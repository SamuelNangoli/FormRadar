import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp, listen } from "../server/app.mjs";
import { createProvider, matchView, teamStatistics } from "../server/data.mjs";

const TOKEN = "test-only-secret-that-must-not-be-forwarded";
const home = { id: 57, name: "Arsenal FC", shortName: "Arsenal", tla: "ARS" };
const away = {
  id: 64,
  name: "Liverpool FC",
  shortName: "Liverpool",
  tla: "LIV",
};
const match = (overrides = {}) => ({
  id: 1,
  utcDate: "2026-11-01T16:30:00Z",
  status: "FINISHED",
  competition: { code: "PL", name: "Premier League" },
  homeTeam: home,
  awayTeam: away,
  score: { fullTime: { home: 2, away: 0 }, winner: "HOME_TEAM" },
  ...overrides,
});

test("API reuses validated crest/emblem metadata in fixtures, standings and config without extra provider calls", async () => {
  const crested = { ...home, crest: "https://crests.football-data.org/57.svg" };
  const competition = { id: 2021, code: "PL", name: "Premier League", emblem: "https://crests.football-data.org/PL.png" };
  let calls = 0;
  await withServer({
    key: TOKEN,
    now: () => Date.parse("2026-11-01T12:00:00Z"),
    fetchImpl: async (url) => {
      calls++;
      return ok(new URL(url).pathname.endsWith("/standings")
        ? { competition, standings: [{ type: "TOTAL", table: [{ position: 1, team: crested }] }] }
        : { competition, matches: [match({ status: "TIMED", competition: undefined, homeTeam: crested })] });
    },
  }, async (base) => {
    const config = await (await fetch(base + "/api/config")).json();
    assert.equal(config.competitions.find((c) => c.code === "PL").id, 2021);
    assert.equal(calls, 0);
    const fixtures = await (await fetch(base + "/api/fixtures")).json();
    assert.equal(fixtures.data.matches[0].homeTeam.crest, crested.crest);
    assert.equal(fixtures.data.matches[0].competition.emblem, competition.emblem);
    assert.equal(fixtures.data.competitionInfo.id, 2021);
    await fetch(base + "/api/fixtures");
    assert.equal(calls, 1, "Rendering/reopening cached fixtures needs no extra provider metadata request");
    const table = await (await fetch(base + "/api/standings")).json();
    assert.equal(table.data.standings[0].table[0].team.crest, crested.crest);
    assert.equal(table.data.competitionInfo.emblem, competition.emblem);
    assert.equal(calls, 2);
    assert.equal(JSON.stringify({ fixtures, table, config }).includes(TOKEN), false);
  });
});
const ok = (body) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
const matchPath =
  "/api/matches?competition=PL&dateFrom=2026-11-01&dateTo=2026-11-02";
async function withServer(options, run) {
  const server = await listen(createApp(options), { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run(base);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("missing token: health is safe and fixtures give actionable setup error", async () => {
  await withServer(
    { key: "", fetchImpl: () => assert.fail("No upstream call without token") },
    async (base) => {
      const config = await (await fetch(`${base}/api/config`)).json();
      assert.equal(config.configured, false);
      assert.equal(config.predictions, "experimental");
      const response = await fetch(base + matchPath);
      assert.equal(response.status, 503);
      assert.equal(
        (await response.json()).error.code,
        "CONFIGURATION_REQUIRED",
      );
    },
  );
});

test("fixtures: token header stays server-side, inclusive date range, null scores and cache", async () => {
  let calls = 0;
  await withServer(
    {
      key: TOKEN,
      fetchImpl: async (url, options) => {
        calls++;
        assert.equal(options.headers["X-Auth-Token"], TOKEN);
        assert.equal(new URL(url).origin, "https://api.football-data.org");
        assert.equal(new URL(url).searchParams.get("dateTo"), "2026-11-03");
        return ok({
          matches: [
            match(),
            match({
              id: 2,
              status: "TIMED",
              score: { fullTime: { home: null, away: null } },
            }),
          ],
        });
      },
    },
    async (base) => {
      const first = await (await fetch(base + matchPath)).json();
      assert.equal(first.data.matches[0].score.home, 2);
      assert.equal(first.data.matches[1].score.home, null);
      assert.equal(first.meta.cache, "miss");
      assert.equal(first.meta.scoresMayBeDelayed, true);
      assert.equal(JSON.stringify(first).includes(TOKEN), false);
      assert.equal(
        (await (await fetch(base + matchPath)).json()).meta.cache,
        "hit",
      );
      assert.equal(calls, 1);
      assert.equal(
        JSON.stringify(
          await (await fetch(base + "/api/config")).json(),
        ).includes(TOKEN),
        false,
      );
    },
  );
});

test("requests are validated before using provider quota; no generic proxy or key endpoint", async () => {
  let calls = 0;
  await withServer(
    {
      key: TOKEN,
      fetchImpl: async () => {
        calls++;
        return ok({});
      },
    },
    async (base) => {
      for (const path of [
        "/api/matches?competition=INVALID",
        "/api/matches?competition=PL&competition=PD",
        "/api/matches?dateFrom=2026-02-30",
        "/api/matches?dateFrom=2026-11-03&dateTo=2026-11-01",
        "/api/matches?dateFrom=2026-01-01&dateTo=2026-03-01",
        "/api/matches?url=https://example.com",
        "/api/standings?competition=PL&token=secret",
        "/api/teams/57/stats?url=https://example.com",
        "/api/fixtures?dateFrom=2026-02-30",
        "/api/results?competition=PL&competition=PD",
        "/api/results?status=TIMED",
      ])
        assert.equal((await fetch(base + path)).status, 400, path);
      for (const path of [
        "/api/teams/-1/stats",
        "/api/teams/999999999/stats",
        "/api/proxy",
        "/api/key",
      ])
        assert.equal((await fetch(base + path)).status, 404, path);
      assert.equal(
        (await fetch(base + "/api/matches", { method: "POST" })).status,
        405,
      );
      assert.equal(calls, 0);
    },
  );
});

test("dedicated fixtures/results default to PL, use status filters, sort and cache separately", async () => {
  let time = Date.parse("2026-11-02T12:00:00Z");
  const requested = [];
  await withServer({
    key: TOKEN,
    now: () => time,
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      requested.push(parsed);
      assert.equal(parsed.pathname, "/v4/competitions/PL/matches");
      return ok({
        competition: { code: "PL", name: "Premier League" },
        matches: [
          match({ id: 1, competition: undefined }),
          match({ id: 2, utcDate: "2026-11-02T10:00:00Z" }),
          match({ id: 3, status: "TIMED", utcDate: "2026-11-03T20:00:00Z", score: {} }),
          match({ id: 4, status: "SCHEDULED", utcDate: "2026-11-02T12:00:00Z", score: {} }),
          match({ id: 5, status: "POSTPONED" }),
          match({ id: 6, status: "IN_PLAY" }),
          match({ id: 7, status: "CANCELLED" }),
        ],
      });
    },
  }, async (base) => {
    const fixtures = await (await fetch(base + "/api/fixtures")).json();
    assert.deepEqual(fixtures.data.matches.map((m) => m.id), [4, 3]);
    assert.equal(fixtures.data.dateFrom, "2026-11-02");
    assert.equal(fixtures.data.dateTo, "2026-11-08");
    assert.equal(requested[0].searchParams.get("status"), "SCHEDULED,TIMED");
    assert.equal(requested[0].searchParams.get("dateTo"), "2026-11-09");
    const results = await (await fetch(base + "/api/results")).json();
    assert.deepEqual(results.data.matches.map((m) => m.id), [2, 1]);
    assert.equal(results.data.matches[1].competition.code, "PL");
    assert.equal(results.data.dateFrom, "2026-10-27");
    assert.equal(results.data.dateTo, "2026-11-02");
    assert.equal(requested[1].searchParams.get("status"), "FINISHED");
    assert.equal(requested[1].searchParams.get("dateTo"), "2026-11-03");
    assert.equal((await (await fetch(base + "/api/fixtures")).json()).meta.cache, "hit");
    time += 61_000;
    assert.equal((await (await fetch(base + "/api/fixtures")).json()).meta.cache, "miss");
    assert.equal((await (await fetch(base + "/api/results")).json()).meta.cache, "hit");
    time += 240_000;
    assert.equal((await (await fetch(base + "/api/results")).json()).meta.cache, "miss");
    assert.equal(requested.length, 4);
  });
});

test("base URL comes from server configuration and refuses credential exfiltration", async () => {
  let calls = 0;
  await withServer({
    key: TOKEN,
    baseUrl: "https://api.football-data.org/v4/",
    fetchImpl: async (url, options) => {
      calls++;
      assert.match(url, /^https:\/\/api\.football-data\.org\/v4\/competitions\/PL\/matches\?/);
      assert.equal(options.redirect, "error");
      assert.equal(options.headers["X-Auth-Token"], TOKEN);
      return ok({ matches: [] });
    },
  }, async (base) => {
    assert.equal((await fetch(base + "/api/fixtures")).status, 200);
  });
  assert.equal(calls, 1);
  for (const baseUrl of [
    "http://api.football-data.org/v4", "https://example.com/v4",
    "https://api.football-data.org.example.com/v4", "https://api.football-data.org/v3",
    "https://api.football-data.org/v4?token=" + TOKEN,
    `https://${TOKEN}@api.football-data.org/v4`, "invalid " + TOKEN,
  ]) {
    assert.throws(() => createApp({ key: TOKEN, baseUrl }),
      (error) => error.code === "INVALID_BASE_URL" && !error.message.includes(TOKEN));
  }
});

test("authentication cooldown retains its error and never serves cached data as a throttle fallback", async () => {
  let time = 1_000_000;
  let calls = 0;
  const provider = createProvider({
    key: TOKEN, now: () => time,
    fetchImpl: async () => ++calls === 1 ? ok({ value: 1 }) : new Response(TOKEN, { status: 401 }),
  });
  await provider.get("/one", 1, (x) => x);
  time += 2;
  for (let i = 0; i < 2; i++) {
    await assert.rejects(provider.get("/one", 1, (x) => x),
      (error) => error.status === 401 && error.code === "INVALID_API_KEY");
  }
  assert.equal(calls, 2);
});

test("HTTP-date and provider counter reset headers set safe shared retry timing", async () => {
  const time = Date.parse("2026-11-02T12:00:00Z");
  let calls = 0;
  await withServer({
    key: TOKEN, now: () => time,
    fetchImpl: async () => {
      calls++;
      return new Response(TOKEN, { status: 429, headers: {
        "Retry-After": new Date(time + 120_000).toUTCString(),
        "X-RequestCounter-Reset": "150",
      } });
    },
  }, async (base) => {
    for (const path of ["/api/fixtures", "/api/results"]) {
      const response = await fetch(base + path);
      assert.equal(response.status, 429);
      assert.equal(response.headers.get("retry-after"), "150");
      const body = await response.text();
      assert.equal(body.includes(TOKEN), false);
    }
    assert.equal(calls, 1);
  });
});

test("malformed provider data returns a controlled error instead of false empty results", async () => {
  for (const [path, body] of [
    ["/api/fixtures", null],
    ["/api/results", { matches: [null] }],
    ["/api/fixtures", { matches: [match({ utcDate: null })] }],
    ["/api/standings", { standings: [{ type: "TOTAL", table: null }] }],
  ]) {
    await withServer({ key: TOKEN, fetchImpl: async () => ok(body) }, async (base) => {
      const response = await fetch(base + path);
      assert.equal(response.status, 502);
      assert.equal((await response.json()).error.code, "INVALID_PROVIDER_DATA");
    });
  }
});

test("standings retain official points and all TOTAL groups, excluding HOME/AWAY splits", async () => {
  const row = {
    position: 1,
    team: home,
    playedGames: 10,
    won: 8,
    draw: 1,
    lost: 1,
    points: 22,
    goalsFor: 20,
    goalsAgainst: 5,
    goalDifference: 15,
  };
  await withServer(
    {
      key: TOKEN,
      fetchImpl: async () =>
        ok({
          season: { startDate: "2026-08-01", endDate: "2027-05-30" },
          standings: [
            { type: "TOTAL", group: "GROUP_A", table: [row] },
            { type: "HOME", table: [row] },
            {
              type: "TOTAL",
              group: "GROUP_B",
              table: [{ ...row, team: away }],
            },
          ],
        }),
    },
    async (base) => {
      const result = await (
        await fetch(base + "/api/standings?competition=CL")
      ).json();
      assert.equal(result.data.standings.length, 2);
      assert.equal(result.data.standings[0].table[0].points, 22);
      assert.equal(result.data.standings[0].table[0].played, 10);
    },
  );
});

test("team statistics use correct home/away perspective, exclude missing scores and retain last-five order", () => {
  const stats = teamStatistics(
    [
      match(),
      match({
        id: 2,
        utcDate: "2026-11-02T12:00:00Z",
        homeTeam: away,
        awayTeam: home,
        score: { fullTime: { home: 3, away: 1 } },
      }),
      match({
        id: 3,
        utcDate: "2026-11-03T12:00:00Z",
        score: { fullTime: { home: 1, away: 1 } },
      }),
      match({ id: 4, score: { fullTime: { home: null, away: null } } }),
      match({ id: 5, status: "TIMED" }),
      match({ id: 6, homeTeam: { id: 2 }, awayTeam: { id: 3 } }),
    ],
    57,
    { days: 90 },
  );
  assert.equal(stats.played, 3);
  assert.equal(stats.excluded, 1);
  assert.equal(stats.goalsFor, 4);
  assert.equal(stats.goalsAgainst, 4);
  assert.deepEqual([stats.won, stats.drawn, stats.lost], [1, 1, 1]);
  assert.deepEqual(stats.form, ["W", "L", "D"]);
  assert.equal(stats.goalsPerMatch, 1.33);
  assert.equal(stats.cleanSheets, 1);
  assert.equal(stats.recentMatches[0].id, 3);
  assert.equal(teamStatistics([], 57, {}).goalsPerMatch, null);
  assert.equal(
    matchView(match({ status: "TIMED", score: {} })).score.home,
    null,
  );
});

test("shootout tallies are removed from displayed goals and team form; incomplete splits are excluded", () => {
  const shootout = match({
    score: {
      duration: "PENALTY_SHOOTOUT",
      winner: "HOME_TEAM",
      fullTime: { home: 7, away: 6 },
      penalties: { home: 6, away: 5 },
    },
  });
  const view = matchView(shootout);
  assert.deepEqual([view.score.home, view.score.away], [1, 1]);
  assert.deepEqual(view.score.penalties, { home: 6, away: 5 });
  const stats = teamStatistics([shootout], 57, {});
  assert.deepEqual(
    [stats.goalsFor, stats.goalsAgainst, stats.drawn, stats.won],
    [1, 1, 1, 0],
  );
  const split = match({
    score: {
      duration: "PENALTY_SHOOTOUT",
      regularTime: { home: 1, away: 1 },
      extraTime: { home: 1, away: 1 },
    },
  });
  assert.equal(matchView(split).score.home, 2);
  const unknown = match({
    score: { duration: "PENALTY_SHOOTOUT", fullTime: { home: 7, away: 6 } },
  });
  assert.equal(matchView(unknown).score.home, null);
  assert.equal(teamStatistics([unknown], 57, {}).excluded, 1);
  const extra = match({
    score: { duration: "EXTRA_TIME", fullTime: { home: 2, away: 1 } },
  });
  assert.equal(teamStatistics([extra], 57, {}).won, 1);
});

test("team stats endpoint requests a bounded 90-day sample and caches the aggregate", async () => {
  let calls = 0;
  await withServer(
    {
      key: TOKEN,
      now: () => Date.parse("2026-11-02T12:00:00Z"),
      fetchImpl: async (url) => {
        calls++;
        const parsed = new URL(url);
        assert.equal(parsed.pathname, "/v4/teams/57/matches");
        assert.equal(parsed.searchParams.get("status"), "FINISHED");
        assert.equal(parsed.searchParams.get("limit"), "500");
        assert.equal(parsed.searchParams.get("dateTo"), "2026-11-03");
        return ok({ matches: [match()] });
      },
    },
    async (base) => {
      const first = await (await fetch(base + "/api/teams/57/stats")).json();
      assert.equal(first.data.played, 1);
      assert.equal(first.data.period.days, 90);
      assert.equal(
        (await (await fetch(base + "/api/teams/57/stats")).json()).meta.cache,
        "hit",
      );
      assert.equal(calls, 1);
    },
  );
});

test("coalesces concurrent requests; stale fallback is bounded and failures trigger cooldown", async () => {
  let time = 1_000_000;
  let calls = 0;
  const provider = createProvider({
    key: TOKEN,
    now: () => time,
    fetchImpl: async () => {
      calls++;
      if (calls === 1) {
        await new Promise((r) => setTimeout(r, 10));
        return ok({ value: 7 });
      }
      return new Response("internal account info " + TOKEN, { status: 503 });
    },
  });
  const both = await Promise.all([
    provider.get("/one", 60_000, (x) => x),
    provider.get("/one", 60_000, (x) => x),
  ]);
  assert.equal(calls, 1);
  assert.equal(both[0].data.value, 7);
  time += 61_000;
  const stale = await provider.get("/one", 60_000, (x) => x);
  assert.equal(stale.meta.stale, true);
  assert.equal(stale.meta.cache, "stale");
  assert.equal(JSON.stringify(stale).includes(TOKEN), false);
  assert.equal(stale.meta.fetchedAt, both[0].meta.fetchedAt);
  await provider.get("/one", 60_000, (x) => x);
  assert.equal(calls, 2, "cooldown avoids retry storm");
  time += 86_400_001;
  await assert.rejects(
    provider.get("/one", 60_000, (x) => x),
    (e) => e.code === "PROVIDER_UNAVAILABLE",
  );
});

test("shared rolling request budget resets and upstream 429 honors a cooldown", async () => {
  let time = 1_000_000;
  let calls = 0;
  const provider = createProvider({
    key: TOKEN,
    maxCalls: 2,
    now: () => time,
    fetchImpl: async () => {
      calls++;
      return ok({});
    },
  });
  await provider.get("/one", 1, (x) => x);
  await provider.get("/two", 1, (x) => x);
  await assert.rejects(
    provider.get("/three", 1, (x) => x),
    (e) => e.status === 429 && e.retryAfter === 60,
  );
  assert.equal(calls, 2);
  time += 60_001;
  await provider.get("/three", 1, (x) => x);
  assert.equal(calls, 3);
  const limited = createProvider({
    key: TOKEN,
    fetchImpl: async () =>
      new Response(TOKEN, { status: 429, headers: { "retry-after": "120" } }),
  });
  await assert.rejects(
    limited.get("/one", 1, (x) => x),
    (e) =>
      e.status === 429 && e.retryAfter === 120 && !e.message.includes(TOKEN),
  );
});

test("provider errors are actionable and never forward raw error bodies or secrets", async () => {
  for (const [status, code] of [
    [401, "INVALID_API_KEY"],
    [403, "PLAN_RESTRICTED"],
    [404, "DATA_UNAVAILABLE"],
    [503, "PROVIDER_UNAVAILABLE"],
  ]) {
    await withServer(
      { key: TOKEN, fetchImpl: async () => new Response(TOKEN, { status }) },
      async (base) => {
        const body = await (await fetch(base + matchPath)).json();
        assert.equal(body.error.code, code);
        assert.equal(JSON.stringify(body).includes(TOKEN), false);
      },
    );
  }
  const network = createProvider({
    key: TOKEN,
    fetchImpl: async () => {
      throw new Error(TOKEN);
    },
  });
  await assert.rejects(
    network.get("/one", 1, (x) => x),
    (e) => e.code === "PROVIDER_UNAVAILABLE" && !e.message.includes(TOKEN),
  );
  const invalid = createProvider({
    key: TOKEN,
    fetchImpl: async () => new Response("not json"),
  });
  await assert.rejects(
    invalid.get("/one", 1, (x) => x),
    (e) => e.code === "INVALID_PROVIDER_DATA",
  );
});

test("production serves the built app, keeps API routes, and blocks secret/source files", async () => {
  const root = await mkdtemp(join(tmpdir(), "formradar-test-"));
  try {
    await writeFile(join(root, "index.html"), "<html>FormRadar</html>");
    await writeFile(join(root, ".env"), TOKEN);
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "assets", "main.js"), 'console.log("safe")');
    await withServer({ key: "", distDir: root }, async (base) => {
      assert.equal(
        await (await fetch(base + "/")).text(),
        "<html>FormRadar</html>",
      );
      assert.equal((await fetch(base + "/matches")).status, 200);
      for (const path of [
        "/.env",
        "/%2eenv",
        "/server/data.mjs",
        "/src/main.jsx",
        "/package.json",
        "/assets/missing.js",
      ])
        assert.equal((await fetch(base + path)).status, 404, path);
      const asset = await fetch(base + "/assets/main.js");
      assert.match(asset.headers.get("cache-control"), /immutable/);
      assert.equal(asset.headers.get("x-content-type-options"), "nosniff");
      assert.equal((await fetch(base + "/api/config")).status, 200);
      assert.equal((await fetch(base + "/api/no-such-route")).status, 404);
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

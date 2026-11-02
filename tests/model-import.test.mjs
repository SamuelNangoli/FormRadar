import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeSeason, loadDataset } from "../model/dataset.mjs";
import { importHistory } from "../model/import.mjs";
import { ApiError } from "../server/data.mjs";

// Synthetic test-only league. Never downloaded and never placed in the app data folder.
function seasonData(season) {
  const matches = [];
  for (let home = 1; home <= 20; home++) for (let away = 1; away <= 20; away++) {
    if (home === away) continue;
    matches.push({ id: season * 1000 + matches.length + 1, status: "FINISHED",
      utcDate: new Date(Date.UTC(season, 7, 1) + matches.length * 86_400_000 / 2).toISOString(),
      season: { startDate: `${season}-08-01` },
      homeTeam: { id: home, name: `Synthetic club ${home}` }, awayTeam: { id: away, name: `Synthetic club ${away}` },
      score: { duration: "REGULAR", fullTime: { home: home % 4, away: away % 3 } } });
  }
  return { testOnly: true, competition: { id: 2021, code: "PL" }, filters: { season }, matches };
}
const fake = (body) => ({ get: async (path) => ({ data: body(Number(new URL('https://test.invalid'+path).searchParams.get('season'))) }) });
async function temporary(run) {
  const root = await mkdtemp(join(tmpdir(), "formradar-model-test-"));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("normalizes complete real-schema 90-minute seasons, deduplicates exact rows and rejects bad coverage/targets", () => {
  const raw = seasonData(2023);
  raw.matches.push(structuredClone(raw.matches[0]));
  const result = normalizeSeason(raw, 2023);
  assert.equal(result.rows.length, 380);
  assert.equal(result.duplicates, 1);
  assert.equal(result.rows[0].homeGoals, 1);
  assert.equal(result.rows[0].homeTeam.provider, "football-data.org");
  for (const modify of [
    x => x.matches.pop(),
    x => { x.matches[0].score.fullTime.home = null; },
    x => { x.matches[0].score.duration = "PENALTY_SHOOTOUT"; },
    x => { x.competition.code = "PD"; },
    x => { x.matches[0].utcDate = "2025-01-01T00:00:00Z"; },
    x => { x.matches[0].utcDate = "2024-02-30T00:00:00Z"; },
    x => { x.matches[1].id = x.matches[0].id; },
  ]) {
    const value = seasonData(2023); modify(value);
    assert.throws(() => normalizeSeason(value, 2023));
  }
});

test("import is resumable, checks source hashes, preserves immutable versions and makes no cache-hit provider calls", async () => temporary(async root => {
  let calls = 0;
  let time = 0;
  const options = { root, now: () => time, wait: async ms => { time += ms; }, log: () => {},
    provider: { get: async path => { calls++; return fake(seasonData).get(path); } } };
  const first = await importHistory(options);
  assert.equal(first.rows.length, 1140);
  assert.equal(first.manifest.testOnly, true);
  assert.equal(calls, 3);
  assert.equal((await stat(join(first.folder, "matches.json"))).mode & 0o077, 0);
  assert.equal((await importHistory({ ...options, provider: { get: () => assert.fail("Cache must resume offline") } })).version, first.version);
  const cache = JSON.parse(await readFile(join(root, "cache.json")));
  await writeFile(join(root, cache[2024].file), "corrupted");
  await assert.rejects(importHistory(options), /checksum/);
  assert.equal(calls, 3);
  await assert.rejects(loadDataset(root), /checksum/);
}));

test("failed later seasons leave reusable cache but do not publish a partial CURRENT dataset", async () => temporary(async root => {
  let calls = 0;
  const fail = { get: async path => {
    calls++;
    if (path.includes("2024")) throw new ApiError(403, "PLAN_RESTRICTED", "Safe plan restriction.");
    return fake(seasonData).get(path);
  } };
  await assert.rejects(importHistory({ root, provider: fail, wait: async () => {}, log: () => {} }), e => e.code === "PLAN_RESTRICTED");
  assert.equal(calls, 2);
  await assert.rejects(readFile(join(root, "CURRENT")));
  assert.equal(Object.keys(JSON.parse(await readFile(join(root, "cache.json")))).length, 1);
  calls = 0;
  const result = await importHistory({ root, provider: { get: path => { calls++; return fake(seasonData).get(path); } }, wait: async () => {}, log: () => {} });
  assert.equal(result.rows.length, 1140);
  assert.equal(calls, 2);
}));

test("temporary failures have one bounded retry; long throttle delays/auth failures stop without synthetic replacement", async () => temporary(async root => {
  let calls = 0;
  const waits = [];
  let time = 0;
  await assert.rejects(importHistory({ root, log: () => {}, now: () => time,
    wait: async ms => { waits.push(ms); time += ms; },
    provider: { get: async () => { calls++; throw new ApiError(502, "PROVIDER_UNAVAILABLE", "Safe unavailable.", 15); } },
  }), e => e.code === "PROVIDER_UNAVAILABLE");
  assert.equal(calls, 2);
  assert.ok(waits.includes(15000));
  calls = 0;
  await assert.rejects(importHistory({ root, log: () => {}, wait: async () => {},
    provider: { get: async () => { calls++; throw new ApiError(429, "RATE_LIMITED", "Safe throttle.", 300); } },
  }));
  assert.equal(calls, 1);
  await assert.rejects(readFile(join(root, "CURRENT")));
}));

test("successful response containing a credential is refused before raw-cache retention", async () => temporary(async root => {
  const key = "synthetic-secret-not-an-api-key";
  const body = seasonData(2023); body.account = key;
  await assert.rejects(importHistory({ root, key, provider: fake(() => body), wait: async () => {}, log: () => {} }), /credential isolation/);
  await assert.rejects(readFile(join(root, "cache.json")));
}));

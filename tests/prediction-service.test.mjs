import test from "node:test";
import assert from "node:assert/strict";
import { createPredictionDemo } from "../server/prediction-service.mjs";
import { createApp, listen } from "../server/app.mjs";

const KEY = "fr_synthetic_backend_test_key_12345678901234567890";
const URL = "http://127.0.0.1:8000";
const reply = () => ({
  home_team: "Arsenal", away_team: "Chelsea",
  probabilities: { home_win: .48, draw: .27, away_win: .25 },
  model_version: "demo-v1", is_demo: true,
});
const response = body => new Response(JSON.stringify(body), {
  headers: { "Content-Type": "application/json" },
});

test("demo connector sends a fixed sample and private header then returns a safe whitelist", async () => {
  let calls = 0;
  const demo = createPredictionDemo({ url: URL, key: KEY, fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url.href, URL + "/predict");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers["X-API-Key"], KEY);
    assert.deepEqual(JSON.parse(options.body), {
      home_team: "Arsenal", away_team: "Chelsea",
      home_rating: 1740, away_rating: 1660, home_form: 11, away_form: 8,
    });
    return response({ ...reply(), privateDebug: KEY });
  }});
  const result = await demo.check();
  assert.equal(calls, 1);
  assert.equal(result.isDemo, true);
  assert.deepEqual(result.probabilities, { home: .48, draw: .27, away: .25 });
  assert.equal(JSON.stringify(result).includes(KEY), false);
  assert.equal(result.privateDebug, undefined);
});

test("missing credentials, example domains and unsafe URLs never receive a key", async () => {
  const cases = [
    { url: "", key: KEY }, { url: URL, key: "" },
    { url: "https://api.example.com", key: KEY },
    { url: "http://remote.test", key: KEY },
    { url: "https://user:pass@remote.test", key: KEY },
    { url: "https://remote.test?key=x", key: KEY },
    { url: URL, key: KEY + "\n" },
  ];
  for (const settings of cases) {
    const service = createPredictionDemo({ ...settings, fetchImpl: () => assert.fail("Do not fetch") });
    assert.equal(service.configured, false);
    await assert.rejects(service.check(), e => e.code === "PREDICTION_DEMO_NOT_CONFIGURED");
  }
});

test("only labelled and valid demo probabilities pass", async () => {
  for (const body of [
    { ...reply(), is_demo: false },
    { ...reply(), model_version: KEY },
    { ...reply(), home_team: KEY },
    { ...reply(), probabilities: { home_win: .9, draw: .9, away_win: .9 } },
    { ...reply(), probabilities: { home_win: ".48", draw: .27, away_win: .25 } },
    { ...reply(), probabilities: { home_win: -.1, draw: .6, away_win: .5 } },
    null,
  ]) {
    const demo = createPredictionDemo({ url: URL, key: KEY, fetchImpl: async () => response(body) });
    await assert.rejects(demo.check(), e => e.status === 502 && !e.message.includes(KEY));
  }
});

test("network, authentication and upstream failures never relay raw errors", async () => {
  for (const [fetchImpl, code] of [
    [async () => { throw new Error(KEY); }, "PREDICTION_DEMO_UNAVAILABLE"],
    [async () => new Response(KEY, { status: 401 }), "PREDICTION_DEMO_AUTH_FAILED"],
    [async () => new Response(KEY, { status: 429 }), "PREDICTION_DEMO_BUSY"],
    [async () => new Response(KEY, { status: 503 }), "PREDICTION_DEMO_UNAVAILABLE"],
    [async () => new Response(KEY), "PREDICTION_DEMO_REQUIRED"],
  ]) {
    await assert.rejects(createPredictionDemo({ url: URL, key: KEY, fetchImpl }).check(),
      e => e.code === code && !e.message.includes(KEY));
  }
});

test("concurrent checks coalesce, success briefly caches and failures pause retries", async () => {
  let time = 10_000, calls = 0;
  const service = createPredictionDemo({ url: URL, key: KEY, now: () => time,
    fetchImpl: async () => { calls++; await new Promise(r => setTimeout(r, 5)); return response(reply()); },
  });
  const [a, b] = await Promise.all([service.check(), service.check()]);
  assert.deepEqual(a, b);
  assert.equal(calls, 1);
  time += 1000;
  await service.check();
  assert.equal(calls, 1);
  time += 5000;
  await service.check();
  assert.equal(calls, 2);
  calls = 0;
  const failed = createPredictionDemo({ url: URL, key: KEY, now: () => time,
    fetchImpl: async () => { calls++; throw new Error(); },
  });
  await assert.rejects(failed.check(), e => e.status === 503);
  await assert.rejects(failed.check(), e => e.status === 429);
  assert.equal(calls, 1);
  time += 3001;
  await assert.rejects(failed.check(), e => e.status === 503);
  assert.equal(calls, 2);
});

test("browser requests cannot choose inputs or override the backend key", async () => {
  let calls = 0;
  const app = createApp({ key: "", predictionServiceUrl: URL, predictionServiceKey: KEY,
    fetchImpl: () => assert.fail("Do not fetch fixtures or trained models"),
    predictionServiceFetchImpl: async (_, options) => {
      calls++;
      assert.equal(options.headers["X-API-Key"], KEY);
      return response(reply());
    },
  });
  const server = await listen(app, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const config = await (await fetch(base + "/api/config")).json();
    assert.equal(config.predictionServiceDemoVersion, 1);
    assert.equal(JSON.stringify(config).includes(KEY), false);
    assert.equal((await fetch(base + "/api/prediction-service/demo?home_team=Other")).status, 400);
    assert.equal(calls, 0);
    const r = await fetch(base + "/api/prediction-service/demo", { headers: { "X-API-Key": "browser-key" } });
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.isDemo, true);
    assert.equal(JSON.stringify(data).includes(KEY), false);
    assert.equal((await fetch(base + "/api/prediction-service/demo", { method: "POST" })).status, 405);
    assert.equal(calls, 1);
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
});

test("the local connection demo is unavailable in the hosted application", async () => {
  const app = createApp({ key: "", hosted: true, predictionServiceUrl: URL,
    predictionServiceKey: KEY, predictionServiceFetchImpl: () => assert.fail("Do not fetch") });
  const server = await listen(app, { port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await (await fetch(base + "/api/config")).json()).predictionServiceDemoVersion, 0);
    assert.equal((await fetch(base + "/api/prediction-service/demo")).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
  }
});

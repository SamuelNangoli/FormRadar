import { ApiError } from "./data.mjs";

const SAMPLE = Object.freeze({
  home_team: "Arsenal", away_team: "Chelsea",
  home_rating: 1740, away_rating: 1660, home_form: 11, away_form: 8,
});

// This connector is exclusively a fixed connection demo, not a forecast source.
export function createPredictionDemo({
  url = process.env.FORMRADAR_API_URL,
  key = process.env.FORMRADAR_API_KEY,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  let endpoint;
  try {
    const base = new URL(url);
    const local = base.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname);
    if ((!local && base.protocol !== "https:") || base.username ||
        base.password || base.search || base.hash ||
        base.hostname === "api.example.com") throw new Error();
    endpoint = new URL("/predict", base);
  } catch {
    endpoint = null;
  }
  const configured = Boolean(endpoint && typeof key === "string" &&
    key.length >= 20 && key.length <= 128 && !/\s/.test(key));
  let pending;
  let cached;
  let expires = 0;
  let cooldown = 0;

  async function request() {
    if (!configured) throw new ApiError(503, "PREDICTION_DEMO_NOT_CONFIGURED",
      "The local prediction service needs its backend address and key. Clear old terminal settings and restart FormRadar.");
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST", redirect: "error",
        headers: { "Content-Type": "application/json", "X-API-Key": key },
        body: JSON.stringify(SAMPLE), signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ApiError(503, "PREDICTION_DEMO_UNAVAILABLE",
        "Could not connect to the prediction service. Keep FastAPI running, then try again.");
    }
    if (response.status === 401 || response.status === 403)
      throw new ApiError(502, "PREDICTION_DEMO_AUTH_FAILED",
        "The prediction service rejected its backend key. Check the local caller configuration and restart FormRadar.");
    if (response.status === 429) throw new ApiError(429, "PREDICTION_DEMO_BUSY",
      "The prediction service is busy. Wait a few seconds and retry.", 5);
    if (!response.ok) throw new ApiError(503, "PREDICTION_DEMO_UNAVAILABLE",
      "The prediction service could not complete the demo. Check that FastAPI is running in demo mode.");
    let body;
    try { body = await response.json(); } catch { /* Never relay raw upstream data. */ }
    if (body?.is_demo !== true) throw new ApiError(502, "PREDICTION_DEMO_REQUIRED",
      "This connection test requires demo mode. Real model forecasts stay in the Experimental model view.");
    const values = [body.probabilities?.home_win, body.probabilities?.draw,
      body.probabilities?.away_win];
    if (body.home_team !== SAMPLE.home_team || body.away_team !== SAMPLE.away_team ||
        body.model_version !== "demo-v1" ||
        !values.every(v => Number.isFinite(v) && v >= 0 && v <= 1) ||
        Math.abs(values.reduce((a, b) => a + b, 0) - 1) > 1e-6)
      throw new ApiError(502, "PREDICTION_DEMO_INVALID",
        "The prediction service returned an unexpected demo response.");
    return {
      available: true, isDemo: true, source: "fastapi-connection-demo",
      sample: { homeTeam: SAMPLE.home_team, awayTeam: SAMPLE.away_team },
      probabilities: { home: values[0], draw: values[1], away: values[2] },
      modelVersion: "demo-v1", checkedAt: new Date(now()).toISOString(),
    };
  }

  async function check() {
    if (cached && now() < expires) return cached;
    if (pending) return pending;
    if (now() < cooldown) throw new ApiError(429, "PREDICTION_DEMO_BUSY",
      "Wait a few seconds before checking the connection again.",
      Math.max(1, Math.ceil((cooldown - now()) / 1000)));
    pending = request().then(result => {
      cached = result;
      expires = now() + 5000;
      return result;
    }).catch(error => {
      cooldown = now() + 3000;
      throw error;
    }).finally(() => { pending = null; });
    return pending;
  }
  return { configured, check };
}

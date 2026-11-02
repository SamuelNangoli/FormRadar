import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PRIVATE } from "../model/paths.mjs";
import { digest, encode, privateDir } from "../model/dataset.mjs";

const DAY = 86_400_000;
const require = (ok) => { if (!ok) throw new Error("Invalid experimental model"); };
const stamp = (v) => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().replace(".000Z", "Z") === v.replace(".000Z", "Z");
const hex = (v, n) => new RegExp(`^[a-f0-9]{${n}}$`).test(v);
export const reasons = {
  MODEL_NOT_READY: "Prepare the current-season model on this computer first.",
  MODEL_INVALID: "The saved experimental model could not be validated. Prepare it again.",
  DATA_STALE: "Model data needs updating. Refresh the current-season model, then retry.",
  UNSUPPORTED_COMPETITION: "Experimental estimates currently support the Premier League only.",
  FIXTURE_NOT_CONFIRMED: "A confirmed kickoff and current-season teams are required.",
  MATCH_STARTED: "New pre-match estimates stop at kickoff. Saved forecasts remain in history.",
  FIXTURE_DATA_STALE: "A fresh fixture check is needed before generating an estimate.",
  OUTSIDE_HORIZON: "Estimates are available within seven days of kickoff.",
  STORAGE_UNAVAILABLE: "The forecast could not be saved. Retry after checking local storage.",
};
const unavailable = (reason) => ({ available: false, reason, message: reasons[reason], probabilities: null });
const validForecast = (f, id) => f.matchId === id && hex(f.forecastId,64) && hex(f.modelVersion,32)
  && hex(f.datasetVersion,64) && hex(f.snapshotVersion,64) && stamp(f.generatedAt) && stamp(f.kickoffAt)
  && Date.parse(f.generatedAt) < Date.parse(f.kickoffAt) && f.mode === "experimental" && f.retrospective === false
  && [f.probabilities?.home,f.probabilities?.draw,f.probabilities?.away].every((p) => Number.isFinite(p) && p >= 0 && p <= 1)
  && Math.abs(f.probabilities.home + f.probabilities.draw + f.probabilities.away - 1) < 1e-9;

export function validateModel(m) {
  require(m?.schemaVersion === 1 && m.role === "experimental-current-season" && m.experimental === true
    && m.deployable === false && m.testOnly === false && m.provider === "football-data.org" && m.competition === "PL"
    && m.season === 2026 && hex(m.modelVersion, 32) && hex(m.datasetVersion, 64) && hex(m.snapshotVersion, 64)
    && JSON.stringify(m.outcomeOrder) === '["home","draw","away"]'
    && m.evaluationIsForDifferentFittedArtifact === true && /^evaluation-[A-Za-z0-9-]+$/.test(m.evaluationReference));
  require([m.trainedAt, m.dataAsOf, m.coverageThrough, m.expiresAt].every(stamp)
    && Date.parse(m.coverageThrough) === Date.parse(m.dataAsOf.slice(0,10))
    && Date.parse(m.trainedAt) >= Date.parse(m.dataAsOf)
    && Date.parse(m.expiresAt) > Date.parse(m.trainedAt)
    && Date.parse(m.expiresAt) <= Date.parse(m.coverageThrough) + DAY
    && Date.parse(m.expiresAt) <= Date.parse(m.dataAsOf) + DAY);
  const p = m.parameters;
  require(p?.family === "regularized-independent-poisson" && p.provider === m.provider
    && Array.isArray(p.teamIds) && p.teamIds.length >= 20 && p.teamIds.length <= 100
    && p.teamIds.every((id) => Number.isSafeInteger(id) && id > 0) && new Set(p.teamIds).size === p.teamIds.length
    && [p.attack, p.defenceWeakness].every((a) => Array.isArray(a) && a.length === p.teamIds.length && a.every((v) => Number.isFinite(v) && Math.abs(v) <= 3))
    && Number.isFinite(p.intercept) && p.intercept >= -3 && p.intercept <= 2
    && Number.isFinite(p.homeAdvantage) && Math.abs(p.homeAdvantage) <= 1
    && Number.isFinite(p.temperature) && p.temperature >= .5 && p.temperature <= 2
    && [1,10].includes(p.alpha) && [null,365].includes(p.halfLifeDays)
    && stamp(p.trainingCutoff) && Date.parse(p.trainingCutoff) <= Date.parse(m.coverageThrough)
    && Number.isInteger(m.currentSeasonMatches) && m.currentSeasonMatches >= 0 && m.currentSeasonMatches <= 380
    && p.trainingMatches === 1140 + m.currentSeasonMatches);
  require(Array.isArray(m.currentTeamIds) && m.currentTeamIds.length === 20
    && new Set(m.currentTeamIds).size === 20 && m.currentTeamIds.every((id) => Number.isSafeInteger(id) && id > 0));
  const e = m.evaluation;
  require(e?.testPoisson?.matches === 380 && e.testFrequencyBaseline?.matches === 380
    && [e.testPoisson, e.testFrequencyBaseline].every((v) => Number.isFinite(v.logLoss) && v.logLoss > 0 && Number.isFinite(v.brier) && v.brier >= 0 && v.brier <= 2)
    && e.testPoisson.logLoss < e.testFrequencyBaseline.logLoss && e.testPoisson.brier <= e.testFrequencyBaseline.brier
    && Array.isArray(e.limitations) && e.limitations.every((v) => typeof v === "string"));
  return m;
}

export function goalProbabilities(lh, la, temperature = 1) {
  require([lh, la].every((v) => Number.isFinite(v) && v > 0 && v <= 50) && Number.isFinite(temperature) && temperature >= .5 && temperature <= 2);
  // A fixed upper ceiling comfortably covers Poisson(50); stop once both tails are negligible.
  const home = [Math.exp(-lh)], away = [Math.exp(-la)];
  let massH = home[0], massA = away[0];
  for (let k=1; k<=200; k++) {
    home.push(home[k-1] * lh/k); away.push(away[k-1] * la/k);
    massH += home[k]; massA += away[k];
    if (k >= 12 && massH >= 1-1e-12 && massA >= 1-1e-12) break;
  }
  require(massH * massA > 1-1e-9);
  const sums = [0,0,0];
  for (let h=0; h<home.length; h++) for (let a=0; a<away.length; a++) sums[h>a ? 0 : h===a ? 1 : 2] += home[h]*away[a];
  const total = sums.reduce((a,b) => a+b,0);
  const scaled = sums.map((p) => Math.log(Math.max(p/total,1e-15))/temperature);
  const maximum = Math.max(...scaled);
  const exp = scaled.map((s) => Math.exp(s-maximum));
  const norm = exp.reduce((a,b) => a+b,0);
  return exp.map((p) => p/norm);
}

export function infer(parameters, homeId, awayId) {
  const h = parameters.teamIds.indexOf(homeId), a = parameters.teamIds.indexOf(awayId);
  const effect = (key, i) => i < 0 ? 0 : parameters[key][i];
  const lh = Math.exp(parameters.intercept + parameters.homeAdvantage + effect("attack", h) + effect("defenceWeakness", a));
  const la = Math.exp(parameters.intercept + effect("attack", a) + effect("defenceWeakness", h));
  const [home, draw, away] = goalProbabilities(lh, la, parameters.temperature);
  return { probabilities: { home, draw, away }, usesPooledPrior: h < 0 || a < 0 };
}

const details = (m) => ({ mode: "experimental", modelVersion: m.modelVersion, datasetVersion: m.datasetVersion,
  snapshotVersion: m.snapshotVersion, trainedAt: m.trainedAt, trainingCutoff: m.parameters.trainingCutoff,
  trainingMatches: m.parameters.trainingMatches, currentSeasonMatches: m.currentSeasonMatches,
  dataAsOf: m.dataAsOf, coverageThrough: m.coverageThrough, expiresAt: m.expiresAt,
  evaluationRef: m.evaluationReference, evaluationUrl: "/api/model/evaluation", evaluationIsForDifferentFittedArtifact: true });

export function createPredictions({ root = PRIVATE, provider, now = Date.now } = {}) {
  const pending = new Map();
  async function load() {
    try {
      let pointer;
      try { pointer = JSON.parse(await readFile(join(root,"EXPERIMENTAL"),"utf8")); }
      catch (e) { if (e.code === "ENOENT") return unavailable("MODEL_NOT_READY"); throw e; }
      require(/^experimental-[A-Za-z0-9-]+$/.test(pointer.run) && hex(pointer.sha256,64));
      const bytes = await readFile(join(root,"runs",pointer.run,"model.json"));
      require(digest(bytes) === pointer.sha256);
      const model = validateModel(JSON.parse(bytes));
      const time = now();
      if (time < Date.parse(model.trainedAt) || time >= Date.parse(model.expiresAt)) return { ...unavailable("DATA_STALE"), ...details(model) };
      return { available: true, model };
    } catch { return unavailable("MODEL_INVALID"); }
  }
  async function status() {
    const state = await load();
    return state.available ? { available: true, ...details(state.model) } : state;
  }
  async function evaluation() {
    const state = await load();
    return state.available ? { available: true, ...details(state.model), retrospective: true, ...state.model.evaluation } : state;
  }
  async function history(id) {
    const folder = join(root,"forecasts",String(id));
    let names;
    try { names = await readdir(folder); } catch (e) { if (e.code === "ENOENT") return { forecasts: [] }; throw e; }
    const forecasts = [];
    for (const name of names) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const f = JSON.parse(await readFile(join(folder,name),"utf8"));
      require(validForecast(f,id) && f.forecastId === name.slice(0,-5));
      forecasts.push(f);
    }
    return { forecasts: forecasts.sort((a,b) => a.generatedAt.localeCompare(b.generatedAt)) };
  }
  async function generate(id) {
    const state = await load();
    if (!state.available) return state;
    const m = state.model;
    const unavailableFor = (reason) => ({ ...unavailable(reason), ...details(m), matchId: id });
    const response = await provider.get(`/matches/${id}`, 60_000, (raw) => raw);
    if (response.meta.stale || now() - Date.parse(response.meta.fetchedAt) >= 60_000) return unavailableFor("FIXTURE_DATA_STALE");
    const f = response.data;
    if (f?.competition?.code !== "PL" || f.competition.id !== 2021) return unavailableFor("UNSUPPORTED_COMPETITION");
    if (f.testOnly === true || f.id !== id || !stamp(f.utcDate)) return unavailableFor("FIXTURE_NOT_CONFIRMED");
    if (Date.parse(f.utcDate) <= now() || ["IN_PLAY","PAUSED","FINISHED"].includes(f.status)) return unavailableFor("MATCH_STARTED");
    if (f.status !== "TIMED" || f.season?.startDate?.slice(0,4) !== String(m.season)
      || f.homeTeam?.id === f.awayTeam?.id || ![f.homeTeam?.id, f.awayTeam?.id].every((t) => m.currentTeamIds.includes(t))
      || Date.parse(f.utcDate) < Date.parse(m.parameters.trainingCutoff)) return unavailableFor("FIXTURE_NOT_CONFIRMED");
    if (Date.parse(f.utcDate) - now() > 7*DAY) return unavailableFor("OUTSIDE_HORIZON");
    const basis = { matchId: id, kickoffAt: f.utcDate, homeTeamId: f.homeTeam.id, awayTeamId: f.awayTeam.id, modelVersion: m.modelVersion, snapshotVersion: m.snapshotVersion };
    const forecastId = digest(JSON.stringify(basis));
    const folder = join(root,"forecasts",String(id)), path = join(folder,`${forecastId}.json`);
    const forecast = { ...basis, forecastId, provider: "football-data.org", competition: "PL", ...details(m),
      ...infer(m.parameters, f.homeTeam.id, f.awayTeam.id), generatedAt: new Date(now()).toISOString(),
      fixtureCheckedAt: response.meta.fetchedAt, retrospective: false };
    // Recheck time after provider access/inference, before persisting a pre-match record.
    if (now() >= Date.parse(f.utcDate)) return unavailableFor("MATCH_STARTED");
    if (now() >= Date.parse(m.expiresAt)) return unavailableFor("DATA_STALE");
    try {
      await privateDir(folder);
      try { await writeFile(path, encode(forecast), { flag: "wx", mode: 0o600 }); }
      catch (error) { if (error.code !== "EEXIST") throw error; }
      const saved = JSON.parse(await readFile(path,"utf8"));
      require(validForecast(saved,id) && saved.forecastId === forecastId && saved.modelVersion === m.modelVersion);
      return { available: true, ...saved };
    } catch { return unavailableFor("STORAGE_UNAVAILABLE"); }
  }
  async function predict(id) {
    if (pending.has(id)) return pending.get(id);
    const task = generate(id);
    pending.set(id, task);
    try { return await task; } finally { pending.delete(id); }
  }
  return { status, evaluation, predict, history };
}

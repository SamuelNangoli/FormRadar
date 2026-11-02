import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { loadServerEnv } from "../server/env.mjs";
import { ApiError, createProvider } from "../server/data.mjs";
import { PRIVATE, PROJECT, VENV } from "./paths.mjs";
import { DatasetError, digest, encode, privateDir, immutable, atomic } from "./dataset.mjs";

const ROOT = join(PRIVATE, "champions-league");
const fail = (message) => { throw new DatasetError(message); };
const positive = (v) => Number.isSafeInteger(v) && v > 0;
const utc = (v) => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v)
  && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().replace(".000Z","Z") === v.replace(".000Z","Z");
const stages = new Set(["GROUP_STAGE","LEAGUE_STAGE","PLAYOFFS","LAST_16","QUARTER_FINALS","SEMI_FINALS","FINAL"]);
const statuses = new Set(["SCHEDULED","TIMED","IN_PLAY","PAUSED","FINISHED","POSTPONED","SUSPENDED","CANCELLED","AWARDED"]);

export function normalizeChampions(raw, season, { current = false, now = Date.now(), allowTest = false } = {}) {
  if (![2023,2024,2025,2026].includes(season) || current !== (season === 2026)
    || raw?.competition?.code !== "CL" || raw.competition.id !== 2001 || !Array.isArray(raw.matches)
    || (raw.filters?.season != null && String(raw.filters.season) !== String(season))) fail("Invalid Champions League source/season.");
  if (raw.testOnly === true && !allowTest) fail("Synthetic sources cannot prepare a Champions League model.");
  const today = new Date(now).toISOString().slice(0,10);
  if (current && (today < "2026-07-01" || today >= "2027-07-01")) fail("The Champions League workflow currently supports 2026/27.");
  const ids = new Set(), pairs = new Set(), teams = new Map(), rounds = new Map(), rows = [];
  const phase = season === 2023 ? "GROUP_STAGE" : "LEAGUE_STAGE";
  const expected = season === 2023 ? { matches:96, teams:32, side:3, rounds:6, perRound:16, opponents:3 } : { matches:144, teams:36, side:4, rounds:8, perRound:18, opponents:8 };
  let phaseCount = 0, excluded = 0;
  for (const m of raw.matches) {
    if (!m || !positive(m.id) || ids.has(m.id) || !positive(m.homeTeam?.id) || !positive(m.awayTeam?.id)
      || m.homeTeam.id === m.awayTeam.id || !statuses.has(m.status) || !stages.has(m.stage) || !utc(m.utcDate)
      || m.utcDate < `${season}-07-01` || m.utcDate >= `${season+1}-07-01`
      || m.season?.startDate?.slice(0,4) !== String(season)
      || (m.competition && (m.competition.code !== "CL" || m.competition.id !== 2001))) fail("Champions League match identity, date, stage or status is invalid.");
    ids.add(m.id);
    if (m.stage !== phase) { excluded++; continue; }
    phaseCount++;
    const pair = season === 2023 ? `${m.homeTeam.id}:${m.awayTeam.id}` : [m.homeTeam.id,m.awayTeam.id].sort((a,b)=>a-b).join(":");
    if (pairs.has(pair)) fail("Champions League phase contains a repeated pairing.");
    pairs.add(pair);
    if (!Number.isInteger(m.matchday) || m.matchday < 1 || m.matchday > expected.rounds) fail("Invalid Champions League matchday.");
    rounds.set(m.matchday,(rounds.get(m.matchday)||0)+1);
    for (const [team,opponent,side] of [[m.homeTeam,m.awayTeam,"home"],[m.awayTeam,m.homeTeam,"away"]]) {
      const t = teams.get(team.id) || { home:0, away:0, opponents:new Set() };
      t[side]++;t.opponents.add(opponent.id);teams.set(team.id,t);
    }
    if (current && m.status === "FINISHED" && Date.parse(m.utcDate) >= now) fail("A future Champions League match is marked finished.");
    if (current && m.utcDate.slice(0,10) < today && ["SCHEDULED","TIMED","IN_PLAY","PAUSED"].includes(m.status)) fail("An earlier Champions League match has an unresolved status. Retry after the provider updates it.");
    if (!current && m.status !== "FINISHED") fail("The historical Champions League phase is incomplete.");
    if (m.status !== "FINISHED" || (current && m.utcDate.slice(0,10) >= today)) continue;
    const score = m.score?.regularTime || m.score?.fullTime;
    if (m.score?.duration !== "REGULAR" || ![score?.home,score?.away].every(v=>Number.isInteger(v)&&v>=0&&v<=50)) fail("Champions League phase result has no valid 90-minute score.");
    const team = (t) => ({ provider:"football-data.org", id:t.id, name:t.shortName||t.name||String(t.id) });
    rows.push({ provider:"football-data.org", competition:"CL", season, stage:phase, matchday:m.matchday,
      id:m.id, utcDate:new Date(m.utcDate).toISOString(), homeTeam:team(m.homeTeam), awayTeam:team(m.awayTeam), homeGoals:score.home, awayGoals:score.away });
  }
  if (phaseCount !== expected.matches || teams.size !== expected.teams || rounds.size !== expected.rounds
    || [...rounds.values()].some(n=>n!==expected.perRound)
    || [...teams.values()].some(t=>t.home!==expected.side||t.away!==expected.side||t.opponents.size!==expected.opponents)) fail("Champions League phase coverage failed: expected all fixtures, clubs, matchdays and home/away allocations.");
  if (!current && rows.length !== expected.matches) fail("Historical Champions League targets are incomplete.");
  return { rows:rows.sort((a,b)=>a.utcDate.localeCompare(b.utcDate)||a.id-b.id), teamIds:[...teams.keys()].sort((a,b)=>a-b),
    excludedKnockoutMatches:excluded, phase, coverageThrough:today+"T00:00:00.000Z" };
}

export async function importChampions({ root = ROOT, provider, key, now = Date.now, wait = (ms)=>new Promise(r=>setTimeout(r,ms)), log = console.log } = {}) {
  await privateDir(join(root,"raw"));
  let cache = {};
  try { cache=JSON.parse(await readFile(join(root,"cache.json"),"utf8")); } catch(e) { if(e.code!=="ENOENT") fail("Champions League cache index is unreadable."); }
  const sources=[], history=[];let current, lastRequest=-Infinity;
  for (const season of [2023,2024,2025,2026]) {
    let source=cache[season], raw;
    const useCache = source && (season!==2026 || (source.fetchedAt.slice(0,10)===new Date(now()).toISOString().slice(0,10) && now()-Date.parse(source.fetchedAt)<3_600_000));
    if (useCache) {
      if (!new RegExp(`^raw/CL-${season}-[a-f0-9]{64}\\.json$`).test(source.file)) fail("Invalid Champions League cache path.");
      const bytes=await readFile(join(root,source.file));
      if(digest(bytes)!==source.sha256)fail("Champions League cache checksum failed.");
      raw=JSON.parse(bytes);
    } else {
      await wait(Math.max(0,8500-(now()-lastRequest)));lastRequest=now();
      const response=await provider.get(`/competitions/CL/matches?season=${season}`,0,v=>v);
      if(response.meta.stale)fail("A fresh Champions League source is required.");
      raw=response.data;
      const bytes=encode(raw);
      if(key?.trim()&&bytes.includes(key.trim()))fail("Credential isolation failed; no Champions League response was saved.");
      normalizeChampions(raw,season,{current:season===2026,now:now()});
      const sha=digest(bytes);source={season,file:`raw/CL-${season}-${sha}.json`,sha256:sha,fetchedAt:response.meta.fetchedAt};
      await immutable(join(root,source.file),bytes);cache[season]=source;await atomic(join(root,"cache.json"),encode(cache));
    }
    const normalized=normalizeChampions(raw,season,{current:season===2026,now:now()});
    log(`CL ${season}/${String(season+1).slice(2)}: ${normalized.rows.length} valid phase results; ${normalized.teamIds.length} clubs.`);
    if(season===2026)current={source,normalized};else {history.push(...normalized.rows);sources.push(source);}
  }
  const bytes=encode(history), normalizedSha256=digest(bytes);
  const version=digest(JSON.stringify([1,normalizedSha256,...sources.map(s=>s.sha256)]));
  const folder=join(root,"datasets",version);await privateDir(folder);
  await immutable(join(folder,"matches.json"),bytes);
  const manifest={schemaVersion:1,datasetVersion:version,normalizedSha256,provider:"football-data.org",competition:"CL",testOnly:false,sources,rows:history.length};
  await immutable(join(folder,"manifest.json"),encode(manifest));
  if(new Set([...history,...current.normalized.rows].map(r=>r.id)).size!==history.length+current.normalized.rows.length)fail("Champions League match IDs overlap across seasons.");
  const snapshot={schemaVersion:1,provider:"football-data.org",competition:"CL",season:2026,testOnly:false,historicalDatasetVersion:version,
    fetchedAt:current.source.fetchedAt,expiresAt:new Date(Math.min(Date.parse(current.source.fetchedAt)+86_400_000,Date.parse(current.normalized.coverageThrough)+86_400_000)).toISOString(),sourceSha256:current.source.sha256,...current.normalized};
  const content=encode(snapshot), snapshotVersion=digest(content);await privateDir(join(root,"current"));await immutable(join(root,"current",snapshotVersion+".json"),content);
  return {version,snapshotVersion};
}

async function main() {
  process.umask(0o077);
  if(process.argv.length!==2)fail("Use npm run model:prepare-cl without arguments.");
  const env={...process.env,PYTHONDONTWRITEBYTECODE:"1",OPENBLAS_NUM_THREADS:"1",OMP_NUM_THREADS:"1"};
  for(const k of Object.keys(env))if(/^(FOOTBALL_DATA_|GUARDIAN_API_KEY$)/.test(k))delete env[k];
  const python=join(VENV,"bin/python3"),probe=spawnSync(python,["-c","import numpy,scipy"],{env,stdio:"pipe"});
  if(probe.status!==0)fail("Run npm run model:setup first.");
  loadServerEnv();const key=process.env.FOOTBALL_DATA_API_KEY;
  const provider=createProvider({key,baseUrl:process.env.FOOTBALL_DATA_BASE_URL||"https://api.football-data.org/v4",maxCalls:6});
  const data=await importChampions({provider,key});
  const result=spawnSync(python,["model/champions.py",data.version,data.snapshotVersion],{cwd:PROJECT,env,stdio:"inherit"});
  process.exitCode=result.error?1:result.status??1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{
  console.error(e instanceof DatasetError||e instanceof ApiError?e.message:"Could not validate Champions League model inputs. Private data and credentials are not printed.");process.exitCode=1;
});

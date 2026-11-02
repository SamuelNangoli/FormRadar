// All model/provider fixtures in this file are synthetic, isolated in temporary folders.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createPredictions, goalProbabilities, infer } from "../server/predictions.mjs";
import { createApp, listen } from "../server/app.mjs";
import { createProvider } from "../server/data.mjs";
import { digest } from "../model/dataset.mjs";
import { normalizeCurrent } from "../model/current.mjs";
import { VENV, PROJECT } from "../model/paths.mjs";
import { displayPercentages } from "../src/probability.js";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const match = (extra={}) => ({ id: 500, competition: {code:"PL",id:2021}, season:{startDate:"2026-08-21"},
  utcDate:"2026-11-03T20:00:00Z", status:"TIMED", homeTeam:{id:1}, awayTeam:{id:2}, ...extra });
import { syntheticModel } from "./fixtures/prediction.mjs";

async function register(root,model=syntheticModel()) {
  const run = `experimental-${model.modelVersion}`;
  const folder=join(root,"runs",run);
  await mkdir(folder,{recursive:true});
  const bytes=JSON.stringify(model);
  await writeFile(join(folder,"model.json"),bytes);
  await writeFile(join(root,"EXPERIMENTAL"),JSON.stringify({run,sha256:digest(bytes)}));
}
async function isolated(run) {
  const root=await mkdtemp(join(tmpdir(),"formradar-synthetic-predictions-"));
  try { await run(root); } finally { await rm(root,{recursive:true,force:true}); }
}
const providerFor = (fixture=match()) => ({get:async()=>({data:fixture,meta:{stale:false,fetchedAt:new Date(NOW).toISOString()}})});

test("current-season validation requires full membership and genuine completed targets before today", () => {
  const matches=[];
  for(let h=1;h<=20;h++) for(let a=1;a<=20;a++) if(h!==a) matches.push(match({id:1000+matches.length,homeTeam:{id:h},awayTeam:{id:a}}));
  matches[0]={...matches[0],status:"FINISHED",utcDate:"2026-11-01T16:00:00Z",score:{duration:"REGULAR",fullTime:{home:2,away:1}}};
  matches[1]={...matches[1],status:"FINISHED",utcDate:"2026-11-02T09:00:00Z",score:{duration:"REGULAR",fullTime:{home:0,away:0}}};
  const raw={competition:{code:"PL",id:2021},filters:{season:"2026"},matches};
  assert.equal(normalizeCurrent(raw,NOW).rows.length,1,"same UTC day must not enter training");
  assert.throws(()=>normalizeCurrent({...raw,testOnly:true},NOW),/Synthetic/);
  assert.throws(()=>normalizeCurrent({...raw,matches:matches.slice(1)},NOW),/380/);
  const bad=structuredClone(raw);bad.matches[0].score.fullTime.home=null;
  assert.throws(()=>normalizeCurrent(bad,NOW),/missing or invalid/);
  bad.matches[0]={...matches[0],status:"TIMED"};
  assert.throws(()=>normalizeCurrent(bad,NOW),/unresolved/);
  bad.matches[0]={...matches[0],homeTeam:{id:2},awayTeam:{id:2}};
  assert.throws(()=>normalizeCurrent(bad,NOW),/identity/);
});

test("Node inference matches Python over asymmetric, prior and extreme rate cases", () => {
  const rates=[[1.2,1.2,1],[3,.5,.85],[.5,3,1.15],[.01,49.9,2],[50,50,.5]];
  const p=syntheticModel().parameters;
  p.attack[0]=.7;p.defenceWeakness[1]=-.3;
  const input={rates,model:p};
  const code="import json,sys;sys.path.insert(0,'model');import train;d=json.load(sys.stdin);print(json.dumps({'rates':[train.temper(train.goal_probabilities(h,a),t).tolist() for h,a,t in d['rates']],'prior':train.predict(d['model'],[{'utcDate':'2026-11-03T20:00:00Z','homeTeam':{'id':1},'awayTeam':{'id':999}}])[0].tolist()[0]}))";
  const result=spawnSync(join(VENV,"bin/python3"),["-c",code],{cwd:PROJECT,input:JSON.stringify(input),encoding:"utf8",env:{...process.env,PYTHONDONTWRITEBYTECODE:"1",OPENBLAS_NUM_THREADS:"1"}});
  assert.equal(result.status,0,result.stderr);
  const reference=JSON.parse(result.stdout);
  rates.forEach((r,i)=>goalProbabilities(...r).forEach((v,j)=>assert.ok(Math.abs(v-reference.rates[i][j])<1e-10)));
  const actual=infer(p,1,999);
  assert.equal(actual.usesPooledPrior,true);
  Object.values(actual.probabilities).forEach((v,j)=>assert.ok(Math.abs(v-reference.prior[j])<1e-10));
  assert.equal(displayPercentages({home:1/3,draw:1/3,away:1/3}).reduce((a,b)=>a+b),100);
});

test("registry refuses absent, corrupted, synthetic, stale or future-dated models before provider access", async()=>isolated(async(root)=>{
  const service=createPredictions({root,now:()=>NOW,provider:{get:()=>assert.fail("Must not fetch")}});
  assert.equal((await service.predict(500)).reason,"MODEL_NOT_READY");
  for (const [patch,reason] of [[{testOnly:true},"MODEL_INVALID"],[{expiresAt:"2026-11-02T11:00:00Z"},"DATA_STALE"],
    [{trainedAt:"2026-11-02T13:00:00Z"},"DATA_STALE"]]) {
    await register(root,{...syntheticModel(),...patch});
    assert.equal((await service.predict(500)).reason,reason);
  }
  await register(root);await writeFile(join(root,"runs",`experimental-${"a".repeat(32)}`,"model.json"),"{}");
  assert.equal((await service.predict(500)).reason,"MODEL_INVALID");
}));

test("fixture gate refuses other leagues, uncertain status, kickoff, stale data and long horizons", async()=>isolated(async(root)=>{
  await register(root);
  for (const [patch,reason] of [[{competition:{code:"PD",id:2014}},"UNSUPPORTED_COMPETITION"],[{status:"SCHEDULED"},"FIXTURE_NOT_CONFIRMED"],
    [{status:"POSTPONED"},"FIXTURE_NOT_CONFIRMED"],[{utcDate:new Date(NOW).toISOString()},"MATCH_STARTED"],
    [{status:"FINISHED"},"MATCH_STARTED"],[{homeTeam:{id:999}},"FIXTURE_NOT_CONFIRMED"],[{utcDate:"2026-11-10T20:00:00Z"},"OUTSIDE_HORIZON"]]) {
    const s=createPredictions({root,now:()=>NOW,provider:providerFor(match(patch))});
    const result=await s.predict(500);assert.equal(result.reason,reason);assert.equal(result.probabilities,null);
  }
  const stale=createPredictions({root,now:()=>NOW,provider:{get:async()=>({data:match(),meta:{stale:true}})}});
  assert.equal((await stale.predict(500)).reason,"FIXTURE_DATA_STALE");
  await assert.rejects(readdir(join(root,"forecasts")),{code:"ENOENT"});
}));

test("forecasts persist before return, coalesce, retain originals and keep kickoff/model revisions", async()=>isolated(async(root)=>{
  await register(root);
  let time=NOW,calls=0,fixture=match();
  const provider={get:async()=>{calls++;return {data:fixture,meta:{stale:false,fetchedAt:new Date(time).toISOString()}};}};
  const s=createPredictions({root,now:()=>time,provider});
  const [a,b]=await Promise.all([s.predict(500),s.predict(500)]);
  assert.equal(a.available,true);assert.deepEqual(a,b);assert.equal(calls,1);
  const path=join(root,"forecasts","500",`${a.forecastId}.json`);
  const original=await readFile(path,"utf8");
  time+=1000;assert.deepEqual(await s.predict(500),a);assert.equal(await readFile(path,"utf8"),original);
  fixture=match({utcDate:"2026-11-04T20:00:00Z"});
  const revised=await s.predict(500);assert.notEqual(revised.forecastId,a.forecastId);
  const next={...syntheticModel(),modelVersion:"d".repeat(32)};await register(root,next);
  const newModel=await s.predict(500);assert.notEqual(newModel.forecastId,revised.forecastId);
  assert.equal((await s.history(500)).forecasts.length,3);
  assert.equal((await s.evaluation()).retrospective,true);
  time=Date.parse(fixture.utcDate);
  assert.equal((await s.predict(500)).available,false);assert.equal((await s.history(500)).forecasts.length,3);
}));

test("storage failure and expiry during a provider check return null probabilities", async()=>isolated(async(root)=>{
  await register(root);
  await writeFile(join(root,"forecasts"),"synthetic obstruction");
  const s=createPredictions({root,now:()=>NOW,provider:providerFor()});
  const blocked=await s.predict(500);
  assert.equal(blocked.reason,"STORAGE_UNAVAILABLE");assert.equal(blocked.probabilities,null);
  let time=NOW;
  const expired=createPredictions({root,now:()=>time,provider:{get:async()=>{
    time=Date.parse("2026-11-03T00:00:00Z");return {data:match(),meta:{stale:false,fetchedAt:new Date(time).toISOString()}};
  }}});
  const result=await expired.predict(500);
  assert.equal(result.reason,"DATA_STALE");assert.equal(result.probabilities,null);
}));

test("HTTP prediction routes reject arbitrary inputs, share provider cache and expose no token or parameters",async()=>isolated(async(root)=>{
  await register(root);let calls=0;
  const token="synthetic-prediction-test-secret";
  const app=createApp({modelRoot:root,key:token,now:()=>NOW,fetchImpl:async(url,options)=>{
    calls++;assert.equal(options.headers["X-Auth-Token"],token);assert.equal(new URL(url).pathname,"/v4/matches/500");
    return new Response(JSON.stringify(match()));
  }});
  const server=await listen(app,{port:0});const base=`http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base+"/api/predictions/500?homeTeam=3")).status,400);assert.equal(calls,0);
    const a=await(await fetch(base+"/api/predictions/500")).json();assert.equal(a.available,true);
    const b=await(await fetch(base+"/api/predictions/500")).json();assert.equal(b.forecastId,a.forecastId);assert.equal(calls,1);
    const h=await(await fetch(base+"/api/predictions/500/history")).json();assert.equal(h.forecasts.length,1);
    const text=JSON.stringify({a,h});assert.equal(text.includes(token),false);assert.equal(text.includes('"parameters"'),false);
  } finally {server.closeAllConnections();await new Promise((resolve)=>server.close(resolve));}
}));

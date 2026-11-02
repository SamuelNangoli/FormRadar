import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,writeFile,mkdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {normalizeChampions,importChampions} from "../model/champions.mjs";
import {championsSeason} from "./fixtures/champions.mjs";
import {syntheticModel} from "./fixtures/prediction.mjs";
import {createPredictions} from "../server/predictions.mjs";
import {createApp,listen} from "../server/app.mjs";
import {digest} from "../model/dataset.mjs";

const NOW=Date.parse("2026-11-02T12:00:00Z");
const normalize=(raw,season)=>normalizeChampions(raw,season,{current:season===2026,now:NOW,allowTest:true});
const fixture=()=>({...championsSeason(2026).matches.find(m=>m.status==="TIMED"),id:500});
const clModel=()=>{
  const m=syntheticModel();Object.assign(m,{competition:"CL",modelVersion:"e".repeat(32),supportedStages:["LEAGUE_STAGE"],currentSeasonMatches:54,currentTeamIds:Array.from({length:36},(_,i)=>i+1)});
  Object.assign(m.parameters,{teamIds:m.currentTeamIds,attack:Array(36).fill(0),defenceWeakness:Array(36).fill(0),trainingMatches:438});
  m.evaluation.testPoisson.matches=m.evaluation.testFrequencyBaseline.matches=144;
  return m;
};
async function register(root,m){const run=`experimental-${m.modelVersion}`;await mkdir(join(root,"runs",run),{recursive:true});const bytes=JSON.stringify(m);await writeFile(join(root,"runs",run,"model.json"),bytes);await writeFile(join(root,"EXPERIMENTAL"),JSON.stringify({run,sha256:digest(bytes)}));}
async function isolated(run){const root=await mkdtemp(join(tmpdir(),"formradar-synthetic-cl-"));try{await run(root);}finally{await rm(root,{recursive:true,force:true});}}

test("CL phase coverage handles the format change and excludes knockout/extra-time matches",()=>{
  for(const [season,count,clubs] of [[2023,96,32],[2024,144,36],[2025,144,36]]){
    const raw=championsSeason(season);
    raw.matches.push({...raw.matches[0],id:9000000,stage:"FINAL",score:{duration:"PENALTY_SHOOTOUT",fullTime:{home:6,away:5}}});
    const n=normalize(raw,season);assert.equal(n.rows.length,count);assert.equal(n.teamIds.length,clubs);assert.equal(n.excludedKnockoutMatches,1);
  }
  const raw=championsSeason(2025);
  assert.throws(()=>normalize({...raw,matches:raw.matches.slice(1)},2025),/coverage/);
  raw.matches[0].score.fullTime.home=null;assert.throws(()=>normalize(raw,2025),/90-minute/);
  raw.matches[0]=championsSeason(2025).matches[0];raw.matches[1].id=raw.matches[0].id;assert.throws(()=>normalize(raw,2025),/identity/);
  assert.throws(()=>normalizeChampions(championsSeason(2025),2025,{now:NOW}),/Synthetic/);
});

test("current CL snapshot excludes today and refuses unresolved earlier results and missing goals",()=>{
  const raw=championsSeason(2026);assert.equal(normalize(raw,2026).rows.length,54);
  raw.matches[0].utcDate="2026-11-02T10:00:00Z";assert.equal(normalize(raw,2026).rows.length,53);
  raw.matches[0].utcDate="2026-11-01T20:00:00Z";raw.matches[0].status="TIMED";assert.throws(()=>normalize(raw,2026),/unresolved/);
  raw.matches[0].status="FINISHED";raw.matches[0].score.duration="EXTRA_TIME";assert.throws(()=>normalize(raw,2026),/90-minute/);
});

test("CL import versions sources, resumes without requests and refuses credential echoes/corruption",async()=>isolated(async(root)=>{
  let calls=0;const waits=[];let clock=NOW;
  const provider={get:async(path)=>{calls++;const season=Number(new URL("https://test.invalid"+path).searchParams.get("season"));const raw=championsSeason(season);delete raw.testOnly;return {data:raw,meta:{fetchedAt:new Date(clock).toISOString(),stale:false}};}};
  const options={root,provider,now:()=>clock,wait:async(ms)=>{waits.push(ms);clock+=ms;},log:()=>{}};
  const first=await importChampions(options);assert.equal(calls,4);assert.equal(waits.filter(n=>n===8500).length,3);
  const manifest=JSON.parse(await readFile(join(root,"datasets",first.version,"manifest.json"),"utf8"));assert.equal(manifest.rows,384);
  const snapshot=JSON.parse(await readFile(join(root,"current",first.snapshotVersion+".json"),"utf8"));assert.equal(snapshot.rows.length,54);assert.equal(snapshot.teamIds.length,36);
  const second=await importChampions(options);assert.equal(second.version,first.version);assert.equal(calls,4);
  const cache=JSON.parse(await readFile(join(root,"cache.json"),"utf8"));await writeFile(join(root,cache[2023].file),"{}");
  await assert.rejects(importChampions(options),/checksum/);
  const other=join(root,"credential-test");const key="synthetic-cl-secret";
  await assert.rejects(importChampions({...options,root:other,key,provider:{get:async()=>({data:{echo:key},meta:{}})}}),/Credential isolation/);
}));

test("CL registry is separate from PL and enforces competition, league phase and current clubs",async()=>isolated(async(root)=>{
  await register(root,syntheticModel());let current=fixture();
  const service=createPredictions({root,now:()=>NOW,provider:{get:async()=>({data:current,meta:{stale:false,fetchedAt:new Date(NOW).toISOString()}})}});
  assert.equal((await service.predict(500,"CL")).reason,"MODEL_NOT_READY","PL artifact cannot fill a missing CL model");
  await register(join(root,"champions-league"),clModel());
  const result=await service.predict(500,"CL");assert.equal(result.available,true);assert.equal(result.competition,"CL");assert.equal(result.trainingMatches,438);assert.equal(result.evaluationUrl,"/api/model/evaluation?competition=CL");
  assert.equal((await service.evaluation("CL")).testPoisson.matches,144);
  assert.equal((await service.history(500)).forecasts[0].competition,"CL");
  assert.equal((await service.predict(500,"PL")).reason,"UNSUPPORTED_COMPETITION");
  current={...fixture(),stage:"LAST_16"};assert.equal((await service.predict(500,"CL")).reason,"UNSUPPORTED_STAGE");
  current={...fixture(),homeTeam:{id:999}};assert.equal((await service.predict(500,"CL")).reason,"FIXTURE_NOT_CONFIRMED");
  assert.equal((await service.status("PD")).reason,"UNSUPPORTED_COMPETITION");
}));

test("HTTP API selects CL explicitly, reports backend capabilities and rejects arbitrary model inputs",async()=>isolated(async(root)=>{
  await register(join(root,"champions-league"),clModel());
  const app=createApp({modelRoot:root,now:()=>NOW,key:"synthetic-cl-token",fetchImpl:async()=>new Response(JSON.stringify(fixture()))});
  const server=await listen(app,{port:0});const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const config=await(await fetch(base+"/api/config")).json();assert.equal(config.predictionsApiVersion,2);assert.deepEqual(config.predictionCompetitions,["PL","CL"]);
    const status=await(await fetch(base+"/api/model/status?competition=CL")).json();assert.equal(status.available,true);
    const estimate=await(await fetch(base+"/api/predictions/500?competition=CL")).json();assert.equal(estimate.available,true);assert.equal(estimate.competition,"CL");
    assert.equal((await fetch(base+"/api/predictions/500?competition=CL&path=anything")).status,400);
    assert.equal((await fetch(base+"/api/model/status?competition=CL&competition=PL")).status,400);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}));

test("Tomorrow CL fixtures exclude adjacent days even when the provider returns a broader range",async()=>isolated(async(root)=>{
  const matches=[{...fixture(),utcDate:"2026-11-02T20:00:00Z",id:498},{...fixture(),id:500},
    {...fixture(),utcDate:"2026-11-04T20:00:00Z",id:501}];
  const app=createApp({modelRoot:root,now:()=>NOW,key:"synthetic-cl-token",fetchImpl:async()=>new Response(JSON.stringify({competition:{code:"CL",id:2001},matches}))});
  const server=await listen(app,{port:0});const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const response=await(await fetch(base+"/api/fixtures?competition=CL&dateFrom=2026-11-03&dateTo=2026-11-03")).json();
    assert.deepEqual(response.data.matches.map(m=>m.id),[500]);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}));

import test from "node:test";
import assert from "node:assert/strict";
import {recentFixtures,absenceReports,playerStatistics,possibleXI,buildPlayerTeam} from "../server/player-context.mjs";
import {createLineupSource,apiStartingXI} from "../server/lineups.mjs";
import {createApp,listen} from "../server/app.mjs";
import {NOW,MATCH,history,bundles,injuries,squad,fakeFeed,target} from "./fixtures/player-context.mjs";
const KEY="synthetic-private-lineup-key";

const build=(extra={})=>buildPlayerTeam({teamId:40,history:history(),bundles:bundles(),squadRows:squad(40),injuries:injuries(),fixtureId:900,normalizeXI:apiStartingXI,cutoff:NOW,...extra});

test("recent histories reject future, stale, duplicate and wrong-team fixtures",()=>{
  const good=history();
  const rows=[...good,good[0],{...target(),fixture:{id:999,date:"2026-11-05T12:00:00Z",status:{short:"FT"}}},
    {...good[0],fixture:{id:800,date:"2026-01-01T12:00:00Z",status:{short:"FT"}}},
    {...good[0],fixture:{id:700,date:good[0].fixture.date,status:{short:"FT"}},teams:{home:{id:1},away:{id:2}}}];
  assert.deepEqual(recentFixtures(rows,40,NOW).map(f=>f.fixture.id),[901,902,903]);
});

test("ratings use actual finite grades and keep missing metrics unavailable",()=>{
  const rows=bundles()[0].players;
  rows[0].players[0].statistics[0].games.rating="";
  rows[0].players[1].statistics[0].goals.assists=null;
  rows[0].players[2].statistics[0].games.rating="11.2";
  const stats=playerStatistics(rows,40);
  assert.equal(stats.get(1).rating,null);
  assert.equal(stats.get(2).assists,null);
  assert.equal(stats.get(3).rating,null);
  assert.equal(stats.get(4).rating,7.2);
  assert.equal(playerStatistics(rows,999).size,0);
  const input=bundles();input[0].players[0].players=[];
  const team=build({bundles:input});
  assert.equal(team.players.find(p=>p.id===1).ratedMatches,2);
  assert.equal(team.players.find(p=>p.id===1).minutes,null,"unknown minutes never become zero or a complete total");
});

test("absence matching preserves fixture and team identities and distinguishes doubtful from out",()=>{
  const rows=[...injuries(),{...injuries()[0],fixture:{id:999}},{...injuries()[0],team:{id:42}}];
  const reports=absenceReports(rows,900,40);
  assert.equal(reports.length,2);
  assert.equal(reports[0].category,"suspension");
  assert.equal(reports[1].status,"doubtful");
});

test("possible XI keeps formation and positions, excludes reported outs and uses a real replacement",()=>{
  const team=build();
  assert.equal(team.possible.kind,"estimated");
  assert.equal(team.possible.players.length,11);
  assert.equal(team.possible.players.some(p=>p.id===2),false);
  assert.equal(team.possible.players.some(p=>p.id===12),true);
  assert.equal(team.possible.players.filter(p=>p.position==="G").length,1);
  assert.equal(team.possible.players.find(p=>p.id===9).availability,"doubtful");
  assert.equal(team.players.find(p=>p.id===1).averageRating,7.2);
  assert.equal(team.possible.calibrated,false);
  assert.equal(possibleXI(team.players,"4-3-3",team.absences,false,3),null);
  assert.equal(possibleXI(team.players,"4-3-3",team.absences,true,1),null);
  assert.equal(possibleXI(team.players.filter(p=>p.id!==12),"4-3-3",team.absences,true,3),null);
});

test("wrong and future detail bundles cannot supply ratings or candidate players",()=>{
  const rows=bundles();rows[0].fixture.date="2026-11-04T12:00:00Z";
  rows[1].teams.home.id=999;
  const team=build({bundles:rows});
  assert.equal(team.historyMatches,1);
  assert.equal(team.possible,null);
});

test("provider context batches history, respects existing eight-call budget and caches follow-up views",async()=>{
  const observed=[];
  const fetchImpl=async(url,options)=>{
    assert.equal(options.headers["x-apisports-key"],KEY);
    assert.equal(options.redirect,"error");
    return fakeFeed({observed})(url,options);
  };
  const source=createLineupSource({key:KEY,now:()=>NOW,fetchImpl});
  const context=await source.playerContext(MATCH);
  assert.equal(observed.length,8);
  assert.ok(observed.includes("/fixtures?ids=901-902-903"));
  assert.equal(context.home.possible.players.length,11);
  assert.equal(context.home.historyMatches,3);
  assert.equal(context.injuriesAvailable,true);
  assert.equal(context.affectsPredictions,false);
  assert.equal(JSON.stringify(context).includes(KEY),false);
  await source.playerContext(MATCH);
  assert.equal(observed.length,8);
});

test("partial injury coverage remains explicit and never claims a clean bill of health",async()=>{
  const source=createLineupSource({key:KEY,now:()=>NOW,fetchImpl:fakeFeed({issues:{"/injuries":"Not included in subscription"}})});
  const result=await source.playerContext(MATCH);
  assert.equal(result.available,true);
  assert.equal(result.injuriesAvailable,false);
  assert.equal(result.home.absenceCoverage,"unavailable");
  assert.equal(result.home.possible.kind,"estimated");
  assert.ok(result.issues.some(i=>i.area==="Injuries and suspensions"));
});

test("reported lineups take precedence over possible selections",async()=>{
  const data=bundles()[0].lineups;
  const base=fakeFeed();
  const source=createLineupSource({key:KEY,now:()=>NOW,fetchImpl:async(url,o)=>new URL(url).pathname==="/fixtures/lineups"
    ?new Response(JSON.stringify({errors:{},response:data})):base(url,o)});
  const result=await source.playerContext(MATCH);
  assert.equal(result.home.possible.kind,"reported");
  assert.equal(result.home.possible.players.some(p=>p.id===2),true,"a provider-reported XI is not silently rewritten");
});

test("player context routes validate parameters and keep all credentials private",async()=>{
  let fixtureCalls=0;
  const app=createApp({key:"synthetic-football-private-token",lineupKey:KEY,now:()=>NOW,
    fetchImpl:async()=>{fixtureCalls++;return new Response(JSON.stringify(MATCH));},lineupFetchImpl:fakeFeed()});
  const server=await listen(app,{port:0}),base=`http://127.0.0.1:${server.address().port}`;
  try{
    assert.equal((await fetch(base+"/api/matches/500/player-context?url=https://other.test")).status,400);
    assert.equal(fixtureCalls,0);
    const response=await fetch(base+"/api/matches/500/player-context");
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.data.fixture.id,500);
    assert.equal(body.data.teams.home.provider,"football-data.org");
    assert.equal(body.data.home.players[0].provider,"api-football");
    assert.equal(body.data.affectsPredictions,false);
    assert.equal(JSON.stringify(body).includes(KEY),false);
    assert.equal((await(await fetch(base+"/api/config")).json()).playerContextVersion,1);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test("declared test-only provider fixtures cannot become live player context",async()=>{
  const {createMatchInsights}=await import("../server/match-insights.mjs");
  const insights=createMatchInsights({provider:{get:async()=>({data:{...MATCH,testOnly:true},meta:{}})},lineupKey:KEY,lineupFetchImpl:()=>assert.fail("Do not fetch"),now:()=>NOW});
  await assert.rejects(insights.playerContext(500),e=>e.code==="INVALID_PROVIDER_DATA");
});

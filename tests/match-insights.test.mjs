import test from "node:test";
import assert from "node:assert/strict";
import {normalizeHeadToHead,reportedXI,createMatchInsights} from "../server/match-insights.mjs";
import {apiStartingXI,matchFixture,createLineupSource} from "../server/lineups.mjs";
import {createApp,listen} from "../server/app.mjs";
import {scorelineMap} from "../server/predictions.mjs";

const NOW=Date.parse("2026-11-02T12:00:00Z"),KEY="synthetic-lineup-key",TOKEN="synthetic-football-token";
const home={id:64,name:"Liverpool FC"},away={id:57,name:"Arsenal FC"};
const fixture=(extra={})=>({id:500,status:"TIMED",utcDate:"2026-11-03T20:00:00Z",competition:{code:"PL",id:2021},homeTeam:home,awayTeam:away,score:{duration:"REGULAR",fullTime:{home:null,away:null}},...extra});
const past=(extra={})=>fixture({id:400,status:"FINISHED",utcDate:"2026-10-01T20:00:00Z",score:{duration:"REGULAR",fullTime:{home:2,away:0}},...extra});
const apiFixture=(extra={})=>({fixture:{id:900,date:"2026-11-03T20:00:00+00:00",status:{short:"NS"}},league:{id:39},teams:{home:{id:40,name:"Liverpool"},away:{id:42,name:"Arsenal"}},...extra});
const xi=(id,offset=0)=>({team:{id},formation:"4-3-3",coach:{name:"Synthetic coach"},startXI:Array.from({length:11},(_,i)=>({player:{id:offset+i+1,name:`Synthetic ${offset+i+1}`,number:i+1,pos:i===0?"G":i<5?"D":i<8?"M":"F"}})),substitutes:[]});
const ok=(response)=>new Response(JSON.stringify({errors:{},response}));

test("H2H respects selected-fixture chronology, both home/away orientations, identities and penalties",()=>{
  const m=fixture();const results=[past(),past({id:401,homeTeam:away,awayTeam:home,score:{duration:"REGULAR",fullTime:{home:1,away:0}}}),
    past({id:402,score:{duration:"PENALTY_SHOOTOUT",fullTime:{home:6,away:5},penalties:{home:5,away:4}}}),past(),
    past({id:403,homeTeam:{id:999}}),past({id:500}),past({id:404,utcDate:"2026-11-04T20:00:00Z"}),past({id:405,status:"IN_PLAY"})];
  const result=normalizeHeadToHead({matches:results},m,NOW);assert.equal(result.matches.length,3);assert.deepEqual(result.summary,{homeWins:1,draws:1,awayWins:1,sample:3});
  assert.equal(normalizeHeadToHead({matches:[past({utcDate:"2026-10-01T20:00:00Z"})]},past(),NOW).matches.length,0);
});

test("reported starting XIs require eleven distinct identified players and preserve source identity",()=>{
  const rows=xi(40).startXI.map(({player:p})=>({id:p.id,name:p.name,shirtNumber:p.number,position:p.pos}));
  assert.equal(reportedXI({lineup:rows}).players.length,11);assert.equal(reportedXI({lineup:rows}).players[0].provider,"football-data.org");
  assert.equal(reportedXI({lineup:rows.slice(1)}),null);assert.equal(reportedXI({lineup:[...rows.slice(1),rows[1]]}),null);
  assert.equal(apiStartingXI([xi(40)],40).players[0].provider,"api-football");assert.equal(apiStartingXI([xi(40)],42),null);
});

test("cross-provider fixture matching requires league, both clubs, kickoff and a unique candidate",()=>{
  assert.equal(matchFixture([apiFixture()],fixture()).fixture.id,900);
  assert.equal(matchFixture([apiFixture(),apiFixture()],fixture()),null);
  assert.equal(matchFixture([apiFixture({league:{id:2}})],fixture()),null);
  assert.equal(matchFixture([apiFixture({teams:{home:{id:40,name:"Arsenal"},away:{id:42,name:"Liverpool"}}})],fixture()),null);
  assert.equal(matchFixture([apiFixture({fixture:{id:900,date:"2026-11-04T20:00:00Z"}})],fixture()),null);
});

test("lineup API keeps keys private, returns the XI used for completed games and reuses cached calls",async()=>{
  let calls=0;const selected=fixture({status:"FINISHED",utcDate:"2026-11-01T20:00:00Z"});
  const source=createLineupSource({key:KEY,now:()=>NOW,fetchImpl:async(url,o)=>{calls++;assert.equal(new URL(url).origin,"https://v3.football.api-sports.io");assert.equal(o.headers["x-apisports-key"],KEY);assert.equal(o.redirect,"error");return ok(new URL(url).pathname==="/fixtures"?[apiFixture({fixture:{id:900,date:selected.utcDate,status:{short:"FT"}}})]:[xi(40),xi(42,20)]);}});
  const result=await source.lineups(selected);assert.equal(result.available,true);assert.equal(result.home.kind,"used");assert.equal(result.away.players.length,11);assert.equal(JSON.stringify(result).includes(KEY),false);
  await source.lineups(selected);assert.equal(calls,2);
});

test("possible XIs use an actual recent lineup, refuse future references and never replace historical actuals",async()=>{
  let references=0;
  const previous=apiFixture({fixture:{id:901,date:"2026-10-30T20:00:00Z",status:{short:"FT"}}});
  const source=createLineupSource({key:KEY,now:()=>NOW,fetchImpl:async(url)=>{const u=new URL(url);if(u.pathname==="/fixtures/lineups"){const prior=u.searchParams.get("fixture")==="901";if(prior)references++;return ok(prior?[xi(40),xi(42,20)]:[]);}return ok(u.searchParams.has("last")?[{...previous,fixture:{...previous.fixture,id:902,date:"2026-11-05T20:00:00Z"}},previous]:[apiFixture()]);}});
  const result=await source.lineups(fixture(),true);assert.equal(result.mode,"reference");assert.equal(result.home.kind,"reference");assert.equal(result.home.reference.date,previous.fixture.date);assert.equal(references,1,"both teams can reuse a cached previous match response");
});

test("free-plan restrictions are actionable and cached without exposing upstream text or substituting old seasons",async()=>{
  let calls=0;const source=createLineupSource({key:KEY,now:()=>NOW,fetchImpl:async()=>{calls++;return new Response(JSON.stringify({errors:{plan:"Free access limited to 2022-2024"},response:[]}));}});
  await assert.rejects(source.lineups(fixture()),e=>e.code==="LINEUP_PLAN_RESTRICTED"&&!e.message.includes(KEY));
  await assert.rejects(source.lineups(fixture(),true),e=>e.code==="LINEUP_PLAN_RESTRICTED");assert.equal(calls,1);
});

test("API-Football embedded auth/quota errors and echoed credentials cannot leak or become lineups",async()=>{
  for(const [errors,code]of [[{token:"Invalid API key"},"LINEUP_KEY_REJECTED"],[{requests:"Request limit reached"},"LINEUP_RATE_LIMITED"]]){
    const s=createLineupSource({key:KEY,now:()=>NOW,fetchImpl:async()=>new Response(JSON.stringify({errors,response:[]}))});await assert.rejects(s.lineups(fixture()),e=>e.code===code);
  }
  const echoed=createLineupSource({key:KEY,now:()=>NOW,fetchImpl:async()=>ok([{secret:KEY}])});await assert.rejects(echoed.lineups(fixture()),e=>e.code==="LINEUP_DATA_INVALID");
});

test("match routes reject arbitrary inputs, share raw fixture cache and report current-plan lineup restrictions",async()=>{
  let footballCalls=0;const app=createApp({key:TOKEN,lineupKey:KEY,now:()=>NOW,fetchImpl:async(url)=>{footballCalls++;return new Response(JSON.stringify(new URL(url).pathname.endsWith("head2head")?{matches:[past()]}:fixture()));},lineupFetchImpl:async()=>new Response(JSON.stringify({errors:{plan:"Season access restricted"},response:[]}))});
  const server=await listen(app,{port:0});const base=`http://127.0.0.1:${server.address().port}`;
  try{
    assert.equal((await fetch(base+"/api/matches/500/head-to-head?url=https://attacker.test")).status,400);assert.equal(footballCalls,0);
    const h=await(await fetch(base+"/api/matches/500/head-to-head")).json();assert.equal(h.data.matches.length,1);
    const r=await fetch(base+"/api/matches/500/lineups");assert.equal(r.status,503);assert.equal((await r.json()).error.code,"LINEUP_PLAN_RESTRICTED");assert.equal(footballCalls,2,"selected fixture reused by both views");
    const c=await(await fetch(base+"/api/config")).json();assert.equal(c.matchInsightsVersion,1);assert.equal(c.lineupSourceConfigured,true);assert.equal(JSON.stringify(c).includes(KEY),false);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test("match information rejects credentials reflected into fixture or history fields",async()=>{
  const secret="synthetic-guardian-secret";
  for(const reflectedIn of ["fixture","history"]){
    const provider={get:async path=>({data:path.includes("head2head")?{matches:[past({homeTeam:{...home,name:secret}})]}:fixture({homeTeam:{...home,name:reflectedIn==="fixture"?secret:home.name}}),meta:{}})};
    const insights=createMatchInsights({provider,secrets:[secret],now:()=>NOW});
    await assert.rejects(insights.headToHead(500),e=>e.code==="INVALID_PROVIDER_DATA"&&!e.message.includes(secret));
  }
});

test('direct match pages validate the selected fixture, retain score and artwork, and reuse the private provider cache',async()=>{
  let calls=0;
  const selected=past({id:500,homeTeam:{...home,crest:'https://crests.football-data.org/64.png',lineup:[{private:'not returned'}]},awayTeam:{...away,crest:'https://crests.football-data.org/57.png'}});
  const app=createApp({key:TOKEN,now:()=>NOW,fetchImpl:async url=>{calls++;return new Response(JSON.stringify(new URL(url).pathname.endsWith('head2head')?{matches:[]}:selected));}});
  const server=await listen(app,{port:0}),base=`http://127.0.0.1:${server.address().port}`;
  try{
    assert.equal((await fetch(base+'/api/matches/500?url=https://attacker.test')).status,400);assert.equal(calls,0);
    const first=await(await fetch(base+'/api/matches/500')).json();
    assert.equal(first.data.match.id,500);assert.equal(first.data.match.status,'FINISHED');assert.deepEqual([first.data.match.score.home,first.data.match.score.away],[2,0]);
    assert.equal(first.data.match.homeTeam.crest,selected.homeTeam.crest);assert.equal(first.data.match.homeTeam.provider,'football-data.org');assert.equal(JSON.stringify(first).includes('not returned'),false);assert.equal(JSON.stringify(first).includes(TOKEN),false);
    const cached=await(await fetch(base+'/api/matches/500')).json();assert.equal(cached.meta.cache,'hit');assert.equal(calls,1);
    await fetch(base+'/api/matches/500/head-to-head');assert.equal(calls,2,'head-to-head reuses the selected-fixture response');
    assert.equal((await(await fetch(base+'/api/config')).json()).matchDetailsVersion,1);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

test('direct match pages refuse mismatched provider identities and reflected credentials',async()=>{
  for(const selected of [fixture({id:501}),fixture({awayTeam:home}),fixture({homeTeam:{...home,name:TOKEN}})]){
    const insights=createMatchInsights({provider:{get:async()=>({data:selected,meta:{}})},secrets:[TOKEN]});
    await assert.rejects(insights.details(500),e=>e.code==='INVALID_PROVIDER_DATA'&&!e.message.includes(TOKEN));
  }
});

test("heat map is a normalized model-derived Poisson grid with honest tail buckets and no 1X2 calibration claim",()=>{
  const symmetric=scorelineMap(1.2,1.2);assert.equal(symmetric.calibrationApplied,false);assert.equal(symmetric.matrix.length,7);assert.ok(Math.abs(symmetric.matrix.flat().reduce((a,b)=>a+b,0)-1)<1e-12);
  symmetric.matrix.forEach((row,h)=>row.forEach((p,a)=>assert.ok(Math.abs(p-symmetric.matrix[a][h])<1e-12)));
  assert.ok(Math.abs(symmetric.matrix[0][0]-Math.exp(-2.4))<1e-12);
  assert.ok(scorelineMap(50,50).matrix[6][6]>.99);assert.notDeepEqual(scorelineMap(3,.5).matrix,scorelineMap(.5,3).matrix);
  assert.throws(()=>scorelineMap(NaN,1));
});

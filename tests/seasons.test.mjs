import test from "node:test";
import assert from "node:assert/strict";
import {seasonList} from "../server/seasons.mjs";
import {createApp,listen} from "../server/app.mjs";
const now=()=>Date.parse("2026-11-02T12:00:00Z");
const season=y=>({id:y,startDate:`${y}-08-01`,endDate:`${y+1}-05-31`});
const competition={currentSeason:season(2026),seasons:[season(2026),season(2025),season(2024)]};
const match={id:501,status:"FINISHED",utcDate:"2025-09-01T12:00:00Z",season:season(2025),homeTeam:{id:1,name:"Home"},awayTeam:{id:2,name:"Away"},score:{duration:"REGULAR",fullTime:{home:2,away:1}}};
async function withApp(fetchImpl,run){const server=await listen(createApp({key:"synthetic-season-token",now,fetchImpl,maxCalls:100}),{port:0});try{await run(`http://127.0.0.1:${server.address().port}`);}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}}
test("season metadata uses real dates, deduplicates, bounds history and never claims subscription access",()=>{
 const value=seasonList({...competition,seasons:[...competition.seasons,season(2025),{startDate:"invalid"},...Array.from({length:30},(_,i)=>season(2023-i))]});
 assert.equal(value.current.label,"2026/27");assert.equal(value.seasons.length,10);assert.equal(value.seasons[1].label,"2025/26");assert.ok(value.seasons.every(s=>s.access==="checked-on-selection"));
 assert.equal(seasonList({currentSeason:{startDate:"2026-01-01",endDate:"2026-12-31"},seasons:[]}).current.label,"2026");
 assert.throws(()=>seasonList({seasons:[]}),e=>e.code==="INVALID_PROVIDER_DATA");
});
test("historical results and standings isolate season caches, keep status filters and validate before quota",async()=>{
 const paths=[];
 await withApp(async url=>{const u=new URL(url);paths.push(u.pathname+u.search);const year=Number(u.searchParams.get("season")||2026);return new Response(JSON.stringify(u.pathname.endsWith('/matches')?{filters:{season:year},matches:[{...match,season:season(year),utcDate:`${year}-09-01T12:00:00Z`},{...match,id:502,status:"TIMED",season:season(year)}]}:u.pathname.endsWith('/standings')?{season:season(year),standings:[]}:competition));},async base=>{
  for(const invalid of ['season=2025x','season=1999','season=2025&season=2024','season=9999'])assert.equal((await fetch(`${base}/api/results?${invalid}`)).status,400);
  assert.equal(paths.length,0);
  const list=await(await fetch(base+'/api/seasons?competition=PL')).json();assert.equal(list.data.seasons.length,3);
  const result=await(await fetch(base+'/api/results?competition=PL&season=2025')).json();assert.equal(result.data.matches.length,1);assert.equal(result.data.fullSeason,true);assert.equal(result.data.dateFrom,null);
  const url=new URL('https://example.test'+paths.find(p=>p.includes('/matches')));assert.equal(url.searchParams.get('season'),'2025');assert.equal(url.searchParams.get('status'),'FINISHED');assert.equal(url.searchParams.has('dateFrom'),false);
  await fetch(base+'/api/results?competition=PL&season=2025');assert.equal(paths.length,2);
  await fetch(base+'/api/results?competition=PL&season=2024');assert.equal(paths.length,3);
  const table=await(await fetch(base+'/api/standings?competition=PL&season=2025')).json();assert.equal(table.data.season.startDate,'2025-08-01');
  assert.equal((await fetch(base+'/api/results?season=2025&dateFrom=2025-08-01&dateTo=2025-10-01')).status,400);
 });
});
test("wrong-season data and plan restrictions cannot appear as the selected historical season",async()=>{
 await withApp(async url=>new Response(JSON.stringify(new URL(url).pathname.endsWith('/matches')?{filters:{season:2024},matches:[]}:{season:season(2024),standings:[]})),async base=>{
  for(const route of ['results','standings']){const r=await fetch(`${base}/api/${route}?season=2025`);assert.equal(r.status,502);assert.equal((await r.json()).error.code,'INVALID_PROVIDER_DATA');}
 });
 await withApp(async()=>new Response('{"message":"private plan detail"}',{status:403}),async base=>{const r=await fetch(base+'/api/results?season=2025');assert.equal(r.status,403);assert.equal((await r.text()).includes('private plan detail'),false);});
});

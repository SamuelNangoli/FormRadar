import test from 'node:test';
import assert from 'node:assert/strict';
import {gameweekView} from '../server/gameweeks.mjs';
import {createApp,listen} from '../server/app.mjs';
const NOW=Date.parse('2026-11-03T12:00:00Z');
const season={year:2026,label:'2026/27',currentMatchday:10,current:true};
const match=(id,matchday,extra={})=>({id,matchday,stage:'REGULAR_SEASON',utcDate:`2026-11-${matchday===10?'06':'13'}T15:00:00Z`,status:'TIMED',competition:{code:'PL'},homeTeam:{id:id*2,name:'Home'},awayTeam:{id:id*2+1,name:'Away'},...extra});
const data=matches=>({competition:'PL',matches:[...matches].sort((a,b)=>a.utcDate.localeCompare(b.utcDate))});

test('All matches returns one complete provider gameweek, including postponed and rescheduled fixtures',()=>{
  const round=Array.from({length:10},(_,i)=>match(i+1,10));round[9]={...round[9],status:'POSTPONED',utcDate:'2027-02-10T20:00:00Z'};
  const input=data([...round,...Array.from({length:10},(_,i)=>match(i+11,11)),round[0]]);
  const result=gameweekView(input,season,'',NOW);
  assert.equal(result.matches.length,10);assert.ok(result.matches.every(m=>m.matchday===10));assert.equal(result.round.label,'Gameweek 10');assert.equal(result.dateTo,'2027-02-10');assert.equal(result.unassignedMatches,0);
  assert.equal(gameweekView(input,season,'REGULAR_SEASON:11',NOW).matches.length,10);
  assert.throws(()=>gameweekView(input,season,'REGULAR_SEASON:99',NOW),e=>e.code==='GAMEWEEK_NOT_FOUND');
});

test('rounds are separated by competition phase and retain actual counts rather than a ten-match cutoff',()=>{
  const matches=Array.from({length:18},(_,i)=>match(i+1,1,{competition:{code:'CL'},stage:'LEAGUE_STAGE'}));
  matches.push(match(100,1,{competition:{code:'CL'},stage:'QUARTER_FINALS'}));
  const result=gameweekView({competition:'CL',matches},{...season,currentMatchday:1},'LEAGUE_STAGE:1',NOW);
  assert.equal(result.matches.length,18);assert.equal(result.rounds.length,2);assert.equal(result.rounds[1].count,1);
  for(const stage of [null,'REGULAR_SEASON','LEAGUE_STAGE','GROUP_STAGE']){const unknown=gameweekView(data([match(500,null,{stage})]),season,'',NOW);assert.equal(unknown.round,null);assert.equal(unknown.matches.length,0);assert.equal(unknown.unassignedMatches,1);}
});

test('gameweek API validates before quota, isolates season data and shares the full-season cache safely',async()=>{
  const paths=[];
  const rawSeason=y=>({startDate:`${y}-08-01`,endDate:`${y+1}-05-31`,currentMatchday:10});
  const app=createApp({key:'synthetic-gameweek-token',now:()=>NOW,fetchImpl:async target=>{const u=new URL(target);paths.push(u.pathname+u.search);const y=Number(u.searchParams.get('season'));return new Response(JSON.stringify(u.pathname.endsWith('/matches')?{competition:{code:'PL'},filters:{season:y},matches:[match(1,10,{season:rawSeason(y)}),match(2,11,{season:rawSeason(y)})]}:{currentSeason:rawSeason(2026),seasons:[rawSeason(2025)]}));}});
  const s=await listen(app,{port:0}),base=`http://127.0.0.1:${s.address().port}`;
  try{
    for(const q of ['round=10','round=REGULAR_SEASON:0&round=REGULAR_SEASON:1','dateFrom=2026-01-01','season=9999','competition=BAD'])assert.equal((await fetch(base+'/api/gameweek?'+q)).status,400);
    assert.equal(paths.length,0);
    const result=await(await fetch(base+'/api/gameweek?competition=PL')).json();assert.equal(result.data.matches.length,1);assert.equal(result.data.round.matchday,10);assert.equal(paths.length,2);
    const other=await(await fetch(base+'/api/gameweek?round=REGULAR_SEASON:11')).json();assert.equal(other.data.matches[0].id,2);assert.equal(paths.length,2);
    const full=await(await fetch(base+'/api/matches?season=2026')).json();assert.equal(full.data.matches.length,2);assert.equal(paths.length,2,'same normalized cache works in both views');
    const old=await(await fetch(base+'/api/gameweek?season=2025')).json();assert.equal(old.data.season,2025);assert.equal(paths.length,3);
    assert.equal((await fetch(base+'/api/gameweek?round=REGULAR_SEASON:99')).status,404);
  }finally{s.closeAllConnections();await new Promise(r=>s.close(r));}
});

test('new round metadata does not reuse an older shared cache missing competition phases',async()=>{
  const {createProvider}=await import('../server/data.mjs');let calls=0;const stored=new Map([['/test',{at:NOW,data:{stage:null}}]]);
  const sharedStore={readProvider:async p=>stored.get(p),writeProvider:async(p,v)=>stored.set(p,v),budget:async()=>({allowed:true,retryAfter:1})};
  const result=await createProvider({key:'synthetic-cache-version-token',sharedStore,cacheVersion:2,now:()=>NOW,fetchImpl:async()=>{calls++;return new Response('{"stage":"LEAGUE_STAGE"}');}}).get('/test',60000,v=>v);
  assert.equal(result.data.stage,'LEAGUE_STAGE');assert.equal(calls,1);assert.equal(stored.get('/test').data.stage,null);assert.equal(stored.get('v2:/test').data.stage,'LEAGUE_STAGE');
});

test('previous and next gameweek follow round numbers even when a fixture is moved to an earlier date',()=>{
  const result=gameweekView(data([match(1,31,{utcDate:'2026-02-10T15:00:00Z'}),match(2,27,{utcDate:'2026-03-01T15:00:00Z'}),match(3,28,{utcDate:'2026-03-08T15:00:00Z'})]),{...season,currentMatchday:27},'',NOW);
  assert.deepEqual(result.rounds.map(r=>r.matchday),[27,28,31]);assert.equal(result.round.matchday,27);
});

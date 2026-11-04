import test from 'node:test';
import assert from 'node:assert/strict';
import {matchView} from '../server/data.mjs';
import {clockText,goalTime} from '../shared/match-events.js';
import {createSeasonProvider} from '../server/formradar-football.mjs';
import {createApp,listen} from '../server/app.mjs';

const KEY='synthetic-formradar-key-not-real',TOKEN='synthetic-football-token';
const fixture={id:500,utcDate:'2026-11-05T20:00:00Z',status:'IN_PLAY',minute:90,injuryTime:3,
  competition:{id:2021,code:'PL'},homeTeam:{id:64,name:'Test Home'},awayTeam:{id:57,name:'Test Away'},score:{fullTime:{home:2,away:1}},
  goals:[{minute:25,injuryTime:null,type:'REGULAR',team:{id:64},scorer:{id:1,name:'Test Forward'},score:{home:1,away:0}},
    {minute:45,injuryTime:2,type:'PENALTY',team:{id:57},scorer:{id:2,name:'Test Striker'},score:{home:1,away:1}},
    {minute:90,injuryTime:3,type:'OWN',team:{id:64},scorer:{id:3,name:'Test Defender'},score:{home:2,away:1}}]};

test('match clocks use reported minutes, stoppage time and real phases without extrapolation',()=>{
  assert.equal(clockText(fixture),'90+3′');assert.equal(goalTime(fixture.goals[1]),'45+2′');
  assert.equal(clockText({...fixture,status:'PAUSED'}),'Half-time');
  assert.equal(clockText({...fixture,status:'EXTRA_TIME',minute:105,injuryTime:1}),'105+1′ · Extra time');
  assert.equal(clockText({...fixture,status:'PENALTY_SHOOTOUT'}),'Penalty shootout');
  for(const minute of [null,undefined,-1,NaN,'65',999])assert.equal(clockText({...fixture,minute}),'Live · minute unavailable');
});

test('goalscorers retain scoring side, penalty/own goal and missing data; shootout and foreign events are excluded',()=>{
  const view=matchView({...fixture,goals:[...fixture.goals,fixture.goals[0],{...fixture.goals[0],type:'SHOOTOUT'},
    {...fixture.goals[0],team:{id:999}},{...fixture.goals[0],minute:NaN,type:'REGULAR',scorer:null,score:{home:3,away:1}}]});
  assert.equal(view.goals.length,4);assert.equal(view.goals[1].side,'away');assert.equal(view.goals[2].type,'OWN');
  assert.equal(view.goals[3].scorer,null);assert.equal(view.goals[3].minute,null);
  assert.equal(view.injuryTime,3);assert.equal(matchView({...fixture,goals:undefined}).goalsAvailable,false);
  assert.equal(matchView({...fixture,goals:[]}).goalsAvailable,true);
});

test('2026 season lists and fixture details go through private FastAPI, reuse cache and preserve older routes',async()=>{
  let calls=0,direct=0;
  const provider=createSeasonProvider({url:'http://127.0.0.1:8000',key:KEY,primary:{configured:true,get:async()=>{direct++;return {data:'older'};}},fetchImpl:async(url,o)=>{
    calls++;const u=new URL(url);assert.equal(u.origin,'http://127.0.0.1:8000');assert.equal(o.headers['X-API-Key'],KEY);assert.equal(o.redirect,'error');
    return Response.json(u.pathname.includes('competitions')?{matches:[fixture]}:fixture);
  }});
  const path='/competitions/PL/matches?season=2026';
  const first=await provider.get(path,60000,v=>v.matches.map(matchView));assert.match(first.meta.provider,/FormRadar API/);assert.equal(first.data[0].goals.length,3);
  await provider.get(path,60000,v=>v.matches);assert.equal(calls,1);
  await provider.get('/matches/500',60000,matchView);assert.equal(calls,2);
  await provider.get('/competitions/PL/matches?season=2025',60000,v=>v);assert.equal(direct,1);
  assert.equal(JSON.stringify(first).includes(KEY),false);
});

test('FastAPI outages use the original feed with an explicit warning and short retry cooldown',async()=>{
  let calls=0;
  const provider=createSeasonProvider({url:'http://127.0.0.1:8000',key:KEY,now:()=>1000,primary:{configured:true,get:async()=>({data:fixture,meta:{provider:'football-data.org'}})},fetchImpl:async()=>{calls++;return new Response('upstream-secret',{status:401});}});
  const first=await provider.get('/matches/500',60000,v=>v);assert.match(first.meta.warning,/FastAPI.*unavailable/);assert.equal(JSON.stringify(first).includes('upstream-secret'),false);
  await provider.get('/matches/500',60000,v=>v);assert.equal(calls,1);
});

test('hosted connector refuses local addresses and credential reflection never becomes match data',async()=>{
  let called=0;
  const primary={configured:true,get:async()=>({data:'fallback',meta:{}})};
  const hosted=createSeasonProvider({primary,url:'http://127.0.0.1:8000',key:KEY,hosted:true,fetchImpl:async()=>{called++;}});
  assert.equal(hosted.formRadarConfigured,false);await hosted.get('/matches/500',60000,v=>v);assert.equal(called,0);
  const leaked=createSeasonProvider({primary,url:'https://formradar.test',key:KEY,fetchImpl:async()=>Response.json({...fixture,private:KEY})});
  assert.equal((await leaked.get('/matches/500',60000,v=>v)).data,'fallback');
});

test('match route returns only normalized goals and the API connection stays backend-only',async()=>{
  const app=createApp({key:TOKEN,predictionServiceUrl:'http://127.0.0.1:8000',predictionServiceKey:KEY,
    fetchImpl:async()=>{throw new Error('direct feed should not be called');},predictionServiceFetchImpl:async()=>Response.json({...fixture,private:'not exposed'})});
  const server=await listen(app,{port:0}),base=`http://127.0.0.1:${server.address().port}`;
  try{
    const response=await fetch(base+'/api/matches/500');assert.equal(response.status,200);
    const result=await response.json();assert.equal(result.data.match.minute,90);assert.equal(result.data.match.goals[0].scorer,'Test Forward');
    assert.match(result.meta.provider,/FormRadar API/);assert.equal(JSON.stringify(result).includes(KEY),false);assert.equal(JSON.stringify(result).includes('not exposed'),false);
    const config=await(await fetch(base+'/api/config')).json();assert.equal(config.formRadarFootballConfigured,true);assert.equal(JSON.stringify(config).includes(KEY),false);
    assert.equal((await fetch(base+'/api/matches/500?key=anything')).status,400);
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});

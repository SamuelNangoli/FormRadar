import {ApiError,matchView,teamView} from "./data.mjs";
import {createLineupSource} from "./lineups.mjs";

const validId=v=>Number.isSafeInteger(v)&&v>0;
export function normalizeHeadToHead(raw,fixture,now=Date.now()){
  if(!Array.isArray(raw?.matches))throw new ApiError(502,"INVALID_PROVIDER_DATA","The provider returned an invalid head-to-head list.");
  const home=fixture.homeTeam.id,away=fixture.awayTeam.id,ids=new Set();
  const matches=raw.matches.filter(m=>m?.status==="FINISHED"&&validId(m.id)&&m.id!==fixture.id&&!ids.has(m.id)
    &&typeof m.utcDate==="string"&&Number.isFinite(Date.parse(m.utcDate))&&Date.parse(m.utcDate)<Math.min(now,Date.parse(fixture.utcDate))
    &&((m.homeTeam?.id===home&&m.awayTeam?.id===away)||(m.homeTeam?.id===away&&m.awayTeam?.id===home))&&(ids.add(m.id)||true))
    .map(matchView).sort((a,b)=>b.utcDate.localeCompare(a.utcDate)).slice(0,10);
  let homeWins=0,awayWins=0,draws=0;
  for(const m of matches){if(!Number.isInteger(m.score.home)||!Number.isInteger(m.score.away))continue;if(m.score.home===m.score.away)draws++;else if((m.score.home>m.score.away)===(m.homeTeam.id===home))homeWins++;else awayWins++;}
  return {fixture:matchView(fixture),matches,summary:{homeWins,draws,awayWins,sample:homeWins+draws+awayWins},scope:"Latest returned meetings before the selected match; not an all-time record"};
}
export function reportedXI(team){
  const rows=Array.isArray(team?.lineup)?team.lineup:[],ids=new Set();
  const people=rows.flatMap(p=>{if(!validId(p?.id)||typeof p.name!=="string"||!p.name.trim()||ids.has(p.id))return[];ids.add(p.id);return[{provider:"football-data.org",id:p.id,name:p.name.trim().slice(0,100),shirtNumber:Number.isInteger(p.shirtNumber)?p.shirtNumber:null,position:typeof p.position==="string"?p.position:null}];});
  if(people.length!==11||rows.length!==11)return null;
  return {players:people,bench:(Array.isArray(team.bench)?team.bench:[]).filter(p=>validId(p?.id)&&typeof p.name==="string").slice(0,25).map(p=>({provider:"football-data.org",id:p.id,name:p.name.trim().slice(0,100),shirtNumber:Number.isInteger(p.shirtNumber)?p.shirtNumber:null,position:typeof p.position==="string"?p.position:null})),formation:typeof team.formation==="string"?team.formation:null,coach:typeof team.coach?.name==="string"?team.coach.name:null};
}
export function createMatchInsights({provider,lineupKey,lineupFetchImpl,now=Date.now,secrets=[],sharedStore}){
  const source=createLineupSource({key:lineupKey,fetchImpl:lineupFetchImpl,now,sharedStore});
  function isolate(data){if(secrets.some(s=>s?.trim()&&JSON.stringify(data).includes(s.trim())))throw new ApiError(502,"INVALID_PROVIDER_DATA","The match response failed credential isolation.");}
  async function fixture(id){const response=await provider.get(`/matches/${id}`,60000,v=>v);const m=response.data;if(m?.id!==id||!validId(m.homeTeam?.id)||!validId(m.awayTeam?.id)||m.homeTeam.id===m.awayTeam.id||typeof m.utcDate!=="string"||!Number.isFinite(Date.parse(m.utcDate)))throw new ApiError(502,"INVALID_PROVIDER_DATA","The selected fixture could not be validated.");isolate(m);return response;}
  async function headToHead(id){const selected=await fixture(id);const raw=await provider.get(`/matches/${id}/head2head?limit=10`,900000,v=>v);isolate(raw.data);return {data:normalizeHeadToHead(raw.data,selected.data,now()),meta:{...raw.meta,stale:raw.meta.stale||selected.meta.stale}};}
  async function lineups(id,possible=false){
    const selected=await fixture(id),m=selected.data,home=reportedXI(m.homeTeam),away=reportedXI(m.awayTeam);
    let data;
    if(home&&away)data={available:true,provider:"football-data.org",mode:"reported",home:{...home,kind:m.status==="FINISHED"?"used":"reported"},away:{...away,kind:m.status==="FINISHED"?"used":"reported"}};
    else {try{data=await source.lineups(m,possible);}catch(error){if(!home&&!away)throw error;data={available:false,provider:"football-data.org",mode:"reported",message:error instanceof ApiError?error.message:"Additional lineup data is unavailable."};}
      for(const [side,xi]of [["home",home],["away",away]])if(xi){data[side]={...xi,kind:m.status==="FINISHED"?"used":"reported"};data.available=true;}
    }
    return {data:{...data,fixture:matchView(m),teams:{home:teamView(m.homeTeam),away:teamView(m.awayTeam)},affectsPredictions:false},meta:{...selected.meta,provider:data.provider||"Lineup sources",fetchedAt:data.dataFetchedAt||selected.meta.fetchedAt}};
  }
  return {headToHead,lineups,lineupConfigured:source.configured};
}

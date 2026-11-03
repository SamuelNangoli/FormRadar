import {ApiError} from './data.mjs';
import {seasonList} from './seasons.mjs';
import {scheduleView} from './schedule.mjs';

const validDay=n=>Number.isInteger(n)&&n>0&&n<100;
export const validRound=value=>/^[A-Z][A-Z0-9_]{0,39}:(?:0|[1-9]\d?)$/.test(value);
const stageLabel=s=>s.toLowerCase().replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());

export function gameweekView(data,season,requested='',now=Date.now()) {
  const groups=new Map(),unique=[...new Map(data.matches.map(m=>[m.id,m])).values()];
  for(const m of unique){
    if(m.competition.code!==data.competition)throw new ApiError(502,'INVALID_PROVIDER_DATA','The provider returned fixtures from another competition.');
    const stage=typeof m.stage==='string'&&/^[A-Z][A-Z0-9_]{0,39}$/.test(m.stage)?m.stage:null;
    const day=validDay(m.matchday)?m.matchday:null;
    if(!day&&(!stage||['REGULAR_SEASON','LEAGUE_STAGE','LEAGUE_PHASE','GROUP_STAGE'].includes(stage)))continue;
    const key=`${stage||'MATCHDAY'}:${day||0}`;
    if(!groups.has(key))groups.set(key,{key,stage,matchday:day,matches:[]});
    groups.get(key).matches.push(m);
  }
  const rounds=[...groups.values()].map(r=>{
    const regular=!r.stage||r.stage==='REGULAR_SEASON';
    const title=r.matchday?`${regular?'Gameweek':'Matchday'} ${r.matchday}`:'';
    return {...r,label:regular?title:`${stageLabel(r.stage)}${title?' · '+title:''}`,count:r.matches.length,firstDate:r.matches[0].utcDate,lastDate:r.matches.at(-1).utcDate};
  }).sort((a,b)=>a.stage===b.stage&&a.matchday&&b.matchday?a.matchday-b.matchday:a.firstDate.localeCompare(b.firstDate)||a.key.localeCompare(b.key));
  if(requested&&!groups.has(requested))throw new ApiError(404,'GAMEWEEK_NOT_FOUND','That gameweek is not available in the selected season.');
  const live=rounds.find(r=>r.matches.some(m=>['IN_PLAY','PAUSED','EXTRA_TIME','PENALTY_SHOOTOUT'].includes(m.status)));
  const current=rounds.filter(r=>validDay(season.currentMatchday)&&r.matchday===season.currentMatchday);
  const closest=rows=>[...rows].sort((a,b)=>Math.abs(Date.parse(a.firstDate)-now)-Math.abs(Date.parse(b.firstDate)-now))[0];
  const selected=requested?rounds.find(r=>r.key===requested):live||closest(current)||closest(rounds);
  return {...data,fullSeason:false,dateFrom:selected?.firstDate.slice(0,10)||null,dateTo:selected?.lastDate.slice(0,10)||null,
    seasonLabel:season.label,round:selected?{key:selected.key,label:selected.label,matchday:selected.matchday,stage:selected.stage}:null,
    rounds:rounds.map(({matches,...r})=>r),matches:selected?.matches||[],unassignedMatches:unique.length-rounds.reduce((n,r)=>n+r.count,0),
    scope:'Provider-assigned gameweek; rescheduled fixtures remain in their original round.'};
}

export function createGameweeks({provider,now=Date.now}) {
  return async function get(code,year,round=''){
    const metadata=await provider.get(`/competitions/${code}`,900000,seasonList);
    const season=year===null?metadata.data.current:metadata.data.seasons.find(s=>s.year===year);
    if(!season)throw new ApiError(404,'SEASON_NOT_LISTED','That season is not listed by the provider.');
    const response=await provider.get(`/competitions/${code}/matches?season=${season.year}`,season.current?60000:900000,raw=>scheduleView(raw,{code,year:season.year,fullSeason:true}));
    return {data:gameweekView(response.data,season,round,now()),meta:{...response.meta,stale:response.meta.stale||metadata.meta.stale}};
  };
}

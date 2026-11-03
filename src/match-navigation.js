import {competitions} from "../shared/competitions.js";
import {isoDay} from "./format.js";
const codes=new Set(competitions.map(c=>c.code));
const date=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||"")&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const realId=v=>/^[1-9]\d{0,6}$/.test(String(v||""));
function context(params){
  const league=codes.has(params.get('competition'))?params.get('competition'):'PL';
  const demo=params.get('demo')==='1';
  const year=params.get('season');
  const season=!demo&&/^\d{4}$/.test(year||'')&&Number(year)>=2000&&Number(year)<=new Date().getUTCFullYear()+1?year:'';
  const selected=params.get('selected');
  const round=params.get('round');
  return {league,season,demo,page:params.get('view')==='predictions'?'Predictions':'Live Scores',
    ...(/^[A-Z][A-Z0-9_]{0,39}:(?:0|[1-9]\d?)$/.test(round||'')?{round}:{}),
    filter:['all','live','upcoming','results'].includes(params.get('filter'))?params.get('filter'):season?'results':'all',
    from:date(params.get('from'))?params.get('from'):isoDay(-3),to:date(params.get('to'))?params.get('to'):isoDay(7),
    search:(params.get('q')||'').slice(0,200),selectedId:realId(selected)?Number(selected):demo&&new RegExp(`^${league}-demo-\\d{1,2}$`).test(selected||'')?selected:null};
}
function paramsFor(value){
  const p=new URLSearchParams({competition:value.league||'PL',view:value.page==='Predictions'?'predictions':'matches',filter:value.filter||'all',from:value.from||isoDay(-3),to:value.to||isoDay(7)});
  if(value.season)p.set('season',value.season);if(value.round)p.set('round',value.round);if(value.search)p.set('q',value.search.slice(0,200));if(value.demo)p.set('demo','1');if(value.selectedId)p.set('selected',String(value.selectedId));
  return p;
}
export function matchHref(match,value){return `#match/${encodeURIComponent(match.id)}?${paramsFor({...value,selectedId:match.id})}`;}
export function matchesHref(value){return `#matches?${paramsFor(value)}`;}
export function readMatchNavigation(hash=''){
  if(!hash.startsWith('#match'))return null;
  const [path,query='']=hash.split('?');const c=context(new URLSearchParams(query));
  if(path==='#matches')return {kind:'list',context:c};
  const found=/^#match\/([^/]+)$/.exec(path);
  if(!found)return {kind:'invalid',context:c};
  const id=found[1];
  if(c.demo&&new RegExp(`^${c.league}-demo-\\d{1,2}$`).test(id))return {kind:'match',id,context:c};
  if(!c.demo&&realId(id))return {kind:'match',id:Number(id),context:c};
  return {kind:'invalid',context:c};
}

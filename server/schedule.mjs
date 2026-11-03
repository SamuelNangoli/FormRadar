import {ApiError,competitionView,matchView} from './data.mjs';

const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;

// Shared shape for date views, season archives and gameweek selection. A single
// provider cache entry must have the same shape whichever view opens it first.
export function scheduleView(raw,{code,year,fullSeason,from,to,statuses=null,results=false}) {
  if(!Array.isArray(raw?.matches)||raw.matches.length>1000||raw.matches.some(m=>!m||!Number.isInteger(m.id)||typeof m.utcDate!=='string'||!Number.isFinite(Date.parse(m.utcDate))||typeof m.status!=='string'))
    throw new ApiError(502,'INVALID_PROVIDER_DATA','The provider returned an invalid fixture list.');
  if(year!==null&&(raw.filters?.season!==undefined&&Number(raw.filters.season)!==year||raw.matches.some(m=>m.season?.startDate!==undefined&&(!validDate(m.season.startDate)||Number(m.season.startDate.slice(0,4))!==year))))
    throw new ApiError(502,'INVALID_PROVIDER_DATA','The provider returned a different season. No results were substituted.');
  return {competition:code,competitionInfo:competitionView(raw.competition,code),season:year,fullSeason,dateFrom:fullSeason?null:from,dateTo:fullSeason?null:to,
    matches:raw.matches.filter(m=>(fullSeason||m.utcDate.slice(0,10)>=from&&m.utcDate.slice(0,10)<=to)&&(!statuses||statuses.includes(m.status)))
      .map(m=>matchView({...m,competition:m.competition||competitionView(raw.competition,code)}))
      .sort((a,b)=>results?b.utcDate.localeCompare(a.utcDate):a.utcDate.localeCompare(b.utcDate))};
}

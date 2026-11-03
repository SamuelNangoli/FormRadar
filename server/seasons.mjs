import {ApiError} from "./data.mjs";
const date=v=>typeof v==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function seasonYear(params,now=Date.now()) {
  const value=params.get("season");
  if(value===null)return null;
  if(!/^\d{4}$/.test(value)||Number(value)<2000||Number(value)>new Date(now).getUTCFullYear()+1)
    throw new ApiError(400,"INVALID_REQUEST","Choose a listed season from 2000 onwards.");
  return Number(value);
}
export function seasonList(raw) {
  if(!Array.isArray(raw?.seasons)||!date(raw.currentSeason?.startDate))throw new ApiError(502,"INVALID_PROVIDER_DATA","The provider returned an invalid season list.");
  const currentYear=Number(raw.currentSeason.startDate.slice(0,4)),seen=new Set();
  const seasons=[raw.currentSeason,...raw.seasons].filter(s=>date(s?.startDate)&&date(s?.endDate)&&s.endDate>=s.startDate)
    .map(s=>{const year=Number(s.startDate.slice(0,4)),end=s.endDate.slice(0,4);return {year,label:end===String(year)?String(year):`${year}/${end.slice(2)}`,startDate:s.startDate,endDate:s.endDate,currentMatchday:Number.isInteger(s.currentMatchday)?s.currentMatchday:null,current:year===currentYear,access:"checked-on-selection"};})
    .filter(s=>s.year>=2000&&!seen.has(s.year)&&(seen.add(s.year)||true)).sort((a,b)=>b.year-a.year).slice(0,10);
  return {current:seasons.find(s=>s.current)||null,seasons,scope:"Ten most recent feed-listed seasons from 2000; listing does not establish account access."};
}

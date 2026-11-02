import { createHash } from "node:crypto";
import { ApiError } from "./data.mjs";
import { competitions } from "../shared/competitions.js";

const TTL = 600_000, MAX_STALE = 21_600_000;
const topics = { all:"", injuries:"(injury OR injured OR fitness OR suspension OR suspended)", lineups:"(lineup OR squad OR selection OR team news)", transfers:"(transfer OR signing OR loan)" };
export const newsTopics = Object.keys(topics);
const phrases = { PL:"Premier League", CL:"Champions League", PD:"La Liga", BL1:"Bundesliga", SA:"Serie A", FL1:"Ligue 1", ELC:"Championship", DED:"Eredivisie", PPL:"Primeira Liga", BSA:"Brazilian football", EC:"European Championship", WC:"World Cup" };
const clean = (v, max=240) => typeof v === "string" ? v.replace(/<[^>]*>/g," ").replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#(?:39|x27);/gi,"'").replace(/\s+/g," ").trim().slice(0,max) : "";
const phrase = (v) => '"'+clean(v,120).replace(/["\\()]/g," ").trim()+'"';

export function guardianArticleUrl(value) {
  try {
    const url = new URL(value);
    if(url.protocol!=="https:" || !["www.theguardian.com","theguardian.com"].includes(url.hostname)
      || url.port || url.username || url.password || !url.pathname.startsWith("/football/")) return null;
    url.search="";url.hash="";return url.href;
  } catch { return null; }
}

export function normalizeNews(raw, now = Date.now()) {
  if(raw?.response?.status!=="ok" || !Array.isArray(raw.response.results))
    throw new ApiError(502,"NEWS_DATA_INVALID","The news provider returned an unreadable article list.");
  const found = new Map();
  for(const item of raw.response.results.slice(0,100)) {
    if(!item || item.sectionId!=="football" || !["article","liveblog"].includes(item.type))continue;
    const url=guardianArticleUrl(item.webUrl), title=clean(item.webTitle), published=Date.parse(item.webPublicationDate);
    if(!url || !title || !Number.isFinite(published) || published>now+300_000)continue;
    const id=createHash("sha256").update(url).digest("hex").slice(0,24);
    found.set(url,{id,provider:"the-guardian",source:"The Guardian",title,url,publishedAt:new Date(published).toISOString(),
      kind:item.type==="liveblog"?"Live report":"Article",verification:"publisher-report",affectsPredictions:false});
  }
  return [...found.values()].sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,20);
}

export function createNews({ key, fetchImpl=fetch, now=Date.now, maxPerMinute=30, maxPerDay=450, wait=(ms)=>new Promise(r=>setTimeout(r,ms)) } = {}) {
  const configured=Boolean(typeof key==="string" && /^[A-Za-z0-9_-]{8,128}$/.test(key.trim()) && !/^(your|replace|paste)/i.test(key.trim()));
  const cache=new Map(),pending=new Map(),calls=[];
  let day="",daily=0,cooldownUntil=0,nextSlot=-Infinity,cooldownError;
  const status=()=>({provider:"the-guardian",name:"The Guardian",configured,affectsPredictions:false,
    setupUrl:"https://open-platform.theguardian.com/access/",topics:newsTopics});
  function cooldown(error,seconds) {cooldownUntil=now()+seconds*1000;cooldownError=error;return error;}
  async function request(query) {
    if(now()<cooldownUntil)throw new ApiError(cooldownError.status,cooldownError.code,cooldownError.message,Math.ceil((cooldownUntil-now())/1000));
    const today=new Date(now()).toISOString().slice(0,10);
    if(today!==day){day=today;daily=0;}
    while(calls.length&&now()-calls[0]>=60_000)calls.shift();
    if(daily>=maxPerDay)throw new ApiError(429,"NEWS_DAILY_LIMIT","The local daily news request budget is used. Cached headlines remain available.",Math.ceil((Date.parse(today)+86_400_000-now())/1000));
    const delay=Math.max(0,nextSlot-now());
    if(calls.length>=maxPerMinute||delay>3300)throw new ApiError(429,"NEWS_RATE_LIMITED","News requests are busy. Wait a moment and retry.",calls.length>=maxPerMinute?60:4);
    nextSlot=now()+delay+1100;calls.push(now()+delay);daily++;
    if(delay)await wait(delay);
    if(now()<cooldownUntil)throw new ApiError(cooldownError.status,cooldownError.code,cooldownError.message,Math.ceil((cooldownUntil-now())/1000));
    const url=new URL("https://content.guardianapis.com/search");
    url.search=new URLSearchParams({"api-key":key.trim(),section:"football",q:query,"order-by":"newest","page-size":"20",
      "from-date":new Date(now()-14*86_400_000).toISOString().slice(0,10),"to-date":today});
    let response;
    try {response=await fetchImpl(url.href,{headers:{Accept:"application/json"},redirect:"error",signal:AbortSignal.timeout(12_000)});}
    catch {throw cooldown(new ApiError(502,"NEWS_UNAVAILABLE","Could not reach The Guardian. Please retry shortly.",15),15);}
    // Never log or forward request URLs, credentials or upstream error bodies.
    if(response.status===401||response.status===403)throw cooldown(new ApiError(401,"NEWS_KEY_REJECTED","The Guardian key was rejected or lacks access. Check GUARDIAN_API_KEY locally and restart FormRadar.",60),60);
    if(response.status===429){const header=response.headers.get("retry-after");const retry=/^\d+$/.test(header||"")?Number(header):(Date.parse(header)-now())/1000;const delay=Math.min(86_400,Math.max(60,Number.isFinite(retry)?retry:60));throw cooldown(new ApiError(429,"NEWS_RATE_LIMITED","The Guardian request limit was reached. Retry after the cooldown.",Math.ceil(delay)),delay);}
    if(!response.ok)throw cooldown(new ApiError(502,"NEWS_UNAVAILABLE","The Guardian could not return headlines. Please retry shortly.",30),30);
    let raw;try{raw=await response.json();}catch{throw new ApiError(502,"NEWS_DATA_INVALID","The news provider returned unreadable data.");}
    if(JSON.stringify(raw).includes(key.trim()))throw new ApiError(502,"NEWS_DATA_INVALID","The news response failed a credential isolation check.");
    return normalizeNews(raw,now());
  }
  async function get({competition="PL",topic="all",team=null}={}) {
    if(!configured)throw new ApiError(503,"NEWS_SETUP_REQUIRED","Add GUARDIAN_API_KEY to your local .env file and restart FormRadar to enable News Radar.");
    const league=competitions.find(c=>c.code===competition);
    if(!league||!newsTopics.includes(topic))throw new ApiError(400,"INVALID_REQUEST","Choose a supported news competition and topic.");
    const names=team?[...new Set([team.name,team.shortName].filter(Boolean).map(n=>clean(n,120).replace(/\b(?:FC|CF|AFC)\b/g,"").trim()).filter(Boolean))]:[];
    if(team&&!names.length)throw new ApiError(502,"NEWS_TEAM_INVALID","This team could not be identified for news filtering.");
    const subject=team?{provider:"football-data.org",id:team.id,name:clean(team.shortName||team.name,120)}:null;
    const query=(team?'('+names.map(phrase).join(" OR ")+')':phrase(phrases[competition]||league.name))+(topics[topic]?" AND "+topics[topic]:"");
    const id=JSON.stringify([competition,topic,subject?.id||null]);
    const entry=cache.get(id);
    const envelope=(item,stale=false,warning)=>({data:{competition,topic,team:subject,teamScope:team?"all competitions":null,articles:item.articles,affectsPredictions:false},
      meta:{provider:"The Guardian",fetchedAt:new Date(item.at).toISOString(),stale,cache:stale?"stale":"hit",...(warning?{warning}:{}),contextOnly:true}});
    if(entry&&now()-entry.at<TTL)return envelope(entry);
    if(pending.has(id))return pending.get(id);
    const work=(async()=>{
      try{const item={articles:await request(query),at:now()};if(cache.size>=200&&!cache.has(id))cache.delete(cache.keys().next().value);cache.set(id,item);const result=envelope(item);result.meta.cache="miss";return result;}
      catch(e){if(entry&&now()-entry.at<=MAX_STALE&&[429,502].includes(e.status))return envelope(entry,true,e.message);throw e;}
      finally{pending.delete(id);}
    })();pending.set(id,work);return work;
  }
  return {status,get};
}

import {createHash,randomUUID} from "node:crypto";

export class CloudStoreError extends Error {
  constructor(){super("Cloud storage is unavailable. Check the server storage settings and retry.");this.code="CLOUD_STORAGE_UNAVAILABLE";}
}
const hash=v=>createHash("sha256").update(v).digest("hex");
const SAVE_FORECAST=`
local saved=redis.call('GET',KEYS[1])
if not saved then
 if ARGV[3]~='import' then
  local clock=redis.call('TIME')
  local now=tonumber(clock[1])*1000+math.floor(tonumber(clock[2])/1000)
  if now>=tonumber(ARGV[3]) then return nil end
 end
 saved=ARGV[1]
 redis.call('SET',KEYS[1],saved)
 redis.call('HSET',KEYS[2],ARGV[2],saved)
end
return saved`;
const BUDGET=`
local clock=redis.call('TIME')
local now=tonumber(clock[1])*1000+math.floor(tonumber(clock[2])/1000)
for i,key in ipairs(KEYS) do
 local window=tonumber(ARGV[i*2])
 local limit=tonumber(ARGV[i*2+1])
 redis.call('ZREMRANGEBYSCORE',key,'-inf',now-window)
 if redis.call('ZCARD',key)>=limit then
  local first=redis.call('ZRANGE',key,0,0,'WITHSCORES')
  return {0,math.max(1,math.ceil((tonumber(first[2])+window-now)/1000))}
 end
end
for i,key in ipairs(KEYS) do
 redis.call('ZADD',key,now,ARGV[1])
 redis.call('PEXPIRE',key,tonumber(ARGV[i*2]))
end
return {1,0}`;

export function createCloudStore({
  url=process.env.UPSTASH_REDIS_REST_URL,token=process.env.UPSTASH_REDIS_REST_TOKEN,
  namespace=process.env.FORMRADAR_CLOUD_NAMESPACE||"formradar-production",fetchImpl=fetch,
}={}) {
  let origin;
  try {const u=new URL(url);if(u.protocol!=="https:"||!/^[-a-z0-9]+\.upstash\.io$/.test(u.hostname)||u.port||u.username||u.password||u.search||u.hash||!['','/'].includes(u.pathname))throw new Error();origin=u.origin;}
  catch {origin=null;}
  const configured=Boolean(origin&&typeof token==="string"&&token.trim().length>=16&&/^[a-zA-Z0-9:_-]{1,80}$/.test(namespace));
  const key=value=>`${namespace}:v1:${value}`;
  async function command(args){
    if(!configured)throw new CloudStoreError();
    try {
      const response=await fetchImpl(origin,{method:"POST",headers:{Authorization:`Bearer ${token.trim()}`,"Content-Type":"application/json"},body:JSON.stringify(args),redirect:"error",signal:AbortSignal.timeout(8000)});
      if(!response.ok)throw new Error();
      const body=await response.json();
      if(body.error||!Object.hasOwn(body,'result')||JSON.stringify(body).includes(token.trim()))throw new Error();
      return body.result;
    } catch {throw new CloudStoreError();}
  }
  const parse=v=>v===null?null:JSON.parse(v);
  return {
    configured,
    async loadModel(competition){return parse(await command(['GET',key(`model:${competition}`)]));},
    async putModel(competition,bundle){await command(['SET',key(`model:${competition}`),JSON.stringify(bundle)]);},
    async readForecasts(id){const values=await command(['HVALS',key(`forecasts:{${id}}`)]);if(!Array.isArray(values)||values.length>1000)throw new CloudStoreError();return values.map(parse);},
    async saveForecast(forecast,{imported=false}={}){const cutoff=imported?'import':Math.min(Date.parse(forecast.kickoffAt),Date.parse(forecast.expiresAt));if(!imported&&!Number.isFinite(cutoff))throw new CloudStoreError();const saved=await command(['EVAL',SAVE_FORECAST,2,key(`forecast:{${forecast.matchId}}:${forecast.forecastId}`),key(`forecasts:{${forecast.matchId}}`),JSON.stringify(forecast),forecast.forecastId,cutoff]);return parse(saved);},
    async readProvider(path){return parse(await command(['GET',key('football-cache:'+hash(path))]));},
    async writeProvider(path,item){await command(['SET',key('football-cache:'+hash(path)),JSON.stringify(item),'EX',86400]);},
    async budget(name,limits){
      const keys=limits.map((_,i)=>key(`budget:{${name}}:${i}`));
      const args=limits.flatMap(({window,limit})=>[window,limit]);
      const result=await command(['EVAL',BUDGET,keys.length,...keys,randomUUID(),...args]);
      if(!Array.isArray(result)||![0,1].includes(result[0])||!Number.isFinite(result[1]))throw new CloudStoreError();
      return {allowed:result[0]===1,retryAfter:Math.max(1,result[1])};
    },
  };
}

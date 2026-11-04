import {ApiError} from './data.mjs';

// The private FastAPI service owns the 2026 route. Other resources retain the
// existing provider. Its upstream is still football-data.org, with the same
// coverage limits; this adapter never turns demo probabilities into match data.
export function createSeasonProvider({primary,url,key,fetchImpl=fetch,now=Date.now,hosted=false}){
  let base;
  try{
    base=new URL(url);
    const local=base.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(base.hostname);
    if((base.protocol!=='https:'&&(!local||hosted))||base.username||base.password||base.search||base.hash||base.pathname!=='/'||base.hostname==='api.example.com')throw new Error();
  }catch{base=null;}
  const configured=Boolean(base&&typeof key==='string'&&key.length>=20&&key.length<=128&&!/\s/.test(key));
  const cache=new Map(),pending=new Map();let cooldown=0;
  function supported(path){
    const parsed=new URL(path,'https://internal.invalid');
    return /^\/matches\/[1-9]\d{0,6}$/.test(parsed.pathname)&&!parsed.search||
      /^\/competitions\/[A-Z0-9]{2,3}\/matches$/.test(parsed.pathname)&&parsed.searchParams.get('season')==='2026';
  }
  async function custom(path,ttl,transform){
    const entry=cache.get(path);
    if(entry&&now()-entry.at<Math.min(ttl,60000))return {data:transform(entry.raw),meta:{provider:'FormRadar API · football-data.org',fetchedAt:new Date(entry.at).toISOString(),cache:'hit',stale:false,scoresMayBeDelayed:true}};
    if(pending.has(path))return pending.get(path).then(raw=>({data:transform(raw.body),meta:raw.meta}));
    if(now()<cooldown)throw new ApiError(503,'FORMRADAR_FOOTBALL_UNAVAILABLE','Your FastAPI football route is unavailable. Keep FastAPI running and retry.');
    const work=(async()=>{
      let response,body;
      try{
        response=await fetchImpl(new URL('/football'+path,base),{headers:{'X-API-Key':key,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw new Error();
        body=await response.json();
        if(!body||JSON.stringify(body).includes(key))throw new Error();
        const parsed=new URL(path,'https://internal.invalid');
        if(parsed.pathname.startsWith('/matches/')?body.id!==Number(parsed.pathname.split('/').at(-1)):!Array.isArray(body.matches))throw new Error();
      }catch{
        cooldown=now()+15000;
        throw new ApiError(503,'FORMRADAR_FOOTBALL_UNAVAILABLE','Your FastAPI football route is unavailable. Restart the updated service and check its football-data.org access.');
      }
      const at=now(),meta={provider:'FormRadar API · football-data.org',fetchedAt:new Date(at).toISOString(),cache:'miss',stale:false,scoresMayBeDelayed:true};
      if(cache.size>=100&&!cache.has(path))cache.delete(cache.keys().next().value);
      cache.set(path,{raw:body,at});
      return {body,meta};
    })();pending.set(path,work);
    try{const raw=await work;return {data:transform(raw.body),meta:raw.meta};}finally{pending.delete(path);}
  }
  async function get(path,ttl,transform){
    if(!configured||!supported(path))return primary.get(path,ttl,transform);
    try{return await custom(path,ttl,transform);}catch(error){
      if(error.code!=='FORMRADAR_FOOTBALL_UNAVAILABLE')throw error;
      // Preserve an available fixture page during a local service restart.
      const fallback=await primary.get(path,ttl,transform);
      return {...fallback,meta:{...fallback.meta,warning:'FastAPI football route unavailable; using the direct football-data.org feed. Start the updated FastAPI service to use your API.'}};
    }
  }
  return {get,configured:primary.configured||configured,formRadarConfigured:configured};
}

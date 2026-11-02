// Cloud tests use synthetic models and injected stores, never a live database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createCloudStore,CloudStoreError} from '../server/cloud-store.mjs';
import {createPredictions} from '../server/predictions.mjs';
import {createProvider} from '../server/data.mjs';
import {createNews} from '../server/news.mjs';
import {createLineupSource} from '../server/lineups.mjs';
import {publishModels} from '../model/cloud.mjs';
import {digest} from '../model/dataset.mjs';
import {syntheticModel} from './fixtures/prediction.mjs';
const NOW=Date.parse('2026-11-02T12:00:00Z'),TOKEN='synthetic-cloud-private-token';
const bundle=()=>{const json=JSON.stringify(syntheticModel());return {pointer:{run:'experimental-synthetic-only',sha256:digest(json)},json};};
const provider={get:async()=>({data:{id:500,competition:{code:'PL',id:2021},season:{startDate:'2026-08-21'},utcDate:'2026-11-03T20:00:00Z',status:'TIMED',homeTeam:{id:1},awayTeam:{id:2}},meta:{stale:false,fetchedAt:new Date(NOW).toISOString()}})};
function memoryStore(){const records=new Map(),models=new Map([['PL',bundle()]]),cache=new Map();return {configured:true,models,records,loadModel:async c=>models.get(c)||null,putModel:async(c,b)=>models.set(c,b),readForecasts:async id=>[...records.values()].filter(f=>f.matchId===id),saveForecast:async f=>{if(!records.has(f.forecastId))records.set(f.forecastId,structuredClone(f));return structuredClone(records.get(f.forecastId));},readProvider:async p=>cache.get(p)||null,writeProvider:async(p,v)=>cache.set(p,v),budget:async()=>({allowed:true,retryAfter:1})};}

test('cloud REST credentials use a fixed HTTPS origin, private headers and safe failures',async()=>{
 const commands=[];
 const store=createCloudStore({url:'https://synthetic-db.upstash.io',token:TOKEN,fetchImpl:async(url,options)=>{assert.equal(url,'https://synthetic-db.upstash.io');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+TOKEN);assert.equal(url.includes(TOKEN),false);commands.push(JSON.parse(options.body));return new Response(JSON.stringify({result:commands.at(-1)[0]==='GET'?null:'OK'}));}});
 await store.putModel('PL',bundle());assert.equal(await store.loadModel('CL'),null);assert.equal(commands[0][0],'SET');assert.equal(commands[0][1],'formradar-production:v1:model:PL');
 for(const url of ['http://synthetic-db.upstash.io','https://attacker.test','https://synthetic-db.upstash.io.evil.test','https://synthetic-db.upstash.io?token=x']){const invalid=createCloudStore({url,token:TOKEN,fetchImpl:()=>assert.fail('Invalid origin must not fetch')});assert.equal(invalid.configured,false);await assert.rejects(invalid.loadModel('PL'),CloudStoreError);}
 for(const response of [()=>new Response(TOKEN,{status:401}),()=>new Response(JSON.stringify({error:TOKEN})),()=>new Response(JSON.stringify({result:TOKEN}))]){const bad=createCloudStore({url:'https://synthetic-db.upstash.io',token:TOKEN,fetchImpl:async()=>response()});await assert.rejects(bad.loadModel('PL'),e=>e.code==='CLOUD_STORAGE_UNAVAILABLE'&&!e.message.includes(TOKEN));}
});

test('cloud adapter saves forecast and history together atomically and uses server-time rolling budgets',async()=>{
 const store=createCloudStore({url:'https://synthetic-db.upstash.io',token:TOKEN,fetchImpl:async(_,o)=>{const a=JSON.parse(o.body);assert.equal(a[0],'EVAL');if(a[1].includes('ZREMRANGEBYSCORE')){assert.ok(a[1].includes("redis.call('TIME')"));assert.equal(a[2],2);assert.deepEqual(a.slice(-4),[60000,9,86400000,90]);return new Response(JSON.stringify({result:[0,23]}));}assert.ok(a[1].includes("redis.call('HSET'"));assert.equal(a[2],2);assert.equal(a[3],'formradar-production:v1:forecast:{500}:abc');assert.equal(a[4],'formradar-production:v1:forecasts:{500}');return new Response(JSON.stringify({result:a[5]}));}});
 const f={matchId:500,forecastId:'abc',generatedAt:'original',kickoffAt:'2026-11-03T20:00:00Z',expiresAt:'2026-11-03T00:00:00Z'};
 assert.deepEqual(await store.saveForecast(f),f);
 assert.deepEqual(await store.budget('football',[{window:60000,limit:9},{window:86400000,limit:90}]),{allowed:false,retryAfter:23});
});

test('hosted predictions fail clearly without storage and never use local scratch space',async()=>{
 const service=createPredictions({hosted:true,root:'/not-a-model-directory',provider,now:()=>NOW});
 assert.equal((await service.predict(500)).reason,'CLOUD_STORAGE_REQUIRED');assert.equal((await service.predict(500)).hosting,'cloud');
 assert.equal((await service.history(500)).storageAvailable,false);
 const store=memoryStore();store.models.clear();assert.equal((await createPredictions({hosted:true,store,provider,now:()=>NOW}).predict(500)).reason,'MODEL_NOT_READY');
});

test('independent hosted instances retain original forecasts and enforce checksum, expiry and save gates',async()=>{
 const store=memoryStore();const first=createPredictions({hosted:true,store,provider,now:()=>NOW});const second=createPredictions({hosted:true,store,provider,now:()=>NOW+1000});
 const [a,b]=await Promise.all([first.predict(500),second.predict(500)]);assert.equal(a.available,true);assert.deepEqual(a,b);assert.equal(store.records.size,1);assert.equal((await second.history(500)).forecasts[0].generatedAt,a.generatedAt);
 assert.equal((await createPredictions({hosted:true,store,provider,now:()=>Date.parse(syntheticModel().expiresAt)}).predict(500)).reason,'DATA_STALE');
 store.models.set('PL',{...bundle(),json:'{}'});assert.equal((await first.predict(500)).reason,'MODEL_INVALID');
 store.models.set('PL',bundle());store.saveForecast=async()=>{throw new CloudStoreError();};assert.equal((await second.predict(500)).reason,'STORAGE_UNAVAILABLE');
 store.saveForecast=async()=>null;assert.equal((await second.predict(500)).reason,'DATA_STALE','Redis checks cutoff atomically before creating a record');
});

test('shared football cache keeps original retrieval times across instances and checks global quotas',async()=>{
 let time=NOW,calls=0;const store=memoryStore();const args={key:'synthetic-football-token',now:()=>time,sharedStore:store,fetchImpl:async()=>{calls++;return new Response(JSON.stringify({value:42}));}};
 const a=createProvider(args),first=await a.get('/test',60000,x=>x);time+=10000;const second=await createProvider(args).get('/test',60000,()=>assert.fail('Shared normalized cache should be reused'));
 assert.equal(calls,1);assert.equal(first.meta.fetchedAt,second.meta.fetchedAt);time+=60000;store.budget=async()=>({allowed:false,retryAfter:25});
 const stale=await createProvider(args).get('/test',60000,x=>x);assert.equal(stale.meta.stale,true);assert.equal(stale.meta.fetchedAt,first.meta.fetchedAt);assert.equal(calls,1);
 await assert.rejects(createProvider(args).get('/new',60000,x=>x),e=>e.status===429&&e.retryAfter===25);
 store.readProvider=async()=>{throw new CloudStoreError();};await assert.rejects(createProvider(args).get('/new',60000,x=>x),e=>e.status===503);assert.equal(calls,1);
});

test('news and lineup providers respect shared budgets before transmitting credentials upstream',async()=>{
 const names=[];const sharedStore={budget:async name=>{names.push(name);return {allowed:false,retryAfter:30};}};
 const fetchImpl=()=>assert.fail('Shared quota denial must not call upstream');
 await assert.rejects(createNews({key:'synthetic-guardian-key',sharedStore,fetchImpl,now:()=>NOW}).get({competition:'PL'}),e=>e.code==='NEWS_RATE_LIMITED');
 await assert.rejects(createLineupSource({key:'synthetic-lineup-key',sharedStore,fetchImpl,now:()=>NOW}).lineups({competition:{code:'PL'},utcDate:'2026-11-03T20:00:00Z'}),e=>e.code==='LINEUP_RATE_LIMITED');
 assert.deepEqual(names,['guardian','lineups']);
 const token='synthetic-football-token';await assert.rejects(createProvider({key:token,fetchImpl:async()=>new Response(JSON.stringify({name:token}))}).get('/test',60,x=>x),e=>e.code==='INVALID_PROVIDER_DATA'&&!e.message.includes(token));
});

test('publisher uploads validated fresh artifacts and real saved records, refusing expired input before writes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'formradar-synthetic-cloud-'));
 try{
  const b=bundle();await mkdir(join(root,'runs',b.pointer.run),{recursive:true});await writeFile(join(root,'EXPERIMENTAL'),JSON.stringify(b.pointer));await writeFile(join(root,'runs',b.pointer.run,'model.json'),b.json);
  const local=createPredictions({root,provider,now:()=>NOW});const f=await local.predict(500);assert.equal(f.available,true);
  const store=memoryStore();store.models.clear();const result=await publishModels({root,store,now:()=>NOW,competitions:['PL']});assert.deepEqual(result,{models:['PL'],forecastRecords:1});assert.equal(store.models.get('PL').json,b.json);assert.equal(store.records.get(f.forecastId).generatedAt,f.generatedAt);
  let writes=0;store.putModel=async()=>{writes++;};await assert.rejects(publishModels({root,store,now:()=>Date.parse(syntheticModel().expiresAt),competitions:['PL']}),/fresh PL/);assert.equal(writes,0);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('Vercel catch-all entry serves same-origin API paths with no local listener or exposed training route',async()=>{
 const {default:handler}=await import('../api/index.js');const server=createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
 try{const r=await fetch(base+'/api/config');assert.equal(r.status,200);const body=await r.json();assert.equal(body.hosting,'vercel');assert.equal((await fetch(base+'/api/model/train')).status,404);assert.equal((await fetch(base+'/api/config',{method:'POST'})).status,405);assert.equal((await(await fetch(base+'/api/predictions/500')).json()).reason,'CLOUD_STORAGE_REQUIRED');}
 finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
 const config=JSON.parse(await readFile(new URL('../vercel.json',import.meta.url)));assert.equal(config.framework,'vite');assert.equal(config.services,undefined);assert.equal(Object.keys(config.functions).length,1);
});

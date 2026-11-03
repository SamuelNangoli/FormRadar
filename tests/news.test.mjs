import test from "node:test";
import assert from "node:assert/strict";
import {createNews,normalizeNews,guardianArticleUrl} from "../server/news.mjs";
import {createApp,listen} from "../server/app.mjs";

const TOKEN="synthetic-guardian-secret",FOOTBALL="synthetic-football-secret";
const NOW=Date.parse("2026-11-02T15:00:00Z");
const article=(extra={})=>({id:"football/2026/nov/02/synthetic-report",sectionId:"football",type:"article",webTitle:"Synthetic football reporting",webPublicationDate:"2026-11-02T13:00:00Z",webUrl:"https://www.theguardian.com/football/2026/nov/02/synthetic-report",...extra});
const response=(articles=[article()])=>({response:{status:"ok",results:articles}});
const ok=(raw=response())=>new Response(JSON.stringify(raw));
async function server(options,run){const s=await listen(createApp(options),{port:0});try{await run(`http://127.0.0.1:${s.address().port}`);}finally{s.closeAllConnections();await new Promise(r=>s.close(r));}}

test("Guardian normalization retains only football headline metadata, safe links and actual publication times",()=>{
  const unsafe=["javascript:alert(1)","http://www.theguardian.com/football/a","https://attacker.test/football/a","https://secret@www.theguardian.com/football/a","https://www.theguardian.com/politics/a"];
  unsafe.forEach(url=>assert.equal(guardianArticleUrl(url),null));
  const rows=normalizeNews(response([article(),article({webUrl:article().webUrl+"?api-key=bad#tracking"}),article({sectionId:"politics"}),article({webPublicationDate:"2027-01-01T00:00:00Z"}),article({webUrl:unsafe[2]})]),NOW);
  assert.equal(rows.length,1);assert.equal(rows[0].source,"The Guardian");assert.equal(rows[0].affectsPredictions,false);assert.equal(rows[0].verification,"publisher-report");
  assert.equal(JSON.stringify(rows).includes("api-key"),false);assert.equal("body" in rows[0],false);
});

test("news key stays server-side, requests use a fixed origin and caches/coalesces normalized articles",async()=>{
  let calls=0,url;let release;const gate=new Promise(r=>release=r);
  const news=createNews({key:TOKEN,now:()=>NOW,fetchImpl:async(target,options)=>{calls++;url=new URL(target);assert.equal(options.redirect,"error");await gate;return ok();}});
  const a=news.get({competition:"CL"}),b=news.get({competition:"CL"});release();const [first,second]=await Promise.all([a,b]);
  assert.equal(calls,1);assert.deepEqual(first,second);assert.equal(url.origin,"https://content.guardianapis.com");assert.equal(url.pathname,"/search");assert.equal(url.searchParams.get("api-key"),TOKEN);assert.equal(url.searchParams.get("section"),"football");
  assert.equal((await news.get({competition:"CL"})).meta.cache,"hit");assert.equal(calls,1);
  assert.equal(JSON.stringify({status:news.status(),first}).includes(TOKEN),false);
});

test("news failures are safe, authentication does not fall back, and stale headlines have an age ceiling",async()=>{
  let time=NOW,mode="ok";
  const news=createNews({key:TOKEN,now:()=>time,fetchImpl:async()=>mode==="ok"?ok():new Response("secret upstream "+TOKEN,{status:mode==="auth"?401:500})});
  await news.get();time+=600001;mode="down";
  const stale=await news.get();assert.equal(stale.meta.stale,true);assert.equal(stale.meta.fetchedAt,new Date(NOW).toISOString());assert.equal(JSON.stringify(stale).includes(TOKEN),false);
  time+=21_600_000;await assert.rejects(news.get(),e=>e.status===502&&!e.message.includes(TOKEN));
  time+=60_000;mode="auth";await assert.rejects(news.get(),e=>e.code==="NEWS_KEY_REJECTED"&&!e.message.includes(TOKEN));
  const echo=createNews({key:TOKEN,now:()=>NOW,fetchImpl:async()=>ok(response([article({webTitle:TOKEN})]))});
  await assert.rejects(echo.get(),e=>e.code==="NEWS_DATA_INVALID");
});

test("news local request budgets reject bursts and daily exhaustion without extra upstream calls",async()=>{
  let time=NOW,calls=0;const news=createNews({key:TOKEN,now:()=>time,maxPerDay:1,fetchImpl:async()=>{calls++;return ok();}});
  await news.get({competition:"PL"});time+=2000;
  await assert.rejects(news.get({competition:"CL"}),e=>e.code==="NEWS_DAILY_LIMIT");assert.equal(calls,1);
  assert.equal((await news.get({competition:"PL"})).meta.cache,"hit");
});

test("quick competition/topic changes are paced instead of failing the normal filter flow",async()=>{
  let time=NOW,calls=0;const delays=[];
  const news=createNews({key:TOKEN,now:()=>time,wait:async(ms)=>{delays.push(ms);time+=ms;},fetchImpl:async()=>{calls++;return ok();}});
  const results=await Promise.all([news.get({competition:"PL"}),news.get({competition:"CL"}),news.get({competition:"CL",topic:"injuries"})]);
  assert.equal(calls,3);assert.ok(delays.length>0);assert.ok(delays.every(ms=>ms<=3300));assert.ok(results.every(r=>r.data.articles.length===1));
});

test("news routes expose setup safely, validate before quota, resolve provider team IDs and never alter predictions",async()=>{
  await server({guardianKey:"",key:FOOTBALL,fetchImpl:()=>assert.fail("No football request during news setup"),newsFetchImpl:()=>assert.fail("No Guardian request without key")},async(base)=>{
    const status=await(await fetch(base+"/api/news/status")).json();assert.equal(status.configured,false);
    assert.equal((await fetch(base+"/api/news")).status,503);
  });
  let teamCalls=0,newsCalls=0;
  await server({guardianKey:TOKEN,key:FOOTBALL,now:()=>NOW,fetchImpl:async(url,options)=>{teamCalls++;assert.equal(new URL(url).pathname,"/v4/teams/66");assert.equal(options.headers["X-Auth-Token"],FOOTBALL);return ok({id:66,name:"Manchester United FC",shortName:"Man United"});},newsFetchImpl:async(url)=>{newsCalls++;const u=new URL(url);assert.ok(u.searchParams.get("q").includes('"Manchester United"'));assert.equal(u.href.includes(FOOTBALL),false);return ok();}},async(base)=>{
    assert.equal((await fetch(base+"/api/news?competition=CL&teamId=66&url=https://attacker.test")).status,400);
    assert.equal((await fetch(base+"/api/news?teamId=invalid")).status,400);assert.equal(newsCalls,0);assert.equal(teamCalls,0);
    const body=await(await fetch(base+"/api/news?competition=CL&teamId=66&topic=injuries")).json();assert.equal(body.data.team.id,66);assert.equal(body.data.affectsPredictions,false);assert.equal(body.data.teamScope,"all competitions");
    assert.equal(body.data.articles.length,1);assert.equal(newsCalls,1);assert.equal(teamCalls,1);assert.equal(JSON.stringify(body).includes(TOKEN),false);assert.equal(JSON.stringify(body).includes(FOOTBALL),false);
    const config=await(await fetch(base+"/api/config")).json();assert.equal(config.news.configured,true);assert.equal(config.news.affectsPredictions,false);
  });
});

test('thumbnail metadata accepts only trusted Guardian image URLs and never returns article bodies',async()=>{
  const {guardianThumbnailUrl}=await import('../shared/news-media.js');
  const url='https://media.guim.co.uk/abc/0_0_800_480/500.jpg';
  assert.equal(guardianThumbnailUrl(url),url);
  for(const bad of ['http://media.guim.co.uk/a.jpg','https://attacker.test/a.jpg','https://media.guim.co.uk.attacker.test/a.jpg','https://secret@media.guim.co.uk/a.jpg','https://media.guim.co.uk/a.jpg?api-key=secret','data:image/png;base64,a'])assert.equal(guardianThumbnailUrl(bad),null);
  const rows=normalizeNews(response([article({fields:{thumbnail:url,body:'private full article'}})]),NOW);
  assert.equal(rows[0].thumbnail,url);assert.equal(JSON.stringify(rows).includes('private full article'),false);
  assert.equal(normalizeNews(response([article()]),NOW)[0].thumbnail,null);
});

test('Overview latest news uses all football reporting, requests thumbnails and reuses the cached response',async()=>{
  let calls=0;
  await server({key:FOOTBALL,guardianKey:TOKEN,now:()=>NOW,newsFetchImpl:async target=>{calls++;const u=new URL(target);assert.equal(u.searchParams.get('section'),'football');assert.equal(u.searchParams.get('q'),'');assert.equal(u.searchParams.get('show-fields'),'thumbnail');return ok(response([article({fields:{thumbnail:'https://media.guim.co.uk/a/500.jpg'}})]));}},async base=>{
    assert.equal((await fetch(base+'/api/news/latest?url=https://attacker.test')).status,400);assert.equal(calls,0);
    const body=await(await fetch(base+'/api/news/latest')).json();assert.equal(body.data.competition,null);assert.equal(body.data.articles[0].thumbnail,'https://media.guim.co.uk/a/500.jpg');assert.equal(body.data.affectsPredictions,false);assert.equal(JSON.stringify(body).includes(TOKEN),false);
    const repeat=await(await fetch(base+'/api/news/latest')).json();assert.equal(repeat.meta.cache,'hit');assert.equal(calls,1);
  });
});

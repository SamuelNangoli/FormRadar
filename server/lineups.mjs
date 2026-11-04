import {ApiError} from "./data.mjs";
import {recentFixtures,buildPlayerTeam} from "./player-context.mjs";

const leagues={PL:39,CL:2,PD:140,BL1:78,SA:135,FL1:61,ELC:40,DED:88,PPL:94,BSA:71,EC:4,WC:1};
const text=(v,max=100)=>typeof v==="string"?v.replace(/[\u0000-\u001f]/g,"").trim().slice(0,max):"";
const aliases={manunited:"manchesterunited",manutd:"manchesterunited",manchestercity:"manchestercity",mancity:"manchestercity",tottenham:"tottenhamhotspur",bayernmunchen:"bayernmunich",bayern:"bayernmunich",sportingcp:"sportingportugal",sporting:"sportingportugal",sportingclubedeportugal:"sportingportugal",losclille:"lille",inter:"internazionale",intermilan:"internazionale",internazionalemilano:"internazionale",clubatleticodemadrid:"atleticomadrid",atleticodemadrid:"atleticomadrid",parissg:"parissaintgermain"};
export function clubName(value){let name=text(value,160).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/ø/g,"o").replace(/\b(?:fc|cf|afc)\b/g,"").replace(/[^a-z0-9]/g,"");return aliases[name]||name;}
const missing=(reason,message)=>({available:false,reason,message});

export function apiStartingXI(raw,expectedProviderTeamId){
  const side=Array.isArray(raw)?raw.find(s=>s.team?.id===expectedProviderTeamId):null;
  if(!side||!Array.isArray(side.startXI))return null;
  const ids=new Set(),players=[];
  for(const entry of side.startXI){const p=entry?.player;if(!Number.isSafeInteger(p?.id)||p.id<=0||!text(p.name)||ids.has(p.id))return null;ids.add(p.id);players.push({provider:"api-football",id:p.id,name:text(p.name),shirtNumber:Number.isInteger(p.number)?p.number:null,position:text(p.pos,40)||null,grid:/^[1-6]:[1-6]$/.test(p.grid||"")?p.grid:null});}
  if(players.length!==11)return null;
  const bench=(Array.isArray(side.substitutes)?side.substitutes:[]).flatMap(e=>Number.isSafeInteger(e?.player?.id)&&text(e.player.name)?[{provider:"api-football",id:e.player.id,name:text(e.player.name),shirtNumber:Number.isInteger(e.player.number)?e.player.number:null,position:text(e.player.pos,40)||null}]:[]).slice(0,25);
  return {players,bench,formation:/^\d{1,2}(?:-\d{1,2}){1,5}$/.test(side.formation||"")?side.formation:null,coach:text(side.coach?.name)||null};
}

export function matchFixture(candidates,match){
  const expected=leagues[match.competition?.code];
  const names=team=>new Set([team?.name,team?.shortName].filter(Boolean).map(clubName));
  const home=names(match.homeTeam),away=names(match.awayTeam);
  const found=(Array.isArray(candidates)?candidates:[]).filter(f=>f.league?.id===expected&&home.has(clubName(f.teams?.home?.name))&&away.has(clubName(f.teams?.away?.name))
    &&Number.isSafeInteger(f.fixture?.id)&&Math.abs(Date.parse(f.fixture.date)-Date.parse(match.utcDate))<=900_000);
  return found.length===1?found[0]:null;
}

export function createLineupSource({key,fetchImpl=fetch,now=Date.now,maxCalls=8,maxDaily=90,sharedStore}={}){
  const configured=Boolean(key?.trim()&&/^[A-Za-z0-9_-]{16,128}$/.test(key.trim())&&!/^(your|paste|replace)/i.test(key.trim()));
  const cache=new Map(),pending=new Map(),restrictedPaths=new Map(),calls=[];let day="",daily=0,cooldownUntil=0;
  async function get(path,ttl=120000){
    const blocked=restrictedPaths.get(path);if(blocked&&now()<blocked.until)throw blocked.error;
    const cached=cache.get(path);if(cached&&now()-cached.at<ttl)return cached.value;
    if(pending.has(path))return pending.get(path);
    const work=(async()=>{
      const today=new Date(now()).toISOString().slice(0,10);if(today!==day){day=today;daily=0;}
      while(calls.length&&now()-calls[0]>=60000)calls.shift();
      if(now()<cooldownUntil||calls.length>=maxCalls||daily>=maxDaily)throw new ApiError(429,"LINEUP_RATE_LIMITED","The lineup request budget is busy. Wait and retry; existing match information remains available.",60);
      calls.push(now());daily++;let response;
      if(sharedStore){let budget;try{budget=await sharedStore.budget('lineups',[{window:60000,limit:maxCalls},{window:86400000,limit:maxDaily}]);}catch{throw new ApiError(503,"CLOUD_STORAGE_UNAVAILABLE","The shared lineup request budget could not be checked. Retry shortly.");}if(!budget.allowed)throw new ApiError(429,"LINEUP_RATE_LIMITED","The shared lineup request budget is busy. Retry later.",budget.retryAfter);}
      try{response=await fetchImpl("https://v3.football.api-sports.io"+path,{headers:{"x-apisports-key":key.trim(),Accept:"application/json"},redirect:"error",signal:AbortSignal.timeout(12000)});}catch{throw new ApiError(502,"LINEUP_SOURCE_UNAVAILABLE","The lineup provider could not be reached. Please retry.");}
      if(response.status===401||response.status===403)throw new ApiError(401,"LINEUP_KEY_REJECTED","The API-Football key or its access was rejected. Check the local key and account coverage.");
      if(response.status===429){cooldownUntil=now()+60000;throw new ApiError(429,"LINEUP_RATE_LIMITED","The lineup provider request limit was reached. Please retry later.",60);}
      if(!response.ok)throw new ApiError(502,"LINEUP_SOURCE_UNAVAILABLE","The lineup provider could not return data.");
      let body;try{body=await response.json();}catch{throw new ApiError(502,"LINEUP_DATA_INVALID","The lineup provider returned unreadable data.");}
      const serialized=JSON.stringify(body);if(serialized.includes(key.trim()))throw new ApiError(502,"LINEUP_DATA_INVALID","The lineup response failed credential isolation.");
      if(Object.keys(body.errors||{}).length){const diagnostic=JSON.stringify(body.errors);
        if(/token|api.?key|authentication/i.test(diagnostic))throw new ApiError(401,"LINEUP_KEY_REJECTED","The lineup provider rejected the API key. Check the local key and restart FormRadar.");
        if(/quota|rate.?limit|requests?.*limit/i.test(diagnostic)){cooldownUntil=now()+60000;throw new ApiError(429,"LINEUP_RATE_LIMITED","The lineup request limit was reached. Please retry later.",60);}
        const restricted=/plan|subscription|season|access/i.test(diagnostic);const error=new ApiError(503,restricted?"LINEUP_PLAN_RESTRICTED":"LINEUP_DATA_UNAVAILABLE",restricted?"Your API-Football plan does not provide this competition/season. Check current-season lineup coverage on your account.":"The lineup provider could not fulfil this request.");if(restricted){if(restrictedPaths.size>=200)restrictedPaths.delete(restrictedPaths.keys().next().value);restrictedPaths.set(path,{error,until:now()+900000});}throw error;}
      if(!Array.isArray(body.response))throw new ApiError(502,"LINEUP_DATA_INVALID","The lineup provider returned an invalid data list.");
      if(cache.size>=200&&!cache.has(path))cache.delete(cache.keys().next().value);cache.set(path,{at:now(),value:body.response});return body.response;
    })();pending.set(path,work);try{return await work;}finally{pending.delete(path);}
  }
  async function lineups(match,possible=false){
    if(!configured)return missing("LINEUP_KEY_REQUIRED","Your current football feed does not supply this lineup. Add an entitled API_FOOTBALL_KEY locally to enable starting-XI data.");
    const league=leagues[match.competition?.code];if(!league)return missing("LINEUP_COMPETITION_UNSUPPORTED","Lineup matching is not configured for this competition.");
    const date=match.utcDate.slice(0,10),year=Number(date.slice(0,4)),month=Number(date.slice(5,7));
    const season=["BSA","EC","WC"].includes(match.competition.code)?year:month>=7?year:year-1;
    const candidates=await get(`/fixtures?league=${league}&season=${season}&date=${date}&timezone=UTC`);
    const mapped=matchFixture(candidates,match);
    if(!mapped)return missing("LINEUP_FIXTURE_UNMATCHED","No unique fixture with matching teams and kickoff was found in the lineup provider. No lineup was guessed.");
    const lineupPath=`/fixtures/lineups?fixture=${mapped.fixture.id}`;
    const raw=await get(lineupPath,match.status==="FINISHED"?86400000:120000);
    const result={available:true,provider:"API-Football",dataFetchedAt:new Date(cache.get(lineupPath).at).toISOString(),mode:"reported",home:null,away:null};
    for(const side of ["home","away"]){
      const providerId=mapped.teams?.[side]?.id;let xi=apiStartingXI(raw,providerId);
      if(xi){result[side]={...xi,kind:match.status==="FINISHED"?"used":"reported",reference:null};continue;}
      if(possible&&Date.parse(match.utcDate)>now()){
        const previous=(await get(`/fixtures?team=${providerId}&last=3&timezone=UTC`,900000)).filter(f=>["FT","AET","PEN"].includes(f.fixture?.status?.short)
          &&Date.parse(f.fixture.date)<Math.min(now(),Date.parse(match.utcDate))&&now()-Date.parse(f.fixture.date)<=30*86400000
          &&[f.teams?.home?.id,f.teams?.away?.id].includes(providerId)).sort((a,b)=>b.fixture.date.localeCompare(a.fixture.date));
        for(const f of previous.slice(0,2)){const path=`/fixtures/lineups?fixture=${f.fixture.id}`;xi=apiStartingXI(await get(path,86400000),providerId);if(xi){result[side]={...xi,kind:"reference",reference:{date:f.fixture.date,home:text(f.teams.home.name),away:text(f.teams.away.name),dataFetchedAt:new Date(cache.get(path).at).toISOString()}};break;}}
      }
      result[side]||={players:[],bench:[],formation:null,kind:"unavailable",reference:null};
    }
    result.mode=[result.home,result.away].some(s=>s.kind==="reference")?"reference":"reported";
    result.available=[result.home,result.away].some(s=>s.players.length===11);
    if(!result.available)Object.assign(result,missing("LINEUPS_NOT_PUBLISHED",match.status==="FINISHED"?"This provider did not return the starting lineups used for this match.":"Starting lineups have not been supplied for this fixture. Try again near kickoff, or view a recent starting-XI reference."));
    return result;
  }
  async function playerContext(match){
    if(!configured)return missing("LINEUP_KEY_REQUIRED","Connect an entitled API-Football key to see player ratings, recent form and availability.");
    const league=leagues[match.competition?.code];
    if(!league)return missing("LINEUP_COMPETITION_UNSUPPORTED","Player matching is not configured for this competition.");
    const date=match.utcDate.slice(0,10),year=Number(date.slice(0,4)),month=Number(date.slice(5,7));
    const season=["BSA","EC","WC"].includes(match.competition.code)?year:month>=7?year:year-1;
    const mapped=matchFixture(await get(`/fixtures?league=${league}&season=${season}&date=${date}&timezone=UTC`),match);
    if(!mapped)return missing("LINEUP_FIXTURE_UNMATCHED","No unique matching fixture was found. Player data was not attached to a different match.");
    if(mapped.testOnly===true||mapped.teams?.home?.id===mapped.teams?.away?.id)throw new ApiError(502,"LINEUP_DATA_INVALID","The lineup fixture identity could not be validated.");
    const issues=[],cutoff=Math.min(now(),Date.parse(match.utcDate)),future=Date.parse(match.utcDate)>now();
    const safe=async(path,ttl,area)=>{try{return await get(path,ttl);}catch(e){issues.push({area,code:e instanceof ApiError?e.code:"LINEUP_SOURCE_UNAVAILABLE",message:e instanceof ApiError?e.message:"This player data is temporarily unavailable."});return null;}};
    const lineupPath=`/fixtures/lineups?fixture=${mapped.fixture.id}`;
    const lineups=await safe(lineupPath,match.status==="FINISHED"?86400000:120000,"Starting XI");
    const injuryPath=`/injuries?fixture=${mapped.fixture.id}`;
    const injuries=await safe(injuryPath,3600000,"Injuries and suspensions");
    const history={},squads={},from=new Date(cutoff-30*86400000).toISOString().slice(0,10),to=new Date(cutoff).toISOString().slice(0,10);
    for(const side of ["home","away"]){
      const teamId=mapped.teams[side]?.id;
      if(!Number.isSafeInteger(teamId)||teamId<=0)throw new ApiError(502,"LINEUP_DATA_INVALID","The lineup provider returned an invalid team identity.");
      history[side]=recentFixtures(await safe(`/fixtures?team=${teamId}&from=${from}&to=${to}&status=FT-AET-PEN&timezone=UTC`,900000,`${side} recent matches`),teamId,cutoff);
      squads[side]=future?await safe(`/players/squads?team=${teamId}`,900000,`${side} current squad`):null;
    }
    const ids=[...new Set([...history.home,...history.away].map(f=>f.fixture.id))].sort((a,b)=>a-b);
    const bundles=ids.length?await safe(`/fixtures?ids=${ids.join("-")}`,86400000,"Recent player ratings"):[];
    const result={available:true,provider:"API-Football",scope:{maxMatches:3,lookbackDays:30,cutoff:new Date(cutoff).toISOString(),ratingScale:"0 to 10; provider performance grades"},
      dataFetchedAt:new Date(now()).toISOString(),injuriesAvailable:injuries!==null,
      availabilityAsOf:cache.has(injuryPath)?new Date(cache.get(injuryPath).at).toISOString():null,
      ratingDataAsOf:ids.length&&cache.has(`/fixtures?ids=${ids.join("-")}`)?new Date(cache.get(`/fixtures?ids=${ids.join("-")}`).at).toISOString():null,
      issues,affectsPredictions:false,modelStatus:"Player-aware training and chronological evaluation are required before these values change match probabilities."};
    for(const side of ["home","away"]){
      const teamId=mapped.teams[side].id;
      const team=buildPlayerTeam({teamId,history:history[side],bundles,squadRows:squads[side],injuries,fixtureId:mapped.fixture.id,normalizeXI:apiStartingXI,cutoff});
      const official=apiStartingXI(lineups,teamId);
      team.reported=official?{...official,kind:match.status==="FINISHED"?"used":"reported"}:null;
      if(!future)team.possible=null;
      if(team.reported)team.possible=team.reported;
      team.absenceCoverage=injuries!==null?"provider-report":"unavailable";
      result[side]=team;
    }
    result.available=[result.home,result.away].some(s=>s.players.length||s.reported||s.absences.length);
    if(!result.available)Object.assign(result,missing("PLAYER_DATA_UNAVAILABLE","No usable player details were returned for this fixture. Check season coverage and try again later."));
    return result;
  }
  return {configured,lineups,playerContext};
}

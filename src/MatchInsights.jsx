import React,{useState} from "react";
import {Swords,Users,Info} from "lucide-react";
import {useResource} from "./api.js";
import {Crest,Loading,ErrorNotice} from "./components.jsx";
import {scoreDetail} from "./format.js";
import PlayerContext from "./PlayerContext.jsx";

const localDate=v=>new Date(v).toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"});
const retrieved=v=>v?new Date(v).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"}):"Unavailable";
const positions={G:"Goalkeeper",D:"Defence",M:"Midfield",F:"Forward"};
function Players({players}){return <ol className="players-list">{players.map(p=><li key={`${p.provider}-${p.id}`}><span className="shirt-number">{p.shirtNumber??"–"}</span><span>{p.name}</span><small>{positions[p.position]||p.position||"Position unavailable"}</small></li>)}</ol>;}
function TeamLineup({team,side}){return <div className="team-lineup">
  <div className="lineup-team"><Crest team={team} size={27}/><b>{team.name}</b><span>{side?.formation||"Formation unavailable"}</span></div>
  {side?.players?.length===11?<><div className={"lineup-kind "+(side.kind==="reference"?"reference":"")}>{side.kind==="used"?"Starting XI used":side.kind==="reference"?"Possible · recent XI reference":"Provider-reported starting XI"}</div>
    {side.reference&&<p className="source-note">{localDate(side.reference.date)} · {side.reference.home} vs {side.reference.away}. This previous XI is a reference, not a confirmed selection or an injury-adjusted prediction.</p>}
    {side.coach&&<p className="lineup-coach">Coach · {side.coach}</p>}<Players players={side.players}/>
    {side.bench?.length>0&&<details className="lineup-bench"><summary>Bench · {side.bench.length}</summary><Players players={side.bench}/></details>}
  </>:<p className="source-note">No starting XI supplied for this team.</p>}
</div>;}

export default function MatchInsights({match,demo,refresh,backendCurrent}){
  const [tab,setTab]=useState("head"),[possible,setPossible]=useState(false),[retry,setRetry]=useState(0);
  const enabled=!demo&&backendCurrent;
  const head=useResource(`/api/matches/${match.id}/head-to-head`,{enabled:enabled&&tab==="head",refresh:refresh+retry,ttl:900000});
  const lineup=useResource(`/api/matches/${match.id}/lineups?view=reported`,{enabled:enabled&&tab==="lineups"&&!possible,refresh:`${refresh}-${retry}-${match.status}`,ttl:120000});
  const player=useResource(`/api/matches/${match.id}/player-context`,{enabled:enabled&&(tab==="players"||tab==="lineups"&&possible),refresh:`${refresh}-${retry}-${match.status}`,ttl:120000});
  const data=head.data?.data,xi=lineup.data?.data;
  const restricted=lineup.error?.code==="LINEUP_PLAN_RESTRICTED";
  return <section className="panel match-insights">
    <div className="panel-title"><span><Swords size={18}/> Match information</span></div>
    <div className="insight-tabs"><button aria-pressed={tab==="head"} className={tab==="head"?"active":""} onClick={()=>setTab("head")}><Swords size={14}/> Head to head</button><button aria-pressed={tab==="lineups"} className={tab==="lineups"?"active":""} onClick={()=>setTab("lineups")}><Users size={14}/> {match.status==="FINISHED"?"Lineups used":"Lineups"}</button><button aria-pressed={tab==="players"} className={tab==="players"?"active":""} onClick={()=>setTab("players")}><Users size={14}/> Player form</button></div>
    {!enabled?<div className="insight-empty"><Info size={20}/><p>{demo?"Head-to-head history and lineups use provider data. No synthetic player selections are substituted in demo mode.":"Restart FormRadar in the terminal and reload this page to enable the new match information routes."}</p></div>:tab==="head"?<>
      {head.loading&&<Loading label="Loading previous meetings…"/>}{head.error&&<ErrorNotice error={head.error} onRetry={()=>setRetry(n=>n+1)}/>}
      {data&&<><div className="h2h-totals"><div><strong>{data.summary.homeWins}</strong><span>{match.homeTeam.name} wins</span></div><div><strong>{data.summary.draws}</strong><span>Draws</span></div><div><strong>{data.summary.awayWins}</strong><span>{match.awayTeam.name} wins</span></div></div>
        {data.matches.length?<div className="h2h-list">{data.matches.map(m=><div className="h2h-row" key={m.id}><small>{localDate(m.utcDate)} · {m.competition.name}</small><div><span className="h2h-club"><Crest team={m.homeTeam} size={24}/>{m.homeTeam.name}</span><b>{m.score.home??"–"}–{m.score.away??"–"}</b><span className="h2h-club">{m.awayTeam.name}<Crest team={m.awayTeam} size={24}/></span></div>{scoreDetail(m)&&<small>{scoreDetail(m)}</small>}</div>)}</div>:<p className="source-note">No previous completed meetings were returned in the available history.</p>}
        <p className="source-note">{data.scope}. Counts use {data.summary.sample} available goal results, including extra time; shootout tallies are excluded.</p>
        <p className="source-note">Retrieved {retrieved(head.data.meta?.fetchedAt)}{head.data.meta?.stale?" · Cached data: the provider could not refresh it.":""}</p></>}
    </>:tab==="players"?<PlayerResource resource={player} possible={false} onRetry={()=>setRetry(n=>n+1)}/>:<>
      {match.status!=="FINISHED"&&Date.parse(match.utcDate)>Date.now()&&<div className="lineup-view"><button aria-pressed={!possible} className={!possible?"active":""} onClick={()=>setPossible(false)}>Reported XI</button><button aria-pressed={possible} className={possible?"active":""} onClick={()=>setPossible(true)}>Possible XI</button></div>}
      {possible?<PlayerResource resource={player} possible onRetry={()=>setRetry(n=>n+1)}/>:<>
      {lineup.loading&&<Loading label="Checking starting lineups…"/>}
      {restricted?<div className="insight-empty"><Info size={20}/><div><b>Lineups not included in this access</b><p>{lineup.error.message}</p><p>The connected plan does not cover the selected season. Head-to-head history, fixtures and model forecasts remain available.</p></div></div>:lineup.error?<ErrorNotice error={lineup.error} onRetry={()=>setRetry(n=>n+1)}/>:null}
      {xi&&!xi.available&&<div className="insight-empty"><Info size={20}/><div><b>{xi.reason==="LINEUP_KEY_REQUIRED"?"Lineup source needed":"Lineups not available yet"}</b><p>{xi.message}</p></div></div>}
      {xi?.available&&<div className="lineup-columns"><TeamLineup team={match.homeTeam} side={xi.home}/><TeamLineup team={match.awayTeam} side={xi.away}/></div>}
      {xi&&<p className="source-note">{xi.provider||"Connected provider"} · {xi.mode==="reference"?"Recent starting-XI reference; selection may change":"Starting lineup data"} · Retrieved {retrieved(lineup.data.meta?.fetchedAt)}{lineup.data.meta?.stale?" · Cached fixture information":""}. Does not alter model probabilities.</p>}
      </>}
    </>}
  </section>;
}

function PlayerResource({resource,possible,onRetry}){
  return <>
    {resource.loading&&<Loading label="Checking player form and availability…"/>}
    {resource.error?.code==="LINEUP_PLAN_RESTRICTED"?<div className="insight-empty"><Info size={20}/><div><b>Player data is not included in this access</b><p>{resource.error.message}</p><p>Ratings, injury reports and possible selections need coverage for the selected season. Existing result-based model estimates remain available.</p></div></div>:resource.error?<ErrorNotice error={resource.error} onRetry={onRetry}/>:null}
    {!resource.loading&&!resource.error&&resource.data?.data&&<PlayerContext data={resource.data.data} possible={possible}/>}
  </>;
}

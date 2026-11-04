import React,{useState} from "react";
import {Info,Users} from "lucide-react";
import {Crest} from "./components.jsx";

const positions={G:"GK",D:"DEF",M:"MID",F:"FWD"};
const display=v=>v==null?"—":v;

function Absences({side,available}){
  return <div className="player-absences"><h4>Injuries and suspensions</h4>
    {!available?<p>Availability reports are unavailable. Missing reports do not establish that a player is fit.</p>:side.absences?.length?<ul>{side.absences.map(p=><li key={p.id}><b>{p.name}</b><span className={p.status==="out"?"availability-out":"availability-doubtful"}>{p.status==="out"?"Reported out":"Doubtful"}</span><small>{p.category} · {p.reason}</small></li>)}</ul>:<p>No absences were reported by this source for the selected fixture.</p>}
  </div>;
}

function Selection({side,injuriesAvailable}){
  const xi=side.possible;
  return <div className="player-selection"><h4>{xi?.kind==="reported"?"Provider-reported XI":xi?.kind==="used"?"Starting XI used":"Possible starting XI"}</h4>
    {xi?<><p>{xi.formation}{xi.kind==="estimated"?" · Estimated from recent starts and player ratings. Selection may change.":" · Supplied by the lineup provider."}</p>
      {xi.kind==="estimated"&&!injuriesAvailable&&<p className="availability-doubtful">Injury and suspension reports are unavailable; absences have not been checked.</p>}
      <ol className="possible-players">{xi.players.map(p=><li key={p.id}><span>{positions[p.position]||p.position||"—"}</span><b>{p.name}</b><small>{p.availability==="doubtful"?"Doubtful":p.starts!=null?`${p.starts}/${side.historyMatches} recent starts`:"Reported starter"}</small></li>)}</ol>
      {xi.kind==="estimated"&&<p>Selection uses the latest available formation and current squad. These are ranking rules, not calibrated player selection probabilities.</p>}
    </>:<p>A full possible XI needs at least two recent starting lineups, a known formation and a verified current squad. No missing players are invented.</p>}
  </div>;
}

function PlayerTeam({team,side,possible,injuriesAvailable}){
  const [expanded,setExpanded]=useState(false);
  if(!side)return null;
  return <section className="player-context-team"><div className="lineup-team"><Crest team={team} size={27}/><b>{team.name}</b></div>
    {possible&&<Selection side={side} injuriesAvailable={injuriesAvailable}/>}
    <h4>Recent player form</h4><p className="player-context-note">Up to three completed matches in the 30 days before the selected kickoff. Ratings are provider performance grades out of 10.</p>
    {side.players?.length?<><div className="table-scroll"><table className="player-form-table"><caption className="sr-only">{team.name} recent player ratings and form</caption><thead><tr><th>Player</th><th>Rating</th><th>Starts</th><th>Minutes</th><th>Goals</th><th>Assists</th></tr></thead><tbody>{(expanded?side.players:side.players.slice(0,11)).map(p=><tr key={p.id}><th scope="row"><span>{p.name}</span><small>{positions[p.position]||p.position||"Position unavailable"}{p.availability?` · ${p.availability==="out"?"Reported out":"Doubtful"}`:""}</small></th><td><b>{p.averageRating==null?"—":p.averageRating.toFixed(2)}</b><small>{p.ratedMatches} rated</small></td><td>{p.starts}/{side.historyMatches}</td><td>{display(p.minutes)}</td><td>{display(p.goals)}</td><td>{display(p.assists)}</td></tr>)}</tbody></table></div>{side.players.length>11&&<button className="quiet-button player-expand" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?"Show regular starters":`Show all ${side.players.length} recent players`}</button>}</>:<p className="player-context-note">Recent player statistics were not returned for this team.</p>}
    <Absences side={side} available={injuriesAvailable}/>
    {side.history?.length>0&&<details className="player-context-history"><summary>{side.history.length} source matches</summary><ul>{side.history.map(f=><li key={f.fixtureId}>{new Date(f.date).toLocaleDateString()} · {f.home} vs {f.away}</li>)}</ul></details>}
  </section>;
}

export default function PlayerContext({data,possible=false}){
  const at=data.dataFetchedAt||data.scope?.cutoff;
  return <div className="player-context">
    <div className="detail-note"><Info size={17}/><p>Player information is shown as match context. The current result-based prediction model has not been retrained with these inputs.</p></div>
    {!data.available&&<div className="insight-empty"><Users size={20}/><p>{data.message||"Player details are not available for this fixture."}</p></div>}
    {data.issues?.length>0&&<details className="player-context-issues"><summary>Some player information is unavailable</summary><ul>{data.issues.map((v,i)=><li key={i}>{v.area}: {v.message}</li>)}</ul></details>}
    <div className="player-context-teams"><PlayerTeam team={data.teams.home} side={data.home} possible={possible} injuriesAvailable={data.injuriesAvailable}/><PlayerTeam team={data.teams.away} side={data.away} possible={possible} injuriesAvailable={data.injuriesAvailable}/></div>
    <p className="source-note">API-Football{at?` · Retrieved ${new Date(at).toLocaleString()}`:""}. A dash means unavailable. Player statistics cover only the listed source matches.</p>
  </div>;
}

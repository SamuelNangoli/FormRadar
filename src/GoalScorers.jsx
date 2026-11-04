import React from 'react';
import {goalTime} from '../shared/match-events.js';

export default function GoalScorers({match,compact=false}){
  if(!['IN_PLAY','PAUSED','EXTRA_TIME','PENALTY_SHOOTOUT','FINISHED'].includes(match.status))return null;
  const goals=Array.isArray(match.goals)?match.goals:[];
  if(compact&&!goals.length)return null;
  const total=Number.isInteger(match.score?.home)&&Number.isInteger(match.score?.away)?match.score.home+match.score.away:null;
  return <div className={'goal-scorers'+(compact?' compact':'')}>
    {!compact&&<h3>Goalscorers</h3>}
    {goals.length?<div className="scorer-columns">{['home','away'].map(side=><div key={side}>
      <b>{match[side+'Team'].name}</b>
      <ul>{goals.filter(g=>g.side===side).map((g,i)=><li key={`${side}-${i}`}><span>{g.scorer||'Scorer unavailable'}{g.type==='PENALTY'?' (pen)':g.type==='OWN'?' (own goal)':''}</span><small>{goalTime(g)}</small></li>)}</ul>
    </div>)}</div>:<p className="source-note">{match.goalsAvailable&&total===0?'No goals reported.':'The connected feed has not supplied goalscorer details for this match.'}</p>}
    {!compact&&total!==null&&total>goals.length&&goals.length>0&&<p className="source-note">The scoring feed is incomplete; some goalscorer details are unavailable.</p>}
    {!compact&&<p className="source-note">Reported match events may be delayed or corrected. Shootout kicks are excluded.</p>}
  </div>;
}

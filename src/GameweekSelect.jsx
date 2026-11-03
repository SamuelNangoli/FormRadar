import React from 'react';
import {ChevronLeft,ChevronRight} from 'lucide-react';

export default function GameweekSelect({resource,onChange,demo,historical}) {
  const data=resource.data?.data,rounds=data?.rounds||[],index=rounds.findIndex(r=>r.key===data?.round?.key);
  return <div className="gameweek-control">
    <div className="gameweek-picker">
      <button className="icon-btn" aria-label="Previous gameweek" disabled={resource.loading||index<=0} onClick={()=>onChange(rounds[index-1].key)}><ChevronLeft size={18}/></button>
      <label>Gameweek<select aria-label="Gameweek" disabled={demo||!rounds.length||resource.loading} value={data?.round?.key||''} onChange={e=>onChange(e.target.value)}>
        {!rounds.length&&<option value="">{demo?'Demo fixtures':resource.loading?'Loading gameweeks…':'No gameweeks available'}</option>}
        {rounds.map(r=><option key={r.key} value={r.key}>{r.label} · {r.count} {r.count===1?'match':'matches'}</option>)}
      </select></label>
      <button className="icon-btn" aria-label="Next gameweek" disabled={resource.loading||index<0||index>=rounds.length-1} onClick={()=>onChange(rounds[index+1].key)}><ChevronRight size={18}/></button>
      {!demo&&<button className="quiet-button gameweek-reset" disabled={resource.loading} onClick={()=>onChange('')}>{historical?'Latest gameweek':'Current gameweek'}</button>}
    </div>
    <p>{demo?'Synthetic fixtures only.':`One provider-assigned round at a time${data?.seasonLabel?` · ${data.seasonLabel}`:''}. Rescheduled fixtures stay in their gameweek.`}</p>
    {data?.unassignedMatches>0&&<p>Some fixtures have no round information and cannot be grouped into a gameweek.</p>}
  </div>;
}

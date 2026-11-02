import React,{useState} from "react";
import {Grid3X3} from "lucide-react";

export default function ScorelineHeatmap({scoreline,match}) {
  const [selected,setSelected]=useState(null);
  if(!scoreline?.matrix)return null;
  const {matrix,labels,expectedGoals}=scoreline;
  const maximum=Math.max(...matrix.flat());
  const current=selected||(()=>{let best=[0,0];matrix.forEach((row,h)=>row.forEach((p,a)=>{if(p>matrix[best[0]][best[1]])best=[h,a];}));return best;})();
  const [h,a]=current;
  const outcome=h===6&&a===6?"Both teams 6+ goals":`${labels[h]}–${labels[a]}`;
  return <section className="panel scoreline-map">
    <div className="panel-title"><span><Grid3X3 size={18}/> Scoreline heat map</span><span className="ai-badge">MODEL</span></div>
    <div className="scoreline-intro"><p>Explore the fitted Poisson goal distribution. Brighter cells have more probability.</p><span>{match.homeTeam.name} expected goals <b>{expectedGoals.home.toFixed(2)}</b> · {match.awayTeam.name} <b>{expectedGoals.away.toFixed(2)}</b></span></div>
    <div className="heatmap-axis">Away goals →</div>
    <div className="table-scroll"><table className="heatmap-table"><caption className="sr-only">Home goals in rows, away goals in columns. Select a cell for its probability. Six plus is an aggregated goal bucket.</caption><thead><tr><th scope="col">Home ↓</th>{labels.map(l=><th scope="col" key={l}>{l}</th>)}</tr></thead><tbody>{matrix.map((row,home)=><tr key={home}><th scope="row">{labels[home]}</th>{row.map((p,away)=><td key={away}><button aria-pressed={home===h&&away===a} aria-label={`${labels[home]} home goals, ${labels[away]} away goals: ${(p*100).toFixed(2)} percent`} title={`${(p*100).toFixed(2)}%`} onClick={()=>setSelected([home,away])} style={{background:`rgba(57,217,154,${.08+.8*p/maximum})`,color:p/maximum>.55?"#061a13":"#d8efe6"}}>{p*100<.1?"<0.1":(p*100).toFixed(1)}<small>%</small></button></td>)}</tr>)}</tbody></table></div>
    <p className="heatmap-selection" aria-live="polite">Selected: <b>{outcome}</b> · <strong>{(matrix[h][a]*100).toFixed(2)}%</strong></p>
    <p className="source-note">These score probabilities use the underlying Poisson rates. The temperature adjustment used for the 1X2 forecast is not applied here; exact-score accuracy has not been separately evaluated. “6+” groups all higher goal counts.</p>
  </section>;
}

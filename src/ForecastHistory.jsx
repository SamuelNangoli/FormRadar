import React from "react";
import {Loading,ErrorNotice} from "./components.jsx";
import {displayPercentages} from "./probability.js";
const date=v=>new Date(v).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
export default function ForecastHistory({resource,onRetry}){
  const saved=resource.error?[]:resource.data?.forecasts||[];
  return <section className="panel model-history">
    <div className="panel-title"><span>Saved pre-match forecasts</span><span className="subtle">{resource.error||resource.data?.storageAvailable===false?'History unavailable':resource.loading?'Checking…':`${saved.length} ${saved.length===1?'revision':'revisions'}`}</span></div>
    {resource.loading&&<Loading label="Loading saved forecasts…"/>}
    {resource.error&&<ErrorNotice error={resource.error} onRetry={onRetry}/>}
    {!resource.loading&&!resource.error&&resource.data?.storageAvailable!==false&&!saved.length&&<p className="source-note">No forecast has been saved for this fixture yet.</p>}
    {resource.data?.storageAvailable===false&&<p className="source-note">{resource.data.message}</p>}
    {saved.length>0&&<div className="table-scroll"><table><caption className="sr-only">Actual saved experimental forecasts, never backfilled</caption><thead><tr><th>Saved</th><th>Home</th><th>Draw</th><th>Away</th><th>Model</th></tr></thead><tbody>{saved.map(f=><tr key={f.forecastId}><td>{date(f.generatedAt)}</td>{displayPercentages(f.probabilities).map((p,i)=><td key={i}>{p}%</td>)}<td title={f.modelVersion}>{f.modelVersion.slice(0,8)}</td></tr>)}</tbody></table></div>}
    <p className="source-note">Real saved revisions only. Reopening the same fixture, model and forecast format reuses its original record. Updated models, changed kickoffs or a new forecast format create a revision.</p>
  </section>;
}

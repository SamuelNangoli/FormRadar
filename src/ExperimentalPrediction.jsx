import React, { useEffect, useState } from "react";
import { Target, Info } from "lucide-react";
import { useResource } from "./api.js";
import { Versus, Loading, ErrorNotice } from "./components.jsx";
import { displayPercentages } from "./probability.js";
import ScorelineHeatmap from "./ScorelineHeatmap.jsx";
import ForecastHistory from "./ForecastHistory.jsx";

const date = (value) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

export default function ExperimentalPrediction({ match, refresh, backendCurrent = true }) {
  const [retry, setRetry] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const [review, setReview] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const competition = match.competition?.code || "PL";
  const champions = competition === "CL";
  const supported = ["PL","CL"].includes(competition);
  const command = champions ? "npm run model:prepare-cl" : "npm run model:prepare-current";
  const resource = useResource(`/api/predictions/${match.id}?competition=${competition}`, { enabled:backendCurrent && supported, refresh: refresh + retry, ttl: 0 });
  const data = resource.data;
  const valid = data?.available && !resource.loading && !resource.error
    && clock < Date.parse(data.expiresAt) && clock < Date.parse(data.kickoffAt);
  const history = useResource(`/api/predictions/${match.id}/history`, { enabled:backendCurrent && supported, refresh: `${refresh}-${retry}-${data?.forecastId || ""}`, ttl: 0 });
  const evaluation = useResource(`/api/model/evaluation?competition=${competition}`, { enabled: review && backendCurrent && supported, refresh: refresh + retry, ttl: 0 });
  const percentages = valid ? displayPercentages(data.probabilities) : null;
  return <>
    <section className="panel prediction">
      <div className="panel-title"><span><Target size={18} /> Model estimate</span><span className="ai-badge">EXPERIMENTAL</span></div>
      <Versus match={match} />
      <div className="detail-note"><Info size={17} /><p>{champions ? "Champions League league-phase Poisson baseline, fitted separately from the Premier League." : "A fitted Poisson baseline using completed results."} No injury, lineup or in-play inputs. Historical testing does not guarantee future accuracy.</p></div>
      {resource.loading && <Loading label="Checking model and fixture…" />}
      {resource.error && <ErrorNotice error={resource.error} onRetry={() => setRetry((n) => n+1)} />}
      {!resource.loading && !resource.error && !valid && <div className="model-unavailable" role="status">
        <b>{!backendCurrent ? "Restart FormRadar to load the update" : !supported ? "League model not available" : data?.reason === "DATA_STALE" ? "Model data needs updating" : data?.reason === "MATCH_STARTED" ? "Pre-match estimates are closed" : data?.reason === "FIXTURE_DATA_STALE" ? "Fixture check temporarily unavailable" : "Estimate unavailable"}</b>
        <p>{!backendCurrent ? "Your running server still has the older code loaded. In the terminal running FormRadar, press Ctrl+C, run npm run dev again, then reload this page. Your saved model is preserved." : !supported ? "Evaluated experimental models currently cover the Premier League and Champions League league phase." : data?.available ? "This estimate has expired or kickoff has passed. Refresh to check availability." : data?.message || "The experimental model is not ready."}</p>
        {backendCurrent && data?.hosting!=="cloud" && ["DATA_STALE","MODEL_NOT_READY"].includes(data?.reason) && <p>Prepare today’s {champions ? "Champions League" : "Premier League"} model in the app folder with <code>{command}</code>, then use Refresh data. Run this refresh each UTC day, starting at 03:00 Uganda time.</p>}
        {backendCurrent && data?.hosting==="cloud" && ["DATA_STALE","MODEL_NOT_READY"].includes(data?.reason) && <p>The app owner needs to refresh the model on their computer and publish it to the hosted model store. Your browser cannot run training.</p>}
        {backendCurrent && data?.hosting!=="cloud" && data?.reason === "MODEL_INVALID" && <p>Restart FormRadar to load the latest code first. If validation still fails, prepare this competition again with <code>{command}</code>. No example probabilities will be substituted.</p>}
        {backendCurrent && data?.hosting==="cloud" && data?.reason==="MODEL_INVALID" && <p>The hosted model did not pass validation. The app owner needs to validate and publish a fresh model. No example probabilities are substituted.</p>}
        {data?.reason === "FIXTURE_DATA_STALE" && <p>Saved forecasts remain listed below. An updated fixture status is needed before another estimate can be returned.</p>}
        {backendCurrent && supported && !["MODEL_NOT_READY","MODEL_INVALID","DATA_STALE","MATCH_STARTED","UNSUPPORTED_STAGE"].includes(data?.reason) && <button className="quiet-button" onClick={() => setRetry(n=>n+1)}>Retry fixture check</button>}
      </div>}
      {valid && <>
        <div className="prob-heading"><b>90-minute outcome</b><span>Model estimate</span></div>
        <div className="prob-numbers">{percentages.map((p,i) => <div key={i}><strong className={["green","amber","blue"][i]}>{p}%</strong><span>{["Home win","Draw","Away win"][i]}</span></div>)}</div>
        <div className="prob-bar">{percentages.map((p,i) => <span key={i} style={{ width: p+"%", background: ["var(--chart-home)","var(--chart-draw)","var(--chart-away)"][i] }} />)}</div>
        {data.usesPooledPrior && <p className="source-note">A team without fitted history uses the {champions ? "Champions League" : "league"} prior. This policy was included in historical testing.</p>}
        <dl className="model-details">
          <dt>Results used</dt><dd>{data.trainingMatches.toLocaleString()} · {data.currentSeasonMatches} this season</dd>
          <dt>Results cutoff</dt><dd>Before {data.coverageThrough.slice(0,10)} UTC</dd>
          <dt>Data fetched</dt><dd>{date(data.dataAsOf)}</dd>
          <dt>Forecast saved</dt><dd>{date(data.generatedAt)}</dd>
          <dt>Model version</dt><dd title={data.modelVersion}>{data.modelVersion.slice(0,12)}</dd>
          <dt>Trained</dt><dd>{date(data.trainedAt)}</dd>
          <dt>Input snapshot</dt><dd title={data.snapshotVersion}>{data.snapshotVersion.slice(0,12)}</dd>
          <dt>Valid until</dt><dd>{date(data.expiresAt)} or kickoff</dd>
        </dl>
        <button className="quiet-button" aria-expanded={review} onClick={() => setReview(!review)}>{review ? "Hide" : "View"} historical evaluation</button>
      </>}
      {review && <div className="model-review">
        {evaluation.loading && <Loading label="Loading evaluation…" />}
        {evaluation.error && <ErrorNotice error={evaluation.error} onRetry={() => setRetry((n) => n+1)} />}
        {evaluation.data?.available && <>
          <b>{evaluation.data.testPoisson.matches}-match retrospective test · 2025/26{champions ? " league phase" : ""}</b>
          <p>Earlier seasons selected the settings. This test used a different fitted artifact, before the current refit.</p>
          <div className="table-scroll"><table><thead><tr><th>Candidate</th><th>Log loss ↓</th><th>Brier ↓</th></tr></thead><tbody>{[["Poisson",evaluation.data.testPoisson],["Frequency",evaluation.data.testFrequencyBaseline]].map(([name,m]) => <tr key={name}><th>{name}</th><td>{m.logLoss.toFixed(4)}</td><td>{m.brier.toFixed(4)}</td></tr>)}</tbody></table></div>
          <p>One held-out season; no walk-forward stability or uncertainty study. Retrospective corrected results are not stored pre-kickoff forecasts. Calibration was transferred to this refit.</p>
          {champions && <p>CL group/league-phase results only; knockout and domestic-league results are excluded. The competition format changed after the 2023/24 training season.</p>}
        </>}
        {evaluation.data && !evaluation.data.available && <p>{evaluation.data.message}</p>}
      </div>}
    </section>
    {valid && data.scoreline && <ScorelineHeatmap key={data.forecastId} scoreline={data.scoreline} match={match}/>}
    {valid&&!data.scoreline&&<section className="panel"><p className="source-note">Restart FormRadar and reload this page to enable the scoreline heat map. Saved forecasts are preserved.</p></section>}
    <ForecastHistory resource={history} onRetry={()=>setRetry(n=>n+1)}/>
  </>;
}

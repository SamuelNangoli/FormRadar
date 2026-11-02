import React, { useEffect, useState } from "react";
import { Target, Info } from "lucide-react";
import { useResource } from "./api.js";
import { Versus, Loading, ErrorNotice } from "./components.jsx";
import { displayPercentages } from "./probability.js";

const date = (value) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

export default function ExperimentalPrediction({ match, refresh }) {
  const [retry, setRetry] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const [review, setReview] = useState(false);
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const resource = useResource(`/api/predictions/${match.id}`, { refresh: refresh + retry, ttl: 0 });
  const data = resource.data;
  const valid = data?.available && !resource.loading && !resource.error
    && clock < Date.parse(data.expiresAt) && clock < Date.parse(data.kickoffAt);
  const history = useResource(`/api/predictions/${match.id}/history`, { refresh: `${refresh}-${retry}-${data?.forecastId || ""}`, ttl: 0 });
  const evaluation = useResource("/api/model/evaluation", { enabled: review, refresh: refresh + retry, ttl: 0 });
  const percentages = valid ? displayPercentages(data.probabilities) : null;
  const saved = history.error ? [] : history.data?.forecasts || [];
  return <>
    <section className="panel prediction">
      <div className="panel-title"><span><Target size={18} /> Model estimate</span><span className="ai-badge">EXPERIMENTAL</span></div>
      <Versus match={match} />
      <div className="detail-note"><Info size={17} /><p>A fitted Poisson baseline using completed results. No injury, lineup or in-play inputs. Historical testing does not guarantee future accuracy.</p></div>
      {resource.loading && <Loading label="Checking model and fixture…" />}
      {resource.error && <ErrorNotice error={resource.error} onRetry={() => setRetry((n) => n+1)} />}
      {!resource.loading && !resource.error && !valid && <div className="model-unavailable" role="status">
        <b>{data?.reason === "DATA_STALE" ? "Model data needs updating" : "Estimate unavailable"}</b>
        <p>{data?.available ? "This estimate has expired or kickoff has passed. Refresh to check availability." : data?.message || "The experimental model is not ready."}</p>
        {["DATA_STALE","MODEL_NOT_READY","MODEL_INVALID"].includes(data?.reason) && <p>On this computer, prepare today’s model with <code>npm run model:prepare-current</code>, then use Refresh data.</p>}
      </div>}
      {valid && <>
        <div className="prob-heading"><b>90-minute outcome</b><span>Model estimate</span></div>
        <div className="prob-numbers">{percentages.map((p,i) => <div key={i}><strong className={["green","amber","blue"][i]}>{p}%</strong><span>{["Home win","Draw","Away win"][i]}</span></div>)}</div>
        <div className="prob-bar">{percentages.map((p,i) => <span key={i} style={{ width: p+"%", background: ["#39d99a","#e9b35e","#699bf9"][i] }} />)}</div>
        {data.usesPooledPrior && <p className="source-note">A team without fitted history uses the league prior. This policy was included in historical testing.</p>}
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
          <b>380-match retrospective test · 2025/26</b>
          <p>Earlier seasons selected the settings. This test used a different fitted artifact, before the current refit.</p>
          <div className="table-scroll"><table><thead><tr><th>Candidate</th><th>Log loss ↓</th><th>Brier ↓</th></tr></thead><tbody>{[["Poisson",evaluation.data.testPoisson],["Frequency",evaluation.data.testFrequencyBaseline]].map(([name,m]) => <tr key={name}><th>{name}</th><td>{m.logLoss.toFixed(4)}</td><td>{m.brier.toFixed(4)}</td></tr>)}</tbody></table></div>
          <p>One held-out season; no walk-forward stability or uncertainty study. Retrospective corrected results are not stored pre-kickoff forecasts. Calibration was transferred to this refit.</p>
        </>}
        {evaluation.data && !evaluation.data.available && <p>{evaluation.data.message}</p>}
      </div>}
    </section>
    <section className="panel model-history">
      <div className="panel-title"><span>Saved pre-match forecasts</span><span className="subtle">{saved.length} {saved.length === 1 ? "revision" : "revisions"}</span></div>
      {history.loading && <Loading label="Loading saved forecasts…" />}
      {history.error && <ErrorNotice error={history.error} onRetry={() => setRetry((n) => n+1)} />}
      {!history.loading && !history.error && !saved.length && <p className="source-note">No forecast has been saved for this fixture yet.</p>}
      {saved.length > 0 && <div className="table-scroll"><table><caption className="sr-only">Actual saved experimental forecasts, never backfilled</caption><thead><tr><th>Saved</th><th>Home</th><th>Draw</th><th>Away</th><th>Model</th></tr></thead><tbody>{saved.map((f) => {
        const p = displayPercentages(f.probabilities);
        return <tr key={f.forecastId}><td>{date(f.generatedAt)}</td>{p.map((v,i) => <td key={i}>{v}%</td>)}<td title={f.modelVersion}>{f.modelVersion.slice(0,8)}</td></tr>;
      })}</tbody></table></div>}
      <p className="source-note">Real saved revisions only. Reopening the same fixture and model reuses its original forecast. A refreshed model or changed kickoff creates a new revision.</p>
    </section>
  </>;
}

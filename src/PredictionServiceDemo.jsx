import React, { useState } from "react";
import { Info, RefreshCw, ShieldCheck } from "lucide-react";
import { useResource } from "./api.js";
import { displayPercentages } from "./probability.js";

export default function PredictionServiceDemo() {
  const [attempt, setAttempt] = useState(0);
  const resource = useResource("/api/prediction-service/demo", {
    enabled: attempt > 0, refresh: attempt, ttl: 0,
  });
  const data = !resource.loading && !resource.error ? resource.data : null;
  const percentages = data?.isDemo ? displayPercentages(data.probabilities) : null;
  return <section className="panel prediction prediction-service-demo">
    <div className="panel-title"><span><ShieldCheck size={18}/> API connection demo</span><span className="ai-badge">DEMO</span></div>
    <div className="detail-note"><Info size={17}/><p>Test the connection to your prediction service using a fixed Arsenal vs Chelsea example. These sample values do not describe the selected match or use live team statistics.</p></div>
    <p className="source-note">The updated service also supplies 2026 fixtures through its protected football routes. Match data comes from the connected football feed; the prediction demo does not generate live scores or player events.</p>
    <button className="primary-button" disabled={resource.loading} onClick={() => setAttempt(n => n + 1)}>
      <RefreshCw size={15}/> {resource.loading ? "Checking connection…" : "Test connection"}
    </button>
    <div className="api-demo-result" aria-live="polite" aria-atomic="true">
      {resource.error && <p className="source-note" role="alert">{resource.error.message}</p>}
      {percentages && <>
        <p className="api-demo-connected"><ShieldCheck size={16}/> Connected to the demo service</p>
        <h3>Arsenal vs Chelsea</h3>
        <div className="api-demo-probabilities">
          {["Home win", "Draw", "Away win"].map((label, i) => <div key={label}><span>{label}</span><strong>{percentages[i]}%</strong></div>)}
        </div>
        <p className="source-note">Fixed demo response · Checked {new Date(data.checkedAt).toLocaleTimeString()} · Connection checks are not saved as match forecasts.</p>
      </>}
    </div>
    <p className="source-note">Your backend sends the service key. The browser receives only the demo result.</p>
  </section>;
}

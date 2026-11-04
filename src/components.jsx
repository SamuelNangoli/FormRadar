import React, { lazy, Suspense, useState } from "react";
import {
  Radar,
  AlertTriangle,
  LoaderCircle,
  RefreshCw,
  Info,
  Target,
  Zap,
  SlidersHorizontal,
  TrendingUp,
  BarChart3,
  Activity,
  ChevronRight,
  ExternalLink,
} from "lucide-react";
const DemoTrend = lazy(() => import("./DemoTrend.jsx"));
const ExperimentalPrediction = lazy(() => import("./ExperimentalPrediction.jsx"));
const PredictionServiceDemo = lazy(() => import("./PredictionServiceDemo.jsx"));
import { useResource } from "./api.js";
import { demoStats } from "./demo.js";
import { entityImage } from "../shared/media.js";
import {clockText} from '../shared/match-events.js';
import GoalScorers from './GoalScorers.jsx';
import {
  localDate,
  kickOff,
  hasScore,
  isLive,
  statusLabel,
  scoreDetail,
} from "./format.js";

export function Logo() {
  return <div className="brand"><img className="brand-light" src="/brand/horizontal-light.svg" alt="FormRadar" width="210"/><img className="brand-dark" src="/brand/horizontal-dark.svg" alt="FormRadar" width="210"/><small>FOOTBALL INTELLIGENCE</small></div>;
}
function MediaBadge({ entity, kind, size, demo = false }) {
  const [failedKey, setFailedKey] = useState(null);
  const source = demo ? null : entityImage(entity, kind);
  const identity = `${entity?.provider}:${kind}:${entity?.id}:${source}`;
  const visibleImage = source && failedKey !== identity;
  const name = entity?.name || (kind === "competition" ? "Competition" : "Club");
  const label = kind === "competition" ? "emblem" : "crest";
  return (
    <span
      className={`crest media-badge ${kind === "competition" ? "competition-emblem" : "club-crest"} ${visibleImage ? "has-image" : ""}`}
      style={{ width: size, height: size, fontSize: size * 0.27 }}
      role={visibleImage ? undefined : "img"}
      aria-label={visibleImage ? undefined : `${name} ${label} unavailable`}
    >
      {visibleImage ? (
        <img
          src={source}
          alt={`${name} ${label}`}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailedKey(identity)}
        />
      ) : <span aria-hidden="true">{entity?.code || "TBC"}</span>}
    </span>
  );
}
export function Crest({ team, size = 36 }) {
  return <MediaBadge entity={team} kind="team" size={size} />;
}
export function CompetitionEmblem({ competition, size = 22, demo = false }) {
  return <MediaBadge entity={competition} kind="competition" size={size} demo={demo} />;
}
export function Loading({ label = "Loading football data…" }) {
  return (
    <div className="loading-state" role="status">
      <LoaderCircle size={21} className="spin" />
      <span>{label}</span>
    </div>
  );
}
export function ErrorNotice({ error, onRetry }) {
  return (
    <div className="error-notice" role="alert">
      <AlertTriangle size={19} />
      <div>
        <b>Data could not be refreshed</b>
        <p>{error.message}</p>
        {error.retryAfter > 0 && (
          <small>Retry in about {error.retryAfter} seconds.</small>
        )}
      </div>
      {onRetry && (
        <button className="quiet-button" onClick={onRetry}>
          <RefreshCw size={14} /> Retry
        </button>
      )}
    </div>
  );
}
export function SourceNote({ resource, demo = false }) {
  if (demo)
    return (
      <p className="source-note demo-note">
        <Info size={13} /> Synthetic demo data — no real results or statistics.
      </p>
    );
  const meta = resource?.data?.meta;
  if (!meta) return null;
  const stale = meta.stale || Boolean(resource.error);
  return (
    <div
      className={"source-note " + (stale ? "stale-note" : "")}
      role={stale ? "status" : undefined}
    >
      <Info size={13} />
      <span>
        {stale ? "Showing older cached data. " : ""}{meta.provider||'football-data.org'} ·
        Retrieved {new Date(meta.fetchedAt).toLocaleString()} · Scores may be
        delayed.{meta.warning && ` ${meta.warning}`}
      </span>
    </div>
  );
}
export function Stat({ icon: Icon = Activity, title, value, foot }) {
  return (
    <div className="stat-card">
      <div className="stat-top">
        <span>{title}</span>
        <Icon size={18} />
      </div>
      <strong>{value}</strong>
      <small>{foot}</small>
    </div>
  );
}
export function Versus({ match }) {
  return (
    <>
      <div className="prediction-league">
        <CompetitionEmblem competition={match.competition} size={22} />
        {match.competition?.name} <span>•</span> {localDate(match.utcDate)}
      </div>
      <div className="versus">
        <div>
          <Crest team={match.homeTeam} size={56} />
          <b>{match.homeTeam.name}</b>
          <small>HOME</small>
        </div>
        <div className="versus-mid">
          <span>
            {hasScore(match)
              ? `${match.score.home} – ${match.score.away}`
              : "VS"}
          </span>
          <small>
            {match.status === "TIMED"
              ? kickOff(match.utcDate)
              : isLive(match) ? clockText(match) : statusLabel(match.status)}
          </small>
          {scoreDetail(match) && <small>{scoreDetail(match)}</small>}
        </div>
        <div>
          <Crest team={match.awayTeam} size={56} />
          <b>{match.awayTeam.name}</b>
          <small>AWAY</small>
        </div>
      </div>
      <GoalScorers match={match}/>
    </>
  );
}
export function MatchList({ matches, selectedId, onSelect, hrefForMatch }) {
  return matches.map((match) => {
    const href=hrefForMatch?.(match),Row=href?'a':'button';
    return <Row
      {...(href?{href,target:'_blank',rel:'noopener noreferrer','aria-label':`${match.homeTeam.name} vs ${match.awayTeam.name}, ${hasScore(match)?`${match.score.home}–${match.score.away}, `:''}${statusLabel(match.status)}. Open match information in a new tab.`,'aria-current':selectedId===match.id?'true':undefined}:{type:'button','aria-pressed':selectedId===match.id})}
      className={"match-row " + (selectedId === match.id ? "chosen" : "")}
      key={match.id}
      data-match-id={match.id}
      onClick={() => onSelect(match.id)}
    >
      <div className="match-top">
        <span className="competition-label">
          <CompetitionEmblem competition={match.competition} size={18} />
          {match.competition?.name}
        </span>
        <span className={isLive(match) ? "live-label" : ""}>
          {isLive(match)
            ? `● ${clockText(match)}`
            : localDate(match.utcDate)}
        </span>
      </div>
      <div className="match-main">
        <div className="match-teams">
          <div>
            <Crest team={match.homeTeam} size={27} />
            <b>{match.homeTeam.name}</b>
          </div>
          <div>
            <Crest team={match.awayTeam} size={27} />
            <b>{match.awayTeam.name}</b>
          </div>
        </div>
        <div className="match-time">
          {hasScore(match)
            ? `${match.score.home} – ${match.score.away}`
            : match.status === "TIMED"
              ? kickOff(match.utcDate)
              : "—"}
          <small>{isLive(match)?clockText(match):statusLabel(match.status)}</small>
          {scoreDetail(match) && <small>{scoreDetail(match)}</small>}
        </div>
        {href?<ExternalLink className="match-chevron" size={18}/>:<ChevronRight className="match-chevron" size={18} />}
      </div>
      <GoalScorers match={match} compact/>
    </Row>;
  });
}

export function TeamStats({ team, demo, refresh = 0 }) {
  const [retry, setRetry] = useState(0);
  const resource = useResource(`/api/teams/${team.id}/stats`, {
    enabled: !demo && Boolean(team.id),
    refresh: refresh + retry,
    ttl: 900_000,
  });
  const stats = demo ? demoStats(team.id) : resource.data?.data;
  return (
    <div className="team-stats">
      <div className="team-stat-title">
        <Crest team={team} size={30} />
        <h3>{team.name}</h3>
      </div>
      {resource.error && (
        <ErrorNotice
          error={resource.error}
          onRetry={() => setRetry((r) => r + 1)}
        />
      )}
      {resource.loading && (
        <Loading label={`Loading ${team.name} statistics…`} />
      )}
      {!team.id && (
        <p className="empty-copy">Team details are not yet confirmed.</p>
      )}
      {stats && (
        <>
          <p className="scope-label">
            {demo ? "Demo sample" : "Latest 90 days · available competitions"}
            <br />
            {stats.period.from} to {stats.period.to} (UTC)
          </p>
          <div className="team-stat-grid">
            {[
              ["Played", stats.played],
              [
                "Won / Drawn / Lost",
                `${stats.won} / ${stats.drawn} / ${stats.lost}`,
              ],
              ["Goals scored", stats.played ? stats.goalsFor : "—"],
              ["Goals conceded", stats.played ? stats.goalsAgainst : "—"],
              ["Goals / match", stats.goalsPerMatch ?? "—"],
              ["Clean sheets", stats.played ? stats.cleanSheets : "—"],
            ].map(([label, value]) => (
              <div key={label}>
                <small>{label}</small>
                <b>{value}</b>
              </div>
            ))}
          </div>
          <div className="form-row">
            <div>
              <span>Last five · oldest to newest</span>
              <div className="form-badges">
                {stats.form.length ? (
                  stats.form.map((value, i) => (
                    <i
                      className={value}
                      key={i}
                      title={{ W: "Win", D: "Draw", L: "Loss" }[value]}
                    >
                      {value}
                    </i>
                  ))
                ) : (
                  <span>No completed results available.</span>
                )}
              </div>
            </div>
          </div>
          {stats.excluded > 0 && (
            <p className="scope-label">
              {stats.excluded} result(s) excluded because the score is
              unavailable.
            </p>
          )}
          {!demo && (
            <p className="scope-label">
              Calculated from {stats.played} completed matches with reported
              final scores. Includes extra time; shootout goals excluded. W/D/L
              uses goals before penalties. xG and injuries are not supplied.
            </p>
          )}
        </>
      )}
      <SourceNote resource={resource} demo={demo} />
    </div>
  );
}

export function TeamComparison({ match, demo, refresh }) {
  return (
    <section className="panel comparison">
      <div className="panel-title">
        <span>
          <BarChart3 size={18} /> Team performance
        </span>
        <span className="subtle">
          {demo ? "DEMO STATS" : "Results-derived"}
        </span>
      </div>
      <div className="team-comparison-grid">
        <TeamStats
          key={`${demo}-${match.homeTeam.id}`}
          team={match.homeTeam}
          demo={demo}
          refresh={refresh}
        />
        <TeamStats
          key={`${demo}-${match.awayTeam.id}`}
          team={match.awayTeam}
          demo={demo}
          refresh={refresh}
        />
      </div>
    </section>
  );
}

export function Prediction({ match, demo, refresh, backendCurrent, apiDemoEnabled = false }) {
  const [view, setView] = useState("model");
  return <>
    {(!demo || apiDemoEnabled) && <div className="fixture-tabs prediction-modes" aria-label="Prediction mode">
      {!demo && <button className={view === "model" ? "active" : ""} aria-pressed={view === "model"} onClick={() => setView("model")}>Experimental model</button>}
      <button className={view === "demo" || demo && view !== "service" ? "active" : ""} aria-pressed={view === "demo" || demo && view !== "service"} onClick={() => setView("demo")}>Demo examples</button>
      {apiDemoEnabled && <button className={view === "service" ? "active" : ""} aria-pressed={view === "service"} onClick={() => setView("service")}>API demo</button>}
    </div>}
    {view === "service" && apiDemoEnabled ? <Suspense fallback={<Loading label="Loading connection demo…"/>}><PredictionServiceDemo/></Suspense> : demo || view === "demo" ? <DemoPrediction match={match} /> : <Suspense fallback={<Loading label="Loading model view…" />}><ExperimentalPrediction match={match} refresh={refresh} backendCurrent={backendCurrent} /></Suspense>}
  </>;
}

function DemoPrediction({ match }) {
  const [scenario, setScenario] = useState("baseline");
  const [period, setPeriod] = useState("7D");
  const probabilities =
    scenario === "injury"
      ? [34, 31, 35]
      : scenario === "rest"
        ? [52, 24, 24]
        : [45, 27, 28];
  return (
    <>
      <section className="panel prediction">
        <div className="panel-title">
          <span>
            <Target size={18} /> Prediction sandbox
          </span>
          <span className="ai-badge">
            <Zap size={12} /> DEMO ONLY
          </span>
        </div>
        <Versus match={match} />
        <div className="demo-disclosure">
          <AlertTriangle size={17} />
          <span>
            These fixed example probabilities are
            unrelated to the teams, scores or statistics shown.
          </span>
        </div>
        <div className="prob-heading">
          <b>Example probabilities</b>
          <span>Illustrative only</span>
        </div>
        <div className="prob-numbers">
          {probabilities.map((p, i) => (
            <div key={i}>
              <strong className={["green", "amber", "blue"][i]}>{p}%</strong>
              <span>{["Home win", "Draw", "Away win"][i]}</span>
            </div>
          ))}
        </div>
        <div className="prob-bar">
          {probabilities.map((p, i) => (
            <span
              key={i}
              style={{
                width: p + "%",
                background: ["var(--chart-home)", "var(--chart-draw)", "var(--chart-away)"][i],
              }}
            />
          ))}
        </div>
        <div className="scenario">
          <div className="scenario-title">
            <SlidersHorizontal size={16} /> Hypothetical controls
          </div>
          <div className="scenario-buttons">
            {[
              ["baseline", "Baseline"],
              ["injury", "Key injuries"],
              ["rest", "Extra rest"],
            ].map(([id, name]) => (
              <button
                key={id}
                className={scenario === id ? "active" : ""}
                aria-pressed={scenario === id}
                onClick={() => setScenario(id)}
              >
                {name}
              </button>
            ))}
          </div>
          <p>
            Synthetic adjustments for exploring the interface. No injury or
            recovery feed is connected.
          </p>
        </div>
        <p className="source-note">
          Demo forecast · not a recommendation or betting advice.
        </p>
      </section>
      <section className="panel trends">
        <div className="panel-title">
          <span>
            <TrendingUp size={17} /> Synthetic probability trend
          </span>
          <div className="periods">
            {["24H", "7D", "30D"].map((p) => (
              <button
                key={p}
                className={period === p ? "active" : ""}
                aria-pressed={period === p}
                onClick={() => setPeriod(p)}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <div
          className="chart-wrap"
          role="img"
          aria-label="Synthetic demo probability curve, not historical forecasts"
        >
          <Suspense fallback={<Loading label="Loading demo chart…" />}>
            <DemoTrend probabilities={probabilities} period={period} />
          </Suspense>
        </div>
        <p className="chart-caption">
          Illustration only — no stored historical predictions.
        </p>
      </section>
    </>
  );
}

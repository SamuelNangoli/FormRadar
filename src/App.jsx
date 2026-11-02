import React, { useEffect, useState } from "react";
import {
  House,
  Radio,
  Trophy,
  Newspaper,
  Search,
  ChevronRight,
  ArrowUpRight,
  ArrowRight,
  Activity,
  ShieldCheck,
  CalendarDays,
  BarChart3,
  Target,
  Menu,
  X,
  Zap,
  RefreshCw,
  KeyRound,
  ExternalLink,
  Info,
} from "lucide-react";
import { competitions } from "../shared/competitions.js";
import { useResource } from "./api.js";
import { demoMatches, demoStandings } from "./demo.js";
import NewsRadar from "./NewsRadar.jsx";
import MatchInsights from "./MatchInsights.jsx";
import ThemeControl from "./ThemeControl.jsx";
import SeasonSelect from "./SeasonSelect.jsx";
import { isoDay, isLive, dayLabel } from "./format.js";
import {
  Logo,
  Crest,
  CompetitionEmblem,
  Loading,
  ErrorNotice,
  SourceNote,
  Stat,
  MatchList,
  Versus,
  TeamComparison,
  TeamStats,
  Prediction,
} from "./components.jsx";

const nav = [
  ["Overview", House],
  ["Live Scores", Radio],
  ["Predictions", Target],
  ["Leagues", Trophy],
  ["News Radar", Newspaper],
];
const headings = {
  Overview: [
    "Your football, decoded.",
    "Real match data, team form and a clear view of the game.",
  ],
  "Live Scores": [
    "Match centre",
    "Fixtures and results from football-data.org. Scores may be delayed by your plan.",
  ],
  Predictions: [
    "Match probabilities",
    "Experimental pre-match estimates, with saved forecasts and a separate demo view.",
  ],
  Leagues: [
    "The league picture",
    "Current standings and results across your favourite competitions.",
  ],
  "News Radar": [
    "News radar",
    "Source-linked football reporting, team context and publication times.",
  ],
};

function Setup({ onDemo, onRetry, hosted=false }) {
  if(hosted)return <section className="panel setup-panel"><div className="setup-icon"><KeyRound size={28}/></div><h2>Football feed setup needed</h2><p>The football feed has not been connected for this hosted app yet. The app owner needs to finish setup.</p><div className="setup-actions"><button className="primary-button" onClick={onRetry}><RefreshCw size={15}/> Check connection</button><button className="quiet-button" onClick={onDemo}>Open demo preview <ArrowRight size={15}/></button></div></section>;
  return (
    <section className="panel setup-panel">
      <div className="setup-icon">
        <KeyRound size={28} />
      </div>
      <div className="eyebrow">CONNECT YOUR FOOTBALL FEED</div>
      <h2>One token. Real match data.</h2>
      <p>
        FormRadar is ready to connect to football-data.org. Add your own API
        token on this computer to load fixtures, results, standings and team
        performance.
      </p>
      <ol>
        <li>
          <a
            href="https://www.football-data.org/client/register"
            target="_blank"
            rel="noreferrer"
          >
            Create a football-data.org account <ExternalLink size={13} />
          </a>{" "}
          and copy your token.
        </li>
        <li>
          Use your existing <code>FormRadar/.env</code>, or copy{" "}
          <code>.env.example</code> to <code>.env</code> in the app folder.
        </li>
        <li>
          Set <code>FOOTBALL_DATA_API_KEY</code> in <code>.env</code>, then
          restart the app.
        </li>
      </ol>
      <p className="setup-note">
        The token stays on your server. The free plan provides delayed scores.
        Experimental estimates need a prepared current-season model.
      </p>
      <div className="setup-actions">
        <button className="primary-button" onClick={onRetry}>
          <RefreshCw size={15} /> Check connection
        </button>
        <button className="quiet-button" onClick={onDemo}>
          Open demo preview <ArrowRight size={15} />
        </button>
      </div>
    </section>
  );
}

function Standings({ league, season:selectedSeason, demo, refresh }) {
  const [retry, setRetry] = useState(0);
  const [team, setTeam] = useState(null);
  const resource = useResource(`/api/standings?competition=${league}${selectedSeason?`&season=${selectedSeason}`:""}`, {
    enabled: !demo,
    refresh: refresh + retry,
    ttl: 900_000,
  });
  const data = demo
    ? { standings: demoStandings(league) }
    : resource.data?.data;
  const season = data?.season;
  return (
    <>
      <section className="panel standings">
        <div className="panel-title">
          <span>
            <CompetitionEmblem competition={data?.competitionInfo || competitions.find((c) => c.code === league)} size={24} demo={demo} />{" "}
            {competitions.find((c) => c.code === league)?.name} standings
          </span>
          <span className="subtle">
            {demo
              ? "DEMO TABLE"
              : season?.startDate
                ? `${season.startDate.slice(0, 4)} / ${season.endDate?.slice(0, 4) || "TBC"}`
                : "Current season"}
          </span>
        </div>
        {resource.error && (
          <ErrorNotice
            error={resource.error}
            onRetry={() => setRetry((r) => r + 1)}
          />
        )}
        {resource.loading && <Loading label="Loading league standings…" />}
        {selectedSeason&&<p className="source-note">Historical table compiled by the provider; past points deductions may not be retained. Team statistics below describe the latest 90 days.</p>}
        {data?.standings?.map((group, i) => (
          <div key={i}>
            <div className="table-group-label">
              {group.group?.replaceAll("_", " ") ||
                group.stage?.replaceAll("_", " ")}{" "}
              · Select a team for statistics
            </div>
            <div className="table-scroll">
              <table>
                <caption className="sr-only">
                  {demo ? "Synthetic demo" : selectedSeason?"Historical":"Current"} standings. Select a team
                  name to see its statistics.
                </caption>
                <thead>
                  <tr>
                    {[
                      "#",
                      "Team",
                      "P",
                      "W",
                      "D",
                      "L",
                      "GF",
                      "GA",
                      "GD",
                      "Pts",
                    ].map((c) => (
                      <th key={c} scope="col">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.table.map((row) => (
                    <tr key={row.team.id}>
                      <td>{row.position}</td>
                      <th scope="row">
                        <button
                          className="team-table-button"
                          onClick={() => setTeam(row.team)}
                        >
                          <Crest team={row.team} size={24} />
                          {row.team.name}
                        </button>
                      </th>
                      {[
                        row.played,
                        row.won,
                        row.drawn,
                        row.lost,
                        row.goalsFor,
                        row.goalsAgainst,
                        row.goalDifference,
                        row.points,
                      ].map((value, j) => (
                        <td key={j} className={j === 7 ? "points" : ""}>
                          {value ?? "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
        {data && !data.standings?.length && (
          <div className="no-results">
            No league table is available for this competition or stage yet.
          </div>
        )}
        <SourceNote resource={resource} demo={demo} />
      </section>
      {team && (
        <section className="panel selected-team">
          <div className="panel-title">
            <span>
              <BarChart3 size={18} /> Team statistics
            </span>
            <button
              aria-label="Close team statistics"
              className="icon-btn"
              onClick={() => setTeam(null)}
            >
              <X size={17} />
            </button>
          </div>
          <TeamStats
            key={`${team.id}-${demo}`}
            team={team}
            demo={demo}
            refresh={refresh}
          />
        </section>
      )}
    </>
  );
}

export default function App() {
  const [page, setPage] = useState("Overview");
  const [mobile, setMobile] = useState(
    () => window.matchMedia("(max-width:850px)").matches,
  );
  const [league, setLeague] = useState("PL");
  const [season,setSeason]=useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState("api");
  const [from, setFrom] = useState(isoDay(-3));
  const [to, setTo] = useState(isoDay(7));
  const [filter, setFilter] = useState("all");
  const [refresh, setRefresh] = useState(0);
  const [poll, setPoll] = useState(0);
  const config = useResource("/api/config", { refresh, ttl: 5000 });
  const demo = mode === "demo";
  const ready = demo || Boolean(config.data?.configured);
  const seasons=useResource(`/api/seasons?competition=${league}`,{enabled:ready&&!demo&&page!=="News Radar",refresh,ttl:900_000});
  const selectedSeason=seasons.data?.data?.seasons?.find(s=>String(s.year)===season);
  const seasonLabel=selectedSeason?.label||season;
  const schedulePage = ["Overview", "Live Scores", "Predictions"].includes(
    page,
  );
  const invalidDates =
    !season && (!from ||
    !to ||
    from > to ||
    (Date.parse(to) - Date.parse(from)) / 86_400_000 > 30);
  const query = new URLSearchParams({
    competition: league,
    ...(season?{season}:{dateFrom:from,dateTo:to}),
  });
  const matchEndpoint =
    filter === "upcoming" ? "fixtures" : filter === "results" ? "results" : "matches";
  const fixtures = useResource(`/api/${matchEndpoint}?${query}`, {
    enabled: ready && !demo && schedulePage && !invalidDates,
    refresh: refresh + poll,
    ttl: filter === "results" ? 300_000 : 60_000,
  });
  const allMatches = demo
    ? demoMatches(league).filter(
        (m) => m.utcDate.slice(0, 10) >= from && m.utcDate.slice(0, 10) <= to,
      )
    : (fixtures.data?.data?.matches || []).filter(
        (m) => season || m.utcDate.slice(0,10) >= from && m.utcDate.slice(0,10) <= to,
      );
  const matches = allMatches.filter((m) => {
    const matchesSearch =
      `${m.homeTeam.name} ${m.awayTeam.name} ${m.competition?.name}`
        .toLowerCase()
        .includes(search.toLowerCase());
    const matchesFilter =
      filter === "all" ||
      (filter === "live" && isLive(m)) ||
      (filter === "results" && m.status === "FINISHED") ||
      (filter === "upcoming" && ["SCHEDULED", "TIMED"].includes(m.status));
    return matchesSearch && matchesFilter;
  }).sort((a, b) =>
    filter === "results"
      ? b.utcDate.localeCompare(a.utcDate)
      : a.utcDate.localeCompare(b.utcDate),
  );
  const selected = matches.find((m) => m.id === selectedId) || matches[0];
  const awaitingMatches = !demo && !fixtures.data;
  const unavailableCount = fixtures.loading ? "…" : "—";
  const matchCount = awaitingMatches ? unavailableCount : allMatches.length;
  const filteredFeed = filter === "results" || filter === "upcoming";
  const feedLabel = filter === "results" ? "Results" : "Upcoming";
  const currentLeague = competitions.find((c) => c.code === league);
  const go = (value) => {
    setPage(value);
    setMenu(false);
    window.scrollTo(0, 0);
  };
  const switchLeague = (code) => {
    setLeague(code);
    setSeason("");
    setSelectedId(null);
  };
  const switchMode = (value) => {
    setMode(value);
    setSeason("");
    setSelectedId(null);
  };
  const switchFilter = (value) => {
    setFilter(value);
    setSelectedId(null);
    if (season) return;
    if (value === "results") {
      setFrom(isoDay(-6));
      setTo(isoDay());
    } else if (value === "upcoming") {
      setFrom(isoDay());
      setTo(isoDay(6));
    }
  };

  useEffect(() => {
    const media = window.matchMedia("(max-width:850px)");
    const update = () => {
      setMobile(media.matches);
      if (!media.matches) setMenu(false);
    };
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!ready || demo || !schedulePage || season) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") setPoll((n) => n + 1);
    }, 60_000);
    return () => clearInterval(timer);
  }, [ready, demo, schedulePage,season]);
  useEffect(() => {
    if (!menu) return;
    document.getElementById("sidebar-close")?.focus();
    const close = (event) => {
      if (event.key === "Escape") setMenu(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [menu]);

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside
        id="main-sidebar"
        inert={mobile && !menu}
        aria-label="Navigation"
        className={"sidebar " + (menu ? "open" : "")}
      >
        <button
          id="sidebar-close"
          className="sidebar-close icon-btn"
          aria-label="Close navigation"
          onClick={() => setMenu(false)}
        >
          <X size={20} />
        </button>
        <Logo />
        <div className="side-caption">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {nav.map(([name, Icon]) => (
            <button
              key={name}
              className={"nav-link " + (page === name ? "active" : "")}
              aria-current={page === name ? "page" : undefined}
              onClick={() => go(name)}
            >
              <Icon size={19} />
              <span>{name}</span>
              {name === "Live Scores" && <span className="live-dot" />}
            </button>
          ))}
        </nav>
        <div className="side-caption second">COMPETITIONS · {competitions.length}</div>
        <div className="league-side">
          {competitions.map((c) => (
            <button
              key={c.code}
              onClick={() => {
                switchLeague(c.code);
                go("Live Scores");
              }}
            >
              <CompetitionEmblem competition={c} size={26} demo={demo} />
              {c.name}
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="side-promo">
            <div className="promo-icon">
              <Zap size={17} />
            </div>
            <b>See what shapes a match</b>
            <p>Explore results, team form and experimental match estimates.</p>
            <button onClick={() => go("Predictions")}>
              Explore predictions <ArrowRight size={14} />
            </button>
          </div>
          <div className="demo-label">
            <span className="demo-pulse" />
            {demo
              ? "DEMO PREVIEW"
              : config.data?.configured
                ? "API TOKEN CONFIGURED"
                : "API SETUP NEEDED"}
          </div>
        </div>
      </aside>
      <div className="main-wrap" inert={mobile && menu}>
        <header className="topbar">
          <div className="top-left">
            <button
              className="mobile-menu icon-btn"
              aria-label={menu ? "Close navigation" : "Open navigation"}
              aria-expanded={menu}
              aria-controls="main-sidebar"
              onClick={() => setMenu(!menu)}
            >
              {menu ? <X size={21} /> : <Menu size={21} />}
            </button>
            <img className="mobile-brand brand-light" src="/brand/mark-light.svg" alt="FormRadar" width="28" height="28"/>
            <img className="mobile-brand brand-dark" src="/brand/mark-dark.svg" alt="FormRadar" width="28" height="28"/>
            <span className="breadcrumb">
              <span className="workspace-label">Workspace</span> <ChevronRight size={14} /> <b>{page}</b>
            </span>
          </div>
          <div className="top-right">
            <ThemeControl/>
            <button
              className="quiet-button refresh-button"
              disabled={config.loading || fixtures.loading}
              onClick={() => setRefresh((n) => n + 1)}
            >
              <RefreshCw size={15} className={fixtures.loading ? "spin" : ""} />
              <span>Refresh data</span>
            </button>
            <div className="avatar" aria-hidden="true">
              <img className="brand-mark-light" src="/brand/mark-light.svg" alt=""/><img className="brand-mark-dark" src="/brand/mark-dark.svg" alt=""/>
            </div>
          </div>
        </header>
        <main className="content" id="main-content">
          <div className="page-head">
            <div>
              <div className="eyebrow">
                <span /> THE FOOTBALL EDGE
              </div>
              <h1>{headings[page][0]}</h1>
              <p>{headings[page][1]}</p>
            </div>
          </div>
          {demo && (
            <div className="mode-banner" role="status">
              <Info size={19} />
              <span>
                <b>Demo preview.</b> Every fixture, score and statistic in this
                mode is synthetic.
              </span>
              <button
                className="quiet-button"
                onClick={() => switchMode("api")}
              >
                Exit demo
              </button>
            </div>
          )}
          {config.error && !demo && (
            <ErrorNotice
              error={config.error}
              onRetry={() => setRefresh((n) => n + 1)}
            />
          )}
          {!demo && config.data && config.data.predictionsApiVersion !== 2 && <div className="mode-banner" role="status">
            <Info size={19} /><span><b>An app update is ready.</b> Restart FormRadar in its terminal with Ctrl+C, then <code>npm run dev</code>, and reload this page. The running server is still using an older version.</span>
          </div>}
          {config.loading && !config.data && !demo && (
            <Loading label="Checking football connection…" />
          )}
          {!ready && !config.loading && page !== "News Radar" && (
            <Setup
              hosted={config.data?.hosting==="vercel"}
              onDemo={() => switchMode("demo")}
              onRetry={() => setRefresh((n) => n + 1)}
            />
          )}
          {page === "News Radar" ? (
            <NewsRadar league={league} onLeagueChange={switchLeague} refresh={refresh} config={config.data} demo={demo}/>
          ) : (
            ready && (
              <>
                {page === "Overview" && (
                  <>
                    <section className="hero">
                      <div className="hero-copy">
                        <div className="hero-tag">
                          <span className="pulse" /> FORM, CONTEXT, CLARITY
                        </div>
                        <h2>
                          See the form.
                          <br />
                          <em>Read the game.</em>
                        </h2>
                        <p>
                          Follow the fixtures. Compare recent results. Find the
                          details that bring a match into focus.
                        </p>
                        <button onClick={() => go("Leagues")}>
                          Explore league tables <ArrowUpRight size={17} />
                        </button>
                      </div>
                      <div className="hero-visual" aria-hidden="true">
                        <div className="radar-ring r1" />
                        <div className="radar-ring r2" />
                        <div className="radar-ring r3" />
                        <img className="brand-light hero-brand" src="/brand/mark-light.svg" alt="" width="180" height="180"/>
                        <img className="brand-dark hero-brand" src="/brand/mark-dark.svg" alt="" width="180" height="180"/>
                        <div className="floating-stat">
                          <Activity size={15} />{" "}
                          {demo ? "SYNTHETIC PREVIEW" : "FOOTBALL FEED READY"}
                        </div>
                      </div>
                    </section>
                    <div className="stat-grid">
                      <Stat
                        title={
                          filter === "results" ? "Completed results"
                            : filter === "upcoming" ? "Upcoming fixtures"
                              : "Matches in this window"
                        }
                        value={matchCount}
                        foot={currentLeague.name}
                      />
                      <Stat
                        icon={Radio}
                        title={filteredFeed ? "Feed view" : "In-play fixtures"}
                        value={filteredFeed ? feedLabel : awaitingMatches
                          ? unavailableCount : allMatches.filter(isLive).length}
                        foot={
                          demo
                            ? "Synthetic schedule"
                            : "Provider scores may be delayed"
                        }
                      />
                      <Stat
                        icon={ShieldCheck}
                        title="Data source"
                        value={demo ? "Demo" : "API"}
                        foot={
                          demo ? "Synthetic examples only" : "football-data.org"
                        }
                      />
                      <Stat
                        icon={Target}
                        title="Prediction stage"
                        value={demo ? "Demo" : "Experimental"}
                        foot={demo ? "Synthetic examples" : "PL + Champions League phase models"}
                      />
                    </div>
                  </>
                )}
                {page === "Leagues" ? (
                  <>
                    <SeasonSelect resource={seasons} value={season} demo={demo} onChange={value=>{setSeason(value);setSelectedId(null);}}/>
                    <div className="league-grid">
                      {competitions.map((c) => (
                        <button
                          key={c.code}
                          aria-pressed={league === c.code}
                          className={
                            "league-tile panel " +
                            (league === c.code ? "active" : "")
                          }
                          onClick={() => switchLeague(c.code)}
                        >
                          <CompetitionEmblem competition={c} size={48} demo={demo} />
                          <h3>{c.name}</h3>
                          <p>{c.area} · {season&&league===c.code?seasonLabel:"current season"}</p>
                          <span>
                            View standings <ArrowRight size={16} />
                          </span>
                        </button>
                      ))}
                    </div>
                    <Standings
                      key={`${league}-${season}-${demo}`}
                      league={league}
                      season={season}
                      demo={demo}
                      refresh={refresh}
                    />
                  </>
                ) : (
                  <>
                    <div className="section-row">
                      <div>
                        <h2>
                          {page === "Predictions"
                            ? "Choose a match to explore"
                            : "Fixtures & results"}
                        </h2>
                        <p>
                          {demo
                            ? "Synthetic examples for exploring FormRadar"
                            : "Schedule dates use UTC. Kickoffs display in your local time."}
                        </p>
                      </div>
                      <label className="filters">
                        <CompetitionEmblem competition={currentLeague} size={22} demo={demo} />
                        <select
                          aria-label="Competition"
                          value={league}
                          onChange={(e) => switchLeague(e.target.value)}
                        >
                          {competitions.map((c) => (
                            <option value={c.code} key={c.code}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <SeasonSelect resource={seasons} value={season} demo={demo} onChange={value=>{setSeason(value);setFilter(value?"results":"all");setSelectedId(null);}}/>
                    {season&&<div className="season-notice">Viewing the {seasonLabel} season. Historical fixtures and results use your account's available coverage. Current team statistics remain a separate last-90-days summary.</div>}
                    {season&&<label className="fixture-search season-search"><Search size={16}/><input aria-label="Search teams" placeholder="Search teams in this season…" value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button className="icon-btn" aria-label="Clear search" onClick={()=>setSearch("")}><X size={14}/></button>}</label>}
                    {!season&&
                    <div className="fixture-controls">
                      <div className="date-controls">
                        <label>
                          From{" "}
                          <input
                            aria-label="From date"
                            type="date"
                            value={from}
                            onChange={(e) => setFrom(e.target.value)}
                          />
                        </label>
                        <label>
                          To{" "}
                          <input
                            aria-label="To date"
                            type="date"
                            value={to}
                            onChange={(e) => setTo(e.target.value)}
                          />
                        </label>
                      </div>
                      <div className="date-presets">
                        <button
                          onClick={() => {
                            setFrom(isoDay(1));
                            setTo(isoDay(1));
                            setFilter("upcoming");
                            setSelectedId(null);
                          }}
                        >
                          Tomorrow
                        </button>
                        <button
                          onClick={() => {
                            setFrom(isoDay());
                            setTo(isoDay());
                          }}
                        >
                          Today
                        </button>
                        <button
                          onClick={() => {
                            setFrom(isoDay());
                            setTo(isoDay(6));
                          }}
                        >
                          Next 7 days
                        </button>
                        <button
                          onClick={() => {
                            setFrom(isoDay(-6));
                            setTo(isoDay());
                          }}
                        >
                          Last 7 days
                        </button>
                      </div>
                      <label className="fixture-search">
                        <Search size={16} />
                        <input
                          aria-label="Search teams"
                          placeholder="Search teams…"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                        />
                        {search && (
                          <button
                            className="icon-btn"
                            aria-label="Clear search"
                            onClick={() => setSearch("")}
                          >
                            <X size={14} />
                          </button>
                        )}
                      </label>
                    </div>}
                    {invalidDates ? (
                      <div className="error-notice" role="alert">
                        Choose valid dates in order, covering at most 31 days.
                      </div>
                    ) : (
                      <>
                        <div
                          className="fixture-tabs"
                          aria-label="Fixture status filters"
                        >
                          {[
                            ["all", "All matches"],
                            ["live", "In play"],
                            ["upcoming", "Upcoming"],
                            ["results", "Results"],
                          ].map(([value, label]) => (
                            <button
                              key={value}
                              className={filter === value ? "active" : ""}
                              aria-pressed={filter === value}
                              onClick={() => switchFilter(value)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <div className="dashboard-grid">
                          <div className="left-column">
                            <section className={`panel match-list${season?" season-list":""}`}>
                              <div className="panel-title">
                                <span>
                                  <CalendarDays size={17} /> {season?`${seasonLabel} season`:`${dayLabel(from)} – ${dayLabel(to)}`}
                                </span>
                                <span className="subtle">
                                  {awaitingMatches ? "Awaiting data"
                                    : `${matches.length} ${matches.length === 1 ? "match" : "matches"}`}
                                </span>
                              </div>
                              {fixtures.error && (
                                <ErrorNotice
                                  error={fixtures.error}
                                  onRetry={() => setRefresh((n) => n + 1)}
                                />
                              )}
                              {fixtures.loading && (
                                <Loading label="Loading fixtures and results…" />
                              )}
                              {matches.length ? (
                                <MatchList
                                  matches={matches}
                                  selectedId={selected?.id}
                                  onSelect={setSelectedId}
                                />
                              ) : (
                                !fixtures.loading &&
                                !fixtures.error && (
                                  <div className="no-results">
                                    No fixtures match these filters. Try another
                                    date, competition or search.
                                  </div>
                                )
                              )}
                              <SourceNote resource={fixtures} demo={demo} />
                            </section>
                            <div className="panel mini-news">
                              <div className="panel-title">
                                <span>
                                  <Newspaper size={17} /> News radar
                                </span>
                                <button
                                  className="text-action"
                                  onClick={() => go("News Radar")}
                                >
                                  View all <ArrowRight size={14} />
                                </button>
                              </div>
                              <div className="news-placeholder">
                                <div className="news-placeholder-icon">
                                  <ShieldCheck size={22} />
                                </div>
                                <div>
                                  <b>Football reporting with its source</b>
                                  <p>
                                    Read Guardian headlines and team context in
                                    News Radar. Reporting does not yet change model estimates.
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="right-column">
                            {selected ? (
                              page === "Predictions" ? (
                                <Prediction
                                  key={selected.id}
                                  match={selected}
                                  demo={demo}
                                  refresh={refresh + poll}
                                  backendCurrent={config.data?.predictionsApiVersion === 2}
                                />
                              ) : (
                                <section className="panel match-detail">
                                  <div className="panel-title">
                                    <span>
                                      <Activity size={18} /> Match intelligence
                                    </span>
                                    <span className="ai-badge">
                                      {demo ? "DEMO FIXTURE" : "PROVIDER DATA"}
                                    </span>
                                  </div>
                                  <Versus match={selected} />
                                  <div className="detail-note">
                                    <Info size={15} />
                                    <p>
                                      {demo
                                        ? "This matchup and score are synthetic."
                                        : "Fixtures and scores are supplied by football-data.org. Availability and delays depend on your plan."}
                                    </p>
                                  </div>
                                  <button
                                    className="full-analysis"
                                    onClick={() => go("Predictions")}
                                  >
                                    Explore match probabilities{" "}
                                    <ArrowRight size={17} />
                                  </button>
                                </section>
                              )
                            ) : (
                              <div className="panel empty-selection">
                                <Target size={30} />
                                <h3>Select a fixture</h3>
                                <p>
                                  Match details and team statistics will appear
                                  here.
                                </p>
                              </div>
                            )}
                            {selected&&<MatchInsights key={`${selected.id}-${demo}`} match={selected} demo={demo} refresh={refresh} backendCurrent={config.data?.matchInsightsVersion===1}/>}
                          </div>
                        </div>
                        {selected && (
                          <TeamComparison
                            key={`${selected.id}-${demo}`}
                            match={selected}
                            demo={demo}
                            refresh={refresh}
                          />
                        )}
                      </>
                    )}
                  </>
                )}
              </>
            )
          )}
          <footer>
            FormRadar v0.2 <span>•</span>{" "}
            {demo ? (
              "Synthetic demo data"
            ) : (
              <a
                href="https://www.football-data.org"
                target="_blank"
                rel="noreferrer"
              >
                Football data provided by football-data.org
              </a>
            )}{" "}
            <span>•</span> {demo ? "Synthetic predictions" : "Experimental predictions · availability varies"}{" "}
            <span>•</span> Not betting advice
          </footer>
        </main>
      </div>
      {menu && <div className="overlay" onClick={() => setMenu(false)} />}
      <nav
        className="mobile-nav"
        inert={mobile && menu}
        aria-label="Mobile navigation"
      >
        {nav.slice(0, 4).map(([name, Icon]) => (
          <button
            key={name}
            aria-current={page === name ? "page" : undefined}
            className={page === name ? "active" : ""}
            onClick={() => go(name)}
          >
            <Icon size={19} />
            <span>{name === "Live Scores" ? "Matches" : name}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

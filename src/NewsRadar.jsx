import React, {useState} from "react";
import {Newspaper,ExternalLink,Info,KeyRound,RefreshCw} from "lucide-react";
import {useResource} from "./api.js";
import {competitions} from "../shared/competitions.js";
import {Loading,ErrorNotice} from "./components.jsx";

const date=(v)=>new Date(v).toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"});
export default function NewsRadar({league,onLeagueChange,refresh,config,demo}) {
  const [topic,setTopic]=useState("all"),[selection,setSelection]=useState({league,teamId:""}),[retry,setRetry]=useState(0);
  const configured=Boolean(config?.news?.configured),supported=Boolean(config?.news);
  const teamId=selection.league===league?selection.teamId:"";
  const table=useResource(`/api/standings?competition=${league}`,{enabled:configured&&Boolean(config?.configured)&&!demo,refresh,ttl:900000});
  const teams=[...new Map((table.data?.data?.standings||[]).flatMap(s=>s.table||[]).map(r=>[r.team.id,r.team])).values()].sort((a,b)=>a.name.localeCompare(b.name));
  const query=new URLSearchParams({competition:league,topic,...(teamId?{teamId}:{})});
  const resource=useResource(`/api/news?${query}`,{enabled:configured&&!demo,refresh:refresh+retry,ttl:600000});
  const data=resource.data?.data,meta=resource.data?.meta;
  const articles=resource.error||resource.loading?[]:data?.articles||[];
  return <div className="news-layout">
    <section className="panel news-feed">
      <div className="panel-title"><span><Newspaper size={18}/> News Radar</span><span className="ai-badge">CONTEXT</span></div>
      <div className="news-filter-row">
        <label><span>Competition</span><select aria-label="News competition" value={league} onChange={e=>onLeagueChange(e.target.value)}>{competitions.map(c=><option key={c.code} value={c.code}>{c.name}</option>)}</select></label>
        <label><span>Team</span><select aria-label="News team" value={teamId} disabled={!teams.length||demo} onChange={e=>setSelection({league,teamId:e.target.value})}><option value="">All teams</option>{teams.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        <label><span>Topic</span><select aria-label="News topic" value={topic} onChange={e=>setTopic(e.target.value)}>{[["all","Latest reporting"],["injuries","Injuries & availability"],["lineups","Lineups & squad"],["transfers","Transfers"]].map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      {demo?<div className="news-setup"><Info size={24}/><h3>News is available in the football feed view</h3><p>Exit the demo preview to read source-linked reporting. Synthetic articles are not used.</p></div>:!supported?<div className="news-setup"><Info size={24}/><h3>Restart FormRadar for the news update</h3><p>Press Ctrl+C in the app terminal, run npm run dev again, then reload this page.</p></div>:!configured?<div className="news-setup">
        <KeyRound size={26}/><h3>Connect The Guardian</h3><p>News Radar is ready. Add your own Guardian developer key to this computer to load football reporting.</p>
        <ol><li><a href="https://open-platform.theguardian.com/access/" target="_blank" rel="noreferrer">Get a Guardian developer key <ExternalLink size={12}/></a>.</li><li>Add <code>GUARDIAN_API_KEY</code> to your existing <code>FormRadar/.env</code>.</li><li>Restart FormRadar and reload this page.</li></ol>
        <p>The key stays on your server. The initial integration displays headlines, dates and links for context.</p>
      </div>:<>
        {table.error&&<p className="news-filter-note">Team filtering could not load for this competition. Competition headlines remain available.</p>}
        {table.loading&&<p className="news-filter-note">Loading team choices…</p>}
        {resource.error&&<ErrorNotice error={resource.error} onRetry={()=>setRetry(n=>n+1)}/>}
        {resource.loading&&<Loading label="Loading football reporting…"/>}
        {meta?.stale&&<div className="mode-banner" role="status"><Info size={17}/><span>Showing previously fetched headlines. {meta.warning} Published times remain visible.</span></div>}
        {data?.team&&<p className="news-filter-note">Reporting about <b>{data.team.name}</b> across competitions. A search match does not confirm a player’s availability.</p>}
        {articles.map(a=><article className="news-article" key={a.id}>
          <div className="news-article-meta"><span>The Guardian</span><time dateTime={a.publishedAt}>{date(a.publishedAt)}</time><span>{a.kind}</span></div>
          <h3><a href={a.url} target="_blank" rel="noreferrer">{a.title} <ExternalLink size={14}/></a></h3>
          <p>Publisher reporting · read the original source for full context</p>
        </article>)}
        {!resource.loading&&!resource.error&&!articles.length&&<div className="no-results">No recent Guardian football articles match these filters. Try all teams or another topic.</div>}
        {meta&&<p className="news-source-note">Headlines from <a href="https://www.theguardian.com/football" target="_blank" rel="noreferrer">The Guardian</a> · Fetched {date(meta.fetchedAt)} · Cached for 10 minutes</p>}
        <button className="quiet-button news-retry" disabled={resource.loading} onClick={()=>setRetry(n=>n+1)}><RefreshCw size={14}/> Refresh headlines</button>
      </>}
    </section>
    <aside className="panel news-note">
      <Info size={24}/><h3>Reporting, with its source</h3>
      <p>Headlines link to the publisher and retain publication times. An injury or lineup search can include speculation; it does not establish a confirmed absence.</p>
      <div className="source-tags"><span>Source linked</span><span>Published time</span><span>Context only</span></div>
      <h3>How this relates to predictions</h3><p>The current models use completed match results. These articles do not change their percentages.</p><p>A future news signal needs identified teams and players, evidence available before kickoff, and evaluation against the existing baseline before it can enter a forecast.</p>
    </aside>
  </div>;
}

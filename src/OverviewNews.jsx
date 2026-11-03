import React,{useState} from 'react';
import {ArrowRight,ExternalLink,Newspaper} from 'lucide-react';
import {useResource} from './api.js';
import {Loading,ErrorNotice} from './components.jsx';
import NewsImage from './NewsImage.jsx';

const date=v=>new Date(v).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
export default function OverviewNews({config,demo,refresh,onViewAll}) {
  const [retry,setRetry]=useState(0),configured=Boolean(config?.news?.configured);
  const resource=useResource('/api/news/latest',{enabled:configured&&!demo,refresh:refresh+retry,ttl:600000});
  const meta=resource.data?.meta;
  const articles=meta&&Date.now()-Date.parse(meta.fetchedAt)<=21600000?resource.data.data.articles.slice(0,4):[];
  return <section className="overview-news" aria-labelledby="overview-news-title">
    <div className="section-row"><div><h2 id="overview-news-title"><Newspaper size={20}/> Latest football news</h2><p>Reporting from The Guardian, with the original source and publication time.</p></div><button className="quiet-button" onClick={onViewAll}>News Radar <ArrowRight size={15}/></button></div>
    {demo?<div className="panel news-overview-notice">Exit demo preview to read current reporting. Demo stories are not generated.</div>:!configured?<div className="panel news-overview-notice">Football news is not connected for this app yet.</div>:<>
      {resource.loading&&<Loading label="Loading latest football news…"/>}
      {resource.error&&<ErrorNotice error={resource.error} onRetry={()=>setRetry(n=>n+1)}/>}
      {meta?.stale&&<p className="season-notice" role="status">Showing cached headlines. {meta.warning} Publication times remain visible.</p>}
      <div className="overview-news-grid">{articles.map(a=><article key={a.id} className="panel overview-story"><a className="overview-story-link" href={a.url} target="_blank" rel="noopener noreferrer"><NewsImage article={a}/><div className="overview-story-copy"><div className="news-article-meta"><span>{a.source}</span><span>{a.kind}</span></div><h3>{a.title}</h3><time dateTime={a.publishedAt}>{date(a.publishedAt)}</time><span className="story-read">Read original report <ExternalLink size={13}/></span></div></a></article>)}</div>
      {!resource.loading&&!resource.error&&!articles.length&&<div className="panel news-overview-notice">No recent football headlines were returned. Try refreshing the news.</div>}
      {meta&&<p className="news-source-note">The Guardian · Retrieved {date(meta.fetchedAt)} · News does not change model percentages.</p>}
    </>}
  </section>;
}

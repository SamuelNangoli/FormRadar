import React,{useEffect,useRef,useState} from "react";
import {ArrowLeft,Activity,Info} from "lucide-react";
import {useResource} from "./api.js";
import {demoMatches} from "./demo.js";
import {matchesHref} from "./match-navigation.js";
import {isLive} from "./format.js";
import {Loading,ErrorNotice,Versus,SourceNote,Prediction,TeamComparison} from "./components.jsx";
import MatchInsights from "./MatchInsights.jsx";
import ForecastHistory from "./ForecastHistory.jsx";

function CompletedForecasts({match,refresh,backendCurrent}){
  const [retry,setRetry]=useState(0);
  const history=useResource(`/api/predictions/${match.id}/history`,{enabled:backendCurrent&&['PL','CL'].includes(match.competition.code),refresh:refresh+retry,ttl:0});
  return <><section className="panel completed-forecast"><div className="panel-title"><span><Info size={18}/> Pre-match estimates are closed</span></div><p>This match has already been played. New predictions are not generated after kickoff. Only forecasts actually saved before the match can appear below.</p></section><ForecastHistory resource={history} onRetry={()=>setRetry(n=>n+1)}/></>;
}

export default function MatchPage({route,config,refresh}){
  const [retry,setRetry]=useState(0),[poll,setPoll]=useState(0),[tab,setTab]=useState('info');
  const heading=useRef(null),demo=route.context.demo,valid=route.kind==='match';
  const current=config?.matchDetailsVersion===1;
  const resource=useResource(valid?`/api/matches/${route.id}`:null,{enabled:valid&&!demo&&current,refresh:refresh+retry+poll,ttl:60000});
  const match=demo?demoMatches(route.context.league).find(m=>m.id===route.id):resource.data?.data?.match;
  const completed=match&&(match.status==='FINISHED'||Date.parse(match.utcDate)<=Date.now());
  useEffect(()=>{if(!match)return;const previous=document.title;document.title=`${match.homeTeam.name} vs ${match.awayTeam.name} — FormRadar`;heading.current?.focus({preventScroll:true});return()=>{document.title=previous;};},[match?.id]);
  useEffect(()=>{if(demo||!match||!['TIMED','SCHEDULED'].includes(match.status)&&!isLive(match))return;const timer=setInterval(()=>{if(document.visibilityState==='visible')setPoll(n=>n+1);},60000);return()=>clearInterval(timer);},[demo,match?.id,match?.status]);
  return <div className="match-page">
    <a className="quiet-button match-back" href={matchesHref({...route.context,selectedId:route.id})}><ArrowLeft size={16}/> Back to matches</a>
    {!valid?<div className="panel empty-selection"><h2>Invalid match link</h2><p>Choose a match from the fixtures or results list.</p></div>:!demo&&!current?<div className="panel empty-selection"><h2>Match details need the latest app update</h2><p>Reload this page after the app update finishes.</p></div>:<>
      {resource.loading&&<Loading label="Loading selected match…"/>}
      {resource.error&&<ErrorNotice error={resource.error} onRetry={()=>setRetry(n=>n+1)}/>}
      {demo&&!match&&<p className="season-notice">This demo fixture is unavailable. Return to the demo match list.</p>}
      {match&&<>
        <h2 className="match-page-heading" tabIndex={-1} ref={heading}>{match.homeTeam.name} vs {match.awayTeam.name}</h2>
        <p className="match-page-date">{new Date(match.utcDate).toLocaleString(undefined,{dateStyle:'full',timeStyle:'short'})}</p>
        <section className="panel match-detail"><div className="panel-title"><span><Activity size={18}/> {match.status==='FINISHED'?'Match result':'Selected match'}</span><span className="ai-badge">{demo?'DEMO FIXTURE':'PROVIDER DATA'}</span></div><Versus match={match}/><SourceNote resource={resource} demo={demo}/></section>
        <div className="fixture-tabs match-page-tabs" aria-label="Match views">{[['info','Match info'],['predictions','Predictions'],['form','Team form']].map(([value,label])=><button key={value} aria-pressed={tab===value} className={tab===value?'active':''} onClick={()=>setTab(value)}>{label}</button>)}</div>
        {tab==='info'&&<MatchInsights key={`${match.id}-${demo}`} match={match} demo={demo} refresh={refresh+poll} backendCurrent={config?.matchInsightsVersion===1}/>}
        {tab==='predictions'&&(completed&&!demo?<CompletedForecasts match={match} refresh={refresh} backendCurrent={config?.predictionsApiVersion===2}/>:<Prediction match={match} demo={demo} refresh={refresh+poll} backendCurrent={config?.predictionsApiVersion===2} apiDemoEnabled={config?.predictionServiceDemoVersion===1}/>)}
        {tab==='form'&&<><p className="season-notice">Team form covers the latest 90 days. For a historical match, this is a current summary rather than form recorded at that kickoff.</p><TeamComparison match={match} demo={demo} refresh={refresh}/></>}
      </>}
    </>}
  </div>;
}

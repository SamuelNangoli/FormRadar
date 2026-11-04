const minuteValue=v=>Number.isInteger(v)&&v>=0&&v<=180?v:null;
const extraValue=v=>Number.isInteger(v)&&v>=0&&v<=60?v:null;
const text=v=>typeof v==='string'?v.replace(/[\u0000-\u001f]/g,'').trim().slice(0,100):'';

export function normalizeGoals(match){
  const provided=Array.isArray(match.goals),seen=new Set();
  const goals=(provided?match.goals:[]).slice(0,100).flatMap(g=>{
    if(!Number.isSafeInteger(g?.team?.id)||g.team.id<=0)return [];
    const side=g?.team?.id===match.homeTeam?.id?'home':g?.team?.id===match.awayTeam?.id?'away':null;
    if(!side||!['REGULAR','PENALTY','OWN'].includes(g.type))return [];
    const score=Number.isInteger(g.score?.home)&&g.score.home>=0&&Number.isInteger(g.score?.away)&&g.score.away>=0?{home:g.score.home,away:g.score.away}:null;
    if(score){const identity=JSON.stringify([side,score]);if(seen.has(identity))return [];seen.add(identity);}
    return [{side,teamId:g.team.id,scorer:text(g.scorer?.name)||null,assist:text(g.assist?.name)||null,minute:minuteValue(g.minute),injuryTime:extraValue(g.injuryTime),type:g.type,score}];
  }).sort((a,b)=>(a.minute??999)-(b.minute??999)||(a.injuryTime??0)-(b.injuryTime??0));
  return {goals,goalsAvailable:provided};
}

export function clockText(match){
  if(match.status==='PAUSED')return 'Half-time';
  if(match.status==='PENALTY_SHOOTOUT')return 'Penalty shootout';
  const minute=minuteValue(match.minute),extra=extraValue(match.injuryTime);
  if(minute===null)return 'Live · minute unavailable';
  return `${minute}${extra>0?`+${extra}`:''}′${match.status==='EXTRA_TIME'?' · Extra time':''}`;
}
export function goalTime(goal){
  const minute=minuteValue(goal.minute),extra=extraValue(goal.injuryTime);
  return minute===null?'Time unavailable':`${minute}${extra>0?`+${extra}`:''}′`;
}
export const safeMinute=minuteValue;
export const safeInjuryTime=extraValue;

// Entirely synthetic responses for isolated tests; never a live player feed.
export const NOW=Date.parse("2026-11-02T12:00:00Z");
export const MATCH={id:500,status:"TIMED",utcDate:"2026-11-03T20:00:00Z",competition:{id:2021,code:"PL"},
  homeTeam:{id:64,name:"Liverpool FC"},awayTeam:{id:57,name:"Arsenal FC"}};
export const target=()=>({fixture:{id:900,date:MATCH.utcDate,status:{short:"NS"}},league:{id:39},teams:{home:{id:40,name:"Liverpool"},away:{id:42,name:"Arsenal"}}});
export function lineup(teamId,offset=0){return {team:{id:teamId},formation:"4-3-3",coach:{name:"Synthetic coach"},
  startXI:Array.from({length:11},(_,i)=>({player:{id:offset+i+1,name:`Synthetic player ${offset+i+1}`,number:i+1,pos:i===0?"G":i<5?"D":i<8?"M":"F"}})),
  substitutes:[{player:{id:offset+12,name:`Synthetic player ${offset+12}`,number:12,pos:"D"}}]};}
const allPlayers=(team,offset)=>[...lineup(team,offset).startXI,...lineup(team,offset).substitutes].map(({player:p})=>({player:{id:p.id,name:p.name},
  statistics:[{games:{position:p.pos,minutes:p.number===12?20:90,rating:p.number===12?"6.80":"7.20"},goals:{total:0,assists:0},cards:{yellow:0,red:0}}]}));
export const history=()=>["2026-11-01T16:00:00Z","2026-10-29T16:00:00Z","2026-10-25T16:00:00Z"].map((date,i)=>({
  ...target(),fixture:{id:901+i,date,status:{short:"FT"}}}));
export const bundles=()=>history().map(f=>({...f,lineups:[lineup(40),lineup(42,100)],players:[{team:{id:40},players:allPlayers(40,0)},{team:{id:42},players:allPlayers(42,100)}]}));
export const injuries=()=>[
  {fixture:{id:900},team:{id:40},player:{id:2,name:"Synthetic player 2",type:"Missing Fixture",reason:"Suspended"}},
  {fixture:{id:900},team:{id:40},player:{id:9,name:"Synthetic player 9",type:"Questionable",reason:"Hamstring"}},
];
export const squad=team=>[{team:{id:team},players:[...lineup(team,team===40?0:100).startXI,...lineup(team,team===40?0:100).substitutes].map(({player:p})=>({...p,position:p.pos}))}];
export function fakeFeed({issues={},observed=[]}={}){
  return async(url,options)=>{
    const u=new URL(url);observed.push(u.pathname+u.search);
    if(issues[u.pathname])return new Response(JSON.stringify({errors:{plan:issues[u.pathname]},response:[]}));
    let response;
    if(u.pathname==="/fixtures/lineups")response=[];
    else if(u.pathname==="/injuries")response=injuries();
    else if(u.pathname==="/players/squads")response=squad(Number(u.searchParams.get("team")));
    else if(u.searchParams.has("ids"))response=bundles();
    else if(u.searchParams.has("team"))response=history();
    else response=[target()];
    return new Response(JSON.stringify({errors:{},response}));
  };
}

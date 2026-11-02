// Synthetic schedules only; callers retain a testOnly flag unless explicitly testing HTTP source parsing.
export function championsSeason(season) {
  const matches=[], group=season===2023, rounds=group?6:8;
  const stage=group?"GROUP_STAGE":"LEAGUE_STAGE";
  function add(home,away,round) {
    const current=season===2026;
    const date=current&&round>=3?new Date(Date.UTC(2026,10,3+21*(round-3),20)):new Date(Date.UTC(season,7,1+21*round,20));
    const finished=!current||round<3;
    matches.push({id:season*1000+matches.length+1,competition:{id:2001,code:"CL"},season:{startDate:`${season}-08-01`},
      utcDate:date.toISOString(),status:finished?"FINISHED":"TIMED",stage,matchday:round+1,
      homeTeam:{id:home,name:`Synthetic ${home}`},awayTeam:{id:away,name:`Synthetic ${away}`},
      score:{duration:"REGULAR",fullTime:{home:finished?(home<=4?4:1):null,away:finished?(away<=4?3:0):null}}});
  }
  if(group){const pairs=[[[1,2],[3,4]],[[1,3],[4,2]],[[1,4],[2,3]]];
    for(let r=0;r<rounds;r++)for(let g=0;g<8;g++)for(const [h,a] of pairs[r%3])add(g*4+(r<3?h:a),g*4+(r<3?a:h),r);
  }else for(let r=0;r<rounds;r++)for(let i=0;i<18;i++){
    const a=i+1,b=19+(i+r)%18;add(r%2?b:a,r%2?a:b,r);
  }
  return {testOnly:true,competition:{id:2001,code:"CL"},filters:{season:String(season)},matches};
}

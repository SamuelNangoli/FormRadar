const DAY = 86_400_000;
const id = v => Number.isSafeInteger(v) && v > 0;
const clean = v => typeof v === "string" ? v.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 120) : "";
const count = v => Number.isInteger(v) && v >= 0 && v <= 150 ? v : null;
const rating = v => typeof v === "number" || typeof v === "string" && /^\d{1,2}(?:\.\d{1,3})?$/.test(v)
  ? Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 10 ? Number(v) : null : null;
const role = v => ({ Goalkeeper:"G", Defender:"D", Midfielder:"M", Attacker:"F", Forward:"F" }[v] || (["G","D","M","F"].includes(v) ? v : null));

export function recentFixtures(rows, teamId, cutoff) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).filter(f => {
    const date = Date.parse(f?.fixture?.date);
    return !f?.testOnly && id(f?.fixture?.id) && !seen.has(f.fixture.id) &&
      ["FT","AET","PEN"].includes(f.fixture.status?.short) &&
      date < cutoff && date >= cutoff - 30 * DAY &&
      [f.teams?.home?.id, f.teams?.away?.id].includes(teamId) &&
      (seen.add(f.fixture.id) || true);
  }).sort((a,b) => Date.parse(b.fixture.date) - Date.parse(a.fixture.date)).slice(0,3);
}

export function absenceReports(rows, fixtureId, teamId) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).flatMap(r => {
    if (r?.fixture?.id !== fixtureId || r.team?.id !== teamId || !id(r.player?.id) ||
        !clean(r.player.name) || seen.has(r.player.id) ||
        !["Missing Fixture","Questionable"].includes(r.player.type)) return [];
    seen.add(r.player.id);
    const reason = clean(r.player.reason);
    return [{ id:r.player.id, name:clean(r.player.name),
      status:r.player.type === "Missing Fixture" ? "out" : "doubtful",
      category:/suspend|suspension|red card|yellow card/i.test(reason) ? "suspension" : "injury or other absence",
      reason:reason || "Reason not supplied" }];
  });
}

export function playerStatistics(rows, teamId) {
  const sides = (Array.isArray(rows) ? rows : []).filter(r => r?.team?.id === teamId);
  if (sides.length !== 1 || !Array.isArray(sides[0].players)) return new Map();
  const players = new Map();
  for (const r of sides[0].players) {
    const s = r?.statistics?.[0];
    if (!id(r?.player?.id) || !clean(r.player.name) || !s || players.has(r.player.id)) continue;
    const minutes = count(s.games?.minutes);
    players.set(r.player.id, {id:r.player.id, name:clean(r.player.name),
      position:role(s.games?.position), minutes,
      rating:minutes > 0 ? rating(s.games?.rating) : null,
      goals:count(s.goals?.total), assists:count(s.goals?.assists),
      yellowCards:count(s.cards?.yellow), redCards:count(s.cards?.red)});
  }
  return players;
}

function squadPlayers(rows, teamId) {
  const side = (Array.isArray(rows) ? rows : []).filter(r => r?.team?.id === teamId);
  if (side.length !== 1 || !Array.isArray(side[0].players) || !side[0].players.length) return null;
  const result = new Map();
  for (const p of side[0].players) if (id(p?.id) && clean(p.name) && !result.has(p.id))
    result.set(p.id, {id:p.id,name:clean(p.name),position:role(p.position),shirtNumber:Number.isInteger(p.number)?p.number:null,provider:"api-football"});
  return result.size ? result : null;
}

export function possibleXI(players, formation, absences, squadVerified, historyMatches) {
  const parts = typeof formation === "string" && /^\d(?:-\d){1,5}$/.test(formation) ? formation.split("-").map(Number) : [];
  const needs = parts.length >= 2 && parts.reduce((a,b)=>a+b,0) === 10
    ? {G:1,D:parts[0],M:parts.slice(1,-1).reduce((a,b)=>a+b,0),F:parts.at(-1)} : null;
  if (!needs || !squadVerified || historyMatches < 2) return null;
  const out = new Set(absences.filter(p => p.status === "out").map(p => p.id));
  const doubtful = new Set(absences.filter(p => p.status === "doubtful").map(p => p.id));
  const candidates = players.filter(p => p.currentSquad && !out.has(p.id) && (p.starts > 0 || p.minutes > 0));
  const chosen = [];
  for (const [position,needed] of Object.entries(needs)) {
    const ordered = candidates.filter(p => p.position === position).sort((a,b) =>
      Number(doubtful.has(a.id))-Number(doubtful.has(b.id)) ||
      b.recencyStarts-a.recencyStarts || b.starts-a.starts ||
      (b.averageRating ?? -1)-(a.averageRating ?? -1) || a.id-b.id);
    if (ordered.length < needed) return null;
    chosen.push(...ordered.slice(0,needed));
  }
  if (chosen.length !== 11 || new Set(chosen.map(p=>p.id)).size !== 11) return null;
  return {kind:"estimated",formation,players:chosen,bench:[],
    method:"Recent starts by position, then recent ratings; reported absences excluded",
    calibrated:false,historyMatches};
}

export function buildPlayerTeam({ teamId, history, bundles, squadRows, injuries,
  fixtureId, normalizeXI, cutoff }) {
  const squad = squadPlayers(squadRows, teamId);
  const absent = absenceReports(injuries, fixtureId, teamId);
  const pool = new Map();
  let reviewed = 0, latestXI = null;
  const sourceMatches = [];
  for (const [index, fixture] of recentFixtures(history,teamId,cutoff).entries()) {
    const matches = (Array.isArray(bundles) ? bundles : []).filter(b => b?.fixture?.id === fixture.fixture.id &&
      !b.testOnly && Date.parse(b.fixture.date) === Date.parse(fixture.fixture.date) &&
      b.teams?.home?.id === fixture.teams.home?.id && b.teams?.away?.id === fixture.teams.away?.id &&
      ["FT","AET","PEN"].includes(b.fixture.status?.short));
    if (matches.length !== 1) continue;
    const bundle = matches[0], xi = normalizeXI(bundle.lineups,teamId);
    if (!xi) continue;
    latestXI ||= xi;
    reviewed++;
    sourceMatches.push({fixtureId:fixture.fixture.id,date:fixture.fixture.date,
      home:clean(fixture.teams.home.name),away:clean(fixture.teams.away.name)});
    const starters = new Set(xi.players.map(p=>p.id));
    const stats = playerStatistics(bundle.players,teamId);
    for (const p of [...xi.players,...xi.bench]) {
      if (!pool.has(p.id)) pool.set(p.id,{...p,position:role(p.position),starts:0,recencyStarts:0,observations:[]});
      const row = pool.get(p.id);
      if (starters.has(p.id)) { row.starts++; row.recencyStarts += 3-index; }
      row.observations.push(stats.get(p.id) || null);
    }
  }
  const absences = new Map(absent.map(p=>[p.id,p]));
  const players = [...pool.values()].map(p => {
    const samples = p.observations.filter(Boolean), ratings = samples.map(s=>s.rating).filter(v=>v !== null);
    const total = key => samples.length && p.observations.length === reviewed && p.observations.every(s=>s && s[key] !== null)
      ? samples.reduce((sum,s)=>sum+s[key],0) : null;
    const registered = squad?.get(p.id);
    return {...p,...(registered || {}),observations:undefined,currentSquad:squad ? squad.has(p.id) : null,
      averageRating:ratings.length ? Math.round(ratings.reduce((a,b)=>a+b,0)/ratings.length*100)/100 : null,
      ratedMatches:ratings.length, appearances:samples.filter(s=>s.minutes > 0).length,
      minutes:total("minutes"), goals:total("goals"), assists:total("assists"),
      yellowCards:total("yellowCards"), redCards:total("redCards"),
      availability:absences.get(p.id)?.status || null};
  }).sort((a,b)=>b.starts-a.starts || (b.averageRating ?? -1)-(a.averageRating ?? -1) || a.id-b.id);
  return {providerTeamId:teamId,players,absences:absent,history:sourceMatches,
    historyMatches:reviewed,squadVerified:Boolean(squad),
    possible:possibleXI(players,latestXI?.formation,absent,Boolean(squad),reviewed)};
}

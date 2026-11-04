export const PLAYER_FEATURES = [
  "homeMeanRating","awayMeanRating","ratingDifference",
  "homeRatingCoverage","awayRatingCoverage","homeRecentStartShare","awayRecentStartShare",
  "homeReportedOuts","awayReportedOuts","homeDoubtful","awayDoubtful",
];

// Candidate training inputs only. The current Poisson model does not use them.
export function playerFeatureSnapshot(response, recordedAt = Date.now()) {
  const d = response?.data, kickoff = Date.parse(d?.fixture?.utcDate);
  const fail = message => { throw new Error(message); };
  if (!d?.available || response.meta?.stale || d.testOnly || !Number.isSafeInteger(d.fixture?.id))
    fail("A fresh, real player-context response is required.");
  if (d.fixture.status !== "TIMED" || !Number.isFinite(kickoff) ||
      recordedAt >= kickoff || kickoff-recordedAt > 7*86400000)
    fail("Capture only a confirmed fixture within seven days, before kickoff.");
  if (!d.injuriesAvailable) fail("Availability coverage is required for a training snapshot.");
  for (const value of [d.dataFetchedAt,d.availabilityAsOf,d.ratingDataAsOf,d.scope?.cutoff])
    if (!Number.isFinite(Date.parse(value)) || Date.parse(value)>recordedAt)
      fail("Player data timestamps must be known at the capture time.");
  const features = {}, selection = {};
  for (const side of ["home","away"]) {
    const team = d[side], xi = team?.reported || team?.possible;
    if (!team?.squadVerified || team.historyMatches < 2 || xi?.players?.length !== 11 ||
        !["reported","estimated"].includes(xi.kind) || new Set(xi.players.map(p=>p.id)).size!==11)
      fail("Both teams need verified squads, recent history and a complete reported or estimated XI.");
    if (!team.history?.length || team.history.some(m=>!Number.isFinite(Date.parse(m.date))||Date.parse(m.date)>=Date.parse(d.scope.cutoff)))
      fail("Only completed source matches strictly before the feature cutoff are allowed.");
    const players = new Map(team.players.map(p=>[p.id,p]));
    const chosen = xi.players.map(p=>players.get(p.id));
    const rated = chosen.filter(p=>p && Number.isFinite(p.averageRating) && p.averageRating>=0 && p.averageRating<=10 && p.ratedMatches>0);
    if (rated.length<8) fail("At least eight players per XI need genuine recent ratings.");
    const out = new Set(team.absences.filter(p=>p.status==="out").map(p=>p.id));
    if (xi.players.some(p=>out.has(p.id))) fail("The chosen XI conflicts with a reported absence.");
    features[`${side}MeanRating`] = rated.reduce((sum,p)=>sum+p.averageRating,0)/rated.length;
    features[`${side}RatingCoverage`] = rated.length/11;
    features[`${side}RecentStartShare`] = chosen.reduce((sum,p)=>sum+(p?.starts||0)/team.historyMatches,0)/11;
    features[`${side}ReportedOuts`] = out.size;
    features[`${side}Doubtful`] = team.absences.filter(p=>p.status==="doubtful").length;
    selection[side] = xi.kind;
  }
  features.ratingDifference = features.homeMeanRating-features.awayMeanRating;
  if (!PLAYER_FEATURES.every(name=>Number.isFinite(features[name]))) fail("Feature values are incomplete.");
  return {schemaVersion:1,role:"pre-kickoff-player-context",provider:"football-data.org",
    playerProvider:"api-football",matchId:d.fixture.id,competition:d.fixture.competition.code,
    homeTeamId:d.fixture.homeTeam.id,awayTeamId:d.fixture.awayTeam.id,
    kickoffAt:d.fixture.utcDate,recordedAt:new Date(recordedAt).toISOString(),
    featureCutoff:d.scope.cutoff,ratingDataAsOf:d.ratingDataAsOf,availabilityAsOf:d.availabilityAsOf,
    featureNames:PLAYER_FEATURES,values:PLAYER_FEATURES.map(name=>features[name]),features,selection,
    affectsCurrentModel:false,requiresRetraining:true};
}

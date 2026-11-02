// Synthetic model for isolated tests only; never install in the app private data folder.
export const syntheticModel = () => ({ schemaVersion:1, role:"experimental-current-season", experimental:true, deployable:false, testOnly:false,
  provider:"football-data.org", competition:"PL", season:2026, modelVersion:"a".repeat(32), datasetVersion:"b".repeat(64), snapshotVersion:"c".repeat(64),
  outcomeOrder:["home","draw","away"], evaluationReference:"evaluation-synthetic-only", evaluationIsForDifferentFittedArtifact:true,
  trainedAt:"2026-11-02T10:01:00Z", dataAsOf:"2026-11-02T10:00:00Z", coverageThrough:"2026-11-02T00:00:00Z", expiresAt:"2026-11-03T00:00:00Z",
  currentSeasonMatches:10, currentTeamIds:Array.from({length:20},(_,i)=>i+1),
  parameters:{family:"regularized-independent-poisson",provider:"football-data.org",teamIds:Array.from({length:20},(_,i)=>i+1),
    intercept:Math.log(1.2), homeAdvantage:.2, attack:Array(20).fill(0), defenceWeakness:Array(20).fill(0),temperature:1.15,alpha:1,halfLifeDays:null,
    trainingCutoff:"2026-11-02T00:00:00Z",trainingMatches:1150},
  evaluation:{testPoisson:{matches:380,logLoss:1.03,brier:.62},testFrequencyBaseline:{matches:380,logLoss:1.09,brier:.66},limitations:["Synthetic test fixture only"]} });

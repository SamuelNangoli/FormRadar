import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,stat,rm,readdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createLineupSource} from "../server/lineups.mjs";
import {matchView} from "../server/data.mjs";
import {playerFeatureSnapshot,PLAYER_FEATURES} from "../model/player-features.mjs";
import {savePlayerSnapshot} from "../model/capture-player-context.mjs";
import {NOW,MATCH,fakeFeed} from "./fixtures/player-context.mjs";

async function context(){
  const source=createLineupSource({key:"synthetic-private-player-key",fetchImpl:fakeFeed(),now:()=>NOW});
  return {data:{...await source.playerContext(MATCH),fixture:matchView(MATCH)},meta:{stale:false}};
}

test("model features use an ordered numerical schema and remain a separate pre-kickoff candidate",async()=>{
  const result=playerFeatureSnapshot(await context(),NOW+1000);
  assert.deepEqual(result.featureNames,PLAYER_FEATURES);
  assert.equal(result.values.length,11);
  assert.equal(result.features.homeReportedOuts,1);
  assert.equal(result.features.homeDoubtful,1);
  assert.equal(result.features.homeRatingCoverage,1);
  assert.equal(result.selection.home,"estimated");
  assert.equal(result.affectsCurrentModel,false);
  assert.equal(result.requiresRetraining,true);
});

test("capture rejects post-kickoff, stale, incomplete, unrated or unavailable-context data",async()=>{
  const original=await context();
  for(const mutate of [
    r=>r.meta.stale=true,
    r=>r.data.injuriesAvailable=false,
    r=>r.data.fixture.status="FINISHED",
    r=>r.data.home.squadVerified=false,
    r=>r.data.home.possible.players.pop(),
    r=>r.data.ratingDataAsOf="2026-11-04T00:00:00Z",
    r=>r.data.home.history[0].date=MATCH.utcDate,
    r=>r.data.home.players.forEach(p=>p.averageRating=null),
  ]){
    const input=structuredClone(original);mutate(input);
    assert.throws(()=>playerFeatureSnapshot(input,NOW+1000));
  }
  assert.throws(()=>playerFeatureSnapshot(original,Date.parse(MATCH.utcDate)),/before kickoff/);
});

test("feature snapshots are immutable private files and unavailable data creates no record",async()=>{
  const root=await mkdtemp(join(tmpdir(),"formradar-synthetic-player-snapshots-"));
  try{
    const input=await context(),options={root,now:()=>NOW+1000};
    const first=await savePlayerSnapshot(input,options),bytes=await readFile(first.file,"utf8");
    assert.equal((await stat(first.file)).mode&0o777,0o600);
    assert.equal(first.snapshot.matchId,500);
    await savePlayerSnapshot(input,options);
    assert.equal(await readFile(first.file,"utf8"),bytes);
    const bad=structuredClone(input);bad.data.available=false;
    await assert.rejects(savePlayerSnapshot(bad,options));
    assert.equal((await readdir(join(root,"player-context","500"))).length,1);
  }finally{await rm(root,{recursive:true,force:true});}
});

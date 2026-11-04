import {pathToFileURL} from "node:url";
import {join} from "node:path";
import {loadServerEnv} from "../server/env.mjs";
import {createProvider,ApiError} from "../server/data.mjs";
import {createMatchInsights} from "../server/match-insights.mjs";
import {PRIVATE} from "./paths.mjs";
import {privateDir,immutable,digest,encode} from "./dataset.mjs";
import {playerFeatureSnapshot} from "./player-features.mjs";

export async function savePlayerSnapshot(response,{root=PRIVATE,now=Date.now}={}){
  const snapshot=playerFeatureSnapshot(response,now());
  const bytes=encode(snapshot),hash=digest(bytes);
  const folder=join(root,"player-context",String(snapshot.matchId));
  await privateDir(root);await privateDir(join(root,"player-context"));await privateDir(folder);
  const file=join(folder,`${hash}.json`);
  await immutable(file,bytes);
  return {file,snapshot};
}

async function main(){
  const id=process.argv[2];
  if(!/^[1-9]\d{0,6}$/.test(id||""))throw new Error("Run npm run model:capture-players -- MATCH_ID using a confirmed upcoming match ID.");
  loadServerEnv();
  const key=process.env.FOOTBALL_DATA_API_KEY,lineupKey=process.env.API_FOOTBALL_KEY;
  const provider=createProvider({key,baseUrl:process.env.FOOTBALL_DATA_BASE_URL});
  const insights=createMatchInsights({provider,lineupKey,secrets:[key,lineupKey]});
  const result=await insights.playerContext(Number(id));
  const saved=await savePlayerSnapshot(result);
  console.log(`Saved pre-kickoff player features: ${saved.file}`);
  console.log("The existing match model is unchanged. Collect outcomes and evaluate a retrained candidate before using these features for probabilities.");
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
  main().catch(error=>{console.error(error instanceof ApiError?error.message:
    error instanceof Error&&!/fetch|ENOENT|EACCES|ENOSPC/.test(error.message)?error.message:
    "Player features could not be saved. Check provider access and private model storage.");process.exitCode=1;});
}

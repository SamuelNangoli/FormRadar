import {readFile,readdir} from "node:fs/promises";
import {join,resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {PRIVATE} from "./paths.mjs";
import {digest} from "./dataset.mjs";
import {validateModel,validForecast} from "../server/predictions.mjs";
import {createCloudStore} from "../server/cloud-store.mjs";
import {loadServerEnv} from "../server/env.mjs";

export async function publishModels({root=PRIVATE,store,now=Date.now,competitions=['PL','CL']}={}) {
  if(!store?.configured)throw new Error('Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in the local server .env first. Never paste them into chat.');
  const bundles=[];
  for(const competition of competitions){
    if(!['PL','CL'].includes(competition))throw new Error('Choose PL or CL.');
    const modelRoot=competition==='CL'?join(root,'champions-league'):root;
    const pointer=JSON.parse(await readFile(join(modelRoot,'EXPERIMENTAL'),'utf8'));
    if(!/^experimental-[A-Za-z0-9-]+$/.test(pointer.run))throw new Error('Invalid model pointer.');
    const bytes=await readFile(join(modelRoot,'runs',pointer.run,'model.json'));
    if(digest(bytes)!==pointer.sha256)throw new Error('Model checksum mismatch.');
    const model=validateModel(JSON.parse(bytes));
    if(model.competition!==competition||now()<Date.parse(model.trainedAt)||now()>=Date.parse(model.expiresAt))throw new Error(`Prepare a fresh ${competition} model before publishing. Model expiry is never extended.`);
    bundles.push({competition,pointer,json:bytes.toString('utf8')});
  }
  const forecasts=[];let folders=[];
  try{folders=await readdir(join(root,'forecasts'));}catch(e){if(e.code!=='ENOENT')throw e;}
  for(const id of folders.filter(v=>/^[1-9]\d{0,6}$/.test(v))){
    for(const file of await readdir(join(root,'forecasts',id))){
      if(!/^[a-f0-9]{64}\.json$/.test(file))continue;
      const f=JSON.parse(await readFile(join(root,'forecasts',id,file),'utf8'));
      if(!validForecast(f,Number(id))||f.forecastId!==file.slice(0,-5))throw new Error('A saved forecast failed validation; nothing was published.');
      if(competitions.includes(f.competition))forecasts.push(f);
    }
  }
  for(const {competition,pointer,json} of bundles)await store.putModel(competition,{pointer,json});
  for(const f of forecasts){const saved=await store.saveForecast(f,{imported:true});if(!validForecast(saved,f.matchId)||saved.forecastId!==f.forecastId)throw new Error('Cloud forecast confirmation failed.');}
  return {models:bundles.map(b=>b.competition),forecastRecords:forecasts.length};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try {
    const args=process.argv.slice(2);
    if(args.some(a=>!/^--competition=(PL|CL)$/.test(a))||args.length>1)throw new Error('Usage: npm run model:publish -- --competition=PL (or CL); omit the flag for both.');
    loadServerEnv();const store=createCloudStore();
    const result=await publishModels({store,competitions:args.length?[args[0].split('=')[1]]:['PL','CL']});
    console.log(`Published ${result.models.join(' and ')} experimental models; synchronized ${result.forecastRecords} saved forecast records. Expiry and evaluation disclosures are preserved.`);
  }catch(error){console.error(error.code==='ENOENT'?'Prepare the local models before publishing.':error.code==='CLOUD_STORAGE_UNAVAILABLE'?error.message:error instanceof SyntaxError?'A local model record is invalid. Validate it before publishing.':error.message==='Invalid experimental model'?'The model failed validation; nothing was published.':error.message);process.exitCode=1;}
}

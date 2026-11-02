import {createApp} from "../server/app.mjs";
import {createCloudStore} from "../server/cloud-store.mjs";

// One Node function handles every /api/* path. Vercel supplies server env vars.
// Python training is offline; no listener or training process runs in this function.
let app;
export default function handler(req,res) {
  app ||= createApp({hosted:true,cloudStore:createCloudStore()});
  return app.handler(req,res);
}

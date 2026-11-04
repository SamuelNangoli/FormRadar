import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

// Host environment > application .env > original .env > local demo caller.
// Resolve from this module so starting the app from another directory works.
export function loadServerEnv(files = [
  fileURLToPath(new URL("../.env", import.meta.url)),
  fileURLToPath(new URL("../../../.env", import.meta.url)),
  fileURLToPath(new URL("../../../ai-service/.client.env", import.meta.url)),
]) {
  for (const file of files) {
    try {
      loadEnvFile(file);
    } catch (error) {
      if (error.code !== "ENOENT")
        throw new Error("Could not load a FormRadar .env file. Check its format.");
    }
  }
  if(process.env.API_FOOTBALL_KEY===undefined){
    const alias=Object.keys(process.env).find(name=>name.toUpperCase()==="API_FOOTBALL_KEY");
    if(alias)process.env.API_FOOTBALL_KEY=process.env[alias];
  }
}

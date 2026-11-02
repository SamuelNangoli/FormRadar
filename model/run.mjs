import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PROJECT, VENV, PRIVATE } from "./paths.mjs";
import { loadDataset, DatasetError } from "./dataset.mjs";
try {
  const action = process.argv[2];
  if (!["evaluate", "refit", "inspect", "test"].includes(action) || process.argv.length !== 3)
    throw new DatasetError("Use an existing model:train, model:refit, model:inspect or model:test npm command.");
  const python = join(VENV, "bin/python3");
  if (!existsSync(python)) throw new DatasetError("Run npm run model:setup first to create the project Python environment.");
  if (["evaluate", "refit"].includes(action)) await loadDataset(PRIVATE);
  const env = { ...process.env, PYTHONDONTWRITEBYTECODE: "1", OPENBLAS_NUM_THREADS: "1", OMP_NUM_THREADS: "1" };
  for (const name of Object.keys(env)) if (/^(FOOTBALL_DATA_|GUARDIAN_API_KEY$|API_FOOTBALL_KEY$|UPSTASH_REDIS_|FORMRADAR_CLOUD_NAMESPACE$)/i.test(name)) delete env[name];
  const ready = spawnSync(python, ["-c", "import numpy,scipy"], { env, stdio: "pipe" });
  if (ready.status !== 0) throw new DatasetError("Python dependencies are incomplete. Rerun npm run model:setup, then retry this command.");
  const args = action === "test" ? ["-m", "unittest", "discover", "-s", "model/tests", "-v"]
    : ["model/train.py", action];
  const result = spawnSync(python, args, { cwd: PROJECT, env, stdio: "inherit" });
  process.exitCode = result.error ? 1 : result.status ?? 1;
} catch (error) {
  console.error(error instanceof DatasetError ? error.message : "The local model command could not validate its input. Run model:validate for details.");
  process.exitCode = 1;
}

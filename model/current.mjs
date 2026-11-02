import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { loadServerEnv } from "../server/env.mjs";
import { ApiError, createProvider } from "../server/data.mjs";
import { PRIVATE, PROJECT, VENV } from "./paths.mjs";
import { DatasetError, coverage, normalizeSeason, loadDataset, digest, encode, privateDir, immutable } from "./dataset.mjs";

const fail = (message) => { throw new DatasetError(message); };
const utc = (value) => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace(".000Z", "Z") === value.replace(".000Z", "Z");

export function normalizeCurrent(raw, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  if (today < "2026-07-01" || today >= "2027-07-01") fail("This model supports the 2026/27 season. Update and evaluate the historical workflow for a new season.");
  if (raw?.testOnly === true) fail("Synthetic data cannot prepare an experimental model.");
  if (raw?.competition?.code !== "PL" || raw.competition.id !== 2021 || !Array.isArray(raw.matches)
    || raw.matches.length !== 380 || (raw.filters?.season != null && String(raw.filters.season) !== "2026")) fail("Expected the full 380-match 2026/27 Premier League schedule.");
  const ids = new Set();
  const known = new Set(["SCHEDULED", "TIMED", "IN_PLAY", "PAUSED", "FINISHED", "POSTPONED", "SUSPENDED", "CANCELLED", "AWARDED"]);
  for (const m of raw.matches) {
    if (!Number.isSafeInteger(m.id) || m.id <= 0 || ids.has(m.id)
      || !Number.isSafeInteger(m.homeTeam?.id) || m.homeTeam.id <= 0
      || !Number.isSafeInteger(m.awayTeam?.id) || m.awayTeam.id <= 0 || m.homeTeam.id === m.awayTeam.id
      || !known.has(m.status) || !utc(m.utcDate) || m.utcDate < "2026-07-01" || m.utcDate >= "2027-07-01"
      || m.season?.startDate?.slice(0, 4) !== "2026"
      || (m.competition && (m.competition.code !== "PL" || m.competition.id !== 2021))) fail("The current schedule has an invalid identity, date, season or status.");
    ids.add(m.id);
    if (m.status === "FINISHED" && Date.parse(m.utcDate) >= now) fail("A future fixture is marked completed.");
    if (m.utcDate.slice(0, 10) < today && ["SCHEDULED", "TIMED", "IN_PLAY", "PAUSED"].includes(m.status)) fail("An earlier fixture has an unresolved status. Retry after the provider updates it.");
  }
  coverage(raw.matches.map((m) => ({ ...m, season: 2026 })), 2026);
  // Exclude the whole current UTC date, even if a match has already finished.
  const eligible = raw.matches.filter((m) => m.status === "FINISHED" && m.utcDate.slice(0, 10) < today);
  const normalized = normalizeSeason({ ...raw, matches: eligible }, 2026, { complete: false });
  if (normalized.rows.length !== eligible.length || normalized.excluded) fail("Completed current-season results have missing or invalid 90-minute scores.");
  return { rows: normalized.rows, season: 2026, teamIds: [...new Set(raw.matches.flatMap((m) => [m.homeTeam.id, m.awayTeam.id]))].sort((a,b) => a-b),
    coverageThrough: today + "T00:00:00.000Z" };
}

export async function prepareSnapshot({ root = PRIVATE, provider, key, now = Date.now } = {}) {
  const history = await loadDataset(root);
  if (history.manifest.testOnly) fail("Import real historical results first.");
  const response = await provider.get("/competitions/PL/matches?season=2026", 0, (raw) => raw);
  if (response.meta.stale) fail("A fresh current-season response is required.");
  const raw = response.data;
  const bytes = encode(raw);
  if (key?.trim() && bytes.includes(key.trim())) fail("Credential isolation check failed; nothing was retained.");
  const normalized = normalizeCurrent(raw, now());
  if (normalized.rows.some((r) => history.rows.some((h) => h.id === r.id))) fail("Historical and current-season match IDs overlap.");
  await privateDir(join(root, "current"));
  const rawHash = digest(bytes);
  await immutable(join(root, "current", `raw-${rawHash}.json`), bytes);
  const fetchedAt = response.meta.fetchedAt;
  const expiresAt = new Date(Math.min(Date.parse(fetchedAt) + 86_400_000, Date.parse(normalized.coverageThrough) + 86_400_000)).toISOString();
  const snapshot = { schemaVersion: 1, provider: "football-data.org", competition: "PL", testOnly: false,
    historicalDatasetVersion: history.version, sourceSha256: rawHash, fetchedAt, expiresAt, ...normalized };
  const content = encode(snapshot);
  const version = digest(content);
  await immutable(join(root, "current", `${version}.json`), content);
  return { version, snapshot };
}

async function main() {
  process.umask(0o077);
  if (process.argv.length !== 2) fail("Use npm run model:prepare-current without arguments.");
  // Check all local prerequisites before spending a provider request.
  const python = join(VENV, "bin/python3");
  const env = { ...process.env, PYTHONDONTWRITEBYTECODE: "1", OPENBLAS_NUM_THREADS: "1", OMP_NUM_THREADS: "1" };
  for (const k of Object.keys(env)) if (/^(FOOTBALL_DATA_|GUARDIAN_API_KEY$)/.test(k)) delete env[k];
  const probe = spawnSync(python, ["-c", "import numpy,scipy"], { env, stdio: "pipe" });
  if (probe.status !== 0) fail("Run npm run model:setup first.");
  const pointer = (await readFile(join(PRIVATE, "LATEST_REFIT"), "utf8")).trim();
  if (!/^refit-[A-Za-z0-9-]+$/.test(pointer)) fail("Run model:refit first.");
  loadServerEnv();
  const key = process.env.FOOTBALL_DATA_API_KEY;
  const provider = createProvider({ key, baseUrl: process.env.FOOTBALL_DATA_BASE_URL || "https://api.football-data.org/v4", maxCalls: 1 });
  const { version, snapshot } = await prepareSnapshot({ provider, key });
  console.log(`Current snapshot: ${snapshot.rows.length} completed 2026/27 results before ${snapshot.coverageThrough.slice(0,10)} UTC.\nFitting with the previously evaluated settings; evaluation and refit are preserved.`);
  const result = spawnSync(python, ["model/train.py", "experimental", "--snapshot", version], { cwd: PROJECT, env, stdio: "inherit" });
  process.exitCode = result.error ? 1 : result.status ?? 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error instanceof DatasetError || error instanceof ApiError ? error.message : "Could not prepare the current model. Check model:validate and model:refit first. No credentials or provider bodies are printed.");
    process.exitCode = 1;
  });

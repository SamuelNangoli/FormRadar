import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rename, lstat } from "node:fs/promises";
import { join } from "node:path";

export const SEASONS = [2023, 2024, 2025];
export const SCHEMA = 1;
export class DatasetError extends Error {}
export const digest = (data) => createHash("sha256").update(data).digest("hex");
export const encode = (value) => JSON.stringify(value) + "\n";
const fail = (message) => { throw new DatasetError(message); };
const integer = (n, low = 1, high = 10_000_000) => Number.isInteger(n) && n >= low && n <= high;

export async function privateDir(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if ((await lstat(path)).isSymbolicLink()) fail("Private data folders must not be symlinks.");
}
export async function atomic(path, value) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, value, { mode: 0o600, flag: "wx" });
  await rename(temporary, path);
}
export async function immutable(path, bytes) {
  try { await writeFile(path, bytes, { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if (error.code !== "EEXIST" || !Buffer.from(await readFile(path)).equals(Buffer.from(bytes)))
      fail("An immutable data file differs from its expected content. Keep it for review; do not overwrite it.");
  }
}

export function coverage(rows, season) {
  const games = rows.filter((row) => row.season === season);
  const pairs = new Set();
  const teams = new Map();
  for (const row of games) {
    const pair = `${row.homeTeam.id}:${row.awayTeam.id}`;
    if (pairs.has(pair)) fail(`Season ${season}: a home/away pairing is repeated.`);
    pairs.add(pair);
    for (const [id, side] of [[row.homeTeam.id, "home"], [row.awayTeam.id, "away"]]) {
      const record = teams.get(id) || { home: 0, away: 0 };
      record[side]++;
      teams.set(id, record);
    }
  }
  if (games.length !== 380 || teams.size !== 20 || [...teams.values()].some((t) => t.home !== 19 || t.away !== 19))
    fail(`Season ${season}: expected 380 completed matches, 20 teams and 19 home/19 away games per team; received ${games.length} matches and ${teams.size} teams.`);
  return { season, matches: games.length, teams: teams.size };
}

export function normalizeSeason(raw, season, { complete = true } = {}) {
  if (!(complete ? SEASONS.includes(season) : season === 2026) || !Array.isArray(raw?.matches)) fail("Invalid historical response schema.");
  if (raw.competition?.code !== "PL" || raw.competition?.id !== 2021)
    fail("Historical response is not the Premier League.");
  if (raw.filters?.season != null && String(raw.filters.season) !== String(season))
    fail("Historical response has the wrong season.");
  const found = new Map();
  let duplicates = 0;
  let excluded = 0;
  for (const match of raw.matches) {
    if (!match || typeof match !== "object") fail("Historical response contains a malformed match.");
    if (match.status !== "FINISHED") { excluded++; continue; }
    const competition = match.competition || raw.competition;
    if (competition.code !== "PL" || (competition.id != null && competition.id !== 2021))
      fail("A historical match belongs to another competition.");
    if (match.season?.startDate && Number(match.season.startDate.slice(0, 4)) !== season)
      fail("A historical match belongs to another season.");
    if (typeof match.utcDate !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(match.utcDate) || !Number.isFinite(Date.parse(match.utcDate)))
      fail("Historical kickoff must be a valid UTC timestamp.");
    const utcDate = new Date(match.utcDate).toISOString();
    if (utcDate.replace(/\.000Z$/, "Z") !== match.utcDate.replace(/\.000Z$/, "Z"))
      fail("Historical kickoff has an invalid calendar date.");
    if (utcDate < `${season}-07-01` || utcDate >= `${season + 1}-07-01`)
      fail("Historical kickoff is outside its requested season.");
    // PL targets are 90-minute scores. Never use extra-time/shootout totals.
    if (match.score?.duration !== "REGULAR") { excluded++; continue; }
    const score = match.score.regularTime || match.score.fullTime;
    if (!integer(score?.home, 0, 50) || !integer(score?.away, 0, 50)) { excluded++; continue; }
    if (!integer(match.id) || !integer(match.homeTeam?.id) || !integer(match.awayTeam?.id) || match.homeTeam.id === match.awayTeam.id)
      fail("Historical match/team identities are invalid.");
    const team = (item) => ({ provider: "football-data.org", id: item.id, name: item.shortName || item.name || String(item.id) });
    const row = { provider: "football-data.org", competition: "PL", season, id: match.id, utcDate,
      homeTeam: team(match.homeTeam), awayTeam: team(match.awayTeam), homeGoals: score.home, awayGoals: score.away };
    const previous = found.get(row.id);
    if (previous && JSON.stringify(previous) !== JSON.stringify(row)) fail("Conflicting duplicate historical match IDs.");
    if (previous) duplicates++; else found.set(row.id, row);
  }
  const rows = [...found.values()].sort((a, b) => a.utcDate.localeCompare(b.utcDate) || a.id - b.id);
  return { rows, coverage: complete ? coverage(rows, season) : null, duplicates, excluded };
}

export async function loadDataset(root) {
  let version;
  try { version = (await readFile(join(root, "CURRENT"), "utf8")).trim(); }
  catch { fail("No imported dataset yet. Run npm run model:import first."); }
  if (!/^[a-f0-9]{64}$/.test(version)) fail("Invalid dataset pointer.");
  const folder = join(root, "datasets", version);
  const manifest = JSON.parse(await readFile(join(folder, "manifest.json"), "utf8"));
  const bytes = await readFile(join(folder, "matches.json"));
  if (manifest.schemaVersion !== SCHEMA || manifest.datasetVersion !== version || digest(bytes) !== manifest.normalizedSha256)
    fail("Dataset checksum/schema verification failed.");
  if (manifest.provider !== "football-data.org" || manifest.competition !== "PL" ||
      !Array.isArray(manifest.sources) || manifest.sources.length !== 3)
    fail("Dataset manifest does not describe three Premier League seasons.");
  const rebuilt = [];
  for (const season of SEASONS) {
    const source = manifest.sources.find((item) => item.season === season);
    if (!source || !new RegExp(`^raw/PL-${season}-[a-f0-9]{64}\\.json$`).test(source.file)) fail("Invalid source manifest path.");
    const raw = await readFile(join(root, source.file));
    if (digest(raw) !== source.sha256) fail("Historical source checksum verification failed.");
    const body = JSON.parse(raw);
    if (Boolean(source.testOnly) !== (body.testOnly === true)) fail("Test-only source metadata is inconsistent.");
    rebuilt.push(...normalizeSeason(body, season).rows);
  }
  if (Boolean(manifest.testOnly) !== manifest.sources.some((source) => source.testOnly))
    fail("Test-only dataset metadata is inconsistent.");
  if (encode(rebuilt) !== bytes.toString("utf8")) fail("Normalized rows differ from the checked historical sources.");
  const expected = digest(JSON.stringify([SCHEMA, manifest.normalizedSha256, ...manifest.sources.map((s) => s.sha256)]));
  if (expected !== version || new Set(rebuilt.map((m) => m.id)).size !== rebuilt.length)
    fail("Dataset version or global match IDs are inconsistent.");
  return { version, manifest, rows: rebuilt, folder };
}

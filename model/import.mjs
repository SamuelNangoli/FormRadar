import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { loadServerEnv } from "../server/env.mjs";
import { ApiError, createProvider } from "../server/data.mjs";
import { PRIVATE } from "./paths.mjs";
import { SEASONS, SCHEMA, DatasetError, digest, encode, privateDir, immutable, atomic, normalizeSeason, loadDataset } from "./dataset.mjs";

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export async function importHistory({ root = PRIVATE, provider, key, refresh = false, wait = pause, now = Date.now, log = console.log } = {}) {
  await privateDir(root);
  await privateDir(join(root, "raw"));
  let cache;
  try { cache = JSON.parse(await readFile(join(root, "cache.json"), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw new DatasetError("Historical cache index is unreadable; keep it for review or use a fresh private folder."); cache = {}; }
  const rows = [];
  const sources = [];
  let lastRequest = -Infinity;
  for (const season of SEASONS) {
    let bytes;
    let source = cache[season];
    if (source && !refresh) {
      if (!new RegExp(`^raw/PL-${season}-[a-f0-9]{64}\\.json$`).test(source.file)) throw new DatasetError("Invalid cache file path.");
      bytes = await readFile(join(root, source.file));
      if (digest(bytes) !== source.sha256) throw new DatasetError("Cached history failed its checksum. Review it or explicitly use --refresh.");
      log(`${season}/${String(season + 1).slice(2)}: reusing checked local cache.`);
    } else {
      const path = `/competitions/PL/matches?season=${season}&status=FINISHED`;
      let raw;
      for (let attempt = 0; attempt < 2; attempt++) {
        await wait(Math.max(0, 8_000 - (now() - lastRequest)));
        lastRequest = now();
        try { raw = (await provider.get(path, 0, (body) => body)).data; break; }
        catch (error) {
          if (attempt || !(error instanceof ApiError) || ![429, 502].includes(error.status) || error.retryAfter > 60) throw error;
          log(`Season ${season}: temporary provider failure; one bounded retry in ${Math.max(15, error.retryAfter)} seconds.`);
          await wait(Math.max(15, error.retryAfter) * 1000);
        }
      }
      bytes = Buffer.from(encode(raw));
      if (key && bytes.includes(Buffer.from(key.trim()))) throw new DatasetError("The provider response failed a credential isolation check; nothing was saved.");
      normalizeSeason(raw, season); // Reject incomplete or malformed seasons before caching them.
      const hash = digest(bytes);
      source = { season, file: `raw/PL-${season}-${hash}.json`, sha256: hash,
        sourcePath: path, fetchedAt: new Date(now()).toISOString(), testOnly: raw.testOnly === true };
      await immutable(join(root, source.file), bytes);
      cache[season] = source;
      await atomic(join(root, "cache.json"), encode(cache));
    }
    const checked = normalizeSeason(JSON.parse(bytes), season);
    sources.push({ ...source, ...checked.coverage, duplicates: checked.duplicates, excluded: checked.excluded });
    rows.push(...checked.rows);
    log(`Season ${season}: ${checked.rows.length} valid 90-minute results, 20 teams.`);
  }
  if (new Set(rows.map((row) => row.id)).size !== rows.length) throw new DatasetError("Match IDs repeat across seasons.");
  const normalized = encode(rows);
  const normalizedSha256 = digest(normalized);
  const version = digest(JSON.stringify([SCHEMA, normalizedSha256, ...sources.map((s) => s.sha256)]));
  const folder = join(root, "datasets", version);
  await privateDir(folder);
  await immutable(join(folder, "matches.json"), normalized);
  try { await readFile(join(folder, "manifest.json")); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    const code = await readFile(new URL("./dataset.mjs", import.meta.url));
    await immutable(join(folder, "manifest.json"), encode({ schemaVersion: SCHEMA, datasetVersion: version,
      provider: "football-data.org", competition: "PL", normalizedSha256, rows: rows.length,
      createdAt: new Date(now()).toISOString(), normalizerVersion: digest(code), sources,
      retrospectiveCorrectedData: true, testOnly: sources.some((source) => source.testOnly) }));
  }
  await atomic(join(root, "CURRENT"), version + "\n");
  return loadDataset(root);
}

async function main() {
  process.umask(0o077);
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--validate", "--refresh"].includes(arg)) || args.includes("--validate") && args.includes("--refresh"))
    throw new DatasetError("Use model:import [-- --refresh] or model:validate without other arguments.");
  if (args.includes("--validate")) {
    const data = await loadDataset(PRIVATE);
    console.log(`Dataset ${data.version}\nValidated ${data.rows.length} matches across 2023/24, 2024/25, 2025/26.\n${data.folder}`);
    return;
  }
  loadServerEnv();
  const key = process.env.FOOTBALL_DATA_API_KEY;
  const provider = createProvider({ key, baseUrl: process.env.FOOTBALL_DATA_BASE_URL || "https://api.football-data.org/v4", maxCalls: 6 });
  const data = await importHistory({ provider, key, refresh: args.includes("--refresh") });
  console.log(`Import complete: ${data.rows.length} results.\nDataset: ${data.version}\nNext: npm run model:validate`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error instanceof ApiError ? `${error.code}: ${error.message}` :
      error instanceof DatasetError ? error.message : "Could not validate/read/write private model data. No provider response or credentials are printed. Check folder access and rerun model:validate.");
    process.exitCode = 1;
  });

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, relative, extname, sep } from "node:path";
import { competitions } from "../shared/competitions.js";
import { createPredictions } from "./predictions.mjs";
import { createNews, newsTopics } from "./news.mjs";
import { createMatchInsights } from "./match-insights.mjs";
import {seasonYear,seasonList} from "./seasons.mjs";
import {
  ApiError,
  createProvider,
  matchView,
  teamStatistics,
  teamView,
  competitionView,
} from "./data.mjs";

const DAY = 86_400_000;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".woff2": "font/woff2",
};
const badInput = (message) => new ApiError(400, "INVALID_REQUEST", message);

function onlyParams(params, allowed) {
  for (const name of params.keys()) {
    if (!allowed.includes(name) || params.getAll(name).length !== 1)
      throw badInput("Unsupported or repeated query parameter.");
  }
}
function competition(params) {
  const code = params.get("competition") || "PL";
  if (!competitions.some((c) => c.code === code))
    throw badInput("Choose a supported competition.");
  return code;
}
function validDate(value) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value || "") &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
function dateShift(value, days) {
  return new Date(Date.parse(value) + days * DAY).toISOString().slice(0, 10);
}

export function createApp({
  key = process.env.FOOTBALL_DATA_API_KEY,
  baseUrl = process.env.FOOTBALL_DATA_BASE_URL || "https://api.football-data.org/v4",
  fetchImpl,
  now = Date.now,
  distDir,
  maxCalls,
  modelRoot,
  guardianKey = process.env.GUARDIAN_API_KEY,
  newsFetchImpl,
  lineupKey = process.env.API_FOOTBALL_KEY,
  lineupFetchImpl,
} = {}) {
  const provider = createProvider({ key, baseUrl, fetchImpl, now, maxCalls });
  const predictions = createPredictions({ root: modelRoot, provider, now });
  const news = createNews({key:guardianKey,fetchImpl:newsFetchImpl,now});
  const insights = createMatchInsights({provider,lineupKey,lineupFetchImpl,now,secrets:[key,guardianKey,lineupKey]});
  async function api(url) {
    const params = url.searchParams;
    if (url.pathname === "/api/config" || url.pathname === "/api/health") {
      return {
        configured: provider.configured,
        provider: "football-data.org",
        predictions: "experimental",
        predictionsApiVersion: 2,
        predictionCompetitions: ["PL","CL"],
        news: news.status(),
        matchInsightsVersion:1,
        seasonsApiVersion:1,
        lineupSourceConfigured:insights.lineupConfigured,
        scoresMayBeDelayed: true,
        competitions,
      };
    }
    if(url.pathname==="/api/seasons"){
      onlyParams(params,["competition"]);
      const code=competition(params);
      return provider.get(`/competitions/${code}`,900_000,seasonList);
    }
    const insightMatch=url.pathname.match(/^\/api\/matches\/([1-9]\d{0,6})\/(head-to-head|lineups)$/);
    if(insightMatch){onlyParams(params,insightMatch[2]==="lineups"?["view"]:[]);const view=params.get("view")||"reported";if(!["reported","possible"].includes(view))throw badInput("Choose reported or possible lineups.");return insightMatch[2]==="head-to-head"?insights.headToHead(Number(insightMatch[1])):insights.lineups(Number(insightMatch[1]),view==="possible");}
    if(url.pathname==="/api/news/status") {onlyParams(params,[]);return news.status();}
    if(url.pathname==="/api/news") {
      onlyParams(params,["competition","teamId","topic"]);
      const code=competition(params),topic=params.get("topic")||"all",id=params.get("teamId");
      if(!newsTopics.includes(topic)||id!==null&&!/^[1-9]\d{0,6}$/.test(id))throw badInput("Choose a valid news topic and team.");
      if(!news.status().configured)return news.get({competition:code,topic});
      let team=null;
      if(id!==null){const result=await provider.get(`/teams/${id}`,900_000,raw=>{
        const names=JSON.stringify([raw?.name,raw?.shortName]);
        if(raw?.id!==Number(id)||typeof raw.name!=="string"||!raw.name.trim()
          || [key,guardianKey].some(secret=>secret?.trim()&&names.includes(secret.trim())))throw new ApiError(502,"INVALID_PROVIDER_DATA","Could not identify that team for news filtering.");
        return {id:raw.id,name:raw.name,shortName:typeof raw.shortName==="string"?raw.shortName:null};
      });team=result.data;}
      return news.get({competition:code,topic,team});
    }
    if (url.pathname === "/api/model/status" || url.pathname === "/api/model/evaluation") {
      onlyParams(params, ["competition"]);
      const code = competition(params);
      return url.pathname.endsWith("/evaluation") ? predictions.evaluation(code) : predictions.status(code);
    }
    const predictionMatch = url.pathname.match(/^\/api\/predictions\/([1-9]\d{0,6})(\/history)?$/);
    if (predictionMatch) {
      onlyParams(params, predictionMatch[2] ? [] : ["competition"]);
      return predictionMatch[2] ? predictions.history(Number(predictionMatch[1])) : predictions.predict(Number(predictionMatch[1]),competition(params));
    }
    if (["/api/matches", "/api/fixtures", "/api/results"].includes(url.pathname)) {
      onlyParams(params, ["competition", "dateFrom", "dateTo", "season"]);
      const code = competition(params);
      const year = seasonYear(params,now());
      const fullSeason = year !== null && !params.has("dateFrom") && !params.has("dateTo");
      const today = new Date(now()).toISOString().slice(0, 10);
      const results = url.pathname === "/api/results";
      const fixtures = url.pathname === "/api/fixtures";
      const from = params.get("dateFrom") ||
        (results ? dateShift(today, -6) : today);
      const to = params.get("dateTo") ||
        (results ? today : fixtures ? dateShift(from, 6) : from);
      if (!fullSeason && (
        !validDate(from) ||
        !validDate(to) ||
        to < from ||
        (Date.parse(to) - Date.parse(from)) / DAY > 30
      ))
        throw badInput("Use valid dates in order, covering at most 31 days.");
      // Request a covering range, then enforce the UI's inclusive dates locally.
      const query = new URLSearchParams(fullSeason ? {} : {
        dateFrom: from,
        dateTo: dateShift(to, 1),
      });
      if(year!==null)query.set("season",String(year));
      const statuses = results ? ["FINISHED"]
        : fixtures ? ["SCHEDULED", "TIMED"] : null;
      if (statuses) query.set("status", statuses.join(","));
      return provider.get(
        `/competitions/${code}/matches?${query}`,
        fullSeason ? 900_000 : results ? 300_000 : 60_000,
        (raw) => {
          if (
            !Array.isArray(raw?.matches) || raw.matches.length>1000 || raw.matches.some((m) =>
              !m || !Number.isInteger(m.id) || typeof m.utcDate !== "string" ||
              !Number.isFinite(Date.parse(m.utcDate)) || typeof m.status !== "string",
            )
          )
            throw new ApiError(
              502,
              "INVALID_PROVIDER_DATA",
              "The provider returned an invalid fixture list.",
            );
          if(year!==null&&(raw.filters?.season!==undefined&&Number(raw.filters.season)!==year||raw.matches.some(m=>m.season?.startDate!==undefined&&(!validDate(m.season.startDate)||Number(m.season.startDate.slice(0,4))!==year))))throw new ApiError(502,"INVALID_PROVIDER_DATA","The provider returned a different season. No results were substituted.");
          return {
            competition: code,
            competitionInfo: competitionView(raw.competition, code),
            season:year,
            fullSeason,
            dateFrom:fullSeason?null:from,
            dateTo:fullSeason?null:to,
            matches: raw.matches
              .filter((m) => (fullSeason || m.utcDate.slice(0,10) >= from && m.utcDate.slice(0,10) <= to)
                && (!statuses || statuses.includes(m.status)))
              .map((m) =>
                matchView({
                  ...m,
                  competition: m.competition || competitionView(raw.competition, code),
                }),
              )
              .sort((a, b) =>
                results ? b.utcDate.localeCompare(a.utcDate)
                  : a.utcDate.localeCompare(b.utcDate),
              ),
          };
        },
      );
    }
    if (url.pathname === "/api/standings") {
      onlyParams(params, ["competition","season"]);
      const code = competition(params);
      const year=seasonYear(params,now());
      return provider.get(`/competitions/${code}/standings${year===null?"":`?season=${year}`}`, 900_000, (raw) => {
        if (
          !Array.isArray(raw?.standings) || raw.standings.some((s) =>
            !s || (s.type === "TOTAL" &&
              (!Array.isArray(s.table) || s.table.some((row) => !row))),
          )
        )
          throw new ApiError(
            502,
            "INVALID_PROVIDER_DATA",
            "The provider returned an invalid league table.",
          );
        if(year!==null&&(!validDate(raw.season?.startDate)||Number(raw.season.startDate.slice(0,4))!==year))throw new ApiError(502,"INVALID_PROVIDER_DATA","The provider returned a different season's table. No table was substituted.");
        return {
          competition: code,
          competitionInfo: competitionView(raw.competition, code),
          season: {
            startDate: raw.season?.startDate,
            endDate: raw.season?.endDate,
            matchday: raw.season?.currentMatchday,
          },
          standings: raw.standings
            .filter((s) => s.type === "TOTAL")
            .map((s) => ({
              stage: s.stage,
              group: s.group,
              table: s.table.map((row) => ({
                position: row.position,
                team: teamView(row.team),
                played: row.playedGames,
                won: row.won,
                drawn: row.draw,
                lost: row.lost,
                points: row.points,
                goalsFor: row.goalsFor,
                goalsAgainst: row.goalsAgainst,
                goalDifference: row.goalDifference,
              })),
            })),
        };
      });
    }
    const teamMatch = url.pathname.match(
      /^\/api\/teams\/([1-9]\d{0,6})\/stats$/,
    );
    if (teamMatch) {
      onlyParams(params, []);
      const today = new Date(now()).toISOString().slice(0, 10);
      const period = { from: dateShift(today, -89), to: today, days: 90 };
      const query = new URLSearchParams({
        dateFrom: period.from,
        dateTo: dateShift(today, 1),
        status: "FINISHED",
        limit: "500",
      });
      return provider.get(
        `/teams/${teamMatch[1]}/matches?${query}`,
        900_000,
        (raw) => {
          if (!Array.isArray(raw?.matches))
            throw new ApiError(
              502,
              "INVALID_PROVIDER_DATA",
              "The provider returned invalid team results.",
            );
          return teamStatistics(raw.matches, Number(teamMatch[1]), period);
        },
      );
    }
    throw new ApiError(404, "NOT_FOUND", "This API endpoint does not exist.");
  }

  function json(res, status, body, retryAfter) {
    if (retryAfter) res.setHeader("Retry-After", String(retryAfter));
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  }
  async function handler(req, res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    try {
      const url = new URL(req.url, "http://localhost");
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.setHeader("Allow", "GET, HEAD");
        throw new ApiError(
          405,
          "METHOD_NOT_ALLOWED",
          "Only read requests are supported.",
        );
      }
      if (url.pathname.startsWith("/api/")) {
        const result = await api(url);
        if (req.method === "HEAD") {
          res.writeHead(200);
          res.end();
        } else json(res, 200, result);
        return;
      }
      if (!distDir)
        throw new ApiError(
          404,
          "NOT_FOUND",
          "Use the Vite frontend address during development.",
        );
      const decoded = decodeURIComponent(url.pathname);
      if (decoded.split("/").some((part) => part.startsWith(".")))
        throw new ApiError(404, "NOT_FOUND", "File not found.");
      const root = resolve(distDir);
      let target = resolve(root, `.${decoded}`);
      const rel = relative(root, target);
      if (rel === ".." || rel.startsWith(`..${sep}`) || rel.startsWith(sep))
        throw new ApiError(404, "NOT_FOUND", "File not found.");
      try {
        if (!(await stat(target)).isFile())
          target = resolve(root, "index.html");
      } catch {
        if (extname(decoded))
          throw new ApiError(404, "NOT_FOUND", "File not found.");
        target = resolve(root, "index.html");
      }
      let content;
      try {
        content = await readFile(target);
      } catch {
        throw new ApiError(
          503,
          "BUILD_REQUIRED",
          "Build the frontend first with npm run build.",
        );
      }
      res.writeHead(200, {
        "Content-Type": MIME[extname(target)] || "application/octet-stream",
        "Cache-Control": target.includes(`${sep}assets${sep}`)
          ? "public, max-age=31536000, immutable"
          : "no-cache",
      });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch (error) {
      const safe =
        error instanceof ApiError
          ? error
          : new ApiError(
              500,
              "INTERNAL_ERROR",
              "FormRadar could not complete this request.",
            );
      json(
        res,
        safe.status,
        {
          error: {
            code: safe.code,
            message: safe.message,
            ...(safe.retryAfter ? { retryAfter: safe.retryAfter } : {}),
          },
        },
        safe.retryAfter,
      );
    }
  }
  return { handler, configured: provider.configured };
}

export function listen(app, { port, host = "127.0.0.1" }) {
  const server = createServer(app.handler);
  return new Promise((resolveServer, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolveServer(server));
  });
}

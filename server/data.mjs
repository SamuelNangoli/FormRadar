import { competitions } from "../shared/competitions.js";
import { FOOTBALL_PROVIDER, safeFootballImageUrl } from "../shared/media.js";

export class ApiError extends Error {
  constructor(status, code, message, retryAfter = 0) {
    super(message);
    Object.assign(this, { status, code, retryAfter });
  }
}

export function teamView(team) {
  team ||= {};
  return {
    provider: FOOTBALL_PROVIDER,
    id: team.id ?? null,
    name: team.shortName || team.name || "To be confirmed",
    code: team.tla || "TBC",
    crest: safeFootballImageUrl(team.crest),
  };
}

export function competitionView(competition, fallbackCode) {
  competition ||= {};
  const id = Number.isInteger(competition.id) ? competition.id : null;
  const code = competition.code || fallbackCode;
  const known = competitions.find((item) =>
    item.code === code && (id === null || item.id === id),
  );
  return {
    provider: FOOTBALL_PROVIDER,
    id: id ?? known?.id ?? null,
    code: code || null,
    name: competition.name || known?.name || "Competition",
    emblem: safeFootballImageUrl(competition.emblem) || known?.emblem || null,
  };
}

function scorePair(value) {
  return {
    home: Number.isInteger(value?.home) && value.home >= 0 ? value.home : null,
    away: Number.isInteger(value?.away) && value.away >= 0 ? value.away : null,
  };
}

function playingScore(score) {
  const full = scorePair(score?.fullTime);
  if (score?.duration !== "PENALTY_SHOOTOUT") return full;
  const penalties = scorePair(score.penalties);
  // This provider's fullTime includes the shootout tally. Remove it before
  // displaying on-pitch goals or calculating goals/form statistics.
  if (
    [full.home, full.away, penalties.home, penalties.away].every(
      Number.isInteger,
    )
  ) {
    return scorePair({
      home: full.home - penalties.home,
      away: full.away - penalties.away,
    });
  }
  const regular = scorePair(score.regularTime);
  const extra = scorePair(score.extraTime);
  if (
    [regular.home, regular.away, extra.home, extra.away].every(Number.isInteger)
  ) {
    return { home: regular.home + extra.home, away: regular.away + extra.away };
  }
  // Avoid inventing a regulation score if the necessary splits are unavailable.
  return { home: null, away: null };
}

export function matchView(match) {
  return {
    id: match.id,
    utcDate: match.utcDate,
    status: match.status,
    matchday: match.matchday ?? null,
    stage: typeof match.stage === 'string' ? match.stage : null,
    minute: match.minute ?? null,
    competition: competitionView(match.competition),
    homeTeam: teamView(match.homeTeam),
    awayTeam: teamView(match.awayTeam),
    score: {
      ...playingScore(match.score),
      winner: match.score?.winner ?? null,
      duration: match.score?.duration ?? null,
      penalties: scorePair(match.score?.penalties),
    },
  };
}

export function teamStatistics(matches, teamId, period) {
  const eligible = matches
    .filter(
      (m) =>
        m.status === "FINISHED" &&
        (m.homeTeam?.id === teamId || m.awayTeam?.id === teamId),
    )
    .sort((a, b) => a.utcDate.localeCompare(b.utcDate));
  const results = eligible.flatMap((m) => {
    const home = m.homeTeam.id === teamId;
    const playing = playingScore(m.score);
    const gf = playing[home ? "home" : "away"];
    const ga = playing[home ? "away" : "home"];
    if (!Number.isInteger(gf) || !Number.isInteger(ga)) return [];
    // Goal-based W/D/L intentionally treats drawn games settled on penalties as draws.
    return [
      {
        ...matchView(m),
        goalsFor: gf,
        goalsAgainst: ga,
        outcome: gf > ga ? "W" : gf < ga ? "L" : "D",
      },
    ];
  });
  const count = results.length;
  const goalsFor = results.reduce((sum, m) => sum + m.goalsFor, 0);
  const goalsAgainst = results.reduce((sum, m) => sum + m.goalsAgainst, 0);
  return {
    teamId,
    period,
    played: count,
    excluded: eligible.length - count,
    won: results.filter((m) => m.outcome === "W").length,
    drawn: results.filter((m) => m.outcome === "D").length,
    lost: results.filter((m) => m.outcome === "L").length,
    goalsFor,
    goalsAgainst,
    goalsPerMatch: count ? Number((goalsFor / count).toFixed(2)) : null,
    concededPerMatch: count ? Number((goalsAgainst / count).toFixed(2)) : null,
    cleanSheets: results.filter((m) => m.goalsAgainst === 0).length,
    form: results.slice(-5).map((m) => m.outcome),
    recentMatches: results.slice(-5).reverse(),
  };
}

export function createProvider({
  key,
  baseUrl = "https://api.football-data.org/v4",
  fetchImpl = fetch,
  now = Date.now,
  maxCalls = 9,
  cacheLimit = 200,
  cacheVersion = 1,
  sharedStore,
} = {}) {
  // Never send credentials to a configurable third-party host or follow redirects.
  let base;
  try {
    const parsed = new URL(baseUrl);
    if (
      parsed.origin !== "https://api.football-data.org" ||
      parsed.pathname.replace(/\/$/, "") !== "/v4" ||
      parsed.username || parsed.password || parsed.search || parsed.hash
    )
      throw new Error();
    base = `${parsed.origin}/v4`;
  } catch {
    throw new ApiError(
      503,
      "INVALID_BASE_URL",
      "Set FOOTBALL_DATA_BASE_URL to https://api.football-data.org/v4 in .env and restart FormRadar.",
    );
  }
  const cache = new Map();
  const pending = new Map();
  const calls = [];
  let cooldownUntil = 0;
  let cooldownError;
  const configured = Boolean(
    key?.trim() && !/^(your[_ -]|replace|paste)/i.test(key.trim()),
  );

  async function request(path) {
    const time = now();
    if (time < cooldownUntil)
      throw new ApiError(
        cooldownError.status,
        cooldownError.code,
        cooldownError.message,
        Math.ceil((cooldownUntil - time) / 1000),
      );
    while (calls.length && time - calls[0] >= 60_000) calls.shift();
    if (calls.length >= maxCalls)
      throw new ApiError(
        429,
        "RATE_LIMITED",
        "The shared football request budget is busy. Please retry shortly.",
        Math.max(1, Math.ceil((60_000 - time + calls[0]) / 1000)),
      );
    calls.push(time);
    if(sharedStore){
      let budget;
      try{budget=await sharedStore.budget('football',[{window:60000,limit:maxCalls}]);}
      catch{throw new ApiError(503,"CLOUD_STORAGE_UNAVAILABLE","The shared football request budget could not be checked. Retry shortly.");}
      if(!budget.allowed)throw new ApiError(429,"RATE_LIMITED","The shared football request budget is busy. Please retry shortly.",budget.retryAfter);
    }
    let response;
    try {
      const target = new URL(`${base}${path}`);
      if (
        target.origin !== "https://api.football-data.org" ||
        !target.pathname.startsWith("/v4/")
      )
        throw new Error();
      response = await fetchImpl(target.href, {
        headers: { "X-Auth-Token": key.trim(), Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
        redirect: "error",
      });
    } catch {
      throw coolDown(new ApiError(
        502,
        "PROVIDER_UNAVAILABLE",
        "Could not reach football-data.org. Check the connection and retry.",
        15,
      ));
    }
    if (!response.ok) {
      // Do not forward upstream bodies: they may contain request or account details.
      if (response.status === 401) {
        throw coolDown(new ApiError(
          401,
          "INVALID_API_KEY",
          "The football API token was rejected. Check .env and restart the server.",
          30,
        ));
      }
      if (response.status === 403)
        throw new ApiError(
          403,
          "PLAN_RESTRICTED",
          "Your football-data.org plan does not allow this data. Check the token and competition coverage.",
        );
      if (response.status === 404)
        throw new ApiError(
          404,
          "DATA_UNAVAILABLE",
          "The provider has no data for this team or competition yet.",
        );
      if (response.status === 429) {
        const retry = response.headers.get("retry-after");
        const seconds = /^\d+$/.test(retry || "")
          ? Number(retry)
          : (Date.parse(retry) - now()) / 1000;
        const reset = Number(response.headers.get("x-requestcounter-reset"));
        const delay = Math.ceil(Math.max(
          60,
          Number.isFinite(seconds) ? seconds : 0,
          Number.isFinite(reset) ? reset : 0,
        ));
        throw coolDown(new ApiError(
          429,
          "RATE_LIMITED",
          "football-data.org has reached its request limit. Cached data will be used where available.",
          delay,
        ));
      }
      throw coolDown(new ApiError(
        502,
        "PROVIDER_UNAVAILABLE",
        "The football provider could not return data. Please try again shortly.",
        15,
      ));
    }
    try {
      const body=await response.json();
      if(JSON.stringify(body).includes(key.trim()))throw new Error();
      return body;
    } catch {
      throw coolDown(new ApiError(
        502,
        "INVALID_PROVIDER_DATA",
        "The football provider returned an unreadable response.",
        15,
      ));
    }
  }

  function coolDown(error) {
    cooldownUntil = now() + error.retryAfter * 1000;
    cooldownError = error;
    return error;
  }

  async function get(path, ttl, transform) {
    if (!configured)
      throw new ApiError(
        503,
        "CONFIGURATION_REQUIRED",
        "Add FOOTBALL_DATA_API_KEY to the project .env file and restart FormRadar.",
      );
    let entry = cache.get(path);
    const envelope = (item, cacheState, warning) => ({
      data: item.data,
      meta: {
        provider: "football-data.org",
        fetchedAt: new Date(item.at).toISOString(),
        cache: cacheState,
        stale: cacheState === "stale",
        scoresMayBeDelayed: true,
        ...(warning ? { warning } : {}),
      },
    });
    if (entry && now() - entry.at < ttl) return envelope(entry, "hit");
    if (pending.has(path)) return pending.get(path);
    const work = (async () => {
      try {
        if(sharedStore){
          let stored;
          try{stored=await sharedStore.readProvider(cacheVersion===1?path:`v${cacheVersion}:${path}`);}catch{throw new ApiError(503,"CLOUD_STORAGE_UNAVAILABLE","The shared football cache could not be reached. Retry shortly.");}
          if(stored&&Number.isFinite(stored.at)&&stored.at<=now()&&now()-stored.at<=86_400_000&&Object.hasOwn(stored,'data')){
            if(!entry||stored.at>entry.at)entry=stored;
            if(now()-entry.at<ttl){if(cache.size>=cacheLimit&&!cache.has(path))cache.delete(cache.keys().next().value);cache.set(path,entry);return envelope(entry,"hit");}
          }
        }
        const item = { data: transform(await request(path)), at: now() };
        if (cache.size >= cacheLimit && !cache.has(path))
          cache.delete(cache.keys().next().value);
        cache.set(path, item);
        if(sharedStore)await sharedStore.writeProvider(cacheVersion===1?path:`v${cacheVersion}:${path}`,item).catch(()=>{});
        return envelope(item, "miss");
      } catch (error) {
        if (
          entry &&
          now() - entry.at <= 86_400_000 &&
          [429, 502].includes(error.status)
        )
          return envelope(entry, "stale", error.message);
        throw error;
      } finally {
        pending.delete(path);
      }
    })();
    pending.set(path, work);
    return work;
  }
  return { configured, get };
}

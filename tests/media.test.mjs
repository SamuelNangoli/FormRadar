import test from "node:test";
import assert from "node:assert/strict";
import { safeFootballImageUrl, entityImage, FOOTBALL_PROVIDER } from "../shared/media.js";
import { teamView, competitionView, matchView, teamStatistics } from "../server/data.mjs";

test("media accepts only public HTTPS provider image files without credential/query forwarding", () => {
  for (const value of [
    "https://crests.football-data.org/57.svg",
    "https://crests.football-data.org/PL.png",
    "https://crests.football-data.org/laliga.png",
  ]) assert.equal(safeFootballImageUrl(value), value);
  for (const value of [
    null, undefined, {}, "", "javascript:alert(1)", "data:image/svg+xml,<svg/>",
    "http://crests.football-data.org/57.svg", "//crests.football-data.org/57.svg",
    "https://example.com/57.svg", "https://crests.football-data.org.example.com/57.svg",
    "https://secret@crests.football-data.org/57.svg",
    "https://crests.football-data.org/57.svg?token=private",
    "https://crests.football-data.org/57.svg#private", "https://crests.football-data.org/57.html",
    "https://crests.football-data.org/%2f57.svg", "https://crests.football-data.org:8080/57.svg",
  ]) assert.equal(safeFootballImageUrl(value), null);
});

test("image identity uses the original provider and integer entity ID; demo and foreign IDs stay initials", () => {
  const team = { provider: FOOTBALL_PROVIDER, id: 57, crest: "https://crests.football-data.org/57.svg" };
  assert.equal(entityImage(team, "team"), team.crest);
  for (const identity of [
    { ...team, provider: "demo" }, { ...team, provider: "api-football" },
    { ...team, id: "57" }, { ...team, id: null }, { ...team, id: -1 },
  ]) assert.equal(entityImage(identity, "team"), null);
  assert.equal(entityImage({ provider: FOOTBALL_PROVIDER, id: 57 }, "team"), null,
    "No guessed filename is constructed from a team ID");
});

test("normalization retains valid team crests and competition emblems, including recent team results", () => {
  const home = { id: 57, shortName: "Arsenal", tla: "ARS", crest: "https://crests.football-data.org/57.svg" };
  const away = { id: 64, shortName: "Liverpool", tla: "LIV", crest: "https://example.com/64.png?secret=value" };
  const fixture = {
    id: 1, status: "FINISHED", utcDate: "2026-11-01T12:00:00Z",
    homeTeam: home, awayTeam: away,
    competition: { id: 2021, code: "PL", name: "Premier League", emblem: "https://crests.football-data.org/PL.png" },
    score: { fullTime: { home: 1, away: 0 } },
  };
  const view = matchView(fixture);
  assert.equal(view.homeTeam.crest, home.crest);
  assert.equal(view.homeTeam.provider, FOOTBALL_PROVIDER);
  assert.equal(view.awayTeam.crest, null);
  assert.equal(view.competition.id, 2021);
  assert.equal(view.competition.emblem, fixture.competition.emblem);
  assert.equal(teamStatistics([fixture], 57, {}).recentMatches[0].homeTeam.crest, home.crest);
  assert.equal(teamView(null).crest, null);
});

test("competition fallback maps only matching provider IDs and supported league codes", () => {
  assert.equal(competitionView(null, "PL").id, 2021);
  assert.equal(competitionView({ id: 9999, code: "PL" }).emblem, null);
  assert.equal(competitionView({ code: "UNKNOWN" }).emblem, null);
  assert.equal(competitionView({ code: "SA" }).emblem, "https://crests.football-data.org/c111.png");
});

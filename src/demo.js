// Explicitly opt-in, synthetic examples. Never used as a fallback for failed API calls.
import { competitions } from "../shared/competitions.js";
import { isoDay } from "./format.js";

const team = (id, name, code) => ({ id, name, code });
const pairs = {
  PL: [
    [team(57, "Arsenal", "ARS"), team(64, "Liverpool", "LIV")],
    [team(61, "Chelsea", "CHE"), team(67, "Newcastle", "NEW")],
    [team(65, "Manchester City", "MCI"), team(397, "Brighton", "BHA")],
  ],
  CL: [[team(81, "Barcelona", "BAR"), team(5, "Bayern Munich", "BAY")]],
  PD: [[team(86, "Real Madrid", "RMA"), team(78, "Atlético Madrid", "ATM")]],
  BL1: [[team(5, "Bayern Munich", "BAY"), team(4, "Dortmund", "BVB")]],
  SA: [[team(108, "Inter", "INT"), team(109, "Juventus", "JUV")]],
  FL1: [
    [team(524, "Paris Saint-Germain", "PSG"), team(516, "Marseille", "OM")],
  ],
};
export function demoMatches(code) {
  return (pairs[code] || []).map(([homeTeam, awayTeam], i) => ({
    id: `${code}-demo-${i}`,
    competition: { ...competitions.find((c) => c.code === code), provider: "demo", emblem: null },
    homeTeam,
    awayTeam,
    utcDate: `${isoDay(i - 1)}T16:30:00Z`,
    status: i === 0 ? "FINISHED" : "TIMED",
    score: { home: i === 0 ? 2 : null, away: i === 0 ? 1 : null },
  }));
}
export function demoStandings(code) {
  if (!pairs[code]) return [];
  return [
    {
      stage: "SYNTHETIC SAMPLE",
      group: null,
      table: pairs[code].flat().map((t, i) => ({
        team: t,
        position: i + 1,
        played: 10,
        won: 8 - i,
        drawn: 1,
        lost: 1 + i,
        points: 25 - 3 * i,
        goalsFor: 24 - i,
        goalsAgainst: 8 + i,
        goalDifference: 16 - 2 * i,
      })),
    },
  ];
}
export const demoStats = (id) => ({
  teamId: id,
  played: 10,
  won: 6,
  drawn: 2,
  lost: 2,
  goalsFor: 19,
  goalsAgainst: 10,
  goalsPerMatch: 1.9,
  concededPerMatch: 1,
  cleanSheets: 3,
  form: ["W", "D", "L", "W", "W"],
  excluded: 0,
  recentMatches: [],
  period: { from: isoDay(-89), to: isoDay(), days: 90 },
});

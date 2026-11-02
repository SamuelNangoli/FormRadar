import { FOOTBALL_PROVIDER } from "./media.js";

// IDs and emblem URLs verified against the existing provider's competition feed.
// Keep these mappings provider-specific; codes/IDs from other feeds may differ.
export const competitions = [
  { id: 2021, code: "PL", name: "Premier League", area: "England", symbol: "EN", emblem: "https://crests.football-data.org/PL.png" },
  { id: 2001, code: "CL", name: "Champions League", area: "Europe", symbol: "EU", emblem: "https://crests.football-data.org/CL.png" },
  { id: 2014, code: "PD", name: "La Liga", area: "Spain", symbol: "ES", emblem: "https://crests.football-data.org/laliga.png" },
  { id: 2002, code: "BL1", name: "Bundesliga", area: "Germany", symbol: "DE", emblem: "https://crests.football-data.org/BL1.png" },
  { id: 2019, code: "SA", name: "Serie A", area: "Italy", symbol: "IT", emblem: "https://crests.football-data.org/c111.png" },
  { id: 2015, code: "FL1", name: "Ligue 1", area: "France", symbol: "FR", emblem: "https://crests.football-data.org/FL1.png" },
].map((competition) => ({ ...competition, provider: FOOTBALL_PROVIDER }));

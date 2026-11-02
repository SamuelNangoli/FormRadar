# News Radar and next development stages

Updated 2 November 2026. Guardian news is connected locally. Authentication and player-data integration below are a roadmap, not completed features.

Starting-lineup display and labelled recent-XI references have since been implemented; see [match information and heat map setup](match-insights.md). The connected API-Football Free plan excludes the current season, so current lineups show a coverage message. Player profiles, structured injuries and player-form metrics remain future work.

## News Radar

Set `GUARDIAN_API_KEY` in the existing parent `FormRadar/.env` or the app `.env`, then restart the server. Host > app `.env` > parent `.env` precedence is unchanged. The key stays on the backend and is removed from offline training environments. The fixed Guardian HTTPS request carries its API key; request URLs, credentials and upstream error bodies are never logged or returned to the browser.

Choose a competition, optionally a team from its standings, and latest reporting, availability, lineups or transfers. Team names are resolved from Football-Data.org IDs on the backend. Team searches span competitions. A name or injury-keyword match does not establish a confirmed absence. Cards show the publisher, headline, original link and publication time; full article bodies and images are not copied. No article changes the model probabilities.

`GET /api/news/status` exposes configuration status only. `GET /api/news?competition=CL&teamId=66&topic=injuries` accepts bounded filters, not arbitrary URLs. Results cache for ten minutes and coalesce concurrent calls. A short bounded queue paces quick filter changes. Temporary failures can use explicitly labelled cached headlines up to six hours old; authentication errors do not use this fallback. Local budgets leave margin below the [Guardian developer limits](https://open-platform.theguardian.com/access/). Other apps share the key’s provider quota.

The live check returned 20 CL articles; a team/availability query returned a successful normalized response too. These are dated checks, not continuous coverage guarantees. Twelve competitions are now listed from checked Football-Data.org TIER_ONE metadata. Fixture/table access still depends on the account and season; evaluated forecasts cover PL and CL league phase only.

## Authentication next

Recommended: [Supabase Auth](https://supabase.com/docs/guides/auth) and Postgres. Begin with account creation, email verification, sign-in, password reset and sign-out; add Google sign-in if wanted. Validate sessions on server data routes, not only in the menu. Store profiles, favourite teams, preferences and user-owned forecast bookmarks with database access policies. Keep administrator and service credentials on the server. Public hosting, email delivery and appropriate commercial data access are later setup steps. No auth service or database has been provisioned yet.

## Player bio, availability and form

Evaluate one structured provider before buying or combining feeds. [API-Football’s official guide](https://www.api-football.com/news/post/how-to-get-started-with-api-football-the-complete-beginners-guide) documents profiles, per-match player statistics, lineups, injuries and sidelined history. Check [current competition/season coverage](https://www.api-football.com/coverage/) first; the [free plan](https://www.api-football.com/pricing) has limited seasons and a small daily quota. Sportmonks is another candidate to compare against the exact fields and rights needed.

Maintain verified mappings between providers’ team, player and fixture IDs. Display position, nationality, age and available bio fields with timestamps. Report availability as injured, suspended, doubtful, available or unknown; do not invent a medical fitness percentage from headlines or appearances. Recent form can use starts, minutes and position-appropriate per-90 statistics over a declared last-five/last-ten sample. Show missing or small samples. Player photos need appropriate media rights.

## Getting more out of the models

1. Join actual outcomes to prospective pre-kickoff forecasts. Track log loss, Brier, calibration, sample sizes and model versions. Add walk-forward stability and uncertainty analysis; one held-out season is limited evidence.
2. Build historical domestic form, opponent-strength, home/away and rest-day features available before kickoff. Adjust for league strength when mixing domestic competitions for CL. Consider xG only where licensed and historically reconstructible.
3. Benchmark Elo and Dixon–Coles candidates against the current Poisson and frequency baselines on identical chronological splits. Complexity alone is not improvement.
4. Add timestamped structured availability and confirmed lineups. A future news signal needs identified teams/players, evidence checks, rights for the intended analysis and separate evaluation. Guardian developer access is non-commercial; commercial or automated analysis needs appropriate permission. News sentiment alone should not move percentages.
5. Add scheduled refreshes, model-health monitoring, stale-data alerts and shared transactional forecast storage when moving to multiple users. These are future work, not installed background jobs.

Premier League fixtures, scores and standings are already supplied by Football-Data.org. Another provider may add timeliness or player detail, but an additional API does not itself improve forecast accuracy. Keep a consistent primary score feed, record provenance and handle conflicts deliberately.

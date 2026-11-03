# Overview news and gameweeks

Updated 3 November 2026.

Overview now leads with the latest four Guardian football stories across competitions. Cards contain the publisher's supplied thumbnail, headline, publication time and a link to the original article. News Radar also shows those thumbnails. A missing or broken image has a labelled placeholder; unrelated stock pictures and synthetic news are not substituted. Only headline metadata and thumbnail URLs are requested, not article bodies. Image URLs are restricted to HTTPS Guardian image hosts. The existing server-only GUARDIAN_API_KEY is used; no additional key or Vercel setting is required for this update.

The separate Fabrizio Romano card opens https://x.com/FabrizioRomano in a new tab. This is the free profile-link option selected by the owner. It performs no X API requests, imports no posts and requires no X developer token or paid credits. Guardian reporting and profile links do not change experimental model percentages.

## All matches

All matches uses the provider's gameweek/matchday and competition phase. It no longer combines fixtures from a rolling date window. Previous, next and the round selector navigate the available rounds; Current gameweek resets the selection. Historical seasons offer Latest gameweek. PL gameweeks normally contain ten fixtures; the app retains the actual available count rather than truncating other competitions to ten.

A moved, postponed or cancelled fixture stays in its provider-assigned round and retains its status. A rescheduled date cannot reorder the numerical gameweek selector. Tournament phases remain separate even when they use the same matchday number. Missing round information is reported instead of inventing a grouping. Team search still narrows the selected gameweek. In play, Upcoming and Results keep their existing date/season filters. Selecting a different season or competition clears the prior round selection. Phone match links and Back to matches preserve the exact gameweek along with season, search and filters.

`GET /api/gameweek?competition=PL` selects the provider's current round (or an active round). Add `season=2025` for an archive and `round=REGULAR_SEASON:38` for a specific round. Unknown, repeated and malformed query parameters are rejected. Missing selected rounds return a controlled error with a reset option in the interface.

The backend loads a bounded full-season schedule through the existing private provider cache, sends only the selected round's fixtures to the browser, and includes compact metadata for other rounds. Current schedules use a 60-second cache, archives fifteen minutes. Existing rate budgets and bounded, labelled stale responses apply. The shared football cache uses a new response revision because older cache entries omitted competition phases; models and stored forecasts are preserved.

## Verification

81 Node tests, 9 Python model tests and the production build passed. New regression tests cover round identity/counts, rescheduled dates, tournament phases, cache compatibility, historical season isolation, malformed requests, gameweek preservation in phone links, and trusted/missing thumbnail metadata. API tests use injected synthetic providers without consuming real API quotas.

Real-feed checks returned ten fixtures in PL gameweek 10, eighteen in Champions League league-stage matchday 4, and twenty Guardian football stories with supplied thumbnail URLs. The browser loaded all four Overview images and verified the free profile link. Desktop and 320/390 phone layouts were checked in light/dark appearances without document overflow. Historical 2025/26 PL All matches showed gameweek 38 with ten fixtures, including Sunderland 2–1 Chelsea.

References: [Football-Data.org competition match filters](https://docs.football-data.org/general/v4/competition.html), [Guardian Open Platform documentation](https://open-platform.theguardian.com/documentation/).

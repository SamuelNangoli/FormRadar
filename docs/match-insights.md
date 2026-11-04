# Match information and scoreline heat map

## Player information update on 3 November 2026

Match information now includes **Player form** for recent provider ratings,
starts, minutes, goals, assists and reported injuries or suspensions. The
**Possible XI** view uses recent starts, current-squad membership, formation and
reported availability where coverage permits. A provider-reported XI takes
precedence. Read [Player form availability and possible lineups](player-context.md)
for data requirements, coverage limits and the separate pre-kickoff model feature
capture command. The current Poisson probabilities do not yet use player inputs.

The historical `lineups?view=possible` endpoint below retains its recent-XI
reference behavior for compatibility. The updated Possible XI interface uses
`/api/matches/:id/player-context` for availability-aware candidate selections.

Updated 2 November 2026. The interface uses Inter for body text and numbers and Poppins for display headings, loaded through Google Fonts with system fallbacks.

## Find the new views

On a phone, tap a fixture in Overview, Live Scores or Predictions to open its information in a new browser tab. The selected fixture's score, club crests and full date appear first. Choose **Match info** for **Head to head** or **Lineups** (labelled **Lineups used** for completed matches), **Predictions** for estimates/history, or **Team form** for the current 90-day summary. **Back to matches** restores the competition, season, filters and search. The original list tab stays open, and match links can be reloaded or shared.

Desktop selection retains the inline match/prediction panel with **Match information** beneath it. Open **Predictions → Experimental model** for the interactive scoreline heat map below an eligible forecast. Completed matches never receive newly generated retrospective forecasts; their dedicated page shows only actual saved pre-match history.

`GET /api/matches/:id` retrieves the exact selected fixture through the existing private provider connection and 60-second cache. Direct match pages do not load a full season or off-screen team panels. An invalid, missing or unavailable fixture displays an explicit message instead of silently selecting another match. The hash-based match link works with the existing single-project Vercel configuration.

Stop an older app terminal with Ctrl+C and restart from the nested application directory:

```bash
cd "$HOME/Desktop/Projects/FormRadar/formradar-v0.1/formradar"
npm run dev:cl
```

This prepares the daily Champions League model before starting the app. Use `npm run model:prepare-current` separately to refresh PL. A model expiring at UTC midnight needs a new daily preparation. Refresh data alone does not reload backend source or newly added environment variables.

## Head to head

`GET /api/matches/:id/head-to-head` retrieves Football-Data.org's latest returned meetings. Only completed matches between the selected two provider team IDs, strictly before both the selected kickoff and the current time, are included. The selected match and duplicate IDs are excluded. The list is capped at ten and sorted newest first. Goal-based win/draw counts include extra time and exclude shootout tallies; they describe the available sample, not all-time records. Retrieval time and stale-data warnings are displayed.

The fixture is checked through the same 60-second cache used by predictions; history caches for fifteen minutes. Existing Football-Data.org rate budgets and bounded, labelled stale fallback apply. Missing history stays empty.

## Starting lineups and possible selections

Add `API_FOOTBALL_KEY` to the existing local parent `FormRadar/.env` or the application's `.env`. The already configured mixed-case `API_fOOTBALL_KEY` is recognized too; the original file is not rewritten. An explicitly configured canonical key takes precedence. Restart after changes. The key is only sent in a header to `https://v3.football.api-sports.io`; redirects are refused. It is removed, including case variants, from offline model child-process environments.

`GET /api/matches/:id/lineups?view=reported` first accepts complete Football-Data.org lineups where supplied. Otherwise API-Football fixtures must match competition, both normalized club names and kickoff within fifteen minutes, with exactly one candidate. The providers' numeric IDs are never assumed interchangeable. Starting XIs require eleven distinct identified players; formation, coach and substitutes appear only when supplied.

- **Starting XI used**: actual provider lineup for a completed match.
- **Provider-reported starting XI**: the provider's current selection for an upcoming match; it may change.
- **Possible · recent XI reference**: with `view=possible`, a missing upcoming XI may use a real starting XI from a completed match within the previous thirty days. Its original date and opponent are shown. It is not a trained selection forecast or an injury-adjusted prediction. No future fixture is used as a reference, and references never replace completed-match lineups.

On 2 November 2026, the configured API-Football key authenticated successfully, but its **Free plan rejected 2026 season access**. The user chose to retain that plan. Current-season lineups therefore show a clear coverage message. The app does not substitute older-season squads, scrape another site or fabricate players. The positive lineup paths were verified with synthetic test responses; live current-season lineup success is not claimed. Football-Data.org's checked responses also omitted lineups for the selected current fixtures.

API-Football requests coalesce, use bounded caches, and allow at most eight calls per minute and ninety per UTC day per process. Other applications share the provider's quota. Current lineups and fixture lookup cache for two minutes, recent-match lookup for fifteen minutes and completed XIs for one day. Plan errors are cached for fifteen minutes. Authentication, quota, network and coverage errors use safe separate messages; raw errors and keys never reach the browser. No background paid service is enabled.

## Scoreline heat map

The seven-by-seven grid shows goals 0–5 and a **6+** tail bucket for each team. Every cell comes from the real eligible fixture's fitted independent Poisson rates. Cells total one, and selecting a cell displays its probability. The expected-goals figures are model expectations, not observed event-based xG statistics.

The model's temperature adjustment calibrates the three outcome probabilities only. The grid deliberately uses the underlying uncalibrated rates; aggregating its cells need not reproduce the calibrated 1X2 percentages. Exact-score accuracy has not been separately evaluated. The 6+/6+ bucket includes multiple scorelines, not one draw outcome.

New forecasts store the grid as forecast schema 2. Earlier immutable forecasts remain untouched, and a new schema revision is saved for an eligible future match. The heat map requires an available experimental PL or CL league-phase model and a confirmed upcoming fixture within its seven-day horizon. It does not appear as a fabricated live output when a model is missing, expired or ineligible. News, head-to-head history and lineups do not modify the current model percentages.

Official references: [Football-Data.org response folding](https://docs.football-data.org/general/v4/policies.html), [API-Football documentation](https://www.api-football.com/documentation-v3), [API-Football coverage](https://www.api-football.com/coverage/).

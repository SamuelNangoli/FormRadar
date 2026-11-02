# Match information and scoreline heat map

Updated 2 November 2026. The interface uses Inter for body text and numbers and Poppins for display headings, loaded through Google Fonts with system fallbacks.

## Find the new views

Select a fixture in Overview, Live Scores or Predictions. **Match information** sits beneath its main match/prediction panel. Choose **Head to head**, or **Lineups** (labelled **Lineups used** for completed matches). Open **Predictions → Experimental model** for the interactive scoreline heat map below the forecast.

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

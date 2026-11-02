# Model progress — 2 November 2026

Two separate experimental independent Poisson models are now fitted on real provider results. Current refits have different parameters from the earlier artifacts used for held-out testing; retrospective metrics do not establish prospective accuracy.

| Model | Current fitted results | Current season | Held-out matches | Log loss: model / frequency | Brier: model / frequency |
| --- | ---: | ---: | ---: | ---: | ---: |
| Premier League | 1,229 | 89 | 380 | 1.031574 / 1.085090 | 0.618514 / 0.656520 |
| Champions League league phase | 438 | 54 | 144 | 0.957753 / 1.019536 | 0.568112 / 0.615988 |

Lower log loss and Brier are better. Settings were chosen on 2024/25 and locked before the 2025/26 test. CL uses 96 historical group-phase results from 2023/24 plus 144 league-phase results from each of 2024/25 and 2025/26. It does not reuse PL team strengths, include domestic form, or serve knockout/qualifying matches. Both models exclude the entire current UTC date from training targets.

## Tomorrow’s matches

The provider returned nine confirmed CL fixtures for Tuesday 3 November 2026. All nine generated and saved experimental forecasts during fresh fixture checks on 2 November. The [official UEFA schedule](https://www.uefa.com/uefachampionsleague/news/02a8-2174c9e9019d-f909a77bd77a-1000--2026-27-champions-league-all-the-league-phase-fix/) lists that matchday too. Kickoffs are 20:45 and 23:00 Uganda time. Estimates concern the 90-minute result, not qualification or extra time.

The 2 November models expire at 03:00 Uganda time on 3 November. Refresh CL before Tuesday’s matches. The convenient startup command prepares CL first, then starts the app:

```bash
cd ~/Desktop/Projects/FormRadar/formradar-v0.1/formradar
npm run dev:cl
```

Stop an already-running server with Ctrl+C first. Select **Predictions → Champions League → Tomorrow** on 2 November, or **Today** on 3 November, then choose a match and **Experimental model**. Date filters use UTC; kickoffs display in the browser’s local time.

For a refresh while the app stays running, use `npm run model:prepare-cl` from a second terminal in the same app folder, then Refresh data. PL continues to use `npm run model:prepare-current`. Refresh is manual each UTC day; no scheduler or training on page views is installed.

## Estimate unavailable

The running backend still reported `MODEL_INVALID`, while its saved model passed the corrected loader. That process had not loaded the timestamp fix. Restart it and reload the page. The interface now detects older backend code and gives this instruction instead of repeatedly suggesting retraining.

Other availability reasons remain explicit: a missing or expired model needs its competition’s preparation command; a started match has saved history only; uncertain/postponed fixtures and unsupported competitions/stages have no new estimate. Example percentages never fill an unavailable state.

The calendar/provider pill in the page header has been removed. The model view shows provenance, expiry, the corresponding evaluation and actual saved forecast revisions. Demo scenarios remain separate.

There is one held-out season per model, no completed prospective accuracy study, no walk-forward stability or uncertainty study, and a CL format change after 2023/24. Calibration is transferred to refits; unfamiliar clubs use pooled priors included in historical evaluation. Injuries, lineups, xG and in-play events are not modeled. No accuracy or profit guarantee is made.

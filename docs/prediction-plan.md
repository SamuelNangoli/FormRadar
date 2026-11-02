# FormRadar: from demo probabilities to an evaluated model

Prepared 2 November 2026. This is an implementation plan, not a trained model or a forecast. Current probabilities, scenarios and trends remain explicitly synthetic.

The initial offline importer, regularized independent Poisson workflow and chronological evaluation are implemented. Current-season preparation, Node inference with Python parity checks, an experimental Model/Demo interface and immutable local JSON forecast revisions are now implemented too; follow [the runnable walkthrough](training-walkthrough.md). Historical refitting alone does not activate the app. Refreshing the experimental model is an explicit manual command. Dixon–Coles, walk-forward/uncertainty studies, shared transactional storage and prospective accuracy monitoring remain future work. The design below records the broader roadmap; the current local implementation uses JSON records rather than the proposed SQLite store.

## Recommendation

Start with Premier League pre-match 1X2 estimates from a fitted Poisson model, then test the Dixon–Coles low-score correction. Fit team attack/defence strengths, home advantage and recency weighting from actual completed results. Keep whichever evaluated model performs best against simple baselines. This is a proposed engineering choice, informed by the [Dixon–Coles paper](https://doi.org/10.1111/1467-9876.00065) and [subsequent football forecasting research](https://academic.oup.com/jrsssc/article/74/3/717/7929974). It is not evidence that a particular implementation will be accurate or profitable.

The existing React/Vite and Node backend can stay. Use a small offline Python training workflow with pinned numerical dependencies, export versioned JSON parameters, and run prediction math in the Node backend. A separate model service is unnecessary for this first baseline. Verify Python/Node prediction parity against the same model artifact before exposing estimates.

## What the existing key can access

Authenticated, read-only checks on 2 November 2026 returned:

| Premier League season | Completed matches available |
| --- | ---: |
| 2023/24 | 380 |
| 2024/25 | 380 |
| 2025/26 | 380 |

That is 1,140 accessible completed matches across three checked seasons. These checks reported availability/counts only; no dataset or credentials were saved into this project or its ZIP. The provider lists more historical seasons in metadata; a listing alone does not prove access. Older seasons were not probed. The current [pricing page](https://www.football-data.org/pricing) advertises ten historical seasons in ML Pack Light; the successful checks above describe this particular key and do not establish all free-plan entitlements. No purchase is needed merely to continue developing against the three checked seasons.

Before building a retained training dataset, establish that the account's terms allow the intended training, retention and product use, and record that basis with the dataset. Technical access is not a licensing review. Do not silently switch to football-data.co.uk: it is a different provider, and its [data-use notice](https://football-data.co.uk/data.php) and [fair-use policy](https://football-data.co.uk/contact.php) restrict commercial/data-training projects and heavy automated access. No scraping workaround is proposed.

## 1. Version the real dataset

Add an explicit offline importer after the usage basis is established. Reuse the server's credential loader and fixed provider origin, respect the shared quota, fetch each allowed season once, cache locally and resume rather than refetching on every training run. Never run historical imports on page views.

Store locally in an ignored data directory, with an immutable manifest containing source/provider, competition/season, retrieval time, schema version, row count and content checksum. Keep `(provider, matchId)` and `(provider, teamId)` identities. Retain kickoff, home/away IDs, actual final 90-minute goals and status. Deduplicate by match ID; exclude unknown goals, postponed/cancelled/awarded fixtures, and non-PL competitions. Validate season coverage and totals. Never turn missing goals into zero. Preserve the current shootout-handling correction; PL training targets are 90-minute results.

Store the raw source separately from normalized rows and preprocessing code. Neither data, logs nor secrets belong in the downloadable source ZIP. Later corrections create a new dataset version rather than silently rewriting an earlier evaluation.

## 2. Fit a small, reproducible baseline

First implement a historical home/draw/away frequency baseline and an independent Poisson baseline. Then fit constrained, regularized attack/defence strengths and home advantage using maximum likelihood; tune time decay and the Dixon–Coles correction on earlier validation data only. Constrain the correction so all score probabilities remain nonnegative. Use an adaptive score grid with negligible omitted mass, then aggregate home-win, draw and away-win cells. Validate finite probabilities in [0,1] summing to one.

Document the treatment of promoted and previously unseen teams. Start with pooled league priors only if that behavior is included in evaluation; otherwise return an insufficient-history reason. Do not derive injuries, starting lineups, xG or player quality from plain score records. Do not train on the synthetic demo data or hardcode a home-team percentage.

## 3. Evaluate in chronological order

With the three confirmed seasons, use 2023/24 for initial fitting, 2024/25 for tuning and calibration, and reserve 2025/26 for the final untouched test. If more authorized history is available, expand earlier training seasons while retaining a later untouched test. Within tuning, use expanding or rolling chronological folds. For the test, use a predeclared walk-forward refit schedule with hyperparameters already locked, and ensure each forecast uses only results available before that forecast time. Group by UTC date so overlapping fixtures cannot feed one another's results.

The current 90-day statistics endpoint is descriptive, not a historical feature store. Do not use today's standings, all-season final aggregates or post-match scores to predict earlier kickoffs. For historical replay, conservatively use completed results from earlier UTC dates where actual publication times are unavailable. Today's corrected historical feed is not a true point-in-time archive: state that limitation in the report and add a prospective evaluation from newly saved pre-kickoff forecasts.

Report multiclass log loss, multiclass Brier score and reliability/calibration curves for each 1X2 outcome. Include sample sizes, per-season and promoted-team breakdowns, and uncertainty estimates such as matchday-block bootstrap intervals. Fit calibration using validation forecasts only and recheck it on the untouched test. Accuracy alone is insufficient. Compare all candidates on exactly the same test matches.

Predeclare the release comparison: prefer lower held-out log loss than the historical-frequency baseline, no material Brier/calibration regression, and stable behavior across folds. If the complex model fails to improve on the simpler model, keep the simpler model and report the result. Never promise a win rate, profit or guaranteed accuracy.

## 4. Export an identifiable model artifact

Export a schema-versioned JSON artifact with model family, parameters, calibration, team/provider mapping, model version, code version, training timestamp, training cutoff, dataset checksum/version, validation report reference and supported competition. Include minimum-history and freshness rules. Retain the previous artifact for rollback. Validate the artifact at server startup; do not train inside an HTTP request.

Keep model artifacts and data immutable. Register each trained revision, with its evaluation report and deployment decision. Validate floating-point parity between training and serving and sum-to-one behavior. Round only for display, using a total-preserving rule for percentages.

## 5. Add a real prediction API and forecast history

Implement `GET /api/predictions/:matchId` only after an evaluated artifact exists. Resolve the fixture server-side from the trusted feed; do not accept arbitrary team IDs, scores, model paths or external URLs from the browser. Serve estimates only for eligible pre-kickoff PL fixtures. Stop generating new pre-match estimates after kickoff or if fixture status/time is uncertain; completed matches may display a clearly dated archived forecast.

Proposed response fields:

| Field | Meaning |
| --- | --- |
| `available`, `reason` | Explicit availability and a stable reason code |
| `provider`, `matchId`, `kickoffAt` | Fixture identity and UTC kickoff |
| `probabilities.home/draw/away` | Actual model probabilities, or null when unavailable |
| `modelVersion`, `datasetVersion` | Reproducible artifact and training-data identity |
| `trainedAt`, `trainingCutoff`, `dataAsOf`, `generatedAt` | Distinct UTC training, input and forecast times |
| `evaluationRef` | The corresponding held-out evaluation report |
| `forecastId` | An immutable stored forecast revision |

Availability reasons should include `MODEL_NOT_READY`, `INSUFFICIENT_HISTORY`, `UNSUPPORTED_COMPETITION`, `FIXTURE_NOT_CONFIRMED`, `MATCH_STARTED` and `DATA_STALE`. Return null probabilities on failure; never substitute 45/27/28 or equal thirds. Cache by fixture, kickoff revision, model version and input snapshot. Save every generated forecast in an ignored SQLite database, with inputs' snapshot ID and generation time, before returning it. Do not overwrite forecasts after seeing results.

Add `GET /api/predictions/:matchId/history` for real stored revisions only. Distinguish live collected history from retrospective backtests. Record fixture rescheduling as a new revision. Never backfill a synthetic curve or treat daily model refits as prior genuine forecasts.

## 6. Connect the interface honestly

Introduce an explicit Model/Demo mode. In real mode, show the model's 1X2 probabilities, retrieval/generation time, model version, limitations and evaluation link. Label the first release **Experimental model** or **Model estimate**. Use unavailable states when inputs or the artifact are missing.

Remove the fixed injury/rest controls and synthetic probability trend from real mode. An actual rest-days feature could be added later only after reconstruction of complete prior schedules and held-out evaluation; it must be derived from real pre-match dates, not a button's fixed percentage adjustment. Injury/lineup scenarios require reliable, licensed, timestamped inputs and a model trained/evaluated to use those inputs. A predictive sensitivity comparison is not automatically a causal injury effect. Keep the existing synthetic scenarios only in an unmistakable Demo mode.

Show a real trend only after at least two genuine stored forecasts exist, and label the timing/version of each point. Monitor input freshness, availability, drift and calibration over time. A completed match must not acquire a newly generated 'pre-match' prediction.

## Suggested delivery sequence

1. Authorized importer, dataset manifest and validation; explicit coverage report.
2. Poisson/Dixon–Coles training and chronological evaluation report; choose an artifact based on the comparison.
3. Node inference, parity checks, immutable forecast storage and read-only prediction/history routes.
4. Model/Demo interface, real forecast charts, availability states and prospective monitoring.

Completion means fixture-specific estimates can be traced to a real model, real inputs and an evaluation, with no silent demo fallback. The local experimental implementation supplies the initial serving path. It is not a production release, and earlier retrospective testing does not establish prospective accuracy.

## Player avatars and media rights

Football-Data.org's documented [team squad fields](https://docs.football-data.org/general/v4/team.html) and [person resource](https://docs.football-data.org/general/v4/person.html) do not establish a dependable player-headshot feed. Keep initials/silhouette placeholders until an entitled source is chosen. Use a reviewed mapping from `(football-data.org, playerId)` to `(photoProvider, playerId)`; numeric IDs from API-Football or other services are not interchangeable. Verify identity and image rights, retain attribution/provenance, and allow missing/broken photos. Do not scrape Google Images or generate substitute player faces. No new credential or subscription is requested now.

Club crests and competition emblems in the current app use public URLs from Football-Data.org's existing feed, with provider/ID identity, a strict HTTPS-host validator, lazy loading and initials fallback. This does not establish a media licence. [Football-Data.org terms, section 9.2](https://www.football-data.org/about), place image permissions with the rights holders and the app owner. Obtain the required consent for the intended use; licensing has not been verified. The app remains local and has not been published.

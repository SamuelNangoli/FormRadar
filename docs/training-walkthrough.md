# Train your first FormRadar model on Ubuntu

The offline workflow imports, validates and evaluates a Poisson baseline. Historical training and refitting preserve the evaluation and do not activate estimates. After reviewing a real evaluation, `model:prepare-current` can prepare a separate, time-limited **Experimental model** for the local app.

## 1. Open the correct app folder

Stop FormRadar/Vite terminals with **Ctrl+C** while importing history, so they do not compete for the same API quota. Open a terminal and run:

```bash
cd /home/shemue-l/Desktop/Projects/FormRadar/formradar-v0.1/formradar
node --version
python3 --version
```

Expected: Node.js 22.12+ and Python 3.12–3.14. This computer's Python 3.14.4 was tested. Do not paste your token into a terminal command or chat. The importer loads your existing parent `FormRadar/.env` automatically, with the same host > app .env > parent .env precedence as the backend.

Use the data under your Football-Data.org account's applicable [terms](https://www.football-data.org/about), including the intended training/retention/product use. API access is not a licensing review. These commands use the existing provider; they do not scrape football-data.co.uk or purchase anything. Three historical seasons were previously accessible, but current provider availability and account entitlements can change.

## 2. Create the project Python environment

```bash
npm run model:setup
```

This creates `.venv-model/`, installs pinned **NumPy 2.5.4** and **SciPy 1.18.1**, and leaves system Python alone. It can take several minutes and downloads roughly 52 MB of numerical wheels on this machine. You do not need sudo, an environment-activation command, a globally installed pip, or ensurepip.

If pip is missing, setup retrieves the pinned pip 26.2.2 wheel from official PyPI, checks its SHA-256 against PyPI metadata, and installs it inside the project environment. Dependencies come from official PyPI as wheels; setup does not compile/install system libraries. Repeating the command resumes setup.

Expected final message:

```text
Ready: Python 3.14.4 NumPy 2.5.4 SciPy 1.18.1
No football data was fetched. Next: npm run model:test
```

The Python version line can differ within the supported range. If your chosen Python is elsewhere, select it explicitly:

```bash
FORMRADAR_PYTHON=/absolute/path/to/python3 npm run model:setup
```

That executable must have the standard-library `venv` module. Setup fails clearly if Python/venv or compatible wheels are unavailable; it does not install operating-system packages. If network setup stops, rerun the same setup command when connected.

## 3. Check the model tools first

```bash
npm run model:test
```

Expected: **6 tests, OK**. These use marked synthetic test fixtures in temporary folders. They test probability sums, score direction, known metric values, fitting, unseen-team priors, chronology, test-target isolation, exported files and refit separation. They do not contact the football API, create a real training dataset or change the app.

## 4. Import the three real completed seasons

```bash
npm run model:import
```

This is the step that actually downloads and retains your history. It makes season requests for **2023/24, 2024/25 and 2025/26**, using the existing key only in server-side request headers. It waits at least eight seconds between attempts and retries a transient failure at most once per season. Authentication/coverage failures stop immediately. Long rate-limit cooldowns stop rather than repeatedly calling the provider. Other applications with the same key still share its quota.

Expected successful season output:

```text
Season 2023: 380 valid 90-minute results, 20 teams.
Season 2024: 380 valid 90-minute results, 20 teams.
Season 2025: 380 valid 90-minute results, 20 teams.
Import complete: 1140 results.
```

If the provider is down, stop here and rerun the same command later. Successful earlier seasons remain cached; they are reused without another provider call. **Do not continue to training after an incomplete import.** Nothing substitutes synthetic data for a failed download.

The importer validates provider/competition/team/match identities, dates, actual regular-time integer goals, unique matches, all 380 home/away pairings and 19 home plus 19 away games per team. It drops exact duplicate records, rejects conflicting duplicates, and refuses incomplete seasons. Extra-time/shootout totals and missing goals are not training targets.

Private files, all outside Git and the source ZIP:

```text
.formradar-model/
  raw/PL-2023-<sha256>.json       immutable successful provider response
  raw/PL-2024-<sha256>.json
  raw/PL-2025-<sha256>.json
  cache.json                    resumable season index
  datasets/<dataset-version>/
    matches.json                normalized real match records
    manifest.json               source hashes, timestamps, counts and version
  CURRENT                       latest complete dataset version
```

The data folder is private and blocked by the dev server. Successful imports use restricted file permissions. A `CURRENT` dataset is published only when all three seasons validate; earlier immutable snapshots remain intact. Normally reuse the cache. Only to deliberately fetch source corrections later, run `npm run model:import -- --refresh`; that can produce a new dataset version while retaining old versions.

## 5. Verify the saved dataset independently

```bash
npm run model:validate
```

Expected: **Validated 1140 matches across 2023/24, 2024/25, 2025/26**, followed by its version/folder. The validator rechecks source checksums, normalization, duplicates, season coverage and the dataset hash, without making API calls. Fix any validation failure before training; do not edit scores or disable checks to make it pass.

## 6. Fit and evaluate the first model

```bash
npm run model:train
```

The trainer runs locally, without internet or access to your API key. It:

1. Fits regularized Poisson attack/defence strengths and home advantage on **2023/24**.
2. Selects between fixed regularization/recency candidates and simple temperature-calibration choices using **2024/25** only.
3. Locks those choices, refits on **2023/24 + 2024/25**, and evaluates **2025/26** once as the held-out test.
4. Compares against a smoothed historical home/draw/away frequency baseline fitted on the same pre-test seasons.

Promoted/unseen clubs receive pooled league attack/defence priors, and their test sample count and metrics are reported separately. Each model's training cutoff is the UTC day after its final training result; an estimate for a preceding date is refused. Score probabilities use an adaptive Poisson grid and must be finite, nonnegative and sum to one. No injuries, lineups, rest-button adjustments or xG are fabricated.

This first milestone deliberately uses an independent Poisson model. The Dixon–Coles correction, repeated walk-forward assessment and uncertainty intervals are later comparisons, not unfinished options hidden in this command.

Expected output: an **Evaluation saved:** folder, **Test matches: 380**, and a message that this command did not activate an experimental model. Actual metric values are not known until you run on real data. Training failure means no completed run pointer is published; do not treat a partial folder as a successful model.

```text
.formradar-model/runs/evaluation-<time>-<id>/
  model.json                    versioned fitted parameters, cutoff and provenance
  evaluation.json               selection details, baselines, metrics and calibration bins
  evaluation.md                 readable report
  test-predictions.json         retrospective estimates and actual outcomes
.formradar-model/LATEST_EVALUATION
```

The JSON artifact contains model/data/code versions, numerical-library versions and timestamps. It is explicitly `deployable: false`; the app is not wired to it. Test estimates are labelled retrospective rather than genuine stored pre-kickoff forecasts.

## 7. Read the result before doing anything else

```bash
npm run model:inspect
```

Look at the **Poisson** and **Frequency baseline** rows. Lower **log loss** and **Brier score** are better. The Brier definition is the mean sum of the three squared outcome errors, ranging from 0 to 2. In `evaluation.json`, calibration bins contain a count, mean predicted probability and actual outcome frequency for home/draw/away. Empty bins have null rates.

A more complicated model can perform worse than the baseline; that is a valid finding. This is one held-out season with retrospective corrected data. The temperature was chosen on validation forecasts then transferred to the pre-test refit. Repeatedly changing settings after seeing the test makes that season no longer untouched. The report always says **REVIEW_REQUIRED** and makes no profit, accuracy or deployment guarantee.

When ready to discuss the result, share only the readable metric table and any error message. Keep `.env`, raw datasets and private model files local. The next decision is whether the model is worth improving/integrating, not whether the command merely finished.

## 8. Optional: a separate all-history refit

After reviewing a successful evaluation, an all-history candidate for later integration can be produced with:

```bash
npm run model:refit
```

This retains the selected settings, fits all **1,140** imported results, and writes a separate `.formradar-model/runs/refit-<time>-<id>/model.json` plus `LATEST_REFIT`. It preserves `LATEST_EVALUATION` and its files. It does not claim that the new fitted artifact has an independent test remaining, overwrite held-out metrics, or activate the app. This optional step is not needed to inspect your first evaluation.

## 9. Prepare the current-season experimental model

Your completed `model:refit` is the prerequisite. Stop other FormRadar instances while refreshing to avoid competing for the provider quota, then run:

```bash
npm run model:prepare-current
npm run dev
```

Open **Predictions → Experimental model**, select **Premier League → Upcoming**, and select a confirmed fixture within the next seven days. Completed fixtures show saved history rather than receiving a newly generated pre-match forecast. **Demo examples** retains the fixed synthetic scenarios and chart; they never enter experimental estimates.

`model:prepare-current` makes **one** authenticated request to `/competitions/PL/matches?season=2026`. It checks all 380 schedule entries, 20 clubs, unique IDs/pairings, competition, season, dates, statuses and valid 90-minute goals. Only finished results from earlier UTC dates enter fitting. Today is excluded as a whole. Unresolved earlier scheduled/in-play games or missing completed scores stop preparation; they are never converted into zeros. A failed request stops without retrying in a loop or replacing data with examples.

The command validates the historical dataset and the saved evaluation/refit relationship, requires improvement on both baseline metrics, and reuses the evaluated settings without new tuning. It fits history plus eligible current results and writes an immutable snapshot and model under:

```text
.formradar-model/current/<snapshot-hash>.json
.formradar-model/current/raw-<source-hash>.json
.formradar-model/runs/experimental-<time>-<id>/model.json
.formradar-model/EXPERIMENTAL     atomic pointer with artifact SHA-256
.formradar-model/forecasts/<match-id>/<forecast-id>.json
```

Your original `CURRENT`, `LATEST_EVALUATION`, `LATEST_REFIT`, historical datasets and reports stay intact. The current refit is experimental and `deployable: false`; earlier held-out metrics concern a different fitted artifact. This command does not constitute a production release or an accuracy claim.

Refresh with **`npm run model:prepare-current` each UTC day** (03:00 Uganda time is UTC midnight), then use **Refresh data**. Models expire at the next UTC midnight or 24 hours after retrieval, whichever comes first. The server reloads the pointer on requests; restarting is only needed to pick up changed application code. Preparation currently supports 2026/27; a new season needs an updated/evaluated historical workflow. It does not install a scheduled job or fetch/train on page views.

The backend resolves each requested match from Football-Data.org, reuses a 60-second fixture check and the existing shared quota, and refuses stale fixture fallbacks. Only confirmed `TIMED` PL fixtures with current-season club IDs are eligible. Unknown, postponed, cancelled, started, expired and distant fixtures return null probabilities plus a reason. Unseen clubs use the pooled prior already included in evaluation. The browser also hides estimates at expiry/kickoff, during rechecks and on request errors.

A forecast is saved locally before it is returned. The same fixture/kickoff/team/model/snapshot combination reuses its original timestamp and probabilities. A changed kickoff or model creates a distinct revision. History contains actual generated experimental forecasts only, without retrospective backfills or synthetic curves. JSON records are used for this single-user local release; a shared service would need transactional shared storage and a shared provider budget. No prospective accuracy report exists yet.

The model view shows probabilities, results cutoff, data retrieval time, training time, input/model versions, generation time, expiry and a historical evaluation summary. No injury/rest controls or synthetic trend appears in this view.

If preparation fails, keep the error message and retry after fixing the provider/input issue. The previous pointer remains intact but stops serving at its own expiry. Never edit results or relax checks to force a model ready. Keep private model/data files out of source archives.

## 10. Champions League league-phase model

Run from the same nested app folder:

```bash
npm run model:prepare-cl
npm run dev
```

Stop an existing development server with Ctrl+C before starting another. In the website select **Predictions → Champions League → Tomorrow → Experimental model**. The calendar/provider pill in the header has been removed. If the page says an update is ready, restart the terminal server and reload the browser; preparing the model again does not reload old running code.

CL is a separate experiment; no PL parameters or default probabilities fill gaps. The first CL command imports and checks the complete 2023/24 group phase (96 results), 2024/25 league phase (144), and 2025/26 league phase (144). It selects Poisson settings on 2024/25, locks them, refits 2023/24+2024/25 and evaluates the untouched 2025/26 phase against a frequency baseline. Both held-out comparisons must improve before an experimental CL artifact is published. Knockout/qualifying results and extra-time/shootout totals are outside this model’s target scope. Modern phase coverage checks all 144 fixtures, 36 clubs, eight distinct opponents, four home/four away allocations and eight matchdays. Historical groups use the appropriate 32-club/96-match checks.

The latest current-season snapshot adds only finished results from prior UTC dates, preserves the held-out report, and refits with its existing settings. Historical responses are cached, current responses are reused for up to one hour within the same UTC day, and new requests are spaced by at least 8.5 seconds. Failures stop without synthetic replacements or repeated retries. All CL data and models live under ignored `.formradar-model/champions-league/`. PL pointers and artifacts are preserved; forecast records remain private and store their competition/model identity.

Run **`npm run model:prepare-cl` each UTC day**, starting at **03:00 Uganda time**. This refresh is manual. On **Tuesday 3 November 2026**, refresh before the evening matches; the 2 November model expires at 03:00 on 3 November. Stop the running server, prepare CL, then start it again, or use a second terminal in the same app folder and press Refresh data afterward. No installed scheduler or page-view training is claimed.

This baseline uses CL group/league-phase score history only. It has a small 144-match retrospective test, a format change between training and validation, transferred calibration, pooled priors for unfamiliar clubs, and no domestic form, lineup/injury input, live estimates or performance guarantee. See [the dated model progress report](model-status.md).

## Verification

The project environment uses Python 3.14.4, NumPy 2.5.4 and SciPy 1.18.1. Current checks cover importer/source checksums, chronological fitting, Node/Python prediction parity, current-season validation, model freshness and corruption, fixture eligibility, forecast persistence/revisions, route validation and credential isolation. Tests use synthetic fixtures in temporary folders; they do not fetch football data or activate the user's model. See the delivery report for the latest counts and build result.

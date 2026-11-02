# FormRadar v0.2

A local React/Vite football dashboard with a Node.js backend. It retains the original dark, green-accented interface inspired by prediction markets and score apps. FormRadar is not affiliated with Polymarket or LiveScore.

## Ubuntu: install and run

Use **Node.js 22.12 or newer** and npm. The project was tested with Node.js 22.22.1.

First stop any older FormRadar/Vite terminal with **Ctrl+C**. An older frontend server does not have the new API connection.

```bash
cd "$HOME/Desktop/Projects/FormRadar/formradar-v0.1/formradar"
node --version
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. One command starts both the frontend and backend. Stop both with **Ctrl+C** in that terminal.

You can start without a token: choose **Open demo preview**. This is an explicit, synthetic preview; API failures never automatically switch to demo data.

### Connect real football data

Your existing `~/Desktop/Projects/FormRadar/.env` is now loaded automatically. Keep your verified `FOOTBALL_DATA_API_KEY` and `FOOTBALL_DATA_BASE_URL` there; you do not need to copy the token into the nested application folder. Stop the old server and restart to load the configuration.

Configuration precedence is: host environment, then the application's `.env`, then the original parent `FormRadar/.env`. An explicitly empty value in a higher-priority source also takes precedence. Paths are resolved from the server files, independently of the terminal's working directory.

For a fresh setup without an existing `.env`:

1. Register for your own token at <https://www.football-data.org/client/register>. You complete registration and accept the provider's terms yourself.
2. Stop FormRadar with Ctrl+C. In the same project folder, run:

   ```bash
   test -f .env || cp .env.example .env
   chmod 600 .env
   nano .env
   ```

3. Set the following line to your token **inside your local `.env` file**:

   ```dotenv
   FOOTBALL_DATA_API_KEY=your_token_here
   FOOTBALL_DATA_BASE_URL=https://api.football-data.org/v4
   ```

   In nano, save with **Ctrl+O**, press **Enter**, then exit with **Ctrl+X**. Do not paste the token into chat, a screenshot, or a public repository. Do not use a `VITE_` prefix.

4. Restart:

   ```bash
   npm run dev
   ```

5. Open http://127.0.0.1:5173. Fixtures should now load. Invalid tokens, unavailable data, plan restrictions, connection failures and request limits have separate messages.

**Provider coverage:** the menu offers twelve competitions: Premier League, Champions League, La Liga, Bundesliga, Serie A, Ligue 1, Championship, Eredivisie, Primeira Liga, Brazilian Série A, European Championship and World Cup. Coverage and freshness depend on your subscription and season. The provider's free plan lists fixtures, league tables and delayed scores; this app never promises instant scores. Check current coverage and terms at <https://www.football-data.org/pricing> and <https://www.football-data.org/coverage>.

### If a port is already in use

Stop the old server first. If another application needs that port, add different values to `.env`, for example:

```dotenv
DEV_PORT=5174
API_PORT=3002
```

Restart `npm run dev` and open http://127.0.0.1:5174. Defaults are frontend 5173, backend 3001. The server binds to 127.0.0.1 for local use.

### Run the production build locally

```bash
npm run build
npm start
```

Open **http://127.0.0.1:3000**. `npm run preview` also starts this backend with the built frontend. `PORT` in `.env` changes the production port. Always run the backend: a static-only host cannot serve the `/api` routes or keep a provider token server-side.

## What changed

- Split the single frontend file into application, reusable components, request hook, formatting helpers and an isolated demo data module.
- Added server-only football-data.org v4 access for fixtures, final results, current standings, and team performance.
- Added dedicated `/api/fixtures` and `/api/results` routes (Premier League by default). Upcoming includes both `SCHEDULED` and `TIMED`; Results includes only `FINISHED` and sorts newest first. Choosing either tab selects the next or last seven UTC dates; date controls remain editable.
- Added competition, inclusive UTC date ranges (maximum 31 days), team search, and all/in-play/upcoming/results filters. Kickoffs use your browser's local time. Unconfirmed kickoff times, unknown scores and postponed/cancelled games are not presented as zero scores or scheduled kickoffs.
- League tables keep provider-supplied points, including deductions, and support multiple TOTAL groups. Select a team to see statistics.
- Team performance is calculated from up to 500 returned completed matches during the latest 90 UTC calendar days, across competitions available to the token. It includes played, W/D/L, goals for/against, goals per game, clean sheets and last-five form. Missing scores or insufficient shootout splits are excluded and counted; no matches gives unavailable averages, not invented zeros. Goal statistics include extra time; shootout goals are excluded and goal-based W/D/L treats drawn games decided on penalties as draws. This is a current results summary, not a historical pre-kickoff feature snapshot.
- Added loading, empty, setup, error, retry and stale-data states. Changing league/team clears the previous response, and abandoned requests cannot overwrite the latest selection.
- Added mobile-visible search, phone layouts, keyboard focus indicators, navigation controls, reduced-motion support and accessible table/field labels.
- Lazy-loaded the synthetic trend chart so the initial app does not download the chart library.
- Added real provider-supplied club crests and verified competition emblems across navigation, fixtures, match/prediction cards, tables and statistics. Image URLs are restricted to public HTTPS files on `crests.football-data.org`; missing or failed images fall back to initials. No extra authenticated provider call is made per image or render.

## Images and experimental models

**First training tools are now runnable:** follow [the Ubuntu training walkthrough](docs/training-walkthrough.md). Start with `npm run model:setup`, then `model:test`, `model:import`, `model:validate`, `model:train` and `model:inspect`. These commands exist in this source tree. Historical training alone does not activate estimates. After reviewing the evaluation and running `model:refit`, use `npm run model:prepare-current` to prepare the experimental current-season model. Refresh it each UTC day. The first trainer uses a regularized independent Poisson baseline; Dixon–Coles remains a later evaluated candidate.

Media identifiers stay tied to their source provider. The app never assumes another service's numeric team/player IDs match Football-Data.org IDs. Explicit demo fixtures/statistics continue to use initials. League emblems for navigation use a provider/competition-ID mapping verified against the feed; current match/table responses supply their own validated media when available. Browser images load directly from the public provider CDN, with no API key, image proxy or bundled media download.

**Media rights:** Football-Data.org's [terms, section 9.2](https://www.football-data.org/about), require arranging permission from image rights holders. API access does not itself establish those rights, and image licensing has not been verified. This update does not publish the app.

Player headshots are not added: the documented squad/person fields do not establish a reliable photo feed. Use initials/silhouettes until a suitable entitled source and verified player-ID mapping are chosen. No additional secret or subscription is needed for the crest/emblem integration.

For a concrete path from synthetic probabilities to a real, evaluated PL model, see [the prediction implementation plan](docs/prediction-plan.md). Checks on 2 November 2026 confirmed that the existing key could access 380 completed matches in each of 2023/24, 2024/25 and 2025/26. Those are access/count checks, not a licence review or model evaluation. No new real data was fetched or model trained automatically as part of this source update.

## Data honesty and predictions

Typography now uses Inter for interface text and numbers, with Poppins for display headings. Select a fixture to open **Match information → Head to head / Lineups**. Under **Predictions → Experimental model**, the new interactive scoreline heat map uses the saved forecast's underlying Poisson rates. See [match information and heat map setup](docs/match-insights.md) for source coverage, lineup modes and limitations. API-Football's connected Free plan was checked on 2 November 2026 and rejected current-season access; the app shows that restriction rather than substituting historical players.

**Experimental model** uses separately evaluated current-season artifacts for Premier League and Champions League league-phase fixtures within seven days. Run `npm run model:prepare-cl` for CL; its initial run imports, evaluates and fits a separate model. See [model progress and tomorrow’s setup](docs/model-status.md). Use `npm run model:prepare-current` for PL after your evaluation/refit, or `npm run model:prepare-cl` for CL. Restart the app after backend source updates; Refresh data alone does not reload running server code. Missing, stale or invalid inputs return unavailable states with null probabilities. Models expire at UTC midnight; refresh manually each UTC day. The view shows provenance and a historical evaluation summary; that evaluation concerns an earlier fitted artifact. It is a local experiment, with no production approval or accuracy guarantee.

Forecasts are saved before return under the ignored private model directory. The same fixture/model/kickoff/forecast-format combination reuses its original record; a changed kickoff, model or forecast format produces a new revision. History is actual stored pre-match records only. **Demo examples** separately retains fixed synthetic probabilities, scenarios and trends, unrelated to real teams or statistics. The optional whole-app demo preview additionally labels fixtures, tables and team statistics as synthetic.

News Radar connects The Guardian with a server-only GUARDIAN_API_KEY, competition/team/topic filters, source links and publication times. Add the key locally and restart the backend. Articles are context only: they do not alter model percentages or establish confirmed injury facts. See [news setup, authentication and player-data recommendations](docs/news-and-next-steps.md). Structured injuries, player statistics, xG and betting odds are not supplied. The app does not accept wagers.

## API, security and caching

Browser requests go only to same-origin `/api` endpoints. The backend sends the token to the fixed HTTPS football-data.org origin in an `X-Auth-Token` header. It does not expose a generic proxy, accept browser-supplied credentials, log tokens, or forward provider error bodies. `.env` is ignored by Git, blocked by the dev server and absent from the production frontend. Only `dist/` is served in production.

`FOOTBALL_DATA_BASE_URL` is server-only and accepts only `https://api.football-data.org/v4` (with an optional trailing slash). Other hosts, HTTP, embedded credentials, query strings and other API versions are rejected before sending a token. Redirects are refused. The existing parent `.env` is read without rewriting it.

| Route                                                               | Purpose                                                          | Server cache     |
| ------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------- |
| `/api/config`                                                       | Configuration status and supported competitions; never the token | No upstream call |
| `/api/health`                                                       | Same safe status response                                        | No upstream call |
| `/api/matches?competition=PL&dateFrom=2026-11-01&dateTo=2026-11-07` | Inclusive UTC schedule window                                    | 60 seconds       |
| `/api/fixtures`                                                     | Upcoming PL fixtures, next seven UTC dates by default            | 60 seconds       |
| `/api/results`                                                      | Completed PL results, last seven UTC dates by default             | 5 minutes        |
| `/api/standings?competition=PL`                                     | Current official tables                                          | 15 minutes       |
| `/api/model/status` | Experimental model availability, version and freshness | Local only |
| `/api/model/evaluation` | Public retrospective metrics for the current experimental artifact | Local only |
| `/api/predictions/500` | Confirmed eligible fixture estimate, persisted before return | Fixture check: 60 seconds |
| `/api/predictions/500/history` | Actual saved forecast revisions, including after kickoff | Local only |
| `/api/teams/57/stats`                                               | Results-derived last-90-days team performance                    | 15 minutes       |
| `/api/matches/500/head-to-head` | Latest returned prior completed meetings for the selected clubs | 15 minutes; fixture 60 seconds |
| `/api/matches/500/lineups?view=reported` | Provider starting XI; `view=possible` permits labelled recent-XI references before kickoff | 2 minutes upcoming; 1 day completed XIs |

The fixtures and results routes accept the same optional `competition`, `dateFrom` and `dateTo` parameters as `/api/matches`. Explicit date ranges are inclusive UTC dates and cover at most 31 days. The backend requests a covering interval and enforces the selected inclusive dates locally, including when the provider returns adjacent-day fixtures.

Requests for the same upstream resource are coalesced. A rolling budget allows at most 9 provider calls per minute per process, leaving margin below the documented 10/minute free-plan limit. Other apps using the same token share the provider's quota. Upstream throttling and network failures have cooldowns. Rate-limit responses respect `Retry-After` (seconds or HTTP date) and `X-RequestCounter-Reset`, with a minimum 60-second cooldown; the browser receives a safe `Retry-After` header and message. Authentication cooldowns retain the authentication error rather than becoming a throttle response. On temporary failures or throttling, an existing cached response up to 24 hours old may be returned with an explicit warning and its original retrieval time. Authentication and coverage failures do not use this fallback. The browser also discards cached responses whose original retrieval time exceeds 24 hours. The server cache is in memory, bounded to 200 resources, and resets when the server restarts; it is not shared across processes.

The browser checks the visible fixture view every 60 seconds. Refresh still respects the server cache and request budget. Tables and team stats refresh on opening or manual refresh, subject to their cache lifetime. Retrieval time is shown; it is not a guarantee of the provider's underlying update time. Date filters use UTC to match the provider, while kickoff labels use local time.

This release is configured for local use. Multi-user public hosting would need a hosting-specific secret store and a shared cache/rate budget.

Official API references:

- <https://docs.football-data.org/general/v4/competition.html>
- <https://docs.football-data.org/general/v4/team.html>
- <https://docs.football-data.org/general/v4/policies.html>
- <https://docs.football-data.org/general/v4/overtime.html>

## Verification

```bash
npm run model:setup    # needed for the Python/Node parity check
npm test
npm run model:test
npm run build
```

The backend suite uses an injected fake provider and disposable local HTTP servers; it never needs or spends a real API token. It tests route validation, secret redaction, date boundaries, standings, home/away statistics, null scores, caching, concurrent request coalescing, bounded stale responses, rate limits, provider failures and production file isolation.

The current integration and experimental prediction workflow passed 57 Node/API/importer/prediction/news/match-information tests, 9 Python model tests, and the production build. Tests cover parent `.env` loading and precedence, dedicated status routes and cache lifetimes, malformed upstream data, base-URL credential safeguards, authentication cooldowns, rate limits, provider/ID media identity, unsafe-image rejection, metadata reuse, existing statistics/security behavior, resumable complete-season imports, checksums, bounded retries, normalized 1X2 probabilities, test-target isolation and separate refits. Match-information tests cover previous-meeting chronology, unique cross-provider fixture matching, eleven-player validation, actual/reference distinction, plan errors and credential isolation. Heat-map tests check symmetry, normalization, known probabilities and tail buckets. A Python-exported artifact is checked through the Node loader and forecast/history path, including microsecond timestamps, malformed dates and expiry. The Champions League workflow was run locally on real provider data after separate chronological evaluation. Private sources, model parameters, reports and forecast records remain excluded from Git and the source ZIP.

The 2 November match-information browser check displayed seven prior Liverpool–Arsenal meetings, the current-season lineup coverage message and a real CL fixture's interactive scoreline grid. Selecting a different cell updated its score and percentage. All three configured credentials were absent from staged source and the built frontend. No live current-season lineup success is claimed with the connected Free plan.

Authenticated verification on 2 November 2026 succeeded using the existing parent `.env`: `/api/fixtures` returned 11 upcoming PL fixtures, `/api/results` returned 9 completed results, and `/api/standings` returned 20 teams. All three returned cache hits on repeat requests. These counts describe that check's default seven-day windows and current season; they will change with the feed. Tokens and raw provider error bodies were not printed.

Browser verification covered the Upcoming/Results presets, newest-first completed results, team search, the full Premier League table and demo-only prediction disclosures, with no browser console errors observed. Production checks served the built frontend and API configuration, refused `.env` and server/source-file requests, and confirmed that none of the four generated frontend files contained the configured API key. Development access to the existing parent `.env` was also refused.

For the media update, all six real competition emblems loaded in the browser. An isolated, visibly labelled synthetic rendering check verified real public club crest files on fixture rows, the prediction card and team-stat headers, a broken image falling back to initials in the same 56px slot, and image recovery when switching fixtures. That temporary test server and its synthetic fixtures are outside the app and excluded from the ZIP. During the final live-feed recheck, Football-Data.org returned HTTP 500 for current-data requests; FormRadar showed its controlled unavailable state. A fresh full live-feed media check remains dependent on the provider recovering. The earlier integration and historical-access results above are separately dated checks, not a claim of continuous provider availability.

## Source layout

```text
src/                 React interface, request state, synthetic preview
shared/              Supported competition metadata
docs/                Plan for a real evaluated prediction model and media guidance
model/               Historical/current import, pinned Python setup, trainer and tests
server/              HTTP API, provider cache, statistics, experimental predictions/history
scripts/dev.mjs      Starts Vite and the backend together
tests/api.test.mjs    Backend and security behaviour tests
.env.example         Empty server configuration template
```

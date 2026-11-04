# Connect your FormRadar API and view live match details

Your API is now connected to the website backend. The 2026 season match lists
and selected-match details use its protected football routes when the service
is configured and running. The browser does not receive your API key.

An **API key is a generated credential**. It gives a caller permission to use a
service. It is not a trained model and does not contain football data.

## What the service does

| Route | Purpose | Key needed? |
| --- | --- | --- |
| `GET /health` | Check that FastAPI is running | No |
| `POST /predict` | Run the configured model, or the clearly labelled demo | Yes |
| `GET /football/status` | Check whether the football feed is configured | Yes |
| `GET /football/competitions/PL/matches?season=2026` | Obtain the 2026 Premier League fixtures and results | Yes |
| `GET /football/matches/500` | Obtain one fixture, including the reported clock and goals if supplied | Yes |

`500` is an example ID. Real match IDs come from the connected feed.
For the Premier League, **season 2026 means 2026/27**, not the whole calendar
year 2026. January–May 2026 belongs to season 2025. Do not change an old season's
label to get around a coverage restriction.

The new football routes use your existing **football-data.org** token. In your
current folder arrangement, FastAPI reads that token from the parent
`FormRadar/.env`. You do not need to generate another key or move the token into
the browser. Alternatively, set `FOOTBALL_DATA_API_KEY` in the API server's own
private environment. That token is separate from `FORMRADAR_API_KEY`, which
authenticates the website backend to your FastAPI service.

## 1. Restart your API in terminal one

If the API is already running, press **Ctrl+C in its terminal** first. Run only
the following commands. Leave this terminal open afterwards.

```bash
cd ~/Desktop/Projects/FormRadar/ai-service
source .venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

Your existing `.env` and `.client.env` have been kept. **Do not run the key
generator again.** The `/predict` route remains in demo mode until you install
a compatible trained model and deliberately change `DEMO_MODE`.

## 2. Restart the website in terminal two

Stop the old website process with **Ctrl+C in its terminal**. Keep terminal one
running. Run these commands in terminal two:

```bash
cd ~/Desktop/Projects/FormRadar/formradar-v0.1/formradar
unset FORMRADAR_API_URL FORMRADAR_API_KEY
npm run dev
```

Open the address printed in the terminal, normally `http://127.0.0.1:5173`.
Choose the 2026/27 season and open a match. The source note should say
**FormRadar API · football-data.org**. This confirms the match data came through
your service. If the local service is unavailable, the website tries the direct
feed and shows an explicit fallback warning.

The unset command clears old values such as `https://api.example.com` from that
terminal. It does not erase either private file. Configuration order is the
existing process environment, the app `.env`, the parent `FormRadar/.env`, then
`FormRadar/ai-service/.client.env`. An explicitly empty value also takes
precedence: remove blank `FORMRADAR_API_URL`/`FORMRADAR_API_KEY` lines from the
app `.env` if you want to use the existing caller file automatically.

**Verified on 5 November 2026:** an authenticated end-to-end check returned all
380 Premier League 2026/27 fixtures through FastAPI, with no direct-feed
fallback. The selected completed-match check returned neither a minute nor
goalscorer events. Positive minute/scorer and player-XI displays were verified
separately with clearly synthetic browser fixtures. This is not a claim that
the current feed supplies those details for every match.

## 3. Check the connection

In a third terminal, these commands contain no credential:

```bash
curl -i http://127.0.0.1:8000/health
curl -sS http://127.0.0.1:3001/api/config
curl -sS 'http://127.0.0.1:3001/api/matches?competition=PL&season=2026'
```

The health response should contain `{"status":"ok"}`. The website configuration
should contain `"formRadarFootballConfigured":true`. That flag confirms the
settings exist; the match response's `meta.provider` confirms a successful
request through FastAPI. A fallback warning means the website used the direct
feed, even when the configuration flag is true.

For the separate prediction connection check, select Predictions, choose a
fixture, open **API demo**, then choose **Test connection**. The 48% / 27% / 25%
sample confirms the authenticated `/predict` connection. These are fixed demo
values, not the selected fixture's forecast.

## 4. Match minutes and goalscorers

Fixture cards and the match header show the reported minute, including stoppage
time such as **45+2′** or **90+3′**, when the feed supplies it. Half-time, extra
time and shootouts have distinct labels. No clock is guessed from kickoff time.

The **Goalscorers** section shows each scoring player's name, scoring minute,
penalties and own goals. It groups goals by the credited team and excludes
shootout kicks. Partially supplied scoring events are labelled incomplete.
The visible match page refreshes every minute while scheduled or live; the
server's cache and the upstream feed can delay updates.

If you see **Live · minute unavailable** or a message that goalscorers were not
supplied, the UI is working but the feed did not return those details. Owning
the API does not remove the upstream subscription limits. Connect a feed with
the necessary coverage before expecting live minutes, lineups or scoring
events. Do not fill those fields with guessed names or invented minutes.

## 5. Player form and possible XIs

Open **Match info → Player form** for ratings, recent starts, minutes, goals,
assists and reported injuries or suspensions. Choose **Lineups → Possible XI**
before kickoff for the available estimate. Reported XIs take priority.

The existing API-Football Free account did not allow the 2026 player season
when checked on 3 November 2026. The new FastAPI fixture routes do not change
that entitlement. Ratings and absence views need an entitled player-data feed;
missing data stays unavailable. See [Player context](player-context.md) for the
selection rules and the preparation step for future model training.

The current trained Poisson models use results. They have not been retrained
with player inputs. The new feature capture command prepares genuine
pre-kickoff records; it does not activate a player-aware model.

## 6. Using this on your hosted website

Pushing to GitHub includes the updated website and a credential-free copy of
the Python service under `services/prediction-api`. A Git push does not run
FastAPI on a public host. Vercel cannot reach `127.0.0.1:8000` on your laptop.

1. Deploy `services/prediction-api` separately, using its Dockerfile or the
   Ubuntu/HTTPS setup from the original API guide. Use a real HTTPS address.
   The updated Nginx template includes `/football/`. Replace its sample domain
   with your own and enable HTTPS before connecting the hosted website.
2. Set `API_KEY_HASHES`, `DEMO_MODE` and `FOOTBALL_DATA_API_KEY` privately on that
   API host. Set `MODEL_PATH` and mount your trusted artifact when enabling a
   real prediction model. Never commit the artifact or credential files.
3. In your Vercel project's server environment, set `FORMRADAR_API_URL` to that
   real HTTPS base address and `FORMRADAR_API_KEY` to the matching caller key.
   Do not add `VITE_` to either name. Redeploy the website to load the settings.
4. Check the website's source note again. The local fixed prediction-demo route
   is intentionally unavailable in the hosted handler; the football connector
   accepts a configured HTTPS service.

FastAPI authenticates each football route, refuses redirects, uses a fixed
upstream host, caches for 60 seconds and limits upstream calls to eight per
minute per process. The direct website feed and other apps share the token's
upstream allowance. Multiple API workers need a shared production quota/rate
limiter. Keep HTTPS, key hashing/rotation and private storage from the original
guide when deploying.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| `api.example.com` / `ENOTFOUND` | Use the restart commands above; clear the old terminal values. |
| FastAPI football route returns 404 | The old API process is still running. Restart it after the update. |
| `formRadarFootballConfigured` is false | Check the caller file exists and that higher-priority blank values do not override it. |
| Configuration is true but source says direct feed | Check FastAPI is running, its key matches, and its football-data.org access works. |
| 401 from a protected FastAPI route | The caller key is missing, invalid or was rotated. Keep it on the backend. |
| Feed unavailable / access not included | Check the upstream token and account coverage; your service cannot create missing data. |
| 429 | Wait at least a minute. Avoid repeatedly refreshing several tabs. |
| No minute or goalscorers | Check the chosen match's response for `minute`, `injuryTime` and `goals`; your feed may omit them. |
| The root URL `/` returns 404 | Expected: use `/health` or the documented routes. |

## Completion checklist

- [ ] FastAPI `/health` returns 200.
- [ ] Website settings recognize the private API connection.
- [ ] A 2026/27 fixture response names FormRadar API as the source.
- [ ] The prediction connection test is labelled as a demo.
- [ ] A live fixture shows its reported minute, or an explicit unavailable label.
- [ ] Supplied goals show their scorer and minute; incomplete data is labelled.
- [ ] No private keys or `.env` files were committed.
- [ ] A hosted website uses an HTTPS API host rather than laptop loopback.

Schema reference: [football-data.org match fields, minutes and goals](https://docs.football-data.org/general/v4/match.html).

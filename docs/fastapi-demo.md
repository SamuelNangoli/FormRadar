# Local FastAPI connection demo

For the new 2026 football routes and live match display, start with
[Connect your API](connect-your-api.md). This page covers the separate fixed
prediction connection check.

The API demo tab checks the separate FastAPI service with a fixed Arsenal vs
Chelsea sample. It does not use the selected fixture, update the trained models,
or save a forecast. It accepts only an explicitly labelled demo-v1 response.

The browser calls `/api/prediction-service/demo` on FormRadar's Node backend.
Only the backend reads the raw service key and sends `X-API-Key` to FastAPI.
The local backend loads the caller file at `FormRadar/ai-service/.client.env`
after its existing environment files. No credential is copied into `src`.
This connection demo is disabled in the hosted Vercel handler.

## Terminal one

Run these commands to keep FastAPI running. Keep `DEMO_MODE=true` for this demo.
The key-generation step is already complete; do not repeat it.

```bash
cd ~/Desktop/Projects/FormRadar/ai-service
source .venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

## Terminal two

Stop the old FormRadar process before restarting it. Run only these commands:

```bash
cd ~/Desktop/Projects/FormRadar/formradar-v0.1/formradar
unset FORMRADAR_API_URL FORMRADAR_API_KEY
npm run dev
```

The unset command clears temporary terminal values. It does not delete either
credential file. Node gives existing environment values precedence over files;
a pasted `https://api.example.com` value otherwise overrides the local URL.

Open the address printed by FormRadar, usually http://127.0.0.1:5173.
Choose Predictions, select a fixture, then API demo and Test connection.
You can also use the existing demo preview if the football feed is unavailable.
The successful sample shows Home win 48%, Draw 27%, Away win 25%.
Those percentages are expected output, not terminal commands or live forecasts.

## Standalone Node caller check

With FastAPI running, run this in a free terminal:

```bash
cd ~/Desktop/Projects/FormRadar/ai-service
unset FORMRADAR_API_URL FORMRADAR_API_KEY
node --env-file=.client.env examples/test-client.mjs
```

The route rejects query parameters, uses a fixed request body and disallows
redirects. It validates the returned demo label and probabilities, caches a
successful check for five seconds, coalesces concurrent checks and briefly
pauses retries after failures. Errors never relay an upstream body or key.
These local protections do not implement customer authentication or shared
production quotas. The existing experimental model and forecast history
continue through their original routes.

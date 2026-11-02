# Deploy FormRadar and formradar.trenttech.online

## One Vercel project

The repository is one Vite application with one Node.js API function at `api/index.js`. `model/` contains offline Python training tools, not a Python web server. The root `vercel.json` selects **Vite** explicitly; it does not define Services or service bindings. Vercel serves `dist/` and rewrites `/api/*` to that Node function, preserving the original API paths and query strings. Browser API calls stay on the same domain. There is no separate backend hostname, listener, Python service or training endpoint.

In the Vercel import page for `SamuelNangoli/FormRadar`, refresh after the latest commit is available. If the page still offers Services, choose **Import single project** on the **app / Vite** row, or change **Application Preset / Framework Preset** to **Vite**. Use these settings:

| Setting | Value |
| --- | --- |
| Project name | `formradar` |
| Root Directory | `./` |
| Framework | Vite |
| Build command | `npm run build` |
| Output directory | `dist` |
| Install command | `npm ci` |
| Node version | 22.x |

The GitHub repository root already contains `package.json`; the longer nested Ubuntu folder is its local location. Leave Vercel's Root Directory at `./`. Python training dependencies, the virtual environment, local datasets, fitted files and `.env` files are excluded from the function bundle. Keep using `npm run dev` locally. If testing with Vercel CLI, use `vercel dev --local`; its dedicated Vite command avoids starting the local two-port runner inside Vercel.

## Server environment variables

In the Vercel import form, or Project → Settings → Environment Variables, add the existing values from your private local `.env`:

```text
FOOTBALL_DATA_API_KEY
FOOTBALL_DATA_BASE_URL=https://api.football-data.org/v4
GUARDIAN_API_KEY
API_FOOTBALL_KEY
```

Use the uppercase spelling `API_FOOTBALL_KEY` on Vercel. Keep these as server variables without `VITE_` prefixes. Do not commit the `.env` or put values in this guide, chat or frontend source. The deployed function reads Vercel's environment; it does not load the laptop's parent `.env`. Local ports and HOST settings are not needed for deployment. Redeploy after changing hosted variables.

Deploy and first check the generated Vercel URL. `/api/health` should return JSON with `hosting: "vercel"`, configuration booleans and competition metadata only. Check fixtures, results, standings, season selection, News Radar and both appearances. No public deployment has been created or verified by the source changes alone.

## Persistent experimental models and forecasts

The laptop's ignored `.formradar-model` folder is not uploaded to GitHub or Vercel. Vercel Functions have a read-only application filesystem; `/tmp` is temporary scratch space and cannot preserve forecast history. A server-only Upstash Redis adapter stores the small validated model artifacts and original forecast records. Python still runs on your laptop, and the numerical model and expiry rules are unchanged.

Connect an Upstash Redis database through Vercel Storage/Marketplace or your own Upstash account. Select a suitable free option if offered; this update does not create an account, accept terms, purchase storage or connect a database automatically. Put these server settings in **Production** on Vercel and in the existing private local `.env`:

```dotenv
UPSTASH_REDIS_REST_URL=the_https_rest_endpoint_from_your_database
UPSTASH_REDIS_REST_TOKEN=the_private_write_token_from_your_database
FORMRADAR_CLOUD_NAMESPACE=formradar-production
```

Use the write-capable REST token, not the read-only token. The adapter accepts only HTTPS `*.upstash.io` endpoints and refuses redirects. Storage credentials are stripped from Python child-process environments. Use the same namespace locally and in Production. Leave credentials out of Preview unless you deliberately configure that environment too; other apps/environments using the football key share its upstream quota.

After connecting storage, prepare and publish from Ubuntu:

```bash
cd /home/shemue-l/Desktop/Projects/FormRadar/formradar-v0.1/formradar
npm run model:prepare-current
npm run model:prepare-cl
npm run model:publish
```

For CL only, use `npm run model:prepare-cl`, then `npm run model:publish -- --competition=CL`. The publisher verifies schema, checksums, current competition and freshness before uploading. It synchronizes actual saved forecast records with their original timestamps; it does not upload raw match datasets or reconstruct past predictions. Refresh and publish each UTC day; artifacts still expire at UTC midnight (03:00 Uganda time). Publishing never extends expiry or changes retrospective/experimental disclosures. No scheduled refresh is installed.

Cloud forecasts are returned only after an atomic save; simultaneous instances reuse the first saved record. Forecast history persists across cold starts and redeploys in the same connected namespace. The database also shares the football cache with original retrieval times and applies atomic rolling upstream request budgets across function instances. News and lineup request budgets are shared as well. In-memory caches and coalescing remain useful inside each warm instance. Store outages fail closed for new upstream requests; no temporary filesystem is presented as durable history.

Without a connected store, fixtures and news can run using the existing per-instance limits, while hosted predictions and history clearly report that cloud storage setup is needed. Shared quotas require the connected store. A new/empty store needs the publication command above. Current-season API-Football lineup restrictions on the retained Free plan still apply. No predictions are fabricated to make a deployment appear ready.

## Namecheap subdomain

1. In Vercel: Project → Settings → Domains → add **formradar.trenttech.online**.
2. Copy the exact **CNAME target shown by Vercel for this project**. It can be project-specific; do not substitute an old tutorial target or a URL with `https://`.
3. In Namecheap: Domain List → Manage **trenttech.online** → Advanced DNS → Host Records → Add New Record:

   | Field | Value |
   | --- | --- |
   | Type | CNAME Record |
   | Host | `formradar` |
   | Value / Target | The exact target copied from Vercel |
   | TTL | Automatic |

4. If that same `formradar` host already has a conflicting A/AAAA/CNAME/redirect record, replace the conflicting record for that host. Keep the root domain, email records and nameservers unchanged.
5. Return to Vercel and verify the domain. Wait for DNS verification and HTTPS provisioning, then test **https://formradar.trenttech.online** and its `/api/health` endpoint.

If Advanced DNS does not offer Host Records, DNS is managed by the active nameservers elsewhere; use that DNS control panel for the same CNAME. Actual DNS records have not been changed by this source update. The exact CNAME target becomes available after the Vercel project/domain is added.

References: [Vite and same-project API functions](https://vercel.com/docs/frameworks/frontend/vite), [Vercel configuration](https://vercel.com/docs/project-configuration/vercel-json), [function filesystem](https://vercel.com/docs/functions/runtimes), [Upstash REST API](https://upstash.com/docs/redis/features/restapi), [Vercel domain setup](https://vercel.com/docs/domains/working-with-domains/add-a-domain), [Namecheap CNAME setup](https://www.namecheap.com/support/knowledgebase/article.aspx/9646/2237/how-to-create-a-cname-record-for-your-domain/).

## Verification

The final source passed 68 Node tests, 9 Python model tests and the Vite production build. Cloud tests use injected stores and synthetic artifacts; a live Upstash database has not been connected or tested. They cover origin/credential isolation, atomic-command construction, first-record preservation across instances, checksum and expiry gates, shared cache timestamps, upstream quotas, publisher validation and the Node API entry.

Vercel CLI 65.9.0 was run locally with `vercel dev --local`. The Vite page returned 200; `/api/config`, nested model status, predictions and history returned their expected JSON; invalid competition returned 400; training routes returned 404. API query strings and original paths were preserved by the explicit rewrite. Local checks used an unlinked Vercel runner, not a hosted deployment. A public DNS check confirmed Namecheap's `registrar-servers.com` nameservers and no CNAME for `formradar.trenttech.online` at the time of verification. The Vercel dashboard deployment, server environment variables, Redis connection/publication and Namecheap CNAME remain owner setup steps.

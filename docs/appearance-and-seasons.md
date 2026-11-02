# Pulse Core, Porcelain Indigo and seasons

Updated 2 November 2026. The app remains open without signup or login. Football feeds, offline fitted models, prediction eligibility, immutable forecast records, news and demo disclosures are preserved.

## Appearance

The exact agreed light/dark palette is centralized in `src/theme.css`. Layout CSS, loading/error states, navigation, forms, tables, chart lines/tooltips, heat-map cells and selected controls consume those tokens. Result badges retain labelled W/D/L meanings, with separate green, amber and red semantic tokens. Original club and competition artwork is not tinted.

The header switch has an accessible name and switch state. It saves an explicit light/dark choice in this browser; the device button clears that choice. With no saved choice, the device preference is followed, including changes while the page is open. Storage failures still permit changing the current page. Changes synchronize between tabs. `public/theme-init.js` is a blocking head script, before styles and app startup, so the root appearance and favicon are selected before first paint. The logo is switched through CSS; favicon, touch icon, manifest and browser theme color follow the active appearance.

The final supplied Pulse Core assets are used as unmodified SVG masters in desktop navigation, the compact mobile header and the decorative overview illustration. The single horizontal image includes both icon and wordmark with one accessible name; decorative repetitions are hidden from assistive technology. The square icon slots preserve the master proportions. `public/brand` includes the light/dark web icons and original credits. The supplied full artwork ZIP also includes transparent/opaque PNG, JPEG, WebP, SVG, EPS and ICO variants, source palette and labelled illustrative mockups. No generated football values from those mockups are used by the app. The existing manifests, including name, ID, start URL, scope, display mode and icon paths, remain byte-for-byte unchanged; the files at those icon paths now contain Pulse Core artwork. The manifests provide installation artwork; no offline data service is added.

Keyboard focus has a visible two-pixel theme-colored outline on controls, links and disclosure summaries. Main, secondary, primary-button and semantic text pairs meet at least 4.5:1 contrast in both palettes. Heat-map labels use separate contrast-safe foregrounds across the complete intensity range; numbers, row/column labels and selected-score text supplement color.

## Season browsing

`GET /api/seasons?competition=PL` normalizes dates from the provider's competition metadata, deduplicates season starting years, and returns the ten most recent valid seasons from 2000. Same-calendar-year competitions display a single year; split seasons display e.g. 2025/26. Metadata listing is not an entitlement check. There is no subscription purchase or extra provider.

`GET /api/results?competition=PL&season=2025` requests that complete season's completed results. Matches and fixtures accept the same optional year, with their existing status rules. Full-season responses are limited to 1,000 matches and cached for fifteen minutes. Explicit date filters retain the existing maximum 31-day range. A returned season contradicting the selected year is rejected. Cache keys include the season. `GET /api/standings?competition=PL&season=2025` selects the corresponding provider table, with an explicit warning that historical point deductions may not be retained.

The UI switches an older season to Results, provides team search and an internally scrolling fixture list, and leaves the current-season date presets intact. Polling stops for historical seasons. The selected fixture still drives head-to-head and lineup views. Current team statistics are separately labelled as the latest 90 days. Models and their pre-kickoff eligibility rules are unchanged; selecting historical matches does not backfill forecasts.

Unavailable seasons retain the existing provider coverage/authentication/throttle messages. No unavailable season is silently replaced with current or demo data. Secrets remain server-only and are excluded from source bundles.

Provider reference: [Football-Data.org competition and season filters](https://docs.football-data.org/general/v4/competition.html).

## Verification on 2 November 2026

All 60 Node tests, 9 Python model tests and the production build passed. New season tests cover metadata normalization, malformed/repeated inputs, separate season cache keys, full-season status filtering, wrong-season rejection and subscription errors. Existing model/fixture/news/security tests still pass.

Live checks returned 380 PL completed results for both 2025/26 and 2024/25 and twenty clubs in the 2024/25 table. These are dated access checks for the connected account, not a guarantee for every listed year or another subscription. The current CL forecast and its disclosures remained intact.

Both appearances were checked at the normal desktop viewport and phone widths of 390 and 320 pixels. Saved light and dark choices survived reloads, matching logos/favicons loaded, restoring device appearance worked, keyboard activation showed a visible focus ring, and the appearance button's hover state changed visibly. Mobile navigation opened with focus on Close and closed with Escape. The phone page had no horizontal overflow. All 49 cells of a real fixture's heat map passed a rendered text-contrast check in both modes (minimum 5.03:1 light and 4.61:1 dark). The supplied artwork package's 157 listed checksums matched before integration.

The final Pulse Core installation repeated all 60 Node tests, 9 model tests and the production build. All sixteen served logo/favicon/touch/PWA assets matched the supplied files byte-for-byte, both manifest files were unchanged, and the 22 palette roles matched both kit references. Desktop and mobile light/dark views, saved preferences, device appearance and mobile navigation were checked. Each navigation state exposed one FormRadar image announcement; the standalone mark rendered in square slots and the horizontal logo retained its master aspect ratio. No browser warnings or errors were observed.

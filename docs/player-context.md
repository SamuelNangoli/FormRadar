# Player form availability and possible lineups

## What is available in the app

In Match information choose Player form to inspect provider performance ratings
out of 10, recent starts, minutes, goals, assists and reported absences. In
Lineups choose Reported XI for the provider's selection or Possible XI for the
new estimate. The estimate is labelled as an estimate and is not a confirmed XI.

Three completed matches from the previous thirty days form the sample. Every
source match must precede both the selected kickoff and the current check time.
The source dates and rating sample counts are shown. Missing numbers stay empty;
they are never converted to zero. Different providers' player IDs are not mixed.

The possible-XI rules use the most recent known formation and the provider's
current squad. They require at least two complete recent XIs, select players by
position, prioritize recent starts, then use recent ratings as a tie-breaker.
Players reported Missing Fixture are excluded. Questionable players are marked
doubtful and ranked below other eligible players. If the known candidate pool
cannot fill eleven distinct positions, the app returns no estimated XI.
A reported XI takes precedence over the estimate.

Injury data is a provider report, not a guarantee. An empty response means no
absences were reported; it does not establish that every player is healthy.
Suspensions are shown only when reported, not inferred from yellow-card totals.
If availability coverage fails, the estimate clearly says it has not checked
absences. Estimates never replace the actual XI for a past match.

## Provider coverage checked on 3 November 2026

The configured API-Football key authenticated. Its active Free plan reports a
100-request daily allowance but rejects Premier League 2026 season access.
This means the new live views will show a season-coverage message for that data.
No account plan was changed. The positive data paths are verified with synthetic
test fixtures, not represented as live current-season player information.

Official references:

- [Lineups, ratings, squads and injury reports](https://api-sports.io/documentation/football/v3)
- [Efficient fixture detail batches](https://www.api-football.com/news/post/how-to-get-all-fixtures-data-from-one-league)

Lookups share the existing private provider cache and request budgets. The
three-match detail records for both teams are batched into one request. A fresh
complete context uses at most eight lineup-provider requests before any cache
reuse. Player details load when opened and follow the existing page refresh;
no separate background job polls them. Some views may need a
later retry when other lineup calls have used the request budget.

## Preparing the model to use players

The existing Poisson models were trained on match results. Their probabilities
do not use player ratings, injuries or expected selections yet. Adding arbitrary
weights to those models would not produce an evaluated player-aware model.

The new player feature builder creates eleven numerical inputs: each side's
mean recent XI rating, rating coverage, recent start share, reported-out count
and doubtful count, plus the difference between mean ratings.

After connecting a feed that covers the chosen fixture, run this terminal
command from the application folder, replacing MATCH_ID with its numeric
Football-Data.org match ID:

```bash
npm run model:capture-players -- MATCH_ID
```

Capture is explicit and local. It accepts only a fresh, confirmed fixture
within seven days and strictly before kickoff. Each side needs a verified
current squad, recent history and at least eight genuinely rated XI players.
Unknown availability, stale data, incomplete XIs and conflicting reported
absences block capture. A timestamped, hashed, immutable feature record is saved
under the private .formradar-model/player-context directory with mode 0600.

No record is saved for missing data, and no model is automatically retrained or
activated. A player-aware release still needs genuine pre-kickoff snapshots,
matching completed outcomes, chronological training/validation/test periods,
and comparison with the existing baseline. Retrospectively downloaded season
ratings are not evidence that those values were available before old matches.

## Restart after the update

Keep FastAPI running in its own terminal. Stop an older FormRadar process with
Ctrl+C, then run only these terminal commands:

```bash
cd ~/Desktop/Projects/FormRadar/formradar-v0.1/formradar
unset FORMRADAR_API_URL FORMRADAR_API_KEY
npm run dev
```

Open the printed website address. The API demo tab remains a separate fixed
connection test; it is not the player-aware model.

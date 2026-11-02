"""Offline Poisson baseline and explicit experimental export. No network or credentials."""
import argparse
from collections import Counter
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import re
import sys
import uuid

import numpy as np
import scipy
from scipy.optimize import minimize
from scipy.stats import poisson

PROJECT = Path(__file__).resolve().parent.parent
PRIVATE = PROJECT / ".formradar-model"
SEASONS = (2023, 2024, 2025)
PROVIDER = "football-data.org"
ORDER = ["home", "draw", "away"]


class TrainingError(Exception):
    pass


def require(condition, message):
    if not condition:
        raise TrainingError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def stamp():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def utc(value):
    require(isinstance(value, str) and value.endswith("Z"), "Expected a UTC timestamp.")
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def check_rows(rows, seasons=SEASONS, complete=True):
    require(isinstance(rows, list), "Expected a normalized match list.")
    ids = set()
    for row in rows:
        require(row.get("provider") == PROVIDER and row.get("competition") == "PL", "Unexpected match provider/competition.")
        require(row.get("season") in seasons, "Unexpected season.")
        require(type(row.get("id")) is int and row["id"] > 0 and row["id"] not in ids, "Invalid/duplicate match ID.")
        ids.add(row["id"])
        for team in (row["homeTeam"], row["awayTeam"]):
            require(team.get("provider") == PROVIDER and type(team.get("id")) is int and team["id"] > 0, "Invalid team identity.")
        require(row["homeTeam"]["id"] != row["awayTeam"]["id"], "A team cannot play itself.")
        require(all(type(row.get(key)) is int and 0 <= row[key] <= 50 for key in ("homeGoals", "awayGoals")), "Invalid/missing 90-minute score.")
        when = utc(row["utcDate"])
        require(datetime(row["season"], 7, 1, tzinfo=timezone.utc) <= when < datetime(row["season"] + 1, 7, 1, tzinfo=timezone.utc), "Kickoff outside season.")
    for season in seasons if complete else ():
        games = [row for row in rows if row["season"] == season]
        home, away = Counter(r["homeTeam"]["id"] for r in games), Counter(r["awayTeam"]["id"] for r in games)
        pairs = {(r["homeTeam"]["id"], r["awayTeam"]["id"]) for r in games}
        require(len(games) == 380 and len(pairs) == 380 and len(home) == 20 and home.keys() == away.keys()
                and all(home[t] == away[t] == 19 for t in home), f"Season {season} is incomplete; expected 380 matches/20 teams.")
    return sorted(rows, key=lambda r: (r["utcDate"], r["id"]))


def load_dataset(root=PRIVATE):
    version = (root / "CURRENT").read_text().strip()
    require(re.fullmatch(r"[a-f0-9]{64}", version), "Invalid dataset pointer.")
    folder = root / "datasets" / version
    manifest = json.loads((folder / "manifest.json").read_text())
    data = (folder / "matches.json").read_bytes()
    require(manifest.get("schemaVersion") == 1 and manifest.get("datasetVersion") == version
            and manifest.get("normalizedSha256") == sha(data), "Dataset checksum/schema failed.")
    require(manifest.get("provider") == PROVIDER and manifest.get("competition") == "PL", "Wrong dataset source.")
    sources = manifest.get("sources", [])
    require([s.get("season") for s in sources] == list(SEASONS), "Expected exactly the three ordered source seasons.")
    for source in sources:
        require(re.fullmatch(r"raw/PL-(2023|2024|2025)-[a-f0-9]{64}\.json", source["file"]), "Unsafe source path.")
        raw = (root / source["file"]).read_bytes()
        require(sha(raw) == source["sha256"], "Raw source checksum failed.")
    basis = [1, sha(data)] + [s["sha256"] for s in sources]
    require(sha(json.dumps(basis, separators=(",", ":")).encode()) == version, "Dataset version failed.")
    return {"version": version, "manifest": manifest, "rows": check_rows(json.loads(data))}


def outcome(row):
    return 0 if row["homeGoals"] > row["awayGoals"] else 2 if row["homeGoals"] < row["awayGoals"] else 1


def cutoff(rows):
    return (max(utc(row["utcDate"]) for row in rows).replace(hour=0, minute=0, second=0, microsecond=0)
            + timedelta(days=1)).isoformat().replace("+00:00", "Z")


def fit(rows, alpha=1.0, half_life=None):
    require(len(rows) >= 4, "Too few matches to fit a model.")
    ids = sorted({row[side]["id"] for row in rows for side in ("homeTeam", "awayTeam")})
    index = {team: i for i, team in enumerate(ids)}
    n = len(ids)
    h = np.array([index[r["homeTeam"]["id"]] for r in rows])
    a = np.array([index[r["awayTeam"]["id"]] for r in rows])
    yh = np.array([r["homeGoals"] for r in rows], dtype=float)
    ya = np.array([r["awayGoals"] for r in rows], dtype=float)
    at = utc(cutoff(rows))
    age = np.array([(at - utc(r["utcDate"])).total_seconds() / 86400 for r in rows])
    weights = np.ones(len(rows)) if half_life is None else np.exp(-math.log(2) * age / half_life)

    def objective(theta):
        attack = theta[2:2+n] - theta[2:2+n].mean()
        defence = theta[2+n:] - theta[2+n:].mean()
        eh = theta[0] + theta[1] + attack[h] + defence[a]
        ea = theta[0] + attack[a] + defence[h]
        lh, la = np.exp(eh), np.exp(ea)
        value = np.sum(weights * (lh - yh * eh + la - ya * ea))
        value += alpha * (attack @ attack + defence @ defence) + 0.01 * theta[1] ** 2
        gh, ga = weights * (lh - yh), weights * (la - ya)
        gat = np.bincount(h, gh, minlength=n) + np.bincount(a, ga, minlength=n) + 2 * alpha * attack
        gde = np.bincount(a, gh, minlength=n) + np.bincount(h, ga, minlength=n) + 2 * alpha * defence
        grad = np.r_[np.sum(gh + ga), np.sum(gh) + 0.02 * theta[1], gat - gat.mean(), gde - gde.mean()]
        return float(value), grad

    initial = np.zeros(2 + 2 * n)
    initial[0] = np.clip(math.log(max(float(ya.mean()), 0.1)), -3, 2)
    initial[1] = np.clip(math.log(max(float(yh.mean()), 0.1) / max(float(ya.mean()), 0.1)), -1, 1)
    result = minimize(objective, initial, jac=True, method="L-BFGS-B",
                      bounds=[(-3, 2), (-1, 1)] + [(-1.5, 1.5)] * (2*n),
                      options={"maxiter": 2000, "ftol": 1e-10, "gtol": 1e-6})
    require(bool(result.success) and np.isfinite(result.x).all(), "Poisson optimization did not converge; no artifact exported.")
    attack = result.x[2:2+n] - result.x[2:2+n].mean()
    defence = result.x[2+n:] - result.x[2+n:].mean()
    return {"family": "regularized-independent-poisson", "provider": PROVIDER,
            "teamIds": ids, "intercept": float(result.x[0]), "homeAdvantage": float(result.x[1]),
            "attack": attack.tolist(), "defenceWeakness": defence.tolist(),
            "alpha": alpha, "halfLifeDays": half_life, "temperature": 1.0,
            "trainingCutoff": cutoff(rows), "trainingMatches": len(rows),
            "unseenTeamPolicy": "pooled league prior: zero centred attack/defence; included in evaluation"}


def goal_probabilities(lh, la):
    require(math.isfinite(lh) and math.isfinite(la) and 0 < lh <= 50 and 0 < la <= 50, "Unsafe goal rates; estimate unavailable.")
    limit = max(12, int(poisson.ppf(1 - 1e-12, max(lh, la))))
    grid = np.outer(poisson.pmf(np.arange(limit + 1), lh), poisson.pmf(np.arange(limit + 1), la))
    require(grid.sum() > 1 - 1e-9, "Insufficient score-grid probability mass.")
    p = np.array([np.tril(grid, -1).sum(), np.trace(grid), np.triu(grid, 1).sum()])
    return p / p.sum()


def temper(probabilities, temperature):
    require(0.5 <= temperature <= 2, "Invalid calibration temperature.")
    scores = np.log(np.maximum(probabilities, 1e-15)) / temperature
    scores -= scores.max(axis=-1, keepdims=True)
    values = np.exp(scores)
    return values / values.sum(axis=-1, keepdims=True)


def predict(model, rows):
    index = {team: i for i, team in enumerate(model["teamIds"])}
    probabilities, unseen = [], []
    for row in rows:
        require(utc(row["utcDate"]) >= utc(model["trainingCutoff"]), "Future leakage: prediction date precedes training cutoff.")
        hi, ai = index.get(row["homeTeam"]["id"]), index.get(row["awayTeam"]["id"])
        effect = lambda key, i: 0.0 if i is None else model[key][i]
        lh = math.exp(model["intercept"] + model["homeAdvantage"] + effect("attack", hi) + effect("defenceWeakness", ai))
        la = math.exp(model["intercept"] + effect("attack", ai) + effect("defenceWeakness", hi))
        probabilities.append(goal_probabilities(lh, la))
        unseen.append(hi is None or ai is None)
    values = temper(np.array(probabilities), model["temperature"])
    require(np.isfinite(values).all() and np.all(values >= 0) and np.allclose(values.sum(axis=1), 1), "Invalid 1X2 probabilities.")
    return values, np.array(unseen)


def frequency(rows, count):
    counts = np.bincount([outcome(row) for row in rows], minlength=3) + 1.0
    return np.tile(counts / counts.sum(), (count, 1))


def metrics(rows, probabilities):
    require(len(rows) == len(probabilities) and len(rows) > 0, "Empty/misaligned evaluation set.")
    targets = np.array([outcome(row) for row in rows])
    one_hot = np.eye(3)[targets]
    calibration = {}
    for cls, name in enumerate(ORDER):
        bins = []
        for bucket in range(10):
            mask = (probabilities[:, cls] >= bucket / 10) & (probabilities[:, cls] < (bucket + 1) / 10 if bucket < 9 else probabilities[:, cls] <= 1)
            count = int(mask.sum())
            bins.append({"lower": bucket / 10, "upper": (bucket + 1) / 10, "count": count,
                         "meanProbability": float(probabilities[mask, cls].mean()) if count else None,
                         "observedRate": float((targets[mask] == cls).mean()) if count else None})
        calibration[name] = {"bins": bins, "expectedCalibrationError": sum(b["count"] * abs(b["meanProbability"] - b["observedRate"]) for b in bins if b["count"]) / len(rows)}
    return {"matches": len(rows), "logLoss": float(-np.log(np.maximum(probabilities[np.arange(len(rows)), targets], 1e-15)).mean()),
            "brier": float(((probabilities - one_hot) ** 2).sum(axis=1).mean()), "brierDefinition": "mean sum of three squared errors; range 0–2",
            "calibration": calibration}


def write_json(path, value):
    with path.open("x") as handle:
        json.dump(value, handle, indent=2, allow_nan=False)
        handle.write("\n")
    path.chmod(0o600)


def new_run(root, role):
    folder = root / "runs" / f"{role}-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{uuid.uuid4().hex[:8]}"
    folder.mkdir(parents=True, mode=0o700)
    return folder


def point(root, name, folder):
    temp = root / f".{name}.{uuid.uuid4().hex}.tmp"
    temp.write_text(folder.name + "\n")
    temp.chmod(0o600)
    temp.replace(root / name)


def artifact(model, dataset, role, test_only=False):
    return {"schemaVersion": 1, "modelVersion": uuid.uuid4().hex, "role": role, "deployable": False,
            "testOnly": test_only, "provider": PROVIDER, "competition": "PL", "outcomeOrder": ORDER,
            "trainedAt": stamp(), "datasetVersion": dataset["version"],
            "dataRetrievedAt": [s["fetchedAt"] for s in dataset["manifest"]["sources"]],
            "codeVersion": sha(Path(__file__).read_bytes() + (PROJECT / "model/requirements.txt").read_bytes()),
            "environment": {"python": platform.python_version(), "numpy": np.__version__, "scipy": scipy.__version__},
            "parameters": model}


def evaluate_dataset(dataset, root, allow_test=False):
    test_only = dataset["manifest"].get("testOnly", False)
    require(allow_test or not test_only, "Test-only synthetic data cannot be used for a normal training run.")
    rows = check_rows(dataset["rows"])
    train = [r for r in rows if r["season"] == 2023]
    valid = [r for r in rows if r["season"] == 2024]
    test = [r for r in rows if r["season"] == 2025]
    require(max(r["utcDate"] for r in train) < min(r["utcDate"] for r in valid)
            and max(r["utcDate"] for r in valid) < min(r["utcDate"] for r in test), "Chronological seasons overlap.")
    candidates = []
    for alpha in (1.0, 10.0):
        for half_life in (None, 365.0):
            model = fit(train, alpha, half_life)
            raw, _ = predict(model, valid)
            for temperature in (0.85, 1.0, 1.15):
                score = metrics(valid, temper(raw, temperature))["logLoss"]
                candidates.append({"alpha": alpha, "halfLifeDays": half_life, "temperature": temperature, "validationLogLoss": score})
    chosen = min(candidates, key=lambda item: item["validationLogLoss"])
    # Settings lock here. Test scores never feed model/temperature selection.
    fitted = fit(train + valid, chosen["alpha"], chosen["halfLifeDays"])
    fitted["temperature"] = chosen["temperature"]
    estimates, unseen = predict(fitted, test)
    baseline = frequency(train + valid, len(test))
    model_file = artifact(fitted, dataset, "held-out-evaluation", test_only)
    report = {"schemaVersion": 1, "generatedAt": stamp(), "datasetVersion": dataset["version"],
              "modelVersion": model_file["modelVersion"], "testOnly": test_only, "appActivated": False,
              "split": {"initialTrain": [2023], "validation": [2024], "fitAfterSelection": [2023, 2024], "untouchedTest": [2025]},
              "evaluationProtocol": "static chronological holdout; no within-test refitting; conservative prior-UTC-day result cutoff",
              "selectedSettings": chosen, "validationCandidates": candidates,
              "validationFrequencyBaseline": metrics(valid, frequency(train, len(valid))),
              "testPoisson": metrics(test, estimates), "testFrequencyBaseline": metrics(test, baseline),
              "unseenTeamMatches": int(unseen.sum()),
              "unseenTeamEvaluation": metrics([r for r, u in zip(test, unseen) if u], estimates[unseen]) if unseen.any() else None,
              "limitations": ["Retrospective corrected results; not genuine stored pre-kickoff forecasts.",
                              "One held-out season; no walk-forward stability or bootstrap uncertainty assessment yet.",
                              "Temperature selected on validation forecasts, then transferred to the refitted pre-test model.",
                              "No injuries, lineups, xG, live scenarios or accuracy/profit guarantee.",
                              "Training success is not app activation or a release decision."],
              "releaseDecision": "REVIEW_REQUIRED"}
    folder = new_run(root, "evaluation")
    model_file["evaluationReport"] = "evaluation.json"
    write_json(folder / "model.json", model_file)
    write_json(folder / "evaluation.json", report)
    write_json(folder / "test-predictions.json", [{"matchId": row["id"], "kickoff": row["utcDate"],
               "probabilities": dict(zip(ORDER, map(float, prob))), "actualOutcome": ORDER[outcome(row)],
               "unseenTeam": bool(is_new), "retrospective": True} for row, prob, is_new in zip(test, estimates, unseen)])
    summary = f"# Retrospective Poisson baseline evaluation\n\nTest-only synthetic fixtures: {test_only}\n\nDataset: {dataset['version']}\n\nTraining: 2023/24; tuning: 2024/25; pre-test refit: both; untouched test: 2025/26.\n\n"
    summary += f"Test matches: {len(test)}; unseen-team matches: {int(unseen.sum())}.\n\n| Candidate | Log loss (lower is better) | Brier (lower is better) |\n|---|---:|---:|\n"
    for label, key in (("Poisson", "testPoisson"), ("Frequency baseline", "testFrequencyBaseline")):
        summary += f"| {label} | {report[key]['logLoss']:.6f} | {report[key]['brier']:.6f} |\n"
    summary += "\nCalibration counts/observed rates are in evaluation.json.\n\n" + "\n".join("- " + text for text in report["limitations"]) + "\n\nReview required. This evaluation does not activate a model.\n"
    (folder / "evaluation.md").write_text(summary)
    (folder / "evaluation.md").chmod(0o600)
    point(root, "LATEST_EVALUATION", folder)
    return folder, report


def latest(root, pointer):
    name = (root / pointer).read_text().strip()
    require(re.fullmatch(r"(?:evaluation|refit)-[A-Za-z0-9-]+", name), "Invalid local run pointer.")
    return root / "runs" / name


def refit_dataset(dataset, root, allow_test=False):
    test_only = dataset["manifest"].get("testOnly", False)
    require(allow_test or not test_only, "Cannot refit a production candidate from synthetic data.")
    previous = latest(root, "LATEST_EVALUATION")
    report = json.loads((previous / "evaluation.json").read_text())
    require(report["datasetVersion"] == dataset["version"] and report["testOnly"] == test_only, "Evaluate this dataset before an all-history refit.")
    settings = report["selectedSettings"]
    model = fit(check_rows(dataset["rows"]), settings["alpha"], settings["halfLifeDays"])
    model["temperature"] = settings["temperature"]
    exported = artifact(model, dataset, "all-history-refit-for-future-integration", test_only)
    exported["evaluationReference"] = previous.name
    exported["evaluationIsForDifferentFittedArtifact"] = True
    exported["warning"] = "This all-history model has no independent test left. Prior evaluation remains unchanged; integration is a later stage."
    folder = new_run(root, "refit")
    write_json(folder / "model.json", exported)
    point(root, "LATEST_REFIT", folder)
    return folder


def experimental_dataset(dataset, snapshot, snapshot_version, root, allow_test=False):
    test_only = dataset["manifest"].get("testOnly", False) or snapshot.get("testOnly") is not False
    require(allow_test or not test_only, "Synthetic inputs cannot activate an experimental model.")
    previous = latest(root, "LATEST_REFIT")
    refitted = json.loads((previous / "model.json").read_text())
    evaluation = latest(root, "LATEST_EVALUATION")
    report = json.loads((evaluation / "evaluation.json").read_text())
    require(refitted["datasetVersion"] == report["datasetVersion"] == dataset["version"]
            and refitted["evaluationReference"] == evaluation.name
            and report["testOnly"] == refitted["testOnly"] == dataset["manifest"].get("testOnly", False),
            "The saved refit and evaluation must match this historical dataset.")
    require(report["testPoisson"]["logLoss"] < report["testFrequencyBaseline"]["logLoss"]
            and report["testPoisson"]["brier"] <= report["testFrequencyBaseline"]["brier"],
            "This candidate did not improve on both baseline metrics; keep it offline for review.")
    require(snapshot.get("schemaVersion") == 1 and snapshot.get("provider") == PROVIDER
            and snapshot.get("competition") == "PL" and snapshot.get("season") == 2026
            and snapshot.get("historicalDatasetVersion") == dataset["version"], "Invalid current snapshot source.")
    as_of, through, expires = (utc(snapshot[key]) for key in ("fetchedAt", "coverageThrough", "expiresAt"))
    require(through == as_of.replace(hour=0, minute=0, second=0, microsecond=0)
            and through <= as_of < expires <= through + timedelta(days=1), "Invalid current snapshot freshness.")
    require(as_of <= datetime.now(timezone.utc) < expires, "The current snapshot expired. Run model:prepare-current again.")
    require(len(snapshot["teamIds"]) == len(set(snapshot["teamIds"])) == 20
            and all(type(t) is int and t > 0 for t in snapshot["teamIds"]), "Invalid current-season membership.")
    current = check_rows(snapshot["rows"], seasons=(2026,), complete=False)
    require(all(utc(r["utcDate"]) < through and all(r[s]["id"] in snapshot["teamIds"] for s in ("homeTeam", "awayTeam")) for r in current),
            "Current targets must be from earlier UTC dates and current member teams.")
    rows = check_rows(dataset["rows"]) + current
    require(len({r["id"] for r in rows}) == len(rows), "Current and historical match IDs overlap.")
    settings = report["selectedSettings"]
    require(all(refitted["parameters"][key] == settings[key] for key in ("alpha", "halfLifeDays", "temperature")), "Refit settings do not match the evaluation.")
    model = fit(rows, settings["alpha"], settings["halfLifeDays"])
    model["temperature"] = settings["temperature"]
    exported = artifact(model, dataset, "experimental-current-season", test_only)
    exported.update({"experimental": True, "snapshotVersion": snapshot_version, "season": 2026,
                     "currentTeamIds": snapshot["teamIds"], "dataAsOf": snapshot["fetchedAt"],
                     "coverageThrough": snapshot["coverageThrough"], "expiresAt": snapshot["expiresAt"],
                     "currentSeasonMatches": len(current), "evaluationReference": evaluation.name,
                     "evaluationIsForDifferentFittedArtifact": True,
                     "evaluation": {key: report[key] for key in ("split", "testPoisson", "testFrequencyBaseline", "unseenTeamMatches", "limitations")},
                     "warning": "Experimental refit; historical evaluation concerns a different fitted artifact. No live/injury/lineup inputs or guarantee."})
    require(datetime.now(timezone.utc) < expires, "Snapshot expired during fitting. Refresh again; no model activated.")
    folder = new_run(root, "experimental")
    write_json(folder / "model.json", exported)
    # Publish only after the complete immutable artifact has been written.
    temp = root / f".EXPERIMENTAL.{uuid.uuid4().hex}.tmp"
    write_json(temp, {"run": folder.name, "sha256": sha((folder / "model.json").read_bytes())})
    temp.replace(root / "EXPERIMENTAL")
    return folder


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("evaluate", "refit", "inspect", "experimental"))
    parser.add_argument("--snapshot")
    args = parser.parse_args()
    if args.action == "inspect":
        print((latest(PRIVATE, "LATEST_EVALUATION") / "evaluation.md").read_text())
        return
    data = load_dataset()
    if args.action == "experimental":
        require(re.fullmatch(r"[a-f0-9]{64}", args.snapshot or ""), "Invalid current snapshot pointer.")
        content = (PRIVATE / "current" / f"{args.snapshot}.json").read_bytes()
        require(sha(content) == args.snapshot, "Current snapshot checksum failed.")
        snapshot = json.loads(content)
        require(re.fullmatch(r"[a-f0-9]{64}", snapshot.get("sourceSha256", "")), "Invalid current source checksum.")
        source = (PRIVATE / "current" / f"raw-{snapshot['sourceSha256']}.json").read_bytes()
        require(sha(source) == snapshot["sourceSha256"], "Current raw source checksum failed.")
        folder = experimental_dataset(data, snapshot, args.snapshot, PRIVATE)
        print(f"Experimental model prepared: {folder}\nValid until {snapshot['expiresAt']}. Earlier evaluation and refit preserved.\nOpen Predictions → Experimental model in the app. Refresh this model each UTC day.")
    elif args.action == "evaluate":
        folder, report = evaluate_dataset(data, PRIVATE)
        print(f"Evaluation saved: {folder}\nTest matches: {report['testPoisson']['matches']}\nNext: npm run model:inspect\nNo experimental model was activated by this command.")
    else:
        print(f"Separate all-history refit saved: {refit_dataset(data, PRIVATE)}\nEarlier evaluation preserved. Next: npm run model:prepare-current\nNo experimental model was activated by this command.")


if __name__ == "__main__":
    try:
        main()
    except (TrainingError, OSError, ValueError, KeyError, TypeError) as error:
        print(str(error) if isinstance(error, TrainingError) else "Local input is missing or invalid. Run model:validate (or model:train before model:inspect). No model was activated.", file=sys.stderr)
        sys.exit(1)

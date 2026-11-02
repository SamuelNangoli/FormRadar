"""Separate CL group/league-phase experiment. Reuses Poisson math, never PL team parameters."""
from collections import Counter
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import sys
import uuid
import numpy as np
import train as t

ROOT = t.PRIVATE / "champions-league"
COUNTS = {2023: 96, 2024: 144, 2025: 144}


def phase_rows(rows, season, complete=True):
    t.require(isinstance(rows, list), "Expected Champions League rows.")
    ids, pairs, home, away, rounds, opponents = set(), set(), Counter(), Counter(), Counter(), {}
    for r in rows:
        t.require(r.get("provider") == t.PROVIDER and r.get("competition") == "CL" and r.get("season") == season,
                  "Wrong Champions League target source.")
        phase = "GROUP_STAGE" if season == 2023 else "LEAGUE_STAGE"
        t.require(r.get("stage") == phase and type(r.get("id")) is int and r["id"] > 0 and r["id"] not in ids, "Invalid CL target stage/identity.")
        ids.add(r["id"])
        hi, ai = r["homeTeam"]["id"], r["awayTeam"]["id"]
        t.require(type(hi) is int and type(ai) is int and hi > 0 and ai > 0 and hi != ai
                  and all(r[s].get("provider") == t.PROVIDER for s in ("homeTeam", "awayTeam")), "Invalid CL team identity.")
        pair = (hi,ai) if season == 2023 else tuple(sorted((hi,ai)))
        t.require(pair not in pairs, "Repeated CL phase pairing.")
        pairs.add(pair)
        t.require(type(r.get("matchday")) is int and 1 <= r["matchday"] <= (6 if season == 2023 else 8), "Invalid CL phase matchday.")
        rounds[r["matchday"]] += 1
        t.require(all(type(r.get(k)) is int and 0 <= r[k] <= 50 for k in ("homeGoals", "awayGoals")), "Missing CL 90-minute goals.")
        when = t.utc(r["utcDate"])
        t.require(datetime(season, 7, 1, tzinfo=timezone.utc) <= when < datetime(season+1, 7, 1, tzinfo=timezone.utc), "CL target outside season.")
        home[hi] += 1
        away[ai] += 1
        opponents.setdefault(hi, set()).add(ai)
        opponents.setdefault(ai, set()).add(hi)
    if complete:
        side, teams = (3, 32) if season == 2023 else (4, 36)
        t.require(len(rows) == COUNTS[season] and len(home) == teams and home.keys() == away.keys()
                  and len(rounds) == (6 if season == 2023 else 8) and all(n == teams//2 for n in rounds.values())
                  and all(home[k] == away[k] == side and len(opponents[k]) == (3 if season == 2023 else 8) for k in home), "Incomplete historical CL phase.")
    return sorted(rows, key=lambda r: (r["utcDate"], r["id"]))


def load_inputs(version, snapshot_version, root=ROOT):
    t.require(all(re.fullmatch(r"[a-f0-9]{64}", v) for v in (version, snapshot_version)), "Invalid CL input version.")
    folder = root / "datasets" / version
    manifest = json.loads((folder / "manifest.json").read_text())
    content = (folder / "matches.json").read_bytes()
    t.require(manifest.get("schemaVersion") == 1 and manifest.get("datasetVersion") == version
              and manifest.get("competition") == "CL" and manifest.get("provider") == t.PROVIDER
              and manifest.get("testOnly") is False and t.sha(content) == manifest.get("normalizedSha256"), "CL dataset checksum/schema failed.")
    sources = manifest["sources"]
    t.require([s["season"] for s in sources] == list(COUNTS), "Invalid CL source seasons.")
    for s in sources:
        t.require(re.fullmatch(r"raw/CL-(2023|2024|2025)-[a-f0-9]{64}\.json", s["file"]), "Invalid CL source path.")
        raw = (root / s["file"]).read_bytes()
        t.require(t.sha(raw) == s["sha256"] and json.loads(raw).get("testOnly") is not True, "CL source integrity failed.")
    basis = [1, t.sha(content)] + [s["sha256"] for s in sources]
    t.require(t.sha(json.dumps(basis, separators=(",", ":")).encode()) == version, "CL dataset version failed.")
    rows = json.loads(content)
    checked = [r for season in COUNTS for r in phase_rows([r for r in rows if r["season"] == season], season)]
    t.require(len(checked) == len(rows) == len({r["id"] for r in rows}), "Unexpected/duplicate CL target rows.")
    content = (root / "current" / f"{snapshot_version}.json").read_bytes()
    t.require(t.sha(content) == snapshot_version, "CL snapshot checksum failed.")
    snapshot = json.loads(content)
    t.require(re.fullmatch(r"[a-f0-9]{64}", snapshot.get("sourceSha256", "")), "Invalid current CL source hash.")
    source = (root / "raw" / f"CL-2026-{snapshot['sourceSha256']}.json").read_bytes()
    t.require(t.sha(source) == snapshot["sourceSha256"] and json.loads(source).get("testOnly") is not True, "Current CL source integrity failed.")
    return {"version": version, "manifest": manifest, "rows": checked}, snapshot


def evaluate(dataset, root, allow_test=False):
    test_only = dataset["manifest"].get("testOnly", False)
    t.require(allow_test or not test_only, "Synthetic CL data cannot run a normal evaluation.")
    by_season = {s: phase_rows([r for r in dataset["rows"] if r["season"] == s], s) for s in COUNTS}
    train, valid, test = (by_season[s] for s in COUNTS)
    t.require(max(r["utcDate"] for r in train) < min(r["utcDate"] for r in valid)
              and max(r["utcDate"] for r in valid) < min(r["utcDate"] for r in test), "Overlapping CL seasons.")
    candidates = []
    for alpha in (1.0, 10.0):
        for half_life in (None, 365.0):
            model = t.fit(train, alpha, half_life)
            raw, _ = t.predict(model, valid)
            for temperature in (0.85, 1.0, 1.15):
                candidates.append({"alpha": alpha, "halfLifeDays": half_life, "temperature": temperature,
                                   "validationLogLoss": t.metrics(valid, t.temper(raw, temperature))["logLoss"]})
    settings = min(candidates, key=lambda s: s["validationLogLoss"])
    # Test outcomes never select settings. The release comparison is fixed before scoring.
    fitted = t.fit(train + valid, settings["alpha"], settings["halfLifeDays"])
    fitted["temperature"] = settings["temperature"]
    values, unseen = t.predict(fitted, test)
    score, baseline = t.metrics(test, values), t.metrics(test, t.frequency(train + valid, len(test)))
    report = {"schemaVersion": 1, "competition": "CL", "testOnly": test_only, "datasetVersion": dataset["version"],
              "generatedAt": t.stamp(), "split": {"initialTrain": [2023], "validation": [2024], "fitAfterSelection": [2023,2024], "untouchedTest": [2025]},
              "scope": "Champions League group/league phase only; knockout and qualifying matches excluded",
              "selectedSettings": settings, "validationCandidates": candidates, "testPoisson": score, "testFrequencyBaseline": baseline,
              "unseenTeamMatches": int(unseen.sum()), "unseenTeamEvaluation": t.metrics([r for r,u in zip(test,unseen) if u], values[unseen]) if unseen.any() else None,
              "gatePassed": score["logLoss"] < baseline["logLoss"] and score["brier"] <= baseline["brier"],
              "limitations": ["Retrospective corrected results, not genuine stored pre-kickoff forecasts.",
                              "Only 144 held-out league-phase matches; no walk-forward stability or uncertainty study.",
                              "The 2023/24 group format changed to the league phase in 2024/25.",
                              "CL phase results only: no domestic form, injuries, lineups, xG or in-play inputs.",
                              "Unseen clubs use the pooled CL prior, evaluated separately; limited-history clubs remain uncertain.",
                              "Temperature calibration is transferred to subsequent refits; no accuracy/profit guarantee."]}
    folder = t.new_run(root, "evaluation")
    exported = t.artifact(fitted, dataset, "held-out-evaluation", test_only)
    exported["codeVersion"] = t.sha(Path(__file__).read_bytes() + (t.PROJECT / "model/train.py").read_bytes() + (t.PROJECT / "model/requirements.txt").read_bytes())
    exported["competition"] = "CL"
    report["modelVersion"] = exported["modelVersion"]
    t.write_json(folder / "model.json", exported)
    t.write_json(folder / "evaluation.json", report)
    t.write_json(folder / "test-predictions.json", [{"matchId": r["id"], "probabilities": dict(zip(t.ORDER,map(float,p))),
                 "actualOutcome": t.ORDER[t.outcome(r)], "retrospective": True} for r,p in zip(test,values)])
    t.point(root, "LATEST_EVALUATION", folder)
    return folder, report


def prepare(dataset, snapshot, snapshot_version, root=ROOT, allow_test=False):
    test_only = dataset["manifest"].get("testOnly", False) or snapshot.get("testOnly") is not False
    t.require(allow_test or not test_only, "Synthetic CL inputs cannot activate estimates.")
    t.require(snapshot.get("schemaVersion") == 1 and snapshot.get("provider") == t.PROVIDER
              and snapshot.get("competition") == "CL" and snapshot.get("season") == 2026
              and snapshot.get("historicalDatasetVersion") == dataset["version"], "Invalid current CL snapshot source.")
    through, as_of, expires = (t.utc(snapshot[k]) for k in ("coverageThrough","fetchedAt","expiresAt"))
    t.require(through == as_of.replace(hour=0,minute=0,second=0,microsecond=0)
              and through <= as_of <= datetime.now(timezone.utc) < expires <= through+timedelta(days=1), "Current CL snapshot is stale or invalid.")
    t.require(len(snapshot["teamIds"]) == len(set(snapshot["teamIds"])) == 36 and all(type(i) is int and i > 0 for i in snapshot["teamIds"]), "Invalid CL club membership.")
    current = phase_rows(snapshot["rows"], 2026, complete=False)
    t.require(all(t.utc(r["utcDate"]) < through and all(r[s]["id"] in snapshot["teamIds"] for s in ("homeTeam","awayTeam")) for r in current), "Invalid current CL chronology/membership.")
    rows = [r for season in COUNTS for r in phase_rows([r for r in dataset["rows"] if r["season"] == season],season)] + current
    t.require(len(rows) == len({r["id"] for r in rows}), "Duplicate CL match IDs across seasons.")
    try:
        evaluation = t.latest(root,"LATEST_EVALUATION")
        report = json.loads((evaluation / "evaluation.json").read_text())
        t.require(report["datasetVersion"] == dataset["version"] and report["testOnly"] == test_only, "Different CL evaluation dataset.")
    except FileNotFoundError:
        evaluation, report = evaluate(dataset, root, allow_test)
    t.require(report["gatePassed"], "CL candidate did not beat the frequency baseline on both held-out metrics. Evaluation saved; no CL estimates activated.")
    settings = report["selectedSettings"]
    fitted = t.fit(rows, settings["alpha"], settings["halfLifeDays"])
    fitted["temperature"] = settings["temperature"]
    exported = t.artifact(fitted,dataset,"experimental-current-season",test_only)
    exported["codeVersion"] = t.sha(Path(__file__).read_bytes() + (t.PROJECT / "model/train.py").read_bytes() + (t.PROJECT / "model/requirements.txt").read_bytes())
    exported.update({"competition":"CL", "experimental":True, "season":2026, "snapshotVersion":snapshot_version,
                     "currentTeamIds":snapshot["teamIds"], "currentSeasonMatches":len(current), "dataAsOf":snapshot["fetchedAt"],
                     "coverageThrough":snapshot["coverageThrough"], "expiresAt":snapshot["expiresAt"], "supportedStages":["LEAGUE_STAGE"],
                     "evaluationReference":evaluation.name, "evaluationIsForDifferentFittedArtifact":True,
                     "evaluation":{k:report[k] for k in ("split","scope","testPoisson","testFrequencyBaseline","unseenTeamMatches","limitations")}})
    t.require(datetime.now(timezone.utc) < expires, "CL snapshot expired while fitting; refresh again.")
    folder = t.new_run(root,"experimental")
    t.write_json(folder / "model.json",exported)
    temp = root / f".EXPERIMENTAL.{uuid.uuid4().hex}.tmp"
    t.write_json(temp,{"run":folder.name,"sha256":t.sha((folder / "model.json").read_bytes())})
    temp.replace(root / "EXPERIMENTAL")
    return folder, report


if __name__ == "__main__":
    try:
        os.umask(0o077)
        t.require(len(sys.argv) == 3, "Use npm run model:prepare-cl.")
        data, snapshot = load_inputs(sys.argv[1],sys.argv[2])
        folder, report = prepare(data,snapshot,sys.argv[2])
        print(f"CL test (144 matches): Poisson log loss {report['testPoisson']['logLoss']:.6f}, Brier {report['testPoisson']['brier']:.6f}; frequency {report['testFrequencyBaseline']['logLoss']:.6f}, {report['testFrequencyBaseline']['brier']:.6f}.")
        print(f"Experimental CL league-phase model saved: {folder}\nValid until {snapshot['expiresAt']}. Refresh each UTC day with model:prepare-cl. PL models/evaluations preserved.")
    except (t.TrainingError, OSError, ValueError, KeyError, TypeError) as e:
        print(str(e) if isinstance(e,t.TrainingError) else "CL local input is missing or invalid; no new model activated.",file=sys.stderr)
        sys.exit(1)

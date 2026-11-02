import importlib.util
import json
import math
from pathlib import Path
import tempfile
import unittest
from datetime import datetime, timedelta, timezone

import numpy as np

SPEC = importlib.util.spec_from_file_location("formradar_train", Path(__file__).resolve().parents[1] / "train.py")
t = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(t)


def synthetic_dataset():
    rows = []
    rng = np.random.default_rng(42)
    for season in t.SEASONS:
        teams = list(range(1, 19)) + [19, 20] if season == 2023 else list(range(1, 19)) + [21, 22] if season == 2024 else list(range(1, 17)) + [21, 22, 23, 24]
        day = datetime(season, 8, 1, tzinfo=timezone.utc)
        count = 0
        for home in teams:
            for away in teams:
                if home == away:
                    continue
                rows.append({"provider": t.PROVIDER, "competition": "PL", "season": season,
                             "id": season * 1000 + count, "utcDate": (day + timedelta(hours=12*count)).isoformat().replace("+00:00", "Z"),
                             "homeTeam": {"provider": t.PROVIDER, "id": home}, "awayTeam": {"provider": t.PROVIDER, "id": away},
                             "homeGoals": int(rng.poisson(1.7 * math.exp(0.5 if home < 5 else -0.1))),
                             "awayGoals": int(rng.poisson(1.1 * math.exp(0.5 if away < 5 else -0.1)))})
                count += 1
    return {"rows": rows, "version": "synthetic-test-only", "manifest": {"testOnly": True,
            "sources": [{"fetchedAt": "2026-11-02T00:00:00Z"} for _ in t.SEASONS]}}


class ModelTests(unittest.TestCase):
    def test_current_export_preserves_history_and_evaluation_and_rejects_leakage(self):
        data = synthetic_dataset()
        now = datetime.now(timezone.utc)
        through = now.replace(hour=0, minute=0, second=0, microsecond=0)
        current = dict(data["rows"][0], season=2026, id=9000001,
                       utcDate=(through - timedelta(days=1)).isoformat().replace("+00:00", "Z"))
        snapshot = {"schemaVersion": 1, "provider": t.PROVIDER, "competition": "PL", "season": 2026,
                    "historicalDatasetVersion": data["version"], "testOnly": True,
                    "fetchedAt": now.isoformat().replace("+00:00", "Z"),
                    "coverageThrough": through.isoformat().replace("+00:00", "Z"),
                    "expiresAt": (through + timedelta(days=1)).isoformat().replace("+00:00", "Z"),
                    "teamIds": list(range(1, 21)), "rows": [current]}
        with tempfile.TemporaryDirectory(prefix="formradar-synthetic-current-") as directory:
            root = Path(directory)
            evaluated, _ = t.evaluate_dataset(data, root, allow_test=True)
            refitted = t.refit_dataset(data, root, allow_test=True)
            originals = {p: p.read_bytes() for p in (evaluated / "evaluation.json", refitted / "model.json", root / "LATEST_EVALUATION", root / "LATEST_REFIT")}
            with self.assertRaises(t.TrainingError):
                t.experimental_dataset(data, snapshot, "a" * 64, root)
            folder = t.experimental_dataset(data, snapshot, "a" * 64, root, allow_test=True)
            exported = json.loads((folder / "model.json").read_text())
            pointer = json.loads((root / "EXPERIMENTAL").read_text())
            self.assertEqual(exported["parameters"]["trainingMatches"], 1141)
            self.assertEqual(exported["currentSeasonMatches"], 1)
            self.assertTrue(exported["testOnly"])
            self.assertFalse(exported["deployable"])
            self.assertEqual(pointer["sha256"], t.sha((folder / "model.json").read_bytes()))
            self.assertTrue(all(p.read_bytes() == content for p, content in originals.items()))
            current["utcDate"] = snapshot["coverageThrough"]
            with self.assertRaises(t.TrainingError):
                t.experimental_dataset(data, snapshot, "b" * 64, root, allow_test=True)
            self.assertEqual(json.loads((root / "EXPERIMENTAL").read_text()), pointer)

    def test_probabilities_are_normalized_symmetric_and_not_hardcoded(self):
        p = t.goal_probabilities(1.2, 1.2)
        self.assertAlmostEqual(float(p[0]), float(p[2]), places=12)
        self.assertAlmostEqual(float(p.sum()), 1.0, places=12)
        self.assertGreater(t.goal_probabilities(3.0, 0.5)[0], 0.8)
        self.assertGreater(t.goal_probabilities(0.5, 3.0)[2], 0.8)
        with self.assertRaises(t.TrainingError):
            t.goal_probabilities(float("nan"), 1)

    def test_metrics_have_known_uniform_reference_values(self):
        rows = synthetic_dataset()["rows"][:10]
        metrics = t.metrics(rows, np.full((10, 3), 1/3))
        self.assertAlmostEqual(metrics["logLoss"], math.log(3), places=12)
        self.assertAlmostEqual(metrics["brier"], 2/3, places=12)
        for cls in t.ORDER:
            self.assertEqual(sum(b["count"] for b in metrics["calibration"][cls]["bins"]), 10)

    def test_fitting_recovers_signal_and_prior_handles_unseen_teams(self):
        rows = synthetic_dataset()["rows"]
        train = [r for r in rows if r["season"] == 2023]
        model = t.fit(train)
        self.assertAlmostEqual(sum(model["attack"]), 0, places=10)
        self.assertAlmostEqual(sum(model["defenceWeakness"]), 0, places=10)
        strengths = dict(zip(model["teamIds"], model["attack"]))
        self.assertGreater(np.mean([strengths[i] for i in range(1, 5)]),
                           np.mean([strengths[i] for i in range(5, 21)]))
        future = [r for r in rows if r["season"] == 2024]
        values, unseen = t.predict(model, future)
        self.assertTrue(np.isfinite(values).all())
        self.assertTrue(unseen.any())
        self.assertTrue(np.allclose(values.sum(axis=1), 1))
        with self.assertRaises(t.TrainingError):
            t.predict(model, train[:1])

    def test_rejects_missing_scores_duplicate_ids_and_noncomplete_seasons(self):
        data = synthetic_dataset()
        t.check_rows(data["rows"])
        data["rows"][0]["homeGoals"] = None
        with self.assertRaises(t.TrainingError):
            t.check_rows(data["rows"])
        with self.assertRaises(t.TrainingError):
            t.check_rows(synthetic_dataset()["rows"][:-1])

    def test_test_targets_cannot_change_selected_settings_or_fitted_parameters(self):
        data = synthetic_dataset()
        with tempfile.TemporaryDirectory(prefix="formradar-synthetic-model-") as directory:
            root = Path(directory)
            with self.assertRaises(t.TrainingError):
                t.evaluate_dataset(data, root)
            first, report1 = t.evaluate_dataset(data, root, allow_test=True)
            for row in data["rows"]:
                if row["season"] == 2025:
                    row["homeGoals"], row["awayGoals"] = 0, 5
            second, report2 = t.evaluate_dataset(data, root, allow_test=True)
            model1 = json.loads((first / "model.json").read_text())
            model2 = json.loads((second / "model.json").read_text())
            self.assertEqual(report1["selectedSettings"], report2["selectedSettings"])
            self.assertEqual(model1["parameters"], model2["parameters"])
            self.assertNotEqual(report1["testPoisson"]["logLoss"], report2["testPoisson"]["logLoss"])
            self.assertEqual(report1["testPoisson"]["matches"], 380)
            self.assertTrue(model1["testOnly"])
            self.assertFalse(model1["deployable"])
            self.assertFalse(report1["appActivated"])
            self.assertTrue((first / "evaluation.md").is_file())
            before = (second / "evaluation.json").read_bytes()
            with self.assertRaises(t.TrainingError):
                t.refit_dataset(data, root)
            refitted = t.refit_dataset(data, root, allow_test=True)
            refit_model = json.loads((refitted / "model.json").read_text())
            self.assertTrue(refit_model["testOnly"])
            self.assertTrue(refit_model["evaluationIsForDifferentFittedArtifact"])
            self.assertEqual(refit_model["parameters"]["alpha"], report2["selectedSettings"]["alpha"])
            self.assertEqual(refit_model["parameters"]["trainingMatches"], 1140)
            self.assertEqual((second / "evaluation.json").read_bytes(), before)
            self.assertEqual(t.latest(root, "LATEST_EVALUATION"), second)
            self.assertEqual(t.latest(root, "LATEST_REFIT"), refitted)


if __name__ == "__main__":
    unittest.main()

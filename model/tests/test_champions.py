"""Synthetic CL coverage and chronology tests, isolated from the user's data."""
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import champions as c
import train as t


def dataset():
    rows = []
    rng = np.random.default_rng(51)
    def add(season, home, away, round):
        strength = lambda i: 2.8 if i % 6 < 2 else 0.6
        rows.append({"provider":t.PROVIDER,"competition":"CL","season":season,
                     "stage":"GROUP_STAGE" if season == 2023 else "LEAGUE_STAGE", "matchday":round+1,
                     "id":season*1000+len([r for r in rows if r["season"] == season])+1,
                     "utcDate":(datetime(season,8,1,20,tzinfo=timezone.utc)+timedelta(days=21*round)).isoformat().replace("+00:00","Z"),
                     "homeTeam":{"provider":t.PROVIDER,"id":home},"awayTeam":{"provider":t.PROVIDER,"id":away},
                     "homeGoals":int(rng.poisson(1.6*strength(home))),"awayGoals":int(rng.poisson(1.1*strength(away)))})
    for season in (2023,2024,2025,2026):
        if season == 2023:
            pairs = (((1,2),(3,4)),((1,3),(4,2)),((1,4),(2,3)))
            for round in range(6):
                for group in range(8):
                    for h,a in pairs[round%3]:
                        add(season,group*4+(h if round<3 else a),group*4+(a if round<3 else h),round)
        else:
            for round in range(3 if season==2026 else 8):
                for i in range(18):
                    a,b = i+1,19+(i+round)%18
                    add(season,b if round%2 else a,a if round%2 else b,round)
    history = [r for r in rows if r["season"] != 2026]
    data = {"version":"a"*64,"rows":history,"manifest":{"testOnly":True,"sources":[{"fetchedAt":"2026-11-02T00:00:00Z"} for _ in range(3)]}}
    now = datetime.now(timezone.utc)
    through = now.replace(hour=0,minute=0,second=0,microsecond=0)
    current = [r for r in rows if r["season"] == 2026]
    for r in current:
        r["utcDate"] = (through-timedelta(days=4-r["matchday"])).isoformat().replace("+00:00","Z")
    snapshot = {"schemaVersion":1,"provider":t.PROVIDER,"competition":"CL","season":2026,"testOnly":True,
                "historicalDatasetVersion":data["version"],"teamIds":list(range(1,37)),"rows":current,
                "fetchedAt":now.isoformat().replace("+00:00","Z"),"coverageThrough":through.isoformat().replace("+00:00","Z"),
                "expiresAt":(through+timedelta(days=1)).isoformat().replace("+00:00","Z")}
    return data,snapshot


class ChampionsTests(unittest.TestCase):
    def test_phase_schema_and_complete_coverage(self):
        data,_ = dataset()
        for season,count in c.COUNTS.items():
            rows = [r for r in data["rows"] if r["season"] == season]
            self.assertEqual(len(c.phase_rows(rows,season)),count)
            with self.assertRaises(t.TrainingError): c.phase_rows(rows[:-1],season)
        rows = [r for r in data["rows"] if r["season"] == 2025]
        rows[0]["homeGoals"] = None
        with self.assertRaises(t.TrainingError): c.phase_rows(rows,2025)

    def test_test_targets_cannot_change_cl_settings_or_pretest_parameters(self):
        data,_ = dataset()
        with tempfile.TemporaryDirectory(prefix="formradar-synthetic-cl-evaluation-") as directory:
            root = Path(directory)
            with self.assertRaises(t.TrainingError): c.evaluate(data,root)
            first,report1 = c.evaluate(data,root,allow_test=True)
            for r in data["rows"]:
                if r["season"] == 2025: r["homeGoals"],r["awayGoals"] = 0,8
            second,report2 = c.evaluate(data,root,allow_test=True)
            a,b = (json.loads((p / "model.json").read_text()) for p in (first,second))
            self.assertEqual(report1["selectedSettings"],report2["selectedSettings"])
            self.assertEqual(a["parameters"],b["parameters"])
            self.assertNotEqual(report1["testPoisson"]["logLoss"],report2["testPoisson"]["logLoss"])
            self.assertEqual(report1["testPoisson"]["matches"],144)
            self.assertEqual(a["competition"],"CL")
            self.assertTrue(a["testOnly"])
            self.assertFalse(a["deployable"])

    def test_current_cl_export_preserves_evaluation_and_refuses_synthetic_or_today_targets(self):
        data,snapshot = dataset()
        with tempfile.TemporaryDirectory(prefix="formradar-synthetic-cl-export-") as directory:
            root = Path(directory)
            pl = root / "EXPERIMENTAL"
            pl.write_text("synthetic PL sentinel")
            cl = root / "champions-league"
            cl.mkdir()
            evaluation,report = c.evaluate(data,cl,allow_test=True)
            self.assertTrue(report["gatePassed"])
            before = (evaluation / "evaluation.json").read_bytes()
            with self.assertRaises(t.TrainingError): c.prepare(data,snapshot,"b"*64,cl)
            folder,_ = c.prepare(data,snapshot,"b"*64,cl,allow_test=True)
            m = json.loads((folder / "model.json").read_text())
            self.assertEqual(m["parameters"]["trainingMatches"],438)
            self.assertEqual(m["currentSeasonMatches"],54)
            self.assertEqual(m["supportedStages"],["LEAGUE_STAGE"])
            self.assertTrue(m["testOnly"])
            self.assertEqual(pl.read_text(),"synthetic PL sentinel")
            self.assertEqual((evaluation / "evaluation.json").read_bytes(),before)
            pointer = (cl / "EXPERIMENTAL").read_bytes()
            snapshot["rows"][0]["utcDate"] = snapshot["coverageThrough"]
            with self.assertRaises(t.TrainingError): c.prepare(data,snapshot,"c"*64,cl,allow_test=True)
            self.assertEqual((cl / "EXPERIMENTAL").read_bytes(),pointer)


if __name__ == "__main__": unittest.main()

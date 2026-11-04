import hashlib
import runpy

import joblib
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sklearn.dummy import DummyClassifier

from app.main import app
from app.model import FEATURES

KEY = "fr_" + "a" * 43  # Test fixture only, never a real credential.
HASH = hashlib.sha256(KEY.encode()).hexdigest()
MATCH = {
    "home_team": "Arsenal", "away_team": "Chelsea",
    "home_rating": 1740, "away_rating": 1660,
    "home_form": 11, "away_form": 8,
}


@pytest.fixture(autouse=True)
def settings(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("API_KEY_HASHES", HASH)
    monkeypatch.setenv("DEMO_MODE", "true")


def test_valid_key_and_health():
    with TestClient(app) as client:
        assert client.get("/health").json() == {"status": "ok"}
        result = client.post("/predict", json=MATCH,
                             headers={"X-API-Key": KEY})
        assert result.status_code == 200
        assert result.json()["is_demo"] is True
        assert result.json()["probabilities"]["home_win"] == 0.48
        assert result.headers["cache-control"] == "no-store"


@pytest.mark.parametrize("headers", [{}, {"X-API-Key": "wrong"},
                                    {"X-API-Key": "b" * 46}])
def test_unauthorized(headers):
    with TestClient(app) as client:
        response = client.post("/predict", json=MATCH, headers=headers)
        assert response.status_code == 401
        assert response.json() == {"detail": "Missing or invalid API key"}


@pytest.mark.parametrize("change", [
    {"home_form": 16}, {"home_form": "11"},
    {"away_team": "arsenal"}, {"home_team": "   "},
    {"extra_field": 1}, {"home_rating": -1},
])
def test_bad_input(change):
    with TestClient(app) as client:
        response = client.post("/predict", json={**MATCH, **change},
                               headers={"X-API-Key": KEY})
        assert response.status_code == 422


def test_docs_disabled():
    with TestClient(app) as client:
        assert client.get("/docs").status_code == 404
        assert client.get("/openapi.json").status_code == 404


@pytest.mark.parametrize("value", [None, "", "placeholder"])
def test_missing_or_bad_configuration_fails(monkeypatch, value):
    if value is None:
        monkeypatch.delenv("API_KEY_HASHES")
    else:
        monkeypatch.setenv("API_KEY_HASHES", value)
    with pytest.raises(ValidationError):
        with TestClient(app):
            pass


def test_missing_production_model_fails(monkeypatch):
    monkeypatch.setenv("DEMO_MODE", "false")
    with pytest.raises(FileNotFoundError):
        with TestClient(app):
            pass


def test_rotation_accepts_two_keys(monkeypatch):
    next_key = "fr_" + "c" * 43
    next_hash = hashlib.sha256(next_key.encode()).hexdigest()
    monkeypatch.setenv("API_KEY_HASHES", f"{HASH},{next_hash}")
    with TestClient(app) as client:
        for key in [KEY, next_key]:
            assert client.post("/predict", json=MATCH,
                               headers={"X-API-Key": key}).status_code == 200
    monkeypatch.setenv("API_KEY_HASHES", next_hash)
    with TestClient(app) as client:
        assert client.post("/predict", json=MATCH,
                           headers={"X-API-Key": KEY}).status_code == 401


def model_bundle():
    # Synthetic data verifies integration only, not prediction quality.
    model = DummyClassifier(strategy="prior")
    model.fit([[1, 2, 3, 4]] * 6,
              ["home_win"] * 3 + ["draw"] * 2 + ["away_win"])
    return {"model": model, "feature_names": FEATURES,
            "model_version": "synthetic-test-v1"}


def test_model_loading_and_class_mapping(monkeypatch, tmp_path):
    path = tmp_path / "test.joblib"
    joblib.dump(model_bundle(), path)
    monkeypatch.setenv("MODEL_PATH", str(path))
    monkeypatch.setenv("DEMO_MODE", "false")
    with TestClient(app) as client:
        result = client.post("/predict", json=MATCH,
                             headers={"X-API-Key": KEY}).json()
        assert result["is_demo"] is False
        assert result["model_version"] == "synthetic-test-v1"
        assert result["probabilities"] == {
            "home_win": 0.5, "draw": 2 / 6, "away_win": 1 / 6,
        }


def test_bad_model_contract_fails(monkeypatch, tmp_path):
    bundle = model_bundle()
    bundle["feature_names"] = list(reversed(FEATURES))
    path = tmp_path / "test.joblib"
    joblib.dump(bundle, path)
    monkeypatch.setenv("MODEL_PATH", str(path))
    monkeypatch.setenv("DEMO_MODE", "false")
    with pytest.raises(ValueError, match="feature order"):
        with TestClient(app):
            pass


def test_key_generator_private_and_no_overwrite(monkeypatch):
    from pathlib import Path
    script = Path(__file__).resolve().parents[1] / "scripts/create_key.py"
    runpy.run_path(str(script))
    client_config = Path(".client.env").read_text()
    key = client_config.splitlines()[0].split("=", 1)[1]
    assert hashlib.sha256(key.encode()).hexdigest() in Path(".env").read_text()
    assert Path(".env").stat().st_mode & 0o777 == 0o600
    assert Path(".client.env").stat().st_mode & 0o777 == 0o600
    with pytest.raises(SystemExit):
        runpy.run_path(str(script))
    assert Path(".client.env").read_text() == client_config

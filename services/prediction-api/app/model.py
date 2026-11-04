import math

import joblib

FEATURES = ["home_rating", "away_rating", "home_form", "away_form"]
OUTCOMES = {"home_win", "draw", "away_win"}


def load_bundle(path):
    # joblib can execute code. Load only your trusted artifact.
    bundle = joblib.load(path)
    if bundle["feature_names"] != FEATURES:
        raise ValueError("Model feature order does not match the API")
    model = bundle["model"]
    if not callable(getattr(model, "predict_proba", None)):
        raise ValueError("Model must support predict_proba")
    if set(model.classes_) != OUTCOMES:
        raise ValueError("Expected home_win, draw and away_win classes")
    if not isinstance(bundle["model_version"], str):
        raise ValueError("model_version must be a string")
    return bundle


def predict_probabilities(bundle, payload):
    if bundle is None:
        # Fixed values for testing plumbing, never betting advice.
        return {"home_win": 0.48, "draw": 0.27, "away_win": 0.25}
    row = [[getattr(payload, name) for name in FEATURES]]
    model = bundle["model"]
    values = [float(v) for v in model.predict_proba(row)[0]]
    if len(values) != 3 or any(
        not math.isfinite(v) or not 0 <= v <= 1 for v in values
    ) or not math.isclose(sum(values), 1, abs_tol=1e-6):
        raise ValueError("Invalid model probabilities")
    return dict(zip(model.classes_, values))

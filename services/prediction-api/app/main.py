import logging
from datetime import date
from urllib.parse import urlencode
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.config import Settings
from app.model import load_bundle, predict_probabilities
from app.security import require_api_key
from app.football import FootballFeed, COMPETITIONS, local_football_key

logger = logging.getLogger("formradar")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = Settings()
    app.state.settings = settings
    app.state.football = FootballFeed(local_football_key(settings.football_data_api_key))
    app.state.bundle = (
        None if settings.demo_mode else load_bundle(settings.model_path)
    )
    yield


app = FastAPI(
    title="FormRadar Prediction API", lifespan=lifespan,
    docs_url=None, redoc_url=None, openapi_url=None,
)


class MatchInput(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    home_team: str = Field(min_length=1, max_length=80)
    away_team: str = Field(min_length=1, max_length=80)
    home_rating: float = Field(ge=0, le=3000)
    away_rating: float = Field(ge=0, le=3000)
    home_form: int = Field(ge=0, le=15, strict=True)
    away_form: int = Field(ge=0, le=15, strict=True)

    @model_validator(mode="after")
    def check_teams(self):
        self.home_team = self.home_team.strip()
        self.away_team = self.away_team.strip()
        if not self.home_team or not self.away_team:
            raise ValueError("Team names cannot be blank")
        if self.home_team.casefold() == self.away_team.casefold():
            raise ValueError("Teams must be different")
        return self


class Probabilities(BaseModel):
    home_win: float = Field(ge=0, le=1)
    draw: float = Field(ge=0, le=1)
    away_win: float = Field(ge=0, le=1)


class Prediction(BaseModel):
    home_team: str
    away_team: str
    probabilities: Probabilities
    model_version: str
    is_demo: bool


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/football/status", dependencies=[Depends(require_api_key)])
def football_status(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-store"
    return {"configured": request.app.state.football.configured,
            "season": 2026, "upstream": "football-data.org",
            "scores_may_be_delayed": True}


@app.get("/football/competitions/{competition}/matches", dependencies=[Depends(require_api_key)])
def football_matches(competition: str, request: Request, response: Response,
                     season: int = Query(default=2026, ge=2026, le=2026),
                     dateFrom: date | None = None, dateTo: date | None = None,
                     status: str | None = None):
    if competition not in COMPETITIONS:
        raise HTTPException(400, "Unsupported competition")
    if dateFrom and dateTo and dateFrom > dateTo:
        raise HTTPException(400, "Dates must be in order")
    allowed = {"SCHEDULED", "TIMED", "IN_PLAY", "PAUSED", "FINISHED", "SUSPENDED", "POSTPONED", "CANCELLED", "AWARDED"}
    if status and (len(status) > 100 or any(s not in allowed for s in status.split(","))):
        raise HTTPException(400, "Unsupported match status")
    query = {"season": season}
    if dateFrom:
        query["dateFrom"] = dateFrom.isoformat()
    if dateTo:
        query["dateTo"] = dateTo.isoformat()
    if status:
        query["status"] = status
    response.headers["Cache-Control"] = "no-store"
    return request.app.state.football.get(f"/competitions/{competition}/matches?{urlencode(query)}")


@app.get("/football/matches/{match_id}", dependencies=[Depends(require_api_key)])
def football_match(match_id: int, request: Request, response: Response):
    if not 1 <= match_id <= 9_999_999:
        raise HTTPException(400, "Invalid match ID")
    response.headers["Cache-Control"] = "no-store"
    return request.app.state.football.get(f"/matches/{match_id}")


@app.post(
    "/predict", response_model=Prediction,
    dependencies=[Depends(require_api_key)],
)
def predict(payload: MatchInput, request: Request, response: Response):
    bundle = request.app.state.bundle
    try:
        probabilities = predict_probabilities(bundle, payload)
    except Exception:
        # Do not log the request, headers or credentials.
        logger.error("Prediction failed; check the model artifact")
        raise HTTPException(503, "Prediction service unavailable") from None
    response.headers["Cache-Control"] = "no-store"
    return Prediction(
        home_team=payload.home_team,
        away_team=payload.away_team,
        probabilities=Probabilities(**probabilities),
        model_version="demo-v1" if bundle is None
        else bundle["model_version"],
        is_demo=bundle is None,
    )

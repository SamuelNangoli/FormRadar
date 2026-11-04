import io
import json
from urllib.error import HTTPError

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.football import FootballFeed, NoRedirect
from app.main import app
from test_api import KEY, settings  # Reuse the synthetic per-test environment.


class FakeOpener:
    def __init__(self, body=None, error=None):
        self.body = body or {"id": 500, "minute": 65, "goals": []}
        self.error = error
        self.calls = []

    def open(self, request, timeout):
        self.calls.append(request)
        assert request.full_url.startswith("https://api.football-data.org/v4/")
        assert timeout == 8
        if self.error:
            raise self.error
        return io.BytesIO(json.dumps(self.body).encode())


def test_private_routes_authentication_and_validation():
    with TestClient(app) as client:
        opener = FakeOpener()
        app.state.football = FootballFeed("synthetic-upstream-key", opener=opener)
        for path in ["/football/status", "/football/matches/500", "/football/competitions/PL/matches?season=2026"]:
            assert client.get(path).status_code == 401
            assert client.get(path, headers={"X-API-Key": "wrong"}).status_code == 401
        assert opener.calls == []
        headers = {"X-API-Key": KEY}
        result = client.get("/football/matches/500", headers=headers)
        assert result.status_code == 200
        assert result.json()["minute"] == 65
        assert result.headers["cache-control"] == "no-store"
        assert client.get("/football/matches/500", headers=headers).status_code == 200
        assert len(opener.calls) == 1
        assert client.get("/football/competitions/PL/matches?season=2025", headers=headers).status_code == 422
        assert client.get("/football/competitions/ZZ/matches", headers=headers).status_code == 400
        assert client.get("/football/matches/0", headers=headers).status_code == 400


def test_2026_season_passes_only_valid_filters_to_fixed_upstream():
    with TestClient(app) as client:
        opener = FakeOpener({"matches": []})
        app.state.football = FootballFeed("synthetic-upstream-key", opener=opener)
        headers = {"X-API-Key": KEY}
        response = client.get("/football/competitions/PL/matches?season=2026&dateFrom=2026-11-01&dateTo=2026-11-08&status=IN_PLAY,PAUSED", headers=headers)
        assert response.status_code == 200
        assert "season=2026" in opener.calls[0].full_url
        assert client.get("/football/competitions/PL/matches?status=https://attacker.test", headers=headers).status_code == 400
        assert client.get("/football/competitions/PL/matches?dateFrom=bad", headers=headers).status_code == 422
        assert len(opener.calls) == 1


def test_quota_and_error_bodies_are_not_forwarded():
    clock = [0]
    opener = FakeOpener({"matches": []})
    feed = FootballFeed("synthetic-upstream-key", clock=lambda: clock[0], opener=opener)
    for i in range(8):
        feed.get(f"/competitions/PL/matches?season=2026&dateFrom=2026-11-{i+1:02d}")
    with pytest.raises(HTTPException) as result:
        feed.get("/matches/500")
    assert result.value.status_code == 429
    assert len(opener.calls) == 8
    clock[0] = 61
    opener.body = {"id": 500}
    assert feed.get("/matches/500")["id"] == 500
    error = HTTPError("https://private.test", 403, "secret-token", {}, None)
    restricted = FootballFeed("synthetic-upstream-key", opener=FakeOpener(error=error))
    with pytest.raises(HTTPException) as result:
        restricted.get("/matches/500")
    assert result.value.status_code == 503
    assert "secret-token" not in result.value.detail


@pytest.mark.parametrize("body", [{"id": 501}, {"id": 500, "echo": "synthetic-upstream-key"}])
def test_wrong_id_and_credential_echo_are_rejected(body):
    with pytest.raises(HTTPException) as result:
        FootballFeed("synthetic-upstream-key", opener=FakeOpener(body)).get("/matches/500")
    assert result.value.status_code == 503


def test_redirects_are_not_followed():
    assert NoRedirect().redirect_request(None, None, 302, "", {}, "https://attacker.test") is None

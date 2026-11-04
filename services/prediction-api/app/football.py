"""Authenticated football-data facade. A prediction model is not a live feed."""

import json
import logging
import re
import time
from collections import deque
from pathlib import Path
from threading import Lock
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener

from dotenv import dotenv_values
from fastapi import HTTPException


COMPETITIONS = {"PL", "CL", "PD", "BL1", "SA", "FL1", "ELC", "DED", "PPL", "BSA", "EC", "WC"}


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def local_football_key(configured):
    if configured.strip():
        return configured.strip()
    # Compatibility with the user's existing FormRadar/ai-service layout.
    # Read one named setting; never import unrelated parent configuration.
    parent = Path(__file__).resolve().parents[2] / ".env"
    return (dotenv_values(parent).get("FOOTBALL_DATA_API_KEY") or "").strip()


class FootballFeed:
    def __init__(self, key, clock=time.monotonic, opener=None):
        self.key = key
        self.clock = clock
        self.opener = opener or build_opener(NoRedirect())
        self.lock = Lock()
        self.cache = {}
        self.calls = deque()
        self.cooldown = 0

    @property
    def configured(self):
        return bool(self.key and not re.match(r"^(your|paste|replace)", self.key, re.I))

    def get(self, path):
        if not self.configured:
            raise HTTPException(503, "Football data key is not configured on the API server")
        if not re.fullmatch(r"/(?:matches/[1-9][0-9]{0,6}|competitions/[A-Z0-9]{2,3}/matches\?[A-Za-z0-9%=&_,+.-]+)", path):
            raise HTTPException(400, "Unsupported football resource")
        # Serialize cache misses to coalesce concurrent callers and enforce quotas.
        with self.lock:
            now = self.clock()
            cached = self.cache.get(path)
            if cached and now - cached[0] < 60:
                return cached[1]
            while self.calls and now - self.calls[0] >= 60:
                self.calls.popleft()
            if now < self.cooldown or len(self.calls) >= 8:
                raise HTTPException(429, "Football request budget is busy; retry later", headers={"Retry-After": "60"})
            self.calls.append(now)
            req = Request("https://api.football-data.org/v4" + path,
                          headers={"X-Auth-Token": self.key, "Accept": "application/json"})
            try:
                with self.opener.open(req, timeout=8) as response:
                    raw = response.read(5_000_001)
                if len(raw) > 5_000_000:
                    raise ValueError("oversized")
                body = json.loads(raw)
                if not isinstance(body, dict) or self.key in json.dumps(body):
                    raise ValueError("invalid body")
                if path.startswith("/matches/"):
                    if body.get("id") != int(path.rsplit("/", 1)[1]):
                        raise ValueError("wrong fixture")
                elif not isinstance(body.get("matches"), list):
                    raise ValueError("missing fixtures")
            except HTTPError as error:
                self.cooldown = now + (60 if error.code == 429 else 15)
                status = 429 if error.code == 429 else 503
                message = ("The upstream football plan does not include this data"
                           if error.code == 403 else "The upstream football service could not supply this data")
                raise HTTPException(status, message, headers={"Retry-After": "60"}) from None
            except (URLError, TimeoutError, OSError, ValueError) as error:
                # Log only an exception category, never an URL, token or body.
                kind = type(error.reason).__name__ if isinstance(error, URLError) else type(error).__name__
                logging.getLogger("formradar").warning("Football upstream unavailable (%s)", kind)
                self.cooldown = now + 15
                raise HTTPException(503, "The upstream football service is unavailable") from None
            if len(self.cache) >= 100 and path not in self.cache:
                self.cache.pop(next(iter(self.cache)))
            self.cache[path] = (self.clock(), body)
            return body

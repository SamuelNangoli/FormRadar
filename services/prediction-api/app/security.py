import hashlib
import hmac
from typing import Annotated

from fastapi import HTTPException, Request, Security
from fastapi.security import APIKeyHeader

key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def require_api_key(
    request: Request,
    api_key: Annotated[str | None, Security(key_header)],
) -> None:
    if api_key is not None and 20 <= len(api_key) <= 128:
        digest = hashlib.sha256(api_key.encode("utf-8")).hexdigest()
        matches = [
            hmac.compare_digest(digest, expected)
            for expected in request.app.state.settings.allowed_hashes
        ]
        if any(matches):
            return
    raise HTTPException(
        status_code=401,
        detail="Missing or invalid API key",
        headers={"WWW-Authenticate": "APIKey"},
    )

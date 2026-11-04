import hashlib
import os
import secrets
from pathlib import Path

os.umask(0o077)
key = "fr_" + secrets.token_urlsafe(32)
with Path(".client-next.env").open("x", encoding="utf-8") as stream:
    stream.write(f"FORMRADAR_API_KEY={key}\n")
print("New key saved privately to .client-next.env")
print("Add this hash to API_KEY_HASHES, separated by a comma:")
print(hashlib.sha256(key.encode("utf-8")).hexdigest())

import hashlib
import os
import secrets
from pathlib import Path

# Run from the ai-service directory. Do not overwrite existing keys.
paths = [Path(".env"), Path(".client.env")]
if any(path.exists() for path in paths):
    raise SystemExit("Existing credentials found. Use the rotation procedure.")
os.umask(0o077)
key = "fr_" + secrets.token_urlsafe(32)
digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
server_config = (
    f"API_KEY_HASHES={digest}\n"
    "DEMO_MODE=true\n"
    "MODEL_PATH=models/formradar.joblib\n"
)
client_config = (
    f"FORMRADAR_API_KEY={key}\n"
    "FORMRADAR_API_URL=http://127.0.0.1:8000\n"
)
for path, content in zip(paths, [server_config, client_config]):
    with path.open("x", encoding="utf-8") as stream:
        stream.write(content)
    path.chmod(0o600)
print("Created .env and .client.env with owner-only permissions.")
print("Keep .client.env private. The server stores only the key hash.")

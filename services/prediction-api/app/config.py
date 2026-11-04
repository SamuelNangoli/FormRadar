import re
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="forbid"
    )
    api_key_hashes: str
    demo_mode: bool = False
    model_path: Path = Path("models/formradar.joblib")
    football_data_api_key: str = ""

    @field_validator("api_key_hashes")
    @classmethod
    def validate_hashes(cls, value: str) -> str:
        parts = [part.strip() for part in value.split(",")]
        if not parts or any(
            re.fullmatch(r"[0-9a-f]{64}", part) is None
            for part in parts
        ):
            raise ValueError("Set comma-separated SHA-256 key hashes")
        return ",".join(parts)

    @property
    def allowed_hashes(self) -> tuple[str, ...]:
        return tuple(self.api_key_hashes.split(","))

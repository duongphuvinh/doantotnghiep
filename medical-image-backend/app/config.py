from functools import lru_cache
from os import getenv
from pathlib import Path

from pydantic import BaseModel


class Settings(BaseModel):
    app_name: str = "Medical Image Backend"
    model_path: str | None = getenv("MEDICAL_IMAGE_MODEL_PATH")
    model_labels: list[str] = [
        label.strip()
        for label in getenv(
            "MEDICAL_IMAGE_MODEL_LABELS",
            "normal,fracture,arthritis,osteoporosis,other",
        ).split(",")
        if label.strip()
    ]
    max_upload_mb: int = int(getenv("MEDICAL_IMAGE_MAX_UPLOAD_MB", "25"))
    database_path: str = getenv("MEDICAL_IMAGE_DB_PATH", "data/medical_app.db")
    auth_secret: str = getenv("MEDICAL_IMAGE_AUTH_SECRET", "dev-secret-change-me")
    access_token_minutes: int = int(getenv("MEDICAL_IMAGE_ACCESS_TOKEN_MINUTES", "480"))

    @property
    def resolved_model_path(self) -> Path | None:
        if not self.model_path:
            return None
        return Path(self.model_path).expanduser().resolve()

    @property
    def resolved_database_path(self) -> Path:
        return Path(self.database_path).expanduser().resolve()

    def validate_security(self) -> None:
        if self.auth_secret == "dev-secret-change-me":
            # Keep local development ergonomic, but make the risk visible in logs.
            print(
                "[security] MEDICAL_IMAGE_AUTH_SECRET is using the development default. "
                "Set a strong secret before using real patient data."
            )


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.validate_security()
    return settings

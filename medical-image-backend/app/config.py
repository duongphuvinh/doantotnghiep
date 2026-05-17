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

    @property
    def resolved_model_path(self) -> Path | None:
        if not self.model_path:
            return None
        return Path(self.model_path).expanduser().resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()


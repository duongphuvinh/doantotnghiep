from typing import Literal

from pydantic import BaseModel, Field


Modality = Literal["xray", "ct", "mri", "unknown"]


class ImageMetadata(BaseModel):
    filename: str
    content_type: str | None = None
    modality: Modality = "unknown"
    body_part: str | None = None
    width: int
    height: int
    channels: int
    source_format: str
    dicom: dict[str, str | int | float | None] = Field(default_factory=dict)


class QualityMetrics(BaseModel):
    mean_intensity: float
    contrast_std: float
    sharpness_laplacian_var: float
    dynamic_range: float
    dark_pixel_ratio: float
    bright_pixel_ratio: float
    warnings: list[str] = Field(default_factory=list)


class BoneFeatureSummary(BaseModel):
    estimated_bone_area_ratio: float
    high_density_region_count: int
    edge_density: float
    symmetry_score: float | None = None
    feature_vector: list[float]


class PreprocessInfo(BaseModel):
    normalized: bool
    contrast_enhanced: bool
    resized_to: tuple[int, int]
    original_size: tuple[int, int]


class PredictionResult(BaseModel):
    status: Literal["model_prediction", "analysis_only"]
    labels: list[str] = Field(default_factory=list)
    probabilities: list[float] = Field(default_factory=list)
    top_label: str | None = None
    confidence: float | None = None
    note: str


class ImageAnalysisResponse(BaseModel):
    metadata: ImageMetadata
    preprocessing: PreprocessInfo
    quality: QualityMetrics
    features: BoneFeatureSummary
    prediction: PredictionResult
    safety_note: str


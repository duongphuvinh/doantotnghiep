from datetime import datetime
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


Gender = Literal["male", "female", "other", "unknown"]
UserRole = Literal["patient", "clinician", "admin"]


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=80)
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = Field(default=None, max_length=120)


class UserLogin(BaseModel):
    username: str
    password: str


class UserPublic(BaseModel):
    id: int
    username: str
    full_name: str | None = None
    role: UserRole


class AuthToken(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class PatientCreate(BaseModel):
    patient_code: str = Field(min_length=1, max_length=40)
    full_name: str = Field(min_length=1, max_length=120)
    age: int = Field(ge=0, le=130)
    gender: Gender = "unknown"
    phone: str | None = Field(default=None, max_length=30)
    address: str | None = Field(default=None, max_length=250)


class PatientPublic(BaseModel):
    id: int
    patient_code: str
    full_name: str
    age: int
    gender: Gender
    created_at: datetime


class PatientDetail(PatientPublic):
    phone: str | None = None
    address: str | None = None
    owner_user_id: int


class ClinicalRecordCreate(BaseModel):
    symptoms: list[str] = Field(default_factory=list)
    medical_history: list[str] = Field(default_factory=list)
    clinical_indicators: dict[str, str | int | float | bool | None] = Field(default_factory=dict)
    note: str | None = Field(default=None, max_length=2000)


class ClinicalRecordPublic(BaseModel):
    id: int
    patient_id: int
    symptoms: list[str]
    medical_history: list[str]
    clinical_indicators: dict[str, str | int | float | bool | None]
    note: str | None = None
    created_at: datetime


class ClinicalAnalyzeRequest(BaseModel):
    age: int = Field(ge=0, le=130)
    gender: Gender = "unknown"
    symptoms: list[str] = Field(default_factory=list)
    medical_history: list[str] = Field(default_factory=list)
    clinical_indicators: dict[str, str | int | float | bool | None] = Field(default_factory=dict)


class ClinicalRiskItem(BaseModel):
    level: Literal["low", "medium", "high"]
    reason: str


class ClinicalAnalyzeResponse(BaseModel):
    normalized: ClinicalAnalyzeRequest
    risk_items: list[ClinicalRiskItem]
    summary: str
    recommended_next_steps: list[str]
    safety_note: str


LabCategory = Literal["blood", "urine"]
LabStatus = Literal["low", "normal", "high", "positive", "negative", "abnormal", "unknown"]
LabSeverity = Literal["info", "watch", "attention", "urgent"]


class LabValueInput(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    value: str | int | float | bool
    unit: str | None = Field(default=None, max_length=40)
    category: LabCategory | None = None


class LabAnalyzeRequest(BaseModel):
    age: int | None = Field(default=None, ge=0, le=130)
    gender: Gender = "unknown"
    values: list[LabValueInput] = Field(default_factory=list)
    raw_text: str | None = Field(default=None, max_length=12000)


class LabResultItem(BaseModel):
    category: LabCategory
    code: str
    name: str
    input_name: str
    value: str | float | bool
    unit: str | None = None
    reference_range: str
    status: LabStatus
    severity: LabSeverity
    interpretation: str


class LabAnalyzeResponse(BaseModel):
    items: list[LabResultItem]
    summary: str
    abnormal_count: int
    urgent_count: int
    recommended_next_steps: list[str]
    safety_note: str


class FusionSignal(BaseModel):
    source: Literal["image", "clinical"]
    name: str
    value: str | int | float | bool
    weight: float
    contribution: float
    explanation: str


class MultimodalAnalyzeResponse(BaseModel):
    image: ImageAnalysisResponse
    clinical: ClinicalAnalyzeResponse
    lab: LabAnalyzeResponse | None = None
    fusion_method: Literal["rule_weighted_late_fusion", "model_fusion"]
    fusion_score: float
    risk_level: Literal["low", "medium", "high"]
    predicted_label: str
    confidence: float
    signals: list[FusionSignal]
    explanation: str
    recommended_next_steps: list[str]
    safety_note: str


class EvaluationRecord(BaseModel):
    y_true: str
    y_pred: str
    model_name: str = "multimodal"


class ClassMetric(BaseModel):
    label: str
    support: int
    precision: float
    recall: float
    f1_score: float


class ModelEvaluationMetrics(BaseModel):
    model_name: str
    accuracy: float
    macro_precision: float
    macro_recall: float
    macro_f1: float
    weighted_f1: float
    total: int
    class_metrics: list[ClassMetric]
    confusion_matrix: dict[str, dict[str, int]]


class EvaluationRequest(BaseModel):
    records: list[EvaluationRecord]


class EvaluationResponse(BaseModel):
    models: list[ModelEvaluationMetrics]
    best_model_by_macro_f1: str | None = None
    comparison_summary: str


class PredictionRunCreate(BaseModel):
    case_code: str = Field(min_length=1, max_length=80)
    y_true: str = Field(min_length=1, max_length=80)
    before_ai_pred: str | None = Field(default=None, max_length=80)
    image_ai_pred: str | None = Field(default=None, max_length=80)
    clinical_ai_pred: str | None = Field(default=None, max_length=80)
    multimodal_pred: str | None = Field(default=None, max_length=80)
    note: str | None = Field(default=None, max_length=1000)


class PredictionRunPublic(PredictionRunCreate):
    id: int
    owner_user_id: int
    created_at: datetime

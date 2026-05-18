from __future__ import annotations

import csv
import json
import sqlite3
from io import StringIO

from fastapi import Depends
from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from .clinical import ClinicalDataProcessor
from .config import get_settings
from .evaluation import EvaluationService
from .image_io import UnsupportedImageError, read_medical_image
from .lab_file_parser import UnsupportedLabFileError, extract_lab_text_from_file
from .lab_results import LabResultProcessor
from .model import BoneModelService
from .multimodal import MultimodalFusionService
from .processor import MedicalImageProcessor
from .schemas import (
    AuthToken,
    ClinicalAnalyzeRequest,
    ClinicalAnalyzeResponse,
    ClinicalRecordCreate,
    ClinicalRecordPublic,
    EvaluationRecord,
    EvaluationRequest,
    EvaluationResponse,
    ImageAnalysisResponse,
    ImageMetadata,
    LabAnalyzeRequest,
    LabAnalyzeResponse,
    MultimodalAnalyzeResponse,
    Modality,
    PatientCreate,
    PatientDetail,
    PatientPublic,
    PredictionRunCreate,
    PredictionRunPublic,
    UserCreate,
    UserLogin,
    UserPublic,
)
from .security import (
    CurrentUser,
    create_access_token,
    ensure_patient_access,
    get_current_user,
    hash_password,
    verify_password,
)
from .storage import Database

settings = get_settings()
processor = MedicalImageProcessor()
clinical_processor = ClinicalDataProcessor()
lab_processor = LabResultProcessor()
fusion_processor = MultimodalFusionService()
evaluation_processor = EvaluationService()
model_service = BoneModelService(settings.resolved_model_path, settings.model_labels)
database = Database()

app = FastAPI(
    title=settings.app_name,
    description="Bone-related medical image processing API for X-ray, CT, MRI, and DICOM files.",
    version="0.1.0",
)


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "model_ready": model_service.is_ready,
        "model_path": str(settings.resolved_model_path) if settings.resolved_model_path else None,
        "model_load_error": model_service.load_error,
    }


def _user_public(row: dict) -> UserPublic:
    return UserPublic(
        id=int(row["id"]),
        username=str(row["username"]),
        full_name=row["full_name"],
        role=row["role"],
    )


def _patient_public(row: dict) -> PatientPublic:
    return PatientPublic(
        id=int(row["id"]),
        patient_code=str(row["patient_code"]),
        full_name=str(row["full_name"]),
        age=int(row["age"]),
        gender=row["gender"],
        created_at=row["created_at"],
    )


def _patient_detail(row: dict) -> PatientDetail:
    return PatientDetail(
        id=int(row["id"]),
        patient_code=str(row["patient_code"]),
        full_name=str(row["full_name"]),
        age=int(row["age"]),
        gender=row["gender"],
        phone=row["phone"],
        address=row["address"],
        owner_user_id=int(row["owner_user_id"]),
        created_at=row["created_at"],
    )


def _clinical_record_public(row: dict) -> ClinicalRecordPublic:
    return ClinicalRecordPublic(
        id=int(row["id"]),
        patient_id=int(row["patient_id"]),
        symptoms=row["symptoms"],
        medical_history=row["medical_history"],
        clinical_indicators=row["clinical_indicators"],
        note=row["note"],
        created_at=row["created_at"],
    )


def _prediction_run_public(row: dict) -> PredictionRunPublic:
    return PredictionRunPublic(
        id=int(row["id"]),
        owner_user_id=int(row["owner_user_id"]),
        case_code=row["case_code"],
        y_true=row["y_true"],
        before_ai_pred=row["before_ai_pred"],
        image_ai_pred=row["image_ai_pred"],
        clinical_ai_pred=row["clinical_ai_pred"],
        multimodal_pred=row["multimodal_pred"],
        note=row["note"],
        created_at=row["created_at"],
    )


def _to_dict(payload: object) -> dict:
    if hasattr(payload, "model_dump"):
        return payload.model_dump()  # type: ignore[attr-defined]
    return payload.dict()  # type: ignore[attr-defined]


def _image_analysis_response(
    content: bytes,
    filename: str,
    content_type: str | None,
    modality: Modality = "unknown",
    body_part: str | None = None,
) -> ImageAnalysisResponse:
    try:
        image, source_format, dicom_meta = read_medical_image(content, filename)
    except UnsupportedImageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    processed, preprocess_info = processor.preprocess(image)
    quality = processor.quality_metrics(processed)
    features = processor.extract_bone_features(processed)
    prediction = model_service.predict(processed)
    resolved_modality = _resolve_modality(modality, dicom_meta.get("modality"))

    channels = 1 if len(processed.shape) == 2 else int(processed.shape[2])
    metadata = ImageMetadata(
        filename=filename,
        content_type=content_type,
        modality=resolved_modality,
        body_part=body_part or dicom_meta.get("body_part"),
        width=int(processed.shape[1]),
        height=int(processed.shape[0]),
        channels=channels,
        source_format=source_format,
        dicom=dicom_meta,
    )

    return ImageAnalysisResponse(
        metadata=metadata,
        preprocessing=preprocess_info,
        quality=quality,
        features=features,
        prediction=prediction,
        safety_note=(
            "Kết quả AI chỉ hỗ trợ sàng lọc và tham khảo ban đầu, không phải chẩn đoán độc lập. "
            "Cần bác sĩ/chuyên khoa chẩn đoán hình ảnh đối chiếu phim gốc, vị trí đau, khám lâm sàng và tiền sử chấn thương."
        ),
    )


@app.post("/api/auth/register", response_model=AuthToken)
def register_user(payload: UserCreate) -> AuthToken:
    try:
        user = database.create_user(
            username=payload.username.strip().lower(),
            password_hash=hash_password(payload.password),
            full_name=payload.full_name.strip() if payload.full_name else None,
        )
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Username already exists") from exc

    return AuthToken(
        access_token=create_access_token(int(user["id"])),
        user=_user_public(user),
    )


@app.post("/api/auth/login", response_model=AuthToken)
def login_user(payload: UserLogin) -> AuthToken:
    user = database.get_user_by_username(payload.username.strip().lower())
    if user is None or not verify_password(payload.password, str(user["password_hash"])):
        raise HTTPException(status_code=401, detail="Invalid username or password")

    return AuthToken(
        access_token=create_access_token(int(user["id"])),
        user=_user_public(user),
    )


@app.get("/api/auth/me", response_model=UserPublic)
def get_me(current_user: CurrentUser = Depends(get_current_user)) -> UserPublic:
    return UserPublic(
        id=current_user.id,
        username=current_user.username,
        full_name=current_user.full_name,
        role=current_user.role,
    )


def _resolve_modality(user_modality: Modality, dicom_modality: object | None) -> Modality:
    if user_modality != "unknown":
        return user_modality

    code = str(dicom_modality or "").strip().upper()
    if code in {"DX", "CR", "XR", "X-RAY", "XRAY"}:
        return "xray"
    if code == "CT":
        return "ct"
    if code in {"MR", "MRI"}:
        return "mri"
    return "unknown"


@app.post("/api/patients", response_model=PatientDetail)
def create_patient(
    payload: PatientCreate,
    current_user: CurrentUser = Depends(get_current_user),
) -> PatientDetail:
    try:
        patient = database.create_patient(current_user.id, _to_dict(payload))
    except sqlite3.IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Patient code already exists for this user") from exc
    return _patient_detail(patient)


@app.get("/api/patients", response_model=list[PatientPublic])
def list_patients(current_user: CurrentUser = Depends(get_current_user)) -> list[PatientPublic]:
    rows = database.list_patients(current_user.id, current_user.role)
    return [_patient_public(row) for row in rows]


@app.get("/api/patients/{patient_id}", response_model=PatientDetail)
def get_patient_detail(
    patient_id: int,
    current_user: CurrentUser = Depends(get_current_user),
) -> PatientDetail:
    patient = database.get_patient_by_id(patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found")
    ensure_patient_access(patient, current_user)
    return _patient_detail(patient)


@app.post("/api/patients/{patient_id}/clinical-records", response_model=ClinicalRecordPublic)
def create_clinical_record(
    patient_id: int,
    payload: ClinicalRecordCreate,
    current_user: CurrentUser = Depends(get_current_user),
) -> ClinicalRecordPublic:
    patient = database.get_patient_by_id(patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found")
    ensure_patient_access(patient, current_user)

    record = database.create_clinical_record(
        patient_id=patient_id,
        created_by_user_id=current_user.id,
        data=_to_dict(payload),
    )
    return _clinical_record_public(record)


@app.get("/api/patients/{patient_id}/clinical-records", response_model=list[ClinicalRecordPublic])
def list_clinical_records(
    patient_id: int,
    current_user: CurrentUser = Depends(get_current_user),
) -> list[ClinicalRecordPublic]:
    patient = database.get_patient_by_id(patient_id)
    if patient is None:
        raise HTTPException(status_code=404, detail="Patient not found")
    ensure_patient_access(patient, current_user)

    rows = database.list_clinical_records(patient_id)
    return [_clinical_record_public(row) for row in rows]


@app.post("/api/clinical/analyze", response_model=ClinicalAnalyzeResponse)
def analyze_clinical_data(
    payload: ClinicalAnalyzeRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> ClinicalAnalyzeResponse:
    return clinical_processor.analyze(payload)


@app.post("/api/labs/analyze", response_model=LabAnalyzeResponse)
def analyze_lab_results(
    payload: LabAnalyzeRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> LabAnalyzeResponse:
    return lab_processor.analyze(payload)


@app.post("/api/labs/analyze-file", response_model=LabAnalyzeResponse)
async def analyze_lab_results_file(
    file: UploadFile = File(...),
    age: int | None = Form(None),
    gender: str = Form("unknown"),
    current_user: CurrentUser = Depends(get_current_user),
) -> LabAnalyzeResponse:
    content = await file.read()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail=f"File is larger than {settings.max_upload_mb} MB")

    try:
        raw_text = extract_lab_text_from_file(content, file.filename or "lab-file")
    except UnsupportedLabFileError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    payload = LabAnalyzeRequest(
        age=age,
        gender=gender if gender in {"male", "female", "other", "unknown"} else "unknown",
        raw_text=raw_text,
    )
    return lab_processor.analyze(payload)


@app.post("/api/multimodal/analyze", response_model=MultimodalAnalyzeResponse)
async def analyze_multimodal(
    file: UploadFile = File(...),
    clinical_json: str = Form(...),
    lab_json: str | None = Form(None),
    modality: Modality = Form("unknown"),
    body_part: str | None = Form(None),
    current_user: CurrentUser = Depends(get_current_user),
) -> MultimodalAnalyzeResponse:
    content = await file.read()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail=f"File is larger than {settings.max_upload_mb} MB")

    try:
        clinical_payload = ClinicalAnalyzeRequest(**json.loads(clinical_json))
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"clinical_json không hợp lệ: {exc}") from exc

    image_response = _image_analysis_response(
        content=content,
        filename=file.filename or "upload",
        content_type=file.content_type,
        modality=modality,
        body_part=body_part,
    )
    clinical_response = clinical_processor.analyze(clinical_payload)
    lab_response = None
    if lab_json:
        try:
            lab_payload = LabAnalyzeRequest(**json.loads(lab_json))
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"lab_json không hợp lệ: {exc}") from exc
        lab_response = lab_processor.analyze(lab_payload)

    return fusion_processor.analyze(image_response, clinical_response, lab_response)


@app.post("/api/evaluation/metrics", response_model=EvaluationResponse)
def evaluate_metrics(
    payload: EvaluationRequest,
    current_user: CurrentUser = Depends(get_current_user),
) -> EvaluationResponse:
    return evaluation_processor.evaluate(payload.records)


@app.post("/api/evaluation/metrics-file", response_model=EvaluationResponse)
async def evaluate_metrics_file(
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(get_current_user),
) -> EvaluationResponse:
    content = await file.read()
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(status_code=400, detail="CSV phải dùng UTF-8") from exc

    reader = csv.DictReader(StringIO(text))
    required = {"model_name", "y_true", "y_pred"}
    if not reader.fieldnames or not required.issubset(set(reader.fieldnames)):
        raise HTTPException(status_code=400, detail="CSV cần có cột: model_name,y_true,y_pred")

    records = [
        EvaluationRecord(
            model_name=(row.get("model_name") or "multimodal").strip(),
            y_true=(row.get("y_true") or "").strip(),
            y_pred=(row.get("y_pred") or "").strip(),
        )
        for row in reader
        if (row.get("y_true") or "").strip() and (row.get("y_pred") or "").strip()
    ]
    return evaluation_processor.evaluate(records)


@app.post("/api/evaluation/runs", response_model=PredictionRunPublic)
def create_prediction_run(
    payload: PredictionRunCreate,
    current_user: CurrentUser = Depends(get_current_user),
) -> PredictionRunPublic:
    row = database.create_prediction_run(current_user.id, _to_dict(payload))
    return _prediction_run_public(row)


@app.get("/api/evaluation/runs", response_model=list[PredictionRunPublic])
def list_prediction_runs(
    current_user: CurrentUser = Depends(get_current_user),
) -> list[PredictionRunPublic]:
    return [_prediction_run_public(row) for row in database.list_prediction_runs(current_user.id, current_user.role)]


@app.get("/api/evaluation/runs/metrics", response_model=EvaluationResponse)
def evaluate_saved_prediction_runs(
    current_user: CurrentUser = Depends(get_current_user),
) -> EvaluationResponse:
    rows = database.list_prediction_runs(current_user.id, current_user.role)
    records: list[EvaluationRecord] = []
    mapping = {
        "before_ai": "before_ai_pred",
        "image_ai": "image_ai_pred",
        "clinical_ai": "clinical_ai_pred",
        "multimodal": "multimodal_pred",
    }
    for row in rows:
        for model_name, field in mapping.items():
            pred = row.get(field)
            if pred:
                records.append(EvaluationRecord(model_name=model_name, y_true=row["y_true"], y_pred=pred))
    return evaluation_processor.evaluate(records)


@app.post("/api/images/analyze", response_model=ImageAnalysisResponse)
async def analyze_image(
    file: UploadFile = File(...),
    modality: Modality = Form("unknown"),
    body_part: str | None = Form(None),
) -> ImageAnalysisResponse:
    content = await file.read()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail=f"File is larger than {settings.max_upload_mb} MB")
    return _image_analysis_response(
        content=content,
        filename=file.filename or "upload",
        content_type=file.content_type,
        modality=modality,
        body_part=body_part,
    )

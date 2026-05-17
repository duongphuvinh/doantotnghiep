from __future__ import annotations

from fastapi import FastAPI, File, Form, HTTPException, UploadFile

from .config import get_settings
from .image_io import UnsupportedImageError, read_medical_image
from .model import BoneModelService
from .processor import MedicalImageProcessor
from .schemas import ImageAnalysisResponse, ImageMetadata, Modality

settings = get_settings()
processor = MedicalImageProcessor()
model_service = BoneModelService(settings.resolved_model_path, settings.model_labels)

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

    try:
        image, source_format, dicom_meta = read_medical_image(content, file.filename or "upload")
    except UnsupportedImageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    processed, preprocess_info = processor.preprocess(image)
    quality = processor.quality_metrics(processed)
    features = processor.extract_bone_features(processed)
    prediction = model_service.predict(processed)
    resolved_modality = _resolve_modality(modality, dicom_meta.get("modality"))

    channels = 1 if len(processed.shape) == 2 else int(processed.shape[2])
    metadata = ImageMetadata(
        filename=file.filename or "upload",
        content_type=file.content_type,
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
            "This module supports preliminary image processing and model inference only. "
            "It must not be used as a standalone medical diagnosis and should be reviewed by qualified clinicians."
        ),
    )

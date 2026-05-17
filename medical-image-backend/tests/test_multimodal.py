from app.multimodal import MultimodalFusionService
from app.schemas import (
    BoneFeatureSummary,
    ClinicalAnalyzeRequest,
    ClinicalAnalyzeResponse,
    ClinicalRiskItem,
    ImageAnalysisResponse,
    ImageMetadata,
    PredictionResult,
    PreprocessInfo,
    QualityMetrics,
)


def test_multimodal_fusion_returns_risk_label():
    image = ImageAnalysisResponse(
        metadata=ImageMetadata(filename="xray.png", width=512, height=512, channels=1, source_format="PNG"),
        preprocessing=PreprocessInfo(normalized=True, contrast_enhanced=True, resized_to=(512, 512), original_size=(512, 512)),
        quality=QualityMetrics(mean_intensity=120, contrast_std=30, sharpness_laplacian_var=80, dynamic_range=220, dark_pixel_ratio=0.1, bright_pixel_ratio=0.1, warnings=[]),
        features=BoneFeatureSummary(estimated_bone_area_ratio=0.2, high_density_region_count=2, edge_density=0.16, symmetry_score=0.8, feature_vector=[0.0] * 20),
        prediction=PredictionResult(status="analysis_only", note="No model"),
        safety_note="demo",
    )
    clinical = ClinicalAnalyzeResponse(
        normalized=ClinicalAnalyzeRequest(age=70, gender="unknown", symptoms=["đau khớp"], medical_history=[], clinical_indicators={}),
        risk_items=[ClinicalRiskItem(level="medium", reason="risk")],
        summary="risk",
        recommended_next_steps=[],
        safety_note="demo",
    )

    result = MultimodalFusionService().analyze(image, clinical)

    assert result.fusion_method == "rule_weighted_late_fusion"
    assert result.predicted_label in {"requires_clinical_review", "suspected_bone_pathology", "no_strong_abnormal_signal"}


from __future__ import annotations

from .schemas import (
    ClinicalAnalyzeResponse,
    FusionSignal,
    ImageAnalysisResponse,
    LabAnalyzeResponse,
    MultimodalAnalyzeResponse,
)


class MultimodalFusionService:
    """Rule-weighted late fusion baseline for demo and model comparison.

    This is intentionally deterministic: it provides a transparent baseline that
    can be compared against image-only and clinical-only models. A trained fusion
    model can later replace this service while keeping the API contract stable.
    """

    def analyze(
        self,
        image: ImageAnalysisResponse,
        clinical: ClinicalAnalyzeResponse,
        lab: LabAnalyzeResponse | None = None,
    ) -> MultimodalAnalyzeResponse:
        signals: list[FusionSignal] = []

        image_score = self._image_score(image, signals)
        clinical_score = self._clinical_score(clinical, signals)
        lab_score = self._lab_score(lab, signals) if lab else 0.0
        if lab:
            fusion_score = max(0.0, min(1.0, 0.46 * image_score + 0.34 * clinical_score + 0.20 * lab_score))
        else:
            fusion_score = max(0.0, min(1.0, 0.58 * image_score + 0.42 * clinical_score))

        if fusion_score >= 0.68:
            risk_level = "high"
            predicted_label = "suspected_bone_pathology"
            explanation = "Ảnh và dữ liệu lâm sàng cùng có nhiều tín hiệu cần chú ý."
        elif fusion_score >= 0.38:
            risk_level = "medium"
            predicted_label = "requires_clinical_review"
            explanation = "Có một số tín hiệu bất thường hoặc chưa đủ rõ, nên bác sĩ đối chiếu thêm."
        else:
            risk_level = "low"
            predicted_label = "no_strong_abnormal_signal"
            explanation = "Chưa thấy tín hiệu nguy cơ nổi bật từ dữ liệu đã nhập."

        return MultimodalAnalyzeResponse(
            image=image,
            clinical=clinical,
            lab=lab,
            fusion_method="rule_weighted_late_fusion",
            fusion_score=round(fusion_score, 4),
            risk_level=risk_level,
            predicted_label=predicted_label,
            confidence=round(max(fusion_score, 1 - fusion_score), 4),
            signals=signals,
            explanation=explanation,
            recommended_next_steps=[
                "Đối chiếu kết quả fusion với phim gốc, triệu chứng thực tế và khám lâm sàng.",
                "Nếu mức nguy cơ trung bình/cao, nên ưu tiên đọc phim bởi bác sĩ chuyên khoa.",
                "Có thể dùng baseline fusion này để so sánh với image-only và clinical-only trong báo cáo.",
            ],
            safety_note="Fusion baseline chỉ hỗ trợ demo/nghiên cứu, không thay thế chẩn đoán của bác sĩ.",
        )

    def _image_score(self, image: ImageAnalysisResponse, signals: list[FusionSignal]) -> float:
        score = 0.0

        area = image.features.estimated_bone_area_ratio
        if area < 0.08 or area > 0.65:
            contribution = 0.18
            score += contribution
            signals.append(FusionSignal(
                source="image",
                name="estimated_bone_area_ratio",
                value=area,
                weight=0.18,
                contribution=contribution,
                explanation="Tỷ lệ vùng xương ước tính nằm ngoài khoảng thường gặp của ảnh demo.",
            ))

        edge_density = image.features.edge_density
        if edge_density > 0.12:
            contribution = min(0.22, edge_density)
            score += contribution
            signals.append(FusionSignal(
                source="image",
                name="edge_density",
                value=edge_density,
                weight=0.22,
                contribution=round(contribution, 4),
                explanation="Mật độ biên cao có thể phản ánh cấu trúc phức tạp hoặc nhiễu cần xem lại.",
            ))

        if image.quality.warnings:
            contribution = min(0.2, 0.07 * len(image.quality.warnings))
            score += contribution
            signals.append(FusionSignal(
                source="image",
                name="image_quality_warnings",
                value=len(image.quality.warnings),
                weight=0.2,
                contribution=round(contribution, 4),
                explanation="Chất lượng ảnh có cảnh báo, kết quả suy luận cần thận trọng.",
            ))

        if image.prediction.status == "model_prediction" and image.prediction.confidence is not None:
            label = image.prediction.top_label or ""
            if label and label.lower() not in {"normal", "no_finding", "healthy"}:
                contribution = 0.3 * image.prediction.confidence
                score += contribution
                signals.append(FusionSignal(
                    source="image",
                    name="image_model_prediction",
                    value=label,
                    weight=0.3,
                    contribution=round(contribution, 4),
                    explanation="Model ảnh đã huấn luyện dự đoán nhãn cần chú ý.",
                ))

        return min(score, 1.0)

    def _lab_score(self, lab: LabAnalyzeResponse | None, signals: list[FusionSignal]) -> float:
        if lab is None or not lab.items:
            return 0.0

        urgent = lab.urgent_count
        abnormal = lab.abnormal_count
        total = max(1, len(lab.items))
        score = min(1.0, 0.18 * abnormal + 0.35 * urgent + 0.22 * (abnormal / total))

        if abnormal:
            signals.append(FusionSignal(
                source="clinical",
                name="lab_abnormal_count",
                value=abnormal,
                weight=0.2,
                contribution=round(score, 4),
                explanation="Chỉ số xét nghiệm bất thường được đưa vào fusion để tăng/giảm mức cần chú ý.",
            ))

        bone_related_codes = {"CRP", "WBC", "GLU", "CRE", "UREA", "PRO", "BLD", "LEU", "NIT"}
        matched = [item for item in lab.items if item.code in bone_related_codes and item.status not in {"normal", "negative"}]
        if matched:
            extra = min(0.18, 0.05 * len(matched))
            score = min(1.0, score + extra)
            signals.append(FusionSignal(
                source="clinical",
                name="bone_relevant_lab_flags",
                value=", ".join(item.code for item in matched[:6]),
                weight=0.18,
                contribution=round(extra, 4),
                explanation="Một số xét nghiệm liên quan viêm/nhiễm, chuyển hóa hoặc thận-tiết niệu có bất thường.",
            ))

        return score

    def _clinical_score(self, clinical: ClinicalAnalyzeResponse, signals: list[FusionSignal]) -> float:
        level_score = {"low": 0.12, "medium": 0.45, "high": 0.82}
        max_level = "low"
        for item in clinical.risk_items:
            if level_score[item.level] > level_score[max_level]:
                max_level = item.level

        score = level_score[max_level]
        signals.append(FusionSignal(
            source="clinical",
            name="clinical_risk_level",
            value=max_level,
            weight=0.42,
            contribution=round(score, 4),
            explanation="Mức nguy cơ cao nhất được rút ra từ triệu chứng, tiền sử và chỉ số lâm sàng.",
        ))

        extra = min(0.18, max(0, len(clinical.risk_items) - 1) * 0.04)
        if extra:
            score += extra
            signals.append(FusionSignal(
                source="clinical",
                name="clinical_risk_count",
                value=len(clinical.risk_items),
                weight=0.18,
                contribution=round(extra, 4),
                explanation="Nhiều yếu tố lâm sàng cùng xuất hiện làm tăng mức cần chú ý.",
            ))

        return min(score, 1.0)

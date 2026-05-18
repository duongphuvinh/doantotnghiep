from __future__ import annotations

from .schemas import (
    ClinicalAnalyzeResponse,
    FusionSignal,
    FusionStructuredReport,
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

        structured_report = self._structured_report(
            image=image,
            clinical=clinical,
            lab=lab,
            fusion_score=fusion_score,
            risk_level=risk_level,
        )

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
            structured_report=structured_report,
            recommended_next_steps=[
                "Đối chiếu kết quả fusion với phim gốc, triệu chứng thực tế và khám lâm sàng.",
                "Nếu mức nguy cơ trung bình/cao, nên ưu tiên đọc phim bởi bác sĩ chuyên khoa.",
                "Có thể dùng baseline fusion này để so sánh với image-only và clinical-only trong báo cáo.",
            ],
            safety_note="Fusion baseline chỉ hỗ trợ demo/nghiên cứu, không thay thế chẩn đoán của bác sĩ.",
        )

    def _structured_report(
        self,
        image: ImageAnalysisResponse,
        clinical: ClinicalAnalyzeResponse,
        lab: LabAnalyzeResponse | None,
        fusion_score: float,
        risk_level: str,
    ) -> FusionStructuredReport:
        body_part = image.metadata.body_part or "vùng xương đã chụp"
        modality = self._modality_label(image.metadata.modality)
        label = (image.prediction.top_label or "").lower()
        label_text = self._image_label_vi(label)
        confidence = image.prediction.confidence
        confidence_text = f"{confidence * 100:.1f}%" if confidence is not None else "chưa có"
        abnormal_labs = [
            item for item in (lab.items if lab else [])
            if item.status in {"low", "high", "positive", "abnormal"}
        ]
        clinical_reasons = [item.reason for item in clinical.risk_items[:3]]

        if label and label not in {"normal", "no_finding", "healthy"}:
            nature = (
                f"Trên {modality} vùng {body_part}, model ảnh gợi ý {label_text} "
                f"với độ tin cậy {confidence_text}. Cần xác định lại vị trí chính xác trên phim gốc, "
                "đường vỏ xương, khe khớp, trục xương và mô mềm lân cận."
            )
        elif image.prediction.status == "model_prediction":
            nature = (
                f"Trên {modality} vùng {body_part}, model ảnh chưa ghi nhận dấu hiệu bất thường xương nổi bật. "
                "Vẫn cần đối chiếu vùng đau khu trú và chất lượng phim."
            )
        else:
            nature = (
                f"Trên {modality} vùng {body_part}, hệ thống mới phân tích đặc trưng ảnh, "
                "chưa có model ảnh đủ cơ sở để kết luận tổn thương đặc hiệu."
            )

        severity = self._severity_text(
            risk_level=risk_level,
            fusion_score=fusion_score,
            confidence=confidence,
            abnormal_lab_count=len(abnormal_labs),
            warning_count=len(image.quality.warnings),
        )
        clinical_summary = (
            " Yếu tố lâm sàng đáng chú ý: " + "; ".join(clinical_reasons) + "."
            if clinical_reasons
            else " Chưa có yếu tố lâm sàng nguy cơ nổi bật."
        )
        lab_summary = (
            f" Có {len(abnormal_labs)} chỉ số xét nghiệm bất thường liên quan cần đối chiếu."
            if abnormal_labs
            else " Chưa ghi nhận chỉ số xét nghiệm bất thường nổi bật trong phần đã đọc."
        )
        assessment = (
            f"Kết quả fusion ở mức {self._risk_label(risk_level)} với điểm {fusion_score:.2f}."
            f"{clinical_summary}{lab_summary} Đây là nhận định tổng hợp để ưu tiên đọc lại ca bệnh, "
            "không phải chẩn đoán cuối cùng."
        )

        recommendations = [
            "Bác sĩ/chẩn đoán hình ảnh đọc lại phim gốc, ưu tiên vùng người bệnh đau hoặc hạn chế vận động.",
            "Đối chiếu cơ chế chấn thương, thời điểm đau, sưng/nề, biến dạng và khả năng chịu lực/vận động.",
        ]
        if risk_level in {"medium", "high"}:
            recommendations.append("Nếu còn nghi ngờ tổn thương kín đáo, cân nhắc chụp thêm tư thế hoặc CT/MRI theo chỉ định.")
        if abnormal_labs:
            recommendations.append("Đối chiếu các xét nghiệm bất thường với tình trạng viêm/nhiễm, chuyển hóa, thận và thuốc đang dùng.")
        if image.quality.warnings:
            recommendations.append("Chất lượng ảnh có cảnh báo; cân nhắc chụp lại nếu phim mờ, thiếu sáng hoặc vùng khảo sát chưa đủ.")

        return FusionStructuredReport(
            nature_and_location=nature,
            severity=severity,
            comprehensive_assessment=assessment,
            recommendations=recommendations,
        )

    def _severity_text(
        self,
        risk_level: str,
        fusion_score: float,
        confidence: float | None,
        abnormal_lab_count: int,
        warning_count: int,
    ) -> str:
        confidence_hint = f"Độ tin cậy model ảnh {confidence * 100:.1f}%." if confidence is not None else "Chưa có độ tin cậy model ảnh."
        if risk_level == "high":
            return f"Mức độ cần ưu tiên cao: fusion score {fusion_score:.2f}. {confidence_hint} Có {abnormal_lab_count} chỉ số xét nghiệm bất thường và {warning_count} cảnh báo chất lượng ảnh."
        if risk_level == "medium":
            return f"Mức độ trung bình/cần đối chiếu: fusion score {fusion_score:.2f}. {confidence_hint} Chưa đủ cơ sở kết luận độc lập, nhưng có tín hiệu cần xem lại."
        return f"Mức độ thấp: fusion score {fusion_score:.2f}. {confidence_hint} Chưa thấy tín hiệu nguy cơ nổi bật trong dữ liệu đã nhập."

    def _image_label_vi(self, label: str) -> str:
        mapping = {
            "fracture": "nghi gãy xương",
            "arthritis": "nghi viêm/thoái hóa khớp",
            "osteoporosis": "nghi loãng xương",
            "normal": "bình thường",
            "other": "bất thường khác",
        }
        return mapping.get(label, label or "chưa rõ")

    def _risk_label(self, risk_level: str) -> str:
        return {"low": "thấp", "medium": "trung bình", "high": "cao"}.get(risk_level, risk_level)

    def _modality_label(self, modality: str) -> str:
        return {"xray": "X-quang", "ct": "CT", "mri": "MRI", "unknown": "phim"}.get(modality, modality)

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

from __future__ import annotations

from .schemas import ClinicalAnalyzeRequest, ClinicalAnalyzeResponse, ClinicalRiskItem


class ClinicalDataProcessor:
    emergency_keywords = {
        "khó thở",
        "kho tho",
        "đau ngực",
        "dau nguc",
        "ngất",
        "ngat",
        "liệt",
        "liet",
        "mất ý thức",
        "mat y thuc",
        "sốt cao",
        "sot cao",
    }

    bone_warning_keywords = {
        "đau xương",
        "dau xuong",
        "đau khớp",
        "dau khop",
        "sưng",
        "sung",
        "biến dạng",
        "bien dang",
        "không cử động",
        "khong cu dong",
        "té ngã",
        "te nga",
        "chấn thương",
        "chan thuong",
        "tê",
        "te",
    }

    chronic_history_keywords = {
        "loãng xương",
        "loang xuong",
        "viêm khớp",
        "viem khop",
        "thoái hóa",
        "thoai hoa",
        "đái tháo đường",
        "dai thao duong",
        "ung thư",
        "ung thu",
        "corticoid",
    }

    def analyze(self, request: ClinicalAnalyzeRequest) -> ClinicalAnalyzeResponse:
        symptoms = self._clean_list(request.symptoms)
        history = self._clean_list(request.medical_history)
        indicators = self._clean_indicators(request.clinical_indicators)
        normalized = ClinicalAnalyzeRequest(
            age=request.age,
            gender=request.gender,
            symptoms=symptoms,
            medical_history=history,
            clinical_indicators=indicators,
        )

        risk_items: list[ClinicalRiskItem] = []
        text_pool = " ".join([*symptoms, *history]).lower()

        if any(keyword in text_pool for keyword in self.emergency_keywords):
            risk_items.append(ClinicalRiskItem(level="high", reason="Có triệu chứng cảnh báo cần đánh giá y tế sớm."))

        if any(keyword in text_pool for keyword in self.bone_warning_keywords):
            risk_items.append(ClinicalRiskItem(level="medium", reason="Có triệu chứng liên quan cơ xương khớp cần đối chiếu với hình ảnh y khoa."))

        if any(keyword in text_pool for keyword in self.chronic_history_keywords):
            risk_items.append(ClinicalRiskItem(level="medium", reason="Tiền sử bệnh có thể ảnh hưởng đến nguy cơ bệnh lý xương/khớp."))

        if request.age >= 60:
            risk_items.append(ClinicalRiskItem(level="medium", reason="Tuổi cao làm tăng nguy cơ thoái hóa khớp, loãng xương hoặc chấn thương xương."))

        numeric_flags = self._indicator_flags(indicators)
        risk_items.extend(numeric_flags)

        if not risk_items:
            risk_items.append(ClinicalRiskItem(level="low", reason="Chưa ghi nhận dấu hiệu nguy cơ rõ từ dữ liệu lâm sàng đã nhập."))

        highest = self._highest_level(risk_items)
        summary = {
            "high": "Dữ liệu lâm sàng có dấu hiệu nguy cơ cao, nên ưu tiên đánh giá bởi nhân viên y tế.",
            "medium": "Dữ liệu lâm sàng có một số yếu tố cần theo dõi và nên kết hợp với phim chụp/hồ sơ y tế.",
            "low": "Dữ liệu lâm sàng hiện chưa cho thấy nguy cơ nổi bật, nhưng vẫn cần đối chiếu với triệu chứng thực tế.",
        }[highest]

        return ClinicalAnalyzeResponse(
            normalized=normalized,
            risk_items=risk_items,
            summary=summary,
            recommended_next_steps=[
                "Đối chiếu triệu chứng với ảnh X-ray/CT/MRI và kết quả khám lâm sàng.",
                "Nếu đau tăng, sưng biến dạng, tê yếu, sốt cao hoặc hạn chế vận động rõ, cần đi khám trực tiếp.",
                "Không dùng kết quả hệ thống để tự chẩn đoán hoặc tự điều trị.",
            ],
            safety_note="Module này chỉ chuẩn hóa và gợi ý mức độ cần chú ý từ dữ liệu lâm sàng, không thay thế bác sĩ.",
        )

    def _clean_list(self, values: list[str]) -> list[str]:
        cleaned = []
        for value in values:
            text = str(value).strip()
            if text:
                cleaned.append(text[:250])
        return cleaned

    def _clean_indicators(self, indicators: dict) -> dict:
        cleaned = {}
        for key, value in indicators.items():
            clean_key = str(key).strip()[:80]
            if not clean_key:
                continue
            if isinstance(value, str):
                cleaned[clean_key] = value.strip()[:250]
            else:
                cleaned[clean_key] = value
        return cleaned

    def _indicator_flags(self, indicators: dict) -> list[ClinicalRiskItem]:
        flags: list[ClinicalRiskItem] = []
        for raw_key, raw_value in indicators.items():
            key = str(raw_key).lower()
            value = self._as_float(raw_value)
            if value is None:
                continue

            if key in {"temperature", "nhiet_do", "nhiệt độ"} and value >= 38.5:
                flags.append(ClinicalRiskItem(level="medium", reason="Nhiệt độ cao có thể gợi ý tình trạng viêm/nhiễm cần theo dõi."))
            if key in {"pain_score", "diem_dau", "điểm đau"} and value >= 7:
                flags.append(ClinicalRiskItem(level="medium", reason="Mức đau cao cần được đánh giá kỹ hơn."))
            if key in {"crp", "esr"} and value > 10:
                flags.append(ClinicalRiskItem(level="medium", reason=f"Chỉ số {raw_key} tăng, có thể liên quan phản ứng viêm."))
            if key in {"bmi"} and (value < 18.5 or value >= 30):
                flags.append(ClinicalRiskItem(level="low", reason="BMI ngoài khoảng tham khảo có thể là yếu tố nền cần lưu ý."))
        return flags

    def _as_float(self, value: object) -> float | None:
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    def _highest_level(self, items: list[ClinicalRiskItem]) -> str:
        order = {"low": 0, "medium": 1, "high": 2}
        return max((item.level for item in items), key=lambda level: order[level])


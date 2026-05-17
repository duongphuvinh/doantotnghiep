from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from .schemas import (
    Gender,
    LabAnalyzeRequest,
    LabAnalyzeResponse,
    LabCategory,
    LabResultItem,
    LabSeverity,
    LabStatus,
    LabValueInput,
)


@dataclass(frozen=True)
class NumericReference:
    category: LabCategory
    code: str
    display_name: str
    aliases: tuple[str, ...]
    unit: str
    low: float | None
    high: float | None
    severity_high: float | None = None
    severity_low: float | None = None
    note_low: str = ""
    note_high: str = ""


@dataclass(frozen=True)
class QualitativeReference:
    category: LabCategory
    code: str
    display_name: str
    aliases: tuple[str, ...]
    normal_values: tuple[str, ...]
    abnormal_values: tuple[str, ...]
    note_abnormal: str


NUMERIC_REFERENCES: tuple[NumericReference, ...] = (
    NumericReference("blood", "WBC", "Bạch cầu", ("wbc", "bach cau", "bạch cầu", "white blood cell"), "10^9/L", 4.0, 10.0, 20.0, 2.0, "Bạch cầu thấp có thể liên quan suy giảm miễn dịch/tủy xương hoặc thuốc.", "Bạch cầu cao có thể gặp trong viêm, nhiễm trùng, stress hoặc bệnh lý huyết học."),
    NumericReference("blood", "RBC", "Hồng cầu", ("rbc", "hong cau", "hồng cầu", "red blood cell"), "10^12/L", 3.8, 5.8, None, 3.0, "Hồng cầu thấp có thể gợi ý thiếu máu.", "Hồng cầu cao cần đối chiếu tình trạng mất nước, bệnh phổi/tim hoặc nguyên nhân khác."),
    NumericReference("blood", "HGB", "Hemoglobin", ("hgb", "hb", "hemoglobin", "huyet sac to", "huyết sắc tố"), "g/dL", 12.0, 17.5, None, 8.0, "Hemoglobin thấp gợi ý thiếu máu, cần tìm nguyên nhân.", "Hemoglobin cao có thể gặp khi cô đặc máu hoặc một số bệnh lý khác."),
    NumericReference("blood", "HCT", "Hematocrit", ("hct", "hematocrit"), "%", 36.0, 52.0, None, 28.0, "Hematocrit thấp thường đi cùng thiếu máu.", "Hematocrit cao cần đánh giá tình trạng cô đặc máu hoặc bệnh nền."),
    NumericReference("blood", "PLT", "Tiểu cầu", ("plt", "tieu cau", "tiểu cầu", "platelet"), "10^9/L", 150.0, 450.0, 700.0, 50.0, "Tiểu cầu thấp làm tăng nguy cơ chảy máu, cần đánh giá sớm nếu rất thấp.", "Tiểu cầu cao có thể liên quan viêm, thiếu sắt hoặc rối loạn tăng sinh."),
    NumericReference("blood", "GLU", "Glucose máu", ("glu", "glucose", "duong huyet", "đường huyết", "glucose mau"), "mmol/L", 3.9, 6.4, 13.9, 3.0, "Glucose thấp có thể gây vã mồ hôi, run, lú lẫn và cần xử trí sớm.", "Glucose cao cần đối chiếu tình trạng nhịn ăn, đái tháo đường hoặc stress cấp."),
    NumericReference("blood", "CRE", "Creatinine", ("cre", "creatinine", "creatinin"), "umol/L", 45.0, 110.0, 250.0, None, "", "Creatinine cao có thể gợi ý giảm chức năng thận hoặc mất nước."),
    NumericReference("blood", "UREA", "Ure", ("ure", "urea", "bun"), "mmol/L", 2.5, 7.5, 20.0, None, "", "Ure cao cần đánh giá chức năng thận, mất nước hoặc tăng dị hóa."),
    NumericReference("blood", "ALT", "ALT/GPT", ("alt", "gpt", "sgpt"), "U/L", None, 40.0, 200.0, None, "", "ALT tăng có thể liên quan tổn thương tế bào gan, thuốc, rượu hoặc viêm gan."),
    NumericReference("blood", "AST", "AST/GOT", ("ast", "got", "sgot"), "U/L", None, 40.0, 200.0, None, "", "AST tăng cần đối chiếu gan, cơ, tim và bối cảnh lâm sàng."),
    NumericReference("blood", "CRP", "CRP", ("crp", "c-reactive protein"), "mg/L", None, 5.0, 100.0, None, "", "CRP tăng gợi ý phản ứng viêm/nhiễm, cần đối chiếu triệu chứng."),
    NumericReference("urine", "SG", "Tỷ trọng nước tiểu", ("sg", "specific gravity", "ty trong", "tỷ trọng"), "", 1.005, 1.030, None, None, "Tỷ trọng thấp có thể do nước tiểu loãng hoặc giảm khả năng cô đặc.", "Tỷ trọng cao có thể do cô đặc nước tiểu, mất nước hoặc chất hòa tan cao."),
    NumericReference("urine", "PH", "pH nước tiểu", ("ph", "urine ph", "ph nuoc tieu", "ph nước tiểu"), "", 5.0, 8.0, None, None, "pH thấp/cao cần đối chiếu chế độ ăn, nhiễm trùng hoặc rối loạn chuyển hóa.", "pH thấp/cao cần đối chiếu chế độ ăn, nhiễm trùng hoặc rối loạn chuyển hóa."),
)

QUALITATIVE_REFERENCES: tuple[QualitativeReference, ...] = (
    QualitativeReference("urine", "PRO", "Protein niệu", ("protein", "pro", "albumin"), ("negative", "neg", "âm tính", "am tinh", "-"), ("+", "trace", "positive", "pos", "dương tính", "duong tinh"), "Protein niệu dương tính cần đánh giá bệnh thận, nhiễm trùng hoặc mẫu nhiễm bẩn."),
    QualitativeReference("urine", "GLU_U", "Glucose niệu", ("urine glucose", "glucose urine", "glu urine", "glucose niệu", "duong nieu"), ("negative", "neg", "âm tính", "am tinh", "-"), ("+", "positive", "pos", "dương tính", "duong tinh"), "Glucose niệu dương tính cần đối chiếu đường huyết và nguy cơ đái tháo đường."),
    QualitativeReference("urine", "KET", "Ketone niệu", ("ketone", "ket", "cetone"), ("negative", "neg", "âm tính", "am tinh", "-"), ("+", "positive", "pos", "dương tính", "duong tinh"), "Ketone niệu dương tính có thể gặp khi nhịn ăn, nôn ói, đái tháo đường mất kiểm soát."),
    QualitativeReference("urine", "BLD", "Máu trong nước tiểu", ("blood", "hồng cầu niệu", "hong cau nieu", "ery", "rbc urine"), ("negative", "neg", "âm tính", "am tinh", "-"), ("+", "positive", "pos", "dương tính", "duong tinh"), "Có máu trong nước tiểu cần đánh giá sỏi, nhiễm trùng, chấn thương hoặc bệnh thận-tiết niệu."),
    QualitativeReference("urine", "LEU", "Bạch cầu niệu", ("leukocyte", "leu", "bach cau nieu", "bạch cầu niệu"), ("negative", "neg", "âm tính", "am tinh", "-"), ("+", "positive", "pos", "dương tính", "duong tinh"), "Bạch cầu niệu dương tính có thể gợi ý viêm/nhiễm đường tiết niệu."),
    QualitativeReference("urine", "NIT", "Nitrite niệu", ("nitrite", "nit"), ("negative", "neg", "âm tính", "am tinh", "-"), ("+", "positive", "pos", "dương tính", "duong tinh"), "Nitrite dương tính có thể gợi ý nhiễm khuẩn tiết niệu."),
)


class LabResultProcessor:
    def analyze(self, request: LabAnalyzeRequest) -> LabAnalyzeResponse:
        inputs = [*request.values, *self._parse_raw_text(request.raw_text or "")]
        items = [item for value in inputs if (item := self._analyze_value(value, request.gender))]

        abnormal_count = sum(1 for item in items if item.status not in {"normal", "negative"})
        urgent_count = sum(1 for item in items if item.severity == "urgent")

        if not items:
            summary = "Chưa nhận diện được chỉ số xét nghiệm phù hợp để đọc kết quả."
        elif urgent_count:
            summary = "Có chỉ số lệch nhiều hoặc có khả năng cần đánh giá y tế sớm."
        elif abnormal_count:
            summary = "Có một số chỉ số bất thường, nên đối chiếu với triệu chứng và bác sĩ."
        else:
            summary = "Các chỉ số đã nhập nằm trong khoảng tham khảo cơ bản hoặc âm tính."

        return LabAnalyzeResponse(
            items=items,
            summary=summary,
            abnormal_count=abnormal_count,
            urgent_count=urgent_count,
            recommended_next_steps=[
                "Đối chiếu kết quả với khoảng tham khảo in trên phiếu xét nghiệm của phòng lab.",
                "Kết hợp triệu chứng, thuốc đang dùng, bệnh nền và thời điểm lấy mẫu.",
                "Nếu có chỉ số lệch nhiều, triệu chứng nặng, sốt cao, đau ngực, khó thở, tiểu máu hoặc lú lẫn, cần khám trực tiếp.",
            ],
            safety_note="Kết quả chỉ hỗ trợ đọc hiểu xét nghiệm, không thay thế chẩn đoán hoặc chỉ định điều trị của bác sĩ.",
        )

    def _analyze_value(self, value: LabValueInput, gender: Gender) -> LabResultItem | None:
        numeric_ref = self._find_numeric_reference(value.name, value.category)
        if numeric_ref:
            number = self._to_float(value.value)
            if number is None:
                return None
            return self._analyze_numeric(value, numeric_ref, number)

        qualitative_ref = self._find_qualitative_reference(value.name, value.category)
        if qualitative_ref:
            return self._analyze_qualitative(value, qualitative_ref)

        return LabResultItem(
            category=value.category or "blood",
            code="UNKNOWN",
            name=value.name.strip(),
            input_name=value.name,
            value=value.value,
            unit=value.unit,
            reference_range="Chưa có khoảng tham khảo trong hệ thống",
            status="unknown",
            severity="info",
            interpretation="Hệ thống chưa nhận diện được chỉ số này. Vui lòng đối chiếu phiếu xét nghiệm hoặc thêm mapping.",
        )

    def _analyze_numeric(self, value: LabValueInput, ref: NumericReference, number: float) -> LabResultItem:
        status: LabStatus = "normal"
        severity: LabSeverity = "info"
        interpretation = "Nằm trong khoảng tham khảo cơ bản."

        if ref.low is not None and number < ref.low:
            status = "low"
            severity = "attention"
            interpretation = ref.note_low or "Thấp hơn khoảng tham khảo."
            if ref.severity_low is not None and number <= ref.severity_low:
                severity = "urgent"
        elif ref.high is not None and number > ref.high:
            status = "high"
            severity = "attention"
            interpretation = ref.note_high or "Cao hơn khoảng tham khảo."
            if ref.severity_high is not None and number >= ref.severity_high:
                severity = "urgent"

        return LabResultItem(
            category=ref.category,
            code=ref.code,
            name=ref.display_name,
            input_name=value.name,
            value=number,
            unit=value.unit or ref.unit or None,
            reference_range=self._format_range(ref),
            status=status,
            severity=severity,
            interpretation=interpretation,
        )

    def _analyze_qualitative(self, value: LabValueInput, ref: QualitativeReference) -> LabResultItem:
        raw = str(value.value).strip().lower()
        normalized = raw.replace("＋", "+")
        is_abnormal = any(token in normalized for token in ref.abnormal_values)
        is_normal = normalized in ref.normal_values or any(token == normalized for token in ref.normal_values)

        status: LabStatus = "negative" if is_normal else "positive" if is_abnormal else "unknown"
        severity: LabSeverity = "attention" if is_abnormal else "info"
        interpretation = ref.note_abnormal if is_abnormal else "Âm tính hoặc chưa ghi nhận bất thường." if is_normal else "Chưa xác định được âm/dương tính từ giá trị đã nhập."

        return LabResultItem(
            category=ref.category,
            code=ref.code,
            name=ref.display_name,
            input_name=value.name,
            value=value.value,
            unit=value.unit,
            reference_range="Âm tính",
            status=status,
            severity=severity,
            interpretation=interpretation,
        )

    def _parse_raw_text(self, raw_text: str) -> list[LabValueInput]:
        values: list[LabValueInput] = []
        for line in raw_text.splitlines():
            clean = line.strip()
            if not clean:
                continue
            match = re.match(r"^([A-Za-zÀ-ỹ0-9_ ./%-]+?)\s*[:=]?\s+([+-]?\d+(?:[.,]\d+)?|\+{1,3}|-{1,3}|âm tính|dương tính|negative|positive|neg|pos)\s*([A-Za-z/%^0-9µμ.]+)?", clean, re.IGNORECASE)
            if not match:
                continue
            name, raw_value, unit = match.groups()
            parsed_value: str | float = raw_value.replace(",", ".")
            number = self._to_float(parsed_value)
            values.append(
                LabValueInput(
                    name=name.strip(),
                    value=number if number is not None else raw_value.strip(),
                    unit=unit,
                    category=self._guess_category(name),
                )
            )
        return values

    def _find_numeric_reference(self, name: str, category: LabCategory | None) -> NumericReference | None:
        normalized = self._normalize_name(name)
        for ref in NUMERIC_REFERENCES:
            if category and ref.category != category:
                continue
            if normalized == ref.code.lower() or any(alias in normalized for alias in ref.aliases):
                return ref
        return None

    def _find_qualitative_reference(self, name: str, category: LabCategory | None) -> QualitativeReference | None:
        normalized = self._normalize_name(name)
        for ref in QUALITATIVE_REFERENCES:
            if category and ref.category != category:
                continue
            if normalized == ref.code.lower() or any(alias in normalized for alias in ref.aliases):
                return ref
        return None

    def _guess_category(self, name: str) -> LabCategory:
        normalized = self._normalize_name(name)
        urine_tokens = ("urine", "nước tiểu", "nuoc tieu", "niệu", "nieu", "nitrite", "ketone", "protein")
        if normalized in {"ph", "sg"}:
            return "urine"
        return "urine" if any(token in normalized for token in urine_tokens) else "blood"

    def _normalize_name(self, name: str) -> str:
        return " ".join(name.strip().lower().split())

    def _to_float(self, value: object) -> float | None:
        try:
            if isinstance(value, str):
                value = value.replace(",", ".")
            return float(value)
        except (TypeError, ValueError):
            return None

    def _format_range(self, ref: NumericReference) -> str:
        unit = f" {ref.unit}" if ref.unit else ""
        if ref.low is not None and ref.high is not None:
            return f"{ref.low:g} - {ref.high:g}{unit}"
        if ref.high is not None:
            return f"<= {ref.high:g}{unit}"
        if ref.low is not None:
            return f">= {ref.low:g}{unit}"
        return "Không xác định"

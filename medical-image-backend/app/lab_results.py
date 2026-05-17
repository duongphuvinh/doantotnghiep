from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
import json
from pathlib import Path
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


@dataclass(frozen=True)
class ParsedLabLine:
    name: str
    value: str
    unit: str | None = None
    reference_low: float | None = None
    reference_high: float | None = None
    reference_unit: str | None = None
    reference_range_source: str | None = None


NUMERIC_REFERENCES: tuple[NumericReference, ...] = (
    NumericReference("blood", "WBC", "Bạch cầu", ("wbc", "bc", "leu", "bach cau", "bạch cầu", "white blood cell", "leukocyte"), "10^9/L", 4.0, 10.0, 20.0, 2.0, "Bạch cầu thấp có thể liên quan suy giảm miễn dịch/tủy xương hoặc thuốc.", "Bạch cầu cao có thể gặp trong viêm, nhiễm trùng, stress hoặc bệnh lý huyết học."),
    NumericReference("blood", "RBC", "Hồng cầu", ("rbc", "hc", "hong cau", "hồng cầu", "red blood cell"), "10^12/L", 3.8, 5.8, None, 3.0, "Hồng cầu thấp có thể gợi ý thiếu máu.", "Hồng cầu cao cần đối chiếu tình trạng mất nước, bệnh phổi/tim hoặc nguyên nhân khác."),
    NumericReference("blood", "HGB", "Hemoglobin", ("hgb", "hb", "hemoglobin", "huyet sac to", "huyết sắc tố"), "g/dL", 12.0, 17.5, None, 8.0, "Hemoglobin thấp gợi ý thiếu máu, cần tìm nguyên nhân.", "Hemoglobin cao có thể gặp khi cô đặc máu hoặc một số bệnh lý khác."),
    NumericReference("blood", "HCT", "Hematocrit", ("hct", "hematocrit"), "%", 36.0, 52.0, None, 28.0, "Hematocrit thấp thường đi cùng thiếu máu.", "Hematocrit cao cần đánh giá tình trạng cô đặc máu hoặc bệnh nền."),
    NumericReference("blood", "PLT", "Tiểu cầu", ("plt", "tc", "tieu cau", "tiểu cầu", "platelet"), "10^9/L", 150.0, 450.0, 700.0, 50.0, "Tiểu cầu thấp làm tăng nguy cơ chảy máu, cần đánh giá sớm nếu rất thấp.", "Tiểu cầu cao có thể liên quan viêm, thiếu sắt hoặc rối loạn tăng sinh."),
    NumericReference("blood", "GLU", "Glucose máu", ("glu", "glucose", "duong huyet", "đường huyết", "glucose mau", "duong mau", "đường máu"), "mmol/L", 3.9, 5.6, 13.9, 3.0, "Glucose thấp có thể gây vã mồ hôi, run, lú lẫn và cần xử trí sớm.", "Glucose cao cần đối chiếu tình trạng nhịn ăn, đái tháo đường hoặc stress cấp."),
    NumericReference("blood", "CRE", "Creatinine", ("cre", "crea", "creatinine", "creatinin", "creatinin mau"), "umol/L", 45.0, 110.0, 250.0, None, "", "Creatinine cao có thể gợi ý giảm chức năng thận hoặc mất nước."),
    NumericReference("blood", "EGFR", "eGFR (CKD-EPI)", ("egfr", "ckd-epi", "ckd epi", "egfr ckd-epi"), "ml/ph/1.73 m2", 60.0, None, None, 30.0, "eGFR thấp cần đánh giá chức năng thận theo tuổi, bệnh nền và xu hướng theo thời gian.", ""),
    NumericReference("blood", "UREA", "Ure", ("ure", "urea", "bun", "ure mau"), "mmol/L", 2.5, 7.5, 20.0, None, "", "Ure cao cần đánh giá chức năng thận, mất nước hoặc tăng dị hóa."),
    NumericReference("blood", "ALT", "ALT/GPT", ("alt", "gpt", "sgpt", "alat"), "U/L", None, 40.0, 200.0, None, "", "ALT tăng có thể liên quan tổn thương tế bào gan, thuốc, rượu hoặc viêm gan."),
    NumericReference("blood", "AST", "AST/GOT", ("ast", "got", "sgot", "asat"), "U/L", None, 40.0, 200.0, None, "", "AST tăng cần đối chiếu gan, cơ, tim và bối cảnh lâm sàng."),
    NumericReference("blood", "CRP", "CRP", ("crp", "c-reactive protein"), "mg/L", None, 5.0, 100.0, None, "", "CRP tăng gợi ý phản ứng viêm/nhiễm, cần đối chiếu triệu chứng."),
    NumericReference("blood", "ALB", "Albumin", ("alb", "albumin"), "g/L", 35.0, 50.0, None, 30.0, "Albumin thấp cần đối chiếu dinh dưỡng, gan, thận hoặc viêm mạn.", "Albumin cao thường liên quan cô đặc máu/mất nước."),
    NumericReference("blood", "ALP", "Phosphatase kiềm", ("alp", "alkaline phosphatase", "phosphatase kiem", "phosphatase kiềm"), "U/L", None, 120.0, 300.0, None, "", "ALP tăng cần đối chiếu gan mật, xương, tuổi và bối cảnh lâm sàng."),
    NumericReference("blood", "CA", "Calci", ("ca", "calci", "calcium"), "mmol/L", 2.15, 2.55, 3.0, 1.9, "Calci thấp cần đánh giá albumin, vitamin D, tuyến cận giáp và triệu chứng.", "Calci cao cần đánh giá mất nước, tuyến cận giáp, thuốc hoặc bệnh nền."),
    NumericReference("blood", "CHOL", "Cholesterol toàn phần", ("chol", "cholesterol", "cholesterol tp", "cholesterol toan phan"), "mmol/L", None, 5.2, 7.8, None, "", "Cholesterol cao cần đánh giá nguy cơ tim mạch tổng thể và chế độ ăn/thuốc."),
    NumericReference("blood", "CK", "Creatine kinase", ("ck", "cpk", "creatine kinase"), "U/L", None, 200.0, 1000.0, None, "", "CK tăng cần đối chiếu vận động, tổn thương cơ, thuốc và triệu chứng."),
    NumericReference("blood", "CL", "Chloride", ("cl", "chloride", "clorua", "clo"), "mmol/L", 98.0, 107.0, 115.0, 90.0, "Chloride thấp cần đối chiếu điện giải và tình trạng mất dịch.", "Chloride cao cần đối chiếu mất nước, toan kiềm và dịch truyền."),
    NumericReference("blood", "GGT", "GGT", ("ggt", "gamma gt", "gamma-glutamyl transferase"), "U/L", None, 55.0, 200.0, None, "", "GGT tăng cần đối chiếu bệnh gan mật, rượu, thuốc và bối cảnh lâm sàng."),
    NumericReference("blood", "IRON", "Sắt huyết thanh", ("fe", "iron", "sat", "sắt", "sat huyet thanh", "sắt huyết thanh"), "umol/L", 10.0, 30.0, None, 5.0, "Sắt huyết thanh thấp cần đối chiếu thiếu máu, ferritin và tình trạng viêm.", "Sắt huyết thanh cao cần đối chiếu bổ sung sắt, truyền máu hoặc bệnh chuyển hóa sắt."),
    NumericReference("blood", "K", "Kali", ("k", "kali", "potassium"), "mmol/L", 3.5, 5.1, 6.0, 3.0, "Kali thấp có thể ảnh hưởng nhịp tim/cơ, cần đối chiếu triệu chứng và thuốc.", "Kali cao cần loại trừ tan máu mẫu và đánh giá thận/thuốc/ECG nếu cao nhiều."),
    NumericReference("blood", "LDH", "LDH", ("ldh", "lactate dehydrogenase"), "U/L", None, 250.0, 500.0, None, "", "LDH tăng không đặc hiệu, cần đối chiếu tan máu, gan, cơ, nhiễm trùng hoặc bệnh nền."),
    NumericReference("blood", "NA", "Natri", ("na", "natri", "sodium"), "mmol/L", 135.0, 145.0, 155.0, 125.0, "Natri thấp cần đánh giá dịch, thuốc, thận/nội tiết và triệu chứng thần kinh.", "Natri cao thường liên quan mất nước hoặc rối loạn cân bằng nước."),
    NumericReference("blood", "PHOS", "Phospho", ("phos", "phosphate", "phospho", "phosphorus"), "mmol/L", 0.8, 1.45, 2.2, 0.5, "Phospho thấp cần đối chiếu dinh dưỡng, vitamin D và bối cảnh lâm sàng.", "Phospho cao cần đánh giá chức năng thận, chuyển hóa xương-khoáng."),
    NumericReference("blood", "TBIL", "Bilirubin toàn phần", ("tbil", "bilirubin", "bilirubin tp", "bilirubin toan phan"), "umol/L", None, 21.0, 50.0, None, "", "Bilirubin tăng cần đối chiếu vàng da, gan mật, tan máu và các men gan."),
    NumericReference("blood", "TP", "Protein toàn phần", ("tp", "total protein", "protein toan phan", "protein toàn phần"), "g/L", 64.0, 83.0, 95.0, 55.0, "Protein toàn phần thấp cần đối chiếu dinh dưỡng, gan, thận hoặc mất protein.", "Protein toàn phần cao cần đối chiếu mất nước hoặc tăng globulin."),
    NumericReference("blood", "TG", "Triglycerid", ("tg", "triglycerid", "triglyceride", "triglycerides"), "mmol/L", None, 1.7, 5.6, None, "", "Triglycerid cao cần đối chiếu tình trạng nhịn ăn, chuyển hóa đường-mỡ và nguy cơ tim mạch."),
    NumericReference("blood", "HDL", "HDL-C", ("hdl", "hdl c", "hdl-c", "hdl cholesterol"), "mmol/L", 1.0, None, None, 0.8, "HDL-C thấp là yếu tố bất lợi về nguy cơ tim mạch.", ""),
    NumericReference("blood", "LDL", "LDL-C", ("ldl", "ldl c", "ldl-c", "ldl cholesterol"), "mmol/L", None, 3.4, 4.9, None, "", "LDL-C cao cần đánh giá nguy cơ tim mạch và mục tiêu điều trị cá thể."),
    NumericReference("blood", "UA", "Acid uric", ("ua", "uric acid", "acid uric", "axit uric"), "umol/L", 150.0, 420.0, 600.0, None, "", "Acid uric cao cần đối chiếu gout, chức năng thận, thuốc và chế độ ăn."),
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
    def __init__(self, trained_reference_path: Path | None = None) -> None:
        self.numeric_references = self._load_trained_numeric_references(
            trained_reference_path or Path(__file__).resolve().parents[1] / "models" / "lab_reference_nhanes.json"
        )

    def analyze(self, request: LabAnalyzeRequest) -> LabAnalyzeResponse:
        parsed_inputs = self._parse_raw_text(request.raw_text or "", request.gender)
        inputs = [*request.values, *parsed_inputs]
        items = self._dedupe_items([item for value in inputs if (item := self._analyze_value(value, request.gender))])
        unrecognized_lines = self._find_unrecognized_lines(request.raw_text or "", parsed_inputs)

        abnormal_count = sum(1 for item in items if item.status in {"low", "high", "positive", "abnormal"})
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
            raw_text_preview=self._preview_raw_text(request.raw_text or ""),
            unrecognized_lines=unrecognized_lines[:20],
        )

    def _dedupe_items(self, items: list[LabResultItem]) -> list[LabResultItem]:
        deduped: dict[str, LabResultItem] = {}
        for item in items:
            key = item.code
            current = deduped.get(key)
            if current is None or self._item_score(item) > self._item_score(current):
                deduped[key] = item
        return list(deduped.values())

    def _item_score(self, item: LabResultItem) -> tuple[int, int, int, int]:
        severity_score = {"urgent": 3, "attention": 2, "watch": 1, "info": 0}.get(item.severity, 0)
        status_score = 1 if item.status in {"low", "high", "positive", "abnormal"} else 0
        value_score = 1 if self._to_float(item.value) is not None else 0
        unit_score = 1 if item.unit == "umol/L" else 0
        return severity_score, status_score, value_score, unit_score

    def _analyze_value(self, value: LabValueInput, gender: Gender) -> LabResultItem | None:
        numeric_ref = self._find_numeric_reference(value.name, value.category)
        if numeric_ref:
            number = self._to_float(value.value)
            if number is None:
                return None
            return self._analyze_numeric(value, self._reference_from_input(value, numeric_ref), number)

        qualitative_ref = self._find_qualitative_reference(value.name, value.category)
        if qualitative_ref:
            return self._analyze_qualitative(value, qualitative_ref)

        return None

    def _analyze_numeric(self, value: LabValueInput, ref: NumericReference, number: float) -> LabResultItem:
        number, unit = self._normalize_numeric_unit(ref, number, value.unit)
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
            unit=unit or ref.unit or None,
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

    def _parse_raw_text(self, raw_text: str, gender: Gender = "unknown") -> list[LabValueInput]:
        values: list[LabValueInput] = []
        seen: set[tuple[str, str]] = set()
        lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
        for index, line in enumerate(lines):
            clean = line.strip()
            if not clean:
                continue
            parsed = self._parse_lab_line(clean, gender)
            if parsed is None:
                parsed = self._parse_split_lab_row(lines, index, gender)
            if parsed is None:
                continue
            name, raw_value, unit = parsed.name, parsed.value, parsed.unit
            if not self._find_numeric_reference(name, self._guess_category(name)) and not self._find_qualitative_reference(name, self._guess_category(name)):
                continue
            parsed = self._validated_parsed_line(parsed)
            key = (self._normalize_name(name), str(raw_value).strip().lower())
            if key in seen:
                continue
            seen.add(key)
            parsed_value: str | float = str(raw_value).replace(",", ".")
            number = self._to_float(parsed_value)
            values.append(
                LabValueInput(
                    name=name.strip(),
                    value=number if number is not None else str(raw_value).strip(),
                    unit=unit,
                    category=self._guess_category(name),
                    reference_low=parsed.reference_low,
                    reference_high=parsed.reference_high,
                    reference_unit=parsed.reference_unit,
                    reference_range_source=parsed.reference_range_source,
                )
            )
        return values

    def _validated_parsed_line(self, parsed: ParsedLabLine) -> ParsedLabLine:
        if parsed.reference_low is None and parsed.reference_high is None:
            return parsed
        value = self._to_float(parsed.value)
        if value is None:
            return parsed
        unit = parsed.unit or ""
        reference_unit = parsed.reference_unit or unit
        if unit and reference_unit:
            normalized_unit = self._normalize_name(unit).replace(" ", "")
            normalized_ref_unit = self._normalize_name(reference_unit).replace(" ", "")
            if normalized_unit != normalized_ref_unit:
                compatible = (
                    normalized_unit in {"mg/dl", "mg%"} and normalized_ref_unit in {"mmol/l", "umol/l"}
                ) or (
                    normalized_unit in {"g/l"} and normalized_ref_unit in {"g/dl"}
                )
                if not compatible:
                    return ParsedLabLine(name=parsed.name, value=parsed.value, unit=parsed.unit)
        if parsed.reference_low is not None and parsed.reference_high is not None:
            low = min(parsed.reference_low, parsed.reference_high)
            high = max(parsed.reference_low, parsed.reference_high)
            if value < low * 0.05 or value > high * 20:
                return ParsedLabLine(name=parsed.name, value=parsed.value, unit=parsed.unit)
        ref = self._find_numeric_reference(parsed.name, self._guess_category(parsed.name))
        if ref and (parsed.reference_low is not None or parsed.reference_high is not None):
            normalized_low, normalized_high, _unit = self._normalize_reference_unit(
                ref,
                parsed.reference_low,
                parsed.reference_high,
                parsed.reference_unit or parsed.unit or ref.unit,
            )
            if (
                ref.high is not None
                and normalized_high is not None
                and normalized_high > ref.high * 3
            ) or (
                ref.low is not None
                and normalized_low is not None
                and normalized_low < ref.low / 3
            ):
                return ParsedLabLine(name=parsed.name, value=parsed.value, unit=parsed.unit)
        return parsed

    def _find_unrecognized_lines(self, raw_text: str, parsed_inputs: list[LabValueInput]) -> list[str]:
        recognized_names = {self._normalize_name(value.name) for value in parsed_inputs}
        unrecognized: list[str] = []
        for line in raw_text.splitlines():
            clean = line.strip()
            if not clean or len(clean) < 3:
                continue
            has_result_like_value = bool(
                re.search(r"([+-]?\d+(?:[.,]\d+)?|\+{1,3}|-{1,3}|âm tính|dương tính|negative|positive)", clean, re.IGNORECASE)
            )
            if not has_result_like_value:
                continue
            normalized = self._normalize_name(clean)
            if any(name and name in normalized for name in recognized_names):
                continue
            if self._looks_administrative_line(normalized):
                continue
            unrecognized.append(clean[:180])
        return unrecognized

    def _preview_raw_text(self, raw_text: str) -> str | None:
        lines = [line.strip() for line in raw_text.splitlines() if line.strip()]
        if not lines:
            return None
        return "\n".join(lines[:80])[:4000]

    def _looks_administrative_line(self, normalized: str) -> bool:
        tokens = (
            "nam",
            "nu",
            "tuoi",
            "gioi tinh",
            "dia chi",
            "benh nhan",
            "bac si",
            "chan doan",
            "ma bn",
            "barcode",
            "phong",
            "khoa",
            "ngay",
        )
        return any(token in normalized for token in tokens)

    def _parse_lab_line(self, clean: str, gender: Gender = "unknown") -> ParsedLabLine | None:
        value_pattern = r"([+-]?\d+(?:[.,]\d+)?|\+{1,3}|-{1,3}|âm tính|dương tính|negative|positive|neg|pos)"
        clean = self._strip_leading_bullet(clean)
        egfr = self._parse_egfr_line(clean, gender)
        if egfr is not None:
            return egfr
        match = re.match(
            rf"^([A-Za-zÀ-ỹ0-9_ ./%()#-]+?)\s*[:=]?\s+{value_pattern}\s*([A-Za-zÀ-ỹ/%^0-9µμ.]+)?",
            clean,
            re.IGNORECASE,
        )
        if match:
            name, raw_value, unit = match.groups()
            ref = self._parse_reference_range(clean[match.end():], gender)
            return ParsedLabLine(name=name, value=raw_value, unit=unit, **ref)

        # Some PDF table extractors produce "value unit test name".
        match = re.match(
            rf"^{value_pattern}\s*([A-Za-zÀ-ỹ/%^0-9µμ.]+)?\s+([A-Za-zÀ-ỹ0-9_ ./%()#-]+)$",
            clean,
            re.IGNORECASE,
        )
        if match:
            raw_value, unit, name = match.groups()
            ref = self._parse_reference_range(clean[match.end():], gender)
            return ParsedLabLine(name=name, value=raw_value, unit=unit, **ref)
        return None

    def _parse_egfr_line(self, clean: str, gender: Gender = "unknown") -> ParsedLabLine | None:
        if "egfr" not in self._normalize_name(clean):
            return None
        numbers = re.findall(r"(?<![A-Za-z])([+-]?\d+(?:[.,]\d+)?)", clean)
        if not numbers:
            return None
        value = next((number for number in numbers if number not in {"2021"}), numbers[-1])
        ref = self._parse_reference_range(clean, gender)
        return ParsedLabLine(name="eGFR", value=value, unit="ml/ph/1.73 m2", **ref)

    def _parse_split_lab_row(self, lines: list[str], index: int, gender: Gender = "unknown") -> ParsedLabLine | None:
        name = self._strip_leading_bullet(lines[index])
        category = self._guess_category(name)
        if not self._find_numeric_reference(name, category) and not self._find_qualitative_reference(name, category):
            return None
        for offset in range(1, 5):
            if index + offset >= len(lines):
                break
            candidate = lines[index + offset].strip()
            value_match = re.match(r"^([+-]?\d+(?:[.,]\d+)?|\+{1,3}|-{1,3}|âm tính|dương tính|negative|positive|neg|pos)\s*([A-Za-zÀ-ỹ/%^0-9µμ.]+)?$", candidate, re.IGNORECASE)
            if value_match:
                raw_value, unit = value_match.groups()
                reference_source = ""
                if not unit and index + offset + 1 < len(lines):
                    next_line = lines[index + offset + 1].strip()
                    if re.match(r"^[A-Za-zÀ-ỹ/%^0-9µμ.]+$", next_line):
                        unit = next_line
                return ParsedLabLine(name=name, value=raw_value, unit=unit)
        return None

    def _parse_reference_range(self, text: str, gender: Gender = "unknown") -> dict[str, float | str | None]:
        normalized = text.strip()
        if not normalized:
            return {
                "reference_low": None,
                "reference_high": None,
                "reference_unit": None,
                "reference_range_source": None,
            }
        range_match = re.search(
            r"([+-]?\d+(?:[.,]\d+)?)\s*(?:-|–|—|to|đến|den)\s*([+-]?\d+(?:[.,]\d+)?)\s*([A-Za-zÀ-ỹ/%^0-9µμ.]+)?",
            normalized,
            re.IGNORECASE,
        )
        gender_ref = self._parse_gendered_reference_range(normalized, gender)
        if gender_ref is not None:
            return gender_ref
        if range_match:
            low, high, unit = range_match.groups()
            return {
                "reference_low": self._to_float(low),
                "reference_high": self._to_float(high),
                "reference_unit": unit,
                "reference_range_source": range_match.group(0),
            }
        upper_match = re.search(
            r"(?:<|<=|≤|duoi|dưới|nho hon|nhỏ hơn)\s*([+-]?\d+(?:[.,]\d+)?)\s*([A-Za-zÀ-ỹ/%^0-9µμ.]+)?",
            normalized,
            re.IGNORECASE,
        )
        if upper_match:
            high, unit = upper_match.groups()
            return {
                "reference_low": None,
                "reference_high": self._to_float(high),
                "reference_unit": unit,
                "reference_range_source": upper_match.group(0),
            }
        lower_match = re.search(
            r"(?:>|>=|≥|tren|trên|lon hon|lớn hơn)\s*([+-]?\d+(?:[.,]\d+)?)\s*([A-Za-zÀ-ỹ/%^0-9µμ.]+)?",
            normalized,
            re.IGNORECASE,
        )
        if lower_match:
            low, unit = lower_match.groups()
            return {
                "reference_low": self._to_float(low),
                "reference_high": None,
                "reference_unit": unit,
                "reference_range_source": lower_match.group(0),
            }
        return {
            "reference_low": None,
            "reference_high": None,
            "reference_unit": None,
            "reference_range_source": None,
        }

    def _parse_gendered_reference_range(self, text: str, gender: Gender) -> dict[str, float | str | None] | None:
        normalized_gender = "nam" if gender == "male" else "nu" if gender == "female" else None
        if normalized_gender is None:
            return None
        normalized_text = self._normalize_name(text)
        pattern = rf"{normalized_gender}\s*:\s*([+-]?\d+(?:[.,]\d+)?)\s*(?:-|–|—|to|đến|den)\s*([+-]?\d+(?:[.,]\d+)?)\s*([A-Za-zÀ-ỹ/%^0-9µμ.]+)?"
        match = re.search(pattern, normalized_text, re.IGNORECASE)
        if not match:
            return None
        low, high, unit = match.groups()
        return {
            "reference_low": self._to_float(low),
            "reference_high": self._to_float(high),
            "reference_unit": unit,
            "reference_range_source": match.group(0),
        }

    def _strip_leading_bullet(self, text: str) -> str:
        return re.sub(r"^[.\-•·]+\s*", "", text.strip())

    def _find_numeric_reference(self, name: str, category: LabCategory | None) -> NumericReference | None:
        normalized = self._normalize_name(name)
        for ref in self.numeric_references:
            if category and ref.category != category:
                continue
            aliases = tuple(self._normalize_name(alias) for alias in ref.aliases)
            if self._matches_reference_name(normalized, ref.code, aliases):
                return ref
        return None

    def _find_qualitative_reference(self, name: str, category: LabCategory | None) -> QualitativeReference | None:
        normalized = self._normalize_name(name)
        for ref in QUALITATIVE_REFERENCES:
            if category and ref.category != category:
                continue
            aliases = tuple(self._normalize_name(alias) for alias in ref.aliases)
            if self._matches_reference_name(normalized, ref.code, aliases):
                return ref
        return None

    def _guess_category(self, name: str) -> LabCategory:
        normalized = self._normalize_name(name)
        urine_tokens = ("urine", "nuoc tieu", "nieu", "nitrite", "ketone", "protein")
        if normalized in {"ph", "sg"}:
            return "urine"
        return "urine" if any(token in normalized for token in urine_tokens) else "blood"

    def _normalize_name(self, name: str) -> str:
        normalized = unicodedata.normalize("NFKD", name.strip().lower())
        without_accents = "".join(char for char in normalized if not unicodedata.combining(char))
        without_accents = without_accents.replace("đ", "d")
        return " ".join(without_accents.split())

    def _matches_reference_name(self, normalized: str, code: str, aliases: tuple[str, ...]) -> bool:
        code_normalized = self._normalize_name(code)
        if normalized == code_normalized or normalized in aliases:
            return True
        for alias in aliases:
            if len(alias) <= 3:
                if re.search(rf"(?<![a-z0-9]){re.escape(alias)}(?![a-z0-9])", normalized):
                    return True
                continue
            if alias in normalized:
                return True
        return False

    def _to_float(self, value: object) -> float | None:
        try:
            if isinstance(value, str):
                value = value.replace(",", ".")
            return float(value)
        except (TypeError, ValueError):
            return None

    def _normalize_numeric_unit(self, ref: NumericReference, number: float, unit: str | None) -> tuple[float, str | None]:
        if not unit:
            return number, ref.unit or None
        normalized_unit = self._normalize_name(unit).replace(" ", "")
        if ref.code == "HGB" and normalized_unit in {"g/l", "gpl"}:
            return round(number / 10.0, 3), "g/dL"
        if ref.code == "GLU" and normalized_unit in {"mg/dl", "mg%"}:
            return round(number / 18.0182, 3), "mmol/L"
        if ref.code == "CRE" and normalized_unit in {"mg/dl", "mg%"}:
            return round(number * 88.4, 3), "umol/L"
        if ref.code == "UREA" and normalized_unit in {"mg/dl", "mg%"}:
            return round(number * 0.357, 3), "mmol/L"
        return number, unit

    def _reference_from_input(self, value: LabValueInput, ref: NumericReference) -> NumericReference:
        if value.reference_low is None and value.reference_high is None:
            return ref
        low = value.reference_low
        high = value.reference_high
        reference_unit = value.reference_unit or value.unit or ref.unit
        low, high, unit = self._normalize_reference_unit(ref, low, high, reference_unit)
        return NumericReference(
            category=ref.category,
            code=ref.code,
            display_name=ref.display_name,
            aliases=ref.aliases,
            unit=unit or ref.unit,
            low=low,
            high=high,
            severity_low=ref.severity_low,
            severity_high=ref.severity_high,
            note_low=ref.note_low,
            note_high=ref.note_high,
        )

    def _normalize_reference_unit(
        self,
        ref: NumericReference,
        low: float | None,
        high: float | None,
        unit: str | None,
    ) -> tuple[float | None, float | None, str | None]:
        if not unit:
            return low, high, ref.unit or None
        normalized_unit = self._normalize_name(unit).replace(" ", "")
        divisor: float | None = None
        multiplier: float | None = None
        target_unit = unit
        if ref.code == "HGB" and normalized_unit in {"g/l", "gpl"}:
            divisor = 10.0
            target_unit = "g/dL"
        elif ref.code == "GLU" and normalized_unit in {"mg/dl", "mg%"}:
            divisor = 18.0182
            target_unit = "mmol/L"
        elif ref.code == "CRE" and normalized_unit in {"mg/dl", "mg%"}:
            multiplier = 88.4
            target_unit = "umol/L"
        elif ref.code == "UREA" and normalized_unit in {"mg/dl", "mg%"}:
            multiplier = 0.357
            target_unit = "mmol/L"

        if divisor:
            return (
                round(low / divisor, 3) if low is not None else None,
                round(high / divisor, 3) if high is not None else None,
                target_unit,
            )
        if multiplier:
            return (
                round(low * multiplier, 3) if low is not None else None,
                round(high * multiplier, 3) if high is not None else None,
                target_unit,
            )
        return low, high, unit

    def _format_range(self, ref: NumericReference) -> str:
        unit = f" {ref.unit}" if ref.unit else ""
        if ref.low is not None and ref.high is not None:
            return f"{ref.low:g} - {ref.high:g}{unit}"
        if ref.high is not None:
            return f"<= {ref.high:g}{unit}"
        if ref.low is not None:
            return f">= {ref.low:g}{unit}"
        return "Không xác định"

    def _load_trained_numeric_references(self, path: Path) -> tuple[NumericReference, ...]:
        if not path.exists():
            return NUMERIC_REFERENCES
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            trained = {
                str(item.get("code")): item
                for item in payload.get("references", [])
                if item.get("segment") == "all" and item.get("code")
            }
        except (OSError, json.JSONDecodeError, TypeError):
            return NUMERIC_REFERENCES

        references: list[NumericReference] = []
        for ref in NUMERIC_REFERENCES:
            item = trained.get(ref.code)
            if not item or self._has_clinical_reference_range(ref):
                references.append(ref)
                continue
            try:
                references.append(
                    NumericReference(
                        category=ref.category,
                        code=ref.code,
                        display_name=ref.display_name,
                        aliases=ref.aliases,
                        unit=str(item.get("unit") or ref.unit),
                        low=float(item["low"]) if item.get("low") is not None else ref.low,
                        high=float(item["high"]) if item.get("high") is not None else ref.high,
                        severity_low=float(item["severity_low"]) if item.get("severity_low") is not None else ref.severity_low,
                        severity_high=float(item["severity_high"]) if item.get("severity_high") is not None else ref.severity_high,
                        note_low=ref.note_low,
                        note_high=ref.note_high,
                    )
                )
            except (KeyError, TypeError, ValueError):
                references.append(ref)
        return tuple(references)

    def _has_clinical_reference_range(self, ref: NumericReference) -> bool:
        return ref.low is not None or ref.high is not None

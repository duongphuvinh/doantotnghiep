import json

from app.lab_results import LabResultProcessor
from app.schemas import LabAnalyzeRequest, LabValueInput


def test_lab_processor_detects_blood_abnormalities():
    processor = LabResultProcessor()
    result = processor.analyze(
        LabAnalyzeRequest(
            gender="unknown",
            values=[
                LabValueInput(name="WBC", value=15.2, unit="10^9/L", category="blood"),
                LabValueInput(name="Hemoglobin", value=10.1, unit="g/dL", category="blood"),
            ],
        )
    )

    assert result.abnormal_count == 2
    assert {item.code for item in result.items} == {"WBC", "HGB"}


def test_lab_processor_detects_urine_positive_values_from_raw_text():
    processor = LabResultProcessor()
    result = processor.analyze(
        LabAnalyzeRequest(
            raw_text="Protein +\nNitrite positive\npH 6.5",
        )
    )

    codes = {item.code for item in result.items}
    assert "PRO" in codes
    assert "NIT" in codes
    assert "PH" in codes
    assert result.abnormal_count >= 2


def test_lab_processor_does_not_treat_dt_as_glucose():
    processor = LabResultProcessor()
    result = processor.analyze(
        LabAnalyzeRequest(
            raw_text="ĐT 28 mmol/L\nA4.05 Cc Vạn Gia Phúc 295 T",
        )
    )

    assert result.items == []
    assert result.abnormal_count == 0


def test_lab_processor_does_not_match_ph_inside_patient_name():
    processor = LabResultProcessor()
    result = processor.analyze(
        LabAnalyzeRequest(
            raw_text="A4.05 Cc Vạn Gia Phúc: 295 T\nNam: 74",
        )
    )

    assert result.items == []
    assert result.abnormal_count == 0


def test_lab_processor_reads_split_pdf_table_rows():
    processor = LabResultProcessor()
    result = processor.analyze(
        LabAnalyzeRequest(
            raw_text="\n".join(
                [
                    "Bạch cầu",
                    "12.5",
                    "10^9/L",
                    "Hemoglobin",
                    "140",
                    "g/L",
                    "Creatinin",
                    "90",
                    "umol/L",
                    "Triglycerid",
                    "2.3",
                    "mmol/L",
                    "Nam",
                    "74",
                ]
            ),
        )
    )

    by_code = {item.code: item for item in result.items}
    assert {"WBC", "HGB", "CRE", "TG"}.issubset(by_code)
    assert by_code["HGB"].value == 14
    assert "Nam" not in {item.input_name for item in result.items}


def test_lab_processor_deduplicates_repeated_lab_items():
    processor = LabResultProcessor()
    result = processor.analyze(
        LabAnalyzeRequest(
            raw_text="Glucose máu 28 mmol/L\nGlucose 28 mmol/L",
        )
    )

    assert [item.code for item in result.items] == ["GLU"]
    assert result.abnormal_count == 1


def test_lab_processor_prefers_real_glucose_over_administrative_dt_line():
    processor = LabResultProcessor()
    result = processor.analyze(
        LabAnalyzeRequest(
            raw_text="ĐT 28\nGlucose 4.9 mmol/L 3.9-5.6 mmol/L\n. Glucose 88 mg/dL 70-101 mg/dL",
        )
    )

    assert [item.code for item in result.items] == ["GLU"]
    assert result.items[0].value == 4.9
    assert result.items[0].status == "normal"
    assert result.items[0].reference_range == "3.9 - 5.6 mmol/L"


def test_lab_processor_uses_clinical_glucose_reference_over_nhanes_model():
    processor = LabResultProcessor()
    result = processor.analyze(
        LabAnalyzeRequest(
            raw_text="Glucose máu 4.9 mmol/L",
        )
    )

    assert result.items[0].code == "GLU"
    assert result.items[0].status == "normal"
    assert result.items[0].reference_range == "3.9 - 5.6 mmol/L"
    assert result.abnormal_count == 0


def test_lab_processor_prefers_reference_range_printed_on_report():
    processor = LabResultProcessor()
    result = processor.analyze(
        LabAnalyzeRequest(
            raw_text="Glucose máu 4.9 mmol/L 3.9 - 5.6 mmol/L",
        )
    )

    assert result.items[0].code == "GLU"
    assert result.items[0].status == "normal"
    assert result.items[0].reference_range == "3.9 - 5.6 mmol/L"


def test_lab_processor_ignores_misaligned_reference_ranges_from_pdf_columns():
    processor = LabResultProcessor()
    result = processor.analyze(
        LabAnalyzeRequest(
            raw_text="\n".join(
                [
                    "Ure 23.97 mmol/L 74 - 114",
                    "Creatinine 93 umol/L 208 - 428",
                ]
            ),
        )
    )

    by_code = {item.code: item for item in result.items}
    assert by_code["UREA"].reference_range == "2.5 - 7.5 mmol/L"
    assert by_code["UREA"].status == "high"
    assert by_code["CRE"].reference_range == "45 - 110 umol/L"
    assert by_code["CRE"].status == "normal"


def test_lab_processor_reads_creatinine_and_egfr_rows_with_gender_reference():
    processor = LabResultProcessor()
    result = processor.analyze(
        LabAnalyzeRequest(
            gender="male",
            raw_text="\n".join(
                [
                    "Creatinine 89.2 umol/L Nam: 74 - 114; Nữ: 58 - 96 umol/L",
                    ". Creatinine 1.01 mg/dL Nam: 0.83-1.28; Nữ: 0.66-1.09 mg/dL",
                    ". eGFR (CKD-EPI 2021) 93 >= 60 ml/ph/1.73 m2",
                ]
            ),
        )
    )

    by_code = {item.code: item for item in result.items}
    assert by_code["CRE"].value == 89.2
    assert by_code["CRE"].unit == "umol/L"
    assert by_code["CRE"].reference_range == "74 - 114 umol/L"
    assert by_code["CRE"].status == "normal"
    assert by_code["EGFR"].value == 93
    assert by_code["EGFR"].status == "normal"


def test_lab_processor_converts_printed_hgb_reference_unit():
    processor = LabResultProcessor()
    result = processor.analyze(
        LabAnalyzeRequest(
            raw_text="Hemoglobin 140 g/L 120 - 160 g/L",
        )
    )

    assert result.items[0].code == "HGB"
    assert result.items[0].value == 14
    assert result.items[0].status == "normal"
    assert result.items[0].reference_range == "12 - 16 g/dL"


def test_lab_processor_ignores_unknown_rows():
    processor = LabResultProcessor()
    result = processor.analyze(
        LabAnalyzeRequest(
            values=[LabValueInput(name="A4.05 Cc Vạn Gia Phúc", value=295, unit="T", category="blood")],
        )
    )

    assert result.items == []
    assert result.abnormal_count == 0


def test_lab_processor_keeps_clinical_reference_over_trained_population_file(tmp_path):
    model_path = tmp_path / "lab_reference_nhanes.json"
    model_path.write_text(
        json.dumps(
            {
                "references": [
                    {
                        "category": "blood",
                        "code": "WBC",
                        "display_name": "Bạch cầu",
                        "segment": "all",
                        "unit": "10^9/L",
                        "low": 4.0,
                        "high": 12.0,
                        "severity_low": 2.0,
                        "severity_high": 20.0,
                    }
                ]
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    processor = LabResultProcessor(trained_reference_path=model_path)
    result = processor.analyze(
        LabAnalyzeRequest(values=[LabValueInput(name="WBC", value=11.0, unit="10^9/L", category="blood")])
    )

    assert result.items[0].status == "high"
    assert result.items[0].reference_range == "4 - 10 10^9/L"

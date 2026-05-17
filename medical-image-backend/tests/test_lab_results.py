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


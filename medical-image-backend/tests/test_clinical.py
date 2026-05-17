from app.clinical import ClinicalDataProcessor
from app.schemas import ClinicalAnalyzeRequest


def test_clinical_processor_flags_bone_related_risk():
    processor = ClinicalDataProcessor()
    result = processor.analyze(
        ClinicalAnalyzeRequest(
            age=67,
            gender="female",
            symptoms=["đau khớp gối", "sưng sau té ngã"],
            medical_history=["loãng xương"],
            clinical_indicators={"pain_score": 8},
        )
    )

    levels = {item.level for item in result.risk_items}
    assert "medium" in levels
    assert "đối chiếu" in result.recommended_next_steps[0].lower()


def test_clinical_processor_returns_low_when_no_clear_risk():
    processor = ClinicalDataProcessor()
    result = processor.analyze(
        ClinicalAnalyzeRequest(
            age=25,
            gender="male",
            symptoms=["mỏi nhẹ"],
            medical_history=[],
            clinical_indicators={},
        )
    )

    assert result.risk_items[0].level == "low"


from app.evaluation import EvaluationService
from app.schemas import EvaluationRecord


def test_evaluation_service_compares_models():
    records = [
        EvaluationRecord(model_name="image_only", y_true="normal", y_pred="normal"),
        EvaluationRecord(model_name="image_only", y_true="fracture", y_pred="normal"),
        EvaluationRecord(model_name="multimodal", y_true="normal", y_pred="normal"),
        EvaluationRecord(model_name="multimodal", y_true="fracture", y_pred="fracture"),
    ]

    result = EvaluationService().evaluate(records)

    assert result.best_model_by_macro_f1 == "multimodal"
    assert len(result.models) == 2
    assert result.models[0].total == 2


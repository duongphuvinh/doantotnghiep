from __future__ import annotations

from collections import defaultdict

from .schemas import (
    ClassMetric,
    EvaluationRecord,
    EvaluationResponse,
    ModelEvaluationMetrics,
)


class EvaluationService:
    def evaluate(self, records: list[EvaluationRecord]) -> EvaluationResponse:
        grouped: dict[str, list[EvaluationRecord]] = defaultdict(list)
        for record in records:
            grouped[record.model_name].append(record)

        metrics = [self._evaluate_model(name, rows) for name, rows in sorted(grouped.items())]
        best = max(metrics, key=lambda item: item.macro_f1).model_name if metrics else None
        summary = (
            f"Mô hình có macro-F1 cao nhất: {best}."
            if best
            else "Chưa có dữ liệu đánh giá."
        )
        return EvaluationResponse(
            models=metrics,
            best_model_by_macro_f1=best,
            comparison_summary=summary,
        )

    def _evaluate_model(self, model_name: str, records: list[EvaluationRecord]) -> ModelEvaluationMetrics:
        labels = sorted({r.y_true for r in records} | {r.y_pred for r in records})
        confusion: dict[str, dict[str, int]] = {
            label: {pred: 0 for pred in labels} for label in labels
        }

        correct = 0
        for record in records:
            confusion[record.y_true][record.y_pred] += 1
            if record.y_true == record.y_pred:
                correct += 1

        class_metrics: list[ClassMetric] = []
        total = len(records)
        for label in labels:
            tp = confusion[label][label]
            fp = sum(confusion[actual][label] for actual in labels if actual != label)
            fn = sum(confusion[label][pred] for pred in labels if pred != label)
            support = sum(confusion[label].values())
            precision = self._safe_div(tp, tp + fp)
            recall = self._safe_div(tp, tp + fn)
            f1 = self._safe_div(2 * precision * recall, precision + recall)
            class_metrics.append(ClassMetric(
                label=label,
                support=support,
                precision=round(precision, 4),
                recall=round(recall, 4),
                f1_score=round(f1, 4),
            ))

        macro_precision = self._mean([m.precision for m in class_metrics])
        macro_recall = self._mean([m.recall for m in class_metrics])
        macro_f1 = self._mean([m.f1_score for m in class_metrics])
        weighted_f1 = self._safe_div(
            sum(m.f1_score * m.support for m in class_metrics),
            total,
        )

        return ModelEvaluationMetrics(
            model_name=model_name,
            accuracy=round(self._safe_div(correct, total), 4),
            macro_precision=round(macro_precision, 4),
            macro_recall=round(macro_recall, 4),
            macro_f1=round(macro_f1, 4),
            weighted_f1=round(weighted_f1, 4),
            total=total,
            class_metrics=class_metrics,
            confusion_matrix=confusion,
        )

    def _safe_div(self, numerator: float, denominator: float) -> float:
        return numerator / denominator if denominator else 0.0

    def _mean(self, values: list[float]) -> float:
        return sum(values) / len(values) if values else 0.0

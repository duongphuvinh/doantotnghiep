from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.evaluation import EvaluationService
from app.schemas import EvaluationRecord


def read_records(path: Path) -> list[EvaluationRecord]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"model_name", "y_true", "y_pred"}
        if not reader.fieldnames or not required.issubset(set(reader.fieldnames)):
            raise SystemExit("CSV cần có các cột: model_name,y_true,y_pred")
        return [
            EvaluationRecord(
                model_name=(row.get("model_name") or "multimodal").strip(),
                y_true=(row.get("y_true") or "").strip(),
                y_pred=(row.get("y_pred") or "").strip(),
            )
            for row in reader
            if (row.get("y_true") or "").strip() and (row.get("y_pred") or "").strip()
        ]


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate model predictions with Accuracy/Precision/Recall/F1.")
    parser.add_argument("csv_path", type=Path, help="CSV with columns: model_name,y_true,y_pred")
    parser.add_argument("--out", type=Path, help="Optional JSON output path")
    args = parser.parse_args()

    response = EvaluationService().evaluate(read_records(args.csv_path))
    data = response.model_dump() if hasattr(response, "model_dump") else response.dict()
    text = json.dumps(data, ensure_ascii=False, indent=2)
    if args.out:
        args.out.write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()


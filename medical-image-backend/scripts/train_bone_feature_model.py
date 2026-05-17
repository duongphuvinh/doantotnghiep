from __future__ import annotations

import argparse
import csv
import json
import random
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.image_io import read_medical_image  # noqa: E402
from app.feature_model import extract_feature_model_vector  # noqa: E402
from app.processor import MedicalImageProcessor  # noqa: E402


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".dcm", ".dicom", ".pdf"}


@dataclass(frozen=True)
class Sample:
    path: Path
    label: str


def read_samples_from_dir(data_dir: Path) -> list[Sample]:
    samples: list[Sample] = []
    for class_dir in sorted(path for path in data_dir.iterdir() if path.is_dir()):
        for image_path in sorted(class_dir.rglob("*")):
            if image_path.suffix.lower() in IMAGE_EXTENSIONS:
                samples.append(Sample(path=image_path, label=class_dir.name))
    return samples


def read_samples_from_csv(csv_path: Path, image_root: Path | None) -> list[Sample]:
    samples: list[Sample] = []
    with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames or not {"image_path", "label"}.issubset(set(reader.fieldnames)):
            raise SystemExit("CSV cần có cột: image_path,label")
        for row in reader:
            raw_path = (row.get("image_path") or "").strip()
            label = (row.get("label") or "").strip()
            if not raw_path or not label:
                continue
            path = Path(raw_path)
            if not path.is_absolute() and image_root:
                path = image_root / path
            samples.append(Sample(path=path, label=label))
    return samples


def extract_feature(processor: MedicalImageProcessor, sample: Sample) -> np.ndarray | None:
    try:
        image, _, _ = read_medical_image(sample.path.read_bytes(), sample.path.name)
        processed, _ = processor.preprocess(image)
        return extract_feature_model_vector(processed, processor)
    except Exception as exc:
        print(f"[skip] {sample.path}: {exc}")
        return None


def stratified_split(samples: list[Sample], test_size: float, seed: int) -> tuple[list[Sample], list[Sample]]:
    rng = random.Random(seed)
    by_label: dict[str, list[Sample]] = defaultdict(list)
    for sample in samples:
        by_label[sample.label].append(sample)

    train: list[Sample] = []
    test: list[Sample] = []
    for rows in by_label.values():
        rng.shuffle(rows)
        test_count = max(1, int(round(len(rows) * test_size))) if len(rows) > 1 else 0
        test.extend(rows[:test_count])
        train.extend(rows[test_count:])
    return train, test


def softmax_from_distances(distances: np.ndarray) -> np.ndarray:
    scores = -distances
    scores = scores - scores.max()
    exp_scores = np.exp(scores)
    return exp_scores / np.maximum(exp_scores.sum(), 1e-12)


def predict_one(vector: np.ndarray, train_vectors: np.ndarray, y_train: list[int], labels: list[str], k: int) -> int:
    distances = np.linalg.norm(train_vectors - vector, axis=1)
    neighbor_indices = np.argsort(distances)[: max(1, min(k, len(distances)))]
    weights = 1.0 / np.maximum(distances[neighbor_indices], 1e-6)
    probs = np.zeros(len(labels), dtype=np.float32)
    for index, weight in zip(neighbor_indices, weights):
        probs[y_train[int(index)]] += float(weight)
    return int(np.argmax(probs))


def evaluate(vectors: np.ndarray, y_true: list[int], train_vectors: np.ndarray, y_train: list[int], labels: list[str], k: int) -> dict:
    y_pred = [predict_one(vector, train_vectors, y_train, labels, k) for vector in vectors]
    total = len(y_true)
    correct = sum(1 for actual, pred in zip(y_true, y_pred) if actual == pred)
    per_class = []
    for index, label in enumerate(labels):
        tp = sum(1 for actual, pred in zip(y_true, y_pred) if actual == index and pred == index)
        fp = sum(1 for actual, pred in zip(y_true, y_pred) if actual != index and pred == index)
        fn = sum(1 for actual, pred in zip(y_true, y_pred) if actual == index and pred != index)
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / (tp + fn) if tp + fn else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        per_class.append({
            "label": label,
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
        })
    return {
        "accuracy": round(correct / total, 4) if total else 0.0,
        "total": total,
        "per_class": per_class,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Train a lightweight feature-centroid bone model.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--data-dir", type=Path, help="Folder format: data_dir/class_name/*.png")
    source.add_argument("--csv", type=Path, help="CSV format: image_path,label")
    parser.add_argument("--image-root", type=Path, help="Root path for relative image_path values in CSV")
    parser.add_argument("--out-dir", type=Path, default=Path("models/bone_feature_demo"))
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--k", type=int, default=5)
    args = parser.parse_args()

    samples = read_samples_from_dir(args.data_dir) if args.data_dir else read_samples_from_csv(args.csv, args.image_root)
    samples = [sample for sample in samples if sample.path.exists()]
    if len(samples) < 8:
        raise SystemExit("Cần ít nhất 8 ảnh hợp lệ để train model feature-centroid.")

    labels = sorted({sample.label for sample in samples})
    if len(labels) < 2:
        raise SystemExit("Cần ít nhất 2 class để train.")
    label_to_idx = {label: index for index, label in enumerate(labels)}

    train_samples, test_samples = stratified_split(samples, args.test_size, args.seed)
    processor = MedicalImageProcessor()

    def build_matrix(rows: list[Sample]) -> tuple[np.ndarray, list[int]]:
        vectors = []
        targets = []
        for sample in rows:
            vector = extract_feature(processor, sample)
            if vector is None:
                continue
            vectors.append(vector)
            targets.append(label_to_idx[sample.label])
        return np.vstack(vectors).astype(np.float32), targets

    x_train, y_train = build_matrix(train_samples)
    x_test, y_test = build_matrix(test_samples)
    if len(set(y_train)) < 2:
        raise SystemExit("Train split cần ít nhất 2 class hợp lệ.")

    feature_mean = x_train.mean(axis=0)
    feature_scale = x_train.std(axis=0)
    x_train_norm = (x_train - feature_mean) / np.maximum(feature_scale, 1e-6)
    x_test_norm = (x_test - feature_mean) / np.maximum(feature_scale, 1e-6) if len(x_test) else x_test

    train_metrics = evaluate(x_train_norm, y_train, x_train_norm, y_train, labels, args.k)
    test_metrics = evaluate(x_test_norm, y_test, x_train_norm, y_train, labels, args.k) if len(x_test_norm) else {"accuracy": 0.0, "total": 0, "per_class": []}

    args.out_dir.mkdir(parents=True, exist_ok=True)
    model_path = args.out_dir / "bone_feature_model.json"
    payload = {
        "model_type": "feature_knn",
        "labels": labels,
        "k": args.k,
        "feature_mean": feature_mean.round(8).tolist(),
        "feature_scale": feature_scale.round(8).tolist(),
        "train_vectors": x_train_norm.round(8).tolist(),
        "train_targets": y_train,
        "metrics": {
            "train": train_metrics,
            "test": test_metrics,
            "samples": {"train": len(y_train), "test": len(y_test)},
        },
        "note": "Feature-centroid demo model. Use real labeled medical data for meaningful clinical performance.",
    }
    model_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    (args.out_dir / "metrics.json").write_text(json.dumps(payload["metrics"], ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Saved model: {model_path}")
    print(f"Labels: {', '.join(labels)}")
    print(f"Train accuracy: {train_metrics['accuracy']}")
    print(f"Test accuracy: {test_metrics['accuracy']} on {test_metrics['total']} samples")


if __name__ == "__main__":
    main()

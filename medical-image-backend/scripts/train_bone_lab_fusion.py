from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import numpy as np
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from sklearn.model_selection import train_test_split
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

from app.multimodal_mlp import build_fusion_mlp


def read_feature_csv(path: Path, label_col: str):
    rows: list[dict[str, str]] = []
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        if not reader.fieldnames or label_col not in reader.fieldnames:
            raise SystemExit(f"CSV cần có cột nhãn `{label_col}`")
        for row in reader:
            if row.get(label_col):
                rows.append(row)

    feature_cols = [col for col in reader.fieldnames or [] if col != label_col and col not in {"id", "image_path"}]
    labels = sorted({row[label_col] for row in rows})
    label_to_idx = {label: i for i, label in enumerate(labels)}
    x = np.array([[float(row.get(col) or 0) for col in feature_cols] for row in rows], dtype=np.float32)
    y = np.array([label_to_idx[row[label_col]] for row in rows], dtype=np.int64)
    return x, y, labels, feature_cols


def main() -> None:
    parser = argparse.ArgumentParser(description="Train image+clinical+lab fusion MLP from feature CSV.")
    parser.add_argument("--csv", type=Path, required=True, help="CSV with numeric feature columns and label column")
    parser.add_argument("--label-col", default="label")
    parser.add_argument("--out-dir", type=Path, default=Path("models/bone_lab_fusion"))
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    args = parser.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)

    x, y, labels, feature_cols = read_feature_csv(args.csv, args.label_col)
    if len(labels) < 2:
        raise SystemExit("Cần ít nhất 2 class.")

    x_train, x_test, y_train, y_test = train_test_split(x, y, test_size=0.2, random_state=args.seed, stratify=y)
    mean = x_train.mean(axis=0)
    std = x_train.std(axis=0)
    std[std == 0] = 1
    x_train = (x_train - mean) / std
    x_test = (x_test - mean) / std

    train_loader = DataLoader(
        TensorDataset(torch.from_numpy(x_train), torch.from_numpy(y_train)),
        batch_size=args.batch_size,
        shuffle=True,
    )

    model = build_fusion_mlp(input_dim=x.shape[1], num_classes=len(labels)).to(args.device)
    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)

    for epoch in range(1, args.epochs + 1):
        model.train()
        losses = []
        for features, target in train_loader:
            features = features.to(args.device)
            target = target.to(args.device)
            logits = model(features)
            loss = criterion(logits, target)
            optimizer.zero_grad()
            loss.backward()
            optimizer.step()
            losses.append(float(loss.item()))
        if epoch == 1 or epoch % 5 == 0:
            print(f"epoch={epoch:03d} loss={np.mean(losses):.4f}")

    model.eval()
    with torch.no_grad():
        logits = model(torch.from_numpy(x_test).to(args.device))
        y_pred = torch.argmax(logits, dim=1).cpu().numpy()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    example = torch.zeros(1, x.shape[1], device=args.device)
    traced = torch.jit.trace(model, example)
    traced.save(str(args.out_dir / "bone_lab_fusion.pt"))
    (args.out_dir / "labels.json").write_text(json.dumps(labels, ensure_ascii=False, indent=2), encoding="utf-8")
    (args.out_dir / "features.json").write_text(json.dumps({"columns": feature_cols, "mean": mean.tolist(), "std": std.tolist()}, ensure_ascii=False, indent=2), encoding="utf-8")
    (args.out_dir / "metrics.json").write_text(json.dumps({
        "accuracy": accuracy_score(y_test, y_pred),
        "classification_report": classification_report(y_test, y_pred, target_names=labels, output_dict=True, zero_division=0),
        "confusion_matrix": confusion_matrix(y_test, y_pred).tolist(),
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved fusion model: {args.out_dir / 'bone_lab_fusion.pt'}")


if __name__ == "__main__":
    main()


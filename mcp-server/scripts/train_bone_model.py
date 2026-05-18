from __future__ import annotations

import argparse
import csv
import json
import random
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import numpy as np
from PIL import Image, ImageOps
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from sklearn.model_selection import train_test_split
import torch
from torch import nn
from torch.utils.data import DataLoader, Dataset

from app.bone_cnn import build_bone_cnn


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}


@dataclass(frozen=True)
class Sample:
    path: Path
    label: str


class BoneImageDataset(Dataset):
    def __init__(self, samples: list[Sample], label_to_idx: dict[str, int], image_size: int, augment: bool) -> None:
        self.samples = samples
        self.label_to_idx = label_to_idx
        self.image_size = image_size
        self.augment = augment

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, index: int):
        sample = self.samples[index]
        image = Image.open(sample.path).convert("L")
        image = ImageOps.autocontrast(image)
        image = image.resize((self.image_size, self.image_size))

        if self.augment:
            if random.random() < 0.5:
                image = ImageOps.mirror(image)
            if random.random() < 0.2:
                image = image.rotate(random.uniform(-7, 7), resample=Image.Resampling.BILINEAR)

        arr = np.asarray(image, dtype=np.float32) / 255.0
        tensor = torch.from_numpy(arr).unsqueeze(0)
        return tensor, self.label_to_idx[sample.label]


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


def split_samples(samples: list[Sample], test_size: float, val_size: float, seed: int):
    labels = [sample.label for sample in samples]
    train_val, test = train_test_split(
        samples,
        test_size=test_size,
        random_state=seed,
        stratify=labels if len(set(labels)) > 1 else None,
    )
    train_val_labels = [sample.label for sample in train_val]
    val_ratio = val_size / (1.0 - test_size)
    train, val = train_test_split(
        train_val,
        test_size=val_ratio,
        random_state=seed,
        stratify=train_val_labels if len(set(train_val_labels)) > 1 else None,
    )
    return train, val, test


def run_epoch(model, loader, criterion, optimizer, device: str, train: bool):
    model.train(train)
    total_loss = 0.0
    y_true: list[int] = []
    y_pred: list[int] = []

    for images, labels in loader:
        images = images.to(device)
        labels = labels.to(device)

        with torch.set_grad_enabled(train):
            logits = model(images)
            loss = criterion(logits, labels)
            if train:
                optimizer.zero_grad()
                loss.backward()
                optimizer.step()

        total_loss += float(loss.item()) * images.size(0)
        predictions = torch.argmax(logits, dim=1)
        y_true.extend(labels.detach().cpu().tolist())
        y_pred.extend(predictions.detach().cpu().tolist())

    avg_loss = total_loss / max(1, len(loader.dataset))
    accuracy = accuracy_score(y_true, y_pred) if y_true else 0.0
    return avg_loss, accuracy, y_true, y_pred


def export_torchscript(model, out_path: Path, image_size: int, device: str) -> None:
    model.eval()
    example = torch.zeros(1, 1, image_size, image_size, device=device)
    traced = torch.jit.trace(model, example)
    traced.save(str(out_path))


def main() -> None:
    parser = argparse.ArgumentParser(description="Train a bone pathology CNN and export TorchScript.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--data-dir", type=Path, help="Folder format: data_dir/class_name/*.png")
    source.add_argument("--csv", type=Path, help="CSV format: image_path,label")
    parser.add_argument("--image-root", type=Path, help="Root path for relative image_path values in CSV")
    parser.add_argument("--out-dir", type=Path, default=Path("models/bone_cnn"))
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--image-size", type=int, default=512)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--test-size", type=float, default=0.15)
    parser.add_argument("--val-size", type=float, default=0.15)
    parser.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    args = parser.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)

    samples = read_samples_from_dir(args.data_dir) if args.data_dir else read_samples_from_csv(args.csv, args.image_root)
    samples = [sample for sample in samples if sample.path.exists()]
    if len(samples) < 10:
        raise SystemExit("Cần ít nhất 10 ảnh hợp lệ để huấn luyện.")

    labels = sorted({sample.label for sample in samples})
    if len(labels) < 2:
        raise SystemExit("Cần ít nhất 2 class để huấn luyện.")
    label_to_idx = {label: index for index, label in enumerate(labels)}

    train_samples, val_samples, test_samples = split_samples(samples, args.test_size, args.val_size, args.seed)
    train_loader = DataLoader(BoneImageDataset(train_samples, label_to_idx, args.image_size, augment=True), batch_size=args.batch_size, shuffle=True)
    val_loader = DataLoader(BoneImageDataset(val_samples, label_to_idx, args.image_size, augment=False), batch_size=args.batch_size)
    test_loader = DataLoader(BoneImageDataset(test_samples, label_to_idx, args.image_size, augment=False), batch_size=args.batch_size)

    model = build_bone_cnn(num_classes=len(labels)).to(args.device)
    class_counts = np.bincount([label_to_idx[s.label] for s in train_samples], minlength=len(labels))
    weights = class_counts.sum() / np.maximum(class_counts, 1)
    weights = torch.tensor(weights, dtype=torch.float32, device=args.device)
    criterion = nn.CrossEntropyLoss(weight=weights)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    best_val_acc = -1.0
    best_state = None
    history = []

    for epoch in range(1, args.epochs + 1):
        train_loss, train_acc, _, _ = run_epoch(model, train_loader, criterion, optimizer, args.device, train=True)
        val_loss, val_acc, _, _ = run_epoch(model, val_loader, criterion, optimizer, args.device, train=False)
        history.append({"epoch": epoch, "train_loss": train_loss, "train_acc": train_acc, "val_loss": val_loss, "val_acc": val_acc})
        print(f"epoch={epoch:03d} train_loss={train_loss:.4f} train_acc={train_acc:.4f} val_loss={val_loss:.4f} val_acc={val_acc:.4f}")
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            best_state = {key: value.detach().cpu().clone() for key, value in model.state_dict().items()}

    if best_state is not None:
        model.load_state_dict(best_state)

    _, test_acc, y_true, y_pred = run_epoch(model, test_loader, criterion, optimizer, args.device, train=False)
    report = classification_report(y_true, y_pred, target_names=labels, output_dict=True, zero_division=0)
    matrix = confusion_matrix(y_true, y_pred).tolist()

    torch.save({"state_dict": model.state_dict(), "labels": labels, "image_size": args.image_size}, args.out_dir / "bone_model.pth")
    export_torchscript(model, args.out_dir / "bone_model.pt", args.image_size, args.device)
    (args.out_dir / "bone_model.labels.json").write_text(json.dumps(labels, ensure_ascii=False, indent=2), encoding="utf-8")
    (args.out_dir / "metrics.json").write_text(
        json.dumps(
            {
                "labels": labels,
                "history": history,
                "test_accuracy": test_acc,
                "classification_report": report,
                "confusion_matrix": matrix,
                "splits": {"train": len(train_samples), "val": len(val_samples), "test": len(test_samples)},
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    print(f"Saved TorchScript model: {args.out_dir / 'bone_model.pt'}")
    print(f"Saved labels: {args.out_dir / 'bone_model.labels.json'}")
    print(f"Test accuracy: {test_acc:.4f}")


if __name__ == "__main__":
    main()


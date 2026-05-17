from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import numpy as np
from PIL import Image, ImageOps
import torch


def load_image(path: Path, image_size: int):
    image = Image.open(path).convert("L")
    image = ImageOps.autocontrast(image)
    image = image.resize((image_size, image_size))
    arr = np.asarray(image, dtype=np.float32) / 255.0
    return torch.from_numpy(arr).unsqueeze(0).unsqueeze(0)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a trained bone TorchScript model on one image.")
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--labels", type=Path)
    parser.add_argument("--image-size", type=int, default=512)
    args = parser.parse_args()

    model = torch.jit.load(str(args.model), map_location="cpu")
    model.eval()
    labels = json.loads(args.labels.read_text(encoding="utf-8")) if args.labels and args.labels.exists() else []

    with torch.no_grad():
        logits = model(load_image(args.image, args.image_size))
        probs = torch.softmax(logits, dim=1).cpu().numpy()[0]
    top = int(np.argmax(probs))
    print(json.dumps({
        "top_label": labels[top] if top < len(labels) else str(top),
        "confidence": float(probs[top]),
        "probabilities": {labels[i] if i < len(labels) else str(i): float(prob) for i, prob in enumerate(probs)},
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()


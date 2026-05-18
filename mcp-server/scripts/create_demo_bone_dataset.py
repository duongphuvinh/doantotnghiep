from __future__ import annotations

import argparse
import math
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


LABELS = ("normal", "fracture", "arthritis", "osteoporosis")
LABEL_SEED_OFFSETS = {label: index * 10_000 for index, label in enumerate(LABELS)}


def draw_base_bone(rng: random.Random, size: int) -> Image.Image:
    image = Image.new("L", (size, size), rng.randint(10, 24))
    draw = ImageDraw.Draw(image)
    center = size // 2 + rng.randint(-10, 10)
    bone_width = rng.randint(size // 7, size // 5)
    gap = rng.randint(size // 18, size // 13)
    top = rng.randint(size // 8, size // 6)
    bottom = rng.randint(size - size // 6, size - size // 9)

    for offset in (-gap, gap):
        x = center + offset
        draw.rounded_rectangle(
            [x - bone_width // 2, top, x + bone_width // 2, bottom],
            radius=bone_width // 2,
            fill=rng.randint(175, 220),
        )
        draw.ellipse(
            [x - bone_width, top - bone_width // 3, x + bone_width, top + bone_width],
            fill=rng.randint(185, 230),
        )
        draw.ellipse(
            [x - bone_width, bottom - bone_width, x + bone_width, bottom + bone_width // 3],
            fill=rng.randint(185, 230),
        )

    return image.filter(ImageFilter.GaussianBlur(radius=1.2))


def add_noise(image: Image.Image, rng: random.Random, sigma: float) -> Image.Image:
    arr = np.asarray(image, dtype=np.float32)
    noise = np.random.default_rng(rng.randint(1, 999_999)).normal(0, sigma, arr.shape)
    arr = np.clip(arr + noise, 0, 255).astype(np.uint8)
    return Image.fromarray(arr, mode="L")


def make_sample(label: str, seed: int, size: int) -> Image.Image:
    rng = random.Random(seed)
    image = draw_base_bone(rng, size)
    draw = ImageDraw.Draw(image)

    if label == "fracture":
        for _ in range(rng.randint(1, 2)):
            y = rng.randint(size // 3, size * 2 // 3)
            angle = rng.uniform(-0.9, 0.9)
            length = rng.randint(size // 5, size // 3)
            x0 = size // 2 - length // 2 + rng.randint(-size // 10, size // 10)
            x1 = x0 + length
            y0 = int(y - math.sin(angle) * length // 2)
            y1 = int(y + math.sin(angle) * length // 2)
            draw.line([x0, y0, x1, y1], fill=rng.randint(5, 25), width=rng.randint(4, 9))
            draw.line([x0, y0 - 4, x1, y1 - 4], fill=rng.randint(220, 255), width=rng.randint(1, 3))

    elif label == "arthritis":
        joint_y = rng.choice([size // 4, size * 3 // 4])
        for _ in range(12):
            x = rng.randint(size // 3, size * 2 // 3)
            radius = rng.randint(3, 8)
            draw.ellipse([x - radius, joint_y - radius, x + radius, joint_y + radius], fill=rng.randint(215, 255))
        draw.rectangle([size // 3, joint_y - 6, size * 2 // 3, joint_y + 6], outline=rng.randint(230, 255), width=2)

    elif label == "osteoporosis":
        arr = np.asarray(image, dtype=np.float32)
        arr = arr * rng.uniform(0.62, 0.78)
        mask = arr > 90
        holes = np.random.default_rng(seed).random(arr.shape) > 0.965
        arr[np.logical_and(mask, holes)] = rng.randint(25, 60)
        image = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), mode="L")
        draw = ImageDraw.Draw(image)

    image = add_noise(image, rng, sigma=rng.uniform(5, 14))
    image = image.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0.0, 0.8)))
    if rng.random() < 0.5:
        image = image.rotate(rng.uniform(-5, 5), resample=Image.Resampling.BICUBIC, fillcolor=rng.randint(8, 24))
    if rng.random() < 0.5:
        image = Image.fromarray(np.fliplr(np.asarray(image)), mode="L")
    return image


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a synthetic demo bone-image dataset.")
    parser.add_argument("--out-dir", type=Path, default=Path("examples/demo_bone_dataset"))
    parser.add_argument("--samples-per-class", type=int, default=96)
    parser.add_argument("--size", type=int, default=512)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    for label in LABELS:
        class_dir = args.out_dir / label
        class_dir.mkdir(parents=True, exist_ok=True)
        for index in range(args.samples_per_class):
            image = make_sample(label, seed=args.seed + index + LABEL_SEED_OFFSETS[label], size=args.size)
            image.save(class_dir / f"{label}_{index:03d}.png")

    print(f"Created demo dataset: {args.out_dir}")
    print("Labels:", ", ".join(LABELS))
    print("Use real labeled X-ray/CT/MRI data for meaningful medical performance.")


if __name__ == "__main__":
    main()

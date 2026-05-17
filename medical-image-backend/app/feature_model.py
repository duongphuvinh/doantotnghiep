from __future__ import annotations

import numpy as np

from .processor import MedicalImageProcessor


def extract_feature_model_vector(image: np.ndarray, processor: MedicalImageProcessor | None = None) -> np.ndarray:
    """Feature vector used by the lightweight trainable JSON model."""
    processor = processor or MedicalImageProcessor()
    arr = image.astype(np.float32)
    base = processor.extract_bone_features(image).feature_vector

    gy, gx = np.gradient(arr)
    grad = np.sqrt(gx * gx + gy * gy)
    height, width = arr.shape[:2]
    center = arr[height // 4: height * 3 // 4, width // 4: width * 3 // 4]
    horizontal_band = arr[height // 2 - max(1, height // 20): height // 2 + max(1, height // 20), :]
    vertical_band = arr[:, width // 2 - max(1, width // 20): width // 2 + max(1, width // 20)]

    extra = [
        float(arr.mean() / 255.0),
        float(arr.std() / 255.0),
        float((arr.max() - arr.min()) / 255.0),
        float((arr < 35).mean()),
        float((arr > 190).mean()),
        float(grad.mean() / 255.0),
        float(np.percentile(grad, 90) / 255.0),
        float(np.percentile(grad, 98) / 255.0),
        float(center.mean() / 255.0),
        float(center.std() / 255.0),
        float(horizontal_band.mean() / 255.0),
        float(vertical_band.mean() / 255.0),
    ]
    return np.asarray([*base, *extra], dtype=np.float32)

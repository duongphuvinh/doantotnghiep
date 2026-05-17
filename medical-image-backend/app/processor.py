from __future__ import annotations

import math

import numpy as np
from PIL import Image

try:
    import cv2
except Exception:  # pragma: no cover - optional runtime dependency
    cv2 = None

from .schemas import BoneFeatureSummary, PreprocessInfo, QualityMetrics


class MedicalImageProcessor:
    def __init__(self, target_size: tuple[int, int] = (512, 512)) -> None:
        self.target_size = target_size

    def preprocess(self, image: np.ndarray) -> tuple[np.ndarray, PreprocessInfo]:
        original_size = (int(image.shape[1]), int(image.shape[0]))
        normalized = self._normalize(image)
        enhanced = self._enhance_contrast(normalized)
        resized = self._resize(enhanced, self.target_size)

        return resized, PreprocessInfo(
            normalized=True,
            contrast_enhanced=True,
            resized_to=self.target_size,
            original_size=original_size,
        )

    def quality_metrics(self, image: np.ndarray) -> QualityMetrics:
        arr = image.astype(np.float32)
        mean_intensity = float(arr.mean())
        contrast_std = float(arr.std())
        dynamic_range = float(arr.max() - arr.min())
        dark_pixel_ratio = float((arr < 10).mean())
        bright_pixel_ratio = float((arr > 245).mean())

        if cv2 is not None:
            sharpness = float(cv2.Laplacian(arr, cv2.CV_32F).var())
        else:
            gy, gx = np.gradient(arr)
            sharpness = float((gx * gx + gy * gy).mean())

        warnings: list[str] = []
        if contrast_std < 20:
            warnings.append("Low contrast image")
        if sharpness < 25:
            warnings.append("Possible blur or low-detail image")
        if dark_pixel_ratio > 0.65:
            warnings.append("Image is very dark")
        if bright_pixel_ratio > 0.35:
            warnings.append("Large saturated bright region")

        return QualityMetrics(
            mean_intensity=round(mean_intensity, 4),
            contrast_std=round(contrast_std, 4),
            sharpness_laplacian_var=round(sharpness, 4),
            dynamic_range=round(dynamic_range, 4),
            dark_pixel_ratio=round(dark_pixel_ratio, 4),
            bright_pixel_ratio=round(bright_pixel_ratio, 4),
            warnings=warnings,
        )

    def extract_bone_features(self, image: np.ndarray) -> BoneFeatureSummary:
        arr = image.astype(np.uint8)
        threshold = self._otsu_threshold(arr)
        high_density_mask = arr >= threshold
        estimated_area = float(high_density_mask.mean())

        if cv2 is not None:
            components_count, _, stats, _ = cv2.connectedComponentsWithStats(
                high_density_mask.astype(np.uint8),
                connectivity=8,
            )
            min_area = max(20, int(arr.size * 0.001))
            region_count = int(sum(1 for i in range(1, components_count) if stats[i, cv2.CC_STAT_AREA] >= min_area))
            edges = cv2.Canny(arr, 50, 150)
            edge_density = float((edges > 0).mean())
        else:
            region_count = 1 if estimated_area > 0 else 0
            gy, gx = np.gradient(arr.astype(np.float32))
            magnitude = np.sqrt(gx * gx + gy * gy)
            edge_density = float((magnitude > np.percentile(magnitude, 85)).mean())

        symmetry = self._left_right_symmetry(arr)
        histogram = np.histogram(arr, bins=16, range=(0, 255), density=True)[0]
        feature_vector = [
            float(estimated_area),
            float(region_count),
            float(edge_density),
            float(symmetry) if symmetry is not None else 0.0,
            *[float(x) for x in histogram],
        ]

        return BoneFeatureSummary(
            estimated_bone_area_ratio=round(estimated_area, 5),
            high_density_region_count=region_count,
            edge_density=round(edge_density, 5),
            symmetry_score=round(symmetry, 5) if symmetry is not None else None,
            feature_vector=[round(x, 6) for x in feature_vector],
        )

    def _normalize(self, image: np.ndarray) -> np.ndarray:
        arr = image.astype(np.float32)
        low, high = np.percentile(arr, [0.5, 99.5])
        if high <= low:
            return np.zeros(arr.shape, dtype=np.uint8)
        arr = np.clip((arr - low) / (high - low), 0, 1)
        return (arr * 255).astype(np.uint8)

    def _enhance_contrast(self, image: np.ndarray) -> np.ndarray:
        if cv2 is not None:
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            return clahe.apply(image)

        pil_image = Image.fromarray(image)
        return np.array(pil_image, dtype=np.uint8)

    def _resize(self, image: np.ndarray, size: tuple[int, int]) -> np.ndarray:
        if cv2 is not None:
            return cv2.resize(image, size, interpolation=cv2.INTER_AREA)
        pil_image = Image.fromarray(image)
        return np.array(pil_image.resize(size), dtype=np.uint8)

    def _otsu_threshold(self, image: np.ndarray) -> int:
        if cv2 is not None:
            threshold, _ = cv2.threshold(image, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            return int(threshold)

        hist, bin_edges = np.histogram(image.ravel(), bins=256, range=(0, 256))
        total = image.size
        sum_total = float(np.dot(np.arange(256), hist))
        sum_background = 0.0
        weight_background = 0
        max_variance = -math.inf
        threshold = 127

        for value in range(256):
            weight_background += int(hist[value])
            if weight_background == 0:
                continue
            weight_foreground = total - weight_background
            if weight_foreground == 0:
                break
            sum_background += value * int(hist[value])
            mean_background = sum_background / weight_background
            mean_foreground = (sum_total - sum_background) / weight_foreground
            variance = weight_background * weight_foreground * (mean_background - mean_foreground) ** 2
            if variance > max_variance:
                max_variance = variance
                threshold = value

        return int(bin_edges[threshold])

    def _left_right_symmetry(self, image: np.ndarray) -> float | None:
        height, width = image.shape[:2]
        half = width // 2
        if half < 8:
            return None

        left = image[:, :half].astype(np.float32)
        right = np.fliplr(image[:, width - half:]).astype(np.float32)
        diff = np.abs(left - right).mean() / 255.0
        return float(max(0.0, 1.0 - diff))


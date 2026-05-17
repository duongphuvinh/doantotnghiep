from __future__ import annotations

from io import BytesIO
from typing import Any

import numpy as np
from PIL import Image

try:
    import pydicom
except Exception:  # pragma: no cover - optional runtime dependency
    pydicom = None

try:
    import fitz
except Exception:  # pragma: no cover - optional runtime dependency
    fitz = None


class UnsupportedImageError(ValueError):
    pass


def _normalize_to_uint8(array: np.ndarray) -> np.ndarray:
    arr = array.astype(np.float32)
    finite = arr[np.isfinite(arr)]
    if finite.size == 0:
        raise UnsupportedImageError("Image contains no finite pixel values")

    low, high = np.percentile(finite, [0.5, 99.5])
    if high <= low:
        low, high = float(finite.min()), float(finite.max())
    if high <= low:
        return np.zeros(arr.shape, dtype=np.uint8)

    arr = np.clip((arr - low) / (high - low), 0, 1)
    return (arr * 255).astype(np.uint8)


def read_medical_image(content: bytes, filename: str) -> tuple[np.ndarray, str, dict[str, Any]]:
    """Read a common image or DICOM file into a uint8 grayscale array."""
    lower_name = filename.lower()

    if lower_name.endswith(".pdf"):
        if fitz is None:
            raise UnsupportedImageError("PDF support requires pymupdf")
        try:
            document = fitz.open(stream=content, filetype="pdf")
            if document.page_count == 0:
                raise UnsupportedImageError("PDF does not contain any pages")
            page = document.load_page(0)
            pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
            image = Image.frombytes("RGB", [pixmap.width, pixmap.height], pixmap.samples)
            grayscale = image.convert("L")
            metadata = {
                "page_count": int(document.page_count),
                "rendered_page": 1,
                "source": "pdf-first-page",
            }
            document.close()
            return np.array(grayscale, dtype=np.uint8), "pdf", metadata
        except UnsupportedImageError:
            raise
        except Exception as exc:
            raise UnsupportedImageError(f"Cannot read PDF: {exc}") from exc

    if lower_name.endswith((".dcm", ".dicom")):
        if pydicom is None:
            raise UnsupportedImageError("DICOM support requires pydicom")
        dataset = pydicom.dcmread(BytesIO(content), force=True)
        if not hasattr(dataset, "pixel_array"):
            raise UnsupportedImageError("DICOM file does not contain pixel data")

        pixels = dataset.pixel_array.astype(np.float32)
        slope = float(getattr(dataset, "RescaleSlope", 1) or 1)
        intercept = float(getattr(dataset, "RescaleIntercept", 0) or 0)
        pixels = pixels * slope + intercept

        metadata = {
            "patient_id": str(getattr(dataset, "PatientID", "")) or None,
            "study_description": str(getattr(dataset, "StudyDescription", "")) or None,
            "series_description": str(getattr(dataset, "SeriesDescription", "")) or None,
            "body_part": str(getattr(dataset, "BodyPartExamined", "")) or None,
            "modality": str(getattr(dataset, "Modality", "")) or None,
            "rows": int(getattr(dataset, "Rows", 0) or 0),
            "columns": int(getattr(dataset, "Columns", 0) or 0),
        }
        return _normalize_to_uint8(pixels), "dicom", metadata

    try:
        image = Image.open(BytesIO(content))
        image.load()
    except Exception as exc:
        raise UnsupportedImageError(f"Cannot read image: {exc}") from exc

    grayscale = image.convert("L")
    return np.array(grayscale, dtype=np.uint8), image.format or "image", {}

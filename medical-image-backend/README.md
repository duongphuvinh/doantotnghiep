# Medical Image Backend

Module Python/FastAPI for processing bone-related medical images such as X-ray,
CT, MRI, and DICOM files.

This module is intentionally split into two layers:

- Image processing: validation, normalization, enhancement, quality checks,
  rough bone-region feature extraction, and preview generation.
- Model inference: optional PyTorch model loading when trained weights are
  available.

Without trained weights, the API returns image-analysis features and a clear
`analysis_only` status. It does not pretend to diagnose disease.

## Quick Start

```bash
cd medical-image-backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

If you already have trained PyTorch weights and want model inference:

```bash
pip install -r requirements-model.txt
```

Open:

```text
http://localhost:8000/docs
```

## Environment Variables

```text
MEDICAL_IMAGE_MODEL_PATH=./models/bone_model.pt
MEDICAL_IMAGE_MODEL_LABELS=normal,fracture,arthritis,osteoporosis,other
```

If `MEDICAL_IMAGE_MODEL_PATH` is missing, the service still works in
analysis-only mode.

## API

### `POST /api/images/analyze`

Form fields:

- `file`: image file. Supports PNG/JPG/BMP/TIFF and DICOM when `pydicom` is
  installed.
- `modality`: optional, one of `xray`, `ct`, `mri`, `unknown`.
- `body_part`: optional text such as `hand`, `knee`, `spine`.

Response includes:

- image metadata
- quality metrics
- preprocessing settings
- extracted image features
- optional model prediction
- safety note

## Tests

```bash
pytest
```

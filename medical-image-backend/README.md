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

Recommended Python versions: **3.11 or 3.12** for the widest compatibility,
especially when installing optional PyTorch training dependencies. The backend
also runs on newer Python versions when compatible wheels are available.

### macOS / MacBook M1 / Linux

```bash
cd medical-image-backend
chmod +x scripts/setup_backend.sh
./scripts/setup_backend.sh
./.venv/bin/python scripts/run_backend.py --reload
```

If MacBook M1 fails while building `numpy`, `opencv-python-headless`, or
`torch`, install Python 3.12 and recreate the virtual environment:

```bash
brew install python@3.12
rm -rf .venv
PYTHON_BIN=python3.12 ./scripts/setup_backend.sh
./.venv/bin/python scripts/run_backend.py --reload
```

### Windows PowerShell

```bash
cd medical-image-backend
.\scripts\setup_backend.ps1
.\.venv\Scripts\python.exe scripts\run_backend.py --reload
```

### Windows Git Bash

```bash
cd ~/Desktop/doantotnghiep/medical-image-backend
./.venv/Scripts/python.exe scripts/run_backend.py --reload
```

If `.venv` does not exist yet in Git Bash, run setup once from PowerShell or run:

```bash
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements.txt
./.venv/Scripts/python.exe scripts/seed_demo_patients.py
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

## Training a Bone Pathology Model

The project includes a trainable offline CNN for grayscale bone images. It
exports TorchScript, so the existing `/api/images/analyze` endpoint can load it
directly.

### Dataset Format A: Folder per Class

```text
dataset/
  normal/
    img001.png
  fracture/
    img002.png
  arthritis/
    img003.png
```

Train:

```bash
cd medical-image-backend
pip install -r requirements.txt
pip install -r requirements-model.txt
python scripts/train_bone_model.py --data-dir dataset --out-dir models/bone_cnn --epochs 20
```

### Dataset Format B: CSV

```csv
image_path,label
images/img001.png,normal
images/img002.png,fracture
images/img003.png,arthritis
```

Train:

```bash
python scripts/train_bone_model.py --csv labels.csv --image-root . --out-dir models/bone_cnn --epochs 20
```

Outputs:

```text
models/bone_cnn/bone_model.pt
models/bone_cnn/bone_model.pth
models/bone_cnn/bone_model.labels.json
models/bone_cnn/metrics.json
```

Run backend with the trained model:

Windows PowerShell:

```powershell
$env:MEDICAL_IMAGE_MODEL_PATH="models/bone_cnn/bone_model.pt"
.\.venv\Scripts\python.exe scripts\run_backend.py --reload
```

macOS/Linux:

```bash
export MEDICAL_IMAGE_MODEL_PATH=models/bone_cnn/bone_model.pt
./.venv/bin/python scripts/run_backend.py --reload
```

Quick prediction test:

```bash
python scripts/predict_bone_model.py --model models/bone_cnn/bone_model.pt --labels models/bone_cnn/bone_model.labels.json --image dataset/fracture/sample.png
```

## API

### Authentication

Create an account:

```text
POST /api/auth/register
```

Login and copy the returned `access_token`:

```text
POST /api/auth/login
```

In Swagger UI, click **Authorize** and enter:

```text
Bearer <access_token>
```

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

### Protected Clinical Data APIs

All patient-detail and clinical-record APIs require login.

```text
POST /api/patients
GET /api/patients
GET /api/patients/{patient_id}
POST /api/patients/{patient_id}/clinical-records
GET /api/patients/{patient_id}/clinical-records
POST /api/clinical/analyze
POST /api/multimodal/analyze
POST /api/evaluation/metrics
POST /api/evaluation/metrics-file
```

Privacy rule: normal users can only access patients they created. Admin users can
access all patients.

### Multimodal Fusion

`POST /api/multimodal/analyze` accepts:

- `file`: X-ray/CT/MRI/DICOM/PDF image.
- `clinical_json`: JSON matching `ClinicalAnalyzeRequest`.
- `lab_json`: optional JSON matching `LabAnalyzeRequest`, for blood/urine
  indicators.
- `modality`: optional.
- `body_part`: optional.

The current implementation is a transparent rule-weighted late-fusion baseline.
It combines image feature signals, clinical risk signals, and lab-result signals
in one inference pipeline.

### Train a Bone + Lab Fusion Model

For a trainable fusion model, prepare a feature CSV with numeric columns from
image, clinical data, and lab results:

```csv
image_bone_area,image_edge_density,image_quality_warning_count,age,pain_score,clinical_risk_score,lab_abnormal_count,lab_urgent_count,crp,wbc,label
0.20,0.08,0,35,2,0.1,0,0,2.0,6.5,normal
0.12,0.18,1,68,8,0.7,2,0,35.0,14.0,fracture
```

Train:

```bash
python scripts/train_bone_lab_fusion.py --csv examples/fusion_features_example.csv --out-dir models/bone_lab_fusion --epochs 50
```

Outputs:

```text
models/bone_lab_fusion/bone_lab_fusion.pt
models/bone_lab_fusion/features.json
models/bone_lab_fusion/labels.json
models/bone_lab_fusion/metrics.json
```

### Model Evaluation

Upload a CSV to `POST /api/evaluation/metrics-file` with columns:

```csv
model_name,y_true,y_pred
image_only,fracture,normal
clinical_only,fracture,fracture
multimodal,fracture,fracture
```

The response includes Accuracy, macro Precision, macro Recall, macro F1,
weighted F1, per-class metrics, and confusion matrices.

CLI option:

```bash
python scripts/evaluate_predictions.py predictions.csv --out metrics.json
```

## Tests

```bash
pytest
```

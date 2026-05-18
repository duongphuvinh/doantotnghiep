$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")

$PythonBin = if ($env:PYTHON_BIN) { $env:PYTHON_BIN } else { "python" }

if (-not (Test-Path ".venv")) {
  & $PythonBin -m venv .venv
}

& ".\.venv\Scripts\python.exe" -m pip install --upgrade pip
& ".\.venv\Scripts\python.exe" -m pip install -r requirements.txt
& ".\.venv\Scripts\python.exe" scripts\seed_demo_patients.py

Write-Host ""
Write-Host "Backend is ready."
Write-Host "Run:"
Write-Host "  .\.venv\Scripts\python.exe scripts\run_backend.py --reload"

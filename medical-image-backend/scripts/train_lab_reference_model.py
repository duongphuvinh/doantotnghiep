from __future__ import annotations

import argparse
import json
import math
import urllib.request
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Callable

try:
    import pandas as pd
except ImportError as exc:  # pragma: no cover - dependency hint for CLI users
    raise SystemExit(
        "This script requires pandas. Install backend requirements first: "
        "python -m pip install -r requirements.txt"
    ) from exc


CDC_BASE = "https://wwwn.cdc.gov/Nchs/Data/Nhanes/Public"


@dataclass(frozen=True)
class DatasetCycle:
    year: str
    suffix: str


@dataclass(frozen=True)
class LabColumn:
    code: str
    display_name: str
    category: str
    source: str
    column: str
    unit: str
    convert: Callable[[float], float] = lambda value: value


CYCLES = (
    DatasetCycle("2015", "I"),
    DatasetCycle("2017", "J"),
    DatasetCycle("2021", "L"),
)

LAB_COLUMNS = (
    LabColumn("WBC", "Bạch cầu", "blood", "CBC", "LBXWBCSI", "10^9/L"),
    LabColumn("RBC", "Hồng cầu", "blood", "CBC", "LBXRBCSI", "10^12/L"),
    LabColumn("HGB", "Hemoglobin", "blood", "CBC", "LBXHGB", "g/dL"),
    LabColumn("HCT", "Hematocrit", "blood", "CBC", "LBXHCT", "%"),
    LabColumn("PLT", "Tiểu cầu", "blood", "CBC", "LBXPLTSI", "10^9/L"),
    LabColumn("GLU", "Glucose máu", "blood", "BIOPRO", "LBXSGL", "mmol/L", lambda value: value / 18.0182),
    LabColumn("CRE", "Creatinine", "blood", "BIOPRO", "LBXSCR", "umol/L", lambda value: value * 88.4),
    LabColumn("UREA", "Ure", "blood", "BIOPRO", "LBXSBU", "mmol/L", lambda value: value * 0.357),
    LabColumn("ALT", "ALT/GPT", "blood", "BIOPRO", "LBXSATSI", "U/L"),
    LabColumn("AST", "AST/GOT", "blood", "BIOPRO", "LBXSASSI", "U/L"),
    LabColumn("ALB", "Albumin", "blood", "BIOPRO", "LBXSAL", "g/L", lambda value: value * 10),
    LabColumn("ALP", "Phosphatase kiềm", "blood", "BIOPRO", "LBXSAPSI", "U/L"),
    LabColumn("CA", "Calci", "blood", "BIOPRO", "LBDSCASI", "mmol/L"),
    LabColumn("CHOL", "Cholesterol toàn phần", "blood", "BIOPRO", "LBDSCHSI", "mmol/L"),
    LabColumn("CK", "Creatine kinase", "blood", "BIOPRO", "LBXSCK", "U/L"),
    LabColumn("CL", "Chloride", "blood", "BIOPRO", "LBXSCLSI", "mmol/L"),
    LabColumn("GGT", "GGT", "blood", "BIOPRO", "LBXSGTSI", "U/L"),
    LabColumn("IRON", "Sắt huyết thanh", "blood", "BIOPRO", "LBDSIRSI", "umol/L"),
    LabColumn("K", "Kali", "blood", "BIOPRO", "LBXSKSI", "mmol/L"),
    LabColumn("LDH", "LDH", "blood", "BIOPRO", "LBXSLDSI", "U/L"),
    LabColumn("NA", "Natri", "blood", "BIOPRO", "LBXSNASI", "mmol/L"),
    LabColumn("PHOS", "Phospho", "blood", "BIOPRO", "LBDSPHSI", "mmol/L"),
    LabColumn("TBIL", "Bilirubin toàn phần", "blood", "BIOPRO", "LBDSTBSI", "umol/L"),
    LabColumn("TP", "Protein toàn phần", "blood", "BIOPRO", "LBDSTPSI", "g/L"),
    LabColumn("TG", "Triglycerid", "blood", "BIOPRO", "LBDSTRSI", "mmol/L"),
    LabColumn("UA", "Acid uric", "blood", "BIOPRO", "LBDSUASI", "umol/L"),
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Train NHANES-based lab reference quantile model.")
    parser.add_argument("--out", type=Path, default=Path("models/lab_reference_nhanes.json"))
    parser.add_argument("--cache-dir", type=Path, default=Path("data/nhanes"))
    parser.add_argument("--lower-q", type=float, default=0.025)
    parser.add_argument("--upper-q", type=float, default=0.975)
    parser.add_argument("--urgent-lower-q", type=float, default=0.01)
    parser.add_argument("--urgent-upper-q", type=float, default=0.99)
    args = parser.parse_args()

    args.cache_dir.mkdir(parents=True, exist_ok=True)
    frames = []
    for cycle in CYCLES:
        demo = read_xpt(cycle, f"DEMO_{cycle.suffix}", args.cache_dir)
        for source in ("CBC", "BIOPRO"):
            lab = read_xpt(cycle, f"{source}_{cycle.suffix}", args.cache_dir)
            frames.append(extract_cycle_labs(cycle, demo, lab, source))

    long_df = pd.concat(frames, ignore_index=True)
    references = []
    for code, group in long_df.groupby("code"):
        column = next(item for item in LAB_COLUMNS if item.code == code)
        values = group["value"].dropna()
        if len(values) < 100:
            continue
        references.append(build_reference(column, values, "all", args.lower_q, args.upper_q, args.urgent_lower_q, args.urgent_upper_q))

        for gender, gender_group in group.groupby("gender"):
            gender_values = gender_group["value"].dropna()
            if len(gender_values) >= 100:
                references.append(build_reference(column, gender_values, gender, args.lower_q, args.upper_q, args.urgent_lower_q, args.urgent_upper_q))

    payload = {
        "model_type": "nhanes_quantile_reference",
        "source": "CDC NHANES public laboratory data",
        "cycles": [f"{cycle.year}-{cycle.suffix}" for cycle in CYCLES],
        "quantiles": {
            "low": args.lower_q,
            "high": args.upper_q,
            "urgent_low": args.urgent_lower_q,
            "urgent_high": args.urgent_upper_q,
        },
        "notes": [
            "Population quantiles are a screening aid, not a diagnostic model.",
            "Reference intervals can differ by laboratory, analyzer, age, sex, pregnancy status, and clinical context.",
            "Glucose from NHANES BIOPRO is not the preferred diabetes classification variable; use it only as a general lab signal.",
        ],
        "references": references,
    }

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(references)} references to {args.out}")


def read_xpt(cycle: DatasetCycle, name: str, cache_dir: Path) -> "pd.DataFrame":
    path = cache_dir / f"{name}.xpt"
    if not path.exists():
        url = f"{CDC_BASE}/{cycle.year}/DataFiles/{name}.xpt"
        print(f"Downloading {url}")
        with urllib.request.urlopen(url, timeout=60) as response:
            path.write_bytes(response.read())
    return pd.read_sas(BytesIO(path.read_bytes()), format="xport")


def extract_cycle_labs(cycle: DatasetCycle, demo: "pd.DataFrame", lab: "pd.DataFrame", source: str) -> "pd.DataFrame":
    merged = lab.merge(demo[["SEQN", "RIAGENDR", "RIDAGEYR"]], on="SEQN", how="left")
    rows = []
    for column in (item for item in LAB_COLUMNS if item.source == source):
        if column.column not in merged.columns:
            continue
        values = pd.to_numeric(merged[column.column], errors="coerce").map(
            lambda value: column.convert(value) if math.isfinite(value) else math.nan
        )
        rows.append(
            pd.DataFrame(
                {
                    "cycle": cycle.suffix,
                    "code": column.code,
                    "gender": merged["RIAGENDR"].map({1: "male", 2: "female"}).fillna("unknown"),
                    "age": pd.to_numeric(merged["RIDAGEYR"], errors="coerce"),
                    "value": values,
                }
            )
        )
    return pd.concat(rows, ignore_index=True) if rows else pd.DataFrame(columns=["cycle", "code", "gender", "age", "value"])


def build_reference(
    column: LabColumn,
    values: "pd.Series",
    segment: str,
    lower_q: float,
    upper_q: float,
    urgent_lower_q: float,
    urgent_upper_q: float,
) -> dict[str, object]:
    return {
        "category": column.category,
        "code": column.code,
        "display_name": column.display_name,
        "segment": segment,
        "unit": column.unit,
        "n": int(values.count()),
        "low": round(float(values.quantile(lower_q)), 3),
        "high": round(float(values.quantile(upper_q)), 3),
        "severity_low": round(float(values.quantile(urgent_lower_q)), 3),
        "severity_high": round(float(values.quantile(urgent_upper_q)), 3),
        "median": round(float(values.quantile(0.5)), 3),
    }


if __name__ == "__main__":
    main()

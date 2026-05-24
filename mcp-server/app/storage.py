from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from threading import Lock
from typing import Any

from .config import get_settings

_init_lock = Lock()


class Database:
    def __init__(self) -> None:
        settings = get_settings()
        self.path = settings.resolved_database_path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._init_schema()

    def connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        return conn

    def _init_schema(self) -> None:
        with _init_lock:
            with self.connect() as conn:
                conn.executescript(
                    """
                    CREATE TABLE IF NOT EXISTS users (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        username TEXT NOT NULL UNIQUE,
                        password_hash TEXT NOT NULL,
                        full_name TEXT,
                        role TEXT NOT NULL DEFAULT 'clinician',
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    );

                    CREATE TABLE IF NOT EXISTS patients (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        patient_code TEXT NOT NULL,
                        full_name TEXT NOT NULL,
                        age INTEGER NOT NULL,
                        gender TEXT NOT NULL,
                        phone TEXT,
                        address TEXT,
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(owner_user_id, patient_code)
                    );

                    CREATE TABLE IF NOT EXISTS clinical_records (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        patient_id INTEGER NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
                        created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        symptoms_json TEXT NOT NULL,
                        medical_history_json TEXT NOT NULL,
                        clinical_indicators_json TEXT NOT NULL,
                        note TEXT,
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    );

                    CREATE TABLE IF NOT EXISTS prediction_runs (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        case_code TEXT NOT NULL,
                        y_true TEXT NOT NULL,
                        before_ai_pred TEXT,
                        image_ai_pred TEXT,
                        clinical_ai_pred TEXT,
                        multimodal_pred TEXT,
                        note TEXT,
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    );

                    CREATE TABLE IF NOT EXISTS upload_records (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        patient_id INTEGER REFERENCES patients(id) ON DELETE SET NULL,
                        upload_type TEXT NOT NULL,
                        filename TEXT NOT NULL,
                        content_type TEXT,
                        file_path TEXT,
                        file_size INTEGER,
                        file_hash TEXT,
                        image_hash TEXT,
                        modality TEXT,
                        body_part TEXT,
                        source_text TEXT,
                        analysis_json TEXT NOT NULL,
                        label_status TEXT NOT NULL DEFAULT 'unlabeled',
                        usable_for_training INTEGER NOT NULL DEFAULT 1,
                        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                    );
                    """
                )
                self._ensure_column(
                    conn,
                    "upload_records",
                    "patient_id",
                    "INTEGER REFERENCES patients(id) ON DELETE SET NULL",
                )
                self._ensure_column(conn, "upload_records", "file_hash", "TEXT")
                self._ensure_column(conn, "upload_records", "image_hash", "TEXT")

    def _ensure_column(self, conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
        columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        if column not in columns:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")

    def create_user(self, username: str, password_hash: str, full_name: str | None, role: str = "clinician") -> dict:
        with self.connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO users (username, password_hash, full_name, role)
                VALUES (?, ?, ?, ?)
                """,
                (username, password_hash, full_name, role),
            )
            return self.get_user_by_id(int(cursor.lastrowid), conn=conn)

    def get_user_by_username(self, username: str) -> dict | None:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
            return dict(row) if row else None

    def get_user_by_id(self, user_id: int, conn: sqlite3.Connection | None = None) -> dict | None:
        owns_conn = conn is None
        conn = conn or self.connect()
        try:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return dict(row) if row else None
        finally:
            if owns_conn:
                conn.close()

    def create_patient(self, owner_user_id: int, data: dict[str, Any]) -> dict:
        with self.connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO patients (owner_user_id, patient_code, full_name, age, gender, phone, address)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    owner_user_id,
                    data["patient_code"],
                    data["full_name"],
                    data["age"],
                    data["gender"],
                    data.get("phone"),
                    data.get("address"),
                ),
            )
            return self.get_patient_by_id(int(cursor.lastrowid), conn=conn)

    def list_patients(self, user_id: int, role: str) -> list[dict]:
        with self.connect() as conn:
            if role in {"admin", "clinician"}:
                rows = conn.execute("SELECT * FROM patients ORDER BY created_at DESC").fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM patients WHERE owner_user_id = ? ORDER BY created_at DESC",
                    (user_id,),
                ).fetchall()
            return [dict(row) for row in rows]

    def get_patient_by_id(self, patient_id: int, conn: sqlite3.Connection | None = None) -> dict | None:
        owns_conn = conn is None
        conn = conn or self.connect()
        try:
            row = conn.execute("SELECT * FROM patients WHERE id = ?", (patient_id,)).fetchone()
            return dict(row) if row else None
        finally:
            if owns_conn:
                conn.close()

    def create_clinical_record(self, patient_id: int, created_by_user_id: int, data: dict[str, Any]) -> dict:
        with self.connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO clinical_records (
                    patient_id,
                    created_by_user_id,
                    symptoms_json,
                    medical_history_json,
                    clinical_indicators_json,
                    note
                )
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    patient_id,
                    created_by_user_id,
                    json.dumps(data.get("symptoms", []), ensure_ascii=False),
                    json.dumps(data.get("medical_history", []), ensure_ascii=False),
                    json.dumps(data.get("clinical_indicators", {}), ensure_ascii=False),
                    data.get("note"),
                ),
            )
            return self.get_clinical_record_by_id(int(cursor.lastrowid), conn=conn)

    def list_clinical_records(self, patient_id: int) -> list[dict]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM clinical_records WHERE patient_id = ? ORDER BY created_at DESC",
                (patient_id,),
            ).fetchall()
            return [self._record_from_row(row) for row in rows]

    def get_clinical_record_by_id(self, record_id: int, conn: sqlite3.Connection | None = None) -> dict | None:
        owns_conn = conn is None
        conn = conn or self.connect()
        try:
            row = conn.execute("SELECT * FROM clinical_records WHERE id = ?", (record_id,)).fetchone()
            return self._record_from_row(row) if row else None
        finally:
            if owns_conn:
                conn.close()

    def _record_from_row(self, row: sqlite3.Row) -> dict:
        data = dict(row)
        data["symptoms"] = json.loads(data.pop("symptoms_json"))
        data["medical_history"] = json.loads(data.pop("medical_history_json"))
        data["clinical_indicators"] = json.loads(data.pop("clinical_indicators_json"))
        return data

    def create_prediction_run(self, owner_user_id: int, data: dict[str, Any]) -> dict:
        with self.connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO prediction_runs (
                    owner_user_id,
                    case_code,
                    y_true,
                    before_ai_pred,
                    image_ai_pred,
                    clinical_ai_pred,
                    multimodal_pred,
                    note
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    owner_user_id,
                    data["case_code"],
                    data["y_true"],
                    data.get("before_ai_pred"),
                    data.get("image_ai_pred"),
                    data.get("clinical_ai_pred"),
                    data.get("multimodal_pred"),
                    data.get("note"),
                ),
            )
            row = conn.execute("SELECT * FROM prediction_runs WHERE id = ?", (int(cursor.lastrowid),)).fetchone()
            return dict(row)

    def list_prediction_runs(self, user_id: int, role: str) -> list[dict]:
        with self.connect() as conn:
            if role == "admin":
                rows = conn.execute("SELECT * FROM prediction_runs ORDER BY created_at DESC").fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM prediction_runs WHERE owner_user_id = ? ORDER BY created_at DESC",
                    (user_id,),
                ).fetchall()
            return [dict(row) for row in rows]

    def create_upload_record(self, owner_user_id: int, data: dict[str, Any]) -> dict:
        with self.connect() as conn:
            cursor = conn.execute(
                """
                INSERT INTO upload_records (
                    owner_user_id,
                    patient_id,
                    upload_type,
                    filename,
                    content_type,
                    file_path,
                    file_size,
                    file_hash,
                    image_hash,
                    modality,
                    body_part,
                    source_text,
                    analysis_json,
                    label_status,
                    usable_for_training
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    owner_user_id,
                    data.get("patient_id"),
                    data["upload_type"],
                    data["filename"],
                    data.get("content_type"),
                    data.get("file_path"),
                    data.get("file_size"),
                    data.get("file_hash"),
                    data.get("image_hash"),
                    data.get("modality"),
                    data.get("body_part"),
                    data.get("source_text"),
                    json.dumps(data.get("analysis", {}), ensure_ascii=False),
                    data.get("label_status", "unlabeled"),
                    1 if data.get("usable_for_training", True) else 0,
                ),
            )
            row = conn.execute("SELECT * FROM upload_records WHERE id = ?", (int(cursor.lastrowid),)).fetchone()
            return self._upload_record_from_row(row)

    def find_upload_by_file_hash(
        self,
        user_id: int,
        role: str,
        upload_type: str,
        patient_id: int | None,
        file_hash: str,
    ) -> dict | None:
        with self.connect() as conn:
            filters = ["upload_type = ?", "file_hash = ?"]
            params: list[Any] = [upload_type, file_hash]
            if patient_id is None:
                filters.append("patient_id IS NULL")
                if role != "admin":
                    filters.append("owner_user_id = ?")
                    params.append(user_id)
            else:
                filters.append("patient_id = ?")
                params.append(patient_id)
                if role not in {"admin", "clinician"}:
                    filters.append("owner_user_id = ?")
                    params.append(user_id)

            row = conn.execute(
                f"SELECT * FROM upload_records WHERE {' AND '.join(filters)} ORDER BY created_at DESC LIMIT 1",
                params,
            ).fetchone()
            return self._upload_record_from_row(row) if row else None

    def find_image_hash_candidates(
        self,
        user_id: int,
        role: str,
        patient_id: int | None,
    ) -> list[dict]:
        with self.connect() as conn:
            filters = ["upload_type = 'image'", "image_hash IS NOT NULL", "image_hash != ''"]
            params: list[Any] = []
            if patient_id is None:
                filters.append("patient_id IS NULL")
                if role != "admin":
                    filters.append("owner_user_id = ?")
                    params.append(user_id)
            else:
                filters.append("patient_id = ?")
                params.append(patient_id)
                if role not in {"admin", "clinician"}:
                    filters.append("owner_user_id = ?")
                    params.append(user_id)

            rows = conn.execute(
                f"SELECT * FROM upload_records WHERE {' AND '.join(filters)} ORDER BY created_at DESC",
                params,
            ).fetchall()
            return [self._upload_record_from_row(row) for row in rows]

    def list_upload_records(
        self,
        user_id: int,
        role: str,
        upload_type: str | None = None,
        patient_id: int | None = None,
    ) -> list[dict]:
        with self.connect() as conn:
            filters: list[str] = []
            params: list[Any] = []
            if role != "admin":
                filters.append("owner_user_id = ?")
                params.append(user_id)
            if upload_type:
                filters.append("upload_type = ?")
                params.append(upload_type)
            if patient_id is not None:
                filters.append("patient_id = ?")
                params.append(patient_id)

            where = f"WHERE {' AND '.join(filters)}" if filters else ""
            rows = conn.execute(
                f"SELECT * FROM upload_records {where} ORDER BY created_at DESC",
                params,
            ).fetchall()
            return [self._upload_record_from_row(row) for row in rows]

    def get_upload_record_by_id(self, record_id: int) -> dict | None:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM upload_records WHERE id = ?", (record_id,)).fetchone()
            return self._upload_record_from_row(row) if row else None

    def _upload_record_from_row(self, row: sqlite3.Row) -> dict:
        data = dict(row)
        data["analysis"] = json.loads(data.pop("analysis_json"))
        data["usable_for_training"] = bool(data["usable_for_training"])
        return data

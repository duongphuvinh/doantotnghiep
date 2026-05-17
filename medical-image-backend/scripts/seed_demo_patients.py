from __future__ import annotations

import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "medical_app.db"

import sys

sys.path.insert(0, str(ROOT))

from app.security import hash_password  # noqa: E402


DEMO_PATIENTS = [
    {
        "username": "bn001",
        "password": "Benhnhan@001",
        "full_name": "Nguyen Van An",
        "patient_code": "BN001",
        "age": 45,
        "gender": "male",
        "phone": "0900000001",
        "address": "TP. Ho Chi Minh",
    },
    {
        "username": "bn002",
        "password": "Benhnhan@002",
        "full_name": "Tran Thi Binh",
        "patient_code": "BN002",
        "age": 62,
        "gender": "female",
        "phone": "0900000002",
        "address": "Dong Nai",
    },
    {
        "username": "bn003",
        "password": "Benhnhan@003",
        "full_name": "Le Minh Chau",
        "patient_code": "BN003",
        "age": 29,
        "gender": "other",
        "phone": "0900000003",
        "address": "Binh Duong",
    },
]


def main() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")

        for item in DEMO_PATIENTS:
            user = conn.execute(
                "SELECT id FROM users WHERE username = ?",
                (item["username"],),
            ).fetchone()
            if user is None:
                cursor = conn.execute(
                    """
                    INSERT INTO users (username, password_hash, full_name, role)
                    VALUES (?, ?, ?, ?)
                    """,
                    (
                        item["username"],
                        hash_password(item["password"]),
                        item["full_name"],
                        "patient",
                    ),
                )
                user_id = int(cursor.lastrowid)
            else:
                user_id = int(user["id"])
                conn.execute(
                    """
                    UPDATE users
                    SET password_hash = ?, full_name = ?, role = ?
                    WHERE id = ?
                    """,
                    (hash_password(item["password"]), item["full_name"], "patient", user_id),
                )

            patient = conn.execute(
                "SELECT id FROM patients WHERE owner_user_id = ? AND patient_code = ?",
                (user_id, item["patient_code"]),
            ).fetchone()
            if patient is None:
                conn.execute(
                    """
                    INSERT INTO patients (
                        owner_user_id,
                        patient_code,
                        full_name,
                        age,
                        gender,
                        phone,
                        address
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        user_id,
                        item["patient_code"],
                        item["full_name"],
                        item["age"],
                        item["gender"],
                        item["phone"],
                        item["address"],
                    ),
                )
            else:
                conn.execute(
                    """
                    UPDATE patients
                    SET full_name = ?, age = ?, gender = ?, phone = ?, address = ?
                    WHERE id = ?
                    """,
                    (
                        item["full_name"],
                        item["age"],
                        item["gender"],
                        item["phone"],
                        item["address"],
                        int(patient["id"]),
                    ),
                )

    print("Demo patient accounts:")
    for item in DEMO_PATIENTS:
        print(f"- {item['patient_code']}: {item['username']} / {item['password']}")


if __name__ == "__main__":
    main()

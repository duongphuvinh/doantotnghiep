"use client";

import { getMedicalAuthToken } from "@/lib/medical-auth";

export type UploadDuplicateInfo = {
  exact: boolean;
  near: boolean;
  message?: string | null;
  matched_record?: {
    id: number;
    filename: string;
    created_at: string;
    patient_id?: number | null;
    upload_type: "image" | "lab" | string;
    distance?: number | null;
  } | null;
};

export type UploadHistoryItem = {
  id: number;
  upload_type: "image" | "lab";
  patient_id?: number | null;
  filename: string;
  content_type?: string | null;
  file_path?: string | null;
  file_size?: number | null;
  file_hash?: string | null;
  image_hash?: string | null;
  modality?: string | null;
  body_part?: string | null;
  source_text?: string | null;
  analysis: Record<string, unknown>;
  label_status: string;
  usable_for_training: boolean;
  created_at: string;
};

export type PatientOption = {
  id: number;
  patient_code: string;
  full_name: string;
  age: number;
  gender: "male" | "female" | "other" | "unknown";
  created_at: string;
};

export async function fetchUploadHistory(uploadType: "image" | "lab", patientId?: number | null) {
  const token = getMedicalAuthToken();
  if (!token) return [];
  const params = new URLSearchParams({ upload_type: uploadType });
  if (patientId) params.set("patient_id", String(patientId));
  const response = await fetch(`/api/uploads?${params.toString()}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) return [];
  return (await response.json()) as UploadHistoryItem[];
}

export async function fetchPatients() {
  const token = getMedicalAuthToken();
  if (!token) return [];
  const response = await fetch("/api/patients", {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) return [];
  return (await response.json()) as PatientOption[];
}

export function patientDisplayName(patient?: PatientOption | null) {
  if (!patient) return "Chưa gắn hồ sơ";
  return `${patient.patient_code} - ${patient.full_name}`;
}

export async function sha256File(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function uploadDuplicateKey(uploadType: "image" | "lab", patientId: number | null, fileHash: string) {
  return `${uploadType}:${patientId ?? "none"}:${fileHash}`;
}

export async function openUploadFile(item: UploadHistoryItem) {
  const token = getMedicalAuthToken();
  if (!token) throw new Error("Vui lòng đăng nhập để xem lại file đã upload");
  const response = await fetch(`/api/uploads/${item.id}/file`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.detail || "Không mở được file đã upload");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function formatUploadTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "không rõ thời điểm";
  return date.toLocaleString("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

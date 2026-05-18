"use client";

import { getMedicalAuthToken } from "@/lib/medical-auth";

export type UploadHistoryItem = {
  id: number;
  upload_type: "image" | "lab";
  filename: string;
  content_type?: string | null;
  file_path?: string | null;
  file_size?: number | null;
  modality?: string | null;
  body_part?: string | null;
  source_text?: string | null;
  analysis: Record<string, unknown>;
  label_status: string;
  usable_for_training: boolean;
  created_at: string;
};

export async function fetchUploadHistory(uploadType: "image" | "lab") {
  const token = getMedicalAuthToken();
  if (!token) return [];
  const response = await fetch(`/api/uploads?upload_type=${uploadType}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) return [];
  return (await response.json()) as UploadHistoryItem[];
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

"use client";

export type MedicalUser = {
  id: number;
  username: string;
  full_name?: string | null;
  role: "clinician" | "admin";
};

export type MedicalAuthSession = {
  access_token: string;
  token_type: "bearer";
  user: MedicalUser;
};

const TOKEN_KEY = "medical-auth-token";
const USER_KEY = "medical-auth-user";

export function getMedicalAuthToken() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function getMedicalAuthUser(): MedicalUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MedicalUser;
  } catch {
    return null;
  }
}

export function saveMedicalAuthSession(session: MedicalAuthSession) {
  localStorage.setItem(TOKEN_KEY, session.access_token);
  localStorage.setItem(USER_KEY, JSON.stringify(session.user));
  window.dispatchEvent(new Event("medical-auth-changed"));
}

export function clearMedicalAuthSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  window.dispatchEvent(new Event("medical-auth-changed"));
}


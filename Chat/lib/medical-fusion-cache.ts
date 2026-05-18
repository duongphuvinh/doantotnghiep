"use client";

import type { MedicalUser } from "@/lib/medical-auth";

const IMAGE_KEY_PREFIX = "medical-latest-image";
const LAB_KEY_PREFIX = "medical-latest-lab";
const CLINICAL_KEY_PREFIX = "medical-latest-clinical";
const DB_NAME = "medical-fusion-cache";
const DB_VERSION = 1;
const IMAGE_STORE = "latest-images";

type StoredImageMetadata = {
  fileName: string;
  fileType: string;
  modality: string;
  bodyPart?: string;
  result: unknown;
  savedAt: string;
};

export type LatestImageSnapshot = StoredImageMetadata & {
  file?: File;
};

export type LatestLabSnapshot = {
  rawText: string;
  age?: string;
  gender?: string;
  result: unknown;
  savedAt: string;
};

export type LatestClinicalSnapshot = {
  age: string;
  gender: string;
  symptoms: string;
  history: string;
  painScore: string;
  bodyPart: string;
  modality: string;
  savedAt: string;
};

function userKey(prefix: string, user: MedicalUser) {
  return `${prefix}:${user.id}`;
}

export function saveLatestLabSnapshot(user: MedicalUser | null, snapshot: Omit<LatestLabSnapshot, "savedAt">) {
  if (!user || typeof window === "undefined") return;
  localStorage.setItem(userKey(LAB_KEY_PREFIX, user), JSON.stringify({ ...snapshot, savedAt: new Date().toISOString() }));
}

export function loadLatestLabSnapshot(user: MedicalUser | null): LatestLabSnapshot | null {
  if (!user || typeof window === "undefined") return null;
  return readJson<LatestLabSnapshot>(userKey(LAB_KEY_PREFIX, user));
}

export function saveLatestClinicalSnapshot(user: MedicalUser | null, snapshot: Omit<LatestClinicalSnapshot, "savedAt">) {
  if (!user || typeof window === "undefined") return;
  localStorage.setItem(userKey(CLINICAL_KEY_PREFIX, user), JSON.stringify({ ...snapshot, savedAt: new Date().toISOString() }));
}

export function loadLatestClinicalSnapshot(user: MedicalUser | null): LatestClinicalSnapshot | null {
  if (!user || typeof window === "undefined") return null;
  return readJson<LatestClinicalSnapshot>(userKey(CLINICAL_KEY_PREFIX, user));
}

export async function saveLatestImageSnapshot(
  user: MedicalUser | null,
  file: File,
  metadata: Omit<StoredImageMetadata, "fileName" | "fileType" | "savedAt">
) {
  if (!user || typeof window === "undefined") return;
  const stored: StoredImageMetadata = {
    ...metadata,
    fileName: file.name,
    fileType: file.type || "application/octet-stream",
    savedAt: new Date().toISOString(),
  };
  localStorage.setItem(userKey(IMAGE_KEY_PREFIX, user), JSON.stringify(stored));
  const db = await openCacheDb();
  await putBlob(db, userKey(IMAGE_KEY_PREFIX, user), file);
}

export async function loadLatestImageSnapshot(user: MedicalUser | null): Promise<LatestImageSnapshot | null> {
  if (!user || typeof window === "undefined") return null;
  const metadata = readJson<StoredImageMetadata>(userKey(IMAGE_KEY_PREFIX, user));
  if (!metadata) return null;
  try {
    const db = await openCacheDb();
    const blob = await getBlob(db, userKey(IMAGE_KEY_PREFIX, user));
    return {
      ...metadata,
      file: blob ? new File([blob], metadata.fileName, { type: metadata.fileType }) : undefined,
    };
  } catch {
    return metadata;
  }
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function openCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(IMAGE_STORE)) {
        db.createObjectStore(IMAGE_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function putBlob(db: IDBDatabase, key: string, blob: Blob): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_STORE, "readwrite");
    tx.objectStore(IMAGE_STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function getBlob(db: IDBDatabase, key: string): Promise<Blob | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMAGE_STORE, "readonly");
    const request = tx.objectStore(IMAGE_STORE).get(key);
    request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

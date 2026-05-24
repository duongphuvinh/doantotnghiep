import { existsSync, readFileSync } from "fs";
import path from "path";
import { inflateRawSync } from "zlib";

type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
};

export type MedicalRecordRow = {
  id: string;
  patientId: string;
  patientCode: string;
  patientName: string;
  visitDate: string;
  treatmentDate: string;
  diagnosis: string;
  treatmentResult: string;
};

let cachedRows: MedicalRecordRow[] | null = null;

export function findMedicalRecordRows(patient: { patient_code?: string; full_name?: string }, question = "") {
  const rows = loadMedicalRecordRows();
  const patientCode = normalizeText(patient.patient_code || "");
  const patientName = normalizeText(patient.full_name || "");
  const query = normalizeText(question);

  const nameMatches = rows.filter((row) => {
    const rowName = normalizeText(row.patientName);
    return Boolean(
      patientName && (rowName === patientName || rowName.includes(patientName) || patientName.includes(rowName))
    );
  });

  const queryNameMatches = rows.filter((row) => {
    const rowName = normalizeText(row.patientName);
    return Boolean(rowName && query.includes(rowName));
  });

  const exactMatches = uniqueRows([...nameMatches, ...queryNameMatches]);
  const codeMatches = rows.filter((row) => normalizeText(row.patientCode) === patientCode);
  const codeOnlyMatches = codeMatches.filter(
    (row) => !exactMatches.some((match) => match.id === row.id)
  );

  return {
    exactMatches,
    codeOnlyMatches,
    hasIdentityConflict: exactMatches.length === 0 && codeOnlyMatches.some((row) => {
      const rowName = normalizeText(row.patientName);
      return Boolean(patientName && rowName && rowName !== patientName);
    }),
  };
}

function loadMedicalRecordRows() {
  if (cachedRows) return cachedRows;
  const workbookPath = [
    path.resolve(process.cwd(), "tool", "tblMedicalRecord_200rows.xlsx"),
    path.resolve(process.cwd(), "..", "tool", "tblMedicalRecord_200rows.xlsx"),
  ].find((candidate) => existsSync(candidate));
  if (!workbookPath) {
    cachedRows = [];
    return cachedRows;
  }

  const files = unzipXlsx(readFileSync(workbookPath));
  const sharedStrings = parseSharedStrings(files.get("xl/sharedStrings.xml")?.toString("utf8") || "");
  const sheet = files.get("xl/worksheets/sheet1.xml")?.toString("utf8") || "";
  const table = parseSheet(sheet, sharedStrings);
  const [headers, ...dataRows] = table;
  const headerMap = new Map(headers.map((header, index) => [header, index]));

  cachedRows = dataRows
    .map((row) => ({
      id: row[headerMap.get("Id") ?? -1] || "",
      patientId: row[headerMap.get("IdNguoiBenh") ?? -1] || "",
      patientCode: row[headerMap.get("MaNguoiBenh") ?? -1] || "",
      patientName: row[headerMap.get("HoTenNguoiBenh") ?? -1] || "",
      visitDate: formatExcelDate(row[headerMap.get("NgayKham") ?? -1]),
      treatmentDate: formatExcelDate(row[headerMap.get("NgayDieuTri") ?? -1]),
      diagnosis: row[headerMap.get("ChanDoanBenh") ?? -1] || "",
      treatmentResult: row[headerMap.get("KetQuaDieuTri") ?? -1] || "",
    }))
    .filter((row) => row.patientCode || row.patientName || row.diagnosis);
  return cachedRows;
}

function uniqueRows(rows: MedicalRecordRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.id || `${row.patientCode}:${row.patientName}:${row.visitDate}:${row.diagnosis}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function unzipXlsx(buffer: Buffer) {
  const entries = readZipEntries(buffer);
  const files = new Map<string, Buffer>();
  for (const entry of entries) {
    const localOffset = entry.localHeaderOffset;
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) continue;
    const nameLength = buffer.readUInt16LE(localOffset + 26);
    const extraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + nameLength + extraLength;
    const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
    if (entry.method === 0) files.set(entry.name, compressed);
    if (entry.method === 8) files.set(entry.name, inflateRawSync(compressed));
  }
  return files;
}

function readZipEntries(buffer: Buffer): ZipEntry[] {
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= 0; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) return [];

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < entryCount; index++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    entries.push({ name, method, compressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function parseSharedStrings(xml: string) {
  return Array.from(xml.matchAll(/<si>([\s\S]*?)<\/si>/g)).map((match) =>
    Array.from(match[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g))
      .map((part) => decodeXml(part[1]))
      .join("")
  );
}

function parseSheet(xml: string, sharedStrings: string[]) {
  return Array.from(xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)).map((rowMatch) => {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = attrs.match(/r="([A-Z]+)\d+"/)?.[1] || "";
      const index = columnToIndex(ref);
      const rawValue = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] || "";
      const value = attrs.includes('t="s"') ? sharedStrings[Number(rawValue)] || "" : decodeXml(rawValue);
      cells[index] = value;
    }
    return cells.map((cell) => cell || "");
  });
}

function columnToIndex(column: string) {
  return column.split("").reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function formatExcelDate(value: string) {
  const serial = Number(value);
  if (!Number.isFinite(serial)) return value || "không rõ";
  const date = new Date(Date.UTC(1899, 11, 30 + serial));
  return date.toLocaleDateString("vi-VN");
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, (char) => char === "Đ" ? "D" : "d")
    .toLowerCase()
    .trim();
}

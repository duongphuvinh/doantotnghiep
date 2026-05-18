import { existsSync, readFileSync } from "fs";
import path from "path";
import { inflateRawSync } from "zlib";

type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
};

export type HealthNewsMatch = {
  title: string;
  category: string;
  content: string;
  score: number;
};

let cachedRows: HealthNewsMatch[] | null = null;

const MEDICAL_TOPICS = [
  {
    id: "gout",
    aliases: ["gout", "gut", "thong phong", "thong phuong", "acid uric", "axit uric", "urat"],
  },
  {
    id: "cervical_spondylosis",
    aliases: ["thoai hoa cot song co", "thoai hoa dot song co", "cot song co", "dot song co"],
  },
  {
    id: "diabetes",
    aliases: ["tieu duong", "dai thao duong", "diabetes", "duong huyet", "glucose"],
  },
  {
    id: "influenza",
    aliases: ["cum mua", "influenza"],
  },
  {
    id: "dengue",
    aliases: ["sot xuat huyet", "dengue"],
  },
  {
    id: "hepatitis_b",
    aliases: ["viem gan b", "hepatitis b"],
  },
  {
    id: "heart_failure",
    aliases: ["suy tim", "heart failure"],
  },
  {
    id: "pregnancy",
    aliases: ["mang thai", "co thai", "thai ky", "thai nghen", "pregnancy", "pregnant"],
  },
];

export function searchHealthNews(query: string, limit = 3): HealthNewsMatch[] {
  const rows = loadHealthNewsRows();
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return [];
  const topic = detectMedicalTopic(query);
  const queryPhrase = normalizeText(query)
    .split(/[^a-z0-9]+/i)
    .filter((token) => token && !QUERY_STOP_WORDS.has(token))
    .join(" ");
  const queryBigrams = makeBigrams(queryTokens);
  const minScore = topic ? 2 : Math.max(3, Math.ceil(queryTokens.length * 0.75));

  return rows
    .map((row) => {
      const title = normalizeText(row.title);
      const category = normalizeText(row.category);
      const content = normalizeText(row.content);
      const haystack = `${title} ${category} ${content}`;
      if (topic && !topicMatches(haystack, topic.id)) return { ...row, score: 0 };
      const tokenScore = queryTokens.reduce((total, token) => {
        if (!haystack.includes(token)) return total;
        return total + (title.includes(token) ? 2 : 1);
      }, 0);
      const topicScore = topic ? 10 : 0;
      const phraseScore = queryPhrase && haystack.includes(queryPhrase) ? queryTokens.length * 3 : 0;
      const bigramScore = queryBigrams.reduce((total, phrase) => total + (haystack.includes(phrase) ? 2 : 0), 0);
      const score = tokenScore + phraseScore + bigramScore + topicScore;
      return { ...row, score };
    })
    .filter((row) => row.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export function formatHealthNewsAnswer(matches: HealthNewsMatch[]) {
  return [
    "Tôi tìm thấy thông tin trong dữ liệu nội bộ `tbNews_200rows.xlsx`:",
    "",
    ...matches.map((match, index) =>
      [
        `${index + 1}. ${match.title}`,
        match.category ? `Nhóm/chủ đề: ${match.category}` : "",
        trimText(match.content, 1100),
      ].filter(Boolean).join("\n")
    ),
    "",
    "Thông tin này chỉ mang tính tham khảo. Nếu có triệu chứng hoặc bệnh nền, nên trao đổi với bác sĩ để được đánh giá trực tiếp.",
  ].join("\n\n");
}

function loadHealthNewsRows() {
  if (cachedRows) return cachedRows;
  const workbookPath = [
    path.resolve(process.cwd(), "tool", "tbNews_200rows.xlsx"),
    path.resolve(process.cwd(), "..", "tool", "tbNews_200rows.xlsx"),
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
  const normalizedHeaders = headers.map((header) => normalizeText(header));
  const titleIndex = findHeader(normalizedHeaders, ["title", "tieu de", "name"]);
  const categoryIndex = findHeader(normalizedHeaders, ["category", "chu de", "nhom", "type"]);
  const contentIndex = findHeader(normalizedHeaders, ["content", "noi dung", "description", "mo ta"]);

  cachedRows = dataRows
    .map((row) => ({
      title: row[titleIndex] || row[1] || "",
      category: row[categoryIndex] || "",
      content: row[contentIndex] || row[row.length - 1] || "",
      score: 0,
    }))
    .filter((row) => row.title || row.content);
  return cachedRows;
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

function findHeader(headers: string[], candidates: string[]) {
  const found = headers.findIndex((header) => candidates.some((candidate) => header.includes(candidate)));
  return found >= 0 ? found : -1;
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

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

const QUERY_STOP_WORDS = new Set([
  "tim",
  "thong",
  "tin",
  "ve",
  "benh",
  "benh ly",
  "la",
  "gi",
  "cho",
  "toi",
  "trieu",
  "chung",
  "dau",
  "hieu",
  "bieu",
  "hien",
]);

function tokenize(value: string) {
  return normalizeText(value)
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 3 && !QUERY_STOP_WORDS.has(token));
}

function makeBigrams(tokens: string[]) {
  return tokens.slice(0, -1).map((token, index) => `${token} ${tokens[index + 1]}`);
}

function detectMedicalTopic(value: string) {
  const normalized = normalizeText(value);
  return MEDICAL_TOPICS.find((topic) => topic.aliases.some((alias) => normalized.includes(alias)));
}

function topicMatches(haystack: string, topicId: string) {
  const topic = MEDICAL_TOPICS.find((item) => item.id === topicId);
  return Boolean(topic?.aliases.some((alias) => haystack.includes(alias)));
}

function trimText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength).trim()}...` : value;
}

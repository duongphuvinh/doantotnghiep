type LabStatus = "low" | "normal" | "high" | "positive" | "negative" | "abnormal" | "unknown";
type LabSeverity = "info" | "watch" | "attention" | "urgent";

type LabItem = {
  category: "blood" | "urine";
  code: string;
  name: string;
  input_name: string;
  value: string | number | boolean;
  unit?: string | null;
  reference_range: string;
  status: LabStatus;
  severity: LabSeverity;
  interpretation: string;
};

type LabAnalyzeResponseLike = {
  items?: LabItem[];
  summary?: string;
  abnormal_count?: number;
  urgent_count?: number;
  recommended_next_steps?: string[];
  safety_note?: string;
  [key: string]: unknown;
};

const KNOWN_NUMERIC_REFS = [
  { code: "WBC", name: "Bạch cầu", aliases: ["wbc", "bc", "bach cau"], unit: "10^9/L", low: 4, high: 10 },
  { code: "RBC", name: "Hồng cầu", aliases: ["rbc", "hc", "hong cau"], unit: "10^12/L", low: 3.8, high: 5.8 },
  { code: "HGB", name: "Hemoglobin", aliases: ["hgb", "hb", "hemoglobin", "huyet sac to"], unit: "g/dL", low: 12, high: 17.5 },
  { code: "HCT", name: "Hematocrit", aliases: ["hct", "hematocrit"], unit: "%", low: 36, high: 52 },
  { code: "PLT", name: "Tiểu cầu", aliases: ["plt", "tc", "tieu cau"], unit: "10^9/L", low: 150, high: 450 },
  { code: "GLU", name: "Glucose máu", aliases: ["glu", "glucose", "duong huyet", "duong mau"], unit: "mmol/L", low: 3.9, high: 5.6 },
  { code: "CRE", name: "Creatinine", aliases: ["cre", "crea", "creatinine", "creatinin"], unit: "umol/L", low: 45, high: 110 },
  { code: "UREA", name: "Ure", aliases: ["ure", "urea", "bun"], unit: "mmol/L", low: 2.5, high: 7.5 },
  { code: "ALT", name: "ALT/GPT", aliases: ["alt", "gpt", "sgpt"], unit: "U/L", high: 40 },
  { code: "AST", name: "AST/GOT", aliases: ["ast", "got", "sgot"], unit: "U/L", high: 40 },
  { code: "ALB", name: "Albumin", aliases: ["alb", "albumin"], unit: "g/L", low: 35, high: 50 },
  { code: "ALP", name: "Phosphatase kiềm", aliases: ["alp", "phosphatase kiem"], unit: "U/L", high: 120 },
  { code: "CA", name: "Calci", aliases: ["ca", "calci", "calcium"], unit: "mmol/L", low: 2.15, high: 2.55 },
  { code: "CHOL", name: "Cholesterol toàn phần", aliases: ["chol", "cholesterol"], unit: "mmol/L", high: 5.2 },
  { code: "CK", name: "Creatine kinase", aliases: ["ck", "cpk", "creatine kinase"], unit: "U/L", high: 200 },
  { code: "CL", name: "Chloride", aliases: ["cl", "chloride", "clorua"], unit: "mmol/L", low: 98, high: 107 },
  { code: "GGT", name: "GGT", aliases: ["ggt", "gamma gt"], unit: "U/L", high: 55 },
  { code: "IRON", name: "Sắt huyết thanh", aliases: ["fe", "iron", "sat", "sat huyet thanh"], unit: "umol/L", low: 10, high: 30 },
  { code: "K", name: "Kali", aliases: ["k", "kali", "potassium"], unit: "mmol/L", low: 3.5, high: 5.1 },
  { code: "LDH", name: "LDH", aliases: ["ldh", "lactate dehydrogenase"], unit: "U/L", high: 250 },
  { code: "NA", name: "Natri", aliases: ["na", "natri", "sodium"], unit: "mmol/L", low: 135, high: 145 },
  { code: "PHOS", name: "Phospho", aliases: ["phos", "phosphate", "phospho"], unit: "mmol/L", low: 0.8, high: 1.45 },
  { code: "TBIL", name: "Bilirubin toàn phần", aliases: ["tbil", "bilirubin"], unit: "umol/L", high: 21 },
  { code: "TP", name: "Protein toàn phần", aliases: ["tp", "total protein", "protein toan phan"], unit: "g/L", low: 64, high: 83 },
  { code: "TG", name: "Triglycerid", aliases: ["tg", "triglycerid", "triglyceride"], unit: "mmol/L", high: 1.7 },
  { code: "HDL", name: "HDL-C", aliases: ["hdl", "hdl c", "hdl-c"], unit: "mmol/L", low: 1 },
  { code: "LDL", name: "LDL-C", aliases: ["ldl", "ldl c", "ldl-c"], unit: "mmol/L", high: 3.4 },
  { code: "UA", name: "Acid uric", aliases: ["ua", "uric acid", "acid uric", "axit uric"], unit: "umol/L", low: 150, high: 420 },
] as const;

export function normalizeLabAnalyzeResponse(payload: unknown) {
  if (!payload || typeof payload !== "object" || !Array.isArray((payload as LabAnalyzeResponseLike).items)) {
    return payload;
  }

  const response = payload as LabAnalyzeResponseLike;
  const sourceItems = response.items as LabItem[];
  const items = sourceItems
    .map(normalizeUnknownLabItem)
    .filter((item): item is LabItem => item !== null && item.status !== "unknown" && item.code !== "UNKNOWN");
  const dedupedItems = dedupeLabItems(items);
  const abnormalCount = dedupedItems.filter((item) => ["low", "high", "positive", "abnormal"].includes(item.status)).length;
  const urgentCount = dedupedItems.filter((item) => item.severity === "urgent").length;

  return {
    ...response,
    items: dedupedItems,
    abnormal_count: abnormalCount,
    urgent_count: urgentCount,
    summary: buildSummary(items.length, abnormalCount, urgentCount),
  };
}

function dedupeLabItems(items: LabItem[]) {
  const byCode = new Map<string, LabItem>();
  for (const item of items) {
    const current = byCode.get(item.code);
    if (!current || scoreLabItem(item) > scoreLabItem(current)) {
      byCode.set(item.code, item);
    }
  }
  return Array.from(byCode.values());
}

function scoreLabItem(item: LabItem) {
  const severityScore = item.severity === "urgent" ? 300 : item.severity === "attention" ? 200 : item.severity === "watch" ? 100 : 0;
  const statusScore = ["low", "high", "positive", "abnormal"].includes(item.status) ? 10 : 0;
  const valueScore = toNumber(item.value) !== null ? 1 : 0;
  return severityScore + statusScore + valueScore;
}

function normalizeUnknownLabItem(item: LabItem): LabItem | null {
  if (item.code !== "UNKNOWN" && item.status !== "unknown") return item;

  const normalizedName = normalizeText(item.input_name || item.name);
  const ref = KNOWN_NUMERIC_REFS.find((candidate) => candidate.aliases.some((alias) => matchesAlias(normalizedName, alias)));
  if (ref) {
    let value = toNumber(item.value);
    if (value === null) return null;
    if (ref.code === "HGB" && normalizeText(item.unit || "") === "g/l") value = Number((value / 10).toFixed(3));
    if (ref.code === "GLU" && normalizeText(item.unit || "") === "mg/dl") value = Number((value / 18.0182).toFixed(3));
    if (ref.code === "CRE" && normalizeText(item.unit || "") === "mg/dl") value = Number((value * 88.4).toFixed(3));
    if (ref.code === "UREA" && normalizeText(item.unit || "") === "mg/dl") value = Number((value * 0.357).toFixed(3));

    const low = "low" in ref ? ref.low : undefined;
    const high = "high" in ref ? ref.high : undefined;
    const status: LabStatus =
      low !== undefined && value < low ? "low" : high !== undefined && value > high ? "high" : "normal";
    return {
      ...item,
      category: "blood",
      code: ref.code,
      name: ref.name,
      value,
      unit: ref.unit,
      reference_range:
        low !== undefined && high !== undefined
          ? `${low} - ${high} ${ref.unit}`
          : high !== undefined
            ? `<= ${high} ${ref.unit}`
            : low !== undefined
              ? `>= ${low} ${ref.unit}`
              : `Tham khảo theo phòng xét nghiệm`,
      status,
      severity: status === "normal" ? "info" : "attention",
      interpretation:
        status === "high"
          ? `${ref.name} cao hơn khoảng tham khảo đang dùng.`
          : status === "low"
            ? `${ref.name} thấp hơn khoảng tham khảo đang dùng.`
            : "Nằm trong khoảng tham khảo cơ bản.",
    };
  }

  return null;
}

function matchesAlias(normalizedName: string, alias: string) {
  const normalizedAlias = normalizeText(alias);
  if (normalizedName === normalizedAlias) return true;
  if (normalizedAlias.length <= 3) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedAlias)}([^a-z0-9]|$)`).test(normalizedName);
  }
  return normalizedName.includes(normalizedAlias);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildSummary(itemCount: number, abnormalCount: number, urgentCount: number) {
  if (itemCount === 0) return "Chưa nhận diện được chỉ số xét nghiệm phù hợp để đọc kết quả.";
  if (urgentCount > 0) return "Có chỉ số lệch nhiều hoặc có khả năng cần đánh giá y tế sớm.";
  if (abnormalCount > 0) return "Có một số chỉ số bất thường, nên đối chiếu với triệu chứng và bác sĩ.";
  return "Các chỉ số đã nhập nằm trong khoảng tham khảo cơ bản hoặc âm tính.";
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function toNumber(value: string | number | boolean) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

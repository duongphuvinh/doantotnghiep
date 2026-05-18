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
  body_system?: string | null;
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
  { code: "CRE", name: "Creatinine", aliases: ["cre", "crea", "creat", "creatinine", "creatinin", "cretinine", "creatinine mau", "creatinin mau"], unit: "umol/L", low: 45, high: 110, bodySystem: "Chức năng thận" },
  { code: "UREA", name: "Ure", aliases: ["ure", "urea", "bun"], unit: "mmol/L", low: 2.5, high: 7.5 },
  { code: "ALT", name: "ALT/GPT", aliases: ["alt", "gpt", "sgpt", "alat", "alat/gpt"], unit: "U/L", high: 40, bodySystem: "Men gan" },
  { code: "AST", name: "AST/GOT", aliases: ["ast", "got", "sgot", "asat", "asat/got"], unit: "U/L", high: 40, bodySystem: "Men gan, cơ và tim" },
  { code: "ALB", name: "Albumin", aliases: ["alb", "albumin"], unit: "g/L", low: 35, high: 50 },
  { code: "ALP", name: "Phosphatase kiềm", aliases: ["alp", "phosphatase kiem"], unit: "U/L", high: 120 },
  { code: "CA", name: "Calci", aliases: ["ca", "calci", "calcium"], unit: "mmol/L", low: 2.15, high: 2.55 },
  { code: "CHOL", name: "Cholesterol toàn phần", aliases: ["chol", "cho", "cholesterol", "choloesterol", "cholesterol tp", "cholesterol toan phan", "total cholesterol"], unit: "mmol/L", high: 5.2, bodySystem: "Mỡ máu và nguy cơ tim mạch" },
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
  { code: "TG", name: "Triglycerid", aliases: ["tg", "trig", "trigly", "triglycerid", "triglyceride", "triglycerides"], unit: "mmol/L", high: 1.7, bodySystem: "Mỡ máu và chuyển hóa đường-mỡ" },
  { code: "HDL", name: "HDL-C", aliases: ["hdl", "hdl c", "hdl-c", "hdl cholesterol", "cholesterol hdl"], unit: "mmol/L", low: 1, bodySystem: "Mỡ máu bảo vệ tim mạch" },
  { code: "NONHDL", name: "Non-HDL Cholesterol", aliases: ["non hdl", "non-hdl", "non hdl cholesterol", "non-hdl cholesterol", "non hdl-c", "non-hdl-c"], unit: "mmol/L", high: 4.1, bodySystem: "Mỡ máu gây xơ vữa và nguy cơ tim mạch" },
  { code: "LDL", name: "LDL-C", aliases: ["ldl", "ldl c", "ldl-c", "ldl cholesterol", "cholesterol ldl"], unit: "mmol/L", high: 3.4, bodySystem: "Mỡ máu và nguy cơ xơ vữa" },
  { code: "UA", name: "Acid uric", aliases: ["ua", "uric acid", "acid uric", "axit uric", "dinh luong acid uric"], unit: "umol/L", low: 150, high: 420, bodySystem: "Acid uric, gout và chức năng thận" },
  { code: "MCV", name: "MCV", aliases: ["mcv", "mean corpuscular volume"], unit: "fL", low: 80, high: 100 },
  { code: "MCH", name: "MCH", aliases: ["mch", "mean corpuscular hemoglobin"], unit: "pg", low: 27, high: 32 },
  { code: "MCHC", name: "MCHC", aliases: ["mchc", "mean corpuscular hemoglobin concentration"], unit: "g/dL", low: 32, high: 36 },
  { code: "RDW", name: "RDW", aliases: ["rdw", "rdw-cv", "red cell distribution width"], unit: "%", low: 11.5, high: 14.5 },
  { code: "MPV", name: "MPV", aliases: ["mpv", "mean platelet volume"], unit: "fL", low: 7.5, high: 12 },
  { code: "PDW", name: "PDW", aliases: ["pdw", "platelet distribution width"], unit: "%", low: 9, high: 17 },
  { code: "PCT", name: "PCT tiểu cầu", aliases: ["pct", "plateletcrit"], unit: "%", low: 0.1, high: 0.5 },
  { code: "HBA1C", name: "HbA1c", aliases: ["hba1c", "hb a1c", "a1c", "hemoglobin a1c"], unit: "%", high: 5.7, bodySystem: "Kiểm soát đường huyết dài hạn" },
  { code: "DBIL", name: "Bilirubin trực tiếp", aliases: ["dbil", "direct bilirubin", "bilirubin truc tiep"], unit: "umol/L", high: 5 },
  { code: "IBIL", name: "Bilirubin gián tiếp", aliases: ["ibil", "indirect bilirubin", "bilirubin gian tiep"], unit: "umol/L", high: 16 },
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
  const ref = findBestKnownNumericRef(normalizedName);
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
      body_system: "bodySystem" in ref ? ref.bodySystem : item.body_system,
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

function findBestKnownNumericRef(normalizedName: string) {
  let best: { ref: (typeof KNOWN_NUMERIC_REFS)[number]; score: number } | null = null;
  for (const ref of KNOWN_NUMERIC_REFS) {
    const score = Math.max(
      aliasMatchScore(normalizedName, ref.code),
      ...ref.aliases.map((alias) => aliasMatchScore(normalizedName, alias))
    );
    if (score > 0 && (!best || score > best.score)) {
      best = { ref, score };
    }
  }
  return best?.ref;
}

function matchesAlias(normalizedName: string, alias: string) {
  return aliasMatchScore(normalizedName, alias) > 0;
}

function aliasMatchScore(normalizedName: string, alias: string) {
  const normalizedAlias = normalizeText(alias);
  if (normalizedName === normalizedAlias) return 1000 + normalizedAlias.length;
  if (normalizedAlias.length <= 3) {
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalizedAlias)}([^a-z0-9]|$)`).test(normalizedName)
      ? 100 + normalizedAlias.length
      : 0;
  }
  return normalizedName.includes(normalizedAlias) ? 100 + normalizedAlias.length : 0;
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

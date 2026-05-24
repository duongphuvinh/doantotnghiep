"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Beaker,
  CheckCircle2,
  ClipboardCheck,
  FlaskConical,
  Loader2,
  Plus,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { normalizeLabAnalyzeResponse } from "@/lib/lab-result-normalizer";
import { getMedicalAuthToken, getMedicalAuthUser, type MedicalUser } from "@/lib/medical-auth";
import { saveLatestLabSnapshot } from "@/lib/medical-fusion-cache";
import {
  fetchPatients,
  fetchUploadHistory,
  formatUploadTime,
  openUploadFile,
  patientDisplayName,
  sha256File,
  uploadDuplicateKey,
  type PatientOption,
  type UploadDuplicateInfo,
  type UploadHistoryItem,
} from "@/lib/upload-history";
import { cn } from "@/lib/utils";

type Gender = "male" | "female" | "other" | "unknown";
type LabCategory = "blood" | "urine";

type LabInputRow = {
  id: string;
  category: LabCategory;
  name: string;
  value: string;
  unit: string;
};

type LabAnalyzeResponse = {
  items: Array<{
    category: LabCategory;
    code: string;
    name: string;
    input_name: string;
    value: string | number | boolean;
    unit?: string | null;
    reference_range: string;
    status: "low" | "normal" | "high" | "positive" | "negative" | "abnormal" | "unknown";
    severity: "info" | "watch" | "attention" | "urgent";
    interpretation: string;
    body_system?: string | null;
  }>;
  summary: string;
  abnormal_count: number;
  urgent_count: number;
  recommended_next_steps: string[];
  safety_note: string;
  raw_text_preview?: string | null;
  unrecognized_lines?: string[];
  file_hash?: string | null;
  duplicate?: UploadDuplicateInfo | null;
};

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { detail: text };
  }
}

const commonBlood = [
  ["WBC", "10^9/L"],
  ["RBC", "10^12/L"],
  ["HGB", "g/dL"],
  ["HCT", "%"],
  ["PLT", "10^9/L"],
  ["Glucose", "mmol/L"],
  ["Creatinine", "umol/L"],
  ["Urea", "mmol/L"],
  ["ALT", "U/L"],
  ["AST", "U/L"],
  ["CRP", "mg/L"],
];

const commonUrine = [
  ["Protein", ""],
  ["Glucose niệu", ""],
  ["Ketone", ""],
  ["Blood", ""],
  ["Leukocyte", ""],
  ["Nitrite", ""],
  ["pH", ""],
  ["SG", ""],
];

export function LabResultsReader() {
  const router = useRouter();
  const [medicalUser, setMedicalUser] = useState<MedicalUser | null>(null);
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>("none");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<Gender>("unknown");
  const [rawText, setRawText] = useState("");
  const [labFile, setLabFile] = useState<File | null>(null);
  const [history, setHistory] = useState<UploadHistoryItem[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<number | null>(null);
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [sessionUploadHashes, setSessionUploadHashes] = useState<Set<string>>(() => new Set());
  const [rows, setRows] = useState<LabInputRow[]>([
    { id: crypto.randomUUID(), category: "blood", name: "WBC", value: "", unit: "10^9/L" },
    { id: crypto.randomUUID(), category: "blood", name: "HGB", value: "", unit: "g/dL" },
    { id: crypto.randomUUID(), category: "urine", name: "Protein", value: "", unit: "" },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<LabAnalyzeResponse | null>(null);

  useEffect(() => {
    const refreshUser = () => setMedicalUser(getMedicalAuthUser());
    refreshUser();
    window.addEventListener("medical-auth-changed", refreshUser);
    return () => window.removeEventListener("medical-auth-changed", refreshUser);
  }, []);

  useEffect(() => {
    if (!medicalUser) {
      setHistory([]);
      setPatients([]);
      setSelectedPatientId("none");
      return;
    }
    fetchPatients().then(setPatients);
  }, [medicalUser]);

  useEffect(() => {
    if (!medicalUser) return;
    const patientId = selectedPatientId === "none" ? null : Number(selectedPatientId);
    fetchUploadHistory("lab", patientId).then(setHistory);
  }, [medicalUser, selectedPatientId]);

  const abnormalItems = useMemo(
    () => result?.items.filter((item) => ["low", "high", "positive", "abnormal"].includes(item.status)) ?? [],
    [result]
  );
  const conclusion = useMemo(() => (result ? buildLabConclusion(result) : null), [result]);
  const selectedHistory = useMemo(
    () => history.find((item) => item.id === selectedHistoryId) ?? null,
    [history, selectedHistoryId]
  );
  const compareItems = useMemo(
    () =>
      (compareIds.map((id) => history.find((item) => item.id === id)).filter(Boolean) as UploadHistoryItem[]).sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      ),
    [compareIds, history]
  );
  const comparisonRows = useMemo(() => buildLabComparison(compareItems[0], compareItems[1]), [compareItems]);

  const addRow = (category: LabCategory) => {
    const [name, unit] = category === "blood" ? commonBlood[0] : commonUrine[0];
    setRows((current) => [...current, { id: crypto.randomUUID(), category, name, value: "", unit }]);
  };

  const updateRow = (id: string, patch: Partial<LabInputRow>) => {
    setRows((current) =>
      current.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, ...patch };
        if (patch.name) {
          const source = next.category === "blood" ? commonBlood : commonUrine;
          const found = source.find(([name]) => name === patch.name);
          if (found) next.unit = found[1];
        }
        return next;
      })
    );
  };

  const removeRow = (id: string) => {
    setRows((current) => current.filter((row) => row.id !== id));
  };

  const toggleCompare = (id: number) => {
    setCompareIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      return [...current.slice(-1), id];
    });
  };

  const handleOpenUploadedLabFile = async (item: UploadHistoryItem) => {
    try {
      await openUploadFile(item);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không mở được phiếu xét nghiệm đã upload");
    }
  };

  const analyze = async () => {
    const token = getMedicalAuthToken();
    if (!token) {
      toast.error("Vui lòng đăng nhập trước khi đọc kết quả xét nghiệm");
      router.push("/medical-login");
      return;
    }

    const values = rows
      .filter((row) => row.name.trim() && row.value.trim())
      .map((row) => ({
        name: row.name.trim(),
        value: coerceValue(row.value.trim()),
        unit: row.unit.trim() || undefined,
        category: row.category,
      }));

    if (values.length === 0 && !rawText.trim()) {
      toast.error("Vui lòng nhập ít nhất một chỉ số hoặc dán nội dung phiếu xét nghiệm");
      return;
    }

    setIsLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/labs/analyze", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          patient_id: selectedPatientId === "none" ? undefined : Number(selectedPatientId),
          age: age ? Number(age) : undefined,
          gender,
          values,
          raw_text: rawText.trim() || undefined,
        }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(data?.detail || "Không đọc được kết quả xét nghiệm");
      }
      const normalized = normalizeLabAnalyzeResponse(data) as LabAnalyzeResponse;
      setResult(normalized);
      const manualText = values
        .map((item) => `${item.name} ${String(item.value)}${item.unit ? ` ${item.unit}` : ""}`)
        .join("\n");
      saveLatestLabSnapshot(medicalUser, {
        rawText: rawText.trim() || manualText,
        age,
        gender,
        result: normalized,
      });
      const patientId = selectedPatientId === "none" ? null : Number(selectedPatientId);
      fetchUploadHistory("lab", patientId).then(setHistory);
      if (normalized.duplicate?.exact) {
        toast.info(normalized.duplicate.message || "Phiếu xét nghiệm này đã được lưu trước đó.");
      } else {
        toast.success("Đã đọc kết quả xét nghiệm");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Có lỗi khi đọc xét nghiệm");
    } finally {
      setIsLoading(false);
    }
  };

  const analyzeFile = async () => {
    const token = getMedicalAuthToken();
    if (!token) {
      toast.error("Vui lòng đăng nhập trước khi upload phiếu xét nghiệm");
      router.push("/medical-login");
      return;
    }
    if (!labFile) {
      toast.error("Vui lòng chọn file phiếu xét nghiệm");
      return;
    }

    const lowerName = labFile.name.toLowerCase();
    const isSupported = [".txt", ".csv", ".pdf", ".xlsx", ".xlsm"].some((ext) => lowerName.endsWith(ext));
    if (!isSupported) {
      toast.error("Chỉ hỗ trợ TXT, CSV, PDF, XLSX/XLSM");
      return;
    }
    if (labFile.size > 25 * 1024 * 1024) {
      toast.error("File tối đa 25MB");
      return;
    }

    const patientId = selectedPatientId === "none" ? null : Number(selectedPatientId);
    const fileHash = await sha256File(labFile);
    const duplicateKey = uploadDuplicateKey("lab", patientId, fileHash);
    const existingRecord = history.find((item) => item.file_hash === fileHash);
    if (sessionUploadHashes.has(duplicateKey) || existingRecord) {
      toast.info(
        existingRecord
          ? `File xét nghiệm này đã được upload trước đó: ${existingRecord.filename} (${formatUploadTime(existingRecord.created_at)}).`
          : "File xét nghiệm này vừa được upload trong phiên hiện tại, hệ thống không tạo thêm bản ghi mới."
      );
      return;
    }

    const formData = new FormData();
    formData.append("file", labFile);
    if (age) formData.append("age", age);
    formData.append("gender", gender);
    if (selectedPatientId !== "none") formData.append("patient_id", selectedPatientId);

    setIsLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/labs/analyze-file", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(data?.detail || "Không đọc được file xét nghiệm");
      }
      const normalized = normalizeLabAnalyzeResponse(data) as LabAnalyzeResponse;
      setResult(normalized);
      saveLatestLabSnapshot(medicalUser, {
        rawText: normalized.raw_text_preview || "",
        age,
        gender,
        result: normalized,
      });
      fetchUploadHistory("lab", patientId).then(setHistory);
      if (normalized.duplicate?.exact) {
        toast.info(normalized.duplicate.message || "File xét nghiệm này đã được upload trước đó.");
      } else {
        setSessionUploadHashes((current) => new Set(current).add(duplicateKey));
        toast.success("Đã đọc file xét nghiệm");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Có lỗi khi upload file xét nghiệm");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-dvh w-full overflow-y-auto px-4 py-8 sm:px-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="pl-10 sm:pl-12">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FlaskConical className="h-4 w-4 text-primary" />
            Xét nghiệm máu và nước tiểu
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">Đọc kết quả xét nghiệm</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Nhập chỉ số thủ công hoặc dán nội dung phiếu xét nghiệm. Hệ thống sẽ so sánh với khoảng tham khảo cơ bản và giải thích các điểm cần chú ý.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {medicalUser ? (
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200">
                <UserRound className="mr-1 h-3.5 w-3.5" />
                {medicalUser.full_name || medicalUser.username}
              </Badge>
            ) : (
              <Button type="button" size="sm" variant="outline" onClick={() => router.push("/medical-login")}>
                <UserRound className="h-4 w-4" />
                Đăng nhập để đọc xét nghiệm
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <section className="rounded-lg border border-border/70 bg-background/70 p-4 shadow-sm sm:p-5">
            <div className="grid gap-4 md:grid-cols-2">
              {medicalUser && (
                <div className="grid gap-2 md:col-span-2">
                  <Label>Chọn hồ sơ người bệnh</Label>
                  <Select value={selectedPatientId} onValueChange={setSelectedPatientId}>
                    <SelectTrigger className="w-full border border-border/70 bg-background">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Không gắn hồ sơ</SelectItem>
                      {patients.map((patient) => (
                        <SelectItem key={patient.id} value={String(patient.id)}>
                          {patientDisplayName(patient)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid gap-2">
                <Label htmlFor="lab-age">Tuổi</Label>
                <Input id="lab-age" type="number" min={0} max={130} value={age} onChange={(event) => setAge(event.target.value)} placeholder="vd: 45" />
              </div>
              <div className="grid gap-2">
                <Label>Giới tính</Label>
                <Select value={gender} onValueChange={(value) => setGender(value as Gender)}>
                  <SelectTrigger className="w-full border border-border/70 bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unknown">Không rõ</SelectItem>
                    <SelectItem value="male">Nam</SelectItem>
                    <SelectItem value="female">Nữ</SelectItem>
                    <SelectItem value="other">Khác</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-5 rounded-lg border border-border/70 bg-muted/15 p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-end">
                <div className="grid flex-1 gap-2">
                  <Label htmlFor="lab-file">Upload file phiếu xét nghiệm</Label>
                  <Input
                    id="lab-file"
                    type="file"
                    accept=".txt,.csv,.pdf,.xlsx,.xlsm,text/plain,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={(event) => setLabFile(event.target.files?.[0] ?? null)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Hỗ trợ TXT, CSV, PDF có text, XLSX/XLSM. PDF scan ảnh cần OCR nên có thể chưa đọc được.
                  </p>
                </div>
                <Button type="button" onClick={analyzeFile} disabled={!labFile || isLoading} className="md:w-auto">
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                  Đọc từ file
                </Button>
              </div>
              {labFile && (
                <div className="mt-3 text-xs text-muted-foreground">
                  Đã chọn: <span className="font-medium text-foreground">{labFile.name}</span> ({(labFile.size / 1024 / 1024).toFixed(2)}MB)
                </div>
              )}
            </div>

            <div className="mt-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">Chỉ số xét nghiệm</div>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant="outline" onClick={() => addRow("blood")}>
                    <Plus className="h-4 w-4" />
                    Máu
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => addRow("urine")}>
                    <Plus className="h-4 w-4" />
                    Nước tiểu
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                {rows.map((row) => (
                  <div key={row.id} className="grid gap-2 rounded-md border border-border/60 bg-muted/15 p-3 md:grid-cols-[110px_1fr_130px_110px_40px]">
                    <Select value={row.category} onValueChange={(value) => updateRow(row.id, { category: value as LabCategory })}>
                      <SelectTrigger className="w-full border border-border/70 bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="blood">Máu</SelectItem>
                        <SelectItem value="urine">Nước tiểu</SelectItem>
                      </SelectContent>
                    </Select>

                    <Select value={row.name} onValueChange={(value) => updateRow(row.id, { name: value })}>
                      <SelectTrigger className="w-full border border-border/70 bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(row.category === "blood" ? commonBlood : commonUrine).map(([name]) => (
                          <SelectItem key={name} value={name}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Input value={row.value} onChange={(event) => updateRow(row.id, { value: event.target.value })} placeholder={row.category === "urine" ? "+ / âm tính" : "Giá trị"} />
                    <Input value={row.unit} onChange={(event) => updateRow(row.id, { unit: event.target.value })} placeholder="Đơn vị" />
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(row.id)} className="h-9 w-9">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5 grid gap-2">
              <Label htmlFor="raw-lab-text">Dán nội dung phiếu xét nghiệm</Label>
              <Textarea
                id="raw-lab-text"
                value={rawText}
                onChange={(event) => setRawText(event.target.value)}
                placeholder={"Ví dụ:\nWBC 12.5 10^9/L\nHGB 11.2 g/dL\nProtein +\nNitrite negative"}
                className="min-h-[130px]"
              />
            </div>

            <Button type="button" className="mt-5 w-full" onClick={analyze} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Beaker className="h-4 w-4" />}
              Đọc kết quả xét nghiệm
            </Button>
          </section>

          <section className="rounded-lg border border-border/70 bg-background/70 p-4 shadow-sm sm:p-5">
            {!result ? (
              <div className="flex min-h-[360px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/15 p-6 text-center">
                <Beaker className="h-10 w-10 text-muted-foreground" />
                <div className="mt-3 text-sm font-medium">Chưa có kết quả đọc xét nghiệm</div>
                <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">
                  Nhập chỉ số hoặc dán phiếu xét nghiệm rồi bấm đọc kết quả.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      {result.urgent_count > 0 ? (
                        <AlertTriangle className="h-5 w-5 text-rose-500" />
                      ) : (
                        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      )}
                      <h2 className="text-lg font-semibold">Tổng quan</h2>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{result.summary}</p>
                  </div>
                  <Badge variant="outline" className={cn(result.urgent_count > 0 ? "border-rose-200 bg-rose-50 text-rose-700" : result.abnormal_count > 0 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700")}>
                    {result.abnormal_count} bất thường
                  </Badge>
                </div>

                {result.duplicate?.exact && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-100">
                    <div className="flex items-center gap-2 font-medium">
                      <AlertTriangle className="h-4 w-4" />
                      Phiếu xét nghiệm đã được lưu trước đó
                    </div>
                    <p className="mt-1 text-xs leading-5">
                      {result.duplicate.message}
                      {result.duplicate.matched_record
                        ? ` Trùng với ${result.duplicate.matched_record.filename} (${formatUploadTime(result.duplicate.matched_record.created_at)}).`
                        : ""}
                    </p>
                  </div>
                )}

                {conclusion && (
                  <div className={cn("rounded-md border p-4 text-sm", conclusion.className)}>
                    <div className="flex items-start gap-3">
                      <ClipboardCheck className="mt-0.5 h-5 w-5 shrink-0" />
                      <div className="min-w-0">
                        <div className="text-xs font-medium uppercase tracking-wide opacity-80">Nhận xét tham khảo</div>
                        <h3 className="mt-1 text-base font-semibold">{conclusion.title}</h3>
                        <p className="mt-2 leading-6">{conclusion.description}</p>
                      </div>
                    </div>
                    {conclusion.points.length > 0 && (
                      <ul className="mt-3 list-disc space-y-1 pl-8 text-xs leading-5">
                        {conclusion.points.map((point) => (
                          <li key={point}>{point}</li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-3 border-t border-current/20 pt-3 text-xs leading-5 opacity-85">{result.safety_note}</p>
                  </div>
                )}

                <div className="space-y-2">
                  {result.items.map((item, index) => (
                    <div key={`${item.code}-${index}`} className="rounded-md border border-border/60 bg-muted/15 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-medium">{item.name}</div>
                          <div className="text-xs text-muted-foreground">{item.category === "blood" ? "Máu" : "Nước tiểu"} • {item.code}</div>
                        </div>
                        <StatusBadge status={item.status} severity={item.severity} />
                      </div>
                      <div className="mt-2 grid gap-2 text-sm md:grid-cols-2">
                        <div>
                          Giá trị: <span className="font-semibold">{String(item.value)} {item.unit || ""}</span>
                        </div>
                        <div>
                          Tham khảo: <span className="font-semibold">{item.reference_range}</span>
                        </div>
                      </div>
                      {item.body_system && (
                        <div className="mt-2 text-xs font-medium text-foreground/80">
                          Ảnh hưởng: <span className="font-semibold">{item.body_system}</span>
                        </div>
                      )}
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.interpretation}</p>
                    </div>
                  ))}
                </div>

                {abnormalItems.length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-100">
                    <div className="font-medium">Cần lưu ý</div>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                      {result.recommended_next_steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {(result.unrecognized_lines?.length || result.raw_text_preview) && (
                  <details className="rounded-md border border-border/60 bg-muted/15 p-3 text-sm">
                    <summary className="cursor-pointer font-medium">Kiểm tra nội dung PDF đã đọc</summary>
                    {result.unrecognized_lines?.length ? (
                      <div className="mt-3">
                        <div className="text-xs font-medium text-muted-foreground">Dòng có vẻ là kết quả nhưng chưa nhận diện</div>
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-muted-foreground">
                          {result.unrecognized_lines.slice(0, 12).map((line, index) => (
                            <li key={`${line}-${index}`}>{line}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {result.raw_text_preview ? (
                      <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-border/60 bg-background/70 p-3 text-xs leading-5 text-muted-foreground">
                        {result.raw_text_preview}
                      </pre>
                    ) : null}
                  </details>
                )}
              </div>
            )}
          </section>
        </div>

        {medicalUser && (
          <section className="rounded-lg border border-border/70 bg-background/70 p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Nhật ký upload xét nghiệm</h2>
                <p className="text-xs text-muted-foreground">
                  Kết quả đã đọc được lưu theo tài khoản để xem lại và làm dữ liệu train sau khi kiểm chứng nhãn.
                </p>
              </div>
              <Badge variant="outline">{history.length} lần lưu</Badge>
            </div>
            <div className="mt-4 space-y-2">
              {history.length === 0 ? (
                <div className="rounded-md border border-dashed border-border bg-muted/15 p-4 text-sm text-muted-foreground">
                  Chưa có phiếu xét nghiệm nào được lưu cho tài khoản này.
                </div>
              ) : (
                history.slice(0, 8).map((item) => (
                  <div key={item.id} className="rounded-md border border-border/60 bg-muted/15 p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{item.filename}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatUploadTime(item.created_at)}
                          {item.patient_id ? ` • ${patientDisplayName(patients.find((patient) => patient.id === item.patient_id))}` : ""}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="w-fit">
                          {item.usable_for_training ? "Train-ready" : "Không train"}
                        </Badge>
                        <Button type="button" size="sm" variant="outline" onClick={() => setSelectedHistoryId(item.id)}>
                          Xem kết quả
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!item.file_path}
                          onClick={() => handleOpenUploadedLabFile(item)}
                        >
                          Xem phiếu
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={compareIds.includes(item.id) ? "secondary" : "outline"}
                          onClick={() => toggleCompare(item.id)}
                        >
                          {compareIds.includes(item.id) ? "Đã chọn" : "So sánh"}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>

            {selectedHistory && (
              <div className="mt-5 rounded-lg border border-border/70 bg-background/80 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-xs font-medium uppercase text-muted-foreground">Kết quả đã upload</div>
                    <h3 className="mt-1 text-base font-semibold">{selectedHistory.filename}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{formatUploadTime(selectedHistory.created_at)}</p>
                  </div>
                  <Badge variant="outline">{getLabAnalysis(selectedHistory)?.abnormal_count ?? 0} bất thường</Badge>
                </div>
                <p className="mt-3 text-sm text-muted-foreground">{getLabAnalysis(selectedHistory)?.summary || "Không có tóm tắt."}</p>
                <div className="mt-4 space-y-2">
                  {(getLabAnalysis(selectedHistory)?.items ?? []).map((item, index) => (
                    <div key={`${item.code}-${index}`} className="rounded-md border border-border/60 bg-muted/15 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-medium">{item.name}</div>
                          <div className="text-xs text-muted-foreground">{item.code}</div>
                        </div>
                        <StatusBadge status={item.status} severity={item.severity} />
                      </div>
                      <div className="mt-2 grid gap-2 text-sm md:grid-cols-2">
                        <div>
                          Giá trị: <span className="font-semibold">{String(item.value)} {item.unit || ""}</span>
                        </div>
                        <div>
                          Tham khảo: <span className="font-semibold">{item.reference_range}</span>
                        </div>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">{item.interpretation}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {compareItems.length > 0 && (
              <div className="mt-5 rounded-lg border border-border/70 bg-background/80 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-xs font-medium uppercase text-muted-foreground">So sánh 2 lần upload</div>
                    <h3 className="mt-1 text-base font-semibold">
                      {compareItems.length < 2 ? "Chọn thêm một phiếu để so sánh" : "Bảng thay đổi chỉ số"}
                    </h3>
                  </div>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setCompareIds([])}>
                    Bỏ chọn
                  </Button>
                </div>
                {compareItems.length === 2 && (
                  <div className="mt-4 overflow-x-auto">
                    <div className="min-w-[720px] rounded-md border border-border/60">
                      <div className="grid grid-cols-[1.1fr_1fr_1fr_0.8fr_1fr] bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                        <div>Chỉ số</div>
                        <div>{formatUploadTime(compareItems[0].created_at)}</div>
                        <div>{formatUploadTime(compareItems[1].created_at)}</div>
                        <div>Thay đổi</div>
                        <div>Nhận xét</div>
                      </div>
                      {comparisonRows.map((row) => (
                        <div key={row.key} className="grid grid-cols-[1.1fr_1fr_1fr_0.8fr_1fr] border-t border-border/60 px-3 py-2 text-sm">
                          <div className="font-medium">{row.name}</div>
                          <div>{row.previous}</div>
                          <div>{row.current}</div>
                          <div className={cn(row.deltaClassName)}>{row.delta}</div>
                          <div className="text-muted-foreground">{row.note}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status, severity }: { status: string; severity: string }) {
  const cls =
    severity === "urgent"
      ? "border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-900/20 dark:text-rose-200"
      : severity === "attention"
        ? "border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-200"
        : "border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200";
  const label =
    status === "low"
      ? "thấp"
      : status === "normal"
        ? "bình thường"
        : status === "high"
          ? "cao"
          : status === "positive"
            ? "dương tính"
            : status === "negative"
              ? "âm tính"
              : status === "unknown"
                ? "chưa rõ"
                : status;
  return (
    <Badge variant="outline" className={cls}>
      {label}
    </Badge>
  );
}

function getLabAnalysis(item: UploadHistoryItem | null): LabAnalyzeResponse | null {
  if (!item || !Array.isArray(item.analysis?.items)) return null;
  return item.analysis as unknown as LabAnalyzeResponse;
}

function buildLabComparison(first?: UploadHistoryItem, second?: UploadHistoryItem) {
  const previous = getLabAnalysis(first ?? null);
  const current = getLabAnalysis(second ?? null);
  if (!previous || !current) return [];

  const previousMap = new Map(previous.items.map((item) => [item.code || item.name, item]));
  const currentMap = new Map(current.items.map((item) => [item.code || item.name, item]));
  const keys = Array.from(new Set([...previousMap.keys(), ...currentMap.keys()]));

  return keys.map((key) => {
    const before = previousMap.get(key);
    const after = currentMap.get(key);
    const beforeNumber = parseLabNumber(before?.value);
    const afterNumber = parseLabNumber(after?.value);
    const deltaValue =
      beforeNumber !== null && afterNumber !== null
        ? afterNumber - beforeNumber
        : null;
    const delta =
      deltaValue === null
        ? "-"
        : `${deltaValue > 0 ? "+" : ""}${Number(deltaValue.toFixed(2))}`;
    const statusChanged = before?.status && after?.status && before.status !== after.status;

    return {
      key,
      name: after?.name || before?.name || key,
      previous: before ? `${String(before.value)} ${before.unit || ""}`.trim() : "Không có",
      current: after ? `${String(after.value)} ${after.unit || ""}`.trim() : "Không có",
      delta,
      deltaClassName:
        deltaValue === null
          ? "text-muted-foreground"
          : deltaValue > 0
            ? "text-amber-700"
            : deltaValue < 0
              ? "text-emerald-700"
              : "text-muted-foreground",
      note: statusChanged
        ? `${statusLabel(before.status)} -> ${statusLabel(after.status)}`
        : after?.status
          ? statusLabel(after.status)
          : "Chỉ có ở phiếu cũ",
    };
  });
}

function parseLabNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const number = Number(value.replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function statusLabel(status: string) {
  return status === "low"
    ? "thấp"
    : status === "normal"
      ? "bình thường"
      : status === "high"
        ? "cao"
        : status === "positive"
          ? "dương tính"
          : status === "negative"
            ? "âm tính"
            : status === "unknown"
              ? "chưa rõ"
              : status;
}

function buildLabConclusion(result: LabAnalyzeResponse) {
  const urgentItems = result.items.filter((item) => item.severity === "urgent");
  const abnormalItems = result.items.filter((item) => ["low", "high", "positive", "abnormal"].includes(item.status));
  const topItems = abnormalItems.slice(0, 3).map((item) => `${item.name}: ${String(item.value)} ${item.unit || ""}`.trim());

  if (result.items.length === 0) {
    return {
      title: "Chưa đủ dữ liệu xét nghiệm để đưa ra nhận xét.",
      description: "Hệ thống chưa nhận diện được chỉ số có trong bảng tham chiếu. Nên kiểm tra lại file PDF có phải dạng scan ảnh không, hoặc dán thủ công các dòng chỉ số quan trọng.",
      points: result.recommended_next_steps.slice(0, 2),
      className: "border-slate-200 bg-slate-50 text-slate-800 dark:border-slate-700/50 dark:bg-slate-900/30 dark:text-slate-100",
    };
  }

  if (urgentItems.length > 0) {
    return {
      title: "Có chỉ số lệch nhiều, nên được đánh giá y tế sớm.",
      description: `Hệ thống nhận diện ${result.items.length} chỉ số và có ${urgentItems.length} chỉ số ở mức cần chú ý cao. Đây là nhận xét hỗ trợ đọc phiếu, chưa thay thế kết luận của bác sĩ.`,
      points: [
        ...topItems,
        "Ưu tiên đối chiếu ngay với khoảng tham khảo in trên phiếu gốc và triệu chứng hiện tại.",
        "Nếu có biểu hiện nặng hoặc chỉ số lệch rất nhiều, nên khám trực tiếp thay vì chỉ theo dõi trên phần mềm.",
      ],
      className: "border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-700/40 dark:bg-rose-900/20 dark:text-rose-100",
    };
  }

  if (abnormalItems.length > 0) {
    return {
      title: "Có một số chỉ số ngoài khoảng tham khảo.",
      description: `Hệ thống nhận diện ${result.items.length} chỉ số, trong đó ${abnormalItems.length} chỉ số lệch so với khoảng tham khảo đang dùng. Cần xem cùng tuổi, giới, tình trạng nhịn ăn, thuốc đang dùng và bệnh nền.`,
      points: [
        ...topItems,
        "Nhóm đường-mỡ máu nên đối chiếu tình trạng nhịn ăn và nguy cơ tim mạch.",
        "Nhóm gan-thận-điện giải nên đối chiếu triệu chứng và các kết quả liên quan trên cùng phiếu.",
      ],
      className: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-100",
    };
  }

  return {
    title: "Các chỉ số đã đọc chưa ghi nhận bất thường rõ.",
    description: `Hệ thống nhận diện ${result.items.length} chỉ số và chưa thấy chỉ số nào lệch rõ theo khoảng tham khảo đang dùng. Kết quả vẫn cần đối chiếu với phiếu gốc vì mỗi phòng xét nghiệm có khoảng tham chiếu riêng.`,
    points: [
      "Nếu phiếu gốc còn nhiều chỉ số nhưng phần mềm đọc ít, nên dùng PDF có text rõ hoặc dán nội dung bảng xét nghiệm vào ô nhập.",
      ...result.recommended_next_steps.slice(0, 1),
    ],
    className: "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-100",
  };
}

function coerceValue(value: string) {
  const normalized = value.replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) && normalized.trim() !== "" ? number : value;
}

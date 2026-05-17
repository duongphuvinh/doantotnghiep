"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Beaker,
  CheckCircle2,
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
import { getMedicalAuthToken, getMedicalAuthUser, type MedicalUser } from "@/lib/medical-auth";
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
  }>;
  summary: string;
  abnormal_count: number;
  urgent_count: number;
  recommended_next_steps: string[];
  safety_note: string;
};

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
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<Gender>("unknown");
  const [rawText, setRawText] = useState("");
  const [labFile, setLabFile] = useState<File | null>(null);
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

  const abnormalItems = useMemo(
    () => result?.items.filter((item) => !["normal", "negative"].includes(item.status)) ?? [],
    [result]
  );

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
          age: age ? Number(age) : undefined,
          gender,
          values,
          raw_text: rawText.trim() || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.detail || "Không đọc được kết quả xét nghiệm");
      }
      setResult(data);
      toast.success("Đã đọc kết quả xét nghiệm");
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

    const formData = new FormData();
    formData.append("file", labFile);
    if (age) formData.append("age", age);
    formData.append("gender", gender);

    setIsLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/labs/analyze-file", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.detail || "Không đọc được file xét nghiệm");
      }
      setResult(data);
      toast.success("Đã đọc file xét nghiệm");
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
              </div>
            )}
          </section>
        </div>
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
  return (
    <Badge variant="outline" className={cls}>
      {status}
    </Badge>
  );
}

function coerceValue(value: string) {
  const normalized = value.replace(",", ".");
  const number = Number(normalized);
  return Number.isFinite(number) && normalized.trim() !== "" ? number : value;
}

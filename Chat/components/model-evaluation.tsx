"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Loader2, Save, Upload } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getMedicalAuthToken } from "@/lib/medical-auth";

type EvaluationResponse = {
  best_model_by_macro_f1?: string | null;
  comparison_summary: string;
  models: Array<{
    model_name: string;
    accuracy: number;
    macro_precision: number;
    macro_recall: number;
    macro_f1: number;
    weighted_f1: number;
    total: number;
  }>;
};

export function ModelEvaluation() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<EvaluationResponse | null>(null);
  const [caseCode, setCaseCode] = useState("");
  const [truth, setTruth] = useState("");
  const [beforeAi, setBeforeAi] = useState("");
  const [imageAi, setImageAi] = useState("");
  const [clinicalAi, setClinicalAi] = useState("");
  const [multimodal, setMultimodal] = useState("");
  const [note, setNote] = useState("");

  const requireToken = () => {
    const token = getMedicalAuthToken();
    if (!token) {
      toast.error("Vui lòng đăng nhập trước khi đánh giá mô hình");
      router.push("/medical-login");
      return null;
    }
    return token;
  };

  const evaluate = async () => {
    const token = requireToken();
    if (!token) return;
    if (!file) {
      toast.error("Vui lòng chọn CSV");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    setIsLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/evaluation/metrics-file", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.detail || "Không đánh giá được mô hình");
      setResult(data);
      toast.success("Đã tính metrics từ CSV");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Có lỗi khi đánh giá");
    } finally {
      setIsLoading(false);
    }
  };

  const saveRun = async () => {
    const token = requireToken();
    if (!token) return;
    if (!caseCode.trim() || !truth.trim()) {
      toast.error("Cần nhập mã ca và nhãn đúng");
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/evaluation/runs", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          case_code: caseCode.trim(),
          y_true: truth.trim(),
          before_ai_pred: beforeAi.trim() || undefined,
          image_ai_pred: imageAi.trim() || undefined,
          clinical_ai_pred: clinicalAi.trim() || undefined,
          multimodal_pred: multimodal.trim() || undefined,
          note: note.trim() || undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.detail || "Không lưu được ca đánh giá");
      toast.success("Đã lưu ca đánh giá");
      setCaseCode("");
      setTruth("");
      setBeforeAi("");
      setImageAi("");
      setClinicalAi("");
      setMultimodal("");
      setNote("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Có lỗi khi lưu ca");
    } finally {
      setIsLoading(false);
    }
  };

  const evaluateSavedRuns = async () => {
    const token = requireToken();
    if (!token) return;

    setIsLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/evaluation/runs/metrics", {
        headers: { authorization: `Bearer ${token}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.detail || "Không tính được metrics từ ca đã lưu");
      setResult(data);
      toast.success("Đã tính metrics từ ca đã lưu");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Có lỗi khi tính metrics");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-dvh w-full overflow-y-auto px-4 py-8 sm:px-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <section className="pl-10 sm:pl-12">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <BarChart3 className="h-4 w-4 text-primary" />
            Model evaluation
          </div>
          <h1 className="mt-2 text-2xl font-semibold">Đánh giá Accuracy / Precision / Recall / F1</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Ghi nhận từng ca đọc phim để so sánh trước AI, model ảnh xương, dữ liệu lâm sàng/xét nghiệm và fusion đa phương thức.
          </p>
        </section>

        <section className="rounded-lg border border-border/70 bg-background/70 p-5 shadow-sm">
          <div>
            <h2 className="text-lg font-semibold">Ghi nhận ca đọc phim trước/sau AI</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Dùng cùng một nhãn đúng để biết mô hình nào cải thiện kết quả sau khi train hoặc sau khi kết hợp xét nghiệm.
            </p>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>Mã ca</Label>
              <Input value={caseCode} onChange={(e) => setCaseCode(e.target.value)} placeholder="VD: CASE-001" />
            </div>
            <div className="grid gap-2">
              <Label>Nhãn đúng / kết luận chuẩn</Label>
              <Input value={truth} onChange={(e) => setTruth(e.target.value)} placeholder="VD: fracture, normal, osteoporosis" />
            </div>
            <div className="grid gap-2">
              <Label>Kết quả trước AI</Label>
              <Input value={beforeAi} onChange={(e) => setBeforeAi(e.target.value)} placeholder="Kết quả đọc phim ban đầu" />
            </div>
            <div className="grid gap-2">
              <Label>Model ảnh xương</Label>
              <Input value={imageAi} onChange={(e) => setImageAi(e.target.value)} placeholder="Dự đoán image-only" />
            </div>
            <div className="grid gap-2">
              <Label>Lâm sàng / xét nghiệm</Label>
              <Input value={clinicalAi} onChange={(e) => setClinicalAi(e.target.value)} placeholder="Dự đoán clinical/lab-only" />
            </div>
            <div className="grid gap-2">
              <Label>Fusion đa phương thức</Label>
              <Input value={multimodal} onChange={(e) => setMultimodal(e.target.value)} placeholder="Dự đoán sau khi kết hợp" />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <Label>Ghi chú</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="VD: phim X-quang gối, có CRP cao..." />
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <Button onClick={saveRun} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Lưu ca
            </Button>
            <Button variant="outline" onClick={evaluateSavedRuns} disabled={isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <BarChart3 className="h-4 w-4" />}
              Tính metrics từ ca đã lưu
            </Button>
          </div>
        </section>

        <section className="rounded-lg border border-border/70 bg-background/70 p-5 shadow-sm">
          <div className="grid gap-2">
            <Label>Hoặc upload CSV dự đoán</Label>
            <Input type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            <p className="text-xs text-muted-foreground">
              CSV cần có cột <code>model_name,y_true,y_pred</code>. Ví dụ: <code>multimodal,fracture,fracture</code>
            </p>
          </div>
          <Button className="mt-4" onClick={evaluate} disabled={isLoading || !file}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Tính metrics từ CSV
          </Button>
        </section>

        {result && (
          <section className="rounded-lg border border-border/70 bg-background/70 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Kết quả đánh giá</h2>
                <p className="mt-1 text-sm text-muted-foreground">{result.comparison_summary}</p>
              </div>
              {result.best_model_by_macro_f1 && <Badge variant="outline">Best: {result.best_model_by_macro_f1}</Badge>}
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-3">Model</th>
                    <th className="py-2 pr-3">Accuracy</th>
                    <th className="py-2 pr-3">Precision</th>
                    <th className="py-2 pr-3">Recall</th>
                    <th className="py-2 pr-3">Macro F1</th>
                    <th className="py-2 pr-3">Weighted F1</th>
                    <th className="py-2 pr-3">N</th>
                  </tr>
                </thead>
                <tbody>
                  {result.models.map((model) => (
                    <tr key={model.model_name} className="border-b border-border/60">
                      <td className="py-2 pr-3 font-medium">{model.model_name}</td>
                      <td className="py-2 pr-3">{model.accuracy}</td>
                      <td className="py-2 pr-3">{model.macro_precision}</td>
                      <td className="py-2 pr-3">{model.macro_recall}</td>
                      <td className="py-2 pr-3">{model.macro_f1}</td>
                      <td className="py-2 pr-3">{model.weighted_f1}</td>
                      <td className="py-2 pr-3">{model.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

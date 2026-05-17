"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, BrainCircuit, Loader2, Upload, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getMedicalAuthToken, getMedicalAuthUser } from "@/lib/medical-auth";

type Gender = "male" | "female" | "other" | "unknown";
type Modality = "xray" | "ct" | "mri" | "unknown";

type MultimodalResponse = {
  fusion_score: number;
  risk_level: "low" | "medium" | "high";
  predicted_label: string;
  confidence: number;
  explanation: string;
  signals: Array<{
    source: "image" | "clinical";
    name: string;
    value: string | number | boolean;
    contribution: number;
    explanation: string;
  }>;
  recommended_next_steps: string[];
};

export function MultimodalAnalysis() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [modality, setModality] = useState<Modality>("xray");
  const [bodyPart, setBodyPart] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<Gender>("unknown");
  const [symptoms, setSymptoms] = useState("");
  const [history, setHistory] = useState("");
  const [painScore, setPainScore] = useState("");
  const [labText, setLabText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<MultimodalResponse | null>(null);
  const user = getMedicalAuthUser();

  const analyze = async () => {
    const token = getMedicalAuthToken();
    if (!token) {
      toast.error("Vui lòng đăng nhập trước khi chạy fusion");
      router.push("/medical-login");
      return;
    }
    if (!file) {
      toast.error("Vui lòng chọn ảnh/phim xương");
      return;
    }
    if (!age) {
      toast.error("Vui lòng nhập tuổi");
      return;
    }

    const clinical = {
      age: Number(age),
      gender,
      symptoms: splitLines(symptoms),
      medical_history: splitLines(history),
      clinical_indicators: {
        ...(painScore ? { pain_score: Number(painScore) } : {}),
      },
    };

    const formData = new FormData();
    formData.append("file", file);
    formData.append("modality", modality);
    if (bodyPart.trim()) formData.append("body_part", bodyPart.trim());
    formData.append("clinical_json", JSON.stringify(clinical));
    if (labText.trim()) {
      formData.append("lab_json", JSON.stringify({
        age: Number(age),
        gender,
        raw_text: labText.trim(),
      }));
    }

    setIsLoading(true);
    setResult(null);
    try {
      const response = await fetch("/api/multimodal/analyze", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.detail || "Không chạy được fusion");
      setResult(data);
      toast.success("Đã chạy pipeline đa phương thức");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Có lỗi khi chạy fusion");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-dvh w-full overflow-y-auto px-4 py-8 sm:px-6">
      <div className="mx-auto grid w-full max-w-6xl gap-6 xl:grid-cols-[1fr_0.9fr]">
        <section className="pl-10 sm:pl-12 xl:col-span-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <BrainCircuit className="h-4 w-4 text-primary" />
            Multimodal fusion
          </div>
          <h1 className="mt-2 text-2xl font-semibold">Phân tích ảnh + lâm sàng</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            Pipeline hợp nhất đặc trưng ảnh y khoa và dữ liệu lâm sàng bằng late fusion có trọng số.
          </p>
          {user && (
            <Badge variant="outline" className="mt-4 border-emerald-200 bg-emerald-50 text-emerald-700">
              <UserRound className="mr-1 h-3.5 w-3.5" />
              {user.full_name || user.username}
            </Badge>
          )}
        </section>

        <section className="rounded-lg border border-border/70 bg-background/70 p-5 shadow-sm">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="grid gap-2 md:col-span-2">
              <Label>Ảnh/phim xương</Label>
              <Input type="file" accept="image/*,.dcm,.dicom,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="grid gap-2">
              <Label>Loại phim</Label>
              <Select value={modality} onValueChange={(value) => setModality(value as Modality)}>
                <SelectTrigger className="w-full border border-border/70 bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="xray">X-ray</SelectItem>
                  <SelectItem value="ct">CT</SelectItem>
                  <SelectItem value="mri">MRI</SelectItem>
                  <SelectItem value="unknown">Không rõ</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Vùng xương</Label>
              <Input value={bodyPart} onChange={(e) => setBodyPart(e.target.value)} placeholder="gối, tay, cột sống..." />
            </div>
            <div className="grid gap-2">
              <Label>Tuổi</Label>
              <Input type="number" value={age} onChange={(e) => setAge(e.target.value)} placeholder="vd: 62" />
            </div>
            <div className="grid gap-2">
              <Label>Giới tính</Label>
              <Select value={gender} onValueChange={(value) => setGender(value as Gender)}>
                <SelectTrigger className="w-full border border-border/70 bg-background"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="unknown">Không rõ</SelectItem>
                  <SelectItem value="male">Nam</SelectItem>
                  <SelectItem value="female">Nữ</SelectItem>
                  <SelectItem value="other">Khác</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2 md:col-span-2">
              <Label>Triệu chứng</Label>
              <Textarea value={symptoms} onChange={(e) => setSymptoms(e.target.value)} placeholder={"Mỗi dòng một triệu chứng\nđau khớp\nsưng sau té ngã"} />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <Label>Tiền sử bệnh</Label>
              <Textarea value={history} onChange={(e) => setHistory(e.target.value)} placeholder={"loãng xương\nviêm khớp"} />
            </div>
            <div className="grid gap-2">
              <Label>Điểm đau</Label>
              <Input type="number" min={0} max={10} value={painScore} onChange={(e) => setPainScore(e.target.value)} placeholder="0-10" />
            </div>
            <div className="grid gap-2 md:col-span-2">
              <Label>Chỉ số xét nghiệm máu/nước tiểu</Label>
              <Textarea
                value={labText}
                onChange={(e) => setLabText(e.target.value)}
                placeholder={"Mỗi dòng một chỉ số\nCRP 35 mg/L\nWBC 14 10^9/L\nProtein +\nBlood negative"}
              />
              <p className="text-xs text-muted-foreground">
                Các chỉ số xét nghiệm sẽ được phân tích và đưa vào fusion cùng ảnh xương và dữ liệu lâm sàng.
              </p>
            </div>
          </div>
          <Button className="mt-5 w-full" onClick={analyze} disabled={isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            Chạy fusion
          </Button>
        </section>

        <section className="rounded-lg border border-border/70 bg-background/70 p-5 shadow-sm">
          {!result ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/15 p-6 text-center">
              <Activity className="h-10 w-10 text-muted-foreground" />
              <div className="mt-3 text-sm font-medium">Chưa có kết quả fusion</div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Badge variant="outline">{result.risk_level}</Badge>
                <h2 className="mt-3 text-xl font-semibold">{result.predicted_label}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{result.explanation}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Metric label="Fusion score" value={String(result.fusion_score)} />
                <Metric label="Confidence" value={`${(result.confidence * 100).toFixed(1)}%`} />
              </div>
              <div className="space-y-2">
                {result.signals.map((signal, index) => (
                  <div key={`${signal.name}-${index}`} className="rounded-md border border-border/60 bg-muted/15 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium">{signal.name}</div>
                      <Badge variant="outline">{signal.source}</Badge>
                    </div>
                    <div className="mt-1 text-sm">Contribution: {signal.contribution}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{signal.explanation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function splitLines(value: string) {
  return value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}

"use client";

import { useMemo, useRef, useState } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  FileImage,
  FileText,
  Loader2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { toast } from "sonner";

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
import { Badge } from "@/components/ui/badge";
import { getMedicalAuthUser, type MedicalUser } from "@/lib/medical-auth";
import { cn } from "@/lib/utils";

type Modality = "xray" | "ct" | "mri" | "unknown";

type ImageAnalysisResponse = {
  metadata: {
    filename: string;
    content_type?: string;
    modality: Modality;
    body_part?: string;
    width: number;
    height: number;
    channels: number;
    source_format: string;
    dicom?: Record<string, unknown>;
  };
  preprocessing: {
    normalized: boolean;
    contrast_enhanced: boolean;
    resized_to: [number, number];
    original_size: [number, number];
  };
  quality: {
    mean_intensity: number;
    contrast_std: number;
    sharpness_laplacian_var: number;
    dynamic_range: number;
    dark_pixel_ratio: number;
    bright_pixel_ratio: number;
    warnings: string[];
  };
  features: {
    estimated_bone_area_ratio: number;
    high_density_region_count: number;
    edge_density: number;
    symmetry_score?: number;
  };
  prediction: {
    status: "model_prediction" | "analysis_only";
    labels?: string[];
    probabilities?: number[];
    top_label?: string;
    confidence?: number;
    note: string;
  };
  safety_note: string;
};

const allowedExtensions = [".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".dcm", ".dicom", ".pdf"];
const maxFileSizeMb = 25;

export function MedicalImageUpload() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [modality, setModality] = useState<Modality>("xray");
  const [bodyPart, setBodyPart] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [result, setResult] = useState<ImageAnalysisResponse | null>(null);
  const [medicalUser, setMedicalUser] = useState<MedicalUser | null>(null);

  useEffect(() => {
    const refreshUser = () => setMedicalUser(getMedicalAuthUser());
    refreshUser();
    window.addEventListener("medical-auth-changed", refreshUser);
    return () => window.removeEventListener("medical-auth-changed", refreshUser);
  }, []);

  const fileKind = useMemo(() => {
    if (!file) return null;
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "pdf";
    if (file.name.toLowerCase().endsWith(".dcm") || file.name.toLowerCase().endsWith(".dicom")) return "dicom";
    return "image";
  }, [file]);

  const setSelectedFile = (nextFile: File | null) => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setResult(null);

    if (!nextFile) {
      setFile(null);
      setPreviewUrl(null);
      return;
    }

    const lowerName = nextFile.name.toLowerCase();
    const hasAllowedExtension = allowedExtensions.some((ext) => lowerName.endsWith(ext));
    if (!hasAllowedExtension) {
      toast.error("Chỉ hỗ trợ ảnh, DICOM hoặc PDF phim xương");
      return;
    }

    if (nextFile.size > maxFileSizeMb * 1024 * 1024) {
      toast.error(`File tối đa ${maxFileSizeMb}MB`);
      return;
    }

    setFile(nextFile);
    if (nextFile.type.startsWith("image/")) {
      setPreviewUrl(URL.createObjectURL(nextFile));
    } else {
      setPreviewUrl(null);
    }
  };

  const analyze = async () => {
    if (!file) {
      toast.error("Vui lòng chọn file phim xương trước");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("modality", modality);
    if (bodyPart.trim()) {
      formData.append("body_part", bodyPart.trim());
    }

    setIsUploading(true);
    setResult(null);

    try {
      const response = await fetch("/api/medical-images/analyze", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.detail || "Không phân tích được file");
      }
      setResult(data);
      toast.success("Đã phân tích phim xương");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Có lỗi khi upload file");
    } finally {
      setIsUploading(false);
    }
  };

  const clearFile = () => {
    setSelectedFile(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const statusBadge = result?.prediction.status === "model_prediction"
    ? { label: "Model prediction", className: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-200" }
    : { label: "Analysis only", className: "border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-200" };
  const conclusion = result ? buildImageConclusion(result) : null;

  return (
    <div className="min-h-dvh w-full overflow-y-auto px-4 py-8 sm:px-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <div className="pl-10 sm:pl-12">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Activity className="h-4 w-4 text-primary" />
            Phân tích hình ảnh y khoa
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal text-foreground">
            Upload phim xương
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Hỗ trợ ảnh X-ray, CT, MRI, DICOM và PDF. File PDF sẽ được backend đọc trang đầu để phục vụ phân tích sơ bộ.
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
                Đăng nhập để dùng hồ sơ người bệnh
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="rounded-lg border border-border/70 bg-background/70 p-4 shadow-sm sm:p-5">
            <div
              className={cn(
                "flex min-h-[300px] flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 p-5 text-center transition-colors",
                isDragging && "border-primary bg-primary/5"
              )}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                setSelectedFile(event.dataTransfer.files?.[0] ?? null);
              }}
            >
              {previewUrl ? (
                <img
                  src={previewUrl}
                  alt="Ảnh phim xương đã chọn"
                  className="max-h-[360px] w-full rounded-md object-contain"
                />
              ) : file ? (
                <div className="flex flex-col items-center gap-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                    {fileKind === "pdf" ? <FileText className="h-7 w-7" /> : <FileImage className="h-7 w-7" />}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">{file.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {(file.size / 1024 / 1024).toFixed(2)}MB • {fileKind?.toUpperCase()}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Upload className="h-7 w-7" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-foreground">Kéo thả file vào đây</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      JPG, PNG, TIFF, DICOM hoặc PDF
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <Input
                ref={inputRef}
                type="file"
                accept="image/*,.dcm,.dicom,.pdf,application/pdf"
                onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
                className="h-10"
              />
              {file && (
                <Button type="button" variant="outline" onClick={clearFile} className="sm:w-auto">
                  <X className="h-4 w-4" />
                  Xóa
                </Button>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-border/70 bg-background/70 p-4 shadow-sm sm:p-5">
            <div className="space-y-4">
              <div className="grid gap-2">
                <Label>Loại phim</Label>
                <Select value={modality} onValueChange={(value) => setModality(value as Modality)}>
                  <SelectTrigger className="w-full border border-border/70 bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="xray">X-ray / X-quang</SelectItem>
                    <SelectItem value="ct">CT</SelectItem>
                    <SelectItem value="mri">MRI</SelectItem>
                    <SelectItem value="unknown">Không rõ</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="body-part">Vùng xương</Label>
                <Input
                  id="body-part"
                  value={bodyPart}
                  onChange={(event) => setBodyPart(event.target.value)}
                  placeholder="Ví dụ: bàn tay, gối, cột sống..."
                />
              </div>

              <Button onClick={analyze} disabled={!file || isUploading} className="w-full">
                {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Phân tích phim
              </Button>

              <div className="rounded-md border border-amber-200/70 bg-amber-50/70 p-3 text-xs leading-5 text-amber-900 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-100">
                Kết quả chỉ phục vụ hỗ trợ tham khảo và demo. Không dùng để tự chẩn đoán hoặc thay thế bác sĩ.
              </div>
            </div>
          </section>
        </div>

        {result && (
          <section className="rounded-lg border border-border/70 bg-background/70 p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                  <h2 className="text-lg font-semibold">Kết quả phân tích</h2>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{result.metadata.filename}</p>
              </div>
              <Badge variant="outline" className={cn("w-fit", statusBadge.className)}>
                {statusBadge.label}
              </Badge>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-3">
              <Metric label="Kích thước xử lý" value={`${result.metadata.width} x ${result.metadata.height}`} />
              <Metric label="Định dạng" value={result.metadata.source_format.toUpperCase()} />
              <Metric label="Modality" value={result.metadata.modality.toUpperCase()} />
              <Metric label="Độ tương phản" value={String(result.quality.contrast_std)} />
              <Metric label="Độ sắc nét" value={String(result.quality.sharpness_laplacian_var)} />
              <Metric label="Vùng xương ước tính" value={`${(result.features.estimated_bone_area_ratio * 100).toFixed(2)}%`} />
            </div>

            {conclusion && (
              <div className={cn("mt-4 rounded-md border p-4 text-sm", conclusion.className)}>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-xs font-medium uppercase opacity-80">Kết luận tham khảo</div>
                    <h3 className="mt-1 text-base font-semibold">{conclusion.title}</h3>
                  </div>
                  <Badge variant="outline" className="w-fit bg-background/60">
                    {conclusion.level}
                  </Badge>
                </div>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-5">
                  {conclusion.points.map((point) => (
                    <li key={point}>{point}</li>
                  ))}
                </ul>
              </div>
            )}

            {result.quality.warnings.length > 0 && (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-100">
                <div className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4" />
                  Cảnh báo chất lượng ảnh
                </div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                  {result.quality.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-4 rounded-md border border-border/70 bg-muted/20 p-3 text-sm">
              <div className="font-medium">Ghi chú mô hình</div>
              <p className="mt-1 text-muted-foreground">{result.prediction.note}</p>
              {result.prediction.top_label && (
                <p className="mt-2">
                  Nhãn dự đoán: <span className="font-semibold">{result.prediction.top_label}</span>
                  {typeof result.prediction.confidence === "number" && (
                    <span className="text-muted-foreground"> ({(result.prediction.confidence * 100).toFixed(2)}%)</span>
                  )}
                </p>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function buildImageConclusion(result: ImageAnalysisResponse) {
  const confidence = typeof result.prediction.confidence === "number"
    ? `${(result.prediction.confidence * 100).toFixed(2)}%`
    : null;

  if (result.prediction.status === "model_prediction" && result.prediction.top_label) {
    const label = result.prediction.top_label;
    const diseaseName = labelToVietnamese(label);
    const isNormal = label.toLowerCase() === "normal";

    return {
      title: isNormal
        ? "Model chưa ghi nhận bất thường xương rõ trên phim."
        : `Model gợi ý: ${diseaseName}.`,
      level: confidence ? `Độ tin cậy ${confidence}` : "Có model AI",
      className: isNormal
        ? "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-100"
        : "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-100",
      points: [
        `Nhãn AI: ${label}${confidence ? `, confidence ${confidence}` : ""}.`,
        "Cần đối chiếu vị trí đau, triệu chứng, tiền sử chấn thương và kết luận của bác sĩ/chẩn đoán hình ảnh.",
        result.safety_note,
      ],
    };
  }

  const points = [
    "Chưa có model AI đã huấn luyện được cấu hình, nên hệ thống chưa thể kết luận người bệnh bị gãy xương, viêm khớp, loãng xương hay bệnh lý cụ thể.",
    `Ảnh đã được tiền xử lý; vùng xương ước tính ${(result.features.estimated_bone_area_ratio * 100).toFixed(2)}%, độ tương phản ${result.quality.contrast_std}, độ sắc nét ${result.quality.sharpness_laplacian_var}.`,
  ];

  if (result.quality.warnings.length > 0) {
    points.push(`Cần chú ý chất lượng ảnh: ${result.quality.warnings.join("; ")}.`);
  } else {
    points.push("Chất lượng ảnh đủ để trích xuất đặc trưng sơ bộ, nhưng chưa thay thế được kết luận bệnh lý từ model hoặc bác sĩ.");
  }

  points.push("Muốn có kết luận bệnh lý cụ thể, cần train/cấu hình model AI và dùng trang Đánh giá để so sánh với nhãn đúng.");

  return {
    title: "Chưa đủ cơ sở để kết luận bệnh lý xương cụ thể.",
    level: "Analysis only",
    className: "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-100",
    points,
  };
}

function labelToVietnamese(label: string) {
  const normalized = label.toLowerCase();
  const mapping: Record<string, string> = {
    fracture: "nghi gãy xương",
    arthritis: "nghi viêm/thoái hóa khớp",
    osteoporosis: "nghi loãng xương",
    normal: "bình thường",
    other: "bất thường khác",
  };
  return mapping[normalized] || label;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

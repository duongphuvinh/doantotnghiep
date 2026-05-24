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
import {
  clearMedicalAuthSession,
  getMedicalAuthToken,
  getMedicalAuthUser,
  type MedicalUser,
} from "@/lib/medical-auth";
import { saveLatestImageSnapshot } from "@/lib/medical-fusion-cache";
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
  file_hash?: string | null;
  image_hash?: string | null;
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
  const [patients, setPatients] = useState<PatientOption[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string>("none");
  const [history, setHistory] = useState<UploadHistoryItem[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<number | null>(null);
  const [compareIds, setCompareIds] = useState<number[]>([]);
  const [sessionUploadHashes, setSessionUploadHashes] = useState<Set<string>>(() => new Set());

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
    fetchUploadHistory("image", patientId).then(setHistory);
  }, [medicalUser, selectedPatientId]);

  const fileKind = useMemo(() => {
    if (!file) return null;
    if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "pdf";
    if (file.name.toLowerCase().endsWith(".dcm") || file.name.toLowerCase().endsWith(".dicom")) return "dicom";
    return "image";
  }, [file]);
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
  const comparisonRows = useMemo(() => buildImageComparison(compareItems[0], compareItems[1]), [compareItems]);

  const toggleCompare = (id: number) => {
    setCompareIds((current) => {
      if (current.includes(id)) return current.filter((item) => item !== id);
      return [...current.slice(-1), id];
    });
  };

  const handleOpenUploadedFilm = async (item: UploadHistoryItem) => {
    try {
      await openUploadFile(item);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không mở được phim xương đã upload");
    }
  };

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

    const patientId = selectedPatientId === "none" ? null : Number(selectedPatientId);
    const fileHash = await sha256File(file);
    const duplicateKey = uploadDuplicateKey("image", patientId, fileHash);
    const existingRecord = history.find((item) => item.file_hash === fileHash);
    if (sessionUploadHashes.has(duplicateKey) || existingRecord) {
      toast.info(
        existingRecord
          ? `Phim này đã được upload trước đó: ${existingRecord.filename} (${formatUploadTime(existingRecord.created_at)}).`
          : "Phim này vừa được upload trong phiên hiện tại, hệ thống không tạo thêm bản ghi mới."
      );
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("modality", modality);
    if (bodyPart.trim()) {
      formData.append("body_part", bodyPart.trim());
    }
    if (selectedPatientId !== "none") {
      formData.append("patient_id", selectedPatientId);
    }

    setIsUploading(true);
    setResult(null);

    try {
      const token = getMedicalAuthToken();
      const response = await fetch("/api/medical-images/analyze", {
        method: "POST",
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
        body: formData,
      });
      const data = await readJsonResponse(response);
      if (!response.ok) {
        if (response.status === 401 && token) {
          clearMedicalAuthSession();
          setMedicalUser(null);
          throw new Error("Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại để lưu lịch sử upload.");
        }
        throw new Error(data?.detail || "Không phân tích được file");
      }
      setResult(data);
      try {
        await saveLatestImageSnapshot(medicalUser, file, {
          modality,
          bodyPart: bodyPart.trim() || undefined,
          result: data,
        });
      } catch {
        // Cache failure should not block the analysis result.
      }
      if (medicalUser) {
        fetchUploadHistory("image", patientId).then(setHistory);
      }
      if (data?.duplicate?.exact) {
        toast.info(data.duplicate.message || "File này đã được upload trước đó, hệ thống không tạo thêm bản ghi mới.");
      } else if (data?.duplicate?.near) {
        toast.warning(data.duplicate.message || "Ảnh này rất giống một phim xương đã upload trước đó.");
        setSessionUploadHashes((current) => new Set(current).add(duplicateKey));
      } else {
        setSessionUploadHashes((current) => new Set(current).add(duplicateKey));
        toast.success("Đã phân tích phim xương");
      }
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
              {medicalUser && (
                <div className="grid gap-2">
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

            {result.duplicate && (result.duplicate.exact || result.duplicate.near) && (
              <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-100">
                <div className="flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4" />
                  {result.duplicate.exact ? "File đã được upload trước đó" : "Ảnh gần giống phim đã upload"}
                </div>
                <p className="mt-1 text-xs leading-5">
                  {result.duplicate.message}
                  {result.duplicate.matched_record
                    ? ` Trùng/gần giống với ${result.duplicate.matched_record.filename} (${formatUploadTime(result.duplicate.matched_record.created_at)}).`
                    : ""}
                </p>
              </div>
            )}

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

        {medicalUser && (
          <section className="rounded-lg border border-border/70 bg-background/70 p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-lg font-semibold">Nhật ký upload phim xương</h2>
                <p className="text-xs text-muted-foreground">
                  Các file đã lưu có thể dùng để xem lại kết quả và làm dữ liệu train sau khi được gán nhãn.
                </p>
              </div>
              <Badge variant="outline">{history.length} lần upload</Badge>
            </div>
            <div className="mt-4 space-y-2">
              {history.length === 0 ? (
                <div className="rounded-md border border-dashed border-border bg-muted/15 p-4 text-sm text-muted-foreground">
                  Chưa có phim xương nào được lưu cho tài khoản này.
                </div>
              ) : (
                history.slice(0, 8).map((item) => (
                  <div key={item.id} className="rounded-md border border-border/60 bg-muted/15 p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{item.filename}</div>
                        <div className="text-xs text-muted-foreground">
                          {formatUploadTime(item.created_at)}
                          {item.modality ? ` • ${item.modality.toUpperCase()}` : ""}
                          {item.body_part ? ` • ${item.body_part}` : ""}
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
                        <Button type="button" size="sm" variant="outline" onClick={() => handleOpenUploadedFilm(item)}>
                          Xem phim
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
                    <div className="text-xs font-medium uppercase text-muted-foreground">Kết quả phim đã upload</div>
                    <h3 className="mt-1 text-base font-semibold">{selectedHistory.filename}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">{formatUploadTime(selectedHistory.created_at)}</p>
                  </div>
                  <Badge variant="outline">{imagePredictionLabel(getImageAnalysis(selectedHistory))}</Badge>
                </div>
                {getImageAnalysis(selectedHistory) && (
                  <>
                    <div className="mt-4 grid gap-3 md:grid-cols-3">
                      <Metric label="Nhãn AI" value={imagePredictionLabel(getImageAnalysis(selectedHistory))} />
                      <Metric label="Độ tin cậy" value={formatConfidence(getImageAnalysis(selectedHistory)?.prediction.confidence)} />
                      <Metric label="Modality" value={getImageAnalysis(selectedHistory)?.metadata.modality.toUpperCase() || "UNKNOWN"} />
                      <Metric label="Vùng xương" value={getImageAnalysis(selectedHistory)?.metadata.body_part || "Không rõ"} />
                      <Metric label="Vùng xương ước tính" value={formatPercent(getImageAnalysis(selectedHistory)?.features.estimated_bone_area_ratio)} />
                      <Metric label="Độ sắc nét" value={formatNumber(getImageAnalysis(selectedHistory)?.quality.sharpness_laplacian_var)} />
                    </div>
                    <div className="mt-4 rounded-md border border-border/60 bg-muted/15 p-3 text-sm">
                      <div className="font-medium">Ghi chú model</div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{getImageAnalysis(selectedHistory)?.prediction.note}</p>
                    </div>
                  </>
                )}
              </div>
            )}

            {compareItems.length > 0 && (
              <div className="mt-5 rounded-lg border border-border/70 bg-background/80 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-xs font-medium uppercase text-muted-foreground">So sánh 2 lần upload phim</div>
                    <h3 className="mt-1 text-base font-semibold">
                      {compareItems.length < 2 ? "Chọn thêm một phim để so sánh" : "Bảng thay đổi kết quả ảnh"}
                    </h3>
                  </div>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setCompareIds([])}>
                    Bỏ chọn
                  </Button>
                </div>
                {compareItems.length === 2 && (
                  <div className="mt-4 overflow-x-auto">
                    <div className="min-w-[760px] rounded-md border border-border/60">
                      <div className="grid grid-cols-[1fr_1fr_1fr_0.8fr_1.2fr] bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                        <div>Thông số</div>
                        <div>{formatUploadTime(compareItems[0].created_at)}</div>
                        <div>{formatUploadTime(compareItems[1].created_at)}</div>
                        <div>Thay đổi</div>
                        <div>Nhận xét</div>
                      </div>
                      {comparisonRows.map((row) => (
                        <div key={row.key} className="grid grid-cols-[1fr_1fr_1fr_0.8fr_1.2fr] border-t border-border/60 px-3 py-2 text-sm">
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

function buildImageConclusion(result: ImageAnalysisResponse) {
  const confidenceValue = typeof result.prediction.confidence === "number" ? result.prediction.confidence : null;
  const confidence = confidenceValue !== null ? `${(confidenceValue * 100).toFixed(2)}%` : null;
  const confidenceBand =
    confidenceValue === null
      ? null
      : confidenceValue >= 0.75
        ? "cao"
        : confidenceValue >= 0.5
          ? "trung bình"
          : "thấp";

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
        : confidenceValue !== null && confidenceValue < 0.5
          ? "border-rose-200 bg-rose-50 text-rose-950 dark:border-rose-700/40 dark:bg-rose-900/20 dark:text-rose-100"
          : "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-100",
      points: [
        `Nhãn AI: ${label}${confidence ? `, confidence ${confidence}` : ""}${confidenceBand ? `, mức chắc chắn ${confidenceBand}` : ""}.`,
        confidenceValue !== null && confidenceValue < 0.5
          ? "Độ tin cậy thấp: kết quả này chỉ nên xem như tín hiệu gợi ý, chưa đủ mạnh để kết luận trên một phim đơn lẻ."
          : "Kết quả có thể dùng để định hướng đọc phim, nhưng vẫn cần kiểm chứng trên phim gốc.",
        "Cần đối chiếu vị trí đau, điểm đau khu trú, sưng/nề, biến dạng, khả năng vận động, tiền sử chấn thương và thời điểm chụp.",
        "Nên kiểm tra thêm đường vỏ xương, khe khớp, trục xương, vùng mô mềm và so sánh với tư thế/chụp bổ sung nếu nghi ngờ.",
        result.safety_note,
      ],
    };
  }

  const points = [
    "Chưa có model AI đã huấn luyện được cấu hình, nên hệ thống chưa thể kết luận người bệnh bị gãy xương, viêm khớp, loãng xương hay bệnh lý cụ thể.",
    `Ảnh đã được tiền xử lý; vùng xương ước tính ${(result.features.estimated_bone_area_ratio * 100).toFixed(2)}%, độ tương phản ${result.quality.contrast_std}, độ sắc nét ${result.quality.sharpness_laplacian_var}.`,
  ];

  const hasModelCandidate = (result.prediction.probabilities?.length ?? 0) > 0 || (result.prediction.labels?.length ?? 0) > 0;
  if (hasModelCandidate) {
    points[0] = "Model AI hiện chưa đủ điều kiện tin cậy để kết luận bệnh lý cụ thể trên ảnh này, nên hệ thống chỉ hiển thị phân tích hỗ trợ.";
    if (result.prediction.note) points.splice(1, 0, result.prediction.note);
  }

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

function getImageAnalysis(item: UploadHistoryItem | null): ImageAnalysisResponse | null {
  if (!item || !item.analysis?.metadata || !item.analysis?.prediction) return null;
  return item.analysis as unknown as ImageAnalysisResponse;
}

function buildImageComparison(first?: UploadHistoryItem, second?: UploadHistoryItem) {
  const previous = getImageAnalysis(first ?? null);
  const current = getImageAnalysis(second ?? null);
  if (!previous || !current) return [];

  const rows = [
    {
      key: "label",
      name: "Nhãn AI",
      previous: imagePredictionLabel(previous),
      current: imagePredictionLabel(current),
      note: previous.prediction.top_label === current.prediction.top_label ? "Không đổi nhãn" : "Nhãn AI thay đổi",
    },
    {
      key: "confidence",
      name: "Độ tin cậy",
      previous: formatConfidence(previous.prediction.confidence),
      current: formatConfidence(current.prediction.confidence),
      ...deltaCell(previous.prediction.confidence, current.prediction.confidence, "Điểm confidence"),
    },
    {
      key: "bone_area",
      name: "Vùng xương ước tính",
      previous: formatPercent(previous.features.estimated_bone_area_ratio),
      current: formatPercent(current.features.estimated_bone_area_ratio),
      ...deltaCell(previous.features.estimated_bone_area_ratio, current.features.estimated_bone_area_ratio, "Tỷ lệ vùng xương"),
    },
    {
      key: "contrast",
      name: "Độ tương phản",
      previous: formatNumber(previous.quality.contrast_std),
      current: formatNumber(current.quality.contrast_std),
      ...deltaCell(previous.quality.contrast_std, current.quality.contrast_std, "Chất lượng ảnh"),
    },
    {
      key: "sharpness",
      name: "Độ sắc nét",
      previous: formatNumber(previous.quality.sharpness_laplacian_var),
      current: formatNumber(current.quality.sharpness_laplacian_var),
      ...deltaCell(previous.quality.sharpness_laplacian_var, current.quality.sharpness_laplacian_var, "Chất lượng ảnh"),
    },
    {
      key: "warnings",
      name: "Cảnh báo ảnh",
      previous: String(previous.quality.warnings.length),
      current: String(current.quality.warnings.length),
      ...deltaCell(previous.quality.warnings.length, current.quality.warnings.length, "Số cảnh báo chất lượng"),
    },
  ];

  return rows.map((row) => ({
    delta: "-",
    deltaClassName: "text-muted-foreground",
    ...row,
  }));
}

function deltaCell(previous?: number | null, current?: number | null, note = "Thay đổi") {
  if (typeof previous !== "number" || typeof current !== "number") {
    return { delta: "-", deltaClassName: "text-muted-foreground", note };
  }
  const delta = current - previous;
  return {
    delta: `${delta > 0 ? "+" : ""}${Number(delta.toFixed(3))}`,
    deltaClassName:
      delta > 0 ? "text-amber-700" : delta < 0 ? "text-emerald-700" : "text-muted-foreground",
    note,
  };
}

function imagePredictionLabel(result: ImageAnalysisResponse | null) {
  if (!result) return "Không có dữ liệu";
  if (result.prediction.top_label) return labelToVietnamese(result.prediction.top_label);
  return result.prediction.status === "model_prediction" ? "Có dự đoán AI" : "Analysis only";
}

function formatConfidence(value?: number | null) {
  return typeof value === "number" ? `${(value * 100).toFixed(2)}%` : "Không có";
}

function formatPercent(value?: number | null) {
  return typeof value === "number" ? `${(value * 100).toFixed(2)}%` : "Không có";
}

function formatNumber(value?: number | null) {
  return typeof value === "number" ? String(Number(value.toFixed(2))) : "Không có";
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, LogIn, ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  clearMedicalAuthSession,
  getMedicalAuthToken,
  getMedicalAuthUser,
  saveMedicalAuthSession,
  type MedicalAuthSession,
  type MedicalUser,
} from "@/lib/medical-auth";
import { cn } from "@/lib/utils";

type Mode = "login" | "register";

export function MedicalLogin() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<MedicalUser | null>(null);

  useEffect(() => {
    setCurrentUser(getMedicalAuthUser());
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!username.trim()) {
      toast.error("Vui lòng nhập tên đăng nhập");
      return;
    }
    if (password.length < 8) {
      toast.error("Mật khẩu tối thiểu 8 ký tự");
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/medical-auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: username.trim(),
          password,
          ...(mode === "register" ? { full_name: fullName.trim() || undefined } : {}),
        }),
      });
      const data = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(data?.detail || "Không đăng nhập được");
      }

      const session = data as MedicalAuthSession;
      saveMedicalAuthSession(session);
      setCurrentUser(session.user);
      toast.success(mode === "register" ? "Đã tạo tài khoản" : "Đăng nhập thành công");
      router.push("/medical-images");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Có lỗi khi đăng nhập");
    } finally {
      setIsLoading(false);
    }
  };

  const logout = () => {
    clearMedicalAuthSession();
    setCurrentUser(null);
    toast.success("Đã đăng xuất");
  };

  const verifySession = async () => {
    const token = getMedicalAuthToken();
    if (!token) {
      toast.error("Chưa có phiên đăng nhập");
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/medical-auth/me", {
        headers: { authorization: `Bearer ${token}` },
      });
      const data = await readJsonResponse(response);
      if (!response.ok) {
        throw new Error(data?.detail || "Phiên đăng nhập không hợp lệ");
      }
      localStorage.setItem("medical-auth-user", JSON.stringify(data));
      setCurrentUser(data);
      toast.success("Phiên đăng nhập hợp lệ");
    } catch (error) {
      clearMedicalAuthSession();
      setCurrentUser(null);
      toast.error(error instanceof Error ? error.message : "Phiên đăng nhập không hợp lệ");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-dvh w-full overflow-y-auto px-4 py-8 sm:px-6">
      <div className="mx-auto grid w-full max-w-5xl gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="pl-10 sm:pl-12">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Bảo mật dữ liệu người bệnh
          </div>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">Đăng nhập tài khoản y tế</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            Tài khoản này dùng cho các tính năng cần xem hoặc lưu thông tin chi tiết người bệnh. Mỗi user chỉ truy cập được hồ sơ do mình tạo, trừ tài khoản admin.
          </p>

          {currentUser && (
            <div className="mt-6 rounded-lg border border-emerald-200/70 bg-emerald-50/70 p-4 text-sm text-emerald-900 dark:border-emerald-700/40 dark:bg-emerald-900/20 dark:text-emerald-100">
              <div className="font-semibold">Đang đăng nhập</div>
              <div className="mt-1">{currentUser.full_name || currentUser.username}</div>
              <div className="text-xs opacity-80">Role: {currentUser.role}</div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => router.push("/medical-images")}>
                  Upload phim
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={verifySession} disabled={isLoading}>
                  Kiểm tra phiên
                </Button>
                <Button type="button" size="sm" variant="destructive" onClick={logout}>
                  Đăng xuất
                </Button>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-lg border border-border/70 bg-background/70 p-5 shadow-sm">
          <div className="mb-5 grid grid-cols-2 rounded-md border border-border/70 bg-muted/20 p-1">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={cn(
                "rounded-sm px-3 py-2 text-sm font-medium transition-colors",
                mode === "login" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Đăng nhập
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              className={cn(
                "rounded-sm px-3 py-2 text-sm font-medium transition-colors",
                mode === "register" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Đăng ký
            </button>
          </div>

          <form className="space-y-4" onSubmit={submit}>
            <div className="grid gap-2">
              <Label htmlFor="medical-username">Tên đăng nhập</Label>
              <Input
                id="medical-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="vd: bacsi01"
                autoComplete="username"
              />
            </div>

            {mode === "register" && (
              <div className="grid gap-2">
                <Label htmlFor="medical-fullname">Họ tên</Label>
                <Input
                  id="medical-fullname"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  placeholder="vd: Nguyễn Văn A"
                  autoComplete="name"
                />
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="medical-password">Mật khẩu</Label>
              <div className="relative">
                <Input
                  id="medical-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Tối thiểu 8 ký tự"
                  autoComplete={mode === "register" ? "new-password" : "current-password"}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : mode === "register" ? (
                <UserPlus className="h-4 w-4" />
              ) : (
                <LogIn className="h-4 w-4" />
              )}
              {mode === "register" ? "Tạo tài khoản" : "Đăng nhập"}
            </Button>
          </form>
        </section>
      </div>
    </div>
  );
}

async function readJsonResponse(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return {
      detail: response.ok
        ? text
        : `Backend đăng nhập trả về lỗi không phải JSON: ${text.slice(0, 160)}`,
    };
  }
}

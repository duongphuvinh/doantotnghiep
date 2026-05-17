export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_BACKEND_URL = "http://localhost:8000";
const allowedActions = new Set(["register", "login", "me"]);

interface Params {
  params: Promise<{
    action: string;
  }>;
}

export async function POST(req: Request, { params }: Params) {
  const { action } = await params;
  if (!allowedActions.has(action) || action === "me") {
    return Response.json({ detail: "Unsupported auth action" }, { status: 404 });
  }

  return proxyAuthRequest(req, action, "POST");
}

export async function GET(req: Request, { params }: Params) {
  const { action } = await params;
  if (action !== "me") {
    return Response.json({ detail: "Unsupported auth action" }, { status: 404 });
  }

  return proxyAuthRequest(req, action, "GET");
}

async function proxyAuthRequest(req: Request, action: string, method: "GET" | "POST") {
  const backendUrl =
    process.env.MEDICAL_IMAGE_API_URL ||
    process.env.NEXT_PUBLIC_MEDICAL_IMAGE_API_URL ||
    DEFAULT_BACKEND_URL;

  const headers: HeadersInit = {
    "content-type": "application/json",
  };
  const authorization = req.headers.get("authorization");
  if (authorization) {
    headers.authorization = authorization;
  }

  try {
    const response = await fetch(`${backendUrl.replace(/\/$/, "")}/api/auth/${action}`, {
      method,
      headers,
      body: method === "POST" ? await req.text() : undefined,
    });

    const contentType = response.headers.get("content-type") || "application/json";
    const body = await response.text();

    return new Response(body, {
      status: response.status,
      headers: {
        "content-type": contentType,
      },
    });
  } catch (error) {
    return Response.json(
      {
        detail:
          "Không kết nối được backend đăng nhập ở " +
          `${backendUrl}. Hãy chạy medical-image-backend bằng lệnh: ` +
          "`uvicorn app.main:app --reload --port 8000`. " +
          (error instanceof Error ? `Chi tiết: ${error.message}` : ""),
      },
      { status: 502 }
    );
  }
}


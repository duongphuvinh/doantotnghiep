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

    const contentType = response.headers.get("content-type") || "";
    const body = await response.text();
    const isJson = contentType.includes("application/json");

    if (!isJson) {
      return Response.json(
        {
          detail: response.ok
            ? body
            : `Medical backend returned non-JSON error: ${body || response.statusText}`,
        },
        { status: response.status }
      );
    }

    return new Response(body, {
      status: response.status,
      headers: {
        "content-type": "application/json",
      },
    });
  } catch (error) {
    return Response.json(
      {
        detail:
          "KhÃ´ng káº¿t ná»‘i Ä‘Æ°á»£c backend Ä‘Äƒng nháº­p á»Ÿ " +
          `${backendUrl}. HÃ£y cháº¡y backend trong thÆ° má»¥c mcp-server báº±ng lá»‡nh: ` +
          "`uvicorn app.main:app --reload --port 8000`. " +
          (error instanceof Error ? `Chi tiáº¿t: ${error.message}` : ""),
      },
      { status: 502 }
    );
  }
}



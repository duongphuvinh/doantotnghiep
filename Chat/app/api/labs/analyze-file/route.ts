export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { normalizeLabAnalyzeResponse } from "@/lib/lab-result-normalizer";

const DEFAULT_BACKEND_URL = "http://localhost:8000";

export async function POST(req: Request) {
  const backendUrl =
    process.env.MEDICAL_IMAGE_API_URL ||
    process.env.NEXT_PUBLIC_MEDICAL_IMAGE_API_URL ||
    DEFAULT_BACKEND_URL;

  const authorization = req.headers.get("authorization");
  if (!authorization) {
    return Response.json(
      { detail: "Vui lÃ²ng Ä‘Äƒng nháº­p trÆ°á»›c khi upload phiáº¿u xÃ©t nghiá»‡m" },
      { status: 401 }
    );
  }

  try {
    const response = await fetch(`${backendUrl.replace(/\/$/, "")}/api/labs/analyze-file`, {
      method: "POST",
      headers: { authorization },
      body: await req.formData(),
    });

    const contentType = response.headers.get("content-type") || "application/json";
    const body = await response.text();
    if (response.ok && contentType.includes("application/json")) {
      return Response.json(normalizeLabAnalyzeResponse(JSON.parse(body)), { status: response.status });
    }

    return new Response(body, {
      status: response.status,
      headers: { "content-type": contentType },
    });
  } catch (error) {
    return Response.json(
      {
        detail:
          "KhÃ´ng káº¿t ná»‘i Ä‘Æ°á»£c backend upload xÃ©t nghiá»‡m á»Ÿ " +
          `${backendUrl}. HÃ£y cháº¡y backend trong thÆ° má»¥c mcp-server báº±ng lá»‡nh: ` +
          "`uvicorn app.main:app --reload --port 8000`. " +
          (error instanceof Error ? `Chi tiáº¿t: ${error.message}` : ""),
      },
      { status: 502 }
    );
  }
}



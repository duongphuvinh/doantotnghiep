export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_BACKEND_URL = "http://localhost:8000";

export async function POST(req: Request) {
  const backendUrl =
    process.env.MEDICAL_IMAGE_API_URL ||
    process.env.NEXT_PUBLIC_MEDICAL_IMAGE_API_URL ||
    DEFAULT_BACKEND_URL;

  const authorization = req.headers.get("authorization");
  if (!authorization) {
    return Response.json(
      { detail: "Vui lÃ²ng Ä‘Äƒng nháº­p trÆ°á»›c khi cháº¡y phÃ¢n tÃ­ch Ä‘a phÆ°Æ¡ng thá»©c" },
      { status: 401 }
    );
  }

  try {
    const response = await fetch(`${backendUrl.replace(/\/$/, "")}/api/multimodal/analyze`, {
      method: "POST",
      headers: { authorization },
      body: await req.formData(),
    });

    const contentType = response.headers.get("content-type") || "application/json";
    const body = await response.text();
    return new Response(body, { status: response.status, headers: { "content-type": contentType } });
  } catch (error) {
    return Response.json(
      {
        detail:
          "KhÃ´ng káº¿t ná»‘i Ä‘Æ°á»£c backend fusion á»Ÿ " +
          `${backendUrl}. HÃ£y cháº¡y backend trong thÆ° má»¥c mcp-server báº±ng lá»‡nh: ` +
          "`uvicorn app.main:app --reload --port 8000`. " +
          (error instanceof Error ? `Chi tiáº¿t: ${error.message}` : ""),
      },
      { status: 502 }
    );
  }
}




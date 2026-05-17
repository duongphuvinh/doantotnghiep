export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_BACKEND_URL = "http://localhost:8000";

export async function GET(req: Request) {
  const backendUrl =
    process.env.MEDICAL_IMAGE_API_URL ||
    process.env.NEXT_PUBLIC_MEDICAL_IMAGE_API_URL ||
    DEFAULT_BACKEND_URL;
  const authorization = req.headers.get("authorization");
  if (!authorization) {
    return Response.json({ detail: "Vui lòng đăng nhập" }, { status: 401 });
  }

  try {
    const response = await fetch(`${backendUrl.replace(/\/$/, "")}/api/evaluation/runs/metrics`, {
      headers: { authorization },
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") || "application/json" },
    });
  } catch (error) {
    return Response.json(
      { detail: error instanceof Error ? error.message : "Không kết nối được backend" },
      { status: 502 }
    );
  }
}


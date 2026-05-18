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
    return Response.json({ detail: "Vui lòng đăng nhập để xem nhật ký upload" }, { status: 401 });
  }

  const sourceUrl = new URL(req.url);
  const targetUrl = new URL(`${backendUrl.replace(/\/$/, "")}/api/uploads`);
  const uploadType = sourceUrl.searchParams.get("upload_type");
  if (uploadType) targetUrl.searchParams.set("upload_type", uploadType);

  try {
    const response = await fetch(targetUrl, {
      headers: { authorization },
    });
    const contentType = response.headers.get("content-type") || "application/json";
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: { "content-type": contentType },
    });
  } catch (error) {
    return Response.json(
      {
        detail:
          "Không kết nối được backend nhật ký upload ở " +
          `${backendUrl}. Hãy chạy backend trong thư mục mcp-server. ` +
          (error instanceof Error ? `Chi tiết: ${error.message}` : ""),
      },
      { status: 502 }
    );
  }
}

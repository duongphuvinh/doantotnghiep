export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_BACKEND_URL = "http://localhost:8000";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const backendUrl =
    process.env.MEDICAL_IMAGE_API_URL ||
    process.env.NEXT_PUBLIC_MEDICAL_IMAGE_API_URL ||
    DEFAULT_BACKEND_URL;
  const authorization = req.headers.get("authorization");
  if (!authorization) {
    return Response.json({ detail: "Vui lòng đăng nhập để xem lại file đã upload" }, { status: 401 });
  }

  const { id } = await params;
  try {
    const response = await fetch(`${backendUrl.replace(/\/$/, "")}/api/uploads/${id}/file`, {
      headers: { authorization },
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        "content-type": response.headers.get("content-type") || "application/octet-stream",
        "content-disposition": response.headers.get("content-disposition") || "inline",
      },
    });
  } catch (error) {
    return Response.json(
      {
        detail:
          "Không kết nối được backend để mở file đã upload. " +
          (error instanceof Error ? `Chi tiết: ${error.message}` : ""),
      },
      { status: 502 }
    );
  }
}

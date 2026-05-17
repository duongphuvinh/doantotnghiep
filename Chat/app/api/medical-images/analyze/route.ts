export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_BACKEND_URL = 'http://localhost:8000';

export async function POST(req: Request) {
  const backendUrl =
    process.env.MEDICAL_IMAGE_API_URL ||
    process.env.NEXT_PUBLIC_MEDICAL_IMAGE_API_URL ||
    DEFAULT_BACKEND_URL;

  const formData = await req.formData();

  try {
    const response = await fetch(`${backendUrl.replace(/\/$/, '')}/api/images/analyze`, {
      method: 'POST',
      body: formData,
    });

    const contentType = response.headers.get('content-type') || 'application/json';
    const body = await response.text();

    return new Response(body, {
      status: response.status,
      headers: {
        'content-type': contentType,
      },
    });
  } catch (error) {
    return Response.json(
      {
        detail:
          'Không kết nối được backend xử lý ảnh ở ' +
          `${backendUrl}. Hãy chạy medical-image-backend bằng lệnh: ` +
          '`uvicorn app.main:app --reload --port 8000`. ' +
          (error instanceof Error ? `Chi tiết: ${error.message}` : ''),
      },
      { status: 502 }
    );
  }
}

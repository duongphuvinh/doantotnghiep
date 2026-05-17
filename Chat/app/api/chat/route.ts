import { model, type modelID } from '@/ai/providers';
import { smoothStream, streamText, StreamData, type UIMessage } from 'ai';
import { appendResponseMessages } from 'ai';
import { nanoid } from 'nanoid';
import { initializeMCPClients, type MCPServerConfig } from '@/lib/mcp-client';

export const runtime = 'nodejs';

// Allow streaming responses up to 60 seconds
export const maxDuration = 60;

export const dynamic = 'force-dynamic';

const MEDICAL_BACKEND_URL =
  process.env.MEDICAL_IMAGE_API_URL ||
  process.env.NEXT_PUBLIC_MEDICAL_IMAGE_API_URL ||
  'http://localhost:8000';

function getLastUserText(msgs: UIMessage[]) {
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m: any = msgs[i];
    if (m?.role === 'user') {
      const parts = Array.isArray(m?.parts) ? m.parts : [];
      const text = parts
        .filter((p: any) => p?.type === 'text')
        .map((p: any) => String(p?.text ?? ''))
        .join('\n');
      return text || String(m?.content ?? '');
    }
  }
  return '';
}

function normalizeVietnamese(text: string) {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function asksForPatientPrivateInfo(text: string) {
  const normalized = normalizeVietnamese(text);

  const patientTerms = [
    'nguoi benh',
    'benh nhan',
    'ho so benh',
    'ho so dieu tri',
    'thong tin dieu tri',
    'thong tin benh nhan',
    'thong tin nguoi benh',
    'ma nguoi benh',
    'manguoibenh',
    'ma benh nhan',
    'patient',
    'medical record',
  ];

  const privateDataTerms = [
    'ho ten',
    'ten',
    'ngay kham',
    'ngay dieu tri',
    'chan doan',
    'ket qua dieu tri',
    'lich su',
    'xem',
    'tim',
    'tra cuu',
    'lay',
    'cho toi biet',
    'chi tiet',
  ];

  const hasPatientTerm = patientTerms.some((term) => normalized.includes(term));
  const hasPrivateDataTerm = privateDataTerms.some((term) => normalized.includes(term));
  const hasLikelyPatientCode = /\b(?:BN|NB|MR|PT)[-_]?\d{2,}\b/i.test(text) || /\b\d{5,}\b/.test(text);

  return hasPatientTerm && (hasPrivateDataTerm || hasLikelyPatientCode);
}

async function verifyMedicalAuthToken(token: string) {
  if (!token) return false;

  try {
    const response = await fetch(`${MEDICAL_BACKEND_URL.replace(/\/$/, '')}/api/auth/me`, {
      headers: {
        authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });
    return response.ok;
  } catch (error) {
    console.error('Medical auth verification failed:', error);
    return false;
  }
}

export async function POST(req: Request) {
  const {
    messages,
    chatId,
    selectedModel,
    userId,
    medicalAuthToken,
    mcpServers = [],
  }: {
    messages: UIMessage[];
    chatId?: string;
    selectedModel: modelID;
    userId: string;
    medicalAuthToken?: string;
    mcpServers?: MCPServerConfig[];
  } = await req.json();

  if (!userId) {
    return new Response(JSON.stringify({ error: 'User ID is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const id = chatId || nanoid();
  const lastUserText = getLastUserText(messages);

  if (asksForPatientPrivateInfo(lastUserText)) {
    const isMedicalUserLoggedIn = await verifyMedicalAuthToken(medicalAuthToken || '');
    if (!isMedicalUserLoggedIn) {
      return new Response(
        JSON.stringify({
          error:
            'Bạn cần đăng nhập tài khoản y tế trước khi hỏi/xem thông tin chi tiết của một người bệnh. ' +
            'Các câu hỏi kiến thức y tế chung vẫn có thể sử dụng không cần đăng nhập.',
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  // Initialize MCP clients using the already running persistent SSE servers
  // mcpServers now only contains SSE configurations since stdio servers
  // have been converted to SSE in the MCP context
  const { tools, cleanup } = await initializeMCPClients(mcpServers, req.signal);

  console.log('messages', messages);
  console.log(
    'parts',
    messages.map((m) => m.parts.map((p) => p))
  );

  // Track if the response has completed
  let responseCompleted = false;

  // StreamData lets us append structured data (e.g., verification score)
  // after the model finishes streaming its main answer.
  const data = new StreamData();

  const result = streamText({
    model: model.languageModel(selectedModel),
    system: `
    Bạn là một trợ lý hữu ích với khả năng truy cập nhiều công cụ khác nhau.

Múi giờ hiện tại: GMT+7.
Ngày hôm nay là: ${new Date().toISOString().split('T')[0]} (tính theo GMT+7).

Bạn có thể sử dụng các công cụ được cung cấp để hỗ trợ người dùng tốt nhất. Hãy luôn lựa chọn những công cụ phù hợp với câu hỏi của người dùng (có thể sử dụng nhiều công cụ).

Nếu không có công cụ thích hợp, hãy trả lời rằng bạn không biết. Nếu người dùng muốn bổ sung công cụ, hãy hướng dẫn họ thêm từ biểu tượng server ở góc dưới bên trái của sidebar.

Luôn trả lời sau khi dùng công cụ, đảm bảo trải nghiệm nhất quán. Mỗi lần chỉ được sử dụng một công cụ. Nếu có nhiều cách giải quyết, hãy chọn công cụ phù hợp nhất.

QUY TẮC KIỂM CHỨNG (RẤT QUAN TRỌNG, NHẤT LÀ CHỦ ĐỀ Y TẾ):
- Nếu câu trả lời có sử dụng kiến thức KHÔNG nằm trong dữ liệu cục bộ / không lấy từ các công cụ RAG (ví dụ tool "healthcare", "medical_record"), hãy **gọi công cụ "verify_health_answer" trước khi kết luận**.
- Sau khi verify, hãy tóm tắt kết quả (score + cảnh báo nếu điểm thấp) và chỉ kết luận chắc chắn khi score cao.
- Nếu score thấp/trung bình: trả lời thận trọng, khuyên người dùng tham khảo nguồn chính thống/bác sĩ.
    `,
    messages,
    tools,
    maxSteps: 20,
    providerOptions: {
      google: {
        thinkingConfig: {
          thinkingBudget: 2048,
        },
      },
      anthropic: {
        thinking: {
          type: 'enabled',
          budgetTokens: 12000,
        },
      },
    },
    experimental_transform: smoothStream({
      delayInMs: 5, // optional: defaults to 10ms
      chunking: 'line', // optional: defaults to 'word'
    }),
    onError: (error) => {
      console.error(JSON.stringify(error, null, 2));
    },
    async onFinish(event: any) {
      responseCompleted = true;

      // -----------------------------
      // AUTO VERIFY (server-enforced)
      // -----------------------------
      // If the model did NOT use local RAG tools, we automatically run a verification
      // pass and attach the score + details as message annotations.
      try {
        const steps = event?.steps ?? [];
        const usedLocalRag = Array.isArray(steps)
          ? steps.some((s: any) => {
              const calls = s?.toolCalls ?? s?.toolInvocations ?? [];
              return Array.isArray(calls)
                ? calls.some((c: any) =>
                    ['healthcare', 'medical_record'].includes(
                      String(c?.toolName ?? c?.name ?? '')
                    )
                  )
                : false;
            })
          : false;

        // If we can't detect tool usage, we still verify (safer for healthcare).
        const shouldVerify = !usedLocalRag;

        if (shouldVerify && tools?.verify_health_answer?.execute) {
          const question = getLastUserText(messages);
          const answerText = String(event?.text ?? '');

          // Skip if we somehow have no assistant text
          if (answerText.trim().length > 0) {
            const verify = await tools.verify_health_answer.execute({
              question,
              answer: answerText,
            });

            // Attach as message annotation so the UI can render it nicely.
            data.appendMessageAnnotation({
              type: 'verification',
              ...verify,
            });
          }
        }
      } catch (e) {
        console.error('Auto verification error:', e);
      } finally {
        try {
          data.close();
        } catch {}
      }

      // Clean up resources - now this just closes the client connections
      // not the actual servers which persist in the MCP context
      await cleanup();
    },
  });

  // Ensure cleanup happens if the request is terminated early
  req.signal.addEventListener('abort', async () => {
    if (!responseCompleted) {
      console.log('Request aborted, cleaning up resources');
      try {
        await cleanup();
      } catch (error) {
        console.error('Error during cleanup on abort:', error);
      }
    }
  });

  result.consumeStream();
  // Add chat ID to response headers so client can know which chat was created
  return result.toDataStreamResponse({
    sendReasoning: true,
    data,
    headers: {
      'X-Chat-ID': id,
    },
    getErrorMessage: (error) => {
      if (error instanceof Error) {
        if (error.message.includes('Rate limit')) {
          return 'Rate limit exceeded. Please try again later.';
        }
      }
      console.error(error);
      return 'An error occurred.';
    },
  });
}

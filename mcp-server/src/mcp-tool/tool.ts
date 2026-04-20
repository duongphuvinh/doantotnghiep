import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'; 
import * as z from 'zod';
import { callGemini, callGeminiEmbedModel } from '../lib/gimini';
import { pool_pg, query } from '../lib/db_pg';

// -----------------------------
// Reliability / Fact-check tools
// -----------------------------

type WebResult = { title?: string; url?: string; content?: string };

function stripCodeFences(s: string) {
  // remove ```json ... ``` wrappers if the model adds them
  return s.replace(/```[a-z]*\s*/gi, '').replace(/```/g, '').trim();
}

function safeJson<T>(raw: string, fallback: T): T {
  try {
    const cleaned = stripCodeFences(raw);
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

async function tavilySearch(query: string, k = 5): Promise<WebResult[]> {
  const apiKey = process.env['TAVILY_API_KEY'];
  if (!apiKey) return [];

  // Domain allowlist (healthcare-safe defaults).
  // Override via env HEALTH_ALLOWED_DOMAINS, comma-separated.
  // Example: HEALTH_ALLOWED_DOMAINS="who.int,cdc.gov,nhs.uk,moh.gov.vn,umc.edu.vn"
  const defaultAllowed = [
    // global / US / UK authoritative
    'who.int',
    'cdc.gov',
    'nih.gov',
    'medlineplus.gov',
    'ncbi.nlm.nih.gov',
    'nhs.uk',
    // clinical references (still curated)
    'mayoclinic.org',
    'clevelandclinic.org',
    // Vietnam
    'moh.gov.vn',
    'umc.edu.vn',
  ];

  const allowedDomains = (process.env['HEALTH_ALLOWED_DOMAINS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const includeDomains = (allowedDomains.length ? allowedDomains : defaultAllowed).slice(0, 40);

  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: k,
      include_domains: includeDomains,
      // If your project is healthcare-focused, this helps reduce junk results
      include_answer: false,
      include_raw_content: false,
    }),
  });

  if (!r.ok) return [];
  const data: any = await r.json();
  const results: any[] = data?.results ?? [];
  // Extra safety: filter by hostname as a second line of defense
  const filtered = results.filter((x) => {
    const url = String(x?.url ?? '');
    if (!url) return false;
    try {
      const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
      return includeDomains.some((d) => host === d || host.endsWith(`.${d}`));
    } catch {
      return false;
    }
  });

  return filtered.map((x) => ({
    title: x?.title,
    url: x?.url,
    content: x?.content ?? x?.snippet,
  }));
}

async function extractClaims(answer: string): Promise<string[]> {
  const prompt = `
Bạn là bộ tách "claim" để kiểm chứng.

Hãy trích xuất các mệnh đề (claim) có thể kiểm chứng từ câu trả lời dưới đây.
- Mỗi claim là 1 câu khẳng định ngắn gọn.
- Tối đa 8 claim.
- Trả về JSON array đúng format, ví dụ: ["claim 1", "claim 2"].

CÂU TRẢ LỜI:
${answer}
  `;

  const raw = await callGemini(prompt, { model: 'gemini-2.5-flash' });
  const claims = safeJson<string[]>(raw, []);
  // fallback if model returns plain text lines
  if (!Array.isArray(claims) || claims.length === 0) {
    return raw
      .split(/\r?\n/)
      .map((x) => x.replace(/^[-*\d.\s]+/, '').trim())
      .filter(Boolean)
      .slice(0, 8);
  }
  return claims.filter(Boolean).slice(0, 8);
}

async function judgeClaim(claim: string, evidences: WebResult[]): Promise<{ label: 'SUPPORTED' | 'NOT_SUPPORTED' | 'CONTRADICTED'; confidence: number; rationale: string; best_sources: string[] }> {
  const ev = evidences.slice(0, 3);
  const evText = ev
    .map((e, i) => `[#${i + 1}] URL: ${e.url}\nSnippet: ${(e.content ?? '').slice(0, 800)}`)
    .join('\n\n');

  const prompt = `
Bạn là bộ kiểm chứng thông tin (fact-checker) cho chatbot y tế.

Nhiệm vụ: đánh giá claim bên dưới dựa trên các bằng chứng (evidence snippets).

CLAIM: ${claim}

EVIDENCES:
${evText || '(không có evidence)'}

Hãy trả về JSON đúng format:
{
  "label": "SUPPORTED" | "NOT_SUPPORTED" | "CONTRADICTED",
  "confidence": 0-1,
  "rationale": "giải thích ngắn 1-2 câu",
  "best_sources": ["url1","url2"]
}

Quy tắc chấm:
- SUPPORTED: evidence nói rõ hoặc suy ra trực tiếp.
- CONTRADICTED: evidence nói ngược lại.
- NOT_SUPPORTED: evidence không đủ.
  `;

  const raw = await callGemini(prompt, { model: 'gemini-2.5-flash' });
  const out = safeJson<any>(raw, null);

  const label = (out?.label ?? 'NOT_SUPPORTED') as any;
  const confidence = clamp(Number(out?.confidence ?? 0.3), 0, 1);
  const rationale = String(out?.rationale ?? '').slice(0, 400);
  const best_sources = Array.isArray(out?.best_sources) ? out.best_sources.slice(0, 3) : [];

  return {
    label: ['SUPPORTED', 'NOT_SUPPORTED', 'CONTRADICTED'].includes(label) ? label : 'NOT_SUPPORTED',
    confidence,
    rationale: rationale || '(no rationale)',
    best_sources,
  };
}

function computeScore(judgments: Array<{ label: string; confidence: number }>): number {
  if (!judgments.length) return 0;
  const total = judgments.length;
  const supported = judgments.filter((j) => j.label === 'SUPPORTED').length;
  const contrad = judgments.filter((j) => j.label === 'CONTRADICTED').length;
  const avgConf = judgments.reduce((s, j) => s + (j.confidence ?? 0), 0) / total;

  const coverage = supported / total; // 0..1
  const contradiction = contrad / total; // 0..1

  // Simple, explainable scoring for thesis
  const raw = 100 * (0.65 * coverage + 0.35 * avgConf - 0.8 * contradiction);
  return clamp(raw, 0, 100);
}


const gioi_thieu : any = async () => 
            { return { 
                content: [{ 
                    type: 'text', 
                    text: `
---
# Giới Thiệu Bệnh Viện

## 1. Tổng Quan
Bệnh viện **[Tên Bệnh Viện]** là cơ sở y tế đa khoa với nhiệm vụ chăm sóc, bảo vệ và nâng cao sức khỏe cộng đồng. Với đội ngũ y bác sĩ có trình độ chuyên môn cao, hệ thống trang thiết bị hiện đại và quy trình khám chữa bệnh chuyên nghiệp, bệnh viện hướng đến việc trở thành địa chỉ tin cậy cho người dân trong khu vực và trên cả nước.

---

## 2. Tầm Nhìn – Sứ Mệnh – Giá Trị Cốt Lõi

### Tầm Nhìn
Trở thành bệnh viện hàng đầu trong khu vực, tiên phong ứng dụng công nghệ vào y tế và cung cấp dịch vụ chăm sóc sức khỏe chất lượng cao.

### Sứ Mệnh
- Cung cấp dịch vụ khám chữa bệnh an toàn, hiệu quả, nhanh chóng.
- Luôn đặt người bệnh làm trung tâm trong mọi hoạt động.
- Không ngừng đổi mới, ứng dụng khoa học kỹ thuật hiện đại.

### Giá Trị Cốt Lõi
- Tận tâm  
- Chất lượng  
- Chuyên nghiệp  
- Hiệu quả  
- Đổi mới

---

## 3. Cơ Sở Vật Chất – Trang Thiết Bị
- Hệ thống phòng khám chuyên khoa khang trang, sạch sẽ.
- Khu cận lâm sàng với các thiết bị hiện đại như MRI, CT-Scan, X-Quang kỹ thuật số, siêu âm 4D.
- Phòng phẫu thuật vô khuẩn một chiều.
- Hệ thống xét nghiệm đạt tiêu chuẩn chất lượng.
- Khu nội trú tiện nghi dành cho bệnh nhân và người nhà.

---

## 4. Đội Ngũ Nhân Sự
- Bao gồm các chuyên gia đầu ngành, thạc sĩ, bác sĩ chuyên khoa I, II.
- Đội ngũ điều dưỡng, kỹ thuật viên được đào tạo bài bản.
- Thường xuyên tham gia đào tạo, hội thảo và chuyển giao kỹ thuật.

---

## 5. Các Chuyên Khoa
- Nội tổng hợp  
- Ngoại tổng hợp  
- Sản – Nhi  
- Tai Mũi Họng  
- Mắt  
- Răng Hàm Mặt  
- Hồi sức – Cấp cứu  
- Xét nghiệm – Chẩn đoán hình ảnh  
- Y học cổ truyền – Phục hồi chức năng  

---

## 6. Dịch Vụ Nổi Bật
- Khám sức khỏe tổng quát
- Khám theo yêu cầu
- Phẫu thuật nội soi
- Điều trị ngoại trú
- Cấp cứu 24/7
- Tư vấn dinh dưỡng và chăm sóc sau điều trị
- Hồ sơ sức khỏe điện tử – đăng ký khám trực tuyến

---

## 7. Thành Tựu – Định Hướng Phát Triển
- Ứng dụng công nghệ số trong quản lý bệnh viện.
- Phát triển mô hình bệnh viện thông minh.
- Nâng cao chất lượng khám chữa bệnh theo các tiêu chuẩn quốc tế.
- Mở rộng quy mô giường bệnh và nâng cấp các phòng chuyên môn.

---

## 8. Thông Tin Liên Hệ
- Địa chỉ: [Điền địa chỉ]
- Điện thoại: [Số điện thoại]
- Email: [Email liên hệ]
- Website: [Website bệnh viện]
- Thời gian làm việc: [Giờ làm việc]


                    ` 
                }] 
            }; 
        } ;

export function registerGioiThieu(mcpServer: McpServer) { 
    mcpServer.registerTool('gioi_thieu_tong_quan_benh_vien', 
        {   title: 'Giới thiệu bệnh viện, các đơn vị, khoa, chuyên khoa, phòng', 
            description: 'Giới thiệu bệnh viện, các đơn vị, khoa, chuyên khoa, phòng', 
        },
         gioi_thieu
        ); 
    }

const healthcare_para:any= {
      title:
        "Bao gồm mọi câu hỏi về sức khỏe và y tế; bệnh tật; và các thắc mắc thường gặp của người bệnh.",
      description:
        "Bao gồm mọi câu hỏi về sức khỏe và y tế; bệnh tật; và các thắc mắc thường gặp của người bệnh.",
      inputSchema: {
        message: z.string().describe("Nội dung câu hỏi của người dùng"),
      },
    }

const healthcare :any = async ({ message }:any) => {
      message = (message ?? "").toLowerCase();

      const sql = `
            SELECT *
            FROM public.articles
            WHERE embedding IS NOT NULL
            ORDER BY embedding <=> $1::vector
            LIMIT 10;

      `;

      const queryEmbeddingStr = await callGeminiEmbedModel(
        message,
        {},
        sql
      );

      // Truy vấn PostgreSQL tìm bài tương tự
      const client = await pool_pg.connect();
      const result = await client.query(sql, [queryEmbeddingStr]);
      client.release();

      // Gộp context
      let context = result.rows
        .map(
          (r:any, i:any) =>
            `# **${i + 1}. ${r.title}**\n${r.content}`
        )
        .join("\n\n");

      if (context?.length > 0) {
        context = `
Dưới đây là các tài liệu tham khảo, mỗi mục là một bài viết có tiêu đề và nội dung.
Hãy sử dụng thông tin này để trả lời câu hỏi của người dùng thật chính xác, súc tích, và trung lập.

=== KIẾN THỨC THAM KHẢO ===
${context}
        `;
      }

      return {
        content: [{ type: "text", text: context ?? "" }],
      };
    }

export function registerToolNew(mcpServer: McpServer) {
  mcpServer.registerTool(
    "healthcare",
    healthcare_para,
    healthcare
  );
}




const schema = `
Table anh Their Structure
1. thong_tin_dieu_tri - Đây là bảng mô tả công việc
- manguoibenh character varying(20) : Mã người bệnh,
- hotennguoibenh character varying(100): Họ tên người bệnh,
- ngaykham date : Ngày khám,
- ngaydieutri date : Ngày điều trị,
- chandoanbenh character varying(255) : Chẩn đoán bệnh,
- ketquadieutri text : Kết quả điều trị
`

export function registerToolTask(mcpServer: McpServer) {
  // Set up your tools, resources, and prompts
  mcpServer.registerTool(
    'medical_record',
    {
      title: 'Quản lý thông tin điều trị của người bệnh tại bệnh viện',
      description: 'Công cụ cho phép truy vấn dữ liệu trong bảng thong_tin_dieu_tri. Bảng này lưu thông tin điều trị của người bệnh, bao gồm mã người bệnh, họ tên, ngày khám, ngày điều trị, chẩn đoán và kết quả điều trị.',
      inputSchema: { message: z.string() }
    },
    async ({ message }, extra) => {
      let _extra = extra;
      
      const prompt = `
    Bạn là chuyên gia SQL (PostgreSQL). Dưới đây là cấu trúc database:
    ${schema}
    
    Câu hỏi: ${message}
    
    Hãy sinh ra 1 câu SQL chính xác theo cú pháp của PostgreSQL 

    **Dưới đây là các chỉ dẫn để thực hiện:** 
    - luôn select tất cả các cột (*)
    - khi tìm các thông tin về Chẩn đoán bệnh, Kết quả điều trị hãy sử dụng điều kiện WHERE với từ khóa ILIKE và % để tìm kiếm.
    - không giải thích, chỉ in ra SQL.
    `

      let sqlOut = await callGemini(prompt);
      let resultText = "";
      let sqlStatement = "";

      if (sqlOut.length > 0) {
        sqlOut = extractSQL(sqlOut);


        sqlStatement = sqlOut;

        const data = await query(
          sqlStatement
        );
        resultText = jsonStringifyWithDate(data);
      }

      return {
        content: [{
          type: 'text', text: `#Bên dưới là cấu trúc json của công việc:
        ${schema}
        #Dữ liệu:
        ${resultText}`
        }]
      };
    }
  );


}

// -----------------------------
// Tool: verify answer reliability (web-backed)
// -----------------------------

export function registerToolVerifyAnswer(mcpServer: McpServer) {
  mcpServer.registerTool(
    'verify_health_answer',
    {
      title: 'Kiểm chứng độ tin cậy câu trả lời (web fact-check)',
      description:
        'Tách các claim từ câu trả lời, tìm bằng chứng (web search) và chấm điểm độ tin cậy 0-100. Cần cấu hình TAVILY_API_KEY để bật web search.',
      inputSchema: {
        question: z.string().describe('Câu hỏi gốc của người dùng'),
        answer: z.string().describe('Câu trả lời cần kiểm chứng'),
      },
    },
    async ({ question, answer }: any) => {
      const claims = await extractClaims(answer);
      const checks: Array<{
        claim: string;
        label: string;
        confidence: number;
        rationale: string;
        sources: string[];
      }> = [];

      for (const c of claims) {
        // Search with the claim + a tiny bit of user question context to reduce ambiguity
        const q = `${c} (context: ${question})`;
        const evidences = await tavilySearch(q, 5);
        const j = await judgeClaim(c, evidences);
        checks.push({
          claim: c,
          label: j.label,
          confidence: j.confidence,
          rationale: j.rationale,
          sources: (j.best_sources?.length ? j.best_sources : evidences.map((e) => e.url).filter(Boolean)).slice(0, 3) as string[],
        });
      }

      const score = computeScore(checks.map((c) => ({ label: c.label, confidence: c.confidence })));
      const tavilyEnabled = Boolean(process.env['TAVILY_API_KEY']);
      // Report domains in use (either env override or defaults)
      const allowedDomainsEnv = (process.env['HEALTH_ALLOWED_DOMAINS'] ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const allowedDomainsUsed = allowedDomainsEnv.length
        ? allowedDomainsEnv
        : [
            'who.int',
            'cdc.gov',
            'nih.gov',
            'medlineplus.gov',
            'ncbi.nlm.nih.gov',
            'nhs.uk',
            'mayoclinic.org',
            'clevelandclinic.org',
            'moh.gov.vn',
            'umc.edu.vn',
          ];

      const summary = `
## Đánh giá độ tin cậy

- **Reliability score:** **${score.toFixed(0)}/100**
- **Web search:** ${tavilyEnabled ? 'BẬT (Tavily)' : 'TẮT (thiếu TAVILY_API_KEY → không có evidence từ web)'}
- **Số claim đã kiểm:** ${checks.length}

### Kết luận nhanh
${score >= 70 ? '✅ Có thể tin cậy ở mức khá (vẫn nên kiểm tra nguồn y tế chính thống).' : score >= 40 ? '⚠️ Độ tin cậy trung bình: nên đọc kỹ nguồn & không kết luận chắc chắn.' : '⛔ Độ tin cậy thấp: không nên dùng để quyết định y tế, cần tham khảo bác sĩ/nguồn chính thống.'}

### Chi tiết theo claim
${checks
  .map(
    (c, i) =>
      `**${i + 1}. ${c.label}** (conf=${c.confidence.toFixed(2)})\n- Claim: ${c.claim}\n- Lý do: ${c.rationale}\n- Nguồn: ${(c.sources?.length ? c.sources : ['(không có)']).join(', ')}`
  )
  .join('\n\n')}
`;

      return {
        // MCP standard output (for visibility in tool invocation UI)
        content: [{ type: 'text', text: summary }],

        // Structured output (for UI annotations / logging)
        score: Number(score.toFixed(0)),
        web_search_enabled: tavilyEnabled,
        allowed_domains: allowedDomainsUsed,
        checks,
      };
    }
  );
}

export function extractSQL(text: string): string {
  const match = text.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  return match ? match[1].trim() : text.trim();
}

function jsonStringifyWithDate(obj : any) {
  return JSON.stringify(obj, (key, value) => {
    if (value instanceof Date) {
      // Format yyyy-MM-dd
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
    return value;
  });
}

Date.prototype.toJSON = function () {
  const y = this.getFullYear();
  const m = String(this.getMonth() + 1).padStart(2, '0');
  const d = String(this.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};
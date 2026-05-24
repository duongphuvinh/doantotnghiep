import { languageModelWithApiKey, type modelID } from '@/ai/providers';
import { createDataStreamResponse, smoothStream, streamText, type UIMessage } from 'ai';
import { nanoid } from 'nanoid';
import { initializeMCPClients, type MCPServerConfig } from '@/lib/mcp-client';
import { formatHealthNewsAnswer, searchHealthNews } from '@/lib/server-health-news';
import { findMedicalRecordRows, type MedicalRecordRow } from '@/lib/server-medical-records';

export const runtime = 'nodejs';

// Allow streaming responses up to 60 seconds
export const maxDuration = 60;

export const dynamic = 'force-dynamic';

const MEDICAL_BACKEND_URL =
  process.env.MEDICAL_IMAGE_API_URL ||
  process.env.NEXT_PUBLIC_MEDICAL_IMAGE_API_URL ||
  'http://localhost:8000';

const WEB_SEARCH_TIMEOUT_MS = 2500;
const WIKIPEDIA_TIMEOUT_MS = 1800;

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
    .replace(/[đĐ]/g, (char) => char === 'Đ' ? 'D' : 'd')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

function dataStreamTextResponse(text: string, chatId: string) {
  return createDataStreamResponse({
    headers: { 'X-Chat-ID': chatId },
    execute(dataStream) {
      dataStream.write(`0:${JSON.stringify(text)}\n`);
    },
  });
}

function getChatStreamErrorMessage(error: unknown) {
  if (error instanceof Error) {
    if (
      error.name === 'AI_LoadAPIKeyError' ||
      error.message.includes('API key is missing') ||
      error.message.includes('GOOGLE_GENERATIVE_AI_API_KEY')
    ) {
      return (
        'Chatbot chưa có API key cho model đang chọn. ' +
        'Vui lòng đặt biến môi trường GOOGLE_API_KEY/GEMINI_API_KEY rồi restart Chat, hoặc cấu hình API key trong sidebar.'
      );
    }
    if (
      error.message.includes('API key not valid') ||
      error.message.includes('API_KEY_INVALID') ||
      error.message.includes('invalid API key')
    ) {
      return 'Gemini API key không hợp lệ. Vui lòng kiểm tra lại key, lưu file .env.local và restart Chat.';
    }
    if (error.message.includes('Rate limit') || error.message.includes('quota')) {
      return 'Gemini đang bị giới hạn quota/rate limit. Vui lòng thử lại sau hoặc dùng API key khác.';
    }
  }
  console.error(error);
  return 'Có lỗi khi tạo câu trả lời. Vui lòng kiểm tra API key/model đang chọn hoặc thử lại sau.';
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
    'thong tin',
    'tinh trang',
    'danh gia',
    'khuyen nghi',
    'ket luan',
    'nguy co',
    'kha nang',
  ];

  const hasPatientTerm = patientTerms.some((term) => normalized.includes(term));
  const hasPrivateDataTerm = privateDataTerms.some((term) => normalized.includes(term));
  const asksNamedPatient = /\b(nguoi benh|benh nhan)\s+[a-z]+(?:\s+[a-z]+){1,5}\b/.test(normalized);
  const hasLikelyPatientCode = /\b(?:BN|NB|MR|PT)[-_]?\d{2,}\b/i.test(text) || /\b\d{5,}\b/.test(text);

  return hasPatientTerm && (hasPrivateDataTerm || asksNamedPatient || hasLikelyPatientCode);
}

function asksMedicalKnowledge(text: string) {
  const normalized = normalizeVietnamese(text);
  return [
    'benh',
    'trieu chung',
    'chan doan',
    'dieu tri',
    'thuoc',
    'xet nghiem',
    'gout',
    'gay xuong',
    'viem',
    'dau',
    'suc khoe',
    'y te',
    'thoai hoa',
    'cot song',
    'dot song',
    'mang thai',
    'co thai',
    'thai ky',
    'thai nghen',
  ].some((term) => normalized.includes(term));
}

function asksCervicalSpondylosis(text: string) {
  const normalized = normalizeVietnamese(text);
  return (
    normalized.includes('thoai hoa cot song co') ||
    (normalized.includes('thoai hoa') && normalized.includes('cot song')) ||
    (normalized.includes('dot song co') && normalized.includes('thoai hoa'))
  );
}

function asksGout(text: string) {
  const normalized = normalizeVietnamese(text);
  return (
    normalized.includes('gout') ||
    normalized.includes('gut') ||
    normalized.includes('thong phong') ||
    normalized.includes('acid uric') ||
    normalized.includes('axit uric') ||
    normalized.includes('urat')
  );
}

function asksSymptoms(text: string) {
  const normalized = normalizeVietnamese(text);
  return (
    normalized.includes('trieu chung') ||
    normalized.includes('dau hieu') ||
    normalized.includes('bieu hien') ||
    normalized.includes('symptom')
  );
}

function asksPregnancy(text: string) {
  const normalized = normalizeVietnamese(text);
  return (
    normalized.includes('mang thai') ||
    normalized.includes('co thai') ||
    normalized.includes('thai ky') ||
    normalized.includes('thai nghen') ||
    normalized.includes('pregnancy') ||
    normalized.includes('pregnant')
  );
}

function hasApiKeyForModel(modelId: modelID, apiKeys: Record<string, string>) {
  if (modelId === 'gemini-2.5-flash') {
    return Boolean(
      apiKeys.GOOGLE_API_KEY ||
      apiKeys.GEMINI_API_KEY ||
      apiKeys.GOOGLE_GENERATIVE_AI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY
    );
  }
  if (modelId === 'claude-4-sonnet') {
    return Boolean(apiKeys.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY);
  }
  if (modelId === 'qwen-qwq') {
    return Boolean(apiKeys.GROQ_API_KEY || process.env.GROQ_API_KEY);
  }
  return true;
}

function generalMedicalFallbackAnswer(question: string) {
  const normalized = normalizeVietnamese(question);

  if (asksCervicalSpondylosis(question)) {
    return [
      'Thông tin tham khảo về thoái hoá cột sống cổ',
      '',
      'Thoái hoá cột sống cổ là tình trạng đĩa đệm, khớp và dây chằng vùng cổ bị lão hoá hoặc tổn thương mạn tính, có thể gây hẹp lỗ liên hợp, chèn ép rễ thần kinh hoặc đôi khi ảnh hưởng tủy cổ.',
      '',
      'Triệu chứng thường gặp gồm đau mỏi cổ, cứng cổ, đau lan vai gáy, tê hoặc yếu tay, đau đầu vùng chẩm, hạn chế xoay/cúi/ngửa cổ. Triệu chứng có thể tăng khi ngồi lâu, cúi nhìn điện thoại/máy tính hoặc vận động sai tư thế.',
      '',
      'Hướng chăm sóc thường gồm điều chỉnh tư thế, nghỉ giải lao khi ngồi lâu, tập vận động cổ-vai nhẹ nhàng theo hướng dẫn, tránh bẻ cổ mạnh, chườm ấm hoặc dùng thuốc giảm đau/kháng viêm khi bác sĩ chỉ định. Vật lý trị liệu có thể hữu ích trong nhiều trường hợp.',
      '',
      'Bạn nên đi khám sớm nếu đau lan xuống tay, tê yếu tay, vụng về khi cầm nắm, đi loạng choạng, rối loạn tiểu tiện, đau sau chấn thương, sốt, sụt cân hoặc đau tăng nhanh. Nội dung này chỉ để tham khảo, không thay thế chẩn đoán và điều trị của bác sĩ.',
    ].join('\n');
  }

  if (asksGout(question)) {
    if (asksSymptoms(question)) {
      return [
        'Triệu chứng thường gặp của bệnh gout',
        '',
        'Gout thường gây các cơn viêm khớp cấp, khởi phát đột ngột, hay xuất hiện về đêm hoặc sáng sớm. Vị trí rất thường gặp là khớp ngón chân cái, nhưng cũng có thể ở cổ chân, gối, cổ tay, bàn tay hoặc khuỷu.',
        '',
        'Các dấu hiệu điển hình gồm: đau khớp dữ dội, khớp sưng nóng đỏ, rất đau khi chạm nhẹ, hạn chế vận động khớp. Cơn đau có thể đạt đỉnh trong 12-24 giờ đầu và kéo dài vài ngày nếu không xử trí.',
        '',
        'Nếu gout kéo dài hoặc tái phát, có thể xuất hiện hạt tophi quanh khớp/vành tai, biến dạng khớp, sỏi thận hoặc suy giảm chức năng thận liên quan tăng acid uric.',
        '',
        'Bạn nên đi khám nếu đây là lần đầu đau khớp kiểu này, có sốt, khớp đỏ nóng nhiều, đau không giảm, hoặc có bệnh thận/dạ dày/tim mạch. Không nên tự dùng thuốc giảm đau/kháng viêm kéo dài khi chưa có chỉ định bác sĩ.',
      ].join('\n');
    }

    return [
      'Thông tin tham khảo về bệnh gout',
      '',
      'Gout là một dạng viêm khớp do lắng đọng tinh thể urat, thường liên quan đến nồng độ acid uric trong máu cao. Cơn gout cấp hay gặp ở khớp ngón chân cái, cổ chân, gối hoặc cổ tay, với biểu hiện đau dữ dội, sưng, nóng, đỏ và rất nhạy khi chạm.',
      '',
      'Yếu tố thuận lợi có thể gồm ăn nhiều phủ tạng, hải sản, thịt đỏ, uống rượu bia, thừa cân, bệnh thận, dùng một số thuốc lợi tiểu, hoặc có tiền sử gia đình.',
      '',
      'Hướng xử trí thường gồm nghỉ ngơi khớp đau, chườm lạnh ngắn, uống đủ nước, hạn chế rượu bia và thực phẩm giàu purin. Thuốc giảm viêm/giảm đau hoặc thuốc hạ acid uric cần dùng theo chỉ định bác sĩ, đặc biệt nếu có bệnh thận, dạ dày, tim mạch hoặc đang dùng thuốc khác.',
      '',
      'Bạn nên đi khám nếu đây là cơn đau khớp đầu tiên, đau/sưng nhiều, sốt, khớp đỏ nóng lan rộng, hoặc triệu chứng không cải thiện. Nội dung này chỉ để tham khảo, không thay thế chẩn đoán và điều trị của bác sĩ.',
    ].join('\n');
  }

  if (asksPregnancy(question)) {
    return [
      'Dấu hiệu thường gặp khi mang thai',
      '',
      'Các dấu hiệu sớm có thể gồm trễ kinh, căng tức ngực, buồn nôn hoặc nôn, mệt mỏi, buồn ngủ, đi tiểu nhiều hơn, nhạy cảm với mùi, thay đổi khẩu vị, đầy bụng hoặc đau âm ỉ nhẹ vùng bụng dưới.',
      '',
      'Một số người có thể ra ít máu báo thai hoặc đau lâm râm nhẹ, nhưng các dấu hiệu này không đủ để khẳng định chắc chắn vì cũng có thể gặp trong rối loạn kinh nguyệt, stress, thay đổi nội tiết hoặc bệnh lý khác.',
      '',
      'Cách kiểm tra thực tế nhất là dùng que thử thai sau khi trễ kinh hoặc sau quan hệ khoảng 10-14 ngày. Nếu cần chắc chắn hơn, xét nghiệm beta-hCG máu và siêu âm theo hẹn giúp xác nhận thai và vị trí thai.',
      '',
      'Nên đi khám sớm nếu đau bụng nhiều, ra máu âm đạo nhiều, chóng mặt/ngất, đau một bên bụng dưới, sốt, hoặc que thử thai dương tính kèm đau/ra máu. Nội dung này chỉ để tham khảo, không thay thế tư vấn sản phụ khoa.',
    ].join('\n');
  }

  return [
    `Thông tin tham khảo cho câu hỏi: "${question}"`,
    '',
    'Tôi chưa lấy được nguồn tham khảo bên ngoài lúc này. Với câu hỏi y tế, bạn nên mô tả rõ triệu chứng, thời gian xuất hiện, tuổi, bệnh nền và thuốc đang dùng để được định hướng tốt hơn.',
    '',
    'Nếu có triệu chứng nặng, đau tăng nhanh, sốt, khó thở, yếu/liệt, đau ngực, lú lẫn, hoặc tình trạng kéo dài không cải thiện, hãy đi khám trực tiếp. Nội dung này chỉ để tham khảo, không thay thế tư vấn của bác sĩ.',
  ].join('\n');
}

async function verifyMedicalAuthToken(token: string) {
  if (!token) return null;

  try {
    const response = await fetch(`${MEDICAL_BACKEND_URL.replace(/\/$/, '')}/api/auth/me`, {
      headers: {
        authorization: `Bearer ${token}`,
      },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return (await response.json()) as { id: number; username: string; full_name?: string | null; role: string };
  } catch (error) {
    console.error('Medical auth verification failed:', error);
    return null;
  }
}

function isSelfMedicalInfoQuery(text: string, user?: { full_name?: string | null; username?: string | null } | null) {
  const normalized = normalizeVietnamese(text);
  const selfTerms = [
    'cua toi',
    'cua minh',
    've toi',
    've minh',
    'toi la ai',
    'thong tin toi',
    'thong tin ve toi',
    'tim thong tin ve toi',
    'thong tin cua toi',
    'ho so cua toi',
    'ket qua cua toi',
    'phieu cua toi',
    'phim cua toi',
  ];
  if (selfTerms.some((term) => normalized.includes(term))) return true;

  const fullName = normalizeVietnamese(user?.full_name || '');
  const username = normalizeVietnamese(user?.username || '');
  return Boolean(
    (fullName && normalized.includes(fullName)) ||
    (username && normalized.includes(username))
  );
}

function asksPatientRecommendation(text: string) {
  const normalized = normalizeVietnamese(text);
  const selfContext = [
    'cua toi',
    'cua minh',
    've toi',
    've minh',
    'toi',
    'minh',
  ].some((term) => normalized.includes(term));
  const patientContext = [
    'nguoi benh',
    'benh nhan',
    'ho so benh',
    'ma nguoi benh',
    'ma benh nhan',
    'patient',
  ].some((term) => normalized.includes(term));

  const recommendationTerms = [
    'kha nang',
    'nguy co',
    'tinh trang',
    'danh gia',
    'khuyen nghi',
    'ket luan',
    'nhan dinh',
    'du doan',
    'co bi benh',
    'bi benh',
    'mac benh',
    'benh cua toi',
  ];

  return (selfContext || patientContext) && recommendationTerms.some((term) => normalized.includes(term));
}

function mentionsCurrentUser(text: string, user?: { full_name?: string | null; username?: string | null } | null) {
  const normalized = normalizeVietnamese(text);
  const fullName = normalizeVietnamese(user?.full_name || '');
  const username = normalizeVietnamese(user?.username || '');
  return Boolean(
    (fullName && normalized.includes(fullName)) ||
    (username && normalized.includes(username))
  );
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? value as Record<string, any> : {};
}

function formatPercent(value: unknown) {
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) return 'không rõ';
  const normalized = numberValue <= 1 ? numberValue * 100 : numberValue;
  return `${normalized.toFixed(1)}%`;
}

function predictionLabelVi(value?: string | null) {
  const mapping: Record<string, string> = {
    normal: 'chưa thấy bất thường nổi bật',
    fracture: 'nghi gãy xương/tổn thương xương',
    arthritis: 'nghi viêm/thoái hóa khớp',
    osteoporosis: 'nghi loãng xương',
    other: 'bất thường khác',
    suspected_bone_pathology: 'nghi bệnh lý/tổn thương xương',
    requires_clinical_review: 'cần bác sĩ đối chiếu thêm',
    no_strong_abnormal_signal: 'chưa thấy tín hiệu bất thường nổi bật',
  };
  return value ? (mapping[value] || value) : 'không rõ';
}

function riskLabelVi(value: 'low' | 'medium' | 'high') {
  return value === 'high' ? 'cao' : value === 'medium' ? 'trung bình' : 'thấp';
}

function importantLabItems(items: any[]) {
  return items
    .filter((item) => item?.status && item.status !== 'normal')
    .slice(0, 6)
    .map((item) => {
      const value = [item.value, item.unit].filter(Boolean).join(' ');
      const status = item.status === 'high'
        ? 'cao'
        : item.status === 'low'
          ? 'thấp'
          : item.status === 'urgent'
            ? 'khẩn'
            : item.status;
      return `- ${item.name || item.input_name || item.code}: ${value || 'không rõ giá trị'} (${status}; ${item.interpretation || 'cần đối chiếu lâm sàng'})`;
    });
}

async function buildPatientRecommendationMessage(
  user: { id: number; username: string; full_name?: string | null; role: string },
  token: string
) {
  const [imageUploads, labUploads, evaluationRuns] = await Promise.all([
    fetchMedicalBackendJson('/api/uploads?upload_type=image', token),
    fetchMedicalBackendJson('/api/uploads?upload_type=lab', token),
    fetchMedicalBackendJson('/api/evaluation/runs', token),
  ]);

  const images = Array.isArray(imageUploads) ? imageUploads : [];
  const labs = Array.isArray(labUploads) ? labUploads : [];
  const runs = Array.isArray(evaluationRuns) ? evaluationRuns : [];
  const latestImage = images[0];
  const latestLab = labs[0];
  const latestRun = runs[0];
  const imageAnalysis = asRecord(latestImage?.analysis);
  const imagePrediction = asRecord(imageAnalysis.prediction);
  const imageQuality = asRecord(imageAnalysis.quality);
  const imageMetadata = asRecord(imageAnalysis.metadata);
  const labAnalysis = asRecord(latestLab?.analysis);
  const labItems = Array.isArray(labAnalysis.items) ? labAnalysis.items : [];
  const abnormalLabItems = importantLabItems(labItems);

  const topImageLabel = typeof imagePrediction.top_label === 'string' ? imagePrediction.top_label : null;
  const imageConfidence = imagePrediction.confidence;
  const labAbnormalCount = Number(labAnalysis.abnormal_count || 0);
  const labUrgentCount = Number(labAnalysis.urgent_count || 0);
  const imageSuggestsAbnormal = Boolean(topImageLabel && topImageLabel !== 'normal');
  const highImageConcern = imageSuggestsAbnormal && Number(imageConfidence || 0) >= 0.7;
  const multimodalPred = typeof latestRun?.multimodal_pred === 'string' ? latestRun.multimodal_pred : null;
  const multimodalSuggestsAbnormal = Boolean(
    multimodalPred &&
    !['normal', 'no_strong_abnormal_signal'].includes(multimodalPred)
  );

  let riskLevel: 'low' | 'medium' | 'high' = 'low';
  if (labUrgentCount > 0 || highImageConcern || topImageLabel === 'fracture') {
    riskLevel = 'high';
  } else if (imageSuggestsAbnormal || labAbnormalCount > 0 || multimodalSuggestsAbnormal) {
    riskLevel = 'medium';
  }

  const evidence: string[] = [];
  if (latestImage) {
    evidence.push(
      `- Phim mới nhất: ${latestImage.filename || 'không rõ tên file'} (${formatDateTime(latestImage.created_at)}), ` +
      `${imageMetadata.modality || latestImage.modality || 'không rõ loại phim'}${imageMetadata.body_part || latestImage.body_part ? ` vùng ${imageMetadata.body_part || latestImage.body_part}` : ''}. ` +
      `AI ảnh: ${predictionLabelVi(topImageLabel)}${imageConfidence != null ? `, độ tin cậy ${formatPercent(imageConfidence)}` : ''}.`
    );
    const warnings = Array.isArray(imageQuality.warnings) ? imageQuality.warnings : [];
    if (warnings.length > 0) evidence.push(`- Chất lượng ảnh có cảnh báo: ${warnings.slice(0, 3).join('; ')}.`);
  } else {
    evidence.push('- Chưa có phim xương đã lưu để đối chiếu.');
  }

  if (latestLab) {
    evidence.push(
      `- Xét nghiệm mới nhất: ${latestLab.filename || 'không rõ tên file'} (${formatDateTime(latestLab.created_at)}). ` +
      `${labAnalysis.summary || `Có ${labAbnormalCount} chỉ số bất thường, ${labUrgentCount} chỉ số cần chú ý khẩn.`}`
    );
    evidence.push(...abnormalLabItems);
  } else {
    evidence.push('- Chưa có phiếu xét nghiệm đã lưu để đối chiếu.');
  }

  if (latestRun) {
    evidence.push(
      `- Ca đánh giá model mới nhất: ${latestRun.case_code || 'không rõ mã ca'} (${formatDateTime(latestRun.created_at)}). ` +
      `Dự đoán multimodal đã lưu: ${predictionLabelVi(latestRun.multimodal_pred)}.`
    );
  }

  const interpretation = [
    `Mức cần theo dõi hiện tại: ${riskLabelVi(riskLevel)}.`,
    riskLevel === 'high'
      ? 'Có tín hiệu cần được bác sĩ xem lại sớm, đặc biệt nếu triệu chứng đang đau nhiều, sưng nóng đỏ, hạn chế vận động, sốt, tê yếu hoặc có chấn thương gần đây.'
      : riskLevel === 'medium'
        ? 'Có một số tín hiệu bất thường hoặc chưa đủ chắc chắn; nên đối chiếu với triệu chứng, khám trực tiếp và phim gốc trước khi kết luận.'
        : 'Dữ liệu hiện có chưa cho thấy tín hiệu bất thường mạnh, nhưng kết luận vẫn phụ thuộc triệu chứng, khám lâm sàng và chất lượng dữ liệu đầu vào.',
  ];

  const nextSteps = [
    '- Đối chiếu phim gốc với bác sĩ/chuyên khoa chẩn đoán hình ảnh hoặc cơ xương khớp.',
    '- Nếu có đau tăng nhanh, biến dạng chi, không chịu lực được, sốt, tê/yếu, hoặc xét nghiệm có chỉ số khẩn: nên đi khám/cấp cứu sớm.',
    '- Nếu dữ liệu chưa đủ: bổ sung tuổi, giới, vị trí đau, thời gian khởi phát, mức đau 0-10, tiền sử chấn thương/bệnh nền và chạy Fusion để có đánh giá đa phương thức hơn.',
  ];

  return [
    `Đánh giá tham khảo dựa trên dữ liệu đang lưu của ${user.full_name || user.username}`,
    '',
    'Dữ liệu được dùng:',
    ...evidence,
    '',
    'Nhận định:',
    ...interpretation.map((item) => `- ${item}`),
    '',
    'Khuyến nghị:',
    ...nextSteps,
    '',
    'Lưu ý: đây là hỗ trợ sàng lọc từ dữ liệu hệ thống, không phải chẩn đoán cuối cùng và không thay thế bác sĩ.',
  ].join('\n');
}

function medicalPrivacyMessage(user?: { full_name?: string | null; username: string } | null) {
  const name = user?.full_name || user?.username || 'tài khoản hiện tại';
  return (
    `Vì lý do bảo mật, tôi không thể tìm hoặc hiển thị thông tin người bệnh khác khi bạn đang đăng nhập bằng tài khoản ${name}.\n\n` +
    'Bạn chỉ được tra cứu dữ liệu gắn với chính tài khoản đang đăng nhập. Nếu muốn xem dữ liệu của mình, hãy hỏi theo dạng: "xem thông tin của tôi", "xem phim/xét nghiệm của tôi", hoặc vào trực tiếp các tab Upload phim xương, Xét nghiệm, Fusion, Đánh giá.'
  );
}

function canAccessOtherPatients(user: { role: string }) {
  return user.role === 'clinician' || user.role === 'admin';
}

function includesNormalized(haystack: string, needle?: string | null) {
  if (!needle) return false;
  return haystack.includes(normalizeVietnamese(needle));
}

function patientSearchTerms(text: string) {
  const normalized = normalizeVietnamese(text);
  const codeMatch = text.match(/\b(?:BN|NB|MR|PT)[-_]?\d{1,}\b/i) || text.match(/\b\d{3,}\b/);
  const afterPatient = normalized.match(/\b(?:benh nhan|nguoi benh)\s+([a-z0-9 _-]{2,80})/);
  return {
    normalized,
    code: codeMatch?.[0]?.trim(),
    afterPatient: afterPatient?.[1]
      ?.replace(/\b(?:co|la|ten|ma|nhu the nao|ra sao|tinh trang|khuyen nghi|danh gia|thong tin|ho so)\b/g, '')
      .trim(),
  };
}

function extractPatientCode(text: string) {
  return text.match(/\b(?:BN|NB|MR|PT)[-_]?\d{1,}\b/i)?.[0]?.trim() || '';
}

function findPatientFromQuestion(text: string, patients: any[]) {
  const terms = patientSearchTerms(text);
  const code = terms.code ? normalizeVietnamese(terms.code) : '';

  if (code) {
    const byCode = patients.find((patient) =>
      includesNormalized(normalizeVietnamese(String(patient.patient_code || '')), code) ||
      String(patient.id || '') === terms.code
    );
    if (byCode) return byCode;
  }

  const byExactText = patients.find((patient) =>
    includesNormalized(terms.normalized, patient.patient_code) ||
    includesNormalized(terms.normalized, patient.full_name)
  );
  if (byExactText) return byExactText;

  if (terms.afterPatient) {
    const query = terms.afterPatient;
    return patients.find((patient) => {
      const name = normalizeVietnamese(patient.full_name || '');
      const codeValue = normalizeVietnamese(patient.patient_code || '');
      return query.includes(name) || name.includes(query) || query.includes(codeValue);
    });
  }

  return patients.length === 1 ? patients[0] : null;
}

function patientFromExcelRecord(record: MedicalRecordRow) {
  return {
    id: `excel:${record.patientCode}`,
    patient_code: record.patientCode,
    full_name: record.patientName,
    age: null,
    gender: 'unknown',
    phone: null,
    address: null,
  };
}

function genderLabel(value?: string) {
  return value === 'male'
    ? 'Nam'
    : value === 'female'
      ? 'Nữ'
      : value === 'other'
        ? 'Khác'
        : 'Không rõ';
}

function formatClinicalRecord(record: any, index: number) {
  const symptoms = Array.isArray(record.symptoms) && record.symptoms.length
    ? record.symptoms.join(', ')
    : 'chưa ghi nhận';
  const history = Array.isArray(record.medical_history) && record.medical_history.length
    ? record.medical_history.join(', ')
    : 'chưa ghi nhận';
  const indicators = asRecord(record.clinical_indicators);
  const indicatorText = Object.keys(indicators).length
    ? Object.entries(indicators).map(([key, value]) => `${key}: ${value}`).join(', ')
    : 'chưa ghi nhận';

  return [
    `Lần ${index + 1} (${formatDateTime(record.created_at)}):`,
    `- Triệu chứng: ${symptoms}`,
    `- Tiền sử: ${history}`,
    `- Chỉ số lâm sàng: ${indicatorText}`,
    record.note ? `- Ghi chú: ${record.note}` : '',
  ].filter(Boolean).join('\n');
}

function formatMedicalRecord(record: MedicalRecordRow, index: number) {
  return [
    `Lần ${index + 1}: ${record.visitDate}${record.treatmentDate ? ` -> điều trị ${record.treatmentDate}` : ''}`,
    `- Mã/Tên trong Excel: ${record.patientCode} - ${record.patientName}`,
    `- Chẩn đoán: ${record.diagnosis || 'chưa ghi nhận'}`,
    `- Kết quả điều trị: ${record.treatmentResult || 'chưa ghi nhận'}`,
  ].join('\n');
}

function formatImageEvidence(upload: any) {
  if (!upload) return '- Chưa có phim xương gắn với hồ sơ này.';
  const analysis = asRecord(upload.analysis);
  const metadata = asRecord(analysis.metadata);
  const prediction = asRecord(analysis.prediction);
  const quality = asRecord(analysis.quality);
  const warnings = Array.isArray(quality.warnings) ? quality.warnings : [];
  return [
    `- File: ${upload.filename || 'không rõ'} (${formatDateTime(upload.created_at)})`,
    `- Loại/vùng: ${metadata.modality || upload.modality || 'không rõ'}${metadata.body_part || upload.body_part ? ` - ${metadata.body_part || upload.body_part}` : ''}`,
    `- AI ảnh: ${predictionLabelVi(typeof prediction.top_label === 'string' ? prediction.top_label : null)}${prediction.confidence != null ? `, độ tin cậy ${formatPercent(prediction.confidence)}` : ''}`,
    warnings.length ? `- Cảnh báo chất lượng ảnh: ${warnings.slice(0, 4).join('; ')}` : '',
    prediction.note ? `- Ghi chú model: ${prediction.note}` : '',
  ].filter(Boolean).join('\n');
}

function formatLabEvidence(upload: any) {
  if (!upload) return '- Chưa có phiếu xét nghiệm gắn với hồ sơ này.';
  const analysis = asRecord(upload.analysis);
  const items = Array.isArray(analysis.items) ? analysis.items : [];
  const abnormalItems = importantLabItems(items);
  return [
    `- File: ${upload.filename || 'không rõ'} (${formatDateTime(upload.created_at)})`,
    `- Tổng quan: ${analysis.summary || 'chưa có tóm tắt'}`,
    `- Bất thường/khẩn: ${Number(analysis.abnormal_count || 0)} bất thường, ${Number(analysis.urgent_count || 0)} khẩn`,
    ...abnormalItems,
  ].filter(Boolean).join('\n');
}

function buildDoctorRecommendation(args: {
  medicalRecords: MedicalRecordRow[];
  codeOnlyRecords: MedicalRecordRow[];
  latestImage: any;
  latestLab: any;
  clinicalRecordCount: number;
}) {
  const labAnalysis = asRecord(args.latestLab?.analysis);
  const urgentLabCount = Number(labAnalysis.urgent_count || 0);
  const abnormalLabCount = Number(labAnalysis.abnormal_count || 0);
  const imagePrediction = asRecord(asRecord(args.latestImage?.analysis).prediction);
  const imageLabel = typeof imagePrediction.top_label === 'string' ? imagePrediction.top_label : '';
  const imageConfidence = Number(imagePrediction.confidence || 0);
  const diagnoses = args.medicalRecords.map((record) => record.diagnosis).filter(Boolean);
  const hasChronicHistory = diagnoses.some((diagnosis) =>
    normalizeVietnamese(diagnosis).match(/man|suy than|tieu duong|viem gan|tang huyet ap|loang xuong/)
  );

  let level: 'low' | 'medium' | 'high' = 'low';
  if (urgentLabCount > 0 || imageLabel === 'fracture' || (imageLabel && imageLabel !== 'normal' && imageConfidence >= 0.7)) {
    level = 'high';
  } else if (abnormalLabCount > 0 || (imageLabel && imageLabel !== 'normal') || hasChronicHistory || args.medicalRecords.length > 0) {
    level = 'medium';
  }

  const reasons = [
    args.medicalRecords.length
      ? `Có ${args.medicalRecords.length} lượt khám trong Excel; chẩn đoán gần đây/ghi nhận gồm: ${Array.from(new Set(diagnoses)).slice(0, 5).join('; ')}.`
      : 'Chưa tìm thấy lượt khám Excel khớp chắc chắn theo họ tên.',
    args.codeOnlyRecords.length
      ? `Có ${args.codeOnlyRecords.length} dòng cùng mã bệnh nhân nhưng tên khác; cần kiểm tra mapping dữ liệu trước khi dùng làm căn cứ chính.`
      : '',
    args.latestImage
      ? `Phim xương mới nhất: ${predictionLabelVi(imageLabel || null)}${imagePrediction.confidence != null ? ` (${formatPercent(imagePrediction.confidence)})` : ''}.`
      : 'Chưa có phim xương gắn hồ sơ.',
    args.latestLab
      ? `Xét nghiệm mới nhất có ${abnormalLabCount} chỉ số bất thường, ${urgentLabCount} chỉ số khẩn.`
      : 'Chưa có xét nghiệm gắn hồ sơ.',
  ].filter(Boolean);

  const actions = [
    level === 'high'
      ? '- Ưu tiên bác sĩ xem lại sớm; nếu có đau tăng nhanh, biến dạng, không chịu lực, sốt, tê/yếu hoặc chỉ số xét nghiệm khẩn thì chuyển khám/cấp cứu.'
      : level === 'medium'
        ? '- Nên hẹn khám/đối chiếu trực tiếp, đọc phim gốc và so phiếu xét nghiệm với triệu chứng hiện tại trước khi kết luận.'
        : '- Có thể theo dõi định kỳ nếu không có triệu chứng nặng, nhưng vẫn cần đối chiếu dữ liệu gốc khi ra quyết định.',
    '- Kiểm tra lại định danh người bệnh giữa hồ sơ app và file Excel nếu mã/tên không thống nhất.',
    '- Nếu cần kết luận chắc hơn: bổ sung triệu chứng hiện tại, vị trí đau, mức đau 0-10, thời gian khởi phát, tiền sử chấn thương và chạy Fusion cho đúng hồ sơ bệnh nhân.',
  ];

  return [
    `Mức ưu tiên theo dõi: ${riskLabelVi(level)}.`,
    ...reasons.map((reason) => `- ${reason}`),
    '',
    'Khuyến nghị:',
    ...actions,
  ].join('\n');
}

async function buildAccessiblePatientMessage(
  question: string,
  user: { id: number; username: string; full_name?: string | null; role: string },
  token: string
) {
  if (!canAccessOtherPatients(user)) return medicalPrivacyMessage(user);

  const patients = await fetchMedicalBackendJson('/api/patients', token);
  const list = Array.isArray(patients) ? patients : [];
  if (list.length === 0) {
    return [
      `Tài khoản ${user.full_name || user.username} là ${roleLabel(user.role)}, nhưng hiện chưa có hồ sơ người bệnh nào trong phạm vi truy cập.`,
      '',
      'Bác sĩ có thể tạo hồ sơ người bệnh trước, sau đó hỏi theo mã hoặc họ tên, ví dụ: "xem tình trạng bệnh nhân BN001" hoặc "khuyến nghị cho bệnh nhân Nguyễn Văn A".',
    ].join('\n');
  }

  const requestedCode = extractPatientCode(question);
  const requestedCodeMatches = requestedCode
    ? findMedicalRecordRows({ patient_code: requestedCode }, question).codeOnlyMatches
    : [];
  const matched = findPatientFromQuestion(question, list);
  const shouldPreferExcelCode =
    requestedCodeMatches.length > 0 &&
    (!matched ||
      normalizeVietnamese(String(matched.full_name || '')) !==
        normalizeVietnamese(String(requestedCodeMatches[0].patientName || '')));
  const resolvedPatient = shouldPreferExcelCode ? patientFromExcelRecord(requestedCodeMatches[0]) : matched;

  if (!resolvedPatient) {
    const suggestions = list
      .slice(0, 8)
      .map((patient) => `- ${patient.patient_code}: ${patient.full_name}, ${patient.age} tuổi, ${genderLabel(patient.gender)}`)
      .join('\n');
    return [
      'Tôi chưa xác định được người bệnh cần tra cứu trong phạm vi tài khoản bác sĩ.',
      '',
      'Bạn có thể hỏi lại kèm mã hoặc họ tên người bệnh. Một số hồ sơ bạn có quyền xem:',
      suggestions,
    ].join('\n');
  }

  const isExcelOnlyPatient = String(resolvedPatient.id).startsWith('excel:');
  const [detail, clinicalRecords, imageUploads, labUploads] = isExcelOnlyPatient
    ? [resolvedPatient, [], [], []]
    : await Promise.all([
        fetchMedicalBackendJson(`/api/patients/${resolvedPatient.id}`, token),
        fetchMedicalBackendJson(`/api/patients/${resolvedPatient.id}/clinical-records`, token),
        fetchMedicalBackendJson(`/api/uploads?upload_type=image&patient_id=${resolvedPatient.id}`, token),
        fetchMedicalBackendJson(`/api/uploads?upload_type=lab&patient_id=${resolvedPatient.id}`, token),
      ]);

  const patient = asRecord(detail || resolvedPatient);
  const records = Array.isArray(clinicalRecords) ? clinicalRecords : [];
  const images = Array.isArray(imageUploads) ? imageUploads : [];
  const labs = Array.isArray(labUploads) ? labUploads : [];
  const latestRecords = records.slice(0, 3);
  const latestImage = images[0];
  const latestLab = labs[0];
  const medicalRecordMatches = findMedicalRecordRows(
    {
      patient_code: String(patient.patient_code || resolvedPatient.patient_code || ''),
      full_name: String(patient.full_name || resolvedPatient.full_name || ''),
    },
    question
  );
  const wantsRecommendation = true;

  const summary = [
    `Hồ sơ người bệnh: ${patient.full_name || resolvedPatient.full_name}`,
    `- Mã người bệnh: ${patient.patient_code || resolvedPatient.patient_code}`,
    patient.age != null || resolvedPatient.age != null
      ? `- Tuổi/giới: ${patient.age ?? resolvedPatient.age} tuổi, ${genderLabel(patient.gender || resolvedPatient.gender)}`
      : `- Tuổi/giới: chưa có trong Excel, ${genderLabel(patient.gender || resolvedPatient.gender)}`,
    patient.phone ? `- Điện thoại: ${patient.phone}` : '',
    patient.address ? `- Địa chỉ: ${patient.address}` : '',
    `- Số bản ghi lâm sàng: ${records.length}`,
    isExcelOnlyPatient
      ? '- Phim xương đã gắn hồ sơ: chưa có hồ sơ app tương ứng để nối patient_id'
      : `- Phim xương đã gắn hồ sơ: ${images.length}${latestImage ? `, mới nhất ${latestImage.filename} (${formatDateTime(latestImage.created_at)})` : ''}`,
    isExcelOnlyPatient
      ? '- Phiếu xét nghiệm đã gắn hồ sơ: chưa có hồ sơ app tương ứng để nối patient_id'
      : `- Phiếu xét nghiệm đã gắn hồ sơ: ${labs.length}${latestLab ? `, mới nhất ${latestLab.filename} (${formatDateTime(latestLab.created_at)})` : ''}`,
  ].filter(Boolean);

  const clinicalText = latestRecords.length
    ? latestRecords.map(formatClinicalRecord).join('\n\n')
    : 'Chưa có bản ghi lâm sàng cho người bệnh này.';

  const excelRecords = medicalRecordMatches.exactMatches;
  const codeOnlyRecords = medicalRecordMatches.codeOnlyMatches;
  const excelText = excelRecords.length
    ? excelRecords.map(formatMedicalRecord).join('\n\n')
    : 'Chưa tìm thấy dòng khám trong `tblMedicalRecord_200rows.xlsx` khớp chắc chắn theo họ tên người bệnh.';
  const codeOnlyText = codeOnlyRecords.length
    ? [
        'Các dòng cùng mã người bệnh nhưng tên khác trong Excel, chỉ dùng để kiểm tra đối soát:',
        codeOnlyRecords.map(formatMedicalRecord).join('\n\n'),
      ].join('\n')
    : '';

  const imageText = formatImageEvidence(latestImage);
  const labText = formatLabEvidence(latestLab);

  const recommendation = wantsRecommendation
    ? [
        '',
        'Nhận định và khuyến nghị tham khảo:',
        buildDoctorRecommendation({
          medicalRecords: excelRecords,
          codeOnlyRecords,
          latestImage,
          latestLab,
          clinicalRecordCount: records.length,
        }),
      ]
    : [];

  return [
    ...summary,
    '',
    'Lịch sử khám từ tblMedicalRecord_200rows.xlsx:',
    excelText,
    codeOnlyText,
    '',
    'Bản ghi lâm sàng gần nhất:',
    clinicalText,
    '',
    'Phim xương đã gắn hồ sơ:',
    imageText,
    '',
    'Phiếu xét nghiệm đã gắn hồ sơ:',
    labText,
    ...recommendation,
    '',
    `Quyền truy cập: ${roleLabel(user.role)} chỉ xem được hồ sơ trong phạm vi backend cho phép.`,
  ].join('\n');
}

async function fetchMedicalBackendJson(path: string, token: string) {
  const response = await fetch(`${MEDICAL_BACKEND_URL.replace(/\/$/, '')}${path}`, {
    headers: { authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!response.ok) return null;
  return response.json();
}

async function buildSelfMedicalInfoMessage(
  user: { id: number; username: string; full_name?: string | null; role: string },
  token: string
) {
  const [imageUploads, labUploads, evaluationRuns] = await Promise.all([
    fetchMedicalBackendJson('/api/uploads?upload_type=image', token),
    fetchMedicalBackendJson('/api/uploads?upload_type=lab', token),
    fetchMedicalBackendJson('/api/evaluation/runs', token),
  ]);

  const images = Array.isArray(imageUploads) ? imageUploads : [];
  const labs = Array.isArray(labUploads) ? labUploads : [];
  const runs = Array.isArray(evaluationRuns) ? evaluationRuns : [];
  const latestImage = images[0];
  const latestLab = labs[0];
  const hasData = images.length > 0 || labs.length > 0 || runs.length > 0;

  return [
    `Thông tin tài khoản: ${user.full_name || user.username}`,
    `Loại tài khoản: ${roleLabel(user.role)}`,
    '',
    hasData ? 'Dữ liệu đang lưu trong hệ thống của bạn:' : 'Hiện chưa có dữ liệu y tế nào được lưu cho tài khoản này.',
    `- Phim xương đã upload: ${images.length}`,
    latestImage ? `  Mới nhất: ${latestImage.filename || 'không rõ tên file'} (${formatDateTime(latestImage.created_at)})` : '',
    `- Phiếu xét nghiệm đã lưu: ${labs.length}`,
    latestLab ? `  Mới nhất: ${latestLab.filename || 'không rõ tên file'} (${formatDateTime(latestLab.created_at)})` : '',
    `- Ca đánh giá model đã lưu: ${runs.length}`,
    '',
    'Bạn có thể thao tác tiếp tại:',
    '- [Xem phim xương đã upload](/medical-images)',
    '- [Xem phiếu xét nghiệm đã upload](/lab-results)',
    '- [Chạy Fusion từ dữ liệu mới nhất](/multimodal)',
    '- [Xem/lưu ca đánh giá model](/model-evaluation)',
    '',
    'Tôi chỉ hiển thị dữ liệu gắn với tài khoản đang đăng nhập, không tra cứu người bệnh khác.',
  ].filter(Boolean).join('\n');
}

function roleLabel(role: string) {
  return role === 'admin'
    ? 'Quản trị viên'
    : role === 'clinician'
      ? 'Nhân viên y tế/bác sĩ'
      : role === 'patient'
        ? 'Người bệnh'
        : role;
}

function formatDateTime(value?: string) {
  if (!value) return 'không rõ thời điểm';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'không rõ thời điểm';
  return date.toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

async function fetchJsonWithTimeout(url: URL | string, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch (error: any) {
    if (error?.name !== 'AbortError') {
      console.error('External search fetch failed:', error);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchWebContext(query: string) {
  const wikipedia = await fetchWikipediaContext(query);
  if (wikipedia) return wikipedia;

  try {
    const url = new URL('https://api.duckduckgo.com/');
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('no_redirect', '1');
    url.searchParams.set('no_html', '1');
    url.searchParams.set('skip_disambig', '1');
    const data = await fetchJsonWithTimeout(url, WEB_SEARCH_TIMEOUT_MS);
    if (!data) return '';
    const related = Array.isArray(data.RelatedTopics)
      ? data.RelatedTopics
          .flatMap((item: any) => Array.isArray(item.Topics) ? item.Topics : [item])
          .filter((item: any) => item?.Text)
          .slice(0, 5)
          .map((item: any) => `- ${item.Text}${item.FirstURL ? ` (${item.FirstURL})` : ''}`)
      : [];
    return [
      data.AbstractText ? `Tóm tắt web: ${data.AbstractText}` : '',
      data.AbstractURL ? `Nguồn: ${data.AbstractURL}` : '',
      related.length ? `Kết quả liên quan:\n${related.join('\n')}` : '',
    ].filter(Boolean).join('\n');
  } catch (error) {
    console.error('Web context fetch failed:', error);
    return '';
  }
}

async function fetchWikipediaContextSlow(query: string) {
  for (const lang of ['vi', 'en']) {
    try {
      const searchUrl = new URL(`https://${lang}.wikipedia.org/w/api.php`);
      searchUrl.searchParams.set('action', 'opensearch');
      searchUrl.searchParams.set('search', query);
      searchUrl.searchParams.set('limit', '1');
      searchUrl.searchParams.set('namespace', '0');
      searchUrl.searchParams.set('format', 'json');
      const searchResponse = await fetch(searchUrl, { cache: 'no-store' });
      if (!searchResponse.ok) continue;
      const searchData = await searchResponse.json();
      const title = Array.isArray(searchData?.[1]) ? searchData[1][0] : '';
      if (!title) continue;

      const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
      const summaryResponse = await fetch(summaryUrl, { cache: 'no-store' });
      if (!summaryResponse.ok) continue;
      const summary = await summaryResponse.json();
      if (summary?.extract) {
        return [
          `Tóm tắt web: ${summary.extract}`,
          summary.content_urls?.desktop?.page ? `Nguồn: ${summary.content_urls.desktop.page}` : '',
        ].filter(Boolean).join('\n');
      }
    } catch (error) {
      console.error('Wikipedia context fetch failed:', error);
    }
  }
  return '';
}

async function fetchWikipediaContext(query: string) {
  const results = await Promise.allSettled(['vi', 'en'].map((lang) => fetchWikipediaLanguageContext(query, lang)));
  return results
    .map((result) => result.status === 'fulfilled' ? result.value : '')
    .find(Boolean) || '';
}

async function fetchWikipediaLanguageContext(query: string, lang: string) {
  const searchUrl = new URL(`https://${lang}.wikipedia.org/w/api.php`);
  searchUrl.searchParams.set('action', 'opensearch');
  searchUrl.searchParams.set('search', query);
  searchUrl.searchParams.set('limit', '1');
  searchUrl.searchParams.set('namespace', '0');
  searchUrl.searchParams.set('format', 'json');
  const searchData = await fetchJsonWithTimeout(searchUrl, WIKIPEDIA_TIMEOUT_MS);
  const title = Array.isArray(searchData?.[1]) ? searchData[1][0] : '';
  if (!title) return '';

  const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const summary = await fetchJsonWithTimeout(summaryUrl, WIKIPEDIA_TIMEOUT_MS);
  if (!summary?.extract) return '';

  return [
    `Tóm tắt web: ${summary.extract}`,
    summary.content_urls?.desktop?.page ? `Nguồn: ${summary.content_urls.desktop.page}` : '',
  ].filter(Boolean).join('\n');
}

export async function POST(req: Request) {
  const {
    messages,
    chatId,
    selectedModel,
    userId,
    medicalAuthToken,
    apiKeys = {},
    mcpServers = [],
  }: {
    messages: UIMessage[];
    chatId?: string;
    selectedModel: modelID;
    userId: string;
    medicalAuthToken?: string;
    apiKeys?: Record<string, string>;
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
    if (isMedicalUserLoggedIn && !isSelfMedicalInfoQuery(lastUserText, isMedicalUserLoggedIn) && !mentionsCurrentUser(lastUserText, isMedicalUserLoggedIn)) {
      if (canAccessOtherPatients(isMedicalUserLoggedIn)) {
        return dataStreamTextResponse(
          await buildAccessiblePatientMessage(lastUserText, isMedicalUserLoggedIn, medicalAuthToken || ''),
          id
        );
      }
      return dataStreamTextResponse(medicalPrivacyMessage(isMedicalUserLoggedIn), id);
    }
    if (isMedicalUserLoggedIn && (isSelfMedicalInfoQuery(lastUserText, isMedicalUserLoggedIn) || mentionsCurrentUser(lastUserText, isMedicalUserLoggedIn))) {
      if (asksPatientRecommendation(lastUserText)) {
        return dataStreamTextResponse(
          await buildPatientRecommendationMessage(isMedicalUserLoggedIn, medicalAuthToken || ''),
          id
        );
      }
      return dataStreamTextResponse(
        await buildSelfMedicalInfoMessage(isMedicalUserLoggedIn, medicalAuthToken || ''),
        id
      );
    }
    if (!isMedicalUserLoggedIn) {
      return dataStreamTextResponse(
        'Bạn cần đăng nhập tài khoản y tế trước khi hỏi/xem thông tin chi tiết người bệnh. Các câu hỏi kiến thức y tế chung vẫn có thể sử dụng không cần đăng nhập.',
        id
      );
    }
  }

  if (isSelfMedicalInfoQuery(lastUserText)) {
    const medicalUser = await verifyMedicalAuthToken(medicalAuthToken || '');
    if (!medicalUser) {
      return dataStreamTextResponse(
        'Bạn cần đăng nhập tài khoản y tế trước khi xem thông tin của mình.',
        id
      );
    }
    if (asksPatientRecommendation(lastUserText)) {
      return dataStreamTextResponse(
        await buildPatientRecommendationMessage(medicalUser, medicalAuthToken || ''),
        id
      );
    }
    return dataStreamTextResponse(
      await buildSelfMedicalInfoMessage(medicalUser, medicalAuthToken || ''),
      id
    );
  }

  if (asksCervicalSpondylosis(lastUserText) || asksGout(lastUserText) || asksPregnancy(lastUserText)) {
    return dataStreamTextResponse(generalMedicalFallbackAnswer(lastUserText), id);
  }

  const isGeneralMedicalQuestion = asksMedicalKnowledge(lastUserText) && !asksForPatientPrivateInfo(lastUserText);
  if (isGeneralMedicalQuestion) {
    const localMatches = searchHealthNews(lastUserText);
    if (localMatches.length > 0) {
      return dataStreamTextResponse(formatHealthNewsAnswer(localMatches), id);
    }

    const webContext = await fetchWebContext(lastUserText);
    if (webContext) {
      return dataStreamTextResponse(
        [
          `Thông tin tham khảo cho câu hỏi: "${lastUserText}"`,
          '',
          webContext,
          '',
          'Lưu ý: Nội dung này chỉ dùng để tham khảo, không thay thế tư vấn/chẩn đoán của bác sĩ. Nếu có đau dữ dội, sưng nóng đỏ khớp, sốt, hoặc triệu chứng kéo dài, bạn nên đi khám chuyên khoa.',
        ].join('\n'),
        id
      );
    }

    return dataStreamTextResponse(generalMedicalFallbackAnswer(lastUserText), id);
  }

  if (isGeneralMedicalQuestion && !hasApiKeyForModel(selectedModel, apiKeys)) {
    const webContext = await fetchWebContext(lastUserText);
    return dataStreamTextResponse(
      webContext
        ? [
            'Chatbot chưa có API key cho model đang chọn nên chưa thể tổng hợp câu trả lời đầy đủ.',
            '',
            'Tôi đã tìm nhanh thông tin web tham khảo:',
            webContext,
            '',
            'Để có câu trả lời được diễn giải đầy đủ hơn, hãy cấu hình API key cho model trong phần API Key Settings.',
          ].join('\n')
        : 'Chatbot chưa có API key cho model đang chọn nên chưa thể tìm/tổng hợp thông tin y tế bên ngoài. Vui lòng cấu hình API key trong phần API Key Settings.',
      id
    );
  }

  // General medical knowledge queries use the local news file + bounded web context.
  // Skipping MCP tool setup here avoids slow SSE/tool handshakes before the first token.
  const shouldUseMcpTools = true;
  const { tools, cleanup } = shouldUseMcpTools
    ? await initializeMCPClients(mcpServers, req.signal)
    : { tools: {} as Record<string, any>, cleanup: async () => {} };

  console.log('messages', messages);
  console.log(
    'parts',
    messages.map((m) => m.parts.map((p) => p))
  );

  // Track if the response has completed
  let responseCompleted = false;
  const webContext = asksMedicalKnowledge(lastUserText) && !asksForPatientPrivateInfo(lastUserText)
    ? await fetchWebContext(lastUserText)
    : '';

  const result = streamText({
    model: languageModelWithApiKey(selectedModel, apiKeys),
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

QUY TẮC BẢO MẬT HỒ SƠ NGƯỜI BỆNH:
- Không tự ý tìm hoặc suy đoán thông tin người bệnh khác.
- Nếu người dùng hỏi hồ sơ/người bệnh cụ thể, chỉ được trả lời dữ liệu của chính tài khoản đang đăng nhập do server cung cấp.
- Với câu hỏi y tế chung, trả lời ở mức thông tin tham khảo, không thay thế bác sĩ.

${webContext ? `NGỮ CẢNH WEB THAM KHẢO ĐÃ TÌM ĐƯỢC:\n${webContext}` : ''}
${isGeneralMedicalQuestion ? `
YEU CAU CHO CAU HOI Y TE CHUNG:
- Tra loi truc tiep bang tieng Viet dua tren kien thuc y khoa va ngu canh tham khao neu co.
- Khong noi "vui long doi", "dang tim kiem", hoac hua se quay lai sau.
- Neu thong tin chua du, neu ro gioi han va khuyen nguoi dung gap bac si khi co trieu chung bat thuong.
` : ''}
    `,
    messages,
    tools,
    maxSteps: isGeneralMedicalQuestion ? 4 : 10,
    providerOptions: {
      google: {
        thinkingConfig: {
          thinkingBudget: isGeneralMedicalQuestion ? 512 : 2048,
        },
      },
      anthropic: {
        thinking: {
          type: 'enabled',
          budgetTokens: isGeneralMedicalQuestion ? 2048 : 12000,
        },
      },
    },
    experimental_transform: smoothStream({
      delayInMs: 5, // optional: defaults to 10ms
      chunking: 'line', // optional: defaults to 'word'
    }),
    onError: async (error) => {
      console.error(JSON.stringify(error, null, 2));
      try {
        await cleanup();
      } catch (cleanupError) {
        console.error('Error during cleanup after stream error:', cleanupError);
      }
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

            console.log('Auto verification result:', verify);
          }
        }
      } catch (e) {
        console.error('Auto verification error:', e);
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

  // Add chat ID to response headers so client can know which chat was created
  return result.toDataStreamResponse({
    sendReasoning: true,
    headers: {
      'X-Chat-ID': id,
    },
    getErrorMessage: getChatStreamErrorMessage,
    /*
    getErrorMessage: (error) => {
      if (error instanceof Error) {
        if (
          error.name === 'AI_LoadAPIKeyError' ||
          error.message.includes('API key is missing') ||
          error.message.includes('GOOGLE_GENERATIVE_AI_API_KEY')
        ) {
          return (
            'Chatbot chưa có API key cho model đang chọn. ' +
            'Vui lòng mở phần cấu hình API key ở sidebar hoặc đặt biến môi trường GOOGLE_API_KEY/GEMINI_API_KEY rồi restart Chat.'
          );
        }
        if (error.message.includes('Rate limit')) {
          return 'Rate limit exceeded. Please try again later.';
        }
      }
      console.error(error);
      return 'Có lỗi khi tạo câu trả lời. Vui lòng kiểm tra API key/model đang chọn hoặc thử lại sau.';
    },
    */
  });
}

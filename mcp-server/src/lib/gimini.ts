import { GoogleGenerativeAI } from "@google/generative-ai";

interface LLMOptions {
  name?: string;
  userId?: string;
  model?: string;
  metadata?: Record<string, any>;
}

export const genAI = () => {
  const apiKey = process.env["GOOGLE_API_KEY"];
  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is not defined in the environment variables.");
  }
  return new GoogleGenerativeAI(apiKey);
};

export async function callGemini(prompt: string, options: LLMOptions = {}) {
  const modelName = options.model ?? "gemini-2.0-flash";

  try {
    const model = genAI().getGenerativeModel({ model: modelName });
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    return text;
  } catch (err: any) {
    throw err;
  }
}

export async function callGeminiEmbedModel(
  prompt: string,
  options: LLMOptions = {},
  sqlFormat: string = ""
) {
  const apiKey = process.env["GOOGLE_API_KEY"];
  if (!apiKey) throw new Error("GOOGLE_API_KEY is not defined.");

  const modelName = options.model ?? "gemini-embedding-001";
  
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:embedContent`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      content: { parts: [{ text: prompt }] },
      // optional:
      // taskType: "RETRIEVAL_QUERY",
      // outputDimensionality: 768,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`[Gemini embedContent] ${res.status} ${res.statusText}: ${errText}`);
  }

  const data: any = await res.json();

  // Gemini API thường trả { embedding: { values: [...] } }
  const values: number[] =
    data?.embedding?.values ??
    data?.embeddings?.[0]?.values ??
    [];

  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`Embedding response invalid: ${JSON.stringify(data).slice(0, 500)}`);
  }

  return `[${values.join(",")}]`;
}
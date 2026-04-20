import os
import time
import psycopg2
from tqdm import tqdm
from importlib import metadata

# ===============================
#  Gemini Embeddings (SDK mới)
# ===============================
try:
    from google import genai  # google-genai
except Exception as e:
    raise RuntimeError(
        "Không import được 'from google import genai'. Hãy chắc chắn đã cài 'google-genai' và KHÔNG dùng 'google-generativeai'."
    ) from e

API_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
if not API_KEY:
    raise RuntimeError("Thiếu API key. Hãy set biến môi trường GEMINI_API_KEY (khuyến nghị) hoặc GOOGLE_API_KEY.")

client = genai.Client(api_key=API_KEY)

print("✅ Using google-genai version:", metadata.version("google-genai"))
print("✅ Embedding model:", "gemini-embedding-001")

# ===============================
#  DB cấu hình
# ===============================
DB_CONFIG = {
    "host": os.getenv("DB_HOST", "localhost"),
    "database": os.getenv("DB_NAME", "chatbot"),
    "user": os.getenv("DB_USER", "admin"),
    "password": os.getenv("DB_PASSWORD", "admin123"),
    "port": int(os.getenv("DB_PORT", "5432"))
}

# ===============================
#  Hàm lấy embedding
# ===============================

def get_embedding(text: str):
    """Gọi Gemini API tạo embedding"""
    time.sleep(0.3)

    if not text or not text.strip():
        return None

    try:
        resp = client.models.embed_content(
            model="gemini-embedding-001",
            contents=text,
        )
        # google-genai trả về list embeddings
        return resp.embeddings[0].values

    except Exception as e:
        print(f"❌ Lỗi khi tạo embedding: {e}")
        return None


def to_pgvector_literal(vec):
    """Chuyển list[float] -> dạng string '[0.1,0.2,...]' để update cột pgvector"""
    return "[" + ",".join(f"{x:.8f}" for x in vec) + "]"


# ===============================
#  Duyệt & cập nhật
# ===============================
conn = psycopg2.connect(**DB_CONFIG)
cursor = conn.cursor()

cursor.execute("""
    SELECT id, title, content
    FROM public.articles
    WHERE embedding IS NULL
""")

rows = cursor.fetchall()
print(f"🔹 Tổng số bản ghi cần cập nhật: {len(rows)}")

for row in tqdm(rows):
    rid, title, content = row
    text = f"{title}\n{content}".strip()

    emb = get_embedding(text)
    if not emb:
        continue

    # Nếu cột embedding là pgvector: dùng literal
    # Nếu cột embedding là json/float8[]/text: bạn cần sửa câu UPDATE cho phù hợp.
    cursor.execute(
        "UPDATE public.articles SET embedding = %s WHERE id = %s",
        (to_pgvector_literal(emb), rid),
    )
    conn.commit()

cursor.close()
conn.close()
print("✅ Hoàn tất cập nhật embedding cho tất cả bản ghi.")

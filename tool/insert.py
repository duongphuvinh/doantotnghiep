import pandas as pd
import google.generativeai as genai
import psycopg2
from tqdm import tqdm

# --- Config ---
genai.configure(api_key="YOUR_GEMINI_API_KEY")

DB_CONFIG = {
    "host": "localhost",
    "database": "chatbot",
    "user": "admin",
    "password": "admin123",
    "port": 5432
}



def get_embedding(text):
    response = genai.embed_content(
        model="models/embedding-001",
        content=text
    )
    return response["embedding"]


# --- Đọc file Excel ---
df = pd.read_excel("tblMedicalRecord_200rows.xlsx")

# Nếu bạn muốn convert markdown → text
# df["clean_content"] = df["content"].apply(markdown_to_text)

# --- Kết nối PostgreSQL ---
conn = psycopg2.connect(**DB_CONFIG)
cursor = conn.cursor()

# --- Lặp qua từng dòng để lưu vào DB ---
for _, row in tqdm(df.iterrows(), total=len(df)):
    IdNguoiBenh = row['IdNguoiBenh']
    MaNguoiBenh = row['MaNguoiBenh']
    HoTenNguoiBenh = row['HoTenNguoiBenh']
    NgayKham = row['NgayKham']
    NgayDieuTri = row['NgayDieuTri']
    ChanDoanBenh = row['ChanDoanBenh']
    KetQuaDieuTri = row['KetQuaDieuTri']

    cursor.execute(
        """
        INSERT INTO thong_tin_dieu_tri (IdNguoiBenh,
    MaNguoiBenh,
    HoTenNguoiBenh,
    NgayKham,
    NgayDieuTri,
    ChanDoanBenh,
    KetQuaDieuTri)
         VALUES (%s, %s, %s, %s, %s, %s, %s)
        """,
       (
        IdNguoiBenh,
        MaNguoiBenh,
        HoTenNguoiBenh,
        NgayKham,
        NgayDieuTri,
        ChanDoanBenh,
        KetQuaDieuTri
    )
    )
    conn.commit()

cursor.close()
conn.close()

print("✅ Đã lưu embedding vào PostgreSQL thành công.")

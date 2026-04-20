import { Pool } from "pg";

export const pool_pg = new Pool({
  host: process.env.DB_PG_SERVER,
  user: process.env.DB_PG_USER,
  password: process.env.DB_PG_PASSWORD,
  database: process.env.DB_PG_NAME,
  port: Number(process.env.DB_PG_PORT || 5432),
});

export async function query(sql: string, params?: any[]) {
  // 2️⃣ Truy vấn PostgreSQL tìm bài tương tự
  const client = await pool_pg.connect();
  const result = await client.query(sql, params);
  client.release();
  return result.rows;
}

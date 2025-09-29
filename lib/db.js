// file: lib/db.js
import mysql from 'mysql2/promise';

const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_PORT = +(process.env.DB_PORT || 3306); // default to 3306
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'bountyexpo';

console.log('[db] host=%s port=%s user=%s db=%s', DB_HOST, DB_PORT, DB_USER, DB_NAME);

export async function query(sql, params = []) {
  try {
    const conn = await mysql.createConnection({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
    });
    try {
      const [rows] = await conn.execute(sql, params);
      return rows;
    } finally {
      await conn.end();
    }
  } catch (err) {
    console.error('[db] connection error:', err.code || err.message);
    throw err;
  }
}
export async function connect() {
  return mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });
}


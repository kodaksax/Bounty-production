import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

export async function connect() {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
    });
    return connection;
  } catch (error) {
    console.error('Error connecting to the database:', error);
    throw error;
  }
}
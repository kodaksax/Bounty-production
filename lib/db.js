const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// Load environment variables (prefer .env.<NODE_ENV> at repo root then fallback)
{
  const envName = process.env.NODE_ENV ? `.env.${String(process.env.NODE_ENV).toLowerCase()}` : '.env';
  const rootEnv = path.resolve(process.cwd(), envName);
  if (fs.existsSync(rootEnv)) {
    dotenv.config({ path: rootEnv });
  } else {
    dotenv.config();
  }
}

async function connect() {
  try {
    const connection = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'bountyexpo_db',
      charset: 'utf8mb4'
    });
    
    // Test the connection
    await connection.ping();
    console.log('✅ Database connected successfully');
    return connection;
  } catch (error) {
    console.error('❌ Error connecting to the database:', error.message);
    throw error;
  }
}

module.exports = { connect };
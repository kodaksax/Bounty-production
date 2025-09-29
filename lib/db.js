const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

dotenv.config();

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
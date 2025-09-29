#!/usr/bin/env node

require('dotenv').config();

// Choose database based on environment
let connect;
if (process.env.USE_SQLITE === 'true') {
  console.log('🗄️  Using SQLite database (development/testing)');
  connect = require('../lib/db-sqlite').connect;
} else {
  console.log('🗄️  Using MySQL database (production)');
  connect = require('../lib/db').connect;
}

const fs = require('fs');
const path = require('path');

async function initDatabase() {
  let connection;
  
  try {
    console.log('🔄 Connecting to database...');
    connection = await connect();
    
    if (process.env.USE_SQLITE === 'true') {
      console.log('✅ SQLite database schema auto-initialized!');
    } else {
      console.log('📄 Reading schema file...');
      const schemaPath = path.join(__dirname, '../database/schema.sql');
      const schema = fs.readFileSync(schemaPath, 'utf8');
      
      // Split schema into individual statements
      const statements = schema
        .split(';')
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0);
      
      console.log(`📋 Executing ${statements.length} SQL statements...`);
      
      for (const statement of statements) {
        if (statement.trim()) {
          try {
            await connection.execute(statement);
          } catch (err) {
            // Log but don't stop for duplicate key or table exists errors
            if (!err.message.includes('already exists') && !err.message.includes('Duplicate entry')) {
              console.warn('Warning:', err.message);
            }
          }
        }
      }
    }
    
    console.log('✅ Database initialized successfully!');
    
    // Verify tables were created (SQLite vs MySQL compatibility)
    const showTablesQuery = process.env.USE_SQLITE === 'true' 
      ? "SELECT name FROM sqlite_master WHERE type='table'" 
      : 'SHOW TABLES';
    const [tables] = await connection.execute(showTablesQuery);
    
    const tableNames = process.env.USE_SQLITE === 'true' 
      ? tables.map(t => t.name).join(', ')
      : tables.map(t => Object.values(t)[0]).join(', ');
    console.log('📊 Created tables:', tableNames);
    
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    process.exit(1);
  } finally {
    if (connection) {
      try {
        await connection.end();
        console.log('🔌 Database connection closed');
      } catch (err) {
        console.warn('Warning: Error closing connection:', err.message);
      }
    }
  }
}

// Run the initialization
if (require.main === module) {
  initDatabase();
}

module.exports = { initDatabase };
#!/usr/bin/env node

const { connect } = require('../lib/db');
const fs = require('fs');
const path = require('path');

async function initDatabase() {
  let connection;
  
  try {
    console.log('🔄 Connecting to database...');
    connection = await connect();
    
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
    
    console.log('✅ Database initialized successfully!');
    
    // Verify tables were created
    const [tables] = await connection.execute('SHOW TABLES');
    console.log('📊 Created tables:', tables.map(t => Object.values(t)[0]).join(', '));
    
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
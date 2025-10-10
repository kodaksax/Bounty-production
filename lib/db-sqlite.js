const dotenv = require('dotenv');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const path = require('path');

dotenv.config();

// Global database connection
let globalDb = null;

async function connect() {
  try {
    const dbPath = process.env.NODE_ENV === 'test' 
      ? ':memory:' 
      : path.join(__dirname, '../data/bountyexpo.db');

    // Create data directory if it doesn't exist
    if (dbPath !== ':memory:') {
      const fs = require('fs');
      const dataDir = path.dirname(dbPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
    }

    if (!globalDb) {
      globalDb = await new Promise((resolve, reject) => {
        const db = new sqlite3.Database(dbPath, async (err) => {
          if (err) {
            console.error('❌ Error connecting to SQLite database:', err.message);
            reject(err);
            return;
          }
          
          console.log('✅ Connected to SQLite database');
          
          // Promisify database methods with proper context handling
          db.runAsync = function(sql, params) {
            return new Promise((resolve, reject) => {
              db.run(sql, params, function(err) {
                if (err) reject(err);
                else resolve({ lastID: this.lastID, changes: this.changes });
              });
            });
          };
          
          db.getAsync = promisify(db.get.bind(db));
          db.allAsync = promisify(db.all.bind(db));

          try {
            await initializeSchema(db);
            resolve(db);
          } catch (initError) {
            reject(initError);
          }
        });
      });
    }

    return createMySQLAdapter(globalDb);
  } catch (error) {
    console.error('❌ Error connecting to the database:', error.message);
    throw error;
  }
}

async function initializeSchema(database) {
  const schema = `
    -- Users/Profiles table
    CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        email TEXT UNIQUE,
        avatar_url TEXT,
        about TEXT,
        phone TEXT,
        balance REAL DEFAULT 0.00,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Bounties table
    CREATE TABLE IF NOT EXISTS bounties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        amount REAL DEFAULT 0.00,
        is_for_honor BOOLEAN DEFAULT FALSE,
        location TEXT,
        timeline TEXT,
        skills_required TEXT,
        user_id TEXT NOT NULL,
        status TEXT DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'archived')),
        work_type TEXT DEFAULT 'online' CHECK (work_type IN ('online', 'in_person')),
        is_time_sensitive BOOLEAN DEFAULT FALSE,
        deadline DATETIME NULL,
        attachments_json TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    -- Bounty Requests table
    CREATE TABLE IF NOT EXISTS bounty_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bounty_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (bounty_id) REFERENCES bounties(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE,
        UNIQUE(bounty_id, user_id)
    );

    -- Insert default test user
    INSERT OR IGNORE INTO profiles (id, username, email, about, phone, balance) 
    VALUES (
        '00000000-0000-0000-0000-000000000001',
        '@jon_Doe', 
        'test@example.com',
  '',
        '+998 90 943 32 00',
        100.00
    );
  `;

  const statements = schema.split(';').filter(stmt => stmt.trim());
  
  for (const statement of statements) {
    if (statement.trim()) {
      await database.runAsync(statement);
    }
  }

  console.log('✅ Database schema initialized');
}

// Adapter to make SQLite work with MySQL-style queries
function createMySQLAdapter(database) {
  return {
    async execute(query, params = []) {
      // Convert MySQL-style queries to SQLite
      let sqliteQuery = query
        .replace(/CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP/g, 'CURRENT_TIMESTAMP')
        .replace(/AUTO_INCREMENT/g, 'AUTOINCREMENT');

      try {
        if (query.toLowerCase().includes('select')) {
          const rows = await database.allAsync(sqliteQuery, params);
          return [rows];
        } else if (query.toLowerCase().includes('insert')) {
          const result = await database.runAsync(sqliteQuery, params);
          return [{ insertId: result.lastID || result.lastId, affectedRows: result.changes }];
        } else if (query.toLowerCase().includes('update') || query.toLowerCase().includes('delete')) {
          const result = await database.runAsync(sqliteQuery, params);
          return [{ affectedRows: result.changes }];
        } else {
          const result = await database.runAsync(sqliteQuery, params);
          return [result];
        }
      } catch (error) {
        console.error('SQLite query error:', error);
        console.error('Query:', sqliteQuery);
        console.error('Params:', params);
        throw error;
      }
    },
    
    async end() {
      // Don't close the global connection on individual requests
      return Promise.resolve();
    },
    
    async ping() {
      await database.getAsync('SELECT 1');
    }
  };
}

module.exports = { 
  connect
};
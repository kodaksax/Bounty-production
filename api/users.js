// Minimal DB connectivity + fetch test for the "users" table.
// Once verified, you can migrate this logic into an Express route (see notes below).
// api/users.js
import 'dotenv/config';          // loads .env early
import { query } from '../lib/db.js';
import { connect } from '../lib/db.js';

(async function main() {
  try {
    const rows = await query('SELECT id, email FROM users LIMIT 20');
    console.log(rows);
  } catch (err) {
    console.error('[users] error:', err);
    process.exit(1);
  }
})();

async function run() {
  let conn;
  try {
    conn = await connect();
    console.log('[users.js] Connected to DB');
    const [rows] = await conn.execute('SELECT * FROM users');
    console.log('[users.js] Fetched users:', rows);
  } catch (err) {
    console.error('[users.js] Fetch failed:', err);
    process.exitCode = 1;
  } finally {
    if (conn) {
      try { await conn.end(); } catch {}
    }
  }
}

run();

/*
Next steps (optional):
1. Create api/server.js with Express server:
   const express = require('express');
   const { connect } = require('../lib/db');
   const app = express();
   app.get('/users', async (_req,res)=>{ const conn = await connect(); const [rows]=await conn.execute('SELECT * FROM users'); await conn.end(); res.json(rows); });
   app.delete('/users/:id', async (req,res)=>{ const conn = await connect(); await conn.execute('DELETE FROM users WHERE id=?',[req.params.id]); await conn.end(); res.json({success:true}); });
   app.listen(3001, ()=> console.log('API listening on 3001'));

2. Run with: node api/server.js
*/


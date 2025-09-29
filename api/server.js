// api/server.js
const express = require('express');
const { connect } = require('../lib/db');

const app = express();

app.get('/users', async (_req, res) => {
  let conn;
  try {
    conn = await connect();
    const [rows] = await conn.execute('SELECT * FROM users');
    res.json(rows);
  } catch (e) {
    console.error('[GET /users] error:', e);
    res.status(500).json({ error: 'Failed to fetch users' });
  } finally {
    if (conn) try { await conn.end(); } catch {}
  }
});

app.delete('/users/:id', async (req, res) => {
  let conn;
  try {
    conn = await connect();
    await conn.execute('DELETE FROM users WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('[DELETE /users/:id] error:', e);
    res.status(500).json({ success: false });
  } finally {
    if (conn) try { await conn.end(); } catch {}
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API listening on :${PORT}`));
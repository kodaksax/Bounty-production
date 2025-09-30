// api/server.js
require('dotenv').config(); // Load environment variables first

const express = require('express');
const cors = require('cors');

// Import domain logic for bounty transitions and validation
const {
  transitionBounty,
  bountyCreateSchema,
  bountyUpdateSchema,
  bountyFilterSchema
} = require('../lib/domain/bounty-transitions');

// Choose database based on environment
let connect;
if (process.env.USE_SQLITE === 'true') {
  console.log('🗄️  Using SQLite database (development/testing)');
  connect = require('../lib/db-sqlite').connect;
} else {
  console.log('🗄️  Using MySQL database (production)');
  connect = require('../lib/db').connect;
}

const { v4: uuidv4 } = require('uuid');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Basic error handler
const handleError = (res, error, customMessage = 'Internal server error') => {
  console.error(customMessage + ':', error);
  res.status(500).json({ 
    error: customMessage,
    details: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==================== PROFILES ENDPOINTS ====================

// Get user profile by ID
app.get('/api/profiles/:id', async (req, res) => {
  let conn;
  try {
    conn = await connect();
    const [rows] = await conn.execute(
      'SELECT * FROM profiles WHERE id = ?',
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    res.json(rows[0]);
  } catch (error) {
    handleError(res, error, 'Failed to fetch profile');
  } finally {
    if (conn) try { await conn.end(); } catch {}
  }
});

// Get current user profile (for authenticated requests)
app.get('/api/profile', async (req, res) => {
  // For now, return default test user
  // In production, extract user ID from JWT token
  const userId = '00000000-0000-0000-0000-000000000001';
  
  let conn;
  try {
    conn = await connect();
    const [rows] = await conn.execute(
      'SELECT * FROM profiles WHERE id = ?',
      [userId]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Profile not found' });
    }
    
    res.json(rows[0]);
  } catch (error) {
    handleError(res, error, 'Failed to fetch profile');
  } finally {
    if (conn) try { await conn.end(); } catch {}
  }
});

// Create or update profile
app.post('/api/profiles', async (req, res) => {
  let conn;
  try {
    conn = await connect();
    const { id, username, email, avatar_url, about, phone, balance } = req.body;
    
    const profileId = id || uuidv4();
    
    const [result] = await conn.execute(`
      INSERT INTO profiles (id, username, email, avatar_url, about, phone, balance)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        username = VALUES(username),
        email = VALUES(email),
        avatar_url = VALUES(avatar_url),
        about = VALUES(about),
        phone = VALUES(phone),
        balance = VALUES(balance),
        updated_at = CURRENT_TIMESTAMP
    `, [profileId, username, email, avatar_url, about, phone, balance || 0]);

    // Fetch and return the updated profile
    const [rows] = await conn.execute('SELECT * FROM profiles WHERE id = ?', [profileId]);
    res.json(rows[0]);
    
  } catch (error) {
    handleError(res, error, 'Failed to create/update profile');
  } finally {
    if (conn) try { await conn.end(); } catch {}
  }
});

// ==================== BOUNTIES ENDPOINTS ====================

// Get all bounties with optional filters
app.get('/api/bounties', async (req, res) => {
  let conn;
  try {
    conn = await connect();
    
    // Validate query parameters using Zod schema
    const validation = bountyFilterSchema.safeParse(req.query);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Invalid query parameters',
        details: validation.error.errors
      });
    }
    
    let query = 'SELECT * FROM bounties';
    const conditions = [];
    const params = [];
    
    // Add filters
    if (validation.data.status) {
      conditions.push('status = ?');
      params.push(validation.data.status);
    }
    
    if (validation.data.user_id) {
      conditions.push('user_id = ?');
      params.push(validation.data.user_id);
    }
    
    if (validation.data.work_type) {
      conditions.push('work_type = ?');
      params.push(validation.data.work_type);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY created_at DESC';
    
    const [rows] = await conn.execute(query, params);
    
    // Add mock distance for location-based bounties
    const bountiesWithDistance = rows.map(bounty => ({
      ...bounty,
      distance: bounty.location ? Math.floor(Math.random() * 20) + 1 : undefined
    }));
    
    res.json(bountiesWithDistance);
  } catch (error) {
    handleError(res, error, 'Failed to fetch bounties');
  } finally {
    if (conn) try { await conn.end(); } catch {}
  }
});

// Get bounty by ID
app.get('/api/bounties/:id', async (req, res) => {
  let conn;
  try {
    conn = await connect();
    const [rows] = await conn.execute(
      'SELECT * FROM bounties WHERE id = ?',
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Bounty not found' });
    }
    
    const bounty = rows[0];
    // Add mock distance if location exists
    if (bounty.location) {
      bounty.distance = Math.floor(Math.random() * 20) + 1;
    }
    
    res.json(bounty);
  } catch (error) {
    handleError(res, error, 'Failed to fetch bounty');
  } finally {
    if (conn) try { await conn.end(); } catch {}
  }
});

// Create new bounty
app.post('/api/bounties', async (req, res) => {
  let conn;
  try {
    conn = await connect();
    
    // Validate request data using Zod schema
    const validation = bountyCreateSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Validation failed',
        details: validation.error.errors
      });
    }
    
    const {
      title,
      description,
      amount,
      is_for_honor,
      location,
      timeline,
      skills_required,
      user_id,
      work_type,
      is_time_sensitive,
      deadline,
      attachments_json
    } = validation.data;
    
    // Additional business logic validation
    if (!is_for_honor && (!amount || amount <= 0)) {
      return res.status(400).json({ 
        error: 'Amount must be greater than 0 for paid bounties' 
      });
    }
    
    const [result] = await conn.execute(`
      INSERT INTO bounties (
        title, description, amount, is_for_honor, location, 
        timeline, skills_required, user_id, work_type, 
        is_time_sensitive, deadline, attachments_json, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      title, description, amount || 0, is_for_honor || false, location,
      timeline, skills_required, user_id, work_type || 'online',
      is_time_sensitive || false, deadline, attachments_json, 'open'
    ]);
    
    // Fetch and return the created bounty
    const [rows] = await conn.execute('SELECT * FROM bounties WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
    
  } catch (error) {
    handleError(res, error, 'Failed to create bounty');
  } finally {
    if (conn) try { await conn.end(); } catch {}
  }
});

// Update bounty
app.patch('/api/bounties/:id', async (req, res) => {
  let conn;
  try {
    conn = await connect();
    
    const bountyId = req.params.id;
    
    // Validate request data using Zod schema
    const validation = bountyUpdateSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: 'Validation failed',
        details: validation.error.errors
      });
    }
    
    const updates = validation.data;
    
    // Build dynamic update query
    const updateFields = [];
    const params = [];
    
    Object.keys(updates).forEach(key => {
      if (key !== 'id' && key !== 'created_at') {
        updateFields.push(`${key} = ?`);
        params.push(updates[key]);
      }
    });
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    
    params.push(bountyId);
    
    const [result] = await conn.execute(
      `UPDATE bounties SET ${updateFields.join(', ')} WHERE id = ?`,
      params
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Bounty not found' });
    }
    
    // Fetch and return updated bounty
    const [rows] = await conn.execute('SELECT * FROM bounties WHERE id = ?', [bountyId]);
    res.json(rows[0]);
    
  } catch (error) {
    handleError(res, error, 'Failed to update bounty');
  } finally {
    if (conn) try { await conn.end(); } catch {}
  }
});

// Delete bounty
app.delete('/api/bounties/:id', async (req, res) => {
  let conn;
  try {
    conn = await connect();
    
    const [result] = await conn.execute('DELETE FROM bounties WHERE id = ?', [req.params.id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Bounty not found' });
    }
    
    res.json({ success: true, message: 'Bounty deleted successfully' });
  } catch (error) {
    handleError(res, error, 'Failed to delete bounty');
  } finally {
    if (conn) try { await conn.end(); } catch {}
  }
});

// ==================== BOUNTY TRANSITION ENDPOINTS ====================

// Accept a bounty (transition from open to in_progress)
app.post('/api/bounties/:id/accept', async (req, res) => {
  let conn;
  try {
    conn = await connect();
    
    // Get current bounty
    const [rows] = await conn.execute('SELECT * FROM bounties WHERE id = ?', [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Bounty not found' });
    }
    
    const bounty = rows[0];
    const transitionResult = transitionBounty(bounty.status, 'accept');
    
    if (!transitionResult.success) {
      return res.status(409).json({ 
        error: 'Invalid state transition',
        details: transitionResult.error,
        currentStatus: bounty.status
      });
    }
    
    // Update bounty status
    const [updateResult] = await conn.execute(
      'UPDATE bounties SET status = ? WHERE id = ?',
      [transitionResult.newStatus, req.params.id]
    );
    
    if (updateResult.affectedRows === 0) {
      return res.status(500).json({ error: 'Failed to update bounty status' });
    }
    
    // Fetch and return updated bounty
    const [updatedRows] = await conn.execute('SELECT * FROM bounties WHERE id = ?', [req.params.id]);
    res.json({
      success: true,
      bounty: updatedRows[0],
      transition: 'accept',
      previousStatus: bounty.status,
      newStatus: transitionResult.newStatus
    });
    
  } catch (error) {
    handleError(res, error, 'Failed to accept bounty');
  } finally {
    if (conn) try { await conn.end(); } catch {}
  }
});

// Complete a bounty (transition from in_progress to completed)
app.post('/api/bounties/:id/complete', async (req, res) => {
  let conn;
  try {
    conn = await connect();
    
    // Get current bounty
    const [rows] = await conn.execute('SELECT * FROM bounties WHERE id = ?', [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Bounty not found' });
    }
    
    const bounty = rows[0];
    const transitionResult = transitionBounty(bounty.status, 'complete');
    
    if (!transitionResult.success) {
      return res.status(409).json({ 
        error: 'Invalid state transition',
        details: transitionResult.error,
        currentStatus: bounty.status
      });
    }
    
    // Update bounty status
    const [updateResult] = await conn.execute(
      'UPDATE bounties SET status = ? WHERE id = ?',
      [transitionResult.newStatus, req.params.id]
    );
    
    if (updateResult.affectedRows === 0) {
      return res.status(500).json({ error: 'Failed to update bounty status' });
    }
    
    // Fetch and return updated bounty
    const [updatedRows] = await conn.execute('SELECT * FROM bounties WHERE id = ?', [req.params.id]);
    res.json({
      success: true,
      bounty: updatedRows[0],
      transition: 'complete',
      previousStatus: bounty.status,
      newStatus: transitionResult.newStatus
    });
    
  } catch (error) {
    handleError(res, error, 'Failed to complete bounty');
  } finally {
    if (conn) try { await conn.end(); } catch {}
  }
});

// Archive a bounty (transition to archived from any status)
app.post('/api/bounties/:id/archive', async (req, res) => {
  let conn;
  try {
    conn = await connect();
    
    // Get current bounty
    const [rows] = await conn.execute('SELECT * FROM bounties WHERE id = ?', [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Bounty not found' });
    }
    
    const bounty = rows[0];
    const transitionResult = transitionBounty(bounty.status, 'archive');
    
    if (!transitionResult.success) {
      return res.status(409).json({ 
        error: 'Invalid state transition',
        details: transitionResult.error,
        currentStatus: bounty.status
      });
    }
    
    // Update bounty status
    const [updateResult] = await conn.execute(
      'UPDATE bounties SET status = ? WHERE id = ?',
      [transitionResult.newStatus, req.params.id]
    );
    
    if (updateResult.affectedRows === 0) {
      return res.status(500).json({ error: 'Failed to update bounty status' });
    }
    
    // Fetch and return updated bounty
    const [updatedRows] = await conn.execute('SELECT * FROM bounties WHERE id = ?', [req.params.id]);
    res.json({
      success: true,
      bounty: updatedRows[0],
      transition: 'archive',
      previousStatus: bounty.status,
      newStatus: transitionResult.newStatus
    });
    
  } catch (error) {
    handleError(res, error, 'Failed to archive bounty');
  } finally {
    if (conn) try { await conn.end(); } catch {}
  }
});

// ==================== BOUNTY REQUESTS ENDPOINTS ====================

// Get all bounty requests with optional filters
app.get('/api/bounty-requests', async (req, res) => {
  let conn;
  try {
    conn = await connect();
    
    // Build query with joins to get bounty and profile data
    let query = `
      SELECT 
        br.*,
        b.title as bounty_title,
        b.amount as bounty_amount,
        b.location as bounty_location,
        b.work_type as bounty_work_type,
        b.deadline as bounty_deadline,
        b.is_for_honor as bounty_is_for_honor,
        p.username as profile_username,
        p.avatar_url as profile_avatar_url
      FROM bounty_requests br
      LEFT JOIN bounties b ON br.bounty_id = b.id
      LEFT JOIN profiles p ON br.user_id = p.id
    `;
    
    const conditions = [];
    const params = [];
    
    // Add filters
    if (req.query.status) {
      conditions.push('br.status = ?');
      params.push(req.query.status);
    }
    
    if (req.query.bounty_id) {
      conditions.push('br.bounty_id = ?');
      params.push(req.query.bounty_id);
    }
    
    if (req.query.user_id) {
      conditions.push('br.user_id = ?');
      params.push(req.query.user_id);
    }
    
    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    
    query += ' ORDER BY br.created_at DESC';
    
    const [rows] = await conn.execute(query, params);
    
    // Transform the flat results into nested structure expected by frontend
    const transformedRows = rows.map(row => ({
      id: row.id,
      bounty_id: row.bounty_id,
      user_id: row.user_id,
      status: row.status,
      created_at: row.created_at,
      updated_at: row.updated_at,
      bounty: {
        id: row.bounty_id,
        title: row.bounty_title,
        amount: row.bounty_amount,
        location: row.bounty_location,
        work_type: row.bounty_work_type,
        deadline: row.bounty_deadline,
        is_for_honor: row.bounty_is_for_honor
      },
      profile: {
        id: row.user_id,
        username: row.profile_username,
        avatar_url: row.profile_avatar_url
      }
    }));
    
    res.json(transformedRows);
  } catch (error) {
    handleError(res, error, 'Failed to fetch bounty requests');
  } finally {
    if (conn) try { await conn.end(); } catch {}
  }
});

// Get bounty request by ID
app.get('/api/bounty-requests/:id', async (req, res) => {
  let conn;
  try {
    conn = await connect();
    const [rows] = await conn.execute(
      'SELECT * FROM bounty_requests WHERE id = ?',
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Bounty request not found' });
    }
    
    res.json(rows[0]);
  } catch (error) {
    handleError(res, error, 'Failed to fetch bounty request');
  } finally {
    if (conn) try { await conn.end(); } catch {}
  }
});

// Get bounty requests by user ID
app.get('/api/bounty-requests/user/:userId', async (req, res) => {
  let conn;
  try {
    conn = await connect();
    const [rows] = await conn.execute(
      'SELECT * FROM bounty_requests WHERE user_id = ? ORDER BY created_at DESC',
      [req.params.userId]
    );
    res.json(rows);
  } catch (error) {
    handleError(res, error, 'Failed to fetch bounty requests');
  } finally {
    if (conn) try { await conn.end(); } catch {}
  }
});

// Create bounty request
app.post('/api/bounty-requests', async (req, res) => {
  let conn;
  try {
    conn = await connect();
    const { bounty_id, user_id, status } = req.body;
    
    // Validation
    if (!bounty_id || !user_id) {
      return res.status(400).json({ error: 'bounty_id and user_id are required' });
    }
    
    const [result] = await conn.execute(
      'INSERT INTO bounty_requests (bounty_id, user_id, status) VALUES (?, ?, ?)',
      [bounty_id, user_id, status || 'pending']
    );
    
    const [rows] = await conn.execute('SELECT * FROM bounty_requests WHERE id = ?', [result.insertId]);
    res.status(201).json(rows[0]);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Request already exists for this bounty' });
    }
    handleError(res, error, 'Failed to create bounty request');
  } finally {
    if (conn) try { await conn.end(); } catch {}
  }
});

// Update bounty request
app.patch('/api/bounty-requests/:id', async (req, res) => {
  let conn;
  try {
    conn = await connect();
    
    const requestId = req.params.id;
    const updates = req.body;
    
    // Build dynamic update query
    const updateFields = [];
    const params = [];
    
    Object.keys(updates).forEach(key => {
      if (key !== 'id' && key !== 'created_at') {
        updateFields.push(`${key} = ?`);
        params.push(updates[key]);
      }
    });
    
    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }
    
    params.push(requestId);
    
    const [result] = await conn.execute(
      `UPDATE bounty_requests SET ${updateFields.join(', ')} WHERE id = ?`,
      params
    );
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Bounty request not found' });
    }
    
    // Fetch and return updated request
    const [rows] = await conn.execute('SELECT * FROM bounty_requests WHERE id = ?', [requestId]);
    res.json(rows[0]);
    
  } catch (error) {
    handleError(res, error, 'Failed to update bounty request');
  } finally {
    if (conn) try { await conn.end(); } catch {}
  }
});

// Delete bounty request
app.delete('/api/bounty-requests/:id', async (req, res) => {
  let conn;
  try {
    conn = await connect();
    
    const [result] = await conn.execute('DELETE FROM bounty_requests WHERE id = ?', [req.params.id]);
    
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Bounty request not found' });
    }
    
    res.json({ success: true, message: 'Bounty request deleted successfully' });
  } catch (error) {
    handleError(res, error, 'Failed to delete bounty request');
  } finally {
    if (conn) try { await conn.end(); } catch {}
  }
});

// ==================== AUTH ENDPOINTS ====================

// Simple sign-in (mock implementation)
app.post('/auth/sign-in', async (req, res) => {
  let conn;
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    conn = await connect();
    const [rows] = await conn.execute(
      'SELECT * FROM profiles WHERE email = ?',
      [email]
    );
    
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // In production, verify password hash here
    // For now, accept any password for testing
    
    const user = rows[0];
    res.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      },
      // In production, return a JWT token here
      token: 'mock_jwt_token'
    });
    
  } catch (error) {
    handleError(res, error, 'Authentication failed');
  } finally {
    if (conn) try { await conn.end(); } catch {}
  }
});

// Get current user ID (for auth)
app.get('/api/user-id', (req, res) => {
  // In production, extract from JWT token
  res.text('00000000-0000-0000-0000-000000000001');
});

// ==================== LEGACY USERS ENDPOINTS ====================

// Keep existing users endpoints for compatibility
app.get('/users', async (req, res) => {
  let conn;
  try {
    conn = await connect();
    const [rows] = await conn.execute('SELECT * FROM profiles');
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
    await conn.execute('DELETE FROM profiles WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    console.error('[DELETE /users/:id] error:', e);
    res.status(500).json({ success: false });
  } finally {
    if (conn) try { await conn.end(); } catch {}
  }
});

// ==================== SERVER STARTUP ====================

const PORT = process.env.API_PORT || process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`🚀 API server listening on http://localhost:${PORT}`);
  console.log(`📋 Health check: http://localhost:${PORT}/health`);
});

module.exports = app;
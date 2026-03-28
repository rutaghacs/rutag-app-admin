require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'sensor_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres'
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000 // 8 hours
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// AUTH MIDDLEWARE & ENDPOINTS
// ============================================

function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

function requireApiKey(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  const expectedApiKey = process.env.API_KEY;

  if (!expectedApiKey) {
    return res.status(503).json({ error: 'API key not configured on server' });
  }

  if (!apiKey || apiKey !== expectedApiKey) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  return next();
}

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.authenticated = true;
    req.session.username = username;
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/status', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.authenticated) });
});

app.post('/api/users/sync', async (req, res) => {
  try {
    const { userId, email, displayName } = req.body;

    if (!userId || !email) {
      return res.status(400).json({
        error: 'Missing required fields: userId, email'
      });
    }

    const query = `
      INSERT INTO app_users (user_id, email, display_name, is_blocked, last_login, created_at, updated_at)
      VALUES ($1, $2, $3, false, NOW(), NOW(), NOW())
      ON CONFLICT (user_id) DO UPDATE
      SET email = EXCLUDED.email,
          display_name = COALESCE(EXCLUDED.display_name, app_users.display_name),
          last_login = NOW(),
          updated_at = NOW()
      RETURNING user_id, email, display_name, is_blocked, created_at, last_login, updated_at
    `;

    const result = await pool.query(query, [userId, email, displayName || email]);

    res.json({
      success: true,
      message: 'User synced successfully',
      user: result.rows[0]
    });
  } catch (error) {
    console.error('User sync error:', error);

    if (error.code === '23505' && error.constraint === 'app_users_email_key') {
      return res.status(409).json({ error: 'Email already registered' });
    }

    res.status(500).json({
      error: 'Failed to sync user',
      message: error.message
    });
  }
});

// ============================================
// DASHBOARD ENDPOINTS
// ============================================

// Get dashboard statistics
app.get('/api/dashboard/stats', requireAuth, async (req, res) => {
  try {
    const devicesQuery = 'SELECT COUNT(*) as count FROM devices';
    const usersQuery = 'SELECT COUNT(*) as count FROM app_users';
    const activeDevicesQuery = 'SELECT COUNT(*) as count FROM devices WHERE is_active = true';
    const blockedUsersQuery = 'SELECT COUNT(*) as count FROM app_users WHERE is_blocked = true';

    const [devices, users, activeDevices, blockedUsers] = await Promise.all([
      pool.query(devicesQuery),
      pool.query(usersQuery),
      pool.query(activeDevicesQuery),
      pool.query(blockedUsersQuery)
    ]);

    res.json({
      totalDevices: parseInt(devices.rows[0].count),
      totalUsers: parseInt(users.rows[0].count),
      activeDevices: parseInt(activeDevices.rows[0].count),
      blockedUsers: parseInt(blockedUsers.rows[0].count)
    });
  } catch (error) {
    console.error('Dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to fetch dashboard stats' });
  }
});

// ============================================
// DEVICE ENDPOINTS
// ============================================

// Get all devices
app.get('/api/devices', requireAuth, async (req, res) => {
  try {
    const query = `
      SELECT 
        device_id,
        device_name,
        location,
        is_active,
        last_seen,
        created_at
      FROM devices
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Get devices error:', error);
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

// Toggle device status (restrict/allow data)
app.put('/api/devices/:deviceId/toggle', requireAuth, async (req, res) => {
  const { deviceId } = req.params;
  
  try {
    const query = `
      UPDATE devices 
      SET is_active = NOT is_active,
          updated_at = NOW()
      WHERE device_id = $1
      RETURNING device_id, device_name, is_active
    `;
    const result = await pool.query(query, [deviceId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    res.json({
      message: `Device ${result.rows[0].is_active ? 'enabled' : 'disabled'} successfully`,
      device: result.rows[0]
    });
  } catch (error) {
    console.error('Toggle device error:', error);
    res.status(500).json({ error: 'Failed to toggle device status' });
  }
});

// Update device details
app.put('/api/devices/:deviceId', requireAuth, async (req, res) => {
  const { deviceId } = req.params;
  const { device_name, location } = req.body;
  
  try {
    const query = `
      UPDATE devices 
      SET device_name = COALESCE($1, device_name),
          location = COALESCE($2, location),
          updated_at = NOW()
      WHERE device_id = $3
      RETURNING *
    `;
    const result = await pool.query(query, [device_name, location, deviceId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Update device error:', error);
    res.status(500).json({ error: 'Failed to update device' });
  }
});

// ============================================
// USER ENDPOINTS
// ============================================

// Get all app users
app.get('/api/users', requireAuth, async (req, res) => {
  try {
    const query = `
      SELECT 
        user_id,
        email,
        display_name,
        is_blocked,
        created_at,
        last_login
      FROM app_users
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Toggle user block status
app.put('/api/users/:userId/toggle-block', requireAuth, async (req, res) => {
  const { userId } = req.params;
  
  try {
    const query = `
      UPDATE app_users 
      SET is_blocked = NOT is_blocked,
          updated_at = NOW()
      WHERE user_id = $1
      RETURNING user_id, email, display_name, is_blocked
    `;
    const result = await pool.query(query, [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
      message: `User ${result.rows[0].is_blocked ? 'blocked' : 'unblocked'} successfully`,
      user: result.rows[0]
    });
  } catch (error) {
    console.error('Toggle user block error:', error);
    res.status(500).json({ error: 'Failed to toggle user block status' });
  }
});

app.get('/api/check-device/:deviceId', requireApiKey, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const result = await pool.query(
      'SELECT device_id, device_name, is_active, location, last_seen FROM devices WHERE device_id = $1',
      [deviceId]
    );

    if (result.rows.length === 0) {
      return res.json({
        hasAccess: false,
        registered: false,
        reason: 'Device is not registered'
      });
    }

    if (result.rows[0].is_active !== true) {
      return res.json({
        hasAccess: false,
        registered: true,
        reason: 'Device is restricted',
        device: result.rows[0]
      });
    }

    res.json({
      hasAccess: true,
      registered: true,
      device: result.rows[0]
    });
  } catch (error) {
    console.error('Check device error:', error);
    res.status(500).json({ error: 'Failed to check device status' });
  }
});

app.get('/api/check-access/:userId/:deviceId', requireApiKey, async (req, res) => {
  try {
    const { userId, deviceId } = req.params;

    const userResult = await pool.query(
      'SELECT user_id, is_blocked FROM app_users WHERE user_id = $1',
      [userId]
    );

    if (userResult.rows.length > 0 && userResult.rows[0].is_blocked === true) {
      return res.json({
        hasAccess: false,
        reason: 'User is blocked'
      });
    }

    const deviceResult = await pool.query(
      'SELECT device_id, device_name, is_active, location, last_seen FROM devices WHERE device_id = $1',
      [deviceId]
    );

    if (deviceResult.rows.length === 0) {
      return res.json({
        hasAccess: false,
        reason: 'Device is not registered'
      });
    }

    if (deviceResult.rows[0].is_active !== true) {
      return res.json({
        hasAccess: false,
        reason: 'Device is restricted',
        device: deviceResult.rows[0]
      });
    }

    res.json({
      hasAccess: true,
      accessLevel: 'default',
      device: deviceResult.rows[0]
    });
  } catch (error) {
    console.error('Check access error:', error);
    res.status(500).json({ error: 'Failed to check access' });
  }
});

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', database: 'connected' });
  } catch (error) {
    res.status(500).json({ status: 'unhealthy', database: 'disconnected' });
  }
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`Admin Portal running on http://localhost:${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  await pool.end();
  process.exit(0);
});

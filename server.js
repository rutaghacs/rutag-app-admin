require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const session = require('express-session');
const { Pool } = require('pg');
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const FIREBASE_SYNC_INTERVAL_MS = parseInt(process.env.FIREBASE_SYNC_INTERVAL_MS || '15000', 10);

let firebaseDb = null;
let firebaseInitialized = false;
let firebaseSyncPromise = null;
let lastFirebaseSyncAt = 0;

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'sensor_db',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres'
});

function parseServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8');
    return JSON.parse(decoded);
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  }

  if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
    return {
      type: 'service_account',
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL
    };
  }

  const credentialPaths = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(__dirname, 'serviceAccountKey.json'),
    path.join(__dirname, '..', 'serviceAccountKey.json')
  ].filter(Boolean);

  for (const credentialPath of credentialPaths) {
    try {
      if (!fs.existsSync(credentialPath)) continue;
      const raw = fs.readFileSync(credentialPath, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      console.warn(`[Firebase] Failed loading credentials from ${credentialPath}: ${error.message}`);
    }
  }

  return null;
}

function initializeFirebase() {
  try {
    const serviceAccount = parseServiceAccount();
    if (!serviceAccount) {
      console.warn('[Firebase] Credentials not configured. List endpoints will use PostgreSQL only.');
      return;
    }

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: process.env.FIREBASE_DATABASE_URL
      });
    }

    firebaseDb = admin.firestore();
    firebaseInitialized = true;
    console.log('[Firebase] Initialized for users/devices sync');
  } catch (error) {
    firebaseInitialized = false;
    console.error('[Firebase] Initialization failed:', error.message);
  }
}

function toJsDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value._seconds === 'number') return new Date(value._seconds * 1000);

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function syncUsersFromFirebase() {
  if (!firebaseInitialized || !firebaseDb) return;

  const usersSnapshot = await firebaseDb.collection('users').get();
  let upserted = 0;
  let failed = 0;
  for (const doc of usersSnapshot.docs) {
    const data = doc.data() || {};
    const userId = doc.id;

    let email = data.email || null;
    if (!email) {
      try {
        const userRecord = await admin.auth().getUser(userId);
        email = userRecord.email || null;
      } catch (_) {
        email = null;
      }
    }

    if (!email) {
      email = `${userId}@firebase.local`;
    }

    const displayName = data.displayName || data.display_name || data.name || email;
    const lastLogin = toJsDate(data.lastLogin || data.last_login || data.updatedAt || data.updated_at);
    const createdAt = toJsDate(data.createdAt || data.created_at) || new Date();
    let authProvider = 'google';

    try {
      const userRecord = await admin.auth().getUser(userId);
      const providers = (userRecord.providerData || []).map((p) => p.providerId);
      if (providers.includes('password')) {
        authProvider = 'password';
      }
    } catch (_) {
      // Keep default provider when auth profile cannot be loaded.
    }

    try {
      await pool.query(
        `
          INSERT INTO app_users (user_id, email, display_name, auth_provider, is_blocked, last_login, created_at, updated_at)
          VALUES ($1, $2, $3, $4, false, $5, $6, NOW())
          ON CONFLICT (user_id) DO UPDATE
          SET email = EXCLUDED.email,
              display_name = COALESCE(EXCLUDED.display_name, app_users.display_name),
              auth_provider = COALESCE(app_users.auth_provider, EXCLUDED.auth_provider, 'google'),
              last_login = COALESCE(EXCLUDED.last_login, app_users.last_login),
              updated_at = NOW()
        `,
        [userId, email, displayName, authProvider, lastLogin, createdAt]
      );
      upserted += 1;
    } catch (error) {
      console.warn(`[Firebase Sync] Skipping user ${userId}: ${error.message}`);
      failed += 1;
    }
  }

  return {
    total: usersSnapshot.size,
    upserted,
    failed,
  };
}

async function syncDevicesFromFirebase() {
  if (!firebaseInitialized || !firebaseDb) return;

  const devicesSnapshot = await firebaseDb.collection('devices').get();
  let upserted = 0;
  let failed = 0;
  for (const doc of devicesSnapshot.docs) {
    const data = doc.data() || {};
    const deviceId = data.deviceId || data.device_id || doc.id;
    const deviceName = data.deviceName || data.device_name || data.name || `Device ${deviceId}`;
    const location = data.location || null;
    const isActive = typeof data.isActive === 'boolean'
      ? data.isActive
      : (typeof data.is_active === 'boolean' ? data.is_active : true);
    const lastSeen = toJsDate(data.lastSeen || data.last_seen || data.updatedAt || data.updated_at);
    const createdAt = toJsDate(data.createdAt || data.created_at) || new Date();

    try {
      await pool.query(
        `
          INSERT INTO devices (device_id, device_name, location, is_active, last_seen, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, NOW())
          ON CONFLICT (device_id) DO UPDATE
          SET device_name = COALESCE(EXCLUDED.device_name, devices.device_name),
              location = COALESCE(EXCLUDED.location, devices.location),
              last_seen = COALESCE(EXCLUDED.last_seen, devices.last_seen),
              updated_at = NOW()
        `,
        [deviceId, deviceName, location, isActive, lastSeen, createdAt]
      );
      upserted += 1;
    } catch (error) {
      console.warn(`[Firebase Sync] Skipping device ${deviceId}: ${error.message}`);
      failed += 1;
    }
  }

  return {
    total: devicesSnapshot.size,
    upserted,
    failed,
  };
}

async function runFirebaseSync(force = false) {
  const now = Date.now();
  if (!firebaseInitialized || !firebaseDb) {
    return {
      skipped: true,
      reason: 'Firebase is not configured',
    };
  }

  if (firebaseSyncPromise) {
    return await firebaseSyncPromise;
  }

  if (!force && now - lastFirebaseSyncAt < FIREBASE_SYNC_INTERVAL_MS) {
    return {
      skipped: true,
      reason: 'Sync interval not elapsed',
      msUntilNextSync: FIREBASE_SYNC_INTERVAL_MS - (now - lastFirebaseSyncAt),
    };
  }

  firebaseSyncPromise = (async () => {
    const [users, devices] = await Promise.all([syncUsersFromFirebase(), syncDevicesFromFirebase()]);
    lastFirebaseSyncAt = Date.now();
    return {
      skipped: false,
      users,
      devices,
      syncedAt: lastFirebaseSyncAt,
    };
  })();

  try {
    return await firebaseSyncPromise;
  } finally {
    firebaseSyncPromise = null;
  }
}

async function syncFromFirebaseIfDue() {
  await runFirebaseSync(false);
}

async function ensureSchema() {
  await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) DEFAULT 'google'`);
  await pool.query(`UPDATE app_users SET auth_provider = 'google' WHERE auth_provider IS NULL`);
}

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
    const { userId, email, displayName, authProvider } = req.body;

    if (!userId || !email) {
      return res.status(400).json({
        error: 'Missing required fields: userId, email'
      });
    }

    const query = `
      INSERT INTO app_users (user_id, email, display_name, auth_provider, is_blocked, last_login, created_at, updated_at)
      VALUES ($1, $2, $3, COALESCE($4, 'google'), false, NOW(), NOW(), NOW())
      ON CONFLICT (user_id) DO UPDATE
      SET email = EXCLUDED.email,
          display_name = COALESCE(EXCLUDED.display_name, app_users.display_name),
          auth_provider = COALESCE(app_users.auth_provider, EXCLUDED.auth_provider, 'google'),
          last_login = NOW(),
          updated_at = NOW()
      RETURNING user_id, email, display_name, is_blocked, created_at, last_login, updated_at
    `;

    const result = await pool.query(query, [userId, email, displayName || email, authProvider || 'google']);

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

app.post('/api/mobile/email-login/check', async (req, res) => {
  try {
    const email = (req.body?.email || '').trim().toLowerCase();
    if (!email) {
      return res.status(400).json({ allowed: false, reason: 'Email is required' });
    }

    const result = await pool.query(
      `
        SELECT user_id, is_blocked, auth_provider
        FROM app_users
        WHERE LOWER(email) = $1
        LIMIT 1
      `,
      [email]
    );

    if (result.rows.length === 0) {
      return res.json({ allowed: false, reason: 'Account must be created by admin' });
    }

    const row = result.rows[0];
    if (row.auth_provider !== 'password') {
      return res.json({ allowed: false, reason: 'Only admin-created email accounts are allowed' });
    }

    if (row.is_blocked === true) {
      return res.json({ allowed: false, reason: 'Account is blocked' });
    }

    return res.json({ allowed: true });
  } catch (error) {
    console.error('Mobile email-login check error:', error);
    return res.status(500).json({ allowed: false, reason: 'Server error' });
  }
});

app.post('/api/sync/refresh', requireAuth, async (req, res) => {
  try {
    const syncResult = await runFirebaseSync(true);

    const [usersCount, devicesCount] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM app_users'),
      pool.query('SELECT COUNT(*)::int AS count FROM devices')
    ]);

    return res.json({
      success: true,
      message: 'Data sync completed',
      sync: syncResult,
      totals: {
        users: usersCount.rows[0].count,
        devices: devicesCount.rows[0].count,
      },
      source: 'Firebase -> EC2 PostgreSQL -> Admin Portal'
    });
  } catch (error) {
    console.error('Manual sync error:', error);
    return res.status(500).json({ error: 'Failed to sync data' });
  }
});

// ============================================
// DASHBOARD ENDPOINTS
// ============================================

// Get dashboard statistics
app.get('/api/dashboard/stats', requireAuth, async (req, res) => {
  try {
    await syncFromFirebaseIfDue();

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
    await syncFromFirebaseIfDue();

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
    await syncFromFirebaseIfDue();

    const query = `
      SELECT 
        user_id,
        email,
        display_name,
        auth_provider,
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

app.post('/api/users/create-password-account', requireAuth, async (req, res) => {
  try {
    if (!firebaseInitialized) {
      return res.status(503).json({ error: 'Firebase is not configured on server' });
    }

    const email = (req.body?.email || '').trim().toLowerCase();
    const password = req.body?.password || '';
    const displayName = (req.body?.displayName || '').trim();

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await pool.query('SELECT user_id FROM app_users WHERE LOWER(email) = $1 LIMIT 1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'A user with this email already exists' });
    }

    let createdAuthUser;
    try {
      createdAuthUser = await admin.auth().createUser({
        email,
        password,
        displayName: displayName || undefined
      });
    } catch (error) {
      if (error?.code === 'auth/email-already-exists') {
        return res.status(409).json({ error: 'A Firebase user with this email already exists' });
      }
      throw error;
    }

    const upsert = await pool.query(
      `
        INSERT INTO app_users (user_id, email, display_name, auth_provider, is_blocked, last_login, created_at, updated_at)
        VALUES ($1, $2, $3, 'password', false, NULL, NOW(), NOW())
        RETURNING user_id, email, display_name, auth_provider, is_blocked, created_at, last_login
      `,
      [createdAuthUser.uid, email, displayName || email]
    );

    return res.json({ success: true, user: upsert.rows[0] });
  } catch (error) {
    console.error('Create password account error:', error);
    return res.status(500).json({ error: 'Failed to create user account' });
  }
});

app.post('/api/users/:userId/generate-reset-link', requireAuth, async (req, res) => {
  try {
    if (!firebaseInitialized) {
      return res.status(503).json({ error: 'Firebase is not configured on server' });
    }

    const { userId } = req.params;
    const result = await pool.query(
      `
        SELECT user_id, email, auth_provider
        FROM app_users
        WHERE user_id = $1
        LIMIT 1
      `,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    if (user.auth_provider !== 'password') {
      return res.status(400).json({ error: 'Reset password is only available for email/password accounts' });
    }

    const resetLink = await admin.auth().generatePasswordResetLink(user.email);
    return res.json({ success: true, email: user.email, resetLink });
  } catch (error) {
    console.error('Generate reset link error:', error);
    return res.status(500).json({ error: 'Failed to generate reset link' });
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
async function startServer() {
  try {
    await ensureSchema();
  } catch (error) {
    console.error('Schema setup error:', error);
  }

  initializeFirebase();
  app.listen(PORT, () => {
    console.log(`Admin Portal running on http://localhost:${PORT}`);
    console.log(`Dashboard: http://localhost:${PORT}`);
  });
}

startServer();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down gracefully...');
  await pool.end();
  process.exit(0);
});

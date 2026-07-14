const { Pool } = require('pg');
require('dotenv').config();

let connectionString = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/skillxchange';

// 1. Clean up DATABASE_URL if it has double assignment: DATABASE_URL=DATABASE_URL=...
if (connectionString.startsWith('DATABASE_URL=')) {
  connectionString = connectionString.substring('DATABASE_URL='.length);
}

// 2. Validate connection string and check for suspicious hostnames like "base"
const isLocalhost = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
const hasSuspiciousHost = connectionString.includes('@base') || connectionString.includes('//base') || connectionString.includes('host=base');

if (!connectionString || hasSuspiciousHost) {
  console.error('\n❌ DATABASE_URL Error: Invalid or missing connection configuration!');
  if (hasSuspiciousHost) {
    console.error('👉 The hostname is parsed as "base". This happens when a malformed connection string starting with "DATABASE_URL=" is parsed by pg-connection-string.');
  }
  console.error('👉 Please make sure your .env file contains: DATABASE_URL=postgresql://neondb_owner:npg_G2buthBkxF5n@ep-bitter-butterfly-atddgz4q-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=verify-full&channel_binding=require\n');
  process.exit(1);
}

// 3. Resolve the pg SSL deprecation warning by replacing 'sslmode=require' with 'sslmode=verify-full'
if (connectionString.includes('sslmode=require')) {
  connectionString = connectionString.replace('sslmode=require', 'sslmode=verify-full');
}

console.log('🔌 Connecting to PostgreSQL database...');

const poolConfig = {
  connectionString
};

// 4. Configure SSL for cloud databases (Neon, Render, etc.)
if (!isLocalhost) {
  poolConfig.ssl = {
    rejectUnauthorized: false
  };
}

const pool = new Pool(poolConfig);

let hasContentColumn = false;

// Query translation helper: Converts SQLite-style '?' placeholders to PostgreSQL '$1, $2, ...'
function translateQuery(sql) {
  if (!sql || typeof sql !== 'string') return sql;
  
  // Ignore SQLite PRAGMA commands gracefully
  if (sql.trim().toUpperCase().startsWith('PRAGMA')) {
    return 'SELECT 1';
  }

  let index = 1;
  return sql.replace(/\?/g, () => `$${index++}`);
}

// =====================================================
//  PROMISE WRAPPERS (SQLite Compatibility Layer)
// =====================================================
async function run(sql, params = []) {
  if (sql.trim().toUpperCase().startsWith('PRAGMA')) {
    return { id: null, changes: 0 };
  }

  let finalSql = translateQuery(sql);
  const isInsert = finalSql.trim().toUpperCase().startsWith('INSERT');
  
  // Append RETURNING id to INSERT statements to mimic lastID
  if (isInsert && !finalSql.toUpperCase().includes('RETURNING')) {
    finalSql += ' RETURNING id';
  }

  const res = await pool.query(finalSql, params);
  const lastID = (isInsert && res.rows && res.rows[0]) ? res.rows[0].id : null;
  return { id: lastID, changes: res.rowCount };
}

async function get(sql, params = []) {
  if (sql.trim().toUpperCase().startsWith('PRAGMA')) return null;
  const finalSql = translateQuery(sql);
  const res = await pool.query(finalSql, params);
  return res.rows[0];
}

async function all(sql, params = []) {
  if (sql.trim().toUpperCase().startsWith('PRAGMA')) return [];
  const finalSql = translateQuery(sql);
  const res = await pool.query(finalSql, params);
  return res.rows || [];
}

// =====================================================
//  DATABASE INIT & MIGRATIONS
// =====================================================
async function initDatabase() {
  // ---- USERS TABLE ----
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id               SERIAL PRIMARY KEY,
      username         VARCHAR(255) UNIQUE NOT NULL,
      email            VARCHAR(255) UNIQUE NOT NULL,
      password_hash    TEXT    NOT NULL,
      full_name        VARCHAR(255) NOT NULL DEFAULT '',
      bio              TEXT,
      avatar_url       TEXT,
      credits          INTEGER DEFAULT 5,
      average_rating   REAL    DEFAULT 0.0,
      is_verified      INTEGER DEFAULT 1,
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Run migrations for existing databases
  const userCols = await all("SELECT column_name FROM information_schema.columns WHERE table_name = 'users'");
  const userColNames = userCols.map(c => c.column_name);
  if (!userColNames.includes('credits')) {
    await run('ALTER TABLE users ADD COLUMN credits INTEGER DEFAULT 5');
    console.log('Migration: added credits column');
  }
  if (!userColNames.includes('average_rating')) {
    await run('ALTER TABLE users ADD COLUMN average_rating REAL DEFAULT 0.0');
    console.log('Migration: added average_rating column');
  }
  if (!userColNames.includes('is_verified')) {
     await run('ALTER TABLE users ADD COLUMN is_verified INTEGER DEFAULT 1');
     console.log('Migration: added is_verified column');
   }
  if (!userColNames.includes('avatar_url')) {
    await run('ALTER TABLE users ADD COLUMN avatar_url TEXT');
    console.log('Migration: added avatar_url column');
  }

  // ---- USER_SKILLS TABLE ----
  await run(`
    CREATE TABLE IF NOT EXISTS user_skills (
      id               SERIAL PRIMARY KEY,
      user_id          INTEGER NOT NULL,
      skill_name       VARCHAR(255) NOT NULL,
      skill_type       VARCHAR(50) NOT NULL CHECK(skill_type IN ('teach', 'learn')),
      proficiency_level VARCHAR(50) DEFAULT 'beginner' CHECK(proficiency_level IN ('beginner', 'intermediate', 'expert')),
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, skill_name, skill_type)
    )
  `);

  // ---- MESSAGES TABLE ----
  await run(`
    CREATE TABLE IF NOT EXISTS messages (
      id               SERIAL PRIMARY KEY,
      sender_id        INTEGER NOT NULL,
      receiver_id      INTEGER NOT NULL,
      message          TEXT,
      message_text     TEXT,
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      timestamp        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(sender_id)   REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(receiver_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // ---- CHAT HISTORY TABLE ----
  await run(`
    CREATE TABLE IF NOT EXISTS chat_history (
      id               SERIAL PRIMARY KEY,
      sender_id        INTEGER NOT NULL,
      receiver_id      INTEGER NOT NULL,
      message_payload  TEXT NOT NULL,
      timestamp        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(sender_id)   REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(receiver_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Migrate old messages table if needed
  try {
    const msgCols = await all("SELECT column_name FROM information_schema.columns WHERE table_name = 'messages'");
    const msgColNames = msgCols.map(c => c.column_name);
    hasContentColumn = msgColNames.includes('content');
    if (!msgColNames.includes('message') && msgColNames.includes('content')) {
      await run('ALTER TABLE messages ADD COLUMN message TEXT DEFAULT \'\'');
      await run('UPDATE messages SET message = content');
      console.log('Migration: messages.content -> messages.message');
    }
    if (!msgColNames.includes('message_text')) {
      await run('ALTER TABLE messages ADD COLUMN message_text TEXT');
      await run('UPDATE messages SET message_text = COALESCE(message, \'\')');
      console.log('Migration: added message_text column');
    }
    if (!msgColNames.includes('timestamp')) {
      await run('ALTER TABLE messages ADD COLUMN timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
      await run('UPDATE messages SET timestamp = created_at');
      console.log('Migration: added timestamp column');
    }
  } catch (e) {
    console.error('Messages migration error:', e.message);
  }

  // ---- SKILL SESSIONS TABLE ----
  await run(`
    CREATE TABLE IF NOT EXISTS skill_sessions (
      id               SERIAL PRIMARY KEY,
      teacher_id       INTEGER NOT NULL,
      learner_id       INTEGER NOT NULL,
      skill_name       VARCHAR(255) NOT NULL,
      scheduled_at     TIMESTAMP,
      status           VARCHAR(50) DEFAULT 'scheduled' CHECK(status IN ('scheduled', 'active', 'completed', 'cancelled')),
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(teacher_id)  REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(learner_id)  REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // ---- CALL HISTORY TABLE ----
  await run(`
    CREATE TABLE IF NOT EXISTS call_history (
      id               SERIAL PRIMARY KEY,
      caller_id        INTEGER NOT NULL,
      receiver_ids     TEXT NOT NULL,
      call_duration    INTEGER,
      status           VARCHAR(50) NOT NULL CHECK(status IN ('missed', 'answered', 'ended')),
      timestamp        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(caller_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // ---- CALL LOGS TABLE (NEW) ----
  await run(`
    CREATE TABLE IF NOT EXISTS call_logs (
      id               SERIAL PRIMARY KEY,
      caller_id        INTEGER NOT NULL,
      receiver_id      INTEGER NOT NULL,
      call_type        VARCHAR(50) NOT NULL CHECK(call_type IN ('direct', 'group')),
      status           VARCHAR(50) NOT NULL CHECK(status IN ('missed', 'completed', 'rejected')),
      timestamp        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(caller_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // ---- REVIEWS TABLE ----
  await run(`
    CREATE TABLE IF NOT EXISTS reviews (
      id               SERIAL PRIMARY KEY,
      session_id       INTEGER,
      reviewer_id      INTEGER NOT NULL,
      reviewed_user_id INTEGER NOT NULL,
      rating           INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      comment          TEXT,
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(reviewer_id)      REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(reviewed_user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Migrate old reviews table if needed
  try {
    const revCols = await all("SELECT column_name FROM information_schema.columns WHERE table_name = 'reviews'");
    const revColNames = revCols.map(c => c.column_name);
    if (!revColNames.includes('reviewed_user_id')) {
      await run('ALTER TABLE reviews ADD COLUMN reviewed_user_id INTEGER DEFAULT 0');
      await run('UPDATE reviews SET reviewed_user_id = COALESCE(reviewee_id, 0)').catch(() => {});
      console.log('Migration: added reviewed_user_id to reviews');
    }
    if (!revColNames.includes('session_id')) {
      await run('ALTER TABLE reviews ADD COLUMN session_id INTEGER');
      console.log('Migration: added session_id');
    }
  } catch {}

  // ---- VERIFICATION TOKENS TABLE ----
  await run(`
    CREATE TABLE IF NOT EXISTS verification_tokens (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER NOT NULL,
      token         TEXT    NOT NULL,
      expires_at    TIMESTAMP NOT NULL,
      used          INTEGER DEFAULT 0,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id)
    )
  `);

  // ---- SKILL EMBEDDINGS CACHE TABLE ----
  await run(`
    CREATE TABLE IF NOT EXISTS skill_embeddings (
      skill_name    VARCHAR(255) PRIMARY KEY,
      embedding     TEXT NOT NULL,
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // ---- INDEXES FOR OPTIMIZED QUERY PERFORMANCE ----
  await run(`CREATE INDEX IF NOT EXISTS idx_user_skills_user_id ON user_skills(user_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_messages_sender_receiver ON messages(sender_id, receiver_id)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_reviews_reviewed_user ON reviews(reviewed_user_id)`);

  console.log('✅ Database tables initialized successfully.');
}

// Helper to store verification token
async function saveVerificationToken(userId, token, expiresAt) {
  try {
    await run(`INSERT INTO verification_tokens (user_id, token, expires_at) VALUES (?, ?, ?)`, [userId, token, expiresAt]);
  } catch (e) {
    console.error('Failed to save verification token:', e.message);
  }
}

// Helper to verify token and activate user
async function verifyToken(token) {
  try {
    const row = await get(`SELECT id, user_id, expires_at, used FROM verification_tokens WHERE token = ?`, [token]);
    if (!row) return { valid: false, message: 'Invalid token' };
    if (row.used) return { valid: false, message: 'Token already used' };
    if (new Date(row.expires_at) < new Date()) return { valid: false, message: 'Token expired' };
    await run('UPDATE users SET is_verified = 1 WHERE id = ?', [row.user_id]);
    await run('UPDATE verification_tokens SET used = 1 WHERE id = ?', [row.id]);
    return { valid: true, userId: row.user_id };
  } catch (e) {
    console.error('Token verification error:', e.message);
    return { valid: false, message: 'Error verifying token' };
  }
}

// Helper to store chat messages in chat_history
async function saveChatMessage(senderId, receiverId, payload) {
  try {
    await run(`INSERT INTO chat_history (sender_id, receiver_id, message_payload) VALUES (?, ?, ?)`, [senderId, receiverId, payload]);
  } catch (e) {
    console.error('Failed to save chat history:', e.message);
  }
}

// Helper to store call records in call_history
async function saveCallRecord(callerId, receiverIdsArray, durationSec, status) {
  const receiverIds = JSON.stringify(receiverIdsArray);
  try {
    await run(`INSERT INTO call_history (caller_id, receiver_ids, call_duration, status) VALUES (?, ?, ?, ?)`, [callerId, receiverIds, durationSec, status]);
  } catch (e) {
    console.error('Failed to save call history:', e.message);
  }
}

// Helper to store call records in call_logs
async function saveCallLog(callerId, receiverId, callType, status) {
  try {
    await run(
      `INSERT INTO call_logs (caller_id, receiver_id, call_type, status) VALUES (?, ?, ?, ?)`,
      [callerId, receiverId, callType, status]
    );
  } catch (e) {
    console.error('Failed to save call log:', e.message);
  }
}

// Helper to save direct messages supporting both schemas with and without content column
async function saveDirectMessage(senderId, receiverId, messageText) {
  try {
    if (hasContentColumn) {
      return await run(
        'INSERT INTO messages (sender_id, receiver_id, content, message, message_text, timestamp) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
        [senderId, receiverId, messageText, messageText, messageText]
      );
    } else {
      return await run(
        'INSERT INTO messages (sender_id, receiver_id, message, message_text, timestamp) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
        [senderId, receiverId, messageText, messageText]
      );
    }
  } catch (e) {
    console.error('Failed to save direct message:', e.message);
    throw e;
  }
}

module.exports = {
  pool,
  initDatabase,
  run,
  get,
  all,
  saveVerificationToken,
  verifyToken,
  saveChatMessage,
  saveCallRecord,
  saveCallLog,
  saveDirectMessage
};

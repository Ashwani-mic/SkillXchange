const sqlite3 = require('sqlite3').verbose();
const path = require('path');

let hasContentColumn = false;

const dbPath = path.resolve(__dirname, 'db.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('✅ Connected to SkillXchange SQLite database.');
  }
});

// =====================================================
//  PROMISE WRAPPERS
// =====================================================
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ id: this.lastID, changes: this.changes });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

// =====================================================
//  DATABASE INIT & MIGRATIONS
// =====================================================
async function initDatabase() {
  await run('PRAGMA foreign_keys = ON');
  await run('PRAGMA journal_mode = WAL');

  // ---- USERS TABLE ----
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      username         TEXT    UNIQUE NOT NULL,
      email            TEXT    UNIQUE NOT NULL,
      password_hash    TEXT    NOT NULL,
      full_name        TEXT    NOT NULL DEFAULT '',
      bio              TEXT,
      avatar_url       TEXT,
      credits          INTEGER DEFAULT 5,
      average_rating   REAL    DEFAULT 0.0,
      is_verified      INTEGER DEFAULT 1,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Run migrations for existing databases
  const userCols = await all('PRAGMA table_info(users)');
  const userColNames = userCols.map(c => c.name);
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
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id          INTEGER NOT NULL,
        skill_name       TEXT    NOT NULL,
        skill_type       TEXT    NOT NULL CHECK(skill_type IN ('teach', 'learn')),
        proficiency_level TEXT   DEFAULT 'beginner' CHECK(proficiency_level IN ('beginner', 'intermediate', 'expert')),
        created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(user_id, skill_name, skill_type)
      )
    `);

    // ---- MESSAGES TABLE ----
    await run(`
      CREATE TABLE IF NOT EXISTS messages (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id        INTEGER NOT NULL,
        receiver_id      INTEGER NOT NULL,
        message          TEXT,
        message_text     TEXT,
        created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
        timestamp        DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(sender_id)   REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(receiver_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    // ---- CHAT HISTORY TABLE ----
    await run(`
      CREATE TABLE IF NOT EXISTS chat_history (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        sender_id        INTEGER NOT NULL,
        receiver_id      INTEGER NOT NULL,
        message_payload  TEXT NOT NULL,
        timestamp        DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(sender_id)   REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(receiver_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

  // Migrate old messages table if needed
  try {
    const msgCols = await all('PRAGMA table_info(messages)');
    const msgColNames = msgCols.map(c => c.name);
    hasContentColumn = msgColNames.includes('content');
    if (!msgColNames.includes('message') && msgColNames.includes('content')) {
      await run('ALTER TABLE messages ADD COLUMN message TEXT DEFAULT ""');
      await run('UPDATE messages SET message = content');
      console.log('Migration: messages.content -> messages.message');
    }
    if (!msgColNames.includes('message_text')) {
      await run('ALTER TABLE messages ADD COLUMN message_text TEXT');
      await run('UPDATE messages SET message_text = COALESCE(message, "")');
      console.log('Migration: added message_text column');
    }
    if (!msgColNames.includes('timestamp')) {
      await run('ALTER TABLE messages ADD COLUMN timestamp DATETIME DEFAULT CURRENT_TIMESTAMP');
      await run('UPDATE messages SET timestamp = created_at');
      console.log('Migration: added timestamp column');
    }
  } catch (e) {
    console.error('Messages migration error:', e.message);
  }

    // ---- SKILL SESSIONS TABLE ----
    await run(`
      CREATE TABLE IF NOT EXISTS skill_sessions (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id       INTEGER NOT NULL,
        learner_id       INTEGER NOT NULL,
        skill_name       TEXT    NOT NULL,
        scheduled_at     DATETIME,
        status           TEXT    DEFAULT 'scheduled' CHECK(status IN ('scheduled', 'active', 'completed', 'cancelled')),
        created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(teacher_id)  REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY(learner_id)  REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    // ---- CALL HISTORY TABLE ----
    await run(`
      CREATE TABLE IF NOT EXISTS call_history (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        caller_id        INTEGER NOT NULL,
        receiver_ids     TEXT NOT NULL,
        call_duration    INTEGER,
        status           TEXT NOT NULL CHECK(status IN ('missed', 'answered', 'ended')),
        timestamp        DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(caller_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    // ---- CALL LOGS TABLE (NEW) ----
    await run(`
      CREATE TABLE IF NOT EXISTS call_logs (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        caller_id        INTEGER NOT NULL,
        receiver_id      INTEGER NOT NULL,
        call_type        TEXT NOT NULL CHECK(call_type IN ('direct', 'group')),
        status           TEXT NOT NULL CHECK(status IN ('missed', 'completed', 'rejected')),
        timestamp        DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(caller_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

  // ---- REVIEWS TABLE ----
  await run(`
    CREATE TABLE IF NOT EXISTS reviews (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id       INTEGER,
      reviewer_id      INTEGER NOT NULL,
      reviewed_user_id INTEGER NOT NULL,
      rating           INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
      comment          TEXT,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(reviewer_id)      REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(reviewed_user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Migrate old reviews table if needed
  try {
    const revCols = await all('PRAGMA table_info(reviews)');
    const revColNames = revCols.map(c => c.name);
    if (!revColNames.includes('reviewed_user_id')) {
      await run('ALTER TABLE reviews ADD COLUMN reviewed_user_id INTEGER DEFAULT 0');
      // Try to backfill from reviewee_id
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
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER NOT NULL,
        token         TEXT    NOT NULL,
        expires_at    DATETIME NOT NULL,
        used          INTEGER DEFAULT 0,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(user_id)
      )
    `);

    // ---- SKILL EMBEDDINGS CACHE TABLE ----
    await run(`
      CREATE TABLE IF NOT EXISTS skill_embeddings (
        skill_name    TEXT PRIMARY KEY,
        embedding     TEXT NOT NULL,
        created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

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
    // Mark user as verified
    // Ensure user is verified (already default true)
await run('UPDATE users SET is_verified = 1 WHERE id = ?', [row.user_id]);
    // Mark token used
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

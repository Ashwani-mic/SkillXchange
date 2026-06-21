const sqlite3 = require('sqlite3').verbose();
const path = require('path');

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
      message          TEXT    NOT NULL,
      created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(sender_id)   REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(receiver_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  // Migrate old messages table if needed (content -> message column)
  try {
    const msgCols = await all('PRAGMA table_info(messages)');
    const msgColNames = msgCols.map(c => c.name);
    if (!msgColNames.includes('message') && msgColNames.includes('content')) {
      await run('ALTER TABLE messages ADD COLUMN message TEXT DEFAULT ""');
      await run('UPDATE messages SET message = content');
      console.log('Migration: messages.content -> messages.message');
    }
  } catch {}

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
      console.log('Migration: added session_id to reviews');
    }
  } catch {}

  console.log('✅ Database tables initialized successfully.');
}

module.exports = { db, run, get, all, initDatabase };

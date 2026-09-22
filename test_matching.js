const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('./src/db');
const { getMatchesForUser } = require('./src/services/matching');
const bcrypt = require('bcryptjs');

test('Skill matching engine computes bidirectional and unidirectional matches correctly', async () => {
  // Initialize DB tables
  await db.initDatabase();

  // Clean DB first to avoid constraint issues during testing
  await db.run('DELETE FROM user_skills');
  await db.run('DELETE FROM users');

  const pwHash = await bcrypt.hash('password123', 10);

  // 1. Create Test Users
  const alice = await db.run(
    'INSERT INTO users (username, email, password_hash, full_name, bio) VALUES (?, ?, ?, ?, ?)',
    ['alice', 'alice@test.com', pwHash, 'Alice Developer', 'Loves coding JS']
  );
  const bob = await db.run(
    'INSERT INTO users (username, email, password_hash, full_name, bio) VALUES (?, ?, ?, ?, ?)',
    ['bob', 'bob@test.com', pwHash, 'Bob Pianist', 'Professional musician']
  );
  const charlie = await db.run(
    'INSERT INTO users (username, email, password_hash, full_name, bio) VALUES (?, ?, ?, ?, ?)',
    ['charlie', 'charlie@test.com', pwHash, 'Charlie Language Lover', 'Polyglot enthusiast']
  );

  console.log(`Created test users: Alice (${alice.id}), Bob (${bob.id}), Charlie (${charlie.id})`);

  // 2. Insert Skills
  // Alice teaches JavaScript, wants to learn Piano
  await db.run('INSERT INTO user_skills (user_id, skill_name, skill_type, proficiency_level) VALUES (?, ?, ?, ?)', [alice.id, 'JavaScript', 'teach', 'expert']);
  await db.run('INSERT INTO user_skills (user_id, skill_name, skill_type, proficiency_level) VALUES (?, ?, ?, ?)', [alice.id, 'Piano', 'learn', 'beginner']);

  // Bob teaches Piano, wants to learn JavaScript (Perfect Match for Alice!)
  await db.run('INSERT INTO user_skills (user_id, skill_name, skill_type, proficiency_level) VALUES (?, ?, ?, ?)', [bob.id, 'Piano', 'teach', 'expert']);
  await db.run('INSERT INTO user_skills (user_id, skill_name, skill_type, proficiency_level) VALUES (?, ?, ?, ?)', [bob.id, 'JavaScript', 'learn', 'beginner']);

  // Charlie teaches Piano, wants to learn Spanish (One-way match)
  await db.run('INSERT INTO user_skills (user_id, skill_name, skill_type, proficiency_level) VALUES (?, ?, ?, ?)', [charlie.id, 'Piano', 'teach', 'expert']);
  await db.run('INSERT INTO user_skills (user_id, skill_name, skill_type, proficiency_level) VALUES (?, ?, ?, ?)', [charlie.id, 'Spanish', 'learn', 'beginner']);

  // 3. Run Matchmaking Engine for Alice
  const matches = await getMatchesForUser(alice.id);
  console.log('Matches computed for Alice:', matches.map(m => ({ id: m.id, username: m.username, score: m.match_score, type: m.match_type })));

  // 4. Assert correctness
  assert.equal(matches.length, 2, `Expected 2 matches, got ${matches.length}`);

  const firstMatch = matches[0];
  assert.equal(firstMatch.id, bob.id, 'Bob should be the first match');
  assert.equal(firstMatch.match_score, 100, 'Bob should have 100% match score');
  assert.equal(firstMatch.match_type, 'perfect', 'Bob should be a perfect match');

  const secondMatch = matches[1];
  assert.equal(secondMatch.id, charlie.id, 'Charlie should be the second match');
  assert.equal(secondMatch.match_score, 25, 'Charlie should have 25% match score');
  assert.equal(secondMatch.match_type, 'partial', 'Charlie should be a partial match');

  setTimeout(() => process.exit(0), 100);
});

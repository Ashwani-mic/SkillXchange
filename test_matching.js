const db = require('./db');
const { getMatchesForUser } = require('./matching');
const bcrypt = require('bcryptjs');

async function test() {
  console.log('--- Starting Match Engine Verification Test ---');

  // Initialize DB tables
  await db.initDatabase();

  // Clean DB first to avoid constraint issues during testing
  await db.run('DELETE FROM skills');
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

  console.log('Created Alice (ID:', alice.id, '), Bob (ID:', bob.id, '), Charlie (ID:', charlie.id, ')');

  // 2. Insert Skills
  // Alice teaches JavaScript, wants to learn Piano
  await db.run('INSERT INTO skills (user_id, skill_name, type, proficiency) VALUES (?, ?, ?, ?)', [alice.id, 'JavaScript', 'teach', 'expert']);
  await db.run('INSERT INTO skills (user_id, skill_name, type, proficiency) VALUES (?, ?, ?, ?)', [alice.id, 'Piano', 'learn', 'beginner']);

  // Bob teaches Piano, wants to learn JavaScript (Perfect Match for Alice!)
  await db.run('INSERT INTO skills (user_id, skill_name, type, proficiency) VALUES (?, ?, ?, ?)', [bob.id, 'Piano', 'teach', 'expert']);
  await db.run('INSERT INTO skills (user_id, skill_name, type, proficiency) VALUES (?, ?, ?, ?)', [bob.id, 'JavaScript', 'learn', 'beginner']);

  // Charlie teaches Piano, wants to learn Spanish (One-way match: Charlie teaches what Alice wants, but Charlie wants Spanish which Alice doesn't teach)
  await db.run('INSERT INTO skills (user_id, skill_name, type, proficiency) VALUES (?, ?, ?, ?)', [charlie.id, 'Piano', 'teach', 'expert']);
  await db.run('INSERT INTO skills (user_id, skill_name, type, proficiency) VALUES (?, ?, ?, ?)', [charlie.id, 'Spanish', 'learn', 'beginner']);

  console.log('Inserted skills for Alice, Bob, and Charlie.');

  // 3. Run Matchmaking Engine for Alice
  const matches = await getMatchesForUser(alice.id);
  console.log('\nMatches computed for Alice:');
  console.log(JSON.stringify(matches, null, 2));

  // 4. Assert correctness
  if (matches.length !== 2) {
    throw new Error(`Expected 2 matches, got ${matches.length}`);
  }

  const firstMatch = matches[0];
  if (firstMatch.user.id !== bob.id || firstMatch.score !== 100 || firstMatch.matchType !== 'perfect') {
    throw new Error(`Bob should be the 100% Perfect Match. Got: ${JSON.stringify(firstMatch)}`);
  }

  const secondMatch = matches[1];
  if (secondMatch.user.id !== charlie.id || secondMatch.score !== 50 || secondMatch.matchType !== 'they_teach_you') {
    throw new Error(`Charlie should be a 50% match (they teach you). Got: ${JSON.stringify(secondMatch)}`);
  }

  console.log('\n--- SUCCESS: Match Engine Verification Test Passed! ---');
  db.db.close();
}

test().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});

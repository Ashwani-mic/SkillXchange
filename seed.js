const db = require('./db');
const bcrypt = require('bcryptjs');

async function seed() {
  console.log('🌱 Starting database seeding...');
  
  // 1. Initialize tables if they don't exist
  await db.initDatabase();

  // 2. Clean existing data
  console.log('🧹 Clearing existing database data...');
  await db.run('TRUNCATE users, user_skills, messages, chat_history, skill_sessions, call_history, call_logs, reviews, verification_tokens, skill_embeddings RESTART IDENTITY CASCADE');

  const hashedPassword = await bcrypt.hash('password123', 10);

  // 3. Create Demo Users
  console.log('👤 Creating demo users...');
  const users = [
    {
      username: 'alice',
      email: 'alice@test.com',
      password_hash: hashedPassword,
      full_name: 'Alice Developer',
      bio: 'Expert software engineer specializing in JavaScript, Node.js, and React. Passionate about mentoring and teaching.',
      avatar_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&q=80&w=150',
      credits: 5,
      average_rating: 4.8
    },
    {
      username: 'bob',
      email: 'bob@test.com',
      password_hash: hashedPassword,
      full_name: 'Bob Pianist',
      bio: 'Professional classical pianist and music instructor. I want to learn web development to build a personal portfolio.',
      avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=150',
      credits: 7,
      average_rating: 4.5
    },
    {
      username: 'charlie',
      email: 'charlie@test.com',
      password_hash: hashedPassword,
      full_name: 'Charlie Language Lover',
      bio: 'Polyglot language enthusiast teaching Spanish and German. Excited to learn UI/UX design to build educational games.',
      avatar_url: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?auto=format&fit=crop&q=80&w=150',
      credits: 6,
      average_rating: 4.7
    },
    {
      username: 'diana',
      email: 'diana@test.com',
      password_hash: hashedPassword,
      full_name: 'Diana Data Scientist',
      bio: 'Data scientist teaching Python Programming and Data Analytics. Looking to learn photography and photo editing.',
      avatar_url: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&q=80&w=150',
      credits: 4,
      average_rating: 4.9
    },
    {
      username: 'evan',
      email: 'evan@test.com',
      password_hash: hashedPassword,
      full_name: 'Evan UI Designer',
      bio: 'Creative director teaching Figma and UI/UX design. Interested in learning Spanish to communicate with overseas clients.',
      avatar_url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&q=80&w=150',
      credits: 5,
      average_rating: 4.6
    }
  ];

  const userIds = {};
  for (const u of users) {
    const res = await db.run(
      `INSERT INTO users (username, email, password_hash, full_name, bio, avatar_url, credits, average_rating) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [u.username, u.email, u.password_hash, u.full_name, u.bio, u.avatar_url, u.credits, u.average_rating]
    );
    userIds[u.username] = res.id;
    console.log(`  Added user: ${u.username} (ID: ${res.id})`);
  }

  // 4. Create User Skills (Reciprocal Matches & Partial Matches)
  console.log('🎓 Seeding skills exchange list...');
  const skills = [
    // Alice
    { user: 'alice', name: 'JavaScript', type: 'teach', level: 'expert' },
    { user: 'alice', name: 'React Development', type: 'teach', level: 'expert' },
    { user: 'alice', name: 'Piano', type: 'learn', level: 'beginner' },

    // Bob (Perfect match for Alice: teaches Piano, wants JavaScript)
    { user: 'bob', name: 'Piano', type: 'teach', level: 'expert' },
    { user: 'bob', name: 'JavaScript', type: 'learn', level: 'beginner' },
    { user: 'bob', name: 'Guitar', type: 'teach', level: 'intermediate' },

    // Charlie (Teaches Spanish, wants UI/UX / Figma)
    { user: 'charlie', name: 'Spanish', type: 'teach', level: 'expert' },
    { user: 'charlie', name: 'German', type: 'teach', level: 'intermediate' },
    { user: 'charlie', name: 'UI/UX Design', type: 'learn', level: 'beginner' },

    // Diana (Teaches Python, wants Photography)
    { user: 'diana', name: 'Python Programming', type: 'teach', level: 'expert' },
    { user: 'diana', name: 'Data Science & ML', type: 'teach', level: 'intermediate' },
    { user: 'diana', name: 'Photography', type: 'learn', level: 'beginner' },

    // Evan (Perfect match for Charlie: teaches UI/UX, wants Spanish)
    { user: 'evan', name: 'UI/UX Design', type: 'teach', level: 'expert' },
    { user: 'evan', name: 'Spanish', type: 'learn', level: 'beginner' }
  ];

  for (const s of skills) {
    const userId = userIds[s.user];
    await db.run(
      'INSERT INTO user_skills (user_id, skill_name, skill_type, proficiency_level) VALUES (?, ?, ?, ?)',
      [userId, s.name, s.type, s.level]
    );
  }
  console.log(`  Added ${skills.length} skills to user profiles.`);

  // 5. Create Reviews
  console.log('⭐️ Seeding demo reviews...');
  const reviews = [
    { reviewer: 'bob', reviewed: 'alice', rating: 5, comment: 'Alice is an amazing teacher! Simplified complex closures in Javascript in minutes.' },
    { reviewer: 'alice', reviewed: 'bob', rating: 5, comment: 'Bob gave a great piano lesson. Excellent hand position tips.' },
    { reviewer: 'charlie', reviewed: 'evan', rating: 4, comment: 'Evan helped me restructure my portfolio landing page. Very creative!' }
  ];

  for (const r of reviews) {
    await db.run(
      'INSERT INTO reviews (reviewer_id, reviewed_user_id, rating, comment) VALUES (?, ?, ?, ?)',
      [userIds[r.reviewer], userIds[r.reviewed], r.rating, r.comment]
    );
  }

  console.log('🎉 Seeding successfully completed!');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seeding failed:', err);
  process.exit(1);
});

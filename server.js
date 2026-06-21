require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');
const { getMatchesForUser } = require('./matching');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'skillxchange-secret-2026';

// =====================================================
//  MIDDLEWARE
// =====================================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
});

app.use(sessionMiddleware);

// Share session with Socket.io
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// Serve Static Frontend
app.use(express.static(path.join(__dirname, 'public')));

// =====================================================
//  DB INIT
// =====================================================
db.initDatabase().catch(err => {
  console.error('Failed to initialize database:', err);
});

// =====================================================
//  AUTH MIDDLEWARE
// =====================================================
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated. Please log in.' });
  next();
}

// =====================================================
//  AUTHENTICATION ROUTES
// =====================================================

// GET /api/auth/me — Get current session user
app.get('/api/auth/me', async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  try {
    const user = await db.get(
      'SELECT id, username, email, full_name AS fullname, bio, avatar_url, credits, average_rating FROM users WHERE id = ?',
      [req.session.userId]
    );
    if (!user) return res.json({ user: null });
    res.json({ user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/register — Sign up
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password, fullname, bio } = req.body;
  if (!username || !email || !password || !fullname) {
    return res.status(400).json({ error: 'Username, email, password, and full name are required.' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  try {
    const existing = await db.get('SELECT id FROM users WHERE username = ? OR email = ?', [username.trim(), email.trim()]);
    if (existing) return res.status(409).json({ error: 'Username or email already taken.' });

    const hash = await bcrypt.hash(password, 10);
    const result = await db.run(
      'INSERT INTO users (username, email, password_hash, full_name, bio, credits) VALUES (?, ?, ?, ?, ?, 5)',
      [username.trim(), email.trim(), hash, fullname.trim(), bio ? bio.trim() : '']
    );
    const user = await db.get(
      'SELECT id, username, email, full_name AS fullname, bio, avatar_url, credits, average_rating FROM users WHERE id = ?',
      [result.id]
    );
    req.session.userId = user.id;
    req.session.username = user.username;
    res.status(201).json({ user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/login — Sign in
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });

  try {
    const user = await db.get(
      'SELECT id, username, email, full_name AS fullname, bio, avatar_url, credits, average_rating, password_hash FROM users WHERE username = ?',
      [username.trim()]
    );
    if (!user) return res.status(401).json({ error: 'User not found. Please check your username.' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Incorrect password.' });

    req.session.userId = user.id;
    req.session.username = user.username;
    const { password_hash: _, ...safeUser } = user;
    res.json({ user: safeUser });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/auth/logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// =====================================================
//  USER ROUTES
// =====================================================

// GET /api/users/me
app.get('/api/users/me', requireAuth, async (req, res) => {
  try {
    const user = await db.get(
      'SELECT id, username, email, full_name AS fullname, bio, avatar_url, credits, average_rating FROM users WHERE id = ?',
      [req.session.userId]
    );
    res.json({ user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/users/me
app.put('/api/users/me', requireAuth, async (req, res) => {
  const { fullname, bio, avatar_url } = req.body;
  try {
    await db.run(
      'UPDATE users SET full_name = ?, bio = ?, avatar_url = ? WHERE id = ?',
      [fullname, bio, avatar_url || null, req.session.userId]
    );
    const user = await db.get(
      'SELECT id, username, email, full_name AS fullname, bio, avatar_url, credits, average_rating FROM users WHERE id = ?',
      [req.session.userId]
    );
    res.json({ user });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/users/explore — Search/list all users
app.get('/api/users/explore', requireAuth, async (req, res) => {
  const { search = '', filter_type = '' } = req.query;
  try {
    let query = `
      SELECT u.id, u.username, u.full_name AS fullname, u.bio, u.avatar_url, u.average_rating,
        (SELECT GROUP_CONCAT(us2.skill_name, ', ') FROM user_skills us2 WHERE us2.user_id = u.id AND us2.skill_type = 'teach') AS teach_skills,
        (SELECT GROUP_CONCAT(us3.skill_name, ', ') FROM user_skills us3 WHERE us3.user_id = u.id AND us3.skill_type = 'learn') AS learn_skills
      FROM users u
      WHERE u.id != ?
    `;
    const params = [req.session.userId];

    if (search) {
      query += ` AND (u.username LIKE ? OR u.full_name LIKE ? OR
        u.id IN (SELECT user_id FROM user_skills WHERE skill_name LIKE ?))`;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (filter_type === 'teach') {
      query += ` AND u.id IN (SELECT user_id FROM user_skills WHERE skill_type = 'teach')`;
    } else if (filter_type === 'learn') {
      query += ` AND u.id IN (SELECT user_id FROM user_skills WHERE skill_type = 'learn')`;
    }

    query += ' ORDER BY u.average_rating DESC LIMIT 50';
    const users = await db.all(query, params);
    res.json({ users });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/users/:id — Get peer profile with skills and reviews
app.get('/api/users/:id', requireAuth, async (req, res) => {
  try {
    const user = await db.get(
      'SELECT id, username, full_name AS fullname, bio, avatar_url, average_rating FROM users WHERE id = ?',
      [req.params.id]
    );
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const teach_skills = await db.all('SELECT skill_name FROM user_skills WHERE user_id = ? AND skill_type = ?', [user.id, 'teach']);
    const learn_skills = await db.all('SELECT skill_name FROM user_skills WHERE user_id = ? AND skill_type = ?', [user.id, 'learn']);
    const reviews = await db.all(
      `SELECT r.rating, r.comment, r.created_at, u.full_name AS reviewer_name
       FROM reviews r JOIN users u ON r.reviewer_id = u.id
       WHERE r.reviewed_user_id = ? ORDER BY r.created_at DESC LIMIT 5`,
      [user.id]
    );

    // Check if online via socket
    const isOnline = onlineUsers.has(parseInt(req.params.id));
    res.json({ user: { ...user, teach_skills, learn_skills, reviews, is_online: isOnline } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =====================================================
//  SKILLS ROUTES
// =====================================================

// GET /api/skills/me
app.get('/api/skills/me', requireAuth, async (req, res) => {
  try {
    const skills = await db.all(
      'SELECT id, skill_name, skill_type, proficiency_level FROM user_skills WHERE user_id = ? ORDER BY created_at DESC',
      [req.session.userId]
    );
    res.json({ skills });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/skills — Add skill
app.post('/api/skills', requireAuth, async (req, res) => {
  const { skill_name, skill_type, proficiency_level } = req.body;
  if (!skill_name || !skill_type) return res.status(400).json({ error: 'Skill name and type are required.' });
  if (!['teach', 'learn'].includes(skill_type)) return res.status(400).json({ error: 'Skill type must be teach or learn.' });

  try {
    const existing = await db.get(
      'SELECT id FROM user_skills WHERE user_id = ? AND skill_name = ? AND skill_type = ?',
      [req.session.userId, skill_name, skill_type]
    );
    if (existing) return res.status(409).json({ error: `You already have "${skill_name}" as a ${skill_type} skill.` });

    const result = await db.run(
      'INSERT INTO user_skills (user_id, skill_name, skill_type, proficiency_level) VALUES (?, ?, ?, ?)',
      [req.session.userId, skill_name, skill_type, proficiency_level || 'beginner']
    );
    res.status(201).json({ id: result.id, skill_name, skill_type, proficiency_level });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/skills/:id
app.delete('/api/skills/:id', requireAuth, async (req, res) => {
  try {
    const skill = await db.get('SELECT id FROM user_skills WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
    if (!skill) return res.status(404).json({ error: 'Skill not found or not yours.' });
    await db.run('DELETE FROM user_skills WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =====================================================
//  MATCH ROUTES
// =====================================================

// GET /api/matches
app.get('/api/matches', requireAuth, async (req, res) => {
  try {
    const matches = await getMatchesForUser(req.session.userId);
    res.json({ matches });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =====================================================
//  MESSAGE ROUTES
// =====================================================

// GET /api/messages/:partnerId
app.get('/api/messages/:partnerId', requireAuth, async (req, res) => {
  try {
    const messages = await db.all(
      `SELECT id, sender_id, receiver_id, message, created_at
       FROM messages
       WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
       ORDER BY created_at ASC LIMIT 100`,
      [req.session.userId, req.params.partnerId, req.params.partnerId, req.session.userId]
    );
    res.json({ messages });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/messages
app.post('/api/messages', requireAuth, async (req, res) => {
  const { receiver_id, message } = req.body;
  if (!receiver_id || !message?.trim()) return res.status(400).json({ error: 'Receiver and message are required.' });
  try {
    const result = await db.run(
      'INSERT INTO messages (sender_id, receiver_id, message) VALUES (?, ?, ?)',
      [req.session.userId, receiver_id, message.trim()]
    );
    res.status(201).json({ id: result.id, success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =====================================================
//  SESSION ROUTES
// =====================================================

// GET /api/sessions/me
app.get('/api/sessions/me', requireAuth, async (req, res) => {
  try {
    const sessions = await db.all(
      `SELECT s.*,
        t.full_name AS teacher_name,
        l.full_name AS learner_name,
        EXISTS(SELECT 1 FROM reviews r WHERE r.session_id = s.id AND r.reviewer_id = ?) AS reviewed
       FROM skill_sessions s
       JOIN users t ON t.id = s.teacher_id
       JOIN users l ON l.id = s.learner_id
       WHERE s.teacher_id = ? OR s.learner_id = ?
       ORDER BY s.created_at DESC`,
      [req.session.userId, req.session.userId, req.session.userId]
    );
    res.json({ sessions });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/sessions — Book a session
app.post('/api/sessions', requireAuth, async (req, res) => {
  const { teacher_id, skill_name, scheduled_at } = req.body;
  if (!teacher_id || !skill_name || !scheduled_at) return res.status(400).json({ error: 'Teacher, skill, and scheduled time are required.' });
  if (parseInt(teacher_id) === req.session.userId) return res.status(400).json({ error: 'You cannot book yourself.' });

  try {
    const result = await db.run(
      'INSERT INTO skill_sessions (teacher_id, learner_id, skill_name, scheduled_at, status) VALUES (?, ?, ?, ?, ?)',
      [teacher_id, req.session.userId, skill_name, scheduled_at, 'scheduled']
    );
    // Deduct a credit
    await db.run('UPDATE users SET credits = MAX(0, credits - 1) WHERE id = ?', [req.session.userId]);
    // Award teacher a credit for booking
    await db.run('UPDATE users SET credits = credits + 1 WHERE id = ?', [teacher_id]);
    res.status(201).json({ id: result.id, success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/sessions/:id/status — Update session status
app.put('/api/sessions/:id/status', requireAuth, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['scheduled', 'active', 'completed', 'cancelled'];
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  try {
    const session = await db.get(
      'SELECT * FROM skill_sessions WHERE id = ? AND (teacher_id = ? OR learner_id = ?)',
      [req.params.id, req.session.userId, req.session.userId]
    );
    if (!session) return res.status(404).json({ error: 'Session not found.' });
    await db.run('UPDATE skill_sessions SET status = ? WHERE id = ?', [status, req.params.id]);
    if (status === 'completed') {
      // Award credits for completion
      await db.run('UPDATE users SET credits = credits + 2 WHERE id = ?', [session.teacher_id]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =====================================================
//  REVIEW ROUTES
// =====================================================

// GET /api/reviews/me
app.get('/api/reviews/me', requireAuth, async (req, res) => {
  try {
    const reviews = await db.all(
      `SELECT r.rating, r.comment, r.created_at, u.full_name AS reviewer_name
       FROM reviews r JOIN users u ON r.reviewer_id = u.id
       WHERE r.reviewed_user_id = ? ORDER BY r.created_at DESC`,
      [req.session.userId]
    );
    res.json({ reviews });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/reviews
app.post('/api/reviews', requireAuth, async (req, res) => {
  const { session_id, rating, comment } = req.body;
  if (!session_id || !rating) return res.status(400).json({ error: 'Session and rating are required.' });
  if (rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be between 1 and 5.' });

  try {
    const session = await db.get(
      'SELECT * FROM skill_sessions WHERE id = ? AND (teacher_id = ? OR learner_id = ?)',
      [session_id, req.session.userId, req.session.userId]
    );
    if (!session) return res.status(404).json({ error: 'Session not found.' });

    const existingReview = await db.get('SELECT id FROM reviews WHERE session_id = ? AND reviewer_id = ?', [session_id, req.session.userId]);
    if (existingReview) return res.status(409).json({ error: 'You already reviewed this session.' });

    const reviewedUserId = session.teacher_id === req.session.userId ? session.learner_id : session.teacher_id;
    await db.run(
      'INSERT INTO reviews (session_id, reviewer_id, reviewed_user_id, rating, comment) VALUES (?, ?, ?, ?, ?)',
      [session_id, req.session.userId, reviewedUserId, rating, comment || '']
    );

    // Update average rating
    const ratingData = await db.get(
      'SELECT AVG(rating) AS avg_rating, COUNT(*) AS count FROM reviews WHERE reviewed_user_id = ?',
      [reviewedUserId]
    );
    await db.run('UPDATE users SET average_rating = ? WHERE id = ?', [ratingData.avg_rating || 0, reviewedUserId]);

    res.status(201).json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =====================================================
//  AI ASSISTANT ROUTE
// =====================================================
app.post('/api/ai/chat', requireAuth, async (req, res) => {
  const { message, context } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required.' });

  // Smart local AI responses based on keywords
  const msg = message.toLowerCase();
  let reply = '';

  if (msg.includes('lesson plan') || msg.includes('plan')) {
    reply = `📋 **1-Hour Lesson Plan**\n\n⏱️ 0-10 min: Introductions & goal-setting. What do you each want to learn today?\n⏱️ 10-30 min: Peer A teaches their skill with live demonstration.\n⏱️ 30-35 min: Q&A and hands-on practice.\n⏱️ 35-55 min: Peer B teaches their skill.\n⏱️ 55-60 min: Wrap-up, what we learned, and schedule next session.`;
  } else if (msg.includes('icebreaker')) {
    reply = `🎯 **3 Great Icebreakers**\n\n1. **"One Cool Thing"** — Each person shares one thing they built or learned recently.\n2. **"Skill Map"** — Draw or describe your skill journey: where you started vs. where you are now.\n3. **"Teach Me 3 Words"** — Spend 2 minutes teaching each other the 3 most important words in your skill's vocabulary.`;
  } else if (msg.includes('time') || msg.includes('split')) {
    reply = `⏱️ **Recommended Time Split**\n\nFor a 60-minute session:\n- 10 min: Introduction & goals\n- 20 min: Peer 1 teaches\n- 5 min: Break\n- 20 min: Peer 2 teaches\n- 5 min: Review & next steps\n\nFor 30-minute sessions, cut each block in half. Always end with scheduling the next meeting!`;
  } else if (msg.includes('goal') || msg.includes('track') || msg.includes('progress')) {
    reply = `📈 **Tracking Learning Progress**\n\n✅ Set 3 specific goals per session (not vague ones — be precise!)\n✅ Use the whiteboard to write down key takeaways\n✅ Rate your confidence (1-5) before and after each session\n✅ Keep a "skill journal" — 5 minutes of notes after every class\n✅ Build a small project or demo to validate learning`;
  } else if (msg.includes('beginner') || msg.includes('start')) {
    reply = `🚀 **Teaching Beginners: Best Practices**\n\n1. Start with WHY — why is this skill valuable?\n2. Use analogies to familiar things (e.g., "HTML is like the bones, CSS is the skin")\n3. Show before you explain — demo first, explain second\n4. Give them something to DO in the first 10 minutes\n5. Celebrate their first small win — it builds confidence`;
  } else if (msg.includes('video') || msg.includes('call') || msg.includes('class')) {
    reply = `🎓 **Tips for Great Online Sessions**\n\n📷 Good lighting matters more than camera quality\n🎧 Use headphones to avoid echo\n📺 Share your screen when demonstrating — it's 10x clearer\n📝 Use the whiteboard for diagrams and notes\n⏸️ Pause frequently and ask "Does this make sense?" every 5 minutes`;
  } else {
    const generic = [
      `💡 Great question! The most effective peer learning happens when both people are slightly uncomfortable — you're in the "growth zone." Push each other gently!`,
      `🧠 Research shows that teaching something is the best way to truly learn it. Even as the "teacher," you'll discover new insights by explaining concepts aloud.`,
      `🤝 The best skill exchanges start with trust. Spend the first few minutes getting to know each other before diving into content.`,
      `📚 Feynman Technique: Explain the concept as if teaching a 12-year-old. Where you struggle to simplify — that's where your knowledge gap is. Perfect for identifying what to study next!`,
      `⚡ Schedule your next session BEFORE you end the current one. Consistency is the #1 factor in successful skill learning.`,
    ];
    reply = generic[Math.floor(Math.random() * generic.length)];
  }

  // Simulate AI thinking delay
  setTimeout(() => res.json({ reply }), 800);
});

// =====================================================
//  SOCKET.IO — REAL-TIME EVENTS
// =====================================================
const onlineUsers = new Map(); // userId -> socketId

io.on('connection', socket => {
  let authenticatedUserId = null;

  socket.on('authenticate', userId => {
    authenticatedUserId = parseInt(userId);
    onlineUsers.set(authenticatedUserId, socket.id);
    socket.join(`user_${authenticatedUserId}`);
    io.emit('user_online', authenticatedUserId);
    console.log(`User ${authenticatedUserId} connected (socket: ${socket.id})`);
  });

  // Chat message
  socket.on('send_message', async ({ receiver_id, message, sender_name }) => {
    if (!authenticatedUserId) return;
    io.to(`user_${receiver_id}`).emit('receive_message', {
      sender_id: authenticatedUserId,
      sender_name: sender_name,
      message,
      timestamp: new Date().toISOString()
    });
  });

  // Code editor collaboration
  socket.on('code_update', ({ code, to, userId }) => {
    io.to(`user_${to}`).emit('code_update', { code, userId });
  });

  // Whiteboard collaboration
  socket.on('whiteboard_update', ({ text, to, userId }) => {
    io.to(`user_${to}`).emit('whiteboard_update', { text, userId });
  });

  // WebRTC Signaling
  socket.on('webrtc_offer', ({ offer, to }) => {
    io.to(`user_${to}`).emit('webrtc_offer', { offer, from: authenticatedUserId });
  });

  socket.on('webrtc_answer', ({ answer, to }) => {
    io.to(`user_${to}`).emit('webrtc_answer', { answer });
  });

  socket.on('webrtc_ice', ({ candidate, to }) => {
    io.to(`user_${to}`).emit('webrtc_ice', { candidate });
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (authenticatedUserId) {
      onlineUsers.delete(authenticatedUserId);
      io.emit('user_offline', authenticatedUserId);
      console.log(`User ${authenticatedUserId} disconnected`);
    }
  });
});

// =====================================================
//  CATCH-ALL: serve index.html for client routing
// =====================================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// =====================================================
//  START SERVER
// =====================================================
server.listen(PORT, () => {
  console.log(`\n🚀 SkillXchange running at: http://localhost:${PORT}`);
  console.log(`   Open this URL in your browser to access the app.\n`);
});

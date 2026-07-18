require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');
const { getMatchesForUser } = require('./matching');

const onlineUsers = new Map(); // userId -> socketId

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });


const SESSION_SECRET = process.env.SESSION_SECRET || 'skillxchange-secret-2026';
const PORT = process.env.PORT || 3001;

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
    const existing = await db.get('SELECT id FROM users WHERE LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?)', [username.trim(), email.trim()]);
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
    // Auto-login
    req.session.userId = user.id;
    req.session.username = user.username;
    res.status(201).json({ user, message: 'Account created and logged in.' });
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
      'SELECT id, username, email, full_name AS fullname, bio, avatar_url, credits, average_rating, is_verified, password_hash FROM users WHERE LOWER(username) = LOWER(?)',
      [username.trim()]
    );
    if (!user) return res.status(401).json({ error: 'User not found. Please check your username.' });

    // Verify email status
        
    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Incorrect password.' });

    req.session.userId = user.id;
    req.session.username = user.username;
    const { password_hash: _, is_verified: __, ...safeUser } = user;
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
// GET /health - Lightweight endpoint to prevent cold starts.
// NOTE: Pinging this endpoint every 10-14 minutes only mitigates cold starts on Render's free tier.
// The permanent fix is upgrading to a paid instance type that does not spin down.
app.get('/health', (req, res) => {
  res.status(200).send('200 ok');
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
        (SELECT string_agg(us2.skill_name, ', ') FROM user_skills us2 WHERE us2.user_id = u.id AND us2.skill_type = 'teach') AS teach_skills,
        (SELECT string_agg(us3.skill_name, ', ') FROM user_skills us3 WHERE us3.user_id = u.id AND us3.skill_type = 'learn') AS learn_skills
      FROM users u
      WHERE u.id != ?
    `;
    const params = [req.session.userId];

    if (search) {
      query += ` AND (u.username ILIKE ? OR u.full_name ILIKE ? OR
        u.id IN (SELECT user_id FROM user_skills WHERE skill_name ILIKE ?))`;
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
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: `You already have "${skill_name}" as a ${skill_type} skill.` });
    }
    res.status(500).json({ error: e.message });
  }
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
      `SELECT id, sender_id, receiver_id, message_text AS message, timestamp AS created_at
       FROM messages
       WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
       ORDER BY timestamp ASC LIMIT 100`,
      [req.session.userId, req.params.partnerId, req.params.partnerId, req.session.userId]
    );

    // Fetch call logs to display inline
    const calls = await db.all(
      `SELECT id, caller_id, receiver_id, call_type, status, timestamp
       FROM call_logs
       WHERE (caller_id = ? AND receiver_id = ?) OR (caller_id = ? AND receiver_id = ?)
       ORDER BY timestamp ASC LIMIT 50`,
      [req.session.userId, req.params.partnerId, req.params.partnerId, req.session.userId]
    );

    const callMessages = calls.map(c => ({
      id: 'call_' + c.id,
      sender_id: c.caller_id,
      receiver_id: c.receiver_id,
      message: `📞 ${c.call_type === 'group' ? 'Group Class' : 'Classroom Session'} (${c.status})`,
      created_at: c.timestamp,
      is_call_log: true,
      call_status: c.status
    }));

    const combined = [...messages, ...callMessages].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    res.json({ messages: combined });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/messages
app.post('/api/messages', requireAuth, async (req, res) => {
  const { receiver_id, message } = req.body;
  if (!receiver_id || !message?.trim()) return res.status(400).json({ error: 'Receiver and message are required.' });
  try {
    const result = await db.saveDirectMessage(req.session.userId, receiver_id, message.trim());
    res.status(201).json({ id: result?.id || null, success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/calls/history
app.get('/api/calls/history', requireAuth, async (req, res) => {
  try {
    const logs = await db.all(
      `SELECT cl.id, cl.caller_id, cl.receiver_id, cl.call_type, cl.status, cl.timestamp,
              u1.username AS caller_name, u2.username AS receiver_name
       FROM call_logs cl
       JOIN users u1 ON cl.caller_id = u1.id
       JOIN users u2 ON cl.receiver_id = u2.id
       WHERE cl.caller_id = ? OR cl.receiver_id = ?
       ORDER BY cl.timestamp DESC LIMIT 50`,
      [req.session.userId, req.session.userId]
    );
    res.json({ logs });
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
// =====================================================
//  AI ASSISTANT ROUTE (REAL LLM & EMBEDDING PIPELINE)
// =====================================================
const ai = require('./ai');

app.get('/api/ai/config', requireAuth, (req, res) => {
  const hasKey = !!(process.env.GEMINI_API_KEY || process.env.API_KEY);
  res.json({ online: hasKey });
});

app.post('/api/ai/chat', requireAuth, async (req, res) => {
  try {
    const { message, context } = req.body || {};
    if (!message) return res.status(400).json({ error: 'Message is required.' });

    // Call real LLM (Gemini 1.5 Flash)
    const reply = await ai.chatWithGemini(message, context);
    
    if (reply) {
      return res.json({ reply, source: 'gemini' });
    }

    // Fallback if API key is not present or failed
    const msg = message.toLowerCase();
    let fallbackReply = '';

    if (msg.includes('lesson plan') || msg.includes('plan')) {
      fallbackReply = `📋 **1-Hour Lesson Plan**\n\n⏱️ 0-10 min: Introductions & goal-setting. What do you each want to learn today?\n⏱️ 10-30 min: Peer A teaches their skill with live demonstration.\n⏱️ 30-35 min: Q&A and hands-on practice.\n⏱️ 35-55 min: Peer B teaches their skill.\n⏱️ 55-60 min: Wrap-up, what we learned, and schedule next session.`;
    } else if (msg.includes('icebreaker')) {
      fallbackReply = `🎯 **3 Great Icebreakers**\n\n1. **"One Cool Thing"** — Each person shares one thing they built or learned recently.\n2. **"Skill Map"** — Draw or describe your skill journey: where you started vs. where you are now.\n3. **"Teach Me 3 Words"** — Spend 2 minutes teaching each other the 3 most important words in your skill's vocabulary.`;
    } else if (msg.includes('time') || msg.includes('split')) {
      fallbackReply = `⏱️ **Recommended Time Split**\n\nFor a 60-minute session:\n- 10 min: Introduction & goals\n- 20 min: Peer 1 teaches\n- 5 min: Break\n- 20 min: Peer 2 teaches\n- 5 min: Review & next steps\n\nFor 30-minute sessions, cut each block in half. Always end with scheduling the next meeting!`;
    } else if (msg.includes('goal') || msg.includes('track') || msg.includes('progress')) {
      fallbackReply = `📈 **Tracking Learning Progress**\n\n✅ Set 3 specific goals per session (not vague ones — be precise!)\n✅ Use the whiteboard to write down key takeaways\n✅ Rate your confidence (1-5) before and after each session\n✅ Keep a "skill journal" — 5 minutes of notes after every class\n✅ Build a small project or demo to validate learning`;
    } else if (msg.includes('beginner') || msg.includes('start')) {
      fallbackReply = `🚀 **Teaching Beginners: Best Practices**\n\n1. Start with WHY — why is this skill valuable?\n2. Use analogies to familiar things (e.g., "HTML is like the bones, CSS is the skin")\n3. Show before you explain — demo first, explain second\n4. Give them something to DO in the first 10 minutes\n5. Celebrate their first small win — it builds confidence`;
    } else if (msg.includes('video') || msg.includes('call') || msg.includes('class')) {
      fallbackReply = `🎓 **Tips for Great Online Sessions**\n\n📷 Good lighting matters more than camera quality\n🎧 Use headphones to avoid echo\n📺 Share your screen when demonstrating — it's 10x clearer\n📝 Use the whiteboard for diagrams and notes\n⏸️ Pause frequently and ask "Does this make sense?" every 5 minutes`;
    } else {
      const generic = [
        `💡 Great question! The most effective peer learning happens when both people are slightly uncomfortable — you're in the "growth zone." Push each other gently!`,
        `🧠 Research shows that teaching something is the best way to truly learn it. Even as the "teacher," you'll discover new insights by explaining concepts aloud.`,
        `🤝 The best skill exchanges start with trust. Spend the first few minutes getting to know each other before diving into content.`,
        `📚 Feynman Technique: Explain the concept as if teaching a 12-year-old. Where you struggle to simplify — that's where your knowledge gap is. Perfect for identifying what to study next!`,
        `⚡ Schedule your next session BEFORE you end the current one. Consistency is the #1 factor in successful skill learning.`,
      ];
      fallbackReply = generic[Math.floor(Math.random() * generic.length)];
    }

    // Add a helper hint to configure Gemini key
    fallbackReply += `\n\n*⚙️ [AI running in local keyword fallback mode. Set GEMINI_API_KEY in your .env to unlock real Gemini 1.5 Flash answers!]*`;

    res.json({ reply: fallbackReply, source: 'fallback' });
  } catch (err) {
    console.error('AI chat error:', err?.message || err);
    res.status(500).json({ error: 'AI Assistant request failed.', reply: 'I am here to help you exchange skills. Try asking for a lesson plan or icebreakers!' });
  }
});

app.post('/api/ai/extract-tags', requireAuth, async (req, res) => {
  try {
    const { bio } = req.body;
    if (!bio) return res.status(400).json({ error: 'Bio text is required.' });

    const tags = await ai.extractSkills(bio);
    res.json(tags);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
//  GROUP ROUTES
// =====================================================

// POST /api/groups — Create a new group
app.post('/api/groups', requireAuth, async (req, res) => {
  const { name, memberIds = [] } = req.body;
  if (!name) return res.status(400).json({ error: 'Group name is required.' });

  try {
    // 1. Insert group
    const groupRes = await db.run(
      'INSERT INTO groups (name, created_by) VALUES (?, ?)',
      [name, req.session.userId]
    );
    const groupId = groupRes.id;

    // 2. Add creator as admin
    await db.run(
      'INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?)',
      [groupId, req.session.userId, 'admin']
    );

    // 3. Add other members
    for (const mId of memberIds) {
      const parsedId = parseInt(mId);
      if (parsedId && parsedId !== req.session.userId) {
        await db.run(
          'INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
          [groupId, parsedId, 'member']
        );
      }
    }

    res.status(201).json({ success: true, groupId, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/groups/:id/members — Add new members
app.post('/api/groups/:id/members', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.id);
  const { memberIds = [] } = req.body;

  try {
    const isMember = await db.get(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, req.session.userId]
    );
    if (!isMember) return res.status(403).json({ error: 'Not authorized to add members.' });

    for (const mId of memberIds) {
      const parsedId = parseInt(mId);
      if (parsedId) {
        await db.run(
          'INSERT INTO group_members (group_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT DO NOTHING',
          [groupId, parsedId, 'member']
        );
      }
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/groups — List current user's groups
app.get('/api/groups', requireAuth, async (req, res) => {
  try {
    const groups = await db.all(`
      SELECT g.id, g.name, g.created_by, g.created_at,
        (SELECT COUNT(*) FROM group_members gm WHERE gm.group_id = g.id) AS member_count
      FROM groups g
      JOIN group_members gm ON gm.group_id = g.id
      WHERE gm.user_id = ?
      ORDER BY g.created_at DESC
    `, [req.session.userId]);
    res.json({ groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/groups/:id/messages — Get message history
app.get('/api/groups/:id/messages', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.id);
  try {
    const isMember = await db.get(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, req.session.userId]
    );
    if (!isMember) return res.status(403).json({ error: 'Access denied.' });

    const messages = await db.all(`
      SELECT gm.id, gm.group_id, gm.sender_id, u.username AS sender_name, u.avatar_url AS sender_avatar, gm.message, gm.created_at AS timestamp
      FROM group_messages gm
      JOIN users u ON u.id = gm.sender_id
      WHERE gm.group_id = ?
      ORDER BY gm.created_at ASC
    `, [groupId]);
    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/groups/:id/messages — Post a group message
app.post('/api/groups/:id/messages', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.id);
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Message is required.' });

  try {
    const isMember = await db.get(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, req.session.userId]
    );
    if (!isMember) return res.status(403).json({ error: 'Access denied.' });

    const msgRes = await db.run(
      'INSERT INTO group_messages (group_id, sender_id, message) VALUES (?, ?, ?)',
      [groupId, req.session.userId, message.trim()]
    );

    const sender = await db.get('SELECT username, avatar_url FROM users WHERE id = ?', [req.session.userId]);

    // Realtime broadcast to group members
    const members = await db.all('SELECT user_id FROM group_members WHERE group_id = ?', [groupId]);
    members.forEach(member => {
      if (member.user_id !== req.session.userId) {
        const socketId = onlineUsers.get(member.user_id);
        if (socketId) {
          io.to(socketId).emit('receive_group_message', {
            id: msgRes.id,
            group_id: groupId,
            sender_id: req.session.userId,
            sender_name: sender.username,
            sender_avatar: sender.avatar_url,
            message: message.trim(),
            timestamp: new Date().toISOString()
          });
        }
      }
    });

    res.status(201).json({
      success: true,
      messageId: msgRes.id,
      senderName: sender.username,
      senderAvatar: sender.avatar_url
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/groups/:id/members — Get members roster
app.get('/api/groups/:id/members', requireAuth, async (req, res) => {
  const groupId = parseInt(req.params.id);
  try {
    const isMember = await db.get(
      'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
      [groupId, req.session.userId]
    );
    if (!isMember) return res.status(403).json({ error: 'Access denied.' });

    const members = await db.all(`
      SELECT u.id, u.username AS name, u.full_name AS fullname, u.avatar_url
      FROM group_members gm
      JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = ?
    `, [groupId]);
    res.json({ members });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =====================================================
//  SOCKET.IO — REAL-TIME EVENTS
// =====================================================
const groupRooms = new Map(); // roomId -> { hostId, hostName, invitedUsers: Array<{id, name}>, connectedUsers: Map(socketId -> {userId, userName}) }

function rebuildParticipantsList(room) {
  const participantsList = [];
  // Host
  participantsList.push({
    userId: room.hostId,
    userName: room.hostName,
    status: 'host'
  });
  // Invited but not connected
  room.invitedUsers.forEach(u => {
    if (u.id !== room.hostId) {
      const isConnected = Array.from(room.connectedUsers.values()).some(cu => cu.userId === u.id);
      if (!isConnected) {
        participantsList.push({
          userId: u.id,
          userName: u.name,
          status: 'invited'
        });
      }
    }
  });
  // Connected users (except host)
  room.connectedUsers.forEach((u) => {
    if (u.userId !== room.hostId) {
      participantsList.push({
        userId: u.userId,
        userName: u.userName,
        status: 'connected'
      });
    }
  });
  return participantsList;
}

// Proactive Heartbeat Scan: disconnect sockets inactive for >60s to prevent stale entries (especially on mobile)
setInterval(() => {
  const now = Date.now();
  io.sockets.sockets.forEach(socket => {
    if (socket.authenticatedUserId) {
      const lastSeen = socket.lastSeen || now;
      if (now - lastSeen > 60000) {
        console.log(`Proactively disconnecting inactive socket ${socket.id} for user ${socket.authenticatedUserId} (missed heartbeat)`);
        socket.disconnect(true);
      }
    }
  });
}, 10000);

io.on('connection', socket => {
  let authenticatedUserId = null;

  socket.on('authenticate', userId => {
    authenticatedUserId = parseInt(userId);
    
    // Clean up any stale sockets previously mapped to this user to avoid presence desync
    const oldSocketId = onlineUsers.get(authenticatedUserId);
    if (oldSocketId && oldSocketId !== socket.id) {
      const oldSocket = io.sockets.sockets.get(oldSocketId);
      if (oldSocket) {
        console.log(`Forcefully disconnecting stale socket ${oldSocketId} for user ${authenticatedUserId}`);
        oldSocket.disconnect(true);
      }
    }

    socket.authenticatedUserId = authenticatedUserId;
    socket.lastSeen = Date.now();

    onlineUsers.set(authenticatedUserId, socket.id);
    socket.join(`user_${authenticatedUserId}`);
    
    // Instantly send list of online users to the newly connected user
    socket.emit('online_users_list', Array.from(onlineUsers.keys()));
    
    // Broadcast presence change to other users
    socket.broadcast.emit('user_online', authenticatedUserId);
    console.log(`User ${authenticatedUserId} connected (socket: ${socket.id})`);
  });

  socket.on('heartbeat', () => {
    socket.lastSeen = Date.now();
  });

  // Chat message
  socket.on('send_message', async ({ receiver_id, message, sender_name }) => {
    if (!authenticatedUserId) return;
    const targetUserId = parseInt(receiver_id);
    
    // Commit message to PostgreSQL database immediately
    try {
      await db.saveDirectMessage(authenticatedUserId, targetUserId, message.trim());
    } catch (e) {
      console.error('Failed to commit message to PostgreSQL:', e.message);
    }

    const recipientSocketId = onlineUsers.get(targetUserId);
    const payload = {
      sender_id: authenticatedUserId,
      sender_name: sender_name,
      message,
      timestamp: new Date().toISOString()
    };
    
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('receive_message', payload);
    }
  });

  // Group Chat message
  socket.on('send_group_message', async ({ group_id, message }) => {
    if (!authenticatedUserId) return;
    const gId = parseInt(group_id);

    try {
      // 1. Commit message to database
      const msgRes = await db.run(
        'INSERT INTO group_messages (group_id, sender_id, message) VALUES (?, ?, ?)',
        [gId, authenticatedUserId, message.trim()]
      );

      const sender = await db.get('SELECT username, avatar_url FROM users WHERE id = ?', [authenticatedUserId]);

      // 2. Broadcast to all members of the group
      const members = await db.all('SELECT user_id FROM group_members WHERE group_id = ?', [gId]);
      members.forEach(m => {
        const memberId = m.user_id;
        const socketId = onlineUsers.get(memberId);
        if (socketId) {
          io.to(socketId).emit('receive_group_message', {
            id: msgRes.id,
            group_id: gId,
            sender_id: authenticatedUserId,
            sender_name: sender.username,
            sender_avatar: sender.avatar_url,
            message: message.trim(),
            timestamp: new Date().toISOString()
          });
        }
      });
    } catch (e) {
      console.error('Failed to process group socket message:', e.message);
    }
  });

  // Code editor collaboration
  socket.on('code_update', ({ code, to, userId }) => {
    io.to(`user_${to}`).emit('code_update', { code, userId });
  });

  // Whiteboard collaboration
  socket.on('whiteboard_update', ({ text, to, userId }) => {
    io.to(`user_${to}`).emit('whiteboard_update', { text, userId });
  });

  // WebRTC 1-on-1 Signaling
  socket.on('webrtc_offer', ({ offer, to }) => {
    io.to(`user_${to}`).emit('webrtc_offer', { offer, from: authenticatedUserId });
  });

  socket.on('webrtc_answer', ({ answer, to }) => {
    io.to(`user_${to}`).emit('webrtc_answer', { answer });
  });

  socket.on('webrtc_ice', ({ candidate, to }) => {
    io.to(`user_${to}`).emit('webrtc_ice', { candidate });
  });

  // WebRTC 1-on-1 Signaling Enhanced Flow
  socket.on('call_user', async ({ to, offer, senderName }) => {
    if (!authenticatedUserId) return;
    const targetUserId = parseInt(to);
    const recipientSocketId = onlineUsers.get(targetUserId);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('incoming_call', {
        callerId: authenticatedUserId,
        callerName: senderName,
        offer
      });
    }
  });

  socket.on('decline_call', async ({ to }) => {
    if (!authenticatedUserId) return;
    const targetUserId = parseInt(to);
    const recipientSocketId = onlineUsers.get(targetUserId);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('call_declined', { from: authenticatedUserId });
    }
    await db.saveCallLog(targetUserId, authenticatedUserId, 'direct', 'rejected');
  });

  socket.on('accept_call', async ({ to, answer }) => {
    if (!authenticatedUserId) return;
    const targetUserId = parseInt(to);
    const recipientSocketId = onlineUsers.get(targetUserId);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('call_accepted', { answer, from: authenticatedUserId });
    }
  });

  socket.on('hang_up', async ({ to, callerId, receiverId }) => {
    if (!authenticatedUserId) return;
    const targetUserId = parseInt(to);
    const recipientSocketId = onlineUsers.get(targetUserId);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('call_ended', { from: authenticatedUserId });
    }
    const finalCallerId = parseInt(callerId) || authenticatedUserId;
    const finalReceiverId = parseInt(receiverId) || targetUserId;
    await db.saveCallLog(finalCallerId, finalReceiverId, 'direct', 'completed');
  });

  socket.on('cancel_call', async ({ to }) => {
    if (!authenticatedUserId) return;
    const targetUserId = parseInt(to);
    const recipientSocketId = onlineUsers.get(targetUserId);
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('call_cancelled', { from: authenticatedUserId });
    }
    await db.saveCallLog(authenticatedUserId, targetUserId, 'direct', 'missed');
  });

  // WebRTC Group Calling signaling (Mesh Network)
  socket.on('group_call_invite', async ({ roomId, invitedUsers, senderName }) => {
    if (!authenticatedUserId) return;

    console.log(`\n📞 [Group Call Invite] Room: ${roomId} | Initiator: ${senderName} (User ID: ${authenticatedUserId})`);
    console.log(`👥 Invited list:`, invitedUsers);

    const room = {
      hostId: authenticatedUserId,
      hostName: senderName,
      invitedUsers: invitedUsers.map(u => ({ id: parseInt(u.id), name: u.name })),
      connectedUsers: new Map()
    };
    groupRooms.set(roomId, room);

    invitedUsers.forEach(async (u) => {
      const id = parseInt(u.id);
      if (id === authenticatedUserId) return;
      const recipientSocketId = onlineUsers.get(id);
      if (recipientSocketId) {
        console.log(`✉️ Delivering incoming_group_call alert to User ${id} on socket ${recipientSocketId}`);
        io.to(recipientSocketId).emit('incoming_group_call', {
          roomId,
          callerId: authenticatedUserId,
          callerName: senderName,
          invitedUserIds: invitedUsers.map(usr => usr.id)
        });
      } else {
        console.log(`⚠️ User ${id} is offline. Inviting into missed call logs.`);
      }
      await db.saveCallLog(authenticatedUserId, id, 'group', 'missed');
    });
  });

  socket.on('join_group_room', ({ roomId, userName }) => {
    if (!authenticatedUserId) return;
    socket.join(roomId);

    let room = groupRooms.get(roomId);
    if (!room) {
      room = {
        hostId: authenticatedUserId,
        hostName: userName,
        invitedUsers: [],
        connectedUsers: new Map()
      };
      groupRooms.set(roomId, room);
    }

    room.connectedUsers.set(socket.id, { userId: authenticatedUserId, userName });

    socket.to(roomId).emit('group_user_joined', {
      userId: authenticatedUserId,
      socketId: socket.id,
      userName
    });

    // Broadcast updated participants list to everyone in the room
    const participantsList = rebuildParticipantsList(room);
    io.to(roomId).emit('group_participants_update', participantsList);
    console.log(`User ${authenticatedUserId} joined group room ${roomId} (socket: ${socket.id})`);
  });

  socket.on('group_signal', ({ toSocketId, signalData }) => {
    io.to(toSocketId).emit('group_signal', {
      fromSocketId: socket.id,
      fromUserId: authenticatedUserId,
      signalData
    });
  });

  socket.on('decline_group_call', async ({ initiatorId }) => {
    if (!authenticatedUserId) return;
    await db.saveCallLog(parseInt(initiatorId), authenticatedUserId, 'group', 'rejected');
  });

  socket.on('leave_group_room', ({ roomId }) => {
    socket.leave(roomId);

    const room = groupRooms.get(roomId);
    if (room) {
      room.connectedUsers.delete(socket.id);
      const participantsList = rebuildParticipantsList(room);
      io.to(roomId).emit('group_participants_update', participantsList);
    }

    socket.to(roomId).emit('group_user_left', {
      socketId: socket.id,
      userId: authenticatedUserId
    });
    console.log(`User ${authenticatedUserId} left group room ${roomId}`);
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (authenticatedUserId) {
      if (onlineUsers.get(authenticatedUserId) === socket.id) {
        onlineUsers.delete(authenticatedUserId);
        io.emit('user_offline', authenticatedUserId);
        console.log(`User ${authenticatedUserId} disconnected`);
      }

      // Cleanup group rooms
      groupRooms.forEach((room, roomId) => {
        if (room.connectedUsers.has(socket.id)) {
          room.connectedUsers.delete(socket.id);
          const participantsList = rebuildParticipantsList(room);
          io.to(roomId).emit('group_participants_update', participantsList);
          socket.to(roomId).emit('group_user_left', {
            socketId: socket.id,
            userId: authenticatedUserId
          });
        }
      });
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

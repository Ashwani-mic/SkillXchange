// Application server bootstrap: configures Express, HTTP/Socket.IO servers, session middleware, routers, and static file serving.
const path = require('path');
const http = require('http');
const express = require('express');
const socketIo = require('socket.io');
const session = require('express-session');

const { PORT, SESSION_SECRET, isProduction } = require('./config');
const db = require('./db');
const initSockets = require('./sockets');

const authRoutes = require('./routes/auth.routes');
const usersRoutes = require('./routes/users.routes');
const skillsRoutes = require('./routes/skills.routes');
const matchesRoutes = require('./routes/matches.routes');
const messagesRoutes = require('./routes/messages.routes');
const sessionsRoutes = require('./routes/sessions.routes');
const reviewsRoutes = require('./routes/reviews.routes');
const aiRoutes = require('./routes/ai.routes');
const groupsRoutes = require('./routes/groups.routes');
const callsRoutes = require('./routes/calls.routes');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, { cors: { origin: '*' } });

// Expose io instance to Express routes
app.set('io', io);

// =====================================================
//  MIDDLEWARE
// =====================================================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Trust reverse proxies (Render, Cloudflare, Heroku) for HTTPS cookies
app.set('trust proxy', 1);

const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    secure: 'auto',
    sameSite: 'lax',
    httpOnly: true
  }
});

app.use(sessionMiddleware);

// Share session with Socket.io
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// Serve Static Frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// =====================================================
//  DB INIT
// =====================================================
db.initDatabase().catch(err => {
  console.error('Failed to initialize database:', err);
});

// =====================================================
//  HEALTH CHECK
// =====================================================
app.get('/health', (req, res) => {
  res.status(200).send('200 ok');
});

// =====================================================
//  API ROUTERS
// =====================================================
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/skills', skillsRoutes);
app.use('/api/matches', matchesRoutes);
app.use('/api/messages', messagesRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/reviews', reviewsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/groups', groupsRoutes);
app.use('/api/calls', callsRoutes);

// =====================================================
//  SOCKET.IO HANDLERS
// =====================================================
initSockets(io);

// =====================================================
//  CATCH-ALL: serve index.html for client routing
// =====================================================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// =====================================================
//  START SERVER
// =====================================================
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 SkillXchange running at: http://localhost:${PORT}`);
  console.log(`   Open this URL in your browser to access the app.\n`);
});

module.exports = { app, server, io };

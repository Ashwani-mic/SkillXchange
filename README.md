# SkillXchange 🔄 Peer-to-Peer Skill Swapping Platform

[![Node.js](https://img.shields.io/badge/Node.js-v18+-43853D?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-4.19+-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-316192?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.7-010101?style=flat-square&logo=socket.io&logoColor=white)](https://socket.io/)
[![ONNX Transformers](https://img.shields.io/badge/HuggingFace-Transformers.js-FFD21E?style=flat-square&logo=huggingface&logoColor=black)](https://github.com/xenova/transformers.js)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

> **"You teach me X, I teach you Y"** — A full-stack collaborative platform where users teach what they know and learn what they want. Built with an AI-driven semantic matching algorithm that connects users based on reciprocal teaching and learning preferences, accompanied by real-time messaging, WebRTC video calling, collaborative whiteboard, and live coding.

---

## 🌟 Key Features

### 1. 🧠 AI-Powered Semantic Skill Matching
- **Local ONNX Feature Extraction**: Uses `@xenova/transformers` running the `Xenova/all-MiniLM-L6-v2` transformer model locally to generate 384-dimensional vector embeddings without external API latency.
- **Cosine Similarity Engine**: Computes semantic similarity between skills (threshold: 0.65) to detect complementary pairs (e.g., matching "Python for Data Science" with "Machine Learning").
- **Reciprocal Matching**: Categorizes matches into **Perfect Match** (two-way reciprocal swap) and **Partial Match** (one-way learning/teaching match).
- **Embedding Cache**: Caches vector embeddings in PostgreSQL / memory to optimize repeated similarity calculations.

### 2. ⚡ Real-Time Collaboration & Communication
- **Real-Time Direct & Group Chat**: Powered by Socket.IO with typing indicators, read receipts, message reactions, edits, and deletions.
- **WebRTC Video & Voice Calling**: Peer-to-peer audio/video calling with signaling handled via WebSockets (`webrtc_offer`, `webrtc_answer`, `webrtc_ice`).
- **Interactive Virtual Classroom**: Includes real-time collaborative code editor (`code_update`), collaborative whiteboard (`whiteboard_update`), hand raising, and host moderation controls (mute all, remove participant).
- **Voice Notes & Attachments**: Audio recorder and media attachment exchange.

### 3. 🤖 AI Assistant & Bio Tag Extraction
- **Gemini LLM Integration**: Built-in AI chat assistant powered by Gemini 2.0 Flash (with 1.5 fallback) for learning roadmaps, lesson plans, and automatic skill tag extraction from free-text user bios.

### 4. 📅 Session Scheduling, Swaps & Trust System
- **Session Management**: Book, accept, reject, and complete 1-on-1 learning sessions with calendar tracking.
- **Peer Review & Rating**: 5-star rating system with text reviews, calculating live average user reputation scores.

### 5. 🛡️ Robust Modular Architecture
- **PostgreSQL Database**: Relational schema with normalized tables (`users`, `user_skills`, `matches`, `messages`, `sessions`, `reviews`, `groups`, `skill_embeddings_cache`).
- **Session-Based Authentication**: Secure cookie authentication using `express-session` with hashed passwords via `bcryptjs`.
- **Session-Verified Sockets**: Real-time WebSockets authenticate against `socket.request.session.userId` to prevent identity spoofing.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Node.js, Express.js |
| **Real-Time / WebSockets** | Socket.IO, WebRTC |
| **Database & ORM Layer** | PostgreSQL (`pg` connection pool with transaction support) |
| **Machine Learning / AI** | `@xenova/transformers` (all-MiniLM-L6-v2 ONNX), Google Gemini API |
| **Authentication & Security** | `express-session`, `bcryptjs`, environment configuration via `dotenv` |
| **Frontend** | Vanilla JavaScript (Native ES Modules), HTML5, Modern CSS3 |
| **Testing** | Node.js Test Runner (`node:test`, `node:assert`) |
| **DevOps & Deployment** | Docker Compose, Render (`render.yaml`) |

---

## 📁 Repository Structure

```text
SkillXchange/
├── src/
│   ├── config/
│   │   └── index.js              # Environment variables & SESSION_SECRET validation
│   ├── db/
│   │   ├── db.js                 # PostgreSQL connection pool & query helpers
│   │   └── index.js              # Database module entry point
│   ├── middleware/
│   │   └── requireAuth.js        # Express session authentication guard
│   ├── routes/
│   │   ├── auth.routes.js        # /api/auth (login, register, me, logout)
│   │   ├── users.routes.js       # /api/users (profiles & directory)
│   │   ├── skills.routes.js      # /api/skills (teach/learn skills CRUD)
│   │   ├── matches.routes.js     # /api/matches (semantic matchmaking)
│   │   ├── messages.routes.js    # /api/messages (history, file attachments)
│   │   ├── groups.routes.js      # /api/groups (groups, members, invite links)
│   │   ├── sessions.routes.js    # /api/sessions (booking & status lifecycle)
│   │   ├── reviews.routes.js     # /api/reviews (peer ratings & reviews)
│   │   ├── calls.routes.js       # /api/calls (call history logging)
│   │   └── ai.routes.js          # /api/ai (skill extraction & chat advisor)
│   ├── services/
│   │   ├── matching.js           # Bidirectional/unidirectional skill matching engine
│   │   ├── embeddings.js         # Xenova/Transformers ONNX embedding pipeline
│   │   └── ai.js                 # Gemini AI integration client
│   ├── sockets/
│   │   ├── state.js              # In-memory online user mappings & active rooms
│   │   ├── presence.js           # Session-authenticated socket auth & heartbeats
│   │   ├── directMessages.js     # 1-on-1 chat, typing, reactions, edit/delete
│   │   ├── groupMessages.js      # Group chat, typing, reactions, edit/delete
│   │   ├── webrtc.js             # 1-on-1 and mesh group call signaling
│   │   ├── classroom.js          # Code editor & whiteboard sync, moderation
│   │   └── index.js              # Root Socket.IO connection dispatcher
│   └── server.js                 # App configuration & HTTP/Socket server startup
├── public/
│   ├── css/                      # Application styling
│   ├── js/
│   │   ├── api.js                # Frontend API client and typed endpoint helpers
│   │   ├── socket.js             # Socket.IO client lifecycle & incoming listeners
│   │   ├── state.js              # Reactive state store, DOM helpers, toast & notifications
│   │   ├── webrtc.js             # WebRTC 1-on-1 & mesh group video call engine
│   │   ├── main.js               # Application bootstrap & navigation coordinator
│   │   └── views/
│   │       ├── auth.js           # Landing page animations & auth modals
│   │       ├── chat.js           # Direct & group messaging UI, attachments, reactions
│   │       ├── classroom.js      # Video call overlay PIP, workspace split, editor sync
│   │       ├── explore.js        # Peer discovery, search filtering & match cards
│   │       ├── profile.js        # Profile edit form, skills management, AI coach
│   │       └── sessions.js       # Booking calendar, session cards, review modals
│   └── index.html                # Single-page HTML shell
├── seed.js                       # Database seeder script
├── test_matching.js              # Node.js automated test suite for matching engine
├── server.js                     # Root entry point delegating to src/server.js
├── README.md                     # Project documentation
├── SETUP_GUIDE.md                # PostgreSQL setup guide
└── package.json                  # Dependencies & scripts
```

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18.0.0 or higher recommended)
- [PostgreSQL](https://www.postgresql.org/) (v14+) OR [Docker](https://www.docker.com/)

### 1. Clone the Repository
```bash
git clone https://github.com/Ashwani-mic/SkillXchange.git
cd SkillXchange
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Setup PostgreSQL Database

**Option A: Using Docker (Recommended)**
```bash
docker compose up -d
```

**Option B: Native PostgreSQL**
Create a database named `skillxchange`:
```sql
CREATE DATABASE skillxchange;
```

### 4. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Update your `.env` with your PostgreSQL database credentials:
```env
PORT=3001
NODE_ENV=development
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/skillxchange
SESSION_SECRET=your_secure_session_secret_key_here
GEMINI_API_KEY=your_gemini_api_key_here
```

### 5. Seed the Database
Populate demo users (`alice`, `bob`, `charlie`, `diana`, `evan` - password: `password123`):
```bash
npm run seed
```

### 6. Run the Application
```bash
npm start
```
Open **[http://localhost:3001](http://localhost:3001)** in your web browser.

### 7. Run Automated Tests
```bash
npm test
```

---

## 📄 License
This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

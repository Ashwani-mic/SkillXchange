# SkillXchange 🔄 Peer-to-Peer Skill Swapping Platform

[![Node.js](https://img.shields.io/badge/Node.js-v18+-43853D?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-4.19+-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-316192?style=flat-square&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-4.7-010101?style=flat-square&logo=socket.io&logoColor=white)](https://socket.io/)
[![ONNX Transformers](https://img.shields.io/badge/HuggingFace-Transformers.js-FFD21E?style=flat-square&logo=huggingface&logoColor=black)](https://github.com/xenova/transformers.js)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](LICENSE)

A full-stack collaborative platform where users teach what they know and learn what they want. Built with an AI-driven semantic matching algorithm that connects users based on reciprocal teaching and learning preferences, accompanied by real-time messaging, WebRTC video calling, collaborative whiteboard, and live coding.

---

## 🌟 Key Features

### 1. 🧠 AI-Powered Semantic Skill Matching
- **Local ONNX Feature Extraction**: Uses @xenova/transformers running the Xenova/all-MiniLM-L6-v2 transformer model locally to generate 384-dimensional vector embeddings without external API latency.
- **Cosine Similarity Engine**: Computes semantic similarity between skills (threshold: 0.65) to detect complementary pairs (e.g., matching "Python for Data Science" with "Machine Learning").
- **Reciprocal Matching**: Categorizes matches into **Perfect Match** (two-way reciprocal swap) and **Partial Match** (one-way learning/teaching match).
- **Embedding Cache**: Caches vector embeddings in PostgreSQL / memory to optimize repeated similarity calculations.

### 2. ⚡ Real-Time Collaboration & Communication
- **Real-Time Direct & Group Chat**: Powered by Socket.IO with typing indicators, read receipts, message reactions, edits, and deletions.
- **WebRTC Video & Voice Calling**: Peer-to-peer audio/video calling with signaling handled via WebSockets (webrtc_offer, webrtc_answer, webrtc_ice).
- **Interactive Virtual Classroom**: Includes real-time collaborative code editor (code_update), collaborative whiteboard (whiteboard_update), hand raising, and host moderation controls (mute all, remove participant).
- **Voice Notes & Attachments**: Audio recorder and media attachment exchange.

### 3. 🤖 AI Assistant & Bio Tag Extraction
- **Gemini LLM Integration**: Built-in AI chat assistant for learning roadmaps and automatic skill tag extraction from free-text user bios.

### 4. 📅 Session Scheduling, Swaps & Trust System
- **Session Management**: Book, accept, reject, and complete 1-on-1 learning sessions with calendar tracking.
- **Peer Review & Rating**: 5-star rating system with text reviews, calculating live average user reputation scores.

### 5. 🛡️ Robust Backend Architecture
- **PostgreSQL Database**: Relational schema with normalized tables (users, user_skills, matches, messages, sessions, eviews, groups, skill_embeddings_cache).
- **Session-Based Authentication**: Secure cookie authentication using express-session with hashed passwords via cryptjs.
- **Dockerized Environment**: Ready-to-use docker-compose.yml for zero-friction local PostgreSQL database provisioning.

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Backend** | Node.js, Express.js |
| **Real-Time / WebSockets** | Socket.IO, WebRTC |
| **Database & ORM Layer** | PostgreSQL (pg connection pool with transaction support) |
| **Machine Learning / AI** | @xenova/transformers (all-MiniLM-L6-v2 ONNX), Google Gemini API |
| **Authentication & Security** | express-session, cryptjs, environment configuration via dotenv |
| **Frontend** | Vanilla JavaScript (ES6+), HTML5, Modern CSS3 (Flexbox/Grid, Dark/Light theme) |
| **DevOps & Deployment** | Docker Compose, Render (ender.yaml) |

---

## 📁 Repository Structure

`	ext
SkillXchange/
├── server.js               # Express app, REST API routes & Socket.IO signaling handlers
├── db.js                   # PostgreSQL connection pool, schema migrations & query helpers
├── matching.js             # Semantic similarity matching algorithm
├── embeddings.js           # Local ONNX transformer embedding generation & caching
├── ai.js                   # Google Gemini API integration (chat assistant & tag parser)
├── seed.js                 # Sample database seeder (mock users, skills & swap data)
├── docker-compose.yml      # Container configuration for local PostgreSQL
├── render.yaml             # Deployment configuration for Render
├── package.json            # Dependencies and scripts
├── .env.example            # Environment variable template
└── public/                 # Client frontend assets
    ├── index.html          # Single-page application markup
    ├── style.css           # UI styles, design tokens and responsive layouts
    └── app.js              # Client state, WebRTC logic, DOM manipulation & Socket.IO client
`

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18.0.0 or higher recommended)
- [PostgreSQL](https://www.postgresql.org/) (v14+) OR [Docker](https://www.docker.com/)

### 1. Clone the Repository
`ash
git clone https://github.com/Ashwani-mic/SkillXchange.git
cd SkillXchange
`

### 2. Install Dependencies
`ash
npm install
`

### 3. Setup PostgreSQL Database

**Option A: Using Docker (Recommended)**
`ash
docker compose up -d
`

**Option B: Using Local PostgreSQL**
Create a database in PostgreSQL:
`sql
CREATE DATABASE skillxchange;
`

### 4. Configure Environment Variables
Copy .env.example to .env:
`ash
cp .env.example .env
`
Update credentials inside .env:
`env
PORT=3001
SESSION_SECRET=your_super_secret_session_key
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/skillxchange

# Optional: Gemini API for AI bio extraction and chatbot
GEMINI_API_KEY=your_gemini_api_key_here
`

### 5. Seed the Database
Populate the database with sample profiles, skills, and mock reviews:
`ash
npm run seed
`

### 6. Run the Application
`ash
npm start
`
Open your browser and navigate to: **http://localhost:3001**

---

## 📡 API Endpoints Overview

| Method | Endpoint | Description |
|---|---|---|
| POST | /api/auth/register | Register a new user account |
| POST | /api/auth/login | Authenticate user & start session |
| POST | /api/auth/logout | Terminate session |
| GET | /api/users/me | Fetch authenticated user's profile |
| GET | /api/matches | Get reciprocal & partial AI-computed skill matches |
| GET | /api/messages/:partnerId | Fetch message history with a specific user |
| POST | /api/sessions | Propose a new skill swap session |
| PUT | /api/sessions/:id/status | Update session status (ccepted, ejected, completed) |
| POST | /api/reviews | Submit rating & review for a swap partner |
| POST | /api/ai/chat | Query the Gemini-powered learning assistant |

---

## 📄 License
This project is open source and available under the [MIT License](LICENSE).

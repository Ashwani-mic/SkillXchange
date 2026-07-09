# SkillXchange — PostgreSQL Setup Guide

Welcome to the production-ready PostgreSQL branch of **SkillXchange**. The database has been migrated from SQLite to PostgreSQL for reliability, concurrency, and performance.

---

## 🚀 Running the Project Locally

### Step 1: Install & Start PostgreSQL

You have two options to run PostgreSQL locally:

#### Option A: Docker Compose (Recommended)
If you have Docker installed, simply run the following command in your project root to spin up a pre-configured PostgreSQL database:
```bash
docker compose up -d
```

#### Option B: Native Installation
1. Download and install PostgreSQL from the [Official Downloads Page](https://www.postgresql.org/download/).
2. Start the PostgreSQL service.
3. Create a database named `skillxchange` (e.g. using `pgAdmin` or `psql` command line):
   ```sql
   CREATE DATABASE skillxchange;
   ```

---

### Step 2: Configure Environment Variables

1. Copy the `.env.example` file to create a `.env` file:
   ```bash
   cp .env.example .env
   ```
2. Edit `.env` and set your `DATABASE_URL` connection string:
   ```env
   DATABASE_URL=postgresql://your_postgres_username:your_postgres_password@localhost:5432/skillxchange
   ```
   *If you are using the default Docker Compose configuration, the connection URL is:*
   `postgresql://postgres:postgres@localhost:5432/skillxchange`

---

### Step 3: Run Database Seeding
Initialize the database schemas and load rich demo users and matching data with the single seed command:
```bash
npm run seed
```

---

### Step 4: Start the Application
Run the start command:
```bash
npm start
```
Open **[http://localhost:3001](http://localhost:3001)** in your web browser.

---

## 📁 Updated Project Structure

```text
SkillXchange/
├── server.js            ← Express server backend + Socket.IO handlers
├── db.js                ← PostgreSQL database layer + compatibility wrappers
├── seed.js              ← Database seeder script
├── matching.js          ← Cosine similarity semantic matching engine
├── ai.js                ← Gemini LLM API client wrapper
├── embeddings.js        ← ONNX Feature Extraction embedding generator
├── docker-compose.yml   ← Local PostgreSQL DB Docker recipe
├── package.json         ← Project dependencies (pg driver integrated)
└── public/              ← Client-side static assets (HTML, CSS, JS)
```

---

## 🔧 Recommended VS Code Extensions

Install these for the best development experience:

| Extension | What it does |
|-----------|-------------|
| **PostgreSQL Explorer** | Visually browse tables, indexes, and run queries |
| **ESLint** | Code style and quality checker |
| **Prettier** | Code formatter |

---

## ❓ Troubleshooting PostgreSQL Connection Issues

| Problem | Solution |
|---------|----------|
| `Pool connection failed` | Verify your PostgreSQL service is running and ports are correct |
| `database "skillxchange" does not exist` | Connect to your server with `psql` and run `CREATE DATABASE skillxchange;` |
| `password authentication failed` | Check the credentials in your `.env` `DATABASE_URL` exactly |
| `relation "X" already exists` | The database tables were created successfully. Running migrations will skip existing tables. |

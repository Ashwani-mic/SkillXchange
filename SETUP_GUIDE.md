# SkillXchange — VS Code Setup Guide

## 🚀 Running in VS Code

### Step 1: Open the Project
1. Open **VS Code**
2. Click **File → Open Folder**
3. Navigate to `C:\Users\oops1\.gemini\antigravity\scratch\skillsharing`
4. Click **Select Folder**

### Step 2: Open Terminal
- Press **Ctrl + `** (backtick) to open the built-in terminal

### Step 3: Start the Server
```bash
npm start
```

### Step 4: Open in Browser
- Visit **http://localhost:3000**
- The app will load with the full landing page

---

## 🌐 Deploy Online (Free) — No More Sharing Links!

### Method 1: Render.com (Recommended — Free)

1. **Create a GitHub account** at github.com (if you don't have one)
2. **Upload the project** to GitHub:
   ```bash
   git init
   git add .
   git commit -m "SkillXchange app"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/skillxchange.git
   git push -u origin main
   ```
3. **Go to [render.com](https://render.com)** and sign up free
4. Click **New → Web Service**
5. Connect your GitHub repo
6. Set:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
7. Click **Deploy** — in 2-3 minutes you get a URL like `https://skillxchange.onrender.com`
8. **Share ONLY this URL** — anyone worldwide can register and connect!

### Method 2: Railway.app (Also Free)
1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub
3. Click **New Project → Deploy from GitHub Repo**
4. Select your repo, it auto-detects Node.js
5. Your app goes live in under 1 minute!

---

## 🔧 Recommended VS Code Extensions

Install these for the best experience:

| Extension | What it does |
|-----------|-------------|
| **SQLite Viewer** | Visually browse your `db.sqlite` database |
| **Thunder Client** | Test API endpoints without Postman |
| **ESLint** | Code quality for JavaScript |
| **Prettier** | Auto-format your code |
| **GitLens** | Better Git history visualization |

---

## 📁 Project Structure

```
skillsharing/
├── server.js          ← Express backend + Socket.IO
├── db.js              ← SQLite database layer
├── matching.js        ← Smart matching algorithm
├── package.json       ← Dependencies
├── db.sqlite          ← Your database (auto-created)
└── public/
    ├── index.html     ← Frontend HTML
    ├── style.css      ← All styles
    └── app.js         ← Frontend JavaScript
```

---

## ❓ Common Issues

| Problem | Solution |
|---------|----------|
| Port 3000 in use | Change `PORT=3001` in `.env` |
| Camera not working | Use Chrome/Firefox (not Edge) |
| Login fails | Check username/password exactly |
| Matches not showing | Add at least one "teach" and one "learn" skill |

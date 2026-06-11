# Inkwell — Notebook To-Do Sync

A beautiful to-do app that bridges your physical notebook and digital life. Scan handwritten to-do lists with AI, manage tasks with due dates, subtasks, priorities, and calendar views.

## Features

- **📸 AI Notebook Scanning** — Photograph your handwritten to-do list and AI extracts all tasks, detects completed items, flags duplicates, picks up dates, defer marks (`>1w`), and priority stars
- **🖋 Paper Mode** — Notebook-first mode that pins the app to Today. The only verbs are scan, check off, and snooze; unfinished tasks carry forward automatically, and everything else waits for a deliberate weekly review. Built to keep your workflow on paper and your app time under a minute a day
- **💤 Snooze** — One-tap "push it out" horizons (tomorrow / week / month / 3 months). Snoozed tasks vanish until their day, then resurface on Today with a badge
- **📋 Smart Lists** — Today, Upcoming, All Tasks, Completed views + custom lists
- **📅 Calendar View** — Monthly calendar with tasks color-coded by priority
- **✅ Subtasks** — Break down tasks into smaller steps
- **🏷️ Priorities** — None/Low/Medium/High with color-coded indicators
- **🔍 Search** — Instant search across tasks and notes
- **📱 PWA** — Install on your Android phone's home screen like a native app
- **💾 Local Storage** — Your data stays in your browser, no account needed

## Deploy to Vercel (Free — Recommended)

This is the easiest way. Your app lives in the cloud, accessible from any device.

### Step 1: Get accounts (all free)

1. **GitHub**: Sign up at [github.com](https://github.com) if you don't have one
2. **Vercel**: Sign up at [vercel.com](https://vercel.com) using your GitHub account
3. **Anthropic API Key**: Get one at [console.anthropic.com](https://console.anthropic.com) (for the photo scanning feature)

### Step 2: Push code to GitHub

Open a terminal (or use [GitHub's web upload](https://github.com/new)):

```bash
# Install git if needed: https://git-scm.com/downloads

cd inkwell
git init
git add .
git commit -m "Initial commit"

# Create a new repo on GitHub, then:
git remote add origin https://github.com/YOUR_USERNAME/inkwell.git
git branch -M main
git push -u origin main
```

Or just drag-and-drop all the files into a new GitHub repository via the web interface.

### Step 3: Deploy on Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click **Import** next to your `inkwell` repository
3. Click **Deploy** — Vercel auto-detects Next.js
4. After deploy, go to **Settings → Environment Variables**
5. Add: `ANTHROPIC_API_KEY` = your API key from Step 1
6. **Redeploy** from the Deployments tab (click the three dots → Redeploy)

Your app is now live at `https://inkwell-xxxx.vercel.app`! 🎉

### Step 4: Install on your Pixel 8

1. Open `https://your-app-name.vercel.app` in Chrome on your Pixel
2. Tap the **three dots menu** (⋮) in the top right
3. Tap **"Add to Home screen"** or **"Install app"**
4. It now appears on your home screen like a real app with its own icon

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | For photo scanning | Your Anthropic API key |

## Local Development (Optional)

If you ever want to run it locally:

```bash
cd inkwell
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local
npm run dev
```

Opens at [http://localhost:3000](http://localhost:3000)

## Project Structure

```
inkwell/
├── app/
│   ├── api/scan/
│   │   └── route.js      # Serverless API for AI photo processing
│   ├── globals.css        # Global styles & animations
│   ├── layout.js          # HTML layout with PWA meta tags
│   └── page.js            # Main app (all UI components)
├── public/
│   ├── icon-192.png       # PWA icon (small)
│   ├── icon-512.png       # PWA icon (large)
│   ├── manifest.json      # PWA manifest for Android install
│   └── sw.js              # Service worker for offline caching
├── .gitignore
├── next.config.js
├── package.json
└── README.md
```

## Tips

- **Notebook scanning works best** with clear handwriting, good lighting, and a contrasting background
- **On your phone**, use the camera button in the scan modal to take a photo directly
- Tasks are stored in your browser's localStorage — clearing browser data will erase them
- The app works offline after the first load (PWA caching), but photo scanning requires internet

### Bullet-journal notation the scanner understands

| On the page | What it means | What the scan does |
|---|---|---|
| `☐` `□` `[ ]` `-` `•` | Open task | Imports it |
| `✓` `[x]` `X` / strikethrough | Done | Checks it off (even if it already exists in the app) |
| `>1w` `>1m` `>3m` `>Fri` `>Mar 3` | Defer / migrate | Reschedules the task to that date |
| Bare `>` | Defer to tomorrow | Reschedules to tomorrow |
| `*` or `!` | Priority signifier | Imports as high priority |
| Underlined header | Category / collection | Fuzzy-matches to your lists |
| Indentation | Subtask | Nests under the task above |
| Date at top of page | Page date | Default due date for the page |

The full in-app guide (sidebar → ?) covers Paper Mode, the daily scan loop, and the weekly review ritual.

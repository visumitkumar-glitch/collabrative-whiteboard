# SketchSync v2: real-time collaborative whiteboard (Group 8)

Many people draw on one shared board in real time. One Node.js server (no framework) serves the website, the installable app (PWA) and the live WebSocket connection.

## What it can do

| Area | Features |
|---|---|
| Drawing | 15 tools: pen, **highlighter**, line, arrow, rect, circle, triangle, diamond, star, text, sticky note, eraser, laser pointer, select/move, pan. **Dashed** lines and shapes, fill, 16 pen colours + custom picker, width slider, multi-page boards, undo/redo per user |
| Board look | **12 preset board colours + custom picker**, patterns (dots, grid, lines, none), spacing slider. Synced to everyone in the room. The eraser removes ink only, so it works on any colour or pattern |
| View | Zoom (wheel, + / −, pinch), pan (✋ tool, Space+drag, two fingers), Fit (key `0`) |
| Content | **Templates** (Kanban, SWOT, Cornell notes, Flowchart, Grid), **image upload** (also paste), export **PNG** and **PDF**, JSON export |
| Collaboration | **Voice and video call** (WebRTC), **Present / Follow** (everyone sees the presenter's view), room chat, emoji reactions, live cursors |
| Control | **Room passwords**, strong random room codes, name required. Host powers: **Remove, Make host, View-only / Allow draw, Lock room, Clear board**. Lock board, viewer mode |
| Sessions | Save, open, replay and delete sessions; server-side activity log per room; admin console at `/admin.html` |
| Mobile | Installable app, scrolling toolbar, pinch zoom, stylus palm rejection, large touch targets |
| Reliability | Auto-reconnect with offline queue, data saved to disk or MongoDB, health check |

> **New to this? Follow `docs/DEPLOY_GUIDE.md`: every click, a final acceptance checklist and a troubleshooting table.**

## 1. Run it on your own computer (Windows, VS Code)

1. Install Node.js 18 or newer from nodejs.org.
2. Open this folder in VS Code, open a terminal and run:

        npm install        # only needed once (installs the optional MongoDB driver)
        npm start

3. Open <http://localhost:8080> in two browser windows and join the same room code.

Run the automatic tests any time with `npm test` (23 checks, about 5 seconds).

## 2. Put it online 24/7 for anyone (step by step)

**Read this first, because it decides which option you choose.** Free hosts put your app to sleep when nobody uses it. On Render's free plan the server sleeps after 15 minutes without traffic and takes about one minute to wake up, and its disk is erased on every restart (source: render.com/docs/free, checked 15 Nov 2026). Your choices:

| Option | Cost | Always on? | Data kept? |
|---|---|---|---|
| **A. Render free + MongoDB Atlas free + a free pinger** | ₹0 | Almost: a pinger keeps it awake; Render may still restart it, and it can be slow for a minute after a restart | Yes, in MongoDB |
| **B. Render Starter plan** | about $7 per month | Yes | Yes with MongoDB (or add a Render disk) |
| **C. Google Cloud Run** | free tier, needs a billing account | Wakes on demand, set `--min-instances 1` to keep it warm (small cost) | Yes with a Cloud Storage volume |
| **D. Any small VPS with Docker** | a few $ per month | Yes | Yes (Docker volume) |

For a college demo, **A** is the best start. If it must never be slow, move to **B** later. You do not change any code.

### Step 1: put the project on GitHub
1. Create a free account at github.com and click **New repository** (name it `sketchsync`, keep it Private or Public).
2. In the project folder in VS Code's terminal:

        git init
        git add .
        git commit -m "SketchSync v2"
        git branch -M main
        git remote add origin https://github.com/YOUR_NAME/sketchsync.git
        git push -u origin main

   (`.gitignore` already keeps `data/` and secrets out of GitHub.)

### Step 2 (Option A or B): deploy on Render
1. Sign up at render.com with your GitHub account.
2. Click **New > Blueprint**, choose your `sketchsync` repository, and click **Apply**. The file `render.yaml` sets everything up and generates a secret `ADMIN_KEY` for you.
   (Manual way: **New > Web Service**, pick the repo, Runtime = Docker, Instance type = Free, Health check path = `/healthz`.)
3. Wait for the first build (a few minutes). Render shows your public address, like `https://sketchsync-xxxx.onrender.com`. **That link is your website. Send it to anyone.**
4. For Option B, open the service > **Settings > Instance Type** and choose **Starter**.

### Step 3: keep the data (MongoDB Atlas free)
Without this, boards and saved sessions vanish whenever Render restarts the server.
1. Sign up at mongodb.com/atlas, create a free **M0** cluster.
2. **Database Access**: add a user with a password. **Network Access**: add `0.0.0.0/0` (Render's free plan has no fixed address).
3. **Connect > Drivers**, copy the connection string (`mongodb+srv://USER:PASSWORD@...`) and put your real password in it.
4. In Render open your service > **Environment** > set `MONGODB_URI` to that string > Save. The server restarts and logs `MongoDB connected`.
   The admin console shows `storage: mongodb` once it works. If the database is unreachable the server falls back to files and keeps running.

### Step 4 (Option A): keep it awake
1. Sign up at uptimerobot.com (free) and add a **HTTP(s) monitor** for `https://YOUR-APP.onrender.com/healthz` with a 5-minute interval.
2. A single always-awake free service uses about 720 of Render's 750 free hours per month, so it fits. Render can still restart a free service at any time, which is why Step 3 matters.

### Step 5: check it works (2 minutes)
1. Open your live link on a laptop and on a phone (use mobile data, not Wi-Fi).
2. **New private room**, enter, copy the **Invite** link and open it on the phone.
3. Change the board colour on one device. The other must change at once. Draw a highlighter stroke and a dashed rectangle. Use **Make host** and watch the buttons move.
4. Join a video call from both devices. This needs https, which Render gives you automatically.

### Admin console and secrets
- Open `https://YOUR-APP.onrender.com/admin.html` and enter `ADMIN_KEY` (Render > Environment shows the generated value). You see live users, rooms, visits, and can remove or block users and clear or close rooms.
- Never put `ADMIN_KEY` or `MONGODB_URI` in the code or on GitHub. They live only in the hosting dashboard (`.env.example` shows the names).
- Custom domain: Render > Settings > Custom Domains. Then set `ALLOWED_ORIGINS=https://your-domain.com` only if you serve the page from a different host than the server.

### Option C: Google Cloud Run
        gcloud auth login
        gcloud config set project YOUR_PROJECT_ID
        gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com
        gcloud run deploy sketchsync --source . --region asia-south1 --allow-unauthenticated \
          --max-instances 1 --concurrency 250 --timeout 3600 --session-affinity \
          --set-env-vars ADMIN_KEY=choose-a-long-secret,MONGODB_URI="your-atlas-string"
Use `--max-instances 1` because rooms live in the memory of one instance. Add `--min-instances 1` to avoid cold starts. Cloud Run cuts a WebSocket after 60 minutes at most; the app reconnects and restores the board by itself.

### Option D: your own VPS
        docker build -t sketchsync .
        docker run -d --restart unless-stopped -p 80:8080 -v sketchsync-data:/data -e ADMIN_KEY=secret sketchsync
Put Caddy or nginx in front for https (needed for video calls and "Install app").

## 3. Settings you can change without editing code

| Environment variable | Default | Meaning |
|---|---|---|
| `ADMIN_KEY` | none | enables `/admin.html` and session deletion |
| `MONGODB_URI` | none | store rooms and sessions in MongoDB instead of files |
| `ICE_SERVERS` | Google STUN | JSON list of STUN/TURN servers for calls (add a TURN server if calls fail on some networks) |
| `ALLOWED_ORIGINS` | same host only | extra sites allowed to open WebSockets |
| `MAX_USERS_PER_ROOM` | 200 | people in one room |
| `MAX_SHAPES_PER_ROOM` | 50000 | shapes stored per room |
| `MAX_IMAGES_PER_ROOM` | 12 | uploaded pictures per room |
| `MAX_PAGES` / `MAX_ROOMS` / `MAX_SESSIONS` | 100 / 10000 / 2000 | pages per board, rooms alive, saved sessions |
| `MSG_RATE_PER_SEC` | 200 | messages one user may send per second (anti-spam) |
| `SHOW_FULL_IP` | off | `1` shows full IPs in the admin console |

## 4. Project layout

    server.js            HTTP + REST API + WebSocket hub (rooms, host powers, signalling, storage)
    public/index.html    page shell        public/style.css   look and layout
    public/app.js        whole client: drawing engine, zoom/pan, colours, templates, calls
    public/admin.html    admin console     public/sw.js       offline cache for the installable app
    Dockerfile  render.yaml  .env.example  deployment files
    docs/ARCHITECTURE.md  diagrams and security notes      docs/TEST_PLAN.md  demo checklist
    tests/smoke.test.js  automatic server tests (npm test)

## 5. Honest limits
- Names are not accounts. Add sign-in (for example Firebase Authentication) if you need verified users.
- One server holds all rooms in memory. For many servers you would add Redis pub/sub.
- Video calls connect people directly (good for about 4 to 6). Some networks need a TURN server.
- Uploaded images are shrunk to about 900 px and kept small on purpose.

# SketchSync: complete step-by-step guide (beginner friendly)

Follow the parts in order. Tick each box. If something goes wrong, jump to **Troubleshooting** at the bottom.

## Part 0: What you need (10 minutes, all free)
- [ ] A Windows/Mac PC with **VS Code** and **Node.js 18+** (check: open a terminal, type `node -v`)
- [ ] **Git** (check: `git -v`; install from git-scm.com if missing)
- [ ] A **GitHub** account, a **Render** account (sign up with GitHub), a **MongoDB Atlas** account, an **UptimeRobot** account

## Part 1: Run on your own PC
1. Extract `sketchsync-v2.zip` into a new folder `sketchsync`. (Windows: right-click > Extract All.)
2. VS Code > File > Open Folder > `sketchsync`.
3. Terminal (Ctrl + `) then:
   ```
   npm install
   npm start
   ```
   You should see: `SketchSync listening on :8080`.
4. Open http://localhost:8080 in two windows (use one normal and one Incognito window).
5. Window 1: type a name, click **New private room**, click **Enter whiteboard**.
6. Window 2: click **Invite** in window 1, copy the link, open it in window 2, type another name, join.
7. Test the demo list (docs/TEST_PLAN.md rows 4 to 10).
8. Stop the server with Ctrl+C.

Optional: `npm test` runs 23 automatic checks. All must say PASS.

## Part 2: GitHub
1. github.com > **+** > **New repository** > name `sketchsync` > **Create repository**. Leave "Add README" unticked.
2. First time using Git on this PC, run once (use your own name and email):
   ```
   git config --global user.name "Your Name"
   git config --global user.email "you@example.com"
   ```
3. In the VS Code terminal:
   ```
   git init
   git add .
   git commit -m "SketchSync v2"
   git branch -M main
   git remote add origin https://github.com/YOUR_NAME/sketchsync.git
   git push -u origin main
   ```
   A browser window may ask you to sign in to GitHub. Approve it.
4. Refresh the GitHub page. You must see `server.js`, `public`, `Dockerfile`, `render.yaml`.
   `data/` and `.env` must NOT appear (they are ignored on purpose).

## Part 3: Deploy on Render
1. render.com > Sign in with GitHub > allow access to the `sketchsync` repository.
2. **New +** > **Blueprint** > select `sketchsync` > **Apply** (or **Deploy Blueprint**).
   When it asks for `MONGODB_URI`, leave it empty for now and continue.
3. Open the service `sketchsync` > **Logs**. Wait for `SketchSync listening on :...` and a green **Live** badge (3 to 6 minutes).
4. Copy the address at the top, like `https://sketchsync-xxxx.onrender.com`. **This is your public website.**
5. Open it on your phone with mobile data (not Wi-Fi). If it shows a "starting" page, wait one minute.
6. Find your admin key: service > **Environment** > `ADMIN_KEY` > click the eye icon to reveal. Open `/admin.html` on your site and sign in with it. Save the key somewhere private.

## Part 4: MongoDB Atlas (keeps boards and sessions forever)
1. mongodb.com/atlas > sign up > **Create** a cluster > choose **M0 Free** > any region near you (for India, Mumbai if offered) > Create.
2. **Database Access** > **Add New Database User** > username `sketch`, a password with only letters and numbers (avoids encoding problems) > Add User.
3. **Network Access** > **Add IP Address** > **Allow access from anywhere** (`0.0.0.0/0`) > Confirm.
4. **Database** > **Connect** > **Drivers** > copy the string. It looks like
   `mongodb+srv://sketch:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
   Replace `<password>` with your real password (remove the < >).
5. Render > your service > **Environment** > set `MONGODB_URI` = that string > **Save changes**. Render redeploys.
6. In **Logs** look for `MongoDB connected`. Open `/admin.html`: the API field `storage` shows `mongodb` (also in the browser at `/api/stats`).
7. Proof test: draw something in a room, then Render > **Manual Deploy > Restart**. After the restart, join the same room: the drawing is still there.

## Part 5: Keep it awake (free)
1. uptimerobot.com > **Add New Monitor** > type **HTTP(s)** > URL `https://YOUR-APP.onrender.com/healthz` > interval **5 minutes** > Create.
2. Status must turn **Up**.
For a server that never sleeps and never needs a pinger: Render > service > **Settings > Instance Type > Starter** (about $7 a month).

## Part 6: Final acceptance test on the live link (use two devices)
- [ ] Phone opens the live link and shows the home page
- [ ] "New private room" makes a code like `WB-K3F9X2QA`
- [ ] Laptop joins from the invite link
- [ ] Laptop changes board colour > phone changes at once
- [ ] Highlighter stroke and dashed rectangle show on both
- [ ] Make host moves the host buttons to the other device
- [ ] Join call on both: camera and microphone prompts appear and video shows (needs https, which Render provides)
- [ ] Phone: pinch zooms, one finger draws
- [ ] Phone: browser menu > **Add to Home Screen** (or **Install app**) opens it full screen
- [ ] Export PDF downloads
- [ ] Restart test from Part 4 step 7 passes

## Updating the app later
Change files in VS Code, then:
```
git add .
git commit -m "describe your change"
git push
```
Render redeploys by itself.

## Troubleshooting
| Problem | Fix |
|---|---|
| `node` / `npm` / `git` is not recognized | Install it, then **close and reopen VS Code** |
| `EADDRINUSE` port 8080 in use | Close the other terminal running the server, or run `set PORT=8090` (Windows cmd) / `$env:PORT=8090` (PowerShell) then `npm start` |
| `npm install` prints a mongodb warning | Safe to ignore; MongoDB is optional |
| `git push` is rejected or asks for a password | Sign in through the browser window, or use GitHub Desktop; GitHub no longer accepts account passwords in the terminal |
| `git commit` says "Please tell me who you are" | Run the two `git config` commands from Part 2 |
| Render build fails | Open **Logs**, read the last red lines; check `Dockerfile` and `package.json` are in the repository root, not inside another folder |
| Render says "Deploy live" but the site shows an error | Logs must show `listening`. Health check path must be `/healthz` |
| Site is slow for about a minute after idle | Free plan was asleep. Do Part 5 or upgrade to Starter |
| Boards disappear after a restart | MongoDB is not connected: redo Part 4 and check Logs for `MongoDB connected` or an error |
| `bad auth` in logs | Wrong database password. Reset it in Atlas > Database Access and update `MONGODB_URI` |
| `ECONNREFUSED` / timeout to Atlas | Network Access must include `0.0.0.0/0` |
| Camera or microphone does not start | Needs `https://` or `localhost`; allow permission in the browser address bar |
| Video call connects on Wi-Fi but not on mobile data | Some networks block direct connections. Add a TURN server in `ICE_SERVERS` (see `.env.example`) |
| "Offline, reconnecting" never ends | Server asleep or crashed: open `/healthz` in the browser; check Render Logs |
| Wrong room password locked me out for 10 minutes | The rate limit protects against guessing; wait, or restart the service |
| Admin page says "Set the ADMIN_KEY" | Add `ADMIN_KEY` in Render > Environment |

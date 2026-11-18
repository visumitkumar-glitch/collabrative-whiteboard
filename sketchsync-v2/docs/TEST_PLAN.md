# SketchSync test plan

Automated: `npm test` runs 23 server checks (no browser needed). A Playwright script (two browsers + a phone) was used to verify the client; the manual checklist below repeats those checks so you can demo them live.

## Manual demo checklist (use two browser windows: A = host, B = guest)

| # | Step | Expected result | Pass |
|---|---|---|---|
| 1 | A: open the site, type a name, click **New private room**, **Enter whiteboard** | Board opens; A is shown as ★ host | |
| 2 | B: open the invite link (**Invite** button), type a name, join | B appears in A's "Online now" list | |
| 3 | Try joining with an empty name | Refused: "Please type your name first" | |
| 4 | A: **🎨 Board colour** > pick Butter, then pattern Grid | B's board changes colour and pattern instantly | |
| 5 | A: choose **🖍 Highlight**, draw a stroke | Semi-transparent stroke appears in B | |
| 6 | A: choose **Rect**, switch on **Dashed**, drag a rectangle | Dashed rectangle appears in B | |
| 7 | A: choose **Eraser**, rub over the grid | Strokes disappear; colour and grid stay | |
| 8 | A: click **Make host** next to B, confirm | A's host buttons disappear; B now sees Make host / View only / Remove and 🚪 Lock room | |
| 9 | B (host): **View only** next to A, then A tries to draw | A cannot draw; toast says view-only | |
| 10 | B: **🚪 Lock room**, then a third person tries to join | Refused: "This room was locked by the host" | |
| 11 | Scroll wheel over the board, hold Space and drag, press 0 | Zoom, pan, fit | |
| 12 | B: **📡 Present**, then zoom | A auto-follows B's view | |
| 13 | **▦ Templates** > Kanban | Same layout appears for everyone | |
| 14 | **🖼 Image**, choose a photo, move it with Select | Photo appears for everyone and moves | |
| 15 | **Export PNG** / **Export PDF** | Image shown / PDF downloads | |
| 16 | A and B: **📞 Join call** (allow camera and microphone) | Video tiles appear and sound works | |
| 17 | Phone: open the site, pinch with two fingers, draw with one | Zoom works, one finger draws, page does not scroll sideways | |
| 18 | Stop the server for 10 s, restart it | Both windows show "Offline", reconnect automatically, board restored | |
| 19 | Join a room that has a password with the wrong password 9 times | "Too many wrong passwords" for 10 minutes | |
| 20 | Open `/admin.html`, enter the admin key | Live users, rooms, visit counts | |

## Known limits (be honest in the viva)
- Names are not accounts: anyone can type any name.
- One server instance holds all rooms in memory; scaling beyond one instance needs Redis pub/sub.
- Video calls are peer to peer (mesh), good for about 4 to 6 people. Strict corporate networks may need a TURN server (`ICE_SERVERS`).
- Free hosting tiers go to sleep when idle (see README).

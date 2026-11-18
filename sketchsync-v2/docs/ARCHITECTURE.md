# SketchSync architecture

```mermaid
flowchart LR
  subgraph Browsers
    A[Host browser<br/>canvas + app.js]
    B[Guest browser<br/>canvas + app.js]
    C[Phone PWA]
  end
  A <-- WebSocket /ws --> S
  B <-- WebSocket /ws --> S
  C <-- WebSocket /ws --> S
  A <-. WebRTC audio/video, peer to peer .-> B
  subgraph S[Node server - server.js]
    H[HTTP: static files + REST API]
    W[WebSocket hub: rooms, presence, host powers,<br/>validation, rate limit]
    SG[WebRTC signalling relay]
  end
  W --> M[(Room memory)]
  M --> D[(JSON files in DATA_DIR<br/>or MongoDB Atlas)]
  H --> D
  Ad[admin.html] -- x-admin-key --> H
```

## Message flow for one stroke

```mermaid
sequenceDiagram
  participant H as Host browser
  participant S as Server
  participant G as Guest browser
  H->>S: {t:"s", s:{id,type:"pen",p:[...]}}  (while drawing, ~30/s)
  S->>S: cleanShape() validates type, colour, size, points
  S-->>G: {t:"s", s} broadcast (not echoed to sender)
  H->>S: {t:"s", fin:1}  (stroke finished)
  S->>S: log + schedule save to disk / MongoDB
```

## Messages (client to server)

| `t` | Who may send | Purpose |
|---|---|---|
| `s`, `batch`, `mvimg`, `del` | editors | draw, add templates, move image, delete |
| `clr` | host (or the only person) | clear board |
| `board` | editors | board colour, pattern, spacing (synced to all) |
| `kick`, `host`, `role`, `roomlock` | host only | remove, make host, view-only/allow draw, lock room |
| `present`, `view` | anyone / presenter only | follow-the-presenter |
| `call`, `sig` | anyone | voice/video call flags and WebRTC offer/answer/ICE relay |
| `chat`, `cur`, `react`, `lock`, `pgs`, `load`, `ping`, `resync`, `getlog` | as before | chat, cursors, reactions, lock board, pages, load session |

## Security measures
- Room passwords are hashed with scrypt (never stored in plain text). Wrong-password attempts are rate-limited per IP.
- Room codes made by "New private room" have about 40 bits of randomness (8 characters from a 31-character alphabet).
- Only the host can kick, make host, mute, lock the room, or clear the board for others.
- Every shape is validated on the server: type, colour, number ranges, point counts, image type and size.
- Origin check on WebSocket upgrade (blocks other websites from joining rooms from a visitor's browser).
- Per-user message rate limit, body size limit, CSP and other security headers, masked IPs in the admin console.

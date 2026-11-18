'use strict';
/* SketchSync server v2
   HTTP (static files + REST API) and a dependency-free WebSocket hub.
   Features: rooms, presence, host controls (kick / make host / mute / lock room), room passwords (scrypt),
   board colour sync, templates (batch), images, presenter view sync, WebRTC signalling relay,
   persistence (JSON files, or MongoDB if MONGODB_URI is set), rate limiting, admin console. */
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = +process.env.PORT || 8080, DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUB = path.join(__dirname, 'public'), ADMIN = process.env.ADMIN_KEY || '';
const envNum = (k, d) => { const v = +process.env[k]; return v > 0 ? v : d; };
const CFG = {
  maxUsers: envNum('MAX_USERS_PER_ROOM', 200), maxShapes: envNum('MAX_SHAPES_PER_ROOM', 50000), maxPages: envNum('MAX_PAGES', 100),
  msgRate: envNum('MSG_RATE_PER_SEC', 200), maxSessions: envNum('MAX_SESSIONS', 2000), maxRooms: envNum('MAX_ROOMS', 10000),
  maxBodyMB: envNum('MAX_BODY_MB', 20), maxImages: envNum('MAX_IMAGES_PER_ROOM', 12)
};
const SALT = process.env.IP_SALT || 'sketchsync', live = new Map(); let cid = 0;
for (const d of ['', 'logs', 'rooms']) fs.mkdirSync(path.join(DATA, d), { recursive: true });

// ---------- storage: JSON files by default, MongoDB when MONGODB_URI is set (data then survives free-tier restarts)
let coll = null; const mem = new Map();
const fileFor = k => path.join(DATA, k.startsWith('room:') ? 'rooms/' + k.slice(5) + '.json' : k + '.json');
const kvGet = (k, d) => { if (coll) return mem.has(k) ? mem.get(k) : d; try { return JSON.parse(fs.readFileSync(fileFor(k), 'utf8')); } catch (e) { return d; } };
const kvSet = (k, v) => { if (coll) { mem.set(k, v); coll.replaceOne({ _id: k }, { _id: k, v }, { upsert: true }).catch(e => console.error('db write:', e.message)); } else fs.writeFile(fileFor(k), JSON.stringify(v), () => { }); };
const kvSetSync = (k, v) => { if (coll) kvSet(k, v); else try { fs.writeFileSync(fileFor(k), JSON.stringify(v)); } catch (e) { } };
async function initStore() {
  if (!process.env.MONGODB_URI) return;
  try {
    const { MongoClient } = require('mongodb'), cl = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
    await cl.connect(); const c = cl.db(process.env.MONGODB_DB || 'sketchsync').collection('kv');
    for await (const d of c.find({})) mem.set(d._id, d.v);
    coll = c; console.log('MongoDB connected, loaded ' + mem.size + ' documents');
  } catch (e) { console.error('MongoDB not available (' + e.message + ') - falling back to JSON files'); }
}

let usage = {}, bans = new Set(), sessions = []; const fails = new Map(), pwFail = new Map();
let ut = null; const saveUsage = () => { clearTimeout(ut); ut = setTimeout(() => kvSet('usage', usage), 3000); };
const saveBans = () => kvSet('bans', [...bans]);
const saveSessions = () => { while (sessions.length > 1 && JSON.stringify(sessions).length > 12e6) sessions.shift(); kvSet('sessions', sessions); };
const okKey = k => !!ADMIN && typeof k === 'string' && k.length === ADMIN.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(ADMIN));
const maskIp = ip => process.env.SHOW_FULL_IP === '1' ? ip : String(ip).replace(/(\d+\.\d+\.\d+)\.\d+$/, '$1.x').replace(/^([0-9a-f]+:[0-9a-f]+:[0-9a-f]+):.*$/i, '$1:...');
const device = ua => (/Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Other browser') + ' on ' + (/Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'unknown OS') + (/Mobi/.test(ua) ? ' (mobile)' : '');
function track(c) {
  const d = new Date().toISOString().slice(0, 10), u = usage[d] || (usage[d] = { connections: 0, uniq: [] });
  u.connections++; const h = crypto.createHash('sha256').update(SALT + c.ip).digest('hex').slice(0, 10);
  if (!u.uniq.includes(h) && u.uniq.length < 100000) u.uniq.push(h); saveUsage();
}
const rooms = new Map(), started = Date.now(); let totalConns = 0, msgCount = 0, lastCount = 0, mps = 0;
const safe = s => String(s || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16).toUpperCase() || 'MAIN';
const TYPES = new Set(['pen', 'highlighter', 'eraser', 'line', 'arrow', 'rect', 'circle', 'tri', 'diamond', 'star', 'text', 'sticky', 'image']);
const PATTERNS = new Set(['dots', 'grid', 'lines', 'none']), DEF_BOARD = { bg: '#0e1230', pat: 'dots', sp: 40 };
const hashPw = (pw, room) => crypto.scryptSync(String(pw).slice(0, 64), SALT + ':' + room, 32).toString('hex');
const cleanBoard = b => (b && /^#[0-9a-f]{6}$/i.test(b.bg) && PATTERNS.has(b.pat)) ? { bg: b.bg.toLowerCase(), pat: b.pat, sp: Math.min(120, Math.max(10, Math.round(+b.sp) || 40)) } : null;

function getRoom(n) {
  let r = rooms.get(n);
  if (!r) {
    const d = kvGet('room:' + n, {});
    r = { name: n, shapes: Array.isArray(d.shapes) ? d.shapes : [], chat: Array.isArray(d.chat) ? d.chat : [], pages: +d.pages || 1, pass: typeof d.pass === 'string' ? d.pass : '', board: cleanBoard(d.board) || { ...DEF_BOARD },
      locked: false, lockBy: '', host: '', roomLocked: false, allowed: new Set(), muted: new Set(), presenter: '' };
    r.clients = new Set(); r.log = []; r.t = null; rooms.set(n, r);
  }
  return r;
}
const roomObj = r => ({ shapes: r.shapes, chat: r.chat, pages: r.pages, pass: r.pass, board: r.board });
const persist = r => { clearTimeout(r.t); r.t = setTimeout(() => kvSet('room:' + r.name, roomObj(r)), 1500); };
function rlog(r, m) {
  const l = new Date().toISOString() + '  ' + m; r.log.push(l); if (r.log.length > 500) r.log.shift();
  fs.appendFile(path.join(DATA, 'logs', r.name + '.log'), l + '\n', () => { });
}
// ---------- minimal RFC 6455 WebSocket
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
function frame(s, op = 1) {
  const p = Buffer.isBuffer(s) ? s : Buffer.from(s), n = p.length; let h;
  if (n < 126) h = Buffer.from([0x80 | op, n]);
  else if (n < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(n, 2); }
  else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); }
  return Buffer.concat([h, p]);
}
const send = (c, o) => { if (!c.sock.destroyed) c.sock.write(frame(JSON.stringify(o))); };
function bcast(r, o, except) { const f = frame(JSON.stringify(o)); for (const c of r.clients) if (c !== except && !c.sock.destroyed) c.sock.write(f); }
const sendInit = (c, r) => send(c, { t: 'init', shapes: r.shapes, pages: r.pages, board: r.board, locked: r.locked, lockBy: r.lockBy, host: r.host, prot: r.pass ? 1 : 0, chat: r.chat.slice(-50), you: c.name, viewer: c.viewer ? 1 : 0 });
const users = r => bcast(r, { t: 'users', host: r.host, pres: r.presenter, rl: r.roomLocked ? 1 : 0, list: [...r.clients].map(x => ({ n: x.name, c: x.c, v: x.viewer ? 1 : 0, k: x.call ? 1 : 0 })) });
const num = v => typeof v === 'number' && isFinite(v) && Math.abs(v) < 5000, pt = a => Array.isArray(a) && a.length === 2 && num(a[0]) && num(a[1]);
const B64 = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
function cleanShape(s, owner) {
  if (!s || typeof s !== 'object' || !TYPES.has(s.type) || typeof s.id !== 'string' || s.id.length > 64) return null;
  const o = { id: s.id, type: s.type, c: /^#[0-9a-f]{6}$/i.test(s.c) ? s.c : '#ffffff', w: Math.min(24, Math.max(1, +s.w || 4)), f: !!s.f, d: !!s.d, pg: Math.min(CFG.maxPages - 1, Math.max(0, +s.pg || 0)), u: owner, ts: +s.ts || Date.now() };
  if (s.p) { if (!Array.isArray(s.p) || s.p.length > 3000 || !s.p.every(pt)) return null; o.p = s.p; }
  else { if (!pt(s.a) || !pt(s.b)) return null; o.a = s.a; o.b = s.b; }
  if (o.type === 'text' || o.type === 'sticky') o.t = String(s.t || '').slice(0, 120);
  if (o.type === 'image') { if (typeof s.img !== 'string' || s.img.length > 450000 || !B64.test(s.img)) return null; o.img = s.img; }
  return o;
}
const imgCount = r => r.shapes.reduce((n, x) => n + (x.type === 'image' ? 1 : 0), 0);
const isHost = (r, c) => r.host === c.name;
function handle(c, m) {
  const r = getRoom(c.room), out = c.viewer || (r.locked && r.lockBy !== c.name);
  switch (m.t) {
    case 'ping': return send(c, { t: 'pong', ts: m.ts });
    case 'resync': return sendInit(c, r);
    case 'getlog': return send(c, { t: 'logtext', lines: r.log.slice(-200) });
    // ---- host controls
    case 'kick': { if (!isHost(r, c)) return; const t = [...r.clients].find(x => x.name === m.n); if (t && t !== c) { send(t, { t: 'kicked' }); rlog(r, c.name + ' removed ' + t.name); setTimeout(() => t.sock.destroy(), 100); } break; }
    case 'host': { if (!isHost(r, c)) return; const t = [...r.clients].find(x => x.name === m.n); if (!t || t === c) return; r.host = t.name; rlog(r, c.name + ' made ' + t.name + ' the host'); users(r); bcast(r, { t: 'hostchg', u: t.name }); break; }
    case 'role': { if (!isHost(r, c)) return; const t = [...r.clients].find(x => x.name === m.n); if (!t || t === c) return; t.viewer = !!m.v; t.viewer ? r.muted.add(t.name) : r.muted.delete(t.name); send(t, { t: 'role', v: t.viewer ? 1 : 0 }); rlog(r, c.name + (t.viewer ? ' set ' + t.name + ' to view-only' : ' allowed ' + t.name + ' to draw')); users(r); break; }
    case 'roomlock': { if (!isHost(r, c)) return; r.roomLocked = !!m.v; r.allowed = new Set([...r.clients].map(x => x.base)); rlog(r, c.name + (r.roomLocked ? ' locked the room (no new joins)' : ' opened the room')); users(r); break; }
    // ---- drawing
    case 's': {
      if (out || !m.s) return; const i = r.shapes.findIndex(x => x.id === m.s.id), s = cleanShape(m.s, i < 0 ? c.name : r.shapes[i].u); if (!s) return;
      if (i < 0) { if (r.shapes.length >= CFG.maxShapes || (s.type === 'image' && imgCount(r) >= CFG.maxImages)) return; r.shapes.push(s); } else if (r.shapes[i].type === 'image') return; else r.shapes[i] = s;
      bcast(r, { t: 's', s, fin: m.fin ? 1 : 0 }, c); if (m.fin) rlog(r, c.name + (i < 0 ? ' drew ' : ' edited ') + s.type); persist(r); break;
    }
    case 'mvimg': {   // moving an image only sends its two corner points (the picture itself is big)
      if (out) return; const s = r.shapes.find(x => x.id === m.id && x.type === 'image'); if (!s || !pt(m.a) || !pt(m.b)) return;
      s.a = m.a; s.b = m.b; bcast(r, { t: 'mvimg', id: s.id, a: s.a, b: s.b }, c); if (m.fin) { rlog(r, c.name + ' moved an image'); persist(r); } break;
    }
    case 'batch': {
      if (out || !Array.isArray(m.shapes)) return; const add = [];
      for (const x of m.shapes.slice(0, 200)) { if (r.shapes.length + add.length >= CFG.maxShapes) break; const s = cleanShape(x, c.name); if (s && s.type !== 'image' && !r.shapes.some(y => y.id === s.id)) add.push(s); }
      if (!add.length) return; r.shapes.push(...add); bcast(r, { t: 'batch', shapes: add }, c); rlog(r, c.name + ' added ' + add.length + ' shapes' + (m.name ? ' (template: ' + String(m.name).slice(0, 20) + ')' : '')); persist(r); break;
    }
    case 'del': if (out) return; r.shapes = r.shapes.filter(x => x.id !== m.id); bcast(r, { t: 'del', id: m.id }, c); rlog(r, c.name + ' deleted a shape'); persist(r); break;
    case 'clr': if (out) return; if (!isHost(r, c) && r.clients.size > 1) return send(c, { t: 'warn', x: 'Only the host can clear the board' }); r.shapes = []; bcast(r, { t: 'clr', u: c.name }, c); rlog(r, c.name + ' cleared the board'); persist(r); break;
    case 'board': { if (out) return; const b = cleanBoard(m.b); if (!b) return; r.board = b; bcast(r, { t: 'board', b, u: c.name }, c); rlog(r, c.name + ' changed the board colour'); persist(r); break; }
    case 'cur': bcast(r, { t: 'cur', u: c.name, c: c.c, x: +m.x || 0, y: +m.y || 0, l: m.l ? 1 : 0 }, c); break;
    case 'chat': { const x = String(m.x || '').trim().slice(0, 300); if (!x) return; const g = { t: 'chat', u: c.name, c: c.c, x }; r.chat.push(g); if (r.chat.length > 100) r.chat.shift(); bcast(r, g, c); rlog(r, c.name + ': ' + x); persist(r); break; }
    case 'lock': if (c.viewer || (r.locked && r.lockBy !== c.name)) return; r.locked = !!m.v; r.lockBy = c.name; bcast(r, { t: 'lock', v: r.locked, u: c.name }, c); rlog(r, c.name + (r.locked ? ' locked' : ' unlocked') + ' the board'); break;
    case 'react': bcast(r, { t: 'react', e: String(m.e).slice(0, 4) }, c); break;
    case 'pgs': if (c.viewer) return; r.pages = Math.min(CFG.maxPages, Math.max(r.pages, +m.n || 1)); bcast(r, { t: 'pgs', n: r.pages }, c); persist(r); break;
    case 'load': {
      if (out || !Array.isArray(m.shapes)) return;
      r.shapes = m.shapes.slice(0, CFG.maxShapes).map(s => cleanShape(s, String(s && s.u || c.name).slice(0, 20))).filter(Boolean);
      r.pages = Math.min(CFG.maxPages, Math.max(1, +m.pages || 1)); for (const x of r.clients) sendInit(x, r);
      rlog(r, c.name + ' loaded a saved session (' + r.shapes.length + ' shapes)'); persist(r); break;
    }
    // ---- collaboration: presenter ("follow me") and WebRTC call signalling
    case 'present': if (m.on) { r.presenter = c.name; rlog(r, c.name + ' started presenting'); } else if (r.presenter === c.name) r.presenter = ''; users(r); break;
    case 'view': if (r.presenter !== c.name || ![m.z, m.x, m.y, m.pg].every(v => typeof v === 'number' && isFinite(v))) return; bcast(r, { t: 'view', z: m.z, x: m.x, y: m.y, pg: m.pg }, c); break;
    case 'call': c.call = !!m.on; users(r); break;
    case 'sig': { const t = [...r.clients].find(x => x.name === m.to); if (t && m.d && JSON.stringify(m.d).length < 20000) send(t, { t: 'sig', from: c.name, d: m.d }); break; }
  }
}
function onData(c, d) {
  c.alive = true; c.buf = Buffer.concat([c.buf, d]); if (c.buf.length > 2e6) return c.sock.destroy();
  for (;;) {
    const b = c.buf; if (b.length < 2) return;
    const fin = b[0] & 128, op = b[0] & 15, mk = b[1] & 128; let len = b[1] & 127, o = 2;
    if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); o = 4; } else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); o = 10; }
    if (!mk || len > 1e6) return c.sock.destroy(); if (b.length < o + 4 + len) return;
    const key = b.slice(o, o + 4), p = Buffer.from(b.slice(o + 4, o + 4 + len)); for (let i = 0; i < len; i++) p[i] ^= key[i & 3];
    c.buf = b.slice(o + 4 + len);
    if (op === 8) { c.sock.end(frame('', 8)); return; } if (op === 9) { c.sock.write(frame(p, 10)); continue; } if (op === 10) continue;
    if (op === 1 || op === 0) {
      c.frag = op === 1 ? [p] : [...(c.frag || []), p]; if (!fin) continue;
      const txt = Buffer.concat(c.frag).toString(); c.frag = null; msgCount++; c.msgs++;
      const now = Date.now(); c.tok = Math.min(CFG.msgRate * 1.5, c.tok + (now - c.last) / 1000 * CFG.msgRate); c.last = now; if (c.tok < 1) continue; c.tok--;
      let m; try { m = JSON.parse(txt); } catch (e) { continue; }
      if (m && typeof m.t === 'string') try { handle(c, m); } catch (e) { console.error(e.message); }
    }
  }
}
function leave(c) {
  if (c.gone) return; c.gone = true; const r = rooms.get(c.room); if (!r || !r.clients.delete(c)) return;
  rlog(r, c.name + ' left'); live.delete(c.id);
  if (r.host === c.name) { const n = [...r.clients][0]; r.host = n ? n.name : ''; if (n) rlog(r, n.name + ' is now the host'); }
  if (r.presenter === c.name) r.presenter = '';
  bcast(r, { t: 'leave', u: c.name }); users(r);
  if (!r.clients.size) { persist(r); setTimeout(() => { if (!r.clients.size) rooms.delete(r.name); }, 60000); }
}
// ---------- HTTP
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'SAMEORIGIN', 'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self' ws: wss:; worker-src 'self'; manifest-src 'self'" };
const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json', ...SEC }); res.end(JSON.stringify(o)); };
const body = req => new Promise((ok, no) => { let b = '', n = 0; req.on('data', d => { n += d.length; if (n > CFG.maxBodyMB * 1e6) { no(Error('Payload too large')); req.destroy(); } else b += d; }); req.on('end', () => ok(b)); req.on('error', no); });
function stats() {
  let conns = 0, shapes = 0; for (const r of rooms.values()) { conns += r.clients.size; shapes += r.shapes.length; }
  return { connections: conns, rooms: rooms.size, shapes, msgsPerSec: mps, totalConnections: totalConns, uptime: Math.round((Date.now() - started) / 1000), memoryMB: Math.round(process.memoryUsage().rss / 1e6), storage: coll ? 'mongodb' : 'files' };
}
function adminLive() {
  return { ...stats(), cfg: CFG, adminSince: started,
    clients: [...live.values()].map(c => ({ id: c.id, name: c.name, room: c.room, ip: maskIp(c.ip), device: device(c.ua), viewer: c.viewer, joined: c.joined, msgs: c.msgs })),
    rooms: [...rooms.values()].map(r => ({ room: r.name, users: r.clients.size, shapes: r.shapes.length, locked: r.locked || r.roomLocked, host: r.host, protected: !!r.pass })),
    daily: Object.entries(usage).sort().slice(-14).map(([d, v]) => ({ d, connections: v.connections, unique: v.uniq.length })),
    bans: [...bans].map((ip, i) => ({ i, label: maskIp(ip) })) };
}
const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x'), p = u.pathname; let m;
    if (p === '/healthz') return json(res, 200, { ok: true });
    const ip0 = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim(), isAdmin = okKey(req.headers['x-admin-key']);
    if (p.startsWith('/api/admin/')) {
      if (!ADMIN) return json(res, 403, { error: 'Set the ADMIN_KEY environment variable to enable the admin console' });
      if ((fails.get(ip0) || 0) > 10) return json(res, 429, { error: 'Too many failed attempts. Try again later.' });
      if (!isAdmin) { fails.set(ip0, (fails.get(ip0) || 0) + 1); return json(res, 401, { error: 'Invalid admin key' }); }
      if (p === '/api/admin/live') return json(res, 200, adminLive());
      if (req.method === 'POST') {
        const b = JSON.parse(await body(req));
        if (p === '/api/admin/kick') { const c = live.get(+b.id); if (!c) return json(res, 404, { error: 'user not connected' }); if (b.ban) { bans.add(c.ip); saveBans(); } send(c, { t: 'kicked' }); setTimeout(() => c.sock.destroy(), 100); return json(res, 200, { ok: true }); }
        if (p === '/api/admin/unban') { const ip = [...bans][+b.i]; if (ip) { bans.delete(ip); saveBans(); } return json(res, 200, { ok: true }); }
        if (p === '/api/admin/room') {
          const r = rooms.get(safe(b.room)); if (!r) return json(res, 404, { error: 'room not found' });
          if (b.action === 'clear') { r.shapes = []; for (const x of r.clients) sendInit(x, r); persist(r); rlog(r, 'Board cleared by administrator'); }
          if (b.action === 'close') { for (const x of r.clients) { send(x, { t: 'kicked' }); setTimeout(() => x.sock.destroy(), 100); } rlog(r, 'Room closed by administrator'); }
          return json(res, 200, { ok: true });
        }
      }
      if (p === '/api/admin/log') { const f = path.join(DATA, 'logs', safe(u.searchParams.get('room')) + '.log'); res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', ...SEC }); return res.end(fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').slice(-2000).join('\n') : 'No log yet.\n'); }
      return json(res, 404, { error: 'not found' });
    }
    if (p === '/api/stats') return json(res, 200, stats());
    if (p === '/api/ice') { let ice = null; try { ice = JSON.parse(process.env.ICE_SERVERS || 'null'); } catch (e) { } return json(res, 200, { iceServers: Array.isArray(ice) ? ice : [{ urls: 'stun:stun.l.google.com:19302' }] }); }
    if (p === '/api/sessions' && req.method === 'GET') { const rm = u.searchParams.get('room'); return json(res, 200, sessions.filter(s => isAdmin || (rm && s.room === safe(rm))).map(({ shapes, log, ...s }) => ({ ...s, count: shapes.length })).reverse()); }
    if (p === '/api/sessions' && req.method === 'POST') {
      const b = JSON.parse(await body(req)); if (!Array.isArray(b.shapes)) return json(res, 400, { error: 'shapes required' });
      const shapes = b.shapes.slice(0, CFG.maxShapes).map(s => cleanShape(s, String(s && s.u || 'guest').slice(0, 20))).filter(Boolean);
      const log = (Array.isArray(b.log) ? b.log : []).slice(-300).map(l => ({ ts: +l.ts || Date.now(), m: String(l.m).slice(0, 200) }));
      const s = { id: sessions.reduce((a, x) => Math.max(a, x.id), 0) + 1, name: String(b.name || 'Session').slice(0, 60), room: safe(b.room), ts: Date.now(), users: (Array.isArray(b.users) ? b.users : []).slice(0, 50).map(x => String(x).slice(0, 20)), shapes, log };
      sessions.push(s); if (sessions.length > CFG.maxSessions) sessions.shift(); saveSessions(); rlog(getRoom(s.room), 'Session #' + s.id + ' saved (' + shapes.length + ' shapes)');
      return json(res, 201, { id: s.id });
    }
    if ((m = p.match(/^\/api\/sessions\/(\d+)$/))) {
      const i = sessions.findIndex(x => x.id === +m[1]); if (i < 0 || (!isAdmin && sessions[i].room !== safe(u.searchParams.get('room')))) return json(res, 404, { error: 'not found' });
      if (req.method === 'GET') return json(res, 200, sessions[i]);
      if (req.method === 'DELETE') { sessions.splice(i, 1); saveSessions(); return json(res, 200, { ok: true }); }
    }
    if (p === '/api/log') {
      if (!isAdmin) return json(res, 403, { error: 'admin only' });
      const f = path.join(DATA, 'logs', safe(u.searchParams.get('room')) + '.log'); res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', ...SEC });
      return res.end(fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').slice(-1000).join('\n') : 'No log yet for this room.\n');
    }
    let f = path.normalize(path.join(PUB, p === '/' ? 'index.html' : p));
    if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { if (path.extname(p)) return json(res, 404, { error: 'not found' }); f = path.join(PUB, 'index.html'); }
    const ext = path.extname(f);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': ['.html', '.js', '.css', '.webmanifest'].includes(ext) ? 'no-cache' : 'public, max-age=3600', ...SEC });
    fs.createReadStream(f).pipe(res);
  } catch (e) { json(res, 400, { error: e.message }); }
});
server.on('upgrade', (req, sock) => {
  const u = new URL(req.url, 'http://x'), key = req.headers['sec-websocket-key'];
  if (u.pathname !== '/ws' || !key) return sock.destroy();
  // block cross-site WebSocket hijacking: the page must come from this same host (or one listed in ALLOWED_ORIGINS)
  const og = req.headers.origin; if (og) { let h = ''; try { h = new URL(og).host; } catch (e) { } const ok = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean); if (h !== req.headers.host && !ok.includes(og) && !ok.includes(h)) return sock.destroy(); }
  sock.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + crypto.createHash('sha1').update(key + GUID).digest('base64') + '\r\n\r\n');
  const col = u.searchParams.get('c') || '', base = (u.searchParams.get('name') || '').replace(/[^\w .-]/g, '').trim().slice(0, 14);
  const c = { sock, room: safe(u.searchParams.get('room')), name: base, base, c: /^#[0-9a-f]{6}$/i.test(col) ? col : '#00ffc8', buf: Buffer.alloc(0), alive: true, tok: CFG.msgRate * 1.5, last: Date.now(), ip: String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim() };
  c.id = ++cid; c.ua = String(req.headers['user-agent'] || '').slice(0, 200); c.joined = Date.now(); c.msgs = 0; c.viewer = u.searchParams.get('v') === '1'; c.call = false;
  const deny = why => { send(c, { t: 'denied', why }); sock.end(); };
  sock.on('error', () => { });
  if (!base) return deny('Please enter your name to join');
  if (bans.has(c.ip)) return deny('Access blocked by the administrator');
  const isNew = !rooms.has(c.room), r = getRoom(c.room);
  const pf = pwFail.get(c.ip); if (pf && Date.now() - pf.t < 600000 && pf.n >= 8) return deny('Too many wrong passwords. Try again in 10 minutes.');
  const pw = u.searchParams.get('p') || '', ph = pw ? hashPw(pw, c.room) : '';
  if (r.pass && r.pass !== ph) { const n = pf && Date.now() - pf.t < 600000 ? pf.n + 1 : 1; pwFail.set(c.ip, { n, t: Date.now() }); return deny('Wrong room password'); }
  pwFail.delete(c.ip);
  if (!r.pass && ph && !r.clients.size && !r.shapes.length) r.pass = ph;   // the first person in a new room sets its password
  if (r.roomLocked && r.clients.size && !r.allowed.has(base)) return deny('This room was locked by the host');
  if (r.clients.size >= CFG.maxUsers || (isNew && rooms.size > CFG.maxRooms)) { send(c, { t: 'full' }); return sock.end(); }
  if (r.muted.has(base)) c.viewer = true;
  let n = c.name, k = 1; while ([...r.clients].some(x => x.name === n)) n = c.name + '#' + (++k); c.name = n;
  if (!r.host || ![...r.clients].some(x => x.name === r.host)) r.host = c.name;
  sock.on('data', d => onData(c, d)); sock.on('close', () => leave(c));
  r.clients.add(c); live.set(c.id, c); track(c); totalConns++; rlog(r, c.name + ' joined from ' + c.ip); sendInit(c, r); users(r); bcast(r, { t: 'join', u: c.name }, c);
});
setInterval(() => { mps = msgCount - lastCount; lastCount = msgCount; }, 1000);
setInterval(() => { for (const r of rooms.values()) for (const c of r.clients) { if (!c.alive) { c.sock.destroy(); continue; } c.alive = false; c.sock.write(frame('', 9)); } }, 25000);
function shutdown() {
  for (const r of rooms.values()) kvSetSync('room:' + r.name, roomObj(r));
  kvSetSync('sessions', sessions); kvSetSync('usage', usage);
  setTimeout(() => process.exit(0), coll ? 1500 : 0);
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
(async () => {
  await initStore();
  usage = kvGet('usage', {}); bans = new Set(kvGet('bans', [])); sessions = kvGet('sessions', []);
  server.listen(PORT, () => console.log('SketchSync listening on :' + PORT + '  storage: ' + (coll ? 'MongoDB' : DATA)));
})();

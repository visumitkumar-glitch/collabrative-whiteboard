'use strict';
/* SketchSync client v2 - one file, no build step.
   Sections: state | networking | drawing engine | view (zoom/pan/pinch) | board colour | templates | images/export |
   calls (WebRTC) | pages | actions | boot */
const $ = (s, e = document) => e.querySelector(s);
const COLS = ['#00ffc8', '#ff3ca0', '#ffd400', '#7aa2ff', '#b36bff', '#ffffff', '#ff7a3c', '#7aff7a', '#111111', '#ff3b30', '#34c759', '#0a84ff', '#ff9f0a', '#8e8e93', '#5ac8fa', '#a2845e'];
const PRESETS = [['#0e1230', 'Midnight'], ['#000000', 'Black'], ['#1f2933', 'Slate'], ['#0b3d2e', 'Chalkboard'], ['#12263f', 'Navy'], ['#2d1b4e', 'Plum'], ['#ffffff', 'White'], ['#f5f0e1', 'Paper'], ['#fff6bf', 'Butter'], ['#dbeeff', 'Sky'], ['#dcf5e4', 'Mint'], ['#fde2e4', 'Blush']];
const PATS = [['dots', 'Dots'], ['grid', 'Grid'], ['lines', 'Lines'], ['none', 'None']];
const W = 1280, H = 720, KEY = 'sketchsync_sessions', NAMEKEY = 'sketchsync_name', ZMIN = .25, ZMAX = 4;
let ME = null, room = '', ws = null, wsState = 'offline', lat = 0, queue = [], tries = 0, SS = [], dip = null, PW = '', VIEW = false, host = '', prot = false, shapes = [], redo = [], users = {}, curs = {}, log = [],
  tool = 'pen', col = COLS[0], lw = 5, drawing = null, replaying = false, page = 'home', fill = false, dash = false, curPg = 0, pages = 1, sel = null, dragFrom = null, pend = null, locked = false, lockBy = '', chat = [],
  board = { bg: '#0e1230', pat: 'dots', sp: 40 }, view = { z: 1, x: 0, y: 0 }, dirty = true, layer = null, roomLocked = false, presenter = '', follow = false,
  spaceDown = false, penSeen = false, pan = null, pinch = null, seq = 0; const PTRS = new Map(), IMG = new Map();
const toast = t => { const d = document.createElement('div'); d.className = 't'; d.textContent = t; $('#toast').append(d); setTimeout(() => d.remove(), 3500) };
const modal = h => $('#mod').innerHTML = `<div class="mb" data-act="close"><div class="mc card">${h}<button class="x" data-act="close">✕</button></div></div>`;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lum = h => (.299 * parseInt(h.slice(1, 3), 16) + .587 * parseInt(h.slice(3, 5), 16) + .114 * parseInt(h.slice(5, 7), 16)) / 255;
const isDark = () => lum(board.bg) < .5;
const addLog = m => { log.push({ ts: Date.now(), m }); if (log.length > 300) log.shift(); const e = $('#lg'); if (e) { e.insertAdjacentHTML('beforeend', `<p>${new Date().toLocaleTimeString()} · ${esc(m)}</p>`); e.scrollTop = 1e9 } };
const upsert = s => { const i = shapes.findIndex(x => x.id == s.id); i < 0 ? shapes.push(s) : shapes[i] = s; dirty = true };
const uid = () => ME.n.replace(/\W/g, '') + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 4);
const newCode = () => { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789', b = crypto.getRandomValues(new Uint8Array(8)); return 'WB-' + [...b].map(x => A[x % A.length]).join('') };
const canEdit = () => { if (!ME) return false; if (VIEW) { toast('View-only mode: you cannot edit this board'); return false } if (locked && lockBy != ME.n) { toast('Board is locked by ' + lockBy); return false } return true };

// ================= networking: WebSocket client with auto-reconnect and offline queue
const send = m => { const s = JSON.stringify(m); if (ws && ws.readyState == 1) ws.send(s); else if ((m.t == 's' && m.fin) || m.t == 'del' || m.t == 'clr') queue.push(s) };
function netUI() { const e = $('#net'); if (e) { const c = { online: '#3f9', connecting: '#fd0', offline: '#f55' }[wsState]; e.innerHTML = `<span style="color:${c}">●</span> ${wsState == 'online' ? 'Live · ' + lat + ' ms' : wsState == 'connecting' ? 'Connecting…' : 'Offline · reconnecting'}` } const i = $('#inst'); if (i && dip) i.style.display = '' }
function connect() {
  if (!ME) return; clearTimeout(window.__rt); if (ws) { ws.onclose = null; try { ws.close() } catch (e) { } } wsState = 'connecting'; netUI();
  const u = (location.protocol == 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?room=' + encodeURIComponent(room) + '&name=' + encodeURIComponent(ME.n) + '&c=' + encodeURIComponent(ME.c) + '&p=' + encodeURIComponent(PW) + '&v=' + (VIEW ? 1 : 0);
  try { ws = new WebSocket(u) } catch (e) { wsState = 'offline'; return netUI() }
  ws.onopen = () => { wsState = 'online'; tries = 0; netUI(); addLog('Connected to server') };
  ws.onmessage = e => { try { onMsg(JSON.parse(e.data)) } catch (x) { console.error(x) } };
  ws.onclose = () => { wsState = 'offline'; netUI(); if (ME) { tries++; window.__rt = setTimeout(connect, Math.min(8000, 400 * 2 ** tries)) } };
  ws.onerror = () => { }
}
function join(name, r, c, pw, v) { ME = { n: name, c }; room = r; PW = pw || ''; VIEW = !!v; shapes = []; users = {}; curs = {}; chat = []; presenter = ''; follow = false; connect(); addLog(name + ' opened room ' + room) }
setInterval(() => { if (ws && ws.readyState == 1) send({ t: 'ping', ts: Date.now() }) }, 3000);
function onMsg(m) {
  switch (m.t) {
    case 'init': if (m.you && m.you != ME.n) ME.n = m.you; host = m.host || host; prot = !!m.prot; VIEW = !!m.viewer; shapes = m.shapes; pages = Math.max(1, m.pages || 1); if (curPg >= pages) curPg = 0; locked = !!m.locked; lockBy = m.lockBy || ''; chat = m.chat || []; if (m.board) board = m.board;
      queue.splice(0).forEach(s => { const q = JSON.parse(s); if (q.t == 's') upsert(q.s); if (q.t == 'del') shapes = shapes.filter(x => x.id != q.id); if (q.t == 'clr') shapes = []; ws.send(s) }); dirty = true; if (page == 'board') route(); break;
    case 'users': { const prev = presenter; host = m.host || ''; presenter = m.pres || ''; roomLocked = !!m.rl; users = {}; m.list.forEach(u => users[u.n] = { c: u.c, v: u.v, k: u.k });
      if (presenter && presenter != prev && presenter != ME.n) { follow = true; toast(presenter + ' is presenting. You are following (tap Follow to stop).') } if (!presenter || presenter == ME.n) follow = false;
      panels(); dyn(); syncPeers(); break }
    case 'pong': lat = Date.now() - m.ts; netUI(); break;
    case 's': upsert(m.s); if (m.fin) addLog(m.s.u + ' drew ' + m.s.type); break;
    case 'batch': m.shapes.forEach(upsert); addLog('Template added'); break;
    case 'mvimg': { const s = shapes.find(x => x.id == m.id); if (s) { s.a = m.a; s.b = m.b; dirty = true } break }
    case 'del': shapes = shapes.filter(x => x.id != m.id); dirty = true; break;
    case 'clr': shapes = []; dirty = true; addLog(m.u + ' cleared the board'); break;
    case 'board': board = m.b; dirty = true; addLog(m.u + ' changed the board colour'); if ($('#bgm')) A.bgmodal(); break;
    case 'cur': curs[m.u] = { x: m.x, y: m.y, c: m.c, l: m.l, t: Date.now() }; dirty = true; break;
    case 'chat': chat.push(m); renderChat(); if (page != 'board') toast(m.u + ': ' + m.x); break;
    case 'lock': locked = m.v; lockBy = m.u; toast(m.u + (m.v ? ' locked' : ' unlocked') + ' the board'); break;
    case 'react': fly(m.e); break;
    case 'pgs': pages = Math.max(pages, m.n); if (page == 'board') route(); break;
    case 'join': addLog(m.u + ' joined'); toast(m.u + ' joined the room'); break;
    case 'leave': delete curs[m.u]; addLog(m.u + ' left'); dirty = true; break;
    case 'hostchg': toast(m.u == ME.n ? 'You are now the host' : m.u + ' is now the host'); break;
    case 'role': VIEW = !!m.v; toast(VIEW ? 'The host set you to view-only' : 'The host allowed you to draw'); dyn(); break;
    case 'warn': toast(m.x); break;
    case 'view': if (follow && presenter && presenter != ME.n) { view = { z: m.z, x: m.x, y: m.y }; if (m.pg != curPg) { curPg = m.pg; pages = Math.max(pages, m.pg + 1); route() } zoomUI(); dirty = true } break;
    case 'sig': onSig(m.from, m.d); break;
    case 'full': ME = null; toast('This room is full'); go('enter'); break;
    case 'denied': ME = null; wsState = 'offline'; netUI(); toast(m.why); go('enter'); break;
    case 'kicked': endCall(); ME = null; wsState = 'offline'; netUI(); toast('You were removed from the room by the host or administrator'); go('home'); break;
    case 'logtext': modal(`<h2 class="gt">Room log (server)</h2><div style="font:12px monospace;color:#bcd;max-height:55vh;overflow:auto;white-space:pre-wrap">${esc(m.lines.join('\n'))}</div>`); break
  }
}

// ================= drawing engine
const img = s => { let i = IMG.get(s.id); if (!i || i.__src !== s.img) { i = new Image(); i.__src = s.img; i.onload = () => { dirty = true }; i.src = s.img; IMG.set(s.id, i) } return i };
function drawShape(g, s) { g.save(); try { drawShape0(g, s) } finally { g.restore() } }
function drawShape0(g, s) {
  const er = s.type == 'eraser', hl = s.type == 'highlighter', glow = !er && !hl && isDark();
  g.globalCompositeOperation = er ? 'destination-out' : 'source-over'; g.strokeStyle = er ? '#000' : s.c; g.lineWidth = er ? s.w * 4 : hl ? s.w * 3 + 8 : s.w; g.lineCap = g.lineJoin = 'round';
  g.globalAlpha = hl ? .35 : 1; g.shadowColor = glow ? s.c : 'transparent'; g.shadowBlur = glow ? 9 : 0; g.setLineDash(s.d ? [s.w * 2 + 6, s.w * 2 + 5] : []); g.beginPath();
  if (s.p) { s.p.forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); if (s.p.length == 1) g.lineTo(s.p[0][0] + .1, s.p[0][1]) }
  else if (s.type == 'image') { const i = img(s); if (i.complete && i.naturalWidth) g.drawImage(i, Math.min(s.a[0], s.b[0]), Math.min(s.a[1], s.b[1]), Math.abs(s.b[0] - s.a[0]), Math.abs(s.b[1] - s.a[1])); return }
  else if (s.type == 'line') { g.moveTo(...s.a); g.lineTo(...s.b) }
  else if (s.type == 'rect') g.rect(Math.min(s.a[0], s.b[0]), Math.min(s.a[1], s.b[1]), Math.abs(s.b[0] - s.a[0]), Math.abs(s.b[1] - s.a[1]));
  else if (s.type == 'circle') g.arc(s.a[0], s.a[1], Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]), 0, 7);
  else if (s.type == 'arrow') { const a = s.a, b = s.b, t = Math.atan2(b[1] - a[1], b[0] - a[0]), h = 14 + s.w * 2; g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.moveTo(b[0] - h * Math.cos(t - .45), b[1] - h * Math.sin(t - .45)); g.lineTo(b[0], b[1]); g.lineTo(b[0] - h * Math.cos(t + .45), b[1] - h * Math.sin(t + .45)) }
  else if (s.type == 'tri') { g.moveTo((s.a[0] + s.b[0]) / 2, s.a[1]); g.lineTo(s.b[0], s.b[1]); g.lineTo(s.a[0], s.b[1]); g.closePath() }
  else if (s.type == 'diamond') { const mx = (s.a[0] + s.b[0]) / 2, my = (s.a[1] + s.b[1]) / 2; g.moveTo(mx, s.a[1]); g.lineTo(s.b[0], my); g.lineTo(mx, s.b[1]); g.lineTo(s.a[0], my); g.closePath() }
  else if (s.type == 'star') { const cx = (s.a[0] + s.b[0]) / 2, cy = (s.a[1] + s.b[1]) / 2, R = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) / 2.4; for (let i = 0; i < 10; i++) { const r = i % 2 ? R * .45 : R, t = -Math.PI / 2 + i * Math.PI / 5; g[i ? 'lineTo' : 'moveTo'](cx + r * Math.cos(t), cy + r * Math.sin(t)) } g.closePath() }
  else if (s.type == 'text') { g.shadowBlur = 0; g.fillStyle = s.c; g.font = '600 ' + (14 + s.w * 3) + 'px Space Grotesk'; g.fillText(s.t, s.a[0], s.a[1]); return }
  else if (s.type == 'sticky') { g.shadowBlur = 0; g.fillStyle = '#ffe66d'; g.fillRect(s.a[0], s.a[1], 200, 150); g.fillStyle = '#222'; g.font = '600 18px Space Grotesk'; wrap(g, s.t, s.a[0] + 12, s.a[1] + 30, 176, 24); return }
  if (s.f && s.p == null && s.type != 'line' && s.type != 'arrow') { g.save(); g.globalAlpha = .3; g.fillStyle = s.c; g.fill(); g.restore() } g.stroke()
}
function drawPattern(g, vw, vh, v) {
  if (board.pat == 'none') return; const x0 = -v.x / v.z, y0 = -v.y / v.z, x1 = (vw - v.x) / v.z, y1 = (vh - v.y) / v.z; let sp = board.sp; while ((x1 - x0) / sp > 150) sp *= 2;
  const c = isDark() ? 'rgba(255,255,255,.13)' : 'rgba(0,0,0,.17)'; g.fillStyle = c; g.strokeStyle = c; g.lineWidth = 1 / v.z; const sx = Math.floor(x0 / sp) * sp, sy = Math.floor(y0 / sp) * sp;
  if (board.pat == 'dots') { const d = Math.max(2, 1.6 / v.z); for (let x = sx; x < x1; x += sp) for (let y = sy; y < y1; y += sp) g.fillRect(x - d / 2, y - d / 2, d, d) }
  else { g.beginPath(); if (board.pat == 'grid') for (let x = sx; x < x1; x += sp) { g.moveTo(x, y0); g.lineTo(x, y1) } for (let y = sy; y < y1; y += sp) { g.moveTo(x0, y); g.lineTo(x1, y) } g.stroke() }
}
// paints background + pattern + ink. The ink goes on its own layer so the eraser (destination-out) removes ink only, never the colour or pattern.
function renderScene(g, vw, vh, v, lay, pg) {
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.shadowBlur = 0; g.fillStyle = board.bg; g.fillRect(0, 0, vw, vh); g.setTransform(v.z, 0, 0, v.z, v.x, v.y); drawPattern(g, vw, vh, v);
  const l = lay.getContext('2d'); l.setTransform(1, 0, 0, 1, 0, 0); l.clearRect(0, 0, vw, vh); l.setTransform(v.z, 0, 0, v.z, v.x, v.y); for (const s of shapes) if ((s.pg || 0) == pg) drawShape(l, s);
  g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(lay, 0, 0); g.setTransform(v.z, 0, 0, v.z, v.x, v.y)
}
function paint() {
  const cv = $('#cv'); if (!cv) return; const g = cv.getContext('2d'); if (!layer) { layer = document.createElement('canvas'); layer.width = W; layer.height = H }
  renderScene(g, W, H, view, layer, curPg);
  if (sel && (sel.pg || 0) == curPg) { const b = bbox(sel); g.shadowBlur = 0; g.setLineDash([8 / view.z, 6 / view.z]); g.strokeStyle = '#ffd400'; g.lineWidth = 2 / view.z; g.strokeRect(b[0] - 6, b[1] - 6, b[2] - b[0] + 12, b[3] - b[1] + 12); g.setLineDash([]) }
  g.shadowBlur = 0; g.font = 'bold ' + 14 / view.z + 'px Space Grotesk';
  for (const u in curs) { const c = curs[u]; if (Date.now() - c.t > (c.l ? 900 : 3000) || (u == ME.n && !c.l)) continue; if (c.l) { g.shadowColor = '#f33'; g.shadowBlur = 25; g.fillStyle = '#f33'; g.beginPath(); g.arc(c.x, c.y, 10 / view.z, 0, 7); g.fill(); g.shadowBlur = 0 } else { g.fillStyle = c.c; g.beginPath(); g.arc(c.x, c.y, 6 / view.z, 0, 7); g.fill(); g.fillText(u, c.x + 10 / view.z, c.y - 8 / view.z) } }
}
(function loop() { if (dirty) { dirty = false; paint() } requestAnimationFrame(loop) })();
const bbox = s => {
  if (s.p) { const X = s.p.map(q => q[0]), Y = s.p.map(q => q[1]); return [Math.min(...X), Math.min(...Y), Math.max(...X), Math.max(...Y)] }
  if (s.type == 'text') return [s.a[0], s.a[1] - 30, s.a[0] + s.t.length * (9 + s.w), s.a[1] + 8]; if (s.type == 'sticky') return [s.a[0], s.a[1], s.a[0] + 200, s.a[1] + 150];
  if (s.type == 'circle') { const r = Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]); return [s.a[0] - r, s.a[1] - r, s.a[0] + r, s.a[1] + r] }
  return [Math.min(s.a[0], s.b[0]), Math.min(s.a[1], s.b[1]), Math.max(s.a[0], s.b[0]), Math.max(s.a[1], s.b[1])]
};
const hit = p => { const L = shapes.filter(s => (s.pg || 0) == curPg && s.type != 'eraser'); for (let i = L.length - 1; i >= 0; i--) { const b = bbox(L[i]); if (p[0] >= b[0] - 8 && p[0] <= b[2] + 8 && p[1] >= b[1] - 8 && p[1] <= b[3] + 8) return L[i] } return null };
const move = (s, dx, dy) => { if (s.p) s.p = s.p.map(q => [q[0] + dx, q[1] + dy]); else { s.a = [s.a[0] + dx, s.a[1] + dy]; s.b = [s.b[0] + dx, s.b[1] + dy] } };
function wrap(g, t, x, y, mw, lh) { let l = ''; for (const w of t.split(' ')) { const n = l ? l + ' ' + w : w; if (g.measureText(n).width > mw && l) { g.fillText(l, x, y); l = w; y += lh } else l = n } g.fillText(l, x, y) }
function fly(e) { const d = document.createElement('div'); d.textContent = e; d.style.cssText = 'position:fixed;bottom:80px;left:' + (20 + Math.random() * 60) + '%;font-size:44px;z-index:25;pointer-events:none;transition:2s ease-out;opacity:1'; document.body.append(d); requestAnimationFrame(() => { d.style.transform = 'translateY(-300px)'; d.style.opacity = '0' }); setTimeout(() => d.remove(), 2100) }
const chatLine = m => `<p style="margin:3px 0"><b style="color:${m.c}">${esc(m.u)}</b> ${esc(m.x)}</p>`;
function renderChat() { const e = $('#ch'); if (e) { e.innerHTML = chat.map(chatLine).join(''); e.scrollTop = 1e9 } }
function undo() { for (let i = shapes.length - 1; i >= 0; i--) if (shapes[i].u == ME.n) { const s = shapes.splice(i, 1)[0]; redo.push(s); send({ t: 'del', id: s.id }); dirty = true; break } }
function redoF() { const s = redo.pop(); if (s) { upsert(s); send({ t: 's', s, fin: 1 }) } }
function replay(list) { replaying = true; const L = [...list].sort((a, b) => a.ts - b.ts); shapes = []; dirty = true; let i = 0; const iv = setInterval(() => { if (i >= L.length || page != 'board') { clearInterval(iv); replaying = false; send({ t: 'resync' }); return } shapes.push(L[i++]); dirty = true }, Math.max(30, Math.min(150, 5000 / L.length))) }

// ================= view: zoom, pan, pinch, palm rejection, presenter sync
const pc = e => { const r = $('#cv').getBoundingClientRect(); return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H] };
const wp = c => [Math.round(clamp((c[0] - view.x) / view.z, -4900, 4900)), Math.round(clamp((c[1] - view.y) / view.z, -4900, 4900))];
function zoomUI() { const z = $('#zl'); if (z) z.textContent = Math.round(view.z * 100) + '%' }
let pvT = 0; function pushView() { if (presenter && ME && presenter == ME.n && Date.now() - pvT > 60) { pvT = Date.now(); send({ t: 'view', z: view.z, x: view.x, y: view.y, pg: curPg }) } }
function viewChanged(user) { view.z = clamp(view.z, ZMIN, ZMAX); dirty = true; zoomUI(); if (user && follow) { follow = false; dyn(); toast('Stopped following the presenter') } pushView() }
function zoomAt(c, f) { const nz = clamp(view.z * f, ZMIN, ZMAX), k = nz / view.z; view.x = c[0] - (c[0] - view.x) * k; view.y = c[1] - (c[1] - view.y) * k; view.z = nz; viewChanged(true) }
function fitView() {
  const L = shapes.filter(s => (s.pg || 0) == curPg && s.type != 'eraser'); if (!L.length) { view = { z: 1, x: 0, y: 0 }; return viewChanged(true) }
  let b = [1e9, 1e9, -1e9, -1e9]; L.forEach(s => { const x = bbox(s); b = [Math.min(b[0], x[0]), Math.min(b[1], x[1]), Math.max(b[2], x[2]), Math.max(b[3], x[3])] });
  const bw = Math.max(80, b[2] - b[0]), bh = Math.max(60, b[3] - b[1]), z = clamp(Math.min((W - 80) / bw, (H - 80) / bh), ZMIN, 1.5); view = { z, x: (W - bw * z) / 2 - b[0] * z, y: (H - bh * z) / 2 - b[1] * z }; viewChanged(true)
}
function startPinch() {
  if (drawing) { shapes = shapes.filter(x => x.id != drawing.id); send({ t: 'del', id: drawing.id }); drawing = null; dirty = true } sel = null; dragFrom = null; pan = null;
  const [a, b] = [...PTRS.values()], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, v: { ...view }, w: [(mid[0] - view.x) / view.z, (mid[1] - view.y) / view.z] }
}
function doPinch() { const [a, b] = [...PTRS.values()], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], d = Math.hypot(a[0] - b[0], a[1] - b[1]); view.z = clamp(pinch.v.z * d / pinch.d, ZMIN, ZMAX); view.x = mid[0] - pinch.w[0] * view.z; view.y = mid[1] - pinch.w[1] * view.z; viewChanged(true) }
function bind() {
  const cv = $('#cv'); let last = 0, lc = 0; zoomUI(); syncTools();
  cv.addEventListener('wheel', e => { e.preventDefault(); zoomAt(pc(e), Math.exp(-e.deltaY * (e.ctrlKey ? .01 : .0015))) }, { passive: false });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.onpointerdown = e => {
    if (replaying) return; if (e.pointerType == 'pen') penSeen = true; if (e.pointerType == 'touch' && penSeen) return;   // palm rejection: once a stylus is used, finger touches don't draw
    cv.setPointerCapture(e.pointerId); const c = pc(e); PTRS.set(e.pointerId, c);
    if (PTRS.size == 2) return startPinch(); if (PTRS.size > 2) return;
    if (tool == 'pan' || spaceDown || e.button == 1) { pan = { sx: c[0], sy: c[1], vx: view.x, vy: view.y }; cv.style.cursor = 'grabbing'; return }
    if (!canEdit()) return; const p = wp(c); if (tool == 'laser') return;
    if (tool == 'select') { sel = hit(p); dragFrom = sel ? p : null; dirty = true; return }
    if (tool == 'text' || tool == 'sticky') { pend = p; return modal(`<h2 class="gt">${tool == 'text' ? 'Add text' : 'New sticky note'}</h2><input id="tx" maxlength="120" placeholder="Type here"><button class="btn" data-act="addtext" style="margin-top:12px">Add</button>`) }
    redo = []; drawing = { id: uid(), type: tool, c: col, w: lw, f: fill, d: dash, pg: curPg, u: ME.n, ts: Date.now() }; tool == 'pen' || tool == 'eraser' || tool == 'highlighter' ? drawing.p = [p] : (drawing.a = p, drawing.b = p); upsert(drawing); send({ t: 's', s: drawing })
  };
  cv.onpointermove = e => {
    const c = pc(e); if (PTRS.has(e.pointerId)) PTRS.set(e.pointerId, c);
    if (pinch && PTRS.size >= 2) return doPinch(); if (pan) { view.x = pan.vx + c[0] - pan.sx; view.y = pan.vy + c[1] - pan.sy; return viewChanged(true) }
    const p = wp(c); if (Date.now() - lc > 40) { lc = Date.now(); const L = tool == 'laser' ? 1 : 0; if (L) { curs[ME.n] = { x: p[0], y: p[1], c: '#f33', l: 1, t: Date.now() }; dirty = true } send({ t: 'cur', u: ME.n, c: ME.c, x: p[0], y: p[1], l: L }) }
    if (sel && dragFrom) { move(sel, p[0] - dragFrom[0], p[1] - dragFrom[1]); dragFrom = p; send(sel.type == 'image' ? { t: 'mvimg', id: sel.id, a: sel.a, b: sel.b } : { t: 's', s: sel }); dirty = true; return }
    if (!drawing) return; drawing.p ? drawing.p.push(p) : drawing.b = p; dirty = true; if (Date.now() - last > 30) { last = Date.now(); send({ t: 's', s: drawing }) }
  };
  cv.onpointerup = cv.onpointercancel = e => {
    PTRS.delete(e.pointerId); if (pinch && PTRS.size < 2) pinch = null; if (pan) { pan = null; syncTools(); return }
    if (sel && dragFrom) { dragFrom = null; send(sel.type == 'image' ? { t: 'mvimg', id: sel.id, a: sel.a, b: sel.b, fin: 1 } : { t: 's', s: sel, fin: 1 }); addLog(ME.n + ' moved a ' + sel.type) }
    if (!drawing) return; send({ t: 's', s: drawing, fin: 1 }); addLog(ME.n + ' drew ' + drawing.type); drawing = null; panels()
  }
}
function syncTools() {
  document.querySelectorAll('[data-act=tool]').forEach(b => b.classList.toggle('on', b.dataset.id == tool)); const f = $('[data-act=fill]'), d = $('[data-act=dash]'); f && f.classList.toggle('on', fill); d && d.classList.toggle('on', dash);
  document.querySelectorAll('.tools .sw').forEach(s => s.classList.toggle('on', s.dataset.id == col)); const cv = $('#cv'); if (cv) cv.style.cursor = tool == 'pan' || spaceDown ? 'grab' : 'crosshair'
}

// ================= board colour (synced to the whole room)
let bt = 0;
function setBoard(p) { if (VIEW) return toast('View-only mode: you cannot change the board colour'); if (locked && lockBy != ME.n) return toast('Board is locked by ' + lockBy); board = { ...board, ...p }; dirty = true; clearTimeout(bt); bt = setTimeout(() => send({ t: 'board', b: board }), 70) }

// ================= templates (all shapes go to the room in one batch message)
const TPLS = { kanban: 'Kanban board', swot: 'SWOT analysis', cornell: 'Cornell notes', flow: 'Flowchart', grid: 'Grid / table' };
function buildTpl(id) {
  const ik = isDark() ? '#cfe3ff' : '#334155', out = []; let n = 0;
  const mk = (type, a, b, o = {}) => out.push({ id: uid() + 't' + (n++), type, c: o.c || ik, w: o.w || 3, f: !!o.f, d: !!o.d, pg: curPg, u: ME.n, ts: Date.now() + n, a, b: b || a, ...(o.t != null ? { t: o.t } : {}) });
  const R = (x1, y1, x2, y2, o) => mk('rect', [x1, y1], [x2, y2], o), L = (x1, y1, x2, y2, o) => mk('line', [x1, y1], [x2, y2], o), T = (x, y, t, w = 3, c) => mk('text', [x, y], null, { t, w, c });
  if (id == 'kanban') [['To do', '#ff3ca0'], ['Doing', '#ffd400'], ['Done', '#00c896']].forEach(([t, c], i) => { const x = 40 + i * 420; R(x, 80, x + 360, 680); R(x, 80, x + 360, 130, { c, f: true }); T(x + 16, 114, t, 3) });
  if (id == 'swot') { T(140, 44, 'SWOT analysis', 4); R(140, 60, 1140, 680); L(640, 60, 640, 680); L(140, 370, 1140, 370); T(160, 100, 'Strengths', 3, '#00c896'); T(660, 100, 'Weaknesses', 3, '#ff3ca0'); T(160, 410, 'Opportunities', 3, '#ffd400'); T(660, 410, 'Threats', 3, '#ff7a3c') }
  if (id == 'cornell') { R(60, 40, 1220, 680); L(60, 120, 1220, 120); L(360, 120, 360, 560); L(60, 560, 1220, 560); T(80, 90, 'Topic / date:', 3); T(80, 160, 'Cues / questions', 2); T(380, 160, 'Notes', 2); T(80, 600, 'Summary', 3) }
  if (id == 'flow') { R(540, 30, 740, 90); T(612, 68, 'Start', 2); L(640, 90, 640, 140, { w: 3 }); mk('arrow', [640, 100], [640, 140]); R(540, 140, 740, 220); T(590, 188, 'Process', 2); mk('arrow', [640, 220], [640, 270]); mk('diamond', [520, 270], [760, 420]); T(573, 352, 'Decision?', 2); mk('arrow', [640, 420], [640, 480]); T(655, 456, 'Yes', 1); R(540, 480, 740, 560); T(610, 528, 'End', 2); mk('arrow', [760, 345], [960, 345]); T(840, 335, 'No', 1); R(960, 300, 1160, 390); T(1010, 352, 'Fix it', 2); L(1060, 300, 1060, 180); mk('arrow', [1060, 180], [740, 180]) }
  if (id == 'grid') { R(100, 60, 1180, 660); for (let i = 1; i < 6; i++) L(100 + i * 180, 60, 100 + i * 180, 660, { w: 2 }); for (let j = 1; j < 5; j++) L(100, 60 + j * 120, 1180, 60 + j * 120, { w: 2 }) }
  return out.filter(s => s.type != 'line' || s.a[0] != s.b[0] || s.a[1] != s.b[1])
}

// ================= images and export
function addImageFile(f) {
  if (!f || !canEdit()) return; if (!/^image\//.test(f.type)) return toast('Please choose an image file'); const rd = new FileReader();
  rd.onload = () => { const im = new Image(); im.onload = () => {
    const k = Math.min(1, 900 / Math.max(im.width, im.height)), cw = Math.round(im.width * k), ch = Math.round(im.height * k), c = document.createElement('canvas'); c.width = cw; c.height = ch; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cw, ch); g.drawImage(im, 0, 0, cw, ch);
    let q = .8, d = c.toDataURL('image/jpeg', q); while (d.length > 400000 && q > .3) { q -= .1; d = c.toDataURL('image/jpeg', q) } if (d.length > 400000) return toast('That image is too big. Try a smaller one.');
    const vw = Math.min(420, cw / view.z), vh = vw * ch / cw, cx = (W / 2 - view.x) / view.z, cy = (H / 2 - view.y) / view.z, s = { id: uid(), type: 'image', c: '#ffffff', w: 1, f: false, d: false, pg: curPg, u: ME.n, ts: Date.now(), a: [Math.round(cx - vw / 2), Math.round(cy - vh / 2)], b: [Math.round(cx + vw / 2), Math.round(cy + vh / 2)], img: d };
    upsert(s); send({ t: 's', s, fin: 1 }); addLog(ME.n + ' added an image'); tool = 'select'; sel = s; syncTools(); toast('Image added. Drag it with the Select tool.') }; im.onerror = () => toast('Could not read that image'); im.src = rd.result }; rd.readAsDataURL(f)
}
function exportCanvas() {
  const L = shapes.filter(s => (s.pg || 0) == curPg && s.type != 'eraser'); let b = [0, 0, W, H]; if (L.length) { b = [1e9, 1e9, -1e9, -1e9]; L.forEach(s => { const x = bbox(s); b = [Math.min(b[0], x[0]), Math.min(b[1], x[1]), Math.max(b[2], x[2]), Math.max(b[3], x[3])] }); b = [b[0] - 40, b[1] - 40, b[2] + 40, b[3] + 40] }
  const k = Math.min(2, 3200 / Math.max(b[2] - b[0], b[3] - b[1])), cw = Math.max(200, Math.round((b[2] - b[0]) * k)), ch = Math.max(150, Math.round((b[3] - b[1]) * k)), c = document.createElement('canvas'), l = document.createElement('canvas'); c.width = l.width = cw; c.height = l.height = ch;
  renderScene(c.getContext('2d'), cw, ch, { z: k, x: -b[0] * k, y: -b[1] * k }, l, curPg); return c
}
function makePDF(dataUrl, w, h) {   // minimal PDF writer: one page that holds the board as a JPEG
  const bin = atob(dataUrl.split(',')[1]), jpg = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) jpg[i] = bin.charCodeAt(i);
  const PW = 842, PH = Math.round(842 * h / w), enc = new TextEncoder(), parts = [], offs = []; let len = 0; const add = b => { if (typeof b == 'string') b = enc.encode(b); parts.push(b); len += b.length };
  const obj = (n, fn) => { offs[n] = len; add(n + ' 0 obj\n'); fn(); add('\nendobj\n') }, cs = `q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`;
  add('%PDF-1.4\n'); obj(1, () => add('<< /Type /Catalog /Pages 2 0 R >>')); obj(2, () => add('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  obj(3, () => add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`));
  obj(4, () => { add(`<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`); add(jpg); add('\nendstream') });
  obj(5, () => add(`<< /Length ${cs.length} >>\nstream\n${cs}\nendstream`)); const x = len; add('xref\n0 6\n0000000000 65535 f \n'); for (let i = 1; i <= 5; i++) add(String(offs[i]).padStart(10, '0') + ' 00000 n \n'); add(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`);
  return new Blob(parts, { type: 'application/pdf' })
}
function download(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1500) }

// ================= voice / video calls (WebRTC mesh, signalling goes through the same WebSocket)
let LS = null, ICE = null, micOn = true, camOn = true; const PEERS = new Map();
const tileOf = n => [...document.querySelectorAll('#calls .vt')].find(x => x.dataset.n == n);
function addTile(n, stream, self) { let t = tileOf(n); if (!t) { t = document.createElement('div'); t.className = 'vt'; t.dataset.n = n; t.innerHTML = '<video autoplay playsinline></video><b></b>'; $('#calls .vts').append(t); t.lastChild.textContent = self ? 'You' : n } const v = t.firstChild; v.muted = !!self; if (v.srcObject !== stream) v.srcObject = stream; v.play().catch(() => { }) }
function renderCallBar() { const c = $('#calls'); if (!LS) { c.className = ''; c.innerHTML = ''; return } c.className = 'on'; if (!$('.vts', c)) c.innerHTML = '<div class="row" style="margin:0"><button class="btn m s" data-act="mic">🎤 Mute</button><button class="btn m s" data-act="cam">📷 Camera off</button><button class="btn m a" data-act="call">Leave</button></div><div class="vts"></div>' }
async function startCall() {
  if (!ME || wsState != 'online') return toast('Join a room first'); if (!navigator.mediaDevices) return toast('Calls need HTTPS (or localhost)');
  try { try { LS = await navigator.mediaDevices.getUserMedia({ audio: true, video: { width: 320, height: 240 } }) } catch (e) { LS = await navigator.mediaDevices.getUserMedia({ audio: true }); toast('No camera found: joined with audio only') } } catch (e) { LS = null; return toast('Microphone/camera permission was denied') }
  if (!ICE) { try { ICE = (await (await fetch('/api/ice')).json()).iceServers } catch (e) { ICE = [{ urls: 'stun:stun.l.google.com:19302' }] } }
  micOn = camOn = true; renderCallBar(); addTile(ME.n, LS, true); send({ t: 'call', on: 1 }); dyn(); toast('You joined the call')
}
function endCall() { if (!LS && !PEERS.size) return; PEERS.forEach(p => { try { p.pc.close() } catch (e) { } }); PEERS.clear(); if (LS) LS.getTracks().forEach(t => t.stop()); LS = null; renderCallBar(); if (ME) { send({ t: 'call', on: 0 }); dyn() } }
function newPeer(n) {
  const pc = new RTCPeerConnection({ iceServers: ICE || [] }), p = { pc, q: [] }; PEERS.set(n, p); LS.getTracks().forEach(t => pc.addTrack(t, LS));
  pc.onicecandidate = e => { if (e.candidate) send({ t: 'sig', to: n, d: { ice: e.candidate } }) }; pc.ontrack = e => addTile(n, e.streams[0], false);
  pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) dropPeer(n) }; return p
}
function dropPeer(n) { const p = PEERS.get(n); if (p) { try { p.pc.close() } catch (e) { } PEERS.delete(n) } const t = tileOf(n); if (t) t.remove() }
function syncPeers() {   // the user with the greater name starts the connection, so exactly one side sends the offer
  if (!LS || !ME) return; for (const n of [...PEERS.keys()]) if (!users[n] || !users[n].k) dropPeer(n);
  for (const n in users) if (n != ME.n && users[n].k && !PEERS.has(n) && ME.n > n) { const p = newPeer(n); p.pc.createOffer().then(o => p.pc.setLocalDescription(o)).then(() => send({ t: 'sig', to: n, d: { sdp: p.pc.localDescription } })).catch(console.error) }
}
async function onSig(from, d) {
  if (!LS || !d) return; try {
    if (d.sdp) { let p = PEERS.get(from); if (d.sdp.type == 'offer') { if (p) dropPeer(from); p = newPeer(from); await p.pc.setRemoteDescription(d.sdp); for (const c of p.q.splice(0)) await p.pc.addIceCandidate(c); await p.pc.setLocalDescription(await p.pc.createAnswer()); send({ t: 'sig', to: from, d: { sdp: p.pc.localDescription } }) } else if (p) { await p.pc.setRemoteDescription(d.sdp); for (const c of p.q.splice(0)) await p.pc.addIceCandidate(c) } }
    else if (d.ice) { const p = PEERS.get(from); if (!p) return; if (p.pc.remoteDescription) await p.pc.addIceCandidate(d.ice); else p.q.push(d.ice) }
  } catch (e) { console.error('signalling', e) }
}

// ================= pages
const nav = () => `<div class="top"><b class="o gt" style="font-size:16px;margin-right:10px">SKETCHSYNC</b>${[['home', 'Home'], ['board', 'Board'], ['sessions', 'Sessions'], ['analytics', 'Analytics']].map(p => `<a class="${page == p[0] ? 'on' : ''}" data-act="go" data-id="${p[0]}">${p[1]}</a>`).join('')}<span class="sp"></span><a id="inst" data-act="install" style="display:none">⬇ Install app</a><span id="net" class="l" style="white-space:nowrap;margin:0 10px"></span>${ME ? `<span class="l" style="white-space:nowrap">ROOM <b style="color:var(--n)">${esc(room)}</b>${prot ? ' 🔒' : ''} · <b style="color:${ME.c}">${esc(ME.n)}</b></span>` : `<a data-act="go" data-id="enter">Join</a>`}</div>`;
function pHome() {
  return nav() + `<div class="hero"><div class="o" style="color:var(--p);letter-spacing:.3em;font-size:12px">◆ GROUP 8 · COLLABORATIVE WHITEBOARD</div><h1 class="gt">DRAW.<br>SYNC.<br>TOGETHER.</h1><p id="tp" class="o" style="color:var(--n);font-size:18px;min-height:28px"></p><div class="row"><button class="btn" data-act="go" data-id="enter">Start drawing</button></div></div>
<div class="mq"><div>${'<span>◆ LIVE CURSORS</span><span>◆ BOARD COLOURS</span><span>◆ VIDEO CALLS</span><span>◆ ZOOM &amp; PAN</span><span>◆ TEMPLATES</span><span>◆ REPLAY</span>'.repeat(3)}</div></div>
<div class="sec"><h2 class="gt">5 modules</h2><div class="g">${[['1', 'Whiteboard server', 'Rooms that sync every stroke'], ['2', 'Client drawing panel', 'Pointer-based canvas with zoom and pan'], ['3', 'Shape and colour tools', 'Pen, highlighter, dashed shapes, board colours'], ['4', 'Broadcast of drawings', 'Live updates to every user'], ['5', 'Save session log', 'Sessions saved and replayed']].map(m => `<div class="card h"><div class="k" style="color:var(--n)">${m[0]}</div><h3>${m[1]}</h3><p style="color:#9ab">${m[2]}</p></div>`).join('')}</div></div>
<div class="sec"><h2 class="gt">Everything you need</h2><div class="g">${['16 drawing tools','12 board colours + custom picker','Dots, grid and lines patterns','Highlighter and dashed lines','Zoom, pan and pinch','Templates: Kanban, SWOT, Cornell','Image upload','Voice and video calls','Follow the presenter','Room passwords','Host: kick, make host, mute, lock room','Undo / redo per user','Export PNG and PDF','Text and sticky notes','Live cursors and laser pointer','Room chat and reactions','Save and replay sessions','Admin console','Installable app (PWA)','Auto-reconnect'].map(f => `<div class="card h"><b>◆ ${f}</b></div>`).join('')}</div></div><div class="sec"><h2 class="gt">Team</h2><div class="card"><div class="tw"><table><tr><th>Role</th><th>Name</th><th>UID</th></tr>${[['Leader', 'Ayush Raj', '2510001054'], ['Member 1', 'Yash Raj Ojha', '2510001037'], ['Member 2', 'Pratyush Kumar Yadav', '2510001036'], ['Member 3', 'Sahil Kumar', '2510001007']].map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('')}</table></div></div></div>`
}
function pEnter() {
  let nm = ''; try { nm = ME ? ME.n : localStorage.getItem(NAMEKEY) || '' } catch (e) { }
  return nav() + `<div class="wrap"><div class="card"><h2 class="gt">Join a room</h2><label>Your name (required)</label><input id="un" maxlength="14" placeholder="Type your name" autocomplete="nickname" value="${esc(nm)}"><label>Room code</label><input id="rc" maxlength="16" placeholder="Paste a code, or create a new room" value="${esc(room)}"><label>Room password (optional: the first person to enter sets it)</label><input id="rp" type="password" maxlength="30" placeholder="Leave empty for an open room" autocomplete="off"><label>Access mode</label><select id="rv"><option value="0">Editor (can draw)</option><option value="1">Viewer (watch only)</option></select><label>Your colour</label><div>${COLS.map(c => `<span class="sw ${c == col ? 'on' : ''}" style="background:${c};color:${c}" data-act="pick" data-id="${c}"></span>`).join('')}</div><div class="row" style="margin-top:14px"><button class="btn" data-act="enter">Enter whiteboard</button><button class="btn s" data-act="rnd">New private room</button></div><p class="hint">Everyone who enters the same room code works on the same board in real time. "New private room" makes a hard-to-guess code. The person who creates a room becomes its host.</p></div></div>`
}
function pBoard() {
  if (!ME) return pEnter(); const tb = ([i, t]) => `<button class="btn s m" data-act="tool" data-id="${i}">${t}</button>`;
  return nav() + `<div class="board"><div class="main"><div class="tools">${[['select', '⬚ Select'], ['pan', '✋ Pan'], ['pen', '✎ Pen'], ['highlighter', '🖍 Highlight'], ['line', '／ Line'], ['arrow', '→ Arrow'], ['rect', '▭ Rect'], ['circle', '◯ Circle'], ['tri', '△ Triangle'], ['diamond', '◇ Diamond'], ['star', '☆ Star'], ['text', 'T Text'], ['sticky', '▤ Sticky'], ['eraser', '⌫ Eraser'], ['laser', '◉ Laser']].map(tb).join('')}</div>
<div class="tools"><input type="range" min="1" max="24" value="${lw}" data-act="w" title="Line width" style="flex:none"><button class="btn s m" data-act="fill">◼ Fill</button><button class="btn s m" data-act="dash">┅ Dashed</button>${COLS.map(c => `<span class="sw ${c == col ? 'on' : ''}" style="background:${c};color:${c}" data-act="color" data-id="${c}"></span>`).join('')}<input type="color" value="${col}" data-act="color2" title="Custom pen colour" style="flex:none"></div>
<div class="tools"><button class="btn m" data-act="bgmodal">🎨 Board colour</button><button class="btn s m" data-act="tpls">▦ Templates</button><button class="btn s m" data-act="img">🖼 Image</button><span class="grp"><button class="btn s m" data-act="zout">−</button><b id="zl" class="l" style="min-width:42px;text-align:center">100%</b><button class="btn s m" data-act="zin">+</button><button class="btn s m" data-act="fit">Fit</button></span><span id="dyn" class="grp"></span></div>
<div class="tools">${[...Array(pages)].map((_, i) => `<button class="btn s m ${i == curPg ? 'on' : ''}" data-act="pg" data-id="${i}">Page ${i + 1}</button>`).join('')}<button class="btn m" data-act="addpg">+ Page</button><span style="flex:1"></span>${['👍', '❤️', '😂', '🔥', '👏'].map(e => `<button class="btn s m" data-act="react" data-id="${e}">${e}</button>`).join('')}</div>
<div class="cvw"><canvas id="cv" width="${W}" height="${H}"></canvas><div id="zb">scroll = zoom · space+drag = pan · pinch on touch</div></div><p class="hint" style="margin:8px 0 0">Shortcuts: V select · H pan · P pen · M highlighter · L line · A arrow · R rect · C circle · T text · N sticky · E eraser · X laser · D dashed · F fill · 0 fit · + / − zoom · Ctrl+Z / Ctrl+Y · Delete</p>
<div class="tools" style="margin-top:10px"><button class="btn s m" data-act="undo">↶ Undo</button><button class="btn s m" data-act="redo">↷ Redo</button><button class="btn a m" data-act="clear">Clear</button><button class="btn s m" data-act="png">Export PNG</button><button class="btn s m" data-act="pdf">Export PDF</button><button class="btn m" data-act="save">Save session</button><button class="btn s m" data-act="rep">▶ Replay</button><button class="btn s m" data-act="lock">${locked ? '🔓 Unlock' : '🔒 Lock board'}</button><button class="btn s m" data-act="delsel">🗑 Delete selected</button><button class="btn s m" data-act="json">Export JSON</button><button class="btn s m" data-act="invite">Invite</button></div></div>
<div class="side"><div class="card"><div class="l">ONLINE NOW</div><div id="us"></div></div><div class="card"><div class="l">ROOM CHAT</div><div id="ch" style="height:140px;overflow:auto;font-size:13px">${chat.map(chatLine).join('')}</div><div class="row" style="margin:8px 0 0;flex-wrap:nowrap"><input id="cm" placeholder="Message..." style="flex:1"><button class="btn m" data-act="say">Send</button></div></div><div class="card"><div class="l">ROOM ACTIVITY LOG</div><div id="lg">${log.slice(-40).map(x => `<p>${new Date(x.ts).toLocaleTimeString()} · ${esc(x.m)}</p>`).join('')}</div></div></div></div>`
}
function dyn() {
  const e = $('#dyn'); if (!e || !ME) return; const hm = host == ME.n, me = presenter == ME.n;
  e.innerHTML = (VIEW ? '<span class="tag">👁 view only</span>' : '') + `<button class="btn s m ${me ? 'on' : ''}" data-act="present">📡 ${me ? 'Stop presenting' : 'Present'}</button>` + (presenter && !me ? `<button class="btn s m ${follow ? 'on' : ''}" data-act="follow">👁 ${follow ? 'Following ' : 'Follow '}${esc(presenter)}</button>` : '') + `<button class="btn s m ${LS ? 'on' : ''}" data-act="call">📞 ${LS ? 'Leave call' : 'Join call'}</button>` + (hm ? `<button class="btn s m ${roomLocked ? 'on' : ''}" data-act="roomlock">${roomLocked ? '🔓 Open room' : '🚪 Lock room'}</button>` : '')
}
function pSess() { return nav() + `<div class="sec"><h2 class="gt">Saved sessions</h2><div class="card"><div class="row"><button class="btn s m" data-act="srvlog">Server log: room ${esc(room)}</button><button class="btn s m" data-act="refresh">Refresh</button></div>${SS.length ? `<div class="tw"><table><tr><th>#</th><th>Name</th><th>Room</th><th>Saved</th><th>Shapes</th><th>Users</th><th></th></tr>${SS.map(s => `<tr><td>${s.id}</td><td>${esc(s.name)}</td><td>${esc(s.room)}</td><td>${new Date(s.ts).toLocaleString()}</td><td>${s.count}</td><td>${esc(s.users.join(', '))}</td><td><button class="btn m" data-act="open" data-id="${s.id}">Open</button> <button class="btn m s" data-act="rpl" data-id="${s.id}">Replay</button> <button class="btn m s" data-act="slog" data-id="${s.id}">Log</button> <button class="btn m a" data-act="sdel" data-id="${s.id}">Delete</button></td></tr>`).join('')}</table></div>` : '<p style="color:#9ab">No saved sessions yet. Draw on the board and press Save session.</p>'}</div></div>` }
function pAna() {
  const by = {}, us = {}; shapes.forEach(s => { by[s.type] = (by[s.type] || 0) + 1; us[s.u] = (us[s.u] || 0) + 1 }); const bars = o => { const m = Math.max(1, ...Object.values(o)); return Object.entries(o).map(([k, v]) => `<div style="display:flex;gap:10px;align-items:center"><span style="width:80px">${esc(k)}</span><div class="bar" style="width:${v / m * 70}%"></div><b>${v}</b></div>`).join('') || '<p style="color:#9ab">No data yet</p>' };
  return nav() + `<div class="sec"><h2 class="gt">Live analytics</h2><div class="g"><div class="card"><div class="l">TOTAL SHAPES</div><div class="k" id="a1">${shapes.length}</div></div><div class="card"><div class="l">USERS ONLINE</div><div class="k" id="a2">${Object.keys(users).length}</div></div><div class="card"><div class="l">STROKES / MIN</div><div class="k" id="a3">${shapes.filter(s => Date.now() - s.ts < 6e4).length}</div></div><div class="card"><div class="l">LOG EVENTS</div><div class="k" id="a4">${log.length}</div></div>${[['s1', 'CONNECTIONS (SERVER)'], ['s2', 'ACTIVE ROOMS'], ['s3', 'MESSAGES / SEC'], ['s4', 'SERVER UPTIME']].map(c => `<div class="card"><div class="l">${c[1]}</div><div class="k" id="${c[0]}">–</div></div>`).join('')}</div>
<div class="g" style="margin-top:14px"><div class="card"><div class="l">SHAPES BY TOOL</div>${bars(by)}</div><div class="card"><div class="l">CONTRIBUTION BY USER</div>${bars(us)}</div></div></div>`
}
function panels() {
  const u = $('#us'), hm = ME && host == ME.n;
  if (u) u.innerHTML = Object.entries(users).map(([n, v]) => `<div class="us"><span class="dot" style="background:${v.c};color:${v.c}"></span>${esc(n)}${ME && n == ME.n ? ' (you)' : ''}${n == host ? ' ★ host' : ''}${v.v ? ' · viewer' : ''}${v.k ? ' 🔊' : ''}${n == presenter ? ' 📡' : ''}${hm && n != ME.n ? `<span class="ctl"><button class="btn m s" data-act="mkhost" data-id="${esc(n)}">Make host</button><button class="btn m s" data-act="role" data-id="${esc(n)}" data-v="${v.v ? 0 : 1}">${v.v ? 'Allow draw' : 'View only'}</button><button class="btn m a" data-act="kick" data-id="${esc(n)}">Remove</button></span>` : ''}</div>`).join('');
  if (page == 'analytics' && $('#a1')) { $('#a1').textContent = shapes.length; $('#a2').textContent = Object.keys(users).length; $('#a3').textContent = shapes.filter(s => Date.now() - s.ts < 6e4).length; $('#a4').textContent = log.length }
}
const R = { home: pHome, enter: pEnter, board: pBoard, sessions: pSess, analytics: pAna };
const io = new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting) { x.target.classList.add('in'); io.unobserve(x.target); setTimeout(() => x.target.classList.remove('rv', 'in'), 900) } }), { threshold: .08 });
function typer() { const W2 = ['Real-time shared canvas.', 'Board colours and templates.', 'Voice and video built in.', 'Installable on any device.']; let w = 0, i = 0, d = 0; clearInterval(window.__ty); window.__ty = setInterval(() => { const e = $('#tp'); if (!e) return clearInterval(window.__ty); const s = W2[w]; i += d ? -1 : 1; e.textContent = s.slice(0, Math.max(0, i)) + '▌'; if (!d && i == s.length) { d = 1; i = s.length + 8 } else if (d && i <= 0) { d = 0; i = 0; w = (w + 1) % W2.length } }, 70) }
function route() {
  const h = location.hash.slice(1) || 'home'; page = R[h] ? h : 'home'; if (page == 'board' && !ME) page = 'enter'; $('#root').innerHTML = R[page](); $('#mod').innerHTML = '';
  document.querySelectorAll('.sec .card,.sec h2').forEach(x => { x.classList.add('rv'); io.observe(x) }); setTimeout(() => document.querySelectorAll('.rv').forEach(x => x.classList.remove('rv')), 3000);
  if (page == 'board') { bind(); dirty = true; panels(); dyn() } typer(); netUI(); scrollTo(0, 0)
}

// ================= actions
const go = p => location.hash === '#' + p ? route() : location.hash = p;
const ask = (m, f) => { window.__y = f; modal(`<h2 class="gt">Confirm</h2><p>${m}</p><div class="row"><button class="btn a" data-act="yes">Confirm</button><button class="btn s" data-act="close">Cancel</button></div>`) };
async function api(p, o) { const r = await fetch(p, o); if (!r.ok) throw Error('Server responded ' + r.status); return r.json() }
async function saveSess(name) { try { const r = await api('/api/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name || 'Session', room, users: Object.keys(users), shapes, log: log.slice(-200) }) }); addLog('Session #' + r.id + ' saved to server'); toast('Session #' + r.id + ' saved to server') } catch (e) { toast('Save failed: ' + e.message) } }
async function loadSess() { try { SS = await api('/api/sessions?room=' + encodeURIComponent(room)) } catch (e) { SS = []; toast('Could not reach the server') } if (page == 'sessions') $('#root').innerHTML = pSess() }
async function pollStats() { if (page != 'analytics') return; try { const s = await api('/api/stats');[['s1', s.connections], ['s2', s.rooms], ['s3', s.msgsPerSec], ['s4', Math.round(s.uptime / 60) + ' min']].forEach(([i, v]) => { const e = $('#' + i); if (e) e.textContent = v }) } catch (e) { } }
setInterval(pollStats, 2000); addEventListener('beforeinstallprompt', e => { e.preventDefault(); dip = e; netUI() });
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => { }));
const bgModal = () => `<div id="bgm"><h2 class="gt">🎨 Board colour</h2><div class="row">${PRESETS.map(([c, n]) => `<span class="sw big ${c == board.bg ? 'on' : ''}" title="${n}" style="background:${c};color:${c}" data-act="bgset" data-id="${c}"></span>`).join('')}</div>
<label>Custom colour</label><input type="color" value="${board.bg}" data-act="bgcustom"><label>Pattern</label><div class="row">${PATS.map(([p, n]) => `<button class="pb ${p == board.pat ? 'on' : ''}" data-act="bgpat" data-id="${p}">${n}</button>`).join('')}</div>
<label>Pattern spacing: <b id="spv">${board.sp}</b></label><input type="range" min="10" max="120" value="${board.sp}" data-act="bgsp"><p class="hint">Everyone in the room sees the change instantly. The eraser works on every colour and pattern.</p></div>`;
const A = {
  fill: () => { fill = !fill; syncTools() }, dash: () => { dash = !dash; syncTools() },
  pg: id => { curPg = +id; sel = null; pushView(); route() }, addpg: () => { if (VIEW) return toast('View-only mode'); pages++; curPg = pages - 1; send({ t: 'pgs', n: pages }); addLog('Page ' + pages + ' added'); pushView(); route() }, react: id => { fly(id); send({ t: 'react', e: id, u: ME.n }) },
  lock: () => { if (VIEW) return toast('View-only mode'); locked = !locked; lockBy = ME.n; send({ t: 'lock', v: locked, u: ME.n }); toast(locked ? 'Board locked: others are view-only' : 'Board unlocked'); route() },
  delsel: () => { if (!sel) return toast('Choose the Select tool and click a shape first'); if (!canEdit()) return; shapes = shapes.filter(x => x.id != sel.id); send({ t: 'del', id: sel.id }); addLog(ME.n + ' deleted a shape'); sel = null; dirty = true },
  json: () => modal(`<h2 class="gt">Export JSON</h2><textarea style="width:100%;height:220px;background:#000;color:#0fc;border-radius:12px;padding:8px">${esc(JSON.stringify(shapes.map(s => s.type == 'image' ? { ...s, img: '(image data omitted)' } : s)))}</textarea>`),
  invite: () => { const l = location.origin + '/?room=' + encodeURIComponent(room); modal(`<h2 class="gt">Invite people</h2><p>Room code: <b class="o" style="color:var(--n)">${esc(room)}</b></p><input id="il" readonly value="${esc(l)}"><button class="btn" data-act="copyl" style="margin-top:10px">Copy invite link</button><p class="hint">Anyone with the link can join${prot ? ', but they must also know the room password (it is not in the link)' : '. Set a room password on the join page to keep a room private'}.</p>`) },
  say: () => { const i = $('#cm'), x = i.value.trim(); if (!x) return; const m = { t: 'chat', u: ME.n, c: ME.c, x }; chat.push(m); send(m); i.value = ''; renderChat() },
  addtext: () => { const v = $('#tx').value.trim(); if (!v) return; const s = { id: uid(), type: tool, c: col, w: lw, f: fill, d: false, pg: curPg, u: ME.n, ts: Date.now(), a: pend, b: pend, t: v }; upsert(s); send({ t: 's', s, fin: 1 }); addLog(ME.n + ' added ' + tool); $('#mod').innerHTML = '' },
  go: id => go(id), close: (id, e, el) => { if (e.target == el || el.classList.contains('x')) $('#mod').innerHTML = '' },
  pick: id => { col = id; ME && (ME.c = id); document.querySelectorAll('.sw').forEach(s => s.classList.toggle('on', s.dataset.id == id)) },
  rnd: () => { $('#rc').value = newCode(); $('#rp').focus(); toast('New room code created. Add a password if you want it private.') },
  enter: () => {
    if (!$('#un')) return go('enter'); const n = $('#un').value.replace(/[^\w .-]/g, '').trim(); if (!n) { toast('Please type your name first'); $('#un').focus(); return }
    let r = $('#rc').value.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, ''); if (!r) r = newCode(); try { localStorage.setItem(NAMEKEY, n) } catch (e) { }
    join(n, r, col, $('#rp').value, $('#rv').value == '1'); go('board'); toast('Joined room ' + r)
  },
  tool: id => { tool = id; if (id != 'select') sel = null; syncTools(); dirty = true }, color: id => { col = id; ME.c = id; syncTools() }, color2: () => { }, w: () => { }, undo: () => { if (canEdit()) undo() }, redo: () => { if (canEdit()) redoF() },
  clear: () => ask('Clear the whole board for everyone in this room? (Only the host can do this when others are present.)', () => { if (!canEdit()) return; if (host != ME.n && Object.keys(users).length > 1) return toast('Only the host can clear the board'); shapes = []; dirty = true; send({ t: 'clr', u: ME.n }); addLog('You cleared the board') }),
  png: () => { const u = exportCanvas().toDataURL('image/png'); modal(`<h2 class="gt">Your drawing</h2><img src="${u}" style="width:100%;border-radius:12px"><p class="hint">Right-click (or long-press) the image to save it.</p><a class="btn" href="${u}" download="whiteboard.png" style="display:inline-block;text-decoration:none">Download PNG</a>`) },
  pdf: () => { const c = exportCanvas(); download(makePDF(c.toDataURL('image/jpeg', .92), c.width, c.height), 'whiteboard-' + room + '.pdf'); toast('PDF downloaded') },
  save: () => modal(`<h2 class="gt">Save session</h2><label>Session name</label><input id="sn" value="${esc(room)} - ${new Date().toLocaleString()}"><button class="btn" data-act="dosave" style="margin-top:12px">Save</button>`), dosave: () => { saveSess($('#sn').value); $('#mod').innerHTML = '' },
  rep: () => { if (!shapes.length) return toast('Nothing to replay yet'); replay(shapes) },
  open: async id => { try { const s = await api('/api/sessions/' + id + '?room=' + encodeURIComponent(room)); if (!ME) return toast('Join a room first, then open a saved session'); pages = Math.max(1, ...s.shapes.map(x => (x.pg || 0) + 1)); send({ t: 'load', shapes: s.shapes, pages }); log = s.log.map(l => ({ ts: l.ts, m: l.m })); go('board'); toast('Loaded ' + s.name) } catch (e) { toast(e.message) } },
  rpl: async id => { try { const s = await api('/api/sessions/' + id + '?room=' + encodeURIComponent(room)); if (!ME) return toast('Join a room first'); go('board'); setTimeout(() => replay(s.shapes), 300) } catch (e) { toast(e.message) } },
  slog: async id => { try { const s = await api('/api/sessions/' + id + '?room=' + encodeURIComponent(room)); modal(`<h2 class="gt">Session log – ${esc(s.name)}</h2><div id="lgx" style="font-size:12px;color:#bcd;max-height:50vh;overflow:auto">${s.log.map(l => `<p>${new Date(l.ts).toLocaleTimeString()} · ${esc(l.m)}</p>`).join('') || 'No events'}</div><button class="btn" data-act="logcopy" style="margin-top:10px">Copy log</button>`) } catch (e) { toast(e.message) } },
  logcopy: () => { try { navigator.clipboard.writeText($('#lgx').innerText); toast('Copied') } catch (e) { toast('Select the text and copy manually') } },
  sdel: id => ask('Delete this saved session permanently?', async () => { try { await api('/api/sessions/' + id + '?room=' + encodeURIComponent(room), { method: 'DELETE' }); loadSess() } catch (e) { toast(e.message) } }),
  refresh: () => loadSess(), srvlog: () => send({ t: 'getlog' }), copyl: () => { try { navigator.clipboard.writeText($('#il').value); toast('Invite link copied') } catch (e) { $('#il').select() } }, yes: () => { const f = window.__y; $('#mod').innerHTML = ''; f && f() }, install: () => { dip && dip.prompt() },
  // host powers
  kick: id => ask('Remove ' + esc(id) + ' from the room?', () => send({ t: 'kick', n: id })), mkhost: id => ask('Make ' + esc(id) + ' the host? You will lose host powers.', () => send({ t: 'host', n: id })),
  role: (id, e, el) => send({ t: 'role', n: id, v: +el.dataset.v }), roomlock: () => send({ t: 'roomlock', v: roomLocked ? 0 : 1 }),
  // colour, zoom, templates, images, presenter, calls
  bgmodal: () => modal(bgModal()), bgset: id => { setBoard({ bg: id }); A.bgmodal() }, bgpat: id => { setBoard({ pat: id }); A.bgmodal() }, bgcustom: () => { }, bgsp: () => { },
  zin: () => zoomAt([W / 2, H / 2], 1.25), zout: () => zoomAt([W / 2, H / 2], 1 / 1.25), fit: () => fitView(),
  tpls: () => modal(`<h2 class="gt">Templates</h2><p class="hint">Adds a ready-made layout to the current page for everyone in the room.</p><div class="tpl">${Object.entries(TPLS).map(([k, v]) => `<button class="btn s" data-act="tpl" data-id="${k}">${v}</button>`).join('')}</div>`),
  tpl: id => { $('#mod').innerHTML = ''; if (!canEdit()) return; const L = buildTpl(id); L.forEach(upsert); for (let i = 0; i < L.length; i += 100) send({ t: 'batch', shapes: L.slice(i, i + 100), name: TPLS[id] }); addLog(ME.n + ' added the ' + TPLS[id] + ' template'); view = { z: 1, x: 0, y: 0 }; viewChanged(false); toast(TPLS[id] + ' added') },
  img: () => { if (canEdit()) $('#imgf').click() },
  present: () => send({ t: 'present', on: presenter == ME.n ? 0 : 1 }), follow: () => { follow = !follow; dyn(); if (follow) toast('Following ' + presenter) },
  call: () => LS ? endCall() : startCall(), mic: (id, e, el) => { micOn = !micOn; LS && LS.getAudioTracks().forEach(t => t.enabled = micOn); el.textContent = micOn ? '🎤 Mute' : '🎤 Unmute' }, cam: (id, e, el) => { camOn = !camOn; LS && LS.getVideoTracks().forEach(t => t.enabled = camOn); el.textContent = camOn ? '📷 Camera off' : '📷 Camera on' }
};
document.addEventListener('click', e => { const el = e.target.closest('[data-act]'); if (!el || el.tagName == 'INPUT') return; try { A[el.dataset.act](el.dataset.id, e, el) } catch (x) { toast(x.message || x) } });
document.addEventListener('input', e => {
  const a = e.target.dataset && e.target.dataset.act; if (a == 'w') lw = +e.target.value; if (a == 'color2') { col = e.target.value; ME && (ME.c = col); document.querySelectorAll('.tools .sw').forEach(s => s.classList.remove('on')) }
  if (a == 'bgcustom') setBoard({ bg: e.target.value }); if (a == 'bgsp') { setBoard({ sp: +e.target.value }); const v = $('#spv'); if (v) v.textContent = e.target.value }
});
$('#imgf').addEventListener('change', e => { addImageFile(e.target.files[0]); e.target.value = '' });
addEventListener('hashchange', route);
addEventListener('paste', e => { if (page != 'board' || !ME) return; const f = [...(e.clipboardData ? e.clipboardData.files : [])].find(x => /^image\//.test(x.type)); if (f) addImageFile(f) });
addEventListener('blur', () => { spaceDown = false; syncTools() });
addEventListener('keyup', e => { if (e.key == ' ' && spaceDown) { spaceDown = false; syncTools() } });
addEventListener('keydown', e => {
  if (e.key == 'Enter' && e.target.id == 'cm') return A.say(); if (!ME || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || page != 'board') return; const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k == 'z') { e.preventDefault(); A.undo() } else if ((e.ctrlKey || e.metaKey) && k == 'y') { e.preventDefault(); A.redo() }
  else if (e.ctrlKey || e.metaKey || e.altKey) return; else if (k == ' ') { e.preventDefault(); if (!spaceDown) { spaceDown = true; syncTools() } }
  else if (k == 'delete' || k == 'backspace') A.delsel(); else if (k == '0') fitView(); else if (k == '+' || k == '=') A.zin(); else if (k == '-') A.zout(); else if (k == 'd') A.dash(); else if (k == 'f') A.fill();
  else { const m = { v: 'select', h: 'pan', p: 'pen', m: 'highlighter', l: 'line', a: 'arrow', r: 'rect', c: 'circle', t: 'text', n: 'sticky', e: 'eraser', x: 'laser' }[k]; if (m) A.tool(m) }
});
const cur = document.createElement('div'); cur.id = 'cur'; document.body.append(cur); addEventListener('mousemove', e => { cur.style.left = e.clientX + 'px'; cur.style.top = e.clientY + 'px' });
setInterval(() => { dirty = true }, 500); setInterval(() => { if (page == 'analytics') panels() }, 1000);
try { const q = new URLSearchParams(location.search).get('room'); if (q) { room = q.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 16); if (!location.hash) location.hash = 'enter' } } catch (e) { }
// 3D background: drawn at full speed on the home page, but only ~5 fps on the board page (and not at all in a hidden tab) so drawing stays smooth
try {
  const c = $('#bg'), Rn = new THREE.WebGLRenderer({ canvas: c, alpha: true, antialias: true }), sc = new THREE.Scene(), cam = new THREE.PerspectiveCamera(60, 1, .1, 100); cam.position.z = 7;
  const kn = new THREE.Mesh(new THREE.TorusKnotGeometry(1.6, .45, 140, 16), new THREE.MeshBasicMaterial({ color: 0x00ffc8, wireframe: true, transparent: true, opacity: .28 })); sc.add(kn);
  const ic = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xff3ca0, wireframe: true, transparent: true, opacity: .35 })); ic.position.set(-4, -2, -2); sc.add(ic);
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2100).map(() => (Math.random() - .5) * 26), 3)); const pt2 = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffd400, size: .05 })); sc.add(pt2); let mx = 0, my = 0, fr = 0;
  addEventListener('mousemove', e => { mx = e.clientX / innerWidth - .5; my = e.clientY / innerHeight - .5 }); const rs = () => { Rn.setSize(innerWidth, innerHeight); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); kn.position.x = innerWidth > 800 ? 3.2 : 0 }; rs(); addEventListener('resize', rs);
  (function an() { requestAnimationFrame(an); if (document.hidden) return; if (page == 'board' && (++fr % 12)) return; kn.rotation.x += .006; kn.rotation.y += .01; ic.rotation.x += .008; ic.rotation.y += .012; pt2.rotation.y += .0008; cam.position.x += (mx * 3 - cam.position.x) * .05; cam.position.y += (-my * 3 - cam.position.y) * .05; cam.lookAt(0, 0, 0); Rn.render(sc, cam) })()
} catch (e) { }
route();

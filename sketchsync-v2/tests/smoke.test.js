// Server smoke test (no browser, no dependencies). Run:  npm test      (starts its own server on port 8123)
const { spawn } = require('child_process'), crypto = require('crypto'), net = require('net'), os = require('os'), path = require('path'), fs = require('fs');
const PORT = 8123, DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-')); let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? '  PASS  ' : '  FAIL  ') + m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function client(room, name, extra = '') {   // tiny WebSocket client
  return new Promise(res => {
    const s = net.connect(PORT, '127.0.0.1'), key = crypto.randomBytes(16).toString('base64'), c = { msgs: [], s, buf: Buffer.alloc(0), hs: false, closed: false };
    s.write(`GET /ws?room=${room}&name=${encodeURIComponent(name)}${extra} HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    s.on('close', () => c.closed = true); s.on('error', () => { });
    s.on('data', d => { c.buf = Buffer.concat([c.buf, d]); if (!c.hs) { const i = c.buf.indexOf('\r\n\r\n'); if (i < 0) return; c.hs = true; c.buf = c.buf.slice(i + 4); }
      for (;;) { const b = c.buf; if (b.length < 2) break; let len = b[1] & 127, o = 2; if (len === 126) { if (b.length < 4) break; len = b.readUInt16BE(2); o = 4; } else if (len === 127) { if (b.length < 10) break; len = Number(b.readBigUInt64BE(2)); o = 10; } if (b.length < o + len) break; if ((b[0] & 15) === 1) c.msgs.push(JSON.parse(b.slice(o, o + len).toString())); c.buf = b.slice(o + len); } });
    c.send = o => { const p = Buffer.from(JSON.stringify(o)), m = crypto.randomBytes(4); let h; if (p.length < 126) h = Buffer.from([0x81, 0x80 | p.length]); else { h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(p.length, 2); } const x = Buffer.from(p); for (let i = 0; i < x.length; i++) x[i] ^= m[i & 3]; s.write(Buffer.concat([h, m, x])); };
    c.last = t => [...c.msgs].reverse().find(m => m.t === t); setTimeout(() => res(c), 150);
  });
}
(async () => {
  const srv = spawn('node', [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, DATA_DIR: DATA, ADMIN_KEY: 'k' }, stdio: 'ignore' }); await sleep(700);
  try {
    const a = await client('T1', 'Host'), b = await client('T1', 'Guest'); await sleep(100);
    ok(a.last('init') && a.last('init').board.bg === '#0e1230', 'join gets default board colour');
    ok(a.last('users').host === 'Host', 'first user is host');
    a.send({ t: 'board', b: { bg: '#fff6bf', pat: 'grid', sp: 60 } }); await sleep(100);
    ok(b.last('board') && b.last('board').b.bg === '#fff6bf' && b.last('board').b.pat === 'grid', 'board colour syncs to the other user');
    a.send({ t: 'board', b: { bg: 'red', pat: 'dots', sp: 40 } }); await sleep(100);
    ok(b.msgs.filter(m => m.t === 'board').length === 1, 'invalid board colour is rejected');
    a.send({ t: 's', fin: 1, s: { id: 'h1', type: 'highlighter', c: '#ffd400', w: 5, pg: 0, p: [[1, 1], [50, 50]] } });
    a.send({ t: 's', fin: 1, s: { id: 'd1', type: 'rect', c: '#00ffc8', w: 3, d: true, pg: 0, a: [10, 10], b: [200, 120] } }); await sleep(100);
    ok(b.msgs.some(m => m.t === 's' && m.s.type === 'highlighter'), 'highlighter stroke reaches the other user');
    ok(b.msgs.some(m => m.t === 's' && m.s.type === 'rect' && m.s.d === true), 'dashed rectangle reaches the other user (dash flag kept)');
    b.send({ t: 'kick', n: 'Host' }); b.send({ t: 'host', n: 'Guest' }); await sleep(100);
    ok(a.last('users').host === 'Host', 'a non-host cannot make themselves host or kick');
    b.send({ t: 'clr' }); await sleep(100); ok(b.last('warn'), 'non-host cannot clear the board when others are present');
    a.send({ t: 'host', n: 'Guest' }); await sleep(100);
    ok(a.last('users').host === 'Guest' && b.last('users').host === 'Guest' && b.last('hostchg'), 'Make host moves the host to the other window');
    b.send({ t: 'role', n: 'Host', v: 1 }); await sleep(100); a.send({ t: 's', fin: 1, s: { id: 'x9', type: 'pen', c: '#ffffff', w: 3, pg: 0, p: [[5, 5]] } }); await sleep(100);
    ok(a.last('role') && a.last('role').v === 1 && !b.msgs.some(m => m.t === 's' && m.s.id === 'x9'), 'host can set a user to view-only and their strokes are ignored');
    b.send({ t: 'roomlock', v: 1 }); await sleep(100); const late = await client('T1', 'Late'); await sleep(100);
    ok(late.last('denied'), 'locked room refuses new people');
    b.send({ t: 'roomlock', v: 0 }); await sleep(100);
    b.send({ t: 'batch', name: 'kanban', shapes: [{ id: 'b1', type: 'rect', c: '#fff', w: 3, pg: 0, a: [1, 1], b: [9, 9] }, { id: 'b2', type: 'text', c: '#fff', w: 3, pg: 0, a: [5, 5], b: [5, 5], t: 'To do' }] }); await sleep(100);
    ok(a.last('batch') && a.last('batch').shapes.length === 2, 'template batch reaches the other user');
    const tiny = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBD', evil = 'data:text/html;base64,PHNjcmlwdD4=';
    b.send({ t: 's', fin: 1, s: { id: 'i1', type: 'image', c: '#fff', w: 1, pg: 0, a: [0, 0], b: [50, 50], img: tiny } }); b.send({ t: 's', fin: 1, s: { id: 'i2', type: 'image', c: '#fff', w: 1, pg: 0, a: [0, 0], b: [50, 50], img: evil } }); await sleep(100);
    ok(a.msgs.some(m => m.t === 's' && m.s.id === 'i1') && !a.msgs.some(m => m.t === 's' && m.s.id === 'i2'), 'images accepted only as jpeg/png/webp data URLs');
    b.send({ t: 'present', on: 1 }); b.send({ t: 'view', z: 2, x: -10, y: -20, pg: 0 }); await sleep(100);
    ok(a.last('users').pres === 'Guest' && a.last('view') && a.last('view').z === 2, 'presenter view is relayed to followers');
    a.send({ t: 'view', z: 3, x: 0, y: 0, pg: 0 }); await sleep(100); ok(b.msgs.filter(m => m.t === 'view').length === 0, 'only the presenter can drive the view');
    a.send({ t: 'call', on: 1 }); b.send({ t: 'call', on: 1 }); a.send({ t: 'sig', to: 'Guest', d: { sdp: { type: 'offer', sdp: 'x' } } }); await sleep(100);
    ok(b.last('sig') && b.last('sig').from === 'Host' && a.last('users').list.every(u => u.k === 1), 'call flags and WebRTC signalling relay work');
    const np = await client('T2', ''); await sleep(100); ok(np.last('denied'), 'joining without a name is refused');
    const p1 = await client('SEC', 'Owner', '&p=secret1'); await sleep(100); const bad = await client('SEC', 'Intruder', '&p=nope'); await sleep(100);
    ok(bad.last('denied') && bad.last('denied').why.includes('password'), 'wrong room password is refused');
    const good = await client('SEC', 'Friend', '&p=secret1'); await sleep(100); ok(good.last('init') && good.last('init').prot === 1, 'right password gets in and room is marked protected');
    for (let i = 0; i < 9; i++) await client('SEC', 'Brute' + i, '&p=guess' + i); const blocked = await client('SEC', 'Brute', '&p=secret1'); await sleep(100);
    ok(blocked.last('denied') && blocked.last('denied').why.includes('Too many'), 'repeated wrong passwords are rate-limited');
    const http = await fetch(`http://127.0.0.1:${PORT}/healthz`).then(r => r.json()); ok(http.ok, 'health check answers');
    const ice = await fetch(`http://127.0.0.1:${PORT}/api/ice`).then(r => r.json()); ok(Array.isArray(ice.iceServers), 'ICE config endpoint answers');
    const mf = await fetch(`http://127.0.0.1:${PORT}/manifest.webmanifest`); ok(mf.ok, 'PWA manifest is served');
  } catch (e) { fail++; console.log('  ERROR ', e); }
  srv.kill(); console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
})();

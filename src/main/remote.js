'use strict';
/*
 * EventDJ – Fernsteuerung per HTTP
 *
 * Für Elgato Stream Deck (z. B. Plugin "API Ninja" / "Web Requests"), Bitfocus Companion
 * oder ein Tablet/Handy im Browser. Standard: nur auf diesem PC erreichbar (127.0.0.1).
 *
 *   GET /                     Fernbedienungs-Seite (Buttons aller Kacheln)
 *   GET /api/state            Reiter, Kacheln, laufende Jingles (JSON)
 *   GET /api/toggle/<id>      wie Antippen der Kachel (Start bzw. Ausblenden)
 *   GET /api/play/<id>        Kachel starten
 *   GET /api/stop/<id>        Kachel ausblenden
 *   GET /api/next/<id>        Playlist: nächster Titel
 *   GET /api/key/<hotkey>     Kachel mit diesem Tastenkürzel auslösen (z. B. F1, Shift+A)
 *   GET /api/fade             alles ausblenden
 *   GET /api/stopall          sofort alles stoppen
 *   GET /api/tab/<nr>         Reiter wechseln (1, 2, 3 …)
 *   GET /api/reset            alle Zähler zurücksetzen
 */
const http = require('http');
const os = require('os');

let server = null;
let current = { enabled: false, port: 0, lan: false };
let state = { tabs: [], playing: [] };
let sendCommand = () => {};

function setCommandHandler(fn) { sendCommand = fn; }
function setState(s) { state = s || state; }

function lanAddresses() {
  const out = [];
  Object.values(os.networkInterfaces()).forEach((list) =>
    (list || []).forEach((a) => { if (a.family === 'IPv4' && !a.internal) out.push(a.address); })
  );
  return out;
}

function json(res, code, data) {
  const body = JSON.stringify(data);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function remotePage() {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>EventDJ Fernbedienung</title>
<style>
body{margin:0;font-family:"Segoe UI",system-ui,sans-serif;background:#0e1117;color:#e9edf4}
header{display:flex;gap:8px;padding:10px;position:sticky;top:0;background:#161a23;flex-wrap:wrap;z-index:2}
header button{min-height:48px;border-radius:12px;border:1px solid #2a3142;background:#1d2230;color:#fff;font-size:16px;font-weight:700;padding:0 16px}
header .stop{background:#e5383b;border-color:#e5383b}
nav{display:flex;gap:6px;overflow-x:auto;padding:8px 10px}
nav button{min-height:44px;border-radius:10px;border:none;padding:0 14px;font-weight:700;font-size:15px;color:#fff;opacity:.6}
nav button.on{opacity:1;outline:2px solid #fff}
main{display:grid;gap:8px;padding:10px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr))}
.t{min-height:96px;border-radius:14px;border:none;font-size:18px;font-weight:800;padding:10px;position:relative}
.t.p{box-shadow:0 0 0 4px #fff}
.t small{position:absolute;left:8px;top:6px;font-size:12px;opacity:.75}
</style></head><body>
<header><button onclick="api('fade')">Ausblenden</button><button class="stop" onclick="api('stopall')">STOP</button></header>
<nav id="nav"></nav><main id="grid"></main>
<script>
let st={tabs:[],playing:[]},cur=0;
function api(p){fetch('/api/'+p).then(load)}
function load(){fetch('/api/state').then(r=>r.json()).then(s=>{st=s;draw()}).catch(()=>{})}
function draw(){
 const nav=document.getElementById('nav');nav.innerHTML='';
 st.tabs.forEach((t,i)=>{const b=document.createElement('button');b.textContent=t.name;b.style.background=t.color;if(i===cur)b.className='on';b.onclick=()=>{cur=i;draw()};nav.appendChild(b)});
 const g=document.getElementById('grid');g.innerHTML='';
 const tab=st.tabs[cur];if(!tab)return;
 tab.tiles.forEach(t=>{const b=document.createElement('button');b.className='t'+(st.playing.includes(t.id)?' p':'');
  b.style.background=t.bg;b.style.color=t.fg;b.innerHTML='<small>'+t.playCount+'×</small>';b.append(t.title);
  b.onclick=()=>api('toggle/'+encodeURIComponent(t.id));g.appendChild(b)})
}
load();setInterval(load,1000);
</script></body></html>`;
}

function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST' });
    return res.end();
  }
  if (!parts.length) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(remotePage());
  }
  if (parts[0] !== 'api') return json(res, 404, { ok: false, error: 'Unbekannter Pfad' });
  const cmd = parts[1] || '';
  const arg = parts.slice(2).join('/');
  const tileExists = (id) => state.tabs.some((t) => t.tiles.some((x) => x.id === id));

  switch (cmd) {
    case 'state':
      return json(res, 200, state);
    case 'toggle':
    case 'play':
    case 'stop':
    case 'next':
      if (!tileExists(arg)) return json(res, 404, { ok: false, error: 'Kachel nicht gefunden: ' + arg });
      sendCommand({ cmd, id: arg });
      return json(res, 200, { ok: true });
    case 'key':
      sendCommand({ cmd: 'key', key: arg });
      return json(res, 200, { ok: true });
    case 'tab': {
      const n = Number(arg);
      if (!(n >= 1 && n <= state.tabs.length)) return json(res, 404, { ok: false, error: 'Reiter nicht gefunden' });
      sendCommand({ cmd: 'tab', index: n - 1 });
      return json(res, 200, { ok: true });
    }
    case 'fade':
    case 'stopall':
    case 'reset':
      sendCommand({ cmd });
      return json(res, 200, { ok: true });
    default:
      return json(res, 404, { ok: false, error: 'Unbekannter Befehl: ' + cmd });
  }
}

function stop() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    const s = server;
    server = null;
    s.close(() => resolve());
    setTimeout(resolve, 500);
  });
}

/** Server gemäß Einstellungen starten/stoppen */
async function configure(opts) {
  opts = opts || {};
  const next = { enabled: !!opts.enabled, port: Number(opts.port) || 8765, lan: !!opts.lan };
  if (server && next.enabled && next.port === current.port && next.lan === current.lan) return info();
  await stop();
  current = next;
  if (!next.enabled) return info();
  return new Promise((resolve) => {
    const s = http.createServer(handle);
    s.on('error', (err) => {
      server = null;
      resolve(Object.assign(info(), { ok: false, error: err.code === 'EADDRINUSE' ? 'Port ' + next.port + ' ist bereits belegt' : String(err.message || err) }));
    });
    s.listen(next.port, next.lan ? '0.0.0.0' : '127.0.0.1', () => {
      server = s;
      resolve(info());
    });
  });
}

function info() {
  const urls = [];
  if (server) {
    urls.push('http://localhost:' + current.port + '/');
    if (current.lan) lanAddresses().forEach((a) => urls.push('http://' + a + ':' + current.port + '/'));
  }
  return { ok: true, running: !!server, port: current.port, lan: current.lan, urls };
}

module.exports = { configure, setState, setCommandHandler, info, stop, _handle: handle, esc };

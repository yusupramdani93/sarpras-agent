// Mock API for testing extension sync without touching production.
// Run: node dev/mock-api.js  -> http://localhost:8787
const http = require('http');
const fs = require('fs');
const path = require('path');

const STORE = path.join(__dirname, 'received');
if (!fs.existsSync(STORE)) fs.mkdirSync(STORE, { recursive: true });

const received = {};

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-API-Key' }); res.end(); return; }
  const url = new URL(req.url, 'http://localhost:8787');
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    let json = {};
    try { json = body ? JSON.parse(body) : {}; } catch (e) {}
    console.log(req.method, url.pathname, 'rows=', Array.isArray(json.rows) ? json.rows.length : (json ? 1 : 0));
    if (req.method === 'POST' && url.pathname.startsWith('/api/agent/bulk/')) {
      const table = url.pathname.split('/').pop();
      received[table] = received[table] || [];
      received[table].push(...(json.rows || []));
      fs.writeFileSync(path.join(STORE, table + '.json'), JSON.stringify(received[table], null, 2));
      send(res, 200, { success: true, count: (json.rows || []).length, skipped: 0 });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/agent/sekolah') {
      received.sekolah = json; fs.writeFileSync(path.join(STORE, 'sekolah.json'), JSON.stringify(json, null, 2));
      send(res, 200, { success: true }); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/agent/akun') {
      received.akun = json; fs.writeFileSync(path.join(STORE, 'akun.json'), JSON.stringify(json, null, 2));
      send(res, 200, { success: true }); return;
    }
    send(res, 404, { success: false, message: 'unknown route' });
  });
});

server.listen(8787, () => console.log('Mock API listening on http://localhost:8787'));
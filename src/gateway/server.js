'use strict';
const http = require('node:http');
const fs = require('node:fs');
const { runtime } = require('./runtime');
const { FileStore } = require('../storage/file');
const { LIMITS } = require('../core/ledger');
function createServer(handle) {
  return http.createServer((req, res) => {
    const send = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(value));
    };
    if (req.url !== '/gateway' || req.method !== 'POST') { req.resume(); send(404, { ok: false, code: 'NOT_FOUND' }); return; }
    if (!(req.headers['content-type'] || '').startsWith('application/json')) { req.resume(); send(415, { ok: false, code: 'JSON_REQUIRED' }); return; }
    let chunks = [], bytes = 0, over = false;
    req.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > LIMITS.payload) {
        if (!over) send(413, { ok: false, code: 'PAYLOAD_TOO_LARGE' });
        over = true; chunks = []; return;
      }
      if (!over) chunks.push(chunk);
    });
    req.on('end', () => {
      if (over) return;
      let envelope;
      try { envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { send(400, { ok: false, code: 'INVALID_JSON' }); return; }
      const result = handle(envelope);
      const status = result.ok ? 200 : result.code === 'UNAUTHORIZED' ? 401 : result.code === 'FORBIDDEN' ? 403 :
        ['VERSION_CONFLICT', 'OPERATION_ID_REUSED', 'OUT_OF_BAND_EDIT'].includes(result.code) ? 409 :
          ['STORE_UNAVAILABLE', 'READ_BACK_FAILED', 'BUSY'].includes(result.code) ? 503 : 400;
      send(status, result);
    });
    req.on('error', () => { if (!res.headersSent) send(400, { ok: false, code: 'INVALID_REQUEST' }); });
  });
}
if (require.main === module) {
  try {
    const principals = JSON.parse(process.env.HIVEMIND_PRINCIPALS_FILE ?
      fs.readFileSync(process.env.HIVEMIND_PRINCIPALS_FILE, 'utf8') : process.env.HIVEMIND_PRINCIPALS || 'null');
    const handle = runtime(new FileStore(process.env.HIVEMIND_DATA_DIR || '.runtime'), principals);
    const server = createServer(handle);
    server.on('error', () => { console.error('Gateway could not listen; no credentials logged.'); process.exitCode = 1; });
    server.requestTimeout = 10000; server.headersTimeout = 5000;
    server.listen(Number(process.env.PORT || 8787), '127.0.0.1', () => console.log('BLUE KITE local gateway: http://127.0.0.1:' + server.address().port + '/gateway'));
  } catch { console.error('Startup failed. Check principal configuration and store lock; no secrets logged.'); process.exitCode = 1; }
}
module.exports = { createServer };

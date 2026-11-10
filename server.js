'use strict';
/**
 * binance-relay — minimal forward proxy for already-signed Binance API requests.
 *
 * The trading space keeps the API key + secret and does the HMAC-SHA256 signing
 * itself. This relay only forwards the already-signed HTTPS request to
 * https://api.binance.com and returns the response verbatim.
 *
 * Security rules (deliberate):
 * - It NEVER sees, logs, or stores API keys, secrets, signatures, or bodies.
 *   Logs contain only method + pathname (no query string: the query carries
 *   the signature) + response status.
 * - It only forwards to the hardcoded host api.binance.com, and only for
 *   /api/* and /sapi/* paths.
 * - No auth is enforced here: this is a TEST relay. Before using it with real
 *   funds, lock it down (e.g. a shared-secret header checked here, or an IP
 *   allowlist) and whitelist the relay's static IP on the Binance API key.
 */
const http = require('http');
const https = require('https');

const PORT = parseInt(process.env.PORT || '3000', 10);
const TARGET_HOST = 'api.binance.com';
const MAX_BODY_BYTES = 1024 * 1024; // 1 MB
const TIMEOUT_MS = 15000;

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'trailers',
]);

// Log only method + pathname + status. NEVER the query string (signature),
// headers (X-MBX-APIKEY), or body.
function logSafe(method, pathname, status) {
  console.log(JSON.stringify({ t: new Date().toISOString(), method, path: pathname, status }));
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function handleForward(req, res) {
  // req.url is the raw path + query string; forward it verbatim so the
  // signature stays valid. Validate only the pathname part.
  const rawUrl = req.url || '/';
  const pathname = rawUrl.split('?')[0];
  if (!(pathname.startsWith('/api/') || pathname.startsWith('/sapi/'))) {
    sendJson(res, 404, { error: 'not_found' });
    logSafe(req.method, pathname, 404);
    return;
  }

  const chunks = [];
  let size = 0;
  let aborted = false;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      aborted = true;
      req.destroy();
      sendJson(res, 413, { error: 'body_too_large' });
      logSafe(req.method, pathname, 413);
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (aborted) return;
    const body = chunks.length ? Buffer.concat(chunks) : null;

    const headers = {};
    for (const [name, value] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(name.toLowerCase())) headers[name] = value;
    }
    headers.host = TARGET_HOST;
    if (body) headers['content-length'] = String(body.length);

    const upstream = https.request(
      {
        hostname: TARGET_HOST,
        port: 443,
        path: rawUrl,
        method: req.method,
        headers,
        timeout: TIMEOUT_MS,
      },
      (upRes) => {
        const outHeaders = {};
        for (const [name, value] of Object.entries(upRes.headers)) {
          if (!HOP_BY_HOP.has(name.toLowerCase())) outHeaders[name] = value;
        }
        res.writeHead(upRes.statusCode, outHeaders);
        upRes.pipe(res);
        upRes.on('end', () => logSafe(req.method, pathname, upRes.statusCode));
      }
    );
    upstream.on('timeout', () => {
      upstream.destroy(new Error('upstream timeout'));
    });
    upstream.on('error', () => {
      if (!res.headersSent) sendJson(res, 502, { error: 'upstream_error' });
      logSafe(req.method, pathname, 502);
    });
    if (body) upstream.write(body);
    upstream.end();
  });
  req.on('error', () => {
    if (!res.headersSent) sendJson(res, 400, { error: 'bad_request' });
  });
}

const server = http.createServer((req, res) => {
  const pathname = (req.url || '/').split('?')[0];

  if (req.method === 'GET' && pathname === '/health') {
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === 'GET' && pathname === '/') {
    sendJson(res, 200, { service: 'binance-relay', ok: true, target: TARGET_HOST });
    return;
  }
  handleForward(req, res);
});

server.listen(PORT, () => {
  console.log(JSON.stringify({ t: new Date().toISOString(), msg: 'binance-relay listening', port: PORT, target: TARGET_HOST }));
});

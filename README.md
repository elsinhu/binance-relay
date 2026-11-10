# binance-relay

Minimal forward proxy for already-signed Binance API requests.

The trading space keeps the API key + secret and does the HMAC-SHA256 signing
itself. This relay only forwards the already-signed request to
`https://api.binance.com` and returns the response verbatim.

- It never sees, logs, or stores API keys, secrets, signatures, or bodies.
  Logs contain only method + pathname + response status (the query string
  carries the signature, so it is never logged).
- It only forwards to the hardcoded host `api.binance.com`, for `/api/*` and
  `/sapi/*` paths.
- `GET /health` returns `{"ok": true}`.

## Why it exists

Binance.com returns HTTP 451 ("Service unavailable from a restricted
location") for requests coming from US egress IPs. The trading space's server
egresses from the US, so its signed calls are rejected. A relay running in
Singapore (a Binance-allowed region) forwards the same signed requests and
Binance answers normally.

## Deploy (Render, free tier, Singapore)

1. Push this repo to GitHub (public).
2. In Render: New → Web Service → pick the repo (or paste its public URL).
3. Region: **Singapore**. Plan: **Free**. Build: `npm install`. Start: `npm start`.
   (Or deploy via the included `render.yaml` blueprint.)
4. Verify from the deployed relay:
   - `GET https://<your-relay>.onrender.com/health` → `{"ok": true}`
   - `GET https://<your-relay>.onrender.com/api/v3/ping` → `{}` with HTTP 200
     (not 451). If it returns 451, that host/region is no good.

## Before using it with real funds

- Lock the relay down (e.g. a shared-secret header, or an IP allowlist), and
  whitelist the relay's IP on the Binance API key.
- Keep the Binance key spot-trading-only, withdrawals disabled.

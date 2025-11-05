# Payment failure on physical iPhone (Expo Go): "TypeError: Network request failed"

## Summary

When attempting to "Add Money" from the iPhone (Expo Go) the client fails with:

```
Payment error: TypeError: Network request failed
```

The client calls the local payments endpoint (`POST /payments/create-payment-intent`) but the request never reaches the dev machine. The app shows a network-level failure (fetch failed), not an HTTP error.

## Environment

- Project: BountyExpo (branch: Newleaf)
- Client: Expo Go on iPhone (physical device)
- Dev machine: Windows (Wi‑Fi IP: 192.168.0.59)
- Local servers involved:
  - `server/index.js` — Stripe/payments proxy (intended for /payments/* on port 3001)
  - `api/server.js` — older API server (also binds port 3001 in some dev runs)
- .env: `server/.env` configured with STRIPE keys and SUPABASE keys (present locally)

## Steps to reproduce

1. Start the payments server: `node server/index.js` (or `npm run api` depending on scripts).
2. Start Expo, open the app in Expo Go on a physical iPhone connected to the same Wi‑Fi network.
3. Open Add Money and trigger the payment flow which calls `${API_BASE_URL}/payments/create-payment-intent`.
4. Observe the Expo error dialog: "Payment error: TypeError: Network request failed".

## Diagnostics collected so far

- Device screenshot: Expo error dialog showing the TypeError network failure.
- Dev machine IP (from `ipconfig`): `192.168.0.59`.
- Server prints that it is running on port 3001 (`BountyExpo Stripe Server running on port 3001`).
- `Test-NetConnection -ComputerName 192.168.0.59 -Port 3001` returned `TcpTestSucceeded : False` (connection refused from LAN IP).
- `api-requests.log` was tailed while the device triggered the request — no incoming request lines were recorded.
- Earlier there was an `EADDRINUSE` because another node process bound 3001; that process was stopped and the server restarted, but LAN connections still fail.

## Likely root causes

1. Device cannot reach the dev machine at the resolved host/port (firewall or network isolation).
2. Client resolves API base URL incorrectly (still using `localhost` on the device).
3. Server is bound only to loopback (or not listening correctly on LAN interface in the current run).
4. Guest/corporate Wi‑Fi blocking local client-to-host traffic.

## Immediate recommended actions / workarounds

1. Verify what the client resolves as API_BASE_URL in Expo logs. Look for a log line added by the app:

```
[client-config] Resolved API_BASE_URL -> http://192.168.0.59:3001
```

If it resolves to `localhost` or `127.0.0.1`, set `EXPO_PUBLIC_API_BASE_URL=http://192.168.0.59:3001` and restart Expo.

2. Allow inbound TCP 3001 on the dev machine (PowerShell Admin):

```powershell
New-NetFirewallRule -DisplayName "Allow Node 3001" -Direction Inbound -LocalPort 3001 -Protocol TCP -Action Allow -Profile Any
```

3. If firewall changes are not possible, use Expo Tunnel (`expo start --tunnel`) or an ngrok tunnel (`ngrok http 3001`) and point the client at the tunnel URL.

4. Confirm that `api-requests.log` receives a line when the device triggers the Add Money action. If no line appears, the request did not reach the host.

## Follow-ups (medium/long term)

- Add an unauthenticated /debug endpoint returning server.address() and listening interface to quickly verify reachability from devices.
- Improve startup checks and fail early if binding to the intended interface fails.
- Add integration tests exercising payments endpoint via a tunnel in CI.

## Acceptance criteria

- Device successfully reaches `/payments/create-payment-intent` and the server logs the incoming request.
- The client receives a 2xx or an expected auth-related 4xx response instead of a network-level fetch failure.

## Labels
bug, payments, network, expo, dev-environment

# Local network setup — running the dry run before any hosting decision

No hosting provider is chosen yet (`docs/deployment.md` stays accurate
but unused for now). This is how to run the real API on your Windows
laptop and reach it from a real phone/tablet on the same wifi, so
`docs/dry-run.md` can actually happen. Everything here is disposable —
none of it should still be running once the dry run is done.

## Before you start: the one finding that could have changed this plan

I checked whether anything this app needs is unavailable over plain
`http://` on a LAN IP (as opposed to `https://`, or `http://localhost`)
— browsers restrict a real, specific set of APIs to "secure contexts,"
and a LAN IP over plain HTTP does not qualify as one, only
`localhost`/`127.0.0.1` do. Checked against what this app actually calls,
not a generic list:

- **PIN hashing is unaffected.** `web/src/auth/pinHash.ts` hashes with
  Argon2id from `@noble/hashes` — pure JavaScript, no WebCrypto. The only
  browser crypto API it touches is `crypto.getRandomValues()` (for the
  salt), which has no secure-context requirement at all. `crypto.subtle`
  — the API that *does* require a secure context — is never called
  anywhere in `web/src`.
- **IndexedDB (Dexie) is unaffected.** It has no secure-context
  requirement; this is the API everything else in this app's
  offline-first design is actually built on.
- **`navigator.storage.persist()` is moot** — it does require a secure
  context, but grepping `web/src` end to end, this app never calls it at
  all today. Nothing changes by testing somewhere it wouldn't work.
- **The service worker does not register.** This is the one real gap.
  `ServiceWorkerContainer.register()` requires a secure context with no
  LAN-IP exception, and `vite-plugin-pwa`'s auto-injected registration
  script checks `'serviceWorker' in navigator` before calling it — so
  this fails silently (no crash, no error banner), it just never
  activates. Practically: no offline app-shell precache, and the app
  isn't installable as a PWA during this test.

**Net effect, checked against what `docs/dry-run.md` actually
exercises:** every scenario in it — booking, sync, the network-drop
scenarios, the conflict scenarios — happens with the page already
loaded, using IndexedDB and `fetch`, neither of which needs a secure
context. None of them test a cold start with zero network at all (opening
the browser fresh with no connectivity whatsoever), which is the one
thing the service worker specifically exists for. **Nothing in the
planned dry run is blocked.** The service-worker gap is real but
deferred, not a blocker — see docs/dry-run.md's own updated notes for
exactly where.

**If you want to test the service worker anyway**, before a real hosting
decision exists, two options, both extra setup this document doesn't
walk through: run [`mkcert`](https://github.com/FiloSottile/mkcert) to
create a locally-trusted certificate for your LAN IP and install its root
CA on the test phone too, or tunnel through a service like `ngrok`/
`cloudflared` for a real HTTPS URL. Both work; neither is needed for the
dry run as written.

## 1. Find your laptop's LAN IP

```
ipconfig
```

This lists every network adapter, not just the one you want. Look for
the block whose header matches your wifi adapter — usually
`Wireless LAN adapter Wi-Fi:` (sometimes `Wi-Fi 2` if you have more than
one wifi radio). Ignore blocks for `Ethernet adapter`, anything saying
`Bluetooth`, and anything virtual-sounding (`vEthernet`, `VirtualBox`,
`Hyper-V`, `WSL`) — those are real adapters on your machine but not the
one your phone is talking over.

**If more than one block looks wifi-shaped**, the right one is whichever
has a non-empty `Default Gateway` line matching your router (e.g.
`192.168.1.1`) — a disconnected or inactive adapter shows
`Media State . . . . . . . . . . . : Media disconnected` and no gateway
at all; skip it.

Note the `IPv4 Address` from the correct block — e.g. `192.168.1.42`.
That's `<LAN_IP>` for everything below.

## 2. Run the API bound to every interface, not just localhost

`php artisan serve`'s default only listens on `127.0.0.1` — invisible to
anything else on the network. From `api/`:

```
php artisan serve --host=0.0.0.0 --port=8000
```

Leave `APP_DEBUG=true` as `.env.example` already has it for local dev —
this is your own laptop, not the deployment this app will eventually run
on.

## 3. Build the web app pointed at your LAN IP, and serve the real build

**Use the production build (`pnpm build` + `pnpm preview`), not the dev
server (`pnpm dev`) — for two independent reasons:**
- A real clinic runs the built, deployed static bundle, never a dev
  server with hot-module-reload and unminified source — the dry run
  should exercise what actually ships.
- `vite-plugin-pwa` doesn't even register a service worker in dev mode
  by default (`devOptions.enabled` isn't set in `web/vite.config.ts`) —
  so `pnpm dev` couldn't test the PWA/offline-shell behavior even over
  HTTPS. The production build is the only one that includes it at all.

From `web/`, create `.env.local` (already gitignored — see
`web/.env.example`) with:

```
VITE_API_BASE_URL=http://<LAN_IP>:8000/api
```

This is read at **build time**, baked into the bundle — it has to be set
*before* building, and a new build is needed every time `<LAN_IP>`
changes (see "the LAN IP changes" below).

```
pnpm build
pnpm run preview -- --host 0.0.0.0 --port 4173
```

The web app is now at `http://<LAN_IP>:4173`.

## 4. Windows Firewall: one narrow rule, not a shutdown

Windows will likely prompt the first time something connects to a
newly-listening port; if it doesn't, or you dismissed it, inbound
connections from other devices can still be silently blocked. Add exactly
two rules, scoped to the **Private** network profile only (never Public,
never "any"):

```powershell
New-NetFirewallRule -DisplayName "Clintra dry run - API" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow -Profile Private
New-NetFirewallRule -DisplayName "Clintra dry run - Web" -Direction Inbound -Protocol TCP -LocalPort 4173 -Action Allow -Profile Private
```

If Windows considers your wifi network "Public" rather than "Private"
(common on a network you haven't explicitly told it to trust), a
Private-scoped rule won't help — check and fix that first: Settings →
Network & internet → Wi-Fi → (your network) → set **Network profile
type** to **Private**. Don't switch it to Public-allowed rules instead;
narrow the network's own trust level, not the firewall rule's scope.

**Remove both rules when the dry run is done:**

```powershell
Remove-NetFirewallRule -DisplayName "Clintra dry run - API"
Remove-NetFirewallRule -DisplayName "Clintra dry run - Web"
```

Do not disable Windows Firewall itself, on this profile or any other.

## 5. CORS: the exact value, including the port

`config/cors.php` matches origins exactly — scheme, host, *and* port all
have to match what the browser actually sends. In `api/.env`:

```
CORS_ALLOWED_ORIGINS=http://<LAN_IP>:4173
```

Using the same example IP: `CORS_ALLOWED_ORIGINS=http://192.168.1.42:4173`.
No trailing slash, no path. Restart `php artisan serve` after changing
`.env` — it's read at process start, not live.

## 6. Prove the phone can reach the API before trying the whole app

On the phone's browser, with the phone on the **same wifi** (not mobile
data — that's a different network entirely, and won't route to your
laptop's LAN IP at all):

```
http://<LAN_IP>:8000/api/health
```

Expect the plain JSON health response
(`{"status":"ok","time":"...","version":"..."}`). If this doesn't load:
check the phone is genuinely on the same wifi (not a "guest" network,
which most routers isolate from the main LAN by design), re-check
`<LAN_IP>` against step 1, and re-check the firewall rule/network profile
in step 4 before touching anything else. Only once this works, try
`http://<LAN_IP>:4173` for the actual app.

---

## Things that will actually break mid-test

**The LAN IP changes.** Most home/clinic routers reassign DHCP leases
periodically, or on laptop sleep/wake, or on reconnecting to the network.
**How to notice:** the app on the phone stops syncing (chip shows "شغّال
محلي" or "السيرفر مش راد" — see `docs/dry-run.md`'s scenario 13 — and
stays that way even though the laptop is clearly still running and the
wifi is fine), or the step-6 health check stops responding from the
phone specifically. **What to do:** re-run `ipconfig`, compare against
the IP you built with; if it changed, update `web/.env.local` and
`api/.env`'s `CORS_ALLOWED_ORIGINS`, rebuild the web app (step 3), and
restart the API (step 2). To avoid this entirely for the dry run's
duration, set a DHCP reservation for the laptop's MAC address in the
router's admin page (a static lease) — a one-time setup step, not
something to redo per session.

**Secure-context restrictions** — covered in full above ("Before you
start"). Summary: PIN hashing and all data/sync functionality are
unaffected; the service worker doesn't register, so no offline app-shell
precache and no PWA installability during this test. Not a blocker for
the planned scenarios.

**A stale build served from ordinary browser cache — not the service
worker specifically.** Since the service worker never registers on plain
HTTP + a LAN IP, it cannot itself go stale here; there is nothing to
clear on that front. The real risk is more mundane: the phone's regular
HTTP cache serving an old build after you rebuild with a new `<LAN_IP>`
baked in (step 3 has to happen again after every IP change — see above).
**How to clear it:** hard-refresh, or clear site data for the
`<LAN_IP>:4173` origin specifically (Chrome on Android: address bar → the
site info icon → "Site settings" → "Clear & reset"; Safari on iOS:
Settings → Safari → Advanced → Website Data → find the site → swipe to
delete). Simplest of all: use a private/incognito tab on the test phone
for the whole dry run — nothing to clear between sessions, ever.

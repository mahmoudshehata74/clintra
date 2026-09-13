# Deploying the API

Provider-neutral: this describes what any host must provide and which env
vars to set, not a specific platform's config file. No provider has been
chosen yet — nothing here is Heroku/Render/Railway/Fly-specific, though
the "trust every proxy" default in `bootstrap/app.php` (see "HTTPS and
reverse proxies" below) is written with that class of platform in mind and
may need narrowing once one is picked.

## What the host must provide

- **PHP 8.3+** with `pdo_pgsql`/`pgsql` extensions (`api/README.md`).
- **PostgreSQL 16+.** A single database is enough — there is no
  multi-database requirement, only multiple *roles* connecting to the same
  one (below).
- **The Postgres roles**, created once by a superuser before anything else
  runs: `clintra_owner`, `clintra_app`, `clintra_rls`,
  `clintra_provision`, `clintra_mint`, `clintra_register` — every one of
  these is required in production; only `clintra_fixtures` is excluded
  (test/local-only, must never exist in a production database at all).
  Exact `CREATE ROLE`/`GRANT` statements are in `api/README.md`'s
  "Database setup" — this document doesn't repeat them, since they're
  literal SQL to run once, not something to translate into deployment
  config.
- **A way to run one-off commands against the database** — for the
  migration step and for `php artisan clintra:provision`/
  `clintra:mint-activation-code`/`clintra:revoke-device` afterward. These
  are CLI-only by design (`api/docs/rls.md`'s "One role per provisioning
  function") — nothing about them needs to be reachable over HTTP.

## Migrations: a separate step, with credentials the running app never sees

`php artisan migrate --database=pgsql_owner` needs `clintra_owner`
credentials — the role that owns every table and can create/alter them.
The **running web process never needs this role for anything**: every
request-time query goes through the default `pgsql` connection,
authenticated as `clintra_app`, which owns nothing and is fully
RLS-bound (`api/docs/rls.md`'s "The two-role model"). Confirmed directly,
not assumed: `grep`ing `app/Http` and `app/Support/Sync` for any
`DB::connection('pgsql_owner')` call outside the three CLI commands turns
up nothing — no controller, middleware, or request-time code path ever
touches that connection.

**The practical implication for a deployment pipeline:** run migrations
as a distinct step — a release-phase hook, a one-off job, or a manual
command — that has `DB_OWNER_USERNAME`/`DB_OWNER_PASSWORD` in its
environment, then never again. The long-running app process (the one
actually serving `/api/*` traffic) should be configured with only
`DB_USERNAME=clintra_app`/`DB_APP_PASSWORD` — it has no legitimate reason
to ever hold owner credentials, and not giving them to it means a bug or
compromise in the request-handling process can't reach them either. Most
platforms with a "release phase"/"pre-deploy command" concept (distinct
from the long-running dyno/service/task) are built for exactly this
split; the specific mechanism depends on whichever host is chosen, but
the shape — migrate once, with owner creds, from a process the public
internet never talks to — doesn't.

## Environment variables

**Application:**
- `APP_KEY` — generate with `php artisan key:generate`, once per
  environment; never share a key across environments.
- `APP_ENV=production`
- `APP_DEBUG=false` — **required.** With this set, the global exception
  handler (`bootstrap/app.php`) never includes an exception's message,
  only a fixed generic Arabic string; confirmed by
  `tests/Feature/ErrorHandling/GenericErrorResponseTest.php`, which
  forces a real uncaught exception and asserts the response contains
  neither the exception's own message, a class name, a file path, nor
  "SQLSTATE". `.env.example`'s `APP_DEBUG=true` is a *local dev* default
  only — it must not reach a real deployment.
- `APP_URL` — the API's own public URL.

**Database (the running app's own connection only — see above for why
owner credentials don't belong here at all):**
- `DB_CONNECTION=pgsql`, `DB_HOST`, `DB_PORT`, `DB_DATABASE`
- `DB_USERNAME=clintra_app`, `DB_APP_PASSWORD`

**CORS:**
- `CORS_ALLOWED_ORIGINS` — comma-separated, the deployed web app's real
  origin(s). `http://localhost:5173`/`http://127.0.0.1:5173` are always
  allowed in addition, for local frontend development against a real
  deployed API — see `config/cors.php`.

**Not a backend variable, but easy to reach for out of habit:**
`VITE_API_BASE_URL` is read at *web app build time* (`web/.env.example`),
never by this API. Setting it here does nothing.

## HTTPS and reverse proxies

This API is expected to sit behind a TLS-terminating proxy or load
balancer on every realistic host — it does not terminate TLS itself.
`bootstrap/app.php` sets `trustProxies(at: '*')`, so `$request->ip()`,
`$request->isSecure()`, and URL generation all correctly reflect the
original client via `X-Forwarded-*` headers rather than the proxy's own.

**Why this matters concretely, not just in principle:** without it,
`$request->ip()` returns the proxy's address for *every* request. The
`register` (unauthenticated) rate limiter is IP-keyed
(`App\Http\Controllers\DeviceRegistrationController`) and the `sync`
limiter falls back to IP when no bearer token is present
(`App\Providers\AppServiceProvider`) — both would silently collapse into
one shared bucket for all traffic through that proxy, rather than one per
real client, if the proxy weren't trusted.

**`'*'` (trust every hop) is a decision, not a default to leave
unexamined.** It's Laravel's own documented recommendation for platforms
whose edge IPs aren't fixed or published (Heroku, Render, Railway, Fly) —
correct specifically because the app process on those platforms is never
reachable except through that platform's own front door. Once a specific
host is chosen: if it publishes a stable proxy IP range, narrow this to
that range instead of `'*'`; if the app could ever be reached directly
(bypassing the platform's proxy), `'*'` would let a direct caller spoof
`X-Forwarded-For` and forge its own rate-limit identity.

## Rate limiting

- **`POST /api/devices/register`** (no auth — the phone + activation code
  it verifies *is* the credential): rate-limited inside the controller
  itself, dual-keyed by IP and by the submitted activation code, 5
  failures per 15 minutes, cleared on success. Not a `throttle:`
  middleware — see `routes/api.php`'s comment on that route for why
  stacking one on top would risk shadowing this endpoint's own, more
  specific `429` response.
- **`POST /api/sync/push`, `GET /api/sync/pull`, `GET /api/sync/bootstrap`**
  (all authenticated): `throttle:sync`, 120 requests/minute, keyed by the
  bearer token — not IP, deliberately: a clinic's several tablets
  typically share one public IP, and IP-keying would let one device
  exhaust a budget shared with every other device in the same office. 120
  is well above steady-state traffic (`web/src/sync/engine.ts`'s
  10-second cycle is roughly 12 requests/minute per device even under
  constant activity) while still bounding a malfunctioning or malicious
  client.

## Region: round-trip latency matters here specifically

Clinics run this app in Egypt. The sync engine cycles every 10 seconds
per device (`web/src/sync/engine.ts`) and the app is explicitly
offline-first *because* real clinic connections are unreliable — every
extra hundred milliseconds of round-trip latency is added to every one of
those cycles, on connections that are already the weak link.

Most major cloud providers don't offer an Egypt or wider-MENA region
directly. The practical recommendation: host the API (and its Postgres
instance — keep them in the *same* region, since the app makes many
small queries per request rather than one, and cross-region DB latency
multiplies that) in whichever available region is geographically closest
to Egypt — typically Europe (e.g. a provider's `eu-west`/Frankfurt/Paris/
London region) rather than that provider's default US region, or a
MENA-adjacent region (e.g. Bahrain/UAE) if the chosen provider offers
one. This is a real, measurable latency difference for every sync cycle,
not a rounding error — worth weighing over a marginally cheaper
US-region price on the same provider.

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

## Backups

This is patient and billing data. There is no backup mechanism built
into this app — it depends entirely on the host's Postgres backup
capability, which must be turned on and verified before any clinic goes
live, not after.

**What must be backed up:** the Postgres database itself (a `pg_dump`,
or your host's managed continuous-backup/point-in-time-recovery feature
if it offers one — either captures every table, every row, every RLS
policy and function this schema defines).

**What is *not* in that backup, and must be recorded separately, or a
restored database is useless:**
- **The six Postgres roles** (`clintra_owner`, `clintra_app`,
  `clintra_rls`, `clintra_provision`, `clintra_mint`,
  `clintra_register`) and their passwords. Roles are cluster-level
  objects in Postgres, not part of any one database — a `pg_dump` of the
  `clintra` database contains tables *owned by* `clintra_owner` and
  policies that reference `clintra_app`/`clintra_rls` by name, but not
  the roles themselves. Restore the dump onto a Postgres server that
  doesn't already have these roles, and every `ALTER TABLE ... OWNER TO
  clintra_owner` and every grant in the dump fails outright. Keep the
  exact `CREATE ROLE`/`GRANT` statements (`api/README.md`'s "Database
  setup") and the passwords used for them in your password manager or
  secrets store — not only in the live host's env vars, which a database
  disaster doesn't necessarily take down along with the database, but a
  *host* disaster (losing the account, the project, the host itself)
  would.
- **`APP_KEY`.** Record it alongside the role passwords. Losing it
  doesn't corrupt the database, but a restored deployment running with a
  *different* key than the one that was live isn't simply "back to
  normal" — treat it as part of the same recovery bundle, not an
  afterthought.

**Frequency and retention — recommendation for a single-clinic
deployment:** daily automated backups, retained 30 days, plus
point-in-time recovery for the last 7 days if your host offers it
(common in managed Postgres — check before assuming it isn't available).
Daily bounds the worst case to "at most one business day," which matches
how this app is actually used (a clinic's working hours, not a
continuously-transacting system); PITR, where available, shrinks that
further toward the moment of failure at effectively no added cost since
it's usually a checkbox on an already-managed database, not a separate
system to run.

**Where backups live:** not in the same failure domain as the database —
not on the same host, not solely in the same availability zone, ideally
not even the same cloud region. A managed host's "automated backups"
feature that stores snapshots on the *same* underlying storage/region as
the live database protects against accidental deletion or a bad
migration, but not against a regional outage or the loss of that hosting
account entirely. If the chosen host's backup feature doesn't clearly
state where backups are stored relative to the primary, ask before
relying on it — this is exactly the kind of thing that looks fine until
the one day it doesn't.

**How to test a restore — do this now, and again after any real schema
change, not only when something has already gone wrong:**
1. Provision a scratch Postgres instance (a throwaway database server,
   not a database on the *same* server the real one lives on).
2. Run `api/README.md`'s full role-creation SQL against it —
   `clintra_owner` through `clintra_register` (not `clintra_fixtures`;
   see "Production role and database hygiene" below for why that one
   must never exist here either).
3. Restore the backup into it (`pg_restore`/`psql < dump.sql`, matching
   whatever `pg_dump` format was used to create it).
4. Point a throwaway copy of the app's `.env` at this scratch database
   (real `DB_HOST`, same `DB_USERNAME=clintra_app`/`DB_APP_PASSWORD` you
   just recreated) and run `php artisan migrate:status --database=pgsql_owner`
   — it should show every migration already `Ran`, not pending, proving
   the restored schema is actually current, not a stale snapshot from
   before the last few migrations.
5. Hit `/api/health` against this scratch deployment, then a real
   membership-scoped read (`/api/isolation-probe` with a real device
   token minted against this restored data, or simplest: run
   `php artisan clintra:mint-activation-code {org_id} {location_id}`
   against it and confirm it succeeds) — proving the restored data is
   genuinely queryable through the real RLS-bound connection, not just
   present as bytes on disk.
6. Tear the scratch instance down once confirmed.

**An untested backup is not a backup.** A `pg_dump` that was never
restored is a file whose readability, completeness, and compatibility
with the *current* role/schema state are all unverified assumptions —
run the above quarterly at minimum, and immediately after any migration
that changes role grants or ownership (exactly the class of change this
project's own `docs/rls.md` "migrate:fresh is idempotent, not just
re-runnable" section is about).

**What data loss looks like, in clinic terms, at each frequency:**

| Backup frequency | Worst-case loss |
|---|---|
| Daily | Up to one business day's bookings, arrivals, completions, invoices, and payments — everything entered since the previous night's backup. |
| Every 6 hours | Up to half a clinic's working day. |
| Point-in-time recovery (if available) | Typically minutes — whatever wasn't yet flushed to the backup stream at the moment of failure. |
| Weekly (not recommended here) | An entire week of patient records and revenue — for a clinic depending on this system daily, this is a real operational and financial loss, not a rounding error. |

**Egyptian legal requirements on patient record retention — flagged, not
guessed.** I don't have reliable, current, verifiable information on
what Egyptian law specifically requires for medical/patient record
retention periods, handling, or cross-border storage (the relevant areas
are likely Egypt's data protection law and Ministry of Health medical
records regulations, but I cannot confirm specifics, current-in-force
status, or exact retention durations from what I have, and stating a
number here would be a guess dressed as a fact). **This needs a real
legal check before this system holds live patient data** — specifically
whether there's a minimum retention period for patient/billing records,
any requirement on where the data may be stored (e.g., data residency
inside Egypt), and any breach-notification obligation that would apply
if backups or the primary database were ever compromised. Please confirm
this with a lawyer familiar with Egyptian healthcare/data law before
launch; don't treat this document's silence on the topic as clearance.

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

**`'*'` (trust every hop) is a starting point, not a finished decision —
narrowing it is a required step before this deployment is complete, not
a suggestion to consider later.** It's Laravel's own documented default
for platforms whose edge IPs aren't fixed or published (Heroku, Render,
Railway, Fly), correct only on the specific assumption that the app
process is never reachable except through that platform's own front
door. **The deployment is not done until one of the following is true:**
either the chosen host publishes a stable proxy IP range and
`bootstrap/app.php`'s `trustProxies(at: '*')` has been narrowed to it, or
you have positively confirmed the app process cannot be reached by any
route that bypasses the platform's proxy (no public IP/port exposed
directly, no direct internal URL that skips the load balancer). Do not
ship on the assumption that it's probably fine.

**Why this is worth being this insistent about, concretely, not
abstractly:** if the app is ever directly reachable, a caller can send
any `X-Forwarded-For` value it likes on every request. `$request->ip()`
would then return whatever the caller claims, not their real address —
and the `register` endpoint's activation-code rate limiter
(`App\Http\Controllers\DeviceRegistrationController`) leans on IP for
exactly the half of its protection that matters against a real attacker:
its code-keyed half only ever limits repeated guesses at the *same*
activation code, which nobody actually brute-forcing distinct codes
would ever do — the IP-keyed half is what actually bounds "try many
different codes," and forged headers defeat it completely, turning every
guess into a fresh, unthrottled attempt. `App\Providers\AppServiceProvider`'s
`sync` limiter is keyed by bearer token, not IP, so it's unaffected by
this specific attack — but confirm that stays true if this limiter is
ever changed.

**Not silent, but not a hard failure either.**
`App\Support\TrustedProxyGuard`, called from `AppServiceProvider::boot()`,
logs a warning (at most once a day, never blocking a request or boot
itself) whenever `APP_ENV=production` and the trusted-proxy setting is
still the literal `'*'` — a deliberate diagnostic, not a gate, since this
must never be the reason a running clinic goes down. Seeing that warning
in production logs means this step was never completed; **its absence is
not proof it was** — the guard only fires when the setting is exactly
`'*'`, not when it's narrowed to a wrong-but-specific range, so an
operator's own confirmation is still what actually closes this out, not
the log staying quiet.

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
  Registration's own IP-keyed half is exactly what a directly-reachable
  deployment loses first — see "HTTPS and reverse proxies" above.

## Production role and database hygiene

**`clintra_fixtures` (a role) is already documented as production-excluded
— say it once more here because it's the one most likely to get copied
by habit:** so is **`clintra_test` (a database)**. Nothing about local
development's two-database setup (`clintra` for dev, `clintra_test` for
the test suite — `api/README.md`'s "Test database") belongs in a real
deployment. A production host needs exactly one database — whatever
`DB_DATABASE` names — migrated once, with no sibling `_test` database
sitting alongside it, and no `clintra_fixtures` role at all, ever. If a
setup script or infrastructure-as-code file was adapted from local
instructions, check it explicitly rather than assuming it was written
correctly the first time.

**Post-deploy verification checklist.** Run this once, right after the
very first deploy, and again after any change to roles, grants, or
environment variables:

1. **`clintra_fixtures` does not exist:**
   ```sql
   SELECT rolname FROM pg_roles WHERE rolname = 'clintra_fixtures';
   -- expect: 0 rows
   ```
2. **No `_test` database exists alongside the real one:**
   ```sql
   SELECT datname FROM pg_database WHERE datname LIKE '%test%';
   -- expect: 0 rows (or only databases you recognize as genuinely unrelated)
   ```
3. **The running app connects as `clintra_app`, never `clintra_owner`:**
   ```sql
   SELECT DISTINCT usename FROM pg_stat_activity WHERE datname = current_database();
   -- expect: clintra_app (plus your own psql session running this query);
   -- clintra_owner should appear only during an active migration run, never at rest
   ```
4. **`APP_DEBUG` is false:** trigger a real error state and confirm the
   response is the generic message, never a stack trace or SQLSTATE —
   e.g. `curl -i https://api.example.com/api/sync/pull` with no
   `Authorization` header and a deliberately malformed `cursor` query
   param, or simplest, confirm directly via whatever your host's
   environment-inspection tool shows for the running process (not just
   what's written in a `.env` file that may not be what actually got
   deployed).
5. **A request with no token is rejected, cleanly:**
   ```sh
   curl -i https://api.example.com/api/isolation-probe
   # expect: HTTP/1.1 401, body {"error":"unauthenticated","message":"..."}
   ```

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

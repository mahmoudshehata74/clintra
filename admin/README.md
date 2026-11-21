# Clintra platform administration

Separate Laravel 13 + Filament 4 panel. Arabic, RTL, Latin digits. The only
connection is `clintra_admin_app`, using `DB_ADMIN_APP_PASSWORD`. The application
has no Eloquent models and makes no table queries: authentication and every
read/write call a bound `platform.*` function. API migrations own the contract.
The panel never loads an API environment file. It needs no owner, clinic-app,
fixture or superuser password. Use an independent `APP_KEY` and domain.

## Local setup

Requirements: PHP 8.3+ with pdo_pgsql, intl, zip, mbstring, openssl; Composer;
the API database already migrated through 000059. Provision accounts only with
the API host's `clintra:admin:create` command. No panel migrations or sign-up.

```powershell
cd admin
composer install
Copy-Item .env.example .env
# Set DB_ADMIN_APP_PASSWORD to the panel role password, and DB_SSLMODE for this host.
php artisan key:generate
php artisan filament:assets
php artisan serve --host=127.0.0.1 --port=8001
```

Open `/panel/sign-in` at http://127.0.0.1:8001. This is separate from the API's
8000 and the clinic app's 5173. The original IBM Plex Sans Arabic font files
and their OFL license are self-hosted in `public/fonts/`. Published Filament
assets, caches, sessions, dependency locks and screenshots are generated locally
and ignored under the standing repository rule. The manifest pins direct PHP
package versions; install resolves their transitive constraints.

## Authentication and transport

The custom `platform` guard/provider resolves `admin_whoami` on each dynamic
panel request. The encrypted file session persists only `platform_session_id`
as authentication identity, plus Laravel's CSRF/flash/session metadata. Name,
email, initial-password state and secrets are never stored as session identity.
Unknown, idle, absolute-expired, ended and inactive-admin sessions go to sign-in.
Initial passwords permit only the standalone password page and sign-out. This
policy also applies to persistent Livewire middleware and page hydration.
There is no remember-me, password reset, sign-up or panel-side MFA verifier.
The database verifies password, TOTP and single-use recovery codes.

Sign-in regenerates the Laravel session. Cookies are host-only, HttpOnly,
SameSite=Strict and Secure except under APP_ENV=local. Sessions are encrypted at
rest. All state-changing routes use CSRF. The optional readable XSRF cookie is disabled;
native forms use hidden tokens and Livewire uses the page meta token. Every
issued cookie is therefore HttpOnly. The reusable native step-up dialog
collects a fresh TOTP for password change; recovery codes cannot satisfy it.
Passwords/codes are neither flashed nor placed into Livewire public state.
The fifth counted failure uses the database's `all_sessions_ended:true` result
and discards the browser session. SQL exceptions never propagate bound secrets
into the application's exception log.

Responses have CSP, frame-ancestors none, X-Frame-Options DENY, no-referrer,
noindex/nofollow, nosniff and no-store. Filament 4 / Livewire 3's Alpine runtime
requires inline/evaluated scripts; CSP permits these, restricts network/script
origins to self, disables objects and framing, and restricts form actions to self.

`ADMIN_IP_ALLOWLIST` is comma-separated CIDRs/IPs; empty is off. Denials are
plain 403. `ADMIN_TRUSTED_PROXIES` is an explicit comma-separated list; empty
trusts none and `*` is rejected. Never trust arbitrary forwarded headers.
Sign-in POST additionally permits 10 requests per IP in 15 minutes; Postgres's
5-failure email/IP budget remains authoritative. Its Arabic refusal is the
same as the database rate limit.

## Log view

Filters are admin UUID, clinic UUID, exact action and inclusive Cairo dates.
The default window is 30 days ending today; at most 366 days are accepted.
Page sizes 1, 25, 50, 100 are offered; the function accepts any integer 1–100.
The `before_seq` cursor is exclusive and remains a string for bigint precision.
“الأقدم” follows the keyset; “الأحدث” returns to the newest matching page.
The view escapes all values, including log detail. Filtering uses free-text UUIDs
because B3 exposes no table or account/clinic enumeration function.

## Tests

All tests target `clintra_test`. The panel assertions and HTTP app use only the
panel role. An explicit test-only API-side fixture CLI provisions unique accounts,
recovery codes, sessions and log rows and expires/retires them. That separate
process loads API `.env.testing`; the panel never receives its credentials.
The helper refuses any database except clintra_test. Immutable logs are retained.

Prepare the API test database using its documented role setup and migrations.
Create an ignored admin `.env.testing` with an independent key, `DB_DATABASE=clintra_test`,
`DB_ADMIN_APP_PASSWORD`, host/port and SSL mode, and no other database password.
For browser servers, the panel `.env` must also target clintra_test. Then:

```powershell
cd admin
php artisan test
pnpm run test:e2e
```

Playwright uses the existing `web/` dependency installation and Chromium. It runs
desktop 1280×900 and mobile 390×844 with one worker, no retries and no flaky passes.
Its three isolated servers use ports 8001–8003 to test allowlist off, denied and
allowed without a test HTTP backdoor. The main browser server explicitly trusts
loopback as its fixture proxy, giving each test an independent database/IP budget.
Screenshots go to ignored `web/e2e/admin-shots/b3-*.png`.

The gate is the existing sequential gate, followed by panel Pest and panel
Playwright. CI's separate admin job uses the same role-provisioning script and
runs after the build → e2e → API chain.

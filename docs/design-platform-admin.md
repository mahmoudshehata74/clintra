# Design: platform admin panel, organization disable, figures and support access

Status: B1 is merged in PR #69. B2 organization disable/enable is implemented
for review. The remaining phases are plans, to be reviewed before their migrations are written.

## 1. Goal

The Clintra team gets its own admin panel — a separate app on its own
domain, behind two-factor sign-in — to provision clinics, mint codes, revoke
devices, disable and re-enable an organization and see per-clinic counts and
money, with every action written to an append-only admin log. The panel
reaches the database only through `SECURITY DEFINER` functions owned by
dedicated NOLOGIN roles, never reads patient-identifying data, and sees a
clinic's records only through a read-only support device the clinic owner
authorises with a time-limited code.

## 2. Today

Everything the team does goes through CLI commands on the API host, as
`clintra_owner`: `clintra:provision`, `clintra:mint-activation-code`,
`clintra:revoke-device`, `clintra:clear-registration-lockout`
(`docs/deployment.md`). There is no way to stop an organization, no
cross-clinic view, no record of who on the team did what, and supporting a
clinic means asking the owner for their device.

## 3. The panel's stack

**A separate Laravel 13 app in `admin/` with Filament 4, deployed on its own
host and domain** (placeholder `admin.<clintra domain>`), connecting to the
clinic database as its own login role, `clintra_admin_app`, which holds
`EXECUTE` on the panel's functions and nothing else.

Why not Filament inside `api/`:

- **Blast radius.** The API is the internet-facing process that holds
  `clintra_app`'s credentials and every clinic's data path. Filament adds
  Livewire, a session-cookie login surface and a large component tree; inside
  `api/` a flaw in any of it runs with `clintra_app` and the API's
  `APP_KEY`. In its own app it runs with a role that can only call
  functions that themselves refuse without a live, 2FA-verified admin
  session.
- **The constraint already asks for a separate deployment and domain.**
  With one codebase, every API deploy would ship the panel's code and every
  panel change would redeploy the API; two apps keep releases, secrets
  (`APP_KEY`, database password) and network exposure apart — the panel can
  sit behind an IP allowlist the API cannot.
- **The contract is the database.** The two apps share no PHP: the panel
  calls `platform.*` functions, which are migrated from `api/` like every
  other database object. Nothing has to be duplicated except Laravel's
  skeleton.

Cost: a second app to keep updated. Filament gives tables, forms, the
action log view and its built-in app (TOTP) MFA, and Arabic RTL support,
for far less than a hand-built panel. The panel's own sessions and cache use
Redis or files, never the clinic database.

## 4. How it works

### 4.1 Signing in (online only)

Admin accounts are created only from the API host:
`php artisan clintra:admin:create {email} {name}` (as `clintra_owner`)
prints a one-time password and the TOTP enrolment URI once. The panel's
sign-in ("البريد الإلكتروني", "كلمة السر", "كود التحقق") calls
`platform.admin_login`, which checks the password (bcrypt via pgcrypto's
`crypt`, cost 12) **and** the 6-digit TOTP (RFC 6238, SHA-1, 30-second
step, ±1 step, a step never accepted twice) or one of ten single-use
recovery codes, inside Postgres. It creates a session (8 hours absolute, 30
minutes idle) and returns its id; Filament keeps it in its encrypted session
and passes it to every function. A compromised panel server therefore cannot
start a session of its own; it can only ride sessions that are live.

Every destructive call (provision, mint, approve, revoke, disable, enable,
open support) also takes a fresh TOTP code ("اكتب كود التحقق تاني"), checked
by the same function.

### 4.2 Every action through a function, every action logged

The panel never queries a table. Each action is one function, owned by a
role that holds exactly what that action touches, which first resolves the
admin from the session (`platform.admin_session_actor`), then acts, then
writes one `platform.admin_log` row in the same transaction. A refusal is
returned as `{ok: false, reason}` — not raised — so its log row commits
too. B2 and every later action function return logged validation refusals
without raising, preserving the log and any session termination. B1 auth
payload validation may raise (`22023`); the panel records that through
`platform.admin_log_refusal`. The CLI commands stay
as break-glass and log through `platform.admin_log_cli` with no admin user.

### 4.3 Disabling an organization

"إيقاف العيادة" (with "سبب الإيقاف", required, at most 200 characters)
sets `organizations.disabled_at`; "تشغيل العيادة" clears it. Nothing is
deleted or revoked. While disabled:

| Path | Returns |
|---|---|
| `POST /api/sync/push`, `GET /api/sync/pull`, `GET /api/sync/bootstrap`, `POST /api/audit/push`, `GET /api/audit/pull`, `POST /api/staff`, every `/api/auth/*` behind the token | `403 {"error": "org_disabled", "message": "حساب العيادة موقوف. كلّم فريق كلينترا."}`, from `ApplyMembership`, before any other work, once the token has verified (an invalid token is still the generic 401, so the 403 is no oracle) |
| `POST /api/devices/register` | the generic failure for every credential problem, as today; only once the code and phone **are** valid, `403 org_disabled` with the same body, and the code is not consumed |
| `POST /api/auth/owner-recovery` (identity design) | the same rule as registration |
| The database | `current_org()` returns null for a member of a disabled organization, so every policy reads zero rows: a request that slipped past the middleware writes and reads nothing |

The specific owner-recovery row takes precedence over the token-protected auth wildcard: invalid recovery credentials keep the existing generic failure and rate limits; only valid credentials reveal `org_disabled`, without consuming the code.

On the device: the sync engine stops on `org_disabled` (no retry loop; one
quiet check every 15 minutes, and on reconnect), and every screen shows a
banner that does not block work: "حساب العيادة موقوف مؤقتاً، والمزامنة
واقفة. اللي بتعمله على الجهاز ده متسجّل وهيتبعت أول ما الحساب يرجع. كلّم
فريق كلينترا." The queue is kept. A registration attempt shows "العيادة دي
حسابها موقوف. كلّم فريق كلينترا." When the organization is enabled, the
next check resumes sync and everything queued goes up as usual. Offline,
nothing changes: the device cannot know until it next reaches the server.

The disable function takes the organization's sync lock
(`pg_advisory_xact_lock(hashtextextended('sync_seq:' || org_id, 0))`), so
it waits for a push already running and no push starts until it commits:
no push is ever half applied by a disable landing in its middle.

### 4.4 Cross-clinic figures

"العيادات" lists every organization with, for a chosen period (at most
366 days): active locations, doctors, staff and devices; the last time any
of its devices synced; completed, cancelled and no-show visits; invoices
issued, billed and collected (piastres, shown as pounds). Only counts and
money, per organization: no patient, no name of a patient, no phone, no
clinical text, no row. The role behind it holds column grants on exactly
the columns those counts read (6.4), so the guarantee is structural, not a
promise of the query.

### 4.5 Support access

1. **The owner opens it.** Settings → "دعم كلينترا" → "إنشاء كود دعم"
   (online, owner only): "المدة" (ساعة / 24 ساعة / 72 ساعة), "الفرع",
   "يشمل البيانات الطبية" (off by default). The device calls
   `POST /api/support/codes`; the code is shown once: "كود الدعم: CLT-…
   — ابعته لفريق كلينترا بس، وبيخلص بعد 72 ساعة لو ماتستخدمش".
2. **Support redeems it in the panel.** "دخول دعم" → "كود الدعم" (with a
   fresh TOTP) calls `platform.admin_open_support_session`: the code must be
   a support code, unused and unexpired; a `device` row of kind `support` is
   created for the clinic, bound to the owner who made the code, expiring
   after the chosen duration, carrying the admin's name; an exchange code
   valid two minutes is returned and the panel opens the clinic app at
   `/#support=<exchange code>`.
3. **The clinic app swaps it once** (`POST /api/support/exchange`,
   `support_exchange`) for a device token whose abilities include
   `support:read-only`, and a bootstrap like registration's, without PIN
   hashes. The app runs in support mode: no PIN, no lock, every write
   control hidden, `mutate()` refusing with "جهاز الدعم للقراءة بس", a
   banner "جهاز دعم — قراءة بس — بينتهي {time}".
4. **The server refuses every write.** For a `support:read-only` token,
   `ApplyMembership` opens the request transaction with `SET TRANSACTION
   READ ONLY` (before `set_config`), so Postgres refuses any write in it
   (`25006`); the write routes (`/sync/push`, `/audit/push`, `/staff`,
   `/auth/*`, `/support/codes`) answer `403 {"error":
   "support_read_only", "message": "جهاز الدعم للقراءة بس، مفيش تغيير بيتحفظ
   منه"}` before any work. Without "يشمل البيانات الطبية", pull, bootstrap
   and audit pull leave out `visit_form_data`, `prescriptions` and
   `prescription_items` rows, null `visits.note`, and leave out device
   audit rows of those entities.
5. **It expires and is visible.** `device_exists()` treats a passed
   `expires_at` like a revoked device: the next request is 401 and the app
   wipes its local data and returns to the start screen (best effort: the
   wipe runs on the support machine). Every pull carries
   `support_sessions: [{device_id, admin_name, expires_at}]`, so every
   clinic device shows "فريق كلينترا عنده وصول للقراءة بس لحد {time}"; the
   owner sees it in Settings → "الأجهزة" as "جهاز دعم كلينترا — {name} —
   بينتهي {time}" with "إنهاء الدعم دلوقتي", which revokes it at once.

## 5. Threat model

| Attacker | Can | Cannot |
|---|---|---|
| **Stolen device** (a clinic tablet) | What the identity design says; nothing about the panel changes it. A stolen *support* machine: read the clinic as the support device allows until it expires or the owner or the team ends it. | Reach the panel: its accounts, sessions and functions have nothing to do with device tokens. Write anything from a support device: the transaction is read-only. |
| **Stolen token** | A stolen panel session cookie: act as that admin until the session's idle or absolute end — but only to view figures and the log, since every destructive function wants a fresh TOTP. A stolen support device token: read-only access until expiry (and, with the identity design, not even that without the device key). | Mint, revoke, disable, provision or open support without the TOTP. Extend a session past 8 hours. Use a clinic device token on the panel. |
| **Malicious staff member** (a clinic employee) | Nothing new: support codes are owner only. | See or redeem a support code without the owner; reach the panel; see the figures. |
| **Compromised admin account** (password and TOTP phished, or a team member gone bad) | Disable and enable organizations (a denial of service, logged, reversible); view every clinic's figures (business data); provision new organizations; request codes for an existing clinic; open support with a code the owner gave. | Read any patient, clinical text or phone: no role behind any function holds those columns. Mint a device or owner-recovery code for an existing clinic alone: a second admin must approve within an hour (open question 3), and the clinic's devices show "فريق كلينترا أصدر كود تفعيل جهاز جديد للعيادة في {time}". Write a clinic row except through the functions. Edit or delete the admin log: no role holds UPDATE or DELETE on it and a trigger refuses both, and TRUNCATE, for every role. Bypass 2FA: it is checked in the database, not by the panel. |
| **Compromised panel server** (code execution as `clintra_admin_app`) | Ride sessions live at that moment; capture passwords and TOTP codes as admins sign in and use them within the 30-second window. | Start a session without a real password and TOTP; call anything but the panel's functions (it holds no table privilege anywhere); read patient data (no function returns any). |

## 6. Planned statements

Roles are created outside migrations (`api/README.md`, `.github/workflows/ci.yml`),
like every other role. `clintra_admin_app` is the only new LOGIN role, and it
has no `BYPASSRLS`. Everything else is a migration in `api/` with a
`down()`.

### 6.1 Roles

```sql
CREATE ROLE clintra_admin_app LOGIN PASSWORD '<secret>' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
CREATE ROLE clintra_admin_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE clintra_admin_provision NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE clintra_admin_mint NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE clintra_admin_device NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
CREATE ROLE clintra_admin_org NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
CREATE ROLE clintra_admin_stats NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
CREATE ROLE clintra_admin_support NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
CREATE ROLE clintra_support NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
GRANT CONNECT ON DATABASE clintra TO clintra_admin_app;
ALTER ROLE clintra_admin_app SET log_parameter_max_length = 0;
ALTER ROLE clintra_admin_app SET log_parameter_max_length_on_error = 0;
```

Like every function-owner role, the eight NOLOGIN roles are granted to clintra_owner so migrations can create their functions under them; clintra_admin_app is granted to no one.

`clintra_admin_provision` and `clintra_admin_mint` need no bypass: they only
call the existing `provision_organization` and `mint_activation_code`,
which bypass as their own roles. The two `log_parameter_max_length`
settings keep a password bound to `admin_login` out of the server log.

### 6.2 The platform schema

pgcrypto lives in its own schema, platform_crypto, usable only by clintra_admin_auth: the extension's functions are owned by the bootstrap superuser with PUBLIC EXECUTE, which the migration owner cannot revoke, so schema USAGE is the gate.

`admin_log.org_id` references `organizations.id` with `ON DELETE RESTRICT`:
organizations are disabled, never deleted. The foreign key preserves the
organization attached to an administrative action.

New admin users have `must_change_password = true`. Successful sign-in
returns that boolean. Until it is cleared, every session action refuses
with `password_change_required`, except password change and logout.
`admin_change_password` requires `{session_id, current_password, otp,
password, log_id}`: the current password, a different new password and a
fresh TOTP. Success clears the flag and ends the admin's other sessions.
Wrong current passwords return and log `current_password_failed` and count
in the same per-admin budget as `step_up_failed`. An unchanged new password
returns `bad_credentials` and does not count. Neither consumes TOTP or
enters the login failure counter.

Session resolution is separate from step-up. Unknown, ended, expired or
idle sessions, and inactive admins, return `session_invalid` and log a
null admin. A wrong or reused TOTP returns `step_up_failed` and logs the
admin resolved from the valid session. A valid session blocked by its
initial-password flag logs that admin with `password_change_required`.
Public refusals remain `{ok: false, reason}`.

Five failed step-ups or current-password checks per admin in 15 minutes end all of that admin's
unended sessions in the same transaction as the fifth refusal's log row.
The counter reads failed log rows with `reason IN ('step_up_failed','current_password_failed')` in that
window; older rows do not count. The fifth refusal records
`detail.all_sessions_ended = true`. A later request through an ended
session returns `session_invalid`, even with a correct TOTP. Other admins'
sessions and budgets are unaffected.

```sql
CREATE SCHEMA platform AUTHORIZATION clintra_owner;
REVOKE ALL ON SCHEMA platform FROM PUBLIC;
CREATE SCHEMA platform_crypto AUTHORIZATION clintra_owner;
REVOKE ALL ON SCHEMA platform_crypto FROM PUBLIC;
GRANT USAGE ON SCHEMA platform_crypto TO clintra_admin_auth;
CREATE EXTENSION pgcrypto WITH SCHEMA platform_crypto;

CREATE TABLE platform.admin_users (
  id uuid PRIMARY KEY,
  email varchar(254) NOT NULL UNIQUE CHECK (email = lower(email)),
  name varchar(120) NOT NULL,
  password_hash text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  totp_secret bytea NOT NULL,
  last_totp_step bigint NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz NULL
);

CREATE TABLE platform.admin_recovery_codes (
  id uuid PRIMARY KEY,
  admin_user_id uuid NOT NULL REFERENCES platform.admin_users(id) ON DELETE RESTRICT,
  code_hash text NOT NULL,
  used_at timestamptz NULL,
  UNIQUE (admin_user_id, code_hash)
);

CREATE TABLE platform.admin_sessions (
  id uuid PRIMARY KEY,
  admin_user_id uuid NOT NULL REFERENCES platform.admin_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ended_at timestamptz NULL,
  ip inet NULL,
  user_agent varchar(400) NULL
);

CREATE TABLE platform.admin_log (
  seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  id uuid NOT NULL UNIQUE,
  at timestamptz NOT NULL DEFAULT now(),
  admin_user_id uuid NULL REFERENCES platform.admin_users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN (
    'admin.login', 'admin.logout', 'admin.password_change', 'figures.view', 'org.provision',
    'code.mint_request', 'code.mint_approve', 'device.revoke', 'org.disable', 'org.enable',
    'support.open', 'cli.provision', 'cli.mint', 'cli.revoke', 'cli.admin_create', 'cli.org_disable', 'cli.org_enable')),
  org_id uuid NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  target_id uuid NULL,
  succeeded boolean NOT NULL,
  reason text NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip inet NULL,
  user_agent varchar(400) NULL
);
CREATE INDEX admin_log_org ON platform.admin_log (org_id, seq);
CREATE INDEX admin_log_login_failures ON platform.admin_log (action, at) WHERE NOT succeeded;

CREATE TABLE platform.admin_approvals (
  id uuid PRIMARY KEY,
  action text NOT NULL CHECK (action IN ('code.mint')),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose IN ('device', 'owner_recovery')),
  requested_by uuid NOT NULL REFERENCES platform.admin_users(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  approved_by uuid NULL REFERENCES platform.admin_users(id) ON DELETE RESTRICT,
  approved_at timestamptz NULL,
  CHECK (approved_by IS NULL OR approved_by <> requested_by)
);

CREATE TABLE platform.support_exchanges (
  exchange_hash text PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES device(id) ON DELETE RESTRICT,
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL
);
```

The admin log is append-only for every role, the owner included — the same
trigger technique as the closed day (`api/docs/rls.md`):

```sql
CREATE FUNCTION platform.admin_log_refuse_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'admin_log is append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER admin_log_append_only BEFORE UPDATE OR DELETE ON platform.admin_log
  FOR EACH ROW EXECUTE FUNCTION platform.admin_log_refuse_change();
CREATE TRIGGER admin_log_no_truncate BEFORE TRUNCATE ON platform.admin_log
  FOR EACH STATEMENT EXECUTE FUNCTION platform.admin_log_refuse_change();
```

### 6.3 Clinic tables

```sql
ALTER TABLE organizations ADD COLUMN disabled_at timestamptz NULL;
ALTER TABLE organizations ADD COLUMN disabled_reason varchar(200) NULL;
ALTER TABLE organizations ADD CONSTRAINT organizations_disabled_reason
  CHECK (((disabled_at IS NULL) = (disabled_reason IS NULL))
    AND (disabled_reason IS NULL OR char_length(disabled_reason) BETWEEN 1 AND 200));

ALTER TABLE device ADD COLUMN kind text NOT NULL DEFAULT 'clinic' CHECK (kind IN ('clinic', 'support'));
ALTER TABLE device ADD COLUMN expires_at timestamptz NULL;
ALTER TABLE device ADD COLUMN include_clinical boolean NOT NULL DEFAULT true;
ALTER TABLE device ADD COLUMN support_admin_name varchar(120) NULL;
ALTER TABLE device ADD COLUMN support_code_id uuid NULL REFERENCES activation_codes(id) ON DELETE RESTRICT;
ALTER TABLE device ADD CONSTRAINT device_support_shape
  CHECK ((kind = 'support') = (expires_at IS NOT NULL AND support_admin_name IS NOT NULL AND support_code_id IS NOT NULL));

-- activation_codes.purpose comes from the identity design; if this lands first, it adds the column.
ALTER TABLE activation_codes DROP CONSTRAINT IF EXISTS activation_codes_purpose_check;
ALTER TABLE activation_codes ADD CONSTRAINT activation_codes_purpose_check
  CHECK (purpose IN ('device', 'owner_recovery', 'support'));
ALTER TABLE activation_codes ADD COLUMN support_hours smallint NULL CHECK (support_hours IN (1, 24, 72));
ALTER TABLE activation_codes ADD COLUMN include_clinical boolean NULL;
ALTER TABLE activation_codes ADD COLUMN created_by_membership_id uuid NULL REFERENCES memberships(id) ON DELETE RESTRICT;
ALTER TABLE activation_codes ADD CONSTRAINT activation_codes_support_shape
  CHECK ((purpose = 'support') = (support_hours IS NOT NULL AND include_clinical IS NOT NULL AND created_by_membership_id IS NOT NULL));
```

`register_device` gains `AND purpose = 'device'` in its code lookup (a
support code never registers a clinic device) and, after the credential
checks pass:

```sql
IF EXISTS (SELECT 1 FROM organizations WHERE id = v_org_id AND disabled_at IS NOT NULL) THEN
  RAISE EXCEPTION 'register_device: organization disabled' USING ERRCODE = 'CL403';
END IF;
```

(`clintra_register` already holds table-level `SELECT` on `organizations`.)

The RLS helpers, recreated as `clintra_rls` with the existing idiom:

```sql
GRANT SELECT (id, disabled_at) ON organizations TO clintra_rls;
GRANT SELECT (id, org_id, revoked_at, expires_at) ON device TO clintra_rls;

CREATE OR REPLACE FUNCTION current_org() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT m.org_id FROM memberships m
    JOIN organizations o ON o.id = m.org_id
    WHERE m.id = current_membership() AND m.is_active = true AND o.disabled_at IS NULL
$$;

CREATE OR REPLACE FUNCTION device_exists(p_device_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM device WHERE id = p_device_id AND revoked_at IS NULL
                   AND (expires_at IS NULL OR expires_at > now()))
$$;

CREATE FUNCTION device_org_disabled(p_device_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM device d JOIN organizations o ON o.id = d.org_id
                   WHERE d.id = p_device_id AND d.revoked_at IS NULL AND o.disabled_at IS NOT NULL)
$$;
REVOKE EXECUTE ON FUNCTION device_org_disabled(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION device_org_disabled(uuid) TO clintra_app;
```

`ApplyMembership` calls `device_org_disabled` only after the token has
verified, so it answers nothing about a device the caller cannot prove.

### 6.4 Grants of the function roles

```sql
GRANT USAGE ON SCHEMA platform TO clintra_admin_app, clintra_admin_auth, clintra_admin_provision, clintra_admin_mint,
  clintra_admin_device, clintra_admin_org, clintra_admin_stats, clintra_admin_support;

-- sign-in, sessions, the log
GRANT SELECT ON platform.admin_users TO clintra_admin_auth;
GRANT UPDATE (last_totp_step, last_login_at, password_hash, must_change_password) ON platform.admin_users TO clintra_admin_auth;
GRANT SELECT ON platform.admin_recovery_codes TO clintra_admin_auth;
GRANT UPDATE (used_at) ON platform.admin_recovery_codes TO clintra_admin_auth;
GRANT SELECT, INSERT ON platform.admin_sessions TO clintra_admin_auth;
GRANT UPDATE (last_seen_at, ended_at) ON platform.admin_sessions TO clintra_admin_auth;
GRANT SELECT, INSERT ON platform.admin_log TO clintra_admin_auth;

-- provisioning and minting call the existing functions
GRANT EXECUTE ON FUNCTION provision_organization(jsonb) TO clintra_admin_provision;
GRANT EXECUTE ON FUNCTION mint_activation_code(jsonb) TO clintra_admin_mint;
GRANT SELECT, INSERT ON platform.admin_approvals TO clintra_admin_mint;
GRANT UPDATE (approved_by, approved_at) ON platform.admin_approvals TO clintra_admin_mint;

-- revoke a device
GRANT SELECT (id, org_id, revoked_at) ON device TO clintra_admin_device;
GRANT UPDATE (revoked_at) ON device TO clintra_admin_device;
GRANT SELECT (tokenable_type, tokenable_id), DELETE ON personal_access_tokens TO clintra_admin_device;

-- disable and enable
GRANT SELECT (id, disabled_at) ON organizations TO clintra_admin_org;
GRANT UPDATE (disabled_at, disabled_reason) ON organizations TO clintra_admin_org;
-- Credential-first owner recovery must check suspension under its own narrow role.
GRANT SELECT (disabled_at) ON organizations TO clintra_auth;

-- figures: exactly the columns the counts read, nothing identifying
GRANT SELECT (id, name, disabled_at) ON organizations TO clintra_admin_stats;
GRANT SELECT (org_id, name, is_active) ON locations TO clintra_admin_stats;
GRANT SELECT (org_id, is_active) ON practitioners TO clintra_admin_stats;
GRANT SELECT (org_id, is_active) ON memberships TO clintra_admin_stats;
GRANT SELECT (org_id, revoked_at, kind) ON device TO clintra_admin_stats;
GRANT SELECT (org_id, applied_at) ON sync_ledger TO clintra_admin_stats;
GRANT SELECT (org_id, visit_date, status) ON visits TO clintra_admin_stats;
GRANT SELECT (id, org_id, total, status, issued_at) ON invoices TO clintra_admin_stats;
GRANT SELECT (invoice_id, amount, created_at) ON payments TO clintra_admin_stats;

-- open a support session
GRANT SELECT (id, org_id, location_id, code_hash, expires_at, used_at, purpose, support_hours, include_clinical,
              created_by_membership_id) ON activation_codes TO clintra_admin_support;
GRANT UPDATE (used_at, used_by_device_id) ON activation_codes TO clintra_admin_support;
GRANT INSERT ON device TO clintra_admin_support;
GRANT INSERT ON platform.support_exchanges TO clintra_admin_support;
GRANT INSERT ON audit_log TO clintra_admin_support;

-- the clinic side of support: the owner's code and the swap
GRANT SELECT (id, org_id, role, is_active) ON memberships TO clintra_support;
GRANT SELECT (id, org_id) ON locations TO clintra_support;
GRANT INSERT ON activation_codes TO clintra_support;
GRANT SELECT, UPDATE (used_at) ON platform.support_exchanges TO clintra_support;
GRANT USAGE ON SCHEMA platform TO clintra_support;
GRANT SELECT (id, org_id, location_id, membership_id) ON device TO clintra_support;
GRANT INSERT ON audit_log TO clintra_support;
```

None of these roles holds any privilege on `patients`, `users` (beyond what
the identity design gives `clintra_auth`), `visit_form_data`,
`prescriptions`, `prescription_items`, `messages`, `message_templates`,
`care_plans`, `care_plan_items`, `audit_log` (SELECT) or
`device_audit_log`; `ProvisioningRoleGrantsTest.php` pins that, column-exact,
for every role above.

### 6.5 Functions

All `SECURITY DEFINER` with `SET search_path = public, platform, pg_temp`,
created with the existing idiom as their owning role, `REVOKE EXECUTE ...
FROM PUBLIC` after each. Owners and callers:

| Function | Owner | EXECUTE |
|---|---|---|
| `platform.totp_at(bytea, bigint)` | `clintra_admin_auth` | `clintra_admin_auth` only (called inside its own functions) |
| `platform.admin_login(jsonb)` | `clintra_admin_auth` | `clintra_admin_app` |
| `platform.admin_logout(uuid)` | `clintra_admin_auth` | `clintra_admin_app` |
| `platform.admin_change_password(jsonb)` | `clintra_admin_auth` | `clintra_admin_app` |
| `platform.admin_session_actor(uuid, text, boolean)` | `clintra_admin_auth` | the six action roles |
| `platform.admin_session_state(uuid, boolean)` | `clintra_admin_auth` | `clintra_admin_auth` only (private session resolution) |
| `platform.admin_step_up(uuid, text)` | `clintra_admin_auth` | `clintra_admin_auth` only (private TOTP check and session termination) |
| `platform.admin_log_write(uuid, uuid, text, uuid, uuid, boolean, text, jsonb, inet, text)` | `clintra_admin_auth` | the six action roles |
| `platform.admin_log_refusal(jsonb)` | `clintra_admin_auth` | `clintra_admin_app` (records only `succeeded = false` rows naming the session's admin) |
| `platform.admin_log_cli(jsonb)` | `clintra_admin_auth` | `clintra_owner`, `clintra_admin_org` (break-glass wrapper only) |
| `platform.admin_provision_organization(uuid, text, jsonb, uuid)` | `clintra_admin_provision` | `clintra_admin_app` |
| `platform.admin_request_code(uuid, text, jsonb, uuid)` / `platform.admin_approve_code(uuid, text, uuid, text, uuid)` | `clintra_admin_mint` | `clintra_admin_app` |
| `platform.admin_revoke_device(uuid, text, uuid, uuid)` | `clintra_admin_device` | `clintra_admin_app` |
| `platform.admin_set_org_disabled(uuid, text, uuid, boolean, text, uuid)` | `clintra_admin_org` | `clintra_admin_app` |
| `platform.cli_set_org_disabled(uuid, boolean, text, uuid, text)` | `clintra_admin_org` | `clintra_owner` |
| `platform.admin_org_figures(uuid, date, date, uuid)` | `clintra_admin_stats` | `clintra_admin_app` |
| `platform.admin_open_support_session(uuid, text, jsonb, uuid)` | `clintra_admin_support` | `clintra_admin_app` |
| `mint_support_code(jsonb)` | `clintra_support` | `clintra_app` |
| `support_exchange(jsonb)` | `clintra_support` | `clintra_app` |

The complete B1 function bodies, validation, ownership and EXECUTE grants
are in [migration 000056](../api/database/migrations/2026_09_12_000056_add_platform_auth_functions.php).
`admin_session_actor` returns a JSON state with `ok`, `admin_user_id` and,
on refusal, `reason`; step-up refusals also carry `all_sessions_ended`.
The six action roles must check `ok` before acting and write exactly one
log using the returned actor and reason in the same transaction. The
private resolver and TOTP helper are callable only by `clintra_admin_auth`.
Only password change and logout ask the private resolver to allow the
initial-password state. B2 resolves the actor and step-up first, then the organization. Existing-org
refusals set `admin_log.org_id`; unknown IDs return `not_found` with `org_id`
null and the requested UUID in `target_id`, preserving the FK. Failed step-ups
for unknown IDs still consume the shared failure budget. The CLI follows the
same not-found log shape with a null admin and host user in detail. Both entry
points return refusals without raising. The complete B2 SQL, grants, and rollback
are in migration 000057; the organization action below matches it. The other examples show later action contracts.

```sql
CREATE FUNCTION platform.admin_set_org_disabled(p_session uuid, p_otp text, p_org uuid, p_disabled boolean,
                                                p_reason text, p_log_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, platform, pg_temp AS $$
DECLARE
    v_state jsonb := platform.admin_session_actor(p_session,p_otp,true);
    v_admin uuid := (v_state->>'admin_user_id')::uuid;
    v_org uuid;
    v_action text := CASE WHEN p_disabled IS FALSE THEN 'org.enable' ELSE 'org.disable' END;
    v_reason text := nullif(btrim(p_reason),'');
    v_refusal text := v_state->>'reason';
BEGIN
    -- Resolve and step up before looking up even a guessed organization ID.
    SELECT id INTO v_org FROM organizations WHERE id=p_org;
    IF v_refusal IS NULL THEN
        IF v_org IS NULL THEN v_refusal := 'not_found';
        ELSIF p_disabled IS NULL THEN v_refusal := 'invalid_payload';
        ELSIF p_disabled AND (v_reason IS NULL OR char_length(v_reason)>200) THEN v_refusal := 'reason_required';
        ELSE
            PERFORM pg_advisory_xact_lock(hashtextextended('sync_seq:' || p_org::text,0));
            UPDATE organizations SET disabled_at=CASE WHEN p_disabled THEN now() END,
                disabled_reason=CASE WHEN p_disabled THEN v_reason END
            WHERE id=p_org AND (disabled_at IS NULL)=p_disabled;
            IF NOT FOUND THEN v_refusal := 'unchanged'; END IF;
        END IF;
    END IF;
    PERFORM platform.admin_log_write(coalesce(p_log_id,gen_random_uuid()),v_admin,v_action,v_org,p_org,
        v_refusal IS NULL,v_refusal,v_state || jsonb_build_object('reason',v_reason));
    IF v_refusal IS NOT NULL THEN RETURN jsonb_build_object('ok',false,'reason',v_refusal); END IF;
    RETURN jsonb_build_object('ok',true);
END;
$$;

CREATE FUNCTION platform.admin_revoke_device(p_session uuid, p_otp text, p_device_id uuid, p_log_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, platform, pg_temp AS $$
DECLARE
  v_state jsonb := platform.admin_session_actor(p_session, p_otp, true);
  v_admin uuid := (v_state->>'admin_user_id')::uuid;
  v_org uuid;
BEGIN
  IF (v_state->>'ok')::boolean THEN
    SELECT org_id INTO v_org FROM device WHERE id = p_device_id AND revoked_at IS NULL;
  END IF;
  IF NOT (v_state->>'ok')::boolean OR v_org IS NULL THEN
    PERFORM platform.admin_log_write(p_log_id, v_admin, 'device.revoke', v_org, p_device_id, false,
                                     coalesce(v_state->>'reason', 'not_found'), v_state);
    RETURN jsonb_build_object('ok', false, 'reason', coalesce(v_state->>'reason', 'not_found'));
  END IF;
  UPDATE device SET revoked_at = now() WHERE id = p_device_id;
  DELETE FROM personal_access_tokens WHERE tokenable_type = 'App\Models\Device' AND tokenable_id = p_device_id;
  PERFORM platform.admin_log_write(p_log_id, v_admin, 'device.revoke', v_org, p_device_id, true, NULL, '{}');
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE FUNCTION platform.admin_org_figures(p_session uuid, p_from date, p_to date, p_log_id uuid)
RETURNS TABLE (org_id uuid, org_name text, disabled_at timestamptz, active_locations bigint,
               active_practitioners bigint, active_members bigint, active_devices bigint, last_sync_at timestamptz,
               visits_completed bigint, visits_cancelled bigint, visits_no_show bigint,
               invoices_issued bigint, billed_piastres bigint, collected_piastres bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, platform, pg_temp AS $$
DECLARE
  v_state jsonb := platform.admin_session_actor(p_session, NULL, false);
  v_admin uuid := (v_state->>'admin_user_id')::uuid;
  v_ok boolean := (v_state->>'ok')::boolean AND p_from <= p_to AND p_to - p_from <= 366;
BEGIN
  PERFORM platform.admin_log_write(p_log_id, v_admin, 'figures.view', NULL, NULL, v_ok,
                                   CASE WHEN NOT v_ok THEN coalesce(v_state->>'reason', 'not_allowed') END, jsonb_build_object('from', p_from, 'to', p_to));
  IF NOT v_ok THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT o.id, o.name::text, o.disabled_at,
    (SELECT count(*) FROM locations l WHERE l.org_id = o.id AND l.is_active),
    (SELECT count(*) FROM practitioners pr WHERE pr.org_id = o.id AND pr.is_active),
    (SELECT count(*) FROM memberships m WHERE m.org_id = o.id AND m.is_active),
    (SELECT count(*) FROM device d WHERE d.org_id = o.id AND d.revoked_at IS NULL AND d.kind = 'clinic'),
    (SELECT max(sl.applied_at) FROM sync_ledger sl WHERE sl.org_id = o.id),
    (SELECT count(*) FROM visits v WHERE v.org_id = o.id AND v.visit_date BETWEEN p_from AND p_to AND v.status = 'completed'),
    (SELECT count(*) FROM visits v WHERE v.org_id = o.id AND v.visit_date BETWEEN p_from AND p_to AND v.status = 'cancelled'),
    (SELECT count(*) FROM visits v WHERE v.org_id = o.id AND v.visit_date BETWEEN p_from AND p_to AND v.status = 'no_show'),
    (SELECT count(*) FROM invoices i WHERE i.org_id = o.id AND i.status <> 'void'
        AND (i.issued_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN p_from AND p_to),
    (SELECT coalesce(sum(i.total), 0)::bigint FROM invoices i WHERE i.org_id = o.id AND i.status <> 'void'
        AND (i.issued_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN p_from AND p_to),
    (SELECT coalesce(sum(pa.amount), 0)::bigint FROM payments pa JOIN invoices i ON i.id = pa.invoice_id
        WHERE i.org_id = o.id AND (pa.created_at AT TIME ZONE 'Africa/Cairo')::date BETWEEN p_from AND p_to)
  FROM organizations o
  ORDER BY o.name;
END;
$$;
```

The remaining functions follow the same shape, each with its payload
checked key by key (`22023`) before any read:

- `platform.admin_provision_organization(session, otp, payload, log_id)`:
  `admin_session_actor(…, true)`, then `PERFORM provision_organization(payload)`
  (its own validation unchanged), then one `org.provision` log row naming
  the new organization.
- `platform.admin_request_code(session, otp, {approval_id, org_id,
  location_id, purpose}, log_id)`: inserts a `platform.admin_approvals` row
  expiring in one hour; logs `code.mint_request`. A brand-new organization's
  first code needs no approval (provisioning mints it, as the CLI does).
- `platform.admin_approve_code(session, otp, approval_id, code_hash,
  log_id)`: a different, active admin; the approval unexpired and
  unapproved; sets `approved_by`, calls `mint_activation_code` with
  `{id, org_id, location_id, code_hash, expires_at: now() + 72 h, audit_id,
  purpose}` (the identity design adds `purpose` to its payload); logs
  `code.mint_approve`. The panel generated the code, sends its hash, and
  shows the plaintext once to the approver.
- `platform.admin_open_support_session(session, otp, {code_hash, device_id,
  exchange_hash, audit_id}, log_id)`: the code `purpose = 'support'`,
  unused, unexpired (`FOR UPDATE`); inserts the `device` row (`kind =
  'support'`, the code's org and location, `membership_id` = the code's
  `created_by_membership_id`, `expires_at = now() + support_hours`,
  `include_clinical`, `support_admin_name` = the admin's name,
  `support_code_id`), marks the code used, inserts the exchange (two
  minutes), writes one clinic `audit_log` row attributed to the owner who
  made the code ("فتح فريق كلينترا دعم للقراءة") and one `support.open` log
  row.
- `mint_support_code({id, code_hash, location_id, support_hours,
  include_clinical, audit_id})`: the caller (`current_membership()`) is an
  active owner and the location is theirs; inserts the code (`purpose =
  'support'`, `expires_at = now() + 72 h`); one clinic audit row.
- `support_exchange({exchange_hash})`: unused and unexpired; marks it used;
  returns `{device_id, org_id, location_id, membership_id}` for the
  controller to mint the token (`App\Models\Device`, abilities
  `membership:<uuid>` and `support:read-only`).

## 7. Sync impact

- **New tables.** All in `platform` — none syncable, none pulled.
  `organizations` and `device` gain columns the device never syncs
  (`organizations` is not a syncable table; the device row is written by
  registration only).
- **Responses, not op reasons.** `org_disabled` and `support_read_only` are
  request-level 403s, so no op is ever partly applied and nothing enters the
  sync review. A device that queued ops while disabled keeps them and sends
  them once enabled. The support device's own review, should anything ever
  be queued there, reads "جهاز الدعم للقراءة بس، مفيش تغيير بيتحفظ منه"
  (`support_read_only` in `reviewSummary.ts`, for completeness).
- **Ordering.** Unchanged for clinic devices. Disabling takes the
  organization's sync seq lock first (4.3), so a disable lands between two
  pushes, never inside one; enabling takes it too, so the first push after
  enabling sees the enabled organization in full.
- **Pull filters.** For a support device without clinical access,
  `SyncPuller`, `SyncBootstrapPuller` and `DeviceAuditPuller` skip the
  clinical entities and null `visits.note`; cursors advance over skipped
  rows as they do over any row (the cursor is the ledger `seq`).
- **`support_sessions`.** A new top-level field on every pull page (beside
  `device_series`), read through `device`'s own policy.

## 8. Migration of existing devices and data

1. Roles are created by the deploy's superuser step (the README's setup file
   and `ci.yml` grow the nine `CREATE ROLE` lines).
2. The migrations add the `platform` schema, its tables and functions, the
   new columns (every organization enabled, every device `kind = 'clinic'`,
   no expiry), and recreate `current_org()`, `device_exists()` and
   `register_device`. No existing row is rewritten; no policy changes.
3. `clintra:admin:create` creates the team's accounts; the CLI commands gain
   a call to `platform.admin_log_cli` so their actions appear in the log
   (with `admin_user_id` null and the host user in `detail`).
4. The web app learns `org_disabled` (banner, sync pause), the support
   section in settings, the support sessions banner, and support mode. A
   device on the old version that meets `org_disabled` shows its existing
   generic sync error and keeps its queue; nothing is lost.
5. The panel is deployed with only `clintra_admin_app`'s credentials. The
   API's environment never holds them, and the panel's never holds
   `clintra_app`'s.

## 9. UI screens touched

**The panel** (Arabic, RTL, Latin digits, as the clinic app):

- "تسجيل الدخول": "البريد الإلكتروني", "كلمة السر", "كود التحقق" ("أو كود
  من أكواد الاسترجاع"); "البيانات دي مش صح"; "محاولات كتير، استنى ربع ساعة".
- "العيادات": the figures table ("الفروع", "الدكاترة", "الموظفين",
  "الأجهزة", "آخر مزامنة", "زيارات اكتملت", "اتلغت", "ماحضرش", "فواتير",
  "المطلوب", "المتحصّل") with "من" / "لحد"; a state chip "موقوفة".
- "العيادة": "إيقاف العيادة" / "تشغيل العيادة", "سبب الإيقاف";
  "الأجهزة" with "إلغاء الجهاز"; "أكواد التفعيل" → "طلب كود تفعيل جهاز",
  "طلب كود استرجاع للمالك", "طلبات مستنية موافقة" → "موافقة"; every
  destructive button asks "اكتب كود التحقق تاني".
- "عيادة جديدة" (provisioning).
- "دخول دعم": "كود الدعم", "افتح التطبيق".
- "سجل الإدارة": every log row, filterable by admin, clinic and action.

**The clinic app:**

- A banner on every screen while disabled (4.3); the registration line.
- Settings → "دعم كلينترا" (owner): "إنشاء كود دعم", "المدة", "الفرع",
  "يشمل البيانات الطبية", the one-time code line.
- Settings → "الأجهزة": "جهاز دعم كلينترا — {name} — بينتهي {time}",
  "إنهاء الدعم دلوقتي".
- A banner on every clinic device during support: "فريق كلينترا عنده وصول
  للقراءة بس لحد {time}"; and "فريق كلينترا أصدر كود تفعيل جهاز جديد للعيادة
  في {time}" after an approved mint.
- Support mode: the banner "جهاز دعم — قراءة بس — بينتهي {time}", every
  write control hidden.

## 10. Tests planned

- **Pest (in `api/`, on `clintra_test`).** Grants: `clintra_admin_app`
  holds `EXECUTE` on exactly the panel's functions and no privilege on any
  table in `public` or `platform`; every function role's privileges
  column-exact; none of them holds anything on the clinical and identifying
  tables listed in 6.4; `admin_session_actor` and `admin_log_write` are not
  executable by `clintra_admin_app`. Sign-in: right password and TOTP;
  wrong password; wrong TOTP; a TOTP step reused; a recovery code once and
  not twice; unknown email gives the same result shape; the 5-in-15-minutes
  limit by email and by IP; inactive admin; session absolute and idle
  expiry; step-up refused without a fresh code. The log: every function
  writes exactly one row on success and one on refusal; `UPDATE`, `DELETE`
  and `TRUNCATE` refused for `clintra_owner`, `clintra_fixtures` and every
  function role. Disable: push, pull, bootstrap, audit push and pull, staff
  return the 403 body once the token is valid, and the 401 for an invalid
  one; registration with a valid code on a disabled organization gives 403
  and leaves the code unused, with an invalid code the generic failure; a
  direct query as `clintra_app` with a disabled member's
  `app.membership_id` reads zero rows; enabling restores; a disable started
  while a push is open waits for it (the `proc_open` harness of
  `SyncSeqOrderTest.php`). Figures: two organizations with known rows give
  exactly their own counts and sums; void invoices left out; the function's
  result columns are only the ones listed. Approvals: the requester cannot
  approve; an expired request cannot be approved; a second approval is
  refused. Support: only an owner mints a support code; a support code
  cannot register a clinic device and a device code cannot open support;
  the exchange works once and only for two minutes; with a support token,
  push, audit push and staff give 403 and a write slipped into the request
  fails with `25006`; without clinical access, pull, bootstrap and audit
  pull carry no clinical row and `visits.note` is null; past `expires_at`
  the token is 401; the owner's "إنهاء" revokes it. Cross-org: a support
  code of organization A cannot open support on B; B's owner cannot see A's
  support devices; figures never mix organizations.
- **Panel (in `admin/`).** Pest feature tests for each Filament action
  calling the right function with the session and TOTP, and showing the
  function's refusal; a Playwright run of sign-in with TOTP and a disable.
- **vitest.** The sync engine's `org_disabled` state (stops, one probe per
  15 minutes, resumes on enable, keeps the queue); support mode refusing
  every `mutate()`; the support code form; the banners' strings; the pull
  page's `support_sessions` handling.
- **e2e (desktop and mobile).** `FakeTransport` answering `org_disabled`:
  the banner, local work kept, resumed sync; the support section in
  settings; support mode with every write hidden.
- **test:live.** Disable the live clinic through
  `platform.admin_set_org_disabled` (driven from the live run's PHP helper
  on `clintra_test` with a test admin): both devices show the banner, A
  books offline-style while disabled and keeps the booking queued; enable:
  it reaches B. The owner on A makes a support code; the helper opens
  support and swaps it; the support context reads A's day, a push from it is
  403; the owner ends it from A and the support context is 401.

## 11. Size

**XL — about 20-30 working days.** A new Laravel app with Filament and its
deployment; nine roles; four migrations (platform schema, clinic columns,
RLS helper and registration changes, functions); `ApplyMembership`'s
disabled and read-only paths; pull filters; the clinic app's banners,
settings section and support mode; tests as above. Support access depends
on the identity design for "owner only" to be proven rather than claimed
(before it, the owner check is the device token's owner, the known gap).

## 12. Open questions

1. **Stack?** Recommended: a separate Laravel 13 + Filament 4 app in
   `admin/`, its own deployment and domain and login role (section 3).
2. **Verify admin passwords and TOTP in Postgres or in PHP?** Recommended:
   in Postgres (pgcrypto), so a compromised panel server cannot mint
   sessions; the cost is bcrypt instead of Argon2id for a handful of team
   accounts.
3. **Two admins for minting a code for an existing clinic?** Recommended:
   yes, for both device and owner-recovery codes, plus the notice on the
   clinic's devices; a single admin may still provision a brand-new clinic.
4. **What does a disabled clinic's device do?** Recommended: keep working
   locally with sync paused and a banner, so a waiting room is never
   stranded; the queue goes up when the clinic is enabled.
5. **Support access to clinical text?** Recommended: off by default, the
   owner's tick per code.
6. **Support durations?** Recommended: 1, 24 or 72 hours, 24 preselected;
   one live support device per clinic at a time.
7. **Panel language?** Recommended: Arabic and RTL like the clinic app, with
   Latin digits.
8. **Admin accounts?** Recommended: created and deactivated only by the CLI
   on the API host; no self-service sign-up, no invitations from the panel.
9. **Network exposure?** Recommended: the panel behind an IP allowlist (or a
   VPN) in addition to 2FA.
10. **Do the CLI commands write the admin log?** Recommended: yes, through
    `platform.admin_log_cli`, with `admin_user_id` null and the host user in
    `detail`.
11. **Provisioning from the panel before the identity design?** Recommended:
    no. Today `provision_organization` requires the owner's PIN hash, which
    an admin should never type; until the owner sets their own password and
    PIN at first sign-in, provisioning stays on the CLI.
12. **What business data may the panel show besides the figures?**
    Recommended: the clinic's and its locations' names only, as the grants
    in 6.4 allow. The owner's contact details stay in the team's own records,
    outside this database, so no panel role ever needs `users` or
    `memberships.display_name`.

## Phases (owner, 2026-11-21)

| Phase | Scope |
|---|---|
| B1 | Foundation, no UI: the nine roles of 6.1 (README setup, ci.yml, and api/scripts/provision-roles.sql with the admin_app password as a psql variable); the platform schema, its tables, the append-only admin log (UPDATE/DELETE/TRUNCATE refused by trigger for every role); platform.totp_at, admin_login, admin_logout, admin_change_password, admin_session_actor, admin_log_write, admin_log_refusal, admin_log_cli; `clintra:admin:create`; every existing operator CLI command (device revoke, mint, provision) writes through admin_log_cli with admin_user_id null and the host user in detail. |
| B2 | Organization disable/enable per 4.3, built from PR #68: the function is platform.admin_set_org_disabled owned by clintra_admin_org (the CLI path goes through admin_log_cli, never a clinic audit row attributed to the owner); the design's exact Arabic texts; ApplyMembership, register_device, current_org(), the device banner and sync pause; PR #68 is then closed in favour of it. |
| B3 | The panel app in admin/ (Laravel 13 + Filament 4, Arabic, RTL, Latin digits): sign-in with TOTP or a recovery code, sessions, the fresh-TOTP step-up on every destructive action, the admin log screen, the optional IP allowlist (off by default). |
| B4 | Cross-clinic figures: platform.admin_org_figures with the column grants of 6.4, the "العيادات" screen and the "موقوفة" chip. |
| B5 | Devices and codes: admin_revoke_device, admin_request_code, admin_approve_code (a second admin's approval only while two or more active admins exist), the notice on the clinic's devices. Provisioning a new clinic stays on the CLI (decision 11). |
| B6 | Support access per 4.5: mint_support_code, support_exchange, admin_open_support_session, the read-only transaction, pull filters, support_sessions, the clinic-side settings, banners and support mode. |

Each phase: its own commits, full SQL with down() for every migration, Pest for every function incl. cross-org and
every refusal, gate, push.

## Decisions (owner, 2026-11-19)

Every open question in section 12 takes its recommended answer, except
questions 3 and 9:

1. A separate Laravel 13 + Filament 4 app in `admin/`, with its own
   deployment, domain and login role.
2. Admin passwords and TOTP are verified in Postgres (pgcrypto, bcrypt).
3. **Changed:** a second admin's approval for minting a code (device or
   owner-recovery) for an existing clinic is required only while two or more
   active admin accounts exist. With one active admin, that admin mints
   alone, and the clinic's devices still show the notice. A single admin may
   still provision a brand-new clinic.
4. A disabled clinic's devices keep working locally with sync paused and a
   banner; the queue goes up when the clinic is enabled.
5. Support access to clinical text is off by default, the owner's tick per
   code.
6. Support lasts 1, 24 or 72 hours, 24 preselected; one live support
   device per clinic at a time.
7. The panel is Arabic and right-to-left, with Latin digits.
8. Admin accounts are created and deactivated only by the CLI on the API
   host; no sign-up, no invitations from the panel.
9. **Changed:** the IP allowlist is optional configuration, off by default;
   two-factor sign-in stays mandatory for every admin.
10. The CLI commands write the admin log through `platform.admin_log_cli`,
    with `admin_user_id` null and the host user in `detail`.
11. No provisioning from the panel before the identity design; it stays on
    the CLI until then.
12. The panel shows the figures and the clinic's and its locations' names
    only; the owner's contact details stay outside this database.

Implementation order: C, then A, then B. Every function named in a design is
written out in full SQL in its migration PR, which the owner's reviewer reads
before merge. (A: `docs/design-identity-permissions.md`; B:
`docs/design-platform-admin.md`; C: `docs/design-clinical-corrections.md`.)

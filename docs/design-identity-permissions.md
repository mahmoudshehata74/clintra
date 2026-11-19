# Design: per-person identity, password login and permissions

Status: design only. Nothing here is built; every statement below is a
plan, to be reviewed before a migration is written.

## 1. Goal

Each staff member gets a server identity of their own: they sign in with a
username and password once per device while online, and the server issues a
credential bound to that person and that device, after which the PIN unlocks
them offline as today. The server then authorises every write by the person
who proved they made it, against a fixed catalogue of permissions held per
membership, instead of by the owner whose phone registered the device.

## 2. What exists today, and what it cannot prove

- A device registers with the owner's phone and a one-time activation code
  (`api/docs/rls.md`, "Registration"). The Sanctum token it gets is bound to
  that owner membership (`membership:<uuid>` ability), and
  `ApplyMembership` sets `app.membership_id` to it for every request.
- Staff unlock with a 4-digit PIN checked on the device only
  (`docs/auth-plan.md`, Layer 2). The server never sees who is signed in.
- So every push is authorised as the owner. The actor columns and device
  audit rows carry the device's *claim* of who acted, held only to "a member
  of this organization" (`api/docs/rls.md`, "Actor attribution",
  `SyncOpApplier::claimsActorInOrg`). Owner-only settings writes are
  enforced on the device alone (`docs/session-handoff.md` backlog).
- A copied bearer token is a full read/write credential for the owner's
  whole scope.

This design keeps the device token (it still says "this device, of this
organization") and adds two keys on the device: one for the device and one
per person signed in there.

## 3. How it works

### 3.1 Keys and credentials

- **Device key.** An ECDSA P-256 key pair made with WebCrypto
  (`generateKey({name: "ECDSA", namedCurve: "P-256"}, false, ["sign"])`).
  The private key is a non-extractable `CryptoKey`, stored as is in
  IndexedDB (structured clone keeps it usable and still unexportable). Its
  public key (JWK) is bound to the `device` row at the first successful
  password login on that device. Every authenticated request carries a
  device proof (3.4).
- **Person credential.** One more P-256 pair per person per device, made the
  moment they sign in with their password on that device. The server stores
  the public key in `member_credentials`, bound to that membership and that
  device. Every op and every device audit row the person writes is signed
  with it (3.5).
- **Password.** Used only online, only to obtain a person credential, reset
  it, or confirm a sensitive action (step-up, 3.7). It is never stored on the
  device.
- **PIN.** Unchanged (Argon2id on the device, `contract/pin-hash.json`). It
  now chooses which local credential signs, and gates the UI.

### 3.2 Online: first sign-in on a device

1. The lock screen ("مين شغّال دلوقتي؟") lists only the people who have a
   live credential on this device. Below it, "دخول بحساب" opens the sign-in
   form: "اسم المستخدم", "كلمة السر", "دخول".
2. The device makes the person key pair (and, on a device that has none
   bound yet, uses its device key pair), then calls `POST /api/auth/login`
   with the device token, the device proof, `{username, password,
   credential_id (a client uuid), credential_public_key (JWK),
   device_public_key (JWK, only while the device has none bound)}`.
3. The API runs `auth_login_begin` (rate limits, returns the stored hash or a
   dummy hash), verifies with `password_verify`, then runs
   `auth_login_complete` (records the attempt, revokes an older credential of
   the same person on this device as `replaced`, stores the new one, binds the
   device key if unbound, writes one `audit_log` row). It answers with the
   membership (role, permissions, display name, PIN hash and salt) and
   `must_change_password`.
4. If `must_change_password`, the device shows "غيّر كلمة السر" ("كلمة السر
   الجديدة", "اكتبها تاني", "حفظ") and calls `POST /api/auth/password`. If
   the person has no PIN yet, "اختار رقم سري" follows. Then the day screen.

### 3.3 Offline: every later shift

The person picks their name on the lock screen and types their PIN, exactly
as today. Nothing reaches the server. Every write they make is signed with
their credential on this device, so it carries their proof whenever it is
pushed. A person with no credential on this device cannot unlock it
offline: "لازم تكون متصل بالإنترنت أول مرة تدخل على الجهاز ده".

### 3.4 Device proof on every request

Every request behind the `membership` middleware (push, pull, bootstrap,
audit push and pull, staff, auth endpoints after login) carries

```
Authorization: Bearer <device token>
X-Clintra-Device-Proof: v1.<unix_ms>.<nonce>.<signature>
```

where the signature (base64url, IEEE P1363 `r||s`, as WebCrypto returns it)
is the device key's over the UTF-8 bytes of

```
clintra-req-v1
<METHOD>
<path with query, as sent>
<unix_ms>
<nonce: 16 random bytes, base64url>
<sha256 hex of the raw request body, or of the empty string>
```

`ApplyMembership` verifies it after the token resolves: the device has a
bound key, `|server_now - unix_ms| <= 300 000`, the nonce was not seen for
this device in the last 10 minutes (cache key `device-nonce:<device>:<nonce>`,
10-minute TTL), and the signature verifies (`openssl_verify` on the DER
form, `OPENSSL_ALGO_SHA256`). Any failure is the existing generic 401. The
device takes `unix_ms` from its clock corrected by the offset to
`GET /api/health`'s `time`, which it already fetches, so a wrong device
clock does not lock it out.

While an organization is not yet enforced (section 7) a request without the
header is accepted as today; a request *with* one is always verified.

### 3.5 Person proof on every op and device audit row

`sync_ops` rows gain `credential_id` and `proof`. The proof is the person
key's signature over

```
clintra-op-v1
<op_id>
<device_id>
<credential_id>
<entity>
<entity_id>
<action>
<base_rev, or "-">
<group_id, or "-">
<created_at, exactly as sent>
<sha256 hex of the RFC 8785 (JCS) canonical JSON of payload, or "-" for a delete>
```

A device audit row is signed the same way over

```
clintra-audit-v1
<id>
<device_id>
<credential_id>
<entity>
<entity_id>
<action>
<at>
<sha256 hex of JCS({"after": after, "before": before})>
```

The server hashes the payload as decoded from the raw request body
(`json_decode($request->getContent())`), never from the input Laravel's
`TrimStrings` / `ConvertEmptyStringsToNull` already rewrote — those still
run for applying, as today (the applier's "" → null mapping is unchanged).
JCS is implemented once in PHP (`App\Support\Sync\Jcs`) and once in
TypeScript (`web/src/sync/jcs.ts`), both held to one shared vector file,
`contract/jcs-cases.json`, as the PIN hash already is to
`contract/pin-hash.json`.

**Signing never happens inside a Dexie transaction.** `crypto.subtle.sign`
is not a Dexie operation, and awaiting it inside `db.transaction` loses the
transaction zone (`PrematureCommitError`). `mutate()` writes the op with
`credential_id` set and `proof: null`; a sealer (`web/src/sync/sealer.ts`)
runs right after each write commits, on unlock and on start, signs every
unsealed op in `created_at` order and stores the proof. The push sends only
sealed ops, in order; it never sends an op whose earlier op on the same
`entity_id` is still unsealed or held.

### 3.6 What the server does with an op

`SyncPushController` resolves the device from the token and verifies the
device proof (3.4). Then, per op, before any existing rule:

1. **Credential.** `credential_id` names a `member_credentials` row of this
   device (read through its org-scoped SELECT policy), not revoked; else
   `rejected` / `proof_invalid`.
2. **Signature.** The proof verifies with that row's public key; else
   `rejected` / `proof_invalid`.
3. **Active person.** The credential's membership has `is_active`; else
   `rejected` / `actor_deactivated` (section 3.8).
4. **Act as the person.** The op is applied with `app.membership_id` set to
   the credential's membership (`DatabaseSession::actAs`, which sets it with
   `set_config(..., true)` inside the op's savepoint and restores the
   device's own membership in a `finally`). Every RLS policy — org, location
   and practitioner scope — now evaluates for the person, not the device's
   owner: an assistant listed for one branch cannot write another branch
   from an owner's tablet. `audit_log_insert`'s `actor_membership_id =
   current_membership()` now names the real person, and
   `sync_ledger.actor_membership_id` too.
5. **Actor columns become a check.** Where a table has an actor column
   (`SyncableTables::ACTOR_COLUMNS`), the claim must equal the credential's
   membership, or be null (then filled with it); else `rejected` /
   `actor_mismatch`. This replaces `claimsActorInOrg` for proven ops.
6. **Permission.** The op is checked against the person's permissions
   (section 4); else `rejected` / `permission_denied`.

Then every existing rule runs unchanged. A group must be signed by one
credential; a group with two is refused whole (`proof_invalid` on the first
op that differs, `group_rejected` on the rest). `sync_ledger` keeps the
credential id and the proof as evidence.

The audit push applies 1-3 and 5 to each row (`actor_membership_id` must be
the credential's membership); `pushed_by_membership_id` stays the token's,
as `device_audit_log_insert` requires.

Reads (pull, bootstrap, audit pull) stay scoped by the device's
registration membership, as today: an offline device must hold what anyone
who may unlock it will need. They are protected by the device proof, so a
copied token cannot read (open question 2).

### 3.7 Passwords

- **Hashing.** Argon2id, PHP `password_hash($password, PASSWORD_ARGON2ID,
  ['memory_cost' => 65536, 'time_cost' => 3, 'threads' => 1])`: 64 MiB,
  3 passes, 1 lane (RFC 9106's second recommended option at the lane count
  PHP's libsodium build supports; PHP 8.3 here reports `PASSWORD_ARGON2ID`).
  `password_needs_rehash` on every successful login, rehashed in the same
  `auth_login_complete` call. Input is NFC-normalised first. Tests use a
  cheap override, as `BCRYPT_ROUNDS` is today.
- **Rules.** 10 to 128 characters, any script; refused if equal to the
  username or in a bundled list of the 10 000 most common passwords
  (`contract/common-passwords.txt`); no composition rules. Usernames:
  `^[a-z0-9][a-z0-9._-]{2,31}$`, unique per organization, Latin so a
  keyboard's language never changes what is typed.
- **Rate limits** (in the database, so a forged `X-Forwarded-For` cannot
  reset them; `auth_login_begin` refuses with SQLSTATE `CL429` before
  returning any hash):
  - per organization and username, existing or not: 5 failures in 15
    minutes, then refused until 15 minutes after the fifth;
  - per device: 20 failures in an hour;
  - per organization: 100 failures in 24 hours;
  - plus a Laravel limiter `auth`, 30 requests per 15 minutes per device
    token.

  Every refusal and every wrong username or password reads the same:
  401 "اسم المستخدم أو كلمة السر غلط", or 429 "محاولات كتير، استنى شوية
  وجرّب تاني". An unknown username is verified against a fixed dummy hash
  of the same parameters, so its timing matches.
- **The owner resets a staff password.** Settings → "الموظفين" → the
  person → "إعادة تعيين كلمة السر", online only, needs `staff.manage` and a
  step-up (the owner retypes their own password: "اكتب كلمة السر بتاعتك
  للتأكيد"). The server generates a 12-character temporary password from an
  unambiguous alphabet, shows it once ("كلمة السر المؤقتة: … — هتتغيّر أول ما
  يدخل"), sets `must_change`, and revokes every credential the person holds
  (`password_reset`): they sign in again on each device. Nobody but the owner
  resets an owner.
- **Owner recovery through the existing CLI activation-code path.** The
  Clintra team, after confirming the owner by phone, runs
  `php artisan clintra:mint-activation-code {org} --purpose=owner-recovery`
  (the existing command, a new option; `activation_codes.purpose`). On any
  device of the clinic — or a new one — "نسيت كلمة السر؟" → "رقم
  الموبايل", "كود الاسترجاع", "كلمة السر الجديدة" calls
  `POST /api/auth/owner-recovery`, which runs `auth_recover_owner`: the
  same generic failure as `register_device` for every credential problem,
  single use, 72-hour expiry, every owner credential revoked.

### 3.8 A person deactivated before their ops arrive

Deactivation (`memberships.is_active = false`) takes effect on the server at
once: steps 1-3 refuse every op signed by that person's credentials,
`rejected` / `actor_deactivated`, however old the op. The server cannot tell
an op written before the deactivation from one backdated after it — the
`created_at` it carries is the device's claim. The device lists each
refused op in its sync review with the person's name and the change, and a
member holding the permission the op needs may tap "اعتمده باسمي": the
change is written again as a new op under their own credential, and the
audit log reads "اعتمد تغيير {name} بعد إيقاف حسابه" (open question 3).
Later ops on the same entity in that push are `blocked`, as after any
refusal. On its next pull the device learns of the deactivation and stops
offering that person on the lock screen.

## 4. Permissions

A fixed catalogue, stored per membership (`memberships.permissions`), synced
with the membership row so the device can hide what a person cannot do. An
owner holds every permission by role; the column is ignored for owners.
RLS stays org / location / practitioner scope; permissions are checked in
the applier and every endpoint, with a trigger as the database backstop for
granting.

| Key | Arabic label | Server enforcement |
|---|---|---|
| `reports.view` | عرض التقارير | UI only: reports are computed on the device from data it already holds (section 5) |
| `services.manage` | تعديل الخدمات والأسعار | any op on `services`, `service_price_overrides` |
| `invoices.edit_items` | تعديل بنود الفاتورة | `invoice_items` update or delete; an `invoices` update that changes `total` |
| `invoices.void` | إلغاء فاتورة | an `invoices` update that sets `status = 'void'` |
| `cash.close` | قفل الخزنة | a `cash_close` create |
| `staff.manage` | إدارة الموظفين | `POST /api/staff`, `POST /api/staff/{id}` (usernames, permissions, scopes), password reset, credential revoke; any op on `memberships`, `membership_locations`, `membership_practitioners` |
| `schedules.manage` | إدارة المواعيد والإجازات | any op on `schedules`, `schedule_exceptions` |
| `clinical.view` | عرض البيانات الطبية | UI only on a clinic device (the data is on it); the server keeps it out of a support device's pull unless the owner allows it (`docs/design-platform-admin.md`) |
| `patients.archive` | أرشفة المرضى | a `patients` update that changes `archived_at` |
| `messages.send` | إرسال الرسايل | a `messages` create or sent mark; any op on `message_templates` |

Writing clinical data (the visit form, a prescription) stays tied to being
the visit's practitioner, as the device already enforces; this design moves
that check to the server for proven ops (`practitioner_not_allowed` is not
new: it reuses `permission_denied`).

**Never grant what you don't hold.** Usernames, scopes and permissions move
off sync onto the online endpoint `POST /api/staff/{id}` (with step-up). The
caller needs `staff.manage`; every permission added or removed must be one
the caller holds; nobody changes their own permissions or role; only an
owner changes an owner or grants a role. A `memberships` op that changes
`permissions` or `role` is refused (`permission_escalation`) whatever it
carries; `add_staff_member` gains `permissions` and checks the same subset
rule. The trigger in 6.3 enforces the rule in the database for every
writer that acts as a person.

New rejection reasons and their review lines (`web/src/sync/reviewSummary.ts`):

| Reason | Arabic review line |
|---|---|
| `proof_invalid` | التغيير ده مش موقّع من حساب على الجهاز ده، فماتحفظش. سجّل دخولك تاني بكلمة السر |
| `proof_missing` | التغيير ده اتعمل قبل الدخول بكلمة السر، ومحتاج صاحبه يسجّل دخول على الجهاز ده |
| `actor_deactivated` | الحساب اللي عمل التغيير ده اتوقف قبل ما يوصل للسيرفر، فماتحفظش |
| `actor_mismatch` | الموظف المسجّل على التغيير ده مش هو اللي عمله، فماتحفظش |
| `permission_denied` | اللي عمل التغيير ده مالوش صلاحية يعمله، فماتحفظش |
| `permission_escalation` | مينفعش تدي أو تشيل صلاحية إنت مش عندك، أو تغيّر صلاحياتك بنفسك |

## 5. Threat model

| Attacker | Can | Cannot |
|---|---|---|
| **Stolen device** (a tablet taken from the desk, locked or not) | Read everything synced to it: IndexedDB is not encrypted, as today. With code access to the browser profile (dev tools), skip the PIN screen and sign as anyone who has a credential on that device; the PIN is a UI gate and 4 digits fall to offline guessing in minutes. Keep doing so until the device is revoked. | Copy any key to another machine (all keys are non-extractable). Act as someone with no credential on that device. Reset passwords, revoke devices or change permissions (online endpoints with step-up: the person's password is not on the device). Survive revocation: the owner taps "إلغاء الجهاز" on another device (or the Clintra team revokes it), every credential of the device is revoked, and its next request is 401. |
| **Stolen token** (the bearer token copied from a log, a backup, a proxy) | Nothing on its own. | Read or write: every request needs the device key's proof and every op a person key's proof. Replay a captured request (nonce, 5-minute window) or op (`op_id`, signature over its content). |
| **Malicious staff member** (a real person with a credential) | Everything their permissions and RLS scope allow — now provably under their own name. Read on their device what the device holds, including what the UI hides from them (on-device restrictions are UI). | Act as another person (no access to another's key without the device and code execution; even then the ops carry the other person's proof and the owner can revoke). Grant themselves or anyone a permission they don't hold (applier, endpoint, trigger). Write outside their own location/practitioner scope (RLS now evaluates for them). Keep acting after deactivation: their ops are `actor_deactivated` at once. |
| **Compromised Clintra admin account** (`docs/design-platform-admin.md`) | Mint an owner-recovery code; with the owner's phone, set a new owner password and sign in on a device of the clinic (or mint a device code and register one). | Do it silently: every code minted for an existing clinic needs a second admin's approval (open question 10 there), is logged in the admin log, and is shown on the clinic's devices ("فريق كلينترا أصدر كود …"); recovery revokes the old owner credentials, which the owner notices at once. Read a password or hash (the admin roles hold nothing on `member_passwords`). |
| **Compromised API server** (code execution as `clintra_app`) | Call `auth_login_begin` and collect password hashes (Argon2id, 64 MiB, slows cracking); capture passwords as people sign in; write as any person while it holds the database. | Forge a device's or person's proof for later pushes once the breach is closed (private keys never leave the devices). |

## 6. Planned statements

Roles are created outside migrations, like the others (`api/README.md`,
`.github/workflows/ci.yml`). Everything else is one migration each, with a
`down()` that reverses it.

### 6.1 Role and grants

```sql
CREATE ROLE clintra_auth NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;

GRANT SELECT (id, user_id, org_id, role, is_active, username, permissions, pin_hash, pin_salt, display_name, rev) ON memberships TO clintra_auth;
GRANT SELECT, INSERT ON member_passwords TO clintra_auth;
GRANT UPDATE (password_hash, must_change, set_at, set_by_membership_id) ON member_passwords TO clintra_auth;
GRANT SELECT (id, org_id, membership_id, device_id, revoked_at) ON member_credentials TO clintra_auth;
GRANT INSERT ON member_credentials TO clintra_auth;
GRANT UPDATE (revoked_at, revoked_by_membership_id, revoke_reason, last_used_at) ON member_credentials TO clintra_auth;
GRANT SELECT (id, org_id, revoked_at, public_key) ON device TO clintra_auth;
GRANT UPDATE (public_key, public_key_bound_at) ON device TO clintra_auth;
GRANT SELECT, INSERT ON login_attempts TO clintra_auth;
GRANT UPDATE (succeeded) ON login_attempts TO clintra_auth;
GRANT SELECT (id, org_id, code_hash, expires_at, used_at, purpose) ON activation_codes TO clintra_auth;
GRANT UPDATE (used_at) ON activation_codes TO clintra_auth;
GRANT SELECT (id, phone) ON users TO clintra_auth;
GRANT INSERT ON audit_log TO clintra_auth;
```

`ProvisioningRoleGrantsTest.php` pins every one, column-exact, and asserts
`clintra_auth` holds nothing on any clinical or financial table.

### 6.2 Schema

```sql
-- memberships: username and permissions
ALTER TABLE memberships ADD COLUMN username varchar(32) NULL;
ALTER TABLE memberships ADD CONSTRAINT memberships_username_format
  CHECK (username IS NULL OR username ~ '^[a-z0-9][a-z0-9._-]{2,31}$');
CREATE UNIQUE INDEX memberships_org_username_unique ON memberships (org_id, username) WHERE username IS NOT NULL;
ALTER TABLE memberships ADD COLUMN permissions text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE memberships ADD CONSTRAINT memberships_permissions_catalogue
  CHECK (permissions <@ ARRAY['reports.view', 'services.manage', 'invoices.edit_items', 'invoices.void', 'cash.close',
                              'staff.manage', 'schedules.manage', 'clinical.view', 'patients.archive', 'messages.send']::text[]);

-- passwords: a table no login role can read
CREATE TABLE member_passwords (
  membership_id uuid PRIMARY KEY REFERENCES memberships(id) ON DELETE RESTRICT,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  password_hash text NOT NULL,
  must_change boolean NOT NULL DEFAULT true,
  set_at timestamptz NOT NULL,
  set_by_membership_id uuid NULL REFERENCES memberships(id) ON DELETE RESTRICT
);
ALTER TABLE member_passwords ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_passwords FORCE ROW LEVEL SECURITY;
REVOKE ALL ON member_passwords FROM PUBLIC;
-- no policy and no grant for clintra_app: only clintra_auth's functions touch it

-- per-person, device-bound credentials
CREATE TABLE member_credentials (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  membership_id uuid NOT NULL REFERENCES memberships(id) ON DELETE RESTRICT,
  device_id uuid NOT NULL REFERENCES device(id) ON DELETE RESTRICT,
  public_key jsonb NOT NULL,
  algorithm text NOT NULL DEFAULT 'ES256' CHECK (algorithm = 'ES256'),
  created_at timestamptz NOT NULL,
  last_used_at timestamptz NULL,
  revoked_at timestamptz NULL,
  revoked_by_membership_id uuid NULL REFERENCES memberships(id) ON DELETE RESTRICT,
  revoke_reason text NULL CHECK (revoke_reason IN ('owner_revoked', 'password_reset', 'device_revoked', 'replaced')),
  CHECK ((revoked_at IS NULL) = (revoke_reason IS NULL))
);
CREATE UNIQUE INDEX member_credentials_one_live ON member_credentials (membership_id, device_id) WHERE revoked_at IS NULL;
CREATE INDEX member_credentials_device ON member_credentials (device_id);
ALTER TABLE member_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_credentials FORCE ROW LEVEL SECURITY;
REVOKE ALL ON member_credentials FROM PUBLIC;
GRANT SELECT ON member_credentials TO clintra_app;
CREATE POLICY member_credentials_select ON member_credentials FOR SELECT USING (org_id = current_org());

-- the device's own key
ALTER TABLE device ADD COLUMN public_key jsonb NULL;
ALTER TABLE device ADD COLUMN public_key_bound_at timestamptz NULL;

-- login attempts, for the rate limits
CREATE TABLE login_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  device_id uuid NOT NULL REFERENCES device(id) ON DELETE RESTRICT,
  username varchar(64) NOT NULL,
  succeeded boolean NOT NULL DEFAULT false,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_user_recent ON login_attempts (org_id, username, at);
CREATE INDEX login_attempts_device_recent ON login_attempts (device_id, at);
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON login_attempts FROM PUBLIC;

-- evidence beside what the server accepted
ALTER TABLE sync_ledger ADD COLUMN credential_id uuid NULL REFERENCES member_credentials(id) ON DELETE RESTRICT;
ALTER TABLE sync_ledger ADD COLUMN proof text NULL;
ALTER TABLE device_audit_log ADD COLUMN credential_id uuid NULL REFERENCES member_credentials(id) ON DELETE RESTRICT;
ALTER TABLE device_audit_log ADD COLUMN proof text NULL;

-- the per-organization switch (section 7)
ALTER TABLE organizations ADD COLUMN identity_enforced_at timestamptz NULL;

-- what an activation code is for
ALTER TABLE activation_codes ADD COLUMN purpose text NOT NULL DEFAULT 'device'
  CHECK (purpose IN ('device', 'owner_recovery'));
```

`register_device` gains `AND purpose = 'device'` in its code lookup, so an
owner-recovery code never registers a device (the 000033 body otherwise
unchanged).

### 6.3 Trigger: never grant what you don't hold

```sql
CREATE FUNCTION membership_permission_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_actor uuid := current_membership();
  v_actor_role text;
  v_actor_perms text[];
  v_old_perms text[] := CASE WHEN TG_OP = 'UPDATE' THEN OLD.permissions ELSE '{}'::text[] END;
BEGIN
  -- Migrations, the CLI and the provisioning functions act as no person.
  IF v_actor IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.permissions IS NOT DISTINCT FROM OLD.permissions AND NEW.role IS NOT DISTINCT FROM OLD.role THEN
    RETURN NEW;
  END IF;
  SELECT role, permissions INTO v_actor_role, v_actor_perms FROM memberships WHERE id = v_actor AND is_active;
  IF v_actor_role IS NULL OR NEW.id = v_actor THEN
    RAISE EXCEPTION 'permission_escalation' USING ERRCODE = '42501';
  END IF;
  IF v_actor_role = 'owner' THEN
    RETURN NEW;
  END IF;
  IF NOT ('staff.manage' = ANY (v_actor_perms))
     OR NEW.role = 'owner'
     OR (TG_OP = 'UPDATE' AND (OLD.role = 'owner' OR NEW.role IS DISTINCT FROM OLD.role))
     OR NOT (ARRAY(SELECT unnest(NEW.permissions) EXCEPT SELECT unnest(v_old_perms)) <@ v_actor_perms)
     OR NOT (ARRAY(SELECT unnest(v_old_perms) EXCEPT SELECT unnest(NEW.permissions)) <@ v_actor_perms) THEN
    RAISE EXCEPTION 'permission_escalation' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER memberships_permission_guard
  BEFORE INSERT OR UPDATE OF permissions, role ON memberships
  FOR EACH ROW EXECUTE FUNCTION membership_permission_guard();
```

`add_staff_member` runs under the request's `app.membership_id` (the proven
caller), so the trigger checks its inserts too. The applier and the
endpoint refuse first with a clean reason; the trigger is the backstop for
any writer acting as a person.

### 6.4 Functions (all `SECURITY DEFINER`, owned by `clintra_auth`, `SET search_path = public, pg_temp`)

Each is created with the existing idiom (`DROP FUNCTION IF EXISTS` as
`clintra_owner`, then `SET ROLE clintra_auth` / `CREATE` / `RESET ROLE`),
validates its payload keys like `add_staff_member` (allowlist, every key
present, shapes checked, `22023` before any read), and is followed by:

```sql
REVOKE EXECUTE ON FUNCTION auth_login_begin(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_login_begin(jsonb) TO clintra_app;
REVOKE EXECUTE ON FUNCTION auth_login_complete(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_login_complete(jsonb) TO clintra_app;
REVOKE EXECUTE ON FUNCTION auth_set_password(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_set_password(jsonb) TO clintra_app;
REVOKE EXECUTE ON FUNCTION auth_reset_member_password(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_reset_member_password(jsonb) TO clintra_app;
REVOKE EXECUTE ON FUNCTION auth_revoke_credential(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_revoke_credential(jsonb) TO clintra_app;
REVOKE EXECUTE ON FUNCTION auth_recover_owner(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_recover_owner(jsonb) TO clintra_app;
```

```sql
-- p: {device_id, username}. Returns {attempt_id, membership_id|null, password_hash}.
-- The attempt is recorded as a failure now and flipped by auth_login_complete,
-- so a caller that never completes still spends the limit.
CREATE FUNCTION auth_login_begin(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_device device%ROWTYPE;
  v_username text := lower(p->>'username');
  v_member_id uuid;
  v_hash text;
  v_attempt bigint;
BEGIN
  SELECT id, org_id, revoked_at INTO v_device.id, v_device.org_id, v_device.revoked_at
    FROM device WHERE id = (p->>'device_id')::uuid;
  IF v_device.id IS NULL OR v_device.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'auth: not allowed';
  END IF;
  IF (SELECT count(*) FROM login_attempts WHERE org_id = v_device.org_id AND username = v_username
        AND NOT succeeded AND at > now() - interval '15 minutes') >= 5
     OR (SELECT count(*) FROM login_attempts WHERE device_id = v_device.id
        AND NOT succeeded AND at > now() - interval '1 hour') >= 20
     OR (SELECT count(*) FROM login_attempts WHERE org_id = v_device.org_id
        AND NOT succeeded AND at > now() - interval '24 hours') >= 100 THEN
    RAISE EXCEPTION 'auth: rate limited' USING ERRCODE = 'CL429';
  END IF;
  INSERT INTO login_attempts (org_id, device_id, username) VALUES (v_device.org_id, v_device.id, v_username)
    RETURNING id INTO v_attempt;
  SELECT m.id INTO v_member_id FROM memberships m
    WHERE m.org_id = v_device.org_id AND m.username = v_username AND m.is_active;
  SELECT password_hash INTO v_hash FROM member_passwords WHERE membership_id = v_member_id;
  RETURN jsonb_build_object('attempt_id', v_attempt, 'membership_id', v_member_id,
                            'password_hash', v_hash);  -- null hash: the caller verifies its dummy hash
END;
$$;

-- p: {device_id, attempt_id, membership_id, credential_id, credential_public_key,
--     device_public_key|null, rehash|null, audit_id}. Called only after password_verify succeeded.
CREATE FUNCTION auth_login_complete(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_org uuid;
  v_member record;
  v_must_change boolean;
BEGIN
  SELECT org_id INTO v_org FROM login_attempts
    WHERE id = (p->>'attempt_id')::bigint AND device_id = (p->>'device_id')::uuid
      AND NOT succeeded AND at > now() - interval '2 minutes';
  SELECT id, role, permissions, display_name, pin_hash, pin_salt, rev INTO v_member
    FROM memberships WHERE id = (p->>'membership_id')::uuid AND org_id = v_org AND is_active;
  IF v_org IS NULL OR v_member.id IS NULL THEN
    RAISE EXCEPTION 'auth: not allowed';
  END IF;
  UPDATE login_attempts SET succeeded = true WHERE id = (p->>'attempt_id')::bigint;
  IF p->>'rehash' IS NOT NULL THEN
    UPDATE member_passwords SET password_hash = p->>'rehash' WHERE membership_id = v_member.id;
  END IF;
  SELECT must_change INTO v_must_change FROM member_passwords WHERE membership_id = v_member.id;
  UPDATE member_credentials SET revoked_at = now(), revoke_reason = 'replaced'
    WHERE membership_id = v_member.id AND device_id = (p->>'device_id')::uuid AND revoked_at IS NULL;
  INSERT INTO member_credentials (id, org_id, membership_id, device_id, public_key, created_at)
    VALUES ((p->>'credential_id')::uuid, v_org, v_member.id, (p->>'device_id')::uuid, p->'credential_public_key', now());
  IF p->'device_public_key' IS NOT NULL AND jsonb_typeof(p->'device_public_key') = 'object' THEN
    UPDATE device SET public_key = p->'device_public_key', public_key_bound_at = now()
      WHERE id = (p->>'device_id')::uuid AND public_key IS NULL;
  END IF;
  INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
    VALUES ((p->>'audit_id')::uuid, v_org, v_member.id, 'member_credentials', (p->>'credential_id')::uuid, 'create', NULL,
            jsonb_build_object('device_id', p->>'device_id'), now());
  RETURN jsonb_build_object('membership_id', v_member.id, 'role', v_member.role, 'permissions', v_member.permissions,
    'display_name', v_member.display_name, 'pin_hash', v_member.pin_hash, 'pin_salt', v_member.pin_salt,
    'rev', v_member.rev, 'must_change_password', coalesce(v_must_change, true));
END;
$$;

-- p: {membership_id, new_hash}. The caller is current_membership() (proven by the request) and
-- must be the membership itself; PHP has already checked the old or temporary password.
CREATE FUNCTION auth_set_password(p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF current_membership() IS DISTINCT FROM (p->>'membership_id')::uuid THEN
    RAISE EXCEPTION 'auth: not allowed';
  END IF;
  UPDATE member_passwords SET password_hash = p->>'new_hash', must_change = false, set_at = now(),
         set_by_membership_id = current_membership()
    WHERE membership_id = current_membership();
END;
$$;

-- p: {target_membership_id, temporary_hash, audit_id}. Caller: an active owner, or a holder of staff.manage
-- for a non-owner target in the same organization. Revokes every credential of the target.
CREATE FUNCTION auth_reset_member_password(p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_caller record;
  v_target record;
BEGIN
  SELECT id, org_id, role, permissions INTO v_caller FROM memberships WHERE id = current_membership() AND is_active;
  SELECT id, org_id, role INTO v_target FROM memberships WHERE id = (p->>'target_membership_id')::uuid;
  IF v_caller.id IS NULL OR v_target.id IS NULL OR v_target.org_id <> v_caller.org_id OR v_target.id = v_caller.id
     OR (v_caller.role <> 'owner' AND (v_target.role = 'owner' OR NOT ('staff.manage' = ANY (v_caller.permissions)))) THEN
    RAISE EXCEPTION 'auth: not allowed';
  END IF;
  INSERT INTO member_passwords (membership_id, org_id, password_hash, must_change, set_at, set_by_membership_id)
    VALUES (v_target.id, v_target.org_id, p->>'temporary_hash', true, now(), v_caller.id)
    ON CONFLICT (membership_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change = true,
      set_at = EXCLUDED.set_at, set_by_membership_id = EXCLUDED.set_by_membership_id;
  UPDATE member_credentials SET revoked_at = now(), revoked_by_membership_id = v_caller.id, revoke_reason = 'password_reset'
    WHERE membership_id = v_target.id AND revoked_at IS NULL;
  INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
    VALUES ((p->>'audit_id')::uuid, v_caller.org_id, v_caller.id, 'member_passwords', v_target.id, 'update', NULL,
            jsonb_build_object('reset', true), now());
END;
$$;

-- p: {credential_id, audit_id}. Same caller rule as the reset; an owner may also revoke their own.
CREATE FUNCTION auth_revoke_credential(p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_caller record;
  v_cred record;
  v_target_role text;
BEGIN
  SELECT id, org_id, role, permissions INTO v_caller FROM memberships WHERE id = current_membership() AND is_active;
  SELECT id, org_id, membership_id INTO v_cred FROM member_credentials
    WHERE id = (p->>'credential_id')::uuid AND revoked_at IS NULL;
  SELECT role INTO v_target_role FROM memberships WHERE id = v_cred.membership_id;
  IF v_caller.id IS NULL OR v_cred.id IS NULL OR v_cred.org_id <> v_caller.org_id
     OR (v_caller.role <> 'owner' AND (v_target_role = 'owner' OR NOT ('staff.manage' = ANY (v_caller.permissions)))) THEN
    RAISE EXCEPTION 'auth: not allowed';
  END IF;
  UPDATE member_credentials SET revoked_at = now(), revoked_by_membership_id = v_caller.id, revoke_reason = 'owner_revoked'
    WHERE id = v_cred.id;
  INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
    VALUES ((p->>'audit_id')::uuid, v_caller.org_id, v_caller.id, 'member_credentials', v_cred.id, 'update', NULL,
            jsonb_build_object('revoked', true), now());
END;
$$;

-- p: {code_hash, phone, new_hash, audit_id}. Generic failure for every credential problem, as register_device.
CREATE FUNCTION auth_recover_owner(p jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_code record;
  v_owner uuid;
BEGIN
  SELECT id, org_id INTO v_code FROM activation_codes
    WHERE code_hash = p->>'code_hash' AND purpose = 'owner_recovery' AND used_at IS NULL AND expires_at > now()
    FOR UPDATE;
  SELECT m.id INTO v_owner FROM memberships m JOIN users u ON u.id = m.user_id
    WHERE m.org_id = v_code.org_id AND m.role = 'owner' AND m.is_active AND u.phone = p->>'phone';
  IF v_code.id IS NULL OR v_owner IS NULL THEN
    RAISE EXCEPTION 'auth_recover_owner: recovery failed';
  END IF;
  UPDATE activation_codes SET used_at = now() WHERE id = v_code.id;
  INSERT INTO member_passwords (membership_id, org_id, password_hash, must_change, set_at, set_by_membership_id)
    VALUES (v_owner, v_code.org_id, p->>'new_hash', false, now(), NULL)
    ON CONFLICT (membership_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change = false,
      set_at = EXCLUDED.set_at, set_by_membership_id = NULL;
  UPDATE member_credentials SET revoked_at = now(), revoke_reason = 'password_reset'
    WHERE membership_id = v_owner AND revoked_at IS NULL;
  INSERT INTO audit_log (id, org_id, actor_membership_id, entity, entity_id, action, before, after, at)
    VALUES ((p->>'audit_id')::uuid, v_code.org_id, v_owner, 'member_passwords', v_owner, 'update', NULL,
            jsonb_build_object('recovered', true), now());
END;
$$;
```

Every id is caller-supplied (the audit row's `audit_id` included), as for
every function in `api/docs/rls.md`; none calls `gen_random_uuid()`.
`clintra_auth` needs `SELECT (user_id)` on memberships for the recovery
join; it is in the column list of 6.1. `auth_login_complete` records the
credential's creation in `audit_log` as an `entity` the device never syncs;
the audit sheet labels it "سجّل دخول على جهاز" (`auditVerb.ts`).

### 6.5 Endpoints

| Route | Auth | Does |
|---|---|---|
| `POST /api/auth/login` | device token + device proof (proof optional until bound) | 3.2 |
| `POST /api/auth/password` | + person proof of the request (`X-Clintra-Person-Proof`, the same message as 3.4 signed by the person key) | change own password (old or temporary password in the body) |
| `POST /api/auth/owner-recovery` | none (code + phone are the credential); IP/code/org limits as registration | 3.7 |
| `POST /api/staff/{id}/password-reset` | person proof + step-up password | `auth_reset_member_password` |
| `DELETE /api/staff/credentials/{id}` | person proof + step-up password | `auth_revoke_credential` |
| `GET /api/staff/credentials` | person proof, `staff.manage` | lists the organization's live credentials and devices (settings) |
| `POST /api/staff/{id}` | person proof + step-up, `staff.manage` | username, permissions, scopes (section 4) |

A request carrying a person proof runs with `app.membership_id` = that
person for its whole transaction, so the functions above see the proven
caller as `current_membership()`.

## 7. Migration of existing devices and data

1. **Server deploy.** Section 6 lands. Every organization has
   `identity_enforced_at IS NULL` ("legacy"): ops with no proof are applied
   exactly as today (actor claim held to the organization); ops and
   requests that carry a proof are always verified. Nothing changes for a
   device that has not updated.
2. **Permissions backfill.** In the same migration, each non-owner
   membership gets the permissions of the actions its role can perform on
   the device today, so nobody gains or loses anything on day one. The
   proposed table, to be confirmed against the code when the migration is
   written (open question 11): `practitioner` → `clinical.view`,
   `reports.view`, `patients.archive`, `messages.send`, `cash.close`;
   `assistant` and `manager` → `reports.view`, `patients.archive`,
   `messages.send`, `cash.close`. No one but an owner gets
   `services.manage`, `schedules.manage`, `staff.manage`,
   `invoices.edit_items` or `invoices.void`, which are owner-only today.
3. **Web update** (Dexie: the next version, 28 at the time of writing).
   Each device makes its device key on first start. `sync_ops` and the
   local `audit_log` gain `credential_id` (null) and `proof` (null) and an
   `actor_membership_id`, backfilled from each op's own audit row (written
   in the same transaction by `mutate()`); a new local store
   `credentials: "id, membership_id"` holds the person keys. No sync op or
   audit row is written by the upgrade.
4. **Owner setup.** The Clintra team mints one owner-recovery code per
   clinic (3.7) and gives it to the owner; the owner uses "إنشاء حسابك"
   (the recovery screen, worded for first use: "اسم المستخدم", "كلمة السر")
   on one of the clinic's devices. Recovery binds the first owner password;
   the device then signs in as in 3.2 and binds its device key. Doing it
   with a code — not with the legacy owner token — means a stolen token
   cannot claim the owner account first.
5. **Staff.** The owner gives each active member a username and a
   temporary password in settings ("الموظفين"); each signs in once on each
   device they use. Queued unsigned ops are sealed by their own author's
   credential when that author signs in on the device; ops whose author
   never will (deactivated, left) stay held and are listed for the owner.
6. **Enforcement.** Settings → "الدخول بكلمة السر" shows readiness:
   "{n} موظفين لسه ماسجّلوش دخول بكلمة السر", "{n} أجهزة لسه مش مربوطة",
   "{n} تغييرات مستنية حد يسجّل دخول". "تفعيل للكل" (owner, step-up) sets
   `identity_enforced_at`; from then the server refuses requests without a
   device proof (401) and ops without a person proof (`proof_missing`).
   If the owner does nothing, enforcement starts 30 days after the first
   owner password, with a banner on every device from day 23 (open question
   9).
7. **PIN hashes.** From the update on, `register_device` stops returning
   other members' `pin_hash` / `pin_salt`; a device receives a person's PIN
   hash only from that person's own login (open question 6). Existing
   devices keep what they hold until the person signs in there.

Existing rows are never rewritten: historical actor columns and audit rows
stay as they were recorded; the ledger's evidence columns are null for
everything before the update.

## 8. Sync impact

- **New tables.** `member_passwords`, `member_credentials`,
  `login_attempts`: server-only, never in `SyncableTables::NAMES`, never
  pulled. `memberships` gains `username` and `permissions`, which travel
  with the row (pull, bootstrap, `register_device`'s payload, the login
  response). Local: the `credentials` store and the new op fields above.
- **Rejection reasons.** The six in section 4, each with its Arabic review
  line; `reviewSummary.test.ts` already holds every reason the applier can
  produce to a label, and grows with them.
- **Ordering.** Per device, ops still go up in `created_at` order and the
  server still trusts that order. The sealer and the held-op rule never
  reorder: an op is held, not skipped, while its author has no credential
  here, and every later op on the same `entity_id` (and every op of its
  group) is held with it, matching the server's same-entity blocking. Ops
  of other people and entities go ahead.
- **The seq lock.** Unchanged: `SyncPushController` takes
  `pg_advisory_xact_lock(hashtextextended('sync_seq:' || org_id, 0))` once
  per request, before the first op, and every op — whoever proved it — runs
  under it; switching `app.membership_id` per op never changes
  `current_org()`, so the key is the same. The audit push keeps the shared
  key. The auth functions write `audit_log` and `member_credentials`, never
  `sync_ledger`, so they take no lock. `POST /api/staff/{id}` writes the
  membership and its ledger row like `StaffController::store`, under the
  lock.

## 9. UI screens touched

- **Lock screen** (screen 2): "مين شغّال دلوقتي؟" lists people with a
  credential here; "دخول بحساب" → "اسم المستخدم", "كلمة السر", "دخول";
  "نسيت كلمة السر؟"; errors "اسم المستخدم أو كلمة السر غلط", "محاولات كتير،
  استنى شوية وجرّب تاني", "لازم تكون متصل بالإنترنت أول مرة تدخل على الجهاز
  ده"; staff forgot: "اطلب من صاحب العيادة يعيّن لك كلمة سر جديدة".
- **First sign-in**: "غيّر كلمة السر" ("كلمة السر الجديدة", "اكتبها تاني",
  "حفظ"; "كلمة السر لازم تكون 10 حروف على الأقل", "كلمة السر دي سهلة
  أوي، اختار غيرها"), "اختار رقم سري".
- **Owner recovery / first setup**: "رقم الموبايل", "كود الاسترجاع",
  "كلمة السر الجديدة", "حفظ"; failure "البيانات دي مش صح".
- **Settings → الموظفين**: per person "اسم المستخدم", "الصلاحيات" (the ten
  labels of section 4 as checkboxes; one the caller doesn't hold is shown
  disabled with "مش عندك الصلاحية دي")، "إعادة تعيين كلمة السر", "الأجهزة
  اللي داخل منها" with "إلغاء الدخول من الجهاز ده"; step-up "اكتب كلمة السر
  بتاعتك للتأكيد".
- **Settings → الأجهزة** (owner): every device and who is signed in there,
  "إلغاء الجهاز".
- **Settings → الدخول بكلمة السر** (owner): the readiness lines and "تفعيل
  للكل" (section 7).
- **Every gated action**: hidden, or disabled with "مش عندك صلاحية «{label}»"
  where hiding would confuse (reports in the rail, void and edit on the
  invoice, the cash close button, the settings tabs, archive, send).
- **Sync review**: the six new lines; a banner "فيه تغييرات مستنية {name}
  يسجّل دخول على الجهاز ده"; "اعتمده باسمي" on `actor_deactivated` rows.

## 10. Tests planned

- **Pest.** Schema: every column, check, index and RLS flag above;
  `clintra_app` has no privilege on `member_passwords` or `login_attempts`
  and only SELECT on `member_credentials`; `clintra_auth`'s grants
  column-exact (`ProvisioningRoleGrantsTest.php`). Functions: login success;
  wrong password and unknown username give the same body and status; the
  three limits each trip and clear; a never-completed begin spends the
  limit; rehash on parameter change; `auth_set_password` refuses another
  member; reset and revoke caller rules (owner, `staff.manage`, a staff
  member resetting an owner refused, other organization refused); owner
  recovery's generic failure for bad code, bad phone, used, expired, a
  device-purpose code, and a two-process race on one code (the existing
  `proc_open` harness); `register_device` refuses an owner-recovery code.
  Proofs: a valid ES256 op accepted; a changed byte in payload, `op_id`,
  `entity`, `base_rev` or `group_id` refused `proof_invalid`; another
  device's credential refused; a revoked credential refused; a deactivated
  person's op `actor_deactivated`; an actor column naming someone else
  `actor_mismatch`; a group signed by two credentials refused whole; device
  proof missing (enforced org), stale (over 5 minutes), replayed nonce and
  wrong key → 401; legacy org accepts unsigned ops, enforced org refuses
  them `proof_missing`. Per-person RLS: an assistant listed for location A
  pushing a visit at B from an owner-registered device is refused, and the
  same op signed by the owner is accepted; `audit_log` and `sync_ledger`
  name the proven person. Permissions: for each server-enforced row of the
  catalogue, refused without and accepted with. Escalation: the trigger,
  through `clintra_app` with `app.membership_id` set, allows granting a
  held permission, refuses an unheld one, self-edit, a non-owner touching
  an owner, and a role change. Cross-org: a credential of organization B
  presented on A's device, a login with B's username on A's device, B's
  owner resetting A's member — all refused, nothing written. Log hygiene: no
  password, hash, proof or private material in `laravel.log` for a
  successful and a failed login.
- **vitest.** JCS against `contract/jcs-cases.json`; the op and audit
  messages byte for byte; sealer order and that no signing runs inside a
  Dexie transaction (a test that fails with `PrematureCommitError` if it
  does); held-op selection with same-entity and group holding; permission
  helpers (owner holds all; the UI gate per action); the Dexie upgrade's
  backfill writing no op; the six review labels.
- **e2e (desktop and mobile, `FakeTransport` taught to verify proofs).**
  First sign-in with a temporary password, change, PIN, unlock; offline
  unlock of a signed-in person; a person with no credential refused
  offline; the settings permission editor disabling what the caller
  doesn't hold; a gated action hidden; the review lines.
- **test:live.** Owner setup with a code minted by
  `clintra:mint-activation-code --purpose=owner-recovery`; the owner adds an
  assistant with a temporary password; the assistant signs in on A and
  books — B's audit log and byline name the assistant, proven; an assistant
  op on `schedules` pushed with A's real credential is refused
  `permission_denied` and listed on A; A offline with a queued assistant op
  while B deactivates the assistant → `actor_deactivated` on A and "اعتمده
  باسمي" by the owner lands; the device token replayed from Node without a
  device proof → 401 once enforced; revoking A from B → A's next request 401.

## 11. Size

**XL — about 25-35 working days.** Server: four migrations (schema, role
grants, functions, trigger), JCS and ECDSA verification, `ApplyMembership`
and `SyncPushController` changes, `DatabaseSession::actAs`, the permission
table in the applier, seven endpoints. Web: keys, sealer, held ops, Dexie
version, lock screen, first sign-in, recovery, three settings screens,
review lines, permission gates across the app. Tests as above. It is the
prerequisite for the platform admin's support access and for tightening the
clinical corrections policy.

## 12. Open questions

1. **Keys non-extractable, or wrapped with a key derived from the PIN?**
   Recommended: non-extractable. Wrapping with a 4-digit PIN adds minutes
   to an offline attack and makes the key copyable; non-extractable keys
   cannot leave the device, which is what defeats a stolen token, and
   revocation handles a stolen device.
2. **Reads scoped by device or by person?** Recommended: by device (the
   registration membership's scope), as today. An offline device must hold
   what anyone who may unlock it will need; per-person pull scoping can come
   later as an opt-in "front desk" device kind with no clinical tables.
3. **A deactivated person's queued ops?** Recommended: refused
   (`actor_deactivated`), listed on the device, and adoptable by a holder of
   the needed permission with "اعتمده باسمي". Accepting them by their
   claimed time would let a dismissed person backdate changes.
4. **Does a password reset revoke all of that person's credentials?**
   Recommended: yes, on every device; they sign in again where they work.
5. **How does the first owner password get set?** Recommended: with a
   CLI-minted owner-recovery code (section 7, step 4), never with the legacy
   owner token, so a stolen token cannot claim the account first.
6. **Send a person's PIN hash only to devices where they signed in?**
   Recommended: yes. Today every device receives every member's PIN hash at
   registration, and a 4-digit hash is guessable offline.
7. **Latin-only usernames?** Recommended: yes, `^[a-z0-9][a-z0-9._-]{2,31}$`;
   display names stay Arabic.
8. **Password rules?** Recommended: 10-128 characters, any script, NFC,
   blocklist of the 10 000 most common, not equal to the username, no
   composition rules, no expiry.
9. **Who switches enforcement on?** Recommended: the owner, with "تفعيل
   للكل", and automatically 30 days after the first owner password, with a
   banner from day 23.
10. **Step-up for sensitive actions?** Recommended: yes — password reset,
    credential and device revoke, and every change of usernames,
    permissions and scopes, all online endpoints that require the caller's
    password again; sync carries none of them.
11. **Permissions backfill per role?** Recommended: mirror today's device
    behaviour exactly (section 7, step 2), confirmed against the code when
    the migration is written; the owner adjusts after.
12. **Device-proof window?** Recommended: ±5 minutes on the server-adjusted
    clock, nonces kept 10 minutes per device.

## Decisions (owner, 2026-11-19)

Every open question in section 12 takes its recommended answer:

1. Keys are non-extractable; they are not wrapped with a PIN-derived key.
2. Reads stay scoped by device (the registration membership's scope).
3. A deactivated person's queued ops are refused (`actor_deactivated`),
   listed on the device, and adoptable with "اعتمده باسمي" by a holder of the
   needed permission.
4. A password reset revokes all of that person's credentials, on every
   device.
5. The first owner password is set with a CLI-minted owner-recovery code,
   never with the legacy owner token.
6. A person's PIN hash is sent only to devices where they signed in.
7. Usernames are Latin only, `^[a-z0-9][a-z0-9._-]{2,31}$`; display names
   stay Arabic.
8. Passwords: 10-128 characters, any script, NFC, the 10 000 most common
   blocked, not equal to the username, no composition rules, no expiry.
9. The owner switches enforcement on with "تفعيل للكل", and it switches on
   by itself 30 days after the first owner password, with a banner from
   day 23.
10. Step-up (the caller's password again) for password reset, credential
    and device revoke, and every change of usernames, permissions and
    scopes; all online endpoints, none carried by sync.
11. The permissions backfill mirrors today's device behaviour per role,
    confirmed against the code when the migration is written; the owner
    adjusts after.
12. The device-proof window is ±5 minutes on the server-adjusted clock,
    with nonces kept 10 minutes per device.

Implementation order: C, then A, then B. Every function named in a design is
written out in full SQL in its migration PR, which the owner's reviewer reads
before merge. (A: `docs/design-identity-permissions.md`; B:
`docs/design-platform-admin.md`; C: `docs/design-clinical-corrections.md`.)

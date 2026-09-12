# Authentication plan (for review)

A decision document for the authentication workstream. Each question carries
one recommendation, a one-line rationale, the constraint that binds it (if
any), and a status:

- **decided** — a single default proposed; needs your confirmation to lock in.
- **open** — genuinely under-specified; I do not have enough to default it.

Sources of constraint referenced below: the design reference
`clintra-screens.html` (screens 1 and 2 are the two auth screens), the data
schema `docs/schema.md` (`memberships`, `audit_log`), and the current
`web/src/db/actingMembership.ts`. There is **no standalone written
specification file in this repo**; where a question says "the specification
says X", that wording comes from the task brief and the reference mockup, and
is cited as such rather than as an in-repo document.

One framing point that recurs below and is worth stating once: a **4-digit PIN
has only 10,000 possible values**. No password hash — Argon2id or anything
else — makes a 4-digit secret resistant to offline brute force by someone who
already holds the hash. The PIN's real protection is therefore (1) the hash
never leaving the device, and (2) rate-limiting at the entry surface. The KDF
choice below is defense-in-depth and future-proofing (it also protects longer
secrets and the eventual server side), not the primary control.

---

## Layer 1 — Device registration

### 1. Device identity: localStorage or IndexedDB?

- **Recommendation:** Move `device_id` into IndexedDB (a single `device` row),
  reading the legacy `localStorage` key once to migrate an existing value.
- **Rationale:** IndexedDB is the store the PWA already treats as durable and
  the one eligible for the persistent-storage grant
  (`navigator.storage.persist()`); co-locating `device_id` with the `sync_ops`
  rows that stamp it (`sync_ops.device_id`, schema v2) means identity and the
  data it labels share one fate instead of drifting apart.
- **Constraint:** None in spec or reference — `web/src/db/deviceId.ts` is a
  codebase choice. Note: the premise that "clearing cookies resets it" is
  weaker than it sounds — current browsers do **not** clear `localStorage` when
  you clear cookies (they are distinct stores); the durability/eligibility
  argument above is the real reason to move, not cookie-clearing.
- **Status:** decided.

### 2. How does a device bind to an org + location in v1?

- **Recommendation:** (c) hardcoded via the seed for v1; the real
  registration flow — the reference's screen 1 — ships with Laravel.
- **Rationale:** Screen 1 activates a device with a server-verified
  credential that returns which org/location the device serves; with no
  Laravel backend there is nothing to verify against, so a v1 wizard would
  be throwaway UI over a single seeded org/location.
- **Constraint:** Reference screen 1 (`تسجيل الدخول (وقت التركيب)`, tables
  `users · memberships`, marked "shown once, install day; the assistant will
  never see it"); `docs/schema.md` `memberships`.
- **What breaks if deferred:** Nothing functional in v1 — there is exactly one
  seeded org/location. The wizard becomes necessary only when (i) one build
  must serve more than one org or location, or (ii) staff accounts must be
  provisioned against a server rather than the seed.
- **Status:** decided.

#### Resolution: the registration credential (recorded once the API shipped)

The mockup's screen 1 shows three fields — mobile number, "كلمة المرور"
(password), and "كود العيادة" (clinic code) — and this document's original
rationale above cited "mobile number + password + clinic code" as the
credential set. That wording was imprecise, discovered as a real blocker
when device registration was actually implemented: **"password" names no
field anywhere in `docs/schema.md`, has no hashing scheme, and directly
contradicts this repo's own `docs/session-handoff.md`, which states
elsewhere that "Clintra has no password-based login; device + PIN per
membership only."** There was never a second, separate password —
"password" was the mockup author's informal label for what this document
already calls the staff PIN, and reusing it for registration was rejected
outright: **a 4-digit PIN must never become a network-facing credential.**
The whole point of Layer 2's design (this document's own framing note,
above) is that the PIN's hash never leaves the device; making it do double
duty as a bearer credential sent to a server would contradict that on its
face, regardless of how it's transmitted.

**Resolved credential: owner phone + a one-time activation code.** This is
what screen 1's "clinic code" already gestures at, but with real entropy —
not the mockup's illustrative 4-digit `CLT-4821` — and bound to a specific
org and location, single-use, and expiring. See `docs/schema.md`'s
`activation_codes` (v10) and `api/docs/rls.md`'s registration section for
the full mechanics (`POST /api/devices/register`,
`php artisan clintra:provision` / `clintra:mint-activation-code`).

**A PIN hash does cross the wire exactly once, and this is intentional and
documented, not an exception to Layer 2's invariant.** Registration's
response includes every membership's `pin_hash`/`pin_salt` for the newly
activated org — the device needs them locally to run PIN entry offline,
the same way the seed used to provide them. This single transfer happens
over a channel already authenticated by the activation code (a
server-verified, single-use secret independent of any PIN), immediately
before the device stores the hash and never sends it again. The Layer 2
invariant is precisely "a PIN hash never leaves the device **after
registration**" — registration is the one moment a fresh device doesn't
have it yet and must receive it from somewhere.

#### Resolution: the web side (recorded once screen 1 shipped)

**The response was missing three things the client actually needs to
render from it, found while wiring this up, not while designing it.** All
three were additive, backward-compatible fixes to
`register_device(jsonb)` and `DeviceRegistrationController`
(`2026_09_12_000019_add_rev_to_register_device_response.php`):

- **`device_id`/`org_id`/`location_id`/`membership_id` at the top level.**
  The response returned `organization`/`locations`/`practitioners`/`memberships`
  but never the four scalar ids that say which of them is *this* device's —
  the client already knows `device_id` (it minted it), but not which
  org/location/membership the activation code just resolved it to.
- **Every membership's `rev`.** `memberships` is one of the 14
  row-versioned tables (`2026_09_12_000012_add_row_versioning.php`), and
  the bootstrap forgot it — a device that received a membership row
  without its real `rev` would send a guessed `base_rev` on its first
  edit to it, and a wrong guess reads as a false `conflict_stale_rev`.
- **`users`.** Entirely absent from the original payload, even though
  `web/src/auth/LockScreen.tsx` — the screen this payload exists to
  bootstrap in the first place — joins memberships to users by `user_id`
  to label its PIN picker. Without this, a freshly registered device's
  PIN screen would show membership rows with no name.

**`web/src/domain/appMode.ts` decides demo vs. real registration, by an
explicit query-param opt-in, not by inspecting local state.** `?seedDay=1`
(already existed) or a new `?demo=1` means "seed-based demo/dev boot,
exactly as this app has always worked" — `db/seed.ts` runs, `db/deviceRegistration.ts`'s
`ensureDeviceRegistration` auto-binds a tokenless device, and
`auth/RegistrationScreen.tsx` never shows. Absent both, `App.tsx` checks
whether `device` holds a row with a real `token`
(`db/registration.ts`'s `isDeviceRegistered`); if not, it renders
`RegistrationScreen` and nothing else — not layered under the app shell,
in place of it — until a successful activation flips that check. This
was a deliberate, explicit default change: a plain `/` used to always
auto-seed demo data; it now means "genuinely fresh install" unless told
otherwise. `web/e2e/support.ts`'s `gotoRealDay` was updated to pass
`?demo=1` for exactly this reason; every other e2e entry point already
used `?seedDay=1`.

**What happens to `db/seed.ts`'s demo data on a device that registers
for real: nothing, by construction, not by a new guard.** `seedDatabase()`
already only ever writes when `organizations.count() === 0`
(`web/src/db/seed.ts`'s own doc comment, predating this task). Real
registration's bootstrap (`db/registration.ts`) writes the organization
row *before* `DayScreen.tsx`'s effect ever gets a chance to call
`seedDatabase()`, so that check is already false by the time it runs — no
separate "skip seeding for a real device" flag was needed or added. A
real clinic's device therefore never sees demo patients, and neither
call site had to know about the other's existence.

**Bootstrap rows are written directly (`bulkPut`/`put`), never through
`mutate()`.** Same reasoning as `db/seed.ts`'s own demo data: these are
server-authoritative facts the device didn't create, and must never queue
a `sync_ops` row claiming otherwise (api/docs/rls.md's "The sync endpoint
is accept-or-reject only" is the same principle from the other
direction — a device inventing history for a row it was only ever handed
is the same class of problem as a server inventing a write it wasn't
given).

**`selectSyncTransport` is now wired to a real credential, at last** — the
gap the previous (`feat(web): http sync transport`) task's stop condition
flagged. `App.tsx` reads `device.token` once the registration gate
resolves and passes it straight through; demo mode's device row never has
one, so Fake remains the default there exactly as before. A 401
(`SyncAuthError`) is caught by `sync/engine.ts` and dispatched as
`SYNC_AUTH_ERROR_EVENT_NAME`; `App.tsx` listens app-wide and shows a
persistent, non-blocking banner offering re-registration — it never wipes
local data on its own; only a fresh, successful activation overwrites the
`device` row's token (and, harmlessly, re-`put`s the same
organization/location/practitioner/membership/user rows it already has).

### 3. What happens if a registered device's local DB is wiped?

- **Recommendation:** Re-registration is required — because (per Q1)
  `device_id` now lives in IndexedDB, a DB wipe clears identity and data
  together.
- **Rationale / trade-off:** Co-locating identity with data gives a clean
  invariant — a wipe is a full reset, never a half-state. The alternative
  (keep `device_id` in a separate store so it survives a wipe) leaves a device
  that still *claims* to be registered but has no data behind it, which is a
  more confusing and harder-to-support state than simply re-registering. I am
  recommending fate-sharing over survivability; this is the direction that
  resolves the Q1/Q3 tension, and the two answers must move together.
- **Constraint:** None in spec; follows from Q1.
- **Status:** decided.

### 4. A real device fingerprint (user agent, screen size) against token replay?

- **Recommendation:** No fingerprint in v1. Do not collect UA/screen size for
  anti-replay.
- **Rationale:** Client-collected fingerprints are trivially spoofed and change
  legitimately (browser updates, external monitor), so they add privacy surface
  and false lock-outs while stopping no motivated attacker; the effective
  anti-replay control is a **server-bound signed activation token** issued at
  registration, which belongs with Laravel (see Q2).
- **Constraint:** Spec and reference are **silent** on this — confirmed, no rule
  either way in `docs/schema.md` or `clintra-screens.html`. The recommendation
  is a proposed default, not something the spec forces.
- **Status:** decided.

---

## Layer 2 — Staff PIN

### 1. Which Argon2id library for v1?

- **Recommendation:** `@noble/hashes` (its `argon2id`), pure-JS.
- **Rationale:** It is audited (Cure53), actively maintained (v2.0.1, published
  ~4 months before this writing), implements Argon2id per RFC 9106, and being
  pure-JS it needs no WASM — so no CSP relaxation (`wasm-unsafe-eval`) and no
  extra binary to precache for offline. The obvious WASM alternative,
  `hash-wasm`, is faster but its last release (4.12.0) is ~2 years old, which
  does not meet the brief's "actively maintained" bar. Native PBKDF2 via
  SubtleCrypto remains the zero-dependency fallback if you'd rather ship no
  crypto dependency at all, but it is weaker than Argon2id and, per the framing
  note above, neither meaningfully rescues a 4-digit secret — so prefer the
  audited Argon2id library to honour the spec's letter and to protect the
  eventual server side.
- **Constraint:** Spec requires Argon2id (per brief); `docs/schema.md`
  `memberships.pin_hash`. Library facts verified against npm/GitHub — see
  Sources at the end of this document.
- **Status:** decided.

### 2. Is 4-digit PIN length fixed? Does 6 digits later need a schema change?

- **Recommendation:** Confirm 4 digits for v1; a later 6-digit option needs
  **no schema change**.
- **Rationale:** `pin_hash` stores a fixed-size Argon2id digest whose length is
  independent of how many digits the PIN had; PIN length is a validation
  constant in the entry code, not a storage concern. `memberships.pin_hash` is
  an unconstrained `string` (`web/src/db/types.ts`), so a future 6-digit clinic
  is a one-line validation change, no migration.
- **Constraint:** Reference screen 2 shows a 4-dot entry; `docs/schema.md`
  `memberships.pin_hash` (no length).
- **Status:** decided.

### 3. PIN reset flow when a staff member forgets their PIN?

- **Recommendation:** (a) Owner-initiated reset from the settings screen is the
  target; in v1 (no settings screen yet) there is no self-service reset, and
  recovery is operational — the owner re-provisions the PIN through the same
  install-time path that set it.
- **Rationale:** A PIN reset is a privileged action that belongs to the owner
  role and the settings surface the reference already implies (screen 16);
  (b) a printed one-time recovery code just relocates the secret to a slip of
  paper likely taped to the tablet — a worse threat than the problem; (c) "open
  the DB in dev tools" is not a product. Accepting no in-app reset in v1 is
  tolerable because staff PINs are low-stakes and forgotten-PIN events are rare.
- **Constraint:** Reference screen 16 (settings) implies the owner surface;
  no spec rule on recovery.
- **Status:** decided.

### 4. Lockout after N failed attempts?

- **Recommendation:** 5 attempts, then a 30-second escalating delay — not a
  hard lockout.
- **Rationale:** A 4-digit space (10,000 values) demands *some* rate-limit or it
  falls in seconds to automated guessing; but a hard lockout on a shared
  front-desk device would strand the whole clinic mid-shift over a fat-fingered
  entry. A short, escalating delay defeats scripted guessing without ever
  bricking the desk.
- **Constraint:** Spec is **silent** on lockout — confirmed, no rule in
  `docs/schema.md` or the reference. Proposed default.
- **Status:** decided.

### 5. PIN entry surface: on-screen pad or system keyboard?

- **Recommendation:** On-screen numeric pad, matching reference screen 2, and
  also accept hardware digit keys.
- **Rationale:** The reference commits to a custom pad (`.pin` grid over
  `.dots`), which is the right call on a tablet where the system keyboard is
  slow and oversized for four digits. A custom pad has **no inherent
  accessibility problem** provided each key is a real focusable `<button>` with
  a digit label, the delete key is labelled, physical number keys also drive it,
  and the dots expose progress via an `aria-live`/status region so a screen
  reader announces "2 of 4 entered". Built that way it is at least as accessible
  as a native input.
- **Constraint:** Reference screen 2 (`.pin`, `.dots`, "مين شغّال دلوقتي؟").
- **Status:** decided.

---

## Layer 3 — Session and auto-lock

### 1. Idle timeout — how long?

- **Decision:** 10 minutes of inactivity.
- **Rationale (owner):** A 5-minute lock fires during a normal phone call where
  the assistant is coordinating a reschedule with a patient, forcing a PIN
  re-entry in the middle of the call. 10 minutes covers that case without giving
  the tablet away. (The earlier 5-minute proposal traded that call scenario for
  a marginally faster re-lock; the call scenario is the common one and wins.)
- **Constraint:** Spec names the trigger ("on idle or at shift start") but
  **not the duration** — the number is an owner decision, not spec-derived.
- **Status:** decided (owner).

### 2. What counts as "idle"?

- **Recommendation:** Absence of *user interaction* — no pointerdown, keydown,
  touchstart, scroll/wheel, or tab-refocus — over the timeout window. Not a
  stricter "no writes" definition.
- **Rationale:** Counting scroll and touch as activity means a genuine reader
  (who scrolls or occasionally taps) stays unlocked, honouring "a screen being
  read shouldn't lock"; a "no writes" definition would treat all reading as idle
  and lock almost immediately, which is exactly the failure to avoid. A screen
  left completely untouched for the full window still locks by design — after 10
  minutes of zero interaction, "reading" and "walked away" are indistinguishable
  and locking is the safe call.
- **Constraint:** Spec says "on idle"; the definition is otherwise unspecified.
- **Status:** decided.

### 3. Does every morning re-open require a PIN, even if it never fully locked?

- **Recommendation:** Yes — require the PIN on every cold start and on the first
  foreground after a calendar-day rollover.
- **Rationale:** "Shift start" is a named trigger, and the morning re-opener may
  not be last night's user; the audit guarantee ("who did this") is only true if
  the session reflects who is actually present now. It is cheap to enforce (lock
  on load; lock on date change while backgrounded).
- **Constraint:** Spec: "on idle or **at shift start**."
- **Status:** decided.

### 4. A half-written form when the lock activates — restore or dismiss?

- **Decision:** Keep it open **under** the lock; do not discard. The lock
  overlay covers the entire viewport — nothing behind it is visible or
  interactable — and the underlying UI state, including an open sheet with typed
  values, is preserved and restored on successful PIN entry.
- **Rationale (owner):** Discarding trains staff to keep the session
  artificially alive, or to screenshot before walking away — both worse for
  privacy than the leak we were trying to prevent. With a full-viewport overlay,
  the correct model needs no discard: because the overlay hides everything,
  nothing leaks even on a wrong PIN, so data-loss risk goes to zero while
  privacy stays intact. (This overturns the earlier "discard on lock" proposal,
  whose privacy concern is fully answered by the overlay covering the viewport
  rather than by throwing typed data away.)
- **Implementation constraints this sets:** the overlay must be a true
  full-viewport cover (nothing behind it focusable or hittable, including open
  sheets and the toast), and unlock must restore — not remount-from-scratch —
  the prior UI state so typed sheet values survive.
- **Constraint:** Owner decision; consistent with the spec's actor/privacy
  intent.
- **Status:** decided (owner).

### 5. Which one function replaces `resolveActingMembership()`?

- **Recommendation:** `resolveActingMembership()` itself — same file, same
  signature, same call sites. It stops returning the seeded assistant and
  instead returns the current session's membership from the session store.
- **Rationale:** Every mutation already resolves the actor through this one
  function specifically so auth has a single change site; keeping the signature
  means no call site changes.
- **Constraint:** `web/src/db/actingMembership.ts` doc comment: "the ONLY place
  that needs to change once PIN-based sessions exist."
- **Status:** decided.

---

## Cross-cutting

### 1. One screen in two states, or two distinct screens?

- **Recommendation:** Two distinct screens.
- **Rationale:** The reference has them as separate screens with different
  audiences and different data: screen 1 (`تسجيل الدخول`, install team,
  `users · memberships`, mobile + password + clinic code, "seen once") is
  device activation; screen 2 (`قفل الرقم السري`, every staff member,
  `memberships.pin_hash`, "who's working now?" + 4-dot pad) is the recurring
  per-shift lock. Different frequency, different actor, different tables.
- **Constraint:** `clintra-screens.html` screens 1 and 2.
- **Status:** decided.

### 2. Testing plan to close this workstream.

- **Recommendation:**
  - **Unit** (Vitest): the KDF wrapper (hash→verify round-trips; a wrong PIN
    rejects; a tampered hash rejects); PIN validation (length/charset); the
    failed-attempt/delay state machine as a pure reducer; the idle-timer as a
    pure reducer (events in → next lock state out); the session→actor
    resolution (`resolveActingMembership` returns the session membership, throws
    when locked).
  - **Playwright** (e2e, both viewports): lock screen appears after idle
    (advance the clock via fake timers / `page.clock`); entering the PIN on the
    on-screen pad reveals the day screen; a cold reload requires the PIN
    (shift-start); an open sheet is discarded when the lock fires.
  - **PIN without leaking it into logs:** seed a test membership whose PIN is a
    known **test-only constant** carried in the seed fixture (never
    `console.log`-ed, never a CLI arg, never a URL parameter); drive entry by
    clicking the pad's digit buttons, and assert only on the resulting unlocked
    state, never echo the PIN. Playwright captures screenshots/traces only on
    failure (already configured), and a masked PIN field plus dots-only UI means
    a failure artefact shows dots, not digits.
- **Constraint:** Matches the existing test split (see `web/e2e` and the unit
  suite).
- **Status:** decided.

### 3. The doc line that needs updating once auth ships.

- **Finding / correction:** The brief expects `docs/schema.md`'s actor field to
  describe the dev-only label — but on inspection it does **not**:
  `docs/schema.md` line 129 lists `audit_log`'s `actor_membership_id` neutrally,
  with no dev-only wording, so nothing there needs changing.
- **What actually needs updating** once real actors exist:
  1. `web/src/db/actingMembership.ts` lines 5–11 — the "TEMPORARY … resolves to
     the seeded assistant membership" doc comment (the source-of-truth note).
  2. `docs/design-audit.md` — the two "Phase 1. Not implemented" notes for
     screens 1–2 (lines ~38–50) and decision (c) item 2 (lines ~352–358), which
     describe the actor label as resolved from a stand-in.
- **Status:** decided (identifying the lines; the edits themselves belong to the
  implementation task, not this plan).

---

## Sources (library verification for Layer 2, Q1)

- @noble/hashes — audited (Cure53), actively maintained, v2.0.1 (~4 months
  old), Argon2id per RFC 9106: [npm](https://www.npmjs.com/package/@noble/hashes),
  [GitHub](https://github.com/paulmillr/noble-hashes)
- hash-wasm — WASM Argon2id, latest 4.12.0, last published ~2 years ago (fails
  the "actively maintained" bar): [npm](https://www.npmjs.com/package/hash-wasm)
- PBKDF2 via Web Crypto `SubtleCrypto` — native fallback, no dependency,
  weaker than Argon2id (documented for completeness, not recommended).

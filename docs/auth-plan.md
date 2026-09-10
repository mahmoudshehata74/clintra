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
- **Rationale:** Screen 1 activates a device with **mobile number + password +
  clinic code**, which are inherently *server-verified* credentials that return
  which org/location the device serves; with no Laravel backend there is
  nothing to verify against, so a v1 wizard would be throwaway UI over a single
  seeded org/location.
- **Constraint:** Reference screen 1 (`تسجيل الدخول (وقت التركيب)`, tables
  `users · memberships`, marked "shown once, install day; the assistant will
  never see it"); `docs/schema.md` `memberships`.
- **What breaks if deferred:** Nothing functional in v1 — there is exactly one
  seeded org/location. The wizard becomes necessary only when (i) one build
  must serve more than one org or location, or (ii) staff accounts must be
  provisioned against a server rather than the seed.
- **Status:** decided.

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

- **Recommendation:** 5 minutes of inactivity.
- **Rationale:** Long enough that two bookings ~90 seconds apart never trigger a
  re-prompt; short enough that a tablet abandoned at the front desk re-locks
  before someone has wandered off for a few minutes.
- **Constraint:** Spec names the trigger ("on idle or at shift start") but
  **not the duration** — the number is my default. If you'd rather I not pick a
  number without your sign-off, treat this one as open; I've defaulted it per
  the brief's instruction to recommend a specific value.
- **Status:** decided.

### 2. What counts as "idle"?

- **Recommendation:** Absence of *user interaction* — no pointerdown, keydown,
  touchstart, scroll/wheel, or tab-refocus — over the timeout window. Not a
  stricter "no writes" definition.
- **Rationale:** Counting scroll and touch as activity means a genuine reader
  (who scrolls or occasionally taps) stays unlocked, honouring "a screen being
  read shouldn't lock"; a "no writes" definition would treat all reading as idle
  and lock almost immediately, which is exactly the failure to avoid. A screen
  left completely untouched for the full window still locks by design — after 5
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

- **Recommendation:** On lock, close any open sheet and discard its in-progress
  input; do not restore it behind the lock.
- **Rationale / trade-off:** Restoring risks showing one patient's partial data
  to whoever unlocks next — who may be a different staff member — which is a
  privacy leak across a session boundary. Discarding risks losing a few typed
  fields. Given v1's sheets are short (booking, payment) and the app is built
  for fast re-entry (3-tap booking), privacy clearly outweighs the minor
  convenience of restoring a half-typed form. Revisit only if the long general
  visit form (reference screen 10) becomes a common lock-interruption point.
- **Constraint:** Follows the spec's actor/privacy intent; sheets are ephemeral
  in the reference.
- **Status:** decided.

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

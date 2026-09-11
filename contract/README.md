# contract/

The API contract shared by every client (web today, Android later) and the
Laravel API — the one place cross-cutting shapes live so the clients and the
server can never silently drift onto different definitions of the same
thing.

## reference-data.json

System-wide reference rows: data every organization shares, with fixed,
known ids, rather than each client (or the server) inventing its own. Today
that's the single "general" `specialty_templates` row and its current
`form_definitions` row — see `docs/schema.md`.

**Rule: system-wide reference rows are server-owned.** They are created
only by an API migration (`api/database/migrations/`, run as
`clintra_owner`), never by a client, and never pushed through sync. A
client only ever *reads* the ids in this file — it uses them, it does not
mint its own. This is the **one** allowed place for a hardcoded UUID in
this codebase, and only for `org_id`-null reference rows; every other id
(organizations, patients, visits, ...) stays client-generated, per
`docs/schema.md`'s own id conventions.

Why this matters: before this file existed, `web/src/db/seed.ts` generated
a random UUID for the "general" template on every device. Two devices'
"general" rows had different ids, so `practitioners.specialty_id` and
`visit_form_data.form_definition_id` pointed at device-local ids that would
never match a row on the server — sync would fail on the foreign key the
moment it tried to push either table. Every client and the server now
reference the exact same id for the same reference row, so there is nothing
for sync to reconcile there at all.

## Adding a new system-wide reference row

1. Add it to `reference-data.json` with a fixed UUID v4, generated once.
2. Add/extend the API migration that upserts `reference-data.json`'s rows
   by id (idempotent — safe across `migrate:fresh` and repeated runs).
3. Any client that needs the row's id imports it from this file — never
   regenerates it.

## pin-hash.json

Staff PINs (Layer 2, `docs/auth-plan.md`) are hashed with Argon2id, never
compared or stored in plaintext. The KDF parameters (`t`, `m`, `p`, `dkLen`,
salt length) live here so the web client and the API can never drift onto
different settings and silently produce incompatible digests for the same
PIN — a stored hash is meaningless unless both sides compute it identically.

`web/src/auth/pinHashParams.ts` is a thin re-export of `argon2id` from this
file. The API's PIN hashing (`app/Support/PinHash.php`) reads the same
values. Web hashes with `@noble/hashes`' pure-JS `argon2id`; the API hashes
with `sodium_crypto_pwhash(..., SODIUM_CRYPTO_PWHASH_ALG_ARGON2ID13)` —
different implementations of the same standardized (RFC 9106) algorithm, so
identical parameters + identical salt + identical PIN must produce identical
bytes. `testVector` is a fixed PIN/salt/expected-digest triple, computed
once with the web implementation and asserted against directly by both a
vitest test and a Pest test — if either implementation or its dependency
ever silently changes behavior, that test vector is what catches it.

**Never change `argon2id`'s values without re-deriving `testVector` first**
(hash the same PIN/salt with the new parameters, in either implementation,
and update the expected digest) — a stale test vector would make the tests
lie about which parameters are actually in effect.

## phone-cases.json

Egyptian phone number normalization rules exist twice — `web/src/domain/phone.ts`'s
`normalizeEgyptianPhone` and the API's `App\Support\EgyptianPhone` — because
one runs in the browser and one runs in a console command, so the *code*
isn't shared. The *test cases* are, here: `valid` (an input, its expected
E.164 output, and whether it classifies as `mobile` or `landline`) and
`invalid` (inputs that must be rejected). `web/src/domain/phone.test.ts`
and `api/tests/Feature/EgyptianPhoneTest.php` both iterate this file rather
than keeping their own hardcoded case lists, so a case added to one
implementation's test suite is a case both are proven against.

Adding a new accepted or rejected phone shape: add it here once, not to
either test file directly.

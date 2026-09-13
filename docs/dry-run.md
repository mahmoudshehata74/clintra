# Manual dry run — two real devices, one real deployed API

This is the acceptance gate before any clinic uses the system. Nothing
here is automated: no test runner, no CI job, no fixtures. You run every
scenario by hand, against a real deployed instance of `api/` (real
Postgres, real network), from two real devices (two phones, two tablets,
or two separate browser profiles on two separate machines — anything that
gives each device its own IndexedDB and its own network connection you
can control independently).

It is written so someone who did not build this system can run it. Where
a step needs a database query, the exact query is given. Where a step
needs a UI action, the exact button label (Arabic, as it appears on
screen) is given.

## Before you start

**The `/api` path gap.** Every fetch in the web app calls a relative path
(`/api/devices/register`, `/api/sync/push`, `/api/sync/pull`) — same
origin as whatever served the page. In local dev, Vite's dev-server proxy
sends `/api/*` to `http://127.0.0.1:8000` (`web/vite.config.ts`); that
proxy **does not exist in the production build**. Vercel serves the built
web app as static files, and `api/` is deployed separately
(`web/vercel.json` has no rewrite to an API origin at all). If you deploy
the two independently with nothing bridging `/api/*` to the real API's
host, every scenario below fails at step zero with a network error
indistinguishable from a real outage. Resolve this before scenario 1 —
put both behind one origin, or add a platform-level rewrite/reverse proxy
from the web deployment's `/api/*` to the API deployment's real URL. This
document does not implement that; it only flags that you need it in place
first.

**What you need on hand:**
- A `psql` connection (or equivalent SQL client) to the deployed Postgres
  database, authenticated as `clintra_owner` (or another non-`BYPASSRLS`
  role — never `clintra_fixtures`, which must not exist in a production
  database at all — see `api/docs/rls.md`).
- Shell/SSH access to the machine running the API, so you can stop and
  restart it.
- Two devices, each with browser DevTools available (Network tab,
  Application/IndexedDB tab), and an independent way to cut each one's
  network connection (Wi-Fi toggle, airplane mode, or DevTools' "Offline"
  checkbox in the Network tab).

**One real-model detail that will otherwise confuse you:** `register_device`
only accepts a phone number matching an **owner**-role membership in that
code's org (`api/database/migrations/2026_09_12_000006_add_register_device_function.php`,
`m.role = 'owner'`). In v1, owner and practitioner are the same person
(see memory: owner==practitioner). This means **both devices in this
whole dry run register with the same phone number** — the doctor's own
phone from provisioning — just two different activation codes and two
different device IDs. That's expected, not a bug. If you want the two
devices to show different *actors* in the audit trail and sync review
screens (recommended — it makes the conflict scenarios much easier to
read), add a second staff membership from Device 1's owner-only Settings
→ Staff panel after scenario 2, let it sync to Device 2, and log each
device into a different membership's PIN at the lock screen from then on.

---

## Setup

### Scenario 1 — Provision the organization, and hit the RLS trap on purpose

**Setup:** a freshly deployed API, pointed at an empty database that has
already been migrated (`php artisan migrate --database=pgsql_owner`).

**Steps:**
1. On the API host, run `php artisan clintra:provision`.
2. Answer the prompts: organization name, location name/address/phone,
   doctor's full name and phone (Egyptian format), a 4-digit PIN (entered
   twice).
3. Copy down every printed id (`organization_id`, `location_id`,
   `user_id`, `practitioner_id`, `practitioner_location_id`,
   `membership_id`) and the activation code. **The code is shown exactly
   once** — if you lose it, scenario 1 must be re-run against a fresh
   database, or you fall through to `clintra:mint-activation-code`
   (scenario 3) instead.

**Expected:** the command exits 0 and prints all six ids plus the code in
the format `CLT-XXXX-XXXX-XXXX-XXXX`.

**Verify in Postgres — do this in this order, deliberately:**

First, the trap. Connect with `psql` as `clintra_owner` (table owner,
should in principle see everything) and run a plain query:

```sql
SELECT * FROM organizations;
```

**Expected: zero rows.** This is not a bug and not a connection problem —
`FORCE ROW LEVEL SECURITY` on every table means even the owner sees
nothing until a membership is declared for the session
(`api/docs/rls.md`, "Owner bypass"). If this query returns your new
organization instead of nothing, that is a hard stop: RLS has regressed.

Now query it correctly, using the `membership_id` scenario 1 printed, in
one transaction (the scope only exists inside the transaction it's set
in):

```sql
BEGIN;
SELECT set_config('app.membership_id', '<membership_id from step 3>', true);
SELECT * FROM organizations;
SELECT * FROM locations;
SELECT * FROM practitioners;
SELECT * FROM memberships;
SELECT * FROM activation_codes;
COMMIT;
```

**Expected:** one row in each of the first four; one row in
`activation_codes` with `used_at IS NULL` and `expires_at` 72 hours out.

**Record if it doesn't:** the plain query returning rows (hard stop); the
scoped query still returning nothing (record the exact Postgres error —
likely means `membership_id` was mistyped or the membership isn't
`is_active`).

### Scenario 2 — Register Device 1

**Setup:** Device 1, a fresh browser profile with no prior IndexedDB for
this app, pointed at the deployed web app.

**Steps:**
1. Open the app. It should show the registration screen (screen 1) — a
   fresh device with no token always does (`App.tsx`'s `needs_registration`
   state).
2. Enter the doctor's phone (from scenario 1) and the activation code
   from scenario 1.
3. Submit.

**Expected:** registration succeeds and the app moves past the
registration screen into the lock screen or day screen.

**Verify in Postgres**, scoped exactly as scenario 1's second query
(same `membership_id`):

```sql
BEGIN;
SELECT set_config('app.membership_id', '<membership_id>', true);
SELECT id, org_id, location_id, used_at, used_by_device_id FROM activation_codes;
COMMIT;
```

**Expected:** `used_at` is now set, `used_by_device_id` matches the
device id (visible in Device 1's DevTools → Application → IndexedDB →
`device` table).

Also check the token — **this table has no RLS at all**
(`personal_access_tokens`, deliberately, per `api/docs/rls.md`'s
"Registration"), so no membership needs to be set to query it:

```sql
SELECT id, tokenable_id, name, last_used_at FROM personal_access_tokens ORDER BY created_at DESC LIMIT 5;
```

**Expected:** a new row, `last_used_at` still null (it's only touched on
subsequent authenticated requests).

**Record if it doesn't:** registration returning an error (record the
exact Arabic message shown — every failure here is deliberately generic,
so if you see a raw error code instead, that's itself a finding); the
activation code not showing `used_at` set (means registration didn't
actually reach the server, or committed to a different database than
you're checking).

### Scenario 3 — Mint a second activation code

**Setup:** the same deployed API and database as scenario 1/2.

**Steps:** on the API host, run:
```
php artisan clintra:mint-activation-code <org_id> <location_id>
```
using the ids from scenario 1.

**Expected:** prints a new `CLT-...` code, distinct from scenario 1's.

**Verify in Postgres:** re-run the scoped `SELECT * FROM activation_codes;`
from scenario 1 — expect two rows now, the new one with `used_at IS NULL`.

### Scenario 4 — Register Device 2

**Setup:** Device 2, a second, independent device/profile.

**Steps:** same as scenario 2, but with the code from scenario 3. Use the
**same phone number** (see "Before you start" — `register_device` only
accepts the owner's phone).

**Expected/verify:** identical to scenario 2, against the scenario 3
code's row. After this, `SELECT * FROM personal_access_tokens` should
show two rows, and both devices' local `device` tables should show the
same `org_id`/`location_id`/`membership_id` but different `id` (device
id) and different `token`.

---

## A normal day

Run this whole section start to finish on Device 1, cross-checking
Device 2 after each step. Both devices must be online and their tabs
**visible/foregrounded** — the sync engine only runs its timer while the
tab is visible, and fires immediately on any local write, so this should
all feel close to instant, not something you need to wait minutes for
(`web/src/sync/engine.ts`: an immediate cycle on every `mutate()` commit,
plus a 10-second timer, plus one on every tab-visibility change).

### Scenario 5 — Book, and watch it appear on the other device

1. On Device 1, book a new patient into an open slot.
2. On Device 2, watch the same slot. Note the wall-clock time between
   Device 1's booking confirming locally and the slot appearing occupied
   on Device 2.

**Expected:** appears on Device 2 within roughly one sync interval —
under ~10-15 seconds if both tabs are foregrounded and online. It should
never require a manual refresh.

**Record if it doesn't:** how long it actually took, and whether a
refresh was needed at all (if so, that's a real bug, not a timing note —
the pull cycle is supposed to be automatic).

### Scenario 6 — Arrive, in-room, complete

On Device 2 (the device that *didn't* book it), walk the same visit
through: mark arrived, then in-room, then completed. After each
transition, confirm Device 1 reflects the new status within the same
window as scenario 5.

**Expected:** each status transition is visible cross-device within one
sync interval; the practitioner's queue view updates on both.

### Scenario 7 — Invoice

On whichever device is convenient, open the visit's invoice ("الفاتورة")
from the just-completed visit, add at least one line item, and confirm
the invoice total. Check the other device sees the invoice with a
matching total and invoice number.

**Expected:** invoice number and total match exactly on both devices.
Invoice numbers are sequential per location per year
(`docs/schema.md`'s "invoices" — record if you ever see two devices both
believe they minted the *same* invoice number for two different
invoices; that would be a real conflict this document doesn't otherwise
exercise).

### Scenario 8 — Payment and receipt

Record a payment ("تسجيل دفعة") against the invoice from Device 1 for
less than the full total (a partial payment), then check Device 2 shows
the same payment with the same receipt number ("إيصال رقم N"). Print/view
the receipt ("إيصال الفاتورة") on Device 2 and confirm the amount and
method match what Device 1 recorded.

### Scenario 9 — Close the cash drawer

On Device 1, use "إغلاق الصندوق" (cash close) at the end of the day:
enter the collected amount, confirm the difference calculation, and
confirm. Check Device 2 shows the same cash-close record (expected vs.
collected vs. difference).

**Note for the record, not a failure:** this action writes a `cash_close`
row. It does **not** set `day_state.is_closed = true` — no screen in the
app does that today (`api/docs/rls.md`'s "Closed days are immutable"
confirms this by grep of the whole `web/src/` tree). So the
immutable-closed-day trigger this system has server-side is real but is
not reachable from any UI action in this dry run — don't expect to be
able to exercise it by hand here; that's expected, not something to
report as broken.

---

## The network

### Scenario 10 — Pull the Wi-Fi mid-booking, reconnect

1. On Device 1, start booking a new visit (open the booking sheet, fill
   it in) but don't submit yet.
2. Cut Device 1's network (Wi-Fi off or airplane mode).
3. Submit the booking.
4. Confirm it appears locally immediately (booked slot shows on Device
   1's own screen) and the sync chip changes to "شغّال محلي".
5. Reconnect Device 1's network.

**Expected:** the booking was never blocked by the missing network (step
3 succeeds instantly, offline). Once reconnected, the chip returns to
"متصل" within one sync interval, and the booking appears on Device 2
shortly after.

### Scenario 11 — Kill the API server mid-push, restart it

1. With both devices online, start a booking on Device 1 and submit it
   immediately.
2. Within the next second or two, stop the API process on the server
   (`Ctrl+C` on `php artisan serve`, or the equivalent for however it's
   deployed).
3. Wait ~30-40 seconds (long enough for the client to attempt a few sync
   cycles and fail).
4. Restart the API process.

**Expected:** Device 1's chip should flip to "السيرفر مش راد" (server
unreachable) after three consecutive failed sync attempts — roughly
30 seconds at the default 10-second interval
(`web/src/sync/engine.ts`'s `TRANSPORT_FAILURE_THRESHOLD = 3`). The
booking stays visible locally the whole time (never blocked). Once the
server restarts, the next cycle should succeed, the chip should return to
"متصل", and the booking should reach Device 2.

**Record if it doesn't:** if the chip never shows "السيرفر مش راد" at
all and just silently stays on "متصل" while nothing syncs, that's a real
bug — the assistant would have no way to know sync had stopped working.

### Scenario 12 — The dropped-response case

This is the specific, nastier failure: the server successfully commits
the write, but the response never reaches the device (a proxy timeout, a
cut connection at exactly the wrong moment, a crashed load balancer mid-response).
`op_id` is supposed to make retrying this safe
(`docs/sync-plan.md` Q3) — this scenario is where you actually prove that,
not just read about it.

**How to force it, most reliably:** put a network proxy you control
between Device 1 and the API (e.g. `mitmproxy`, or any small TCP proxy
you can script) that forwards the request through normally, waits for the
upstream response, and then closes the connection to the device *without*
forwarding that response. If you don't have a proxy tool handy, an
approximate, less reliable alternative: throttle Device 1's connection
heavily in DevTools (Network tab → "Slow 3G" or a custom very-low-bandwidth
profile), submit a write, and cut Device 1's network (Wi-Fi off) the
instant the request shows as sent-but-pending in the Network tab, before
the response arrives. This second method takes a few tries to land in
the right window — that's expected; keep the request visible in the
Network tab so you can see exactly when it was sent.

**Steps:**
1. Force the drop on a single, identifiable write (e.g. a new booking
   with a patient name you'll recognize).
2. Immediately check Postgres directly — **do not check the device's own
   screen first**, since the device doesn't know yet:
   ```sql
   BEGIN;
   SELECT set_config('app.membership_id', '<membership_id>', true);
   SELECT id, patient_id, visit_date, status FROM visits WHERE patient_id = '<the patient id you booked>';
   COMMIT;
   ```
   **Expected:** the row is already there, committed, even though Device
   1's UI may still show the booking as unsynced or may have shown a
   transient error.
3. Let Device 1 reconnect normally and let its sync engine run its next
   cycle (no manual retry needed — `runSyncCycle` re-sends any unsent op
   automatically).

**Expected on retry:** the server recognizes the `op_id` as already
applied and returns `duplicate`, not `accepted` again
(`docs/sync-plan.md` Q3; `SyncOpApplier` checks `sync_ledger` before any
write). The device marks the op synced without creating a second row.

**Verify no duplicate was created:**
```sql
SELECT count(*) FROM visits WHERE patient_id = '<the patient id>';
SELECT count(*) FROM sync_ledger WHERE entity_id = '<the visit id>';
```
**Expected:** exactly one row in each, not two.

**Record if it doesn't:** a second `visits` row for the same booking, or
two `sync_ledger` rows for the same `entity_id` — either is a real
idempotency bug, not a network flake.

### Scenario 13 — All four chip states, and confirm the assistant is never blocked

Walk through each state deliberately and, in **each** one, perform an
ordinary action (book a visit, or advance a queue status) to confirm
nothing is ever blocked by sync status — this is a brief requirement
("a small indicator only... never blocking"), not a nice-to-have.

| State | Label shown | How to force it |
|---|---|---|
| Online | "متصل" | Normal operation, both devices connected, nothing pending review. |
| Local-only | "شغّال محلي" | Turn off Device 1's Wi-Fi/data. Should flip immediately (`navigator.onLine`). |
| Server unreachable | "السيرفر مش راد" | Scenario 11's setup: network interface up, API process down. Takes ~30s (3 failed cycles) to appear, and the same to clear. |
| Needs review | "فيه حاجة محتاجة مراجعة" | Any conflict from the next section. Outranks all three other states — trigger one while offline/server-unreachable and confirm this label wins. |

For each state: perform a booking or a status change while it's showing,
and confirm it completes with no dialog, no blocking spinner, no error
toast — only the small chip. Record any case where an action is
refused, delayed waiting on network, or produces a popup.

---

## Conflicts

Both scenarios below need to genuinely happen offline on both devices at
once — do the "go offline" step on **both devices before either one
touches the conflicting data**, not sequentially, or you'll just get an
ordinary sequential write instead of a real conflict.

### Scenario 14 — Two devices book the same slot while both offline

1. Disconnect both Device 1 and Device 2's networks.
2. On Device 1, book Patient A into slot X.
3. On Device 2 (still offline, has no idea Device 1 just did this), book
   Patient B into the same slot X.
4. Reconnect Device 1 first. Let it sync fully (chip returns to "متصل").
5. Then reconnect Device 2.

**Expected:** whichever device's push reaches the server *first* — Device
1 in this ordering — wins the slot outright, `accepted`. Device 2's
create for the same slot comes back `rejected`/`conflict_slot_taken`,
which becomes a "فيه حاجة محتاجة مراجعة" row on Device 2 specifically —
Device 1 sees nothing unusual at all, since its own booking was simply
accepted.

**On Device 2, open the review chip and exercise both actions — on two
separate copies of this scenario, since each action consumes the review
row:**

- **"خليها كده" (keep mine):** the patient's visit row survives locally,
  but its status becomes cancelled with reason `sync_conflict`
  (`domain/visitStatus.ts`) — this is what actually frees the slot back
  up visually. Confirm the slot no longer looks confirmed on Device 2,
  and confirm Patient B's record itself is *not* deleted (open the
  patient's own record and confirm it's still there — "keep mine" must
  never lose the patient, only the slot claim).
- **"شيلها" (discard mine):** the phantom local row is deleted outright.
  Confirm Device 2's grid now shows exactly what Device 1's does for that
  slot (Patient A, since it won).

**Record if it doesn't:** the review row missing the "waiting for
server" state before a pull actually completes (`getReviewComparison`'s
`ready` gate) — if either action is offered before Device 2 has pulled at
all, that's a bug, since there'd be nothing real to show yet.

### Scenario 15 — The chronologically-older-loses case, deliberately

This is the documented deviation from the brief (the brief says "the
chronologically older wins"; this system implements first-*arrival*-wins
instead — `docs/sync-plan.md` Q4/Q5/Q7). Make it happen on purpose so you
see the actual losing screen, not just read the explanation.

1. Disconnect both devices.
2. On Device 2, book slot Y **first** (note the time).
3. Wait a full minute or two.
4. On Device 1, book the **same slot Y**, later in wall-clock/chronological
   time than Device 2's booking.
5. Reconnect **Device 1 first** this time (the chronologically-*later*
   booking reconnects *first*).
6. Only after Device 1 has fully synced, reconnect Device 2 (the
   chronologically-*earlier* booking, reconnecting *last*).

**Expected — and this is the deviation, not a bug:** Device 1 wins the
slot, even though its booking happened later in real time. Device 2 —
the one that booked *first*, chronologically — gets the rejection and
the "keep mine"/"discard mine" review, exactly as scenario 14, despite
having the earlier `created_at`. Record the exact wall-clock times of
both bookings and confirm the loser is the chronologically earlier one,
so this is provably the deviation and not coincidence.

**This is expected behavior, not a finding to write up as a bug** — it's
already a named, deliberate trade-off (`api/docs/rls.md`'s "Slot
conflicts: accept-or-reject, not chronologically-older-wins"). Record it
in the results table as **pass** if the losing side is the
chronologically-earlier booking and the review flow behaves exactly as
scenario 14; record it as a genuine failure only if the *later* booking
somehow loses instead (that would mean the implementation doesn't even
match its own documented deviation).

### Scenario 16 — Same patient edited on both devices, offline

1. Disconnect both devices.
2. On Device 1, edit an existing patient's phone number.
3. On Device 2, edit the **same patient's** name (a different field, to
   make the diff easy to read — the mechanism doesn't care which field).
4. Reconnect Device 1 first, let it fully sync.
5. Reconnect Device 2.

**Expected:** Device 1's edit applies cleanly (`accepted`, and the row's
`rev` increments). Device 2's edit is rejected as `conflict_stale_rev`
(its `base_rev` no longer matches) once it reaches the server, and turns
into a review row on Device 2 once Device 2 has pulled Device 1's
version (the `ready` gate again — don't expect the review actions to be
offered instantly on reconnect; give it one more sync cycle to pull).

**Exercise both actions, on two separate copies of this scenario:**

- **"خليها كده" (keep mine):** Device 2's edit is rebased onto the
  current `rev` and resent — it should end up applied on top of Device
  1's edit (both the phone number and the name change should be present
  afterward, on both devices).
- **"شيلها" (discard mine):** Device 2's local row is overwritten with
  the server's version — Device 2's name edit is dropped; Device 1's
  phone edit is what both devices show afterward.

**Record if it doesn't:** either action leaving the record in a state
that matches *neither* device's edit (that would violate the "never lose
data — always end up with one deliberately chosen version" guarantee);
the review sheet showing a raw reason code instead of a real Arabic label
(`conflict_stale_rev` leaking as text rather than being translated).

---

## Device replacement

Treat this as a first-class scenario: a live clinic, mid-day, with a real
schedule already booked, losing a device and needing a working
replacement fast.

### Scenario 17 — Register a replacement device mid-day

**Setup:** Device 1 and Device 2 both have a realistic amount of today's
schedule already booked and synced (several visits across different
statuses, at least one invoice, one payment). Treat Device 2 as "lost."

**Steps:**
1. Mint a fresh code for a replacement: `php artisan clintra:mint-activation-code <org_id> <location_id>`.
2. On a **third**, brand-new device/profile ("Device 3"), register using
   that code and the same owner phone.
3. Note the exact wall-clock time registration completed (token issued).
4. Watch Device 3's day screen. Note the wall-clock time it first shows
   **today's already-booked schedule correctly** — every visit Device 1
   and Device 2 already created, with their current statuses.
5. Open DevTools → Network on Device 3 while this happens. Filter for
   `/api/sync/bootstrap` and `/api/sync/pull` **separately**. Record, for
   each: how many requests fired, and the total response size summed
   across them.

**Fixed since this document was first written — verify the fix, don't
just assume it.** `GET /api/sync/pull` still pages strictly in ascending
`sync_ledger.seq` order, oldest first
(`api/app/Support/Sync/SyncPuller.php`), and that is unchanged and
unchangeable without breaking its cursor's monotonic guarantee for every
already-synced device. What changed is that a device with no prior
cursor now calls a second, separate endpoint first —
`GET /api/sync/bootstrap` (`App\Support\Sync\SyncBootstrapPuller`) —
before it ever starts that historical walk. Registration's own bootstrap
response already gave Device 3 the org, its locations, practitioners,
memberships and users directly; `GET /api/sync/bootstrap` now also gives
it, fast, the current state of every `day_state` and `visits` row inside
the brief's own 60-day-back/60-day-forward window, plus the `patients`
those windowed visits reference — in practice, today's grid, correctly
occupied, within a page or two, before the oldest-first `/api/sync/pull`
backfill has made any progress at all. `GET /api/sync/pull` then runs
immediately afterward exactly as before, unpaginated-by-date, walking the
*entire* history from the beginning — re-delivering what bootstrap just
sent (harmless: an upsert by id) and eventually reaching everything
bootstrap's window didn't cover.

**What bootstrap deliberately does not cover — confirm this is what you
actually see, not a regression:** invoices, payments, and any patient
with no visit inside the 60-day window are **not** part of the fast
path — they still arrive only once `/api/sync/pull`'s oldest-first
backfill reaches them. So the honest expectation is: today's slots,
statuses, and the names of patients seen today should be correct almost
immediately; a completed visit's invoice/payment amounts, and the wider
patient list, may still lag behind for a while. That split is a
deliberate, bounded scope decision (`docs/sync-plan.md`'s Q9 addendum),
not a partial fix — record it as a **note**, not a **fail**, unless
today's grid itself (slots/statuses/today's patient names) is what's
missing or wrong.

**Record:**
- Wall-clock time from token issuance to a *fully correct* today's
  schedule (slots, statuses, today's patient names) on Device 3 — this
  should now be seconds, not minutes.
- Number of `/api/sync/bootstrap` requests and bytes, separately from
  `/api/sync/pull`'s — bootstrap should be a handful of small requests;
  pull's own count/size is whatever the org's full history still is
  (see the finding below).
- Whether today's grid itself ever showed anything actively *wrong* (a
  slot showing empty when it's actually booked) rather than merely
  *incomplete elsewhere* (an invoice amount, or an older patient's
  history, not yet visible) — the former is a real defect; the latter is
  the documented, bounded scope of this fix.

### Scenario 18 — Kill the lost device's token

**Fixed since this document was first written.** There is now a real
revoke path: `php artisan clintra:revoke-device {device_id}`
(`App\Console\Commands\RevokeDevice`), run by whoever has CLI access to
the API host — the same operator who already runs `clintra:provision`/
`clintra:mint-activation-code`. No new database role was needed for
this (an earlier draft of the fix added one; it turned out unnecessary —
see `api/docs/rls.md`'s "Revoking a device" for why).

**Steps:**
1. With Device 3 successfully registered and Device 2 treated as
   permanently lost, run:
   ```
   php artisan clintra:revoke-device <Device 2's device id>
   ```
2. Confirm the command reports the device id, its org, and how many
   tokens it deleted (normally 1).
3. On Device 2 (leave it running, don't touch it), wait for its next
   sync cycle — no action needed on that device itself.

**Expected:**
- Device 2's next request of any kind gets a 401, identical in shape to
  a request with no credential at all (`{"error": "unauthenticated"}`) —
  it cannot tell "revoked" apart from "never registered."
- Per `App.tsx`'s `SYNC_AUTH_ERROR_EVENT_NAME` handling (already covered
  by scenario 13's chip states), Device 2 shows its re-authentication
  banner rather than silently failing — confirm this still holds; it was
  already true before this fix and should not have changed.
- **Device 2's local data is not wiped.** Revocation kills the
  *credential*, not the device's own IndexedDB — the assistant's booking
  history up to that point stays on the tablet even though it can no
  longer sync. Confirm this explicitly: open Device 2's DevTools →
  Application → IndexedDB after revoking and see the data still there.
- Running the same command again against the same device id is safe —
  it reports the existing revocation rather than erroring or writing a
  second audit entry.

**Record if it doesn't:** any request from Device 2 succeeding after
revocation (hard stop); Device 2's local data disappearing on its own as
a side effect of the 401 (hard stop — a clinic must never lose a day's
work because a *different* device was revoked); the re-run not being
idempotent.

2. After running one of the above, confirm Device 2 (if it ever comes
   back online) gets a 401 on its next sync attempt and — per
   `App.tsx`'s `SYNC_AUTH_ERROR_EVENT_NAME` listener — shows whatever
   re-registration banner exists, rather than silently failing forever.

**Record:** whether this manual deletion actually locks Device 2 out
(it should, per the `device_exists()` code path); and, regardless of
outcome, flag "no supported device-revocation feature exists" as its own
line item in the closing table below — this is a product gap, not
something scenario 18 can "pass."

---

## Closing

### Results

| # | Scenario | Pass/Fail | Notes |
|---|---|---|---|
| 1 | Provision org + RLS trap | | |
| 2 | Register Device 1 | | |
| 3 | Mint second code | | |
| 4 | Register Device 2 | | |
| 5 | Book, cross-device | | |
| 6 | Arrive/in-room/complete, cross-device | | |
| 7 | Invoice | | |
| 8 | Payment + receipt | | |
| 9 | Close cash drawer | | |
| 10 | Wi-Fi drop mid-booking | | |
| 11 | Kill API mid-push, restart | | |
| 12 | Dropped-response idempotency | | |
| 13 | Four chip states, never blocked | | |
| 14 | Same-slot conflict, both actions | | |
| 15 | Chronologically-older-loses, deliberate | | |
| 16 | Same-patient edit conflict, both actions | | |
| 17 | Device replacement, timing + data | | |
| 18 | Revoke lost device's token | | |

### Hard stop vs. note for later

**Hard stop — do not let a clinic use this until fixed:**
- The plain (unscoped) Postgres query in scenario 1 returns rows — RLS
  regression.
- Any duplicate row created after the dropped-response retry (scenario
  12) — idempotency is broken.
- Any action refused or blocked by sync state in scenario 13 — violates
  the brief's core "always works, network or not" guarantee.
- Either review action in scenario 14/16 leaving data matching neither
  device's version, or silently discarding data with no review at all.
- The `/api` origin gap ("Before you start") not resolved — nothing else
  in this document can even run.

**Note for later — real, but doesn't block launch on its own:**
- Scenario 15's chronologically-older-loses outcome (already a known,
  documented, deliberate trade-off — confirm it, don't "fix" it here).
- Scenario 17's pull-orders-oldest-first delay on device replacement —
  **fixed** for the part that matters most (today's schedule now arrives
  via `GET /api/sync/bootstrap` in seconds, verify this is what you
  actually see); the underlying full-history backfill (`GET /api/sync/pull`)
  is unchanged and still downloads everything, oldest-first, in the
  background — see the estimate below for what that still costs a
  mature clinic, now as a background-latency concern rather than a
  today's-schedule-blocking one.
- Scenario 18's missing revoke mechanism — **fixed** (`php artisan
  clintra:revoke-device`); confirm the idempotency and no-data-wipe
  behavior still hold, but this is no longer an open gap to plan around.

### The unwindowed pull: what it means for a clinic six months in

**Update: the today's-schedule-latency half of this finding is fixed
(see scenario 17) — the total-history-size half is not, and was never
meant to be by that fix.** `GET /api/sync/bootstrap` means a replacement
device no longer has to wait for its history backfill to reach today's
data — but `GET /api/sync/pull` itself still has no age cutoff at all
(`api/app/Support/Sync/SyncPuller.php`; `api/docs/rls.md`'s "The sync
pull endpoint" names this explicitly as an open item) and still
downloads the organization's **entire** history, oldest-record-first,
exactly as before. The difference is that this now happens *after* the
device is already usable, in the background, rather than *before* — a
latency-to-usability problem turned into a bandwidth/background-sync-time
problem. The estimate below is unchanged and still worth reading: it's
no longer "how long until today's schedule shows up," but it is still
"how long until this device's local history is actually complete, and
how much data that costs on a bad connection" — both real questions for
a mature clinic.

**A rough estimate**, stated with its assumptions so it can be
re-checked against a real clinic's actual volume: a small single-location
clinic doing ~20 visits/day, 6 days/week, for 6 months is roughly 3,100
visits. Each visit's lifecycle (create, a couple of status transitions,
an invoice, a payment) is conservatively ~5-6 `sync_ledger` rows, plus
patient records (mostly one row each, a few edits) and daily
`day_state`/`cash_close` rows. That's on the order of **15,000-20,000
ledger rows** for six months of one clinic. At the pull endpoint's fixed
page size of 200 rows (`api/docs/rls.md`'s "The sync pull endpoint" —
"Page size is 200"), that's **75-100+ sequential round trips**, each one
waiting for the previous page's response before the next request goes
out (`runPullCycle`'s `while (hasMore)` loop is sequential, not
parallel). Each `visits` row alone carries roughly twenty columns
(`api/docs/rls.md`); a reasonable per-row JSON estimate across all
synced entity types is 400-700 bytes, so a full page is roughly
80-140 KB, and the full six-month history is on the order of
**6-14 MB** total.

On a genuinely weak connection — say the kind of link the offline-first
architecture exists for in the first place, not a clinic's best day —
both the data volume and the round-trip count matter independently: 10
MB at a sustained 150 kbps is itself several minutes, and 90 sequential
round trips at even 500ms-1s of latency each adds another minute or two
on top, with no parallelism to hide it. **The practical number to expect
for a replacement device at a six-month-old clinic, on a bad connection,
is "several minutes before this device's local history is actually
complete,"** not seconds — but, since the bootstrap fix, that time no
longer stands between the assistant and a working, correctly-populated
day screen; it's happening underneath her, same as any other background
backfill.

**Whether this changes the retention decision:** the brief's own 60-day
local-storage window was written for *device storage size*, and that
question is untouched by the bootstrap fix — bootstrap only changes
*ordering/latency for a fresh device*, not how much history a device
that's been running for months eventually accumulates and stores
locally forever (the same client-side pruning gap `docs/session-handoff.md`
already names as its own open item). If a real windowing rule is ever
implemented for `GET /api/sync/pull` itself (the same open item
`docs/sync-plan.md`'s Q9 already flags — no principled date exists for
`patients`/`services`/`memberships`, only for `visits`/`day_state`), it
would shrink this section's estimate directly; it is no longer needed to
fix the ordering problem specifically, since bootstrap already solved
that half independently, ahead of and without depending on a pull-side
windowing decision. This document does not decide or implement a pull
windowing rule; it only confirms the remaining size problem is real and
roughly quantifies it.

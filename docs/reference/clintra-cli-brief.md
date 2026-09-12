# Clintra — CLI Working Brief (v1 · Web first, Android later)

> Upload this file at the start of every new CLI session and write:
> **"Read this file in full. Current phase: __. Give me one step."**
> Upload alongside it: `clintra-v1-spec-rtl.pdf` and `clintra-screens.html`.
>
> This file is NOT part of the repository. Keep it outside the repo or in `.gitignore`.

---

## 0 · Roles and response rules

- **The user** runs commands in the terminal and pastes the output or error back.
- **You (CLI)** execute **one step at a time** and stop. You do not run ahead.

Fixed rules — never broken:

1. One step per response. Never five commands at once.
2. Every step must end in something **visible or testable**. Never end a step with
   "backend is ready but there is no screen".
3. If the output contains an error, reply with a **fix**, not with theory.
4. Decisions in section 4 are settled. If you disagree, say it in one line and move on.
5. Missing information = **one specific question**, not five.
6. No feature outside v1 scope, even if it looks easy.
7. All prompts, code, comments, commit messages, and docs are in **English**.
   All user-facing UI strings are in **Arabic (RTL)**.

---

## 1 · Platform decision

**Web first (temporarily). Android comes later.**

Consequences, mandatory:

- The backend is a **standalone Laravel API**. The web app is one client; Android will be
  a second client of the same endpoints.
- No operational logic (state machine, pricing, scope rules, validation) may live only in
  the frontend. It lives in the API, and its contract lives in `contract/`.
- The web app is an installable PWA that opens and works with the network down.

**Build order note:** the frontend is built first against a local store and a fake
transport. Phase 1 (scope isolation) therefore closes **twice** — once provisionally on the
client, once for real when the Laravel API and RLS exist. Real isolation is a database
property and is not measurable before then.

---

## 2 · The product in five lines

**Clintra** — a clinic operating system for Egypt.
v1 replaces the clinic's paper appointment book: faster, works offline, and tells the
doctor at the end of the day how many came in and who was lost.
The primary user is the **clinic assistant**, not the doctor.
The first customer is a **general clinic with no specialties**.
Language is **Arabic, RTL**. Timezone is **Africa/Cairo**.

---

## 3 · The seven principles

1. Every event is linked to what came before and after it. **Arrival** is what drives the
   counter and the revenue — there is no parallel manual log.
2. The UI is shaped by **how many things the user can see**, never by a setting called "type".
3. **Isolation lives in the database, not in the code.** Any query that forgets the filter
   must return zero rows.
4. Offline operation is a base requirement, not a later optimisation.
5. Speed is a delivery criterion **measured with a stopwatch**.
6. Future seams are built empty now (an empty column costs nothing).
7. Every action on data is recorded under the name of whoever performed it.

---

## 4 · Settled decisions — not up for discussion

| Item | Decision |
|---|---|
| Name | Clintra |
| Primary user | Clinic assistant |
| First specialty | General — a two-field form only |
| Database | PostgreSQL with Row-Level Security |
| Identifiers | UUID v4 **generated on the client**, never on the server |
| Money | Integers in piastres — **no floats, ever** |
| Patient name | One field `full_name` — never split |
| Phone | Stored as E.164, displayed locally |
| Dates | Day as `date` (local) · timestamps as `timestamptz` |
| Auth | Registered device + a PIN per staff member |
| Statuses | `no_show` is a status independent of `cancelled` |
| Forbidden access | Returns **404**, never 403 |

**Absolutely forbidden:** a column named `clinic_type`, `mode`, or `scenario`.
Different situations are expressed through data, never through code branches.

---

## 5 · v1 scope

**In scope:**
Booking in two modes (slots / queue) · edit, reschedule, cancel with reason · walk-in
patient · doctor delay entry · full visit status machine including `no_show` · instant
search · printable day sheet · offline operation and sync · a PIN per staff member ·
audit log · two-field visit form · invoice, partial payments, numbered receipt · daily
cash close.

**Out of scope — deliberately:**
Any messaging or reminders · online booking · specialty forms · care-plan screens ·
analytics and charts · any AI.

**Built now as empty tables, with no screens:**
`care_plans` · `care_plan_items` · `specialty_templates` (one row: `general`) ·
`form_definitions`.

---

## 6 · Approved stack

| Layer | Choice |
|---|---|
| Editor | VS Code + ESLint · Prettier · Tailwind · Error Lens |
| Runtime (web) | Node.js 22 LTS + pnpm |
| Frontend | React + TypeScript on Vite (single-page app) |
| Offline | vite-plugin-pwa (service worker) |
| Local store | IndexedDB via Dexie |
| Styling | Tailwind with logical properties + self-hosted fonts |
| Client validation | Zod |
| Backend | Laravel 13 on PHP 8.4 |
| Server data access | Eloquent + migrations; RLS policies as raw SQL migrations |
| Database | PostgreSQL 16, managed (Neon) |
| Server auth | Sanctum device tokens + 15-minute access token + Argon2id PIN hash |
| Server validation | Form Requests |
| Contract | `contract/` — OpenAPI + shared enum constants |
| Tests | Vitest + Playwright (web) · Pest (API) |
| Hosting | Web: Vercel · API: Railway (Docker) · DB: Neon |
| CI | GitHub Actions |

No package outside this table without one line justifying it.

---

## 7 · Repository layout

```
clintra/
├─ web/               React + Vite + TS + PWA          (built first)
├─ api/               Laravel 13                       (built second)
├─ contract/          OpenAPI spec · status enums · field names
├─ docs/
├─ e2e/               Playwright — the simulated clinic day
└─ .github/workflows/
```

Rule: anything Android will need later belongs in `contract/` or in the API — never only
in `web/`.

---

## 8 · Frontend-first architecture (non-negotiable)

- The UI **reads and writes IndexedDB only**. No screen ever awaits the network.
- All server communication sits behind a single interface, `SyncTransport`, with two
  implementations: `FakeTransport` (now) and `HttpTransport` (once the API exists).
  Swapping them is a one-line change.
- Every mutation is appended to a local operation queue:
  ```
  sync_ops (op_id uuid, entity, entity_id, action, payload,
            device_id, created_at, synced_at?)
  ```
- `op_id` is unique and sent with every operation. The server ignores any duplicate
  `op_id` — this is what prevents duplication on retry.
- Operations upload in chronological order per device.
- On a conflict over the same slot: **the chronologically older wins**; the loser becomes
  `needs_review` and is shown to the staff member. Never silently deleted.
- Local storage covers the last 60 days and the next 60 days.
- A small indicator only: online / working locally. **No intrusive error messages.**
- Fonts and icons are bundled in the app. Nothing is fetched from an external network at
  runtime.

---

## 9 · Mandatory code rules

1. **Identifiers:** `crypto.randomUUID()` on the client before sending. In Laravel, models
   set `$incrementing = false` and `$keyType = 'string'`, and must **not** generate UUIDs.
2. **Money:** integer piastres end to end. `bigInteger` columns, no decimal casts, no
   float anywhere. Any division is rounded explicitly in one known helper.
3. **Name:** `full_name` only. No `first_name` / `last_name` anywhere, not even in a
   temporary form.
4. **Phone:** converted to E.164 on save, rendered locally on display. Not unique —
   family members share a number.
5. **Time:** all day calculations in `Africa/Cairo`. Never rely implicitly on the browser
   timezone.
6. **Constraints live in the database, not in code:**
   ```sql
   UNIQUE (practitioner_id, visit_date, position)
   UNIQUE (practitioner_id, visit_date, scheduled_at)  -- except is_overbooked
   UNIQUE (org_id, phone) ON users
   UNIQUE (location_id, number) ON invoices
   INDEX (org_id, location_id, visit_date, status) ON visits
   INDEX (org_id, full_name text_pattern_ops) ON patients
   ```
7. **State machine** — defined once in `contract/`, enforced in the API:
   ```
   booked -> confirmed -> arrived -> in_room -> completed
   booked -> cancelled    (cancel_reason = patient | clinic)
   booked -> no_show      (cancel_reason = no_show)
   booked -> rescheduled  (creates a new visit via rescheduled_from)
   ```
   Any transition not listed is rejected with a clear error.
8. **`no_show` is never set automatically and silently.** At day close, every visit still
   `booked` whose time has passed is listed together for the staff member to mark.
9. **Practitioner availability is computed across all locations.** Someone booked at 7pm in
   one location must appear busy in the other.
10. **Audit log** is written on every change to: visits · patients · invoices · payments ·
    memberships · schedules. Attributed to the acting membership, never to the device.
11. An invoice can never be voided after any payment is recorded.
12. Every payment has its own receipt number. Printing the invoice is not a substitute for
    the receipt.

---

## 10 · Isolation and auth (Laravel specifics)

- RLS is enabled on every table carrying `org_id`.
- The request carries **the membership id only**:
  ```sql
  SELECT set_config('app.membership_id', ?, true);
  ```
  Executed inside the same transaction as the request's queries.
- Helper functions defined once: `current_org()` · `allowed_locations()` ·
  `allowed_practitioners()`.
- Policy template:
  ```sql
  CREATE POLICY visits_scope ON visits USING (
    org_id = current_org()
    AND location_id IN (SELECT * FROM allowed_locations())
    AND practitioner_id IN (SELECT * FROM allowed_practitioners())
  );
  ```

Four traps that must be handled explicitly:

1. **The application must connect as a dedicated non-superuser role that does not own the
   tables**, and every table uses `ALTER TABLE ... FORCE ROW LEVEL SECURITY`. A table owner
   bypasses RLS silently, which makes every policy look like it works while it does not.
2. With connection pooling, the session variable must be set per transaction (`is_local =
   true`) so it cannot leak into the next request on a reused connection.
3. An empty link table never means "all". Scope is stated explicitly by
   `location_scope` / `practitioner_scope`; the link tables only enumerate.
4. The token carries `user_id` and `membership_id` **only**. Any scope arriving from the
   client is ignored entirely. The server reads the membership from the database on every
   request, so permission changes take effect immediately.

Other auth rules:

- Device registered once at installation time -> long-lived token bound to `device_id`.
- Short access token, 15 minutes, refreshed automatically.
- A four-digit PIN per staff member, Argon2id-hashed in `memberships.pin_hash`.
- The PIN is requested on idle or at shift start. Every operation is recorded under the
  PIN owner.
- Requesting a record outside scope returns **404**, never 403.
- Hiding a button in the UI is not security. Every endpoint refuses on its own.

---

## 11 · Mandatory UI rules

- Visible locations = 1 -> **the location switcher is hidden entirely**.
- Visible practitioners = 1 -> **the practitioner column, its filter, and its booking field
  are hidden**.
- The app opens directly on **today**. No date picker on the main screen.
- **Name is the only required field** when creating a patient, next to a "no phone number"
  button.
- No confirmation dialog after each action. A light toast with a **five-minute undo**.
- Destructive actions live in a separate menu, away from daily actions.
- The print header is a **required setup step**. No printable default values.
- `arrived`, `in_room`, and `completed` are each **one tap from the day list**. If any of
  them needs a separate screen, the staff member will not do it and the data is lost.
- The audit log is presented to the doctor as a timeline, never as staff surveillance.

**Design tokens:**

- Ink `#16211D` · Paper `#FBFAF7` · Green `#1D5B4A` · Light green `#E8F0EC`
- Red `#B23A34` · Amber `#8A6A22` · Border `#E2E3DC` · Grey `#6E7370`
- Radius `8px` for elements, `12px` for frames
- Headings: **Readex Pro** · Body: **IBM Plex Sans Arabic** — both self-hosted

---

## 12 · v1 screens (1–19 in `clintra-screens.html`)

| # | Screen (Arabic UI title) | User | Tables |
|---|---|---|---|
| 1 | تسجيل الدخول (وقت التركيب) | install team | users · memberships |
| 2 | قفل الرقم السري | every staff member | memberships.pin_hash |
| 3 | يوم العيادة — نمط المواعيد | assistant | visits · schedules |
| 4 | يوم العيادة — نمط الطابور | assistant | visits.position · day_state |
| 5 | تسجيل الحجز | assistant | patients · visits |
| 6 | إجراءات المريض | assistant | visits.status · audit_log |
| 7 | تسجيل تأخير الطبيب | assistant / doctor | day_state.delay_minutes |
| 8 | مريض جه من غير حجز | assistant | visits.source = walkin |
| 9 | بحث المريض | assistant | patients (index) |
| 10 | الزيارة — النموذج العام | doctor | visit_form_data · form_definitions |
| 11 | الفاتورة | assistant | invoices · invoice_items |
| 12 | تسجيل دفعة وإيصال | assistant | payments |
| 13 | إقفال اليوم | assistant then doctor | cash_close |
| 14 | ورقة اليوم (طباعة) | assistant | visits |
| 15 | الإعدادات — مواعيد العمل | owner | schedules · schedule_exceptions |
| 16 | الإعدادات — الخدمات | owner | services · service_price_overrides |
| 17 | الإعدادات — الموظفون والصلاحيات | owner | memberships · scopes |
| 18 | شاشة الطبيب — قائمة اليوم | doctor | visits |
| 19 | سجل التدقيق | owner | audit_log |

Screens 20 and beyond in that file are entirely out of scope.

---

## 13 · Build order and progress board

| # | Phase | Done when | Status |
|---|---|---|---|
| 0 | Skeleton and deployment | A code change appears deployed automatically | [ ] |
| 1 | Account, locations, memberships | Two users with different scopes see different data | [ ] |
| 2 | Settings and day generation | Changing a service duration changes the grid | [ ] |
| 3 | Booking entry | 20 consecutive bookings under the time limit | [ ] |
| 4 | Statuses and attendance | A patient goes booked -> completed in three taps | [ ] |
| 5 | Modifications | Reschedule, cancel, delay, walk-in — no errors | [ ] |
| 6 | Offline operation | Two hours with no network, then a clean sync | [ ] |
| 7 | Money | Invoice, partial payment, receipt, day close | [ ] |
| 8 | Queue mode | Switching between the two modes without data loss | [ ] |
| 9 | Audit and printing | Day sheet, and a log showing who did what | [ ] |
| 10 | Hardening | Every acceptance criterion measured and written down | [ ] |

Phase 1 precedes booking deliberately. Building it later means a data migration on every
table. Update this board before closing a session.

---

## 14 · Acceptance criteria

| Criterion | Limit |
|---|---|
| Booking an existing patient | 3 seconds · 3 taps |
| Booking a new patient | 6 seconds |
| Opening the app on today | 1 second |
| Search by name | under 0.5s with 5,000 patients |
| Marking arrival | one tap |
| Moving an appointment to tomorrow | 3 taps or fewer |
| Offline operation | 8 hours with zero data loss |
| Sync after a disconnect | no duplication, no loss |
| Simulated clinic day | 30 scenarios, not a single error |

The simulated day is mandatory before any installation: one person on the device acting as
the assistant, another acting as patients **over the phone, not face to face** · thirty
mixed scenarios · the network is cut mid-way with no warning to the device operator ·
repeated until it passes without a single moment of confusion.

---

## 15 · Repository and commit rules

- Private GitHub repository named `clintra`.
- Identity configured once before the first commit:
  ```
  git config user.name  "<owner name>"
  git config user.email "<owner email>"
  ```
- Commit messages in English, short, Conventional Commits:
  `feat: add memberships table` · `fix: guard visit status transition` · `chore: setup ci`
- **Strictly forbidden:**
  - Any `Co-authored-by` trailer.
  - Any mention of an AI, assistant, or generation tool in a commit message, README, code
    comment, branch name, or config file.
  - Any contributor other than the repository owner.
  - Any assistant-tooling config file committed to the repo.
- Push after every step that succeeds, not at the end of the day.
- `main` is protected. Work happens on `feat/...` branches merged by pull request.
- `.env` is in `.gitignore` from the first commit, with a `.env.example` listing variable
  names only.

---

## 16 · Definition of "step complete"

A step is not complete until all four hold:

1. The command ran without errors.
2. There is **something visible in the browser**, or a passing test.
3. The code is pushed to the repository.
4. The progress board in section 13 is updated if a phase closed.

---

## 17 · Short list of prohibitions

- No `clinic_type`, `mode`, or `scenario` column.
- No floating-point money.
- No splitting the patient name.
- No server-generated identifiers.
- No 403 for an out-of-scope record.
- No merging `no_show` into `cancelled`.
- No scope stored in the token.
- No deferring sync to the end of the project.
- No date picker on the main screen.
- No confirmation dialog after every action.
- No separate service per practitioner — price is overridden via `service_price_overrides`.
- No screen belonging to phases 2 through 5.

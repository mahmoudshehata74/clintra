# Harvest notes: the standalone backend

Source read: remote `backend`, branch `backend/main` at `0b639cb`
(`routes/tenant.php`, `routes/web.php`, `app/`, `database/migrations`,
`tests/`, `docs/`). Read only: nothing from it was merged, cherry-picked,
copied or run. Every "port the idea" below means re-implementing the rule in
our own design, not taking his code.

## 1. Two architectures

| | Standalone backend | Ours |
|---|---|---|
| Connectivity | Online only: every action is an HTTP call to the server. Offline is listed as a future version. | Offline-first: the device writes to IndexedDB (Dexie) and syncs ops through `POST /api/sync/push` / `GET /api/sync/pull`. |
| Database | MySQL 8.4 in production, SQLite `:memory:` for the portable test run. | PostgreSQL 16 everywhere (dev, CI, test). |
| Tenancy | `stancl/tenancy`, one shared database, tenant chosen by subdomain; isolation enforced in repositories and composite same-tenant foreign keys (application level). | One database; isolation enforced by Postgres RLS (`FORCE ROW LEVEL SECURITY`, `current_org()`), with the app connecting as the RLS-bound `clintra_app`. |
| Identity | Username + password per clinic user, Sanctum bearer per login; staff shifts are logout/login on a shared device. Separate platform users for the Filament panel. | A registered device (activation code, device token) plus a per-person PIN lock on the device. No passwords. Operator work is CLI-only (`clintra:provision`, `clintra:mint-activation-code`, `clintra:revoke-device`). |
| Permissions | Spatie roles/permissions per tenant, customisable, with a delegation ceiling. | Four fixed roles (`web/src/domain/role.ts`) enforced by RLS policies and the device UI. |
| Scope | One clinic location and one owner-doctor per tenant. | Organisations with locations and several practitioners. |
| Server shape | REST API of 74 clinic routes plus a Filament platform panel. | A sync API (push, pull, bootstrap, audit push/pull), device registration and `POST /api/staff`. |

Both are reasonable for their premises. His design centralises every rule on
the server inside one locked transaction; ours has to express the same rules
as accept-or-reject decisions on a pushed op (`api/docs/rls.md`, "The sync
endpoint is accept-or-reject only") and as local rules on the device. That
difference decides most of the verdicts below.

## 2. Feature table

Verdicts: **covered** = already covered; **port** = port the idea;
**no fit** = does not fit.

| # | His feature / route group | What it does in his system | Ours | Verdict | Notes and rules worth keeping |
|---|---|---|---|---|---|
| 1 | `GET /tenant-context` | Public clinic name, mode, locale, timezone for login branding, resolved from the subdomain. | No (no subdomains; the device learns its org at registration, `RegistrationScreen.tsx`). | no fit | Depends on subdomain tenancy. |
| 2 | `POST /auth/login`, `/auth/logout`, `GET /auth/me` | Username/password login, bearer token, throttled login, logout between staff. | Device token + PIN lock (`web/src/auth/LockScreen.tsx`, `session.ts`, `pinRateLimit.ts`). | no fit | Passwords and per-login tokens require the server to be reachable at shift change. Rule worth keeping: deactivating a person or resetting their credential revokes their access immediately; ours does this for devices (`clintra:revoke-device`) and should keep doing it for members (`memberships.is_active`). |
| 3 | `/staff` (list, create, update, reset-password, roles) | Owner manages staff accounts and passwords; staff cannot alter the owner. | Yes: `StaffPanel.tsx`, `db/staffSettings.ts`, `POST /api/staff` (`add_staff_member`). | covered | Password reset does not apply (PINs). His invariant "owner identity is tied to the doctor row and cannot be removed or edited by staff" matches ours. |
| 4 | `/roles`, `/permissions` | Custom tenant roles from a permission catalogue; staff may delegate only permissions they hold, within an owner-set ceiling read under a tenant-row lock. | Partly: four fixed roles (`domain/role.ts`). | no fit | Per-permission grants would need one RLS policy shape per permission and a sync story for role edits. Rule to keep if roles ever become editable: never grant what the granter does not hold; a narrower ceiling restricts future grants without revoking existing ones. |
| 5 | `GET/PATCH /settings` | Clinic name, timezone, locale, phone, address, print header; mode and currency immutable. | Yes: location/print header (`usePrintClinic.ts`, `printClinic.ts`), settings sheet (`SettingsSheet.tsx`). | covered | His operating mode is immutable per clinic; ours now switches from tomorrow (A-03), which is the more useful rule. |
| 6 | `GET/PATCH /doctor` | Owner-doctor display name and professional details. | Yes: `domain/practitionerProfile.ts`, `practitioners.syndicate_number`. | covered | |
| 7 | `/services` | Bilingual services, positive integer price (piastres) and duration, deactivate instead of delete. | Yes: `ServicesPanel.tsx`, `db/serviceSettings.ts`, `service_price_overrides`. | covered | Same money rule (integer piastres). |
| 8 | `GET/PUT /schedules` (weekly + exceptions) | Weekly intervals per weekday, plus date-specific closures or one replacement interval; no overnight spans. | Partly: weekly hours (`WorkingHoursPanel.tsx`, `db/scheduleSettings.ts`); `schedule_exceptions` exists in Dexie and has an RLS policy, but has no screen and is **not** in `sync/syncableTables.ts` (no `rev`). | port | Port date closures and one-day replacement hours. Touches `schedule_exceptions`, the working-hours panel, `bookingAvailability.ts`, `emptySlots.ts`. Needs a schema change (add `rev`, make it syncable, a Dexie version). Size M. |
| 9 | `GET /availability` | Free windows for a date from schedule, exceptions and existing bookings. | Yes, computed on the device: `screens/day/bookingAvailability.ts`, `emptySlots.ts`. | covered | |
| 10 | `/cash-drawers`, `/cash-drawers/{id}/open`, `/cash-sessions/{id}`, `/cash-sessions/{id}/close` | Named drawers; one open session per drawer; payments only into an open session; close records counted cash; expected = opening + collections; difference = counted − expected; closed sessions immutable; any collector may use the session regardless of who opened it. | Partly: one `cash_close` per location per day (`CashCloseSheet.tsx`, `db/cashClose.ts`) with expected, collected, difference and a required note when the difference is not zero. No opening float, no drawers. | port | Port the **opening float** (expected = opening + cash collected) and keep a per-day close. Multiple drawers with an "only one open session" pointer needs a server-side lock across devices, which offline devices cannot take; keep it out. Touches `cash_close`, `CashCloseSheet`, `cashCloseCsv.ts`, `DayCloseSummaryPrint.tsx`. Schema change (`cash_close.opening_amount`). Size S–M. |
| 11 | `/patients` (list, create, show, update incl. archive/restore) | Patient profile; name required; phone normalised, shared phones allowed; archive with `archived_at`, history kept. | Partly: `PatientsScreen.tsx`, `db/patientCreate.ts`, `db/patientSearch.ts`; no archive. | port | Port archive/restore: hides the patient from search and booking, keeps all history. Touches `patients`, `patientSearch.ts`, `PatientProfile.tsx`. Schema change (`patients.archived_at`). Size S–M. |
| 12 | `GET /patients/{id}/history` | Paginated timeline of visits, clinical records, prescriptions, invoices, payments and messages, filtered per permission family before counting: reception sees no complaint, diagnosis or medication. | Partly: `screens/patient/profileModel.ts` builds the timeline, but shows diagnosis to every role. | port | Port the rule "an assistant's view of the timeline omits clinical text" as a UI rule. It is presentation only: the data is on the device either way (Dexie holds `visit_form_data`), so it is not a security boundary. No schema change. Size S. |
| 13 | `POST /visits` (booking) | Appointment or queue strategy chosen by clinic mode; slot overlap rejected with `SLOT_UNAVAILABLE` under a per-day lock; one unpaid invoice created atomically. | Yes: `db/visitBooking.ts`, `BookingSheet.tsx`; slot collisions rejected by the server (`conflict_slot_taken`). | covered | |
| 14 | `GET /visits`, `/visits/tomorrow`, `/visits/{id}` | Day lists, tomorrow list. | Yes: `DayScreen.tsx`, `DaySheet.tsx` (tomorrow print). | covered | |
| 15 | `GET /clinic-day`, `PATCH /clinic-day/delay` | Per doctor per day delay minutes, revision counter. | Yes: `day_state`, `DelayControl.tsx`, `db/dayState.ts`. | covered | Ours also locks a closed day in the database (`conflict_day_closed`). |
| 16 | `GET /queue`, `PUT /queue/order` | Reorder waiting visits: the new order is a permutation of the waiting visits' **existing** positions (in-room, completed, cancelled visits keep theirs); the submitted list must equal the exact waiting set; an `expected_revision` on the day rejects stale reorders. | Partly: queue display and advance (`db/visitQueue.ts`, `QueueRow.tsx`); no reorder (backlog). | port | Port the permutation rule and the stale check. Touches `visits.position`, `day_state`, `QueueRow.tsx`, `SyncOpApplier`. No new column; each visit's `rev` gives the stale check (`conflict_stale_rev`). Size M. |
| 17 | `POST /visits/{id}/arrive|call|start|cancel|no-show` | Status transitions; cancelling an unpaid visit voids its invoice; cancelling a paid visit is blocked. | Yes: `db/visitAttendance.ts`, `db/visitCancel.ts`, `db/invoiceVoid.ts`, `domain/transitions.ts`. | covered | Keep the "paid visit cannot be cancelled without a financial correction" rule in mind for invoice editing (row 21). |
| 18 | `GET/PATCH /visits/{id}/record` | Fixed fields (complaint, notes, diagnosis) with `expected_revision`; owner-doctor only. | Yes, richer: specialty form definitions and `visit_form_data` (`VisitWorkspace.tsx`, `db/visitForm.ts`). | covered | |
| 19 | `GET/PUT /visits/{id}/prescription`, `GET /prescriptions/{id}/print` | Ordered free-text medication lines; print data is read-only. | Yes: `db/prescriptions.ts`, `RxPrintPage.tsx`, `PrescriptionPrintSheet.tsx`. | covered | Ours locks a prescription once printed. |
| 20 | `POST /visits/{id}/complete`, `/corrections`, `GET .../revisions` | Completion finalises the record; a later correction by the owner-doctor snapshots the previous state into an immutable `clinical_record_revisions` row with a required reason; no financial row touched. | Partly: completion (`db/visitCompletion.ts`); changes are visible only through `audit_log` before/after. | port | Port "a correction after completion keeps the previous version and a reason". Touches a new table (revisions), `VisitWorkspace.tsx`, patient timeline. Schema and RLS change (new syncable table). Size M–L. |
| 21 | `GET /invoices`, `/invoices/{id}`, `PATCH /invoices/{id}` | Edit items only while unpaid; removed lines are retired, not deleted; a change of duration re-checks the slot and moves the reservation end atomically, or the whole edit is rejected. | Partly: `InvoiceSheet.tsx` shows and prints; no item editing (backlog). | port | Port: edit only while no payment exists; recompute total; retire instead of delete; reject if the new duration collides. Touches `invoices`, `invoice_items`, `InvoiceSheet.tsx`, `SyncOpApplier`. Probably no column (each row has `rev`); a new sync rejection reason for "invoice has a payment" needs your approval. Size M. |
| 22 | `POST /invoices/{id}/payment`, `GET /payments/{id}/receipt` | Full cash only; idempotency key per actor and operation; the same key with a different body fails; one payment per invoice; receipt number per period. | Yes and wider: partial and card payments (`db/payments.ts`, `PaymentSheet.tsx`); client UUIDs plus `conflict_already_exists` make a resent push idempotent; receipts from per-device number series. | covered | Rule worth checking in ours: a resent op with the same id but different content must be rejected, not silently accepted. |
| 23 | `GET /invoices/{id}/print`, `/payments/{id}/print`, `/visits/tomorrow/print` | Print data with current clinic header, stored item snapshots. | Yes: `InvoiceSheet.tsx`, receipt reprint, `DaySheet.tsx` tomorrow list, `DayCloseSummaryPrint.tsx`. | covered | |
| 24 | `GET /reports/{report}`, `/reports/{report}/export` | Ten reports, JSON and CSV (see section 3). | Partly: cash-close CSV (`cashCloseCsv.ts`), day-close summary, consult stats (`domain/consultStats.ts`). | port | Port the report definitions as an on-device reports screen. No schema change for most reports. Size M–L. |
| 25 | `GET /activity` | Audit list, filtered by permission family, with support attribution. | Yes: `AuditSheet.tsx`, `domain/auditScope.ts`, `device_audit_log` sync. | covered | |
| 26 | `/message-templates`, `/messages/preview`, `/messages` | Three template keys per locale; owner overrides with revision; allowlisted `{{placeholders}}`; unknown tokens rejected; one-pass rendering; 4000 characters max; message rows record an immutable copy/share intent, never "delivered". | Yes: six keys (`domain/messageTemplates.ts`), overrides in `message_templates`, `MessagesScreen.tsx`, `SendMessageSheet.tsx`. | covered | Rules worth confirming in ours: one-pass rendering (a patient name containing `{{…}}` must not be expanded again) and a length cap. |
| 27 | Filament Tenants resource (create, edit, activate/deactivate, reset owner password) | Platform team provisions a clinic, can disable it (every request then fails with `TENANT_INACTIVE`), and recovers the owner. | Partly: `clintra:provision`, `clintra:mint-activation-code` (owner recovery = a new code), `clintra:revoke-device`. No org-level disable. | port | Port an org-level disable: sync and registration refuse an inactive org. Touches `organizations`, `ApplyMembership`, `register_device`. Schema and RLS/function change. Size M. |
| 28 | Filament platform users and roles (Shield) | Separate operator accounts with five central capabilities. | No: operators use the CLI. | no fit | A web operator panel would add an internet-facing door to `BYPASSRLS` work that is CLI-only by design (`api/docs/rls.md`, "One role per provisioning function"). |
| 29 | Filament dashboard (overview, tenant insights, clinic cash) | Cross-tenant usage and cash metrics, finance figures behind a separate capability. | No. | no fit | Cross-org reads are exactly what RLS forbids for `clintra_app`; it would need its own read-only bypass role. Revisit when there is more than a handful of clinics. |
| 30 | `POST /admin/support/sessions`, `/stop` (impersonation) | Audited, time-limited support login as a clinic user, never clinical writes. | No. | no fit | Our data lives on the clinic's devices; there is no server session to impersonate. |
| 31 | Shared JSON envelope (`{success, message, data, pagination}`) | Uniform REST response format. | No (sync responses are per-op accept/reject). | no fit | Not useful for a sync protocol. |
| 32 | `EndpointBoundaryMatrixTest` | Fails when a route is added without an auth/tenant classification; checks missing, foreign and revoked tokens on every route. | Partly: per-route tests (`tests/Feature/Rls`), no inventory test. | port | Port as one Pest test over `api/routes/api.php`: every route must be listed with its expected unauthenticated and revoked-device status. No schema change. Size S. |
| 33 | `document_sequences` (per tenant, type and period) | Invoice and receipt numbers allocated under a row lock. | Yes, by design different: per-device number series (`docs/schema.md` v16, `domain/numberSeries.ts`). | covered | A server-allocated counter cannot work offline; ours is the right shape. |
| 34 | Login throttling (`throttle:clinic-login`) | Limits password guessing. | Yes: registration limits (IP, code, org) and PIN rate limit (`auth/pinRateLimit.ts`). | covered | |

Counts: covered 17 · port the idea 10 · does not fit 7 (34 rows).

## 3. His reports

All ten take the same inputs: `date_from`, `date_to` (inclusive, `YYYY-MM-DD`,
at most 366 days), `locale` (`en`/`ar`), `page`, `per_page` (default 15, max
100). Timestamp-based reports turn local midnight to midnight into a
half-open UTC range. Money is integer piastres. CSV export (`/export`)
returns all rows up to 10 000 (more fails with 422 instead of a partial
file), starts with a UTF-8 BOM, uses CRLF, localised column labels, ISO UTC
timestamps, `1/0` booleans, empty cells for null, and prefixes cells
starting with `=`, `+`, `-`, `@` or a control character with an apostrophe
(typed negative numbers stay numeric).

"On device?" assumes the device holds the period's rows. Today it holds the
whole history; the brief's 60-days-back/60-days-forward retention
(`docs/sync-plan.md`, Q9) is not implemented, and once it is, reports older
than 60 days would need a server read.

| Report | Date basis | Columns | Summary | On device? |
|---|---|---|---|---|
| `visits` | visit business date | visit_id, business_date, status, created_at, arrived_at, completed_at, cancelled_at | visits, booked, arrived, in_consultation, completed, cancelled, no_show counts | Yes. `visits` has status, `created_at`, `arrived_at`, `ended_at`; there is no `cancelled_at` (the cancel time is in `audit_log`). |
| `booking_activity` | booking `created_at` (a booking may target a later date) | same as `visits` | same as `visits` | Yes. |
| `cancellations_no_shows` | business date, current status Cancelled/NoShow | same as `visits` | same as `visits` | Yes (`status` + `cancel_reason`; ours also tells patient/clinic/postpone apart). |
| `patient_activity` | profile `created_at`; attendance by business date | patient_id, created_at, archived_at, qualifying_visits_count, had_prior_visit | profiles, new_profiles, active_patients, returning_patients | Yes, except `archived_at` (row 11). |
| `service_usage` | business date; current non-retired lines grouped by service and label snapshot | service_id, description, reserved_quantity, completed_quantity | service_snapshots, reserved_quantity, completed_quantity | Yes, from `invoice_items` and visit status. |
| `invoicing` | invoice `issued_at` | invoice_id, number, visit_id, patient_id, status, currency, total_minor, issued_at, paid_at, voided_at | invoices, unpaid, paid, void counts; unpaid_minor, paid_invoice_minor, void_minor | Yes; ours adds `partial`. `paid_at`/`voided_at` are derived (last payment; audit row). |
| `collections` | payment `paid_at` | payment_id, invoice_id, cash_session_id, receipt_number, received_by, currency, amount_minor, paid_at | payments, collected_minor | Yes (`payments.created_at`, `created_by`, `method`); "session" becomes the day's `cash_close`. |
| `unpaid_invoices` | `issued_at`, current status Unpaid | same as `invoicing` | same as `invoicing` | Yes, with partial invoices showing the balance (`total − paid`). |
| `drawer_reconciliation` | session `opened_at`, lifetime ledger totals | cash_session_id, drawer_id, status, currency, opening_amount_minor, collections_minor, payments_count, expected_minor, counted_minor, difference_minor, opened_at, closed_at | sessions, open, closed counts; opening, collections, expected, counted_closed, difference_closed | Partly: one `cash_close` per day gives expected, collected, difference; no opening float (row 10) and no drawers. |
| `staff_collections` | payment `paid_at`, grouped by collector id | received_by, payments_count, currency, collected_minor | collectors, payments_count, collected_minor | Yes, and better: the device can show the collector's name (`memberships.display_name`) where his returns only an id. |

## 4. Bugs and risks not to copy

1. **Ambiguous upsert id.** `ClinicDayStateRepository` upserts with
   `['id' => DB::raw('id')]` as the update clause. On MySQL that becomes
   `ON DUPLICATE KEY UPDATE id = id`; on Postgres Laravel emits
   `ON CONFLICT (...) DO UPDATE SET "id" = id`, and `id` is ambiguous
   between the target row and `excluded`, so the statement fails. On
   Postgres the idiom is `ON CONFLICT DO NOTHING` followed by the locking
   read.
2. **MySQL index hints as a correctness tool.** `forceIndex(...)` in
   `InvoiceRepository`, `PaymentRepository`, `PrescriptionRepository` and
   `VisitRepository` exists because InnoDB locked a wider index range than
   intended; his locking guarantees were proved with that hint. Postgres has
   no index hints, and row locks there do not depend on the plan the same
   way, so none of that evidence carries over.
3. **Driver-specific tests and error handling.** 64 concurrency tests run
   only on MySQL (`performance_schema` lock-wait evidence) and are skipped on
   SQLite. Duplicate-key handling in `PermissionService`, `StaffService` and
   `TenantProvisioningService` matches only MySQL error 1062 or SQLite error
   19; on Postgres (SQLSTATE `23505`) the friendly validation error is lost
   and the request becomes a 500. `ReportRepository` detects overflow only
   for SQLite.
4. **`SUBSTR` on timestamps.** `PlatformDashboardRepository` groups by
   `SUBSTR(created_at, 1, 7)`. That works on MySQL and SQLite (implicit cast
   to text) and fails on Postgres (`substr(timestamp)` does not exist). Use
   `to_char(created_at, 'YYYY-MM')` or `date_trunc`, and mind the timezone
   (`api/docs/rls.md`, "Hardening pass: the timezone bug class").
5. **Check-then-upsert.** `DocumentSequenceRepository` and
   `IdempotencyRepository` call `exists()` and then upsert; correct only
   because the following locking read re-reads. Fine to learn from, not to
   copy as a pattern.
6. **Application-level tenancy.** Isolation lives in repository guards. A
   single missed `where tenant_id` leaks across clinics; ours fails closed in
   the database. Nothing from his repository layer should replace an RLS
   policy.

## 5. Ranked shortlist

1. **On-device reports screen** from his ten definitions (visits, bookings,
   cancellations/no-shows, patient activity, service usage, invoicing,
   collections, unpaid, cash close, staff collections) with his CSV rules —
   M–L; no schema/RLS approval needed. Done in `feat/reports`
   (`docs/session-handoff.md`, "Reports").
2. **Invoice item editing while unpaid** (retire lines, recompute total,
   re-check slot duration, reject once a payment exists) — M; no new column,
   but a new sync rejection reason needs your approval.
3. **Queue reordering as a permutation of existing positions**, stale
   reorders rejected through `rev` — M; no schema/RLS approval needed.
4. **Opening float in the cash close** (expected = opening + cash
   collected) — S–M; needs your schema approval (`cash_close.opening_amount`).
5. **Schedule exceptions** (date closures, one-day hours) with a screen and
   sync — M; needs your schema approval (`rev`, syncable table).
6. **Patient archive/restore** that hides from search and booking and keeps
   history — S–M; needs your schema approval (`patients.archived_at`).
7. **Clinical text hidden from the assistant's patient timeline** (a UI
   rule, not a security boundary) — S; no approval needed.
8. **Post-completion clinical corrections with an immutable previous
   version and a reason** — M–L; needs your schema and RLS approval (new
   syncable table).
9. **Org-level disable** (sync and registration refuse an inactive org) — M;
   needs your schema and RLS/function approval.
10. **Route inventory test for `api/`** (every route classified, checked
    unauthenticated and with a revoked device) — S; no approval needed.

## 6. Work for the backend developer on our `api/`

### Deployment checklist (`docs/deployment.md`)

- PHP 8.3+ with `pdo_pgsql`/`pgsql`; PostgreSQL 16+; one database.
- Create the roles once as a superuser, exactly as `api/README.md`'s
  "Database setup" lists them: `clintra_owner`, `clintra_app`,
  `clintra_rls`, `clintra_provision`, `clintra_mint`, `clintra_register`
  **and `clintra_staff`**. `docs/deployment.md` still names six roles and
  omits `clintra_staff`, which `add_staff_member` (the authenticated
  `POST /api/staff`) needs in production; `api/README.md` and `ci.yml`
  have it. Fixing that line is a first small docs task.
- **Never** create `clintra_fixtures` or a `_test` database in production.
  Run the post-deploy checks in `docs/deployment.md` (no
  `clintra_fixtures`, no `%test%` database, the app connects only as
  `clintra_app`, `APP_DEBUG=false`, a token-less request gets 401).
- Migrations run as a separate step with owner credentials
  (`php artisan migrate --database=pgsql_owner --force`); the web process
  holds only `clintra_app` credentials.
- Env: `APP_KEY`, `APP_ENV=production`, `APP_DEBUG=false`, `APP_URL`,
  `DB_*` for `clintra_app`, `CORS_ALLOWED_ORIGINS` set to the deployed web
  origin(s).
- Narrow `trustProxies(at: '*')` to the host's proxy range, or confirm the
  app is unreachable except through the proxy.
- Backups: daily, kept 30 days, PITR if offered, stored outside the
  database's failure domain; record the role statements, their passwords
  and `APP_KEY` separately; test a restore now and after any role/grant
  migration, following the six steps in `docs/deployment.md`.
- Region close to Egypt (Europe or a Gulf region), API and database in the
  same region.
- Provisioning from Linux: run `php artisan clintra:provision` on the
  server (interactive prompts, owner PIN read hidden), then
  `clintra:mint-activation-code {org_id} {location_id}` per device;
  `clintra:revoke-device {device_id}` and
  `clintra:clear-registration-lockout {org_id}` for support. The Windows
  piped-stdin workaround used in local tests is not needed on a Linux
  shell. These stay CLI-only; do not wrap them in HTTP routes.
- Get the open legal question answered (Egyptian patient-record retention
  and data residency) before a live clinic.

### Backlog he could own

1. **Server-side per-person identity — design document first, no code
   until approved.** Today the server knows only the membership the device
   token was issued to. The design must say how the acting membership is
   proved per request (for example a PIN-derived proof), how it works
   offline (ops queued under one person and pushed later), how revocation
   and PIN changes reach devices, and how it turns the claimed actor in
   `device_audit_log` and the actor columns into a checked one
   (`api/docs/rls.md`, "Actor attribution").
2. **Invoice item editing** (shortlist 2): the applier side — accept an
   item edit only while the invoice has no payment, keep retired lines,
   recompute the total, re-check the slot on duration change.
3. **Queue reordering** (shortlist 3): the applier side of a position
   permutation, stale ops rejected by `rev`.
4. **Care-plan package payments**: paying for a plan up front is out of v1
   (`care_plans.paid` is written 0 and never read; anything else is
   `care_plan_invalid`). Design how a package payment, its invoice and its
   consumption by sessions sync, before any schema.

### Rules for any change in `api/`

- **RLS first.** Every new table: `docs/schema.md`, a Dexie version, a
  migration, RLS policies with `FORCE`, `rev`, and the syncable-table list
  (`api/docs/rls.md`, "How to add a new table"). No `BYPASSRLS` path from
  HTTP except the existing narrow functions; a new one needs approval.
- **Accept or reject, never rewrite.** The push endpoint decides on the op
  in front of it only; it never changes a third row. Rejections use the
  existing reason codes (`conflict_stale_rev`, `conflict_slot_taken`,
  `conflict_day_closed`, `conflict_number_taken`, `conflict_already_exists`,
  `conflict_visit_has_prescription`, `scope_mismatch`, `org_mismatch`,
  `series_mismatch`, `care_plan_invalid`, `message_invalid`,
  `template_invalid`, `practitioner_profile_invalid`, ...); a new reason is
  a contract change for the web app and needs approval.
- **Seq lock.** Any transaction that writes `sync_ledger` (or
  `device_audit_log`) takes `SyncSeqLock` for its org before its first
  write (`api/docs/rls.md`, "One organization's sync writes commit in seq
  order").
- **Pushed `""` becomes `null`** (Laravel middleware); NOT NULL text
  columns need mapping in the applier.
- **Migrations**: never `migrate:fresh` on the dev database; destructive
  commands only with `DB_DATABASE=clintra_test`; owner backfills under
  `FORCE` RLS follow the documented pattern and need approval.
- **Gate**: Pest on `clintra_test`, and `pnpm --dir web test:live` for any
  change to the push/pull/bootstrap path — the normal e2e runs on a fake
  transport that does not check `base_rev` or wire formats. Merge only with
  all checks green and no flaky or retried test.

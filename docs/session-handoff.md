# Session handoff

## Phase
Design system rebuild. The visual reference for v1 is
`docs/reference/clintra-prototype.html` (19 screens); `docs/design-rule.md`
defines how to use it and lists the settled deviations from it. Logic and
data are not being rewritten: existing screens are restyled, and the new
screens are built on top of the existing data layer.

## Actual state (as of 8d993d7)
- **Web** (React + Vite PWA, offline-first, IndexedDB via Dexie): assistant
  day screen (slots and queue), booking and walk-in, visit actions, doctor
  delay, visit form (complaint + diagnosis), invoice, payments, cash close,
  tomorrow's day sheet, audit log, settings (working hours, services,
  staff), PIN lock (Argon2id, 5 attempts then a delay, 10-minute idle lock)
  and device registration.
- **Sync transport**: `HttpTransport` exists and is selected whenever the
  device row holds a real token (`selectSyncTransport` in
  `web/src/sync/httpTransport.ts`); `FakeTransport` remains for demo mode.
- **Fonts**: already bundled locally through `@fontsource` packages (IBM
  Plex Sans Arabic 400/500/600, Readex Pro variable) — nothing is fetched at
  runtime.
- **API**: device registration (`POST /api/devices/register`), sync push,
  pull and bootstrap endpoints, provisioning and activation-code CLI
  commands, full RLS on every tenant table (see `api/docs/rls.md`).

## Verify
Web: `pnpm --dir web test` (vitest, 563 passed) · `pnpm --dir web
exec tsc -b --noEmit` · `pnpm --dir web build` · `pnpm --dir web test:e2e`.
API: `cd api && php artisan test` (Pest, 213 passed).

## Rebuild order (approved)
1. `docs/design-rule.md` points at the prototype — done (PR #1).
2. This handoff.
3. Design tokens in `web/src/index.css` from the prototype's `:root`; move
   fonts to `web/public/fonts/` with local `@font-face`; remove Readex Pro.
4. Shared components, one per commit, each with a demo page: button,
   field, card, sheet, badge.
5. Existing assistant screens, restyled: 1 lock, 2 day slots, 3 queue,
   4 booking, 5 invoice, 6 payment, 7 cash close (with the past-due list),
   8 tomorrow's sheet.
6. New data + doctor screens: `visits.note` then 9 doctor day;
   `prescriptions` + `prescription_items` then 10 visit form, 16 prescription
   print; `messages` + `message_templates` then 19 messages.
7. 17 care plan.
8. 18 patient profile — last, because it aggregates everything else.
9. 15 device activation (restyle + post-activation confirmation).
10. Re-capture the Playwright screenshot layer for all 19 screens.

## Data decisions for the rebuild
- `visits.note text NULL` — the doctor's quick note.
- `practitioners.syndicate_number varchar(50) NULL` — hidden when empty.
- `prescriptions` numbered `RX-{issued_year}-{sequence}`, sequential per
  location per calendar year, reserved with the same mechanism as invoice
  numbers (`prescriptions.issued_year` is a stored field).
- `messages` + `message_templates`; templates seeded by migration. A message
  row records `attempted_at`; "sent" is marked manually. WhatsApp opens
  `wa.me`, SMS opens `sms:`. No messaging provider in v1.
- Care plans use the existing `care_plans` and `care_plan_items`; there is
  no `care_plan_sessions` table. A session's label comes from its service
  name, its date from its linked visit or from the previous session plus
  `min_gap_days`; with neither, it shows as "session {n}".
- Cash close cannot complete while a `booked` visit whose time has passed
  is still unmarked, unless the assistant explicitly confirms. CSV export:
  date, patient, service, amount, payment status.
- Every new table goes through all of: `docs/schema.md`, a new Dexie
  version, an API migration, RLS policies, and the syncable-table list with
  `rev`.

## Standing rules for the rebuild
- Existing logic and behaviour do not change; vitest and e2e stay green at
  every step, not just at the end.
- Screens without a prototype counterpart (visit menu, move, cancel, sync
  review) get the new tokens and fonts only. A design question that would
  change their behaviour is raised before it is answered.
- Navigation is a role-dependent sidebar: every role sees day, queue,
  messages, audit log, settings and patient search; the doctor also sees
  the doctor day and the current visit. Prescription and care plan open from
  the visit or the patient profile.

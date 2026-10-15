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
Web: `pnpm --dir web test` (vitest, 1314 passed) · `pnpm --dir web
exec tsc -b --noEmit` · `pnpm --dir web build` · `pnpm --dir web test:e2e`.
API: `cd api && php artisan test` (Pest, 325 passed).

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

`visits.note` (step 6, data only): done — migration, sync, local store, audited setter.

9 doctor day (step 6): done — `web/src/screens/doctor/`, rail item "شاشة الطبيب"
for any membership with a `practitioner_id`; the quick note writes
`visits.note` through `setVisitNote`. The owner decisions it implements are
listed under "Screen 9 (doctor day)" below.

`prescriptions` + `prescription_items` (step 6, data only): done — migration,
RLS, sync (push, pull, bootstrap), per-device RX numbering, printed lock,
local store (database version 16) and audited writers in
`web/src/db/prescriptions.ts`; no UI yet (`docs/schema.md`'s v17 additions).
Owner decisions it implements:
1. At most one prescription per visit, created with its first item and
   numbered then in this device's series ("RX-{year}-{0000}", "RX-{year}-{L}-{0000}").
2. Items are editable only until the first print, which sets `printed_at` and
   snapshots the visit's diagnosis; after that every write is refused, on the
   device and by the server.
3. Item fields: name and instructions required, form, duration and note
   optional, position 1-based in append order and never renumbered.
4. Only the visit's own practitioner writes (`not_prescriber`); the server
   does not enforce who writes in v1 — a known gap (`api/docs/rls.md`).
5. Removing every item keeps the numbered prescription; an empty one cannot be
   printed (`prescription_empty`), and the skipped number is acceptable.

10 visit form (step 6): done — `web/src/screens/visit/` (VisitWorkspace,
pure helpers in `workspace.ts`), hosted by VisitFormSheet (same entry points)
and by the rail page "الزيارة الحالية"; prescription editing goes through
`db/prescriptions.ts`. The legacy tokens (`green-soft`, `line`,
`--radius-el`) had no use left and are retired. The owner decisions it
implements are listed under "Screen 10 (visit workspace)" below.

16 prescription print (step 6): done — `web/src/screens/prescription/`
(PrescriptionPrintSheet, RxPrintPage, pure helpers in `printModel.ts`), opened
from the visit workspace's `.rx-section` and reusable by screen 18; the first
print goes through `markPrescriptionPrinted`. The owner decisions it
implements are listed under "Screen 16 (printed prescription)" below. On
paper it is plain paper (the 12mm margin is `@page prescription`'s), a drug
never splits across pages and the signature stays with the last drug; the
audit log lists prescription events under "الزيارات", naming the patient.

Practitioner profile (decision A): done — practitioners sync, and the owner
edits each practitioner's name, title and syndicate number from the settings
tab "الأطباء" (`web/src/screens/day/PractitionersPanel.tsx`,
`web/src/db/practitioners.ts`); the printed prescription shows "رقم النقابة
{n}" (`docs/schema.md`'s v18 additions; `api/docs/rls.md`'s
"Practitioners"). Owner decisions it implements:
1. Name, title and syndicate number are the only editable fields;
   practitioners are still created only by provisioning, and the server
   refuses anything else (`practitioner_not_editable`).
2. The title is stored trimmed with `""` for none (the column stays NOT
   NULL); the syndicate number is stored trimmed with null for none, at most
   50 characters. One shared helper decides "empty" for every screen.
3. Owner only, enforced on the device like every other settings write — the
   server does not check who edits (a known gap, `api/docs/rls.md`).
4. Renaming an assistant or other staff member was left for its own
   decision, since a staff name lived on `users`, which is not syncable —
   since decided: see "Staff identity" below.

`messages` + `message_templates` (step 6, data only): done — migration, RLS,
sync (push, pull, bootstrap), local store (database version 18), audited
writers in `web/src/db/messages.ts`, template definitions and
`renderTemplate` in `web/src/domain/messageTemplates.ts`, wa.me/sms links in
`web/src/domain/messageLink.ts`; no UI yet (`docs/schema.md`'s v19
additions; `api/docs/rls.md`'s "Messages and message templates"). Owner
decisions it implements:
1. Six fixed template keys whose names, descriptions, kinds and default bodies ship in web code; `message_templates` stores only an organization's edited body for one of the five editable keys, and "reset to default" deletes it.
2. A message row is written when the app opens WhatsApp or SMS for it (`attempted_at`); only `marked_sent_at` ("اتبعتت", by hand) ever changes, and messages are never deleted (`message_immutable`).
3. No provider and no delivery status: `https://wa.me/<digits>?text=` and `sms:<E.164>?body=`, built by the pure `buildMessageLink`.
4. Messages are scoped like invoices (org + locations), templates like practitioners (org); owner-only template editing is enforced on the device only — the same known server gap as other settings writes.

19 messages (step 6): done — `web/src/screens/messages/` (MessagesScreen,
SendMessageSheet, pure helpers in `messagesModel.ts`), the rail page
"الرسائل" (nav key `messages`) and the send sheet opened from the day
screen's VisitMenu and from a printed prescription; writes go through
`db/messages.ts`. The owner decisions it implements are listed under
"Screen 19 (messages)" below.

`care_plans` + `care_plan_items` (step 7, data only): done — migration
(policies narrowed to the visits scope on empty tables, `visit_id`
nullable, `rev`), sync (push rules, pull, bootstrap stages 8–9), local
store (database version 20), audited writers in `web/src/db/carePlans.ts`,
derivations in `web/src/domain/carePlan.ts`; no UI yet (`docs/schema.md`'s
v20 additions; `api/docs/rls.md`'s "Care plans"). Owner decisions it
implements:
1. Billed per session: a session's visit is billed on completion at the session's own price; a plan's paid is derived from its linked visits' payments, and `care_plans.paid` stays 0, unread.
2. A plan is created from a visit (its practitioner, patient, location; diagnosis from the visit form) with a goal and groups of sessions (service, count, gap), priced at the service's effective price at creation.
3. `care_plan_items.visit_id` is the only link: booking a session sets it, moving the visit carries it, cancelling or a no-show clears it, each in the visit's own transaction.
4. Stored statuses are only active/stopped and planned/skipped; done, booked, suggested, dates, completed and stalled are derived.
5. Edits (goal, diagnosis, added sessions, skip/unskip, stop/resume) are the plan practitioner's only, enforced on the device; nothing is deleted.

Before screen 17 (done): undoing a move, a cancel or a no-show (and a
session's booking) restores the session link with the visit, in the same
transaction (`db/visitUndo.ts`); a plan is completed only with at least one
done session; the audit sheet lists care plan rows under "الزيارات".

17 care plan (step 7): done — `web/src/screens/carePlan/` (CarePlanSheet
with its create and edit forms, CarePlanEntry in the visit workspace,
CarePlanBookingSheet, pure helpers in `carePlanModel.ts`); writes go
through `db/carePlans.ts`, bookings through the day screen's BookingSheet
with an optional prefill. The owner decisions it implements are listed
under "Screen 17 (care plan)" below.

18 patient profile (step 8): done — `web/src/screens/patient/` (PatientProfile,
PatientProfileSheet, PatientsScreen, pure helpers in `profileModel.ts`): the
rail page "المرضى" (nav key `patients`) with search, and the same profile as
a sheet from a visit. It reads every other screen's data and writes nothing
of its own; what a row opens is that screen's own sheet. The owner decisions
it implements are listed under "Screen 18 (patient profile)" below.

All 19 screens are now built. Next step: the full screenshot re-capture
(step 10) — `pnpm --dir web test:e2e:screenshots` for every screen, desktop
and mobile, reviewed against the prototype.

This changes the earlier plan below ("templates seeded by migration"):
defaults now ship with the app and only overrides live in the database,
because a seed would only reach the organizations that exist when the
migration runs — every organization provisioned later would have none.

### Screen 19 (messages) — owner decisions over the prototype
- a. Rail item "الرسائل" (nav key `messages`) for every role, after "الزيارة الحالية" (after "اليوم" for roles without the doctor items). The page follows `.msg-layout`: `.msg-side` lists the six templates in their defined order with `.icn`, name, description and badge ("مقترح" `.badge.auto`, "اختياري" plain, "يدوي" `.badge.manual`); `.msg-main` shows the selected one.
- b. `.msg-preview` shows the effective body (override or default) with each known placeholder as a `.var` chip with its Arabic label (اسم المريض، اسم العيادة، هاتف العيادة، التاريخ، الوقت، اسم الطبيب، الجلسة، المبلغ المتبقي). `.ch` reads "قابل للتعديل" for the owner, "معدّل" when an override exists. Owner only: "تعديل" switches to the shared TextArea with the raw body and one insert chip per placeholder; "حفظ التعديلات" (`saveTemplateBody`), "إلغاء", and "رجّع النص الأصلي" when an override exists (`resetTemplate`). Others read it. Custom shows "الرسالة دي بتتكتب وقت الإرسال" and no editor.
- c. The prototype's channel toggle is not on this page (templates are channel-agnostic); it lives in the send sheet.
- d. SendMessageSheet, from VisitMenu's "ابعت رسالة" (any visit whose patient exists — an owner-approved addition) and from "واتساب" / "SMS" on a printed prescription (shown only once printed). Template picker (ToggleGroup; the prescription entry preselects custom with the prescription text: RX number, patient, one numbered line per drug "name — form: instructions · duration", note lines, "د. {name}"); the filled text in an editable TextArea (edits affect this message only); "فيه بيانات ناقصة: …" for unfilled placeholders, never blocking; the `.msg-ch-toggle` channel toggle, WhatsApp by default; "افتح واتساب" / "افتح SMS" call `recordMessageAttempt`, then open the link (`window.open` for wa.me, the location for sms:); refusals (no phone, empty text, device errors) show in the sheet and open nothing. Values: patient name; clinic name and phone from the printClinic sources (organization, the visit's location); the visit's date and booked time; the visit's practitioner's name; the balance (invoice total − paid, when above zero, as money); the session label stays missing until screen 17.
- e. `.msg-sent` "آخر الرسائل": the 20 most recent messages the membership can see (organization, and its locations unless it covers all), newest first: `.icn.wa` / `.icn.sms`, "name · phone" (local display, left to right), `.snip` = the body's first line cut to 60 characters with "…", and a status button: "اتفتحت" (`.st.pending`) marks it sent, "اتبعتت" unmarks it. Empty: "لسه مفيش رسائل".
- f. Below 768px `.msg-side` is a horizontal row of template chips above `.msg-main`.
- WhatsApp's green (`#25D366`, `.icn.wa` and the toggle's dot) is the `whatsapp` token (`docs/design-tokens.md`).

### Messages: "مقترح النهارده"
- Above "آخر الرسائل" on the messages page, for every role: "مقترح النهارده" with a count badge, one row per suggestion — the patient's name, the reason, and "ابعت", which opens SendMessageSheet on that visit with the row's template preselected; a patient without a usable mobile number reads a muted "مفيش رقم" and has no button. Empty: "مفيش رسائل مقترحة النهارده". No prototype counterpart: `.msg-item`'s row look, tokens and shared components.
- Rules (`web/src/screens/messages/suggestedMessages.ts`, pure, Cairo days): appointment_reminder for tomorrow's booked or confirmed visits ("موعد بكرة 10:30"; a queue visit has no time); care_plan_session_reminder instead of it for a tomorrow visit that books a care plan session ("جلسة خطة بكرة 9:30"); post_visit_followup for visits completed exactly two days ago ("زيارة من يومين"); balance_reminder at most once per patient, on their oldest non-void invoice still owed and issued seven or more days ago, on that invoice's visit, reading what that invoice still owes ("عليه 150 ج.م من أسبوع", whole weeks).
- A visit's row goes once a message with its template was opened for that visit; a balance row once a balance reminder was opened for the patient today or in the six days before. Only what the membership may see counts (messages' own scope: organization, and listed locations). Order: tomorrow's rows by time, then follow-ups, then balances, each by name.

### Screen 17 (care plan) — owner decisions over the prototype
- a. Entry points, in the visit workspace (at the top of `.visit-main`): with a plan under way (active, not completed) between the patient and the visit's practitioner, s10's `.plan-badge` "خطة رعاية جارية: {goal}" with `.p` "جلسة {n} من {count}" (n = the session this visit books, else the done sessions + 1, over the sessions not skipped), opening the plan; without one, the visit's own practitioner gets "ابدأ خطة رعاية" on an in_room or completed visit, opening the create form in the same sheet. One plan under way per patient per practitioner: `createCarePlan` and `resumeCarePlan` refuse another with `plan_already_active` (a stopped or completed plan does not count).
- b. Create form (shared Field/TextInput/TextArea/ToggleGroup): "الهدف" (required), "التشخيص" (from the visit form, required), session groups — service (active services, with their effective price), "عدد الجلسات" (≥ 1), "كل كام يوم" (≥ 0), "＋ نوع جلسات تاني", "شيل" while more than one — and a live preview of the sessions (number, service, suggested "d / m": the first today, each later one its group's gap after the one before) with their total. Messages show after the first "ابدأ الخطة"; nothing is written until it succeeds; a refusal shows as one line.
- c. CarePlanSheet per s17: `.plan-hero` (avatar initial, name, "الهدف: …" · "التشخيص: …", `.kbd` "{count} جلسات" with arabicCount), `.plan-progress` ("التقدم", "{done} / {count} جلسة", bar = done/count), `.plan-legs` (بدأت, متوقع الانتهاء — "—" while no session has a date —, الإجمالي, المدفوع: "d / m / yyyy", money as "2,500 ج.م"); a status line: "الخطة اكتملت", else "الخطة متوقفة", else the stalled warning "المريض متوقف من N يوم". `.plan-sessions`: `.n` = sequence; name = service; `.meta` "d / m · د. {doctor} · {duration} دقيقة" for done and booked (booked adds "h:mm" after the day, the app's 24-hour clock without a leading zero), "d / m · مقترح" for a dated suggestion, nothing for an undated or skipped one; `.st` "تمّت" (`.done`), "التالية" (`.next`, the first booked session) or "محجوزة" (a later booked one), "مقترحة" (`.st.plan`), "مؤجلة" (muted). The plan's practitioner gets "أجّل" on a suggested row and "رجّع" on a skipped one.
- d. `.split`: "احجز الجلسة التالية" (anyone) opens the day screen's BookingSheet with an optional prefill — the plan's patient, the session's service (fixed), the session's suggested day (today when it has passed or there is none), a day at a time either way but never before today, and the session's id, linked by `bookExistingPatientVisit` or, in queue mode, `addToQueue` (which now takes `carePlanItemId` too); without a prefill the sheet is unchanged. Disabled with "الجلسة التالية محجوزة {d / m · h:mm}" while the first open session is booked; absent when the plan is stopped or completed, or has only skipped sessions left. A booking made here offers no undo toast. "عدّل الخطة" (plan's practitioner only): goal, diagnosis, "＋ ضيف جلسات" (one group), "وقّف الخطة" / "رجّع الخطة". "أرسل تذكير للمريض" opens SendMessageSheet for the first booked session's visit with `care_plan_session_reminder` preselected (its own filled text); disabled with "احجز الجلسة الأول" while nothing is booked.
- e. The doctor day's attention card gets no stalled-plan item; screen 18 will show it.
- A plan whose every session is skipped is not completed (it reads as active with nothing to book).
- e2e: a write made straight into IndexedDB (a past visit, another device's plan) needs `syncSettled` first — the demo server's pull puts back its own copy of every pushed row — and a reload after (`reloadAs`): Dexie answers live queries from its own cache.

### Screen 18 (patient profile) — owner decisions over the prototype
- a. Rail item "المرضى" (nav key `patients`) for every role, right after "اليوم". The page: a shared TextInput "دوّر بالاسم أو رقم التليفون" over `db/patientSearch.ts`, results as rows (name, local phone left to right, "آخر زيارة d / m / yyyy" or "مفيش زيارات"), empty states "اكتب اسم أو رقم" / "مفيش مريض بالاسم ده". A row shows the profile on the same page with "رجوع للبحث". No prototype screen for the search: tokens and shared components only.
- b. The same PatientProfile opens as a sheet (size lg, in a body-level portal so it stacks over another sheet) from the visit workspace's `.quick` buttons "التاريخ المرضي" (on "زيارات") and "الفواتير" (on "مدفوعات"), from the doctor's day's next-patient "افتح الملف" (`.brief-act`), and from VisitMenu's "ملف المريض" (owner-approved, any visit whose patient exists). Screen 9's decision c and screen 10's decision b are superseded.
- c. `.pt-hero`: avatar initial; name with `.age` "N سنة · ذكر/أنثى" (each part omitted when unknown; gender only from `patients.gender` `male`/`female`); `.meta` phone (mono, local display) · "أول زيارة: d / m / yyyy" (earliest completed visit), each omitted without data. No file number. `.stat-row`: "زيارات" = completed visits; `.pt-stat.plan` "خطة" = اكتملت / متوقفة / جارية for the most recent plan by start (hidden without one; tapping opens CarePlanSheet, which now also opens on a plan without a visit); `.pt-stat.balance` "متبقي" = the sum over non-void invoices of total − paid, as "1,250", "0" when nothing is owed. Under the hero, "المريض متوقف من N يوم" when that plan is under way and stalled.
- d. `.pt-tabs` (shared ToggleGroup, `patientTab`) with counts: الكل، زيارات، وصفات، رسائل، مدفوعات، ملاحظات.
- e. `.pt-timeline` grouped by Cairo day, newest first; `.pt-day-h` "النهارده · d {month} yyyy" for today, else "d {month} · {the doctor's day's relative helper}", plus " · بداية خطة الرعاية" on a day a plan started. Events, time "H:mm": visit (`.visit`, "ز") — completed: "زيارة — {diagnosis}" (else "زيارة"), or "جلسة {service} · {n} من {count}" when a plan session links to it; `.d` "د. {doctor}" · `.dx` diagnosis · "شكوى: …" · "وصف N أدوية"; cancelled / no-show muted (field surface) as "زيارة اتلغت" / "ما حضرش"; nothing still to come (or in the room) shows; time = started_at, else scheduled_at. rx (`.rx`, "Rx") "وصفة طبية · N أدوية", bold drug names joined by "، " · "اتطبعت" / "لسه ما اتطبعتش" (a prescription with no drug left is not shown); time = created_at. msg (`.msg`, "✉") "{template} · واتساب/SMS", the body's first line · "اتفتحت" / "اتبعتت"; time = attempted_at. pay (`.pay`, "₤") "دفعة · {amount} ج.م {method}", "فاتورة {INV number} · <b>{staff}</b>"; time = created_at. note ("✎", no prototype class: the plain `.icn`) "ملاحظة الطبيب" with the visit's note, at the visit's time, only under "الكل" and "ملاحظات". The newest 100 events, "اعرض أقدم" for 100 more. Tapping a visit opens VisitFormSheet, a prescription the print sheet, a payment its InvoiceSheet (recording a payment there returns to the invoice); a message nothing.
- f. Empty tab states: "لسه مفيش حاجة في ملف المريض", "لسه مفيش زيارات", "لسه مفيش وصفات", "لسه مفيش رسائل", "لسه مفيش مدفوعات", "لسه مفيش ملاحظات".
- The method label is the app's own ("كاش", "فيزا", …), not the prototype's "نقدي".

## Staff identity (fix/staff-identity)

Owner decisions it implements (`docs/schema.md`'s v21 additions,
`api/docs/rls.md`'s "Adding staff", `docs/sync-plan.md`'s "Adding staff,
and ops for entities the server does not sync"):
1. Each membership carries the name the organization uses:
   `memberships.display_name`. Every staff name shown (staff list, lock
   screen, app bar, audit actor, cash close, printed pages, profile) goes
   through `web/src/domain/staffName.ts`, falling back to `users.full_name`
   only when `display_name` is null. Renaming (the staff row's edit form)
   edits `display_name` through the memberships sync — owner-only on the
   device, the same server gap as other settings writes.
2. Adding staff needs a connection and happens on the server in one step:
   `POST /api/staff` → `add_staff_member(jsonb)`, owned by the new
   `clintra_staff` role, which checks that the device token's membership is
   an active owner and that every location and practitioner is the
   organization's (404 otherwise). That proves "a device registered by an
   active owner" (`register_device` always issues the token to the owner),
   not "the person signed in by PIN is an owner" — PIN sessions are
   device-local and the server never sees them; a non-owner calling the
   endpoint from an owner-registered device is not stopped, the same limit
   as every other settings write. Offline the form says "إضافة موظف محتاجة اتصال بالإنترنت"
   and writes nothing. The device stores the returned rows at once.
3. A push op for an entity the server does not sync is rejected alone
   (`unknown_entity`); the rest of the batch applies.
4. The device no longer creates `users` rows; database version 21 removes
   a stuck device's queued `users` ops and the ops of the memberships and
   links created with them.
5. `register_device`'s bootstrap carries each membership's `display_name`.
   An inactive owner's token is refused by `ApplyMembership` (401, kept as
   it is); the function refuses that caller too.

Local setup now needs the `clintra_staff` role — `api/README.md`'s "Fresh
local setup".

## Dark mode (feat/dark-mode)

Owner decisions it implements (`docs/design-tokens.md`'s dark column and
"Dark mode"; `docs/screen-comparison.md`'s "Dark mode"):
1. Dark values come from the prototype verbatim: `web/src/index.css`
   redefines the colour tokens under the prototype's own selectors —
   `@media (prefers-color-scheme: dark)` on `:root:not([data-theme="light"])`,
   and `:root[data-theme="dark"]` — each with `color-scheme: dark`. Default
   is auto (no `data-theme`: the system decides). Tokens the prototype's
   dark blocks do not cover are derived and listed in design-tokens.md:
   `print-note*`, `print-paper`/`print-ink`, `whatsapp`, `brand-*`,
   `glass` keep their light values (the prototype's own literals in both
   themes); the text tokens of decisions 6 and 9 carry the owner's values; the shadow colours `shadow-soft/-mid/-deep` carry the
   prototype's dark `--shadow-s/-m/-l` (Tailwind inlines a theme shadow's
   literal colour, so only a colour token lets dark reach `shadow-*`). The
   body's colour is `text`, not `ink` (equal in light; `ink` is a surface).
2. An icon button cycles تلقائي → فاتح → غامق ("المظهر: …"; the label shows
   beside the icon from `sm` up) in the app bar, on the lock card and on the
   activation card (`web/src/components/AppearanceToggle.tsx`). The choice
   is per device, in a new local-only Dexie store `preferences` (database
   version 22, `web/src/db/preferences.ts`) — not the device row, which
   does not exist before registration and which registration replaces
   whole; never synced (not in `SYNCABLE_TABLES`, no `mutate()`, no audit
   row). No flash: the choice is mirrored into `localStorage`
   (`clintra.appearance`), and an inline script in `web/index.html`'s head
   sets `data-theme` from it before the stylesheet paints; at boot the
   stored choice wins over the mirror. The `theme-color` meta follows the
   active theme's `green`; the manifest's `theme_color`/`background_color`
   stay light (a manifest has one value).
3. Printing is always light: an `@media print` block restates the light
   tokens over both dark selectors, with `color-scheme: light` — every
   printed page (prescription, receipt, invoice, tomorrow's sheet, day-close
   summary) and the prescription portal's paper.
4. No literal colours in `web/src`: whites, blacks and `rgba()` moved to
   tokens (`on-fill`, `glass`, `print-paper`, `print-ink`,
   `shadow-logo`/`-lg`); the settings toggle's knob is `on-ink` (white in
   dark too, as `.toggle::after`; decision 6); focus rings take a `card` ring offset
   instead of Tailwind's literal white. Left as they are: two hex values in
   comments (LockScreen's contrast note, DaySlab's note on the prototype's
   one-off `#0D2621`), the manifest's light colours, and `index.html`'s
   initial `theme-color`.
5. Contrast (WCAG, every text/background token pair in use, both themes)
   is tabled in `docs/design-tokens.md`'s "Contrast" and guarded by
   `web/src/designTokens.test.ts`: a declared list of every pair, computed
   from index.css's own values, each at least 4.5:1 in light and dark. The
   owner's answers to the pairs that were under AA are decisions 6–12.

Owner decisions on contrast (the comparison's four dark [ask] lines, and
the pairs the guard found after them):
6. Text on fills, split by what sits under it. `on-fill`: text and icons on
   a saturated green, green-2, danger, warning, eligible or muted fill —
   `#ffffff` in light, `#081311` (the dark paper) in dark. `on-copper`
   (new): text and icons on copper or copper-2 fills — `#081311` in both
   (light 4.67/6.38). `on-ink` (new): `#ffffff` in both — anything on the
   ink chrome (the lock card's brand, the activation card's title, the
   logo tiles' letter) and the marks that stay white (the switch knob, the
   care-plan hero's top highlight and its progress fill). Every former
   `on-fill` use moved to exactly one of the three. The logo tiles' "C" on
   the green tile is a logotype, outside the guard.
7. `faint` is only for placeholder text inside empty fields and for
   disabled controls; every other faint text (status words, hints,
   timestamps, empty states, counts, units — 40 uses) is `muted`. Faint as
   a non-text mark (separator dots, the cancelled row's stripe and
   strike-through) stays. Placeholders read under AA (light 2.75 on field,
   2.92 on card; dark 3.88, 4.13) and are named outside the guard with
   those numbers; the guard also fails if faint is text anywhere but a
   placeholder.
8. The invoice head's status (`.inv-status`, a 22% tint over ink-2) is a
   solid badge: its status fill with `on-fill` text, in both themes.
9. Light-theme pairs under AA. `copper-ink` (new): copper as text —
   `#8E6222` in light (5.36 on card, 4.69 on copper-wash), `#C79247` (the
   dark copper) in dark; copper stays for fills, borders and icons, and
   every copper text (copper-2 as text on a light surface included) moved
   to it. `green-on-ink` (new): `#37B894` in both — the slab's "arrived"
   count (light 5.49, dark 6.33 on ink-2). `copper-on-ink` (new):
   `#DBA35A` in both — the on-dark copper button's text (light 4.83, dark
   4.95). `copper-2` stays as text on the ink chrome (the lock card's
   "tra", the slab's copper figures: 4.61 light, 7.05 dark on ink-2).
   `warning` on `warning-wash` in light, 4.49, is accepted as it is — the
   guard's one exception.
10. The care-plan hero's text is `on-copper` at full opacity (no 85%/70%
    lines) on a copper → copper-2 fill (the avatars' gradient) in place of
    copper → copper mixed 20% with ink, whose dark end read 3.50 in light.
11. The slab's no-show count (`.cell.miss`, danger on ink: 1.89 light, 4.43
    dark on ink-2) is `danger-on-ink` (new): `#F08C82` in both (light
    5.70, dark 6.58 on ink-2).
12. The card head's badge (`.c-head .badge`, on-dark-dim on 8% glass: 3.90
    light, 3.82 dark) drops its glass fill and keeps its border: on-dark-dim
    on the ink head (4.98 / 4.84).

Every new token is in `@theme`, both dark blocks and the `@media print`
restatement; no prototype value changed.

Screen 10's decision h ("dark mode stays off") is superseded.

## Settled deviations / decisions — prototype alignment

The owner's answers to `docs/screen-comparison.md`'s questions (applied on
`fix/prototype-alignment`). Where an answer says "keep", nothing changed.

### Global
- **Visit status words** follow the prototype everywhere, through one
  `visitStatusLabel` (`web/src/screens/day/statusStyle.ts`): booked "محجوز",
  arrived "وصل" / "وصلت" (`patients.gender` `female` → "وصلت", otherwise
  "وصل"), in_room "في الكشف", completed "اكتمل", no_show "لم يحضر",
  cancelled "ملغي". Kept for the other statuses: confirmed "اتأكد";
  rescheduled has no word (its row reads as an empty slot, so none shows).
  The queue row's `.qwho .meta` follows the patient's gender the same way
  ("خلص" / "خلصت 12:04", "وصل" / "وصلت 12:28"), as does the slot row's
  `.until` ("وصلت 08:52"). The profile's cancelled and no-show visits read
  "زيارة — ملغي" / "زيارة — لم يحضر". The doctor's day shows no status word
  of its own (its list keeps its phrases: "خلصت 09:28", "في الكشف من 12د",
  "مستني" / "مستنية").
- **Audit verbs**: "أنشأ حجز" (a visit created, and a care plan session
  booked), "علّم لم يحضر", "ألغى الحجز"; aligned the same way: "حذف الحجز"
  (a visit deleted, i.e. a booking undone). Unchanged: "علّم وصول", "حوّل
  للكشف", "قفل الزيارة", "أكّد الحجز", "نقل الميعاد", "سجّل دفعة".
- **Page width**: one shared content width for every rail page (day slots,
  day queue, doctor day, current visit, patients and profile, messages):
  `PageMain` (`web/src/components/PageMain.tsx`) with the `max-w-page`
  token, **1116px** — the prototype's `.app` frame inside its 1160px
  `.screen` — and `.content`'s side padding (20px, 12px below 600px). At
  1280 wide the rail leaves about 1056px, so the column takes all of it.
- **Slash dates** ("d / m / yyyy", "d / m") render in the page's own
  right-to-left order, the day on the right, on screen and on paper:
  `web/src/domain/slashDate.ts` formats them and
  `web/src/components/SlashDate.tsx` isolates them right to left. The
  spaceless "d/m" (visit history, the actor's earlier-day suffix) is
  unchanged.
- **Egyptian mobile numbers** display 4-3-4 ("0111 234 5678") in
  `formatEgyptianPhoneForDisplay`; landlines keep their grouping ("02 2123
  4567", "03 123 4567", "050 123 4567").
- **Kept**: bottom sheets (not centred cards); the app bar's sync chip and
  lock button; the practitioner's name as the day card's title; the extra
  row chips, lines and buttons of screens 2, 3 and 5 ("التسجيل", "الزيارة
  اتقفلت من غير تسجيل", "إغلاق الصندوق", "مريض جه دلوقتي", the receipt
  reprint, the void block, the clinic-header hint); the two-step booking;
  the staff active badge (the switch stays in the edit form); "قفل
  الزيارة" without "(يفتح الفاتورة)"; per-row saving in working hours; the
  one-line mobile hours; the doctor day's mobile quick note.

### Per screen
- **1 (PIN lock)**: keep the full-screen overlay — it now holds a `.pin-scr`
  card on the page's paper; keep the neutral title "اكتب الرقم السري", the
  reserved error line and "تبديل المستخدم".
- **3 (queue)**: a waiting row's `.qwait` shows its expected call time as a
  24-hour clock time ("متوقع" over "13:15"), from the existing expected-wait
  computation (`computeExpectedCallTime`); no "استدعاء التالي" in the card
  head (the slab's "التالي" covers it); no reorder button (backlog).
- **4 (new booking)**: keep the shared relative wording — a search result's
  `.rr .m` reads "آخر زيارة قبل …" from the doctor's day's relative helper
  (screen 9 j), not the prototype's "آخر زيارة من N يوم".
- **6 (payment)**: the confirm button reads "أكّد الدفعة واطبع إيصال": it
  records the payment, returns to the invoice and prints that payment's
  receipt through the reprint's own print target, in one tap. A refused or
  failed write prints nothing.
- **7 (cash close)**: summary cells render label and value inline like
  `.close-cell`. The confirm button reads "اقفل اليوم واطبع الملخص": it
  closes the day, then prints a one-page A4 summary
  (`DayCloseSummaryPrint.tsx`, named `@page day-close`, the shared PrintPage
  and printClinic): the clinic block, "إقفال يوم {weekday d month yyyy}",
  patients seen (completed), no-shows, cancellations, collected by method
  (كاش، فيزا، محفظة، تحويل — the payments of the day's invoices, the same
  invoices the expected total sums), total collected, expected cash (the
  close's expected total), counted cash, the difference and its note, who
  closed it, and "طُبعت {d month HH:MM}". A refused or failed close prints
  nothing. The closed state offers "اطبع الملخص" to reprint it.
- **8 (tomorrow's sheet)**: the footer brand reads "Clintra v{version}" from
  web/package.json's version (`printedBrand()`, `web/src/domain/appVersion.ts`),
  shared by every printed page's `.print-foot` (the day sheet and the day
  summary; the invoice, the receipt and the prescription have no footer).
- **9 (doctor day)**: a booked, not-yet-arrived row in "كل اليوم" gets "افتح
  الملف", opening the patient profile sheet.
- **10 (visit workspace)**: the dose line prefixes the duration with "لمدة"
  and bolds the duration ("قرص مرتين يوميًا · لمدة <b>7 أيام</b>"), the same
  on the printed prescription; a duration typed with its own "لمدة" is not
  prefixed twice.
- **11 (audit log)**: the filters are the prototype's four — الكل؛ زيارات
  (visits, visit forms and notes, prescriptions and their drugs, care plans
  and their sessions, patients, messages)؛ فواتير (invoices, payments, the
  cash close)؛ إعدادات (services and their price overrides, working hours,
  staff — users, memberships and their location and practitioner scopes —,
  practitioners, message templates). The action filters are gone. Every
  event the sheet lists stays reachable under "الكل"; the settings rows are
  now listed too, each with its own verb and never a price, a PIN or a scope.
- **12 (working hours)**: every row carries "تعديل", a day off's too, as in
  the prototype. A day off's editor holds the hours only, starting from the
  practitioner's most common hours at the location (ties: earlier start,
  then earlier end; none: 09:00–17:00), and "خليه يوم شغل" creates the
  weekday's schedule row (`addWorkingDay`), copying mode, slot length,
  capacity and resource count from the earliest weekday with those hours
  (none: slots, 30 minutes). A working day's editor adds "خليه إجازة"
  (`removeWorkingDay`), which deletes the weekday's rows in one
  transaction, refused while a visit on that weekday, today or later, still
  holds its slot. Both are ordinary audited `schedules` creates and deletes;
  no schema or server change. The hours are the shared 24-hour TimeField
  (`web/src/components/ui/TimeField.tsx`: hour 00–23 and minute in 5-minute
  steps, Latin digits), labelled "من" and "لحد" — never the native time
  input, which follows the device locale ("09:00 AM").
- **13 (services, edit and add)**: a row's "تعديل" opens the service form
  above its price overrides (which work as before); "خدمة جديدة" opens the
  same form; only one of the two is open at a time. Fields: "اسم الخدمة"
  (required, unique among the organization's services with case and runs of
  spaces ignored), "المدة بالدقايق" (5–480, steps of 5), "السعر الأساسي"
  (pounds, ≥ 0). Nothing applies until "حفظ"; the same checks run in the
  writer (`saveServiceDetails`, `web/src/domain/serviceDetails.ts`), and an
  unchanged save writes nothing. Audited "عدّل خدمة" / "أضاف خدمة", naming
  the service, never its price.
- **13 (services)**: the list is sorted by name under Arabic collation, ties
  broken by id (`sortServicesByName`), so the order is always the same.

## Backlog
- Invoice item editing (screen 5's "تعديل بنود") — owner decision of the prototype alignment: recorded, not built.
- Queue reordering (screen 3's "إعادة ترتيب") — owner decision of the prototype alignment: recorded, not built.
- Server-side per-person identity: the acting membership sent and verified per request (e.g. a PIN-derived proof). Today the server knows only the membership the device token was issued to (the owner who registered the device), so it cannot tell who is signed in; this would close the staff owner check's gap and the other settings-write gaps.
- Members added locally on a device that was stuck before the staff-identity fix stay local-only — none exist today. If one appears, re-add the person online and deactivate the local row.

## Data decisions for the rebuild
- `visits.note text NULL` — the doctor's quick note.
- `practitioners.syndicate_number varchar(50) NULL` — hidden when empty;
  done (decision A, above).
- `prescriptions` numbered `RX-{issued_year}-{sequence}`, sequential per
  location per calendar year, reserved with the same mechanism as invoice
  numbers (`prescriptions.issued_year` is a stored field).
- Per-device number series (owner decision): every device at a location
  gets its own series at registration and mints invoice and receipt numbers
  only inside it, so two devices never collide (`docs/schema.md`'s v16
  additions); prescriptions (RX) will reuse the same series rule.
- `messages` + `message_templates`; template defaults ship with the app and
  `message_templates` holds only an organization's overrides (originally
  "seeded by migration" — changed, see above). A message row records
  `attempted_at`; "sent" is marked manually. WhatsApp opens `wa.me`, SMS
  opens `sms:`. No messaging provider in v1. Done (data only).
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

### Screen 9 (doctor day) — owner decisions over the prototype
- a. Momentum: "متوسط الكشف" is the median of today's recorded consultations; "المخطط" the median service duration of today's occupying visits; lateness (slots only) is now minus the earliest overdue unstarted visit's time, "ماشي في الميعاد" at 5 minutes or less; queue mode shows the median and expected finish only; the bar is hidden until a consultation has a recorded length.
- b. Last visit: the patient's most recent completed visit before the current one, with any practitioner, showing complaint and diagnosis from the visit form; no "موصوف"; empty parts, and the whole block without a prior visit, are omitted.
- c. "افتح الملف" (patient profile) is not rendered until screen 18 exists.
- d. Attention card: only empty diagnoses ("أكمل الآن" opens the visit form) and unpaid or partially paid invoices (no button); no lab referral; not rendered when empty.
- e. Waiting room: arrived visits, waiting from `arrived_at` (fallback `created_at`); above 30 minutes a row is `.wait-item.long`, the header tag turns warning and the footer counts it; empty state "مفيش حد مستني".
- f. Quick note: placeholder "ملاحظة على الزيارة دي…" (the note is visible to anyone who sees the visit), saved through `setVisitNote`, "اتحفظ" after saving; unsaved text survives the idle lock because the screen stays mounted under the lock overlay.
- g. Calling in and closing the visit use the day screen's write paths and advance cooldown; the call button appears only where in_room is an allowed transition, disabled with "فيه مريض في الكشف" while someone is in the room.
- h. "مستني"/"مستنية" from `patients.gender` (`female`), neutral "مستني" otherwise.
- i. Age is the current Cairo year minus `birth_year`, omitted when unknown.
- j. Relative time: days under 14, weeks under 60 days, months after that, with Arabic singular/dual/plural forms.

### Screen 10 (visit workspace) — owner decisions over the prototype
- a. No `.visit-aside`: one `.visit-main` column; the field hint is only the autosave "اتحفظ"; autosave stays per field, on blur, focus-preserving.
- b. `.pt-summary`: avatar initial, name · age (omitted without birth_year), local mono LTR phone when present, "N زيارات · آخر زيارة قبل …" omitting empty parts; no `.quick` buttons until screen 18, no `.plan-badge` until screen 17.
- c. `.visit-history`: the last three completed visits before this one, any practitioner on the device, newest first — d/m, diagnosis (else complaint, else "من غير تشخيص"), " — " first two drug names then "+N"; heading by real count; hidden without a prior visit.
- d. Complaint and diagnosis are the shared Field + TextArea, saved as before.
- e. `.rx-section` with arabicCount ("دواء واحد"/"دوائين"/"3 أدوية"/"11 دواء"); item = LTR name + "instructions · duration" (note muted), tap to edit in place, "حذف", "＋ أضف دواء" inline form; writer errors mapped to Arabic; read-only when not the visit's practitioner, not prescribable, or printed ("الوصفة اتطبعت ومش ممكن تتعدّل"); hidden for a non-prescriber with no drug; the print button arrived with screen 16.
- f. `.runrow`: "قفل الزيارة" only while in_room through the caller's own completion path and cooldown; "حفظ ومتابعة لاحقًا" waits for the field save and closes; `.count` live while in_room, final once completed, "أقل من دقيقة" under one minute.
- g. One VisitWorkspace for VisitFormSheet and the "الزيارة الحالية" rail page (nav key `visit`, practitioner memberships only, after "شاشة الطبيب"): the practitioner's in_room visit today or "مفيش زيارة مفتوحة دلوقتي" with "افتح شاشة الطبيب"; stays mounted under the idle lock on the guarded acting membership.
- h. The legacy tokens are retired from `@theme` and `docs/design-tokens.md` (zero uses in web/src); dark mode stays off.

### Screen 16 (printed prescription) — owner decisions over the prototype
- a. Entry: "اطبع الوصفة" (printed: "اطبع تاني") in `.rx-section` whenever the prescription has a drug, for anyone who sees the section; it opens PrescriptionPrintSheet (Sheet, size lg) with the `.rx-print-page` preview.
- b. One action, "طباعة / حفظ PDF" (the browser's print dialog does both); no PDF button; WhatsApp and SMS wait for screen 19.
- c. The first print asks "بعد الطباعة الوصفة مش هتتعدّل. نطبع؟" ("اطبع" / "رجوع"), then `markPrescriptionPrinted`, then the dialog; reprints open the dialog with no write; refusals (not the visit's practitioner on a first print, empty, write failure) show an Arabic line and never open the dialog.
- d. A5 portrait through a named `@page prescription`, applied only to the print target (`.rx-print-target`, rendered in a body-level portal that leaves `#root` off paper); the day sheet, invoice and receipt keep the default page.
- e. `.rx-doc`: "د. {name}", "{title} · رقم النقابة {n}" (either part omitted when empty, the line when both are — decision A), the printClinic lines; `.rx-num` number and "d / m / yyyy" (print date once printed, today in the preview); `.rx-pt` name, age, diagnosis (snapshot once printed); one `.rx-drug` per item numbered 1..n by position; `.rx-sig`; no legal disclaimer (open owner decision); the screen-only `.rx-print-header`.
- f. After the first print the workspace shows the printed line and read-only list, and the button reads "اطبع تاني".

## Standing rules for the rebuild
- Every commit passes tsc, lint and vitest on its own: tests land in the
  same commit as the change they cover.
- Existing logic and behaviour do not change; vitest and e2e stay green at
  every step, not just at the end.
- Screens without a prototype counterpart (visit menu, move, cancel, sync
  review) get the new tokens and fonts only. A design question that would
  change their behaviour is raised before it is answered.
- Navigation is a role-dependent sidebar: every role sees day, queue,
  messages, audit log, settings and patient search; the doctor also sees
  the doctor day and the current visit. Prescription and care plan open from
  the visit or the patient profile.

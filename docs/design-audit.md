# Design audit: current UI vs. `clintra-screens.html`

Compares every phase-1 ("v1") screen in the design reference
(`clintra-screens.html`, read in full including its embedded CSS) against
what is actually implemented in `web/src/screens/day/`. `docs/schema.md`
contains **no design tokens, screen list, or phase numbering of its own** —
it is a pure data-schema document. The "v1 = screens 1–19" boundary used
here comes entirely from the reference's own phase-1 grouping; it is
corroborated by the fact that every phase-1 screen's stated table (the `t:`
field in the reference's source) is a table `docs/schema.md` lists under
"v1 tables," while phase-2+ screens introduce tables schema.md does not
define at all (`messages`, `waitlist`, `conversations`, `orders`, etc.) —
with one exception, flagged below.

**19 phase-1 screens compared, judged holistically per screen: 0
identical, 0 minor, 5 moderate, 7 major, 7 missing** (not implemented at
all — screens 1, 2, 10, 15, 16, 17, 18). The single biggest gap: **the
reference renders every visit's status as a full card/row
background-colour fill (grid cards in slots mode, filled list rows in
queue mode); the current implementation renders status as a thin
left-edge accent stripe with no fill for most states.** This is the first
thing a doctor or assistant would notice, and it affects the
highest-traffic screen in the whole app (the day schedule, screens 3–4).

A structural note that applies to every screen below rather than to any
one of them: **the reference's per-screen mockups include an in-app
navigation rail** (`.fn` column inside each `.frame`, e.g.
`اليوم · المرضى · الطابور · الفواتير · التقارير · الإعدادات`) that has no
equivalent anywhere in the current app. The current app is a single
screen (`DayScreen.tsx`) with no router and no nav shell at all. This is
called out once here rather than as a repeated row in every table; see
decision category (c) below.

---

## Screen 1 — تسجيل الدخول (وقت التركيب)

**Phase 1. Not implemented.** There is no authentication in this codebase
yet — `db/actingMembership.ts`'s `resolveActingMembership()` is explicitly
documented as a temporary stand-in that always resolves to the seeded
assistant membership. A fix would introduce an entirely new device-activation
flow (mobile + password + clinic code) and is out of scope for a design
pass on screens that already exist.

## Screen 2 — قفل الرقم السري

**Phase 1. Not implemented.** Same root cause as screen 1: no PIN-based
session exists. `resolveActingMembership()`'s own doc comment says this is
"the ONLY place that needs to change once PIN-based sessions exist" — so
this screen and its write-up are already anticipated, just not built.

## Screen 3 — يوم العيادة — نمط المواعيد

**Implemented**: `screens/day/DayScreen.tsx` (header, counters, booking
actions) + `PractitionerColumn.tsx` (slots branch) + `SlotRow.tsx` +
`statusStyle.ts`. **Overall: major.**

| Aspect | Reference | Current | Diff severity | Notes |
|---|---|---|---|---|
| Layout composition | `.frame` with header bar, in-app nav rail (`.fn`), stats bar (`.fs`), then a 3-column grid of slot cards (`.g3`) | Single-column page: brand wordmark, date line, action buttons row, delay chip, location/practitioner filters, counters grid, then a vertical list of slot rows | Major | Reference uses a 3-across card grid; current uses a 1-across vertical list. No nav rail exists at all (see structural note above). |
| Empty-slot rendering | Dashed-border square card, centered `+` glyph, 22px, light grey (`#C2C4BD`) | Dashed-border **row** (not a card) containing the Arabic text "الموعد فاضي" | Moderate | Reference communicates "empty" with a symbol at a glance; current requires reading the words. |
| Visit-row content | Time (top, small), patient name (medium), one status/context line below (e.g. "خلصت", "جوه دلوقتي", "وصل ٥:٢٢") | Time, patient name + status word inline, service name on its own line, plus a "slot free again" line for cancelled/no-show and an overbook badge line | Minor | Current shows strictly more fields (service name always visible; reference's sample doesn't show a service line on this screen). Ordering is otherwise equivalent. |
| Status colour and treatment | Full-card background fill per state: `.pst` grey (past/done), `.now` solid pine (in-room), `.her` soft-pine tint (arrived), `.mis` soft-red tint (missed) | Thin 4px left-edge border stripe only, mostly no fill: booked/confirmed = amber stripe, arrived = amber stripe + faint `bg-amber/10` tint, in-room **and** completed = green stripe (no distinction between them), cancelled = dashed red stripe + strikethrough, no-show = solid red stripe | Major | Two compounding gaps: (1) current's own code comment for `statusVisual()` says the in-room visit "must not look like a plain booking" and must be "unmissable," but the actual treatment is a thin stripe, not the bold full fill the reference (and that comment) call for; (2) completed and in-room share one treatment in slots mode, so a finished visit doesn't visually fade the way it does in queue mode (see screen 4) or in the reference's `.pst` treatment. |
| Counters block placement and definition | Inline stat strip (`.fs`) directly under the header bar: "١٨ محجوز · ٤ فاضي · ٣ وصلوا · ٢ لم يحضروا" (4 metrics, including an empty-slot count) | A 4-box grid (`Counters.tsx`) further down the page, each box a bordered card with a large 2xl number: total booked / arrived / completed / remaining | Moderate | Different metrics (no "فاضي"/empty count in current) and a much heavier visual treatment (large card grid vs. inline text). |
| Primary action affordance | Not directly shown on this screen (booking flow is screen 5) | Two floating pill buttons, bottom-right: "مريض جه دلوقتي" (walk-in) and "حجز" (booking) | Not comparable | Reference doesn't depict the day screen's own booking entry point in this particular mock. |
| Secondary/destructive actions | Not shown on this screen (see screen 6) | Overflow `⋯` menu per occupied row (`VisitMenu.tsx`), opened via a small icon button | Not comparable | Same reason — reference's screen 6 is the comparison point, not this one. |
| Typography weights/sizes | Body 15px/1.65; muted text is explicitly `font-weight:300` (lighter), not just a different colour; headings use the display font at weight 500–600 | Muted text (`text-muted`) only changes colour, still regular weight; headings use `font-display` | Minor | The "muted = lighter weight, not just lighter colour" convention from the reference is absent everywhere in the current app, not just this screen. |
| Digits: clock times | Western ("5:00") | Western, wrapped in `Ltr` (`clockTimeInCairo` + `<Ltr>`) | Identical | |
| Digits: counters | Arabic-Indic ("١٨ محجوز") | Western, wrapped in `Ltr` (`Counters.tsx`) | Major | See decision (a) below — also an internal inconsistency, since queue-mode counts use Arabic-Indic (see screen 4). |
| "recorded by" line | Not shown on this exact screen (see screen 6, which shows "سجّلته منى" on the visit-actions sheet) | Not shown anywhere | Missing | See decision (c) — needs a resolved acting-membership display label, which exists (`resolveActingMembership`) but nothing currently reads it into a UI string. |
| Brand wordmark placement | Appears only in the reference tool's own outer meta-nav sidebar, and on the login screen — never inside a working day-screen mock | Rendered as a large green `text-4xl` "Clintra" heading at the very top of the page, above the date | Major | Current gives the brand name the primary heading position the reference reserves for the date/day context. |

## Screen 4 — يوم العيادة — نمط الطابور

**Implemented**: `PractitionerColumn.tsx` (`QueueColumn`) + `QueueRow.tsx` +
`queueSummary.ts`. **Overall: moderate** — closer to the reference than
slots mode, mainly on the strength of a genuinely bold in-room treatment.

| Aspect | Reference | Current | Diff severity | Notes |
|---|---|---|---|---|
| Layout composition | Same `.frame`/nav-rail/stats-bar shell as screen 3, body is a vertical list (`.lr` rows) plus a dashed "add to queue" affordance at the bottom | Vertical list of `QueueRow`s under the practitioner heading and a one-line summary; add-to-queue is a floating button, not an inline dashed row in the list | Moderate | Conceptually close (both are lists); the "add" affordance's placement differs. |
| Visit-row content | Position number in a 31px rounded square (`.qn`), name, one context line (e.g. "جوه من ٤ دقايق", "مستني من ١٨ دقيقة"), a right-aligned time/action label | Position number (Arabic-Indic, plain text not a badge shape), name + status word, optional "التالي" badge, service line, expected-wait line | Minor | Content parity is good; the position number isn't rendered as a distinct badge shape the way the reference's `.qn` square is. |
| Status colour and treatment | `.lr.done` = full light-grey fill, all text grey; `.lr.acc` (in-room/current) = full soft-pine fill, bold pine name; the position badge itself gets three states (`.qn`/`.qn.on`/`.qn.ok`) | In-room = solid full green fill (`bg-green`) with white text — this one **does** match the reference's "unmissable" intent; next-in-line = soft green tint border; completed/cancelled/no-show = same border treatment at `opacity-60` | Moderate | Better than slots mode: in-room here really is a bold full fill. Still no distinct badge treatment for the position number itself, and "done" fades via opacity rather than a flat grey fill + grey text. |
| Counters block placement/definition | Inline stats bar: "الدور دلوقتي: ٢ · في الانتظار: ٤ · متوسط الكشف: ١١ دقيقة" | One muted text line above the list with the same three metrics, same wording pattern | Minor | Placement (inline text vs. a stats bar) is a cosmetic difference only; content matches closely. |
| Primary action affordance | Dashed inline row at the list's end: "+ إضافة للدور — النمرة الجاية ٥" | Floating pill button "إضافة للدور" (replaces the booking button in queue mode) | Moderate | Reference's affordance also tells the assistant the next position number in advance; current's floating button does not. |
| Secondary/destructive actions | Not shown on this screen | Same overflow menu as slots mode, plus a queue-only "أجّله لآخر الدور" (send to end) item | Not comparable | |
| Digits: position, waiting count, average | Arabic-Indic throughout | Arabic-Indic throughout (`toArabicIndicDigits`) | Identical | The one place digit convention fully matches the reference. |
| "recorded by" line | Not shown on this screen | Not shown | Missing | Same gap as screen 3. |

## Screen 5 — تسجيل الحجز

**Implemented**: `BookingSheet.tsx` (search step, in `"booking"`/`"walk_in"` modes).
**Overall: major** — the missing service-type choice is a functional gap, not just a visual one.

| Aspect | Reference | Current | Diff severity | Notes |
|---|---|---|---|---|
| Layout composition | Small modal frame, search field pre-filled, a short results list where the top (best) match is highlighted with a light-grey background, then a "+ مريض جديد باسم «…»" row inline in the same list | Bottom sheet (`Sheet.tsx`), search field, results list, then a separate no-results state that shows a full-width green "إضافة مريض جديد" button instead of an inline list row | Moderate | Reference always keeps "new patient" as a row in the same list (even when other matches exist); current only offers it once there are zero matches. |
| Visit-row/result content | Name, phone (Arabic-Indic, masked as `xxxxxxx`), "آخر زيارة من X" | Name, "أول زيارة" or last-visit date formatted via `formatCairoDisplayDate` | Moderate | Current doesn't show the patient's phone number in the results list at all — only name and last-visit info. Reference shows both, which is exactly the disambiguator `docs/schema.md`'s own patients-table note relies on for its "phone is not unique" design decision. |
| Primary action affordance | Two service-type toggle buttons (كشف / متابعة) shown directly on this screen, then "تم" | No service choice on this screen — the service is fixed to `defaultService` (the org's first active service) before the sheet ever opens; the flow instead proceeds straight to a time/slot picker | Major | This isn't just visual: the reference's booking flow lets staff pick the visit type at booking time; current's does not expose that choice anywhere in the sheet. |
| Secondary affordance ("من غير رقم") | Present, a bordered pill button next to "تم" | Present, in the new-patient step (not the initial search step) with the same "من غير رقم" wording and matching toggle behaviour | Minor | Same feature, one step later in the flow than the reference places it. |
| Typography/weights | Same base conventions as screen 3 | Same as screen 3 | Minor | |
| Digits: phone | Arabic-Indic (masked sample) | N/A on this screen currently (phone isn't shown in results) — elsewhere Western, `Ltr`-wrapped | Major | See decision (a); also see the missing-phone-in-results row above. |

## Screen 6 — إجراءات المريض

**Implemented**: `VisitMenu.tsx` (overflow menu) + `CancelVisitSheet.tsx` +
one-tap advance buttons on `SlotRow`/`QueueRow` + `MoveVisitSheet.tsx`.
**Overall: major.**

| Aspect | Reference | Current | Diff severity | Notes |
|---|---|---|---|---|
| Layout composition | Small modal, header line shows "أحمد علي · 6:30" then a muted line "كشف · حجز بالتليفون · **سجّلته منى**", then a 2×2 grid of big equal-weight action buttons (وصل / أجّله لآخر الدور / نقل ليوم تاني / إلغاء) | No single "actions" screen at all — actions are split across: one-tap primary buttons directly on the row (attendance advance), an overflow `⋯` menu (move/cancel/no-show/invoice), and a separate `CancelVisitSheet` for the reason prompt | Major | Reference treats these four actions as equally prominent and co-located; current splits them into a one-tap action plus a hidden overflow menu, and the cancel-reason step is a second sheet rather than inline pills on the same screen. |
| Visit-row header context line | "كشف · حجز بالتليفون · سجّلته منى" — service, booking source, **and actor**, all on one line | `CancelVisitSheet` shows only the patient's name as context; nothing shows service, source, or actor together anywhere | Missing | This is the single clearest instance of the "recorded by" gap the task calls out by name. |
| Destructive action grouping | إلغاء is visually distinct (red-tinted outline) but still lives in the same 2×2 grid as the other three | `VisitMenu.tsx` explicitly separates cancel/no-show below a divider from move/send-to-end/invoice, and colours them red — a stronger grouping than the reference's | Minor | Current is arguably more careful here, not less — worth keeping. |
| Cancel-reason affordance | Four inline pills in the same screen: "المريض ألغى / العيادة ألغت / لم يحضر / هيأجّل" (cancel-with-reason and no-show and postpone are unified into one reason picker) | Two-button `CancelVisitSheet` (المريض / العيادة only) — no-show is a separate menu item entirely, with no reason prompt, and there is no "postpone" reason at all | Moderate | Current's model matches `docs/schema.md`'s `cancel_reason` enum (`patient\|clinic\|no_show\|postpone`) only partially: `no_show` bypasses the reason sheet by being its own status/action, and `postpone` isn't offered as a reason anywhere in the UI. |
| Actor label ("سجّلته منى") | Present, muted, small, secondary to the header line | Absent entirely | Missing | See decision (c) — needs a display-name formatter over `resolveActingMembership()`, which the audit-log work this session (`AuditSheet.tsx`) already built one version of (`{full_name} ({role_label})`) but nothing on the day screen itself uses yet. |

## Screen 7 — تسجيل تأخير الطبيب

**Implemented**: `DelayControl.tsx`. **Overall: moderate.**

| Aspect | Reference | Current | Diff severity | Notes |
|---|---|---|---|---|
| Layout composition | Small modal, one muted explanatory line, then a 3-across grid of preset buttons (١٥/٣٠/٦٠ دقيقة), then a muted impact line ("١٢ مريض هيتأثروا · آخر ميعاد هيبقى 10:30") | A pill chip in the day header opens a small dropdown menu with the same three presets plus a "شيل التأخير" (clear) option; impact is reported afterward as a one-line summary ("الطبيب متأخر X دقيقة — البدء الفعلي Y"), not before choosing | Moderate | Reference previews the impact *before* commit (how many patients, new last-appointment time); current only reports the new effective start time *after* the delay is already set, and never reports patient-count impact at all. |
| Primary action affordance | Equal-weight 3-button grid, one already pre-selected/emphasised (٣٠ دقيقة shown filled) | Dropdown menu items, all equal weight, no pre-selected default | Minor | |
| Digits | Arabic-Indic ("١٢ مريض", "١٥ دقيقة") | Western, `Ltr`-wrapped (`delayMinutes`, preset minutes) | Major | See decision (a). |

## Screen 8 — مريض جه من غير حجز

**Implemented**: `BookingSheet.tsx`'s `"walk_in"` mode (reuses the same
search → confirm flow as screen 5, auto-selecting the next empty slot).
**Overall: moderate.**

| Aspect | Reference | Current | Diff severity | Notes |
|---|---|---|---|---|
| Layout composition | Dedicated small screen: one name field, one muted hint line ("هيتحط في أقرب خانة فاضية: 7:00 — ويتعلّم وصول"), one submit button | No dedicated walk-in screen — walk-in is a *mode flag* through the same `BookingSheet` used for scheduled booking; the "will auto-mark arrived" behaviour is real (`status: VisitStatus.Arrived` is set) but never stated as a hint anywhere in the UI | Moderate | Behaviourally equivalent (both land the patient in the next open slot, both mark arrived automatically), but the reference tells the assistant this is happening and current does not. |
| Primary action affordance | Single-field, single-button, minimal screen | Full search-first flow (same as a scheduled booking) — arguably more steps for what the reference treats as a one-field shortcut | Moderate | |

## Screen 9 — بحث المريض

**Implemented, different context**: the search step of `BookingSheet.tsx`.
There is no standalone "المرضى" screen or route — search only exists
inside the booking flow. **Overall: major.**

| Aspect | Reference | Current | Diff severity | Notes |
|---|---|---|---|---|
| Layout composition | Standalone full screen reachable from the nav rail, with its own "المرضى" tab | Not standalone — only reachable by opening the booking sheet | Major | There is no patients index/route at all outside of booking; this is the missing-nav-shell issue (decision c) compounded with an actually-missing screen. |
| Result-row content | Name, phone (Arabic-Indic, masked), visit count ("٩ زيارات"), last-visit recency | Name, last-visit date or "أول زيارة" | Moderate | Same phone/visit-count gap as screen 5's results list (they share the same underlying search, `db/patientSearch.ts`). |
| Digits | Arabic-Indic (phone, visit count) | N/A (phone/count not shown); dates use the mixed weekday/Western-day-number convention from `domain/time.ts` | Major | |

## Screen 10 — الزيارة — النموذج العام

**Not yet implemented. Scope conflict SETTLED by decision A** (see decision
category (a) below): this screen is in v1 scope, and `docs/schema.md` has
been updated so `form_definitions`, `visit_form_data` and
`specialty_templates` are listed under v1 tables rather than under
"declared now, unused in v1, no screens." The screen itself (chief
complaint + diagnosis + service tag + save) still has no implementation —
that remains a future task, now unambiguously in scope rather than
disputed.

## Screen 11 — الفاتورة

**Implemented**: `InvoiceSheet.tsx`. **Overall: major** — the money-digit
convention alone touches this screen's core purpose (it is a financial
document).

| Aspect | Reference | Current | Diff severity | Notes |
|---|---|---|---|---|
| Layout composition | Full-width frame, header bar with invoice number + status badge + "تسجيل دفعة" action inline in the header | Bottom sheet, header row with invoice number + status badge; "تسجيل دفعة" is a separate full-width button lower in the sheet, not in the header | Minor | |
| Status colour/treatment | Status shown as a filled soft-background pill (`.tg.c` amber-soft for partial, etc.) | Status shown as an outlined pill: `border-amber text-amber` (no fill) for partial, etc. (`STATUS_CLASS` in `InvoiceSheet.tsx`) | Moderate | Same filled-vs-outline gap as the day-screen status treatment, here applied to a badge instead of a row. |
| Totals block | Three `.kv` rows (Total / Paid / Remaining), remaining row (`.kv.dif`) has an amber soft-fill background | Three rows (`invoiceTotalLabel`/`invoicePaidLabel`/`invoiceRemainingLabel`), remaining row is only bold, no colour treatment at all | Moderate | The reference visually flags "money still owed" with colour; current relies on font-weight alone. |
| Digits: money | Arabic-Indic, whole pounds, unit "ج" (e.g. "٤٠٠ ج") | Western, two decimal places, unit "ج.م", `Ltr`-wrapped (e.g. "400.00 ج.م") (`formatPiastresForDisplay`) | Major | See decision (a) — this is the most visible instance of the digit-convention divergence, since every money amount in the app goes through this one function. |
| Print header safeguard | Not applicable to this screen in the reference (it has no separate print state) | `printHeaderPlaceholder`/`printHeaderWarning` mechanism (built in a prior task) | Not comparable | Reference's own print screen is screen 14, not this one. |

## Screen 12 — تسجيل دفعة وإيصال

**Implemented**: `PaymentSheet.tsx` (recording) + `InvoiceSheet.tsx` (receipt print, per-payment "طباعة" action).
**Overall: major** — same money-digit reasoning as screen 11.

| Aspect | Reference | Current | Diff severity | Notes |
|---|---|---|---|---|
| Layout composition | Single small modal: amount, method (as a single-line field, not buttons), note, then "تسجيل" + "إيصال" side by side | Bottom sheet: amount, method as a **row of pill-toggle buttons** (four methods), note, single "تسجيل" button; receipt printing lives back on `InvoiceSheet`, one button per already-recorded payment | Moderate | Current's method-as-pills is arguably a better affordance than the reference's plain field, but it is a real layout difference. Receipt printing is one screen removed from where the reference puts it (same modal). |
| Digits: amount | Arabic-Indic in the reference's sample value ("٢٠٠") | Western (plain `<input>`, and `formatPiastresForDisplay` for the remaining-balance line) | Major | See decision (a). |

## Screen 13 — إقفال اليوم

**Implemented**: `CashCloseSheet.tsx`. **Overall: major** — the missing
overdue/no-show list is a functional gap the reference treats as this
screen's second purpose, not a decoration.

| Aspect | Reference | Current | Diff severity | Notes |
|---|---|---|---|---|
| Layout composition | Full-width frame: a `.kv` breakdown (كشوف تمت / متابعات, each with a "count × price = subtotal" line), a Total row, a Collected row, a Difference row, then a separate `.fm` block listing still-booked-but-time-passed patients with a "لم يحضر" tag each | Bottom sheet: a single Expected line (no per-service-type breakdown), a Collected input, a Difference line, a note input, a confirm button — **no list of still-booked/overdue patients anywhere in this sheet** | Major | The reference's cash-close screen doubles as the mechanism that surfaces unresolved no-shows at end of day ("لسه محجوزين ومر وقتهم — علّمهم"); the current implementation has no equivalent, and no-show marking only happens via the per-row overflow menu earlier in the day. |
| Expected-total breakdown | Itemised by service type with quantity × price shown | Single number from `computeExpectedCashTotal` — no breakdown shown to staff | Moderate | Behaviourally the total may be correct; the reference's itemised view is auditable at a glance, current's is not. |
| Difference row treatment | `.kv.dif` — amber soft-fill background, bold | Plain text row, no colour treatment even when non-zero | Moderate | Same missing-soft-fill-token issue as screens 3 and 11. |
| Digits: money | Arabic-Indic, whole pounds | Western, two decimals, `Ltr`-wrapped | Major | See decision (a). |

## Screen 14 — ورقة اليوم (طباعة)

**Implemented**: `DaySheet.tsx` (this session's phase-9 work). **Overall: moderate.**

| Aspect | Reference | Current | Diff severity | Notes |
|---|---|---|---|---|
| Screen title vs. actual content | Titled "ورقة **اليوم**" (today's sheet) but the printed sample content is dated "الاثنين ٢٥ أغسطس" against a day-screen sample dated "الأحد ٢٤ أغسطس" — i.e. **the reference's own sample content is tomorrow's date, despite the screen being named "today."** | Named "ورقة **الغد**" (tomorrow's sheet) and genuinely prints tomorrow's date (`addDaysToClinicDay(today, 1)`) | — | This is flagged under decision (b) below: the reference is internally inconsistent about which day this screen covers, and the current implementation resolved that inconsistency in favour of what the content actually shows, not what the title says. |
| Layout composition | `.frame.print` card, header row: clinic name (right) + muted date line (left), separated by a 2px pine rule, then a plain `.tbl` table (Time / Patient / Phone / Type) | Same general shape: a header line, then a plain HTML `<table>` with the same four logical columns (time-or-position / patient / phone / service) | Minor | Very close. Reference's header is a real clinic name; current's print header is the mandated `printHeaderWarning` placeholder, correctly, since no clinic-branding settings screen exists yet (see screen 15/17). |
| Digits: phone, time | Arabic-Indic phone, Western time | Western time and phone both, unwrapped in the print block (no `Ltr`, matching `InvoiceSheet`'s existing print-block convention of not isolating direction for printed output) | Major | Same phone-digit divergence as screens 5/9, on a printed page this time. |

## Screen 15 — الإعدادات — مواعيد العمل

**Not implemented.** No settings screens or settings route exist anywhere
in the app. A fix would introduce a new settings section (and, per the
structural note above, somewhere to navigate to it from).

## Screen 16 — الإعدادات — الخدمات

**Not implemented.** Same as screen 15. Note for later: this is also the
screen where the reference's only v1-scope use of the purple token
(`--pur`/`--purs`, for a price-override tag) appears — see decision (a),
since the current palette has no purple token at all yet.

## Screen 17 — الإعدادات — الموظفون والصلاحيات

**Not implemented.** Same as screen 15 — additionally depends on
authentication (screens 1–2) existing first, since this screen's whole
purpose is managing the memberships/roles that a real login would use.

## Screen 18 — شاشة الطبيب — قائمة اليوم

**Not implemented.** The current app has exactly one screen
(`DayScreen.tsx`), used identically regardless of who's "logged in" (there
is no login). A fix would need a second, phone-sized, read-mostly view of
the same visit data, and a way to route a doctor's session there —
depends on screens 1–2.

## Screen 19 — سجل التدقيق

**Implemented**: `AuditSheet.tsx` (this session's phase-9 work). **Overall: moderate.**

| Aspect | Reference | Current | Diff severity | Notes |
|---|---|---|---|---|
| Layout composition | Full-width frame reachable from a "التقارير" nav-rail context, plain list, no filters shown in the sample | Full-height bottom sheet, two rows of pill filters (entity type, action) above the list | Moderate | Current adds filtering the reference's sample doesn't show; the sheet-vs-full-screen container difference is the same nav-shell gap noted structurally above. |
| Row content | One bold action line ("إلغاء حجز — طارق حسن"), one muted line combining **actor + detail** ("منى · السبب: المريض ألغى"), a time on the trailing edge | One line combining verb + entity description ("علّم وصول — أحمد علي"), a muted actor-only line beneath it, a time on the trailing edge | Minor | Both keep the actor visually secondary to the action, matching the specification's "timeline, not surveillance" framing. Current separates actor from other detail (reason, old/new value) onto two different lines rather than combining them on one muted line the way the reference does — a real but small structural difference once reasons/diffs are added to more verbs. |
| Actor label | First name only ("منى") | `"{full_name} ({role_label})"`, e.g. "سارة حسن (المساعد)" | Minor | Current is more explicit (includes role); reference is terser. Note: the reference's example staff name is "منى" everywhere; the actual seed data names the assistant "سارة حسن" — cosmetic, not a design issue, but worth knowing the sample names never matched. |
| Time format | "٦:٠٢ م" — 12-hour with Arabic-Indic digits and ص/م suffix | "18:02"-style 24-hour Western digits (`clockTimeInCairo`, `HH:MM`) | Major | Two independent divergences stacked: 12-hour vs. 24-hour, and digit convention. This is the same clock-time convention used everywhere else in the app (screens 3, 4), so fixing it here alone would create a new inconsistency rather than resolve one — see decision (a). |

---

## Decisions to make before implementation

### (a) Places the current implementation deliberately (or by inertia) differs from the reference

**SETTLED**, recorded verbatim as given:

> **Decision A.** The visit form (screen 10) IS in v1 scope. The design
> reference is right, and the earlier "declared now, unused" scoping in
> `docs/schema.md` needed to be updated for that table. This does not
> change the schema — `visit_form_data`, `form_definitions` and
> `specialty_templates` already exist and are correct — it only changes
> their status from "no screens" to "in v1". *(Applied: `docs/schema.md`
> now lists these three tables under v1 tables, not under "declared now,
> unused in v1, no screens.")*
>
> **Decision B.** All numbers in the app remain Western digits (0-9). This
> is deliberate and diverges from the design reference on purpose. Reason:
> the app already uses Western digits for times, invoice numbers, hex
> values, and identifiers; mixing digit systems inside a single screen
> (e.g. Arabic-Indic money next to Western clock times on the invoice
> screen) is harder to read than committing consistently to one. The
> reference is not enforceable as-is because it is itself inconsistent
> (queue counts already use Western digits in the current implementation
> and Arabic-Indic in some reference screens). *(This resolves items 1–4
> below as: keep Western digits everywhere, including reconciling
> slots-mode counters — item 4's internal inconsistency — to Western, the
> same direction as queue-mode's `Ltr`-wrapped counters, not the other way.
> Each screen's actual digit rendering is unchanged until that screen's own
> rework task; this decision only settles which direction to reconcile
> toward.)*
>
> **Decision C.** Three colour tokens named in the design reference are
> missing from our theme and must be added: a light green fill, a light
> amber fill, and a purple accent. They are used by the reference for soft
> status backgrounds and secondary tags respectively. *(Applied: the light
> green fill already existed as `--color-green-soft`; `--color-amber-soft`,
> `--color-purple` and `--color-purple-soft` were added to
> `web/src/index.css`'s `@theme` block — see `docs/design-tokens.md`. This
> resolves item 6 below at the token level only; no component has been
> switched to use the new tokens yet, which remains a separate,
> screen-by-screen task.)*

Still open — not addressed by decisions A–C:

5. **Clock-time format.** Reference: 12-hour with ص/م. Current: 24-hour
   (`clockTimeInCairo` always returns `"HH:MM"` in 24-hour form). This is
   used pervasively (schedule grids, audit log, queue) — a reconciliation
   here is an app-wide change, not a per-screen one, and still needs a
   decision.

Resolved by decision B (kept for the record of what was being decided):

1. **Digits for money.** Reference: Arabic-Indic, whole pounds, "ج" suffix
   (e.g. "٤٠٠ ج"). Current: Western digits, two decimal places, "ج.م"
   suffix, wrapped in `Ltr` (`domain/money.ts`'s `formatPiastresForDisplay`).
   Affects screens 3 (counters — see below), 11, 12, 13, 14.
2. **Digits for phone numbers.** Reference: Arabic-Indic (masked samples).
   Current: Western, `Ltr`-wrapped (`domain/phone.ts`'s
   `formatEgyptianPhoneForDisplay`). Affects screens 5, 9, 14.
3. **Digits for the calendar day number.** Reference: Arabic-Indic
   ("٢٤ أغسطس"). Current: Western, deliberately — `domain/time.ts`'s
   `CAIRO_DISPLAY_DATE_FORMATTER` comment states this is intentional, "to
   match the Western digits used elsewhere on screen." Decision B confirms
   that rationale rather than overturning it.
4. **Digits for slots-mode day counters vs. queue-mode counters — an
   internal inconsistency, not just a reference mismatch.** Queue-mode
   counters (current position, waiting count, average) use Arabic-Indic
   digits today (`toArabicIndicDigits`); slots-mode day counters
   (total/arrived/completed/remaining, `Counters.tsx`) use Western digits
   via `Ltr`. Decision B means queue-mode's counters are the one that needs
   to change, once that screen is reworked — not the other way.
6. **Status badges: outline vs. filled.** Reference fills every status/tag
   pill with a soft tinted background (`.tg.*` classes all set both
   `background` and `color`). Current's equivalents (`InvoiceSheet`'s
   `STATUS_CLASS`, `CashCloseSheet`'s difference row, `SlotRow`'s
   `statusVisual`) mostly use a border/left-accent-stripe with no fill.
   Decision C adds the missing tokens (`--color-amber-soft`,
   `--color-purple`, `--color-purple-soft`); switching these components to
   use filled soft backgrounds is still a separate, unstarted task.

### (b) Places the reference is internally inconsistent between its own screens

1. **Screen 14's title says "اليوم" (today) but its own sample content is
   dated for the day after the day-screen samples (screens 3/4).** The
   current implementation picked the content's meaning ("tomorrow") over
   the title's wording and named the feature "ورقة الغد" accordingly — this
   audit surfaces that choice rather than silently inheriting the
   reference's mismatched title.
2. **Money's digit convention itself is consistent across the reference**
   (always Arabic-Indic, always whole pounds) — no internal inconsistency
   found here, only a reference-vs-current one (see (a)1).
3. **No other cross-screen inconsistency was found** in the reference's own
   digit or colour conventions during this pass — phone numbers, dates, and
   counts are all Arabic-Indic everywhere they appear in phase 1.

### (c) Places that need new infrastructure before the reference's design can be applied

1. **A sidebar/nav-rail shell.** Nearly every phase-1 screen assumes a
   working nav rail (اليوم / المرضى / الطابور / الفواتير / التقارير /
   الإعدادات) that simply does not exist — the app is one screen with no
   router. This blocks screens 9, 15, 16, 17, 19 from ever having a
   standalone equivalent, and affects the layout-composition row of every
   other screen in this document.
2. **A "recorded by `<name>`" display label.** The reference shows this on
   screens 3 (implicitly, via row detail), 6 (explicitly, "سجّلته منى"), and
   19 (as "منى"). `resolveActingMembership()` already resolves the acting
   membership; `AuditSheet.tsx` (built this session) already formats
   `"{full_name} ({role_label})"` from it — but nothing on the day screen
   itself (screens 3, 4, 6) reads this yet. Wiring it in is small once the
   nav/label question is settled, but it touches every visit row.
3. **A purple design token — SETTLED by decision C, applied.**
   `--color-purple` (`#453fa0`) and `--color-purple-soft` (`#edebfb`) now
   exist in `web/src/index.css`'s `@theme` block (see
   `docs/design-tokens.md`). Screen 16 (settings → services) is still the
   only phase-1 screen that would use them, and screen 16 itself remains
   unbuilt — the token existing doesn't change that.
4. **Soft-fill amber/red tokens and the full palette reconciliation —
   SETTLED and applied.** `--color-amber-soft` (`#f6efdd`) was added
   alongside the existing `--color-green-soft`, closing gap (a)6 at the
   token level. A follow-up full reconciliation against the reference's
   entire `:root` block (prompted by the day-screen redesign task needing
   an arrived-row meta colour) found zero hex disagreements and three more
   real, multiply-used tokens worth adding: `--color-red-soft` (`#faecea`,
   matching `--reds`), `--color-green-medium` (`#4c8571`, matching `--pm`),
   and `--color-line-soft` (`#edeee8`, matching `--rs`) — see
   `docs/design-tokens.md` for each one's confirmed usage count and intended
   use. `--color-card` (`#fff`, matching the reference's `--card`) was
   deliberately **not** added: it is used exactly once in the entire
   reference file, and that one use is the reference tool's own outer
   screen-picker sidebar background, not any actual per-screen mockup —
   revisit only if a real screen design ever needs a card surface distinct
   from `--color-paper`.
5. **A doctor-facing mobile view (screen 18) and an auth/PIN flow (screens
   1–2)** are both prerequisite infrastructure for several other screens
   (17, and implicitly 18 itself) rather than isolated visual gaps.

---

## Out of scope for this v1 design pass

Every phase 2–5 screen in the reference, listed for completeness only —
not compared:

**Phase 2** — رسالة التأكيد · رسالة التذكير + تأجيل · قوالب الرسائل ·
التقرير الأسبوعي · لوحة الطبيب الصبح

**Phase 3** — صفحة حجز المريض · المكالمات الفايتة · قائمة الانتظار ·
المساعد الآلي على الرسايل · صندوق محادثات المساعد

**Phase 4** — ملف المريض · الخط الزمني الموحّد · ملخص قبل الكشف ·
المتابعات المتأخرة · الروشتة الرقمية · إنشاء خطة رعاية · متابعة خطة
الرعاية · تقرير المتوقفين · نموذج تخصص — الأسنان · نموذج تخصص — العلاج
الطبيعي · باني النماذج

**Phase 5** — طلب تحليل · رحلة التحليل · صندوق النتائج · التحويل لزميل ·
شاشة غرفة الانتظار

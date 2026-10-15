# Screen-by-screen comparison against the prototype

Every screen of `docs/reference/clintra-prototype.html` (sections `#s1` …
`#s19`) next to the app driven to the state that best matches it, at desktop
(1280 wide) and mobile (390 wide). The captures come from
`pnpm --dir web test:compare` (`web/e2e/compare.spec.ts`); open
`web/e2e/compare/index.html` to see each pair side by side. The images are
regenerated on every run and are not committed.

This is the comparison after the prototype alignment (`fix/prototype-alignment`):
every earlier [fix] is applied, and every earlier [ask] is answered by the
owner — those answers are recorded in `docs/session-handoff.md` under
"Settled deviations / decisions — prototype alignment" and cited below as
[decided].

How to read it:

- The prototype's own document chrome (`.topbar`, `.role-div`,
  `.screen-head` with the screen number, title and sub-line, the closing
  `.notes`) is not part of any screen and is not compared.
- Both sides render IBM Plex Sans Arabic from the app's own font files (the
  capture inlines them into the prototype instead of its Google Fonts link).
- Each line is one visible difference, classified as exactly one of:
  **[decided]** an owner decision already recorded (cited by file and line);
  **[data]** only the sample data or the capture's own state differs;
  **[fix]** an unexplained difference that should be changed to match the
  prototype (what, and where);
  **[ask]** a difference that needs an owner decision (the question).
- A difference that shows on both viewports is listed once; a line marked
  "Mobile:" shows only at 390.
- Verdict per screen: **matches** — no [fix]; **small fixes** — one to three
  [fix] lines, all local; **needs work** — four or more [fix] lines.

## 1. PIN lock (`#s1`)

App capture: the lock overlay's PIN pad for the assistant, two digits keyed in.

- [decided] The keypad reads 1 2 3 left to right, so 0 sits in the middle and "مسح" on the right of the last row; the prototype mirrors the pad (`docs/design-rule.md:58-59`).
- [decided] The lock stays a full-screen overlay, opaque on the page's paper, holding a `.pin-scr` card (`docs/session-handoff.md:242-244`).
- [decided] The title reads the neutral "اكتب الرقم السري" (`docs/session-handoff.md:242-244`).
- [decided] An empty error line keeps its space between the dots and the pad, so the pad never moves when an error shows (`docs/session-handoff.md:242-244`).
- [decided] "تبديل المستخدم" under the pad (`docs/session-handoff.md:242-244`).
- [data] Key "2" shows its hover fill: the pointer rests on it after the capture's last tap.

## 2. Day — slots (`#s2`)

App capture: the whole page — the seeded Monday for the slots doctor, كريم called in.

- [decided] A role-dependent sidebar (desktop rail, mobile bottom bar) frames the page instead of the prototype's single `.app` frame (`docs/design-rule.md:55-57`).
- [decided] The app bar keeps the page title, the "متصل" sync chip and "قفل الشاشة", with the brand on the rail (`docs/session-handoff.md:232-239`).
- [decided] Slab, tiles and card share the one page width, `max-w-page` (1116px, the `.app` frame); at 1280 the rail leaves the column about 1016px (`docs/session-handoff.md:217-222`).
- [data] Practitioner switcher pills (أحمد المصري / سلمى إبراهيم): the demo has two practitioners, and the prototype's notes say switchers appear by themselves when a clinic grows.
- [decided] The card head's title is the practitioner's name ("أحمد المصري") (`docs/session-handoff.md:232-239`).
- [decided] Each row carries a "…" visit-menu trigger; the visit menu has no prototype counterpart (`docs/session-handoff.md:356-357`).
- [decided] The "التسجيل" chip on in-room and completed rows and the "الزيارة اتقفلت من غير تسجيل" line under a completed row without a visit form (`docs/session-handoff.md:232-239`).
- [data] No `.until` sub-line under the times and no phone in `.meta`: the seeded day is in the past and the demo patients have no phone (the row renders both when present).
- [data] Row statuses, the slab's and tiles' figures, and the number of empty slots (5 against 2).
- [decided] "إغلاق الصندوق" in `.slab-act` (`docs/session-handoff.md:232-239`).
- [decided] The close time reads "إقفال 14:00", the app's 24-hour clock (`docs/session-handoff.md:180`).
- [data] An undo toast ("دخل المريض الكشف · تراجع") at the bottom: the capture's own last action.

## 3. Day — queue (`#s3`)

App capture: the whole page — the seeded Monday for the queue doctor.

- [decided] The role-dependent sidebar frames the page (`docs/design-rule.md:55-57`).
- [decided] The app bar's sync chip and lock button (`docs/session-handoff.md:232-239`).
- [decided] The one shared page width (`docs/session-handoff.md:217-222`).
- [data] Practitioner switcher pills: two practitioners in the demo.
- [decided] The card head's title is the practitioner's name ("سلمى إبراهيم"), with no "استدعاء التالي" (the slab's "التالي" covers it) (`docs/session-handoff.md:232-239`, `:245-248`).
- [decided] `.slab-act` has no "إعادة ترتيب" (backlog) and adds "تسجيل تأخير الطبيب" and "إغلاق الصندوق" (`docs/session-handoff.md:245-248`, `:289-290`).
- [decided] "يتوقع خلاص 10:33" and each waiting row's `.qwait` "متوقع 10:11" use the 24-hour clock (`docs/session-handoff.md:180`, `:245-248`).
- [decided] Each row carries the "…" visit-menu trigger (`docs/session-handoff.md:356-357`).
- [decided] The "التسجيل" chip, the "الزيارة اتقفلت من غير تسجيل" line and the "مريض جه دلوقتي" pill (`docs/session-handoff.md:232-239`).
- [data] Names, numbers, the no-show row, and the prototype's walk-in line "جه من غير حجز".

Mobile: the slab's vertical rule beside the stacked `.side` cells matches — in both it is the second and third cells' own start border (none beside the first, none on `.side` itself), at the same place and height; an earlier [fix] line here was withdrawn.

## 4. New booking (`#s4`)

App capture: the booking sheet opened from the 11:30 slot, searching «كريم» (the prototype's search-and-pick state).

- [decided] Every sheet is a bottom sheet with a close × (`docs/session-handoff.md:232-239`).
- [decided] The flow takes two steps — results first, then the service picker and the footer once a patient is picked (`docs/session-handoff.md:232-239`).
- [decided] A result's `.rr .m` reads "آخر زيارة قبل يومين", the doctor's day's shared relative helper, not the prototype's "آخر زيارة من 20 يوم" (`docs/session-handoff.md:249-251`).
- [data] One «كريم» in the demo, without a phone (the prototype shows two, with phones).

## 5. Invoice (`#s5`)

App capture: the invoice sheet, half the total paid in cash.

- [decided] The invoice is a bottom sheet with a close × (`docs/session-handoff.md:232-239`).
- [decided] The "ترويسة العيادة — تتضبط من الإعدادات" line at the top of the body (`docs/session-handoff.md:232-239`).
- [decided] The payment method reads "كاش", not "نقدي" (`docs/session-handoff.md:193`).
- [decided] The receipt and creation times read "10:00", the 24-hour clock (`docs/session-handoff.md:180`).
- [decided] The "طباعة" link on each payment row (`docs/session-handoff.md:232-239`).
- [decided] No "تعديل بنود" pill: item editing is backlog (`docs/session-handoff.md:289`).
- [decided] The "إلغاء الفاتورة" block with "مفيش إلغاء بعد تسجيل دفعة" (`docs/session-handoff.md:232-239`).
- [data] Invoice number, patient, items and amounts; the invoice is dated today although the seeded day is a past Monday (writes use the real clock).

## 6. Payment and receipt (`#s6`)

App capture: the payment sheet over a partially paid invoice, the remaining amount typed in.

- [decided] Bottom sheet against the prototype's centred `.book` card (`docs/session-handoff.md:232-239`).
- [decided] The first method reads "كاش", not "نقدي" (`docs/session-handoff.md:193`).
- [decided] "أكّد الدفعة واطبع إيصال" records the payment and prints its receipt in one tap (`docs/session-handoff.md:252-255`).
- [data] "75.00": the capture typed the amount with two decimals; patient and amounts.

## 7. Cash close (`#s7`)

App capture: the cash close sheet on the real day after one visit paid in full in cash, the drawer amount matching.

- [decided] Bottom sheet against the prototype's page card; the summary grid is two across in the sheet against four across on the page (`docs/session-handoff.md:232-239`).
- [decided] "تصدير CSV" instead of "تصدير Excel" (`docs/design-rule.md:52-54`).
- [decided] "اقفل اليوم واطبع الملخص" closes the day and prints its summary (`docs/session-handoff.md:256-266`).
- [data] The sub-line's time is the capture's pinned clock ("09:00"); amounts, the invoice and no-show counts, and the closer's name (the owner ran the capture).

## 8. Tomorrow's sheet (`#s8`)

App capture: the tomorrow's-sheet preview, the seeded Monday's slots-doctor visits written again as tomorrow's bookings.

- [decided] The page is previewed inside a sheet (title "جدول زيارات الغد", "طباعة ورقة الغد", ×) (`docs/session-handoff.md:232-239`).
- [decided] Footer and table times use the 24-hour clock (`docs/session-handoff.md:180`).
- [decided] The footer's brand reads "Clintra v{version}" from web/package.json (`docs/session-handoff.md:267-270`).
- [data] The version itself: web/package.json says 0.0.0 ("Clintra v0.0.0" against the prototype's "v1.0").
- [data] Clinic name and address, patients, services, the patient count; the demo patients have no phone ("بدون رقم").

## 9. Doctor's day (`#s9`)

App capture: the whole page — the doctor's day mid-morning.

- [decided] The role-dependent sidebar frames the page (`docs/design-rule.md:55-57`).
- [decided] The app bar's sync chip and lock button (`docs/session-handoff.md:232-239`).
- [decided] The one shared page width (`docs/session-handoff.md:217-222`).
- [data] The momentum bar is in its on-time state ("ماشي في الميعاد") against the prototype's late state; times and medians.
- [data] No age in the brief (no birth year for that patient in the demo); one prior visit.
- [decided] The last-visit block has no "موصوف" part (`docs/session-handoff.md:323`).
- [decided] The quick note's placeholder reads "ملاحظة على الزيارة دي…" (`docs/session-handoff.md:327`).
- [data] The quick note's "حفظ" is disabled: nothing typed.
- [decided] "استدعِ للكشف" is disabled with "فيه مريض في الكشف" while someone is in the room, in the brief and the day list (`docs/session-handoff.md:328`).
- [data] Waiting rows show the booked time instead of "نمرة N": the capture is a slots day.
- [decided] The attention card has no lab-referral item and the unpaid-invoice item no button (`docs/session-handoff.md:325`; `docs/design-rule.md:50-51`).
- [decided] A booked visit not yet arrived gets "افتح الملف" in the day list (`docs/session-handoff.md:271-272`).
- [decided] Mobile: the quick-note input stays inside its card (`docs/session-handoff.md:232-239`).
- [decided] Times use the 24-hour clock (`docs/session-handoff.md:180`).

## 10. Visit workspace (`#s10`)

App capture: the visit sheet for كريم in the room — history, complaint, diagnosis and three drugs (no plan under way).

- [decided] The workspace is a bottom sheet titled "ملف الزيارة" with a close ×, the arrival time beside it (`docs/session-handoff.md:232-239`).
- [decided] No `.visit-aside` assistant panel; one `.visit-main` column (`docs/design-rule.md:29-33`; `docs/session-handoff.md:334`).
- [data] "زيارتين · آخر زيارة قبل 3 أيام" and the age.
- [decided] "ابدأ خطة رعاية" in place of `.plan-badge`: no plan is under way (`docs/session-handoff.md:178`).
- [decided] The history's heading counts the real visits ("آخر زيارتين") and each row ends with the drug names (`docs/session-handoff.md:336`).
- [decided] No field hint besides the autosave "اتحفظ" (`docs/session-handoff.md:334`).
- [decided] The dose line reads "… · لمدة <b>7 أيام</b>"; only the duration is bold, not the counts (`docs/session-handoff.md:273-276`).
- [decided] An extra "اطبع الوصفة" under the list (`docs/session-handoff.md:344`).
- [decided] The run button reads "قفل الزيارة", without "(يفتح الفاتورة)" (`docs/session-handoff.md:232-239`).
- [data] Complaint, diagnosis, drugs and the session length.

## 11. Audit log (`#s11`)

App capture: the audit sheet on the real day — three bookings, an arrival, a cancellation and a no-show.

- [decided] Bottom sheet against the prototype's page card (`docs/session-handoff.md:232-239`).
- [decided] The filters are the prototype's four, each with its own groups of events (`docs/session-handoff.md:277-284`).
- [decided] Verbs read "أنشأ حجز / علّم لم يحضر / ألغى الحجز" (`docs/session-handoff.md:213-216`).
- [decided] Times use the 24-hour clock (`docs/session-handoff.md:180`).
- [data] Six events, all minutes old, so every row carries "من 5د"; names; the `.who` context is the visit's time ("موعد 10:00") where the prototype shows other contexts ("شاشة اليوم", «طلب المريضة»).

## 12. Settings — working hours (`#s12`)

App capture: the settings sheet's working-hours tab, as the owner.

- [decided] Bottom sheet against the prototype's page card (`docs/session-handoff.md:232-239`).
- [decided] An extra tab "الأطباء" (`docs/session-handoff.md:90-92`).
- [decided] No run row: each row saves on its own (`docs/session-handoff.md:232-239`).
- [decided] Mobile: hours stay on one line (`docs/session-handoff.md:232-239`).
- [data] Every day 09:00–14:00 in slots of 30 minutes; the location's name.

## 13. Settings — services (`#s13`)

App capture: the settings sheet's services tab, as the owner, one service stopped.

- [decided] Bottom sheet against the prototype's page card (`docs/session-handoff.md:232-239`).
- [decided] The extra tab "الأطباء" (`docs/session-handoff.md:90-92`).
- [decided] Services are listed by name under Arabic collation (`docs/session-handoff.md:285-286`).
- [data] Services, durations and prices.

## 14. Settings — staff (`#s14`)

App capture: the settings sheet's staff tab, as the owner.

- [decided] Bottom sheet against the prototype's page card (`docs/session-handoff.md:232-239`).
- [decided] The PIN shows as a "مُعيّن ✓" badge, never its digits (`docs/design-rule.md:38-39`).
- [decided] The active state is a "مفعّل" badge; the switch stays in the edit form (`docs/session-handoff.md:232-239`).
- [decided] The extra tab "الأطباء" (`docs/session-handoff.md:90-92`).

## 15. Device activation (`#s15`)

App capture: the activation card before activating, both fields filled.

- [decided] The fields are the 16-character activation code ("كود التفعيل") and the owner's phone; no SMS code field and no "will be registered to …" line (`docs/design-rule.md:40-45`).
- [data] The phone shows as typed, focused (the capture's last field).
- [data] The code's value.

## 16. Printed prescription (`#s16`)

App capture: the print sheet's preview for كريم's three drugs, before the first print.

- [decided] The preview sits in a sheet titled "الوصفة" with a close × (`docs/session-handoff.md:232-239`).
- [decided] One action, "طباعة / حفظ PDF", and no PDF, WhatsApp or SMS buttons before the first print (`docs/session-handoff.md:345`, `:172`).
- [decided] The preview note names that one action ("دي معاينة للطباعة · اضغط «طباعة / حفظ PDF»") (`docs/session-handoff.md:345`).
- [decided] The date reads right to left, the day furthest right (`docs/session-handoff.md:223-228`).
- [decided] The dose line reads "· لمدة <b>7 أيام</b>" (`docs/session-handoff.md:273-276`).
- [data] Title "طبيب عام" without a syndicate number, the clinic, the RX number, the drugs' texts and forms.

## 17. Care plan (`#s17`)

App capture: the care plan sheet — five sessions done, the sixth booked, four suggested.

- [decided] Bottom sheet titled "خطة الرعاية" against the prototype's two page cards (`docs/session-handoff.md:232-239`).
- [decided] Session names are the services' names (`docs/session-handoff.md:310-313`).
- [decided] `.meta` reads "d / m · د. {doctor} · {duration} دقيقة", a booked session adding "h:mm" — "14 / 10 · 9:30" instead of "النهارده · 4:30 م" (`docs/session-handoff.md:180`).
- [decided] Suggested rows carry "أجّل" (`docs/session-handoff.md:180`).
- [decided] "احجز الجلسة التالية" is disabled with "الجلسة التالية محجوزة 14 / 10 · 9:30" while the next session is booked (`docs/session-handoff.md:181`).
- [data] Dates, totals, paid, durations and the diagnosis text.

## 18. Patient profile (`#s18`)

App capture: the whole page — كريم's profile from the patients page, on the الكل tab.

- [decided] The role-dependent sidebar frames the page (`docs/design-rule.md:55-57`).
- [decided] The app bar's sync chip and lock button (`docs/session-handoff.md:232-239`).
- [decided] "رجوع للبحث" above the profile (`docs/session-handoff.md:187`).
- [decided] No file number in `.meta` (`docs/design-rule.md:50`).
- [decided] "أول زيارة" reads right to left, the day next to the label (`docs/session-handoff.md:223-228`).
- [decided] No "النهارده" group: today's visit is in the room, and visits still to come or in the room are not shown (`docs/session-handoff.md:191`).
- [decided] A message reads "اتبعتت" / "اتفتحت", never "اتسلّمت" (`docs/design-rule.md:46-49`; `docs/session-handoff.md:191`).
- [decided] A prescription reads "اتطبعت" / "لسه ما اتطبعتش" instead of "مرتبطة بزيارة اليوم" (`docs/session-handoff.md:191`).
- [decided] The payment method reads "كاش" (`docs/session-handoff.md:193`).
- [decided] An extra "ملاحظة الطبيب" event and a muted cancelled visit, "زيارة — ملغي" (`docs/session-handoff.md:191`, `:201-212`).
- [decided] Times use the 24-hour clock (`docs/session-handoff.md:191`).
- [data] Events, counts, the balance and dates.

## 19. Messages (`#s19`)

App capture: the whole page — the messages page with three recent messages, the booking confirmation template selected.

- [decided] The role-dependent sidebar frames the page (`docs/design-rule.md:55-57`).
- [decided] The app bar's sync chip and lock button (`docs/session-handoff.md:232-239`).
- [decided] Badges read "مقترح" instead of "تلقائي", and no description says "تلقائي" (`docs/design-rule.md:46-47`).
- [decided] No channel toggle on the page; the owner's "تعديل" replaces "حفظ التعديلات" (`docs/session-handoff.md:170-171`).
- [decided] The list's heading reads "آخر الرسائل" and statuses "اتفتحت" / "اتبعتت" (`docs/session-handoff.md:173`).
- [decided] Mobile: the templates are a horizontal row of chips (`docs/session-handoff.md:174`).
- [data] Recipients, snippets, three messages against four.

## Summary

| Screen | decided | data | fix | ask | Verdict |
|---|---:|---:|---:|---:|---|
| 1. PIN lock | 5 | 1 | 0 | 0 | matches |
| 2. Day — slots | 8 | 4 | 0 | 0 | matches |
| 3. Day — queue | 8 | 2 | 0 | 0 | matches |
| 4. New booking | 3 | 1 | 0 | 0 | matches |
| 5. Invoice | 7 | 1 | 0 | 0 | matches |
| 6. Payment and receipt | 3 | 1 | 0 | 0 | matches |
| 7. Cash close | 3 | 1 | 0 | 0 | matches |
| 8. Tomorrow's sheet | 3 | 2 | 0 | 0 | matches |
| 9. Doctor's day | 10 | 4 | 0 | 0 | matches |
| 10. Visit workspace | 8 | 2 | 0 | 0 | matches |
| 11. Audit log | 4 | 1 | 0 | 0 | matches |
| 12. Settings — working hours | 4 | 1 | 0 | 0 | matches |
| 13. Settings — services | 3 | 1 | 0 | 0 | matches |
| 14. Settings — staff | 4 | 0 | 0 | 0 | matches |
| 15. Device activation | 1 | 2 | 0 | 0 | matches |
| 16. Printed prescription | 5 | 1 | 0 | 0 | matches |
| 17. Care plan | 5 | 1 | 0 | 0 | matches |
| 18. Patient profile | 11 | 1 | 0 | 0 | matches |
| 19. Messages | 6 | 1 | 0 | 0 | matches |
| **Total** | **101** | **28** | **0** | **0** | |

## Dark mode

Every screen again in dark: the prototype with `data-theme="dark"` on its
`<html>` (its explicit dark block), the app on a dark system with its
appearance left on auto (`web/src/index.css`'s `prefers-color-scheme`
block — the same values). `pnpm --dir web test:compare` writes them next to
the light ones with a `-dark` suffix, and `web/e2e/compare/index.html` shows
light and dark pairs for both viewports. The capture asserts the app's body
is on the dark `paper` before it shoots.

Only differences that show in dark are listed: everything in the light
comparison above holds in dark too and is not repeated. The appearance
toggle is new in the light captures as well; its [decided] lines below
cover both themes. Same classes as above.

### Global

- [decided] Dark values are the prototype's two dark blocks verbatim under its own selectors; tokens they do not cover keep their light values, as the prototype's own literals do (`docs/session-handoff.md:239-250`).
- [decided] Printed pages and their previews stay white paper in dark (`.print-page`, `.rx-print-page`, the `.print-header` note), as in the prototype; printing itself always uses the light tokens (`docs/session-handoff.md:264-267`).
- [ask] White text on a saturated fill (`on-fill`, the prototype's literal `#fff`, which it keeps in dark) is under AA in dark: 3.41 on `green` (every primary button), 2.49 on `green-2`, 2.75 on `copper`, 2.23 on `copper-2`, 3.55 on `danger`, 2.32 on `warning`, 2.66 on `eligible`, 2.36 on `muted` (solid badges, slot state pills, avatars, numbered circles). Keep the prototype's white, or give the fills dark text in dark (the dark `paper`, `#081311`, reads 5.32–8.46 on every one of them; the brand marks on ink — the lock card's "Clin", the activation title — would then need a token of their own)?
- [ask] `faint` text (hints, timestamps, empty states) is under AA in dark on `paper-2`, `card` and `field` (4.33, 4.13, 3.88), as it is in light on every surface (2.60–2.92). Keep the prototype's `faint`, or use it only where the text is not needed to act?
- [ask] The tinted invoice-status badge on the dark invoice head (`.inv-status`) is under AA in dark for "مدفوعة" (`eligible`, 4.04) and "ملغاة" (`danger`, 3.42); in light all three tints are (1.80–2.22). Keep `.inv-status`'s 22% tint, or a solid badge on the invoice head?
- [ask] The light theme's other pairs under AA, all prototype values (`docs/design-tokens.md`'s "Contrast"): `copper` on `card` (4.04) and on `copper-wash` (3.54), `warning` on `warning-wash` (4.49), `green-2` on `ink-2` (2.65, the slab's "arrived" count), the on-dark copper button (3.65), white on `copper` (4.04) and `copper-2` (2.96). Keep them?

### 1. PIN lock (`#s1`)

- [decided] The lock card carries the appearance toggle at its top corner ("تلقائي" with its icon; the icon alone on mobile): the overlay hides the app bar (`docs/session-handoff.md:251-263`).

### 2. Day — slots (`#s2`)

- [decided] The app bar's appearance toggle between the acting member and "قفل الشاشة" (`docs/session-handoff.md:251-263`).

### 3. Day — queue (`#s3`)

- [decided] The app bar's appearance toggle (`docs/session-handoff.md:251-263`).

### 4–8, 10–14, 16, 17 (the sheets)

No difference beyond the light comparison's: each capture is the sheet alone, without the app bar. The settings toggle's knob is white in dark as `.toggle::after` is (13); the prescription and tomorrow's-sheet previews are white paper as `.rx-print-page` and `.print-page` are (8, 16).

### 9. Doctor's day (`#s9`)

- [decided] The app bar's appearance toggle (`docs/session-handoff.md:251-263`).

### 15. Device activation (`#s15`)

- [decided] The activation card carries the appearance toggle at its top corner: there is no app bar before registration (`docs/session-handoff.md:251-263`).

### 18. Patient profile (`#s18`)

- [decided] The app bar's appearance toggle (`docs/session-handoff.md:251-263`).

### 19. Messages (`#s19`)

- [decided] The app bar's appearance toggle (`docs/session-handoff.md:251-263`).

### Dark summary

| Screen | decided | data | fix | ask | Verdict |
|---|---|---|---|---|---|
| Global | 2 | 0 | 0 | 4 | — |
| 1. PIN lock | 1 | 0 | 0 | 0 | matches |
| 2. Day — slots | 1 | 0 | 0 | 0 | matches |
| 3. Day — queue | 1 | 0 | 0 | 0 | matches |
| 4. New booking | 0 | 0 | 0 | 0 | matches |
| 5. Invoice | 0 | 0 | 0 | 0 | matches |
| 6. Payment and receipt | 0 | 0 | 0 | 0 | matches |
| 7. Cash close | 0 | 0 | 0 | 0 | matches |
| 8. Tomorrow's sheet | 0 | 0 | 0 | 0 | matches |
| 9. Doctor's day | 1 | 0 | 0 | 0 | matches |
| 10. Visit workspace | 0 | 0 | 0 | 0 | matches |
| 11. Audit log | 0 | 0 | 0 | 0 | matches |
| 12. Settings — working hours | 0 | 0 | 0 | 0 | matches |
| 13. Settings — services | 0 | 0 | 0 | 0 | matches |
| 14. Settings — staff | 0 | 0 | 0 | 0 | matches |
| 15. Device activation | 1 | 0 | 0 | 0 | matches |
| 16. Printed prescription | 0 | 0 | 0 | 0 | matches |
| 17. Care plan | 0 | 0 | 0 | 0 | matches |
| 18. Patient profile | 1 | 0 | 0 | 0 | matches |
| 19. Messages | 1 | 0 | 0 | 0 | matches |
| **Total** | **9** | **0** | **0** | **4** | |


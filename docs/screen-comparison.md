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
[decided]. It was re-run after the contrast decisions (`docs/session-
handoff.md`'s "Dark mode", decisions 6–12): where they make a screen differ
from the prototype in light too, a [decided] line says what differs.

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
- [decided] The lock stays a full-screen overlay, opaque on the page's paper, holding a `.pin-scr` card (`docs/session-handoff.md:377-379`).
- [decided] The title reads the neutral "اكتب الرقم السري" (`docs/session-handoff.md:377-379`).
- [decided] An empty error line keeps its space between the dots and the pad, so the pad never moves when an error shows (`docs/session-handoff.md:377-379`).
- [decided] "تبديل المستخدم" under the pad (`docs/session-handoff.md:377-379`).
- [data] Key "2" shows its hover fill: the pointer rests on it after the capture's last tap.

## 2. Day — slots (`#s2`)

App capture: the whole page — the seeded Monday for the slots doctor, كريم called in.

- [decided] A role-dependent sidebar (desktop rail, mobile bottom bar) frames the page instead of the prototype's single `.app` frame (`docs/design-rule.md:55-57`).
- [decided] The app bar keeps the page title, the "متصل" sync chip and "قفل الشاشة", with the brand on the rail (`docs/session-handoff.md:367-374`).
- [decided] Slab, tiles and card share the one page width, `max-w-page` (1116px, the `.app` frame); at 1280 the rail leaves the column about 1016px (`docs/session-handoff.md:352-357`).
- [data] Practitioner switcher pills (أحمد المصري / سلمى إبراهيم): the demo has two practitioners, and the prototype's notes say switchers appear by themselves when a clinic grows.
- [decided] The card head's title is the practitioner's name ("أحمد المصري") (`docs/session-handoff.md:367-374`).
- [decided] Each row carries a "…" visit-menu trigger; the visit menu has no prototype counterpart (`docs/session-handoff.md:514-515`).
- [decided] The "التسجيل" chip on in-room and completed rows and the "الزيارة اتقفلت من غير تسجيل" line under a completed row without a visit form (`docs/session-handoff.md:367-374`).
- [data] No `.until` sub-line under the times and no phone in `.meta`: the seeded day is in the past and the demo patients have no phone (the row renders both when present).
- [data] Row statuses, the slab's and tiles' figures, and the number of empty slots (5 against 2).
- [decided] "إغلاق الصندوق" in `.slab-act` (`docs/session-handoff.md:367-374`).
- [decided] The close time reads "إقفال 14:00", the app's 24-hour clock (`docs/session-handoff.md:185`).
- [data] An undo toast ("دخل المريض الكشف · تراجع") at the bottom: the capture's own last action.
- [decided] The in-room row's name (and its `.until` line) is `copper-ink`, darker than the prototype's copper, and its "في الكشف" pill's text is dark on copper (`on-copper`) (`docs/session-handoff.md:284-293`; `docs/session-handoff.md:304-314`).
- [decided] Slab: the "حضروا" count is `green-on-ink` and the "لم يحضر" count `danger-on-ink` (lighter than the prototype's green-2 and danger), and the "التالي" button's text `copper-on-ink` (`docs/session-handoff.md:304-314`; `docs/session-handoff.md:318-320`).
- [decided] The "مستحق" tile's amount is `copper-ink` (`docs/session-handoff.md:304-314`).
- [decided] The empty slots' times and "موعد فاضي", the completed and cancelled rows' lines and the tiles' units and sub-lines are `muted`, not `faint` (`docs/session-handoff.md:294-301`).
- [decided] The card head's badge ("اليوم") has no glass fill, only its border (`.c-head .badge` has an 8% white fill) (`docs/session-handoff.md:321-323`).
- [decided] The app bar's acting-member initial is dark on its copper circle (`on-copper`), where the prototype's is white (`docs/session-handoff.md:284-293`).

## 3. Day — queue (`#s3`)

App capture: the whole page — the seeded Monday for the queue doctor.

- [decided] The role-dependent sidebar frames the page (`docs/design-rule.md:55-57`).
- [decided] The app bar's sync chip and lock button (`docs/session-handoff.md:367-374`).
- [decided] The one shared page width (`docs/session-handoff.md:352-357`).
- [data] Practitioner switcher pills: two practitioners in the demo.
- [decided] The card head's title is the practitioner's name ("سلمى إبراهيم"), with no "استدعاء التالي" (the slab's "التالي" covers it) (`docs/session-handoff.md:367-374`, `:380-383`).
- [decided] `.slab-act` has no "إعادة ترتيب" (backlog) and adds "تسجيل تأخير الطبيب" and "إغلاق الصندوق" (`docs/session-handoff.md:380-383`, `:447-448`).
- [decided] "يتوقع خلاص 10:33" and each waiting row's `.qwait` "متوقع 10:11" use the 24-hour clock (`docs/session-handoff.md:185`, `:380-383`).
- [decided] Each row carries the "…" visit-menu trigger (`docs/session-handoff.md:514-515`).
- [decided] The "التسجيل" chip, the "الزيارة اتقفلت من غير تسجيل" line and the "مريض جه دلوقتي" pill (`docs/session-handoff.md:367-374`).
- [data] Names, numbers, the no-show row, and the prototype's walk-in line "جه من غير حجز".
- [decided] The in-room row's number is dark on copper (`on-copper`) and its "في الكشف" figure `copper-ink` (`docs/session-handoff.md:284-293`; `docs/session-handoff.md:304-314`).
- [decided] Slab: the "مستنيين" count is `green-on-ink`, and the "التالي" button's text `copper-on-ink` (`docs/session-handoff.md:304-314`).
- [decided] The finished rows' numbers and the "سجّله" lines are `muted`, not `faint` (`docs/session-handoff.md:294-301`).
- [decided] The card head's badge ("الطابور") has no glass fill, only its border (`.c-head .badge` has an 8% white fill) (`docs/session-handoff.md:321-323`).
- [decided] The app bar's acting-member initial is dark on its copper circle (`on-copper`), where the prototype's is white (`docs/session-handoff.md:284-293`).

Mobile: the slab's vertical rule beside the stacked `.side` cells matches — in both it is the second and third cells' own start border (none beside the first, none on `.side` itself), at the same place and height; an earlier [fix] line here was withdrawn.

## 4. New booking (`#s4`)

App capture: the booking sheet opened from the 11:30 slot, searching «كريم» (the prototype's search-and-pick state).

- [decided] Every sheet is a bottom sheet with a close × (`docs/session-handoff.md:367-374`).
- [decided] The flow takes two steps — results first, then the service picker and the footer once a patient is picked (`docs/session-handoff.md:367-374`).
- [decided] A result's `.rr .m` reads "آخر زيارة قبل يومين", the doctor's day's shared relative helper, not the prototype's "آخر زيارة من 20 يوم" (`docs/session-handoff.md:384-386`).
- [data] One «كريم» in the demo, without a phone (the prototype shows two, with phones).

## 5. Invoice (`#s5`)

App capture: the invoice sheet, half the total paid in cash.

- [decided] The invoice is a bottom sheet with a close × (`docs/session-handoff.md:367-374`).
- [decided] The "ترويسة العيادة — تتضبط من الإعدادات" line at the top of the body (`docs/session-handoff.md:367-374`).
- [decided] The payment method reads "كاش", not "نقدي" (`docs/session-handoff.md:198`).
- [decided] The receipt and creation times read "10:00", the 24-hour clock (`docs/session-handoff.md:185`).
- [decided] The "طباعة" link on each payment row (`docs/session-handoff.md:367-374`).
- [decided] No "تعديل بنود" pill: item editing is backlog (`docs/session-handoff.md:447`).
- [decided] The "إلغاء الفاتورة" block with "مفيش إلغاء بعد تسجيل دفعة" (`docs/session-handoff.md:367-374`).
- [data] Invoice number, patient, items and amounts; the invoice is dated today although the seeded day is a past Monday (writes use the real clock).
- [decided] The head's status "مدفوعة جزئيًا" is a solid badge, white on warning, where `.inv-status` is a 22% tint (`docs/session-handoff.md:302-303`).
- [decided] The remaining amount's "ج.م" is `copper-ink`, and the payment row's receipt number and time `muted`, not `faint` (`docs/session-handoff.md:294-301`; `docs/session-handoff.md:304-314`).

## 6. Payment and receipt (`#s6`)

App capture: the payment sheet over a partially paid invoice, the remaining amount typed in.

- [decided] Bottom sheet against the prototype's centred `.book` card (`docs/session-handoff.md:367-374`).
- [decided] The first method reads "كاش", not "نقدي" (`docs/session-handoff.md:198`).
- [decided] "أكّد الدفعة واطبع إيصال" records the payment and prints its receipt in one tap (`docs/session-handoff.md:387-390`).
- [data] "75.00": the capture typed the amount with two decimals; patient and amounts.
- [decided] The patient's initial is dark on its copper tile (`on-copper`) (`docs/session-handoff.md:284-293`).
- [decided] The amount's hint is `muted`, not `faint` (`docs/session-handoff.md:294-301`).

## 7. Cash close (`#s7`)

App capture: the cash close sheet on the real day after one visit paid in full in cash, the drawer amount matching.

- [decided] Bottom sheet against the prototype's page card; the summary grid is two across in the sheet against four across on the page (`docs/session-handoff.md:367-374`).
- [decided] "تصدير CSV" instead of "تصدير Excel" (`docs/design-rule.md:52-54`).
- [decided] "اقفل اليوم واطبع الملخص" closes the day and prints its summary (`docs/session-handoff.md:391-401`).
- [data] The sub-line's time is the capture's pinned clock ("09:00"); amounts, the invoice and no-show counts, and the closer's name (the owner ran the capture).
- [decided] The card head's badge ("الصندوق") has no glass fill, only its border (`.c-head .badge` has an 8% white fill) (`docs/session-handoff.md:321-323`).
- [decided] The summary cells' units are `muted`, not `faint` (`docs/session-handoff.md:294-301`).

## 8. Tomorrow's sheet (`#s8`)

App capture: the tomorrow's-sheet preview, the seeded Monday's slots-doctor visits written again as tomorrow's bookings.

- [decided] The page is previewed inside a sheet (title "جدول زيارات الغد", "طباعة ورقة الغد", ×) (`docs/session-handoff.md:367-374`).
- [decided] Footer and table times use the 24-hour clock (`docs/session-handoff.md:185`).
- [decided] The footer's brand reads "Clintra v{version}" from web/package.json (`docs/session-handoff.md:402-405`).
- [data] The version itself: web/package.json says 0.0.0 ("Clintra v0.0.0" against the prototype's "v1.0").
- [data] Clinic name and address, patients, services, the patient count; the demo patients have no phone ("بدون رقم").

## 9. Doctor's day (`#s9`)

App capture: the whole page — the doctor's day mid-morning.

- [decided] The role-dependent sidebar frames the page (`docs/design-rule.md:55-57`).
- [decided] The app bar's sync chip and lock button (`docs/session-handoff.md:367-374`).
- [decided] The one shared page width (`docs/session-handoff.md:352-357`).
- [data] The momentum bar is in its on-time state ("ماشي في الميعاد") against the prototype's late state; times and medians.
- [data] No age in the brief (no birth year for that patient in the demo); one prior visit.
- [decided] The last-visit block has no "موصوف" part (`docs/session-handoff.md:481`).
- [decided] The quick note's placeholder reads "ملاحظة على الزيارة دي…" (`docs/session-handoff.md:485`).
- [data] The quick note's "حفظ" is disabled: nothing typed.
- [decided] "استدعِ للكشف" is disabled with "فيه مريض في الكشف" while someone is in the room, in the brief and the day list (`docs/session-handoff.md:486`).
- [data] Waiting rows show the booked time instead of "نمرة N": the capture is a slots day.
- [decided] The attention card has no lab-referral item and the unpaid-invoice item no button (`docs/session-handoff.md:483`; `docs/design-rule.md:50-51`).
- [decided] A booked visit not yet arrived gets "افتح الملف" in the day list (`docs/session-handoff.md:406-407`).
- [decided] Mobile: the quick-note input stays inside its card (`docs/session-handoff.md:367-374`).
- [decided] Times use the 24-hour clock (`docs/session-handoff.md:185`).
- [decided] The hero's initial is dark on copper (`on-copper`), and its "في الكشف الآن" label, the last visit's labels and diagnosis and the quick note's label and "حفظ" are `copper-ink` (`docs/session-handoff.md:284-293`; `docs/session-handoff.md:304-314`).
- [decided] The day list's in-room number is dark on copper (`on-copper`) (`docs/session-handoff.md:284-293`).
- [decided] The card head's badge ("التسلسل") has no glass fill, only its border (`.c-head .badge` has an 8% white fill) (`docs/session-handoff.md:321-323`).
- [decided] The app bar's acting-member initial is dark on its copper circle (`on-copper`), where the prototype's is white (`docs/session-handoff.md:284-293`).

## 10. Visit workspace (`#s10`)

App capture: the visit sheet for كريم in the room — history, complaint, diagnosis and three drugs (no plan under way).

- [decided] The workspace is a bottom sheet titled "ملف الزيارة" with a close ×, the arrival time beside it (`docs/session-handoff.md:367-374`).
- [decided] No `.visit-aside` assistant panel; one `.visit-main` column (`docs/design-rule.md:29-33`; `docs/session-handoff.md:492`).
- [data] "زيارتين · آخر زيارة قبل 3 أيام" and the age.
- [decided] "ابدأ خطة رعاية" in place of `.plan-badge`: no plan is under way (`docs/session-handoff.md:183`).
- [decided] The history's heading counts the real visits ("آخر زيارتين") and each row ends with the drug names (`docs/session-handoff.md:494`).
- [decided] No field hint besides the autosave "اتحفظ" (`docs/session-handoff.md:492`).
- [decided] The dose line reads "… · لمدة <b>7 أيام</b>"; only the duration is bold, not the counts (`docs/session-handoff.md:408-411`).
- [decided] An extra "اطبع الوصفة" under the list (`docs/session-handoff.md:502`).
- [decided] The run button reads "قفل الزيارة", without "(يفتح الفاتورة)" (`docs/session-handoff.md:367-374`).
- [data] Complaint, diagnosis, drugs and the session length.
- [decided] The patient's initial is dark on its copper tile (`on-copper`), and "أضف دواء" and the drug count badge are `copper-ink` (`docs/session-handoff.md:284-293`; `docs/session-handoff.md:304-314`).

## 11. Audit log (`#s11`)

App capture: the audit sheet on the real day — three bookings, an arrival, a cancellation and a no-show.

- [decided] Bottom sheet against the prototype's page card (`docs/session-handoff.md:367-374`).
- [decided] The filters are the prototype's four, each with its own groups of events (`docs/session-handoff.md:412-419`).
- [decided] Verbs read "أنشأ حجز / علّم لم يحضر / ألغى الحجز" (`docs/session-handoff.md:348-351`).
- [decided] Times use the 24-hour clock (`docs/session-handoff.md:185`).
- [data] Six events, all minutes old, so every row carries "من 5د"; names; the `.who` context is the visit's time ("موعد 10:00") where the prototype shows other contexts ("شاشة اليوم", «طلب المريضة»).
- [decided] The card head's badge ("السجل") has no glass fill, only its border (`.c-head .badge` has an 8% white fill) (`docs/session-handoff.md:321-323`).
- [decided] The rows' times are `muted`, not `faint` (`docs/session-handoff.md:294-301`).

## 12. Settings — working hours (`#s12`)

App capture: the settings sheet's working-hours tab, as the owner.

- [decided] Bottom sheet against the prototype's page card (`docs/session-handoff.md:367-374`).
- [decided] An extra tab "الأطباء" (`docs/session-handoff.md:90-92`).
- [decided] No run row: each row saves on its own (`docs/session-handoff.md:367-374`).
- [decided] Mobile: hours stay on one line (`docs/session-handoff.md:367-374`).
- [data] Every day 09:00–14:00 in slots of 30 minutes; the location's name.
- [decided] The card head's badge ("الإعدادات") has no glass fill, only its border (`.c-head .badge` has an 8% white fill) (`docs/session-handoff.md:321-323`).

## 13. Settings — services (`#s13`)

App capture: the settings sheet's services tab, as the owner, one service stopped.

- [decided] Bottom sheet against the prototype's page card (`docs/session-handoff.md:367-374`).
- [decided] The extra tab "الأطباء" (`docs/session-handoff.md:90-92`).
- [decided] Services are listed by name under Arabic collation (`docs/session-handoff.md:443-444`).
- [data] Services, durations and prices.
- [decided] The card head's badge ("الإعدادات") has no glass fill, only its border (`.c-head .badge` has an 8% white fill) (`docs/session-handoff.md:321-323`).
- [decided] Prices and their "ج.م" are `copper-ink`, and the stopped service's "موقوفة" `muted`, not `faint` (`docs/session-handoff.md:294-301`; `docs/session-handoff.md:304-314`).

## 14. Settings — staff (`#s14`)

App capture: the settings sheet's staff tab, as the owner.

- [decided] Bottom sheet against the prototype's page card (`docs/session-handoff.md:367-374`).
- [decided] The PIN shows as a "مُعيّن ✓" badge, never its digits (`docs/design-rule.md:38-39`).
- [decided] The active state is a "مفعّل" badge; the switch stays in the edit form (`docs/session-handoff.md:367-374`).
- [decided] The extra tab "الأطباء" (`docs/session-handoff.md:90-92`).
- [decided] The card head's badge ("الإعدادات") has no glass fill, only its border (`.c-head .badge` has an 8% white fill) (`docs/session-handoff.md:321-323`).

## 15. Device activation (`#s15`)

App capture: the activation card before activating, both fields filled.

- [decided] The fields are the 16-character activation code ("كود التفعيل") and the owner's phone; no SMS code field and no "will be registered to …" line (`docs/design-rule.md:40-45`).
- [data] The phone shows as typed, focused (the capture's last field).
- [data] The code's value.
- [decided] The code field's hint is `muted`, not `faint` (`docs/session-handoff.md:294-301`).

## 16. Printed prescription (`#s16`)

App capture: the print sheet's preview for كريم's three drugs, before the first print.

- [decided] The preview sits in a sheet titled "الوصفة" with a close × (`docs/session-handoff.md:367-374`).
- [decided] One action, "طباعة / حفظ PDF", and no PDF, WhatsApp or SMS buttons before the first print (`docs/session-handoff.md:503`, `:172`).
- [decided] The preview note names that one action ("دي معاينة للطباعة · اضغط «طباعة / حفظ PDF»") (`docs/session-handoff.md:503`).
- [decided] The date reads right to left, the day furthest right (`docs/session-handoff.md:358-363`).
- [decided] The dose line reads "· لمدة <b>7 أيام</b>" (`docs/session-handoff.md:408-411`).
- [data] Title "طبيب عام" without a syndicate number, the clinic, the RX number, the drugs' texts and forms.

## 17. Care plan (`#s17`)

App capture: the care plan sheet — five sessions done, the sixth booked, four suggested.

- [decided] Bottom sheet titled "خطة الرعاية" against the prototype's two page cards (`docs/session-handoff.md:367-374`).
- [decided] Session names are the services' names (`docs/session-handoff.md:468-471`).
- [decided] `.meta` reads "d / m · د. {doctor} · {duration} دقيقة", a booked session adding "h:mm" — "14 / 10 · 9:30" instead of "النهارده · 4:30 م" (`docs/session-handoff.md:185`).
- [decided] Suggested rows carry "أجّل" (`docs/session-handoff.md:185`).
- [decided] "احجز الجلسة التالية" is disabled with "الجلسة التالية محجوزة 14 / 10 · 9:30" while the next session is booked (`docs/session-handoff.md:186`).
- [data] Dates, totals, paid, durations and the diagnosis text.
- [decided] The hero's text is dark (`on-copper`) at full opacity on a copper → copper-2 fill, where `.plan-hero` is white text (85% and 70% for its secondary lines) on copper darkening toward ink; its top highlight and progress fill stay white (`docs/session-handoff.md:315-317`).
- [decided] The next session's number and "التالية" are `copper-ink` (`docs/session-handoff.md:304-314`).
- [decided] The card head's badge ("الجلسات") has no glass fill, only its border (`.c-head .badge` has an 8% white fill) (`docs/session-handoff.md:321-323`).

## 18. Patient profile (`#s18`)

App capture: the whole page — كريم's profile from the patients page, on the الكل tab.

- [decided] The role-dependent sidebar frames the page (`docs/design-rule.md:55-57`).
- [decided] The app bar's sync chip and lock button (`docs/session-handoff.md:367-374`).
- [decided] "رجوع للبحث" above the profile (`docs/session-handoff.md:192`).
- [decided] No file number in `.meta` (`docs/design-rule.md:50`).
- [decided] "أول زيارة" reads right to left, the day next to the label (`docs/session-handoff.md:358-363`).
- [decided] No "النهارده" group: today's visit is in the room, and visits still to come or in the room are not shown (`docs/session-handoff.md:196`).
- [decided] A message reads "اتبعتت" / "اتفتحت", never "اتسلّمت" (`docs/design-rule.md:46-49`; `docs/session-handoff.md:196`).
- [decided] A prescription reads "اتطبعت" / "لسه ما اتطبعتش" instead of "مرتبطة بزيارة اليوم" (`docs/session-handoff.md:196`).
- [decided] The payment method reads "كاش" (`docs/session-handoff.md:198`).
- [decided] An extra "ملاحظة الطبيب" event and a muted cancelled visit, "زيارة — ملغي" (`docs/session-handoff.md:196`, `:336-347`).
- [decided] Times use the 24-hour clock (`docs/session-handoff.md:196`).
- [data] Events, counts, the balance and dates.
- [decided] The patient's initial is dark on copper (`on-copper`); the "خطة" figure, the pressed "الكل" tab, the "Rx" icon and the diagnoses are `copper-ink` (`docs/session-handoff.md:284-293`; `docs/session-handoff.md:304-314`).
- [decided] The events' times are `muted`, not `faint` (`docs/session-handoff.md:294-301`).
- [decided] The app bar's acting-member initial is dark on its copper circle (`on-copper`), where the prototype's is white (`docs/session-handoff.md:284-293`).

## 19. Messages (`#s19`)

App capture: the whole page — the messages page with three recent messages, the booking confirmation template selected.

- [decided] The role-dependent sidebar frames the page (`docs/design-rule.md:55-57`).
- [decided] The app bar's sync chip and lock button (`docs/session-handoff.md:367-374`).
- [decided] Badges read "مقترح" instead of "تلقائي", and no description says "تلقائي" (`docs/design-rule.md:46-47`).
- [decided] No channel toggle on the page; the owner's "تعديل" replaces "حفظ التعديلات" (`docs/session-handoff.md:170-171`).
- [decided] The list's heading reads "آخر الرسائل" and statuses "اتفتحت" / "اتبعتت" (`docs/session-handoff.md:173`).
- [decided] Mobile: the templates are a horizontal row of chips (`docs/session-handoff.md:174`).
- [data] Recipients, snippets, three messages against four.
- [decided] The "مقترح" badges' text is dark on copper (`on-copper`); the template icons, the preview's placeholders, the "مقترح النهارده" count and the "اتفتحت" badges are `copper-ink` (`docs/session-handoff.md:284-293`; `docs/session-handoff.md:304-314`).
- [decided] "مفيش رسائل مقترحة النهارده" is `muted`, not `faint` (`docs/session-handoff.md:294-301`).
- [decided] The app bar's acting-member initial is dark on its copper circle (`on-copper`), where the prototype's is white (`docs/session-handoff.md:284-293`).

## Summary

| Screen | decided | data | fix | ask | Verdict |
|---|---:|---:|---:|---:|---|
| 1. PIN lock | 5 | 1 | 0 | 0 | matches |
| 2. Day — slots | 14 | 4 | 0 | 0 | matches |
| 3. Day — queue | 13 | 2 | 0 | 0 | matches |
| 4. New booking | 3 | 1 | 0 | 0 | matches |
| 5. Invoice | 9 | 1 | 0 | 0 | matches |
| 6. Payment and receipt | 5 | 1 | 0 | 0 | matches |
| 7. Cash close | 5 | 1 | 0 | 0 | matches |
| 8. Tomorrow's sheet | 3 | 2 | 0 | 0 | matches |
| 9. Doctor's day | 14 | 4 | 0 | 0 | matches |
| 10. Visit workspace | 9 | 2 | 0 | 0 | matches |
| 11. Audit log | 6 | 1 | 0 | 0 | matches |
| 12. Settings — working hours | 5 | 1 | 0 | 0 | matches |
| 13. Settings — services | 5 | 1 | 0 | 0 | matches |
| 14. Settings — staff | 5 | 0 | 0 | 0 | matches |
| 15. Device activation | 2 | 2 | 0 | 0 | matches |
| 16. Printed prescription | 5 | 1 | 0 | 0 | matches |
| 17. Care plan | 8 | 1 | 0 | 0 | matches |
| 18. Patient profile | 14 | 1 | 0 | 0 | matches |
| 19. Messages | 9 | 1 | 0 | 0 | matches |
| **Total** | **139** | **28** | **0** | **0** | |

## Dark mode

Every screen again in dark: the prototype with `data-theme="dark"` on its
`<html>` (its explicit dark block), the app on a dark system with its
appearance left on auto (`web/src/index.css`'s `prefers-color-scheme`
block — the same values). `pnpm --dir web test:compare` writes them next to
the light ones with a `-dark` suffix, and `web/e2e/compare/index.html` shows
light and dark pairs for both viewports. The capture asserts the app's body
is on the dark `paper` before it shoots.

Only differences that show in dark are listed: everything in the light
comparison above holds in dark too and is not repeated (its contrast
[decided] lines included). The appearance
toggle is new in the light captures as well; its [decided] lines below
cover both themes. Same classes as above.

### Global

- [decided] Dark values are the prototype's two dark blocks verbatim under its own selectors; tokens they do not cover keep their light values, as the prototype's own literals do (`docs/session-handoff.md:239-250`).
- [decided] Printed pages and their previews stay white paper in dark (`.print-page`, `.rx-print-page`, the `.print-header` note), as in the prototype; printing itself always uses the light tokens (`docs/session-handoff.md:264-267`).
- [decided] Text on fills is no longer the prototype's white in dark: `on-fill` is the dark paper (`#081311`) on green, green-2, danger, warning, eligible and muted fills (5.32–8.14: primary buttons, solid badges, slot state pills, numbered circles), and `on-copper` the dark paper on copper and copper-2 (6.87 / 8.46: the in-room pill, avatars, the care-plan hero); `on-ink` stays white on the ink chrome and for the marks that stay white — the lock card's "Clin", the activation title, the logo tiles' letter, the switch knob, the care-plan hero's highlight and progress fill (`docs/session-handoff.md:284-293`).
- [decided] `faint` is text only as a placeholder in an empty field (and for disabled controls); every other faint text — hints, timestamps, empty states, units, the finished rows' lines — is `muted` (7.36 on `card`, 6.91 on `field` in dark) (`docs/session-handoff.md:294-301`).
- [decided] The invoice head's status is a solid badge: its status fill with `on-fill` text (dark in dark), in place of `.inv-status`'s 22% tint (`docs/session-handoff.md:302-303`).
- [decided] The light theme's pairs under AA take new tokens — `copper-ink` for copper text, `green-on-ink` for the slab's arrived count, `copper-on-ink` for the on-dark copper button — whose dark values are the prototype's dark copper, green-2 and copper-2, so they change nothing in dark; `warning` on `warning-wash` stays (4.49 in light, 6.89 in dark) (`docs/session-handoff.md:304-314`). The care-plan hero, the slab's no-show count and the card head's badge differ in both themes (light lines of 17, 2 and the card-head screens; `docs/session-handoff.md:315-323`).

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
| Global | 6 | 0 | 0 | 0 | — |
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
| **Total** | **13** | **0** | **0** | **0** | |


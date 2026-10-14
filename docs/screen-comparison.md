# Screen-by-screen comparison against the prototype

Every screen of `docs/reference/clintra-prototype.html` (sections `#s1` …
`#s19`) next to the app driven to the state that best matches it, at desktop
(1280 wide) and mobile (390 wide). The captures come from
`pnpm --dir web test:compare` (`web/e2e/compare.spec.ts`); open
`web/e2e/compare/index.html` to see each pair side by side. The images are
regenerated on every run and are not committed.

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
- [ask] The lock is a full-viewport overlay; the prototype draws it as a rounded `.pin-scr` card — keep the full-screen overlay?
- [ask] The title reads "اكتب الرقم السري"; the prototype reads the feminine "أدخلي الرقم السري" — use the prototype's wording, a gender-aware form, or keep the neutral one?
- [fix] 32px between the wordmark and "دخول · سارة حسن (المساعد)"; the prototype's `.pin-who` sits 6px under `.pin-brand` — drop the pad wrapper's `mt-8` (`web/src/auth/LockScreen.tsx`).
- [ask] An empty error line reserves about 38px between the dots and the pad (the prototype has 22px) — keep the reserved space so the pad never moves when an error shows?
- [fix] Pad keys are 48px tall (`min-h-12`); the prototype's `.pad button` is about 60px (14px vertical padding around 20px text) — raise the key height (`padKeyClassName`, `web/src/auth/LockScreen.tsx`).
- [ask] An extra "تبديل المستخدم" link under the pad, not in the prototype — keep it?
- [data] Key "2" shows its hover fill: the pointer rests on it after the capture's last tap.

## 2. Day — slots (`#s2`)

App capture: the whole page — the seeded Monday for the slots doctor, كريم called in.

- [decided] A role-dependent sidebar (desktop rail, mobile bottom bar) frames the page instead of the prototype's single `.app` frame (`docs/design-rule.md:55-57`).
- [ask] The app bar carries the page title, a "متصل" sync chip and a "قفل الشاشة" button, with the brand moved to the rail; the prototype's `.appbar` has brand + subtitle, who and date only — keep the sync chip and the lock button in the bar?
- [ask] Slab, tiles and card sit in a column about 720px wide in the middle of the page; in the prototype they span the whole frame (1116px) — widen them?
- [data] Practitioner switcher pills (أحمد المصري / سلمى إبراهيم): the demo has two practitioners, and the prototype's notes say switchers appear by themselves when a clinic grows.
- [ask] The card head's title is the practitioner's name ("أحمد المصري") instead of "مواعيد اليوم" — keep the name?
- [ask] Status labels differ: "محجوز / وصل / جوه / خلص / غاب / اتلغى" against the prototype's "وصلت / في الكشف / اكتمل / لم يحضر / ملغي" (the slab itself already says "لم يحضر") — adopt the prototype's labels?
- [decided] Each row carries a "…" visit-menu trigger; the visit menu has no prototype counterpart (`docs/session-handoff.md:259-260`).
- [ask] An extra "التسجيل" chip on in-room and completed rows (opens the visit form) — keep it on the row?
- [ask] An extra warning line "الزيارة اتقفلت من غير تسجيل" under a completed row without a visit form — keep it?
- [fix] The status pill sits at the top of the trailing column with the menu under it; the prototype's `.slot .state` is centred vertically in the row (`web/src/screens/day/SlotRow.tsx`).
- [fix] The actor line adds the role: "سجّله سارة حسن (المساعد)" against "سجّله سارة حسن" (`web/src/screens/day/actorLabel.ts`, `SlotRow.tsx`).
- [data] No `.until` sub-line under the times and no phone in `.meta`: the seeded day is in the past and the demo patients have no phone (the row renders both when present).
- [data] Row statuses, the slab's and tiles' figures, and the number of empty slots (5 against 2).
- [fix] The run row's primary button reads "حجز"; the prototype's `.run` reads "احجز مريض جديد" (`web/src/screens/day/PractitionerColumn.tsx`, `dayScreenStrings.bookingButtonLabel`).
- [ask] An extra "إغلاق الصندوق" button in `.slab-act` (the prototype shows no entry to the cash close) — keep it there?
- [decided] The close time reads "إقفال 14:00", the app's 24-hour clock (`docs/session-handoff.md:180`).
- [data] An undo toast ("دخل المريض الكشف · تراجع") at the bottom: the capture's own last action.

## 3. Day — queue (`#s3`)

App capture: the whole page — the seeded Monday for the queue doctor.

- [decided] The role-dependent sidebar frames the page (`docs/design-rule.md:55-57`).
- [ask] The app bar's sync chip and lock button (as on screen 2) — keep them?
- [ask] The content column is about 720px wide against the prototype's full frame (as on screen 2) — widen it?
- [data] Practitioner switcher pills: two practitioners in the demo.
- [ask] The card head's title is the practitioner's name ("سلمى إبراهيم") instead of "الدور" — keep the name?
- [ask] The card head has no "استدعاء التالي" `.app-btn` (calling in is the slab's "التالي" button) — add it?
- [ask] `.slab-act` has no "إعادة ترتيب" (reorder) button, and adds "تسجيل تأخير الطبيب" and "إغلاق الصندوق" — add reordering?
- [fix] The split legend reads "اكتمل 3 من 6 · باقي 3"; the prototype's queue legend reads "اكتمل 4 · مستنيين 4" (`web/src/screens/day/DaySlab.tsx`).
- [decided] "يتوقع خلاص 10:33" uses the 24-hour clock (`docs/session-handoff.md:180`).
- [ask] Waiting rows show "متوقع دورك بعد ~ 11 دقيقة" (a relative wait); the prototype's `.qwait` shows "متوقع 1:15 م" (an expected clock time) — which one?
- [ask] Status labels "جوه" / "غاب" against the prototype's vocabulary (as on screen 2) — adopt the prototype's?
- [decided] Each row carries the "…" visit-menu trigger (`docs/session-handoff.md:259-260`).
- [ask] The "التسجيل" chip on in-room and completed rows (as on screen 2) — keep it?
- [ask] The "الزيارة اتقفلت من غير تسجيل" warning line (as on screen 2) — keep it?
- [fix] The actor line adds the role "(المساعد)" (`web/src/screens/day/actorLabel.ts`, `QueueRow.tsx`).
- [ask] An extra "مريض جه دلوقتي" pill in the queue's run row; the prototype's has only "إضافة للدور" — keep it?
- [fix] Mobile: the slab's three cells sit in one row under the hero; the prototype (and the app's own slots slab) stacks them in a column beside the hero (`web/src/screens/day/DaySlab.tsx`).
- [data] Names, numbers, the no-show row, and the prototype's walk-in line "جه من غير حجز".

## 4. New booking (`#s4`)

App capture: the booking sheet opened from the first empty slot, searching «كريم» (the prototype's search-and-pick state).

- [ask] Every sheet is a bottom sheet (anchored to the viewport's bottom, square bottom corners, a close ×); the prototype draws `.book` as a centred card with four rounded corners — keep the bottom sheet?
- [fix] The title reads "حجز · أحمد المصري": no slot time although the sheet opened from the 11:30 slot, and no "د." before the name; the prototype reads "حجز · 11:30 · د. أحمد المصري" (`web/src/screens/day/bookingSheetTitle.ts`, `BookingSheet.tsx`).
- [ask] The flow takes two steps — results first, then the service picker and the "تأكيد الحجز" / "من غير رقم" footer once a patient is picked; the prototype shows search, the selected result (`.rr.sel`), services and footer together — show them together?
- [fix] A result's meta reads a bare date ("الاثنين، 12 أكتوبر"); the prototype's `.rr .m` reads "آخر زيارة من 20 يوم · {phone}" (`web/src/screens/day/BookingSheet.tsx`).
- [fix] The new-patient row reads "+ مريض جديد باسم «كريم»" on white; the prototype's `.rr.new` reads "＋ إضافة مريض جديد باسم «كريم»" on a green-wash tint in green (`web/src/screens/day/BookingSheet.tsx`).
- [data] One «كريم» in the demo, without a phone (the prototype shows two, with phones).

## 5. Invoice (`#s5`)

App capture: the invoice sheet, half the total paid in cash.

- [ask] The invoice is a bottom sheet with a close × (as on screen 4); the prototype draws a page card — keep the sheet?
- [fix] The head's button reads "إيصال الفاتورة"; the prototype's reads "طباعة" (`web/src/screens/day/InvoiceSheet.tsx`).
- [fix] The head's sub-line reads "أحمد المصري · الأربعاء، 14 أكتوبر": no "د." and a weekday-and-comma date without the year; the prototype reads "د. أحمد المصري · 7 سبتمبر 2026" (`InvoiceSheet.tsx`).
- [fix] The "مدفوعة جزئيًا" badge is a light warning-wash pill; the prototype's `.inv-status` is a 22% warning fill with a warning border, dark on the dark head (`InvoiceSheet.tsx`).
- [ask] An extra "ترويسة العيادة — تتضبط من الإعدادات" line at the top of the body — keep it on screen?
- [fix] The price column reads "سعر الوحدة" and the first total "إجمالي الفاتورة"; the prototype reads "السعر" and "الإجمالي" (`InvoiceSheet.tsx`, `web/src/screens/day/strings.ts`).
- [decided] The payment method reads "كاش", not "نقدي" (`docs/session-handoff.md:193`).
- [decided] The receipt time reads "10:00", the 24-hour clock (`docs/session-handoff.md:180`).
- [ask] An extra "طباعة" link on each payment row (reprint the receipt) — keep it?
- [ask] No "تعديل بنود" pill in the run row — add item editing?
- [fix] No `.runrow .count` line "إنشاء {time} · {staff}" (`InvoiceSheet.tsx`).
- [ask] An extra "إلغاء الفاتورة" block with "مفيش إلغاء بعد تسجيل دفعة" — keep it on this sheet?
- [data] Invoice number, patient, items and amounts; the invoice is dated today although the seeded day is a past Monday (writes use the real clock).

## 6. Payment and receipt (`#s6`)

App capture: the payment sheet over a partially paid invoice, the remaining amount typed in.

- [ask] Bottom sheet against the prototype's centred `.book` card (as on screen 4) — keep it?
- [fix] The title reads "تسجيل دفعة · فاتورة …"; the prototype reads "دفعة · فاتورة …" (`web/src/screens/day/PaymentSheet.tsx`).
- [fix] The amount's label reads "المبلغ (جنيه)"; the prototype's reads "المبلغ" (`PaymentSheet.tsx`).
- [decided] The first method reads "كاش", not "نقدي" (`docs/session-handoff.md:193`).
- [ask] The confirm button reads "تسجيل"; the prototype's reads "أكّد الدفعة وطبع إيصال" (confirm and print the receipt in one step) — print on confirm?
- [data] "75.00": the capture typed the amount with two decimals; patient and amounts.

## 7. Cash close (`#s7`)

App capture: the cash close sheet on the real day after one visit paid in full in cash, the drawer amount matching.

- [ask] Bottom sheet against the prototype's page card (as on screen 4); the summary grid is two across in the sheet against four across on the page — keep the sheet?
- [fix] The head has no "آخر اليوم" badge and no sub-line "{time} · قبل ما تسيبي الاستقبال" (`web/src/screens/day/CashCloseSheet.tsx`).
- [fix] The title's date has a comma ("إقفال يوم الأربعاء، 14 أكتوبر"); the prototype reads "إقفال يوم الاثنين 7 سبتمبر" (`CashCloseSheet.tsx`).
- [ask] Summary cells put the label above the value; the prototype's `.close-cell` renders label and value on one line (its spans are inline) — which?
- [decided] "تصدير CSV" instead of "تصدير Excel" (`docs/design-rule.md:52-54`).
- [ask] The confirm button reads "إغلاق"; the prototype's reads "قفل اليوم وطبع الملخّص" — print the summary on closing?
- [data] Amounts, the invoice and no-show counts, and the closer's name (the owner ran the capture).

## 8. Tomorrow's sheet (`#s8`)

App capture: the tomorrow's-sheet preview, the seeded Monday's slots-doctor visits written again as tomorrow's bookings.

- [ask] The page is previewed inside a sheet (title "جدول زيارات الغد", "طباعة ورقة الغد", ×); the prototype shows the `.print-page` alone — keep the sheet?
- [fix] `.print-header` is a grey dashed box without the ✎; the prototype's is yellow (`#fff8e1` fill, `#d4a017` dashed border, `#856d00` text) with a ✎ (`web/src/screens/day/PrintPage.tsx`).
- [fix] The day line has a comma ("الثلاثاء، 13 أكتوبر 2026"); the prototype reads "الثلاثاء 8 سبتمبر 2026" (`web/src/screens/day/DaySheet.tsx`).
- [fix] A missing phone prints "بدون رقم" in the monospace, letter-spaced phone style, which breaks the Arabic letters apart (`DaySheet.tsx`).
- [fix] The footer adds the weekday ("طُبعت الأربعاء، 14 أكتوبر 10:00"); the prototype reads "طُبعت 7 سبتمبر 6:15 م" (`DaySheet.tsx`).
- [decided] Footer and table times use the 24-hour clock (`docs/session-handoff.md:180`).
- [ask] The footer's brand reads "Clintra"; the prototype's reads "Clintra v1.0" — show the version?
- [data] Clinic name and address, patients, services, the patient count; the demo patients have no phone.

## 9. Doctor's day (`#s9`)

App capture: the whole page — the doctor's day mid-morning.

- [decided] The role-dependent sidebar frames the page (`docs/design-rule.md:55-57`).
- [ask] The app bar's sync chip and lock button (as on screen 2) — keep them?
- [ask] The content column is about 720px wide against the prototype's full frame (as on screen 2) — widen it?
- [fix] The who chip reads "أحمد المصري"; the prototype's reads "د. أحمد المصري" (`web/src/components/AppShell.tsx`).
- [data] The momentum bar is in its on-time state ("ماشي في الميعاد") against the prototype's late state; times and medians.
- [data] No age in the hero or the brief (no birth year in the demo); "زيارة سابقة" for one prior visit.
- [decided] The last-visit block has no "موصوف" part (`docs/session-handoff.md:228`).
- [decided] The quick note's placeholder reads "ملاحظة على الزيارة دي…" (`docs/session-handoff.md:232`).
- [data] The quick note's "حفظ" is disabled: nothing typed.
- [decided] "استدعِ للكشف" is disabled with "فيه مريض في الكشف" while someone is in the room, in the brief and the day list (`docs/session-handoff.md:233`).
- [data] Waiting rows show the booked time instead of "نمرة N": the capture is a slots day.
- [decided] The attention card has no lab-referral item and the unpaid-invoice item no button (`docs/session-handoff.md:230`; `docs/design-rule.md:50-51`).
- [ask] A booked visit that has not arrived has no button in the day list; the prototype's last row has "افتح ملف" — add it?
- [ask] Mobile: the quick-note input stays inside its card; the prototype's input overflows the card at 390 — keep the app's?
- [decided] Times use the 24-hour clock (`docs/session-handoff.md:180`).

## 10. Visit workspace (`#s10`)

App capture: the visit sheet for كريم in the room — history, complaint, diagnosis and three drugs (no plan under way).

- [ask] The workspace is a bottom sheet titled "ملف الزيارة" with a close × (as on screen 4); the prototype draws a page card — keep the sheet?
- [fix] The sheet head's arrival time "09:00" is drawn under the close ×, overlapping it (`web/src/screens/day/SheetHeader.tsx`, `VisitFormSheet.tsx`).
- [decided] No `.visit-aside` assistant panel; one `.visit-main` column (`docs/design-rule.md:29-33`; `docs/session-handoff.md:239`).
- [fix] The phone is grouped "010 0123 4567"; the prototype groups it 4-3-4 ("0111 234 5678") (`web/src/domain/phone.ts`, `formatEgyptianPhoneForDisplay`).
- [data] "زيارتين · آخر زيارة قبل يومين" and the age.
- [decided] "ابدأ خطة رعاية" in place of `.plan-badge`: no plan is under way (`docs/session-handoff.md:178`).
- [decided] The history's heading counts the real visits ("آخر زيارتين") and each row ends with the drug names (`docs/session-handoff.md:241`).
- [decided] No field hint besides the autosave "اتحفظ" (`docs/session-handoff.md:239`).
- [ask] Drug lines are plain text; the prototype's `.rx-item .dose` bolds the counts and durations — bold the duration?
- [fix] "حذف" is a compact button; the prototype's `.rx-item .rm` stretches to the item's height (the grid's default stretch, as rendered) (`web/src/screens/visit/VisitWorkspace.tsx`).
- [decided] An extra "اطبع الوصفة" under the list (`docs/session-handoff.md:249`).
- [ask] The run button reads "قفل الزيارة"; the prototype's reads "قفل الزيارة (يفتح الفاتورة)" — should closing open the invoice, and say so?
- [data] Complaint, diagnosis, drugs and the session length.

## 11. Audit log (`#s11`)

App capture: the audit sheet on the real day — three bookings, an arrival, a cancellation and a no-show.

- [ask] Bottom sheet against the prototype's page card (as on screen 4) — keep it?
- [fix] The head has no "اليوم" badge and reads "السجل — الأربعاء، 14 أكتوبر"; the prototype reads "سجل اليوم" (`web/src/screens/day/AuditSheet.tsx`).
- [ask] Filters come in two rows (eight entities, then الكل / إنشاء / تعديل / حذف); the prototype's `.filts` has four (الكل / زيارات / فواتير / إعدادات) — which set?
- [fix] Row text: the verb alone on the first line and "actor · patient" on the second; the prototype's `.aud-txt` reads "verb · patient" then "actor · context" ("شاشة اليوم", "موعد 10:30", «طلب المريضة») (`AuditSheet.tsx`).
- [fix] The actor adds the role "(المساعد)" (`web/src/screens/day/actorLabel.ts`, `AuditSheet.tsx`).
- [fix] Verbs read "سجّل حجز / سجّل غياب / ألغى الزيارة"; the prototype's read "أنشأ حجز / علّم لم يحضر / ألغى الحجز" (`AuditSheet.tsx`).
- [decided] Times use the 24-hour clock (`docs/session-handoff.md:180`).
- [data] Six events, all minutes old, so every row carries "من 5د"; names.

## 12. Settings — working hours (`#s12`)

App capture: the settings sheet's working-hours tab, as the owner.

- [ask] Bottom sheet against the prototype's page card (as on screen 4) — keep it?
- [fix] The head reads "أحمد المصري"; the prototype's reads "د. أحمد المصري" (`web/src/screens/day/SettingsSheet.tsx`).
- [decided] An extra tab "الأطباء" (`docs/session-handoff.md:90-92`).
- [fix] The range is laid out left to right ("09:00" on the left, "14:00" on the right); the prototype's `.hours` runs right to left, "09:00" on the right (`web/src/screens/day/WorkingHoursPanel.tsx`).
- [ask] No run row ("حفظ التغييرات", "آخر تعديل: د. أحمد · قبل يومين"): each row saves on its own — add the footer?
- [ask] Mobile: hours stay on one line; the prototype's wrap onto three lines at 390 — keep the app's?
- [data] Every day 09:00–14:00 in slots of 30 minutes; the location's name.

## 13. Settings — services (`#s13`)

App capture: the settings sheet's services tab, as the owner, one service stopped.

- [ask] Bottom sheet against the prototype's page card (as on screen 4) — keep it?
- [fix] The head has no sub-line "N خدمات نشطة · N موقوفة" (`web/src/screens/day/SettingsSheet.tsx`, `ServicesPanel.tsx`).
- [decided] The extra tab "الأطباء" (`docs/session-handoff.md:90-92`).
- [ask] Services follow their ids' order, which differs from run to run; the prototype lists them in a fixed order — sort by creation, by name, or by an owner-set order?
- [data] Services, durations and prices.

## 14. Settings — staff (`#s14`)

App capture: the settings sheet's staff tab, as the owner.

- [ask] Bottom sheet against the prototype's page card (as on screen 4) — keep it?
- [decided] The PIN shows as a "مُعيّن ✓" badge, never its digits (`docs/design-rule.md:38-39`).
- [ask] The active state is a "مفعّل" badge; the prototype's row has a `.toggle` switch — use a switch?
- [fix] The owner reads "أحمد المصري" with the role "المالك"; the prototype reads "د. أحمد المصري" with "المالك · طبيب" (`web/src/screens/day/StaffPanel.tsx`).
- [fix] The head has no sub-line "2 موظفين نشطين" (`SettingsSheet.tsx`, `StaffPanel.tsx`).
- [fix] The note reads "العيادة لازم يكون ليها مالك واحد شغّال على الأقل"; the prototype's reads "مش قادر تخفّي المالك — العيادة لازم عندها مالك واحد شغّال على الأقل." (`StaffPanel.tsx`).
- [decided] The extra tab "الأطباء" (`docs/session-handoff.md:90-92`).

## 15. Device activation (`#s15`)

App capture: the activation card before activating, both fields filled.

- [decided] The fields are the 16-character activation code ("كود التفعيل") and the owner's phone; no SMS code field and no "will be registered to …" line (`docs/design-rule.md:40-45`).
- [fix] The button reads "تفعيل الجهاز"; the prototype's reads "فعّل الجهاز" (`web/src/auth/registrationStrings.ts`).
- [data] The phone shows as typed, focused (the capture's last field).
- [data] The code's value.

## 16. Printed prescription (`#s16`)

App capture: the print sheet's preview for كريم's three drugs, before the first print.

- [ask] The preview sits in a sheet titled "الوصفة" with a close ×; the prototype shows the page with an action card under it — keep the sheet?
- [decided] One action, "طباعة / حفظ PDF", and no PDF, WhatsApp or SMS buttons before the first print (`docs/session-handoff.md:250`, `:172`).
- [decided] The preview note names that one action ("دي معاينة للطباعة · اضغط «طباعة / حفظ PDF»") (`docs/session-handoff.md:250`).
- [fix] The preview note is a copper-wash box with a copper border; the prototype's `.rx-print-header` is `#fff8e1` with a `#d4a017` dashed border and `#856d00` text (`web/src/screens/prescription/RxPrintPage.tsx`).
- [fix] The clinic line has no "هاتف:" before the phone (`RxPrintPage.tsx`, `printModel.ts`).
- [ask] The date is set left to right ("14 / 10 / 2026", the year furthest right); the prototype's `.rx-num` renders right to left (the day furthest right) — which order?
- [fix] "Rx" sits on the left with its rule running right; the prototype's `.rx-title` puts "Rx" on the right with the rule running left (`RxPrintPage.tsx`).
- [fix] The dose line has no "لمدة" before the duration ("· 7 أيام" against "· لمدة 7 أيام") (`web/src/screens/prescription/printModel.ts`).
- [data] Title "طبيب عام" without a syndicate number, the clinic, the RX number, the drugs' texts and forms.

## 17. Care plan (`#s17`)

App capture: the care plan sheet — five sessions done, the sixth booked, four suggested.

- [ask] Bottom sheet titled "خطة الرعاية" against the prototype's two page cards (as on screen 4) — keep it?
- [decided] Session names are the services' names (`docs/session-handoff.md:216-218`).
- [fix] `.meta` shows the doctor and "مقترح" in plain text; the prototype bolds both (`<b>د. أحمد</b>`, `<b>مقترح</b>`) (`web/src/screens/carePlan/CarePlanSheet.tsx`).
- [decided] `.meta` reads "d / m · د. {doctor} · {duration} دقيقة", a booked session adding "h:mm" — "14 / 10 · 9:30" instead of "النهارده · 4:30 م" (`docs/session-handoff.md:180`).
- [decided] Suggested rows carry "أجّل" (`docs/session-handoff.md:180`).
- [decided] "احجز الجلسة التالية" is disabled with "الجلسة التالية محجوزة 14 / 10 · 9:30" while the next session is booked (`docs/session-handoff.md:181`).
- [data] Dates, totals, paid, durations and the diagnosis text.

## 18. Patient profile (`#s18`)

App capture: the whole page — كريم's profile from the patients page, on the الكل tab.

- [decided] The role-dependent sidebar frames the page (`docs/design-rule.md:55-57`).
- [ask] The app bar's sync chip and lock button (as on screen 2) — keep them?
- [decided] "رجوع للبحث" above the profile (`docs/session-handoff.md:187`).
- [decided] No file number in `.meta` (`docs/design-rule.md:50`).
- [fix] The phone is grouped "011 1234 5678"; the prototype groups it 4-3-4 (`web/src/domain/phone.ts`).
- [ask] "أول زيارة" is set left to right (the year next to the label); the prototype renders right to left (the day next to the label) — which order?
- [decided] No "النهارده" group: today's visit is in the room, and visits still to come or in the room are not shown (`docs/session-handoff.md:191`).
- [decided] A message reads "اتبعتت" / "اتفتحت", never "اتسلّمت" (`docs/design-rule.md:46-49`; `docs/session-handoff.md:191`).
- [decided] A prescription reads "اتطبعت" / "لسه ما اتطبعتش" instead of "مرتبطة بزيارة اليوم" (`docs/session-handoff.md:191`).
- [decided] The payment method reads "كاش" (`docs/session-handoff.md:193`).
- [decided] An extra "ملاحظة الطبيب" event and a muted cancelled visit (`docs/session-handoff.md:191`).
- [decided] Times use the 24-hour clock (`docs/session-handoff.md:191`).
- [data] Events, counts, the balance and dates.

## 19. Messages (`#s19`)

App capture: the whole page — the messages page with three recent messages, the booking confirmation template selected.

- [decided] The role-dependent sidebar frames the page (`docs/design-rule.md:55-57`).
- [ask] The app bar's sync chip and lock button (as on screen 2) — keep them?
- [decided] Badges read "مقترح" instead of "تلقائي", and no description says "تلقائي" (`docs/design-rule.md:46-47`).
- [decided] No channel toggle on the page; the owner's "تعديل" replaces "حفظ التعديلات" (`docs/session-handoff.md:170-171`).
- [decided] The list's heading reads "آخر الرسائل" and statuses "اتفتحت" / "اتبعتت" (`docs/session-handoff.md:173`).
- [fix] Phones are grouped "012 2345 6789"; the prototype groups them 4-3-4 (`web/src/domain/phone.ts`).
- [decided] Mobile: the templates are a horizontal row of chips (`docs/session-handoff.md:174`).
- [data] Recipients, snippets, three messages against four.

## Summary

| Screen | decided | data | fix | ask | Verdict |
|---|---:|---:|---:|---:|---|
| 1. PIN lock | 1 | 1 | 2 | 4 | small fixes |
| 2. Day — slots | 3 | 4 | 3 | 7 | small fixes |
| 3. Day — queue | 3 | 2 | 3 | 10 | small fixes |
| 4. New booking | 0 | 1 | 3 | 2 | small fixes |
| 5. Invoice | 2 | 1 | 5 | 5 | needs work |
| 6. Payment and receipt | 1 | 1 | 2 | 2 | small fixes |
| 7. Cash close | 1 | 1 | 2 | 3 | small fixes |
| 8. Tomorrow's sheet | 1 | 1 | 4 | 2 | needs work |
| 9. Doctor's day | 6 | 4 | 1 | 4 | small fixes |
| 10. Visit workspace | 5 | 2 | 3 | 3 | small fixes |
| 11. Audit log | 1 | 1 | 4 | 2 | needs work |
| 12. Settings — working hours | 1 | 1 | 2 | 3 | small fixes |
| 13. Settings — services | 1 | 1 | 1 | 2 | small fixes |
| 14. Settings — staff | 2 | 0 | 3 | 2 | small fixes |
| 15. Device activation | 1 | 2 | 1 | 0 | small fixes |
| 16. Printed prescription | 2 | 1 | 4 | 2 | needs work |
| 17. Care plan | 4 | 1 | 1 | 1 | small fixes |
| 18. Patient profile | 9 | 1 | 1 | 2 | small fixes |
| 19. Messages | 5 | 1 | 1 | 1 | small fixes |
| **Total** | **49** | **27** | **46** | **57** | |

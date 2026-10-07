// All user-facing Arabic strings for the day screen live in this module so
// they can be reviewed in one place.
export const dayScreenStrings = {
  // The app bar's title (AppShell.tsx) — the one piece of that bar's content
  // this screen supplies. Queue mode gets its own suffix, slots mode none.
  appBarTitle: "يوم العيادة",
  appBarTitleQueue: "يوم العيادة — طابور",

  // SheetHeader.tsx's explicit close button — an additional, discoverable
  // dismissal alongside the sheet's existing backdrop-tap/Escape/drag-down,
  // shared by every sheet built with that header.
  sheetCloseAriaLabel: "إغلاق",

  // Case A: the practitioner has schedule rows, but none for today's weekday.
  // A normal day off — counters are hidden entirely, not shown as zero.
  noScheduleToday: "مفيش مواعيد النهاردة",
  // Case B: the practitioner has no schedule rows at all, for any weekday.
  // Missing configuration, not a day off.
  scheduleNotConfigured: "مواعيد العمل لسه مش متسجلة",
  scheduleNotConfiguredHint: "تتسجل من الإعدادات",
  emptySlot: "الموعد فاضي",
  // Short status words shown on every booked row, so status is never
  // communicated by colour alone.
  statusBooked: "محجوز",
  statusConfirmed: "اتأكد",
  statusArrived: "وصل",
  statusInRoom: "جوه",
  statusCompleted: "خلص",
  statusCancelled: "اتلغى",
  statusNoShow: "غاب",
  // Shown under the patient name on a cancelled or no_show row: the slot is
  // free again, but the screen stays read-only so this is text only.
  slotAvailableAgain: "الميعاد ده فاضي تاني",
  // Prefixes the "recorded by" byline under every occupied slot row, e.g.
  // "سجّله سارة حسن (المساعد)" — see screens/day/actorLabel.ts. Code points:
  // U+0633 U+062C U+0651 U+0644 U+0647 (س ج ّ ل ه).
  recordedByPrefix: "سجّله",
  // Shown in the light toast after a one-tap attendance mark, with an undo
  // action available for five minutes.
  attendanceMarked: "اتسجل حضور المريض",
  undoAction: "تراجع",
  // Shown instead of the undo option when the undo is refused: the window
  // passed, or the visit changed since the mark, so nothing was written.
  undoRefused: "التراجع مش متاح دلوقتي",
  // The summary slab (prototype `.slab`) — shared cell words, reused by both
  // slots and queue mode.
  countersArrived: "حضروا",
  countersCompleted: "خلصوا",
  allLocations: "كل الفروع",
  // Accessible group names for the practitioner/location ToggleGroups under
  // the slab (shown only when there is more than one of either).
  practitionerFilterAriaLabel: "اختار الطبيب",
  locationSwitcherAriaLabel: "اختار الفرع",

  // Slots mode's slab (#s2): hero, cells, split legend, tiles.
  slabRemainingLabel: "متبقي في اليوم",
  slabRemainingUnit: "مريض",
  slabTotalCaptionPrefix: "من إجمالي",
  slabTotalCaptionSuffix: "حجوزات",
  slabNoShowCellLabel: "لم يحضر",
  slabSplitCompletedPrefix: "اكتمل",
  slabSplitOfWord: "من",
  slabSplitRemainingPrefix: "باقي",
  // The copper "next up" action and the cash-close kbd hint.
  slabNextActionPrefix: "التالي:",
  slabCloseKbdPrefix: "إقفال",
  // Money/consult-length tiles.
  // `.tile .v i` — the small faint unit after the number, separate from the
  // value itself (screens/money.ts's formatMoneyAmount formats the bare number).
  tileCurrencyUnit: "ج.م",
  tileCollectedLabel: "محصّل اليوم",
  tileInvoiceCountSuffix: "فواتير",
  tileDueLabel: "مستحق",
  tileLongestConsultPrefix: "أطول",
  // Short minute suffix ("27د"), distinct from delayMinutesSuffix's full
  // word ("27 دقيقة") — both appear in the prototype, in different spots.
  minutesShortUnit: "د",
  // Short hour suffix for elapsedLabel.ts's bounded elapsed labels ("1س 15د").
  hoursShortUnit: "س",

  // Queue mode's slab (#s3): hero caption and its own cell/action words
  // (مستنيين/خلصوا reuse the two shared cell words above).
  queueHeroOfTotalWord: "من",
  queueExpectedFinishPrefix: "يتوقع خلاص",
  queueInRoomCellLabel: "في الكشف",
  // `.qwho .meta`'s in_room phrase ("دخل من 7د") — gender-neutral, unlike
  // the prototype's own per-row sample text.
  queueInRoomMetaPrefix: "دخل من",
  // Marks the single waiting row that is next in line. The redesigned row
  // (QueueRow.tsx) carries this as visually-hidden text for assistive
  // technology, not a visible badge — the prototype's own `.qrow.next`
  // only recolours the qnum.
  queueNextBadge: "التالي",
  queueNextActionNumberPrefix: "نمرة",
  // The floating action that opens the booking sheet.
  bookingButtonLabel: "حجز",
  // `.field label` above the search box — distinct from the placeholder
  // below, which stays its own (shorter) wording.
  bookingSearchLabel: "ابحث بالاسم أو التليفون",
  bookingSearchPlaceholder: "دور بالاسم أو الرقم",
  // `.field label` above the confirm step's service picker.
  bookingServiceFieldLabel: "الخدمة",
  // `.svc-row .svc`'s own price suffix, e.g. "400ج" — short, unlike
  // tileCurrencyUnit's full "ج.م" on the day tiles.
  shortCurrencySuffix: "ج",
  // Shown only once the search query is non-empty and matches nothing. An
  // empty query renders no results and no message at all.
  bookingNoResults: "مفيش نتائج",
  // Shown on a result row in place of a last-visit date, for a patient with
  // no completed visit on record.
  bookingFirstVisit: "أول زيارة",
  bookingBackAction: "رجوع",
  // Shown on the slots step when the practitioner's schedule has no empty
  // slot left today.
  bookingNoEmptySlots: "مفيش مواعيد فاضية النهاردة",
  bookingConfirmButton: "احجز",
  // Shown in the toast after a successful booking, with the same undo action
  // and five-minute window as the attendance toast.
  visitBooked: "اتحجز الميعاد",
  // Shown in the toast when the tapped slot was taken by another booking a
  // moment earlier; nothing is written and there is no undo to offer.
  bookingSlotTakenError: "الميعاد ده اتحجز لسه من ثانية",
  // Prefixes the typed search text on the always-present "create new
  // patient" row, e.g. "+ مريض جديد باسم «أحم»" — shown as the list's last
  // row whether or not any real match was found, not only on zero results.
  newPatientButtonPrefix: "+ مريض جديد باسم",
  newPatientNamePlaceholder: "اسم المريض",
  newPatientPhonePlaceholder: "رقم التليفون (اختياري)",
  // Toggle that disables and clears the phone field.
  newPatientNoPhoneToggle: "من غير رقم",
  newPatientOnlyNameRequiredHint: "الاسم هو المطلوب الوحيد",
  newPatientNameRequiredError: "لازم تكتب اسم المريض",
  newPatientPhoneInvalidError: "الرقم ده مش صحيح",
  newPatientSubmitButton: "إضافة",
  // Shown when undoing a new-patient booking reverses the visit but then the
  // patient reversal itself fails: the assistant must know the patient
  // record is still there, not assume the whole booking was cleanly undone.
  newPatientUndoPartialFailure: "اتلغى الحجز، لكن بيانات المريض لسه محفوظة",

  // The overflow (ellipsis) menu on an occupied row.
  menuOpenAriaLabel: "خيارات تانية",
  moveMenuLabel: "نقل لميعاد تاني",
  cancelMenuLabel: "إلغاء",
  noShowMenuLabel: "تسجيل غياب",

  // The cancel-reason prompt: two buttons, no free-text.
  cancelPromptTitle: "سبب الإلغاء",
  cancelReasonPatient: "المريض",
  cancelReasonClinic: "العيادة",
  cancelToastMessage: "اتلغى الميعاد",
  noShowToastMessage: "اتسجل غياب المريض",

  // The move sheet: empty slots for today and the next 7 days.
  moveSheetHeading: "اختار الميعاد الجديد",
  moveToastMessage: "اتنقل الميعاد",
  // Shown when undoing a move reverses the new slot but then reversing the
  // original visit's row fails: the assistant must know the old appointment
  // is still marked as moved, not assume the whole move was cleanly undone.
  moveUndoPartialFailure: "اترجع الميعاد الجديد، لكن الميعاد القديم لسه متسجل إنه اتنقل",

  // Doctor delay: the slab's trigger action and its picker.
  // The trigger's own visible/accessible label (prototype's `.sb` text) —
  // static; the amount appends to this same label when a delay is set.
  delayControlTriggerLabel: "تسجيل تأخير الطبيب",
  delayMinutesSuffix: "دقيقة",
  delayPickerTitle: "تأخير الطبيب",
  delayClearOption: "شيل التأخير",
  delayLinePrefix: "الطبيب متأخر",
  delayLineActualStart: "البدء الفعلي",
  delayChangedToastMessage: "اتسجل تأخير الطبيب",

  // The remaining two one-tap advances (booked/confirmed -> arrived already
  // reuses attendanceMarked above).
  inRoomToastMessage: "دخل المريض الكشف",
  completedToastMessage: "خلصت الزيارة",

  // Walk-in: a patient who arrived without an appointment.
  walkInButtonLabel: "مريض جه دلوقتي",

  // Overbook: writing a visit outside the normal slot grid.
  overbookButtonLabel: "احجز فوق السعة",
  overbookPickerHeading: "اختار ميعاد فوق السعة",
  // Shown on every row after the first at a clock time two or more visits
  // share — only reachable through the overbook flow.
  overbookedRowBadge: "فوق السعة",

  // The slots-list card (prototype `.c-card`/`.c-head`, #s2) and its rows.
  slotsCardBadge: "اليوم",
  slotsCardTitle: "مواعيد اليوم",
  slotsCardSubtitleBookedSuffix: "حجوزات",
  slotsCardSubtitleFreeSuffix: "فاضية",
  // `.slot .time .until` — shown under the time, state-dependent.
  untilArrivedPrefix: "وصل",
  untilSincePrefix: "من",
  // The empty slot's own free-text line and its dashed quick-book button —
  // distinct from emptySlot above, which stays the button's accessible name.
  emptySlotFreeLabel: "موعد فاضي",
  emptySlotQuickActionLabel: "＋ احجز هنا",
  // Appended to the actor byline when the visit was recorded on an earlier
  // day — "أمس" for yesterday, otherwise a short d/m date (no string needed
  // for that — see actorRecency.ts).
  actorYesterdaySuffix: "أمس",
  // `.runrow .count` on the slots card's footer.
  slotsFooterCountTotalSuffix: "ميعاد",
  slotsFooterCountBookedSuffix: "محجوز",
  slotsFooterCountFreeSuffix: "فاضي",

  // The sync status chip in the day header, and its needs-review list.
  syncOnline: "متصل",
  syncLocal: "شغّال محلي",
  // The network interface is up but the server itself keeps failing to
  // respond — distinct from syncLocal (docs/sync-plan.md's Q10;
  // sync/engine.ts's consecutive-transport-failure counter).
  syncServerUnreachable: "السيرفر مش راد",
  syncNeedsReview: "فيه حاجة محتاجة مراجعة",
  syncReviewListTitle: "حاجات محتاجة مراجعة",
  // The two review actions now genuinely differ — sync/reviewActions.ts's
  // keepMine/discardMine.
  syncReviewKeepAction: "خليها كده",
  syncReviewRemoveAction: "شيلها",
  // Shown instead of the two actions until getReviewComparison reports
  // ready — offering a choice before the data to choose from exists would
  // be a blind choice (docs/sync-plan.md's Q6).
  syncReviewWaitingForServer: "في انتظار تحديث من السيرفر…",
  syncReviewMineLabel: "نسختي",
  syncReviewServerLabel: "نسخة السيرفر",
  // A create-conflict's "server" side, shown in place of syncReviewServerLabel's row — there is no server row under this id at all (Q7).
  syncReviewNoServerRow: "مفيش نسخة على السيرفر — الميعاد ده اتحجز لمريض تاني",

  // The overflow menu's invoice entry, only shown once a visit has one.
  invoiceMenuLabel: "الفاتورة",

  // The invoice sheet.
  invoiceNumberLabel: "رقم الفاتورة",
  invoicePatientLabel: "المريض",
  invoicePractitionerLabel: "الطبيب",
  invoiceDateLabel: "التاريخ",
  // The items table's leading column header.
  invoiceItemLabel: "البند",
  invoiceItemQtyLabel: "الكمية",
  invoiceItemUnitPriceLabel: "سعر الوحدة",
  invoiceItemTotalLabel: "الإجمالي",
  invoiceTotalLabel: "إجمالي الفاتورة",
  invoicePaidLabel: "المدفوع",
  invoiceRemainingLabel: "المتبقي",
  invoiceStatusUnpaid: "غير مدفوعة",
  invoiceStatusPartial: "مدفوعة جزئيًا",
  invoiceStatusPaid: "مدفوعة بالكامل",
  invoiceStatusVoid: "ملغاة",
  recordPaymentAction: "تسجيل دفعة",
  printInvoiceAction: "إيصال الفاتورة",
  voidInvoiceAction: "إلغاء الفاتورة",
  // Shown instead of an enabled voidInvoiceAction once any payment exists.
  voidInvoiceDisabledReason: "مفيش إلغاء بعد تسجيل دفعة",
  voidInvoiceToastMessage: "اتلغت الفاتورة",
  paymentsListHeading: "الدفعات",
  // Prefixes a payment row's receipt number, e.g. "إيصال رقم 3".
  paymentReceiptNumberPrefix: "إيصال رقم",
  printReceiptAction: "طباعة",

  // The "تسجيل دفعة" prompt.
  paymentSheetTitle: "تسجيل دفعة",
  // `.book-head h3`'s own connector word, e.g. "دفعة · فاتورة INV-2026-0142".
  paymentSheetInvoiceConnector: "فاتورة",
  paymentAmountPlaceholder: "المبلغ (جنيه)",
  // `.field .hint` under the amount field.
  paymentAmountHint: "اكتب رقم أقل عشان دفعة جزئية تانية",
  paymentAmountInvalidError: "المبلغ ده مش صحيح",
  paymentAmountNotPositiveError: "لازم يكون المبلغ أكبر من صفر",
  paymentAmountExceedsRemainingError: "المبلغ أكبر من المتبقي",
  // The .lb label above the method pill row — the pills themselves are
  // still labelled by each method's own name below.
  paymentMethodLabel: "طريقة الدفع",
  paymentMethodCash: "كاش",
  paymentMethodCard: "فيزا",
  paymentMethodWallet: "محفظة",
  paymentMethodTransfer: "تحويل",
  paymentNotePlaceholder: "ملاحظة (اختياري)",
  // The note field's own example placeholder text (`.field .in` placeholder),
  // distinct from paymentNotePlaceholder above, which is the field's label.
  paymentNoteExamplePlaceholder: "مثلًا: باقي المبلغ الأسبوع الجاي",
  paymentConfirmButton: "تسجيل",
  paymentToastMessage: "اتسجلت الدفعة",
  // Shown when undoing a payment reverses the invoice's paid/status but then
  // deleting the payment row itself fails — the assistant must know the
  // invoice no longer reflects this payment, even though its row survives.
  paymentUndoPartialFailure: "اترجعت الفاتورة، لكن الدفعة لسه متسجلة",

  // Completing a visit now also creates its invoice in the same write; this
  // is the partial-failure message for when undoing that reverses the
  // invoice but the visit's status can no longer be reverted with it (e.g. a
  // payment was recorded against the invoice since, or the undo window on
  // the visit itself expired independently).
  visitCompletionUndoPartialFailure: "اتلغت الفاتورة، لكن حالة الزيارة لسه \"خلصت\"",

  // The day header's cash-close action and its sheet (prototype #s7: `.c-head`,
  // `.close-summary`, `.close-grid`, `.close-cell`, `.match`, `.diff`, `.field`,
  // `.runrow`).
  cashCloseButtonLabel: "إغلاق الصندوق",
  cashCloseSheetTitle: "إغلاق الصندوق",
  // `.c-head h3`'s own prefix, combined with formatCairoDisplayDate(date) —
  // e.g. "إقفال يوم الاثنين 7 سبتمبر".
  cashCloseHeadTitlePrefix: "إقفال يوم",
  cashCloseSummaryHeading: "ملخّص اليوم",
  // `.close-grid`'s four cells.
  cashCloseExpectedLabel: "إجمالي المتوقع",
  cashCloseGridCollectedLabel: "المحصّل نقدي",
  cashCloseGridInvoicesLabel: "فاتورة",
  cashCloseGridInvoicesUnit: "مدفوعة",
  cashCloseActualCashFieldLabel: "الكاش الفعلي في الدرج",
  cashCloseCollectedPlaceholder: "المبلغ المحصل (جنيه)",
  cashCloseCollectedInvalidError: "المبلغ ده مش صحيح",
  cashCloseDifferenceLabel: "الفرق",
  cashCloseNotePlaceholder: "سبب الفرق",
  // Shown only once the difference is non-zero and the note is still empty.
  cashCloseNoteRequiredError: "لازم تكتب سبب الفرق",
  // The eligible/warning result banner once an amount has been typed.
  cashCloseMatchedTitle: "مطابق تمامًا",
  cashCloseMatchedSubtitle: "مفيش فرق بين المتوقع والمحصّل",
  // Existing label kept as-is per the task's own instruction (no printing
  // added here, unlike the prototype's own ".run" button text).
  cashCloseConfirmButton: "إغلاق",
  cashCloseExportCsvAction: "تصدير CSV",
  // `.runrow .count`'s own prefix, e.g. "هيقفله سارة حسن".
  cashCloseClosesCountPrefix: "هيقفله",
  cashCloseAlreadyClosedError: "الصندوق مقفول بالفعل عن اليوم ده",
  cashCloseToastMessage: "اتقفل الصندوق",

  // The read-only summary shown instead of the form once this location/day
  // already has a cash_close row.
  cashCloseClosedAtLabel: "اتقفل الساعة",
  cashCloseClosedByLabel: "بواسطة",
  cashCloseNoDifferenceNoteLabel: "مفيش ملاحظة",

  // The past-due gate (screen 7): visits still booked/confirmed whose time
  // has already passed — see pastDueVisits.ts. Shown as its own list above
  // the totals, with a per-row no-show/move pair, a bulk no-show action, and
  // a checkbox that lets the close proceed without touching any of them.
  cashClosePastDueSectionTitle: "تحتاج تعليم",
  cashClosePastDueNoShowAction: "لم يحضر",
  cashClosePastDueMoveAction: "نقل",
  cashClosePastDueBulkAction: "علّم الكل لم يحضر",
  cashClosePastDueBulkToastMessage: "اتسجل غياب الزيارات المتأخرة",
  // Shown instead of the undo option when reversing the bulk mark fails
  // partway through — some visits went back to how they were, some didn't.
  noShowBulkUndoPartialFailure: "جزء من التراجع مكنش ممكن، راجع القايمة",
  cashClosePastDueAcknowledgeLabel: "عارف إنهم ما حضروش — اقفل من غير تعليم",
  // Shown instead of the amount/note errors while the past-due list is
  // non-empty and the checkbox above is unchecked — closing is refused
  // outright until one of the two is true.
  cashClosePastDueBlockedError: "لسه فيه زيارات متأخرة محتاجة تعليم أو تأكيد",

  // Print output: a plainly-labeled placeholder header shown in the app in
  // place of clinic branding, since settings screens don't exist yet — the
  // specification is explicit that this placeholder must never itself
  // appear on a printed page (see printHeaderWarning, which replaces it
  // there instead).
  printHeaderPlaceholder: "ترويسة العيادة — تتضبط من الإعدادات",
  printHeaderWarning: "برجاء ضبط ترويسة الطباعة قبل الطبع",
  printInvoiceTitle: "فاتورة",
  printReceiptTitle: "إيصال",

  // Queue mode: the numbered-list rendering, its summary line, and the
  // waiting-row expected-time hint. Position numbers and the summary's
  // counts use Eastern Arabic-Indic digits (see domain/arabicNumerals.ts) —
  // unlike clock times or money, these read as plain counting numbers
  // inside natural Arabic text, not foreign Latin-script data, so they are
  // never wrapped in components/Ltr.tsx.
  queueSummaryCurrentTurnLabel: "الدور دلوقتي",
  queueSummaryWaitingLabel: "مستنيين",
  queueSummaryAverageLabel: "متوسط الكشف",
  // Prefixes the expected-wait minutes on a waiting row, e.g. "متوقع دورك بعد ~٢٢ دقيقة".
  queueExpectedWaitPrefix: "متوقع دورك بعد ~",
  // Shown instead, on every waiting row, until at least two visits have
  // completed today — never extrapolated from a single data point.
  queueExpectedWaitUnknown: "لسه بدري نحسب المتوقع",
  // The floating action, replacing "حجز" while the current schedule is in queue mode.
  addToQueueButtonLabel: "إضافة للدور",
  // Prefixes the assigned queue position in the booking sheet's confirm step, e.g. "هيتحط في الدور برقم ٣".
  addToQueueConfirmPrefix: "هيتحط في الدور برقم",
  addToQueueConfirmButton: "تأكيد",
  // The overflow menu's send-to-end-of-queue entry, and its toast.
  sendToEndOfQueueMenuLabel: "أجّله لآخر الدور",
  sendToEndOfQueueToastMessage: "اتنقل لآخر الدور",

  // The queue-list card (prototype `.q-list`/`.qrow`, #s3) and its rows.
  queueCardBadge: "الطابور",
  queueCardTitle: "الدور",
  queueCardSubtitle: "النمرة تلقائية للأقدم انتظار",
  queueCallNextActionLabel: "استدعاء التالي",
  // `.qwait` — completed shows a duration, in_room a plain dash (the
  // prototype's own rendering: no elapsed time there), waiting reuses
  // queueExpectedWaitPrefix/queueExpectedWaitUnknown above unchanged.
  queueWaitCompletedPrefix: "استغرق",
  queueWaitInRoomDash: "—",
  // `.runrow .count` on the queue card's footer.
  queueFooterCountInQueueSuffix: "في الطابور",
  queueFooterCountCompletedSuffix: "اكتملوا",

  // The day header's day-sheet action ("ورقة الغد"): a printable list of
  // tomorrow's booked visits for the current practitioner+location, prepared
  // before staff leave for the day — never today's own list.
  daySheetButtonLabel: "ورقة الغد",
  daySheetTitle: "جدول زيارات الغد",
  daySheetEmpty: "مفيش حجوزات للغد",
  daySheetNoPhone: "بدون رقم",
  printDaySheetAction: "طباعة ورقة الغد",
  // `.print-day`'s own trailing count, e.g. "— 7 مرضى".
  daySheetPatientCountUnit: "مرضى",
  // `.print-tbl` column headers (#s8).
  daySheetColumnTime: "الوقت",
  daySheetColumnPatient: "المريض",
  daySheetColumnService: "الخدمة",
  daySheetColumnPhone: "التليفون",
  // `.print-foot`'s own prefix, e.g. "طُبعت 7 سبتمبر 18:15".
  printedAtPrefix: "طُبعت",

  // The day header's audit-log action ("السجل") and its sheet: today's
  // audit_log rows for the current practitioner+location, newest first, read
  // as a timeline of what happened rather than staff surveillance — see
  // domain/auditVerb.ts for how a row's verb is built from its before/after
  // diff, not just its entity name.
  auditButtonLabel: "السجل",
  auditSheetTitle: "السجل",
  auditSheetEmpty: "مفيش حركة النهاردة",
  auditFilterAll: "الكل",
  auditFilterEntityVisits: "الزيارات",
  auditFilterEntityPatients: "المرضى",
  auditFilterEntityInvoices: "الفواتير",
  auditFilterEntityPayments: "الدفعات",
  auditFilterEntityCashClose: "إغلاق الصندوق",
  auditFilterEntityVisitFormData: "الزيارة (النموذج)",
  auditFilterActionCreate: "إنشاء",
  auditFilterActionUpdate: "تعديل",
  auditFilterActionDelete: "حذف",
  // The actor label's role suffix, e.g. "سارة حسن (المساعد)" — see domain/role.ts's Role enum.
  roleOwner: "المالك",
  rolePractitioner: "الطبيب",
  roleAssistant: "المساعد",
  roleManager: "المدير",
  auditUnknownActor: "غير معروف",

  // Settings (owner only). The entry pill and the three-panel sheet
  // (reference screens 15-17).
  settingsButtonLabel: "الإعدادات",
  settingsHoursTab: "مواعيد العمل",
  settingsServicesTab: "الخدمات",
  settingsStaffTab: "الموظفون",
  // Indexed by weekdayOf() (0 = Sunday .. 6 = Saturday).
  weekdayNames: ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"],

  // Panel A — working hours.
  hoursStartLabel: "من",
  hoursEndLabel: "لـ",
  hoursSlotMinutesLabel: "مدة الكشف (دقيقة)",
  hoursCapacityLabel: "السعة",
  hoursEditAction: "غيّر",
  hoursModeSlots: "مواعيد",
  hoursModeQueue: "طابور",
  hoursEndBeforeStartError: "وقت النهاية لازم يكون بعد البداية",
  hoursInvalidSlotError: "مدة الكشف لازم تكون أكبر من صفر",
  hoursInvalidCapacityError: "السعة لازم تكون أكبر من صفر",
  hoursVisitsOnOldGridError: "فيه مواعيد محجوزة على المدة القديمة، امسحها أو انقلها الأول",

  // Panel B — services.
  serviceDurationSuffix: "دقيقة",
  serviceActiveLabel: "مفعّلة",
  serviceNewAction: "خدمة جديدة",
  serviceNameLabel: "الاسم",
  serviceDurationLabel: "المدة (دقيقة)",
  servicePriceLabel: "السعر (جنيه)",
  serviceOverridesLink: "أسعار خاصة",
  serviceOverrideAddAction: "أضف سعر خاص",
  serviceOverrideTargetPractitioner: "طبيب",
  serviceOverrideTargetLocation: "فرع",
  serviceOverrideTargetError: "اختار طبيب أو فرع (واحد بس)",
  serviceOverrideDeleteAction: "حذف",
  servicePriceInvalidError: "السعر ده مش صحيح",
  serviceNameRequiredError: "لازم تكتب اسم الخدمة",

  // Panel C — staff and permissions.
  staffNewAction: "موظف جديد",
  staffNameLabel: "الاسم",
  staffPhoneLabel: "رقم الموبايل",
  staffRoleLabel: "الصلاحية",
  staffLocationScopeLabel: "نطاق الفروع",
  staffPractitionerScopeLabel: "نطاق الأطباء",
  staffPinLabel: "الرقم السري (٤ أرقام)",
  staffNewPinLabel: "رقم سري جديد",
  scopeAll: "الكل",
  scopeListed: "محدد",
  scopeSelf: "نفسه",
  staffActiveLabel: "مفعّل",
  staffLastOwnerError: "لازم يفضل مالك واحد نشط على الأقل",
  staffNameRequiredError: "لازم تكتب اسم الموظف",
  staffPinLengthError: "الرقم السري لازم يكون ٤ أرقام",
  staffPhoneInvalidError: "الرقم ده مش صحيح",
  staffPhoneTakenError: "الرقم ده مستخدم قبل كده",
  staffPractitionerRequiredError: "لازم تختار طبيب واحد",
  // Confirmation after a PIN change: prefix + name + suffix.
  staffPinChangedPrefix: "اتغيّر الرقم السري لـ",
  staffPinChangedSuffix: "— لازم تدخل بيه المرة الجاية",

  // Shared settings actions.
  settingsSaveAction: "حفظ",
  settingsCancelAction: "إلغاء",

  // The in-room general visit form (reference screen 10): a small pill on an
  // in_room or completed row, next to the ellipsis, opening a sheet with the
  // two v1 fields. The doctor opens it deliberately — it never opens itself
  // when a visit becomes in_room (see screens/day/VisitFormSheet.tsx).
  visitFormPillLabel: "التسجيل",
  visitFormLoadingLabel: "جارٍ التحميل...",
  visitFormComplaintLabel: "الشكوى الرئيسية",
  visitFormComplaintPlaceholder: "مثال: ألم في الركبة اليمنى من أسبوعين",
  visitFormDiagnosisLabel: "التشخيص",
  visitFormDiagnosisPlaceholder: "مثال: التهاب أوتار",
  // Shown next to a field for two seconds right after its autosave commits,
  // then fades — never a permanent "saved" state occupying layout space.
  visitFormSavedIndicator: "اتحفظ",
  // Shown on a completed row with no visit_form_data row at all — a passive
  // note, not a warning: completing a visit never requires the form to be
  // filled (see db/visitForm.ts and db/visitCompletion.ts's deliberate
  // decoupling).
  visitFormEmptyHint: "الزيارة اتقفلت من غير تسجيل",
} as const;

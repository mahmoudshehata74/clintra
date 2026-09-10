// All user-facing Arabic strings for the day screen live in this module so
// they can be reviewed in one place.
export const dayScreenStrings = {
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
  countersTotalBooked: "إجمالي الحجوزات",
  countersArrived: "حضروا",
  countersCompleted: "خلصوا",
  countersRemaining: "متبقي",
  allLocations: "كل الفروع",
  // The floating action that opens the booking sheet.
  bookingButtonLabel: "حجز",
  bookingSearchPlaceholder: "دور بالاسم أو الرقم",
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

  // Doctor delay: the day header chip and its picker.
  delayNone: "بدون تأخير",
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

  // The sync status chip in the day header, and its needs-review list.
  syncOnline: "متصل",
  syncLocal: "شغّال محلي",
  syncNeedsReview: "فيه حاجة محتاجة مراجعة",
  syncReviewListTitle: "حاجات محتاجة مراجعة",
  // Both actions dismiss the review row the same way for now — see
  // sync/reviewActions.ts for why a real resolution flow is a later task.
  syncReviewKeepAction: "خليها كده",
  syncReviewRemoveAction: "شيلها",

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
  paymentAmountPlaceholder: "المبلغ (جنيه)",
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

  // The day header's cash-close action and its sheet.
  cashCloseButtonLabel: "إغلاق الصندوق",
  cashCloseSheetTitle: "إغلاق الصندوق",
  cashCloseExpectedLabel: "المتوقع",
  cashCloseCollectedPlaceholder: "المبلغ المحصل (جنيه)",
  cashCloseCollectedInvalidError: "المبلغ ده مش صحيح",
  cashCloseDifferenceLabel: "الفرق",
  cashCloseNotePlaceholder: "سبب الفرق",
  // Shown only once the difference is non-zero and the note is still empty.
  cashCloseNoteRequiredError: "لازم تكتب سبب الفرق",
  cashCloseConfirmButton: "إغلاق",
  cashCloseAlreadyClosedError: "الصندوق مقفول بالفعل عن اليوم ده",
  cashCloseToastMessage: "اتقفل الصندوق",

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
  // Marks the single waiting row that is next in line, distinct from the
  // in_room row's own (stronger) treatment.
  queueNextBadge: "التالي",
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

  // The day header's day-sheet action ("ورقة الغد"): a printable list of
  // tomorrow's booked visits for the current practitioner+location, prepared
  // before staff leave for the day — never today's own list.
  daySheetButtonLabel: "ورقة الغد",
  daySheetTitle: "جدول زيارات الغد",
  daySheetEmpty: "مفيش حجوزات للغد",
  daySheetNoPhone: "بدون رقم",
  printDaySheetAction: "طباعة ورقة الغد",

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
} as const;

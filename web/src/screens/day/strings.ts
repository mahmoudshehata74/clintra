// All user-facing Arabic strings for the day screen live in this module so
// they can be reviewed in one place.
export const dayScreenStrings = {
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
  allPractitioners: "الكل",
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
  // Shown under the "no results" line on the search step, to create a new
  // patient from the typed text.
  newPatientButtonLabel: "إضافة مريض جديد",
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
} as const;

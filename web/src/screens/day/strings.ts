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
} as const;

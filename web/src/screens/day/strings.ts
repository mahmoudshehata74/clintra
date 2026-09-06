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
  countersTotalBooked: "إجمالي الحجوزات",
  countersArrived: "حضروا",
  countersCompleted: "خلصوا",
  countersRemaining: "متبقي",
  allLocations: "كل الفروع",
  allPractitioners: "الكل",
} as const;

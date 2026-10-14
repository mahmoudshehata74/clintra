// Arabic strings for the patient profile (reference screen 18, "ملف المريض")
// and the patients page that finds one (no reference screen).
export const patientProfileStrings = {
  appBarTitle: "المرضى",
  sheetTitle: "ملف المريض",
  loadingLabel: "جارٍ التحميل...",

  // The patients page: search and results.
  searchLabel: "دوّر على مريض",
  searchPlaceholder: "دوّر بالاسم أو رقم التليفون",
  searchPrompt: "اكتب اسم أو رقم",
  searchNoMatch: "مفيش مريض بالاسم ده",
  resultsLabel: "نتايج البحث",
  lastVisitPrefix: "آخر زيارة",
  noVisits: "مفيش زيارات",
  backToSearch: "رجوع للبحث",

  // `.pt-hero`
  ageUnit: "سنة",
  genderMale: "ذكر",
  genderFemale: "أنثى",
  firstVisitLabel: "أول زيارة:",
  statVisits: "زيارات",
  statPlan: "خطة",
  statBalance: "متبقي",
  planOngoing: "جارية",
  planStopped: "متوقفة",
  planCompleted: "اكتملت",

  // `.pt-tabs`
  tabsLabel: "تصنيف الأحداث",
  tabAll: "الكل",
  tabVisits: "زيارات",
  tabRx: "وصفات",
  tabMessages: "رسائل",
  tabPayments: "مدفوعات",
  tabNotes: "ملاحظات",
  emptyAll: "لسه مفيش حاجة في ملف المريض",
  emptyVisits: "لسه مفيش زيارات",
  emptyRx: "لسه مفيش وصفات",
  emptyMessages: "لسه مفيش رسائل",
  emptyPayments: "لسه مفيش مدفوعات",
  emptyNotes: "لسه مفيش ملاحظات",

  // `.pt-timeline`
  timelineLabel: "سجل المريض",
  dayToday: "النهارده",
  planStartSuffix: "بداية خطة الرعاية",
  showOlder: "اعرض أقدم",
  months: ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"],

  // `.pt-event.visit`
  visitIcon: "ز",
  visitTitle: "زيارة",
  sessionPrefix: "جلسة",
  sessionOf: "من",
  doctorPrefix: "د.",
  complaintPrefix: "شكوى:",
  prescribedPrefix: "وصف",

  // `.pt-event.rx`
  rxIcon: "Rx",
  rxTitle: "وصفة طبية",
  rxPrinted: "اتطبعت",
  rxNotPrinted: "لسه ما اتطبعتش",

  // `.pt-event.msg`
  msgIcon: "✉",
  channelWhatsApp: "واتساب",
  channelSms: "SMS",
  msgOpened: "اتفتحت",
  msgSent: "اتبعتت",

  // `.pt-event.pay`
  payIcon: "₤",
  payTitle: "دفعة",
  invoicePrefix: "فاتورة",
  currencyUnit: "ج.م",

  // note
  noteIcon: "✎",
  noteTitle: "ملاحظة الطبيب",

  // Entry points elsewhere.
  openProfile: "افتح الملف",
  historyQuick: "التاريخ المرضي",
  invoicesQuick: "الفواتير",
  menuLabel: "ملف المريض",
} as const;

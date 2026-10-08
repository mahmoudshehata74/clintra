// Arabic strings for the doctor's day (reference screen 9, "شاشة الطبيب —
// قائمة اليوم"). Units shared with the day screen ("د", "س") stay in
// screens/day/strings.ts and are read from there.
export const doctorDayStrings = {
  appBarTitle: "شاشة الطبيب",
  loadingLabel: "جارٍ التحميل...",

  // `.momentum`
  momentumLatePrefix: "متأخر",
  momentumLateSuffix: "دقيقة عن الخطة",
  momentumOnTime: "ماشي في الميعاد",
  momentumMedianLabel: "متوسط الكشف اليوم",
  momentumPlannedLabel: "المخطط",
  momentumFinishesLate: "لو مشيت بنفس السرعة، هتخلص متأخر",
  momentumEtaLabel: "الخلاص المتوقع",

  // `.doc-hero`
  heroLabel: "في الكشف الآن",
  heroEnteredPrefix: "دخل من",
  heroOpenVisitForm: "افتح ملف الزيارة",
  heroCloseVisit: "قفل الزيارة",
  heroEmpty: "مفيش مريض في الكشف دلوقتي",
  ageUnit: "سنة",

  // `.last-visit` / `.brief-hist`
  lastVisitHeading: "آخر زيارة",
  lastVisitComplaint: "شكوى:",
  lastVisitDiagnosisHero: "التشخيص:",
  lastVisitDiagnosisBrief: "تشخيص:",

  // `.quick-note`
  quickNoteLabel: "ملاحظة سريعة",
  quickNotePlaceholder: "ملاحظة على الزيارة دي…",
  quickNoteSave: "حفظ",
  quickNoteSaved: "اتحفظ",

  // `.brief` — next patient
  briefNextHeading: "التالي في الكشف",
  briefTagArrived: "مستني في الاستقبال",
  briefTagNotArrived: "لسه ما وصلش",
  briefExpectedPrefix: "متوقع",
  briefArrivedPrefix: "وصل من",
  briefQueueNumberPrefix: "نمرة",
  briefTotalVisitsSuffix: "إجمالي عندك",
  briefLastInvoicePrefix: "آخر فاتورة",
  briefNoNext: "مفيش حد تاني النهارده",
  callIn: "استدعِ للكشف",
  callInShort: "استدعِ",
  callInBlockedReason: "فيه مريض في الكشف",

  // Invoice state of the next patient's last invoice (owner's wording).
  invoicePaid: "مدفوعة كاملة",
  invoicePartial: "مدفوعة جزئيًا",
  invoiceUnpaid: "مش مدفوعة",

  // `.brief` — waiting room
  waitingHeading: "صالة الانتظار",
  waitingLongestPrefix: "أطول انتظار",
  waitingWordNeutral: "مستني",
  waitingWordFemale: "مستنية",
  waitingInRoomSuffix: "في الصالة",
  waitingAboveThreshold: "فوق حد التنبيه",
  waitingEmpty: "مفيش حد مستني",

  // `.attn`
  attentionHeading: "يحتاج انتباه قبل نهاية اليوم",
  attentionMissingDiagnosisTitle: "التشخيص فاضي",
  attentionMissingDiagnosisDetail: "مالهاش تشخيص مسجّل",
  attentionVisitPrefix: "زيارة",
  attentionInvoicePrefix: "فاتورة",
  attentionClosedAtPrefix: "اتقفلت الساعة",
  attentionUnpaidDetail: "ما اتحصّلش المبلغ",
  attentionPartialDetail: "اتحصّل جزء من المبلغ",
  attentionCompleteNow: "أكمل الآن",

  // `.c-card` + `.doc-list`
  dayListBadge: "التسلسل",
  dayListTitle: "كل اليوم",
  dayListSubtitle: "اللي عدى واللي جاي",
  dayListEmpty: "مفيش زيارات النهارده",
  dayListFinishedAt: "خلصت",
  dayListInRoomPrefix: "في الكشف من",
  dayListPreviousVisit: "الزيارة السابقة",
  dayListWaitingFor: "من",
  dayListMissingDiagnosis: "تشخيص فاضي",
  dayListReview: "راجع",
  dayListOpen: "افتح",

  // Relative time (formatRelativeVisitTime).
  relativeToday: "النهارده",
  relativeAgo: "قبل",
  relativeSince: "من",
  dayOne: "يوم",
  dayTwo: "يومين",
  dayFew: "أيام",
  dayMany: "يوم",
  weekTwo: "أسبوعين",
  weekFew: "أسابيع",
  monthTwo: "شهرين",
  monthFew: "شهور",
  monthMany: "شهر",

  // Counted nouns (formatCount).
  priorVisitOne: "زيارة سابقة",
  priorVisitTwo: "زيارتين سابقتين",
  priorVisitFew: "زيارات سابقة",
  priorVisitMany: "زيارة سابقة",
  visitOne: "زيارة",
  visitTwo: "زيارتين",
  visitFew: "زيارات",
  visitMany: "زيارة",
  patientOne: "مريض",
  patientTwo: "مريضين",
  patientFew: "مرضى",
  patientMany: "مريض",
} as const;

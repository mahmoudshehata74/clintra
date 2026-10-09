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
  heroEnteredNow: "دخل دلوقتي",
  heroOpenVisitForm: "افتح ملف الزيارة",
  heroCloseVisit: "قفل الزيارة",
  heroEmpty: "مفيش مريض في الكشف دلوقتي",
  ageUnit: "سنة",

  // `.last-visit` / `.brief-hist`
  lastVisitHeading: "آخر زيارة",
  lastVisitComplaint: "شكوى:",
  lastVisitDiagnosisHero: "التشخيص:",
  lastVisitDiagnosisBrief: "تشخيص:",
  lastVisitNothingRecorded: "ما اتسجّلش شكوى ولا تشخيص",

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
  briefArrivedNow: "وصل دلوقتي",
  briefQueueNumberPrefix: "نمرة",
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
  dayListInRoomNow: "في الكشف دلوقتي",
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

  // Counted phrases (domain/arabicText.ts's arabicCount): one and two are
  // whole phrases without a numeral; few (3–10) and many (11+) follow one.
  priorVisitOne: "زيارة سابقة",
  priorVisitTwo: "زيارتين سابقتين",
  priorVisitFew: "زيارات سابقة",
  priorVisitMany: "زيارة سابقة",
  totalVisitsOne: "زيارة واحدة إجمالي عندك",
  totalVisitsTwo: "زيارتين إجمالي عندك",
  totalVisitsFew: "زيارات إجمالي عندك",
  totalVisitsMany: "زيارة إجمالي عندك",
  waitingCountOne: "مريض واحد في الصالة",
  waitingCountTwo: "مريضين في الصالة",
  waitingCountFew: "مرضى في الصالة",
  waitingCountMany: "مريض في الصالة",
} as const;

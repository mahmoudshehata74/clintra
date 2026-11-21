// Arabic strings for the visit workspace (reference screen 10, "الزيارة —
// النموذج المتكامل") and the "الزيارة الحالية" page that hosts it. The two
// field labels, their placeholders and "اتحفظ" stay in screens/day/strings.ts,
// where the visit form has always read them.
export const visitWorkspaceStrings = {
  loadingLabel: "جارٍ التحميل...",
  // VisitFormSheet's own title; the patient is named in `.pt-summary`.
  visitSheetTitle: "ملف الزيارة",

  // `.pt-summary`
  ageUnit: "سنة",
  lastVisitPrefix: "آخر زيارة",
  visitsOne: "زيارة واحدة",
  visitsTwo: "زيارتين",
  visitsFew: "زيارات",
  visitsMany: "زيارة",

  // `.visit-history` — "آخر زيارة" / "آخر زيارتين" / "آخر 3 زيارات".
  historyOne: "آخر زيارة",
  historyTwo: "آخر زيارتين",
  historyPrefix: "آخر",
  historyFew: "زيارات",
  historyMany: "زيارة",
  historyNoDiagnosis: "من غير تشخيص",

  // `.rx-section`
  rxHeading: "الوصفة الطبية",
  // `.rx-item .dose`: "· لمدة" before the (bold) duration.
  rxDurationPrefix: "لمدة",
  rxCountOne: "دواء واحد",
  rxCountTwo: "دوائين",
  rxCountFew: "أدوية",
  rxCountMany: "دواء",
  rxRemove: "حذف",
  rxAdd: "＋ أضف دواء",
  rxAddConfirm: "إضافة",
  rxEditConfirm: "حفظ",
  rxCancel: "إلغاء",
  rxNameLabel: "اسم الدواء",
  rxNamePlaceholder: "Diclofenac 50mg",
  rxFormLabel: "الشكل",
  rxFormPlaceholder: "قرص",
  rxInstructionsLabel: "طريقة الاستخدام",
  rxInstructionsPlaceholder: "قرص مرتين يوميًا بعد الأكل",
  rxDurationLabel: "المدة",
  rxDurationPlaceholder: "7 أيام",
  rxNoteLabel: "ملاحظة",
  rxNotePlaceholder: "مثال: يوقف لو حصل ألم في المعدة",
  rxPrintedLine: "الوصفة اتطبعت ومش ممكن تتعدّل",
  rxNotPrescribableLine: "الوصفة بتتكتب لما المريض يدخل الكشف",

  // db/prescriptions.ts's refusals, as the doctor reads them.
  rxErrorNameRequired: "اكتب اسم الدواء",
  rxErrorInstructionsRequired: "اكتب طريقة الاستخدام",
  rxErrorNotPrescriber: "الوصفة بيكتبها طبيب الزيارة بس",
  rxErrorFailed: "ما اتحفظش، جرّب تاني",

  // `.runrow`
  closeVisit: "قفل الزيارة",
  saveAndContinueLater: "حفظ ومتابعة لاحقًا",
  sessionLengthLabel: "مدة الجلسة:",
  minuteOne: "دقيقة واحدة",
  minuteTwo: "دقيقتين",
  minuteFew: "دقائق",
  minuteMany: "دقيقة",
  minuteUnderOne: "أقل من دقيقة",

  // The "الزيارة الحالية" page.
  currentVisitTitle: "الزيارة الحالية",
  currentVisitEmpty: "مفيش زيارة مفتوحة دلوقتي",
  currentVisitOpenDoctorDay: "افتح شاشة الطبيب",
} as const;

// Corrections after completion (docs/design-clinical-corrections.md): the
// workspace's "تعديل" form, the "تم التعديل" chip and "سجل التعديلات".
export const visitCorrectionStrings = {
  correctAction: "تعديل",
  correctedChip: "تم التعديل",
  historyAction: "سجل التعديلات",
  formTitle: "تعديل نموذج الزيارة",
  reasonLabel: "سبب التعديل",
  reasonPlaceholder: "ليه بتعدّل نموذج الزيارة بعد ما اتقفلت؟",
  save: "حفظ التعديل",
  cancel: "إلغاء",

  // The writer's refusals (db/visitCorrections.ts), as the doctor reads them.
  errorNotAllowed: "تعديل الزيارة بعد ما تتقفل لطبيب الزيارة أو صاحب العيادة بس",
  errorReasonRequired: "اكتب سبب التعديل (3 حروف على الأقل)",
  errorReasonTooLong: "السبب طويل، خليه 500 حرف أو أقل",
  errorUnchanged: "مفيش تغيير عن النسخة الحالية",
  errorFailed: "التعديل ما اتحفظش، جرّب تاني",

  // "سجل التعديلات": newest first.
  historyTitle: "سجل التعديلات",
  historyEmpty: "مفيش تعديلات",
  // "عدّلها {name}".
  correctedByPrefix: "عدّلها",
  unknownStaff: "غير معروف",
  // "السبب: {reason}".
  reasonPrefix: "السبب:",
  // Each field that changed, with its text "قبل" and "بعد".
  fieldComplaint: "الشكوى",
  fieldDiagnosis: "التشخيص",
  before: "قبل",
  after: "بعد",
  emptyValue: "—",
} as const;

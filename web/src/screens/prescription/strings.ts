// Arabic strings for the printed prescription (reference screen 16,
// "الوصفة — للطباعة") and the workspace button that opens it.
export const prescriptionPrintStrings = {
  // The `.rx-section` button that opens the preview.
  printButton: "اطبع الوصفة",
  reprintButton: "اطبع تاني",

  sheetTitle: "الوصفة",
  loadingLabel: "جارٍ التحميل...",

  // `.rx-print-header` — the preview only, never on paper.
  previewNote: "دي معاينة للطباعة · اضغط «طباعة / حفظ PDF»",

  // `.rx-doc`
  doctorPrefix: "د.",
  // `.doc-spec`'s first line: "{title} · رقم النقابة {n}".
  syndicatePrefix: "رقم النقابة",

  // `.rx-pt`
  patientLabel: "المريض:",
  ageLabel: "العمر:",
  ageUnit: "سنة",
  diagnosisLabel: "التشخيص:",

  // `.rx-sig`
  signature: "التوقيع",
  stamp: "الختم الرسمي",

  // `.split` — one action: the browser's print dialog both prints and saves a PDF.
  printAction: "طباعة / حفظ PDF",
  confirmQuestion: "بعد الطباعة الوصفة مش هتتعدّل. نطبع؟",
  confirmPrint: "اطبع",
  confirmBack: "رجوع",

  // Refusals, as the reader sees them.
  errorNotPrescriber: "أول طباعة للوصفة بيعملها دكتور الزيارة بس",
  errorEmpty: "الوصفة فاضية، أضف دواء الأول",
  errorFailed: "الوصفة ما اتطبعتش، جرّب تاني",
} as const;

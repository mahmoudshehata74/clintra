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
  // `.doc-spec`: before the clinic's phone ("هاتف: 0100 000 0000").
  clinicPhonePrefix: "هاتف:",
  // `.doc-spec`'s first line: "{title} · رقم النقابة {n}".
  syndicatePrefix: "رقم النقابة",
  // Under the clinic line: "مواعيد العيادة: السبت – الأربعاء 17:00–21:00 · الخميس 10:00–14:00".
  hoursLabel: "مواعيد العيادة:",
  hoursSeparator: " · ",
  // Between a split day's ranges.
  hoursRangeJoiner: "و",

  // `.rx-pt`
  patientLabel: "المريض:",
  ageLabel: "العمر:",
  ageUnit: "سنة",
  diagnosisLabel: "التشخيص:",

  // Under the last drug, a blank line to write the next visit on.
  followUpLabel: "ميعاد الإعادة:",

  // `.rx-sig`
  signature: "التوقيع",
  stamp: "الختم الرسمي",

  // The small centred footer at the foot of the last page.
  footer: "لا تغيّر الجرعة أو توقف الدواء منغير استشارة الطبيب · يُحفظ الدواء بعيدًا عن متناول الأطفال",

  // The one-line header of every printed page after the first:
  // "تابع روشتة {patient} · {RX number} · صفحة {n} من {m}".
  continuationPrefix: "تابع وصفة",
  continuationPage: "صفحة",
  continuationOf: "من",

  // The print sheet's switch, before the first print: on by default; off prints no diagnosis.
  diagnosisSwitchLabel: "اطبع التشخيص",

  // `.split` — one action: the browser's print dialog both prints and saves a PDF.
  printAction: "طباعة / حفظ PDF",
  confirmQuestion: "بعد الطباعة الوصفة مش هتتعدّل. نطبع؟",
  confirmPrint: "اطبع",
  confirmBack: "رجوع",

  // Refusals, as the reader sees them.
  errorNotPrescriber: "أول طباعة للوصفة بيعملها طبيب الزيارة بس",
  errorEmpty: "الوصفة فاضية، أضف دواء الأول",
  errorFailed: "الوصفة ما اتطبعتش، جرّب تاني",
} as const;

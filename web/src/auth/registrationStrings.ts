// Arabic UI strings for screen 1 (docs/reference/clintra-screens.html) —
// device activation, install day only. Mirrors authStrings.ts's own
// one-module convention.
export const registrationStrings = {
  title: "تفعيل جهاز العيادة",
  phoneLabel: "رقم الموبايل",
  phonePlaceholder: "٠١٠٠xxxxxxx",
  codeLabel: "كود التفعيل",
  codePlaceholder: "CLT-XXXX-XXXX-XXXX-XXXX",
  submitLabel: "تفعيل الجهاز",
  submittingLabel: "جاري التفعيل…",
  invalidPhone: "رقم الموبايل غير صالح",
  invalidCode: "من فضلك أدخل كود التفعيل كامل",
  successTitle: "تم تفعيل الجهاز",
  // e.g. "هذا الجهاز سيخدم: عيادة المعادي" — shown only when the
  // organization has more than one location, so it isn't obvious which one.
  servingLocationPrefix: "هذا الجهاز سيخدم:",
  continueLabel: "متابعة",
  formAria: "تفعيل جهاز العيادة",
} as const;

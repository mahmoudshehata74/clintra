// Arabic UI strings for device activation (prototype #s15), install day
// only. Mirrors authStrings.ts's own one-module convention.
export const registrationStrings = {
  // `.install-hero .t` / `.s`.
  brandName: "Clintra",
  title: "تفعيل جهاز العيادة",
  phoneLabel: "رقم الموبايل",
  phonePlaceholder: "0100xxxxxxx",
  codeLabel: "كود التفعيل",
  codePlaceholder: "CLT-XXXX-XXXX-XXXX-XXXX",
  // `.field .hint` under the code.
  codeHint: "من رسالة التفعيل اللي وصلتك",
  submitLabel: "تفعيل الجهاز",
  submittingLabel: "جاري التفعيل…",
  // The same text db/registration.ts's local phone check returns; see activationForm.ts.
  invalidPhone: "رقم الموبايل غير صالح",
  invalidCode: "من فضلك أدخل كود التفعيل كامل",
  // The post-activation confirmation (settled deviation): "اتربط الجهاز بعيادة {organization name}".
  confirmationPrefix: "اتربط الجهاز بعيادة",
  // e.g. "هذا الجهاز سيخدم: عيادة المعادي" — shown only when the
  // organization has more than one location, so it isn't obvious which one.
  servingLocationPrefix: "هذا الجهاز سيخدم:",
  startLabel: "ابدأ",
  formAria: "تفعيل جهاز العيادة",
} as const;

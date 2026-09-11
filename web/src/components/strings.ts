// Arabic strings for app-wide chrome that lives outside any single screen.
export const installBannerStrings = {
  message: "ثبّت التطبيق على الشاشة عشان يشتغل بسرعة حتى من غير نت",
  installAction: "تثبيت",
  dismissAction: "مش دلوقتي",
  dismissAriaLabel: "إخفاء دعوة التثبيت",
} as const;

// The persistent sidebar (AppShell.tsx) — reference clintra-screens.html's
// .fn nav list, in its fixed six-item order. Only navDay and navSettings
// currently open a real screen; the rest render disabled with
// comingSoonHint rather than being hidden (see AppShell.tsx's own doc
// comment for why).
export const sidebarStrings = {
  navAriaLabel: "التنقل الرئيسي",
  navDay: "اليوم",
  navPatients: "المرضى",
  navQueue: "الطابور",
  navInvoices: "الفواتير",
  navReports: "التقارير",
  navSettings: "الإعدادات",
  comingSoonHint: "جاي قريب",
} as const;

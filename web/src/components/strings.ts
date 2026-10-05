// Arabic strings for app-wide chrome that lives outside any single screen.
export const installBannerStrings = {
  message: "ثبّت التطبيق على الشاشة عشان يشتغل بسرعة حتى من غير نت",
  installAction: "تثبيت",
  dismissAction: "مش دلوقتي",
  dismissAriaLabel: "إخفاء دعوة التثبيت",
} as const;

// The persistent rail (AppShell.tsx). Which items a role sees is
// domain/navigation.ts's navItemsFor; this module only holds their copy.
export const sidebarStrings = {
  navAriaLabel: "التنقل الرئيسي",
  navDay: "اليوم",
  navSettings: "الإعدادات",
} as const;

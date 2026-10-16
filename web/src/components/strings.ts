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
  navPatients: "المرضى",
  navDoctor: "شاشة الطبيب",
  navVisit: "الزيارة الحالية",
  navMessages: "الرسائل",
  navAudit: "السجل",
  navSettings: "الإعدادات",
} as const;

// TimeField's two selects (components/ui/TimeField.tsx), each named for
// screen readers inside the field's own labelled group.
export const timeFieldStrings = {
  hourLabel: "الساعة",
  minuteLabel: "الدقيقة",
} as const;

// The app bar AppShell.tsx renders above every screen (prototype's
// `.appbar`). The screen itself only ever supplies the title text.
export const appBarStrings = {
  brandName: "Clintra",
} as const;

// The one line a control shows when its write fails — refused, or a storage
// error (components/ui/SaveFailedLine.tsx).
export const saveFailedStrings = {
  line: "ماتحفظش، جرّب تاني",
} as const;

import type { ButtonVariant } from "../components/ui/Button";

// Arabic strings for the component gallery (?gallery=1) — a dev-only
// surface, not part of the clinical app, so its copy lives on its own
// rather than inside any screen's strings module.
export const galleryStrings = {
  pageTitle: "مكونات Clintra",
  buttonsSectionTitle: "الأزرار",
  clickCounterLabel: "عدد الضغطات",
} as const;

export interface ButtonVariantDemo {
  variant: ButtonVariant;
  heading: string;
  label: string;
}

// Labels are the prototype's own button text (docs/reference/clintra-prototype.html),
// per variant: .run, .pill, .pill.danger, .set-row .edit, .slot.empty .quick,
// .sb, .sb.copper (the .who nested span's text folded into one plain string).
// Exported (not inlined in ButtonsSection.tsx) so gallery.spec.ts asserts
// against these same labels rather than a second, hand-copied list.
export const LIGHT_SURFACE_BUTTON_DEMOS: readonly ButtonVariantDemo[] = [
  { variant: "primary", heading: "أساسي", label: "احجز مريض جديد" },
  { variant: "secondary", heading: "ثانوي", label: "مريض جه دلوقتي" },
  { variant: "danger", heading: "خطر", label: "إلغاء الفاتورة" },
  { variant: "outline", heading: "مخطط", label: "تعديل" },
  { variant: "dashed", heading: "متقطع", label: "＋ احجز هنا" },
];

export const DARK_SURFACE_BUTTON_DEMOS: readonly ButtonVariantDemo[] = [
  { variant: "onDark", heading: "على خلفية داكنة", label: "تسجيل تأخير الطبيب" },
  { variant: "onDarkCopper", heading: "على خلفية داكنة · نحاسي", label: "التالي: كريم فتحي · 09:30" },
];

import type { MdOnlyVariant, SmCapableVariant } from "../components/ui/Button";

// Arabic strings for the component gallery (?gallery=1) — a dev-only
// surface, not part of the clinical app, so its copy lives on its own
// rather than inside any screen's strings module.
export const galleryStrings = {
  pageTitle: "مكونات Clintra",
  buttonsSectionTitle: "الأزرار",
  clickCounterLabel: "عدد الضغطات",
} as const;

export interface SmCapableButtonDemo {
  variant: SmCapableVariant;
  heading: string;
  label: string;
}

export interface MdOnlyButtonDemo {
  variant: MdOnlyVariant;
  heading: string;
  label: string;
}

// Labels are the prototype's own button text (docs/reference/clintra-prototype.html),
// per variant: .run, .pill, .pill.danger, .sb, .sb.copper (the .who nested
// span's text folded into one plain string), .set-row .edit,
// .slot.empty .quick. Exported (not inlined in ButtonsSection.tsx) so
// gallery.spec.ts asserts against these same labels rather than a second,
// hand-copied list.
//
// Split in two per surface, matching Button.tsx's own split: only
// primary/secondary/danger and onDark have a reference-defined compact
// (sm) form; onDarkCopper/outline/dashed render md only.
export const LIGHT_SURFACE_SM_BUTTON_DEMOS: readonly SmCapableButtonDemo[] = [
  { variant: "primary", heading: "أساسي", label: "احجز مريض جديد" },
  { variant: "secondary", heading: "ثانوي", label: "مريض جه دلوقتي" },
  { variant: "danger", heading: "خطر", label: "إلغاء الفاتورة" },
];

export const LIGHT_SURFACE_MD_ONLY_BUTTON_DEMOS: readonly MdOnlyButtonDemo[] = [
  { variant: "outline", heading: "مخطط", label: "تعديل" },
  { variant: "dashed", heading: "متقطع", label: "＋ احجز هنا" },
];

export const DARK_SURFACE_SM_BUTTON_DEMOS: readonly SmCapableButtonDemo[] = [
  { variant: "onDark", heading: "على خلفية داكنة", label: "تسجيل تأخير الطبيب" },
];

export const DARK_SURFACE_MD_ONLY_BUTTON_DEMOS: readonly MdOnlyButtonDemo[] = [
  { variant: "onDarkCopper", heading: "على خلفية داكنة · نحاسي", label: "التالي: كريم فتحي · 09:30" },
];

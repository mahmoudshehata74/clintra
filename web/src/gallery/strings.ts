import type { MdOnlyVariant, SmCapableVariant } from "../components/ui/Button";

// Arabic strings for the component gallery (?gallery=1) — a dev-only
// surface, not part of the clinical app, so its copy lives on its own
// rather than inside any screen's strings module.
export const galleryStrings = {
  pageTitle: "مكونات Clintra",
  buttonsSectionTitle: "الأزرار",
  clickCounterLabel: "عدد الضغطات",
  fieldsSectionTitle: "الحقول",
  cardsSectionTitle: "البطاقات",
  badgesSectionTitle: "الشارات",
  toggleChipsSectionTitle: "شارات الاختيار",
  sheetPanelSectionTitle: "لوحة الشيت",
  switchSectionTitle: "المفاتيح",
} as const;

// The Switch section's demo labels (.set-row .toggle / .toggle.off — screens
// 13 and 14's active/inactive control).
export const switchGalleryStrings = {
  liveOnLabel: "خدمة كشف عام",
  liveOffLabel: "خدمة تدليك علاجي",
  disabledOnLabel: "المالك (مقفول وشغّال)",
  disabledOffLabel: "مقفول وموقوف",
  stateOn: "شغّالة",
  stateOff: "موقوفة",
} as const;

// Screen 4's booking sheet, composed from the pieces above — the search
// field reuses fieldGalleryStrings.searchLabel/searchFilledValue and the
// services toggle reuses toggleChipGalleryStrings.servicesOptions, since
// both are the exact same prototype fields shown there a second time.
export const sheetPanelGalleryStrings = {
  title: "حجز · 11:30 · د. أحمد المصري",
  closeLabel: "إغلاق",
  primaryAction: "تأكيد الحجز",
  secondaryAction: "من غير رقم",
} as const;

// Each group's own options, from docs/reference/clintra-prototype.html:
// .svc-row (screen 4's service picker), .filts (screen 13's audit
// filters), .set-tabs (screen 11-13's settings tabs), .pt-tabs (screen
// 18's patient tabs, with their own .b counters), .msg-ch-toggle (screen
// 17's channel switch).
export const toggleChipGalleryStrings = {
  servicesHeading: "الخدمات (svc-row)",
  servicesOptions: ["كشف عام · 400ج", "استشارة متابعة · 250ج", "فحص شامل · 600ج"] as const,
  filtersHeading: "فلاتر السجل (filt)",
  filtersOptions: ["الكل", "زيارات", "فواتير", "إعدادات"] as const,
  tabsHeading: "تبويبات الإعدادات (set-tab)",
  tabsOptions: ["مواعيد العمل", "الخدمات", "الموظفون"] as const,
  patientTabsHeading: "تبويبات ملف المريض (pt-tab)",
  patientTabsOptions: [
    { label: "الكل", counter: 28 },
    { label: "زيارات", counter: 5 },
    { label: "وصفات", counter: 4 },
    { label: "رسائل", counter: 7 },
    { label: "مدفوعات", counter: 8 },
    { label: "ملاحظات", counter: 4 },
  ] as const,
  channelHeading: "قناة الإرسال (msg-ch-toggle)",
  channelOptions: ["واتساب", "SMS"] as const,
} as const;

// Each row's label and source class, from docs/reference/clintra-prototype.html:
// .c-head .badge, .brief-h .tag, .tag.warn, .inv-status, .rx-head .c,
// .set-row .mode, .msg-tpl .badge (+ .auto renamed per the settled
// deviation, + .manual), .slot .state on .arrived/.in-room/.done/
// .no-show/.cancelled.
export const badgeGalleryStrings = {
  onDarkHeading: "على خلفية داكنة · اليوم",
  onDarkLabel: "اليوم",
  waitingHeading: "مستني في الاستقبال",
  longestWaitHeading: "أطول انتظار",
  longestWaitLabel: "أطول انتظار 34د",
  invoicePartialHeading: "فاتورة مدفوعة جزئيًا",
  invoicePartialLabel: "مدفوعة جزئيًا",
  prescriptionCountHeading: "عدد الأدوية",
  prescriptionCountLabel: "3 أدوية",
  slotModeHeading: "مدة الموعد",
  slotModeLabel: "مواعيد 30د",
  suggestedTemplateHeading: "قالب مقترح",
  suggestedTemplateLabel: "مقترح",
  optionalTemplateHeading: "قالب اختياري",
  optionalTemplateLabel: "اختياري",
  manualTemplateHeading: "قالب يدوي",
  manualTemplateLabel: "يدوي",
  statusArrivedHeading: "وصل",
  statusArrivedLabel: "وصلت",
  statusInRoomHeading: "في الكشف",
  statusInRoomLabel: "في الكشف",
  statusDoneHeading: "اكتمل",
  statusDoneLabel: "اكتمل",
  statusNoShowHeading: "لم يحضر",
  statusNoShowLabel: "لم يحضر",
  statusCancelledHeading: "ملغي",
  statusCancelledLabel: "ملغي",
} as const;

// One label per BadgeSection row, in its render order — gallery.spec.ts
// iterates this instead of hand-copying the list a second time.
export const ALL_BADGE_DEMO_LABELS: readonly string[] = [
  badgeGalleryStrings.waitingHeading,
  badgeGalleryStrings.longestWaitLabel,
  badgeGalleryStrings.invoicePartialLabel,
  badgeGalleryStrings.prescriptionCountLabel,
  badgeGalleryStrings.slotModeLabel,
  badgeGalleryStrings.suggestedTemplateLabel,
  badgeGalleryStrings.optionalTemplateLabel,
  badgeGalleryStrings.manualTemplateLabel,
  badgeGalleryStrings.statusArrivedLabel,
  badgeGalleryStrings.statusInRoomLabel,
  badgeGalleryStrings.statusDoneLabel,
  badgeGalleryStrings.statusNoShowLabel,
  badgeGalleryStrings.statusCancelledLabel,
  badgeGalleryStrings.onDarkLabel,
];

// Screen 3's "مواعيد اليوم" card (docs/reference/clintra-prototype.html,
// `.c-card`/`.c-head`/`.runrow` around that card) — head, footer and count
// text reproduced verbatim; the body is a placeholder, since the slot list
// itself belongs to the day screen, not this gallery.
export const cardGalleryStrings = {
  dayCardBadge: "اليوم",
  dayCardTitle: "مواعيد اليوم",
  dayCardSubtitle: "5 حجوزات · 3 فاضية · 30 دقيقة",
  dayCardTrailingAction: "ورقة الغد",
  dayCardPlaceholderBody: "قائمة المواعيد تظهر هنا",
  dayCardPrimaryAction: "احجز مريض جديد",
  dayCardSecondaryAction: "مريض جه دلوقتي",
  dayCardCountAppointments: "7",
  dayCardCountAppointmentsLabel: "ميعاد",
  dayCardCountBooked: "5",
  dayCardCountBookedLabel: "محجوز",
  dayCardCountFree: "2",
  dayCardCountFreeLabel: "فاضي",
  plainCardBody: "بطاقة بجسم فقط، بدون رأس أو تذييل",
} as const;

// Labels, values and hints are the prototype's own field text
// (docs/reference/clintra-prototype.html), per source: screen 4's search
// field (`.field` around `.in filled` value "كريم"), screen 6's amount and
// note fields, the visit form's chief-complaint textarea, and screen 15's
// activation-code field. The error demo's label and message are an
// addition — Field's doc comment explains why. See FieldSection.tsx for how
// each is composed.
export const fieldGalleryStrings = {
  searchLabel: "ابحث بالاسم أو التليفون",
  searchFilledValue: "كريم",
  emptyHeading: "فاضي",
  focusedHeading: "بالتركيز",
  // Focus isn't forced here (autoFocus would scroll the whole gallery page
  // to this field on load) — this caption just points at the real
  // `:focus` style already on the control, triggered by tabbing to it.
  focusedCaption: "انتقل إليه بمفتاح Tab لرؤية شكل التركيز الحقيقي",
  filledHeading: "معبّى",
  complaintLabel: "الشكوى الرئيسية",
  complaintValue: "ألم مستمر في الركبة اليمنى من 5 أيام، يزيد مع الحركة، لا يوجد تورم واضح.",
  complaintHint: "اتحفظ · قبل ثانيتين",
  complaintHeading: "متعدد الأسطر",
  phoneLabel: "رقم الموبايل",
  phoneValue: "0100",
  phoneError: "رقم الموبايل غير صحيح",
  errorHeading: "خطأ",
  noteLabel: "ملاحظة (اختيارية)",
  notePlaceholder: "مثلًا: باقي المبلغ الأسبوع الجاي",
  disabledHeading: "معطّل",
  codeLabel: "كود العيادة",
  codeValue: "CLT-4821",
  codeHeading: "كود مُفعّل",
  amountLabel: "المبلغ",
  amountValue: "200",
  amountHint: "اكتب رقم أقل عشان دفعة جزئية تانية",
  amountHeading: "مبلغ",
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
// per variant: .run, .pill, .pill.danger, .doc-item.done .go, .sb, .sb.copper (the .who nested
// span's text folded into one plain string), .set-row .edit,
// .slot.empty .quick. Exported (not inlined in ButtonsSection.tsx) so
// gallery.spec.ts asserts against these same labels rather than a second,
// hand-copied list.
//
// Split in two per surface, matching Button.tsx's own split: only
// primary/secondary/danger/muted and onDark have a reference-defined compact
// (sm) form; onDarkCopper/outline/dashed render md only.
export const LIGHT_SURFACE_SM_BUTTON_DEMOS: readonly SmCapableButtonDemo[] = [
  { variant: "primary", heading: "أساسي", label: "احجز مريض جديد" },
  { variant: "secondary", heading: "ثانوي", label: "مريض جه دلوقتي" },
  { variant: "danger", heading: "خطر", label: "إلغاء الفاتورة" },
  { variant: "muted", heading: "خافت", label: "راجع" },
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

// Arabic strings for the messages screen (reference screen 19, "مركز
// الرسائل") and the send sheet that opens WhatsApp or SMS.
export const messagesStrings = {
  appBarTitle: "الرسائل",
  loadingLabel: "جارٍ التحميل...",

  // `.msg-side`
  templatesHeading: "القوالب",

  // `.msg-preview`
  previewPrefix: "معاينة:",
  customBodyNote: "الرسالة دي بتتكتب وقت الإرسال",
  editAction: "تعديل",
  editorLabel: "نص القالب",
  insertLabel: "أضف للنص",
  saveAction: "حفظ التعديلات",
  cancelAction: "إلغاء",
  resetAction: "رجّع النص الأصلي",
  saved: "اتحفظ",
  errorNotOwner: "تعديل القوالب لصاحب العيادة بس",
  errorBodyRequired: "اكتب نص القالب",
  errorBodyTooLong: "النص أطول من 4000 حرف",
  errorSaveFailed: "ما اتحفظش، جرّب تاني",

  // `.msg-sent`
  recentHeading: "آخر الرسائل",
  recentEmpty: "لسه مفيش رسائل",
  statusOpened: "اتفتحت",
  statusSent: "اتبعتت",
  channelWhatsAppShort: "wa",
  channelSmsShort: "sms",

  // `.msg-preview .ch`
  chipEditable: "قابل للتعديل",
  chipOverridden: "معدّل",

  // The send sheet's warning: placeholders the text still holds unfilled.
  missingValuesPrefix: "فيه بيانات ناقصة:",

  // A printed prescription, as the custom template's text.
  rxMessageTitle: "الوصفة",
  rxMessagePatient: "المريض:",
} as const;

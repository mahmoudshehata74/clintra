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

  // The send sheet.
  sendSheetTitle: "ابعت رسالة",
  sendRecipientPrefix: "إلى:",
  sendTemplateLabel: "القالب",
  sendBodyLabel: "نص الرسالة",
  sendBodyHint: "التعديل هنا للرسالة دي بس",
  sendChannelLabel: "القناة",
  channelWhatsApp: "واتساب",
  channelSms: "SMS",
  openWhatsApp: "افتح واتساب",
  openSms: "افتح SMS",
  errorNoPhone: "المريض ده مالوش رقم موبايل صحيح، ضيفه الأول",
  errorBodyEmpty: "اكتب نص الرسالة",
  errorRecordMissing: "المريض أو الزيارة مش موجودين على الجهاز",
  errorSendFailed: "الرسالة ما اتسجلتش، جرّب تاني",

  // The printed prescription's own send buttons (screens/prescription/PrescriptionPrintSheet.tsx).
  rxSendWhatsApp: "واتساب",
  rxSendSms: "SMS",

  // The send sheet's warning: placeholders the text still holds unfilled.
  missingValuesPrefix: "فيه بيانات ناقصة:",

  // A printed prescription, as the custom template's text.
  rxMessageTitle: "الوصفة",
  rxMessagePatient: "المريض:",
} as const;

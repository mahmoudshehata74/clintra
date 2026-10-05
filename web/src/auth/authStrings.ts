// Arabic UI strings for the authentication layer (the lock screen). Kept in one
// module, mirroring screens/day/strings.ts, so all user-facing copy is reviewed
// in one place.
export const authStrings = {
  // Fresh launch, no session yet: pick who is about to work.
  lockClinicPrompt: "دخول العيادة",
  // Re-lock (idle/explicit) for a known person, combined with the shared
  // actor-label helper's "{full name} ({role label})" into
  // "دخول · سارة حسن (المساعد)".
  lockEnterPrefix: "دخول ·",
  // The prototype's own pin-title ("أدخلي الرقم السري") assumes a female
  // user (feminine imperative); this is the gender-neutral equivalent.
  lockPinTitle: "اكتب الرقم السري",
  // Shown briefly after a wrong PIN.
  lockWrongPin: "الرقم السري غلط",
  // Countdown after too many wrong attempts, e.g. "حاول تاني بعد 30 ثانية"
  // (Western digits per Decision B).
  lockLockedOutPrefix: "حاول تاني بعد",
  lockSecondsSuffix: "ثانية",
  // The dots' live-region progress text, e.g. "2 من 4 أرقام مدخلة".
  lockDigitsProgressOf: "من",
  lockDigitsProgressSuffix: "أرقام مدخلة",
  // Return from the PIN pad to the membership picker.
  lockSwitchUser: "تبديل المستخدم",
  // The pad's delete key: visible label and accessible name are distinct
  // (the prototype's own pad renders it as a text key, not an icon).
  lockDeleteLabel: "مسح",
  lockDeleteAria: "مسح رقم",
  // The explicit lock action in the day header.
  lockButtonLabel: "قفل الشاشة",
  // Accessible name for the whole overlay.
  lockOverlayAria: "قفل العيادة",
} as const;

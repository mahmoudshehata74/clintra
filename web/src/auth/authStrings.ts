// Arabic UI strings for the authentication layer (the lock screen). Kept in one
// module, mirroring screens/day/strings.ts, so all user-facing copy is reviewed
// in one place.
export const authStrings = {
  // Fresh launch, no session yet: pick who is about to work.
  lockClinicPrompt: "دخول العيادة",
  // Re-lock (idle/explicit) for a known person, e.g. "دخول سارة حسن".
  lockEnterPrefix: "دخول",
  // Shown briefly after a wrong PIN.
  lockWrongPin: "الرقم السري غلط",
  // Countdown after too many wrong attempts, e.g. "حاول تاني بعد 30 ثانية"
  // (Western digits per Decision B).
  lockLockedOutPrefix: "حاول تاني بعد",
  lockSecondsSuffix: "ثانية",
  // Return from the PIN pad to the membership picker.
  lockSwitchUser: "تبديل المستخدم",
  // The pad's delete key.
  lockDeleteAria: "مسح رقم",
  // The explicit lock action in the day header.
  lockButtonLabel: "قفل الشاشة",
  // Accessible name for the whole overlay.
  lockOverlayAria: "قفل العيادة",
} as const;

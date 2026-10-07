# Design source of truth

`docs/reference/clintra-prototype.html` is the authoritative visual
reference for v1 (19 screens). For any task that touches how a screen looks:

1. Before writing any UI code, open the exact screen in
   `clintra-prototype.html` (each screen is a `<section id="sN">`).
2. Read its HTML structure, its inline CSS classes, and the shared class
   definitions those classes reference, including the `:root` tokens.
3. Match the structure and the styling as-rendered, not as-described.
   A prose description in a prompt is a summary of the reference, not a
   replacement for it. If the prompt describes something differently from
   what the reference shows, the REFERENCE wins — stop and flag the
   contradiction before proceeding. The one exception is the list of
   settled deviations below: those override the reference.
4. Cite the exact reference class names in the commit message so the
   trace back to the reference stays intact.

This applies to redesigns, new screens, and any visual regression fix.
It does NOT apply to backend, data model, or logic tasks.

Do not commit reference file changes; the reference is read-only.

## Settled deviations from the reference

Owner decisions that override what the prototype shows. Implement these,
not the prototype, wherever they apply.

- **No AI anywhere in v1.** The visit form's assistant panel (`.visit-aside`,
  `.ai-h`, `.ai-hint`, `.ai-disclaimer`) and every hint that text was read
  by an assistant are not implemented — no panel, no preview badge, no
  disabled button, no demo-mode variant. Deferred to v1.5 by separate
  decision.
- **Latin digits everywhere** (Decision B). Any Arabic-Indic digit in the
  prototype is a design artefact, not a decision.
- **Fonts are self-hosted.** No Google Fonts link at runtime. IBM Plex Sans
  Arabic only, in several weights, for headings and body alike.
- **Staff PIN is never displayed, in whole or in part.** Screen 14's
  `.staff-pin` becomes a status badge: `مُعيّن ✓` or `غير مُعيّن`.
- **Device activation (screen 15)** uses the two credentials settled in
  `docs/auth-plan.md`: owner phone + a 16-character activation code. There
  is no SMS verification field. The "the device will be registered to
  <clinic>" line is not shown before activation; after a successful
  activation a short confirmation shows `اتربط الجهاز بعيادة {clinic_name}`
  with a `ابدأ` button.
- **Messages are sent by the user, never automatically.** Template badges
  that read `تلقائي` become `مقترح`; `يدوي` stays. WhatsApp opens
  `https://wa.me/{phone}?text={encoded}`, SMS opens
  `sms:{phone}?body={encoded}`. The log records an attempt, not delivery.
- **Removed from v1:** the patient file number (`#P-1042`) and the
  lab-referral attention item on the doctor screen.
- **Day close (screen 7):** the `تصدير Excel` button exports CSV, and the
  screen adds a list of past-due visits still `booked` that must be marked
  before the day can close.
- **Navigation** is a role-dependent sidebar, which the prototype does not
  show. Prescription (16) and care plan (17) are reached from the visit or
  the patient profile, not from the sidebar.
- **PIN pad order** is left-to-right (1 2 3), as on a phone keypad; the
  prototype's right-to-left order is a side effect of page direction.

`docs/reference/clintra-screens.html` is retired and kept only as history;
older documents that cite it describe the state of the project at the time
they were written.

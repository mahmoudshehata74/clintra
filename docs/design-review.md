# Design review of clintra-screens.html

Analysis only — no code or markup in `clintra-screens.html` was changed for
this review. Scope is v1: the 19 screens under Phase 1 (`PH[1]`, screens 1-19
in the reference's own numbering). Phases 2-5 (screens 20+) were read for
context but are not v1 and are excluded from citations below.

## 1. Design language summary

The reference uses one accent color (`--pine:#1D5B4A`) for every primary
action and "on track" state, and reserves red/amber/purple strictly for
semantic status (negative, needs-attention, and a narrow "override" case),
never for decoration. Typography splits cleanly into a display family
(Readex Pro, headings and big numbers) and a body family (IBM Plex Sans
Arabic, everything else), with weight held to 400/500/600 — nothing bolder.
Spacing is tight and componentized: list rows (`.lr`) and fields (`.fld`)
sit in the 8-12px range, with slightly more air (16-30px) only at the page
and frame level. Radius follows a rough two-tier rule — small controls at
5-8px, container surfaces at 12px, fully-round for dots/avatars — though
this isn't perfectly applied (see Weaknesses). A single tag component
(`.tg`, five color variants) is reused for every status label, filter, and
chip across the whole system rather than one-off inline styles. Empty
states are minimal by design: a dashed border and a bare glyph or short
phrase, never an illustration or a boxed empty-state block.

## 2. Strengths

1. **The empty-slot tile** (`screen 3`, `.sl.free`) — a dashed border and a
   centered "+" with no label. It reads instantly as "nothing here yet" in
   a dense 3-column grid without competing visually with the populated
   slots around it. Worth preserving as the empty-state pattern generally.

2. **The `.tg` tag system** (`screen 3` connection/delay chips, `screen 11`
   invoice status, `screen 13` no-show tags, `screen 16` price-override
   tag) — five color variants (`.tg.a` through `.tg.e`) cover every status
   label in the system. A developer never has to invent a new inline color
   for "this is a status" — they pick from five.

3. **Financial emphasis via row fill, not iconography** (`screen 11`
   `.kv.tot` / `.kv.dif`, `screen 13` same classes on the cash-close
   summary) — the one row that needs a decision (a remaining balance, a
   cash-close discrepancy) gets an amber fill; the total gets a plain gray
   fill. Both are legible in a dense list of otherwise unstyled rows
   without needing an icon or extra copy.

4. **The queue badge's three fill states** (`screen 4`, `.qn` /
   `.qn.on` / `.qn.ok`) — "not yet", "current", "already seen" are encoded
   purely through fill on one small square, no separate icon system. It
   keeps a numbered queue scannable at a glance.

5. **Print treatment deliberately sheds screen chrome** (`screen 14`,
   `.frame.print`) — no chips, no colored fills, just a plain table under
   a single pine-colored rule. It recognizes a printed day sheet is a
   different artifact from the interactive screen it's derived from,
   rather than reusing the on-screen component set as-is.

## 3. Weaknesses

1. **`--ash` secondary text is at the edge of WCAG AA contrast.**
   `--ash:#6E7370` on `--paper:#FBFAF7` measures roughly 4.6:1 — just over
   the 4.5:1 minimum for normal text, with no margin. Combined with
   `.muted{font-weight:300}`, which most engines render close to 400
   weight for Arabic script, the visual contrast reads lower than the
   number suggests. This is the single most-used secondary-text path in
   the system (`.muted`, `.lr .t2`, `.lr .rt`, `.sl .t`/`.s`) — it appears
   on nearly every screen (1, 3, 4, 5, 9, 13, 15, 18, 19 among others).

2. **The same concept — "this deviates from the default" — gets two
   different colors.** `screen 15`'s schedule exception ("٣ سبتمبر —
   مقفول — سفر") uses `.tg.b` (red, the negative/blocking color).
   `screen 16`'s per-doctor price override ("د. سارة ٤٥٠") uses `.tg.d`
   (purple, used nowhere else in v1). Both are "an exception to the
   standing rule," styled as if they were unrelated categories. Appears
   in exactly these two screens, but it's the only place either color
   maps to this idea, so there's no established rule to follow next time.

3. **"Add a new record" is styled as a passive tag in two screens and a
   real button in a third.** `screen 16`'s "+ خدمة" and `screen 17`'s
   "+ موظف" are both `.tg.e` chips — the same visual weight as a neutral
   filter label. `screen 8`'s "إضافة" (adding a walk-in patient) is a full
   `.bt.w` button. Same action type (create a record), two different
   affordances, with nothing to signal the chip is clickable at all.

4. **`.lr` has no hover or focus state.** It's the most-reused interactive
   primitive in the system — patient search results (`screen 5`), queue
   rows (`screen 4`), settings rows (`screen 15`), audit rows
   (`screen 19`) — and the shared stylesheet defines no `:hover` or
   `:focus-visible` treatment for it at all, only the JS-driven persistent
   states (`.lr.acc`, `.lr.done`). A mouse or keyboard user gets zero
   feedback that a row is clickable before they click it. This is a gap
   across every `.lr`-based screen, not a one-off.

5. **Small text sizing has no scale — six near-duplicate values.** `.xs`
   (11.5px), `.sm` (13px), `.tg` (11px), `.fs` (12.5px), `.lr .t2`
   (11.5px, duplicates `.xs`), and inline uses of 9.5px and 13.5px all
   coexist with no documented ratio between them. Nothing maps cleanly
   onto a 3- or 4-step type scale, so picking the "right" small-text class
   for new work means guessing among six options that differ by half a
   pixel. This spans nearly every screen that has secondary text.

6. **The PIN pad's radius doesn't match every other control's.**
   `screen 2`'s `.pin div` keys use `border-radius:8px`, while every other
   tappable control in the system — `.bt`, `.fld`, `.qn` — uses 6px. It's
   a single-screen inconsistency, but the PIN pad is the very first
   interactive surface most staff touch every shift.

## 4. Improvement proposals

Each proposal is scoped to one token or component and can ship as its own
commit, independent of the others.

1. **Darken `--ash` for safer contrast.**
   Before: `--ash:#6E7370` on `--paper:#FBFAF7` ≈ 4.6:1.
   After: a value around `#5B615E` (≈6:1+), applied to the single
   `--ash` token. No markup changes — every `.muted`/`.t2`/`.rt`/`.k` use
   inherits the fix automatically. Grounded in Weakness 1.

2. **Style "add a new record" as a button everywhere.**
   Before: `screen 16`/`17`'s "+ خدمة"/"+ موظف" render as `.tg.e` chips.
   After: both switch to `.bt.g` (the same small bordered-button style
   already used for secondary actions elsewhere), matching `screen 8`'s
   "إضافة" pattern. Scoped to two settings-table headers. Grounded in
   Weakness 3.

3. **Give "override/exception" one color, not two.**
   Before: `screen 15`'s closed-day exception uses `.tg.b` (red);
   `screen 16`'s price override uses `.tg.d` (purple).
   After: both use `.tg.d`, freeing red exclusively for genuinely negative
   or blocking states (cancellations, no-shows). A semantic remap, no new
   classes. Grounded in Weakness 2.

4. **Collapse the small-text sizes to a named 3-step scale.**
   Before: 9.5 / 11 / 11.5 / 12.5 / 13 / 13.5px in various places with no
   naming logic. After: three tokens (e.g. `--fs-xs:12px`,
   `--fs-sm:13.5px`, `--fs-base:15px`), with `.xs`, `.sm`, `.tg`, `.fs`,
   and `.lr .t2` each mapped to one. Touches several class definitions but
   no markup or behavior — mechanical, one commit. Grounded in Weakness 5.

5. **Match `.pin div`'s radius to every other control.**
   Before: `.pin div{border-radius:8px}`. After: `border-radius:6px`,
   matching `.bt`/`.fld`/`.qn`. One line, one screen, zero risk.
   Grounded in Weakness 6.

## 5. Out-of-scope items

1. **Numeral system.** The reference renders every number — times, counts,
   prices, the PIN pad itself — in Eastern Arabic-Indic digits (٠-٩), but
   the shipped app already made a settled call to render numbers in
   Western digits elsewhere. Reconciling that is a content/locale
   decision that touches far more than design tokens, not a visual fix —
   flagging it rather than treating it as a weakness, per the standing
   Western-digits decision.

2. **A full contrast audit of every color pair.** Proposal 1 fixes the one
   color everyone reads on every screen, but a systematic pass over every
   remaining pair (`--amb`/`--ambs`, `--red`/`--reds`, `--pm` on
   `--paper`, etc.) is a bigger initiative than a single token swap and
   deserves its own pass once the new token set exists.

3. **Responsive rework of data-dense layouts.** `.g3` (screen 3) and the
   settings tables (`screens 16`, `17`) have exactly one fallback
   breakpoint (`.g3` drops from 3 to 2 columns under 560px) and no real
   small-viewport rethink. Redesigning how a dense grid or table degrades
   on a phone is a structural layout project, not a token or component
   change, and is out of scope here.

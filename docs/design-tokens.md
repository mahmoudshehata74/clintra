# Clintra design tokens

Every token is declared once, in `web/src/index.css`'s `@theme` block, and
generates Tailwind utilities (`bg-*`, `text-*`, `border-*`, `rounded-*`,
`shadow-*`). Values come from the `:root` block of
`docs/reference/clintra-prototype.html`; the colour tokens are redefined for
dark in index.css's two dark blocks (see "Dark mode" below). No component
hardcodes a colour: no hex, `rgb()`, `white` or `black` outside index.css.

## Surfaces and text

Light values come from the prototype's `:root`; dark values from its two
dark blocks (`@media (prefers-color-scheme: dark)` on
`:root:not([data-theme="light"])`, and `:root[data-theme="dark"]`),
verbatim. A value marked *derived* is not the prototype's: a token its dark
blocks do not list, whose dark value is chosen here, or a text token added
for contrast (`docs/session-handoff.md`'s "Dark mode", decisions 6–12),
whose values are the owner's. No prototype value is changed.

| Token | Light | Dark | Use |
|---|---|---|---|
| `paper` | `#EFF3F1` | `#081311` | Page background. |
| `paper-2` | `#F7FAF8` | `#0B1815` | Content area inside the app frame; top of the page gradient. |
| `card` | `#FFFFFF` | `#0F1D1A` | Cards, sheets, rows. |
| `field` | `#F6F9F7` | `#132320` | Input fill, table header, footer strips. |
| `ink` / `ink-2` / `ink-3` | `#0B211D` / `#14332C` / `#1A3E35` | `#040E0C` / `#0F2722` / `#183930` | Dark surfaces: app bar, card heads, hero slab, lock screen. Never a text colour: in dark it is darker than the page. |
| `text` | `#0B211D` | `#E7EFEC` | Primary text (the body's colour). |
| `muted` | `#55665F` | `#9AADA7` | Secondary text, labels. |
| `faint` | `#8A9B95` | `#6C807A` | Placeholder text in an empty field and disabled controls only; non-text marks (separator dots, the cancelled row's stripe). Every other secondary text is `muted`. |
| `rule` | `#D9E0DD` | `#22332E` | Borders. |
| `hair` | `#E7ECEA` | `#192824` | Row separators. |
| `on-dark` / `on-dark-dim` | `#F2F7F5` / `#87A29A` | `#EAF3F0` / `#7A948D` | Text on `ink` surfaces. |
| `on-fill` | `#FFFFFF` | `#081311` *derived* | Text and icons on a saturated green, green-2, danger, warning, eligible or muted fill: primary buttons, solid badges and pills, numbered circles, the invoice head's status. The prototype's `#fff` in light; the dark `paper` in dark, where white reads under AA on every fill. |
| `on-copper` | `#081311` *derived* | `#081311` *derived* | Text and icons on a copper or copper-2 fill: the in-room pill, the queue's current number, avatars, the care-plan hero. |
| `on-ink` | `#FFFFFF` *derived* | `#FFFFFF` *derived* | Anything on the ink chrome (the lock card's brand, the activation card's title, the logo tiles' letter) and the marks that stay white: the settings toggle's knob, the care-plan hero's top highlight and progress fill. |
| `glass` | `#FFFFFF` | `#FFFFFF` *derived* | The translucent white of controls on ink and copper, always with an opacity (`.app-btn`, `.tb-nav`, `.pad button`: `rgba(255,255,255,.06–.25)` in the prototype, in both themes). |

## Brand and state

| Token | Light | Dark | Use |
|---|---|---|---|
| `green` / `green-2` | `#1D5B4A` / `#2E7A63` | `#2E9C7C` / `#37B894` | Identity: primary buttons, selected state, links. `green` is also the browser's `theme-color`, per active theme. |
| `green-wash` / `green-line` | `#E8F0EC` / `#BFDBD0` | `#102520` / `#26463D` | Green-toned fill and border. |
| `copper` / `copper-2` | `#A8742A` / `#C68A38` | `#C79247` / `#DBA35A` | Active moments: in the room, next, amount due, prescription — as fills, borders and icons. As text on a light surface, `copper-ink`; `copper-2` stays as text on the ink chrome (the lock card's "tra", the slab's copper figures). |
| `copper-ink` | `#8E6222` *derived* | `#C79247` *derived* | Copper as text: the in-room name and its time, soft and dashed copper badges, prices, labels, pressed copper tabs. |
| `copper-wash` / `copper-line` | `#F7EFE2` / `#E2CDA6` | `#241C0F` / `#4A3820` | Copper-toned fill and border. |
| `eligible` | `#186B4B` | `#47B187` | Done, arrived, paid, matched. |
| `warning` / `warning-wash` | `#96620B` / `#F7EEDA` | `#D7A13A` / `#2A2010` | Delay, partial payment, needs attention. |
| `danger` / `danger-wash` / `danger-line` | `#A32A21` / `#F7E3E0` / `#E4B9B4` | `#DE6055` / `#2E1614` / `#552420` | No-show, cancel, destructive actions, errors. |
| `green-on-ink` | `#37B894` *derived* | `#37B894` *derived* | Green text on the ink chrome: the slab's "arrived" count. |
| `copper-on-ink` | `#DBA35A` *derived* | `#DBA35A` *derived* | The on-dark copper button's text (`.sb.copper`). |
| `danger-on-ink` | `#F08C82` *derived* | `#F08C82` *derived* | Red text on the ink chrome: the slab's no-show count. |
| `print-note` / `print-note-line` / `print-note-ink` | `#FFF8E1` / `#D4A017` / `#856D00` | same *derived* | The printed pages' note (`.print-header`, `.rx-print-header`): fill, dashed border, text. The prototype's own literals, unchanged in its dark theme: the note sits on the white preview page. |
| `print-paper` / `print-ink` | `#FFFFFF` / `#000000` | same *derived* | The printed pages and their on-screen previews (`.print-page`, `.rx-print-page`, `.rx-drug .num`); greys are `print-ink` with an opacity. Paper stays white in dark, as the prototype's `#fff`/`#111` do. |
| `whatsapp` | `#25D366` | same *derived* | WhatsApp's own mark only: the messages screen's channel icon and toggle dot (`.msg-item .icn.wa`, `.msg-ch-toggle .wa`). A brand colour, the prototype's literal in both themes. |
| `brand-teal` / `brand-ink` | `#1A957D` / `#0E1814` | same *derived* | Logo surfaces only; no utility uses them today. |

## Radius, shadow and width

| Token | Value | Use |
|---|---|---|
| `rounded-chip` | 6px | Badges, small tags. |
| `rounded-control` | 9px | Buttons, inputs, toggles. |
| `rounded-card` | 12px | Inner cards, tiles, rows with a frame. |
| `rounded-panel` | 14px | Cards, sheets, hero slab. |
| `rounded-app` | 16px | The app frame. |
| `max-w-page` | 1116px | The shared content width of every rail page (`PageMain`): the prototype's `.app` frame. |
| `shadow-s` | `0 1px 2px` | Cards and tiles at rest. |
| `shadow-m` | two-layer | App frame, sticky bars. |
| `shadow-l` | deep, soft | Sheets, print previews, hero slab. |
| `shadow-logo` / `shadow-logo-lg` | `0 2px 8px` / `0 8px 20px`, black at .35 | The brand tile on ink (`.brand .logo`, `.install-hero .logo`); the same in both themes. |

Each of `shadow-s`, `-m` and `-l` takes its colour from a token, because
Tailwind writes a theme shadow's literal colour into the utility itself:

| Token | Light | Dark |
|---|---|---|
| `shadow-soft` | `rgba(11,33,29,.05)` | `rgba(0,0,0,.4)` |
| `shadow-mid` | `rgba(11,33,29,.30)` | `rgba(0,0,0,.8)` |
| `shadow-deep` | `rgba(11,33,29,.55)` | `rgba(0,0,0,.9)` |

These are the prototype's `--shadow-s/-m/-l` colours in each theme.

## Typography

IBM Plex Sans Arabic only, weights 300–700, for headings and body. All
numbers render as Latin digits with `font-variant-numeric: tabular-nums`
where they align in columns.

## Dark mode

On. With no `data-theme` on `<html>` ("auto") the system's preference
decides; `data-theme="light"` or `"dark"` is the device's explicit choice
(the app bar's appearance toggle, stored per device). Both dark selectors
set `color-scheme: dark`. Printing always uses the light column: an
`@media print` block restates it over both dark selectors.
`web/src/designTokens.test.ts` holds both columns to the prototype and
the derived text tokens to the owner's values.

## Contrast

WCAG 2 contrast of every text/background token pair the screens use, in
both themes. A gradient is listed at both ends; a tint or a translucent
glass as its composite over the surface beneath ("glass 25% over ink-2");
a text with an opacity as its composite over its background. AA is 4.5:1
for text — almost all of this UI's text is under 18.66px bold, so the
large-text 3:1 applies to none of these pairs. ✗ marks a pair under AA.

`web/src/designTokens.test.ts` declares this list and computes every ratio
from `web/src/index.css`'s own values: each pair must read at least 4.5:1
in light and in dark, so a token value that regresses fails the test. The
one pair under AA is the accepted one (decision 9).

| Group | Text | Background | Use | Light | Dark |
|---|---|---|---|---|---|
| Text on surfaces | `text` | `paper` | body, labels, hints, timestamps, empty states | 15.01 | 16.15 |
| Text on surfaces | `muted` | `paper` | body, labels, hints, timestamps, empty states | 5.43 | 8.02 |
| Text on surfaces | `text` | `paper-2` | body, labels, hints, timestamps, empty states | 15.99 | 15.54 |
| Text on surfaces | `muted` | `paper-2` | body, labels, hints, timestamps, empty states | 5.79 | 7.71 |
| Text on surfaces | `text` | `card` | body, labels, hints, timestamps, empty states | 16.81 | 14.83 |
| Text on surfaces | `muted` | `card` | body, labels, hints, timestamps, empty states | 6.08 | 7.36 |
| Text on surfaces | `text` | `field` | body, labels, hints, timestamps, empty states | 15.86 | 13.93 |
| Text on surfaces | `muted` | `field` | body, labels, hints, timestamps, empty states | 5.74 | 6.91 |
| Text on surfaces | `text` | `copper 12% over card` | the care-plan entry on the visit sheet | 14.62 | 12.42 |
| Tone text on surfaces | `green` | `card` | links, status words, amounts, the in-room name | 7.93 | 5.09 |
| Tone text on surfaces | `copper-ink` | `card` | links, status words, amounts, the in-room name | 5.36 | 6.30 |
| Tone text on surfaces | `danger` | `card` | links, status words, amounts, the in-room name | 7.22 | 4.88 |
| Tone text on surfaces | `warning` | `card` | links, status words, amounts, the in-room name | 5.19 | 7.47 |
| Tone text on surfaces | `eligible` | `card` | links, status words, amounts, the in-room name | 6.47 | 6.53 |
| Tone text on surfaces | `green` | `field` | links, status words, amounts, the in-room name | 7.48 | 4.78 |
| Tone text on surfaces | `copper-ink` | `field` | links, status words, amounts, the in-room name | 5.05 | 5.92 |
| Tone text on surfaces | `danger` | `field` | links, status words, amounts, the in-room name | 6.81 | 4.59 |
| Tone text on surfaces | `warning` | `field` | links, status words, amounts, the in-room name | 4.89 | 7.02 |
| Tone text on surfaces | `eligible` | `field` | links, status words, amounts, the in-room name | 6.11 | 6.13 |
| Tone text on surfaces | `copper-ink` | `copper 12% over card` | the care-plan entry's progress | 4.66 | 5.28 |
| Tone text on its wash | `green` | `green-wash` | soft badges, secondary and outline buttons, pressed chips | 6.84 | 4.71 |
| Tone text on its wash | `copper-ink` | `copper-wash` | soft badges, pressed tabs, the in-room row, the next session | 4.69 | 6.11 |
| Tone text on its wash | `danger` | `danger-wash` | soft badges, danger buttons, the no-show row | 5.85 | 4.76 |
| Tone text on its wash | `warning` | `warning-wash` | soft badges, the late notes | 4.49 ✗ | 6.89 |
| Tone text on its wash | `eligible` | `eligible 18% over card` | a done session's status | 4.95 | 4.82 |
| Chrome (ink) | `on-dark` | `ink` | titles, values, buttons | 15.52 | 17.31 |
| Chrome (ink) | `on-dark-dim` | `ink` | labels, sub-lines, inactive nav, the card head's badge | 6.13 | 6.01 |
| Chrome (ink) | `on-ink` | `ink` | the lock card's and the activation card's brand | 16.81 | 19.57 |
| Chrome (ink) | `copper-2` | `ink` | the lock card's “tra”, the slab's copper figures | 5.68 | 8.76 |
| Chrome (ink) | `green-on-ink` | `ink` | the slab's arrived count | 6.76 | 7.87 |
| Chrome (ink) | `danger-on-ink` | `ink` | the slab's no-show count | 7.03 | 8.18 |
| Chrome (ink) | `on-dark` | `ink-2` | titles, values, buttons | 12.60 | 13.93 |
| Chrome (ink) | `on-dark-dim` | `ink-2` | labels, sub-lines, inactive nav, the card head's badge | 4.98 | 4.84 |
| Chrome (ink) | `on-ink` | `ink-2` | the lock card's and the activation card's brand | 13.64 | 15.75 |
| Chrome (ink) | `copper-2` | `ink-2` | the lock card's “tra”, the slab's copper figures | 4.61 | 7.05 |
| Chrome (ink) | `green-on-ink` | `ink-2` | the slab's arrived count | 5.49 | 6.33 |
| Chrome (ink) | `danger-on-ink` | `ink-2` | the slab's no-show count | 5.70 | 6.58 |
| Chrome (ink) | `on-dark` | `glass 25% over ink-2` | on-dark buttons, the PIN pad, the active nav item | 5.70 | 6.17 |
| Chrome (ink) | `copper-on-ink` | `copper 22% over ink-2` | the on-dark copper button | 4.83 | 4.95 |
| Text on fills | `on-fill` | `green` | primary buttons, solid badges and pills, numbered circles, the invoice head's status | 7.93 | 5.54 |
| Text on fills | `on-fill` | `green-2` | primary buttons, solid badges and pills, numbered circles, the invoice head's status | 5.15 | 7.60 |
| Text on fills | `on-fill` | `danger` | primary buttons, solid badges and pills, numbered circles, the invoice head's status | 7.22 | 5.32 |
| Text on fills | `on-fill` | `warning` | primary buttons, solid badges and pills, numbered circles, the invoice head's status | 5.19 | 8.14 |
| Text on fills | `on-fill` | `eligible` | primary buttons, solid badges and pills, numbered circles, the invoice head's status | 6.47 | 7.11 |
| Text on fills | `on-fill` | `muted` | primary buttons, solid badges and pills, numbered circles, the invoice head's status | 6.08 | 8.02 |
| Text on fills | `on-copper` | `copper` | the in-room pill, avatars, the care-plan hero | 4.67 | 6.87 |
| Text on fills | `on-copper` | `copper-2` | the in-room pill, avatars, the care-plan hero | 6.38 | 8.46 |
| Text on fills | `paper` | `danger` | the sync auth-error banner | 6.45 | 5.32 |
| Text on fills | `paper` | `green` | the install banner's action | 7.09 | 5.54 |
| Print | `print-note-ink` | `print-note` | the printed pages' note | 4.72 | 4.72 |
| Print | `print-ink` | `print-paper` | printed pages | 21.00 | 21.00 |
| Print | `print-ink 60%` | `print-paper` | printed pages' greys (60% is the lightest) | 5.74 | 5.74 |
| Print | `print-paper` | `print-ink` | the prescription's drug numbers | 21.00 | 21.00 |

Outside the guard:
- Placeholder text in an empty field (decision 7): `faint` on `field`
  (inputs) 2.75 light / 3.88 dark, on `card` (the quick note) 2.92 /
  4.13. The test holds them at those numbers and fails if `faint` is text
  anywhere but a placeholder.
- Disabled controls (half opacity), which WCAG exempts.
- The logo tiles' "C" on the green tile (`on-ink`), a logotype; the
  WhatsApp mark (`whatsapp`), an icon.
- The slab's radial `ink-3` highlight, a corner glow: its text is tabled
  on `ink` and `ink-2`, the slab's base gradient.

Every pair the earlier table marked ✗ is answered by decisions 6–12 in
`docs/session-handoff.md`'s "Dark mode": white on fills splits into
`on-fill`, `on-copper` and `on-ink` (6); `faint` leaves text (7); the
invoice head's status is solid (8); `copper-ink`, `green-on-ink` and
`copper-on-ink` take the light theme's remaining pairs, and `warning` on
`warning-wash` stays at 4.49 (9); the care-plan hero (10), the slab's
no-show count (11) and the card head's badge (12).

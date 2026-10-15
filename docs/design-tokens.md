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
verbatim. A value marked *derived* is a token the prototype's dark blocks do
not list; its dark value is chosen here and the reason given.

| Token | Light | Dark | Use |
|---|---|---|---|
| `paper` | `#EFF3F1` | `#081311` | Page background. |
| `paper-2` | `#F7FAF8` | `#0B1815` | Content area inside the app frame; top of the page gradient. |
| `card` | `#FFFFFF` | `#0F1D1A` | Cards, sheets, rows. |
| `field` | `#F6F9F7` | `#132320` | Input fill, table header, footer strips. |
| `ink` / `ink-2` / `ink-3` | `#0B211D` / `#14332C` / `#1A3E35` | `#040E0C` / `#0F2722` / `#183930` | Dark surfaces: app bar, card heads, hero slab, lock screen. Never a text colour: in dark it is darker than the page. |
| `text` | `#0B211D` | `#E7EFEC` | Primary text (the body's colour). |
| `muted` | `#55665F` | `#9AADA7` | Secondary text, labels. |
| `faint` | `#8A9B95` | `#6C807A` | Hints, timestamps, empty states. |
| `rule` | `#D9E0DD` | `#22332E` | Borders. |
| `hair` | `#E7ECEA` | `#192824` | Row separators. |
| `on-dark` / `on-dark-dim` | `#F2F7F5` / `#87A29A` | `#EAF3F0` / `#7A948D` | Text on `ink` surfaces. |
| `on-fill` | `#FFFFFF` | `#FFFFFF` *derived* | Text and marks on a saturated fill (green, copper, danger, eligible, warning, muted) and on the ink chrome; the settings toggle's knob. The prototype's literal `#fff`, which it keeps in dark. |
| `glass` | `#FFFFFF` | `#FFFFFF` *derived* | The translucent white of controls on ink and copper, always with an opacity (`.app-btn`, `.tb-nav`, `.pad button`: `rgba(255,255,255,.06–.25)` in the prototype, in both themes). |

## Brand and state

| Token | Light | Dark | Use |
|---|---|---|---|
| `green` / `green-2` | `#1D5B4A` / `#2E7A63` | `#2E9C7C` / `#37B894` | Identity: primary buttons, selected state, links. `green` is also the browser's `theme-color`, per active theme. |
| `green-wash` / `green-line` | `#E8F0EC` / `#BFDBD0` | `#102520` / `#26463D` | Green-toned fill and border. |
| `copper` / `copper-2` | `#A8742A` / `#C68A38` | `#C79247` / `#DBA35A` | Active moments: in the room, next, amount due, prescription. |
| `copper-wash` / `copper-line` | `#F7EFE2` / `#E2CDA6` | `#241C0F` / `#4A3820` | Copper-toned fill and border. |
| `eligible` | `#186B4B` | `#47B187` | Done, arrived, paid, matched. |
| `warning` / `warning-wash` | `#96620B` / `#F7EEDA` | `#D7A13A` / `#2A2010` | Delay, partial payment, needs attention. |
| `danger` / `danger-wash` / `danger-line` | `#A32A21` / `#F7E3E0` / `#E4B9B4` | `#DE6055` / `#2E1614` / `#552420` | No-show, cancel, destructive actions, errors. |
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
`web/src/designTokens.test.ts` holds both columns to the prototype.

## Contrast

WCAG 2 contrast of every text/background token pair the screens use, in
both themes (gradients at their weaker end; a tint over the ink head
computed as its composite). AA is 4.5:1 for text — almost all of this UI's
text is under 18.66px bold, so the large-text 3:1 applies to none of these
pairs. ✗ marks a pair under AA.

| Group | Text | Background | Use | Light | Dark | AA |
|---|---|---|---|---|---|---|
| Text on surfaces | `text` | `paper` | body, labels, hints | 15.01 | 16.15 | 4.5 |
| Text on surfaces | `muted` | `paper` | body, labels, hints | 5.43 | 8.02 | 4.5 |
| Text on surfaces | `faint` | `paper` | body, labels, hints | 2.60 ✗ | 4.50 | 4.5 |
| Text on surfaces | `text` | `paper-2` | body, labels, hints | 15.99 | 15.54 | 4.5 |
| Text on surfaces | `muted` | `paper-2` | body, labels, hints | 5.79 | 7.71 | 4.5 |
| Text on surfaces | `faint` | `paper-2` | body, labels, hints | 2.77 ✗ | 4.33 ✗ | 4.5 |
| Text on surfaces | `text` | `card` | body, labels, hints | 16.81 | 14.83 | 4.5 |
| Text on surfaces | `muted` | `card` | body, labels, hints | 6.08 | 7.36 | 4.5 |
| Text on surfaces | `faint` | `card` | body, labels, hints | 2.92 ✗ | 4.13 ✗ | 4.5 |
| Text on surfaces | `text` | `field` | body, labels, hints | 15.86 | 13.93 | 4.5 |
| Text on surfaces | `muted` | `field` | body, labels, hints | 5.74 | 6.91 | 4.5 |
| Text on surfaces | `faint` | `field` | body, labels, hints | 2.75 ✗ | 3.88 ✗ | 4.5 |
| Tone text on card | `green` | `card` | links, status words, amounts | 7.93 | 5.09 | 4.5 |
| Tone text on card | `copper` | `card` | links, status words, amounts | 4.04 ✗ | 6.30 | 4.5 |
| Tone text on card | `danger` | `card` | links, status words, amounts | 7.22 | 4.88 | 4.5 |
| Tone text on card | `warning` | `card` | links, status words, amounts | 5.19 | 7.47 | 4.5 |
| Tone text on card | `eligible` | `card` | links, status words, amounts | 6.47 | 6.53 | 4.5 |
| Tone text on its wash | `green` | `green-wash` | soft badges, secondary/danger/muted buttons | 6.84 | 4.71 | 4.5 |
| Tone text on its wash | `copper` | `copper-wash` | soft badges, secondary/danger/muted buttons | 3.54 ✗ | 6.11 | 4.5 |
| Tone text on its wash | `danger` | `danger-wash` | soft badges, secondary/danger/muted buttons | 5.85 | 4.76 | 4.5 |
| Tone text on its wash | `warning` | `warning-wash` | soft badges, secondary/danger/muted buttons | 4.49 ✗ | 6.89 | 4.5 |
| Tone text on its wash | `muted` | `field` | soft badges, secondary/danger/muted buttons | 5.74 | 6.91 | 4.5 |
| Chrome (ink) | `on-dark` | `ink` | app bar, rail, card heads, slab, lock card | 15.52 | 17.31 | 4.5 |
| Chrome (ink) | `on-dark-dim` | `ink` | app bar, rail, card heads, slab, lock card | 6.13 | 6.01 | 4.5 |
| Chrome (ink) | `copper-2` | `ink` | app bar, rail, card heads, slab, lock card | 5.68 | 8.76 | 4.5 |
| Chrome (ink) | `on-fill` | `ink` | app bar, rail, card heads, slab, lock card | 16.81 | 19.57 | 4.5 |
| Chrome (ink) | `on-dark` | `ink-2` | app bar, rail, card heads, slab, lock card | 12.60 | 13.93 | 4.5 |
| Chrome (ink) | `on-dark-dim` | `ink-2` | app bar, rail, card heads, slab, lock card | 4.98 | 4.84 | 4.5 |
| Chrome (ink) | `copper-2` | `ink-2` | app bar, rail, card heads, slab, lock card | 4.61 | 7.05 | 4.5 |
| Chrome (ink) | `on-fill` | `ink-2` | app bar, rail, card heads, slab, lock card | 13.64 | 15.75 | 4.5 |
| Chrome (ink) | `green-2` | `ink-2` | slab "arrived" count | 2.65 ✗ | 6.33 | 4.5 |
| Tinted badge on invoice head | `warning` | `warning 22% over ink-2` | .inv-status | 2.22 ✗ | 4.54 | 4.5 |
| Tinted badge on invoice head | `eligible` | `eligible 22% over ink-2` | .inv-status | 1.81 ✗ | 4.04 ✗ | 4.5 |
| Tinted badge on invoice head | `danger` | `danger 22% over ink-2` | .inv-status | 1.80 ✗ | 3.42 ✗ | 4.5 |
| Tinted on-dark copper button | `copper-2` | `copper 22% over ink-2` | .sb.copper | 3.65 ✗ | 4.93 | 4.5 |
| White on fills | `on-fill` | `green` | primary button, solid badges, avatars, numbers | 7.93 | 3.41 ✗ | 4.5 |
| White on fills | `on-fill` | `green-2` | primary button, solid badges, avatars, numbers | 5.15 | 2.49 ✗ | 4.5 |
| White on fills | `on-fill` | `copper` | primary button, solid badges, avatars, numbers | 4.04 ✗ | 2.75 ✗ | 4.5 |
| White on fills | `on-fill` | `copper-2` | primary button, solid badges, avatars, numbers | 2.96 ✗ | 2.23 ✗ | 4.5 |
| White on fills | `on-fill` | `danger` | primary button, solid badges, avatars, numbers | 7.22 | 3.55 ✗ | 4.5 |
| White on fills | `on-fill` | `warning` | primary button, solid badges, avatars, numbers | 5.19 | 2.32 ✗ | 4.5 |
| White on fills | `on-fill` | `eligible` | primary button, solid badges, avatars, numbers | 6.47 | 2.66 ✗ | 4.5 |
| White on fills | `on-fill` | `muted` | primary button, solid badges, avatars, numbers | 6.08 | 2.36 ✗ | 4.5 |
| Paper as text on fills | `paper` | `danger` | sync auth-error banner (App.tsx) | 6.45 | 5.32 | 4.5 |
| Paper as text on fills | `paper` | `green` | install banner action | 7.09 | 5.54 | 4.5 |
| Print (constant) | `print-note-ink` | `print-note` | .print-header note | 4.72 | 4.72 | 4.5 |
| Print (constant) | `print-ink` | `print-paper` | printed pages | 21.00 | 21.00 | 4.5 |
| Print (constant) | `print-ink/60` | `print-paper` | print-ink/60 greys | 5.74 | 5.74 | 4.5 |

Findings (pairs under AA). Every one is a prototype value or one of the
prototype's own literals (`#fff` on fills); none is a token derived for dark
mode, so none was changed — each is an owner question:
- Light: `faint` on every surface (2.60–2.92); `copper` on `card` (4.04) and
  on `copper-wash` (3.54); `warning` on `warning-wash` (4.49); `green-2` on
  `ink-2` (2.65, the slab's "arrived" count); the tinted invoice-status badges
  (1.80–2.22) and the on-dark copper button (3.65); `on-fill` on `copper`
  (4.04) and on `copper-2` (2.96, the gradient's light end).
- Dark: `faint` on `paper-2`, `card` and `field` (3.88–4.33); the tinted
  "paid" and "void" badges (4.04, 3.42); `on-fill` on every saturated fill
  (2.23–3.55: primary buttons, solid badges, avatars, the slot state pills).

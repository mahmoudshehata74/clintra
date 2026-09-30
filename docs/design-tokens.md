# Clintra design tokens

Every token is declared once, in `web/src/index.css`'s `@theme` block, and
generates Tailwind utilities (`bg-*`, `text-*`, `border-*`, `rounded-*`,
`shadow-*`). Values come from the `:root` block of
`docs/reference/clintra-prototype.html`. No component hardcodes a hex value.

## Surfaces and text

| Token | Hex | Use |
|---|---|---|
| `paper` | `#EFF3F1` | Page background. |
| `paper-2` | `#F7FAF8` | Content area inside the app frame; top of the page gradient. |
| `card` | `#FFFFFF` | Cards, sheets, rows. |
| `field` | `#F6F9F7` | Input fill, table header, footer strips. |
| `ink` / `ink-2` / `ink-3` | `#0B211D` / `#14332C` / `#1A3E35` | Dark surfaces: app bar, card heads, hero slab, lock screen. |
| `text` | `#0B211D` | Primary text. |
| `muted` | `#55665F` | Secondary text, labels. |
| `faint` | `#8A9B95` | Hints, timestamps, empty states. |
| `rule` | `#D9E0DD` | Borders. |
| `hair` | `#E7ECEA` | Row separators. |
| `on-dark` / `on-dark-dim` | `#F2F7F5` / `#87A29A` | Text on `ink` surfaces. |

## Brand and state

| Token | Hex | Use |
|---|---|---|
| `green` / `green-2` | `#1D5B4A` / `#2E7A63` | Identity: primary buttons, selected state, links. |
| `green-wash` / `green-line` | `#E8F0EC` / `#BFDBD0` | Green-toned fill and border. |
| `copper` / `copper-2` | `#A8742A` / `#C68A38` | Active moments: in the room, next, amount due, prescription. |
| `copper-wash` / `copper-line` | `#F7EFE2` / `#E2CDA6` | Copper-toned fill and border. |
| `eligible` | `#186B4B` | Done, arrived, paid, matched. |
| `warning` / `warning-wash` | `#96620B` / `#F7EEDA` | Delay, partial payment, needs attention. |
| `danger` / `danger-wash` / `danger-line` | `#A32A21` / `#F7E3E0` / `#E4B9B4` | No-show, cancel, destructive actions, errors. |

## Radius and shadow

| Token | Value | Use |
|---|---|---|
| `rounded-chip` | 6px | Badges, small tags. |
| `rounded-control` | 9px | Buttons, inputs, toggles. |
| `rounded-card` | 12px | Inner cards, tiles, rows with a frame. |
| `rounded-panel` | 14px | Cards, sheets, hero slab. |
| `rounded-app` | 16px | The app frame. |
| `shadow-s` | `0 1px 2px` | Cards and tiles at rest. |
| `shadow-m` | two-layer | App frame, sticky bars. |
| `shadow-l` | deep, soft | Sheets, print previews, hero slab. |

## Typography

IBM Plex Sans Arabic only, weights 300–700, for headings and body. All
numbers render as Latin digits with `font-variant-numeric: tabular-nums`
where they align in columns.

## Legacy tokens

`green-soft`, `green-medium`, `red`, `red-soft`, `amber`, `amber-soft`,
`purple`, `purple-soft`, `line`, `line-soft`, and the radii `--radius-el`
(8px) and `--radius-frame` (12px) belong to the pre-prototype system. They
stay only while screens that use them are not yet restyled, and each is
deleted in the commit that migrates its last usage.

## Not yet enabled

Dark mode. The prototype defines dark values; they are enabled in a separate
step once every screen uses the tokens above, so light and dark never mix.

# Clintra design tokens

This is the single source of truth for colour, alongside `docs/schema.md`
for data shape. Every token is declared once, in `web/src/index.css`'s
`@theme` block, as a Tailwind CSS custom property (`--color-*`). No
component should hardcode a hex value — see `docs/design-audit.md`'s
verification list for the current, temporary exceptions still awaiting a
per-screen rework.

## Strong colours

Used for body text, borders, and primary/destructive button fills.

| Token | Hex | Use |
|---|---|---|
| `--color-ink` | `#16211d` | Primary text colour. |
| `--color-paper` | `#fbfaf7` | Page background. |
| `--color-green` | `#1d5b4a` | Primary brand colour: primary buttons, positive/active state, links. |
| `--color-red` | `#b23a34` | Destructive actions and negative/error state (cancel, void, validation errors). |
| `--color-amber` | `#8a6a22` | Warning/attention state (delay, needs-review, pending difference). |
| `--color-purple` | `#453fa0` | Secondary accent for tags unrelated to the green/red/amber status vocabulary (e.g. a price override, a specialty-form marker). |
| `--color-line` | `#e2e3dc` | Borders and dividers. |
| `--color-muted` | `#6e7370` | Secondary/muted text. |

## Soft fills

Used as tinted backgrounds behind a status pill or a highlighted row —
paired one-to-one with the strong colour whose text sits on top of them.

| Token | Hex | Use |
|---|---|---|
| `--color-green-soft` | `#e8f0ec` | Background for a green-toned highlighted row or tag (e.g. the current/next item in a queue). |
| `--color-amber-soft` | `#f6efdd` | Background for an amber-toned tag or row (e.g. a cash-close difference, a needs-review flag). |
| `--color-purple-soft` | `#edebfb` | Background for a purple-toned tag (paired with `--color-purple`). |

## Provenance

`--color-green`, `--color-green-soft`, `--color-red`, `--color-amber`,
`--color-ink`, `--color-paper`, `--color-line` and `--color-muted` already
matched the design reference's own values exactly (see
`docs/design-audit.md`) before this document existed; `--color-amber-soft`,
`--color-purple` and `--color-purple-soft` were added from the reference's
`--ambs`, `--pur` and `--purs` values (`clintra-screens.html`, lines 12–13)
to close the gap `docs/design-audit.md` flagged. The reference's digit
convention (Arabic-Indic) was deliberately not adopted — see
`docs/design-audit.md`'s decision (a)1–4, now settled: this app uses
Western digits everywhere, on purpose.

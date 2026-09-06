# RTL bidi isolation

The UI is Arabic-only and RTL. Every Latin or numeric run embedded in
Arabic text must be wrapped in `<Ltr>` (`web/src/components/Ltr.tsx`).
Without it, the bidi algorithm can reorder neutral characters (`#`, `-`,
`:`, `/`) next to the run, e.g. `#B23A34` renders as `B23A34#`.

Applies to: phone numbers, invoice numbers, receipt numbers, clock times,
hex colour values, and any other Latin/numeric identifier.

`<Ltr>` renders `<bdi dir="ltr">` with the `ltr-run` utility class
(`direction: ltr; unicode-bidi: isolate;`).

Example:

```tsx
<span>
  رقم الفاتورة: <Ltr>INV-2044</Ltr>
</span>
```

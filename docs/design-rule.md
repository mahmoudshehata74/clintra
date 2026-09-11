# Design source of truth

`clintra-screens.html` is the authoritative visual reference. For any task
that touches how a screen looks:

1. Before writing any UI code, open the exact screen in
   `clintra-screens.html`.
2. Read its HTML structure, its inline CSS classes, and the shared class
   definitions those classes reference.
3. Match the structure and the styling as-rendered, not as-described.
   A prose description in a prompt is a summary of the reference, not a
   replacement for it. If the prompt describes something differently from
   what the reference shows, the REFERENCE wins — stop and flag the
   contradiction before proceeding.
4. Cite the exact reference class names in the commit message so the
   trace back to the reference stays intact.

This applies to redesigns, new screens, and any visual regression fix.
It does NOT apply to backend, data model, or logic tasks.

Do not commit reference file changes; the reference is read-only.

# Session handoff

## Phase
Web app (React + Vite PWA, offline-first) and API (Laravel + Postgres RLS)
are both feature-complete for v1's single-clinic sync flow. Most recent
work: Clintra brand assets (wordmark, icons, brand tokens) and a flaky-test
cleanup — two genuine root causes fixed with repeat-run proof, not timeout
bumps — plus a seed-date bug the cleanup surfaced along the way.

## Last commits
`2278e82` fix(web): pin seed demo visits strictly before today, not
on-or-before · `99d7ab4` test: fix flaky tests and surface retries ·
`e71dd14` feat(web): brand assets. All pushed to `origin/main`; CI green.

## Verify
Web: `pnpm --dir web test` (vitest, 563 passed) · `pnpm exec tsc -b
--noEmit` · `pnpm --dir web build` · `pnpm --dir web test:e2e` (111 passed,
desktop + mobile). API: `cd api && php artisan test`.

## Next session: design system rebuild

**`docs/reference/clintra-screens.html` is retired as the visual
reference.** The next session builds a new design system from scratch;
don't consult the old mockup for layout, spacing, or component shape —
it's being replaced, not extended.

### Next session context
- **Laravel Phase 3 (auth + patients) is deferred** until the design
  rebuild completes. Don't start API auth/patients work in the interim.
- **No screen, component, or logic should be touched** until new design
  tokens are approved — this includes `web/src/index.css`'s `@theme`
  block and everything under `web/src/screens` and `web/src/auth`.
- **Existing tests must remain green throughout the design rebuild.**
  Any change made once tokens are approved must keep vitest and e2e
  passing at every step, not just at the end.

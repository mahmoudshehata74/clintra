# Session handoff

## Phase
v1 web app (React + Vite PWA, offline-first, IndexedDB via Dexie), pre-Laravel.
Shipped: day screen (slots + queue), booking sheet, invoice/payment/receipt,
audit sheet, day sheet, Playwright e2e + screenshot layer, Layer 1 device
identity, Layer 2 staff PIN + lock screen, and owner-scoped settings.

## Last commit
`f5e195c` — feat(web): owner-scoped settings for hours, services, staff.
Adds the owner-only settings sheet (working hours, services + price overrides,
staff + permissions), seeds the practitioner membership as `role: "owner"`, and
routes every settings write through the audited `mutate()` pipeline.

## Open WIP / deferred
- No WIP branches; `main` is the only branch and is green.
- Auth Layer 3 beyond what Layer 2 needed is not built.
- Real device registration + real staff setup flow wait for Laravel (see
  docs/auth-plan.md Layer 1). Existing staff edit supports role/active/PIN only.

## Gotchas any future session must know
- `?seedDay=1` pins the screen to a fixed past Monday, but new rows are stamped
  with the real now — so audit/day-scoped views look empty for freshly-created
  rows under seedDay. Use `/` (no seedDay) when reading back today's writes.
- Vercel Root Directory must be `web`, not the repo root (the app lives in web/).
- `resolveActingMembership()` THROWS when no PIN session is active — no fallback
  in production. DB unit tests keep working because `src/test/setupIndexedDb.ts`
  registers a test-actor resolver (the seeded assistant); a real session is set
  via `auth/session.ts`. Don't reintroduce a production default.
- `src/auth/devPins.ts` holds the dev seed PINs (assistant 1234, owner 5678).
  DELETE it (and its seed/e2e uses) when the real setup flow ships.
- The overbook uniqueness field is `visits.unique_scheduled_at` (equals
  scheduled_at, ENTIRELY ABSENT when `is_overbooked`). It is derived — only ever
  set/removed by the visit write helpers (visitBooking/visitMove/visitQueue,
  scheduleModeSwitch). Never assign it by hand.
- e2e: `pnpm exec playwright test` does NOT rebuild; run `pnpm --dir web
  test:e2e` (builds first) or `pnpm --dir web build` before, or the preview
  serves stale dist. `test:e2e` runs interaction specs; `test:e2e:screenshots`
  captures the (gitignored) PNGs for visual review.
- Dexie `useLiveQuery` async-then-`.filter()` queriers may not re-emit; use the
  plain `() => db.table.toArray()` querier and filter in render.
- Digits are Western everywhere (Decision B); money via `formatPiastresForDisplay`,
  phone via `domain/phone` (E.164).

## Verify
`pnpm --dir web test` (481) · `pnpm exec tsc -b --noEmit` · `pnpm --dir web
build` · `pnpm --dir web test:e2e` (78). CI has separate `build` and `e2e` jobs.

## Next task
Care plans / templated visits (reference screen 10, the general visit form) —
the first v1 screen to read specialty_templates / form_definitions /
visit_form_data, already in scope per docs/schema.md decision A.

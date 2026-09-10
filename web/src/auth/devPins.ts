/**
 * DEV SEED PINS — NOT FOR PRODUCTION.
 *
 * These four-digit PINs exist only so the dev seed (db/seed.ts) can populate
 * memberships.pin_hash with something a developer can actually type on the lock
 * screen, and so the Playwright tests can drive the real PIN flow. They are the
 * ONE place any literal PIN value lives.
 *
 * They MUST be removed when a real setup/registration flow ships (the flow the
 * reference's screen 1 describes, arriving with the Laravel backend — see
 * docs/auth-plan.md, Layer 1/2). At that point PINs are set by staff, never
 * hardcoded, and this file should be deleted along with its seed usage.
 *
 * Keyed by role so the seed and the tests agree without importing membership
 * ids. Never log these, never put them in a URL.
 */
export const DEV_SEED_PINS = {
  assistant: "1234",
  practitioner: "5678",
} as const;

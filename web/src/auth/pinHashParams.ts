/**
 * Argon2id parameters for hashing staff PINs.
 *
 * These are OWASP's recommended Argon2id configuration: "m=19456 (19 MiB),
 * t=2, p=1" — one of the settings the OWASP Password Storage Cheat Sheet lists
 * as acceptable minimums.
 * Source: OWASP Password Storage Cheat Sheet, "Argon2id" section
 * (https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
 * Measured at ~250ms per hash with @noble/hashes (pure-JS) on a dev machine,
 * which keeps a single unlock responsive while staying on OWASP's guidance.
 *
 * A 4-digit PIN has only 10,000 possible values, so — as docs/auth-plan.md
 * records — this KDF is defense-in-depth, not the primary control; the real
 * protection is the hash never leaving the device plus entry rate-limiting.
 *
 * Changing these parameters later does NOT require a data migration: a stored
 * hash is only ever compared against a fresh hash of the entered PIN, so once
 * these constants change, the next successful PIN entry can transparently
 * re-hash and overwrite the old value. Nothing reads the old hash except the
 * verify step it is about to replace.
 */
export const ARGON2ID_PARAMS = {
  /** Iterations (time cost). */
  t: 2,
  /** Memory cost in KiB (19456 KiB = 19 MiB). */
  m: 19456,
  /** Parallelism (lanes). */
  p: 1,
  /** Derived key length in bytes. */
  dkLen: 32,
} as const;

/** Length in bytes of the per-membership random salt. 16 bytes is the Argon2 reference default. */
export const PIN_SALT_BYTES = 16;

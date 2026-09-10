import { argon2id } from "@noble/hashes/argon2.js";
import { ARGON2ID_PARAMS, PIN_SALT_BYTES } from "./pinHashParams";

// Argon2id (RFC 9106) via @noble/hashes — audited, actively maintained,
// pure-JS (no WASM, so no CSP relaxation and nothing extra to precache for
// offline). Decided in docs/auth-plan.md, Layer 2.

function toHex(bytes: Uint8Array): string {
  let hex = "";
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, "0");
  }
  return hex;
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** A fresh random per-membership salt, hex-encoded for storage in memberships.pin_salt. */
export function generatePinSalt(): string {
  const salt = new Uint8Array(PIN_SALT_BYTES);
  crypto.getRandomValues(salt);
  return toHex(salt);
}

/** Hashes a PIN with the given (hex) salt under the pinned Argon2id parameters; returns a hex digest. */
export function hashPin(pin: string, saltHex: string): string {
  const digest = argon2id(pin, fromHex(saltHex), {
    t: ARGON2ID_PARAMS.t,
    m: ARGON2ID_PARAMS.m,
    p: ARGON2ID_PARAMS.p,
    dkLen: ARGON2ID_PARAMS.dkLen,
  });
  return toHex(digest);
}

/**
 * Constant-time-ish comparison of a candidate PIN against a stored hash+salt.
 * Both sides are fixed-length hex of the same dkLen, so a length-independent
 * compare over every character avoids leaking the match position via timing.
 */
export function verifyPin(pin: string, saltHex: string, expectedHashHex: string): boolean {
  const actual = hashPin(pin, saltHex);
  if (actual.length !== expectedHashHex.length) {
    return false;
  }
  let mismatch = 0;
  for (let i = 0; i < actual.length; i++) {
    mismatch |= actual.charCodeAt(i) ^ expectedHashHex.charCodeAt(i);
  }
  return mismatch === 0;
}

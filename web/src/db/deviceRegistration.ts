import { id } from "../domain/id";
import type { ClintraDatabase } from "./database";
import type { DeviceRegistration } from "./types";

// The device id used to live here (localStorage), before database version 8
// moved it into the `device` table. This key is read once during migration and
// then deleted — never written again.
const LEGACY_DEVICE_ID_STORAGE_KEY = "clintra:device_id";

// The device id, cached in memory. The write path (db/mutate.ts) stamps every
// sync_ops row with it synchronously inside a Dexie transaction, so it cannot
// afford an async read; ensureDeviceRegistration primes this during app start.
let cachedDeviceId: string | null = null;

function readLegacyLocalStorageDeviceId(): string | null {
  if (typeof localStorage === "undefined") {
    return null;
  }
  return localStorage.getItem(LEGACY_DEVICE_ID_STORAGE_KEY);
}

function clearLegacyLocalStorageDeviceId(): void {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem(LEGACY_DEVICE_ID_STORAGE_KEY);
  }
}

/**
 * The device id, synchronously — for the write path only (db/mutate.ts).
 * Returns the persisted id once ensureDeviceRegistration has run. Before that
 * (e.g. a unit test that writes without registering a device) it mints a
 * memory-only id so a write still carries a stable, non-empty device_id for
 * the process's lifetime; it is never written to localStorage, which no longer
 * holds device identity. In the real app, ensureDeviceRegistration runs during
 * load before any mutation, so the persisted id is always what gets stamped.
 */
export function getDeviceId(): string {
  if (cachedDeviceId === null) {
    cachedDeviceId = id();
  }
  return cachedDeviceId;
}

/** Test-only: drops the in-memory device id so a fresh registration can be exercised. */
export function resetDeviceIdCacheForTests(): void {
  cachedDeviceId = null;
}

/**
 * Registers this browser against the seeded org+location if it is not already
 * registered, and returns the binding. Idempotent: after the first run the
 * existing row is returned unchanged and the in-memory id cache is primed from
 * it.
 *
 * Migration: a device id left in localStorage by a build from before version 8
 * is adopted as the new row's id, so a currently-deployed device keeps its
 * identity; the localStorage entry is then deleted. If a device row already
 * exists AND a *different* legacy id is still in localStorage, this refuses
 * loudly rather than silently choosing one — that is a conflicting state (e.g.
 * a stale write) a human must resolve, not something to paper over.
 *
 * Requires the seed to have run first: an active location (and its org) must
 * exist to bind to. See db/seed.ts and the day screen's load sequence.
 */
export async function ensureDeviceRegistration(db: ClintraDatabase): Promise<DeviceRegistration> {
  const existing = await db.device.toArray();
  if (existing.length > 0) {
    const registration = existing[0];
    const legacyId = readLegacyLocalStorageDeviceId();
    if (legacyId !== null && legacyId !== registration.id) {
      throw new Error(
        "device_registration_conflict: a device row exists but a different device id remains in localStorage",
      );
    }
    // A leftover legacy id equal to the row is a half-finished migration; finish it.
    if (legacyId !== null) {
      clearLegacyLocalStorageDeviceId();
    }
    cachedDeviceId = registration.id;
    return registration;
  }

  const locations = await db.locations.toArray();
  const location = locations.find((candidate) => candidate.is_active) ?? locations[0];
  if (!location) {
    throw new Error("no_active_location_for_device_binding");
  }

  const deviceId = readLegacyLocalStorageDeviceId() ?? id();
  const registration: DeviceRegistration = {
    id: deviceId,
    org_id: location.org_id,
    location_id: location.id,
    registered_at: new Date().toISOString(),
    pull_cursor: null,
    // Never went through real registration (db/registration.ts) — this is
    // the seed/demo fallback binding, which has no server-issued identity.
    membership_id: null,
    token: null,
    // The seed/demo device never talks to a server, so nothing will ever
    // assign it a number series; it is series 1, which also keeps its
    // printed numbers exactly as they always were (docs/schema.md's v16
    // additions).
    series: 1,
  };
  await db.device.add(registration);
  clearLegacyLocalStorageDeviceId();
  cachedDeviceId = deviceId;
  return registration;
}

/**
 * The device's binding — its id and the org+location it serves — as the single
 * source of truth for these three ids. Everything that needs the device's own
 * org/location reads it here, so swapping the seed-based binding for the future
 * Laravel-backed one is a change to this module alone. Ensures registration
 * first, so callers never see a missing binding.
 */
export function getDeviceBinding(db: ClintraDatabase): Promise<DeviceRegistration> {
  return ensureDeviceRegistration(db);
}

/** Thrown by invoice and receipt minting when this device does not know its own number series yet. */
export const DEVICE_SERIES_UNKNOWN = "device_series_unknown";

/** True for the error getMintingSeries throws — what a screen checks to show its "connect once" message. */
export function isDeviceSeriesUnknown(error: unknown): boolean {
  return error instanceof Error && error.message === DEVICE_SERIES_UNKNOWN;
}

/**
 * The number series this device mints invoice and receipt numbers in
 * (DeviceRegistration.series). Throws device_series_unknown while it is
 * still null — a device registered before series existed, that has not
 * pulled since — rather than guessing a series another device at the same
 * location may already hold. Callers read it before their write
 * transaction starts, so a refusal leaves nothing written.
 */
export async function getMintingSeries(db: ClintraDatabase): Promise<number> {
  const device = await getDeviceBinding(db);
  if (device.series === null || device.series === undefined) {
    throw new Error(DEVICE_SERIES_UNKNOWN);
  }
  return device.series;
}

/** The three kinds of number a device mints inside its series. */
export type MintedNumberKind = "invoice" | "receipt" | "prescription";

/**
 * The key one series' high-water mark is stored under in
 * DeviceRegistration.number_marks: kind, location and series, plus the
 * issued year for the yearly numbers (invoices and prescriptions; receipt
 * numbers run across all time).
 */
export function numberMarkKey(kind: MintedNumberKind, locationId: string, series: number, issuedYear: number | null): string {
  return issuedYear === null ? `${kind}:${locationId}:${series}` : `${kind}:${locationId}:${series}:${issuedYear}`;
}

/**
 * Reserves the next number in one series: one more than the larger of the
 * highest number still in the local store (`localMax`) and the highest this
 * device has ever minted there (its number_marks entry), and records it as
 * the new mark. The mark is what keeps a number reserved once the row that
 * carried it is gone — displaced by a pulled row (sync/pullCollisions.ts) —
 * so a printed invoice, receipt or prescription number never comes back on
 * a different document. Must run inside the minting write's own transaction,
 * which must cover db.device, so the read, the mark and the row commit
 * together.
 */
export async function reserveNextNumber(db: ClintraDatabase, key: string, localMax: number): Promise<number> {
  const device = await db.device.get(getDeviceId());
  if (!device) {
    throw new Error("device_not_registered");
  }
  const marks = device.number_marks ?? {};
  const next = Math.max(localMax, marks[key] ?? 0) + 1;
  await db.device.update(device.id, { number_marks: { ...marks, [key]: next } });
  return next;
}

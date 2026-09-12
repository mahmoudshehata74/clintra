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

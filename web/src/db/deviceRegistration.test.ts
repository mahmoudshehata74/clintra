import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClintraDatabase } from "./database";
import {
  ensureDeviceRegistration,
  getDeviceBinding,
  getDeviceId,
  resetDeviceIdCacheForTests,
} from "./deviceRegistration";
import { seedDatabase } from "./seed";

let db: ClintraDatabase;

const LEGACY_KEY = "clintra:device_id";

// The vitest environment is Node (no DOM), so localStorage does not exist by
// default — the migration path is exercised by installing a minimal in-memory
// stub for the duration of a test and removing it afterwards.
function stubLocalStorage(initial: Record<string, string> = {}): Map<string, string> {
  const store = new Map<string, string>(Object.entries(initial));
  const stub = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  (globalThis as unknown as { localStorage?: unknown }).localStorage = stub;
  return store;
}

beforeEach(() => {
  db = new ClintraDatabase(`clintra-device-test-${crypto.randomUUID()}`);
  resetDeviceIdCacheForTests();
});

afterEach(() => {
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
});

describe("ensureDeviceRegistration", () => {
  it("binds the device to the seeded org and active location, and is idempotent", async () => {
    await seedDatabase(db);
    const [location] = await db.locations.toArray();

    const first = await ensureDeviceRegistration(db);
    expect(first.id).toBeTruthy();
    expect(first.location_id).toBe(location.id);
    expect(first.org_id).toBe(location.org_id);
    expect(await db.device.toArray()).toHaveLength(1);

    const second = await ensureDeviceRegistration(db);
    expect(second.id).toBe(first.id);
    expect(await db.device.toArray()).toHaveLength(1);
  });

  it("primes the synchronous getDeviceId with the registered id", async () => {
    await seedDatabase(db);
    const registration = await ensureDeviceRegistration(db);
    expect(getDeviceId()).toBe(registration.id);
  });

  it("migrates an existing localStorage device id, then deletes the localStorage entry", async () => {
    const store = stubLocalStorage({ [LEGACY_KEY]: "legacy-device-1" });
    await seedDatabase(db);

    const registration = await ensureDeviceRegistration(db);
    expect(registration.id).toBe("legacy-device-1");
    expect(store.has(LEGACY_KEY)).toBe(false);
    expect(getDeviceId()).toBe("legacy-device-1");
  });

  it("refuses loudly when a device row and a different localStorage id both exist", async () => {
    await seedDatabase(db);
    await ensureDeviceRegistration(db); // writes the row (no localStorage present)

    resetDeviceIdCacheForTests();
    stubLocalStorage({ [LEGACY_KEY]: "some-other-id" });
    await expect(ensureDeviceRegistration(db)).rejects.toThrow(/device_registration_conflict/);
  });

  it("throws when no location exists to bind to", async () => {
    // No seed: an empty database has no org/location for the binding.
    await expect(ensureDeviceRegistration(db)).rejects.toThrow(/no_active_location_for_device_binding/);
  });
});

describe("getDeviceBinding", () => {
  it("returns the binding ensureDeviceRegistration wrote", async () => {
    await seedDatabase(db);
    const [location] = await db.locations.toArray();

    const binding = await getDeviceBinding(db);
    expect(binding.location_id).toBe(location.id);
    expect(binding.org_id).toBe(location.org_id);
  });
});

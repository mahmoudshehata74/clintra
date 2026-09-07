import { id } from "../domain/id";

const DEVICE_ID_STORAGE_KEY = "clintra:device_id";

// Falls back to an in-memory value when localStorage is unavailable (e.g.
// under test), so this module works without a browser environment.
let memoryDeviceId: string | null = null;

function readStoredDeviceId(): string | null {
  if (typeof localStorage !== "undefined") {
    return localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  }
  return memoryDeviceId;
}

function writeStoredDeviceId(value: string): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(DEVICE_ID_STORAGE_KEY, value);
  } else {
    memoryDeviceId = value;
  }
}

/** The UUID identifying this browser, generated once on first run and persisted locally. */
export function getDeviceId(): string {
  const existing = readStoredDeviceId();
  if (existing) {
    return existing;
  }

  const generated = id();
  writeStoredDeviceId(generated);
  return generated;
}

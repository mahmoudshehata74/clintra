import Dexie from "dexie";
import { getApiBaseUrl } from "../config/apiBaseUrl";
import { db } from "../db/database";
import { primeSupportDeviceId } from "../db/deviceRegistration";
import { bootstrapFromRegistration, type RegisterDeviceResponseBody } from "../db/registration";
import { clearActiveSession, setActiveMembershipId } from "./session";
import { generateIdentityKey } from "./identityClient";
import { clearSupportMode, supportDatabaseName } from "./supportMode";

interface SupportBootstrap extends RegisterDeviceResponseBody {
  support: { expires_at: string; include_clinical: boolean; admin_name: string };
}

export async function exchangeSupportCode(code: string): Promise<void> {
  const key = await generateIdentityKey();
  const response = await fetch(`${getApiBaseUrl()}/support/exchange`, {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ exchange_code: code, device_public_key: key.public_key }),
  });
  if (!response.ok) throw new Error("support_exchange_failed");
  const body = await response.json() as SupportBootstrap;
  await bootstrapFromRegistration(db, body);
  await db.device.update(body.device_id, { support: body.support });
  await db.device_keys.put({ device_id: body.device_id, ...key, bound: true });
  primeSupportDeviceId(body.device_id);
  setActiveMembershipId(body.membership_id);
}

export async function resumeSupportAccess(): Promise<boolean> {
  const device = (await db.device.toArray()).find((row) => row.token && row.support);
  if (!device) return false;
  if (Date.parse(device.support!.expires_at) <= Date.now()) return false;
  primeSupportDeviceId(device.id);
  if (device.membership_id) setActiveMembershipId(device.membership_id);
  return true;
}

/** Only this named database is deleted; the clinic database is never opened here. */
let wipePromise: Promise<void> | null = null;
export function wipeSupportAccess(): Promise<void> {
  wipePromise ??= (async () => {
    db.close({ disableAutoOpen: true });
    await Dexie.delete(supportDatabaseName());
    clearActiveSession();
    clearSupportMode();
  })();
  return wipePromise;
}

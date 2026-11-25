import { identityClock } from "../auth/identityClient";
import { requestProof } from "../auth/proof";
import { getApiBaseUrl } from "../config/apiBaseUrl";
import type { ClintraDatabase } from "../db/database";
import { hashSupportCode, generateSupportCode } from "../domain/supportCode";

async function request(db: ClintraDatabase, path: string, body: Record<string, unknown>): Promise<Response> {
  const device = (await db.device.toArray()).find((row) => row.token);
  if (!device) throw new Error("support_requires_device");
  const key = await db.device_keys.get(device.id);
  const url = `${getApiBaseUrl()}${path}`;
  const payload = JSON.stringify(body);
  const headers = new Headers({ Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${device.token}` });
  if (key) headers.set("X-Clintra-Device-Proof", await requestProof(key.private_key, "POST", url, payload, await identityClock(getApiBaseUrl())));
  return fetch(url, { method: "POST", headers, body: payload });
}

export async function mintSupportCode(db: ClintraDatabase, locationId: string, hours: 1 | 24 | 72, includeClinical: boolean): Promise<string> {
  const code = generateSupportCode();
  const response = await request(db, "/support/codes", {
    id: crypto.randomUUID(), code_hash: await hashSupportCode(code), location_id: locationId,
    support_hours: hours, include_clinical: includeClinical, audit_id: crypto.randomUUID(),
  });
  if (!response.ok) throw new Error("support_code_failed");
  return code;
}

export async function endSupportSession(db: ClintraDatabase, deviceId: string): Promise<void> {
  const response = await request(db, `/support/devices/${encodeURIComponent(deviceId)}/end`, {});
  if (!response.ok) throw new Error("support_end_failed");
}

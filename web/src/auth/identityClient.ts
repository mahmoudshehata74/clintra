import { getApiBaseUrl } from "../config/apiBaseUrl";
import type { ClintraDatabase } from "../db/database";
import type { DeviceRegistration, IdentityKeyPair, Membership, PersonCredential } from "../db/types";
import { requestProof } from "./proof";

export class IdentityRequestError extends Error {}

export async function generateIdentityKey(): Promise<IdentityKeyPair> {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  return { private_key: keys.privateKey, public_key: await crypto.subtle.exportKey("jwk", keys.publicKey) };
}

const clocks = new Map<string, { offset: number; sampledAt: number }>();

export async function identityClock(baseUrl: string): Promise<number> {
  const start = Date.now();
  const cached = clocks.get(baseUrl);
  if (cached && start >= cached.sampledAt && start - cached.sampledAt < 60_000) {
    return start + cached.offset;
  }

  try {
    const response = await fetch(`${baseUrl}/health`, { cache: "no-store" });
    if (response.ok) {
      const { time } = await response.json() as { time: string };
      const received = Date.now();
      const offset = Date.parse(time) - Math.round((start + received) / 2);
      if (Number.isFinite(offset)) {
        clocks.set(baseUrl, { offset, sampledAt: received });
        return received + offset;
      }
    }
  } catch {
    // A temporary loss of the health endpoint can reuse the last offset.
  }
  return Date.now() + (cached?.offset ?? 0);
}

async function identityRequest<T>(
  device: DeviceRegistration, deviceKey: CryptoKey, path: string, payload: Record<string, unknown>,
  person?: PersonCredential, method = "POST",
): Promise<T> {
  const baseUrl = getApiBaseUrl();
  const url = `${baseUrl}${path}`;
  const body = JSON.stringify(payload);
  const time = await identityClock(baseUrl);
  const headers = new Headers({
    Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${device.token}`,
    "X-Clintra-Device-Proof": await requestProof(deviceKey, method, url, body, time),
  });
  if (person) {
    headers.set("X-Clintra-Person-Proof", await requestProof(person.private_key, method, url, body, time, person.id));
  }
  const response = await fetch(url, { method, body, headers });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { message?: string } | null;
    throw new IdentityRequestError(data?.message ?? "حدث خطأ، جرّب تاني");
  }
  return response.json();
}

interface Login extends Pick<Membership, "role" | "display_name" | "pin_hash" | "pin_salt" | "rev"> {
  membership_id: string;
  must_change_password: boolean;
}

export async function signIn(db: ClintraDatabase, device: DeviceRegistration, username: string, password: string): Promise<PersonCredential> {
  let deviceKey = await db.device_keys.get(device.id);
  if (!deviceKey) {
    const generated = { device_id: device.id, ...await generateIdentityKey() };
    deviceKey = await db.transaction("rw", db.device_keys, async () => {
      const existing = await db.device_keys.get(device.id);
      if (existing) return existing;
      await db.device_keys.add(generated);
      return generated;
    });
  }
  const keys = await generateIdentityKey();
  const id = crypto.randomUUID();
  const result = await identityRequest<Login>(device, deviceKey.private_key, "/auth/login", {
    username, password, credential_id: id, credential_public_key: keys.public_key,
    device_public_key: deviceKey.bound ? null : deviceKey.public_key,
  });
  const credential: PersonCredential = {
    id, ...keys, device_id: device.id, membership_id: result.membership_id, must_change_password: result.must_change_password,
  };
  await db.transaction("rw", db.device_keys, db.credentials, db.memberships, async () => {
    await db.device_keys.update(device.id, { bound: true });
    const prior = db.credentials.where("[device_id+membership_id]").equals([device.id, result.membership_id]);
    const previousPin = await prior.first();
    if (previousPin?.pin_hash && previousPin.pin_salt) {
      credential.pin_hash = previousPin.pin_hash;
      credential.pin_salt = previousPin.pin_salt;
    }
    await prior.delete();
    await db.credentials.add(credential);
    await db.memberships.update(result.membership_id, {
      role: result.role, display_name: result.display_name, pin_hash: result.pin_hash, pin_salt: result.pin_salt,
    });
  });
  return credential;
}

export async function changeOwnPassword(
  db: ClintraDatabase, device: DeviceRegistration, credential: PersonCredential, currentPassword: string, newPassword: string,
): Promise<void> {
  const deviceKey = await db.device_keys.get(device.id);
  if (!deviceKey || credential.device_id !== device.id) throw new IdentityRequestError("سجّل الدخول على الجهاز ده الأول");
  await identityRequest(device, deviceKey.private_key, "/auth/password", {
    current_password: currentPassword, password: newPassword,
  }, credential);
  await db.credentials.update(credential.id, { must_change_password: false });
}

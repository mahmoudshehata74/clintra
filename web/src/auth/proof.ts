import type { SyncOp } from "../db/types";
import { canonicalizeJcs } from "../sync/jcs";
import type { WireAuditRow } from "../sync/transport";

const encoder = new TextEncoder();
const algorithm = { name: "ECDSA", hash: "SHA-256" };

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function canonicalWireJson(value: unknown): string {
  return canonicalizeJcs(JSON.parse(JSON.stringify(value)));
}

export async function requestMessage(method: string, pathWithQuery: string, unixMs: number, nonce: string, body: string): Promise<string> {
  return ["clintra-req-v1", method.toUpperCase(), pathWithQuery, unixMs, nonce, await sha256(body)].join("\n");
}

export async function opMessage(op: SyncOp, credentialId: string): Promise<string> {
  return [
    "clintra-op-v1", op.op_id, op.device_id, credentialId, op.entity, op.entity_id, op.action,
    op.base_rev ?? "-", op.group_id ?? "-", op.created_at,
    op.action === "delete" || op.payload === undefined ? "-" : await sha256(canonicalWireJson(op.payload)),
  ].join("\n");
}

export async function auditMessage(row: WireAuditRow, deviceId: string, credentialId: string): Promise<string> {
  return [
    "clintra-audit-v1", row.id, deviceId, credentialId, row.entity, row.entity_id, row.action, row.at,
    await sha256(canonicalWireJson({ after: row.after ?? null, before: row.before ?? null })),
  ].join("\n");
}

export async function signProof(privateKey: CryptoKey, message: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.sign(algorithm, privateKey, encoder.encode(message))));
}

export async function requestProof(
  privateKey: CryptoKey, method: string, url: string, body: string, unixMs: number, credentialId?: string,
): Promise<string> {
  const { pathname, search } = new URL(url, location.href);
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
  const signature = await signProof(privateKey, await requestMessage(method, pathname + search, unixMs, nonce, body));
  return ["v1", ...(credentialId ? [credentialId] : []), unixMs, nonce, signature].join(".");
}

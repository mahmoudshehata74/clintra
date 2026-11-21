import { db } from "../db/database";
import type { ClintraDatabase } from "../db/database";
import type { SyncOp } from "../db/types";
import { useLiveQuery } from "../db/useLiveQuery";

export interface RolloutMember {
  id: string;
  display_name: string | null;
  role: string;
  has_username: boolean;
  has_password: boolean;
  signed_in: boolean;
}

export interface RolloutStatus {
  identity_enforced_at: string | null;
  auto_at: string | null;
  waiting: boolean;
  ready: boolean;
  blockers: ("rolloutOwnerMissing" | "rolloutUsernamesMissing" | "rolloutDevicesUnbound")[];
  members: RolloutMember[];
  devices: { id: string; location_id: string; series: number; bound: boolean }[];
}

export function memberNextStep(member: RolloutMember) {
  if (member.role === "owner" && !member.has_password) return "rolloutSetupHint";
  if (!member.has_username) return "rolloutSetUsername";
  if (!member.has_password) return "rolloutSetPassword";
  if (!member.signed_in) return "rolloutMemberSignIn";
  return "rolloutComplete";
}

export function showRolloutWarning(enforcedAt?: string | null, automaticAt?: string | null): boolean {
  return !enforcedAt && Boolean(automaticAt);
}

export function needsAuthorSignIn(op: Pick<SyncOp, "device_id" | "synced_at" | "actor_membership_id">, deviceId: string, signedIn: ReadonlySet<string>): boolean {
  return op.device_id === deviceId && op.synced_at === null
    && (!op.actor_membership_id || !signedIn.has(op.actor_membership_id));
}

export async function rolloutUnsignedCount(database: ClintraDatabase, deviceId: string): Promise<number> {
  const credentials = await database.credentials.toArray();
  const signedIn = new Set(credentials.filter((row) => row.device_id === deviceId && !row.must_change_password)
    .map((row) => row.membership_id));
  return database.sync_ops.filter((op) => needsAuthorSignIn(op, deviceId, signedIn)).count();
}

export function useDeviceAccount(ownerId?: string) {
  return useLiveQuery(async () => {
    const device = (await db.device.toArray()).find((row) => row.token);
    if (!device || !ownerId) return undefined;
    const credential = await db.credentials.where("[device_id+membership_id]").equals([device.id, ownerId]).first();
    return { device, credential: credential?.must_change_password ? undefined : credential };
  }, [ownerId]);
}

import identityStrings from "./identityStrings";
import { createContext, useContext } from "react";
import type { Membership } from "../db/types";
import { Role } from "../domain/role";

export const permissionCatalogue = identityStrings.permissionCatalogue;

export type Permission = keyof typeof permissionCatalogue;
type Member = Pick<Membership, "id" | "role" | "permissions" | "practitioner_id" | "is_active">;
export interface IdentityAccess { enforced: boolean; member?: Member }

export function hasPermission(access: IdentityAccess, permission: Permission, legacy: boolean): boolean {
  if (!access.enforced) return legacy;
  return Boolean(access.member?.is_active && (access.member.role === Role.Owner || access.member.permissions?.includes(permission)));
}

export function canManageCredential(caller: Member, target: Member): boolean {
  return caller.is_active && (caller.role === Role.Owner || (caller.id !== target.id
    && target.role !== Role.Owner && target.role !== Role.Practitioner
    && Boolean(caller.permissions?.includes("staff.manage"))
    && (target.permissions ?? []).every((permission) => caller.permissions?.includes(permission))));
}

export function canEditPermissions(caller: Member, target: Member): boolean {
  return caller.id !== target.id && caller.is_active && (caller.role === Role.Owner
    || (target.role !== Role.Owner && Boolean(caller.permissions?.includes("staff.manage"))));
}

export const IdentityAccessContext = createContext<IdentityAccess>({ enforced: false });

export function useIdentityAccess() {
  const access = useContext(IdentityAccessContext);
  return { ...access, allows: (permission: Permission, legacy = true) => hasPermission(access, permission, legacy) };
}

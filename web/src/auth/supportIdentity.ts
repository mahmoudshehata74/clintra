export function identityChipName(
  supportMode: boolean,
  whoName: string | undefined,
  actingName: string | undefined,
  supportAdminName: string | undefined,
): string | undefined {
  return supportMode ? (supportAdminName ? `دعم كلينترا — ${supportAdminName}` : undefined) : whoName ?? actingName;
}

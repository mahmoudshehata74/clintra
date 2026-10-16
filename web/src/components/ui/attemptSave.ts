/**
 * Runs a write and reports whether it went through: false when it rejected
 * (refused, or a storage error), so a control can show SaveFailedLine
 * instead of leaving an unhandled rejection and no message.
 */
export async function attemptSave(save: () => Promise<unknown>): Promise<boolean> {
  try {
    await save();
    return true;
  } catch {
    return false;
  }
}

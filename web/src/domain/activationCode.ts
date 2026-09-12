// Matches api/app/Support/ActivationCode.php's own shape exactly:
// CLT-XXXX-XXXX-XXXX-XXXX, 16 significant characters in groups of 4.
const GROUP_LENGTH = 4;
const GROUP_COUNT = 4;
const PREFIX = "CLT-";

/**
 * Reformats an activation-code field's raw value into CLT-XXXX-XXXX-XXXX-XXXX
 * as the assistant types, tolerant of a pasted code with or without dashes
 * and with or without the "CLT" prefix (typing it is harmless; pasting a
 * code that already has it must not double it up). Never rejects a
 * character outright — an out-of-alphabet character (the server's alphabet
 * excludes 0/O/1/I/L) is left for the server's own generic failure to
 * catch, not silently dropped, so a mistyped character stays visible to
 * correct rather than disappearing.
 */
export function formatActivationCodeInput(raw: string): string {
  const withoutPrefix = raw.toUpperCase().replace(/^CLT-?/, "");
  const significant = withoutPrefix.replace(/[^A-Z0-9]/g, "").slice(0, GROUP_LENGTH * GROUP_COUNT);

  if (significant.length === 0) {
    return "";
  }

  const groups: string[] = [];
  for (let start = 0; start < significant.length; start += GROUP_LENGTH) {
    groups.push(significant.slice(start, start + GROUP_LENGTH));
  }
  return PREFIX + groups.join("-");
}

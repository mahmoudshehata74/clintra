import { formatActivationCodeInput } from "./activationCode";

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** The same 16-character code shape and alphabet as the API activation code. */
export function generateSupportCode(): string {
  const chars: string[] = [];
  const limit = Math.floor(256 / ALPHABET.length) * ALPHABET.length;
  while (chars.length < 16) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    for (const byte of bytes) {
      if (byte < limit) chars.push(ALPHABET[byte % ALPHABET.length]);
      if (chars.length === 16) break;
    }
  }
  return formatActivationCodeInput(chars.join(""));
}

export async function hashSupportCode(input: string): Promise<string> {
  const normalized = formatActivationCodeInput(input);
  if (normalized.length !== "CLT-XXXX-XXXX-XXXX-XXXX".length) throw new Error("invalid_support_code");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Generates a UUID v4 on the client. Identifiers are always client-generated, never assigned by a server. */
export function id(): string {
  return crypto.randomUUID();
}

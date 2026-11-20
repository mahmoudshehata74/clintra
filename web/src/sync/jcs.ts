/** RFC 8785 canonicalization of a value decoded from the JSON wire body. */
export function canonicalizeJcs(value: unknown): string {
  if (value === null || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (typeof value === "string" && !/[\uD800-\uDFFF]/u.test(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJcs).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    const members = Object.keys(object).sort().map((key) => `${canonicalizeJcs(key)}:${canonicalizeJcs(object[key])}`);
    return `{${members.join(",")}}`;
  }
  throw new TypeError("Value cannot be represented in canonical JSON");
}

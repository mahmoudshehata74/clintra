/** Checks fixed support expiry immediately, on focus, and at the expiry instant. */
export function watchSupportExpiry(readExpiry: () => Promise<string | null>, onExpired: () => void): () => void {
  let stopped = false;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function check() {
    if (stopped || expired) return;
    const expiresAt = await readExpiry();
    if (stopped || expired) return;
    const delay = expiresAt === null ? 0 : Date.parse(expiresAt) - Date.now();
    if (!Number.isFinite(delay) || delay <= 0) {
      expired = true;
      onExpired();
      return;
    }
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => void check(), delay);
  }
  void check();
  window.addEventListener("focus", check);
  return () => { stopped = true; if (timer !== undefined) clearTimeout(timer); window.removeEventListener("focus", check); };
}

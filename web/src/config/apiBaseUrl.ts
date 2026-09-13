/**
 * The API's base URL. Every real network call in this app (device
 * registration, the sync transport) goes through this, never a hardcoded
 * path of its own — a second hardcoded "/api" elsewhere would silently
 * stop matching the moment this variable is actually configured.
 *
 * Read from a build-time env var (Vite requires the `VITE_` prefix to
 * expose it to client code at all — see
 * https://vite.dev/guide/env-and-mode.html#env-variables). Unset falls
 * back to "/api", a same-origin relative path — exactly what every fetch
 * in this app has always used, so a build with nothing configured (every
 * local dev run today, every test run, any build before a real API
 * deployment exists to point at) behaves identically to before this
 * variable existed. Vite's dev-server proxy (vite.config.ts) is what
 * makes that relative path reach a local Laravel instance in dev; nothing
 * about that changes here.
 */
export function getApiBaseUrl(): string {
  return import.meta.env.VITE_API_BASE_URL || "/api";
}

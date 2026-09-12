import { normalizeEgyptianPhone } from "../domain/phone";
import type { ClintraDatabase } from "./database";
import { getDeviceId } from "./deviceRegistration";
import type { Location, Membership, Organization, Practitioner, User } from "./types";

const REGISTER_ENDPOINT = "/api/devices/register";

/** Matches POST /api/devices/register's response exactly (DeviceRegistrationController::register). */
interface RegisterDeviceResponseBody {
  token: string;
  device_id: string;
  org_id: string;
  location_id: string;
  membership_id: string;
  organization: Organization;
  locations: Location[];
  practitioners: Practitioner[];
  memberships: Membership[];
  users: User[];
}

/** Every JSON error this API returns shares this shape (api/bootstrap/app.php's exception renderers). */
interface ApiErrorBody {
  error: string;
  message: string;
  errors?: Record<string, string[]>;
}

export interface RegisterDeviceInput {
  phone: string;
  activationCode: string;
}

export type RegisterDeviceResult =
  | { ok: true; locations: Location[]; locationId: string }
  | { ok: false; message: string };

/**
 * Calls the real registration endpoint and, on success, bootstraps this
 * device's local database from the response and writes the `device` row
 * with its token — docs/auth-plan.md's registration credential
 * resolution, screen 1 in docs/reference/clintra-screens.html.
 *
 * Every failure — a malformed phone caught before the request even goes
 * out, a wrong/expired/used activation code (401, deliberately generic),
 * a rate limit (429), a network failure — resolves to the same `{ok:
 * false, message}` shape with an Arabic string ready to show as-is. This
 * function never guesses which field was wrong for the server's own
 * generic 401; it only surfaces a per-field message when the server
 * itself already attributes one (a genuine 422 shape error).
 *
 * `fetchImpl` is overridable for tests; defaults to the global fetch. The
 * token is never logged and never appears in a URL — it travels only in
 * this POST's JSON body and this function's own return value, then is
 * written straight to IndexedDB (db/deviceRegistration.ts's `device`
 * table) via bootstrapFromRegistration below.
 */
export async function registerDevice(
  db: ClintraDatabase,
  input: RegisterDeviceInput,
  fetchImpl: typeof fetch = fetch,
): Promise<RegisterDeviceResult> {
  const normalizedPhone = normalizeEgyptianPhone(input.phone);
  if (!normalizedPhone.ok) {
    return { ok: false, message: "رقم الموبايل غير صالح" };
  }

  let response: Response;
  try {
    response = await fetchImpl(REGISTER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        phone: normalizedPhone.value,
        activation_code: input.activationCode,
        device_id: getDeviceId(),
      }),
    });
  } catch {
    return { ok: false, message: "تعذر الاتصال بالخادم — تأكد من الإنترنت وحاول مرة أخرى" };
  }

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as ApiErrorBody | null;
    const firstFieldMessage = errorBody?.errors ? Object.values(errorBody.errors)[0]?.[0] : undefined;
    return { ok: false, message: firstFieldMessage ?? errorBody?.message ?? "حدث خطأ غير متوقع — حاول مرة أخرى" };
  }

  const body = (await response.json()) as RegisterDeviceResponseBody;
  await bootstrapFromRegistration(db, body);
  return { ok: true, locations: body.locations, locationId: body.location_id };
}

/**
 * Writes the registration response's rows directly — bulkPut, never
 * mutate() — because these are server-authoritative facts about
 * organizations/locations/practitioners/memberships/users this device
 * did not create and must not queue a sync_ops row claiming it did (see
 * db/seed.ts's identical reasoning for its own demo data, and
 * api/docs/rls.md's "The sync endpoint is accept-or-reject only" for why
 * a device inventing history for a row it was only ever handed is the
 * same class of problem in reverse). Each membership row already carries
 * its real server `rev`, straight from the response.
 */
async function bootstrapFromRegistration(db: ClintraDatabase, response: RegisterDeviceResponseBody): Promise<void> {
  await db.transaction(
    "rw",
    [db.organizations, db.locations, db.practitioners, db.memberships, db.users, db.device],
    async () => {
      await db.organizations.put(response.organization);
      await db.locations.bulkPut(response.locations);
      await db.practitioners.bulkPut(response.practitioners);
      await db.memberships.bulkPut(response.memberships);
      await db.users.bulkPut(response.users);
      await db.device.put({
        id: response.device_id,
        org_id: response.org_id,
        location_id: response.location_id,
        membership_id: response.membership_id,
        registered_at: new Date().toISOString(),
        pull_cursor: null,
        token: response.token,
      });
    },
  );
}

/** True once this browser holds a real, server-issued device credential — screen 1 never shows again after this. */
export async function isDeviceRegistered(db: ClintraDatabase): Promise<boolean> {
  const rows = await db.device.toArray();
  return rows.some((row) => row.token !== null);
}

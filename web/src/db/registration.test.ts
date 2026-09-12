import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClintraDatabase } from "./database";
import { resetDeviceIdCacheForTests } from "./deviceRegistration";
import { isDeviceRegistered, registerDevice } from "./registration";

let db: ClintraDatabase;

beforeEach(() => {
  db = new ClintraDatabase(`clintra-registration-test-${crypto.randomUUID()}`);
  resetDeviceIdCacheForTests();
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A realistic POST /api/devices/register success body (DeviceRegistrationController::register). */
function makeSuccessBody(overrides: Record<string, unknown> = {}) {
  const orgId = "org-1";
  const locationId = "location-1";
  const userId = "user-1";
  const membershipId = "membership-1";
  return {
    token: "1|plain-text-token",
    device_id: "device-1",
    org_id: orgId,
    location_id: locationId,
    membership_id: membershipId,
    organization: { id: orgId, name: "عيادة تجريبية", plan_tier: "small", created_at: "2026-09-07T06:00:00.000Z" },
    locations: [
      { id: locationId, org_id: orgId, name: "الفرع الرئيسي", address: "شارع", phone: "+20221234567", is_active: true },
    ],
    practitioners: [
      { id: "practitioner-1", org_id: orgId, user_id: null, full_name: "د. أحمد", specialty_id: "spec-1", title: "طبيب", is_active: true },
    ],
    memberships: [
      {
        id: membershipId,
        user_id: userId,
        org_id: orgId,
        role: "owner",
        location_scope: "all",
        practitioner_scope: "all",
        practitioner_id: null,
        pin_hash: "hash",
        pin_salt: "salt",
        is_active: true,
        rev: 1,
      },
    ],
    users: [{ id: userId, full_name: "منى الشريف", phone: "+201001234567", email: null, is_active: true }],
    ...overrides,
  };
}

describe("registerDevice", () => {
  it("on success, stores the token on the device row and writes every bootstrap row", async () => {
    const body = makeSuccessBody();
    const fetchImpl = vi.fn(async () => jsonResponse(200, body));

    const result = await registerDevice(db, { phone: "01001234567", activationCode: "CLT-7F3K-9QRT-4XWM-2BCD" }, fetchImpl);

    expect(result.ok).toBe(true);

    const [device] = await db.device.toArray();
    expect(device.token).toBe(body.token);
    expect(device.org_id).toBe(body.org_id);
    expect(device.location_id).toBe(body.location_id);
    expect(device.membership_id).toBe(body.membership_id);

    expect(await db.organizations.get(body.org_id)).toMatchObject({ name: body.organization.name });
    expect(await db.locations.get(body.location_id)).toMatchObject({ name: body.locations[0].name });
    expect(await db.practitioners.get("practitioner-1")).toMatchObject({ full_name: "د. أحمد" });
    expect(await db.memberships.get(body.membership_id)).toMatchObject({ rev: 1, pin_hash: "hash" });
    expect(await db.users.get("user-1")).toMatchObject({ full_name: "منى الشريف" });
  });

  it("the bootstrap writes no sync_ops — these are server-authoritative rows, not this device's own writes", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, makeSuccessBody()));

    await registerDevice(db, { phone: "01001234567", activationCode: "CLT-7F3K-9QRT-4XWM-2BCD" }, fetchImpl);

    expect(await db.sync_ops.count()).toBe(0);
    expect(await db.audit_log.count()).toBe(0);
  });

  it("sends the normalised E.164 phone and the device's own id in the request body", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    fetchImpl.mockImplementation(async () => jsonResponse(200, makeSuccessBody()));

    await registerDevice(db, { phone: "01001234567", activationCode: "CLT-7F3K-9QRT-4XWM-2BCD" }, fetchImpl);

    const init = fetchImpl.mock.calls[0][1];
    const sentBody = JSON.parse(init?.body as string);
    expect(sentBody.phone).toBe("+201001234567");
    expect(sentBody.activation_code).toBe("CLT-7F3K-9QRT-4XWM-2BCD");
    expect(sentBody.device_id).toBeTruthy();
  });

  it("an invalid phone fails locally with a generic Arabic message, without ever calling the network", async () => {
    const fetchImpl = vi.fn();

    const result = await registerDevice(db, { phone: "not-a-phone", activationCode: "CLT-7F3K-9QRT-4XWM-2BCD" }, fetchImpl);

    expect(result).toEqual({ ok: false, message: "رقم الموبايل غير صالح" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("shows the server's own generic message on a wrong/expired/used activation code, verbatim, never guessing a field", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(401, { error: "registration_failed", message: "فشل التفعيل — تأكد من رقم الهاتف وكود التفعيل" }),
    );

    const result = await registerDevice(db, { phone: "01001234567", activationCode: "CLT-7F3K-9QRT-4XWM-2BCD" }, fetchImpl);

    expect(result).toEqual({ ok: false, message: "فشل التفعيل — تأكد من رقم الهاتف وكود التفعيل" });
    expect(await db.device.count()).toBe(0);
  });

  it("shows a rate-limit response's own message, handling lockout gracefully rather than looking broken", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(429, { error: "too_many_attempts", message: "محاولات كثيرة جدًا — حاول لاحقًا" }),
    );

    const result = await registerDevice(db, { phone: "01001234567", activationCode: "CLT-7F3K-9QRT-4XWM-2BCD" }, fetchImpl);

    expect(result).toEqual({ ok: false, message: "محاولات كثيرة جدًا — حاول لاحقًا" });
  });

  it("prefers a field-specific validation message when the server structures one (a real 422 shape error)", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(422, {
        error: "validation_failed",
        message: "بيانات غير صالحة",
        errors: { activation_code: ["صيغة كود التفعيل غير صحيحة"] },
      }),
    );

    const result = await registerDevice(db, { phone: "01001234567", activationCode: "not-a-real-code" }, fetchImpl);

    expect(result).toEqual({ ok: false, message: "صيغة كود التفعيل غير صحيحة" });
  });

  it("surfaces a network failure with a retry-friendly Arabic message rather than throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });

    const result = await registerDevice(db, { phone: "01001234567", activationCode: "CLT-7F3K-9QRT-4XWM-2BCD" }, fetchImpl);

    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toContain("تعذر الاتصال");
  });
});

describe("isDeviceRegistered", () => {
  it("is false when no device row exists at all", async () => {
    expect(await isDeviceRegistered(db)).toBe(false);
  });

  it("is false for a demo/dev-bound device row with no token — the activation screen must still show", async () => {
    await db.device.add({
      id: "device-1",
      org_id: "org-1",
      location_id: "location-1",
      registered_at: "2026-09-07T06:00:00.000Z",
      pull_cursor: null,
      membership_id: null,
      token: null,
    });

    expect(await isDeviceRegistered(db)).toBe(false);
  });

  it("is true once a real registration has stored a token — the screen must never show again", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, makeSuccessBody()));
    await registerDevice(db, { phone: "01001234567", activationCode: "CLT-7F3K-9QRT-4XWM-2BCD" }, fetchImpl);

    expect(await isDeviceRegistered(db)).toBe(true);
  });
});

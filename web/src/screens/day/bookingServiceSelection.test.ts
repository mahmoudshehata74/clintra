import { describe, expect, it } from "vitest";
import { resolveSelectedService } from "./bookingServiceSelection";
import type { Service } from "../../db/types";

function service(id: string, name: string): Service {
  return { id, org_id: "org-1", name, duration_minutes: 15, default_price: 30000, is_active: true } as Service;
}

const CONSULT = service("service-1", "كشف");
const FOLLOW_UP = service("service-2", "متابعة");
const INJECTION = service("service-3", "حقنة");
const SERVICES = [CONSULT, FOLLOW_UP, INJECTION];

describe("resolveSelectedService", () => {
  it("defaults to the first service when nothing is explicitly selected", () => {
    expect(resolveSelectedService(SERVICES, null)).toBe(CONSULT);
  });

  it("returns the explicitly selected service when it exists in the list", () => {
    expect(resolveSelectedService(SERVICES, "service-2")).toBe(FOLLOW_UP);
  });

  it("falls back to the first service when the selected id is no longer in the list", () => {
    expect(resolveSelectedService(SERVICES, "service-stale")).toBe(CONSULT);
  });

  it("returns null when there are no services at all", () => {
    expect(resolveSelectedService([], null)).toBeNull();
  });
});

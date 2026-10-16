import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpStaffServer, StaffServerError, type AddStaffRequest, type AddStaffResponse } from "./staffServer";

const request: AddStaffRequest = {
  membership_id: "membership-1",
  user_id: "user-1",
  display_name: "منى",
  phone: "+201098765432",
  role: "assistant",
  location_scope: "all",
  practitioner_scope: "all",
  practitioner_id: null,
  pin_hash: "a".repeat(64),
  pin_salt: "b".repeat(32),
  locations: [],
  practitioners: [],
} as AddStaffRequest;

function serverAnswering(status: number, body: unknown = {}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { server: new HttpStaffServer("1|token", "https://api.example/api", fetchImpl), calls };
}

describe("HttpStaffServer", () => {
  it("posts the request with the device token and returns the created rows on 201", async () => {
    const created = { membership: { id: "membership-1" }, membership_locations: [], membership_practitioners: [] };
    const { server, calls } = serverAnswering(201, created);

    expect(await server.addStaffMember(request)).toEqual(created as unknown as AddStaffResponse);
    expect(calls[0].url).toBe("https://api.example/api/staff");
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer 1|token");
    expect(JSON.parse(calls[0].init.body as string)).toEqual(request);
  });

  it.each([
    [409, "already_member"],
    [404, "not_allowed"],
    [422, "failed"],
    [401, "failed"],
    [500, "failed"],
  ] as const)("reads %i as %s", async (status, reason) => {
    const { server } = serverAnswering(status);
    await expect(server.addStaffMember(request)).rejects.toEqual(new StaffServerError(reason));
  });

  it("reads a network failure as unreachable", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const server = new HttpStaffServer("1|token", "https://api.example/api", fetchImpl);
    await expect(server.addStaffMember(request)).rejects.toMatchObject({ reason: "unreachable" });
  });
});

describe("HttpStaffServer without a fetchImpl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the global fetch as a plain function, as a browser requires", async () => {
    const created = { membership: { id: "membership-1" }, membership_locations: [], membership_practitioners: [] };
    // A browser's fetch refuses any receiver other than the window ("Illegal invocation").
    vi.stubGlobal("fetch", function strictFetch(this: unknown) {
      if (this !== undefined && this !== globalThis) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      return Promise.resolve(new Response(JSON.stringify(created), { status: 201 }));
    });
    const server = new HttpStaffServer("1|token", "https://api.example/api");

    expect(await server.addStaffMember(request)).toEqual(created as unknown as AddStaffResponse);
  });
});

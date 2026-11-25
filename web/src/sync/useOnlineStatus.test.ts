import { afterEach, expect, it, vi } from "vitest";

const health = vi.hoisted(() => ({ unreachable: false }));
vi.mock("./engine", () => ({
  SYNC_TRANSPORT_STATUS_EVENT_NAME: "clintra:sync-transport-status",
  isServerUnreachable: () => health.unreachable,
}));

afterEach(() => { vi.unstubAllGlobals(); health.unreachable = false; });

it("gives two consumers the same first snapshot and every subsequent connectivity change", async () => {
  const events = new EventTarget();
  let online = false;
  vi.stubGlobal("window", events);
  vi.stubGlobal("navigator", { get onLine() { return online; } });
  const { getConnectionSnapshot, subscribeConnectionStatus } = await import("./useOnlineStatus");
  const seenA = [getConnectionSnapshot()];
  const seenB = [getConnectionSnapshot()];
  const stopA = subscribeConnectionStatus(() => seenA.push(getConnectionSnapshot()));
  const stopB = subscribeConnectionStatus(() => seenB.push(getConnectionSnapshot()));
  online = true;
  events.dispatchEvent(new Event("online"));
  health.unreachable = true;
  events.dispatchEvent(new Event("clintra:sync-transport-status"));
  online = false;
  events.dispatchEvent(new Event("offline"));
  expect(seenA).toEqual(["offline", "online", "server_unreachable", "offline"]);
  expect(seenB).toEqual(seenA);
  stopA(); stopB();
});

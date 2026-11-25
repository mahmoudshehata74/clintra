import Dexie from "dexie";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); });

it("selects an isolated support database and wipes only that name", async () => {
  vi.resetModules();
  const storage = new Map<string, string>();
  const replaceState = vi.fn();
  vi.stubGlobal("window", { location: { hash: "#support=one-time", pathname: "/", search: "" }, history: { state: null, replaceState }, fetch });
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  });
  const { isSupportMode, supportEntryCode } = await import("./supportMode");
  const { ClintraDatabase, db } = await import("../db/database");
  const { wipeSupportAccess } = await import("./supportAccess");
  const { mutate } = await import("../db/mutate");
  expect(supportEntryCode).toBe("one-time");
  expect(replaceState).toHaveBeenCalledWith(null, "", "/");
  expect(isSupportMode()).toBe(true);
  expect(document.documentElement.dataset.supportMode).toBe("true");
  expect(db.name).toBe("clintra-support");

  const clinic = new ClintraDatabase("clintra");
  await clinic.preferences.put({ key: "clinic-marker", value: "preserve" });
  await db.preferences.put({ key: "support-marker", value: "remove" });
  await expect(mutate(db, { table: db.patients, entity: "patients", entityId: "x", action: "create",
    before: null, after: null, actorMembershipId: "x", orgId: "x" })).rejects.toThrow("جهاز الدعم للقراءة بس");
  expect(await db.audit_log.count()).toBe(0);

  await wipeSupportAccess();
  expect(await Dexie.exists("clintra-support")).toBe(false);
  expect(await clinic.preferences.get("clinic-marker")).toEqual({ key: "clinic-marker", value: "preserve" });
  clinic.close();
  expect(isSupportMode()).toBe(false);
  expect(storage.has("clintra:support-mode")).toBe(false);
});

it("dispatches the support auth-error path on any 401 and wipes only support storage", async () => {
  vi.resetModules();
  const events = new EventTarget();
  const supportFetch = vi.fn(async () => new Response(null, { status: 401 }));
  vi.stubGlobal("window", Object.assign(events, {
    location: { hash: "#support=single-use", pathname: "/", search: "" },
    history: { state: null, replaceState: vi.fn() }, fetch: supportFetch,
  }));
  vi.stubGlobal("document", { documentElement: { dataset: {} } });
  const storage = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  });
  const { observeSupport401 } = await import("./supportMode");
  const { ClintraDatabase, db } = await import("../db/database");
  const { wipeSupportAccess } = await import("./supportAccess");
  const clinic = new ClintraDatabase("clintra");
  await clinic.preferences.put({ key: "clinic-marker", value: "keep" });
  await db.preferences.put({ key: "support-marker", value: "remove" });
  let wipe: Promise<void> | undefined;
  events.addEventListener("clintra:sync-auth-error", () => { wipe = wipeSupportAccess(); });
  observeSupport401();
  await window.fetch("/api/health");
  expect(supportFetch).toHaveBeenCalledWith("/api/health", undefined);
  expect(wipe).toBeDefined();
  await wipe;
  expect(await Dexie.exists("clintra-support")).toBe(false);
  expect(await clinic.preferences.get("clinic-marker")).toEqual({ key: "clinic-marker", value: "keep" });
  clinic.close();
});

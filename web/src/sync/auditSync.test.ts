import { beforeEach, describe, expect, it } from "vitest";
import { ClintraDatabase } from "../db/database";
import { getDeviceId } from "../db/deviceRegistration";
import { AuditAction, type AuditLog, type RemoteAuditLog } from "../db/types";
import { addDaysToClinicDay, cairoInstant, todayInCairo } from "../domain/time";
import {
  AUDIT_PUSH_BATCH,
  pruneRemoteAuditRows,
  runAuditPull,
  runAuditPush,
  storePulledAuditRows,
  toWireAuditRow,
} from "./auditSync";
import { runAuditCycle } from "./engine";
import { FakeTransport } from "./fakeTransport";
import {
  SyncAuthError,
  type AuditTransport,
  type PullAuditResult,
  type PullSinceResult,
  type PushAuditResult,
  type PushOpResult,
  type SyncTransport,
  type WireAuditRow,
} from "./transport";

let db: ClintraDatabase;

beforeEach(async () => {
  db = await deviceDatabase();
});

/** A registered device's local database. */
async function deviceDatabase(): Promise<ClintraDatabase> {
  const local = new ClintraDatabase(`clintra-audit-sync-test-${crypto.randomUUID()}`);
  await local.device.put({
    id: getDeviceId(),
    org_id: "org-1",
    location_id: "location-1",
    registered_at: "2026-10-01T06:00:00.000Z",
    pull_cursor: null,
    membership_id: "membership-1",
    token: "token",
    series: 1,
  });
  return local;
}

function auditRow(seq: number, overrides: Partial<AuditLog> = {}): AuditLog {
  return {
    id: crypto.randomUUID(),
    seq,
    org_id: "org-1",
    actor_membership_id: "membership-2",
    entity: "patients",
    entity_id: crypto.randomUUID(),
    action: AuditAction.Create,
    before: null,
    after: { full_name: "كريم فتحي" },
    at: new Date().toISOString(),
    ...overrides,
  };
}

async function writeRows(target: ClintraDatabase, count: number, from = 1): Promise<AuditLog[]> {
  const rows = Array.from({ length: count }, (_, index) => auditRow(from + index));
  await target.audit_log.bulkAdd(rows);
  return rows;
}

async function watermark(target: ClintraDatabase = db): Promise<number | undefined> {
  return (await target.device.get(getDeviceId()))?.audit_pushed_seq;
}

/** An audit transport answering each pushed row by a script; pulls are empty. */
class ScriptedAuditTransport implements AuditTransport {
  pushed: WireAuditRow[][] = [];
  pulled: (string | null)[] = [];
  private readonly answer: (row: WireAuditRow, index: number) => PushAuditResult["status"] | Error;
  private readonly pages: PullAuditResult[];

  constructor(answer: (row: WireAuditRow, index: number) => PushAuditResult["status"] | Error = () => "accepted", pages: PullAuditResult[] = []) {
    this.answer = answer;
    this.pages = pages;
  }

  async pushAuditRows(rows: readonly WireAuditRow[]): Promise<PushAuditResult[]> {
    this.pushed.push([...rows]);
    return rows.map((row, index) => {
      const status = this.answer(row, index);
      if (status instanceof Error) {
        throw status;
      }
      return status === "accepted" || status === "duplicate" ? { id: row.id, status } : { id: row.id, status, reason: "test" };
    });
  }

  async pullAuditSince(cursor: string | null): Promise<PullAuditResult> {
    this.pulled.push(cursor);
    return this.pages.shift() ?? { cursor: cursor ?? "0", hasMore: false, rows: [] };
  }
}

describe("toWireAuditRow", () => {
  it("sends the row without its seq or a membership's PIN fields, tagged by its record", () => {
    const visitRow = auditRow(7, { entity: "visits", after: { location_id: "location-1", practitioner_id: "pr-1", status: "booked" } });
    expect(toWireAuditRow(visitRow, new Map())).toEqual({
      id: visitRow.id,
      org_id: "org-1",
      location_id: "location-1",
      practitioner_id: "pr-1",
      actor_membership_id: "membership-2",
      entity: "visits",
      entity_id: visitRow.entity_id,
      action: AuditAction.Create,
      before: null,
      after: visitRow.after,
      at: visitRow.at,
    });

    const membershipRow = auditRow(8, {
      entity: "memberships",
      action: AuditAction.Update,
      before: { role: "assistant", pin_hash: "a", pin_salt: "b" },
      after: { role: "manager", pin_hash: "c", pin_salt: "d" },
    });
    const wire = toWireAuditRow(membershipRow, new Map());
    expect(wire.before).toEqual({ role: "assistant" });
    expect(wire.after).toEqual({ role: "manager" });
    // The local row keeps them.
    expect(membershipRow.after).toEqual({ role: "manager", pin_hash: "c", pin_salt: "d" });
  });

  it("tags a child by its parent, and leaves it organization-wide without one", () => {
    const item = auditRow(9, { entity: "prescription_items", after: { prescription_id: "rx-1", name: "بنادول" } });
    expect(toWireAuditRow(item, new Map([["rx-1", { location_id: "location-1", practitioner_id: "pr-1" }]]))).toMatchObject({
      location_id: "location-1",
      practitioner_id: "pr-1",
    });
    expect(toWireAuditRow(item, new Map())).toMatchObject({ location_id: null, practitioner_id: null });
  });
});

describe("runAuditPush", () => {
  it("pushes every local row once, in seq order, 200 a request", async () => {
    const rows = await writeRows(db, AUDIT_PUSH_BATCH + 1);
    const transport = new ScriptedAuditTransport();

    expect(await runAuditPush(db, transport)).toBe("done");

    expect(transport.pushed.map((batch) => batch.length)).toEqual([AUDIT_PUSH_BATCH, 1]);
    expect(transport.pushed.flat().map((row) => row.id)).toEqual(rows.map((row) => row.id));
    expect(await watermark()).toBe(AUDIT_PUSH_BATCH + 1);

    await runAuditPush(db, transport);
    expect(transport.pushed).toHaveLength(2);
  });

  it("moves past accepted, duplicate and rejected rows and stops at a failed one", async () => {
    await writeRows(db, 5);
    const statuses: PushAuditResult["status"][] = ["accepted", "duplicate", "rejected", "failed", "accepted"];
    const transport = new ScriptedAuditTransport((_, index) => statuses[index]);

    await runAuditPush(db, transport);

    expect(await watermark()).toBe(3);
    expect(transport.pushed).toHaveLength(1);
    // The failed row is first next time.
    await runAuditPush(db, new ScriptedAuditTransport());
    expect(await watermark()).toBe(5);
  });

  it("leaves the watermark when the request fails, and says why", async () => {
    await writeRows(db, 2);

    expect(await runAuditPush(db, new ScriptedAuditTransport(() => new Error("offline")))).toBe("unreachable");
    expect(await runAuditPush(db, new ScriptedAuditTransport(() => new SyncAuthError()))).toBe("unauthenticated");
    expect(await watermark()).toBeUndefined();
  });

  it("starts above the rows already answered for", async () => {
    await writeRows(db, 3);
    await db.device.update(getDeviceId(), { audit_pushed_seq: 2 });
    const transport = new ScriptedAuditTransport();

    await runAuditPush(db, transport);

    expect(transport.pushed.flat().length).toBe(1);
    expect(await watermark()).toBe(3);
  });
});

describe("runAuditPull and storePulledAuditRows", () => {
  function pulledRow(overrides: Partial<RemoteAuditLog> = {}): RemoteAuditLog {
    return {
      ...toWireAuditRow(auditRow(1), new Map()),
      device_id: "device-b",
      ...overrides,
    };
  }

  it("stores each page and its cursor, starting from no cursor", async () => {
    const first = pulledRow();
    const second = pulledRow();
    const transport = new ScriptedAuditTransport(undefined, [
      { cursor: "10", hasMore: true, rows: [first] },
      { cursor: "11", hasMore: false, rows: [second] },
    ]);

    expect(await runAuditPull(db, transport)).toBe("done");

    expect(transport.pulled).toEqual([null, "10"]);
    expect((await db.device.get(getDeviceId()))?.audit_pull_cursor).toBe("11");
    expect((await db.remote_audit_log.toArray()).map((row) => row.id).sort()).toEqual([first.id, second.id].sort());

    await runAuditPull(db, transport);
    expect(transport.pulled).toEqual([null, "10", "11"]);
  });

  it("never overwrites a row either store already holds", async () => {
    const own = auditRow(1);
    await db.audit_log.add(own);
    const held = pulledRow({ actor_membership_id: "membership-3" });
    await db.remote_audit_log.add(held);

    await storePulledAuditRows(db, [
      pulledRow({ id: own.id }),
      { ...held, actor_membership_id: "membership-4" },
    ]);

    expect(await db.remote_audit_log.count()).toBe(1);
    expect((await db.remote_audit_log.get(held.id))?.actor_membership_id).toBe("membership-3");
    expect(await db.audit_log.get(own.id)).toEqual(own);
  });

  it("keeps no pulled row older than 60 Cairo days, and the prune removes only pulled rows", async () => {
    const today = todayInCairo();
    const oldest = cairoInstant(addDaysToClinicDay(today, -59), "00:00");
    const tooOld = new Date(new Date(oldest).getTime() - 1).toISOString();
    const kept = pulledRow({ at: oldest });

    await storePulledAuditRows(db, [kept, pulledRow({ at: tooOld })]);
    expect((await db.remote_audit_log.toArray()).map((row) => row.id)).toEqual([kept.id]);

    const ownOld = auditRow(1, { at: tooOld });
    await db.audit_log.add(ownOld);
    const pulledThen = pulledRow({ at: tooOld });
    await db.remote_audit_log.add(pulledThen);

    await pruneRemoteAuditRows(db);

    expect((await db.remote_audit_log.toArray()).map((row) => row.id)).toEqual([kept.id]);
    expect(await db.audit_log.get(ownOld.id)).toEqual(ownOld);
  });
});

describe("two devices through FakeTransport", () => {
  it("A's rows reach B once; B never receives its own", async () => {
    const serverName = `clintra-audit-sync-server-${crypto.randomUUID()}`;
    const deviceA = await deviceDatabase();
    const asA = new FakeTransport(serverName, () => "device-a");
    const asB = new FakeTransport(serverName, () => "device-b");
    const rowsA = await writeRows(deviceA, 2);
    const rowsB = await writeRows(db, 1);

    await runAuditPush(deviceA, asA);
    await runAuditPush(db, asB);
    await runAuditPull(db, asB);
    // A resend and a second pull change nothing.
    await deviceA.device.update(getDeviceId(), { audit_pushed_seq: 0 });
    await runAuditPush(deviceA, asA);
    await runAuditPull(db, asB);

    const pulled = await db.remote_audit_log.toArray();
    expect(pulled.map((row) => row.id).sort()).toEqual(rowsA.map((row) => row.id).sort());
    expect(pulled.every((row) => row.device_id === "device-a")).toBe(true);
    expect(pulled.some((row) => row.id === rowsB[0].id)).toBe(false);
  });

  it("the fake server answers as the real one does for a resend, a changed resend, an unknown entity and a PIN field", async () => {
    const transport = new FakeTransport(`clintra-audit-sync-server-${crypto.randomUUID()}`, () => "device-a");
    const row = toWireAuditRow(auditRow(1), new Map());

    expect(await transport.pushAuditRows([row])).toEqual([{ id: row.id, status: "accepted" }]);
    expect(await transport.pushAuditRows([row])).toEqual([{ id: row.id, status: "duplicate" }]);
    expect(await transport.pushAuditRows([{ ...row, after: { full_name: "غيره" } }])).toEqual([
      { id: row.id, status: "rejected", reason: "audit_id_taken" },
    ]);
    const device = { ...row, id: crypto.randomUUID(), entity: "device" };
    const secret = { ...row, id: crypto.randomUUID(), entity: "memberships", after: { pin_hash: "x" } };
    expect(await transport.pushAuditRows([device, secret])).toEqual([
      { id: device.id, status: "rejected", reason: "unknown_entity" },
      { id: secret.id, status: "rejected", reason: "audit_secret_field" },
    ]);
  });

  it("a first pull from the fake server starts 14 Cairo days back", async () => {
    const serverName = `clintra-audit-sync-server-${crypto.randomUUID()}`;
    const asA = new FakeTransport(serverName, () => "device-a");
    const windowStart = cairoInstant(addDaysToClinicDay(todayInCairo(), -13), "00:00");
    const old = toWireAuditRow(auditRow(1, { at: new Date(new Date(windowStart).getTime() - 1).toISOString() }), new Map());
    const recent = toWireAuditRow(auditRow(2, { at: windowStart }), new Map());
    await asA.pushAuditRows([old, recent]);

    const page = await new FakeTransport(serverName, () => "device-b").pullAuditSince(null);

    expect(page.rows.map((row) => row.id)).toEqual([recent.id]);
    expect((await new FakeTransport(serverName, () => "device-b").pullAuditSince("0")).rows.map((row) => row.id)).toEqual([old.id, recent.id]);
  });
});

describe("runAuditCycle", () => {
  class EntityOnlyTransport implements SyncTransport {
    async pushOps(): Promise<PushOpResult[]> {
      return [];
    }
    async pullSince(): Promise<PullSinceResult> {
      return { cursor: "", hasMore: false, changes: [] };
    }
    async pullBootstrap(): Promise<PullSinceResult> {
      return { cursor: "", hasMore: false, changes: [] };
    }
  }

  it("does nothing for a transport with no audit endpoints", async () => {
    await writeRows(db, 1);
    await runAuditCycle(db, new EntityOnlyTransport());
    expect(await watermark()).toBeUndefined();
  });

  it("pulls only once the push has reached the server", async () => {
    await writeRows(db, 1);
    const scripted = new ScriptedAuditTransport(() => new Error("offline"));
    const transport: SyncTransport & AuditTransport = Object.assign(new EntityOnlyTransport(), {
      pushAuditRows: scripted.pushAuditRows.bind(scripted),
      pullAuditSince: scripted.pullAuditSince.bind(scripted),
    });

    await runAuditCycle(db, transport);

    expect(scripted.pushed).toHaveLength(1);
    expect(scripted.pulled).toEqual([]);
  });
});

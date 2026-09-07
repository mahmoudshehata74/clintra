import { beforeEach, describe, expect, it } from "vitest";
import { VisitStatus } from "../domain/visitStatus";
import { ClintraDatabase } from "./database";
import { mutate } from "./mutate";
import { seedDatabase } from "./seed";
import { AuditAction } from "./types";

let db: ClintraDatabase;

beforeEach(() => {
  db = new ClintraDatabase(`clintra-mutate-test-${crypto.randomUUID()}`);
});

describe("mutate", () => {
  it("writes the entity change, an audit_log row and a sync_ops row together in one transaction", async () => {
    await seedDatabase(db);
    const visits = await db.visits.toArray();
    const visit = visits.find((v) => v.position === 1);
    if (!visit) throw new Error("seed did not produce a visit at position 1");
    const [membership] = await db.memberships.toArray();

    const before = visit;
    const after = { ...visit, status: VisitStatus.Confirmed };

    await mutate(db, {
      table: db.visits,
      entity: "visits",
      entityId: visit.id,
      action: AuditAction.Update,
      before,
      after,
      actorMembershipId: membership.id,
      orgId: visit.org_id,
    });

    const stored = await db.visits.get(visit.id);
    expect(stored?.status).toBe(VisitStatus.Confirmed);

    const auditRows = await db.audit_log.toArray();
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      org_id: visit.org_id,
      actor_membership_id: membership.id,
      entity: "visits",
      entity_id: visit.id,
      action: AuditAction.Update,
      before,
      after,
    });

    const syncRows = await db.sync_ops.toArray();
    expect(syncRows).toHaveLength(1);
    expect(syncRows[0]).toMatchObject({
      entity: "visits",
      entity_id: visit.id,
      action: AuditAction.Update,
      payload: after,
      synced_at: null,
    });
    expect(syncRows[0].op_id).toBeTruthy();
    expect(syncRows[0].device_id).toBeTruthy();
  });

  it("rolls back all three writes together when one part of the transaction fails", async () => {
    await seedDatabase(db);
    const visits = (await db.visits.toArray()).sort((a, b) => a.position - b.position);
    const [visit1, visit2] = visits;

    const before = visit1;
    // Colliding with visit2's position under the same practitioner_id+visit_date
    // violates the unique index, which must throw and roll back the whole transaction.
    const after = { ...visit1, position: visit2.position };

    await expect(
      mutate(db, {
        table: db.visits,
        entity: "visits",
        entityId: visit1.id,
        action: AuditAction.Update,
        before,
        after,
        actorMembershipId: "membership-1",
        orgId: visit1.org_id,
      }),
    ).rejects.toThrow();

    const stored = await db.visits.get(visit1.id);
    expect(stored).toEqual(visit1);
    expect(await db.audit_log.count()).toBe(0);
    expect(await db.sync_ops.count()).toBe(0);
  });
});

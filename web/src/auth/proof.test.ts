import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SyncOp } from "../db/types";
import type { WireAuditRow } from "../sync/transport";
import { auditMessage, opMessage, requestMessage } from "./proof";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");

describe("identity proof messages", () => {
  it("signs the raw body, method, and encoded request path exactly", async () => {
    const body = '{ "name": " منى " }';
    const path = "/api/sync/pull?cursor=a%2Fb";
    expect(await requestMessage("post", path, 1234, "nonce", body))
      .toBe(`clintra-req-v1\nPOST\n${path}\n1234\nnonce\n${hash(body)}`);
  });

  it("signs the revision, group, and canonical payload on updates and uses a dash on deletes", async () => {
    const op: SyncOp = {
      op_id: "op", device_id: "device", entity: "patients", entity_id: "patient", action: "update", base_rev: 2,
      group_id: "group", created_at: "2026-11-20T12:01:00.000Z", payload: { z: " منى ", a: null },
      synced_at: null, failure_count: 0, next_retry_at: null,
    };
    const prefix = "clintra-op-v1\nop\ndevice\ncredential\npatients\npatient";
    expect(await opMessage(op, "credential"))
      .toBe(`${prefix}\nupdate\n2\ngroup\n${op.created_at}\n${hash('{"a":null,"z":" منى "}')}`);
    expect(await opMessage({ ...op, action: "delete", group_id: undefined }, "credential"))
      .toBe(`${prefix}\ndelete\n2\n-\n${op.created_at}\n-`);
  });

  it("signs canonical before and after snapshots for an audit row", async () => {
    const row: WireAuditRow = {
      id: "row", org_id: "org", actor_membership_id: "person", entity: "patients", entity_id: "patient",
      location_id: null, practitioner_id: null, action: "create", before: null, after: { z: 2, a: 1 },
      at: "2026-11-20T12:01:00.000Z",
    };
    expect(await auditMessage(row, "device", "credential"))
      .toBe(`clintra-audit-v1\nrow\ndevice\ncredential\npatients\npatient\ncreate\n${row.at}\n${hash('{"after":{"a":1,"z":2},"before":null}')}`);
  });
});

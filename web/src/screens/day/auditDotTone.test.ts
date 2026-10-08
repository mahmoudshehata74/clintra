import { describe, expect, it } from "vitest";
import { AuditAction, InvoiceStatus } from "../../db/types";
import { VisitStatus } from "../../domain/visitStatus";
import { auditDotTone } from "./auditDotTone";

function row(entity: string, action: AuditAction, before: unknown, after: unknown) {
  return { entity, action, before, after };
}

describe("auditDotTone", () => {
  it("marks every delete as danger", () => {
    expect(auditDotTone(row("visits", AuditAction.Delete, { status: VisitStatus.Booked }, null))).toBe("danger");
    expect(auditDotTone(row("payments", AuditAction.Delete, { amount: 100 }, null))).toBe("danger");
  });

  it("marks a visit cancellation and an invoice void as danger", () => {
    expect(
      auditDotTone(row("visits", AuditAction.Update, { status: VisitStatus.Booked }, { status: VisitStatus.Cancelled })),
    ).toBe("danger");
    expect(
      auditDotTone(row("invoices", AuditAction.Update, { status: InvoiceStatus.Unpaid }, { status: InvoiceStatus.Void })),
    ).toBe("danger");
  });

  it("marks a no-show as warn", () => {
    expect(
      auditDotTone(row("visits", AuditAction.Update, { status: VisitStatus.Booked }, { status: VisitStatus.NoShow })),
    ).toBe("warn");
  });

  it("marks a payment recorded after the day closed as warn, and an ordinary one as default", () => {
    expect(auditDotTone(row("payments", AuditAction.Create, null, { after_close: true }))).toBe("warn");
    expect(auditDotTone(row("payments", AuditAction.Create, null, { after_close: false }))).toBe("default");
  });

  it("does not re-flag an edit to a row that was already cancelled or a no-show", () => {
    expect(
      auditDotTone(
        row("visits", AuditAction.Update, { status: VisitStatus.Cancelled, note: "" }, { status: VisitStatus.Cancelled, note: "x" }),
      ),
    ).toBe("default");
    expect(
      auditDotTone(row("visits", AuditAction.Update, { status: VisitStatus.NoShow }, { status: VisitStatus.NoShow })),
    ).toBe("default");
  });

  it("leaves everything else default green", () => {
    expect(auditDotTone(row("visits", AuditAction.Create, null, { status: VisitStatus.Booked }))).toBe("default");
    expect(
      auditDotTone(row("visits", AuditAction.Update, { status: VisitStatus.Booked }, { status: VisitStatus.Arrived })),
    ).toBe("default");
    expect(auditDotTone(row("cash_close", AuditAction.Create, null, { date: "2026-10-08" }))).toBe("default");
  });
});

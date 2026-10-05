import { describe, expect, it } from "vitest";
import { InvoiceStatus, type Invoice, type Visit } from "../../db/types";
import type { Piastres } from "../../domain/money";
import { VisitSource } from "../../domain/visitSource";
import { VisitStatus } from "../../domain/visitStatus";
import { computeDaySlotsSlab } from "./daySlotsSlab";

function makeVisit(status: Visit["status"], position: number, overrides: Partial<Visit> = {}): Visit {
  return {
    id: `visit-${position}`,
    org_id: "org-1",
    location_id: "location-1",
    practitioner_id: "practitioner-1",
    patient_id: `patient-${position}`,
    service_id: null,
    care_plan_item_id: null,
    visit_date: "2026-09-06",
    position,
    scheduled_at: `2026-09-06T0${position}:00:00.000Z`,
    status,
    is_overbooked: false,
    source: VisitSource.Phone,
    arrived_at: null,
    started_at: null,
    ended_at: null,
    cancel_reason: null,
    rescheduled_from: null,
    created_by: "membership-1",
    created_at: "2026-09-06T06:00:00.000Z",
    rev: 1,
    ...overrides,
  };
}

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: "invoice-1",
    org_id: "org-1",
    location_id: "location-1",
    number: 1,
    issued_year: 2026,
    patient_id: "patient-1",
    practitioner_id: "practitioner-1",
    visit_id: "visit-1",
    total: 1000 as Piastres,
    paid: 1000 as Piastres,
    status: InvoiceStatus.Paid,
    issued_at: "2026-09-06T10:00:00.000Z",
    rev: 1,
    ...overrides,
  };
}

describe("computeDaySlotsSlab", () => {
  it("reports all zero/null on an empty day", () => {
    const slab = computeDaySlotsSlab([], []);
    expect(slab.finalStateCount).toBe(0);
    expect(slab.splitSharePercent).toBe(0);
    expect(slab.noShowCount).toBe(0);
    expect(slab.nextVisit).toBeNull();
    expect(slab.invoiceCount).toBe(0);
    expect(slab.duePiastres).toBe(0);
    expect(slab.hasPartialInvoice).toBe(false);
    expect(slab.longestCompletedConsultMinutes).toBeNull();
  });

  describe("finalStateCount and splitSharePercent: completed, cancelled and no_show are terminal", () => {
    it("counts completed, cancelled and no_show, not booked/confirmed/arrived/in_room", () => {
      const visits = [
        makeVisit(VisitStatus.Booked, 1),
        makeVisit(VisitStatus.Confirmed, 2),
        makeVisit(VisitStatus.Arrived, 3),
        makeVisit(VisitStatus.InRoom, 4),
        makeVisit(VisitStatus.Completed, 5),
        makeVisit(VisitStatus.Cancelled, 6),
        makeVisit(VisitStatus.NoShow, 7),
      ];
      const slab = computeDaySlotsSlab(visits, []);
      expect(slab.finalStateCount).toBe(3);
      expect(slab.splitSharePercent).toBe(Math.round((3 / 7) * 100));
    });
  });

  it("counts no-show visits for the لم يحضر cell", () => {
    const visits = [makeVisit(VisitStatus.NoShow, 1), makeVisit(VisitStatus.NoShow, 2), makeVisit(VisitStatus.Booked, 3)];
    expect(computeDaySlotsSlab(visits, []).noShowCount).toBe(2);
  });

  describe("nextVisit: the earliest arrived visit, else the earliest booked/confirmed one", () => {
    it("prefers the earliest arrived visit over any booked one", () => {
      const visits = [
        makeVisit(VisitStatus.Booked, 1, { scheduled_at: "2026-09-06T08:00:00.000Z" }),
        makeVisit(VisitStatus.Arrived, 2, { scheduled_at: "2026-09-06T09:30:00.000Z" }),
        makeVisit(VisitStatus.Arrived, 3, { scheduled_at: "2026-09-06T09:00:00.000Z" }),
      ];
      expect(computeDaySlotsSlab(visits, []).nextVisit?.id).toBe("visit-3");
    });

    it("falls back to the earliest booked/confirmed visit when none is arrived", () => {
      const visits = [
        makeVisit(VisitStatus.Confirmed, 1, { scheduled_at: "2026-09-06T11:00:00.000Z" }),
        makeVisit(VisitStatus.Booked, 2, { scheduled_at: "2026-09-06T08:00:00.000Z" }),
      ];
      expect(computeDaySlotsSlab(visits, []).nextVisit?.id).toBe("visit-2");
    });

    it("is null when nothing is arrived, booked or confirmed", () => {
      const visits = [makeVisit(VisitStatus.Completed, 1), makeVisit(VisitStatus.NoShow, 2)];
      expect(computeDaySlotsSlab(visits, []).nextVisit).toBeNull();
    });
  });

  describe("due/invoice-count tiles: non-void invoices only", () => {
    it("sums each invoice's unpaid remainder as due", () => {
      const invoices = [
        makeInvoice({ id: "i1", total: 1000 as Piastres, paid: 1000 as Piastres, status: InvoiceStatus.Paid }),
        makeInvoice({ id: "i2", total: 800 as Piastres, paid: 400 as Piastres, status: InvoiceStatus.Partial }),
        makeInvoice({ id: "i3", total: 500 as Piastres, paid: 0 as Piastres, status: InvoiceStatus.Unpaid }),
      ];
      const slab = computeDaySlotsSlab([], invoices);
      expect(slab.duePiastres).toBe(900);
      expect(slab.invoiceCount).toBe(3);
      expect(slab.hasPartialInvoice).toBe(true);
    });

    it("excludes void invoices entirely", () => {
      const invoices = [makeInvoice({ total: 1000 as Piastres, paid: 500 as Piastres, status: InvoiceStatus.Void })];
      const slab = computeDaySlotsSlab([], invoices);
      expect(slab.duePiastres).toBe(0);
      expect(slab.invoiceCount).toBe(0);
    });

    it("has no partial sub-line when every invoice is fully paid or unpaid", () => {
      const invoices = [
        makeInvoice({ total: 1000 as Piastres, paid: 1000 as Piastres, status: InvoiceStatus.Paid }),
        makeInvoice({ total: 500 as Piastres, paid: 0 as Piastres, status: InvoiceStatus.Unpaid }),
      ];
      expect(computeDaySlotsSlab([], invoices).hasPartialInvoice).toBe(false);
    });
  });

  describe("longestCompletedConsultMinutes: completed visits with both timestamps only", () => {
    it("picks the longest of several completed consults", () => {
      const visits = [
        makeVisit(VisitStatus.Completed, 1, {
          started_at: "2026-09-06T09:00:00.000Z",
          ended_at: "2026-09-06T09:18:00.000Z",
        }),
        makeVisit(VisitStatus.Completed, 2, {
          started_at: "2026-09-06T10:00:00.000Z",
          ended_at: "2026-09-06T10:27:00.000Z",
        }),
      ];
      expect(computeDaySlotsSlab(visits, []).longestCompletedConsultMinutes).toBe(27);
    });

    it("ignores a completed visit missing started_at or ended_at", () => {
      const visits = [makeVisit(VisitStatus.Completed, 1, { started_at: null, ended_at: null })];
      expect(computeDaySlotsSlab(visits, []).longestCompletedConsultMinutes).toBeNull();
    });

    it("never counts a non-completed visit even with both timestamps set", () => {
      const visits = [
        makeVisit(VisitStatus.InRoom, 1, {
          started_at: "2026-09-06T09:00:00.000Z",
          ended_at: "2026-09-06T09:40:00.000Z",
        }),
      ];
      expect(computeDaySlotsSlab(visits, []).longestCompletedConsultMinutes).toBeNull();
    });
  });
});

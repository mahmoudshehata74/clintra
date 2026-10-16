import { describe, expect, it } from "vitest";
import { AuditAction, type SyncReview } from "../db/types";
import { DISPLACED_BY_SERVER_REASON, SERVER_UNIQUE_CONFLICT_REASON, type DisplacedPayload } from "./pullCollisions";
import { describeDisplacedContent, describeLostBooking, describeReviewFieldDiffs, describeSupersededReviews, describeSyncReview, displacedPayments } from "./reviewSummary";
import { SYNCABLE_TABLES } from "./syncableTables";

function makeReview(overrides: Partial<SyncReview> = {}): SyncReview {
  return {
    id: "review-1",
    op_id: "op-1",
    entity: "visits",
    entity_id: "visit-1",
    reason: "conflict_slot_taken",
    payload: {},
    needs_review: true,
    created_at: "2026-09-07T06:00:00.000Z",
    action: AuditAction.Create,
    base_rev: null,
    ...overrides,
  };
}

describe("describeSyncReview", () => {
  it("labels a known entity and reason in Arabic", () => {
    expect(describeSyncReview(makeReview())).toBe("زيارة — الميعاد ده اتحجز من جهاز تاني");
  });

  it("falls back to the raw entity name when unrecognised", () => {
    expect(describeSyncReview(makeReview({ entity: "some_future_table" }))).toContain("some_future_table");
  });

  it.each(SYNCABLE_TABLES)("labels the syncable table %s in Arabic, never by its raw name", (entity) => {
    const description = describeSyncReview(makeReview({ entity }));
    expect(description).not.toContain(entity);
    expect(description.split(" — ")[0]).toMatch(/^[\u0600-\u06FF ]+$/);
  });

  it.each([
    ["series_mismatch", "الرقم ده مش من سلسلة أرقام الجهاز ده"],
    ["number_immutable", "الرقم ده اتطبع، مينفعش يتغيّر"],
    ["conflict_number_taken", "الرقم ده متسجّل قبل كده على السيرفر"],
    ["conflict_visit_has_prescription", "الزيارة دي ليها وصفة بالفعل من جهاز تاني"],
    ["prescription_printed", "الوصفة دي اتطبعت، مينفعش تتعدّل"],
  ])("labels %s in Arabic", (reason, label) => {
    expect(describeSyncReview(makeReview({ entity: "prescriptions", reason }))).toBe(`وصفة — ${label}`);
  });

  it("labels unknown_entity in Arabic, without the raw table name", () => {
    expect(describeSyncReview(makeReview({ entity: "users", reason: "unknown_entity" }))).toBe(
      "بيانات — السيرفر مبيستقبلش النوع ده من البيانات، فالتغيير ده مش هيوصل",
    );
    expect(describeSyncReview(makeReview({ entity: "memberships", reason: "unknown_entity" }))).toBe(
      "موظف — السيرفر مبيستقبلش النوع ده من البيانات، فالتغيير ده مش هيوصل",
    );
  });

  it("never shows the raw reason code when unrecognised — a stable reference code instead", () => {
    const description = describeSyncReview(makeReview({ reason: "some_new_reason" }));
    expect(description).not.toContain("some_new_reason");
    expect(description).toContain("كود المرجع");
    // The reference code is derived from the review's own id, stable and reproducible.
    expect(description).toContain("REVIEW-1");
  });
});

describe("describeReviewFieldDiffs", () => {
  it("returns only the fields that actually differ, formatted as strings", () => {
    const mine = { id: "1", full_name: "منى", phone: "+201000000000", note: null };
    const server = { id: "1", full_name: "منى فؤاد", phone: "+201000000000", note: "ملاحظة" };

    const diffs = describeReviewFieldDiffs(mine, server);

    expect(diffs).toEqual([
      { field: "full_name", mine: "منى", server: "منى فؤاد" },
      { field: "note", mine: "—", server: "ملاحظة" },
    ]);
  });

  it("shows a field present on only one side against an em dash, not hidden", () => {
    const diffs = describeReviewFieldDiffs({ a: 1 }, { a: 1, b: 2 });
    expect(diffs).toEqual([{ field: "b", mine: "—", server: "2" }]);
  });
});

describe("the pull side's two review reasons (sync/pullCollisions.ts)", () => {
  function displaced(entity: string, row: Record<string, unknown>, children: DisplacedPayload["children"] = []): SyncReview {
    return makeReview({ entity, reason: DISPLACED_BY_SERVER_REASON, payload: { row, children } satisfies DisplacedPayload });
  }

  it("labels displaced_by_server in Arabic", () => {
    expect(describeSyncReview(displaced("prescriptions", {}))).toBe("وصفة — النسخة دي اتشالت لأن جهاز تاني سبقها على السيرفر");
  });

  it("labels server_unique_conflict for support, with its reference code", () => {
    expect(describeSyncReview(makeReview({ entity: "message_templates", reason: SERVER_UNIQUE_CONFLICT_REASON }))).toBe(
      "قالب رسالة — تعارض محتاج مراجعة من الدعم — كود المرجع: REVIEW-1",
    );
  });

  it("summarises a displaced prescription by its drug names, in item order", () => {
    const review = displaced("prescriptions", { id: "rx-1" }, [
      { entity: "prescription_items", row: { name: "Voltaren Gel", position: 2 } },
      { entity: "prescription_items", row: { name: "Brufen 400mg", position: 1 } },
    ]);
    expect(describeDisplacedContent(review, new Map())).toBe("الأدوية: Brufen 400mg، Voltaren Gel");
    expect(describeDisplacedContent(displaced("prescriptions", { id: "rx-2" }), new Map())).toBe("وصفة من غير أدوية");
  });

  it("summarises a displaced template by its name", () => {
    expect(describeDisplacedContent(displaced("message_templates", { key: "booking_confirmation" }), new Map())).toBe("القالب: تأكيد الحجز");
  });

  it("summarises a displaced visit by its patient and its time, or its place in the queue", () => {
    const names = new Map([["patient-1", "هدى سمير"]]);
    expect(describeDisplacedContent(displaced("visits", { patient_id: "patient-1", scheduled_at: "2026-09-07T07:00:00.000Z", position: 1 }), names)).toBe(
      "هدى سمير — الساعة 10:00",
    );
    expect(describeDisplacedContent(displaced("visits", { patient_id: "patient-2", scheduled_at: null, position: 4 }), names)).toBe("مريض — دور 4");
  });

  it("summarises a displaced day's delay and a displaced cash close's total", () => {
    expect(describeDisplacedContent(displaced("day_state", { delay_minutes: 30 }), new Map())).toBe("تأخير 30 دقيقة");
    expect(describeDisplacedContent(displaced("cash_close", { total_collected: 45000 }), new Map())).toBe("المحصّل 450.00 ج.م");
  });

  it("has nothing to add for any other review", () => {
    expect(describeDisplacedContent(makeReview(), new Map())).toBeNull();
    expect(describeDisplacedContent(displaced("visit_form_data", { visit_id: "visit-1" }), new Map())).toBeNull();
  });
});

describe("money is never displaced silently", () => {
  const payment = (overrides: Record<string, unknown>) => ({
    id: "payment-1",
    invoice_id: "invoice-1",
    location_id: "location-1",
    amount: 20000,
    method: "cash",
    receipt_number: "12",
    series: 2,
    note: null,
    after_close: false,
    created_by: "membership-1",
    created_at: "2026-09-07T09:00:00.000Z",
    rev: 1,
    ...overrides,
  });
  const visitWithPayments = makeReview({
    entity: "visits",
    reason: DISPLACED_BY_SERVER_REASON,
    payload: {
      row: { id: "visit-1", patient_id: "patient-1", scheduled_at: null, position: 3 },
      children: [
        { entity: "invoices", row: { id: "invoice-1", visit_id: "visit-1" } },
        { entity: "payments", row: payment({ id: "payment-2", amount: 5050, method: "card", receipt_number: "13", created_at: "2026-09-07T09:05:00.000Z" }) },
        { entity: "payments", row: payment({}) },
      ],
    } satisfies DisplacedPayload,
  });

  it("a displaced visit's payments are listed by amount, method and full receipt number, in the order recorded, with what to do", () => {
    expect(describeSyncReview(visitWithPayments)).toBe(
      "زيارة — النسخة دي اتشالت لأن جهاز تاني سبقها على السيرفر. " +
        "فيه دفعات اتحصّلت عليها ومش هتوصل للسيرفر: 200.00 ج.م كاش (RCP-B-12)، 50.50 ج.م فيزا (RCP-B-13). " +
        "احجز للمريض من جديد وسجّل الدفعة تاني، واكتب رقم الإيصال القديم في ملاحظة الدفعة.",
    );
    expect(displacedPayments(visitWithPayments).map((row) => row.id)).toEqual(["payment-1", "payment-2"]);
  });

  it("a displaced invoice's payments and a displaced payment itself are listed too", () => {
    const invoice = makeReview({
      entity: "invoices",
      reason: DISPLACED_BY_SERVER_REASON,
      payload: { row: { id: "invoice-1" }, children: [{ entity: "payments", row: payment({ series: 1, receipt_number: "7" }) }] } satisfies DisplacedPayload,
    });
    expect(describeSyncReview(invoice)).toContain("فيه دفعات اتحصّلت عليها ومش هتوصل للسيرفر: 200.00 ج.م كاش (RCP-7).");
    const own = makeReview({ entity: "payments", reason: DISPLACED_BY_SERVER_REASON, payload: { row: payment({ method: "wallet" }), children: [] } satisfies DisplacedPayload });
    expect(describeSyncReview(own)).toContain("200.00 ج.م محفظة (RCP-B-12)");
  });

  it("an invoice without payments and a prescription keep the plain text", () => {
    const invoice = makeReview({ entity: "invoices", reason: DISPLACED_BY_SERVER_REASON, payload: { row: { id: "invoice-1" }, children: [] } satisfies DisplacedPayload });
    expect(describeSyncReview(invoice)).toBe("فاتورة — النسخة دي اتشالت لأن جهاز تاني سبقها على السيرفر");
    const rx = makeReview({ entity: "prescriptions", reason: DISPLACED_BY_SERVER_REASON, payload: { row: { id: "rx-1" }, children: [] } satisfies DisplacedPayload });
    expect(describeSyncReview(rx)).toBe("وصفة — النسخة دي اتشالت لأن جهاز تاني سبقها على السيرفر");
    expect(displacedPayments(makeReview())).toEqual([]);
  });

  it("names the reviews a displacement closed, and nothing when it closed none", () => {
    const folded = makeReview({
      reason: DISPLACED_BY_SERVER_REASON,
      payload: {
        row: { id: "visit-1" },
        children: [],
        superseded: [{ entity: "visits", entity_id: "visit-1", reason: "conflict_slot_taken", action: AuditAction.Create, payload: {} }],
      } satisfies DisplacedPayload,
    });
    expect(describeSupersededReviews(folded)).toBe("كانت مستنية مراجعة قبل كده: الميعاد ده اتحجز من جهاز تاني");
    expect(describeSupersededReviews(visitWithPayments)).toBeNull();
    expect(describeSupersededReviews(makeReview())).toBeNull();
  });
});

describe("describeLostBooking", () => {
  it("names a slot conflict's booking by its patient and its time", () => {
    const names = new Map([["patient-1", "هدى سمير"]]);
    const review = makeReview({ payload: { patient_id: "patient-1", scheduled_at: "2026-09-07T07:00:00.000Z", position: 1 } });
    expect(describeLostBooking(review, names)).toBe("هدى سمير — الساعة 10:00");
  });

  it("falls back to a plain patient word when the name is not on the device", () => {
    const review = makeReview({ payload: { patient_id: "patient-9", scheduled_at: "2026-09-07T07:00:00.000Z", position: 1 } });
    expect(describeLostBooking(review, new Map())).toBe("مريض — الساعة 10:00");
  });

  it("has nothing to say for any other review", () => {
    expect(describeLostBooking(makeReview({ reason: "conflict", payload: { patient_id: "patient-1" } }), new Map())).toBeNull();
    expect(describeLostBooking(makeReview({ entity: "patients" }), new Map())).toBeNull();
  });
});

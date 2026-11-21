import { describe, expect, it } from "vitest";
import { CorrectionError } from "../../db/visitCorrections";
import type { VisitFormRevision } from "../../db/types";
import { cairoInstant } from "../../domain/time";
import { buildCorrectionHistory, correctionErrorMessage, correctionHistoryLabel } from "./correctionModel";

function revision(revisionNo: number, overrides: Partial<VisitFormRevision> = {}): VisitFormRevision {
  return {
    id: `revision-${revisionNo}`,
    org_id: "org-1",
    visit_id: "visit-1",
    visit_form_data_id: "form-1",
    revision_no: revisionNo,
    replaced_rev: revisionNo,
    previous_data: { complaint: "ألم في الركبة", diagnosis: "التهاب وتر" },
    new_data: { complaint: "ألم في الركبة", diagnosis: "التهاب وتر الرضفة" },
    reason: "خطأ في كتابة التشخيص",
    corrected_by: "membership-1",
    corrected_at: cairoInstant("2026-11-20", "14:05"),
    device_id: "device-1",
    rev: 1,
    ...overrides,
  };
}

const NAMES = new Map([["membership-1", "أحمد المصري"]]);

describe("buildCorrectionHistory", () => {
  it("lists each correction with when, who, why and only the fields it changed", () => {
    expect(buildCorrectionHistory([revision(1)], NAMES)).toEqual([
      {
        id: "revision-1",
        when: "20 / 11 / 2026 · 14:05",
        by: "عدّلها أحمد المصري",
        reason: "السبب: خطأ في كتابة التشخيص",
        changes: [{ label: "التشخيص", before: "التهاب وتر", after: "التهاب وتر الرضفة" }],
      },
    ]);
  });

  it("puts the newest first, the complaint before the diagnosis, and an empty side as —", () => {
    const second = revision(2, {
      corrected_at: cairoInstant("2026-11-21", "09:00"),
      previous_data: { complaint: null, diagnosis: "التهاب وتر الرضفة" },
      new_data: { complaint: "ألم", diagnosis: "" },
    });

    const history = buildCorrectionHistory([revision(1), second], NAMES);

    expect(history.map((entry) => entry.id)).toEqual(["revision-2", "revision-1"]);
    expect(history[0].changes).toEqual([
      { label: "الشكوى", before: "—", after: "ألم" },
      { label: "التشخيص", before: "التهاب وتر الرضفة", after: "—" },
    ]);
  });

  it("names a corrector who is not on this device as unknown", () => {
    expect(buildCorrectionHistory([revision(1, { corrected_by: "membership-9" })], NAMES)[0].by).toBe("عدّلها غير معروف");
  });
});

describe("correctionHistoryLabel", () => {
  it("carries the count", () => {
    expect(correctionHistoryLabel(2)).toBe("سجل التعديلات (2)");
  });
});

describe("correctionErrorMessage", () => {
  it("maps every refusal the doctor can meet, and anything else to a retry line", () => {
    expect(correctionErrorMessage(new Error(CorrectionError.NotAllowed))).toBe("تعديل الزيارة بعد ما تتقفل لطبيب الزيارة أو صاحب العيادة بس");
    expect(correctionErrorMessage(new Error(CorrectionError.ReasonRequired))).toBe("اكتب سبب التعديل (3 حروف على الأقل)");
    expect(correctionErrorMessage(new Error(CorrectionError.ReasonTooLong))).toBe("السبب طويل، خليه 500 حرف أو أقل");
    expect(correctionErrorMessage(new Error(CorrectionError.Unchanged))).toBe("مفيش تغيير عن النسخة الحالية");
    expect(correctionErrorMessage(new Error("boom"))).toBe("التعديل ما اتحفظش، جرّب تاني");
  });
});

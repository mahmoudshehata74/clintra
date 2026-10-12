import { describe, expect, it } from "vitest";
import { DEVICE_SERIES_UNKNOWN } from "../../db/deviceRegistration";
import { PrescriptionError } from "../../db/prescriptions";
import type { Patient, Visit } from "../../db/types";
import type { VisitFormFieldValues } from "../../db/visitForm";
import { cairoInstant, type ClockTime } from "../../domain/time";
import { VisitSource } from "../../domain/visitSource";
import { VisitStatus } from "../../domain/visitStatus";
import { dayScreenStrings } from "../day/strings";
import { visitWorkspaceStrings as T } from "./strings";
import {
  buildVisitHistory,
  computeRxAccess,
  countPhrase,
  dayMonth,
  formatDrugSummary,
  MINUTE_FORMS,
  priorCompletedVisits,
  RX_COUNT_FORMS,
  rxDoseLine,
  rxErrorMessage,
  sessionLengthPhrase,
  sessionMinutes,
  sortRxItems,
  summarizePatient,
  VISIT_COUNT_FORMS,
  visitHistoryHeading,
} from "./workspace";

const TODAY = "2026-10-08";
const at = (time: ClockTime, day = TODAY) => cairoInstant(day, time);
const nowAt = (time: ClockTime) => new Date(at(time));

let nextId = 0;
function makeVisit(overrides: Partial<Visit> = {}): Visit {
  nextId += 1;
  return {
    id: `visit-${nextId}`,
    org_id: "org-1",
    location_id: "location-1",
    practitioner_id: "practitioner-1",
    patient_id: "patient-1",
    service_id: null,
    care_plan_item_id: null,
    visit_date: TODAY,
    position: nextId,
    scheduled_at: null,
    status: VisitStatus.Booked,
    is_overbooked: false,
    source: VisitSource.Phone,
    arrived_at: null,
    started_at: null,
    ended_at: null,
    cancel_reason: null,
    rescheduled_from: null,
    created_by: "membership-1",
    created_at: at("08:00"),
    note: null,
    rev: 1,
    ...overrides,
  };
}

function completedOn(day: string, endTime: ClockTime = "10:00", overrides: Partial<Visit> = {}): Visit {
  return makeVisit({
    visit_date: day,
    status: VisitStatus.Completed,
    started_at: at("09:30", day),
    ended_at: at(endTime, day),
    ...overrides,
  });
}

const patient: Patient = {
  id: "patient-1",
  org_id: "org-1",
  full_name: "كريم فتحي",
  phone: "+201112345678",
  gender: null,
  birth_year: 1992,
  note: null,
  created_at: at("08:00"),
  rev: 1,
};

describe("countPhrase", () => {
  it("words the drug count with Arabic agreement", () => {
    expect(countPhrase(1, RX_COUNT_FORMS)).toBe("دواء واحد");
    expect(countPhrase(2, RX_COUNT_FORMS)).toBe("دوائين");
    expect(countPhrase(3, RX_COUNT_FORMS)).toBe("3 أدوية");
    expect(countPhrase(10, RX_COUNT_FORMS)).toBe("10 أدوية");
    expect(countPhrase(11, RX_COUNT_FORMS)).toBe("11 دواء");
  });

  it("words visits and minutes the same way", () => {
    expect(countPhrase(1, VISIT_COUNT_FORMS)).toBe("زيارة واحدة");
    expect(countPhrase(2, VISIT_COUNT_FORMS)).toBe("زيارتين");
    expect(countPhrase(4, VISIT_COUNT_FORMS)).toBe("4 زيارات");
    expect(countPhrase(12, VISIT_COUNT_FORMS)).toBe("12 زيارة");
    expect(countPhrase(1, MINUTE_FORMS)).toBe("دقيقة واحدة");
    expect(countPhrase(2, MINUTE_FORMS)).toBe("دقيقتين");
    expect(countPhrase(7, MINUTE_FORMS)).toBe("7 دقائق");
    expect(countPhrase(14, MINUTE_FORMS)).toBe("14 دقيقة");
    expect(countPhrase(0, MINUTE_FORMS)).toBe("0 دقيقة");
  });
});

describe("priorCompletedVisits", () => {
  it("keeps the patient's completed visits before this one, newest first, any practitioner", () => {
    const current = makeVisit({ status: VisitStatus.InRoom, started_at: at("11:00") });
    const older = completedOn("2026-08-15");
    const newer = completedOn("2026-09-20", "10:00", { practitioner_id: "practitioner-2" });
    const sameDayEarlier = completedOn(TODAY, "09:45");
    const cancelled = makeVisit({ visit_date: "2026-09-01", status: VisitStatus.Cancelled });
    const otherPatient = completedOn("2026-09-25", "10:00", { patient_id: "patient-2" });
    const later = completedOn("2026-10-20");

    expect(
      priorCompletedVisits([older, current, cancelled, newer, otherPatient, sameDayEarlier, later], current).map((v) => v.id),
    ).toEqual([sameDayEarlier.id, newer.id, older.id]);
  });

  it("for a completed visit, counts a same-day visit only when it ended first", () => {
    const current = completedOn(TODAY, "11:00");
    const before = completedOn(TODAY, "10:00");
    const after = completedOn(TODAY, "12:00");
    expect(priorCompletedVisits([before, current, after], current).map((v) => v.id)).toEqual([before.id]);
  });
});

describe("summarizePatient", () => {
  it("builds the avatar, age, local phone, visit count and last-visit time", () => {
    const prior = [completedOn("2026-09-17"), completedOn("2026-08-01")];
    expect(summarizePatient(patient, prior, nowAt("12:00"))).toEqual({
      initial: "ك",
      name: "كريم فتحي",
      age: 34,
      phone: "011 1234 5678",
      visitCount: "زيارتين",
      lastVisitRelative: "قبل 3 أسابيع",
    });
  });

  it("omits what it has no data for", () => {
    const summary = summarizePatient({ ...patient, phone: null, birth_year: null }, [], nowAt("12:00"));
    expect(summary.age).toBeNull();
    expect(summary.phone).toBeNull();
    expect(summary.visitCount).toBeNull();
    expect(summary.lastVisitRelative).toBeNull();
  });
});

describe("visit history", () => {
  it("formats the date as d/m", () => {
    expect(dayMonth("2026-08-15")).toBe("15/8");
    expect(dayMonth("2026-01-05")).toBe("5/1");
  });

  it("names the first two drugs, then +N", () => {
    expect(formatDrugSummary([])).toBeNull();
    expect(formatDrugSummary(["Voltaren Gel"])).toBe("Voltaren Gel");
    expect(formatDrugSummary(["A", "B"])).toBe("A، B");
    expect(formatDrugSummary(["A", "B", "C", "D"])).toBe("A، B +2");
  });

  it("shows the diagnosis, else the complaint, else a placeholder, and at most three rows", () => {
    const visits = [
      completedOn("2026-09-20"),
      completedOn("2026-09-01"),
      completedOn("2026-08-15"),
      completedOn("2026-07-18"),
    ];
    const forms = new Map<string, VisitFormFieldValues>([
      [visits[0].id, { complaint: "ألم", diagnosis: "التهاب وتر" }],
      [visits[1].id, { complaint: "متابعة", diagnosis: "  " }],
    ]);
    const drugs = new Map<string, string[]>([[visits[0].id, ["Diclofenac 50mg", "Paracetamol 500mg", "Voltaren Gel"]]]);

    expect(buildVisitHistory(visits, forms, drugs)).toEqual([
      { visitId: visits[0].id, date: "20/9", title: "التهاب وتر", drugs: "Diclofenac 50mg، Paracetamol 500mg +1" },
      { visitId: visits[1].id, date: "1/9", title: "متابعة", drugs: null },
      { visitId: visits[2].id, date: "15/8", title: T.historyNoDiagnosis, drugs: null },
    ]);
  });

  it("heads the block with the real count", () => {
    expect(visitHistoryHeading(1)).toBe("آخر زيارة");
    expect(visitHistoryHeading(2)).toBe("آخر زيارتين");
    expect(visitHistoryHeading(3)).toBe("آخر 3 زيارات");
  });
});

describe("prescription items", () => {
  const item = (position: number, overrides: Record<string, string | null> = {}) => ({
    id: `item-${position}`,
    prescription_id: "rx-1",
    name: `Drug ${position}`,
    form: null,
    instructions: "قرص مرتين يوميًا",
    duration: null,
    note: null,
    position,
    rev: 1,
    ...overrides,
  });

  it("keeps the order they were added in", () => {
    expect(sortRxItems([item(3), item(1), item(2)]).map((i) => i.position)).toEqual([1, 2, 3]);
  });

  it("builds the dose line from instructions and duration, with the note apart", () => {
    expect(rxDoseLine(item(1))).toEqual({ dose: "قرص مرتين يوميًا", note: null });
    expect(rxDoseLine(item(1, { duration: "7 أيام", note: "بعد الأكل" }))).toEqual({
      dose: "قرص مرتين يوميًا · 7 أيام",
      note: "بعد الأكل",
    });
    expect(rxDoseLine(item(1, { duration: " ", note: "" }))).toEqual({ dose: "قرص مرتين يوميًا", note: null });
  });
});

describe("computeRxAccess", () => {
  const inRoom = { practitioner_id: "practitioner-1", status: VisitStatus.InRoom };
  const unprinted = { printed_at: null };

  it("lets the visit's own practitioner edit while in_room or completed", () => {
    expect(computeRxAccess("practitioner-1", inRoom, undefined, 0)).toEqual({
      isShown: true,
      canEdit: true,
      readOnlyReason: null,
      readOnlyLine: null,
    });
    expect(computeRxAccess("practitioner-1", { ...inRoom, status: VisitStatus.Completed }, unprinted, 2).canEdit).toBe(true);
  });

  it("is read-only, with the printed line, once printed", () => {
    const access = computeRxAccess("practitioner-1", inRoom, { printed_at: at("10:00") }, 2);
    expect(access.canEdit).toBe(false);
    expect(access.readOnlyLine).toBe("الوصفة اتطبعت ومش ممكن تتعدّل");
  });

  it("shows another membership the list read-only with no line, and nothing when there is no drug", () => {
    expect(computeRxAccess(null, inRoom, unprinted, 2)).toEqual({
      isShown: true,
      canEdit: false,
      readOnlyReason: "not_prescriber",
      readOnlyLine: null,
    });
    expect(computeRxAccess("practitioner-2", inRoom, unprinted, 2).canEdit).toBe(false);
    expect(computeRxAccess(null, inRoom, undefined, 0).isShown).toBe(false);
    expect(computeRxAccess(null, inRoom, unprinted, 0).isShown).toBe(false);
  });

  it("refuses a first drug outside in_room and completed, but not more drugs on an existing prescription", () => {
    const arrived = { ...inRoom, status: VisitStatus.Arrived };
    expect(computeRxAccess("practitioner-1", arrived, undefined, 0)).toMatchObject({
      canEdit: false,
      readOnlyReason: "not_prescribable",
      readOnlyLine: T.rxNotPrescribableLine,
    });
    expect(computeRxAccess("practitioner-1", arrived, unprinted, 1).canEdit).toBe(true);
  });
});

describe("rxErrorMessage", () => {
  it("maps every writer refusal to its Arabic message and field", () => {
    const error = (code: string) => new Error(code);
    expect(rxErrorMessage(error(PrescriptionError.NameRequired))).toEqual({ field: "name", message: T.rxErrorNameRequired });
    expect(rxErrorMessage(error(PrescriptionError.InstructionsRequired))).toEqual({
      field: "instructions",
      message: T.rxErrorInstructionsRequired,
    });
    expect(rxErrorMessage(error(PrescriptionError.NotPrescriber))).toEqual({ field: null, message: T.rxErrorNotPrescriber });
    expect(rxErrorMessage(error(PrescriptionError.Printed))).toEqual({ field: null, message: T.rxPrintedLine });
    expect(rxErrorMessage(error(PrescriptionError.VisitNotPrescribable))).toEqual({
      field: null,
      message: T.rxNotPrescribableLine,
    });
    expect(rxErrorMessage(error(DEVICE_SERIES_UNKNOWN))).toEqual({
      field: null,
      message: dayScreenStrings.deviceSeriesUnknownError,
    });
    expect(rxErrorMessage(error("prescription_item_not_found"))).toEqual({ field: null, message: T.rxErrorFailed });
    expect(rxErrorMessage("not an error")).toEqual({ field: null, message: T.rxErrorFailed });
  });
});

describe("sessionMinutes", () => {
  it("runs live from started_at while in_room", () => {
    const visit = makeVisit({ status: VisitStatus.InRoom, started_at: at("09:00") });
    expect(sessionMinutes(visit, nowAt("09:00"))).toBe(0);
    expect(sessionMinutes(visit, new Date(new Date(at("09:14")).getTime() + 59_000))).toBe(14);
  });

  it("is ended_at − started_at once completed, whatever the clock says", () => {
    const visit = completedOn(TODAY, "10:12", { started_at: at("09:30") });
    expect(sessionMinutes(visit, nowAt("15:00"))).toBe(42);
  });

  it("is hidden otherwise", () => {
    expect(sessionMinutes(makeVisit({ status: VisitStatus.Arrived }), nowAt("09:00"))).toBeNull();
    expect(sessionMinutes(makeVisit({ status: VisitStatus.Completed, started_at: null, ended_at: at("10:00") }), nowAt("10:00"))).toBeNull();
  });
});

describe("sessionLengthPhrase", () => {
  it("says less than a minute for zero, then counts minutes", () => {
    expect(sessionLengthPhrase(0)).toBe("أقل من دقيقة");
    expect(sessionLengthPhrase(1)).toBe("دقيقة واحدة");
    expect(sessionLengthPhrase(14)).toBe("14 دقيقة");
  });
});

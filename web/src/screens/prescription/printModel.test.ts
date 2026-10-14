import { describe, expect, it } from "vitest";
import { PrescriptionError } from "../../db/prescriptions";
import type { Prescription, PrescriptionItem } from "../../db/types";
import { cairoInstant } from "../../domain/time";
import type { PrintClinicLines } from "../day/printClinic";
import {
  buildRxPrintModel,
  computeRxPrintState,
  rxPrintErrorMessage,
  type RxPrintInput,
} from "./printModel";
import { prescriptionPrintStrings as T } from "./strings";

const CLINIC: PrintClinicLines = {
  title: "عيادة النور",
  details: ["الفرع الرئيسي", "شارع الجمهورية، القاهرة", "02 2123 4567"],
  phone: "02 2123 4567",
};

function makePrescription(overrides: Partial<Prescription> = {}): Prescription {
  return {
    id: "rx-1",
    org_id: "org-1",
    location_id: "location-1",
    visit_id: "visit-1",
    patient_id: "patient-1",
    practitioner_id: "practitioner-1",
    series: 1,
    issued_year: 2026,
    number: 287,
    diagnosis: null,
    printed_at: null,
    created_by: "membership-1",
    created_at: cairoInstant("2026-09-30", "10:00"),
    rev: 1,
    ...overrides,
  };
}

function makeItem(position: number, overrides: Partial<PrescriptionItem> = {}): PrescriptionItem {
  return {
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
  };
}

function input(overrides: Partial<RxPrintInput> = {}): RxPrintInput {
  return {
    prescription: makePrescription(),
    items: [makeItem(1)],
    visitForm: { complaint: "ألم في الركبة", diagnosis: "التهاب وتر الرضفة" },
    patient: { full_name: "كريم فتحي", birth_year: 1992 },
    practitioner: { full_name: "أحمد المصري", title: "استشاري العلاج الطبيعي", syndicate_number: null },
    clinic: CLINIC,
    now: new Date(cairoInstant("2026-09-30", "11:00")),
    ...overrides,
  };
}


describe("buildRxPrintModel", () => {
  it("names the doctor, their title and the clinic lines in `.rx-doc`", () => {
    const model = buildRxPrintModel(input());
    expect(model.doctorName).toBe("د. أحمد المصري");
    expect(model.doctorSpec).toEqual({ title: "استشاري العلاج الطبيعي", syndicateNumber: null });
    expect(model.clinic).toBe(CLINIC);
  });

  it("carries the syndicate number after the title, trimmed", () => {
    const practitioner = { full_name: "أحمد المصري", title: "استشاري العلاج الطبيعي", syndicate_number: " 12345 " };
    expect(buildRxPrintModel(input({ practitioner })).doctorSpec).toEqual({
      title: "استشاري العلاج الطبيعي",
      syndicateNumber: "12345",
    });
  });

  it("leaves out the title when there is none, keeping the syndicate number", () => {
    const practitioner = { full_name: "أحمد المصري", title: "", syndicate_number: "12345" };
    expect(buildRxPrintModel(input({ practitioner })).doctorSpec).toEqual({ title: null, syndicateNumber: "12345" });
  });

  it("omits the whole line when there is neither a title nor a syndicate number", () => {
    expect(
      buildRxPrintModel(input({ practitioner: { full_name: "أحمد المصري", title: "  ", syndicate_number: null } })).doctorSpec,
    ).toBeNull();
    expect(
      buildRxPrintModel(input({ practitioner: { full_name: "أحمد المصري", title: "", syndicate_number: " " } })).doctorSpec,
    ).toBeNull();
  });

  it("formats the number in its series", () => {
    expect(buildRxPrintModel(input()).number).toBe("RX-2026-0287");
    expect(buildRxPrintModel(input({ prescription: makePrescription({ series: 2 }) })).number).toBe("RX-2026-B-0287");
  });

  it("before the first print, shows today's Cairo date and the visit's current diagnosis", () => {
    // 23:30 UTC on the 30th is already the 1st in Cairo.
    const model = buildRxPrintModel(input({ now: new Date("2026-09-30T23:30:00Z") }));
    expect(model.date).toBe("1 / 10 / 2026");
    expect(model.diagnosis).toBe("التهاب وتر الرضفة");
  });

  it("once printed, shows the print's Cairo date and the diagnosis snapshot, not the visit's current one", () => {
    const model = buildRxPrintModel(
      input({
        prescription: makePrescription({ printed_at: cairoInstant("2026-09-30", "10:15"), diagnosis: "إجهاد عضلي" }),
        now: new Date(cairoInstant("2026-10-12", "09:00")),
      }),
    );
    expect(model.date).toBe("30 / 9 / 2026");
    expect(model.diagnosis).toBe("إجهاد عضلي");
  });

  it("omits an empty diagnosis, before and after printing", () => {
    expect(buildRxPrintModel(input({ visitForm: { complaint: "", diagnosis: "   " } })).diagnosis).toBeNull();
    const printed = makePrescription({ printed_at: cairoInstant("2026-09-30", "10:15"), diagnosis: null });
    expect(buildRxPrintModel(input({ prescription: printed })).diagnosis).toBeNull();
  });

  it("gives the patient's age, omitted without a birth year", () => {
    expect(buildRxPrintModel(input()).age).toBe(34);
    expect(buildRxPrintModel(input({ patient: { full_name: "كريم فتحي", birth_year: null } })).age).toBeNull();
    expect(buildRxPrintModel(input()).patientName).toBe("كريم فتحي");
  });

  it("numbers the drugs 1..n in position order, whatever gaps removed items left", () => {
    const model = buildRxPrintModel(
      input({
        items: [
          makeItem(4, { name: "Voltaren Gel 1%", form: "Topical", instructions: "دهان 3 مرات يوميًا", duration: "14 يوم" }),
          makeItem(1, { name: "Diclofenac 50mg", form: "Tablet", note: "يوقف مع أي ألم في المعدة", duration: "7 أيام" }),
          makeItem(2, { name: "Paracetamol 500mg", instructions: "قرص عند الحاجة" }),
        ],
      }),
    );
    expect(model.drugs).toEqual([
      {
        number: 1,
        name: "Diclofenac 50mg — Tablet",
        dose: {
          instructions: "قرص مرتين يوميًا",
          duration: "7 أيام",
          dose: "قرص مرتين يوميًا · لمدة 7 أيام",
          note: "يوقف مع أي ألم في المعدة",
        },
        note: "يوقف مع أي ألم في المعدة",
      },
      {
        number: 2,
        name: "Paracetamol 500mg",
        dose: { instructions: "قرص عند الحاجة", duration: null, dose: "قرص عند الحاجة", note: null },
        note: null,
      },
      {
        number: 3,
        name: "Voltaren Gel 1% — Topical",
        dose: { instructions: "دهان 3 مرات يوميًا", duration: "14 يوم", dose: "دهان 3 مرات يوميًا · لمدة 14 يوم", note: null },
        note: null,
      },
    ]);
  });
});

describe("computeRxPrintState", () => {
  const visit = { practitioner_id: "practitioner-1" };
  const unprinted = { printed_at: null };
  const printed = { printed_at: cairoInstant("2026-09-30", "10:15") };

  it("asks the visit's practitioner before the first print", () => {
    expect(computeRxPrintState("practitioner-1", visit, unprinted, 2)).toEqual({
      isButtonShown: true,
      buttonLabel: T.printButton,
      step: { kind: "confirm" },
    });
  });

  it("refuses a first print by anyone else, with its message", () => {
    for (const acting of [null, "practitioner-2"]) {
      expect(computeRxPrintState(acting, visit, unprinted, 2)).toEqual({
        isButtonShown: true,
        buttonLabel: T.printButton,
        step: { kind: "refuse", message: T.errorNotPrescriber },
      });
    }
  });

  it("reprints a printed one for anyone, without asking", () => {
    for (const acting of [null, "practitioner-1", "practitioner-2"]) {
      expect(computeRxPrintState(acting, visit, printed, 1)).toEqual({
        isButtonShown: true,
        buttonLabel: T.reprintButton,
        step: { kind: "print" },
      });
    }
  });

  it("hides the button and refuses an empty prescription", () => {
    expect(computeRxPrintState("practitioner-1", visit, unprinted, 0)).toEqual({
      isButtonShown: false,
      buttonLabel: T.printButton,
      step: { kind: "refuse", message: T.errorEmpty },
    });
  });
});

describe("rxPrintErrorMessage", () => {
  it("maps the writer's refusals, and anything else to a retry line", () => {
    expect(rxPrintErrorMessage(new Error(PrescriptionError.NotPrescriber))).toBe(T.errorNotPrescriber);
    expect(rxPrintErrorMessage(new Error(PrescriptionError.Empty))).toBe(T.errorEmpty);
    expect(rxPrintErrorMessage(new Error("no_acting_membership"))).toBe(T.errorFailed);
    expect(rxPrintErrorMessage("boom")).toBe(T.errorFailed);
  });
});

import { PrescriptionError } from "../../db/prescriptions";
import type { Patient, Practitioner, Prescription, PrescriptionItem, Visit } from "../../db/types";
import type { VisitFormFieldValues } from "../../db/visitForm";
import { formatPrescriptionNumber } from "../../domain/numberSeries";
import { practitionerTitleOf, syndicateNumberOf } from "../../domain/practitionerProfile";
import { formatSlashDate } from "../../domain/slashDate";
import { todayInCairo } from "../../domain/time";
import type { PrintClinicLines } from "../day/printClinic";
import { computeAge } from "../doctor/doctorDay";
import { rxDoseLine, sortRxItems } from "../visit/workspace";
import { prescriptionPrintStrings as T } from "./strings";

// Pure derivations behind the printed prescription (reference screen 16).
// None reads the database or the clock on its own.

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

export interface RxPrintDrug {
  /** `.num`: 1, 2, 3… in position order. */
  number: number;
  /** `.n`: "name — form", or the name alone without a form. Rendered left to right. */
  name: string;
  /** `.dose`: "instructions · duration". */
  dose: string;
  /** `.note`; null when empty. */
  note: string | null;
}

/** The first `.doc-spec` line: "{title} · رقم النقابة {n}", either part left out when the practitioner has none. */
export interface RxDoctorSpec {
  title: string | null;
  /** The number alone; the line renders it after "رقم النقابة", as its own left-to-right run. */
  syndicateNumber: string | null;
}

export interface RxPrintModel {
  /** `.doc-name`: "د. {full_name}". */
  doctorName: string;
  /** The first `.doc-spec` line; null when the practitioner has neither a title nor a syndicate number. */
  doctorSpec: RxDoctorSpec | null;
  /** The second `.doc-spec` line: the same clinic lines as every other printed page. */
  clinic: PrintClinicLines;
  /** `.rx-num`: "RX-2026-0287". */
  number: string;
  /** `.rx-num`: "30 / 9 / 2026" — the print's Cairo date once printed, today's before. */
  date: string;
  patientName: string;
  /** Null when the birth year is unknown — the "العمر" part is omitted. */
  age: number | null;
  /** The snapshot once printed, the visit's current diagnosis before; null when empty. */
  diagnosis: string | null;
  drugs: RxPrintDrug[];
}

export interface RxPrintInput {
  prescription: Prescription;
  items: readonly PrescriptionItem[];
  /** The visit's general form as it stands now (only read before the first print). */
  visitForm: VisitFormFieldValues;
  patient: Pick<Patient, "full_name" | "birth_year"> | undefined;
  practitioner: Pick<Practitioner, "full_name" | "title" | "syndicate_number"> | undefined;
  clinic: PrintClinicLines;
  now: Date;
}

/**
 * What the printed prescription shows (`.rx-doc`, `.rx-pt`, `.rx-drug`s).
 * Once printed, it is the prescription as printed: its date is printed_at's
 * and its diagnosis the snapshot taken then; before that, it is today's
 * preview with the visit's current diagnosis.
 */
export function buildRxPrintModel(input: RxPrintInput): RxPrintModel {
  const { prescription, practitioner, patient } = input;
  const issuedAt = prescription.printed_at !== null ? new Date(prescription.printed_at) : input.now;
  const doctorSpec: RxDoctorSpec = {
    title: practitionerTitleOf(practitioner?.title),
    syndicateNumber: syndicateNumberOf(practitioner?.syndicate_number),
  };
  return {
    doctorName: `${T.doctorPrefix} ${practitioner?.full_name ?? ""}`,
    doctorSpec: doctorSpec.title === null && doctorSpec.syndicateNumber === null ? null : doctorSpec,
    clinic: input.clinic,
    number: formatPrescriptionNumber(prescription),
    date: formatSlashDate(todayInCairo(issuedAt)),
    patientName: patient?.full_name ?? "",
    age: computeAge(patient?.birth_year ?? null, issuedAt),
    diagnosis:
      prescription.printed_at !== null ? nonEmpty(prescription.diagnosis) : nonEmpty(input.visitForm.diagnosis),
    drugs: sortRxItems(input.items).map((item, index) => {
      const { dose, note } = rxDoseLine(item);
      const form = nonEmpty(item.form);
      return { number: index + 1, name: form ? `${item.name} — ${form}` : item.name, dose, note };
    }),
  };
}

/** What pressing "طباعة / حفظ PDF" does. */
export type RxPrintStep =
  /** The first print, by the visit's practitioner: ask first, since it locks the prescription. */
  | { kind: "confirm" }
  /** Already printed: straight to the print dialog, nothing written. */
  | { kind: "print" }
  /** Refused before anything is written or the print dialog opens. */
  | { kind: "refuse"; message: string };

export interface RxPrintState {
  /** The workspace's print button renders at all: only with at least one drug. */
  isButtonShown: boolean;
  /** "اطبع الوصفة", or "اطبع تاني" once printed. */
  buttonLabel: string;
  step: RxPrintStep;
}

/**
 * Mirrors markPrescriptionPrinted's own rules: an empty prescription cannot
 * be printed; the first print is the visit's practitioner's alone and is
 * irreversible, so it is confirmed; a printed one reprints for anyone who
 * can see it, without a write.
 */
export function computeRxPrintState(
  actingPractitionerId: string | null,
  visit: Pick<Visit, "practitioner_id">,
  prescription: Pick<Prescription, "printed_at">,
  itemCount: number,
): RxPrintState {
  const isPrinted = prescription.printed_at !== null;
  const isPrescriber = actingPractitionerId !== null && actingPractitionerId === visit.practitioner_id;
  let step: RxPrintStep;
  if (itemCount === 0) {
    step = { kind: "refuse", message: T.errorEmpty };
  } else if (isPrinted) {
    step = { kind: "print" };
  } else if (!isPrescriber) {
    step = { kind: "refuse", message: T.errorNotPrescriber };
  } else {
    step = { kind: "confirm" };
  }
  return {
    isButtonShown: itemCount > 0,
    buttonLabel: isPrinted ? T.reprintButton : T.printButton,
    step,
  };
}

/** A thrown markPrescriptionPrinted error as the visible Arabic message. */
export function rxPrintErrorMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  switch (code) {
    case PrescriptionError.NotPrescriber:
      return T.errorNotPrescriber;
    case PrescriptionError.Empty:
      return T.errorEmpty;
    default:
      return T.errorFailed;
  }
}

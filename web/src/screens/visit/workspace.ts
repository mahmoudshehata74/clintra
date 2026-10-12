import { isDeviceSeriesUnknown } from "../../db/deviceRegistration";
import { PrescriptionError } from "../../db/prescriptions";
import type { Patient, Prescription, PrescriptionItem, Visit } from "../../db/types";
import type { VisitFormFieldValues } from "../../db/visitForm";
import { arabicCount, type ArabicCountForms } from "../../domain/arabicText";
import { formatEgyptianPhoneForDisplay } from "../../domain/phone";
import { todayInCairo } from "../../domain/time";
import { VisitStatus } from "../../domain/visitStatus";
import { dayScreenStrings } from "../day/strings";
import { computeAge, formatRelativeVisitTime } from "../doctor/doctorDay";
import { visitWorkspaceStrings as T } from "./strings";

// Pure derivations behind the visit workspace (reference screen 10). None
// reads the database or the clock on its own.

/** How many past visits `.visit-history` lists at most. */
export const VISIT_HISTORY_LIMIT = 3;

/** How many drug names a history row names before "+N". */
const HISTORY_DRUG_NAMES = 2;

/** A counted phrase as one string: "دواء واحد", "دوائين", "3 أدوية", "11 دواء". */
export function countPhrase(count: number, forms: ArabicCountForms): string {
  const { numeral, words } = arabicCount(count, forms);
  return numeral === null ? words : `${numeral} ${words}`;
}

export const RX_COUNT_FORMS: ArabicCountForms = {
  one: T.rxCountOne,
  two: T.rxCountTwo,
  few: T.rxCountFew,
  many: T.rxCountMany,
};

export const VISIT_COUNT_FORMS: ArabicCountForms = {
  one: T.visitsOne,
  two: T.visitsTwo,
  few: T.visitsFew,
  many: T.visitsMany,
};

export const MINUTE_FORMS: ArabicCountForms = {
  one: T.minuteOne,
  two: T.minuteTwo,
  few: T.minuteFew,
  many: T.minuteMany,
};

// ── Patient history ──────────────────────────────────────────────────────

/**
 * The patient's completed visits before this one, newest first, with any
 * practitioner whose visits this device holds (what the membership's sync
 * scope can see). "Before" is by day; on the same day, a visit counts when
 * the current one is still open, or when it ended before the current one did.
 */
export function priorCompletedVisits(patientVisits: readonly Visit[], current: Visit): Visit[] {
  return patientVisits
    .filter((visit) => {
      if (visit.id === current.id || visit.patient_id !== current.patient_id || visit.status !== VisitStatus.Completed) {
        return false;
      }
      if (visit.visit_date !== current.visit_date) {
        return visit.visit_date < current.visit_date;
      }
      return current.status !== VisitStatus.Completed || (visit.ended_at ?? "") < (current.ended_at ?? "");
    })
    .sort((a, b) => b.visit_date.localeCompare(a.visit_date) || (b.ended_at ?? "").localeCompare(a.ended_at ?? ""));
}

export interface PatientSummary {
  /** `.avatar`: the name's first letter. */
  initial: string;
  name: string;
  /** Null when birth_year is unknown — the "· N سنة" part is then omitted. */
  age: number | null;
  /** Local display format ("010 0123 4567"); null when the patient has no phone. */
  phone: string | null;
  /** "4 زيارات"; null without a prior visit. */
  visitCount: string | null;
  /** "قبل 3 أسابيع", "من شهرين"…; null without a prior visit. */
  lastVisitRelative: string | null;
}

/** `.pt-summary`'s parts, each null when there is nothing to show for it. */
export function summarizePatient(patient: Patient | undefined, prior: readonly Visit[], now: Date): PatientSummary {
  const name = patient?.full_name ?? "";
  const last = prior[0];
  return {
    initial: name.charAt(0),
    name,
    age: computeAge(patient?.birth_year ?? null, now),
    phone: patient?.phone ? formatEgyptianPhoneForDisplay(patient.phone) : null,
    visitCount: prior.length > 0 ? countPhrase(prior.length, VISIT_COUNT_FORMS) : null,
    lastVisitRelative: last ? formatRelativeVisitTime(last.visit_date, todayInCairo(now)) : null,
  };
}

export interface VisitHistoryRow {
  visitId: string;
  /** d/m, e.g. "15/8". */
  date: string;
  /** The diagnosis, else the complaint, else "من غير تشخيص". */
  title: string;
  /** "Diclofenac 50mg، Paracetamol 500mg +1"; null when the visit has no prescribed drug. */
  drugs: string | null;
}

/** "2026-08-15" → "15/8". */
export function dayMonth(day: string): string {
  const [, month, date] = day.split("-").map(Number);
  return `${date}/${month}`;
}

/** The first two names, then "+N" for the rest; null for none. */
export function formatDrugSummary(names: readonly string[]): string | null {
  if (names.length === 0) {
    return null;
  }
  const shown = names.slice(0, HISTORY_DRUG_NAMES).join("، ");
  const rest = names.length - HISTORY_DRUG_NAMES;
  return rest > 0 ? `${shown} +${rest}` : shown;
}

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/**
 * `.visit-history-item`s: the newest VISIT_HISTORY_LIMIT of `prior` (already
 * newest first). `drugNamesByVisitId` holds each visit's prescribed drug
 * names in position order.
 */
export function buildVisitHistory(
  prior: readonly Visit[],
  formValuesByVisitId: ReadonlyMap<string, VisitFormFieldValues>,
  drugNamesByVisitId: ReadonlyMap<string, readonly string[]>,
): VisitHistoryRow[] {
  return prior.slice(0, VISIT_HISTORY_LIMIT).map((visit) => {
    const values = formValuesByVisitId.get(visit.id);
    return {
      visitId: visit.id,
      date: dayMonth(visit.visit_date),
      title: nonEmpty(values?.diagnosis) ?? nonEmpty(values?.complaint) ?? T.historyNoDiagnosis,
      drugs: formatDrugSummary(drugNamesByVisitId.get(visit.id) ?? []),
    };
  });
}

/** `.visit-history-h` by the real count: "آخر زيارة", "آخر زيارتين", "آخر 3 زيارات". */
export function visitHistoryHeading(count: number): string {
  const { numeral, words } = arabicCount(count, {
    one: T.historyOne,
    two: T.historyTwo,
    few: T.historyFew,
    many: T.historyMany,
  });
  return numeral === null ? words : `${T.historyPrefix} ${numeral} ${words}`;
}

// ── Prescription (`.rx-section`) ─────────────────────────────────────────

/** Items in the order they were added (position), never renumbered. */
export function sortRxItems(items: readonly PrescriptionItem[]): PrescriptionItem[] {
  return [...items].sort((a, b) => a.position - b.position);
}

export interface RxDoseLine {
  /** "instructions · duration" — the duration part omitted when empty. */
  dose: string;
  /** Rendered muted after the dose; null when empty. */
  note: string | null;
}

/** `.rx-item .dose`. */
export function rxDoseLine(item: Pick<PrescriptionItem, "instructions" | "duration" | "note">): RxDoseLine {
  const duration = nonEmpty(item.duration ?? undefined);
  return {
    dose: duration ? `${item.instructions} · ${duration}` : item.instructions,
    note: nonEmpty(item.note ?? undefined),
  };
}

/** Why the prescription is shown without its add, edit and remove controls. */
export type RxReadOnlyReason = "printed" | "not_prescriber" | "not_prescribable";

export interface RxAccess {
  /** The section renders at all: always for the prescriber, otherwise only when there is a drug to show. */
  isShown: boolean;
  canEdit: boolean;
  /** Null when editable. */
  readOnlyReason: RxReadOnlyReason | null;
  /** The one muted line under a read-only list; null when it says nothing (an assistant, or editable). */
  readOnlyLine: string | null;
}

/**
 * Mirrors db/prescriptions.ts's own refusals, so the controls only show
 * where a write would be accepted: the acting membership must be the visit's
 * own practitioner, nothing is editable once printed, and a visit with no
 * prescription yet takes a first drug only while in_room or completed (an
 * existing, unprinted one keeps taking drugs whatever the visit's status).
 */
export function computeRxAccess(
  actingPractitionerId: string | null,
  visit: Pick<Visit, "practitioner_id" | "status">,
  prescription: Pick<Prescription, "printed_at"> | undefined,
  itemCount: number,
): RxAccess {
  const isPrescriber = actingPractitionerId !== null && actingPractitionerId === visit.practitioner_id;
  let readOnlyReason: RxReadOnlyReason | null = null;
  if (prescription && prescription.printed_at !== null) {
    readOnlyReason = "printed";
  } else if (!isPrescriber) {
    readOnlyReason = "not_prescriber";
  } else if (!prescription && visit.status !== VisitStatus.InRoom && visit.status !== VisitStatus.Completed) {
    readOnlyReason = "not_prescribable";
  }
  return {
    isShown: isPrescriber || itemCount > 0,
    canEdit: readOnlyReason === null,
    readOnlyReason,
    readOnlyLine:
      readOnlyReason === "printed"
        ? T.rxPrintedLine
        : readOnlyReason === "not_prescribable"
          ? T.rxNotPrescribableLine
          : null,
  };
}

export interface RxErrorMessage {
  /** The form field the message belongs under; null for a message about the whole write. */
  field: "name" | "instructions" | null;
  message: string;
}

/** A thrown prescription write error as the visible Arabic message. */
export function rxErrorMessage(error: unknown): RxErrorMessage {
  if (isDeviceSeriesUnknown(error)) {
    return { field: null, message: dayScreenStrings.deviceSeriesUnknownError };
  }
  const code = error instanceof Error ? error.message : "";
  switch (code) {
    case PrescriptionError.NameRequired:
      return { field: "name", message: T.rxErrorNameRequired };
    case PrescriptionError.InstructionsRequired:
      return { field: "instructions", message: T.rxErrorInstructionsRequired };
    case PrescriptionError.NotPrescriber:
      return { field: null, message: T.rxErrorNotPrescriber };
    case PrescriptionError.Printed:
      return { field: null, message: T.rxPrintedLine };
    case PrescriptionError.VisitNotPrescribable:
      return { field: null, message: T.rxNotPrescribableLine };
    default:
      return { field: null, message: T.rxErrorFailed };
  }
}

// ── Session length (`.runrow .count`) ────────────────────────────────────

/**
 * Whole minutes in the room: live from started_at while in_room, ended_at −
 * started_at once completed; null otherwise (the count is hidden).
 */
export function sessionMinutes(visit: Pick<Visit, "status" | "started_at" | "ended_at">, now: Date): number | null {
  if (visit.started_at === null) {
    return null;
  }
  const started = new Date(visit.started_at).getTime();
  if (visit.status === VisitStatus.InRoom) {
    return Math.max(0, Math.floor((now.getTime() - started) / 60_000));
  }
  if (visit.status === VisitStatus.Completed && visit.ended_at !== null) {
    return Math.max(0, Math.floor((new Date(visit.ended_at).getTime() - started) / 60_000));
  }
  return null;
}

import { normalizeArabicText } from "../domain/arabicText";
import { normalizeEgyptianPhone } from "../domain/phone";
import { VisitStatus } from "../domain/visitStatus";
import type { ClintraDatabase } from "./database";
import type { ClinicDay, Patient } from "./types";

const MAX_RESULTS = 8;

export interface PatientSearchResult {
  patient: Patient;
  /** The most recent completed visit's date, or null if the patient has never completed one. */
  lastVisitDate: ClinicDay | null;
}

/**
 * Searches patients by full_name (substring, tashkeel- and case-insensitive)
 * and, separately, by phone number normalised the same way the number was
 * stored. An empty query returns no results — this never lists every
 * patient. Name matches are ranked by how early the query appears in the
 * name; phone matches follow. Capped to MAX_RESULTS.
 */
export async function searchPatients(
  db: ClintraDatabase,
  rawQuery: string,
): Promise<PatientSearchResult[]> {
  const trimmed = rawQuery.trim();
  if (!trimmed) {
    return [];
  }

  const normalizedQuery = normalizeArabicText(trimmed);
  const phoneQuery = normalizeEgyptianPhone(trimmed);

  const patients = await db.patients.toArray();
  const matches = patients
    .map((patient) => {
      const nameIndex = normalizeArabicText(patient.full_name).indexOf(normalizedQuery);
      const phoneMatches = phoneQuery.ok && patient.phone === phoneQuery.value;
      return { patient, nameIndex, phoneMatches };
    })
    .filter(({ nameIndex, phoneMatches }) => nameIndex >= 0 || phoneMatches)
    .sort((a, b) => {
      const rankA = a.nameIndex >= 0 ? a.nameIndex : Number.MAX_SAFE_INTEGER;
      const rankB = b.nameIndex >= 0 ? b.nameIndex : Number.MAX_SAFE_INTEGER;
      return rankA - rankB;
    })
    .slice(0, MAX_RESULTS)
    .map(({ patient }) => patient);

  if (matches.length === 0) {
    return [];
  }

  const allVisits = await db.visits.toArray();
  const lastCompletedByPatient = new Map<string, ClinicDay>();
  for (const visit of allVisits) {
    if (visit.status !== VisitStatus.Completed) {
      continue;
    }
    const existing = lastCompletedByPatient.get(visit.patient_id);
    if (!existing || visit.visit_date > existing) {
      lastCompletedByPatient.set(visit.patient_id, visit.visit_date);
    }
  }

  return matches.map((patient) => ({
    patient,
    lastVisitDate: lastCompletedByPatient.get(patient.id) ?? null,
  }));
}

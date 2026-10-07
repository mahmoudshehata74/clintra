import { useState } from "react";
import Ltr from "../../components/Ltr";
import { SheetPanelBody } from "../../components/ui/SheetPanel";
import { closeCashForDay, computeExpectedCashTotal } from "../../db/cashClose";
import { db } from "../../db/database";
import type { Patient, Schedule, Service, Visit } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { markVisitNoShow } from "../../db/visitCancel";
import { formatPiastresForDisplay, parsePoundsToPiastres, type Piastres } from "../../domain/money";
import type { ClinicDay } from "../../domain/time";
import { clockTimeInCairo } from "../../domain/time";
import { VisitStatus } from "../../domain/visitStatus";
import { validateCashCloseForm } from "./cashCloseForm";
import { computePastDueVisits } from "./pastDueVisits";
import Sheet from "./Sheet";
import { dayScreenStrings } from "./strings";
import type { UndoAction } from "./undoAction";

interface CashCloseSheetProps {
  locationId: string;
  orgId: string;
  date: ClinicDay;
  onDismiss: () => void;
  onClosed: () => void;
  /** Reported up so DayScreen can show the same toast+undo every other no-show mark uses. */
  onNoShowMarked: (undo: UndoAction) => void;
  /** Closes this sheet and opens the move sheet for the given visit — the same replace-one-sheet-with-another pattern the invoice sheet's "record payment" uses. */
  onRequestMove: (visit: Visit) => void;
}

interface PastDueData {
  visits: Visit[];
  schedules: Schedule[];
  patientsById: Map<string, Patient>;
  servicesById: Map<string, Service>;
}

const EMPTY_PAST_DUE_DATA: PastDueData = { visits: [], schedules: [], patientsById: new Map(), servicesById: new Map() };

/** The day header's cash-close sheet: a past-due gate, then expected vs. collected, with a note required only when they differ. */
export default function CashCloseSheet({
  locationId,
  orgId,
  date,
  onDismiss,
  onClosed,
  onNoShowMarked,
  onRequestMove,
}: CashCloseSheetProps) {
  const [totalCollectedInput, setTotalCollectedInput] = useState("");
  const [note, setNote] = useState("");
  const [acknowledgedPastDue, setAcknowledgedPastDue] = useState(false);
  const [collectedError, setCollectedError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [pastDueError, setPastDueError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isMarkingAll, setIsMarkingAll] = useState(false);

  const invoicesAtLocation =
    useLiveQuery(() => db.invoices.where("location_id").equals(locationId).toArray(), [locationId]) ?? [];
  const expected = computeExpectedCashTotal(invoicesAtLocation, locationId, date);

  const pastDueData =
    useLiveQuery<PastDueData>(async () => {
      const [stillOpenVisits, schedules] = await Promise.all([
        db.visits
          .where("[org_id+location_id+visit_date+status]")
          .anyOf([
            [orgId, locationId, date, VisitStatus.Booked],
            [orgId, locationId, date, VisitStatus.Confirmed],
          ])
          .toArray(),
        db.schedules.toArray(),
      ]);
      const patientIds = [...new Set(stillOpenVisits.map((visit) => visit.patient_id))];
      const serviceIds = [
        ...new Set(stillOpenVisits.map((visit) => visit.service_id).filter((id): id is string => id != null)),
      ];
      const [patients, services] = await Promise.all([
        db.patients.bulkGet(patientIds),
        db.services.bulkGet(serviceIds),
      ]);
      return {
        visits: stillOpenVisits,
        schedules: schedules.filter((schedule) => schedule.location_id === locationId),
        patientsById: new Map(patients.filter((p): p is Patient => p != null).map((p) => [p.id, p])),
        servicesById: new Map(services.filter((s): s is Service => s != null).map((s) => [s.id, s])),
      };
    }, [orgId, locationId, date]) ?? EMPTY_PAST_DUE_DATA;

  const pastDueVisits = computePastDueVisits(pastDueData.visits, pastDueData.schedules, date, new Date());

  const parsedCollected = parsePoundsToPiastres(totalCollectedInput);
  const difference = parsedCollected.ok ? ((parsedCollected.value - expected) as Piastres) : null;

  function positionOrTime(visit: Visit): string {
    return visit.scheduled_at ? clockTimeInCairo(visit.scheduled_at) : String(visit.position);
  }

  async function handleMarkNoShow(visit: Visit) {
    try {
      const auditLogId = await markVisitNoShow(db, visit.id);
      onNoShowMarked({ kind: "visit", auditLogId });
    } catch (error) {
      console.error(error);
    }
  }

  async function handleMarkAllNoShow() {
    setIsMarkingAll(true);
    try {
      const auditLogIds: string[] = [];
      // Sequential, one after another — never a parallel burst of writes.
      for (const visit of pastDueVisits) {
        auditLogIds.push(await markVisitNoShow(db, visit.id));
      }
      onNoShowMarked({ kind: "visit_batch", auditLogIds });
    } catch (error) {
      console.error(error);
    } finally {
      setIsMarkingAll(false);
    }
  }

  async function handleConfirm() {
    const validation = validateCashCloseForm(
      { totalCollectedInput, note, pastDueCount: pastDueVisits.length, acknowledgedPastDue },
      expected,
    );
    if (!validation.ok) {
      setCollectedError(validation.collectedError);
      setNoteError(validation.noteError);
      setPastDueError(validation.pastDueError);
      return;
    }
    setPastDueError(null);

    setIsSubmitting(true);
    try {
      const result = await closeCashForDay(db, {
        locationId,
        orgId,
        date,
        totalCollected: validation.totalCollected,
        differenceNote: validation.note,
      });
      if (!result.ok) {
        setCollectedError(dayScreenStrings.cashCloseAlreadyClosedError);
        return;
      }
      onClosed();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Sheet onDismiss={onDismiss}>
      <SheetPanelBody>
        <p className="font-medium">{dayScreenStrings.cashCloseSheetTitle}</p>

        {pastDueVisits.length > 0 && (
          <div>
            <p className="font-medium text-warning">{dayScreenStrings.cashClosePastDueSectionTitle}</p>
            <ul className="mt-2 flex flex-col gap-2">
              {pastDueVisits.map((visit) => {
                const patient = pastDueData.patientsById.get(visit.patient_id);
                const service = visit.service_id ? pastDueData.servicesById.get(visit.service_id) : undefined;
                return (
                  <li key={visit.id} className="flex items-center justify-between gap-2 rounded-[--radius-el] border border-line p-2 text-sm">
                    <div>
                      <p>
                        <Ltr>{positionOrTime(visit)}</Ltr> — {patient?.full_name ?? ""}
                      </p>
                      {service && <p className="text-muted">{service.name}</p>}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <button type="button" onClick={() => handleMarkNoShow(visit)} className="text-red">
                        {dayScreenStrings.cashClosePastDueNoShowAction}
                      </button>
                      <button type="button" onClick={() => onRequestMove(visit)} className="text-green">
                        {dayScreenStrings.cashClosePastDueMoveAction}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              disabled={isMarkingAll}
              onClick={handleMarkAllNoShow}
              className="mt-2 rounded-[--radius-el] border border-line px-3 py-2 text-sm text-muted disabled:opacity-60"
            >
              {dayScreenStrings.cashClosePastDueBulkAction}
            </button>
            <label className="mt-2 flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={acknowledgedPastDue}
                onChange={(event) => {
                  setAcknowledgedPastDue(event.target.checked);
                  setPastDueError(null);
                }}
              />
              {dayScreenStrings.cashClosePastDueAcknowledgeLabel}
            </label>
            {pastDueError && <p className="mt-1 text-sm text-red">{pastDueError}</p>}
          </div>
        )}

        <p className="flex justify-between text-sm">
          <span className="text-muted">{dayScreenStrings.cashCloseExpectedLabel}</span>
          <Ltr>{formatPiastresForDisplay(expected)}</Ltr>
        </p>

        <div>
          <input
            type="text"
            inputMode="decimal"
            value={totalCollectedInput}
            onChange={(event) => {
              setTotalCollectedInput(event.target.value);
              setCollectedError(null);
            }}
            placeholder={dayScreenStrings.cashCloseCollectedPlaceholder}
            className="w-full rounded-[--radius-el] border border-line bg-paper px-3 py-2 text-start"
          />
          {collectedError && <p className="mt-1 text-sm text-red">{collectedError}</p>}
        </div>

        {difference !== null && (
          <p className="flex justify-between text-sm">
            <span className="text-muted">{dayScreenStrings.cashCloseDifferenceLabel}</span>
            <Ltr>{formatPiastresForDisplay(difference)}</Ltr>
          </p>
        )}

        <div>
          <input
            type="text"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setNoteError(null);
            }}
            placeholder={dayScreenStrings.cashCloseNotePlaceholder}
            className="w-full rounded-[--radius-el] border border-line bg-paper px-3 py-2 text-start"
          />
          {noteError && <p className="mt-1 text-sm text-red">{noteError}</p>}
        </div>

        <button
          type="button"
          disabled={isSubmitting}
          onClick={handleConfirm}
          className="rounded-[--radius-el] bg-green px-4 py-3 text-center font-semibold text-paper disabled:opacity-60"
        >
          {dayScreenStrings.cashCloseConfirmButton}
        </button>
      </SheetPanelBody>
    </Sheet>
  );
}

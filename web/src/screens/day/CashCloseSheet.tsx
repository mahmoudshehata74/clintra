import Dexie from "dexie";
import { useState, type ReactNode } from "react";
import Ltr from "../../components/Ltr";
import Button from "../../components/ui/Button";
import Field, { TextInput } from "../../components/ui/Field";
import { SheetPanelBody, SheetPanelFoot } from "../../components/ui/SheetPanel";
import { useActingMembership } from "../../auth/useActingMembership";
import { closeCashForDay, computeExpectedCashTotal } from "../../db/cashClose";
import { db } from "../../db/database";
import { InvoiceStatus, type CashClose, type Patient, type Schedule, type Service, type Visit } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { markVisitNoShow } from "../../db/visitCancel";
import { parsePoundsToPiastres, type Piastres } from "../../domain/money";
import { clockTimeInCairo, formatCairoDisplayDate, todayInCairo, type ClinicDay } from "../../domain/time";
import { VisitStatus } from "../../domain/visitStatus";
import { formatMoneyAmount } from "../money";
import { validateCashCloseForm } from "./cashCloseForm";
import { computePastDueVisits } from "./pastDueVisits";
import Sheet from "./Sheet";
import SheetHeader from "./SheetHeader";
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

interface SheetData {
  /** Every visit at this location on this day, any status — covers both the past-due gate and the no-show count. */
  visits: Visit[];
  schedules: Schedule[];
  patientsById: Map<string, Patient>;
  servicesById: Map<string, Service>;
  existingClose: CashClose | undefined;
  closedByName: string | null;
}

const EMPTY_SHEET_DATA: SheetData = {
  visits: [],
  schedules: [],
  patientsById: new Map(),
  servicesById: new Map(),
  existingClose: undefined,
  closedByName: null,
};

const CURRENCY_UNIT = dayScreenStrings.tileCurrencyUnit;

/** `.close-cell` — one tile of the summary grid, its value tinted eligible/warning or left neutral. */
function CloseCell({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: "match" | "diff";
}) {
  const valueToneClass = tone === "match" ? "text-eligible" : tone === "diff" ? "text-warning" : "text-text";
  return (
    <div className="rounded-control border border-rule bg-card px-3.5 py-3">
      <span className="block text-[11px] font-semibold text-muted">{label}</span>
      <span className={`mt-0.5 block text-[19px] font-bold tabular-nums tracking-[-0.01em] ${valueToneClass}`}>
        <Ltr>{value}</Ltr>
        {unit && <i className="ms-1 text-[11px] font-semibold not-italic text-faint">{unit}</i>}
      </span>
    </div>
  );
}

/**
 * The day header's cash-close sheet (prototype #s7): a read-only summary
 * once this location/day is already closed; otherwise the past-due gate,
 * the day's summary grid, the actual-cash field with its match/diff result
 * banner, and the note required only once they differ.
 */
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

  const actingMembership = useActingMembership();
  const actingUser = useLiveQuery(
    async () => (actingMembership ? db.users.get(actingMembership.user_id) : undefined),
    [actingMembership?.user_id],
  );

  const invoicesAtLocation =
    useLiveQuery(() => db.invoices.where("location_id").equals(locationId).toArray(), [locationId]) ?? [];
  const expected = computeExpectedCashTotal(invoicesAtLocation, locationId, date);
  const invoicesToday = invoicesAtLocation.filter((invoice) => todayInCairo(new Date(invoice.issued_at)) === date);
  const paidInvoiceCount = invoicesToday.filter((invoice) => invoice.status === InvoiceStatus.Paid).length;

  const data =
    useLiveQuery<SheetData>(async () => {
      const [visits, schedules, existingClose] = await Promise.all([
        db.visits
          .where("[org_id+location_id+visit_date+status]")
          .between([orgId, locationId, date, Dexie.minKey], [orgId, locationId, date, Dexie.maxKey])
          .toArray(),
        db.schedules.toArray(),
        db.cash_close.where("[location_id+date]").equals([locationId, date]).first(),
      ]);
      const patientIds = [...new Set(visits.map((visit) => visit.patient_id))];
      const serviceIds = [...new Set(visits.map((visit) => visit.service_id).filter((id): id is string => id != null))];
      const [patients, services] = await Promise.all([
        db.patients.bulkGet(patientIds),
        db.services.bulkGet(serviceIds),
      ]);

      let closedByName: string | null = null;
      if (existingClose) {
        const closedByMembership = await db.memberships.get(existingClose.closed_by);
        const closedByUser = closedByMembership ? await db.users.get(closedByMembership.user_id) : undefined;
        closedByName = closedByUser?.full_name ?? null;
      }

      return {
        visits,
        schedules: schedules.filter((schedule) => schedule.location_id === locationId),
        patientsById: new Map(patients.filter((p): p is Patient => p != null).map((p) => [p.id, p])),
        servicesById: new Map(services.filter((s): s is Service => s != null).map((s) => [s.id, s])),
        existingClose,
        closedByName,
      };
    }, [orgId, locationId, date]) ?? EMPTY_SHEET_DATA;

  const noShowCountToday = data.visits.filter((visit) => visit.status === VisitStatus.NoShow).length;
  const pastDueVisits = computePastDueVisits(data.visits, data.schedules, date, new Date());

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

  const headTitle = `${dayScreenStrings.cashCloseHeadTitlePrefix} ${formatCairoDisplayDate(date)}`;

  if (data.existingClose) {
    const closedClose = data.existingClose;
    return (
      <Sheet onDismiss={onDismiss}>
        <SheetHeader title={headTitle} onDismiss={onDismiss} />
        <SheetPanelBody>
          <div className="rounded-card bg-field p-5">
            <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.05em] text-muted">
              {dayScreenStrings.cashCloseSummaryHeading}
            </p>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
              <CloseCell label={dayScreenStrings.cashCloseExpectedLabel} value={formatMoneyAmount(closedClose.total_expected)} unit={CURRENCY_UNIT} />
              <CloseCell
                label={dayScreenStrings.cashCloseGridCollectedLabel}
                value={formatMoneyAmount(closedClose.total_collected)}
                unit={CURRENCY_UNIT}
                tone={closedClose.difference === 0 ? "match" : "diff"}
              />
              <CloseCell
                label={dayScreenStrings.cashCloseDifferenceLabel}
                value={formatMoneyAmount(closedClose.difference)}
                unit={CURRENCY_UNIT}
                tone={closedClose.difference === 0 ? "match" : "diff"}
              />
              <CloseCell label={dayScreenStrings.cashCloseClosedAtLabel} value={clockTimeInCairo(closedClose.closed_at)} />
            </div>
          </div>
          <p className="text-sm text-muted">
            {dayScreenStrings.cashCloseClosedByLabel} <span className="font-semibold text-text">{data.closedByName ?? ""}</span>
          </p>
          <p className="text-sm text-muted">{closedClose.difference_note ?? dayScreenStrings.cashCloseNoDifferenceNoteLabel}</p>
        </SheetPanelBody>
      </Sheet>
    );
  }

  return (
    <Sheet onDismiss={onDismiss}>
      <SheetHeader title={headTitle} onDismiss={onDismiss} />
      <SheetPanelBody>
        {pastDueVisits.length > 0 && (
          <div className="flex flex-col gap-2 rounded-card border border-warning/40 bg-warning-wash p-3">
            <p className="text-[13px] font-bold text-warning">{dayScreenStrings.cashClosePastDueSectionTitle}</p>
            <ul className="flex flex-col gap-2">
              {pastDueVisits.map((visit) => {
                const patient = data.patientsById.get(visit.patient_id);
                const service = visit.service_id ? data.servicesById.get(visit.service_id) : undefined;
                return (
                  <li key={visit.id} className="flex items-center justify-between gap-2 rounded-control border border-rule bg-card px-3 py-2 text-[13px]">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-text">
                        <Ltr>{positionOrTime(visit)}</Ltr> — {patient?.full_name ?? ""}
                      </p>
                      {service && <p className="truncate text-[11.5px] text-muted">{service.name}</p>}
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Button variant="danger" size="sm" onClick={() => handleMarkNoShow(visit)}>
                        {dayScreenStrings.cashClosePastDueNoShowAction}
                      </Button>
                      <Button variant="secondary" size="sm" onClick={() => onRequestMove(visit)}>
                        {dayScreenStrings.cashClosePastDueMoveAction}
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
            <Button variant="outline" disabled={isMarkingAll} onClick={handleMarkAllNoShow}>
              {dayScreenStrings.cashClosePastDueBulkAction}
            </Button>
            <label className="flex items-center gap-2 text-[12.5px] text-muted">
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
            {pastDueError && <p className="text-[12.5px] text-danger">{pastDueError}</p>}
          </div>
        )}

        {/* `.close-summary` */}
        <div className="rounded-card bg-field p-5">
          <p className="mb-2.5 text-[11px] font-bold uppercase tracking-[0.05em] text-muted">
            {dayScreenStrings.cashCloseSummaryHeading}
          </p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
            <CloseCell label={dayScreenStrings.cashCloseExpectedLabel} value={formatMoneyAmount(expected)} unit={CURRENCY_UNIT} />
            <CloseCell
              label={dayScreenStrings.cashCloseGridCollectedLabel}
              value={parsedCollected.ok ? formatMoneyAmount(parsedCollected.value) : "—"}
              unit={parsedCollected.ok ? CURRENCY_UNIT : undefined}
              tone={difference === null ? undefined : difference === 0 ? "match" : "diff"}
            />
            <CloseCell label={dayScreenStrings.cashCloseGridInvoicesLabel} value={paidInvoiceCount} unit={dayScreenStrings.cashCloseGridInvoicesUnit} />
            <CloseCell label={dayScreenStrings.slabNoShowCellLabel} value={noShowCountToday} />
          </div>
        </div>

        <Field label={dayScreenStrings.cashCloseActualCashFieldLabel} id="cash-close-collected" error={collectedError ?? undefined}>
          <TextInput
            variant="amount"
            inputMode="decimal"
            value={totalCollectedInput}
            onChange={(event) => {
              setTotalCollectedInput(event.target.value);
              setCollectedError(null);
            }}
            placeholder={dayScreenStrings.cashCloseCollectedPlaceholder}
          />
        </Field>

        {difference !== null &&
          (difference === 0 ? (
            <div className="flex items-center gap-2.5 rounded-control border border-green-line bg-[color-mix(in_srgb,var(--color-eligible)_8%,transparent)] px-3.5 py-3">
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-control bg-eligible text-sm font-bold text-white">✓</span>
              <div>
                <p className="text-[13.5px] font-bold text-eligible">{dayScreenStrings.cashCloseMatchedTitle}</p>
                <p className="text-[11.5px] text-muted">{dayScreenStrings.cashCloseMatchedSubtitle}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 rounded-control border border-[color-mix(in_srgb,var(--color-warning)_40%,transparent)] bg-warning-wash px-3.5 py-3">
              <span className="flex h-8 w-8 flex-none items-center justify-center rounded-control bg-warning text-sm font-bold text-white">!</span>
              <p className="text-[13.5px] font-bold text-warning">
                {dayScreenStrings.cashCloseDifferenceLabel} <Ltr>{formatMoneyAmount(difference)}</Ltr> {CURRENCY_UNIT}
              </p>
            </div>
          ))}

        {difference !== null && difference !== 0 && (
          <Field label={dayScreenStrings.cashCloseNotePlaceholder} id="cash-close-note" error={noteError ?? undefined}>
            <TextInput
              type="text"
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                setNoteError(null);
              }}
            />
          </Field>
        )}
      </SheetPanelBody>

      <SheetPanelFoot>
        <Button variant="primary" className="flex-1" disabled={isSubmitting} onClick={handleConfirm}>
          {dayScreenStrings.cashCloseConfirmButton}
        </Button>
        <Button variant="secondary" disabled>
          {dayScreenStrings.cashCloseExportCsvAction}
        </Button>
        {actingUser && (
          <span className="ms-auto self-center text-[11.5px] text-muted">
            {dayScreenStrings.cashCloseClosesCountPrefix} <b className="font-bold text-text">{actingUser.full_name}</b>
          </span>
        )}
      </SheetPanelFoot>
    </Sheet>
  );
}

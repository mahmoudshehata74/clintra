import { useEffect, useState, type ReactNode } from "react";
import Ltr from "../../components/Ltr";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Card, { CardHead } from "../../components/ui/Card";
import { db } from "../../db/database";
import { getDeviceBinding } from "../../db/deviceRegistration";
import type { Invoice, Patient, Practitioner, Service, Visit } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { markVisitCompleted, markVisitInRoom } from "../../db/visitAttendance";
import { findGeneralFormDefinition, readVisitFormValues, type VisitFormFieldValues } from "../../db/visitForm";
import { ScheduleMode } from "../../domain/scheduleMode";
import { clockTimeInCairo, weekdayOf, type ClinicDay } from "../../domain/time";
import { VisitStatus } from "../../domain/visitStatus";
import {
  ADVANCE_COOLDOWN_MS,
  beginCooldown,
  elapseCooldown,
  EMPTY_COOLDOWN_STATE,
  isCoolingDown,
  settleCooldown,
  type CooldownState,
} from "../day/advanceCooldown";
import { computeElapsedLabel, formatElapsedMinutes } from "../day/elapsedLabel";
import VisitFormSheet from "../day/VisitFormSheet";
import {
  canCallIn,
  computeAge,
  computeAttentionItems,
  computeDayList,
  computeMomentum,
  computeWaitingRoom,
  countNoun,
  countPriorCompletedVisits,
  dayListAction,
  endedAtClock,
  findCurrentVisit,
  findLastInvoiceState,
  findNextPatient,
  hasMissingDiagnosis,
  lastInvoiceStateLabel,
  PATIENT_FORMS,
  PRIOR_VISIT_FORMS,
  summarizeLastVisit,
  VISIT_FORMS,
  waitingWord,
  type AttentionItem,
  type LastVisitSummary,
  type MomentumSummary,
  type WaitingRoom,
} from "./doctorDay";
import QuickNote from "./QuickNote";
import { doctorDayStrings as T } from "./strings";

interface DoctorDayScreenProps {
  /** The acting membership's own practitioner (memberships.practitioner_id). */
  practitionerId: string;
  /** The clinic day the day screen is showing — App.tsx forwards the one DayScreen reports. */
  today: ClinicDay;
  /** Reports the practitioner's name up for the app bar's "who" (AppShell's whoName). */
  onPractitionerName: (name: string) => void;
}

interface DoctorDayData {
  practitioner: Practitioner | undefined;
  isQueueMode: boolean;
  /** This practitioner's visits today at the device's location, every status. */
  visits: Visit[];
  patientsById: Map<string, Patient>;
  servicesById: Map<string, Service>;
  /** Today's invoices, by visit. */
  invoicesByVisitId: Map<string, Invoice>;
  /** The general form's values, for today's visits and for the current/next patient's past visits. */
  formValuesByVisitId: Map<string, VisitFormFieldValues>;
  /** Every visit (any day, any practitioner on this device) of the current and next patients. */
  historyVisits: Visit[];
  /** Every invoice of the next patient. */
  nextPatientInvoices: Invoice[];
}

/**
 * The doctor's own day (reference screen 9, "شاشة الطبيب — قائمة اليوم"),
 * for one practitioner on the day the day screen shows. Read live from
 * Dexie the way DayScreen reads its own grid; every write goes through the
 * same db/ paths the day screen's row taps use (markVisitInRoom,
 * markVisitCompleted — so completion still creates the invoice) behind the
 * same advance cooldown (advanceCooldown.ts), and the visit form is the
 * existing VisitFormSheet, unchanged.
 */
export default function DoctorDayScreen({ practitionerId, today, onPractitionerName }: DoctorDayScreenProps) {
  const [locationId, setLocationId] = useState<string | null>(null);
  const [visitFormVisitId, setVisitFormVisitId] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState<CooldownState>(EMPTY_COOLDOWN_STATE);
  // Waits and "دخل من" are wall-clock-derived; nothing re-renders them on
  // its own, so this ticks once a minute (SlotRow.tsx's own pattern).
  const [, forceMinuteTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => forceMinuteTick((tick) => tick + 1), 60_000);
    return () => clearInterval(interval);
  }, []);

  // The device's own location, the one the day screen defaults to.
  useEffect(() => {
    let cancelled = false;
    void getDeviceBinding(db).then((binding) => {
      if (!cancelled) {
        setLocationId(binding.location_id);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const data = useLiveQuery<DoctorDayData | null>(async () => {
    if (!locationId) {
      return null;
    }
    const weekday = weekdayOf(today);
    const [practitioner, schedules, dayVisits, services, formDefinition] = await Promise.all([
      db.practitioners.get(practitionerId),
      db.schedules.toArray(),
      db.visits.where("[practitioner_id+visit_date]").equals([practitionerId, today]).toArray(),
      db.services.toArray(),
      findGeneralFormDefinition(db),
    ]);
    const schedule = schedules.find(
      (candidate) =>
        candidate.practitioner_id === practitionerId &&
        candidate.location_id === locationId &&
        candidate.weekday === weekday,
    );
    const visits = dayVisits.filter((visit) => visit.location_id === locationId);
    const visitIds = visits.map((visit) => visit.id);

    const current = findCurrentVisit(visits);
    const next = findNextPatient(visits, schedule?.mode === ScheduleMode.Queue);
    const historyPatientIds = new Set([current?.patient_id, next?.visit.patient_id].filter(Boolean));

    const [patients, todayInvoices, allVisits, allInvoices] = await Promise.all([
      db.patients.bulkGet([...new Set(visits.map((visit) => visit.patient_id))]),
      visitIds.length > 0 ? db.invoices.where("visit_id").anyOf(visitIds).toArray() : Promise.resolve([]),
      historyPatientIds.size > 0 ? db.visits.toArray() : Promise.resolve([]),
      next ? db.invoices.toArray() : Promise.resolve([]),
    ]);
    const historyVisits = allVisits.filter((visit) => historyPatientIds.has(visit.patient_id));
    const formVisitIds = [...new Set([...visitIds, ...historyVisits.map((visit) => visit.id)])];
    const formRows =
      formVisitIds.length > 0 ? await db.visit_form_data.where("visit_id").anyOf(formVisitIds).toArray() : [];

    const formValuesByVisitId = new Map<string, VisitFormFieldValues>();
    for (const row of formRows) {
      if (row.form_definition_id === formDefinition.id) {
        formValuesByVisitId.set(row.visit_id, readVisitFormValues(row));
      }
    }
    const invoicesByVisitId = new Map<string, Invoice>();
    for (const invoice of todayInvoices) {
      if (invoice.visit_id) {
        invoicesByVisitId.set(invoice.visit_id, invoice);
      }
    }

    return {
      practitioner,
      isQueueMode: schedule?.mode === ScheduleMode.Queue,
      visits,
      patientsById: new Map(patients.filter((p): p is Patient => p != null).map((p) => [p.id, p])),
      servicesById: new Map(services.map((service) => [service.id, service])),
      invoicesByVisitId,
      formValuesByVisitId,
      historyVisits,
      nextPatientInvoices: next ? allInvoices.filter((invoice) => invoice.patient_id === next.visit.patient_id) : [],
    };
  }, [locationId, practitionerId, today]);

  const practitionerName = data?.practitioner?.full_name;
  useEffect(() => {
    if (practitionerName) {
      onPractitionerName(practitionerName);
    }
  }, [practitionerName, onPractitionerName]);

  async function advance(visit: Visit, write: (visitId: string) => Promise<unknown>) {
    setCooldown((prev) => beginCooldown(prev, visit.id));
    window.setTimeout(() => {
      setCooldown((prev) => elapseCooldown(prev, visit.id));
    }, ADVANCE_COOLDOWN_MS);
    try {
      await write(visit.id);
    } catch (error) {
      console.error(error);
    } finally {
      setCooldown((prev) => settleCooldown(prev, visit.id));
    }
  }

  if (!data) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-muted">{T.loadingLabel}</p>
      </main>
    );
  }

  const now = new Date();
  const { visits, patientsById, servicesById, isQueueMode } = data;
  const momentum = computeMomentum(visits, servicesById, isQueueMode, today, now);
  const current = findCurrentVisit(visits);
  const next = findNextPatient(visits, isQueueMode);
  const waitingRoom = computeWaitingRoom(visits, isQueueMode, today, now);
  const attentionItems = computeAttentionItems(visits, data.formValuesByVisitId, data.invoicesByVisitId);
  const dayList = computeDayList(visits, isQueueMode);
  const someoneInRoom = current !== null;

  const patientOf = (visit: Visit) => patientsById.get(visit.patient_id);
  const serviceNameOf = (visit: Visit) => (visit.service_id ? servicesById.get(visit.service_id)?.name : undefined);

  function callIn(visit: Visit) {
    void advance(visit, (visitId) => markVisitInRoom(db, visitId));
  }

  // One call button, shared by the hero's empty state, the brief and the day
  // list: shown only where transitions.ts allows in_room, disabled with its
  // visible reason while this practitioner already has someone in the room.
  function callButton(
    visit: Visit,
    label: string,
    variant: "primary" | "secondary",
    size: "md" | "sm",
    className?: string,
  ): ReactNode {
    if (!canCallIn(visit)) {
      return null;
    }
    return (
      <>
        <Button
          variant={variant}
          size={size}
          className={className}
          disabled={someoneInRoom || isCoolingDown(cooldown, visit.id)}
          onClick={() => callIn(visit)}
        >
          {label}
        </Button>
        {someoneInRoom && <span className="text-[11px] text-muted">{T.callInBlockedReason}</span>}
      </>
    );
  }

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-3.5 px-6 py-6 pb-16 print:hidden">
      {momentum && <MomentumBar momentum={momentum} isQueueMode={isQueueMode} />}

      {current ? (
        <CurrentPatientHero
          visit={current}
          patient={patientOf(current)}
          serviceName={serviceNameOf(current)}
          today={today}
          now={now}
          priorVisitCount={countPriorCompletedVisits(data.historyVisits, current)}
          lastVisit={summarizeLastVisit(data.historyVisits, current, data.formValuesByVisitId, today)}
          isCoolingDown={isCoolingDown(cooldown, current.id)}
          onOpenVisitForm={() => setVisitFormVisitId(current.id)}
          onComplete={() => void advance(current, (visitId) => markVisitCompleted(db, visitId))}
        />
      ) : (
        <section
          aria-label={T.heroLabel}
          className="flex flex-wrap items-center gap-4 rounded-panel border border-copper-line bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-copper)_14%,var(--color-card))_0%,var(--color-card)_60%)] px-6 py-5"
        >
          <p className="me-auto text-[15px] font-semibold text-muted">{T.heroEmpty}</p>
          {next && callButton(next.visit, T.callIn, "primary", "md")}
        </section>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <NextPatientBrief
          next={next}
          patient={next ? patientOf(next.visit) : undefined}
          serviceName={next ? serviceNameOf(next.visit) : undefined}
          isQueueMode={isQueueMode}
          today={today}
          now={now}
          historyVisits={data.historyVisits}
          formValuesByVisitId={data.formValuesByVisitId}
          lastInvoice={findLastInvoiceState(data.nextPatientInvoices)}
          practitionerId={practitionerId}
          callButton={next ? callButton(next.visit, T.callIn, "primary", "sm", "flex-1") : null}
        />
        <WaitingRoomCard
          waitingRoom={waitingRoom}
          isQueueMode={isQueueMode}
          patientOf={patientOf}
          serviceNameOf={serviceNameOf}
        />
      </div>

      {attentionItems.length > 0 && (
        <AttentionCard items={attentionItems} patientOf={patientOf} onCompleteNow={setVisitFormVisitId} />
      )}

      <Card>
        <CardHead badge={T.dayListBadge} title={T.dayListTitle} subtitle={T.dayListSubtitle} />
        {dayList.length === 0 ? (
          <p className="p-5 text-center text-xs text-faint">{T.dayListEmpty}</p>
        ) : (
          <ul aria-label={T.dayListTitle}>
            {dayList.map((visit, index) => (
              <DayListRow
                key={visit.id}
                number={index + 1}
                visit={visit}
                patient={patientOf(visit)}
                serviceName={serviceNameOf(visit)}
                isQueueMode={isQueueMode}
                today={today}
                now={now}
                missingDiagnosis={hasMissingDiagnosis(visit, data.formValuesByVisitId)}
                previousVisitLabel={
                  visit.status === VisitStatus.InRoom
                    ? summarizeLastVisit(data.historyVisits, visit, data.formValuesByVisitId, today)?.relativeTime
                    : undefined
                }
                onOpenVisitForm={() => setVisitFormVisitId(visit.id)}
                callButton={callButton(visit, T.callInShort, "secondary", "sm")}
              />
            ))}
          </ul>
        )}
      </Card>

      {visitFormVisitId && <VisitFormSheet visitId={visitFormVisitId} onDismiss={() => setVisitFormVisitId(null)} />}
    </main>
  );
}

// ── `.momentum` ──────────────────────────────────────────────────────────

// `.momentum` (warning) and `.momentum.ok` (eligible): each look sets its own
// border, background, icon and status colours, so exactly one class per
// property ever applies.
const MOMENTUM_LOOK = {
  late: {
    frame:
      "border-[color-mix(in_srgb,var(--color-warning)_30%,var(--color-rule))] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-warning)_8%,var(--color-card))_0%,var(--color-card)_60%)]",
    icon: "bg-[color-mix(in_srgb,var(--color-warning)_15%,transparent)] text-warning",
    status: "text-warning",
  },
  ok: {
    frame:
      "border-[color-mix(in_srgb,var(--color-eligible)_30%,var(--color-rule))] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-eligible)_8%,var(--color-card))_0%,var(--color-card)_60%)]",
    icon: "bg-[color-mix(in_srgb,var(--color-eligible)_15%,transparent)] text-eligible",
    status: "text-eligible",
  },
} as const;

function minutes(value: number): string {
  return formatElapsedMinutes(value);
}

function MomentumBar({ momentum, isQueueMode }: { momentum: MomentumSummary; isQueueMode: boolean }) {
  const look = momentum.isLate ? MOMENTUM_LOOK.late : MOMENTUM_LOOK.ok;
  return (
    <section
      aria-label={T.momentumMedianLabel}
      className={`grid grid-cols-[auto_1fr_auto] items-center gap-[18px] rounded-card border px-5 py-3.5 shadow-s ${look.frame}`}
    >
      <div className={`flex h-11 w-11 flex-none items-center justify-center rounded-card text-xl font-bold ${look.icon}`} aria-hidden="true">
        ⏱
      </div>
      <div className="min-w-0">
        {!isQueueMode && momentum.lateMinutes !== null && (
          <div className={`text-[15px] font-bold tracking-[-0.01em] ${look.status}`}>
            {momentum.isLate ? (
              <>
                {T.momentumLatePrefix} <Ltr>{momentum.lateMinutes}</Ltr> {T.momentumLateSuffix}
              </>
            ) : (
              T.momentumOnTime
            )}
          </div>
        )}
        <div className="mt-px text-[11.5px] text-muted [&>b]:font-semibold [&>b]:text-text [&>b]:tabular-nums">
          {T.momentumMedianLabel}{" "}
          <b>
            <Ltr>{minutes(momentum.medianMinutes)}</Ltr>
          </b>
          {momentum.plannedMinutes !== null && (
            <>
              {" · "}
              {T.momentumPlannedLabel}{" "}
              <b>
                <Ltr>{minutes(momentum.plannedMinutes)}</Ltr>
              </b>
            </>
          )}
          {momentum.runsLongerThanPlan && momentum.isLate && <> · {T.momentumFinishesLate}</>}
        </div>
      </div>
      {momentum.expectedFinish && (
        <div className="text-end text-[11px] text-muted">
          {T.momentumEtaLabel}
          <b className="mt-0.5 block text-[17px] font-bold tracking-[-0.02em] text-text tabular-nums">
            <Ltr>{momentum.expectedFinish}</Ltr>
          </b>
        </div>
      )}
    </section>
  );
}

// ── `.doc-hero` ──────────────────────────────────────────────────────────

function ageSuffix(patient: Patient | undefined, now: Date): ReactNode {
  const age = computeAge(patient?.birth_year ?? null, now);
  return age === null ? null : (
    <>
      · <Ltr>{age}</Ltr> {T.ageUnit}
    </>
  );
}

interface CurrentPatientHeroProps {
  visit: Visit;
  patient: Patient | undefined;
  serviceName: string | undefined;
  today: ClinicDay;
  now: Date;
  priorVisitCount: number;
  lastVisit: LastVisitSummary | null;
  isCoolingDown: boolean;
  onOpenVisitForm: () => void;
  onComplete: () => void;
}

function CurrentPatientHero({
  visit,
  patient,
  serviceName,
  today,
  now,
  priorVisitCount,
  lastVisit,
  isCoolingDown,
  onOpenVisitForm,
  onComplete,
}: CurrentPatientHeroProps) {
  const name = patient?.full_name ?? "";
  const entered = visit.started_at ? computeElapsedLabel(visit.started_at, now.toISOString(), today, now) : null;
  const age = ageSuffix(patient, now);
  const metaParts: ReactNode[] = [];
  if (serviceName) {
    metaParts.push(<span key="service">{serviceName}</span>);
  }
  if (entered) {
    metaParts.push(
      <span key="entered">
        {T.heroEnteredPrefix}{" "}
        <b>
          <Ltr>{entered}</Ltr>
        </b>
      </span>,
    );
  }
  if (priorVisitCount > 0) {
    metaParts.push(
      <span key="prior">
        <b>
          <Ltr>{priorVisitCount}</Ltr>
        </b>{" "}
        {countNoun(priorVisitCount, PRIOR_VISIT_FORMS)}
      </span>,
    );
  }

  return (
    <section
      aria-label={T.heroLabel}
      className="flex flex-col gap-4 rounded-panel border border-copper-line bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-copper)_14%,var(--color-card))_0%,var(--color-card)_60%)] px-6 py-5"
    >
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-[52px] w-[52px] flex-none items-center justify-center rounded-card bg-[linear-gradient(135deg,var(--color-copper)_0%,var(--color-copper-2)_100%)] text-xl font-bold text-white">
          {name.charAt(0)}
        </div>
        <div className="min-w-[200px] flex-1">
          <div className="text-[10.5px] font-bold uppercase tracking-[0.1em] text-copper">{T.heroLabel}</div>
          <div className="mt-[3px] text-[22px] font-bold tracking-[-0.01em] text-text">
            {name}
            {age && <span className="ms-2 text-sm font-medium text-muted">{age}</span>}
          </div>
          {metaParts.length > 0 && (
            <div className="mt-[3px] flex flex-wrap items-center gap-2 text-xs text-muted [&_b]:font-semibold [&_b]:text-text">
              {metaParts.flatMap((part, index) =>
                index === 0 ? [part] : [<span key={`sep-${index}`} className="inline-block h-[3px] w-[3px] rounded-full bg-faint" />, part],
              )}
            </div>
          )}
        </div>
        <div className="ms-auto flex flex-wrap gap-2">
          <Button variant="primary" onClick={onOpenVisitForm}>
            {T.heroOpenVisitForm}
          </Button>
          <Button variant="secondary" disabled={isCoolingDown} onClick={onComplete}>
            {T.heroCloseVisit}
          </Button>
        </div>
      </div>

      {lastVisit && (
        <div className="rounded-control border border-copper-line bg-[color-mix(in_srgb,var(--color-copper-wash)_60%,transparent)] px-3.5 py-2.5 text-xs text-text">
          <div className="mb-[3px] text-[10px] font-bold uppercase tracking-[0.05em] text-copper">
            {T.lastVisitHeading} · {lastVisit.relativeTime}
          </div>
          <LastVisitParts summary={lastVisit} diagnosisLabel={T.lastVisitDiagnosisHero} />
        </div>
      )}

      <QuickNote key={visit.id} visit={visit} />
    </section>
  );
}

/** `شكوى: <b>…</b> · التشخيص: <dx>…</dx>`, each part omitted when empty. */
function LastVisitParts({ summary, diagnosisLabel }: { summary: LastVisitSummary; diagnosisLabel: string }) {
  if (!summary.complaint && !summary.diagnosis) {
    return null;
  }
  return (
    <div>
      {summary.complaint && (
        <>
          {T.lastVisitComplaint} <b className="font-semibold text-text">{summary.complaint}</b>
        </>
      )}
      {summary.complaint && summary.diagnosis && " · "}
      {summary.diagnosis && (
        <>
          {diagnosisLabel} <span className="font-semibold text-copper">{summary.diagnosis}</span>
        </>
      )}
    </div>
  );
}

// ── `.brief` (next patient) ──────────────────────────────────────────────

const BRIEF_FRAME = "overflow-hidden rounded-card border border-rule bg-card shadow-s";
const BRIEF_HEAD = "flex items-center gap-2 border-b border-rule bg-field px-3.5 py-2.5";
const BRIEF_HEAD_TITLE = "text-[11px] font-bold uppercase tracking-[0.05em] text-muted";

interface NextPatientBriefProps {
  next: ReturnType<typeof findNextPatient>;
  patient: Patient | undefined;
  serviceName: string | undefined;
  isQueueMode: boolean;
  today: ClinicDay;
  now: Date;
  historyVisits: Visit[];
  formValuesByVisitId: Map<string, VisitFormFieldValues>;
  lastInvoice: ReturnType<typeof findLastInvoiceState>;
  practitionerId: string;
  callButton: ReactNode;
}

function NextPatientBrief({
  next,
  patient,
  serviceName,
  isQueueMode,
  today,
  now,
  historyVisits,
  formValuesByVisitId,
  lastInvoice,
  practitionerId,
  callButton,
}: NextPatientBriefProps) {
  if (!next) {
    return (
      <section aria-label={T.briefNextHeading} className={BRIEF_FRAME}>
        <div className={BRIEF_HEAD}>
          <span className={BRIEF_HEAD_TITLE}>{T.briefNextHeading}</span>
        </div>
        <p className="p-5 text-center text-xs text-faint">{T.briefNoNext}</p>
      </section>
    );
  }

  const { visit, hasArrived } = next;
  const arrivedFor = hasArrived && visit.arrived_at ? computeElapsedLabel(visit.arrived_at, now.toISOString(), today, now) : null;
  const lastVisit = summarizeLastVisit(historyVisits, visit, formValuesByVisitId, today);
  const totalWithYou = countPriorCompletedVisits(historyVisits, visit, practitionerId);
  const svcParts: ReactNode[] = [];
  if (serviceName) {
    svcParts.push(<b key="service">{serviceName}</b>);
  }
  if (isQueueMode) {
    svcParts.push(
      <span key="position">
        {T.briefQueueNumberPrefix} <Ltr>{visit.position}</Ltr>
      </span>,
    );
  } else if (visit.scheduled_at) {
    svcParts.push(
      <span key="expected">
        {T.briefExpectedPrefix} <Ltr>{clockTimeInCairo(visit.scheduled_at)}</Ltr>
      </span>,
    );
  }
  if (arrivedFor) {
    svcParts.push(
      <span key="arrived">
        {T.briefArrivedPrefix} <Ltr>{arrivedFor}</Ltr>
      </span>,
    );
  }

  return (
    <section aria-label={T.briefNextHeading} className={BRIEF_FRAME}>
      <div className={BRIEF_HEAD}>
        <span className={BRIEF_HEAD_TITLE}>{T.briefNextHeading}</span>
        <Badge appearance="soft" tone={hasArrived ? "green" : "neutral"} className="ms-auto">
          {hasArrived ? T.briefTagArrived : T.briefTagNotArrived}
        </Badge>
      </div>
      <div className="p-3.5">
        <div className="flex items-baseline gap-2 text-[17px] font-bold tracking-[-0.01em] text-text">
          {patient?.full_name ?? ""}
          {ageSuffix(patient, now) && (
            <span className="text-[12.5px] font-medium text-muted">{ageSuffix(patient, now)}</span>
          )}
        </div>
        {svcParts.length > 0 && (
          <div className="mt-0.5 text-xs text-muted [&>b]:font-semibold [&>b]:text-text">
            {svcParts.flatMap((part, index) => (index === 0 ? [part] : [" · ", part]))}
          </div>
        )}

        {(lastVisit || totalWithYou > 0 || lastInvoice) && (
          <div className="mt-3 rounded-control border border-rule bg-field px-3 py-2.5 text-xs text-muted">
            {lastVisit && (
              <>
                <div className="mb-[5px] text-[10px] font-bold uppercase tracking-[0.05em] text-muted">
                  {T.lastVisitHeading} · {lastVisit.relativeTime}
                </div>
                <div className="text-text">
                  <LastVisitParts summary={lastVisit} diagnosisLabel={T.lastVisitDiagnosisBrief} />
                </div>
              </>
            )}
            {(totalWithYou > 0 || lastInvoice) && (
              <div className="mt-1 text-[11px] text-muted [&>b]:font-bold [&>b]:text-text [&>b]:tabular-nums">
                {totalWithYou > 0 && (
                  <>
                    <b>
                      <Ltr>{totalWithYou}</Ltr>
                    </b>{" "}
                    {countNoun(totalWithYou, VISIT_FORMS)} {T.briefTotalVisitsSuffix}
                  </>
                )}
                {totalWithYou > 0 && lastInvoice && " · "}
                {lastInvoice && (
                  <>
                    {T.briefLastInvoicePrefix} <b>{lastInvoiceStateLabel(lastInvoice)}</b>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {callButton && <div className="mt-3 flex flex-wrap items-center gap-1.5">{callButton}</div>}
      </div>
    </section>
  );
}

// ── `.brief` (waiting room) + `.wait-item` ───────────────────────────────

interface WaitingRoomCardProps {
  waitingRoom: WaitingRoom;
  isQueueMode: boolean;
  patientOf: (visit: Visit) => Patient | undefined;
  serviceNameOf: (visit: Visit) => string | undefined;
}

function WaitingRoomCard({ waitingRoom, isQueueMode, patientOf, serviceNameOf }: WaitingRoomCardProps) {
  const { rows, longestMinutes, longCount } = waitingRoom;
  const longestIsLong = longCount > 0;
  return (
    <section aria-label={T.waitingHeading} className={BRIEF_FRAME}>
      <div className={BRIEF_HEAD}>
        <span className={BRIEF_HEAD_TITLE}>{T.waitingHeading}</span>
        {longestMinutes !== null && (
          <Badge appearance="soft" tone={longestIsLong ? "warning" : "green"} className="ms-auto">
            {T.waitingLongestPrefix} <Ltr>{minutes(longestMinutes)}</Ltr>
          </Badge>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="p-5 text-center text-xs text-faint">{T.waitingEmpty}</p>
      ) : (
        <>
          <ul aria-label={T.waitingHeading}>
            {rows.map(({ visit, waitedMinutes, isLong }) => {
              const patient = patientOf(visit);
              const serviceName = serviceNameOf(visit);
              const where = isQueueMode ? (
                <>
                  {T.briefQueueNumberPrefix} <Ltr>{visit.position}</Ltr>
                </>
              ) : visit.scheduled_at ? (
                <Ltr>{clockTimeInCairo(visit.scheduled_at)}</Ltr>
              ) : null;
              return (
                <li
                  key={visit.id}
                  className="grid grid-cols-[auto_1fr_auto] items-center gap-2.5 border-b border-hair px-3.5 py-[9px] last:border-b-0"
                >
                  <span
                    className={`h-2 w-2 flex-none rounded-full ${isLong ? "bg-warning shadow-[0_0_0_3px_var(--color-warning-wash)]" : "bg-eligible"}`}
                  />
                  <span className="truncate text-[13px] font-semibold text-text">
                    {patient?.full_name ?? ""}{" "}
                    <span className="ms-1.5 text-[10.5px] font-normal text-muted">
                      {serviceName && <>· {serviceName} </>}
                      {where && <>· {where}</>}
                    </span>
                  </span>
                  <span
                    className={`whitespace-nowrap text-end text-[11px] tabular-nums ${isLong ? "font-bold text-warning" : "text-muted"}`}
                  >
                    {waitingWord(patient)}
                    {waitedMinutes !== null && (
                      <>
                        {" "}
                        <b className={`text-[12.5px] font-bold ${isLong ? "text-warning" : "text-text"}`}>
                          <Ltr>{minutes(waitedMinutes)}</Ltr>
                        </b>
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-dashed border-hair bg-field px-3.5 py-[9px] text-center text-[11px] text-muted [&>b]:font-bold [&>b]:text-text">
            <b>
              <Ltr>{rows.length}</Ltr>
            </b>{" "}
            {countNoun(rows.length, PATIENT_FORMS)} {T.waitingInRoomSuffix}
            {longCount > 0 && (
              <>
                {" · "}
                <b>
                  <Ltr>{longCount}</Ltr>
                </b>{" "}
                <span className="text-warning">{T.waitingAboveThreshold}</span>
              </>
            )}
          </div>
        </>
      )}
    </section>
  );
}

// ── `.attn` ──────────────────────────────────────────────────────────────

interface AttentionCardProps {
  items: AttentionItem[];
  patientOf: (visit: Visit) => Patient | undefined;
  onCompleteNow: (visitId: string) => void;
}

function AttentionCard({ items, patientOf, onCompleteNow }: AttentionCardProps) {
  return (
    <section
      aria-label={T.attentionHeading}
      className="flex flex-col gap-2 rounded-card border border-[color-mix(in_srgb,var(--color-warning)_35%,var(--color-rule))] bg-[color-mix(in_srgb,var(--color-warning)_8%,var(--color-card))] px-4 py-3.5 shadow-s"
    >
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 flex-none items-center justify-center rounded-control bg-[color-mix(in_srgb,var(--color-warning)_20%,transparent)] text-sm font-bold text-warning" aria-hidden="true">
          !
        </div>
        <span className="text-[12.5px] font-bold tracking-[0.02em] text-warning">{T.attentionHeading}</span>
        <span className="ms-auto rounded-chip bg-[color-mix(in_srgb,var(--color-warning)_15%,transparent)] px-2 py-0.5 text-[11px] font-bold text-warning">
          <Ltr>{items.length}</Ltr>
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((item) => {
          const name = patientOf(item.visit)?.full_name ?? "";
          const closedAt = endedAtClock(item.visit);
          const closedPart = closedAt ? (
            <>
              {T.attentionClosedAtPrefix} <Ltr>{closedAt}</Ltr> ·{" "}
            </>
          ) : null;
          return (
            <li
              key={`${item.kind}-${item.visit.id}`}
              className="grid grid-cols-[1fr_auto] items-center gap-2.5 rounded-control border border-[color-mix(in_srgb,var(--color-warning)_20%,var(--color-rule))] bg-card px-3 py-[9px]"
            >
              {item.kind === "missing_diagnosis" ? (
                <>
                  <div>
                    <div className="text-[12.5px] font-semibold text-text">
                      {T.attentionVisitPrefix} {name} — {T.attentionMissingDiagnosisTitle}
                    </div>
                    <div className="mt-px text-[10.5px] text-muted">
                      {closedPart}
                      {T.attentionMissingDiagnosisDetail}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onCompleteNow(item.visit.id)}
                    className="cursor-pointer appearance-none rounded-chip border border-[color-mix(in_srgb,var(--color-warning)_40%,transparent)] bg-transparent px-2.5 py-1 text-[11px] font-semibold text-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning"
                  >
                    {T.attentionCompleteNow}
                  </button>
                </>
              ) : (
                <div>
                  <div className="text-[12.5px] font-semibold text-text">
                    {T.attentionInvoicePrefix} {name} — {lastInvoiceStateLabel(item.invoiceStatus)}
                  </div>
                  <div className="mt-px text-[10.5px] text-muted">
                    {closedPart}
                    {item.invoiceStatus === "partial" ? T.attentionPartialDetail : T.attentionUnpaidDetail}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ── `.doc-list` + `.doc-item` ────────────────────────────────────────────

// `.doc-item .num` per state; `.current` and `.done` each replace the
// resting border/background/text colour outright.
const NUM_LOOK = {
  current:
    "border-transparent bg-[linear-gradient(135deg,var(--color-copper)_0%,var(--color-copper-2)_100%)] text-white shadow-[0_3px_10px_color-mix(in_srgb,var(--color-copper)_30%,transparent)]",
  done: "border-transparent bg-eligible text-white",
  rest: "border-rule bg-field text-muted",
} as const;

interface DayListRowProps {
  number: number;
  visit: Visit;
  patient: Patient | undefined;
  serviceName: string | undefined;
  isQueueMode: boolean;
  today: ClinicDay;
  now: Date;
  missingDiagnosis: boolean;
  previousVisitLabel: string | undefined;
  onOpenVisitForm: () => void;
  callButton: ReactNode;
}

function DayListRow({
  number,
  visit,
  patient,
  serviceName,
  isQueueMode,
  today,
  now,
  missingDiagnosis,
  previousVisitLabel,
  onOpenVisitForm,
  callButton,
}: DayListRowProps) {
  const action = dayListAction(visit);
  const isDone = visit.status === VisitStatus.Completed;
  const isCurrent = visit.status === VisitStatus.InRoom;
  const numLook = isCurrent ? NUM_LOOK.current : isDone ? NUM_LOOK.done : NUM_LOOK.rest;
  const nowIso = now.toISOString();

  const meta: ReactNode[] = [];
  if (serviceName) {
    meta.push(serviceName);
  }
  if (isDone) {
    const endedAt = endedAtClock(visit);
    if (endedAt) {
      meta.push(
        <>
          {T.dayListFinishedAt} <Ltr>{endedAt}</Ltr>
        </>,
      );
    }
    if (missingDiagnosis) {
      meta.push(<span className="font-semibold text-warning">{T.dayListMissingDiagnosis}</span>);
    }
  } else if (isCurrent) {
    const entered = visit.started_at ? computeElapsedLabel(visit.started_at, nowIso, today, now) : null;
    meta.push(
      entered ? (
        <>
          {T.dayListInRoomPrefix} <Ltr>{entered}</Ltr>
        </>
      ) : (
        T.heroLabel
      ),
    );
    if (previousVisitLabel) {
      meta.push(
        <>
          {T.dayListPreviousVisit} {previousVisitLabel}
        </>,
      );
    }
  } else {
    if (visit.status === VisitStatus.Arrived) {
      const since = computeElapsedLabel(visit.arrived_at ?? visit.created_at, nowIso, today, now);
      meta.push(
        since ? (
          <>
            {waitingWord(patient)} {T.dayListWaitingFor} <Ltr>{since}</Ltr>
          </>
        ) : (
          waitingWord(patient)
        ),
      );
    } else {
      meta.push(T.briefTagNotArrived);
    }
    if (!isQueueMode && visit.scheduled_at) {
      meta.push(
        <>
          {T.briefExpectedPrefix} <Ltr>{clockTimeInCairo(visit.scheduled_at)}</Ltr>
        </>,
      );
    }
  }

  return (
    <li
      className="grid grid-cols-[56px_1fr_auto] items-center gap-3.5 border-b border-hair px-[18px] py-3 last:border-b-0"
    >
      <div
        className={`flex h-[34px] w-[34px] items-center justify-center rounded-control border-[1.5px] text-[13px] font-bold tabular-nums ${numLook}`}
      >
        <Ltr>{number}</Ltr>
      </div>
      <div className="min-w-0">
        <div className={`text-sm font-semibold ${isDone ? "text-muted line-through decoration-faint" : "text-text"}`}>
          {patient?.full_name ?? ""}
        </div>
        <div className="mt-px text-[11.5px] text-muted">
          {meta.map((part, index) => (
            <span key={index}>
              {index > 0 && " · "}
              {part}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        {action === "review" && (
          <Button variant="secondary" size="sm" onClick={onOpenVisitForm}>
            {T.dayListReview}
          </Button>
        )}
        {action === "open" && (
          <Button variant="secondary" size="sm" onClick={onOpenVisitForm}>
            {T.dayListOpen}
          </Button>
        )}
        {action === "call" && callButton}
      </div>
    </li>
  );
}

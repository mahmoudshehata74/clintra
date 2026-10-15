import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Ltr from "../../components/Ltr";
import SlashDate from "../../components/SlashDate";
import Button from "../../components/ui/Button";
import ToggleGroup from "../../components/ui/ToggleGroup";
import { db } from "../../db/database";
import type { Invoice, Patient, PrescriptionItem, Visit } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { markVisitCompleted } from "../../db/visitAttendance";
import { findGeneralFormDefinition, readVisitFormValues, type VisitFormFieldValues } from "../../db/visitForm";
import { todayInCairo } from "../../domain/time";
import CarePlanSheet from "../carePlan/CarePlanSheet";
import InvoiceSheet from "../day/InvoiceSheet";
import PaymentSheet from "../day/PaymentSheet";
import VisitFormSheet from "../day/VisitFormSheet";
import { useVisitAdvance } from "../doctor/useVisitAdvance";
import PrescriptionPrintSheet from "../prescription/PrescriptionPrintSheet";
import {
  buildProfileEvents,
  buildProfileHero,
  filterProfileEvents,
  groupProfileEvents,
  pageProfileEvents,
  planStartDays,
  profileTabCounts,
  PROFILE_TABS,
  type DetailPart,
  type PatientProfileSource,
  type ProfileEvent,
  type ProfileEventKind,
  type ProfileEventTarget,
  type ProfileHero,
  type ProfileTab,
} from "./profileModel";
import { patientProfileStrings as T } from "./strings";
import { staffName } from "../../domain/staffName";

export interface PatientProfileProps {
  patientId: string;
  /** The tab it opens on: "زيارات" from the workspace's "التاريخ المرضي", "مدفوعات" from "الفواتير". */
  initialTab?: ProfileTab;
}

/** Every row the profile reads for one patient; the patient is undefined until it exists on this device. */
async function loadProfile(patientId: string): Promise<PatientProfileSource | null> {
  const patient: Patient | undefined = await db.patients.get(patientId);
  if (!patient) {
    return null;
  }
  const [allVisits, formDefinition, practitioners, services, plans, prescriptions, messages, allInvoices, memberships, users] =
    await Promise.all([
      db.visits.toArray(),
      findGeneralFormDefinition(db),
      db.practitioners.toArray(),
      db.services.toArray(),
      db.care_plans.where("patient_id").equals(patientId).toArray(),
      db.prescriptions.where("patient_id").equals(patientId).toArray(),
      db.messages.where("patient_id").equals(patientId).toArray(),
      db.invoices.toArray(),
      db.memberships.toArray(),
      db.users.toArray(),
    ]);
  const visits: Visit[] = allVisits.filter((visit) => visit.patient_id === patientId);
  const invoices: Invoice[] = allInvoices.filter((invoice) => invoice.patient_id === patientId);
  const [formRows, planItems, prescriptionItems, payments] = await Promise.all([
    visits.length === 0 ? [] : db.visit_form_data.where("visit_id").anyOf(visits.map((visit) => visit.id)).toArray(),
    plans.length === 0 ? [] : db.care_plan_items.where("care_plan_id").anyOf(plans.map((plan) => plan.id)).toArray(),
    prescriptions.length === 0
      ? ([] as PrescriptionItem[])
      : db.prescription_items.where("prescription_id").anyOf(prescriptions.map((rx) => rx.id)).toArray(),
    invoices.length === 0 ? [] : db.payments.where("invoice_id").anyOf(invoices.map((invoice) => invoice.id)).toArray(),
  ]);

  const formValuesByVisitId = new Map<string, VisitFormFieldValues>();
  for (const row of formRows) {
    if (row.form_definition_id === formDefinition.id) {
      formValuesByVisitId.set(row.visit_id, readVisitFormValues(row));
    }
  }
  const usersById = new Map(users.map((user) => [user.id, user]));
  const staffNames = new Map<string, string>();
  for (const membership of memberships) {
    const name = staffName(membership, usersById.get(membership.user_id));
    if (name) {
      staffNames.set(membership.id, name);
    }
  }
  return {
    patient,
    visits,
    formValuesByVisitId,
    practitioners,
    services,
    plans,
    planItems,
    prescriptions,
    prescriptionItems,
    messages,
    invoices,
    payments,
    staffNames,
  };
}

/** What is open over the profile: one sheet at a time. */
type OpenSheet =
  | ProfileEventTarget
  | { kind: "payment"; invoiceId: string }
  // The invoice again after a payment, printing that payment's receipt once.
  | { kind: "invoice_after_payment"; invoiceId: string; paymentId: string }
  | { kind: "plan"; planId: string }
  | null;

/**
 * The patient profile (reference screen 18, "ملف المريض"): `.pt-hero`
 * (`.avatar`, `.info`, `.name`, `.age`, `.meta`, `.mono`, `.sep`,
 * `.stat-row`, `.pt-stat`, `.pt-stat.plan`, `.pt-stat.balance`, `.k`, `.v`),
 * then `.pt-tabs` (`.pt-tab`, `.b`) and `.pt-timeline` (`.pt-day`,
 * `.pt-day-h`, `.pt-event` with `.visit` / `.rx` / `.msg` / `.pay`, `.icn`,
 * `.body`, `.t`, `.d`, `.dx`, `.time`).
 *
 * Owner decisions over the prototype: no file number; the stalled-plan
 * warning under the hero; a doctor's note is its own event, shown under
 * "الكل" and "ملاحظات"; only history shows (completed, cancelled and
 * missed visits — never one still to come); the newest 100 events, with
 * "اعرض أقدم" for 100 more. Tapping a visit opens its workspace, a
 * prescription its printed page, a payment its invoice, the plan stat the
 * plan. The host frames it: a card on the patients page, a sheet elsewhere.
 */
export default function PatientProfile({ patientId, initialTab = "all" }: PatientProfileProps) {
  const [tab, setTab] = useState<ProfileTab>(initialTab);
  const [pages, setPages] = useState(1);
  const [openSheet, setOpenSheet] = useState<OpenSheet>(null);
  const data = useLiveQuery(() => loadProfile(patientId), [patientId]);

  if (!data) {
    return <p className="px-6 py-5 text-muted">{T.loadingLabel}</p>;
  }

  const now = new Date();
  const hero = buildProfileHero(data, now);
  const events = buildProfileEvents(data);
  const counts = profileTabCounts(events);
  const page = pageProfileEvents(filterProfileEvents(events, tab), pages);
  const days = groupProfileEvents(page.events, todayInCairo(now), planStartDays(data.plans));
  const empty = PROFILE_TABS.find((option) => option.tab === tab)!.empty;

  return (
    <>
      <Hero hero={hero} onOpenPlan={(planId) => setOpenSheet({ kind: "plan", planId })} />
      {hero.stalledLine && (
        <p role="status" className="border-b border-rule bg-warning-wash px-6 py-2.5 text-[12.5px] font-semibold text-warning">
          {hero.stalledLine}
        </p>
      )}

      {/* `.pt-tabs` */}
      <div className="border-b border-rule bg-field px-[18px] py-2">
        <ToggleGroup
          variant="patientTab"
          label={T.tabsLabel}
          value={tab}
          onChange={(next) => {
            setTab(next);
            setPages(1);
          }}
          options={PROFILE_TABS.map((option) => ({ value: option.tab, label: option.label, counter: counts[option.tab] }))}
        />
      </div>

      {/* `.pt-timeline` */}
      <section aria-label={T.timelineLabel} className="px-[18px] py-4">
        {days.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted">{empty}</p>
        ) : (
          days.map((day) => (
            // `.pt-day`
            <section key={day.day} aria-label={day.heading} className="mb-4 last:mb-0">
              {/* `.pt-day-h` */}
              <h3 className="mb-2 flex items-center gap-2.5 text-[11px] font-bold uppercase tracking-[0.05em] text-muted after:h-px after:flex-1 after:bg-hair after:content-['']">
                {day.heading}
              </h3>
              <ul className="flex flex-col gap-1.5">
                {day.events.map((event) => (
                  <li key={event.key}>
                    <EventRow event={event} onOpen={event.target ? () => setOpenSheet(event.target) : undefined} />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
        {page.hasOlder && (
          <div className="mt-3 flex justify-center">
            <Button variant="secondary" size="sm" onClick={() => setPages((count) => count + 1)}>
              {T.showOlder}
            </Button>
          </div>
        )}
      </section>

      <ProfileSheets openSheet={openSheet} onChange={setOpenSheet} />
    </>
  );
}

// ── `.pt-hero` ───────────────────────────────────────────────────────────

const STAT_FRAME = "min-w-[82px] rounded-control border border-rule bg-card px-3.5 py-2 text-center";
const STAT_KEY = "block text-[10px] font-bold uppercase tracking-[0.05em] text-muted";
const STAT_VALUE = "mt-0.5 block text-[17px] font-bold tracking-[-0.01em] tabular-nums";

function Hero({ hero, onOpenPlan }: { hero: ProfileHero; onOpenPlan: (planId: string) => void }) {
  const meta: ReactNode[] = [];
  if (hero.phone) {
    meta.push(
      <span key="phone" className="font-mono text-muted">
        <Ltr>{hero.phone}</Ltr>
      </span>,
    );
  }
  if (hero.firstVisit) {
    meta.push(
      <span key="first">
        {T.firstVisitLabel} <SlashDate>{hero.firstVisit}</SlashDate>
      </span>,
    );
  }
  return (
    <section
      aria-label={hero.name}
      className="flex flex-wrap items-center gap-[18px] border-b border-copper-line bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-copper)_10%,var(--color-card))_0%,var(--color-card)_60%)] px-6 py-[22px] max-[600px]:px-[18px]"
    >
      {/* `.avatar` */}
      <div
        aria-hidden="true"
        className="flex h-16 w-16 flex-none items-center justify-center rounded-app bg-[linear-gradient(135deg,var(--color-copper)_0%,var(--color-copper-2)_100%)] text-[26px] font-bold text-on-copper"
      >
        {hero.initial}
      </div>
      {/* `.info` */}
      <div className="min-w-[220px] flex-1">
        <h2 className="m-0 text-[22px] font-bold tracking-[-0.01em] text-text">
          {hero.name}
          {hero.ageLine && <span className="ms-2 text-sm font-medium text-muted">{hero.ageLine}</span>}
        </h2>
        {meta.length > 0 && (
          <div className="mt-[3px] flex flex-wrap items-center gap-2 text-xs text-muted">
            {meta.flatMap((part, index) =>
              index === 0
                ? [part]
                : [<span key={`sep-${index}`} aria-hidden="true" className="inline-block h-[3px] w-[3px] rounded-full bg-faint" />, part],
            )}
          </div>
        )}
      </div>
      {/* `.stat-row` */}
      <div className="ms-auto flex flex-wrap gap-2">
        <div className={STAT_FRAME}>
          <span className={STAT_KEY}>{T.statVisits}</span>
          <span className={`${STAT_VALUE} text-text`}>{hero.visitCount}</span>
        </div>
        {hero.plan && (
          // `.pt-stat.plan` — opens the plan.
          <button
            type="button"
            onClick={() => onOpenPlan(hero.plan!.planId)}
            className={`${STAT_FRAME} cursor-pointer font-[inherit] transition-colors duration-150 hover:border-copper-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper`}
          >
            <span className={STAT_KEY}>{T.statPlan}</span>
            <span className={`${STAT_VALUE} text-copper-ink`}>{hero.plan.label}</span>
          </button>
        )}
        {/* `.pt-stat.balance` */}
        <div className={STAT_FRAME}>
          <span className={STAT_KEY}>{T.statBalance}</span>
          <span className={`${STAT_VALUE} text-warning`}>{hero.balance}</span>
        </div>
      </div>
    </section>
  );
}

// ── `.pt-event` ──────────────────────────────────────────────────────────

const ICON: Record<ProfileEventKind, string> = {
  visit: T.visitIcon,
  rx: T.rxIcon,
  msg: T.msgIcon,
  pay: T.payIcon,
  note: T.noteIcon,
};

// `.pt-event.visit/.rx/.msg/.pay .icn`; the note has no prototype class and
// keeps the plain `.icn`, as does a muted (cancelled, missed) visit.
const ICON_LOOK: Record<ProfileEventKind | "muted", string> = {
  visit: "border-green-line bg-green-wash text-green",
  rx: "border-copper-line bg-copper-wash text-copper-ink",
  msg: "border-rule bg-field text-text",
  pay: "border-[color-mix(in_srgb,var(--color-eligible)_40%,transparent)] bg-[color-mix(in_srgb,var(--color-eligible)_15%,transparent)] text-eligible",
  note: "border-rule bg-field text-muted",
  muted: "border-rule bg-field text-muted",
};

const ROW_BASE = "grid w-full grid-cols-[auto_1fr_auto] items-start gap-3 rounded-control border border-rule px-3 py-2.5 text-start";
const ROW_BUTTON =
  "cursor-pointer font-[inherit] transition-colors duration-150 hover:border-green-line focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green";

function DetailGroup({ parts }: { parts: DetailPart[] }) {
  return (
    <>
      {parts.map((part, index) => {
        const text = part.ltr ? <Ltr>{part.text}</Ltr> : part.text;
        if (part.tone === "strong") {
          return (
            <b key={index} className="font-semibold text-text">
              {text}
            </b>
          );
        }
        if (part.tone === "dx") {
          return (
            <span key={index} className="font-semibold text-copper-ink">
              {text}
            </span>
          );
        }
        return <span key={index}>{text}</span>;
      })}
    </>
  );
}

function EventRow({ event, onOpen }: { event: ProfileEvent; onOpen?: () => void }) {
  const content = (
    <>
      {/* `.icn` */}
      <span
        aria-hidden="true"
        className={`flex h-[30px] w-[30px] flex-none items-center justify-center rounded-control border text-xs font-bold ${ICON_LOOK[event.muted ? "muted" : event.kind]}`}
      >
        {ICON[event.kind]}
      </span>
      {/* `.body` */}
      <span className="min-w-0">
        <span className={`block text-[13px] font-semibold ${event.muted ? "text-muted" : "text-text"}`}>{event.title}</span>
        {event.details.length > 0 && (
          <span className="mt-px block text-[11.5px] text-muted">
            {event.details.map((group, index) => (
              <span key={index}>
                {index > 0 && " · "}
                <DetailGroup parts={group} />
              </span>
            ))}
          </span>
        )}
      </span>
      {/* `.time` */}
      <span className="whitespace-nowrap text-[10.5px] text-muted tabular-nums">{event.time && <Ltr>{event.time}</Ltr>}</span>
    </>
  );
  const surface = event.muted ? "bg-field" : "bg-card";
  return onOpen ? (
    <button type="button" data-kind={event.kind} onClick={onOpen} className={`${ROW_BASE} ${ROW_BUTTON} ${surface}`}>
      {content}
    </button>
  ) : (
    <div data-kind={event.kind} className={`${ROW_BASE} ${surface}`}>
      {content}
    </div>
  );
}

// ── What an event opens ──────────────────────────────────────────────────

/**
 * The sheet an event (or the plan stat) opens, each rendered into the body
 * so it stacks above the profile whether the profile is a page or itself a
 * sheet. A payment recorded from the invoice goes back to the invoice.
 */
function ProfileSheets({ openSheet, onChange }: { openSheet: OpenSheet; onChange: (next: OpenSheet) => void }) {
  const { advance, isCoolingDown, advanceError } = useVisitAdvance();
  const close = () => onChange(null);
  if (!openSheet) {
    return null;
  }
  switch (openSheet.kind) {
    case "visit":
      return createPortal(
        <VisitFormSheet
          visitId={openSheet.visitId}
          onDismiss={close}
          completion={{
            onComplete: (visit) => void advance(visit, (visitId) => markVisitCompleted(db, visitId)),
            isCoolingDown,
            error: advanceError,
          }}
        />,
        document.body,
      );
    case "rx":
      return <PrescriptionPrintSheet prescriptionId={openSheet.prescriptionId} onDismiss={close} />;
    case "invoice":
      return createPortal(
        <InvoiceSheet
          invoiceId={openSheet.invoiceId}
          showPractitionerName
          onDismiss={close}
          onRequestPayment={(invoiceId) => onChange({ kind: "payment", invoiceId })}
          onVoided={close}
        />,
        document.body,
      );
    case "invoice_after_payment":
      return createPortal(
        <InvoiceSheet
          invoiceId={openSheet.invoiceId}
          showPractitionerName
          printReceiptForPaymentId={openSheet.paymentId}
          onReceiptPrinted={() => onChange({ kind: "invoice", invoiceId: openSheet.invoiceId })}
          onDismiss={close}
          onRequestPayment={(invoiceId) => onChange({ kind: "payment", invoiceId })}
          onVoided={close}
        />,
        document.body,
      );
    case "payment":
      return createPortal(
        <PaymentSheet
          invoiceId={openSheet.invoiceId}
          onDismiss={close}
          onRecorded={(_undo, payment) =>
            onChange({ kind: "invoice_after_payment", invoiceId: openSheet.invoiceId, paymentId: payment.id })
          }
        />,
        document.body,
      );
    case "plan":
      return <CarePlanSheet visitId={null} planId={openSheet.planId} onDismiss={close} />;
  }
}

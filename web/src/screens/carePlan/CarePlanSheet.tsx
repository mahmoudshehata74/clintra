import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useGuardedActingMembership } from "../../auth/useActingMembership";
import Ltr from "../../components/Ltr";
import Button from "../../components/ui/Button";
import Card, { CardHead } from "../../components/ui/Card";
import Field, { TextArea, TextInput } from "../../components/ui/Field";
import { SheetPanelBody, SheetPanelFoot } from "../../components/ui/SheetPanel";
import ToggleGroup from "../../components/ui/ToggleGroup";
import {
  addCarePlanSessions,
  carePlanDraftForVisit,
  createCarePlan,
  resumeCarePlan,
  skipCarePlanSession,
  stopCarePlan,
  unskipCarePlanSession,
  updateCarePlanDetails,
} from "../../db/carePlans";
import { db } from "../../db/database";
import { CarePlanStatus, type CarePlan, type Service, type ServicePriceOverride, type Visit } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { id } from "../../domain/id";
import { MessageTemplateKey } from "../../domain/messageTemplates";
import { resolveServicePrice } from "../../domain/pricing";
import { todayInCairo } from "../../domain/time";
import Sheet from "../day/Sheet";
import SheetHeader from "../day/SheetHeader";
import SendMessageSheet from "../messages/SendMessageSheet";
import CarePlanBookingSheet from "./CarePlanBookingSheet";
import {
  buildCarePlanSheet,
  carePlanErrorMessage,
  formatPlanMoney,
  previewCarePlanSessions,
  validateCarePlanDraft,
  type BookNextState,
  type CarePlanSheetModel,
  type CarePlanSheetSource,
  type DraftErrors,
  type DraftGroup,
  type MetaPart,
  type SessionRow,
  type SessionTone,
} from "./carePlanModel";
import { carePlanStrings as T } from "./strings";

interface CarePlanSheetProps {
  /** The visit the sheet was opened from: the one a new plan is created from. */
  visitId: string;
  /** The plan to show; null opens the create form for the visit. */
  planId: string | null;
  onDismiss: () => void;
}

/**
 * The care plan (reference screen 17, "خطة الرعاية") in a sheet, opened
 * from the visit workspace's `.plan-badge` or its "ابدأ خطة رعاية": the
 * plan itself (`.plan-hero`, `.plan-sessions`, `.split`), or the form that
 * creates one from the visit, or the form that edits it. Every write goes
 * through db/carePlans.ts, whose own rules the controls mirror
 * (carePlanModel.ts). Rendered into a body-level portal, like every sheet
 * that opens over another one, and kept off paper.
 */
export default function CarePlanSheet({ visitId, planId, onDismiss }: CarePlanSheetProps) {
  const [shownPlanId, setShownPlanId] = useState<string | null>(planId);

  return createPortal(
    <div className="print:hidden">
      <Sheet onDismiss={onDismiss} size="lg">
        <SheetHeader title={T.sheetTitle} onDismiss={onDismiss} />
        {shownPlanId === null ? (
          <CreatePlanForm visitId={visitId} onCreated={setShownPlanId} onCancel={onDismiss} />
        ) : (
          <PlanView planId={shownPlanId} />
        )}
      </Sheet>
    </div>,
    document.body,
  );
}

// ── The plan ─────────────────────────────────────────────────────────────

interface PlanData {
  source: CarePlanSheetSource;
  /** Every active service, for the edit form's added sessions. */
  activeServices: Service[];
  overrides: ServicePriceOverride[];
}

async function loadPlan(planId: string): Promise<PlanData | null> {
  const plan = await db.care_plans.get(planId);
  if (!plan) {
    return null;
  }
  const [items, services, overrides, patient, practitioner] = await Promise.all([
    db.care_plan_items.where("care_plan_id").equals(plan.id).toArray(),
    db.services.toArray(),
    db.service_price_overrides.toArray(),
    db.patients.get(plan.patient_id),
    db.practitioners.get(plan.practitioner_id),
  ]);
  const visitIds = [...new Set(items.map((item) => item.visit_id).filter((visitId): visitId is string => visitId !== null))];
  const visits = visitIds.length === 0 ? [] : (await db.visits.bulkGet(visitIds)).filter((visit): visit is Visit => visit !== undefined);
  const invoices = visitIds.length === 0 ? [] : await db.invoices.where("visit_id").anyOf(visitIds).toArray();
  const payments =
    invoices.length === 0 ? [] : await db.payments.where("invoice_id").anyOf(invoices.map((invoice) => invoice.id)).toArray();
  return {
    source: {
      plan,
      items,
      visits,
      services,
      patientName: patient?.full_name ?? "",
      practitionerName: practitioner?.full_name ?? "",
      invoices,
      payments,
    },
    activeServices: services.filter((service) => service.is_active),
    overrides,
  };
}

function PlanView({ planId }: { planId: string }) {
  const actingPractitionerId = useGuardedActingMembership()?.practitioner_id ?? null;
  const [isEditing, setIsEditing] = useState(false);
  const [reminderVisitId, setReminderVisitId] = useState<string | null>(null);
  const [booking, setBooking] = useState<BookNextState | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const data = useLiveQuery(() => loadPlan(planId), [planId]);

  if (!data) {
    return (
      <SheetPanelBody>
        <p className="text-muted">{T.loadingLabel}</p>
      </SheetPanelBody>
    );
  }

  const model = buildCarePlanSheet(data.source, todayInCairo(), actingPractitionerId);
  const { plan } = data.source;

  if (isEditing && model.canEdit) {
    return (
      <EditPlanForm
        plan={plan}
        activeServices={data.activeServices}
        priceOf={(service) =>
          resolveServicePrice(service, data.overrides, { practitionerId: plan.practitioner_id, locationId: plan.location_id })
        }
        onDone={() => setIsEditing(false)}
      />
    );
  }

  async function runRowAction(row: SessionRow) {
    setRowError(null);
    try {
      await (row.action?.kind === "skip" ? skipCarePlanSession(db, row.itemId) : unskipCarePlanSession(db, row.itemId));
    } catch (error) {
      setRowError(carePlanErrorMessage(error));
    }
  }

  return (
    <SheetPanelBody>
      <PlanHero model={model} />
      {model.statusLine && (
        <p
          role="status"
          className={
            model.statusLine.kind === "stalled"
              ? "rounded-control bg-warning-wash px-3 py-2 text-[12.5px] font-semibold text-warning"
              : "rounded-control bg-field px-3 py-2 text-[12.5px] font-semibold text-muted"
          }
        >
          {model.statusLine.text}
        </p>
      )}

      <Card>
        <CardHead badge={T.sessionsBadge} title={T.sessionsHeading} subtitle={model.sessionsSubtitle} />
        {/* `.plan-sessions` */}
        <ul aria-label={T.sessionsHeading} className="flex flex-col">
          {model.rows.map((row) => (
            <SessionRowItem key={row.itemId} row={row} onAction={() => void runRowAction(row)} />
          ))}
        </ul>
        {rowError && (
          <p role="alert" className="px-[18px] pb-2 text-[12.5px] text-danger">
            {rowError}
          </p>
        )}
        {/* `.split` — the actions under the sessions. */}
        <div className="flex flex-wrap items-center gap-2 px-6 pb-5 pt-1 max-[600px]:px-[18px]">
          {model.book && (
            <Button
              variant="primary"
              disabled={model.book.disabledReason !== null}
              onClick={() => setBooking(model.book)}
            >
              {T.bookNext}
            </Button>
          )}
          {model.canEdit && (
            <Button variant="secondary" onClick={() => setIsEditing(true)}>
              {T.editPlan}
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={model.reminder.visitId === null}
            onClick={() => setReminderVisitId(model.reminder.visitId)}
          >
            {T.sendReminder}
          </Button>
          {model.book?.disabledReason && <p className="basis-full text-[11.5px] text-muted">{model.book.disabledReason}</p>}
          {model.reminder.disabledReason && (
            <p className="basis-full text-[11.5px] text-muted">{model.reminder.disabledReason}</p>
          )}
        </div>
      </Card>

      {booking && <CarePlanBookingSheet plan={plan} book={booking} onDismiss={() => setBooking(null)} />}

      {reminderVisitId && (
        <SendMessageSheet
          visitId={reminderVisitId}
          start={{ templateKey: MessageTemplateKey.CarePlanSessionReminder }}
          onDismiss={() => setReminderVisitId(null)}
        />
      )}
    </SheetPanelBody>
  );
}

/** `.plan-hero`: `.top` (`.avatar`, `.info` `.name` `.goal`, `.kbd`), `.plan-progress` (`.plan-prog-h`, `.plan-bar`), `.plan-legs`. */
function PlanHero({ model }: { model: CarePlanSheetModel }) {
  return (
    <section
      aria-label={T.sheetTitle}
      className="relative overflow-hidden rounded-panel bg-[linear-gradient(135deg,var(--color-copper)_0%,color-mix(in_srgb,var(--color-copper)_80%,var(--color-ink)_20%)_100%)] px-6 py-5 text-white shadow-l before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:bg-[linear-gradient(to_left,white_0%,transparent_60%)] before:opacity-40 before:content-[''] max-[600px]:px-[18px]"
    >
      <div className="mb-4 flex items-start gap-3.5">
        <div
          aria-hidden="true"
          className="flex h-12 w-12 flex-none items-center justify-center rounded-card border border-white/25 bg-white/[0.16] text-xl font-bold text-white"
        >
          {model.initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xl font-bold tracking-[-0.01em] text-white">{model.patientName}</div>
          <div className="mt-[3px] text-[12.5px] text-white/85">
            <b className="font-semibold text-white">{T.goalLabel}</b> {model.goal}
            {" · "}
            <b className="font-semibold text-white">{T.diagnosisLabel}</b> {model.diagnosis}
          </div>
        </div>
        <div className="ms-auto whitespace-nowrap rounded-chip border border-white/20 bg-white/[0.12] px-2.5 py-1 text-[11px] text-white/70">
          {model.countLabel}
        </div>
      </div>

      <div className="mt-2">
        <div className="mb-1.5 flex items-baseline justify-between text-[11px] text-white/85">
          <span>{T.progressLabel}</span>
          <b className="text-[15px] font-bold tracking-[-0.01em] text-white tabular-nums">{model.progressLabel}</b>
        </div>
        <div
          role="progressbar"
          aria-label={T.progressLabel}
          aria-valuemin={0}
          aria-valuemax={model.count}
          aria-valuenow={model.done}
          className="h-2 overflow-hidden rounded-full bg-white/15"
        >
          <span className="block h-full rounded-full bg-white" style={{ width: `${model.progressPercent}%` }} />
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-4 text-[11px] text-white/85">
        <Leg label={T.startedLabel} value={model.startedOn} />
        <Leg label={T.expectedEndLabel} value={model.expectedEnd} />
        <Leg label={T.totalLabel} value={model.total} />
        <Leg label={T.paidLabel} value={model.paid} />
      </div>
    </section>
  );
}

// A run of digits and separators alone ("15 / 8 / 2026", "9:30") reads left
// to right; anything with an Arabic word in it ("2,500 ج.م", "30 دقيقة")
// stays in the page's own direction, so the word keeps its side.
const NUMERIC_ONLY = /^[\d\s/:.,-]+$/;

function NumberText({ text }: { text: string }) {
  return NUMERIC_ONLY.test(text) ? <Ltr>{text}</Ltr> : <>{text}</>;
}

function Leg({ label, value }: { label: string; value: string }) {
  return (
    <div>
      {label}{" "}
      <b className="font-bold text-white tabular-nums">
        <NumberText text={value} />
      </b>
    </div>
  );
}

// `.plan-session .n` per tone: plain, `.done .n`, `.next .n`.
const NUMBER_LOOK: Record<SessionTone, string> = {
  done: "border-transparent bg-eligible text-white",
  next: "border-copper-line bg-copper-wash text-copper",
  booked: "border-rule bg-field text-muted",
  suggested: "border-rule bg-field text-muted",
  skipped: "border-rule bg-field text-faint",
};

// `.plan-session .name`: muted once done (`.done .name`), and for a skipped session.
const NAME_LOOK: Record<SessionTone, string> = {
  done: "text-muted",
  next: "text-text",
  booked: "text-text",
  suggested: "text-text",
  skipped: "text-faint",
};

// `.plan-session .st` per tone: `.done .st`, `.next .st`, `.st.plan`; a later
// booked session's plain `.st`, and the skipped session's muted one.
const STATUS_LOOK: Record<SessionTone, string> = {
  done: "border-transparent bg-[color-mix(in_srgb,var(--color-eligible)_18%,transparent)] text-eligible",
  next: "border-copper-line bg-copper-wash text-copper",
  booked: "border-rule bg-card text-text",
  suggested: "border-rule bg-field text-muted",
  skipped: "border-transparent bg-transparent text-faint",
};

function Meta({ parts }: { parts: readonly MetaPart[] }) {
  return (
    <div className="mt-px text-[11px] text-muted">
      {parts.map((part, index) => (
        <span key={index}>
          {index > 0 && " · "}
          {part.strong ? <b>{part.text}</b> : <NumberText text={part.text} />}
        </span>
      ))}
    </div>
  );
}

/** `.plan-session` (`.done`, `.next`): `.n`, `.name` and `.meta`, `.st` — and the practitioner's "أجّل" / "رجّع". */
function SessionRowItem({ row, onAction }: { row: SessionRow; onAction: () => void }) {
  return (
    <li className="grid grid-cols-[48px_1fr_auto] items-center gap-3.5 border-b border-hair px-[18px] py-[13px] last:border-b-0 max-[600px]:px-3.5">
      <div
        className={`flex h-[34px] w-[34px] items-center justify-center rounded-control border-[1.5px] text-[13px] font-bold tabular-nums ${NUMBER_LOOK[row.tone]}`}
      >
        <Ltr>{row.n}</Ltr>
      </div>
      <div className="min-w-0">
        <div className={`text-[13.5px] font-semibold ${NAME_LOOK[row.tone]}`}>{row.name}</div>
        {row.meta.length > 0 && <Meta parts={row.meta} />}
      </div>
      <div className="flex items-center gap-2">
        <span className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATUS_LOOK[row.tone]}`}>
          {row.statusLabel}
        </span>
        {row.action && (
          <Button variant="secondary" size="sm" onClick={onAction}>
            {row.action.label}
          </Button>
        )}
      </div>
    </li>
  );
}

// ── The create form ──────────────────────────────────────────────────────

interface CreateData {
  visit: Visit;
  diagnosis: string;
  activeServices: Service[];
  overrides: ServicePriceOverride[];
}

function newGroup(serviceId: string): DraftGroup {
  return { key: id(), serviceId, count: "", gap: "" };
}

function CreatePlanForm({
  visitId,
  onCreated,
  onCancel,
}: {
  visitId: string;
  onCreated: (planId: string) => void;
  onCancel: () => void;
}) {
  const data = useLiveQuery<CreateData | null>(async () => {
    const visit = await db.visits.get(visitId);
    if (!visit) {
      return null;
    }
    const [{ diagnosis }, services, overrides] = await Promise.all([
      carePlanDraftForVisit(db, visitId),
      db.services.toArray(),
      db.service_price_overrides.toArray(),
    ]);
    return { visit, diagnosis, activeServices: services.filter((service) => service.is_active), overrides };
  }, [visitId]);

  if (!data) {
    return (
      <SheetPanelBody>
        <p className="text-muted">{T.loadingLabel}</p>
      </SheetPanelBody>
    );
  }
  // Mounted once the visit form's diagnosis is read, so the field starts from it.
  return <CreatePlanFields data={data} onCreated={onCreated} onCancel={onCancel} />;
}

function CreatePlanFields({
  data,
  onCreated,
  onCancel,
}: {
  data: CreateData;
  onCreated: (planId: string) => void;
  onCancel: () => void;
}) {
  const [goal, setGoal] = useState("");
  const [diagnosis, setDiagnosis] = useState(data.diagnosis);
  const [groups, setGroups] = useState<DraftGroup[]>(() => [newGroup(data.activeServices[0]?.id ?? "")]);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const activeIds = new Set(data.activeServices.map((service) => service.id));
  const validation = validateCarePlanDraft({ goal, diagnosis, groups }, activeIds);
  const errors: DraftErrors = submitted ? validation.errors : { groups: [] };
  const priceOf = (service: Service) =>
    resolveServicePrice(service, data.overrides, { practitionerId: data.visit.practitioner_id, locationId: data.visit.location_id });
  const preview = previewCarePlanSessions(groups, data.activeServices, priceOf, todayInCairo());

  async function start() {
    setSubmitted(true);
    setError(null);
    if (!validation.ok) {
      return;
    }
    setIsSaving(true);
    try {
      const { plan } = await createCarePlan(db, { visitId: data.visit.id, goal, diagnosis, sessions: validation.groups });
      onCreated(plan.id);
    } catch (caught) {
      setError(carePlanErrorMessage(caught));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <SheetPanelBody>
        <h4 className="m-0 text-[15px] font-semibold text-text">{T.createHeading}</h4>
        <Field label={T.goalField} id="care-plan-goal" error={errors.goal}>
          <TextInput value={goal} placeholder={T.goalPlaceholder} onChange={(event) => setGoal(event.target.value)} />
        </Field>
        <Field label={T.diagnosisField} id="care-plan-diagnosis" error={errors.diagnosis}>
          <TextArea value={diagnosis} onChange={(event) => setDiagnosis(event.target.value)} />
        </Field>
        <GroupsEditor
          groups={groups}
          errors={errors}
          services={data.activeServices}
          priceOf={priceOf}
          onChange={setGroups}
        />
        <button
          type="button"
          onClick={() => setGroups((prev) => [...prev, newGroup(data.activeServices[0]?.id ?? "")])}
          className={ADD_BUTTON_CLASS}
        >
          {T.addGroup}
        </button>
        <Preview preview={preview} />
        {error && (
          <p role="alert" className="text-[12.5px] font-semibold text-danger">
            {error}
          </p>
        )}
      </SheetPanelBody>
      <SheetPanelFoot>
        <Button variant="primary" className="flex-1" disabled={isSaving} onClick={() => void start()}>
          {T.startAction}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          {T.cancelAction}
        </Button>
      </SheetPanelFoot>
    </>
  );
}

// The dashed "add" control the visit workspace's `.rx-add` uses, in copper.
const ADD_BUTTON_CLASS =
  "flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-control border-[1.5px] border-dashed border-copper-line bg-transparent px-3 py-[9px] font-[inherit] text-xs font-semibold text-copper hover:border-solid hover:bg-copper-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper";

function serviceOptionLabel(service: Service, price: ReturnType<typeof resolveServicePrice>): ReactNode {
  return `${service.name} · ${formatPlanMoney(price)}`;
}

/** The groups of sessions: each a service (`.svc-row`), how many, and how many days apart, removable while more than one. */
function GroupsEditor({
  groups,
  errors,
  services,
  priceOf,
  onChange,
  removable = groups.length > 1,
}: {
  groups: readonly DraftGroup[];
  errors: DraftErrors;
  services: readonly Service[];
  priceOf: (service: Service) => ReturnType<typeof resolveServicePrice>;
  onChange: (groups: DraftGroup[]) => void;
  removable?: boolean;
}) {
  const options = services.map((service) => ({ value: service.id, label: serviceOptionLabel(service, priceOf(service)) }));

  function update(key: string, field: "serviceId" | "count" | "gap", value: string) {
    onChange(groups.map((group) => (group.key === key ? { ...group, [field]: value } : group)));
  }

  return (
    <>
      {groups.map((group, index) => {
        const groupErrors = errors.groups[index] ?? {};
        const heading = `${T.groupHeading} ${index + 1}`;
        return (
          <fieldset key={group.key} aria-label={heading} className="m-0 flex flex-col gap-3 rounded-control border border-rule bg-field p-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-[0.05em] text-muted">{heading}</span>
              {removable && (
                <button
                  type="button"
                  onClick={() => onChange(groups.filter((candidate) => candidate.key !== group.key))}
                  className="ms-auto cursor-pointer appearance-none rounded-control border border-danger-line bg-transparent px-2.5 py-1 font-[inherit] text-[11px] font-semibold text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger"
                >
                  {T.removeGroup}
                </button>
              )}
            </div>
            <Field label={T.serviceField} id={`care-plan-${group.key}-service`} error={groupErrors.serviceId}>
              <ToggleGroup
                variant="service"
                label={`${T.serviceField} ${index + 1}`}
                value={group.serviceId}
                onChange={(value) => update(group.key, "serviceId", value)}
                options={options}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={T.countField} id={`care-plan-${group.key}-count`} error={groupErrors.count}>
                <TextInput inputMode="numeric" value={group.count} onChange={(event) => update(group.key, "count", event.target.value)} />
              </Field>
              <Field label={T.gapField} id={`care-plan-${group.key}-gap`} error={groupErrors.gap}>
                <TextInput inputMode="numeric" value={group.gap} onChange={(event) => update(group.key, "gap", event.target.value)} />
              </Field>
            </div>
          </fieldset>
        );
      })}
    </>
  );
}

/** The sessions the form will create, as `.plan-session` rows marked `.st.plan`, and their total. */
function Preview({ preview }: { preview: ReturnType<typeof previewCarePlanSessions> }) {
  return (
    <section aria-label={T.previewHeading} className="overflow-hidden rounded-card border border-rule bg-card">
      <div className="border-b border-hair bg-field px-[18px] py-2.5 text-xs font-bold uppercase tracking-[0.05em] text-muted">
        {T.previewHeading}
      </div>
      <ul aria-label={T.previewHeading} className="flex flex-col">
        {preview.rows.map((row) => (
          <li
            key={row.n}
            className="grid grid-cols-[48px_1fr_auto] items-center gap-3.5 border-b border-hair px-[18px] py-2.5 last:border-b-0 max-[600px]:px-3.5"
          >
            <div className={`flex h-[34px] w-[34px] items-center justify-center rounded-control border-[1.5px] text-[13px] font-bold tabular-nums ${NUMBER_LOOK.suggested}`}>
              <Ltr>{row.n}</Ltr>
            </div>
            <div className="min-w-0 text-[13.5px] font-semibold text-text">{row.serviceName}</div>
            <span className={`whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold ${STATUS_LOOK.suggested}`}>
              <Ltr>{row.date}</Ltr>
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-baseline justify-between border-t border-hair bg-field px-[18px] py-2.5 text-[12.5px] text-muted">
        <span>{T.previewTotal}</span>
        <b className="text-[15px] font-bold text-text tabular-nums">{formatPlanMoney(preview.total)}</b>
      </div>
    </section>
  );
}

// ── The edit form ────────────────────────────────────────────────────────

function EditPlanForm({
  plan,
  activeServices,
  priceOf,
  onDone,
}: {
  plan: CarePlan;
  activeServices: Service[];
  priceOf: (service: Service) => ReturnType<typeof resolveServicePrice>;
  onDone: () => void;
}) {
  const [goal, setGoal] = useState(plan.goal);
  const [diagnosis, setDiagnosis] = useState(plan.diagnosis);
  const [added, setAdded] = useState<DraftGroup[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const activeIds = new Set(activeServices.map((service) => service.id));
  const details = validateCarePlanDraft({ goal, diagnosis, groups: [] }, activeIds);
  const sessions = validateCarePlanDraft({ goal, diagnosis, groups: added }, activeIds, false);
  const errors: DraftErrors = submitted ? { ...details.errors, groups: sessions.errors.groups } : { groups: [] };

  async function save() {
    setSubmitted(true);
    setError(null);
    if (details.errors.goal || details.errors.diagnosis || (added.length > 0 && !sessions.ok)) {
      return;
    }
    setIsSaving(true);
    try {
      await updateCarePlanDetails(db, plan.id, { goal, diagnosis });
      if (added.length > 0 && sessions.ok) {
        await addCarePlanSessions(db, plan.id, sessions.groups);
      }
      onDone();
    } catch (caught) {
      setError(carePlanErrorMessage(caught));
    } finally {
      setIsSaving(false);
    }
  }

  async function setStatus(status: CarePlanStatus) {
    setError(null);
    try {
      await (status === CarePlanStatus.Stopped ? stopCarePlan(db, plan.id) : resumeCarePlan(db, plan.id));
    } catch (caught) {
      setError(carePlanErrorMessage(caught));
    }
  }

  return (
    <>
      <SheetPanelBody>
        <h4 className="m-0 text-[15px] font-semibold text-text">{T.editHeading}</h4>
        <Field label={T.goalField} id="care-plan-edit-goal" error={errors.goal}>
          <TextInput value={goal} onChange={(event) => setGoal(event.target.value)} />
        </Field>
        <Field label={T.diagnosisField} id="care-plan-edit-diagnosis" error={errors.diagnosis}>
          <TextArea value={diagnosis} onChange={(event) => setDiagnosis(event.target.value)} />
        </Field>
        <GroupsEditor groups={added} errors={errors} services={activeServices} priceOf={priceOf} onChange={setAdded} removable />
        {added.length === 0 && (
          <button type="button" onClick={() => setAdded([newGroup(activeServices[0]?.id ?? "")])} className={ADD_BUTTON_CLASS}>
            {T.addSessions}
          </button>
        )}
        <div className="flex">
          {plan.status === CarePlanStatus.Active ? (
            <Button variant="danger" onClick={() => void setStatus(CarePlanStatus.Stopped)}>
              {T.stopPlan}
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => void setStatus(CarePlanStatus.Active)}>
              {T.resumePlan}
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-[12.5px] font-semibold text-danger">
            {error}
          </p>
        )}
      </SheetPanelBody>
      <SheetPanelFoot>
        <Button variant="primary" className="flex-1" disabled={isSaving} onClick={() => void save()}>
          {T.saveAction}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          {T.cancelAction}
        </Button>
      </SheetPanelFoot>
    </>
  );
}

import { useState } from "react";
import Ltr from "../../components/Ltr";
import ToggleGroup from "../../components/ui/ToggleGroup";
import { db } from "../../db/database";
import { useLiveQuery } from "../../db/useLiveQuery";
import type { AuditLog, CarePlan, ClinicDay, Membership, Patient, Prescription, User, Visit } from "../../db/types";
import { PaymentMethod } from "../../db/types";
import { describeAuditVerb, describeVisitFormChange } from "../../domain/auditVerb";
import { formatWeekdayDayMonth } from "../../domain/displayDate";
import type { Piastres } from "../../domain/money";
import { clockTimeInCairo, todayInCairo } from "../../domain/time";
import { formatMoneyAmount } from "../money";
import { formatActorName } from "./actorLabel";
import { auditDotTone, type AuditDotTone } from "./auditDotTone";
import { type AuditFilter, filterAuditRows, isAuditRowInScope } from "./auditLogFilters";
import { computeElapsedLabel } from "./elapsedLabel";
import { formatBareReceiptNumber, formatInvoiceNumber } from "./invoiceNumber";
import Sheet from "./Sheet";
import SheetCardHead from "./SheetCardHead";
import { dayScreenStrings } from "./strings";

interface AuditSheetProps {
  practitionerId: string;
  locationId: string;
  today: ClinicDay;
  onDismiss: () => void;
}

interface AuditRowView {
  row: AuditLog;
  verb: string;
  /** What the row is about, after the verb ("أنشأ حجز · كريم فتحي"); "" for none. */
  subject: string;
  actorName: string;
  /** After the actor ("سارة حسن · موعد 10:30"); "" for none. */
  context: string;
  tone: AuditDotTone;
}

const FILTER_OPTIONS: readonly { value: AuditFilter; label: string }[] = [
  { value: "all", label: dayScreenStrings.auditFilterAll },
  { value: "visits", label: dayScreenStrings.auditFilterVisits },
  { value: "invoices", label: dayScreenStrings.auditFilterInvoices },
  { value: "settings", label: dayScreenStrings.auditFilterSettings },
];

const METHOD_LABEL: Record<string, string> = {
  [PaymentMethod.Cash]: dayScreenStrings.paymentMethodCash,
  [PaymentMethod.Card]: dayScreenStrings.paymentMethodCard,
  [PaymentMethod.Wallet]: dayScreenStrings.paymentMethodWallet,
  [PaymentMethod.Transfer]: dayScreenStrings.paymentMethodTransfer,
};

const AUDITED_ENTITIES = new Set([
  "visits",
  "patients",
  "invoices",
  "payments",
  "cash_close",
  "visit_form_data",
  "prescriptions",
  "prescription_items",
  "practitioners",
  "messages",
  "message_templates",
  "care_plans",
  "care_plan_items",
  "services",
  "service_price_overrides",
  "schedules",
  "users",
  "memberships",
  "membership_locations",
  "membership_practitioners",
]);

function payloadOf(row: Pick<AuditLog, "before" | "after">): Record<string, unknown> | null {
  return (row.after ?? row.before) as Record<string, unknown> | null;
}

// `.aud-dot` / `.aud-dot.warn` / `.aud-dot.danger`: the fill and its 3px
// wash ring, one complete class set per tone.
const DOT_LOOK: Record<AuditDotTone, string> = {
  default: "bg-green shadow-[0_0_0_3px_var(--color-green-wash)]",
  warn: "bg-warning shadow-[0_0_0_3px_var(--color-warning-wash)]",
  danger: "bg-danger shadow-[0_0_0_3px_var(--color-danger-wash)]",
};

/**
 * A full-height sheet listing today's audit_log rows for the current
 * practitioner+location, newest first — a timeline the doctor reads to
 * reconstruct what happened, not staff surveillance. Prototype #s11:
 * `.c-head`, `.filts`/`.filt`, `.audit`, `.aud-row`, `.aud-dot`
 * (+ `.warn`/`.danger`, see auditDotTone.ts), `.aud-txt .verb`/`.who`,
 * `.aud-time`. The verb leads every row at the larger size, with what it is
 * about ("أنشأ حجز · كريم فتحي"); the smaller muted line under it names the
 * actor and the row's context ("سارة حسن · موعد 10:30").
 */
export default function AuditSheet({ practitionerId, locationId, today, onDismiss }: AuditSheetProps) {
  const [filter, setFilter] = useState<AuditFilter>("all");

  const rows =
    useLiveQuery<AuditRowView[]>(async () => {
      const allRows = await db.audit_log.toArray();
      const candidateRows = allRows.filter(
        (row) => AUDITED_ENTITIES.has(row.entity) && todayInCairo(new Date(row.at)) === today,
      );

      // visit_form_data's own payload carries only visit_id and
      // form_definition_id — no location_id or practitioner_id to scope by
      // directly, unlike every other audited entity. Resolving the visit up
      // front lets both the scope check below and descriptionFor() treat it
      // the same way the reference entities are treated, rather than the
      // field's mere absence silently admitting every organisation's rows
      // (isAuditRowInScope's documented "absence means org-wide" rule is
      // correct for entities with no location/practitioner concept at all —
      // this is not that; the fields exist, one join away).
      const formDataVisitIds = [
        ...new Set(
          candidateRows
            .filter((row) => row.entity === "visit_form_data")
            .map((row) => payloadOf(row)?.visit_id)
            .filter((visitId): visitId is string => typeof visitId === "string"),
        ),
      ];
      const formDataVisits = await db.visits.bulkGet(formDataVisitIds);
      const formDataVisitsById = new Map(
        formDataVisits.filter((v): v is Visit => v != null).map((v) => [v.id, v]),
      );

      // prescription_items is the same case one level down: its payload
      // carries only prescription_id, so each row is scoped (and named) by
      // its prescription, which carries the visit's location, practitioner
      // and patient.
      const itemPrescriptionIds = [
        ...new Set(
          candidateRows
            .filter((row) => row.entity === "prescription_items")
            .map((row) => payloadOf(row)?.prescription_id)
            .filter((prescriptionId): prescriptionId is string => typeof prescriptionId === "string"),
        ),
      ];
      const itemPrescriptions = await db.prescriptions.bulkGet(itemPrescriptionIds);
      const itemPrescriptionsById = new Map(
        itemPrescriptions.filter((p): p is Prescription => p != null).map((p) => [p.id, p]),
      );

      function itemPrescriptionOf(row: AuditLog): Prescription | undefined {
        const prescriptionId = payloadOf(row)?.prescription_id;
        return typeof prescriptionId === "string" ? itemPrescriptionsById.get(prescriptionId) : undefined;
      }

      // care_plan_items likewise: its payload carries only care_plan_id, and
      // its plan carries the location, practitioner and patient.
      const itemPlanIds = [
        ...new Set(
          candidateRows
            .filter((row) => row.entity === "care_plan_items")
            .map((row) => payloadOf(row)?.care_plan_id)
            .filter((planId): planId is string => typeof planId === "string"),
        ),
      ];
      const itemPlans = await db.care_plans.bulkGet(itemPlanIds);
      const itemPlansById = new Map(itemPlans.filter((p): p is CarePlan => p != null).map((p) => [p.id, p]));

      function itemPlanOf(row: AuditLog): CarePlan | undefined {
        const planId = payloadOf(row)?.care_plan_id;
        return typeof planId === "string" ? itemPlansById.get(planId) : undefined;
      }

      function isInScope(row: AuditLog): boolean {
        if (row.entity === "visit_form_data") {
          const visitId = payloadOf(row)?.visit_id;
          const visit = typeof visitId === "string" ? formDataVisitsById.get(visitId) : undefined;
          return visit ? visit.location_id === locationId && visit.practitioner_id === practitionerId : false;
        }
        if (row.entity === "prescription_items") {
          const prescription = itemPrescriptionOf(row);
          return prescription
            ? prescription.location_id === locationId && prescription.practitioner_id === practitionerId
            : false;
        }
        if (row.entity === "care_plan_items") {
          const plan = itemPlanOf(row);
          return plan ? plan.location_id === locationId && plan.practitioner_id === practitionerId : false;
        }
        // A practitioner's own row carries neither field, only its id: it
        // is in scope on that practitioner's log, at any location.
        if (row.entity === "practitioners") {
          return row.entity_id === practitionerId;
        }
        return isAuditRowInScope(row, practitionerId, locationId);
      }

      const scoped = candidateRows.filter(isInScope);

      // A staff membership's own row names its staff member.
      const subjectMembershipIds = scoped
        .filter((row) => row.entity === "memberships")
        .map((row) => row.entity_id);
      const membershipIds = [...new Set([...scoped.map((row) => row.actor_membership_id), ...subjectMembershipIds])];
      const memberships = await db.memberships.bulkGet(membershipIds);
      const membershipsById = new Map(
        memberships.filter((m): m is Membership => m != null).map((m) => [m.id, m]),
      );
      const userIds = [...new Set([...membershipsById.values()].map((m) => m.user_id))];
      const users = await db.users.bulkGet(userIds);
      const usersById = new Map(users.filter((u): u is User => u != null).map((u) => [u.id, u]));

      // The patient a row is about, for the entities whose line names one.
      function patientIdOf(row: AuditLog): string | undefined {
        if (row.entity === "prescription_items") {
          return itemPrescriptionOf(row)?.patient_id;
        }
        if (row.entity === "care_plan_items") {
          return itemPlanOf(row)?.patient_id;
        }
        if (
          row.entity === "visits" ||
          row.entity === "invoices" ||
          row.entity === "prescriptions" ||
          row.entity === "messages" ||
          row.entity === "care_plans"
        ) {
          const patientId = payloadOf(row)?.patient_id;
          return typeof patientId === "string" ? patientId : undefined;
        }
        return undefined;
      }

      const patientIds = new Set<string>();
      for (const row of scoped) {
        const patientId = patientIdOf(row);
        if (patientId !== undefined) {
          patientIds.add(patientId);
        }
      }
      const patients = await db.patients.bulkGet([...patientIds]);
      const patientsById = new Map(patients.filter((p): p is Patient => p != null).map((p) => [p.id, p]));

      function actorNameFor(membershipId: string): string {
        const membership = membershipsById.get(membershipId);
        const user = membership ? usersById.get(membership.user_id) : undefined;
        return formatActorName(membership, user);
      }

      function contextFor(row: AuditLog): string {
        const payload = payloadOf(row);
        if (!payload) {
          return "";
        }
        if (row.entity === "visits") {
          if (typeof payload.scheduled_at === "string") {
            return `${dayScreenStrings.auditContextSlotPrefix} ${clockTimeInCairo(payload.scheduled_at)}`;
          }
          return typeof payload.position === "number" ? `${dayScreenStrings.auditContextQueuePrefix} ${payload.position}` : "";
        }
        if (row.entity === "invoices") {
          const { number, issued_year: issuedYear, series } = payload;
          return typeof number === "number" && typeof issuedYear === "number"
            ? `${dayScreenStrings.auditContextInvoicePrefix} ${formatInvoiceNumber({ number, issued_year: issuedYear, series: typeof series === "number" ? series : 1 })}`
            : "";
        }
        if (row.entity === "payments") {
          const receiptNumber = payload.receipt_number;
          // A payment audited before number series existed carries no
          // series: it was minted as series 1, the value database version 15
          // gave its row.
          const series = typeof payload.series === "number" ? payload.series : 1;
          return typeof receiptNumber === "string"
            ? `${dayScreenStrings.paymentReceiptNumberPrefix} ${formatBareReceiptNumber({ receipt_number: receiptNumber, series })}`
            : "";
        }
        return "";
      }

      function subjectFor(row: AuditLog): string {
        const payload = payloadOf(row);
        if (!payload) {
          return "";
        }
        // A prescription's line names its patient, never a drug, its
        // instructions or the diagnosis, a message's never its body or
        // phone, and a care plan's never its goal or diagnosis (as their
        // verbs, domain/auditVerb.ts).
        if (
          row.entity === "visits" ||
          row.entity === "invoices" ||
          row.entity === "prescriptions" ||
          row.entity === "prescription_items" ||
          row.entity === "messages" ||
          row.entity === "care_plans" ||
          row.entity === "care_plan_items"
        ) {
          const patientId = patientIdOf(row);
          return patientId !== undefined ? (patientsById.get(patientId)?.full_name ?? "") : "";
        }
        if (row.entity === "patients") {
          return typeof payload.full_name === "string" ? payload.full_name : "";
        }
        if (row.entity === "payments") {
          // `.aud-txt .verb`: "سجّل دفعة · 200 ج.م كاش".
          const amount = payload.amount;
          const method = typeof payload.method === "string" ? (METHOD_LABEL[payload.method] ?? "") : "";
          return typeof amount === "number"
            ? `${formatMoneyAmount(amount as Piastres)} ${dayScreenStrings.tileCurrencyUnit} ${method}`.trim()
            : "";
        }
        if (row.entity === "cash_close") {
          const date = payload.date;
          return typeof date === "string" ? formatWeekdayDayMonth(date) : "";
        }
        if (row.entity === "visit_form_data") {
          return describeVisitFormChange(row)?.excerpt ?? "";
        }
        // Settings name what was set — never a price, a PIN or a scope.
        if (row.entity === "services" || row.entity === "users") {
          const name = row.entity === "services" ? payload.name : payload.full_name;
          return typeof name === "string" ? name : "";
        }
        if (row.entity === "memberships") {
          const membership = membershipsById.get(row.entity_id);
          return membership ? (usersById.get(membership.user_id)?.full_name ?? "") : "";
        }
        if (row.entity === "schedules") {
          const weekday = payload.weekday;
          return typeof weekday === "number" ? (dayScreenStrings.weekdayNames[weekday] ?? "") : "";
        }
        return "";
      }

      return scoped
        .slice()
        .sort((a, b) => b.at.localeCompare(a.at))
        .map((row) => ({
          row,
          verb: describeAuditVerb(row),
          subject: subjectFor(row),
          actorName: actorNameFor(row.actor_membership_id),
          context: contextFor(row),
          tone: auditDotTone(row),
        }));
    }, [practitionerId, locationId, today]) ?? [];

  const filteredRows = filterAuditRows(
    rows.map((item) => ({ ...item, entity: item.row.entity })),
    filter,
  );

  const now = new Date();

  return (
    <Sheet onDismiss={onDismiss} size="lg">
      {/* `.c-head`: "اليوم", "سجل اليوم", and the count of events listed as `.sub`. */}
      <SheetCardHead
        badge={dayScreenStrings.auditSheetBadge}
        title={dayScreenStrings.auditSheetTitle}
        subtitle={
          <>
            <Ltr>{filteredRows.length}</Ltr> {dayScreenStrings.auditEventCountUnit}
          </>
        }
        onDismiss={onDismiss}
      />

      {/* `.filts` — the prototype's four `.filt`s, the shared ToggleGroup. */}
      <div className="border-b border-hair bg-field px-[18px] py-3">
        <ToggleGroup
          variant="filter"
          label={dayScreenStrings.auditFilterGroupLabel}
          value={filter}
          onChange={setFilter}
          options={FILTER_OPTIONS}
        />
      </div>

      {/* `.audit` — a timeline of who did what: the verb leads, the actor follows. */}
      {filteredRows.length === 0 ? (
        <p className="px-[18px] py-[22px] text-center text-[12.5px] text-faint">{dayScreenStrings.auditSheetEmpty}</p>
      ) : (
        <ul className="flex flex-col">
          {filteredRows.map(({ row, verb, subject, actorName, context, tone }) => {
            const elapsed = computeElapsedLabel(row.at, now.toISOString(), today, now);
            return (
              <li
                key={row.id}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-[14px] border-b border-hair px-[18px] py-3 last:border-b-0 max-[600px]:px-3.5"
              >
                <span className={`h-[9px] w-[9px] rounded-full ${DOT_LOOK[tone]}`} aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold text-text">
                    <span>{verb}</span>
                    {subject && (
                      <>
                        {" · "}
                        <span>{subject}</span>
                      </>
                    )}
                  </p>
                  <p className="mt-px text-[11.5px] text-muted">
                    <b className="font-semibold text-text">{actorName}</b>
                    {context && (
                      <>
                        {" · "}
                        <span>{context}</span>
                      </>
                    )}
                  </p>
                </div>
                <span className="whitespace-nowrap text-end text-[11px] text-faint tabular-nums">
                  <Ltr>{clockTimeInCairo(row.at)}</Ltr>
                  {elapsed && (
                    <>
                      {" · "}
                      {dayScreenStrings.auditElapsedPrefix} <Ltr>{elapsed}</Ltr>
                    </>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Sheet>
  );
}

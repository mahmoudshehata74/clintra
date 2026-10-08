import { useState } from "react";
import Ltr from "../../components/Ltr";
import ToggleGroup from "../../components/ui/ToggleGroup";
import { db } from "../../db/database";
import { useLiveQuery } from "../../db/useLiveQuery";
import type { AuditLog, ClinicDay, Membership, Patient, User, Visit } from "../../db/types";
import { AuditAction } from "../../db/types";
import { describeAuditVerb, describeVisitFormChange } from "../../domain/auditVerb";
import { clockTimeInCairo, formatCairoDisplayDate, todayInCairo } from "../../domain/time";
import { formatActorLabel } from "./actorLabel";
import { auditDotTone, type AuditDotTone } from "./auditDotTone";
import {
  type AuditActionFilter,
  type AuditEntityFilter,
  filterAuditRows,
  isAuditRowInScope,
} from "./auditLogFilters";
import { computeElapsedLabel } from "./elapsedLabel";
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
  description: string;
  actorLabel: string;
  tone: AuditDotTone;
}

const ENTITY_FILTER_OPTIONS: readonly { value: AuditEntityFilter; label: string }[] = [
  { value: "all", label: dayScreenStrings.auditFilterAll },
  { value: "visits", label: dayScreenStrings.auditFilterEntityVisits },
  { value: "patients", label: dayScreenStrings.auditFilterEntityPatients },
  { value: "invoices", label: dayScreenStrings.auditFilterEntityInvoices },
  { value: "payments", label: dayScreenStrings.auditFilterEntityPayments },
  { value: "cash_close", label: dayScreenStrings.auditFilterEntityCashClose },
  { value: "visit_form_data", label: dayScreenStrings.auditFilterEntityVisitFormData },
];

const ACTION_FILTER_OPTIONS: readonly { value: AuditActionFilter; label: string }[] = [
  { value: "all", label: dayScreenStrings.auditFilterAll },
  { value: AuditAction.Create, label: dayScreenStrings.auditFilterActionCreate },
  { value: AuditAction.Update, label: dayScreenStrings.auditFilterActionUpdate },
  { value: AuditAction.Delete, label: dayScreenStrings.auditFilterActionDelete },
];

const AUDITED_ENTITIES = new Set(["visits", "patients", "invoices", "payments", "cash_close", "visit_form_data"]);

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
 * `.aud-time`. The verb leads every row at the larger size; the actor is
 * named on the smaller muted line under it, beside the row's context.
 */
export default function AuditSheet({ practitionerId, locationId, today, onDismiss }: AuditSheetProps) {
  const [entityFilter, setEntityFilter] = useState<AuditEntityFilter>("all");
  const [actionFilter, setActionFilter] = useState<AuditActionFilter>("all");

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

      function isInScope(row: AuditLog): boolean {
        if (row.entity === "visit_form_data") {
          const visitId = payloadOf(row)?.visit_id;
          const visit = typeof visitId === "string" ? formDataVisitsById.get(visitId) : undefined;
          return visit ? visit.location_id === locationId && visit.practitioner_id === practitionerId : false;
        }
        return isAuditRowInScope(row, practitionerId, locationId);
      }

      const scoped = candidateRows.filter(isInScope);

      const membershipIds = [...new Set(scoped.map((row) => row.actor_membership_id))];
      const memberships = await db.memberships.bulkGet(membershipIds);
      const membershipsById = new Map(
        memberships.filter((m): m is Membership => m != null).map((m) => [m.id, m]),
      );
      const userIds = [...new Set([...membershipsById.values()].map((m) => m.user_id))];
      const users = await db.users.bulkGet(userIds);
      const usersById = new Map(users.filter((u): u is User => u != null).map((u) => [u.id, u]));

      const patientIds = new Set<string>();
      for (const row of scoped) {
        if (row.entity === "visits" || row.entity === "invoices") {
          const patientId = payloadOf(row)?.patient_id;
          if (typeof patientId === "string") {
            patientIds.add(patientId);
          }
        }
      }
      const patients = await db.patients.bulkGet([...patientIds]);
      const patientsById = new Map(patients.filter((p): p is Patient => p != null).map((p) => [p.id, p]));

      function actorLabelFor(membershipId: string): string {
        const membership = membershipsById.get(membershipId);
        const user = membership ? usersById.get(membership.user_id) : undefined;
        return formatActorLabel(membership, user);
      }

      function descriptionFor(row: AuditLog): string {
        const payload = payloadOf(row);
        if (!payload) {
          return "";
        }
        if (row.entity === "visits" || row.entity === "invoices") {
          const patientId = payload.patient_id;
          return typeof patientId === "string" ? (patientsById.get(patientId)?.full_name ?? "") : "";
        }
        if (row.entity === "patients") {
          return typeof payload.full_name === "string" ? payload.full_name : "";
        }
        if (row.entity === "payments") {
          const receiptNumber = payload.receipt_number;
          return typeof receiptNumber === "string"
            ? `${dayScreenStrings.paymentReceiptNumberPrefix} ${receiptNumber}`
            : "";
        }
        if (row.entity === "cash_close") {
          const date = payload.date;
          return typeof date === "string" ? formatCairoDisplayDate(date) : "";
        }
        if (row.entity === "visit_form_data") {
          return describeVisitFormChange(row)?.excerpt ?? "";
        }
        return "";
      }

      return scoped
        .slice()
        .sort((a, b) => b.at.localeCompare(a.at))
        .map((row) => ({
          row,
          verb: describeAuditVerb(row),
          description: descriptionFor(row),
          actorLabel: actorLabelFor(row.actor_membership_id),
          tone: auditDotTone(row),
        }));
    }, [practitionerId, locationId, today]) ?? [];

  const filteredRows = filterAuditRows(
    rows.map((item) => ({ ...item, entity: item.row.entity, action: item.row.action })),
    entityFilter,
    actionFilter,
  );

  const now = new Date();

  return (
    <Sheet onDismiss={onDismiss} size="lg">
      {/* `.c-head`: the title as before, with the count of events listed as `.sub`. */}
      <SheetCardHead
        title={
          <>
            {dayScreenStrings.auditSheetTitle} — {formatCairoDisplayDate(today)}
          </>
        }
        subtitle={
          <>
            <Ltr>{filteredRows.length}</Ltr> {dayScreenStrings.auditEventCountUnit}
          </>
        }
        onDismiss={onDismiss}
      />

      {/* `.filts` — the bar itself; each group is the shared `.filt` ToggleGroup. */}
      <div className="flex flex-col gap-2 border-b border-hair bg-field px-[18px] py-3">
        <ToggleGroup
          variant="filter"
          label={dayScreenStrings.auditFilterEntityGroupLabel}
          value={entityFilter}
          onChange={setEntityFilter}
          options={ENTITY_FILTER_OPTIONS}
        />
        <ToggleGroup
          variant="filter"
          label={dayScreenStrings.auditFilterActionGroupLabel}
          value={actionFilter}
          onChange={setActionFilter}
          options={ACTION_FILTER_OPTIONS}
        />
      </div>

      {/* `.audit` — a timeline of who did what: the verb leads, the actor follows. */}
      {filteredRows.length === 0 ? (
        <p className="px-[18px] py-[22px] text-center text-[12.5px] text-faint">{dayScreenStrings.auditSheetEmpty}</p>
      ) : (
        <ul className="flex flex-col">
          {filteredRows.map(({ row, verb, description, actorLabel, tone }) => {
            const elapsed = computeElapsedLabel(row.at, now.toISOString(), today, now);
            return (
              <li
                key={row.id}
                className="grid grid-cols-[auto_1fr_auto] items-center gap-[14px] border-b border-hair px-[18px] py-3 last:border-b-0 max-[600px]:px-3.5"
              >
                <span className={`h-[9px] w-[9px] rounded-full ${DOT_LOOK[tone]}`} aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-[13.5px] font-semibold text-text">{verb}</p>
                  <p className="mt-px text-[11.5px] text-muted">
                    <b className="font-semibold text-text">{actorLabel}</b>
                    {description && <> · {description}</>}
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

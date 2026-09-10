import { useState } from "react";
import Ltr from "../../components/Ltr";
import { db } from "../../db/database";
import { useLiveQuery } from "../../db/useLiveQuery";
import type { AuditLog, ClinicDay, Membership, Patient, User, Visit } from "../../db/types";
import { AuditAction } from "../../db/types";
import { describeAuditVerb, describeVisitFormChange } from "../../domain/auditVerb";
import { clockTimeInCairo, formatCairoDisplayDate, todayInCairo } from "../../domain/time";
import { formatActorLabel } from "./actorLabel";
import {
  type AuditActionFilter,
  type AuditEntityFilter,
  filterAuditRows,
  isAuditRowInScope,
} from "./auditLogFilters";
import Sheet from "./Sheet";
import SheetHeader from "./SheetHeader";
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

// The reference's .tg.a (selected) / .tg.e (neutral) tag-pill language.
function filterPillClassName(isSelected: boolean): string {
  return isSelected
    ? "rounded-[5px] bg-green-soft px-2 py-0.5 text-xs text-green"
    : "rounded-[5px] bg-line-soft px-2 py-0.5 text-xs text-muted";
}

/**
 * A full-height sheet listing today's audit_log rows for the current
 * practitioner+location, newest first — a timeline the doctor reads to
 * reconstruct what happened, not staff surveillance. The verb is the
 * primary text on every row; the actor is a muted line underneath, never
 * emphasized over the action itself.
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
        }));
    }, [practitionerId, locationId, today]) ?? [];

  const filteredRows = filterAuditRows(
    rows.map((item) => ({ ...item, entity: item.row.entity, action: item.row.action })),
    entityFilter,
    actionFilter,
  );

  return (
    <Sheet onDismiss={onDismiss}>
      <SheetHeader
        title={
          <>
            {dayScreenStrings.auditSheetTitle} — {formatCairoDisplayDate(today)}
          </>
        }
        onDismiss={onDismiss}
      />

      <div className="mt-3 flex flex-wrap gap-2">
        {ENTITY_FILTER_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setEntityFilter(option.value)}
            className={filterPillClassName(option.value === entityFilter)}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {ACTION_FILTER_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setActionFilter(option.value)}
            className={filterPillClassName(option.value === actionFilter)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col divide-y divide-line-soft overflow-y-auto">
        {filteredRows.length === 0 && <p className="py-3 text-muted">{dayScreenStrings.auditSheetEmpty}</p>}
        {filteredRows.map(({ row, verb, description, actorLabel }) => (
          <div key={row.id} className="py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span>
                <span className="text-ink">{verb}</span>
                {description && <span className="text-muted"> — {description}</span>}
              </span>
              <Ltr>
                <span className="text-sm text-muted">{clockTimeInCairo(row.at)}</span>
              </Ltr>
            </div>
            <p className="mt-1 text-sm text-muted">{actorLabel}</p>
          </div>
        ))}
      </div>
    </Sheet>
  );
}

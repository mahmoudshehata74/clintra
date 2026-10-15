import { useState } from "react";
import { useGuardedActingMembership } from "../../auth/useActingMembership";
import Button from "../../components/ui/Button";
import { db } from "../../db/database";
import type { Visit } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import CarePlanSheet from "./CarePlanSheet";
import { canStartCarePlan, carePlanBadgeProgress, derivePlanSessions, ongoingPlanFor, type PlanWithSessions } from "./carePlanModel";
import { carePlanStrings as T } from "./strings";

/** The patient's plans with the visit's practitioner, each with its sessions derived. */
async function loadPlans(visit: Pick<Visit, "patient_id" | "practitioner_id">): Promise<PlanWithSessions[]> {
  const plans = (await db.care_plans.where("patient_id").equals(visit.patient_id).toArray()).filter(
    (plan) => plan.practitioner_id === visit.practitioner_id,
  );
  if (plans.length === 0) {
    return [];
  }
  const items = await db.care_plan_items.where("care_plan_id").anyOf(plans.map((plan) => plan.id)).toArray();
  const visitIds = [...new Set(items.map((item) => item.visit_id).filter((visitId): visitId is string => visitId !== null))];
  const visits = visitIds.length === 0 ? [] : (await db.visits.bulkGet(visitIds)).filter((linked): linked is Visit => linked !== undefined);
  return plans.map((plan) => ({
    plan,
    sessions: derivePlanSessions(
      items.filter((item) => item.care_plan_id === plan.id),
      visits,
      [],
    ),
  }));
}

/**
 * The visit workspace's way into the care plan (screen 10's `.plan-badge`,
 * `.ic`, `.t`, `.p`): with a plan under way between the patient and the
 * visit's practitioner, "خطة رعاية جارية: {goal}" and "جلسة {n} من
 * {count}", opening the plan; without one, the visit's own practitioner
 * gets "ابدأ خطة رعاية" on a visit in the room or completed, opening the
 * create form. Renders nothing otherwise.
 */
export default function CarePlanEntry({ visit }: { visit: Visit }) {
  const actingPractitionerId = useGuardedActingMembership()?.practitioner_id ?? null;
  const [sheet, setSheet] = useState<{ planId: string | null } | null>(null);
  const plans = useLiveQuery(() => loadPlans(visit), [visit.patient_id, visit.practitioner_id]);

  if (!plans) {
    return null;
  }
  const ongoing = ongoingPlanFor(plans, visit.patient_id, visit.practitioner_id);
  const canStart = canStartCarePlan(actingPractitionerId, visit, ongoing !== null);

  return (
    <>
      {ongoing ? (
        <button
          type="button"
          onClick={() => setSheet({ planId: ongoing.plan.id })}
          className="inline-flex cursor-pointer items-center gap-2 self-start rounded-control border border-copper-line bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-copper)_12%,var(--color-card))_0%,var(--color-card)_100%)] px-3 py-2 text-start font-[inherit] text-xs text-text transition-colors duration-150 hover:border-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper"
        >
          <span
            aria-hidden="true"
            className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-chip bg-copper text-[11px] font-bold text-on-fill"
          >
            {T.badgeIcon}
          </span>
          <span className="font-semibold">
            {T.badgePrefix} {ongoing.plan.goal}
          </span>
          <span className="ms-auto text-[11px] font-bold text-copper tabular-nums">{carePlanBadgeProgress(ongoing.sessions, visit.id)}</span>
        </button>
      ) : (
        canStart && (
          <Button variant="secondary" size="sm" className="self-start" onClick={() => setSheet({ planId: null })}>
            {T.startPlan}
          </Button>
        )
      )}
      {sheet && <CarePlanSheet visitId={visit.id} planId={sheet.planId} onDismiss={() => setSheet(null)} />}
    </>
  );
}

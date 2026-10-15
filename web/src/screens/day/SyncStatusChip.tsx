import { useState } from "react";
import { db } from "../../db/database";
import { useLiveQuery } from "../../db/useLiveQuery";
import { DISPLACED_BY_SERVER_REASON, SERVER_UNIQUE_CONFLICT_REASON, type DisplacedPayload } from "../../sync/pullCollisions";
import { acknowledgeReview, discardMine, getReviewComparison, keepMine, type ReviewComparison } from "../../sync/reviewActions";
import {
  describeDisplacedContent,
  describeReviewFieldDiffs,
  describeSupersededReviews,
  describeSyncReview,
} from "../../sync/reviewSummary";
import { useOnlineStatus } from "../../sync/useOnlineStatus";
import { useServerUnreachable } from "../../sync/useTransportHealth";
import type { SyncReview } from "../../db/types";
import Sheet from "./Sheet";
import { dayScreenStrings } from "./strings";

type ChipState = "online" | "local" | "server_unreachable" | "needs_review";

// Restyled for the dark app bar it now lives in (AppShell.tsx) — a soft
// `.app-btn`-sized chip whose border/fill tint carries the meaning (green for
// "everything is fine", danger for "needs attention", plain on-dark otherwise)
// while the text itself stays on-dark for contrast against the ink gradient.
const CHIP_BASE = "rounded-control border px-[11px] py-[5px] text-[11.5px] font-medium text-on-dark";
function chipClassName(state: ChipState): string {
  if (state === "needs_review") {
    return `${CHIP_BASE} border-danger-line bg-[color-mix(in_srgb,var(--color-danger)_26%,transparent)]`;
  }
  if (state === "online") {
    return `${CHIP_BASE} border-green-line bg-[color-mix(in_srgb,var(--color-green)_20%,transparent)]`;
  }
  return `${CHIP_BASE} border-glass/[0.14] bg-glass/[0.08]`;
}

interface ReviewRow {
  review: SyncReview;
  comparison: ReviewComparison;
  /** What a displaced_by_server row held (reviewSummary.ts's describeDisplacedContent); null for every other row. */
  displacedContent: string | null;
  /** The reviews a displacement closed and folded in (describeSupersededReviews); null for every other row. */
  supersededSummary: string | null;
}

/** The patient behind a displaced visit, so its summary can name them; null for any other row. */
function displacedPatientId(review: SyncReview): string | null {
  if (review.reason !== DISPLACED_BY_SERVER_REASON || review.entity !== "visits") {
    return null;
  }
  return ((review.payload as DisplacedPayload).row.patient_id as string | undefined) ?? null;
}

/**
 * The day header's sync indicator: "متصل" while the network is up and
 * nothing needs attention, "شغّال محلي" once the network interface drops
 * (the app keeps working, purely locally), "السيرفر مش راد" when the
 * interface is up but the transport itself keeps failing outright
 * (docs/sync-plan.md's Q10 — sync/engine.ts's consecutive-transport-failure
 * counter, not an ordinary per-op rejection), and — regardless of any of
 * those — "فيه حاجة محتاجة مراجعة" the moment sync_review has any open row,
 * since a standing conflict matters more than plain connectivity. Tapping
 * the chip only opens something in that last state.
 *
 * Two kinds of row offer no choice between versions (sync/pullCollisions.ts):
 * a row the server's version displaced shows what it held and only "تمام",
 * and a server_unique_conflict shows its reference code (in its description)
 * and nothing to press — it needs support. A displacement also lists the
 * payments it removed (in its description) and the reviews it closed for
 * the same rows; a create conflict whose local row is already gone offers
 * only "تمام", never keep/discard (sync/reviewActions.ts's REVIEW_ROW_GONE).
 */
export default function SyncStatusChip() {
  const isOnline = useOnlineStatus();
  const isServerUnreachable = useServerUnreachable();
  const [isListOpen, setIsListOpen] = useState(false);

  const reviewRows =
    useLiveQuery<ReviewRow[]>(async () => {
      const allReviews = await db.sync_review.toArray();
      const openReviews = allReviews.filter((review) => review.needs_review);
      return Promise.all(
        openReviews.map(async (review) => {
          const patientId = displacedPatientId(review);
          const patient = patientId === null ? undefined : await db.patients.get(patientId);
          const patientNames = new Map(patient ? [[patient.id, patient.full_name]] : []);
          return {
            review,
            comparison: await getReviewComparison(db, review),
            displacedContent: describeDisplacedContent(review, patientNames),
            supersededSummary: describeSupersededReviews(review),
          };
        }),
      );
    }, []) ?? [];

  const state: ChipState =
    reviewRows.length > 0 ? "needs_review" : !isOnline ? "local" : isServerUnreachable ? "server_unreachable" : "online";
  const label = {
    needs_review: dayScreenStrings.syncNeedsReview,
    local: dayScreenStrings.syncLocal,
    server_unreachable: dayScreenStrings.syncServerUnreachable,
    online: dayScreenStrings.syncOnline,
  }[state];

  // Gated on reviewRows.length too, not just isListOpen: if the last open
  // review resolves while the list is up, it disappears on its own rather
  // than leaving an empty sheet open.
  const showList = isListOpen && reviewRows.length > 0;

  async function handleKeep(reviewId: string) {
    await keepMine(db, reviewId);
  }

  async function handleDiscard(reviewId: string) {
    await discardMine(db, reviewId);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (state === "needs_review") {
            setIsListOpen(true);
          }
        }}
        className={chipClassName(state)}
      >
        {label}
      </button>

      {showList && (
        <Sheet onDismiss={() => setIsListOpen(false)}>
          <p className="p-3 pb-1 text-sm font-medium">{dayScreenStrings.syncReviewListTitle}</p>
          <div className="flex flex-col overflow-y-auto">
            {reviewRows.map(({ review, comparison, displacedContent, supersededSummary }) => (
              <div key={review.id} className="flex flex-col gap-2 border-t border-rule p-3">
                <p className="text-sm">{describeSyncReview(review)}</p>

                {review.reason === DISPLACED_BY_SERVER_REASON ? (
                  <>
                    {displacedContent && (
                      <p className="rounded-control bg-field p-2 text-xs">{displacedContent}</p>
                    )}
                    {supersededSummary && <p className="text-xs text-muted">{supersededSummary}</p>}
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => acknowledgeReview(db, review.id)}
                        className="rounded-control border border-rule px-2 py-1 text-sm"
                      >
                        {dayScreenStrings.syncReviewAcknowledgeAction}
                      </button>
                    </div>
                  </>
                ) : review.reason === SERVER_UNIQUE_CONFLICT_REASON ? null : comparison.rowGone ? (
                  <>
                    <p className="text-xs text-muted">{dayScreenStrings.syncReviewRowGone}</p>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => acknowledgeReview(db, review.id)}
                        className="rounded-control border border-rule px-2 py-1 text-sm"
                      >
                        {dayScreenStrings.syncReviewAcknowledgeAction}
                      </button>
                    </div>
                  </>
                ) : comparison.ready ? (
                  <>
                    <ReviewComparisonTable comparison={comparison} />
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => handleKeep(review.id)}
                        className="rounded-control border border-rule px-2 py-1 text-sm"
                      >
                        {dayScreenStrings.syncReviewKeepAction}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDiscard(review.id)}
                        className="rounded-control border border-rule px-2 py-1 text-sm"
                      >
                        {dayScreenStrings.syncReviewRemoveAction}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted">{dayScreenStrings.syncReviewWaitingForServer}</p>
                )}
              </div>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}

/**
 * Both versions, side by side, before either action is offered — never
 * rendered until getReviewComparison reports ready (docs/sync-plan.md's
 * Q6: a blind choice is worse than no choice). A create conflict (Q7) has
 * no server row under this entity_id at all, so this shows that
 * explicitly rather than an empty diff.
 */
function ReviewComparisonTable({ comparison }: { comparison: ReviewComparison }) {
  if (comparison.server === null) {
    return <p className="rounded-control bg-field p-2 text-xs text-muted">{dayScreenStrings.syncReviewNoServerRow}</p>;
  }

  const diffs = describeReviewFieldDiffs(comparison.mine, comparison.server);
  if (diffs.length === 0) {
    return null;
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-muted">
          <th className="text-start font-normal" />
          <th className="text-start font-normal">{dayScreenStrings.syncReviewMineLabel}</th>
          <th className="text-start font-normal">{dayScreenStrings.syncReviewServerLabel}</th>
        </tr>
      </thead>
      <tbody>
        {diffs.map((diff) => (
          <tr key={diff.field}>
            <td className="pe-2 text-muted">{diff.field}</td>
            <td className="pe-2">{diff.mine}</td>
            <td>{diff.server}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

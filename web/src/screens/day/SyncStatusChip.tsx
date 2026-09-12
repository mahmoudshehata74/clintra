import { useState } from "react";
import { db } from "../../db/database";
import { useLiveQuery } from "../../db/useLiveQuery";
import { discardMine, getReviewComparison, keepMine, type ReviewComparison } from "../../sync/reviewActions";
import { describeReviewFieldDiffs, describeSyncReview } from "../../sync/reviewSummary";
import { useOnlineStatus } from "../../sync/useOnlineStatus";
import { useServerUnreachable } from "../../sync/useTransportHealth";
import type { SyncReview } from "../../db/types";
import Sheet from "./Sheet";
import { dayScreenStrings } from "./strings";

type ChipState = "online" | "local" | "server_unreachable" | "needs_review";

// Matches the design reference's .tg tag-pill language: a filled soft
// background rather than an outline, one colour per meaning — green for
// "everything is fine" (.tg.a), red for "needs attention" (.tg.b), neutral
// grey otherwise (.tg.e).
function chipClassName(state: ChipState): string {
  if (state === "needs_review") {
    return "rounded-[5px] bg-red-soft px-2 py-0.5 text-xs text-red";
  }
  if (state === "online") {
    return "rounded-[5px] bg-green-soft px-2 py-0.5 text-xs text-green";
  }
  return "rounded-[5px] bg-line-soft px-2 py-0.5 text-xs text-muted";
}

interface ReviewRow {
  review: SyncReview;
  comparison: ReviewComparison;
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
        openReviews.map(async (review) => ({ review, comparison: await getReviewComparison(db, review) })),
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
            {reviewRows.map(({ review, comparison }) => (
              <div key={review.id} className="flex flex-col gap-2 border-t border-line p-3">
                <p className="text-sm">{describeSyncReview(review)}</p>

                {comparison.ready ? (
                  <>
                    <ReviewComparisonTable comparison={comparison} />
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => handleKeep(review.id)}
                        className="rounded-[--radius-el] border border-line px-2 py-1 text-sm"
                      >
                        {dayScreenStrings.syncReviewKeepAction}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDiscard(review.id)}
                        className="rounded-[--radius-el] border border-line px-2 py-1 text-sm"
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
    return <p className="rounded-[--radius-el] bg-line-soft p-2 text-xs text-muted">{dayScreenStrings.syncReviewNoServerRow}</p>;
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

import { useState } from "react";
import { db } from "../../db/database";
import { useLiveQuery } from "../../db/useLiveQuery";
import { dismissSyncReview } from "../../sync/reviewActions";
import { describeSyncReview } from "../../sync/reviewSummary";
import { useOnlineStatus } from "../../sync/useOnlineStatus";
import Sheet from "./Sheet";
import { dayScreenStrings } from "./strings";

type ChipState = "online" | "local" | "needs_review";

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

/**
 * The day header's sync indicator: "متصل" while the network is up and
 * nothing needs attention, "شغّال محلي" once the network drops (the app
 * keeps working, purely locally), and — regardless of network state —
 * "فيه حاجة محتاجة مراجعة" in muted red the moment sync_review has any open
 * row, since a standing conflict matters more than plain connectivity.
 * Tapping the chip only opens something in that third state.
 */
export default function SyncStatusChip() {
  const isOnline = useOnlineStatus();
  const [isListOpen, setIsListOpen] = useState(false);

  const reviews = useLiveQuery(() => db.sync_review.toArray(), []) ?? [];
  const needsReview = reviews.filter((review) => review.needs_review);

  const state: ChipState = needsReview.length > 0 ? "needs_review" : isOnline ? "online" : "local";
  const label =
    state === "needs_review"
      ? dayScreenStrings.syncNeedsReview
      : state === "online"
        ? dayScreenStrings.syncOnline
        : dayScreenStrings.syncLocal;

  // Gated on needsReview.length too, not just isListOpen: if the last open
  // review gets dismissed while the list is up, it disappears on its own
  // rather than leaving an empty sheet open.
  const showList = isListOpen && needsReview.length > 0;

  async function handleDismiss(reviewId: string) {
    await dismissSyncReview(db, reviewId);
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
            {needsReview.map((review) => (
              <div key={review.id} className="flex items-center justify-between gap-2 border-t border-line p-3">
                <p className="text-sm">{describeSyncReview(review)}</p>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => handleDismiss(review.id)}
                    className="rounded-[--radius-el] border border-line px-2 py-1 text-sm"
                  >
                    {dayScreenStrings.syncReviewKeepAction}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDismiss(review.id)}
                    className="rounded-[--radius-el] border border-line px-2 py-1 text-sm"
                  >
                    {dayScreenStrings.syncReviewRemoveAction}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Sheet>
      )}
    </>
  );
}

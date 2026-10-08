import { useState } from "react";
import { db } from "../../db/database";
import type { Visit } from "../../db/types";
import { setVisitNote } from "../../db/visitNote";
import { doctorDayStrings as T } from "./strings";

interface QuickNoteProps {
  /** The visit in the room — keyed by its id at the call site, so the draft starts over for each patient. */
  visit: Visit;
}

/**
 * `.quick-note`: the in-room visit's note (visits.note), written through
 * setVisitNote — audited and synced like every other visit field. Visible
 * to anyone who can see the visit, hence the placeholder's wording.
 *
 * The draft is this component's own state, nothing more: the doctor's day
 * stays mounted underneath the lock overlay exactly as the day screen does
 * (App.tsx renders LockScreen over the mounted screen rather than in its
 * place), so half-typed text survives an idle lock the same way a
 * half-written sheet does.
 *
 * "حفظ" is disabled while the draft, as setVisitNote would store it
 * (trimmed), equals the stored note; after a save, "اتحفظ" stays until the
 * text changes again.
 */
export default function QuickNote({ visit }: QuickNoteProps) {
  const [draft, setDraft] = useState(visit.note ?? "");
  const [savedDraft, setSavedDraft] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const inputId = `quick-note-${visit.id}`;
  const matchesStored = draft.trim() === (visit.note ?? "");

  async function handleSave() {
    setIsSaving(true);
    try {
      await setVisitNote(db, visit.id, draft);
      setSavedDraft(draft);
    } catch (error) {
      console.error(error);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form
      className="flex flex-wrap items-center gap-2.5 border-t border-dashed border-copper-line pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!matchesStored && !isSaving) {
          void handleSave();
        }
      }}
    >
      <label htmlFor={inputId} className="flex-none text-[11px] font-bold uppercase tracking-[0.05em] text-copper">
        {T.quickNoteLabel}
      </label>
      <input
        id={inputId}
        value={draft}
        placeholder={T.quickNotePlaceholder}
        onChange={(event) => setDraft(event.target.value)}
        className="min-w-40 flex-1 rounded-control border-[1.5px] border-rule bg-card px-3 py-[7px] text-[13px] text-text placeholder:text-faint focus:border-copper focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-copper)_15%,transparent)] focus:outline-none"
      />
      {savedDraft === draft && (
        <span role="status" className="text-[11px] text-muted">
          {T.quickNoteSaved}
        </span>
      )}
      <button
        type="submit"
        disabled={matchesStored || isSaving}
        className="flex-none cursor-pointer appearance-none rounded-chip border border-copper-line bg-transparent px-3 py-1.5 text-[11px] font-semibold text-copper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-copper disabled:cursor-not-allowed disabled:opacity-50"
      >
        {T.quickNoteSave}
      </button>
    </form>
  );
}

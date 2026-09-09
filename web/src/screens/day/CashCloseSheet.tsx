import { useState } from "react";
import Ltr from "../../components/Ltr";
import { closeCashForDay, computeExpectedCashTotal } from "../../db/cashClose";
import { db } from "../../db/database";
import { useLiveQuery } from "../../db/useLiveQuery";
import { formatPiastresForDisplay, parsePoundsToPiastres, type Piastres } from "../../domain/money";
import type { ClinicDay } from "../../domain/time";
import { validateCashCloseForm } from "./cashCloseForm";
import Sheet from "./Sheet";
import { dayScreenStrings } from "./strings";

interface CashCloseSheetProps {
  locationId: string;
  orgId: string;
  date: ClinicDay;
  onDismiss: () => void;
  onClosed: () => void;
}

/** The day header's cash-close sheet: expected vs. collected, with a note required only when they differ. */
export default function CashCloseSheet({ locationId, orgId, date, onDismiss, onClosed }: CashCloseSheetProps) {
  const [totalCollectedInput, setTotalCollectedInput] = useState("");
  const [note, setNote] = useState("");
  const [collectedError, setCollectedError] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const invoicesAtLocation =
    useLiveQuery(() => db.invoices.where("location_id").equals(locationId).toArray(), [locationId]) ?? [];
  const expected = computeExpectedCashTotal(invoicesAtLocation, locationId, date);

  const parsedCollected = parsePoundsToPiastres(totalCollectedInput);
  const difference = parsedCollected.ok ? ((parsedCollected.value - expected) as Piastres) : null;

  async function handleConfirm() {
    const validation = validateCashCloseForm({ totalCollectedInput, note }, expected);
    if (!validation.ok) {
      setCollectedError(validation.collectedError);
      setNoteError(validation.noteError);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await closeCashForDay(db, {
        locationId,
        orgId,
        date,
        totalCollected: validation.totalCollected,
        differenceNote: validation.note,
      });
      if (!result.ok) {
        setCollectedError(dayScreenStrings.cashCloseAlreadyClosedError);
        return;
      }
      onClosed();
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Sheet onDismiss={onDismiss}>
      <p className="font-medium">{dayScreenStrings.cashCloseSheetTitle}</p>

      <p className="mt-3 flex justify-between text-sm">
        <span className="text-muted">{dayScreenStrings.cashCloseExpectedLabel}</span>
        <Ltr>{formatPiastresForDisplay(expected)}</Ltr>
      </p>

      <div className="mt-3">
        <input
          type="text"
          inputMode="decimal"
          value={totalCollectedInput}
          onChange={(event) => {
            setTotalCollectedInput(event.target.value);
            setCollectedError(null);
          }}
          placeholder={dayScreenStrings.cashCloseCollectedPlaceholder}
          className="w-full rounded-[--radius-el] border border-line bg-paper px-3 py-2 text-start"
        />
        {collectedError && <p className="mt-1 text-sm text-red">{collectedError}</p>}
      </div>

      {difference !== null && (
        <p className="mt-3 flex justify-between text-sm">
          <span className="text-muted">{dayScreenStrings.cashCloseDifferenceLabel}</span>
          <Ltr>{formatPiastresForDisplay(difference)}</Ltr>
        </p>
      )}

      <div className="mt-3">
        <input
          type="text"
          value={note}
          onChange={(event) => {
            setNote(event.target.value);
            setNoteError(null);
          }}
          placeholder={dayScreenStrings.cashCloseNotePlaceholder}
          className="w-full rounded-[--radius-el] border border-line bg-paper px-3 py-2 text-start"
        />
        {noteError && <p className="mt-1 text-sm text-red">{noteError}</p>}
      </div>

      <button
        type="button"
        disabled={isSubmitting}
        onClick={handleConfirm}
        className="mt-4 rounded-[--radius-el] bg-green px-4 py-3 text-center font-semibold text-paper disabled:opacity-60"
      >
        {dayScreenStrings.cashCloseConfirmButton}
      </button>
    </Sheet>
  );
}

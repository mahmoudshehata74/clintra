import { useState } from "react";
import { db } from "../../db/database";
import { useLiveQuery } from "../../db/useLiveQuery";
import { formatPiastresForDisplay, type Piastres } from "../../domain/money";
import { recordPayment } from "../../db/payments";
import { PaymentMethod } from "../../db/types";
import { validatePaymentForm } from "./paymentForm";
import Sheet from "./Sheet";
import { dayScreenStrings } from "./strings";
import type { UndoAction } from "./undoAction";

interface PaymentSheetProps {
  invoiceId: string;
  onDismiss: () => void;
  onRecorded: (undo: UndoAction) => void;
}

const METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: PaymentMethod.Cash, label: dayScreenStrings.paymentMethodCash },
  { value: PaymentMethod.Card, label: dayScreenStrings.paymentMethodCard },
  { value: PaymentMethod.Wallet, label: dayScreenStrings.paymentMethodWallet },
  { value: PaymentMethod.Transfer, label: dayScreenStrings.paymentMethodTransfer },
];

function pillClassName(isSelected: boolean): string {
  return isSelected
    ? "rounded-full border border-green bg-green-soft px-3 py-1 text-sm"
    : "rounded-full border border-line px-3 py-1 text-sm";
}

/**
 * The compact "تسجيل دفعة" prompt: amount, method, an optional note. Reads
 * the invoice itself live (rather than taking one as a prop) so the
 * remaining-balance validation always reflects the invoice's current state,
 * not a snapshot that could go stale while this sheet is open.
 */
export default function PaymentSheet({ invoiceId, onDismiss, onRecorded }: PaymentSheetProps) {
  const [amountInput, setAmountInput] = useState("");
  const [method, setMethod] = useState<PaymentMethod>(PaymentMethod.Cash);
  const [note, setNote] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const invoice = useLiveQuery(() => db.invoices.get(invoiceId), [invoiceId]);

  if (!invoice) {
    return (
      <Sheet onDismiss={onDismiss}>
        <p className="text-muted">جارٍ التحميل...</p>
      </Sheet>
    );
  }

  const remaining = (invoice.total - invoice.paid) as Piastres;

  async function handleConfirm() {
    const validation = validatePaymentForm({ amountInput }, remaining);
    if (!validation.ok) {
      setAmountError(validation.amountError);
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await recordPayment(db, {
        invoiceId,
        amount: validation.amount,
        method,
        note: note.trim() ? note.trim() : null,
      });
      if (!result.ok) {
        setAmountError(dayScreenStrings.paymentAmountExceedsRemainingError);
        return;
      }
      onRecorded({
        kind: "payment",
        paymentAuditLogId: result.paymentAuditLogId,
        invoiceAuditLogId: result.invoiceAuditLogId,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Sheet onDismiss={onDismiss}>
      <p className="font-medium">{dayScreenStrings.paymentSheetTitle}</p>
      <p className="mt-1 text-sm text-muted">
        {dayScreenStrings.invoiceRemainingLabel}: {formatPiastresForDisplay(remaining)}
      </p>

      <div className="mt-4">
        <input
          type="text"
          inputMode="decimal"
          value={amountInput}
          onChange={(event) => {
            setAmountInput(event.target.value);
            setAmountError(null);
          }}
          placeholder={dayScreenStrings.paymentAmountPlaceholder}
          className="w-full rounded-[--radius-el] border border-line bg-paper px-3 py-2 text-start"
        />
        {amountError && <p className="mt-1 text-sm text-red">{amountError}</p>}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {METHOD_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setMethod(option.value)}
            className={pillClassName(method === option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>

      <input
        type="text"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder={dayScreenStrings.paymentNotePlaceholder}
        className="mt-3 w-full rounded-[--radius-el] border border-line bg-paper px-3 py-2 text-start"
      />

      <button
        type="button"
        disabled={isSubmitting}
        onClick={handleConfirm}
        className="mt-4 rounded-[--radius-el] bg-green px-4 py-3 text-center font-semibold text-paper disabled:opacity-60"
      >
        {dayScreenStrings.paymentConfirmButton}
      </button>
    </Sheet>
  );
}

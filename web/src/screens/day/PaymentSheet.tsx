import { useState } from "react";
import Ltr from "../../components/Ltr";
import Field, { TextInput } from "../../components/ui/Field";
import Button from "../../components/ui/Button";
import { SheetPanelBody, SheetPanelFoot } from "../../components/ui/SheetPanel";
import ToggleGroup from "../../components/ui/ToggleGroup";
import { db } from "../../db/database";
import { useLiveQuery } from "../../db/useLiveQuery";
import { type Piastres } from "../../domain/money";
import { formatMoneyAmount } from "../money";
import { recordPayment } from "../../db/payments";
import { PaymentMethod, type Invoice, type Patient } from "../../db/types";
import { formatInvoiceNumber } from "./invoiceNumber";
import { validatePaymentForm } from "./paymentForm";
import Sheet from "./Sheet";
import SheetHeader from "./SheetHeader";
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

interface PaymentData {
  invoice: Invoice;
  patient: Patient | undefined;
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

  const data = useLiveQuery<PaymentData | null>(async () => {
    const invoice = await db.invoices.get(invoiceId);
    if (!invoice) {
      return null;
    }
    const patient = await db.patients.get(invoice.patient_id);
    return { invoice, patient };
  }, [invoiceId]);

  if (!data) {
    return (
      <Sheet onDismiss={onDismiss}>
        <SheetPanelBody>
          <p className="text-muted">جارٍ التحميل...</p>
        </SheetPanelBody>
      </Sheet>
    );
  }

  const { invoice, patient } = data;
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
      <SheetHeader
        title={`${dayScreenStrings.paymentSheetTitle} · ${dayScreenStrings.paymentSheetInvoiceConnector} ${formatInvoiceNumber(invoice)}`}
        onDismiss={onDismiss}
      />

      <SheetPanelBody>
        {/* `.pt-summary`, bled to the body's own edges per the reference's
            inline override on this screen (`margin:-18px -20px 0`) — the
            body's own px-5/py-[18px] match that 20px/18px exactly. */}
        <div className="-mx-5 -mt-[18px] flex flex-wrap items-center gap-[14px] border-b border-copper-line bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-copper)_10%,var(--color-card))_0%,var(--color-card)_100%)] px-5 py-4">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-card bg-[linear-gradient(135deg,var(--color-copper)_0%,var(--color-copper-2)_100%)] text-[17px] font-bold text-white">
            {patient?.full_name.charAt(0) ?? ""}
          </span>
          <div className="min-w-[180px] flex-1">
            <p className="text-base font-bold tracking-[-0.01em] text-text">{patient?.full_name ?? ""}</p>
            <p className="mt-px text-[11.5px] text-muted">
              {dayScreenStrings.invoiceRemainingLabel}{" "}
              <b className="font-bold text-warning">
                <Ltr>{formatMoneyAmount(remaining)}</Ltr> {dayScreenStrings.tileCurrencyUnit}
              </b>{" "}
              {dayScreenStrings.slabTotalCaptionPrefix} <Ltr>{formatMoneyAmount(invoice.total)}</Ltr>{" "}
              {dayScreenStrings.tileCurrencyUnit}
            </p>
          </div>
        </div>

        <Field label={dayScreenStrings.paymentAmountPlaceholder} id="payment-amount" hint={dayScreenStrings.paymentAmountHint} error={amountError ?? undefined}>
          <TextInput
            variant="amount"
            inputMode="decimal"
            value={amountInput}
            onChange={(event) => {
              setAmountInput(event.target.value);
              setAmountError(null);
            }}
          />
        </Field>

        <div className="flex flex-col gap-[5px]">
          <label className="text-[11px] font-bold tracking-[0.02em] text-muted">{dayScreenStrings.paymentMethodLabel}</label>
          <ToggleGroup
            variant="service"
            label={dayScreenStrings.paymentMethodLabel}
            value={method}
            onChange={setMethod}
            options={METHOD_OPTIONS}
          />
        </div>

        <Field label={dayScreenStrings.paymentNotePlaceholder} id="payment-note">
          <TextInput
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={dayScreenStrings.paymentNoteExamplePlaceholder}
          />
        </Field>
      </SheetPanelBody>

      <SheetPanelFoot>
        <Button variant="primary" className="flex-1" disabled={isSubmitting} onClick={handleConfirm}>
          {dayScreenStrings.paymentConfirmButton}
        </Button>
      </SheetPanelFoot>
    </Sheet>
  );
}

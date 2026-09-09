import { useEffect, useState } from "react";
import Ltr from "../../components/Ltr";
import { db } from "../../db/database";
import { formatPiastresForDisplay } from "../../domain/money";
import { formatCairoDisplayDate, todayInCairo } from "../../domain/time";
import { useLiveQuery } from "../../db/useLiveQuery";
import { voidInvoice } from "../../db/invoiceVoid";
import { InvoiceStatus, PaymentMethod, type Invoice, type InvoiceItem, type Patient, type Payment, type Practitioner } from "../../db/types";
import Sheet from "./Sheet";
import { dayScreenStrings } from "./strings";

interface InvoiceSheetProps {
  invoiceId: string;
  onDismiss: () => void;
  onRequestPayment: (invoiceId: string) => void;
  onVoided: () => void;
}

interface InvoiceData {
  invoice: Invoice;
  items: InvoiceItem[];
  payments: Payment[];
  patient: Patient | undefined;
  practitioner: Practitioner | undefined;
}

const STATUS_LABEL: Record<string, string> = {
  [InvoiceStatus.Unpaid]: dayScreenStrings.invoiceStatusUnpaid,
  [InvoiceStatus.Partial]: dayScreenStrings.invoiceStatusPartial,
  [InvoiceStatus.Paid]: dayScreenStrings.invoiceStatusPaid,
  [InvoiceStatus.Void]: dayScreenStrings.invoiceStatusVoid,
};

const STATUS_CLASS: Record<string, string> = {
  [InvoiceStatus.Unpaid]: "border-line text-muted",
  [InvoiceStatus.Partial]: "border-amber text-amber",
  [InvoiceStatus.Paid]: "border-green text-green",
  [InvoiceStatus.Void]: "border-red text-red line-through",
};

const METHOD_LABEL: Record<string, string> = {
  [PaymentMethod.Cash]: dayScreenStrings.paymentMethodCash,
  [PaymentMethod.Card]: dayScreenStrings.paymentMethodCard,
  [PaymentMethod.Wallet]: dayScreenStrings.paymentMethodWallet,
  [PaymentMethod.Transfer]: dayScreenStrings.paymentMethodTransfer,
};

type PrintTarget = { kind: "invoice" } | { kind: "receipt"; payment: Payment };

/**
 * A full-height sheet showing one invoice: its items, its totals, its
 * payments so far, and the three actions the specification calls for. Reads
 * everything itself via liveQuery rather than taking pre-fetched data as
 * props, matching how SyncStatusChip is self-contained — the caller only
 * needs to know which invoice to show.
 */
export default function InvoiceSheet({ invoiceId, onDismiss, onRequestPayment, onVoided }: InvoiceSheetProps) {
  const [printTarget, setPrintTarget] = useState<PrintTarget | null>(null);
  const [isVoiding, setIsVoiding] = useState(false);

  useEffect(() => {
    if (!printTarget) {
      return;
    }
    window.print();
    function handleAfterPrint() {
      setPrintTarget(null);
    }
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
  }, [printTarget]);

  const data = useLiveQuery<InvoiceData | null>(async () => {
    const invoice = await db.invoices.get(invoiceId);
    if (!invoice) {
      return null;
    }
    const [items, payments, patient, practitioner] = await Promise.all([
      db.invoice_items.where("invoice_id").equals(invoiceId).toArray(),
      db.payments.where("invoice_id").equals(invoiceId).toArray(),
      db.patients.get(invoice.patient_id),
      db.practitioners.get(invoice.practitioner_id),
    ]);
    return { invoice, items, payments: payments.sort((a, b) => a.created_at.localeCompare(b.created_at)), patient, practitioner };
  }, [invoiceId]);

  if (!data) {
    return (
      <Sheet onDismiss={onDismiss}>
        <p className="text-muted">جارٍ التحميل...</p>
      </Sheet>
    );
  }

  const { invoice, items, payments, patient, practitioner } = data;
  const remaining = (invoice.total - invoice.paid) as typeof invoice.total;
  const canRecordPayment = invoice.status === InvoiceStatus.Unpaid || invoice.status === InvoiceStatus.Partial;
  const hasPayments = payments.length > 0;

  async function handleVoid() {
    setIsVoiding(true);
    try {
      const result = await voidInvoice(db, invoiceId);
      if (result.ok) {
        onVoided();
      }
    } finally {
      setIsVoiding(false);
    }
  }

  return (
    <>
      <div className="print:hidden">
        <Sheet onDismiss={onDismiss}>
          <p className="text-xs text-muted">{dayScreenStrings.printHeaderPlaceholder}</p>
          <div className="mt-2 flex items-center justify-between">
            <p className="font-medium">
              {dayScreenStrings.invoiceNumberLabel} <Ltr>{invoice.number}</Ltr>
            </p>
            <span className={`rounded-full border px-2 py-0.5 text-sm ${STATUS_CLASS[invoice.status]}`}>
              {STATUS_LABEL[invoice.status]}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted">
            {dayScreenStrings.invoicePatientLabel}: {patient?.full_name ?? ""}
          </p>
          <p className="text-sm text-muted">
            {dayScreenStrings.invoicePractitionerLabel}: {practitioner?.full_name ?? ""}
          </p>
          <p className="text-sm text-muted">
            {dayScreenStrings.invoiceDateLabel}: {formatCairoDisplayDate(todayInCairo(new Date(invoice.issued_at)))}
          </p>

          <div className="mt-4 flex flex-col gap-2 overflow-y-auto">
            {items.map((item) => (
              <div key={item.id} className="rounded-[--radius-el] border border-line p-3">
                <p>{item.description}</p>
                <p className="mt-1 flex justify-between text-sm text-muted">
                  <span>
                    {dayScreenStrings.invoiceItemQtyLabel}: <Ltr>{item.qty}</Ltr>
                  </span>
                  <span>
                    {dayScreenStrings.invoiceItemUnitPriceLabel}: <Ltr>{formatPiastresForDisplay(item.unit_price)}</Ltr>
                  </span>
                  <span>
                    {dayScreenStrings.invoiceItemTotalLabel}: <Ltr>{formatPiastresForDisplay(item.total)}</Ltr>
                  </span>
                </p>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-col gap-1 border-t border-line pt-3">
            <p className="flex justify-between">
              <span>{dayScreenStrings.invoiceTotalLabel}</span>
              <Ltr>{formatPiastresForDisplay(invoice.total)}</Ltr>
            </p>
            <p className="flex justify-between text-muted">
              <span>{dayScreenStrings.invoicePaidLabel}</span>
              <Ltr>{formatPiastresForDisplay(invoice.paid)}</Ltr>
            </p>
            <p className="flex justify-between font-medium">
              <span>{dayScreenStrings.invoiceRemainingLabel}</span>
              <Ltr>{formatPiastresForDisplay(remaining)}</Ltr>
            </p>
          </div>

          {hasPayments && (
            <div className="mt-4 flex flex-col gap-2 border-t border-line pt-3">
              <p className="text-sm font-medium">{dayScreenStrings.paymentsListHeading}</p>
              {payments.map((payment) => (
                <div key={payment.id} className="flex items-center justify-between text-sm">
                  <span className="text-muted">
                    {dayScreenStrings.paymentReceiptNumberPrefix} <Ltr>{payment.receipt_number}</Ltr> —{" "}
                    {METHOD_LABEL[payment.method]}
                  </span>
                  <span className="flex items-center gap-2">
                    <Ltr>{formatPiastresForDisplay(payment.amount)}</Ltr>
                    <button
                      type="button"
                      onClick={() => setPrintTarget({ kind: "receipt", payment })}
                      className="text-green"
                    >
                      {dayScreenStrings.printReceiptAction}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex flex-col gap-2">
            {canRecordPayment && (
              <button
                type="button"
                onClick={() => onRequestPayment(invoiceId)}
                className="rounded-[--radius-el] bg-green px-4 py-3 text-center font-semibold text-paper"
              >
                {dayScreenStrings.recordPaymentAction}
              </button>
            )}
            <button
              type="button"
              onClick={() => setPrintTarget({ kind: "invoice" })}
              className="rounded-[--radius-el] border border-line px-4 py-3 text-center text-muted"
            >
              {dayScreenStrings.printInvoiceAction}
            </button>
          </div>

          <div className="mt-6 border-t border-line pt-3">
            <button
              type="button"
              disabled={hasPayments || isVoiding || invoice.status === InvoiceStatus.Void}
              onClick={handleVoid}
              className="w-full rounded-[--radius-el] border border-red px-4 py-3 text-center text-red disabled:opacity-50"
            >
              {dayScreenStrings.voidInvoiceAction}
            </button>
            {hasPayments && (
              <p className="mt-1 text-center text-sm text-muted">{dayScreenStrings.voidInvoiceDisabledReason}</p>
            )}
          </div>
        </Sheet>
      </div>

      {printTarget?.kind === "invoice" && (
        <div className="hidden print:block">
          <p className="text-center font-semibold">{dayScreenStrings.printHeaderWarning}</p>
          <h2 className="mt-4 text-center text-lg font-semibold">{dayScreenStrings.printInvoiceTitle}</h2>
          <p className="mt-2">
            {dayScreenStrings.invoiceNumberLabel}: {invoice.number}
          </p>
          <p>
            {dayScreenStrings.invoicePatientLabel}: {patient?.full_name ?? ""}
          </p>
          <p>
            {dayScreenStrings.invoicePractitionerLabel}: {practitioner?.full_name ?? ""}
          </p>
          <p>
            {dayScreenStrings.invoiceDateLabel}: {formatCairoDisplayDate(todayInCairo(new Date(invoice.issued_at)))}
          </p>
          <table className="mt-4 w-full">
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.description}</td>
                  <td>{item.qty}</td>
                  <td>{formatPiastresForDisplay(item.unit_price)}</td>
                  <td>{formatPiastresForDisplay(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4">
            {dayScreenStrings.invoiceTotalLabel}: {formatPiastresForDisplay(invoice.total)}
          </p>
          <p>
            {dayScreenStrings.invoicePaidLabel}: {formatPiastresForDisplay(invoice.paid)}
          </p>
          <p>
            {dayScreenStrings.invoiceRemainingLabel}: {formatPiastresForDisplay(remaining)}
          </p>
        </div>
      )}

      {printTarget?.kind === "receipt" && (
        <div className="hidden print:block">
          <p className="text-center font-semibold">{dayScreenStrings.printHeaderWarning}</p>
          <h2 className="mt-4 text-center text-lg font-semibold">{dayScreenStrings.printReceiptTitle}</h2>
          <p className="mt-2">
            {dayScreenStrings.paymentReceiptNumberPrefix} {printTarget.payment.receipt_number}
          </p>
          <p>
            {dayScreenStrings.invoiceNumberLabel}: {invoice.number}
          </p>
          <p>
            {dayScreenStrings.invoicePatientLabel}: {patient?.full_name ?? ""}
          </p>
          <p>{formatPiastresForDisplay(printTarget.payment.amount)}</p>
          <p>{METHOD_LABEL[printTarget.payment.method]}</p>
          <p>{formatCairoDisplayDate(todayInCairo(new Date(printTarget.payment.created_at)))}</p>
          {printTarget.payment.note && <p>{printTarget.payment.note}</p>}
        </div>
      )}
    </>
  );
}

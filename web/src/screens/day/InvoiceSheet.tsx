import { useEffect, useState } from "react";
import Ltr from "../../components/Ltr";
import { db } from "../../db/database";
import { formatPiastresForDisplay } from "../../domain/money";
import { formatCairoDisplayDate, todayInCairo } from "../../domain/time";
import { useLiveQuery } from "../../db/useLiveQuery";
import { voidInvoice } from "../../db/invoiceVoid";
import { InvoiceStatus, PaymentMethod, type Invoice, type InvoiceItem, type Patient, type Payment, type Practitioner } from "../../db/types";
import Sheet from "./Sheet";
import SheetHeader from "./SheetHeader";
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

// The reference's filled tag-pill language: paid = .tg.a (green), partial =
// .tg.c (amber), unpaid = .tg.e (neutral), void = .tg.b (red).
const STATUS_PILL_CLASS: Record<string, string> = {
  [InvoiceStatus.Unpaid]: "bg-line-soft text-muted",
  [InvoiceStatus.Partial]: "bg-amber-soft text-amber",
  [InvoiceStatus.Paid]: "bg-green-soft text-green",
  [InvoiceStatus.Void]: "bg-red-soft text-red line-through",
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
  const remainingRowClassName = `flex justify-between border-t border-line-soft px-3 py-2 font-medium ${
    remaining > 0 ? "bg-amber-soft text-amber" : ""
  }`;

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
          <SheetHeader
            title={
              <>
                {dayScreenStrings.invoiceNumberLabel} <Ltr>{invoice.number}</Ltr>
              </>
            }
            onDismiss={onDismiss}
            extra={
              <>
                <span className={`rounded-[5px] px-2 py-0.5 text-xs ${STATUS_PILL_CLASS[invoice.status]}`}>
                  {STATUS_LABEL[invoice.status]}
                </span>
                {canRecordPayment && (
                  <button
                    type="button"
                    onClick={() => onRequestPayment(invoiceId)}
                    className="rounded-[5px] bg-line-soft px-2 py-0.5 text-xs text-muted hover:bg-green-soft hover:text-green"
                  >
                    {dayScreenStrings.recordPaymentAction}
                  </button>
                )}
              </>
            }
          />
          <p className="mt-2 text-xs text-muted">{dayScreenStrings.printHeaderPlaceholder}</p>
          <p className="mt-2 text-sm text-muted">
            {dayScreenStrings.invoicePatientLabel}: {patient?.full_name ?? ""}
          </p>
          <p className="text-sm text-muted">
            {dayScreenStrings.invoicePractitionerLabel}: {practitioner?.full_name ?? ""}
          </p>
          <p className="text-sm text-muted">
            {dayScreenStrings.invoiceDateLabel}: {formatCairoDisplayDate(todayInCairo(new Date(invoice.issued_at)))}
          </p>

          <div className="mt-4 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="border-b border-line px-2 py-1.5 text-start text-xs font-medium text-muted">
                    {dayScreenStrings.invoiceItemLabel}
                  </th>
                  <th className="border-b border-line px-2 py-1.5 text-start text-xs font-medium text-muted">
                    {dayScreenStrings.invoiceItemQtyLabel}
                  </th>
                  <th className="border-b border-line px-2 py-1.5 text-start text-xs font-medium text-muted">
                    {dayScreenStrings.invoiceItemUnitPriceLabel}
                  </th>
                  <th className="border-b border-line px-2 py-1.5 text-start text-xs font-medium text-muted">
                    {dayScreenStrings.invoiceItemTotalLabel}
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="border-b border-line-soft px-2 py-2">{item.description}</td>
                    <td className="border-b border-line-soft px-2 py-2">
                      <Ltr>{item.qty}</Ltr>
                    </td>
                    <td className="border-b border-line-soft px-2 py-2">
                      <Ltr>{formatPiastresForDisplay(item.unit_price)}</Ltr>
                    </td>
                    <td className="border-b border-line-soft px-2 py-2">
                      <Ltr>{formatPiastresForDisplay(item.total)}</Ltr>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-col overflow-hidden rounded-[--radius-el] border border-line">
            <p className="flex justify-between bg-line-soft px-3 py-2 font-medium">
              <span>{dayScreenStrings.invoiceTotalLabel}</span>
              <Ltr>{formatPiastresForDisplay(invoice.total)}</Ltr>
            </p>
            <p className="flex justify-between border-t border-line-soft px-3 py-2 text-muted">
              <span>{dayScreenStrings.invoicePaidLabel}</span>
              <Ltr>{formatPiastresForDisplay(invoice.paid)}</Ltr>
            </p>
            <p className={remainingRowClassName}>
              <span>{dayScreenStrings.invoiceRemainingLabel}</span>
              <Ltr>{formatPiastresForDisplay(remaining)}</Ltr>
            </p>
          </div>

          {hasPayments && (
            <div className="mt-4 border-t border-line pt-3">
              <p className="mb-1 text-sm font-medium">{dayScreenStrings.paymentsListHeading}</p>
              <div className="flex flex-col divide-y divide-line-soft">
                {payments.map((payment) => (
                  <div key={payment.id} className="flex items-center justify-between py-2 text-sm">
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
            </div>
          )}

          <div className="mt-4">
            <button
              type="button"
              onClick={() => setPrintTarget({ kind: "invoice" })}
              className="w-full rounded-[--radius-el] border border-line px-4 py-3 text-center text-ink"
            >
              {dayScreenStrings.printInvoiceAction}
            </button>
          </div>

          <div className="mt-6 border-t border-line pt-3">
            <button
              type="button"
              disabled={hasPayments || isVoiding || invoice.status === InvoiceStatus.Void}
              onClick={handleVoid}
              className="w-full rounded-[--radius-el] border border-red bg-paper px-4 py-3 text-center text-red disabled:opacity-50"
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
          <p className="mt-4 text-center text-sm text-muted">{dayScreenStrings.paymentReceiptNumberPrefix}</p>
          <h2 className="text-center text-2xl font-semibold">{printTarget.payment.receipt_number}</h2>
          <p className="mt-6 text-center text-4xl font-semibold">
            {formatPiastresForDisplay(printTarget.payment.amount)}
          </p>
          <div className="mt-6 flex flex-col gap-1 text-sm">
            <p className="flex justify-between">
              <span className="text-muted">{dayScreenStrings.invoiceNumberLabel}</span>
              <span>{invoice.number}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-muted">{dayScreenStrings.invoicePatientLabel}</span>
              <span>{patient?.full_name ?? ""}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-muted">{dayScreenStrings.paymentMethodLabel}</span>
              <span>{METHOD_LABEL[printTarget.payment.method]}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-muted">{dayScreenStrings.invoiceDateLabel}</span>
              <span>{formatCairoDisplayDate(todayInCairo(new Date(printTarget.payment.created_at)))}</span>
            </p>
            {printTarget.payment.note && (
              <p className="flex justify-between">
                <span className="text-muted">{dayScreenStrings.paymentNotePlaceholder}</span>
                <span>{printTarget.payment.note}</span>
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}

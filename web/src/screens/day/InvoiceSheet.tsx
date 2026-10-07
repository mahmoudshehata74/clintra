import { useEffect, useState } from "react";
import Ltr from "../../components/Ltr";
import Badge, { type BadgeTone } from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import { CardFooter } from "../../components/ui/Card";
import { SheetPanelCloseButton } from "../../components/ui/SheetPanel";
import { db } from "../../db/database";
import { formatMoneyAmount } from "../money";
import { clockTimeInCairo, formatCairoDisplayDate, todayInCairo } from "../../domain/time";
import { useLiveQuery } from "../../db/useLiveQuery";
import { voidInvoice } from "../../db/invoiceVoid";
import { InvoiceStatus, PaymentMethod, type Invoice, type InvoiceItem, type Patient, type Payment, type Practitioner } from "../../db/types";
import { formatInvoiceNumber, formatReceiptNumber } from "./invoiceNumber";
import Sheet from "./Sheet";
import { dayScreenStrings } from "./strings";

interface InvoiceSheetProps {
  invoiceId: string;
  /** More than one practitioner is visible today — the head names this one only then. */
  showPractitionerName: boolean;
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

// `.inv-status` (unpaid/partial) / `.inv-status.paid` (paid) reproduced via
// the shared Badge: both soft+warning. Paid is "eligible" per
// docs/design-tokens.md's own "done, arrived, paid, matched" entry for that
// token, but Badge has no soft+eligible look (design-tokens.md defines no
// eligible-wash/eligible-line pair) — solid+eligible is the closest its
// existing API offers, a deliberate deviation from `.inv-status.paid`'s own
// tinted look rather than a new token pair invented for this one spot. Void
// has no reference class at all; danger (this app's own tone for a
// cancelled/nullified record elsewhere — VisitMenu.tsx's cancel/no-show)
// plus the line-through the pre-restyle version already used.
const STATUS_BADGE: Record<string, { appearance: "soft"; tone: Exclude<BadgeTone, "eligible"> } | { appearance: "solid"; tone: BadgeTone }> = {
  [InvoiceStatus.Unpaid]: { appearance: "soft", tone: "warning" },
  [InvoiceStatus.Partial]: { appearance: "soft", tone: "warning" },
  [InvoiceStatus.Paid]: { appearance: "solid", tone: "eligible" },
  [InvoiceStatus.Void]: { appearance: "soft", tone: "danger" },
};

const METHOD_LABEL: Record<string, string> = {
  [PaymentMethod.Cash]: dayScreenStrings.paymentMethodCash,
  [PaymentMethod.Card]: dayScreenStrings.paymentMethodCard,
  [PaymentMethod.Wallet]: dayScreenStrings.paymentMethodWallet,
  [PaymentMethod.Transfer]: dayScreenStrings.paymentMethodTransfer,
};

type PrintTarget = { kind: "invoice" } | { kind: "receipt"; payment: Payment };

const CURRENCY_UNIT = dayScreenStrings.tileCurrencyUnit;

/**
 * A full-height sheet showing one invoice: its items, its totals, its
 * payments so far, and the three actions the specification calls for. Reads
 * everything itself via liveQuery rather than taking pre-fetched data as
 * props, matching how SyncStatusChip is self-contained — the caller only
 * needs to know which invoice to show.
 */
export default function InvoiceSheet({ invoiceId, showPractitionerName, onDismiss, onRequestPayment, onVoided }: InvoiceSheetProps) {
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
      <Sheet onDismiss={onDismiss} size="lg">
        <p className="p-[18px] text-muted">جارٍ التحميل...</p>
      </Sheet>
    );
  }

  const { invoice, items, payments, patient, practitioner } = data;
  const remaining = (invoice.total - invoice.paid) as typeof invoice.total;
  const hasRemaining = remaining > 0;
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
        <Sheet onDismiss={onDismiss} size="lg">
          {/* `.inv-head` */}
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 bg-[linear-gradient(135deg,var(--color-ink)_0%,var(--color-ink-2)_100%)] px-[18px] py-[14px] text-on-dark">
            <span className="font-mono text-sm font-bold tracking-[0.02em] text-on-dark tabular-nums">
              <Ltr>{formatInvoiceNumber(invoice)}</Ltr>
            </span>
            <Badge {...STATUS_BADGE[invoice.status]} className={invoice.status === InvoiceStatus.Void ? "line-through" : undefined}>
              {STATUS_LABEL[invoice.status]}
            </Badge>
            <div className="me-auto border-s border-white/[0.14] ps-[14px]">
              <p className="text-[13px] font-semibold text-on-dark">{patient?.full_name ?? ""}</p>
              <p className="-mt-px text-[11px] text-on-dark-dim">
                {showPractitionerName && practitioner ? `${practitioner.full_name} · ` : ""}
                {formatCairoDisplayDate(todayInCairo(new Date(invoice.issued_at)))}
              </p>
            </div>
            <Button variant="onDark" size="sm" onClick={() => setPrintTarget({ kind: "invoice" })}>
              {dayScreenStrings.printInvoiceAction}
            </Button>
            <SheetPanelCloseButton onClose={onDismiss} closeLabel={dayScreenStrings.sheetCloseAriaLabel} />
          </div>

          {/* `.inv-body` */}
          <div className="flex flex-col gap-[14px] p-[18px]">
            <p className="text-xs text-muted">{dayScreenStrings.printHeaderPlaceholder}</p>

            <table className="w-full border-separate border-spacing-0 tabular-nums">
              <thead>
                <tr>
                  <th className="border-b-[1.5px] border-rule bg-field px-3 py-[9px] text-start text-[11px] font-bold uppercase tracking-[0.05em] text-muted">
                    {dayScreenStrings.invoiceItemLabel}
                  </th>
                  <th className="border-b-[1.5px] border-rule bg-field px-3 py-[9px] text-start text-[11px] font-bold uppercase tracking-[0.05em] text-muted">
                    {dayScreenStrings.invoiceItemQtyLabel}
                  </th>
                  <th className="border-b-[1.5px] border-rule bg-field px-3 py-[9px] text-end text-[11px] font-bold uppercase tracking-[0.05em] text-muted">
                    {dayScreenStrings.invoiceItemUnitPriceLabel}
                  </th>
                  <th className="border-b-[1.5px] border-rule bg-field px-3 py-[9px] text-end text-[11px] font-bold uppercase tracking-[0.05em] text-muted">
                    {dayScreenStrings.invoiceItemTotalLabel}
                  </th>
                </tr>
              </thead>
              <tbody className="[&>tr:last-child>td]:border-b-0">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="border-b border-hair px-3 py-[9px] text-[13px] font-semibold text-text">{item.description}</td>
                    <td className="border-b border-hair px-3 py-[9px] text-[13px] font-semibold text-text">
                      <Ltr>{item.qty}</Ltr>
                    </td>
                    <td className="border-b border-hair px-3 py-[9px] text-end text-[13px] font-bold text-text">
                      <Ltr>{formatMoneyAmount(item.unit_price)}</Ltr>
                    </td>
                    <td className="border-b border-hair px-3 py-[9px] text-end text-[13px] font-bold text-text">
                      <Ltr>{formatMoneyAmount(item.total)}</Ltr>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* `.totals` */}
            <div className="flex flex-col gap-2 rounded-card border border-rule bg-field px-4 py-[14px]">
              <div className="flex items-center justify-between text-[13.5px]">
                <span className="font-semibold text-muted">{dayScreenStrings.invoiceTotalLabel}</span>
                <span className="font-bold tabular-nums tracking-[-0.01em] text-text">
                  <Ltr>{formatMoneyAmount(invoice.total)}</Ltr> {CURRENCY_UNIT}
                </span>
              </div>
              <div className="flex items-center justify-between text-[13.5px]">
                <span className="font-semibold text-muted">{dayScreenStrings.invoicePaidLabel}</span>
                <span className="font-bold tabular-nums tracking-[-0.01em] text-text">
                  <Ltr>{formatMoneyAmount(invoice.paid)}</Ltr> {CURRENCY_UNIT}
                </span>
              </div>
              {/* .row.remain.grand: the grand row's own 15px/20px/pt-2-border-top
                  emphasis, but remain's warning color wins over grand's copper
                  for the value itself (same specificity, remain declared
                  later) — reproduced as rendered, not as each class reads
                  alone. Shown only while something is actually owed — the
                  existing behaviour this replaces (amber only when
                  remaining > 0) kept exactly, just restyled. */}
              <div className={`flex items-center justify-between text-[13.5px] ${hasRemaining ? "border-t border-rule pt-2 text-[15px]" : ""}`}>
                <span className="font-semibold text-muted">{dayScreenStrings.invoiceRemainingLabel}</span>
                {hasRemaining ? (
                  <span className="text-xl font-bold tabular-nums tracking-[-0.01em] text-warning">
                    <Ltr>{formatMoneyAmount(remaining)}</Ltr>
                    <i className="ms-1 text-xs font-normal not-italic text-copper-2">{CURRENCY_UNIT}</i>
                  </span>
                ) : (
                  <span className="font-bold tabular-nums tracking-[-0.01em] text-text">
                    <Ltr>{formatMoneyAmount(remaining)}</Ltr> {CURRENCY_UNIT}
                  </span>
                )}
              </div>
            </div>

            {hasPayments && (
              <div>
                <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.05em] text-muted">{dayScreenStrings.paymentsListHeading}</p>
                <div className="flex flex-col gap-[6px]">
                  {payments.map((payment) => (
                    <div key={payment.id} className="flex flex-wrap items-center gap-3 rounded-card border border-rule bg-card px-[13px] py-[10px]">
                      <span className="me-auto text-[14.5px] font-bold tabular-nums text-eligible">
                        <Ltr>{formatMoneyAmount(payment.amount)}</Ltr> {CURRENCY_UNIT}
                      </span>
                      <span className="rounded-chip border border-rule bg-field px-[9px] py-[3px] text-[11.5px] font-semibold text-muted">
                        {METHOD_LABEL[payment.method]}
                      </span>
                      <span className="font-mono text-[11px] tabular-nums text-faint">
                        <Ltr>{formatReceiptNumber(payment.receipt_number)}</Ltr> · <Ltr>{clockTimeInCairo(payment.created_at)}</Ltr>
                      </span>
                      <button
                        type="button"
                        onClick={() => setPrintTarget({ kind: "receipt", payment })}
                        className="text-[11.5px] font-semibold text-green"
                      >
                        {dayScreenStrings.printReceiptAction}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {canRecordPayment && (
            <CardFooter>
              <Button variant="primary" onClick={() => onRequestPayment(invoiceId)}>
                {dayScreenStrings.recordPaymentAction} ({formatMoneyAmount(remaining)} {CURRENCY_UNIT})
              </Button>
            </CardFooter>
          )}

          {/* Voiding stays visually separate from the daily actions above. */}
          <div className="border-t border-hair px-[18px] py-[14px]">
            <Button
              variant="danger"
              disabled={hasPayments || isVoiding || invoice.status === InvoiceStatus.Void}
              onClick={handleVoid}
            >
              {dayScreenStrings.voidInvoiceAction}
            </Button>
            {hasPayments && <p className="mt-1 text-sm text-muted">{dayScreenStrings.voidInvoiceDisabledReason}</p>}
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
                  <td>{formatMoneyAmount(item.unit_price)}</td>
                  <td>{formatMoneyAmount(item.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4">
            {dayScreenStrings.invoiceTotalLabel}: {formatMoneyAmount(invoice.total)}
          </p>
          <p>
            {dayScreenStrings.invoicePaidLabel}: {formatMoneyAmount(invoice.paid)}
          </p>
          <p>
            {dayScreenStrings.invoiceRemainingLabel}: {formatMoneyAmount(remaining)}
          </p>
        </div>
      )}

      {printTarget?.kind === "receipt" && (
        <div className="hidden print:block">
          <p className="text-center font-semibold">{dayScreenStrings.printHeaderWarning}</p>
          <p className="mt-4 text-center text-sm text-muted">{dayScreenStrings.paymentReceiptNumberPrefix}</p>
          <h2 className="text-center text-2xl font-semibold">{printTarget.payment.receipt_number}</h2>
          <p className="mt-6 text-center text-4xl font-semibold">
            {formatMoneyAmount(printTarget.payment.amount)}
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

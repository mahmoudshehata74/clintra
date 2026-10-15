import Dexie from "dexie";
import { useEffect, useState, type ReactNode } from "react";
import Ltr from "../../components/Ltr";
import { db } from "../../db/database";
import { useLiveQuery } from "../../db/useLiveQuery";
import type { Piastres } from "../../domain/money";
import type { ClinicDay } from "../../domain/time";
import { formatMoneyAmount } from "../money";
import { buildDayCloseSummary, type DayCloseSummarySource } from "./dayCloseSummary";
import { PrintClinicBlock, PrintDayLine, PrintFoot, PrintPage, PrintTable, PrintTd } from "./PrintPage";
import { dayScreenStrings } from "./strings";
import { usePrintClinic } from "./usePrintClinic";
import { staffName } from "../../domain/staffName";

interface DayCloseSummaryPrintProps {
  orgId: string;
  locationId: string;
  date: ClinicDay;
  /** Called once the print dialog has closed. */
  onDone: () => void;
}

const CURRENCY_UNIT = dayScreenStrings.tileCurrencyUnit;

function Money({ value }: { value: Piastres }) {
  return (
    <>
      <Ltr>{formatMoneyAmount(value)}</Ltr> {CURRENCY_UNIT}
    </>
  );
}

function Row({ label, children, strong = false }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <tr>
      <PrintTd>{label}</PrintTd>
      <PrintTd>{strong ? <b className="font-bold">{children}</b> : children}</PrintTd>
    </tr>
  );
}

/**
 * The printed summary of a closed day (screen 7's "اقفل اليوم واطبع الملخص",
 * and its reprint from the closed state): one A4 page in the shared print
 * language (PrintPage, `.print-clinic`, `.print-day`, `.print-tbl`,
 * `.print-foot`), laid out on the named `@page day-close` (index.css). Reads
 * the location's close for the day itself, and prints once it has it; a day
 * without a close prints nothing.
 */
export default function DayCloseSummaryPrint({ orgId, locationId, date, onDone }: DayCloseSummaryPrintProps) {
  const [printedAt] = useState(() => new Date().toISOString());
  const clinic = usePrintClinic(locationId);
  const source = useLiveQuery<DayCloseSummarySource | null>(async () => {
    const cashClose = await db.cash_close.where("[location_id+date]").equals([locationId, date]).first();
    if (!cashClose) {
      return null;
    }
    const [visits, invoices, membership] = await Promise.all([
      db.visits
        .where("[org_id+location_id+visit_date+status]")
        .between([orgId, locationId, date, Dexie.minKey], [orgId, locationId, date, Dexie.maxKey])
        .toArray(),
      db.invoices.where("location_id").equals(locationId).toArray(),
      db.memberships.get(cashClose.closed_by),
    ]);
    const invoiceIds = invoices.map((invoice) => invoice.id);
    const [payments, user] = await Promise.all([
      invoiceIds.length > 0 ? db.payments.where("invoice_id").anyOf(invoiceIds).toArray() : Promise.resolve([]),
      membership ? db.users.get(membership.user_id) : Promise.resolve(undefined),
    ]);
    return { date, visits, invoices, payments, cashClose, closedByName: membership ? staffName(membership, user) : null };
  }, [orgId, locationId, date]);

  const isReady = Boolean(source);
  useEffect(() => {
    if (!isReady) {
      return;
    }
    window.print();
    function handleAfterPrint() {
      onDone();
    }
    window.addEventListener("afterprint", handleAfterPrint);
    return () => window.removeEventListener("afterprint", handleAfterPrint);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one print once the close has loaded; the callback's identity must not reprint.
  }, [isReady]);

  if (!source) {
    return null;
  }
  const summary = buildDayCloseSummary(source, printedAt);
  const S = dayScreenStrings;

  return (
    <div className="day-close-print-target hidden print:block">
      <PrintPage>
        <PrintClinicBlock {...clinic} />
        <PrintDayLine>{summary.title}</PrintDayLine>
        <PrintTable>
          <tbody>
            <Row label={S.daySummarySeenLabel}>
              <Ltr>{summary.seenCount}</Ltr>
            </Row>
            <Row label={S.slabNoShowCellLabel}>
              <Ltr>{summary.noShowCount}</Ltr>
            </Row>
            <Row label={S.daySummaryCancelledLabel}>
              <Ltr>{summary.cancelledCount}</Ltr>
            </Row>
            {summary.byMethod.map((line) => (
              <Row key={line.method} label={`${S.daySummaryCollectedByPrefix} ${line.label}`}>
                <Money value={line.amount} />
              </Row>
            ))}
            <Row label={S.daySummaryTotalCollectedLabel} strong>
              <Money value={summary.totalCollected} />
            </Row>
            <Row label={S.daySummaryExpectedCashLabel}>
              <Money value={summary.expected} />
            </Row>
            <Row label={S.cashCloseActualCashFieldLabel}>
              <Money value={summary.counted} />
            </Row>
            <Row label={S.cashCloseDifferenceLabel} strong>
              <Money value={summary.difference} />
              {" · "}
              {summary.differenceNote ?? S.cashCloseNoDifferenceNoteLabel}
            </Row>
            <Row label={S.daySummaryClosedByLabel}>{summary.closedByName ?? S.auditUnknownActor}</Row>
          </tbody>
        </PrintTable>
        <PrintFoot printedAt={summary.printedAt} />
      </PrintPage>
    </div>
  );
}

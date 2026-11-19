import { useState } from "react";
import Ltr from "../../components/Ltr";
import PageMain from "../../components/PageMain";
import Button from "../../components/ui/Button";
import Card, { CardHead } from "../../components/ui/Card";
import Field, { TextInput } from "../../components/ui/Field";
import ToggleGroup from "../../components/ui/ToggleGroup";
import { db } from "../../db/database";
import type { Membership } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import type { Piastres } from "../../domain/money";
import { clockTimeInCairo, todayInCairo, type ClinicDay } from "../../domain/time";
import { formatMoneyAmount } from "../money";
import {
  buildReport,
  defaultRange,
  fixedPractitionerId,
  rangeProblem,
  REPORT_KEYS,
  REPORT_TITLES,
  reportCsv,
  reportFileName,
  type ColumnKind,
  type Report,
  type ReportData,
  type ReportKey,
  type ReportValue,
} from "./reportsModel";
import { reportsStrings as T } from "./strings";

interface ReportsScreenProps {
  /** The member reading: the owner picks a doctor (or all); a doctor's own membership reads only that doctor's rows. */
  membership: Membership;
}

const RANGE_PROBLEM_TEXT = {
  invalid: T.rangeInvalid,
  reversed: T.rangeReversed,
  too_long: T.rangeTooLong,
} as const;

/**
 * The reports page ("التقارير"): a date range (from/to, both included, at
 * most 366 days, this month by default), the owner's doctor filter, the ten
 * reports as chips, and the chosen one's summary figures, table and "تنزيل
 * CSV". Every figure is computed on the device from what it holds
 * (reportsModel.ts). Below 768px the figures wrap two to a row and the table
 * scrolls sideways inside its card.
 */
export default function ReportsScreen({ membership }: ReportsScreenProps) {
  const [initial] = useState(() => defaultRange(todayInCairo()));
  const [from, setFrom] = useState<string>(initial.from);
  const [to, setTo] = useState<string>(initial.to);
  const [chosenDoctorId, setChosenDoctorId] = useState<string>("");
  const [selected, setSelected] = useState<ReportKey>("visits");
  const fixedDoctorId = fixedPractitionerId(membership);
  const practitionerId = fixedDoctorId ?? (chosenDoctorId === "" ? null : chosenDoctorId);
  const problem = rangeProblem(from, to);

  const data = useLiveQuery<ReportData>(async () => {
    const [visits, patients, invoices, invoiceItems, payments, cashCloses, services, practitioners, memberships, users] = await Promise.all([
      db.visits.toArray(),
      db.patients.toArray(),
      db.invoices.toArray(),
      db.invoice_items.toArray(),
      db.payments.toArray(),
      db.cash_close.toArray(),
      db.services.toArray(),
      db.practitioners.toArray(),
      db.memberships.toArray(),
      db.users.toArray(),
    ]);
    return { visits, patients, invoices, invoiceItems, payments, cashCloses, services, practitioners, memberships, users };
  }, []);

  const report =
    data && problem === null ? buildReport(selected, data, { from: from as ClinicDay, to: to as ClinicDay, practitionerId }) : null;
  const doctors = (data?.practitioners ?? []).filter((practitioner) => practitioner.org_id === membership.org_id);

  function download() {
    if (!report) {
      return;
    }
    const blob = new Blob([reportCsv(report)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = reportFileName(report.key, { from, to } as { from: ClinicDay; to: ClinicDay });
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }

  return (
    <PageMain className="flex flex-col gap-3.5 pt-6 pb-16 print:hidden">
      <Card>
        <div className="flex flex-wrap items-start gap-3 p-4">
          <div className="w-[150px]">
            <Field label={T.fromLabel} id="reports-from" error={problem === null ? undefined : RANGE_PROBLEM_TEXT[problem]}>
              <TextInput variant="mono" dir="ltr" inputMode="numeric" placeholder={T.dayPlaceholder} value={from} onChange={(event) => setFrom(event.target.value.trim())} />
            </Field>
          </div>
          <div className="w-[150px]">
            <Field label={T.toLabel} id="reports-to">
              <TextInput variant="mono" dir="ltr" inputMode="numeric" placeholder={T.dayPlaceholder} value={to} onChange={(event) => setTo(event.target.value.trim())} />
            </Field>
          </div>
        </div>
        {fixedDoctorId === null && (
          <div className="flex flex-col gap-[5px] border-t border-rule px-4 py-3">
            <span className="text-[11px] font-bold tracking-[0.02em] text-muted">{T.doctorLabel}</span>
            <ToggleGroup
              variant="filter"
              label={T.doctorLabel}
              value={chosenDoctorId}
              onChange={setChosenDoctorId}
              options={[{ value: "", label: T.allDoctors }, ...doctors.map((doctor) => ({ value: doctor.id, label: doctor.full_name }))]}
            />
          </div>
        )}
        <div className="border-t border-rule px-4 py-3">
          <ToggleGroup
            variant="filter"
            label={T.reportsNavLabel}
            value={selected}
            onChange={setSelected}
            options={REPORT_KEYS.map((key) => ({ value: key, label: REPORT_TITLES[key] }))}
          />
        </div>
      </Card>

      {!data ? (
        <p className="text-muted">{T.loadingLabel}</p>
      ) : report ? (
        <ReportView report={report} onDownload={download} />
      ) : null}
    </PageMain>
  );
}

function ReportView({ report, onDownload }: { report: Report; onDownload: () => void }) {
  return (
    <Card>
      <section aria-label={report.title} data-report={report.key}>
        <CardHead
          title={report.title}
          level={2}
          subtitle={T.rowsCount(report.rows.length)}
          action={
            <Button variant="secondary" size="sm" onClick={onDownload}>
              {T.downloadCsv}
            </Button>
          }
        />
        <dl className="grid grid-cols-2 gap-2 px-4 pt-3 sm:grid-cols-3 lg:grid-cols-4">
          {report.figures.map((figure) => (
            <div key={figure.label} className="rounded-control border border-rule bg-field px-3 py-2" data-report-figure={figure.label}>
              <dt className="text-[11px] font-bold text-muted">{figure.label}</dt>
              <dd className="mt-0.5 text-[17px] font-semibold tabular-nums text-text">
                <Ltr>{figure.kind === "money" ? formatMoneyAmount(figure.value as Piastres) : figure.value}</Ltr>
                {figure.kind === "money" && <span className="ms-1 text-[12px] font-medium text-muted">{T.currencyUnit}</span>}
              </dd>
            </div>
          ))}
        </dl>
        {report.note && <p className="px-4 pt-3 text-[12px] text-muted">{report.note}</p>}
        <div className="p-4">
          {report.rows.length === 0 ? (
            <p className="text-[13px] text-muted">{T.noRows}</p>
          ) : (
            <div className="overflow-x-auto rounded-control border border-rule">
              <table className="w-full border-separate border-spacing-0 tabular-nums">
                <thead>
                  <tr>
                    {report.columns.map((column) => (
                      <th
                        key={column.label}
                        scope="col"
                        className="whitespace-nowrap border-b-[1.5px] border-rule bg-field px-3 py-[9px] text-start text-[11px] font-bold tracking-[0.05em] text-muted"
                      >
                        {column.kind === "money" ? `${column.label} (${T.currencyUnit})` : column.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {row.map((value, index) => (
                        <td key={index} className="whitespace-nowrap border-b border-rule px-3 py-2 text-start text-[12.5px] text-text">
                          <CellValue kind={report.columns[index].kind} value={value} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </Card>
  );
}

/** One cell as the table shows it: days and Cairo times in Latin digits, left to right; money without its unit (the header has it). */
function CellValue({ kind, value }: { kind: ColumnKind; value: ReportValue }) {
  if (value === null) {
    return <span className="text-muted">—</span>;
  }
  switch (kind) {
    case "money":
      return <Ltr>{formatMoneyAmount(value as Piastres)}</Ltr>;
    case "count":
      return <Ltr>{String(value)}</Ltr>;
    case "flag":
      return <>{value ? T.yes : T.no}</>;
    case "day":
      return <Ltr>{String(value)}</Ltr>;
    case "instant": {
      const instant = String(value);
      return <Ltr>{`${todayInCairo(new Date(instant))} ${clockTimeInCairo(instant)}`}</Ltr>;
    }
    default:
      return <>{String(value)}</>;
  }
}

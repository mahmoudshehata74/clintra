import { useState } from "react";
import PageMain from "../../components/PageMain";
import Ltr from "../../components/Ltr";
import SlashDate from "../../components/SlashDate";
import Button from "../../components/ui/Button";
import Card from "../../components/ui/Card";
import Badge from "../../components/ui/Badge";
import Field, { TextInput } from "../../components/ui/Field";
import Switch from "../../components/ui/Switch";
import { db } from "../../db/database";
import { searchPatients } from "../../db/patientSearch";
import { useLiveQuery } from "../../db/useLiveQuery";
import { isArchived } from "../../domain/patientArchive";
import { formatEgyptianPhoneForDisplay } from "../../domain/phone";
import PatientProfile from "./PatientProfile";
import { lastVisitLine } from "./profileModel";
import { patientProfileStrings as T } from "./strings";

/**
 * The patients page (rail item "المرضى"): no reference screen of its own,
 * so tokens and shared components only — a TextInput searching by name or
 * phone (db/patientSearch.ts), the matches as rows (name, local phone, last
 * visit), and the chosen patient's profile (reference screen 18) on the
 * same page with a way back to the results. Archived patients
 * (db/patientArchive.ts) are left out unless "إظهار المؤرشفين" is on, and
 * then read "مؤرشف".
 */
export default function PatientsScreen() {
  const [query, setQuery] = useState("");
  const [patientId, setPatientId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const results = useLiveQuery(() => searchPatients(db, query, { includeArchived: showArchived }), [query, showArchived]);

  if (patientId !== null) {
    return (
      <PageMain className="flex flex-col gap-3.5 pt-6 pb-16 print:hidden">
        <Button variant="secondary" size="sm" data-support-nav className="self-start" onClick={() => setPatientId(null)}>
          {T.backToSearch}
        </Button>
        <Card>
          <PatientProfile patientId={patientId} />
        </Card>
      </PageMain>
    );
  }

  const hasQuery = query.trim() !== "";
  return (
    <PageMain className="flex flex-col gap-3.5 pt-6 pb-16 print:hidden">
      <Card>
        <div className="px-[18px] py-4">
          <Field label={T.searchLabel} id="patient-search" supportNavigation>
            <TextInput
              data-support-nav
              type="text"
              value={query}
              placeholder={T.searchPlaceholder}
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
            />
          </Field>
          <div data-support-write className="mt-3 flex items-center gap-2.5">
            <Switch checked={showArchived} onCheckedChange={setShowArchived} label={T.showArchivedLabel} />
            <span aria-hidden="true" className="text-xs text-muted">
              {T.showArchivedLabel}
            </span>
          </div>
        </div>
        {!hasQuery ? (
          <p className="border-t border-hair px-[18px] py-6 text-center text-xs text-muted">{T.searchPrompt}</p>
        ) : results && results.length === 0 ? (
          <p className="border-t border-hair px-[18px] py-6 text-center text-xs text-muted">{T.searchNoMatch}</p>
        ) : (
          results && (
            <ul aria-label={T.resultsLabel} className="border-t border-hair">
              {results.map(({ patient, lastVisitDate }) => {
                const lastVisit = lastVisitLine(lastVisitDate);
                return (
                  <li key={patient.id} className="border-b border-hair last:border-b-0">
                    <button
                      data-support-nav
                      type="button"
                      onClick={() => setPatientId(patient.id)}
                      className="flex w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-0.5 bg-card px-[18px] py-3 text-start font-[inherit] transition-colors duration-150 hover:bg-field focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-green"
                    >
                      <span className="text-sm font-semibold text-text">{patient.full_name}</span>
                      {isArchived(patient) && (
                        <Badge appearance="soft" tone="neutral">
                          {T.archivedBadge}
                        </Badge>
                      )}
                      {patient.phone && (
                        <span className="font-mono text-xs text-muted">
                          <Ltr>{formatEgyptianPhoneForDisplay(patient.phone)}</Ltr>
                        </span>
                      )}
                      <span className="ms-auto text-[11.5px] text-muted tabular-nums">
                        {lastVisit.label}
                        {lastVisit.date && (
                          <>
                            {" "}
                            <SlashDate>{lastVisit.date}</SlashDate>
                          </>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )
        )}
      </Card>
    </PageMain>
  );
}

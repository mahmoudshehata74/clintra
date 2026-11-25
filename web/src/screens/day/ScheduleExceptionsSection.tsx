import { useState } from "react";
import Ltr from "../../components/Ltr";
import { attemptSave } from "../../components/ui/attemptSave";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Field, { TextInput } from "../../components/ui/Field";
import SaveFailedLine from "../../components/ui/SaveFailedLine";
import TimeField from "../../components/ui/TimeField";
import ToggleGroup from "../../components/ui/ToggleGroup";
import { db } from "../../db/database";
import { activeVisitsOn, addScheduleException, deleteScheduleException, type AddExceptionResult } from "../../db/scheduleExceptions";
import { ScheduleExceptionType, type ScheduleException } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { CLOSURE_REASON_MAX_LENGTH } from "../../domain/scheduleExceptions";
import { clockTimeInCairo, todayInCairo, type ClinicDay, type ClockTime } from "../../domain/time";
import { SetList, SetRow } from "./SettingsLayout";
import { dayScreenStrings as S } from "./strings";

type Kind = "closed" | "hours";

const REFUSAL_MESSAGE: Record<Exclude<AddExceptionResult, { ok: true }>["reason"], string> = {
  invalid_date: S.exceptionInvalidDateError,
  past_date: S.exceptionPastDateError,
  already_has_exception: S.exceptionExistsError,
  end_before_start: S.hoursEndBeforeStartError,
  reason_too_long: S.exceptionReasonTooLongError,
  practitioner_not_found: S.exceptionExistsError,
};

/** A booked visit on the date being closed, as the confirmation lists it. */
interface AffectedVisit {
  id: string;
  time: string | null;
  patientName: string;
}

/**
 * "إجازات ومواعيد استثنائية" under the doctor's week in settings → working
 * hours (owner only, as the whole settings sheet): the doctor's exceptions
 * from today on, each with "حذف", and a form to add a closed date or that
 * date's own hours (db/scheduleExceptions.ts), a closure with its optional
 * "سبب الإجازة" shown under it in the list. Closing a date that has
 * bookings first lists them and asks to confirm; the bookings stay, flagged
 * on the day screen as outside working hours — a closure never cancels one.
 * No prototype counterpart: built from the settings rows and shared ui/.
 */
export default function ScheduleExceptionsSection({ practitionerId }: { practitionerId: string }) {
  const today = todayInCairo();
  const exceptions =
    useLiveQuery<ScheduleException[]>(async () => {
      const all = await db.schedule_exceptions.toArray();
      return all
        .filter((exception) => exception.practitioner_id === practitionerId && exception.date >= today)
        .sort((a, b) => a.date.localeCompare(b.date));
    }, [practitionerId, today]) ?? [];

  const [date, setDate] = useState("");
  const [kind, setKind] = useState<Kind>("closed");
  const [reason, setReason] = useState("");
  const [startTime, setStartTime] = useState("10:00");
  const [endTime, setEndTime] = useState("14:00");
  const [error, setError] = useState<string | null>(null);
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [affected, setAffected] = useState<AffectedVisit[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);

  async function add(confirmed: boolean) {
    setError(null);
    setReasonError(null);
    const day = date.trim() as ClinicDay;
    if (kind === "closed" && !confirmed) {
      const visits = await activeVisitsOn(db, practitionerId, day);
      if (visits.length > 0) {
        const patients = await db.patients.bulkGet([...new Set(visits.map((visit) => visit.patient_id))]);
        const names = new Map(patients.filter((patient) => patient !== undefined).map((patient) => [patient.id, patient.full_name]));
        setAffected(
          visits.map((visit) => ({
            id: visit.id,
            time: visit.scheduled_at ? clockTimeInCairo(visit.scheduled_at) : null,
            patientName: names.get(visit.patient_id) ?? "",
          })),
        );
        return;
      }
    }
    setSaving(true);
    try {
      const result =
        kind === "closed"
          ? await addScheduleException(db, { practitionerId, date: day, kind: "closed", reason })
          : await addScheduleException(db, { practitionerId, date: day, kind: "hours", startTime: startTime as ClockTime, endTime: endTime as ClockTime });
      if (!result.ok) {
        if (result.reason === "reason_too_long") {
          setReasonError(REFUSAL_MESSAGE[result.reason]);
        } else {
          setError(REFUSAL_MESSAGE[result.reason]);
        }
        setAffected(null);
        return;
      }
      setDate("");
      setReason("");
      setAffected(null);
    } catch {
      setError(S.exceptionSaveFailedError);
    } finally {
      setSaving(false);
    }
  }

  async function remove(exceptionId: string) {
    setDeleteFailed(!(await attemptSave(() => deleteScheduleException(db, exceptionId))));
  }

  return (
    <section aria-label={S.exceptionsHeading} className="mt-5 flex flex-col gap-3">
      <h3 className="text-[13px] font-bold text-text">{S.exceptionsHeading}</h3>

      {exceptions.length === 0 ? (
        <p className="text-[12.5px] text-muted">{S.exceptionsEmpty}</p>
      ) : (
        <SetList>
          {exceptions.map((exception) => (
            <SetRow key={exception.id} layout="hours">
              <Ltr className="text-[12.5px] font-bold text-text">{exception.date}</Ltr>
              <span className="text-[13px] text-text">
                {exception.type === ScheduleExceptionType.Closed ? (
                  <>
                    {S.exceptionClosedLabel}
                    {exception.reason && (
                      <span className="mt-0.5 block text-[12px] text-muted">
                        {S.closureReasonPrefix} {exception.reason}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    {S.exceptionHoursLabel}{" "}
                    <Ltr className="tabular-nums">{`${exception.start_time}–${exception.end_time}`}</Ltr>
                  </>
                )}
              </span>
              <div className="flex items-center gap-1.5">
                <Badge appearance="soft" tone={exception.type === ScheduleExceptionType.Closed ? "warning" : "neutral"}>
                  {exception.type === ScheduleExceptionType.Closed ? S.hoursModeDayOff : S.exceptionHoursBadge}
                </Badge>
                <Button variant="outline" onClick={() => remove(exception.id)}>
                  {S.exceptionDeleteAction}
                </Button>
              </div>
            </SetRow>
          ))}
        </SetList>
      )}
      {deleteFailed && <SaveFailedLine />}

      <div data-support-write className="flex flex-col gap-3 rounded-card border border-rule bg-field p-3.5">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
          <Field label={S.exceptionDateLabel} id="exception-date" error={error ?? undefined}>
            <TextInput
              variant="mono"
              dir="ltr"
              inputMode="numeric"
              placeholder={S.exceptionDatePlaceholder}
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
                setAffected(null);
              }}
            />
          </Field>
          <div className="flex flex-col gap-[5px]">
            <span className="text-[11px] font-bold tracking-[0.02em] text-muted">{S.exceptionKindLabel}</span>
            <ToggleGroup
              variant="filter"
              label={S.exceptionKindLabel}
              value={kind}
              onChange={(value) => {
                setKind(value);
                setAffected(null);
              }}
              options={[
                { value: "closed", label: S.exceptionKindClosed },
                { value: "hours", label: S.exceptionKindHours },
              ]}
            />
          </div>
        </div>
        {kind === "closed" && (
          <Field label={S.exceptionReasonLabel} id="exception-reason" hint={S.exceptionReasonHint} error={reasonError ?? undefined}>
            <TextInput
              maxLength={CLOSURE_REASON_MAX_LENGTH}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setReasonError(null);
              }}
            />
          </Field>
        )}
        {kind === "hours" && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
            <Field label={S.hoursStartLabel} id="exception-start">
              <TimeField label={S.hoursStartLabel} value={startTime} onChange={setStartTime} />
            </Field>
            <Field label={S.hoursEndLabel} id="exception-end">
              <TimeField label={S.hoursEndLabel} value={endTime} onChange={setEndTime} />
            </Field>
          </div>
        )}

        {affected ? (
          <div role="alert" className="flex flex-col gap-2 rounded-control border border-warning bg-warning-wash p-3">
            <p className="text-[12.5px] font-semibold text-text">{S.exceptionClosureHasVisits(affected.length)}</p>
            <ul className="flex flex-col gap-1">
              {affected.map((visit) => (
                <li key={visit.id} className="flex items-center gap-2 text-[12.5px] text-text">
                  {visit.time && <Ltr className="tabular-nums">{visit.time}</Ltr>}
                  <span>{visit.patientName}</span>
                </li>
              ))}
            </ul>
            <p className="text-[12px] text-muted">{S.exceptionClosureKeepsVisits}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" size="sm" disabled={saving} onClick={() => add(true)}>
                {S.exceptionConfirmClosure}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setAffected(null)}>
                {S.settingsCancelAction}
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <Button variant="primary" size="sm" disabled={saving} onClick={() => add(false)}>
              {S.exceptionAddAction}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

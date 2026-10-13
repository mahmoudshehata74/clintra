import { useState } from "react";
import Ltr from "../../components/Ltr";
import Button from "../../components/ui/Button";
import Field, { TextInput } from "../../components/ui/Field";
import { db } from "../../db/database";
import { PractitionerProfileError, updatePractitionerProfile } from "../../db/practitioners";
import type { Practitioner } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { practitionerTitleOf, syndicateNumberOf } from "../../domain/practitionerProfile";
import { SetBody, SetList, SetRow } from "./SettingsLayout";
import { dayScreenStrings as T } from "./strings";

/**
 * The "الأطباء" settings tab: one row per practitioner of the org — name,
 * title, and "رقم النقابة N" or "من غير رقم نقابة" — each with "تعديل"
 * opening an inline form (the shared Field/TextInput) that applies on
 * "حفظ" only, the pattern StaffPanel's rows use. There is no prototype
 * screen for it: the settings layout (`.set-row` in a `.set-list`) and the
 * shared components only. Practitioners are created by provisioning, so
 * there is no add action. Owner-only, like the whole settings sheet; the
 * writer refuses anyone else too (db/practitioners.ts).
 */
export default function PractitionersPanel({ orgId }: { orgId: string }) {
  const practitioners =
    useLiveQuery<Practitioner[]>(async () => {
      const rows = (await db.practitioners.toArray()).filter((practitioner) => practitioner.org_id === orgId);
      return rows.sort((a, b) => a.full_name.localeCompare(b.full_name, "ar"));
    }, [orgId]) ?? [];

  return (
    <SetBody>
      <SetList>
        {practitioners.map((practitioner) => (
          <PractitionerRow key={practitioner.id} practitioner={practitioner} />
        ))}
      </SetList>
    </SetBody>
  );
}

type FormField = "name" | "syndicate";

function errorMessageFor(caught: unknown): { field: FormField | null; message: string } {
  const code = caught instanceof Error ? caught.message : "";
  switch (code) {
    case PractitionerProfileError.NameRequired:
      return { field: "name", message: T.practitionerNameRequiredError };
    case PractitionerProfileError.SyndicateNumberTooLong:
      return { field: "syndicate", message: T.practitionerSyndicateTooLongError };
    default:
      return { field: null, message: T.practitionerSaveFailedError };
  }
}

function PractitionerRow({ practitioner }: { practitioner: Practitioner }) {
  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState("");
  const [title, setTitle] = useState("");
  const [syndicateNumber, setSyndicateNumber] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<{ field: FormField | null; message: string } | null>(null);

  const shownTitle = practitionerTitleOf(practitioner.title);
  const shownSyndicateNumber = syndicateNumberOf(practitioner.syndicate_number);
  const idPrefix = `practitioner-${practitioner.id}`;

  function startEditing() {
    setFullName(practitioner.full_name);
    setTitle(shownTitle ?? "");
    setSyndicateNumber(shownSyndicateNumber ?? "");
    setError(null);
    setEditing(true);
  }

  async function save() {
    setIsSaving(true);
    try {
      await updatePractitionerProfile(db, practitioner.id, {
        full_name: fullName,
        title,
        syndicate_number: syndicateNumber,
      });
      setEditing(false);
    } catch (caught) {
      setError(errorMessageFor(caught));
    } finally {
      setIsSaving(false);
    }
  }

  const editor = editing ? (
    <div className="flex flex-col gap-3">
      <Field
        label={T.practitionerNameLabel}
        id={`${idPrefix}-name`}
        error={error?.field === "name" ? error.message : undefined}
      >
        <TextInput
          type="text"
          value={fullName}
          onChange={(e) => {
            setFullName(e.target.value);
            setError(null);
          }}
        />
      </Field>
      <Field label={T.practitionerTitleLabel} id={`${idPrefix}-title`}>
        <TextInput
          type="text"
          placeholder={T.practitionerTitlePlaceholder}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>
      <Field
        label={T.practitionerSyndicateLabel}
        id={`${idPrefix}-syndicate`}
        error={error?.field === "syndicate" ? error.message : undefined}
      >
        <TextInput
          type="text"
          dir="ltr"
          variant="mono"
          value={syndicateNumber}
          onChange={(e) => {
            setSyndicateNumber(e.target.value);
            setError(null);
          }}
        />
      </Field>
      {error?.field === null && (
        <p role="alert" className="text-[12.5px] text-danger">
          {error.message}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" className="flex-1" disabled={isSaving} onClick={() => void save()}>
          {T.settingsSaveAction}
        </Button>
        <Button variant="secondary" size="sm" disabled={isSaving} onClick={() => setEditing(false)}>
          {T.settingsCancelAction}
        </Button>
      </div>
    </div>
  ) : undefined;

  return (
    <SetRow layout="practitioner" muted={!practitioner.is_active} editor={editor}>
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold text-text">
          {practitioner.full_name}
          {/* The space is load-bearing: with none, Chrome joins the name's
              last letter to the title's first across the element boundary. */}{" "}
          {shownTitle && <span className="ms-1 text-[11px] font-medium text-muted">{shownTitle}</span>}
        </p>
        {shownSyndicateNumber ? (
          <p className="mt-0.5 text-[11.5px] text-muted">
            {T.practitionerSyndicatePrefix} <Ltr className="font-mono">{shownSyndicateNumber}</Ltr>
          </p>
        ) : (
          <p className="mt-0.5 text-[11.5px] text-faint">{T.practitionerNoSyndicate}</p>
        )}
      </div>
      {!editing && (
        <Button variant="outline" onClick={startEditing}>
          {T.hoursEditAction}
        </Button>
      )}
    </SetRow>
  );
}

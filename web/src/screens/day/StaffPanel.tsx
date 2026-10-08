import { useState } from "react";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Field, { TextInput } from "../../components/ui/Field";
import Switch from "../../components/ui/Switch";
import ToggleChip from "../../components/ui/ToggleChip";
import ToggleGroup from "../../components/ui/ToggleGroup";
import { db } from "../../db/database";
import { createStaffMembership, updateMembership } from "../../db/staffSettings";
import type { Location, Membership, Practitioner, User } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { Role } from "../../domain/role";
import { LocationScope, PractitionerScope } from "../../domain/scope";
import { ROLE_LABELS } from "./actorLabel";
import { SetBody, SetList, SetRow, SettingsFooter } from "./SettingsLayout";
import { hasPinSet, isLastActiveOwner } from "./staffRows";
import { dayScreenStrings } from "./strings";

const ROLE_OPTIONS: readonly { value: Role; label: string }[] = [Role.Owner, Role.Assistant, Role.Manager].map((role) => ({
  value: role,
  label: ROLE_LABELS[role],
}));

const LOCATION_SCOPE_OPTIONS: readonly { value: LocationScope; label: string }[] = [
  { value: LocationScope.All, label: dayScreenStrings.scopeAll },
  { value: LocationScope.Listed, label: dayScreenStrings.scopeListed },
];

const PRACTITIONER_SCOPE_OPTIONS: readonly { value: PractitionerScope; label: string }[] = [
  { value: PractitionerScope.All, label: dayScreenStrings.scopeAll },
  { value: PractitionerScope.Listed, label: dayScreenStrings.scopeListed },
  { value: PractitionerScope.Self, label: dayScreenStrings.scopeSelf },
];

const LAST_OWNER_NOTE_ID = "staff-last-owner-note";

interface PanelData {
  memberships: Membership[];
  usersById: Map<string, User>;
  locations: Location[];
  practitioners: Practitioner[];
}

const EMPTY: PanelData = { memberships: [], usersById: new Map(), locations: [], practitioners: [] };

/** A small `.field label`-styled heading over a group of chips (not a form control, so not Field). */
function GroupHeading({ children }: { children: string }) {
  return <p className="text-[11px] font-bold tracking-[0.02em] text-muted">{children}</p>;
}

/**
 * Panel C, prototype #s14 (`.set-row.staff`, `.staff-name`, `.role`, the
 * dashed copper note box, `.runrow`): the org's staff. Each row shows the
 * member's PIN status as a badge — never any digit of the PIN (settled
 * deviation) — and their active switch. The last active owner's switch is
 * disabled, and the note under the list says why: the same rule
 * db/staffSettings.ts's updateMembership enforces ("last_owner").
 */
export default function StaffPanel({ orgId }: { orgId: string }) {
  const data =
    useLiveQuery<PanelData>(async () => {
      const memberships = (await db.memberships.toArray()).filter((m) => m.org_id === orgId);
      const users = await db.users.bulkGet(memberships.map((m) => m.user_id));
      const [locations, practitioners] = await Promise.all([db.locations.toArray(), db.practitioners.toArray()]);
      return {
        memberships,
        usersById: new Map(users.filter((u): u is User => u != null).map((u) => [u.id, u])),
        locations: locations.filter((l) => l.is_active),
        practitioners: practitioners.filter((p) => p.is_active),
      };
    }, [orgId]) ?? EMPTY;

  const [isAdding, setIsAdding] = useState(false);
  const hasLockedOwner = data.memberships.some((m) => isLastActiveOwner(m, data.memberships));

  return (
    <>
      <SetBody>
        <SetList>
          {data.memberships.map((membership) => (
            <StaffRow
              key={membership.id}
              membership={membership}
              userName={data.usersById.get(membership.user_id)?.full_name ?? ""}
              isLastActiveOwner={isLastActiveOwner(membership, data.memberships)}
            />
          ))}
        </SetList>

        {hasLockedOwner && (
          <div
            id={LAST_OWNER_NOTE_ID}
            className="mt-3.5 flex items-start gap-2 rounded-card border border-dashed border-copper-line bg-copper-wash px-3.5 py-3 text-xs text-copper"
          >
            <span className="font-bold">{dayScreenStrings.staffNoteLabel}</span>
            <span>{dayScreenStrings.staffLastOwnerNote}</span>
          </div>
        )}

        {isAdding && (
          <NewStaffForm
            orgId={orgId}
            locations={data.locations}
            practitioners={data.practitioners}
            onSaved={() => setIsAdding(false)}
          />
        )}
      </SetBody>

      <SettingsFooter
        count={
          <>
            {dayScreenStrings.staffMinimumPrefix} <b>{dayScreenStrings.staffMinimumOwner}</b>
          </>
        }
      >
        {/* Hidden while the form is open, as before — its own save is the one action then. */}
        {!isAdding && (
          <Button variant="primary" onClick={() => setIsAdding(true)}>
            {dayScreenStrings.staffNewAction}
          </Button>
        )}
      </SettingsFooter>
    </>
  );
}

function StaffRow({
  membership,
  userName,
  isLastActiveOwner: isLocked,
}: {
  membership: Membership;
  userName: string;
  isLastActiveOwner: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState<Role>(membership.role);
  const [newPin, setNewPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  // Demoting the last active owner is refused before it is even tried.
  const wouldRemoveLastOwner = isLocked && role !== Role.Owner;
  const pinIsSet = hasPinSet(membership);

  async function setActive(next: boolean) {
    const result = await updateMembership(db, membership.id, { isActive: next });
    if (!result.ok) {
      setError(result.reason === "last_owner" ? dayScreenStrings.staffLastOwnerError : "");
    }
  }

  async function save() {
    if (newPin !== "" && !/^\d{4}$/.test(newPin)) {
      setPinError(dayScreenStrings.staffPinLengthError);
      return;
    }
    const result = await updateMembership(db, membership.id, {
      role,
      newPin: newPin === "" ? undefined : newPin,
    });
    if (!result.ok) {
      setError(result.reason === "last_owner" ? dayScreenStrings.staffLastOwnerError : "");
      return;
    }
    setConfirmation(
      newPin !== "" ? `${dayScreenStrings.staffPinChangedPrefix} ${userName} ${dayScreenStrings.staffPinChangedSuffix}` : null,
    );
    setNewPin("");
    setEditing(false);
  }

  const editor = editing ? (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-[5px]">
        <GroupHeading>{dayScreenStrings.staffRoleLabel}</GroupHeading>
        <ToggleGroup variant="filter" label={dayScreenStrings.staffRoleLabel} value={role} onChange={setRole} options={ROLE_OPTIONS} />
      </div>
      <Field label={dayScreenStrings.staffNewPinLabel} id={`staff-${membership.id}-pin`} error={pinError ?? undefined}>
        <TextInput
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          variant="mono"
          value={newPin}
          onChange={(e) => {
            setNewPin(e.target.value);
            setPinError(null);
          }}
        />
      </Field>
      {wouldRemoveLastOwner && <p className="text-[12.5px] text-danger">{dayScreenStrings.staffLastOwnerError}</p>}
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" className="flex-1" disabled={wouldRemoveLastOwner} onClick={save}>
          {dayScreenStrings.settingsSaveAction}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
          {dayScreenStrings.settingsCancelAction}
        </Button>
      </div>
    </div>
  ) : confirmation || error ? (
    <p className={`text-[12.5px] ${error ? "text-danger" : "text-eligible"}`}>{error || confirmation}</p>
  ) : undefined;

  return (
    <SetRow layout="staff" muted={!membership.is_active} editor={editor}>
      <span className="min-w-0 text-[13.5px] font-semibold text-text">
        {userName}
        {/* The space is load-bearing: with none, Chrome joins the name's
            last letter to the role's first across the element boundary. */}{" "}
        <span className="ms-1 text-[11px] font-medium text-muted">{ROLE_LABELS[membership.role]}</span>
      </span>
      {pinIsSet ? (
        <Badge appearance="solid" tone="eligible">
          {dayScreenStrings.staffPinSetBadge}
        </Badge>
      ) : (
        <Badge appearance="soft" tone="neutral">
          {dayScreenStrings.staffPinUnsetBadge}
        </Badge>
      )}
      <Switch
        checked={membership.is_active}
        disabled={isLocked}
        aria-describedby={isLocked ? LAST_OWNER_NOTE_ID : undefined}
        onCheckedChange={setActive}
        label={`${dayScreenStrings.staffActiveLabel} · ${userName}`}
      />
      {!editing && (
        <Button
          variant="outline"
          onClick={() => {
            setRole(membership.role);
            setNewPin("");
            setPinError(null);
            setError(null);
            setConfirmation(null);
            setEditing(true);
          }}
        >
          {dayScreenStrings.hoursEditAction}
        </Button>
      )}
    </SetRow>
  );
}

type NewStaffField = "name" | "phone" | "practitioners" | "pin";

function NewStaffForm({
  orgId,
  locations,
  practitioners,
  onSaved,
}: {
  orgId: string;
  locations: Location[];
  practitioners: Practitioner[];
  onSaved: () => void;
}) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<Role>(Role.Assistant);
  const [locationScope, setLocationScope] = useState<LocationScope>(LocationScope.All);
  const [practitionerScope, setPractitionerScope] = useState<PractitionerScope>(PractitionerScope.All);
  const [listedLocationIds, setListedLocationIds] = useState<string[]>([]);
  const [listedPractitionerIds, setListedPractitionerIds] = useState<string[]>([]);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<{ field: NewStaffField; message: string } | null>(null);

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  function errorFor(field: NewStaffField): string | undefined {
    return error?.field === field ? error.message : undefined;
  }

  async function save() {
    if (fullName.trim() === "") {
      setError({ field: "name", message: dayScreenStrings.staffNameRequiredError });
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setError({ field: "pin", message: dayScreenStrings.staffPinLengthError });
      return;
    }
    const result = await createStaffMembership(db, {
      orgId,
      fullName: fullName.trim(),
      phone,
      role,
      locationScope,
      practitionerScope,
      listedLocationIds,
      listedPractitionerIds,
      pin,
    });
    if (!result.ok) {
      setError(
        result.reason === "invalid_phone"
          ? { field: "phone", message: dayScreenStrings.staffPhoneInvalidError }
          : result.reason === "phone_taken"
            ? { field: "phone", message: dayScreenStrings.staffPhoneTakenError }
            : { field: "practitioners", message: dayScreenStrings.staffPractitionerRequiredError },
      );
      return;
    }
    setError(null);
    onSaved();
  }

  return (
    <div className="mt-3.5 flex flex-col gap-3 rounded-card border border-green-line bg-card p-3.5">
      <Field label={dayScreenStrings.staffNameLabel} id="staff-new-name" error={errorFor("name")}>
        <TextInput type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </Field>
      <Field label={dayScreenStrings.staffPhoneLabel} id="staff-new-phone" error={errorFor("phone")}>
        <TextInput type="tel" inputMode="tel" variant="mono" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>

      <div className="flex flex-col gap-[5px]">
        <GroupHeading>{dayScreenStrings.staffRoleLabel}</GroupHeading>
        <ToggleGroup variant="filter" label={dayScreenStrings.staffRoleLabel} value={role} onChange={setRole} options={ROLE_OPTIONS} />
      </div>

      <div className="flex flex-col gap-[5px]">
        <GroupHeading>{dayScreenStrings.staffLocationScopeLabel}</GroupHeading>
        <ToggleGroup
          variant="filter"
          label={dayScreenStrings.staffLocationScopeLabel}
          value={locationScope}
          onChange={setLocationScope}
          options={LOCATION_SCOPE_OPTIONS}
        />
        {locationScope === LocationScope.Listed && (
          // Several locations at once — ToggleGroup is single-choice, so
          // these are independent ToggleChips under one labelled group.
          <div role="group" aria-label={dayScreenStrings.staffLocationScopeLabel} className="mt-1 flex flex-wrap gap-[6px]">
            {locations.map((location) => (
              <ToggleChip
                key={location.id}
                variant="filter"
                pressed={listedLocationIds.includes(location.id)}
                onClick={() => setListedLocationIds((list) => toggle(list, location.id))}
              >
                {location.name}
              </ToggleChip>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-[5px]">
        <GroupHeading>{dayScreenStrings.staffPractitionerScopeLabel}</GroupHeading>
        <ToggleGroup
          variant="filter"
          label={dayScreenStrings.staffPractitionerScopeLabel}
          value={practitionerScope}
          onChange={setPractitionerScope}
          options={PRACTITIONER_SCOPE_OPTIONS}
        />
        {(practitionerScope === PractitionerScope.Listed || practitionerScope === PractitionerScope.Self) && (
          <div role="group" aria-label={dayScreenStrings.staffPractitionerScopeLabel} className="mt-1 flex flex-wrap gap-[6px]">
            {practitioners.map((practitioner) => (
              <ToggleChip
                key={practitioner.id}
                variant="filter"
                pressed={listedPractitionerIds.includes(practitioner.id)}
                onClick={() =>
                  setListedPractitionerIds(
                    practitionerScope === PractitionerScope.Self ? [practitioner.id] : toggle(listedPractitionerIds, practitioner.id),
                  )
                }
              >
                {practitioner.full_name}
              </ToggleChip>
            ))}
          </div>
        )}
        {errorFor("practitioners") && <span className="mt-0.5 text-[10.5px] text-danger">{errorFor("practitioners")}</span>}
      </div>

      <Field label={dayScreenStrings.staffPinLabel} id="staff-new-pin" error={errorFor("pin")}>
        <TextInput
          type="password"
          inputMode="numeric"
          autoComplete="new-password"
          variant="mono"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
        />
      </Field>
      <Button variant="primary" onClick={save}>
        {dayScreenStrings.settingsSaveAction}
      </Button>
    </div>
  );
}

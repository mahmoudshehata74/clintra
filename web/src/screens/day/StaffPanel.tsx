import { useState } from "react";
import { db } from "../../db/database";
import { createStaffMembership, updateMembership } from "../../db/staffSettings";
import type { Location, Membership, Practitioner, User } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { Role } from "../../domain/role";
import { LocationScope, PractitionerScope } from "../../domain/scope";
import { ROLE_LABELS } from "./actorLabel";
import { dayScreenStrings } from "./strings";

const FIELD_CLASS =
  "w-full rounded-[--radius-el] border border-line bg-paper px-3 py-2 text-start focus:border-green focus:outline-none focus:ring-[3px] focus:ring-green-soft";

const ROLE_OPTIONS: readonly Role[] = [Role.Owner, Role.Assistant, Role.Manager];

interface PanelData {
  memberships: Membership[];
  usersById: Map<string, User>;
  locations: Location[];
  practitioners: Practitioner[];
}

const EMPTY: PanelData = { memberships: [], usersById: new Map(), locations: [], practitioners: [] };

function pillClass(selected: boolean): string {
  return selected
    ? "rounded-[--radius-el] border border-green px-3 py-1 text-sm text-green"
    : "rounded-[--radius-el] border border-line px-3 py-1 text-sm text-ink";
}

/** Panel C: the org's staff and their permissions. */
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

  const activeOwnerCount = data.memberships.filter((m) => m.role === Role.Owner && m.is_active).length;

  return (
    <div className="mt-4">
      <ul className="flex flex-col divide-y divide-line-soft">
        {data.memberships.map((membership) => (
          <StaffRow
            key={membership.id}
            membership={membership}
            userName={data.usersById.get(membership.user_id)?.full_name ?? ""}
            activeOwnerCount={activeOwnerCount}
          />
        ))}
      </ul>
      <NewStaffForm orgId={orgId} locations={data.locations} practitioners={data.practitioners} />
    </div>
  );
}

function StaffRow({
  membership,
  userName,
  activeOwnerCount,
}: {
  membership: Membership;
  userName: string;
  activeOwnerCount: number;
}) {
  const [editing, setEditing] = useState(false);
  const [role, setRole] = useState<Role>(membership.role);
  const [isActive, setIsActive] = useState(membership.is_active);
  const [newPin, setNewPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  const isLastActiveOwner = membership.role === Role.Owner && membership.is_active && activeOwnerCount === 1;
  const wouldRemoveLastOwner = isLastActiveOwner && !(role === Role.Owner && isActive);

  async function save() {
    if (newPin !== "" && !/^\d{4}$/.test(newPin)) {
      setError(dayScreenStrings.staffPinLengthError);
      return;
    }
    const result = await updateMembership(db, membership.id, {
      role,
      isActive,
      newPin: newPin === "" ? undefined : newPin,
    });
    if (!result.ok) {
      setError(result.reason === "last_owner" ? dayScreenStrings.staffLastOwnerError : "");
      return;
    }
    setConfirmation(
      newPin !== ""
        ? `${dayScreenStrings.staffPinChangedPrefix} ${userName} ${dayScreenStrings.staffPinChangedSuffix}`
        : null,
    );
    setNewPin("");
    setEditing(false);
  }

  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className={membership.is_active ? "font-medium" : "font-medium text-muted line-through"}>{userName}</span>
        <span className="flex items-center gap-2 text-sm text-muted">
          <span className="rounded-[5px] bg-line-soft px-2 py-0.5 text-xs">{ROLE_LABELS[membership.role]}</span>
          {!editing && (
            <button
              type="button"
              onClick={() => {
                setRole(membership.role);
                setIsActive(membership.is_active);
                setNewPin("");
                setError(null);
                setConfirmation(null);
                setEditing(true);
              }}
              className="text-green"
            >
              {dayScreenStrings.hoursEditAction}
            </button>
          )}
        </span>
      </div>
      {!editing && confirmation && <p className="mt-1 text-sm text-green">{confirmation}</p>}

      {editing && (
        <div className="mt-3 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            {ROLE_OPTIONS.map((option) => (
              <button key={option} type="button" onClick={() => setRole(option)} className={pillClass(role === option)}>
                {ROLE_LABELS[option]}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={isActive}
            onClick={() => setIsActive((value) => !value)}
            className={pillClass(isActive)}
          >
            {dayScreenStrings.staffActiveLabel}
          </button>
          <input
            type="password"
            inputMode="numeric"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            placeholder={dayScreenStrings.staffNewPinLabel}
            className={FIELD_CLASS}
          />
          {wouldRemoveLastOwner && <p className="text-sm text-red">{dayScreenStrings.staffLastOwnerError}</p>}
          {error && <p className="text-sm text-red">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={wouldRemoveLastOwner}
              onClick={save}
              className="flex-1 rounded-[--radius-el] bg-green px-4 py-2 text-center font-semibold text-paper disabled:opacity-50"
            >
              {dayScreenStrings.settingsSaveAction}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-[--radius-el] border border-line px-4 py-2 text-ink"
            >
              {dayScreenStrings.settingsCancelAction}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function NewStaffForm({
  orgId,
  locations,
  practitioners,
}: {
  orgId: string;
  locations: Location[];
  practitioners: Practitioner[];
}) {
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<Role>(Role.Assistant);
  const [locationScope, setLocationScope] = useState<LocationScope>(LocationScope.All);
  const [practitionerScope, setPractitionerScope] = useState<PractitionerScope>(PractitionerScope.All);
  const [listedLocationIds, setListedLocationIds] = useState<string[]>([]);
  const [listedPractitionerIds, setListedPractitionerIds] = useState<string[]>([]);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  async function save() {
    if (fullName.trim() === "") {
      setError(dayScreenStrings.staffNameRequiredError);
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setError(dayScreenStrings.staffPinLengthError);
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
          ? dayScreenStrings.staffPhoneInvalidError
          : result.reason === "phone_taken"
            ? dayScreenStrings.staffPhoneTakenError
            : dayScreenStrings.staffPractitionerRequiredError,
      );
      return;
    }
    setOpen(false);
    setFullName("");
    setPhone("");
    setPin("");
    setListedLocationIds([]);
    setListedPractitionerIds([]);
    setError(null);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 w-full rounded-[--radius-el] bg-green px-4 py-3 text-center font-semibold text-paper"
      >
        {dayScreenStrings.staffNewAction}
      </button>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-[--radius-el] border border-line p-3">
      <input
        type="text"
        value={fullName}
        onChange={(e) => setFullName(e.target.value)}
        placeholder={dayScreenStrings.staffNameLabel}
        className={FIELD_CLASS}
      />
      <input
        type="tel"
        inputMode="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder={dayScreenStrings.staffPhoneLabel}
        className={FIELD_CLASS}
      />

      <p className="text-sm text-muted">{dayScreenStrings.staffRoleLabel}</p>
      <div className="flex flex-wrap gap-2">
        {ROLE_OPTIONS.map((option) => (
          <button key={option} type="button" onClick={() => setRole(option)} className={pillClass(role === option)}>
            {ROLE_LABELS[option]}
          </button>
        ))}
      </div>

      <p className="text-sm text-muted">{dayScreenStrings.staffLocationScopeLabel}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setLocationScope(LocationScope.All)} className={pillClass(locationScope === LocationScope.All)}>
          {dayScreenStrings.scopeAll}
        </button>
        <button type="button" onClick={() => setLocationScope(LocationScope.Listed)} className={pillClass(locationScope === LocationScope.Listed)}>
          {dayScreenStrings.scopeListed}
        </button>
      </div>
      {locationScope === LocationScope.Listed && (
        <div className="flex flex-wrap gap-2">
          {locations.map((location) => (
            <button
              key={location.id}
              type="button"
              onClick={() => setListedLocationIds((list) => toggle(list, location.id))}
              className={pillClass(listedLocationIds.includes(location.id))}
            >
              {location.name}
            </button>
          ))}
        </div>
      )}

      <p className="text-sm text-muted">{dayScreenStrings.staffPractitionerScopeLabel}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setPractitionerScope(PractitionerScope.All)} className={pillClass(practitionerScope === PractitionerScope.All)}>
          {dayScreenStrings.scopeAll}
        </button>
        <button type="button" onClick={() => setPractitionerScope(PractitionerScope.Listed)} className={pillClass(practitionerScope === PractitionerScope.Listed)}>
          {dayScreenStrings.scopeListed}
        </button>
        <button type="button" onClick={() => setPractitionerScope(PractitionerScope.Self)} className={pillClass(practitionerScope === PractitionerScope.Self)}>
          {dayScreenStrings.scopeSelf}
        </button>
      </div>
      {(practitionerScope === PractitionerScope.Listed || practitionerScope === PractitionerScope.Self) && (
        <div className="flex flex-wrap gap-2">
          {practitioners.map((practitioner) => (
            <button
              key={practitioner.id}
              type="button"
              onClick={() =>
                setListedPractitionerIds(
                  practitionerScope === PractitionerScope.Self
                    ? [practitioner.id]
                    : toggle(listedPractitionerIds, practitioner.id),
                )
              }
              className={pillClass(listedPractitionerIds.includes(practitioner.id))}
            >
              {practitioner.full_name}
            </button>
          ))}
        </div>
      )}

      <input
        type="password"
        inputMode="numeric"
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        placeholder={dayScreenStrings.staffPinLabel}
        className={FIELD_CLASS}
      />
      {error && <p className="text-sm text-red">{error}</p>}
      <button
        type="button"
        onClick={save}
        className="rounded-[--radius-el] bg-green px-4 py-3 text-center font-semibold text-paper"
      >
        {dayScreenStrings.settingsSaveAction}
      </button>
    </div>
  );
}

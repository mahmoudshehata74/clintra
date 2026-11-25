import { useState } from "react";
import text from "../../auth/identityStrings";
import { useIdentityAccess } from "../../auth/permissions";
import { useDeviceAccount } from "../../auth/rollout";
import ToggleGroup from "../../components/ui/ToggleGroup";
import { db } from "../../db/database";
import { useLiveQuery } from "../../db/useLiveQuery";
import { withDoctorPrefix } from "./doctorName";
import IdentityRolloutPanel from "./IdentityRolloutPanel";
import PractitionersPanel from "./PractitionersPanel";
import { countServicesByState } from "./serviceCounts";
import ServicesPanel from "./ServicesPanel";
import Sheet from "./Sheet";
import SheetCardHead from "./SheetCardHead";
import StaffPanel from "./StaffPanel";
import SupportPanel from "./SupportPanel";
import { isSupportMode } from "../../auth/supportMode";
import { dayScreenStrings } from "./strings";
import WorkingHoursPanel from "./WorkingHoursPanel";

type Panel = "hours" | "services" | "staff" | "practitioners" | "rollout" | "support";

interface SettingsSheetProps {
  practitionerId: string;
  locationId: string;
  orgId: string;
  onDismiss: () => void;
}

const TAB_OPTIONS: readonly { value: Panel; label: string }[] = [
  { value: "hours", label: dayScreenStrings.settingsHoursTab },
  { value: "services", label: dayScreenStrings.settingsServicesTab },
  { value: "staff", label: dayScreenStrings.settingsStaffTab },
  { value: "practitioners", label: dayScreenStrings.settingsPractitionersTab },
  { value: "rollout", label: text.rolloutTitle },
  { value: "support", label: "دعم كلينترا" },
];

/**
 * The owner-only settings sheet, prototype #s12–14: a `.c-head` (badge
 * "الإعدادات", then what the open tab is about), the `.set-tabs` bar
 * switching between the panels — the prototype's three, then the
 * practitioners tab it does not show — and the panel itself, which owns its
 * own `.set-body` and `.runrow`. Only ever rendered when the acting
 * membership is an owner (see DayScreen) — there is no route to it
 * otherwise.
 */
export default function SettingsSheet({ practitionerId, locationId, orgId, onDismiss }: SettingsSheetProps) {
  const [selected, setPanel] = useState<Panel>("hours");
  const access = useIdentityAccess();
  const ownerId = access.member?.role === "owner" && access.member.is_active ? access.member.id : undefined;
  const ownerDevice = useDeviceAccount(ownerId);
  const available = TAB_OPTIONS.filter(({ value }) => {
    if (value === "hours") return access.allows("schedules.manage");
    if (value === "services") return access.allows("services.manage");
    if (value === "staff") return access.allows("staff.manage");
    if (value === "rollout") return Boolean(!isSupportMode() && ownerId && ownerDevice);
    if (value === "support") return Boolean(!isSupportMode() && ownerId);
    return !access.enforced || access.member?.role === "owner";
  });
  const panel = available.some(({ value }) => value === selected) ? selected : available[0]?.value;

  const context = useLiveQuery(async () => {
    const [practitioner, location, services, memberships] = await Promise.all([
      db.practitioners.get(practitionerId),
      db.locations.get(locationId),
      db.services.toArray(),
      db.memberships.toArray(),
    ]);
    return {
      practitionerName: practitioner?.full_name ?? "",
      locationName: location?.name ?? "",
      serviceCounts: countServicesByState(services.filter((service) => service.org_id === orgId)),
      activeStaffCount: memberships.filter((membership) => membership.org_id === orgId && membership.is_active).length,
    };
  }, [practitionerId, locationId, orgId]);

  if (!panel) return null;

  // `.c-head h3` / `.sub` per tab, as the prototype words each: the
  // practitioner whose week this is (with the location as context), the
  // clinic's services ("4 خدمات نشطة · 1 موقوفة"), the staff ("2 موظفين
  // نشطين").
  const head =
    panel === "hours"
      ? {
          title: context?.practitionerName ? withDoctorPrefix(context.practitionerName) : "",
          subtitle: [dayScreenStrings.settingsHoursHeadSubtitle, context?.locationName].filter(Boolean).join(" · "),
        }
      : panel === "services"
        ? {
            title: dayScreenStrings.settingsServicesHeadTitle,
            subtitle: context
              ? `${context.serviceCounts.active} ${dayScreenStrings.settingsServicesHeadActiveUnit} · ${context.serviceCounts.inactive} ${dayScreenStrings.serviceCountInactiveUnit}`
              : undefined,
          }
        : panel === "staff"
          ? {
              title: dayScreenStrings.settingsStaffTab,
              subtitle: context ? `${context.activeStaffCount} ${dayScreenStrings.settingsStaffHeadActiveUnit}` : undefined,
            }
          : { title: panel === "support" ? "دعم كلينترا" : panel === "rollout" ? text.rolloutTitle : dayScreenStrings.settingsPractitionersTab, subtitle: undefined };

  return (
    <Sheet onDismiss={onDismiss} size="lg">
      <SheetCardHead badge={dayScreenStrings.settingsButtonLabel} title={head.title} subtitle={head.subtitle} onDismiss={onDismiss} />

      {/* `.set-tabs` — the bar; the tabs themselves are the shared `.set-tab` ToggleGroup. */}
      <div data-support-navigation className="border-b border-hair bg-field px-[18px] py-2.5">
        <ToggleGroup
          variant="tab"
          label={dayScreenStrings.settingsTabsGroupLabel}
          value={panel}
          onChange={setPanel}
          options={available}
          className="overflow-x-auto"
        />
      </div>

      {panel === "hours" && <WorkingHoursPanel practitionerId={practitionerId} locationId={locationId} />}
      {panel === "services" && <ServicesPanel orgId={orgId} />}
      {panel === "staff" && <StaffPanel orgId={orgId} />}
      {panel === "practitioners" && <PractitionersPanel orgId={orgId} />}
      {panel === "rollout" && ownerId && <IdentityRolloutPanel key={ownerId} ownerId={ownerId} />}
      {panel === "support" && ownerId && <SupportPanel orgId={orgId} />}
    </Sheet>
  );
}

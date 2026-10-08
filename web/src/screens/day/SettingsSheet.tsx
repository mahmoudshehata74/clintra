import { useState } from "react";
import ToggleGroup from "../../components/ui/ToggleGroup";
import { db } from "../../db/database";
import { useLiveQuery } from "../../db/useLiveQuery";
import ServicesPanel from "./ServicesPanel";
import Sheet from "./Sheet";
import SheetCardHead from "./SheetCardHead";
import StaffPanel from "./StaffPanel";
import { dayScreenStrings } from "./strings";
import WorkingHoursPanel from "./WorkingHoursPanel";

type Panel = "hours" | "services" | "staff";

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
];

/**
 * The owner-only settings sheet, prototype #s12–14: a `.c-head` (badge
 * "الإعدادات", then what the open tab is about), the `.set-tabs` bar
 * switching between the three panels, and the panel itself, which owns its
 * own `.set-body` and `.runrow`. Only ever rendered when the acting
 * membership is an owner (see DayScreen) — there is no route to it
 * otherwise.
 */
export default function SettingsSheet({ practitionerId, locationId, orgId, onDismiss }: SettingsSheetProps) {
  const [panel, setPanel] = useState<Panel>("hours");

  const context = useLiveQuery(async () => {
    const [practitioner, location] = await Promise.all([db.practitioners.get(practitionerId), db.locations.get(locationId)]);
    return { practitionerName: practitioner?.full_name ?? "", locationName: location?.name ?? "" };
  }, [practitionerId, locationId]);

  // `.c-head h3` / `.sub` per tab, as the prototype words each: the
  // practitioner whose week this is (with the location as context), the
  // clinic's services, the staff.
  const head =
    panel === "hours"
      ? {
          title: context?.practitionerName ?? "",
          subtitle: [dayScreenStrings.settingsHoursHeadSubtitle, context?.locationName].filter(Boolean).join(" · "),
        }
      : panel === "services"
        ? { title: dayScreenStrings.settingsServicesHeadTitle, subtitle: undefined }
        : { title: dayScreenStrings.settingsStaffTab, subtitle: undefined };

  return (
    <Sheet onDismiss={onDismiss} size="lg">
      <SheetCardHead badge={dayScreenStrings.settingsButtonLabel} title={head.title} subtitle={head.subtitle} onDismiss={onDismiss} />

      {/* `.set-tabs` — the bar; the tabs themselves are the shared `.set-tab` ToggleGroup. */}
      <div className="border-b border-hair bg-field px-[18px] py-2.5">
        <ToggleGroup
          variant="tab"
          label={dayScreenStrings.settingsTabsGroupLabel}
          value={panel}
          onChange={setPanel}
          options={TAB_OPTIONS}
          className="overflow-x-auto"
        />
      </div>

      {panel === "hours" && <WorkingHoursPanel practitionerId={practitionerId} locationId={locationId} />}
      {panel === "services" && <ServicesPanel orgId={orgId} />}
      {panel === "staff" && <StaffPanel orgId={orgId} />}
    </Sheet>
  );
}

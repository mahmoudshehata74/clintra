import { useState } from "react";
import ServicesPanel from "./ServicesPanel";
import Sheet from "./Sheet";
import SheetHeader from "./SheetHeader";
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

function tabClassName(isActive: boolean): string {
  return isActive
    ? "rounded-[5px] bg-green-soft px-3 py-1 text-sm text-green"
    : "rounded-[5px] bg-line-soft px-3 py-1 text-sm text-muted";
}

/**
 * The owner-only settings sheet (reference screens 15-17): one full-height
 * sheet, a segmented pill row switching between the three panels. Only ever
 * rendered when the acting membership is an owner (see DayScreen) — there is no
 * route to it otherwise.
 */
export default function SettingsSheet({ practitionerId, locationId, orgId, onDismiss }: SettingsSheetProps) {
  const [panel, setPanel] = useState<Panel>("hours");

  return (
    <Sheet onDismiss={onDismiss}>
      <SheetHeader title={dayScreenStrings.settingsButtonLabel} onDismiss={onDismiss} />

      <div className="mt-3 flex gap-2">
        <button type="button" onClick={() => setPanel("hours")} className={tabClassName(panel === "hours")}>
          {dayScreenStrings.settingsHoursTab}
        </button>
        <button type="button" onClick={() => setPanel("services")} className={tabClassName(panel === "services")}>
          {dayScreenStrings.settingsServicesTab}
        </button>
        <button type="button" onClick={() => setPanel("staff")} className={tabClassName(panel === "staff")}>
          {dayScreenStrings.settingsStaffTab}
        </button>
      </div>

      <div className="overflow-y-auto">
        {panel === "hours" && <WorkingHoursPanel practitionerId={practitionerId} locationId={locationId} />}
        {panel === "services" && <ServicesPanel orgId={orgId} />}
        {panel === "staff" && <StaffPanel orgId={orgId} />}
      </div>
    </Sheet>
  );
}

import { useState, type ReactNode } from "react";
import ToggleGroup from "../../components/ui/ToggleGroup";
import { galleryStrings, toggleChipGalleryStrings } from "../strings";

function Row({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold text-muted">{heading}</p>
      {children}
    </div>
  );
}

/** ToggleChip + ToggleGroup — one group per prototype source, each independently controlled. */
export default function ToggleChipSection() {
  const [service, setService] = useState<(typeof toggleChipGalleryStrings.servicesOptions)[number]>(
    toggleChipGalleryStrings.servicesOptions[0],
  );
  const [filter, setFilter] = useState<(typeof toggleChipGalleryStrings.filtersOptions)[number]>(
    toggleChipGalleryStrings.filtersOptions[0],
  );
  const [tab, setTab] = useState<(typeof toggleChipGalleryStrings.tabsOptions)[number]>(
    toggleChipGalleryStrings.tabsOptions[0],
  );
  const [patientTab, setPatientTab] = useState<(typeof toggleChipGalleryStrings.patientTabsOptions)[number]["label"]>(
    toggleChipGalleryStrings.patientTabsOptions[0].label,
  );
  const [channel, setChannel] = useState<(typeof toggleChipGalleryStrings.channelOptions)[number]>(
    toggleChipGalleryStrings.channelOptions[0],
  );

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold text-text">{galleryStrings.toggleChipsSectionTitle}</h2>

      <Row heading={toggleChipGalleryStrings.servicesHeading}>
        <ToggleGroup
          variant="service"
          value={service}
          onChange={setService}
          options={toggleChipGalleryStrings.servicesOptions.map((label) => ({ value: label, label }))}
        />
      </Row>

      <Row heading={toggleChipGalleryStrings.filtersHeading}>
        <ToggleGroup
          variant="filter"
          value={filter}
          onChange={setFilter}
          options={toggleChipGalleryStrings.filtersOptions.map((label) => ({ value: label, label }))}
        />
      </Row>

      <Row heading={toggleChipGalleryStrings.tabsHeading}>
        <ToggleGroup
          variant="tab"
          value={tab}
          onChange={setTab}
          options={toggleChipGalleryStrings.tabsOptions.map((label) => ({ value: label, label }))}
        />
      </Row>

      <Row heading={toggleChipGalleryStrings.patientTabsHeading}>
        <ToggleGroup
          variant="patientTab"
          value={patientTab}
          onChange={setPatientTab}
          options={toggleChipGalleryStrings.patientTabsOptions.map(({ label, counter }) => ({
            value: label,
            label,
            counter,
          }))}
        />
      </Row>

      <Row heading={toggleChipGalleryStrings.channelHeading}>
        <ToggleGroup
          variant="channel"
          value={channel}
          onChange={setChannel}
          options={toggleChipGalleryStrings.channelOptions.map((label) => ({ value: label, label }))}
        />
      </Row>
    </section>
  );
}

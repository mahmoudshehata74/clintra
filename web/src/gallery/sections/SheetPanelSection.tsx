import { useState } from "react";
import Button from "../../components/ui/Button";
import Field, { TextInput } from "../../components/ui/Field";
import SheetPanel, { SheetPanelBody, SheetPanelFoot, SheetPanelHead } from "../../components/ui/SheetPanel";
import ToggleGroup from "../../components/ui/ToggleGroup";
import { fieldGalleryStrings, galleryStrings, sheetPanelGalleryStrings, toggleChipGalleryStrings } from "../strings";

/**
 * Screen 4's booking sheet, composed from SheetPanel + Field + ToggleGroup
 * + Button — rendered inline in the page, the way the prototype itself
 * shows it (no overlay/portal here; see SheetPanel's own doc comment).
 */
export default function SheetPanelSection() {
  const [service, setService] = useState<(typeof toggleChipGalleryStrings.servicesOptions)[number]>(
    toggleChipGalleryStrings.servicesOptions[0],
  );
  const [closedCount, setClosedCount] = useState(0);

  return (
    <section data-gallery-section="sheetpanel" className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-text">{galleryStrings.sheetPanelSectionTitle}</h2>

      <SheetPanel>
        <SheetPanelHead
          title={sheetPanelGalleryStrings.title}
          closeLabel={sheetPanelGalleryStrings.closeLabel}
          onClose={() => setClosedCount((count) => count + 1)}
        />
        <SheetPanelBody>
          <Field label={fieldGalleryStrings.searchLabel} id="gallery-sheetpanel-search">
            <TextInput defaultValue={fieldGalleryStrings.searchFilledValue} />
          </Field>
          <ToggleGroup
            variant="service"
            label={toggleChipGalleryStrings.servicesHeading}
            value={service}
            onChange={setService}
            options={toggleChipGalleryStrings.servicesOptions.map((label) => ({ value: label, label }))}
          />
        </SheetPanelBody>
        <SheetPanelFoot>
          <Button variant="primary" className="flex-1">
            {sheetPanelGalleryStrings.primaryAction}
          </Button>
          <Button variant="secondary">{sheetPanelGalleryStrings.secondaryAction}</Button>
        </SheetPanelFoot>
      </SheetPanel>

      <p className="text-xs text-muted">
        {sheetPanelGalleryStrings.closeLabel}: {closedCount}
      </p>
    </section>
  );
}

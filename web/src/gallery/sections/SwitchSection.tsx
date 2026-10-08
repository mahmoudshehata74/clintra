import { useState } from "react";
import Switch from "../../components/ui/Switch";
import { galleryStrings, switchGalleryStrings } from "../strings";

/** Switch (`.set-row .toggle` / `.toggle.off`) — two live switches plus both disabled states. */
export default function SwitchSection() {
  const [isFirstOn, setIsFirstOn] = useState(true);
  const [isSecondOn, setIsSecondOn] = useState(false);

  return (
    <section data-gallery-section="switch" className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold text-text">{galleryStrings.switchSectionTitle}</h2>

      <div className="flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-2">
          <Switch checked={isFirstOn} onCheckedChange={setIsFirstOn} label={switchGalleryStrings.liveOnLabel} />
          <span className="text-xs text-muted">
            {switchGalleryStrings.liveOnLabel}: {isFirstOn ? switchGalleryStrings.stateOn : switchGalleryStrings.stateOff}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={isSecondOn} onCheckedChange={setIsSecondOn} label={switchGalleryStrings.liveOffLabel} />
          <span className="text-xs text-muted">
            {switchGalleryStrings.liveOffLabel}: {isSecondOn ? switchGalleryStrings.stateOn : switchGalleryStrings.stateOff}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked disabled onCheckedChange={() => {}} label={switchGalleryStrings.disabledOnLabel} />
          <span className="text-xs text-muted">{switchGalleryStrings.disabledOnLabel}</span>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={false} disabled onCheckedChange={() => {}} label={switchGalleryStrings.disabledOffLabel} />
          <span className="text-xs text-muted">{switchGalleryStrings.disabledOffLabel}</span>
        </div>
      </div>
    </section>
  );
}

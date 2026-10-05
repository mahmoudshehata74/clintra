import { useState } from "react";
import Button, { type ButtonSize } from "../../components/ui/Button";
import {
  DARK_SURFACE_MD_ONLY_BUTTON_DEMOS,
  DARK_SURFACE_SM_BUTTON_DEMOS,
  galleryStrings,
  LIGHT_SURFACE_MD_ONLY_BUTTON_DEMOS,
  LIGHT_SURFACE_SM_BUTTON_DEMOS,
  type MdOnlyButtonDemo,
  type SmCapableButtonDemo,
} from "../strings";

const SIZES: readonly ButtonSize[] = ["md", "sm"];

interface SmCapableRowProps extends SmCapableButtonDemo {
  onEnabledMdClick?: () => void;
}

/** md + sm, each enabled and disabled — the four variants with a reference-defined compact form. */
function SmCapableButtonRow({ variant, heading, label, onEnabledMdClick }: SmCapableRowProps) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold text-muted">{heading}</p>
      <div className="flex flex-wrap items-center gap-3">
        {SIZES.map((size) => (
          <div key={size} className="flex flex-wrap items-center gap-3">
            <Button variant={variant} size={size} onClick={size === "md" ? onEnabledMdClick : undefined}>
              {label}
            </Button>
            <Button variant={variant} size={size} disabled>
              {label}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** md only, enabled and disabled — the three variants with no reference-defined compact form. */
function MdOnlyButtonRow({ variant, heading, label }: MdOnlyButtonDemo) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold text-muted">{heading}</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant={variant}>{label}</Button>
        <Button variant={variant} disabled>
          {label}
        </Button>
      </div>
    </div>
  );
}

/**
 * Every Button variant (md, plus sm where the reference defines one), each
 * shown enabled and disabled. gallery.spec.ts proves a click handler fires
 * exactly once by reading this section's counter after tapping the
 * primary/md button below.
 */
export default function ButtonsSection() {
  const [clickCount, setClickCount] = useState(0);

  return (
    <section className="flex flex-col gap-8">
      <h2 className="text-lg font-semibold text-text">{galleryStrings.buttonsSectionTitle}</h2>

      <div className="flex flex-col gap-6">
        {LIGHT_SURFACE_SM_BUTTON_DEMOS.map((demo) => (
          <SmCapableButtonRow
            key={demo.variant}
            {...demo}
            onEnabledMdClick={demo.variant === "primary" ? () => setClickCount((count) => count + 1) : undefined}
          />
        ))}
        {LIGHT_SURFACE_MD_ONLY_BUTTON_DEMOS.map((demo) => (
          <MdOnlyButtonRow key={demo.variant} {...demo} />
        ))}
      </div>

      <div className="flex flex-col gap-6 rounded-panel bg-ink p-6">
        {DARK_SURFACE_SM_BUTTON_DEMOS.map((demo) => (
          <SmCapableButtonRow key={demo.variant} {...demo} />
        ))}
        {DARK_SURFACE_MD_ONLY_BUTTON_DEMOS.map((demo) => (
          <MdOnlyButtonRow key={demo.variant} {...demo} />
        ))}
      </div>

      <p className="text-xs text-muted">
        {galleryStrings.clickCounterLabel}: {clickCount}
      </p>
    </section>
  );
}

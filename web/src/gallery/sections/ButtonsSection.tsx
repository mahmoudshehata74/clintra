import { useState } from "react";
import Button, { type ButtonSize } from "../../components/ui/Button";
import { DARK_SURFACE_BUTTON_DEMOS, galleryStrings, LIGHT_SURFACE_BUTTON_DEMOS, type ButtonVariantDemo } from "../strings";

const SIZES: readonly ButtonSize[] = ["md", "sm"];

interface ButtonRowProps extends ButtonVariantDemo {
  onEnabledMdClick?: () => void;
}

function ButtonRow({ variant, heading, label, onEnabledMdClick }: ButtonRowProps) {
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

/**
 * Every Button variant x size, each shown enabled and disabled.
 * gallery.spec.ts proves a click handler fires exactly once by reading this
 * section's counter after tapping the primary/md button below.
 */
export default function ButtonsSection() {
  const [clickCount, setClickCount] = useState(0);

  return (
    <section className="flex flex-col gap-8">
      <h2 className="text-lg font-semibold text-text">{galleryStrings.buttonsSectionTitle}</h2>

      <div className="flex flex-col gap-6">
        {LIGHT_SURFACE_BUTTON_DEMOS.map((demo) => (
          <ButtonRow
            key={demo.variant}
            {...demo}
            onEnabledMdClick={demo.variant === "primary" ? () => setClickCount((count) => count + 1) : undefined}
          />
        ))}
      </div>

      <div className="flex flex-col gap-6 rounded-panel bg-ink p-6">
        {DARK_SURFACE_BUTTON_DEMOS.map((demo) => (
          <ButtonRow key={demo.variant} {...demo} />
        ))}
      </div>

      <p className="text-xs text-muted">
        {galleryStrings.clickCounterLabel}: {clickCount}
      </p>
    </section>
  );
}

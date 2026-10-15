import type { ReactNode } from "react";
import { APPEARANCE_LABEL, appearanceAccessibleName, type Appearance } from "../domain/appearance";
import { cycleAppearance, useAppearance } from "./appearance";
import Button from "./ui/Button";

// Half a disc (auto: the system decides), a sun (light), a moon (dark).
const ICON_PATHS: Record<Appearance, ReactNode> = {
  auto: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor" />
    </>
  ),
  light: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  dark: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
};

/**
 * The device's appearance, on the ink chrome (the app bar, the lock card,
 * the activation card): one tap moves تلقائي → فاتح → غامق. Named
 * "المظهر: …" for assistive tech; from `sm` up the current label shows
 * beside the icon (below it the bar has no room, the icon alone shows).
 * No prototype counterpart: Button's onDark compact form (`.app-btn`).
 */
export default function AppearanceToggle({ className }: { className?: string }) {
  const appearance = useAppearance();
  return (
    <Button
      variant="onDark"
      size="sm"
      onClick={cycleAppearance}
      aria-label={appearanceAccessibleName(appearance)}
      data-appearance={appearance}
      className={["gap-1.5", className ?? ""].filter(Boolean).join(" ")}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4 shrink-0"
        aria-hidden="true"
      >
        {ICON_PATHS[appearance]}
      </svg>
      <span className="hidden sm:inline">{APPEARANCE_LABEL[appearance]}</span>
    </Button>
  );
}

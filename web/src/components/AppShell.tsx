import type { ReactNode } from "react";
import { sidebarStrings } from "./strings";

export type SidebarActiveItem = "day" | "settings";

interface AppShellProps {
  activeItem: SidebarActiveItem;
  onSelectDay: () => void;
  /** Owner-only, same gate the day screen's own settings entry always used. */
  settingsEnabled: boolean;
  onSelectSettings: () => void;
  children: ReactNode;
}

function SidebarIcon({ path }: { path: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 shrink-0"
      aria-hidden="true"
    >
      {path}
    </svg>
  );
}

// Small hand-drawn line icons — no icon package added for six glyphs.
const TODAY_ICON = (
  <>
    <rect x="3" y="4" width="18" height="17" rx="2" />
    <line x1="3" y1="9" x2="21" y2="9" />
    <line x1="7" y1="2" x2="7" y2="6" />
    <line x1="17" y1="2" x2="17" y2="6" />
  </>
);
const PATIENTS_ICON = (
  <>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
  </>
);
const QUEUE_ICON = (
  <>
    <line x1="9" y1="6" x2="20" y2="6" />
    <line x1="9" y1="12" x2="20" y2="12" />
    <line x1="9" y1="18" x2="20" y2="18" />
    <circle cx="4.5" cy="6" r="1.4" />
    <circle cx="4.5" cy="12" r="1.4" />
    <circle cx="4.5" cy="18" r="1.4" />
  </>
);
const INVOICES_ICON = (
  <>
    <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2z" />
    <line x1="9" y1="7" x2="15" y2="7" />
    <line x1="9" y1="11" x2="15" y2="11" />
  </>
);
const REPORTS_ICON = (
  <>
    <line x1="5" y1="20" x2="5" y2="12" />
    <line x1="12" y1="20" x2="12" y2="6" />
    <line x1="19" y1="20" x2="19" y2="15" />
  </>
);
const SETTINGS_ICON = (
  <>
    <line x1="4" y1="6" x2="20" y2="6" />
    <circle cx="9" cy="6" r="2" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <circle cx="15" cy="12" r="2" />
    <line x1="4" y1="18" x2="20" y2="18" />
    <circle cx="9" cy="18" r="2" />
  </>
);

interface SidebarItemConfig {
  key: "day" | "patients" | "queue" | "invoices" | "reports" | "settings";
  label: string;
  icon: ReactNode;
}

// Fixed order from clintra-screens.html's NAV array: اليوم · المرضى ·
// الطابور · الفواتير · التقارير · الإعدادات.
const SIDEBAR_ITEMS: readonly SidebarItemConfig[] = [
  { key: "day", label: sidebarStrings.navDay, icon: TODAY_ICON },
  { key: "patients", label: sidebarStrings.navPatients, icon: PATIENTS_ICON },
  { key: "queue", label: sidebarStrings.navQueue, icon: QUEUE_ICON },
  { key: "invoices", label: sidebarStrings.navInvoices, icon: INVOICES_ICON },
  { key: "reports", label: sidebarStrings.navReports, icon: REPORTS_ICON },
  { key: "settings", label: sidebarStrings.navSettings, icon: SETTINGS_ICON },
];

// Permanently disabled regardless of role — a later task each, per the owner
// decision. "settings" is handled separately below: it is live for an owner,
// not "coming soon" for anyone else.
const COMING_SOON_KEYS = new Set<SidebarItemConfig["key"]>(["patients", "queue", "invoices", "reports"]);

/** The reference's .fn div.on treatment: pine text, medium weight, light-green fill. */
function activeItemClassName(isActive: boolean): string {
  return isActive
    ? "flex flex-col items-center gap-0.5 rounded-[--radius-el] bg-green-soft px-2 py-1.5 text-center text-green sm:flex-row sm:justify-start sm:gap-2 sm:px-3 sm:py-2"
    : "flex flex-col items-center gap-0.5 rounded-[--radius-el] px-2 py-1.5 text-center text-muted hover:bg-line-soft hover:text-ink sm:flex-row sm:justify-start sm:gap-2 sm:px-3 sm:py-2";
}

/**
 * The app-wide navigation shell — clintra-screens.html's shared sidebar
 * (`.fn`/`.fn div`/`.fn div.on` inside its `shell()` mockup helper, reused
 * across every screen 1-19 mockup via the NAV array) made persistent and
 * real. That file is itself a two-level tool: an outer `aside`/`.brand`
 * used only to browse between mockups, and this inner `.fn` list
 * representing the actual app's own sidebar (which the mockup never gives a
 * brand of its own, since the outer browsing chrome already has one). Our
 * app has only one level of chrome, so the brand + its `.brand .n` styling
 * (Readex Pro, "tra" in pine) moves here, as the owner decided, rather than
 * living in the day screen's own header.
 *
 * Six items in the reference's fixed order; only "اليوم" and "الإعدادات"
 * open a real screen today. The rest render disabled with a muted "جاي
 * قريب" note instead of being hidden, so the eventual shape of the app is
 * visible from day one (see docs/schema.md's "future seams built empty now"
 * principle — the same idea applied to navigation, not just data). Settings
 * is a third, narrower case: live for an owner, otherwise structurally
 * absent (not merely disabled) — the exact access rule the day screen's own
 * settings entry always enforced, preserved here rather than changed.
 *
 * Below 640px the rail becomes a fixed bottom bar rather than a side rail.
 * The reference's own outer shell collapses its aside into a full-width
 * horizontal strip below 900px
 * (`@media(max-width:900px){aside{position:static;...;border-bottom:1px solid var(--rule)}}`);
 * a fixed bottom bar is that same idea taken one step further, appropriate
 * here because this rail carries live navigation, not just a browsing aid.
 * Every item keeps the same icon+label(+hint) content at every width —
 * only the container's own flex direction and sizing change — so nothing
 * this shell needs to expose to a script (the "جاي قريب" hint, in
 * particular) is ever hidden by width alone.
 */
export default function AppShell({ activeItem, onSelectDay, settingsEnabled, onSelectSettings, children }: AppShellProps) {
  function renderItem(item: SidebarItemConfig) {
    if (item.key === "day") {
      const isActive = activeItem === "day";
      return (
        <button
          key={item.key}
          type="button"
          onClick={onSelectDay}
          aria-current={isActive ? "page" : undefined}
          className={activeItemClassName(isActive)}
        >
          <SidebarIcon path={item.icon} />
          <span className="text-[11px] sm:text-sm">{item.label}</span>
        </button>
      );
    }

    if (item.key === "settings" && settingsEnabled) {
      const isActive = activeItem === "settings";
      return (
        <button
          key={item.key}
          type="button"
          onClick={onSelectSettings}
          aria-current={isActive ? "page" : undefined}
          className={activeItemClassName(isActive)}
        >
          <SidebarIcon path={item.icon} />
          <span className="text-[11px] sm:text-sm">{item.label}</span>
        </button>
      );
    }

    // Not a <button> at all, deliberately: the four not-yet-built sections
    // are visible-but-inert, and settings for a non-owner stays exactly as
    // absent from the accessibility tree as it always was — a script asking
    // "is there a settings button" gets the same answer as before this task.
    return (
      <div key={item.key} className="flex flex-col items-center gap-0.5 px-2 py-1.5 text-center opacity-40 sm:items-start sm:px-3 sm:py-2">
        <span className="flex flex-col items-center gap-0.5 sm:flex-row sm:gap-2">
          <SidebarIcon path={item.icon} />
          <span className="text-[11px] sm:text-sm">{item.label}</span>
        </span>
        {COMING_SOON_KEYS.has(item.key) && <span className="text-[9px] text-muted sm:text-xs">{sidebarStrings.comingSoonHint}</span>}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col-reverse sm:flex-row">
      <nav
        aria-label={sidebarStrings.navAriaLabel}
        // z-20, matching Sheet.tsx: the two never geometrically overlap
        // (Sheet reserves this bar's height at the bottom below sm: — see
        // Sheet.tsx), so their relative stacking order no longer matters,
        // but both sit above the day screen's own floating action buttons
        // (z-10) and below LockScreen's z-50, which must always win.
        className="fixed inset-x-0 bottom-0 z-20 flex items-stretch justify-around border-t border-line bg-paper px-1 py-1 sm:static sm:h-screen sm:w-56 sm:flex-col sm:items-stretch sm:justify-start sm:gap-1 sm:border-e sm:border-t-0 sm:p-3"
      >
        <div className="hidden sm:mb-3 sm:block">
          <p className="font-display text-xl font-semibold">
            Clin<span className="text-green">tra</span>
          </p>
        </div>
        {SIDEBAR_ITEMS.map(renderItem)}
      </nav>
      <div className="min-w-0 flex-1 pb-16 sm:pb-0">{children}</div>
    </div>
  );
}

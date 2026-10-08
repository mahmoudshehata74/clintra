import type { ReactNode } from "react";
import { authStrings } from "../auth/authStrings";
import { clearActiveSession } from "../auth/session";
import { useActingMembership } from "../auth/useActingMembership";
import { db } from "../db/database";
import { useLiveQuery } from "../db/useLiveQuery";
import { navItemsFor, type NavItem } from "../domain/navigation";
import type { Role } from "../domain/role";
import type { ClinicDay } from "../domain/time";
import SyncStatusChip from "../screens/day/SyncStatusChip";
import { formatAppBarDate } from "./appBarDate";
import Button from "./ui/Button";
import { appBarStrings, sidebarStrings } from "./strings";

interface AppShellProps {
  role: Role;
  activeItem: NavItem["key"];
  onSelect: (key: NavItem["key"]) => void;
  /** The current screen's own title — e.g. "يوم العيادة". */
  title: ReactNode;
  /** The day currently on screen — one source with the grid below it, since a dev-only affordance can pin it away from the real current day. */
  today: ClinicDay;
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

const ICON_PATHS: Record<NavItem["key"], ReactNode> = {
  day: (
    <>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <line x1="3" y1="9" x2="21" y2="9" />
      <line x1="7" y1="2" x2="7" y2="6" />
      <line x1="17" y1="2" x2="17" y2="6" />
    </>
  ),
  settings: (
    <>
      <line x1="4" y1="6" x2="20" y2="6" />
      <circle cx="9" cy="6" r="2" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <circle cx="15" cy="12" r="2" />
      <line x1="4" y1="18" x2="20" y2="18" />
      <circle cx="9" cy="18" r="2" />
    </>
  ),
};

// An un-pressed item (`.tb-nav button`'s own look: transparent, on-dark-dim,
// hover lightens). The active look (lighter fill + a copper marker) is not
// in the prototype's own `.tb-nav` rule — it never draws a pressed state —
// so it's designed here: a copper edge on the side that reads as "forward"
// in each layout (the bottom edge of a bottom-bar pill, the leading edge of
// a rail row).
//
// Border/background/text colour live in ITEM_INACTIVE/ITEM_ACTIVE below, not
// here, so exactly one class of each ever applies — never both an inactive
// and an active colour utility on the same render. Tailwind's cascade is by
// generated-sheet order, not by position in the className string (see
// Button.tsx's BASE comment), so two classes setting the same property would
// leave the winner up to that order instead of to isActive.
const ITEM_BASE =
  "flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-chip border-b-2 px-2 py-1.5 text-center text-[11px] font-medium transition-colors duration-150 " +
  "hover:bg-white/[0.10] hover:text-on-dark " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green focus-visible:ring-offset-2 focus-visible:ring-offset-ink " +
  "sm:w-full sm:flex-none sm:flex-row sm:justify-start sm:gap-2 sm:border-b-0 sm:border-s-2 sm:px-3 sm:py-2 sm:text-sm";

// At rest: transparent border (reserved so taking the active state never
// shifts the row's size), no background fill, dim on-dark text.
const ITEM_INACTIVE = "border-transparent bg-transparent text-on-dark-dim";
const ITEM_ACTIVE = "border-copper bg-white/[0.14] text-on-dark";

/**
 * The app-wide navigation rail, in the prototype's own dark-chrome language:
 * the ink-gradient surface and copper accent edge `.topbar` uses, the brand
 * block `.appbar .brand`/`.brand .logo`/`.brand-t` draws, and each item
 * styled after `.tb-nav button` (adapted from that control's own horizontal
 * segmented layout to this rail's vertical one — the prototype never shows
 * a sidebar at all; "navigation is a role-dependent sidebar" is a settled
 * deviation from it, per docs/design-rule.md).
 *
 * Items come from navItemsFor(role) — today "day" (every role) and
 * "settings" (owner only, the same gate the day screen's own settings entry
 * always used). Rendering is generic over whatever that returns, so a later
 * task that appends an item needs no change here, only an icon entry above.
 *
 * Below the `sm` breakpoint the rail becomes a fixed bottom bar instead of a
 * side rail. Both the rail/bottom-bar and the app bar below sit at z-40 —
 * above Sheet.tsx's own backdrop (z-30), which dims the whole viewport
 * (including this chrome) when a sheet is open but must never block a tap on
 * it: the sidebar stays usable while settings is open, and the lock action
 * stays reachable mid-booking, by real browser hit-testing rather than
 * pointer-events tricks, since this chrome is genuinely always interactive.
 * Both still sit below LockScreen's z-50, which must always win regardless
 * of width.
 */
// The brand tile shared by the rail (sm+) and the app bar's own mobile-only
// brand block (below `sm`, where the rail becomes a bottom bar with no room
// for it) — `.brand .logo` reproduced once rather than duplicated inline.
function BrandLogo() {
  return (
    <div className="flex h-8 w-8 flex-none items-center justify-center rounded-control bg-[linear-gradient(135deg,var(--color-green-2)_0%,var(--color-green)_100%)] text-sm font-bold text-white shadow-[0_2px_8px_rgba(0,0,0,.35)]">
      C
    </div>
  );
}

/**
 * The dark app bar above every screen (prototype's `.appbar`, `.brand`,
 * `.who`, `.date`, `.app-btn`). Owns its own chrome end to end — the acting
 * member's name/avatar, the lock action and the date are all resolved here,
 * independent of whatever screen is mounted; `title` is the one thing a
 * screen supplies (DayScreen.tsx's own subtitle, e.g. "يوم العيادة").
 *
 * Below `sm` (the bottom-bar breakpoint, where the rail carries no brand of
 * its own) the leading slot is the brand block; from `sm` up the rail already
 * shows the brand, so the bar's own leading slot is the title, rendered as a
 * real `<h1>` for accessibility either way — visually hidden on mobile
 * (sr-only) rather than removed, so exactly one page heading always exists.
 *
 * `today` is screen-supplied too, the same as `title` — this bar never calls
 * todayInCairo() itself, so its date block can never disagree with whatever
 * day the screen below it is actually showing (a dev-only affordance can pin
 * that away from the real current day).
 */
function AppBar({ title, today }: { title: ReactNode; today: ClinicDay }) {
  const actingMembership = useActingMembership();
  const actingUser = useLiveQuery(
    async () => (actingMembership ? db.users.get(actingMembership.user_id) : undefined),
    [actingMembership?.user_id],
  );
  const { dateLine, weekdayLine } = formatAppBarDate(today);

  return (
    <header className="sticky top-0 z-40 flex flex-wrap items-center gap-3.5 bg-[linear-gradient(135deg,var(--color-ink)_0%,var(--color-ink-2)_100%)] px-5 py-[11px] text-on-dark shadow-m print:hidden">
      <div className="me-auto flex items-center gap-2.5">
        <div className="flex items-center gap-2.5 sm:hidden">
          <BrandLogo />
          <div>
            <p className="text-base font-semibold leading-[1.15] tracking-[-0.01em] text-on-dark">
              {appBarStrings.brandName}
            </p>
            <p className="text-[10px] tracking-[0.06em] text-on-dark-dim">{title}</p>
          </div>
        </div>
        <h1 className="sr-only text-sm font-semibold tracking-[-0.005em] text-on-dark sm:not-sr-only">{title}</h1>
      </div>

      <SyncStatusChip />

      {actingUser && (
        <div className="flex items-center gap-2 rounded-control border border-white/[0.14] bg-white/[0.06] px-3 py-[5px] text-xs text-on-dark">
          <span className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-[linear-gradient(135deg,var(--color-copper)_0%,var(--color-copper-2)_100%)] text-[11px] font-bold text-white">
            {actingUser.full_name.charAt(0)}
          </span>
          <span>{actingUser.full_name}</span>
        </div>
      )}

      <Button variant="onDark" size="sm" onClick={() => clearActiveSession()}>
        {authStrings.lockButtonLabel}
      </Button>

      <div className="flex flex-col gap-px border-s border-white/[0.13] ps-3 text-end">
        <span className="text-[12.5px] font-semibold tracking-[-0.01em] text-on-dark tabular-nums">{dateLine}</span>
        <span className="text-[10px] tracking-[0.04em] text-on-dark-dim">{weekdayLine}</span>
      </div>
    </header>
  );
}

export default function AppShell({ role, activeItem, onSelect, title, today, children }: AppShellProps) {
  const items = navItemsFor(role);

  return (
    <div className="flex min-h-screen flex-col-reverse sm:flex-row">
      <nav
        aria-label={sidebarStrings.navAriaLabel}
        className="fixed inset-x-0 bottom-0 z-40 flex items-stretch gap-1 border-t-2 border-copper bg-[linear-gradient(135deg,var(--color-ink)_0%,var(--color-ink-2)_100%)] px-2 py-1.5 shadow-m print:hidden sm:sticky sm:top-0 sm:h-screen sm:w-56 sm:flex-col sm:items-stretch sm:gap-1 sm:border-e-2 sm:border-t-0 sm:p-3"
      >
        <div className="hidden items-center gap-[10px] px-1 pb-4 sm:flex">
          <BrandLogo />
          <p className="text-base font-semibold leading-[1.15] tracking-[-0.01em] text-on-dark">
            {appBarStrings.brandName}
          </p>
        </div>

        {items.map((item) => {
          const isActive = item.key === activeItem;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => onSelect(item.key)}
              aria-current={isActive ? "page" : undefined}
              className={`${ITEM_BASE} ${isActive ? ITEM_ACTIVE : ITEM_INACTIVE}`}
            >
              <SidebarIcon path={ICON_PATHS[item.key]} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="min-w-0 flex-1 pb-16 sm:pb-0">
        <AppBar title={title} today={today} />
        {children}
      </div>
    </div>
  );
}

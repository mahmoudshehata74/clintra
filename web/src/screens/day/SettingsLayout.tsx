import type { ReactNode } from "react";
import { CardFooter } from "../../components/ui/Card";

/**
 * Settings screens' shared layout, prototype #s12–14: `.set-body`,
 * `.set-list`, `.set-row` (+ `.svc` / `.staff` column templates) and the
 * `.runrow` footer. Each panel composes these; none of them own data.
 */

/** `.set-body` — the padded area under the tabs. */
export function SetBody({ children }: { children: ReactNode }) {
  return <div className="px-[18px] py-4">{children}</div>;
}

/** `.set-list` — a real list, so each row stays a listitem. */
export function SetList({ children }: { children: ReactNode }) {
  return <ul className="flex flex-col gap-2">{children}</ul>;
}

export type SetRowLayout = "hours" | "service" | "staff";

// `.set-row` (110px 1fr auto), `.set-row.svc` (1fr auto auto auto auto),
// `.set-row.staff` (1fr auto auto auto). Below 600px (the prototype's own
// narrow breakpoint) the hours row's fixed 110px day column gives way to
// auto, so the three parts still fit one line on a phone.
const ROW_COLUMNS: Record<SetRowLayout, string> = {
  hours: "grid-cols-[110px_1fr_auto] max-[600px]:grid-cols-[auto_1fr_auto]",
  service: "grid-cols-[1fr_auto_auto_auto_auto]",
  staff: "grid-cols-[1fr_auto_auto_auto]",
};

interface SetRowProps {
  layout: SetRowLayout;
  /** `.set-row.svc[style="opacity:.6"]` — a stopped service (or inactive member) reads with reduced emphasis. */
  muted?: boolean;
  children: ReactNode;
  /** An inline editor opened from this row's "تعديل"; spans the whole row under its own columns. */
  editor?: ReactNode;
}

/** `.set-row` — the framed row; its border radius (10px) collapses to the card token. */
export function SetRow({ layout, muted = false, children, editor }: SetRowProps) {
  return (
    <li
      className={`grid items-center gap-3 rounded-card border border-rule bg-card px-3.5 py-3 ${ROW_COLUMNS[layout]} ${muted ? "opacity-60" : "opacity-100"}`}
    >
      {children}
      {editor && <div className="col-span-full border-t border-hair pt-3">{editor}</div>}
    </li>
  );
}

/** `.runrow`, pinned to the bottom of the sheet's own scroll area like SheetPanelFoot. */
export function SettingsFooter({ children, count }: { children?: ReactNode; count?: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10">
      <CardFooter count={count}>{children}</CardFooter>
    </div>
  );
}

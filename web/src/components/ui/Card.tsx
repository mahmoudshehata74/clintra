import type { ReactNode } from "react";

export type CardHeadingLevel = 2 | 3 | 4 | 5 | 6;

export interface CardProps {
  children: ReactNode;
  className?: string;
}

/**
 * Prototype source: `.c-card`, `.c-head`, `.c-head .badge`, `.c-head h3`,
 * `.c-head .sub`, `.c-head .sp`, `.c-body`, `.runrow`, `.runrow .count`
 * (docs/reference/clintra-prototype.html). Card is just the clipped frame —
 * CardHead, CardBody and CardFooter compose inside it. CardBody is its own
 * piece rather than Card's only way to hold content, because some cards
 * (the day's appointment list) sit flush against the frame with no padding;
 * for those, pass children to Card directly instead of wrapping them in
 * CardBody.
 */
export default function Card({ children, className }: CardProps) {
  const classes = ["overflow-hidden rounded-panel border border-rule bg-card shadow-s", className ?? ""]
    .filter(Boolean)
    .join(" ");
  return <div className={classes}>{children}</div>;
}

export interface CardHeadProps {
  /** `.c-head .badge` — a short leading label, e.g. "اليوم". */
  badge?: string;
  title: ReactNode;
  /** Heading level for `title`; the prototype always renders `<h3>`, but callers nest cards at different depths. */
  level?: CardHeadingLevel;
  subtitle?: ReactNode;
  /** `.c-head`'s trailing slot — e.g. the onDark sm "ورقة الغد" button. */
  action?: ReactNode;
}

/** The dark gradient head row: optional badge, a title/subtitle block, and a trailing action. */
export function CardHead({ badge, title, level = 3, subtitle, action }: CardHeadProps) {
  const Heading = `h${level}` as "h2" | "h3" | "h4" | "h5" | "h6";

  return (
    <div className="flex items-center gap-3 bg-[linear-gradient(135deg,var(--color-ink)_0%,var(--color-ink-2)_120%)] px-[18px] py-3 text-on-dark">
      {badge ? (
        <span className="rounded-chip border border-white/[0.14] bg-white/[0.08] px-[9px] py-[3px] text-[10.5px] font-semibold tracking-[0.05em] text-on-dark-dim">
          {badge}
        </span>
      ) : null}
      <div className="me-auto">
        <Heading className="m-0 text-sm font-semibold tracking-[-0.005em]">{title}</Heading>
        {subtitle ? <div className="-mt-px text-[11px] text-on-dark-dim">{subtitle}</div> : null}
      </div>
      {action}
    </div>
  );
}

export interface CardBodyProps {
  children: ReactNode;
}

/** `.c-body` — the padded content area. */
export function CardBody({ children }: CardBodyProps) {
  return <div className="px-[18px] py-4">{children}</div>;
}

export interface CardFooterProps {
  /** `.runrow`'s action buttons. */
  children?: ReactNode;
  /** `.runrow .count` — bold (`<b>`) segments render in the `text` token, matching the prototype's own `.runrow .count b`. */
  count?: ReactNode;
}

/** `.runrow` — the footer strip: actions, then a trailing count pushed to the end. */
export function CardFooter({ children, count }: CardFooterProps) {
  return (
    <div className="flex flex-wrap items-center gap-[10px] border-t border-hair bg-field px-[18px] py-[14px]">
      {children}
      {count ? (
        <span className="ms-auto text-[11.5px] text-muted tabular-nums [&>b]:font-bold [&>b]:text-text">{count}</span>
      ) : null}
    </div>
  );
}

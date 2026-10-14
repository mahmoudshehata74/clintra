import type { ReactNode } from "react";

interface PageMainProps {
  /** Vertical padding, layout and print classes only — the width and the side padding are this component's. */
  className?: string;
  children: ReactNode;
}

/**
 * Every rail page's content column (the day, the doctor's day, the current
 * visit, the patients page and profile, the messages page): one shared
 * width, `max-w-page` (1116px — the prototype's `.app` frame inside its
 * 1160px `.screen`), centred, with `.content`'s own side padding (20px,
 * 12px below 600px). A narrower viewport simply gives the column all the
 * width beside the rail.
 */
export default function PageMain({ className, children }: PageMainProps) {
  const classes = className
    ? `mx-auto w-full max-w-page px-5 max-[600px]:px-3 ${className}`
    : "mx-auto w-full max-w-page px-5 max-[600px]:px-3";
  return <main className={classes}>{children}</main>;
}

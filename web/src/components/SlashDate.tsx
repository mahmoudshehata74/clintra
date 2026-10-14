interface SlashDateProps {
  /** A formatted "d / m" or "d / m / yyyy" (domain/slashDate.ts). */
  children: string;
  className?: string;
}

/**
 * A slash date isolated in right-to-left order, so the day always sits on
 * the right — the prototype's own rendering (`.rx-num`, `.plan-legs`,
 * `.pt-hero .meta`) — whatever surrounds it, on screen and on paper.
 */
export default function SlashDate({ children, className }: SlashDateProps) {
  return (
    <bdi dir="rtl" className={className}>
      {children}
    </bdi>
  );
}

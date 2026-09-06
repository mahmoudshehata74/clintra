import type { ReactNode } from "react";

interface LtrProps {
  children: ReactNode;
  className?: string;
}

export default function Ltr({ children, className }: LtrProps) {
  const classes = className ? `ltr-run ${className}` : "ltr-run";
  return (
    <bdi dir="ltr" className={classes}>
      {children}
    </bdi>
  );
}

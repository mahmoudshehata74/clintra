import type { ReactNode } from "react";

/**
 * Prototype source (docs/reference/clintra-prototype.html #s8): `.print-page`,
 * `.print-header`, `.print-clinic`, `.print-day`, `.print-tbl`, `.mono`,
 * `.print-foot`. Shared by the day sheet (DaySheet.tsx) and InvoiceSheet.tsx's
 * invoice/receipt prints — the one visual language for every printed page in
 * the app, rendered twice by each caller: once as the on-screen preview
 * (inside a Sheet, wrapped `print:hidden`) and once as the flat print target
 * (`hidden print:block`, outside the sheet's own fixed/overflow dialog, since
 * a position:fixed, overflow-clipped element does not print reliably).
 *
 * Structural chrome (radius, border, shadow) stays on this app's own design
 * tokens — only the page's own background/ink colours are the plain
 * black/white/grey keywords design-rule.md's print exception allows, since
 * these are the colours that actually go on paper.
 */
export function PrintPage({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-[600px] rounded-panel border border-rule bg-white p-8 text-black shadow-l">{children}</div>;
}

/** `.print-header` — the placeholder/warning note; its text differs by context (see each caller) but never its own look. */
export function PrintHeaderNote({ children }: { children: ReactNode }) {
  return (
    <p className="mb-5 rounded-control border border-dashed border-black/30 bg-black/5 p-3 text-center text-[12.5px] font-semibold text-black/70">
      {children}
    </p>
  );
}

/** `.print-clinic` — the clinic's own name, and address · phone from the location, each omitted when empty. */
export function PrintClinicBlock({ name, addressLine }: { name: string | null; addressLine: string | null }) {
  if (!name && !addressLine) {
    return null;
  }
  return (
    <div className="mb-[22px] text-center">
      {name && <p className="text-[19px] font-bold tracking-[-0.01em] text-black">{name}</p>}
      {addressLine && <p className="mt-0.5 text-xs text-black/60">{addressLine}</p>}
    </div>
  );
}

/** `.print-day` */
export function PrintDayLine({ children }: { children: ReactNode }) {
  return <p className="mb-3.5 border-y-[1.5px] border-black py-3 text-center text-[14.5px] font-semibold text-black">{children}</p>;
}

/** `.print-tbl` */
export function PrintTable({ children }: { children: ReactNode }) {
  return <table className="w-full border-collapse tabular-nums">{children}</table>;
}

/** `.print-tbl th` */
export function PrintTh({ children }: { children: ReactNode }) {
  return (
    <th className="border-b border-black/15 bg-black/5 px-2.5 py-[9px] text-start text-[11.5px] font-bold uppercase tracking-[0.05em] text-black/60">
      {children}
    </th>
  );
}

/** `.print-tbl td` — pass `mono` for `.print-tbl td .mono` (the phone column), `colSpan` for a full-width row (e.g. an empty-list message). */
export function PrintTd({ children, mono, colSpan }: { children: ReactNode; mono?: boolean; colSpan?: number }) {
  const monoClass = mono ? "font-mono text-[11.5px] text-black/70" : "text-[13px] text-black";
  return (
    <td colSpan={colSpan} className={`border-b border-black/15 px-2.5 py-[9px] ${monoClass}`}>
      {children}
    </td>
  );
}

/** `.print-foot` */
export function PrintFoot({ printedAt }: { printedAt: string }) {
  return (
    <div className="mt-5 flex justify-between border-t border-dashed border-black/20 pt-3 text-[11px] text-black/60">
      <span>{printedAt}</span>
      <span>Clintra</span>
    </div>
  );
}

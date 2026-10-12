import type { ReactNode } from "react";
import Ltr from "../../components/Ltr";
import { PrintPage } from "../day/PrintPage";
import type { RxPrintDrug, RxPrintModel } from "./printModel";
import { prescriptionPrintStrings as T } from "./strings";

/**
 * Prototype source (docs/reference/clintra-prototype.html #s16):
 * `.rx-print-page`, `.rx-print-header`, `.rx-doc` (`.doc-name`, `.doc-spec`,
 * `.rx-num`), `.rx-pt`, `.rx-title`, `.rx-drug` (`.num`, `.body .n`,
 * `.dose`, `.note`), `.rx-sig` (`.stamp`). Rendered twice by
 * PrescriptionPrintSheet, as every printed page is (see day/PrintPage.tsx):
 * once as the on-screen preview, with `.rx-print-header`, and once as the
 * flat print target, without it.
 *
 * On screen, `.rx-print-page` is `.print-page` (same white page, padding,
 * border, shadow and width), so the preview is the shared PrintPage. On
 * paper it is plain paper: no border, radius, shadow, card background,
 * width cap or padding — the margin is `@page prescription`'s (index.css).
 * A drug never splits across two pages, and `.rx-sig` stays on the page of
 * the last drug: the two share one unbreakable block. Colours on paper are
 * the plain black/white/grey keywords design-rule.md's print exception
 * allows; the screen-only `.rx-print-header` uses the warning tokens.
 */
export default function RxPrintPage({ model, preview }: { model: RxPrintModel; preview: boolean }) {
  const lastDrug = model.drugs.at(-1);
  return (
    <RxPaper preview={preview}>
      {preview && (
        <p className="mb-5 rounded-control border-[1.5px] border-dashed border-warning bg-warning-wash px-3.5 py-3 text-center text-xs font-semibold text-warning">
          {T.previewNote}
        </p>
      )}

      {/* `.rx-doc` */}
      <div className="mb-4 flex items-start justify-between gap-4 border-b-2 border-black pb-3.5">
        <div>
          <p className="text-[17px] font-bold tracking-[-0.01em] text-black">{model.doctorName}</p>
          {model.doctorSpec && <DoctorSpec spec={model.doctorSpec} />}
          <ClinicSpec clinic={model.clinic} />
        </div>
        <div className="flex-none text-end font-mono text-xs text-black/60 tabular-nums">
          <p>
            <Ltr>{model.number}</Ltr>
          </p>
          <p>
            <Ltr>{model.date}</Ltr>
          </p>
        </div>
      </div>

      {/* `.rx-pt` */}
      <div className="mb-4 flex flex-wrap justify-between gap-2 rounded-control bg-black/2 px-3.5 py-2.5 text-[12.5px] text-black">
        <p>
          <b className="font-semibold">{T.patientLabel}</b> {model.patientName}
        </p>
        {model.age !== null && (
          <p>
            <b className="font-semibold">{T.ageLabel}</b> <Ltr>{model.age}</Ltr> {T.ageUnit}
          </p>
        )}
        {model.diagnosis && (
          <p>
            <b className="font-semibold">{T.diagnosisLabel}</b> {model.diagnosis}
          </p>
        )}
      </div>

      {/* `.rx-title`, its `::after` rule drawn as a span */}
      <div dir="ltr" className="mb-2.5 flex items-baseline gap-2 text-[15px] font-bold text-black">
        Rx
        <span aria-hidden="true" className="flex-1 border-b-[1.5px] border-black" />
      </div>

      {model.drugs.length > 1 && (
        <ol>
          {model.drugs.slice(0, -1).map((drug) => (
            <RxDrug key={drug.number} drug={drug} isLast={false} />
          ))}
        </ol>
      )}

      {/* The last `.rx-drug` and `.rx-sig`, kept together on one page. */}
      <div className="break-inside-avoid">
        {lastDrug && (
          <ol start={lastDrug.number}>
            <RxDrug drug={lastDrug} isLast />
          </ol>
        )}

        {/* `.rx-sig` */}
        <div className="mt-[22px] flex justify-between border-t border-dashed border-black/20 pt-3.5 text-[11px] text-black/60">
          <p>
            <span className="font-bold text-black">{T.signature}</span> · {model.doctorName}
          </p>
          <p>{T.stamp}</p>
        </div>
      </div>
    </RxPaper>
  );
}

/** The preview's `.print-page` card on screen; plain paper in the print target. */
function RxPaper({ preview, children }: { preview: boolean; children: ReactNode }) {
  return preview ? <PrintPage>{children}</PrintPage> : <div className="bg-white text-black">{children}</div>;
}

/** `.rx-drug`: never split across two pages; the last one has no rule under it. */
function RxDrug({ drug, isLast }: { drug: RxPrintDrug; isLast: boolean }) {
  return (
    <li
      className={`flex break-inside-avoid items-start gap-3.5 py-3 ${isLast ? "" : "border-b border-dashed border-black/20"}`}
    >
      <span className="flex h-7 w-7 flex-none items-center justify-center rounded-chip bg-black text-[13px] font-bold text-white">
        <Ltr>{drug.number}</Ltr>
      </span>
      <div>
        <p className="text-[14.5px] font-bold tracking-[-0.005em] text-black">
          <Ltr>{drug.name}</Ltr>
        </p>
        <p className="mt-[3px] text-xs text-black/80 tabular-nums">{drug.dose}</p>
        {drug.note && <p className="mt-0.5 text-[11.5px] text-black/60 italic">{drug.note}</p>}
      </div>
    </li>
  );
}

/**
 * The first `.doc-spec` line: "{title} · رقم النقابة {n}", either part left
 * out when the practitioner has none (printModel.ts); the number is its own
 * left-to-right run.
 */
function DoctorSpec({ spec }: { spec: NonNullable<RxPrintModel["doctorSpec"]> }) {
  return (
    <p className="mt-0.5 text-[11.5px] text-black/65">
      {spec.title}
      {spec.title !== null && spec.syndicateNumber !== null && " · "}
      {spec.syndicateNumber !== null && (
        <>
          {T.syndicatePrefix} <Ltr>{spec.syndicateNumber}</Ltr>
        </>
      )}
    </p>
  );
}

/**
 * The second `.doc-spec` line: the clinic, from printClinic like every other
 * printed page — not PrintClinicBlock's centred block but, as `.rx-doc`
 * shows it, one line ("{organization} · {location} · {address}
 * · {phone}"), the phone its own left-to-right run.
 */
function ClinicSpec({ clinic }: { clinic: RxPrintModel["clinic"] }) {
  const parts = [...(clinic.title ? [clinic.title] : []), ...clinic.details];
  if (parts.length === 0) {
    return null;
  }
  return (
    <p className="mt-0.5 text-[11.5px] text-black/65">
      {parts.map((part, index) => (
        <span key={index}>
          {index > 0 && " · "}
          {clinic.phone !== null && index === parts.length - 1 ? <Ltr>{part}</Ltr> : part}
        </span>
      ))}
    </p>
  );
}

import type { ReactNode } from "react";
import Field, { TextArea, TextInput } from "../../components/ui/Field";
import { fieldGalleryStrings, galleryStrings } from "../strings";

function Row({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold text-muted">{heading}</p>
      <div className="max-w-xs">{children}</div>
    </div>
  );
}

/**
 * Every Field state the task calls for, each on the field it actually
 * appears on in the prototype (or, for the error addition, the closest
 * fit) — see strings.ts's fieldGalleryStrings doc comment for sourcing.
 */
export default function FieldSection() {
  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-lg font-semibold text-text">{galleryStrings.fieldsSectionTitle}</h2>

      <div className="flex flex-col gap-6">
        <Row heading={fieldGalleryStrings.emptyHeading}>
          <Field label={fieldGalleryStrings.searchLabel} id="gallery-field-search-empty">
            <TextInput />
          </Field>
        </Row>

        <Row heading={fieldGalleryStrings.focusedHeading}>
          <Field label={fieldGalleryStrings.searchLabel} id="gallery-field-search-focused">
            <TextInput />
          </Field>
          <p className="mt-1 text-[10.5px] text-faint">{fieldGalleryStrings.focusedCaption}</p>
        </Row>

        <Row heading={fieldGalleryStrings.filledHeading}>
          <Field label={fieldGalleryStrings.searchLabel} id="gallery-field-search-filled">
            <TextInput defaultValue={fieldGalleryStrings.searchFilledValue} />
          </Field>
        </Row>

        <Row heading={fieldGalleryStrings.complaintHeading}>
          <Field label={fieldGalleryStrings.complaintLabel} id="gallery-field-complaint" hint={fieldGalleryStrings.complaintHint}>
            <TextArea defaultValue={fieldGalleryStrings.complaintValue} />
          </Field>
        </Row>

        <Row heading={fieldGalleryStrings.errorHeading}>
          <Field label={fieldGalleryStrings.phoneLabel} id="gallery-field-phone-error" error={fieldGalleryStrings.phoneError}>
            <TextInput defaultValue={fieldGalleryStrings.phoneValue} />
          </Field>
        </Row>

        <Row heading={fieldGalleryStrings.disabledHeading}>
          <Field label={fieldGalleryStrings.noteLabel} id="gallery-field-note-disabled">
            <TextInput placeholder={fieldGalleryStrings.notePlaceholder} disabled />
          </Field>
        </Row>

        <Row heading={fieldGalleryStrings.codeHeading}>
          <Field label={fieldGalleryStrings.codeLabel} id="gallery-field-code">
            <TextInput variant="mono" defaultValue={fieldGalleryStrings.codeValue} />
          </Field>
        </Row>

        <Row heading={fieldGalleryStrings.amountHeading}>
          <Field label={fieldGalleryStrings.amountLabel} id="gallery-field-amount" hint={fieldGalleryStrings.amountHint}>
            <TextInput variant="amount" defaultValue={fieldGalleryStrings.amountValue} />
          </Field>
        </Row>
      </div>
    </section>
  );
}

import { useState } from "react";
import Ltr from "../../components/Ltr";
import Button from "../../components/ui/Button";
import { TextInput } from "../../components/ui/Field";
import ToggleGroup from "../../components/ui/ToggleGroup";
import { db } from "../../db/database";
import { saveInvoiceItems } from "../../db/invoiceItems";
import type { Invoice, InvoiceItem, Service, ServicePriceOverride } from "../../db/types";
import { id } from "../../domain/id";
import { invoiceTotalOf, lineTotal } from "../../domain/invoiceItemEdit";
import type { Piastres } from "../../domain/money";
import { resolveServicePrice } from "../../domain/pricing";
import { formatMoneyAmount } from "../money";
import {
  editLineFromInput,
  lineFromItem,
  piastresToPoundsInput,
  saveRefusalMessage,
  validateEditLines,
  type EditLineInput,
} from "./invoiceItemsForm";
import { dayScreenStrings as S } from "./strings";

interface InvoiceItemsEditorProps {
  invoice: Invoice;
  items: readonly InvoiceItem[];
  /** The services a line can be added from: the active ones. */
  services: readonly Service[];
  overrides: readonly ServicePriceOverride[];
  onDone: () => void;
}

/**
 * The invoice sheet's edit mode ("تعديل بنود"): each line's quantity and
 * price, a line removed, a service added at its price for this invoice's
 * practitioner and location (its override when there is one), and the new
 * total as it will be saved. Saving goes through db/invoiceItems.ts, which
 * re-checks inside its transaction that the invoice is still editable.
 */
export default function InvoiceItemsEditor({ invoice, items, services, overrides, onDone }: InvoiceItemsEditorProps) {
  const [lines, setLines] = useState<EditLineInput[]>(() => items.map(lineFromItem));
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const priceOf = (service: Service): Piastres =>
    resolveServicePrice(service, overrides, { practitionerId: invoice.practitioner_id, locationId: invoice.location_id });
  const parsedLines = lines.map(editLineFromInput);
  const draftTotal = parsedLines.every((line) => line !== null) ? invoiceTotalOf(parsedLines.filter((line) => line !== null)) : null;

  function changeLines(change: (current: EditLineInput[]) => EditLineInput[]) {
    setLines(change);
    setError(null);
  }

  function addLine() {
    const service = services.find((candidate) => candidate.id === serviceId);
    if (!service) {
      return;
    }
    changeLines((current) => [
      ...current,
      {
        key: id(),
        id: null,
        service_id: service.id,
        description: service.name,
        qtyInput: "1",
        priceInput: piastresToPoundsInput(priceOf(service)),
      },
    ]);
  }

  async function handleSave() {
    const validation = validateEditLines(lines);
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    setIsSaving(true);
    try {
      const result = await saveInvoiceItems(db, invoice.id, validation.draft);
      if (!result.ok) {
        setError(saveRefusalMessage(result.reason));
        return;
      }
      onDone();
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div data-invoice-items-editor className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {lines.map((line, index) => {
          const parsed = parsedLines[index];
          return (
            <li key={line.key} className="flex flex-wrap items-center gap-2 rounded-card border border-rule bg-card px-3 py-2">
              <p className="min-w-0 basis-full truncate text-[13px] font-semibold text-text sm:grow sm:basis-0">{line.description}</p>
              <div className="w-16">
                <TextInput
                  variant="centered"
                  inputMode="numeric"
                  aria-label={`${S.invoiceItemQtyLabel} ${line.description}`}
                  value={line.qtyInput}
                  onChange={(event) => {
                    const qtyInput = event.target.value;
                    changeLines((current) => current.map((candidate) => (candidate.key === line.key ? { ...candidate, qtyInput } : candidate)));
                  }}
                />
              </div>
              <div className="w-28">
                <TextInput
                  variant="centered"
                  inputMode="decimal"
                  aria-label={`${S.invoiceItemUnitPriceLabel} ${line.description}`}
                  value={line.priceInput}
                  onChange={(event) => {
                    const priceInput = event.target.value;
                    changeLines((current) => current.map((candidate) => (candidate.key === line.key ? { ...candidate, priceInput } : candidate)));
                  }}
                />
              </div>
              <span className="me-auto min-w-[72px] text-end text-[13px] font-bold tabular-nums text-text">
                <Ltr>{parsed === null ? "—" : formatMoneyAmount(lineTotal(parsed.qty, parsed.unit_price))}</Ltr>
              </span>
              <Button
                variant="danger"
                size="sm"
                aria-label={`${S.editItemsRemoveAction} ${line.description}`}
                onClick={() => changeLines((current) => current.filter((candidate) => candidate.key !== line.key))}
              >
                {S.editItemsRemoveAction}
              </Button>
            </li>
          );
        })}
      </ul>

      {services.length > 0 && (
        <div className="flex flex-col gap-2 rounded-card border border-dashed border-rule p-3">
          <p className="text-[11px] font-bold tracking-[0.02em] text-muted">{S.editItemsAddServiceLabel}</p>
          <ToggleGroup
            variant="service"
            label={S.editItemsAddServiceLabel}
            value={serviceId}
            onChange={setServiceId}
            options={services.map((service) => ({
              value: service.id,
              label: `${service.name} · ${formatMoneyAmount(priceOf(service))}`,
            }))}
          />
          <div>
            <Button variant="secondary" size="sm" onClick={addLine}>
              {S.editItemsAddAction}
            </Button>
          </div>
        </div>
      )}

      <div data-invoice-items-draft-total className="flex items-center justify-between rounded-card border border-rule bg-field px-4 py-3 text-[13.5px]">
        <span className="font-semibold text-muted">{S.editItemsNewTotalLabel}</span>
        <span className="font-bold tabular-nums text-text">
          <Ltr>{draftTotal === null ? "—" : formatMoneyAmount(draftTotal)}</Ltr> {S.tileCurrencyUnit}
        </span>
      </div>

      {error && <p className="text-[12.5px] text-danger">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={isSaving} onClick={handleSave}>
          {S.editItemsSaveAction}
        </Button>
        <Button variant="muted" disabled={isSaving} onClick={onDone}>
          {S.editItemsCancelAction}
        </Button>
      </div>
    </div>
  );
}

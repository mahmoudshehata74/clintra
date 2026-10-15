import { useState } from "react";
import Ltr from "../../components/Ltr";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Field, { TextInput } from "../../components/ui/Field";
import Switch from "../../components/ui/Switch";
import ToggleGroup from "../../components/ui/ToggleGroup";
import { db } from "../../db/database";
import { parsePoundsToPiastres, type Piastres } from "../../domain/money";
import {
  formatPriceForInput,
  parseServiceForm,
  SERVICE_DETAILS_ERROR_FIELD,
  SERVICE_DURATION_MINUTES,
  type ServiceDetails,
  type ServiceDetailsError,
  type ServiceDetailsField,
} from "../../domain/serviceDetails";
import {
  addServicePriceOverride,
  deleteServicePriceOverride,
  saveServiceDetails,
  updateService,
  type SaveServiceDetailsResult,
} from "../../db/serviceSettings";
import type { Location, Practitioner, Service, ServicePriceOverride } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { formatMoneyAmount } from "../money";
import { countServicesByState, sortServicesByName } from "./serviceCounts";
import { SetBody, SetList, SetRow, SettingsFooter } from "./SettingsLayout";
import { dayScreenStrings } from "./strings";

interface PanelData {
  services: Service[];
  overrides: ServicePriceOverride[];
  practitioners: Practitioner[];
  locations: Location[];
}

const EMPTY: PanelData = { services: [], overrides: [], practitioners: [], locations: [] };

const CURRENCY_UNIT = dayScreenStrings.tileCurrencyUnit;

// A native <select> has no shared component; it wears `.field .in`'s own
// resting box (Field.tsx's IN_BASE + default colours) so it reads as one of
// the form's inputs.
const SELECT_CLASSES =
  "w-full rounded-control border-[1.5px] border-rule bg-field px-[13px] py-2.5 font-[inherit] text-[15px] font-semibold text-text " +
  "focus:border-green focus:bg-card focus:outline-none focus:shadow-[0_0_0_3.5px_color-mix(in_srgb,var(--color-green)_16%,transparent)]";

/** `.set-row .svc-price` — the amount in copper with its smaller `i` unit. */
function Price({ amount }: { amount: Piastres }) {
  return (
    <span className="text-sm font-bold tracking-[-0.01em] text-copper-ink tabular-nums">
      <Ltr>{formatMoneyAmount(amount)}</Ltr>
      <i className="ms-[3px] text-[11px] font-semibold not-italic text-copper-ink">{CURRENCY_UNIT}</i>
    </span>
  );
}

const DETAILS_ERROR_MESSAGE: Record<ServiceDetailsError, string> = {
  name_required: dayScreenStrings.serviceNameRequiredError,
  name_taken: dayScreenStrings.serviceNameTakenError,
  duration_invalid: dayScreenStrings.serviceDurationInvalidError,
  price_invalid: dayScreenStrings.servicePriceInvalidError,
};

/**
 * Panel B, prototype #s13 (`.set-row.svc`, `.svc-name`, `.svc-dur`,
 * `.svc-price`, `.toggle`, `.edit`, `.runrow`): the org's services, each
 * with its active switch, and a per-row "تعديل" that opens the service form
 * (name, duration, base price — applied on save only) above its price
 * overrides. The footer's "خدمة جديدة" opens the same form for a new
 * service, and counts active against stopped ones.
 */
export default function ServicesPanel({ orgId }: { orgId: string }) {
  const data =
    useLiveQuery<PanelData>(async () => {
      const [services, overrides, practitioners, locations] = await Promise.all([
        db.services.toArray(),
        db.service_price_overrides.toArray(),
        db.practitioners.toArray(),
        db.locations.toArray(),
      ]);
      return {
        services: sortServicesByName(services),
        overrides,
        practitioners: practitioners.filter((p) => p.is_active),
        locations: locations.filter((l) => l.is_active),
      };
    }, [orgId]) ?? EMPTY;

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  // The organization's other services, the one being edited left out — what a name must not repeat.
  const othersThan = (serviceId: string | null) =>
    data.services.filter((service) => service.org_id === orgId && service.id !== serviceId);

  const counts = countServicesByState(data.services);

  return (
    <>
      <SetBody>
        <SetList>
          {data.services.map((service) => (
            <SetRow
              key={service.id}
              layout="service"
              muted={!service.is_active}
              editor={
                expandedId === service.id ? (
                  <div className="flex flex-col gap-4">
                    <ServiceDetailsForm
                      idPrefix={`service-${service.id}`}
                      initial={service}
                      others={othersThan(service.id)}
                      onSave={(details) => saveServiceDetails(db, { serviceId: service.id, orgId, details })}
                      onDone={() => setExpandedId(null)}
                    />
                    <OverridesEditor
                      service={service}
                      overrides={data.overrides.filter((o) => o.service_id === service.id)}
                      practitioners={data.practitioners}
                      locations={data.locations}
                    />
                  </div>
                ) : undefined
              }
            >
              <span className="min-w-0 text-[13.5px] font-semibold text-text">
                {service.name}
                {/* A real space before the tag: without one, Chrome joins the
                    name's last letter to the tag's first across the span. */}
                {!service.is_active && (
                  <>
                    {" "}
                    <span className="ms-1 text-[10.5px] font-normal text-muted">{dayScreenStrings.serviceInactiveTag}</span>
                  </>
                )}
              </span>
              <Badge appearance="soft" tone="neutral" className="tabular-nums">
                <Ltr>{service.duration_minutes}</Ltr> {dayScreenStrings.serviceDurationSuffix}
              </Badge>
              <Price amount={service.default_price} />
              <Switch
                checked={service.is_active}
                onCheckedChange={(next) => updateService(db, service.id, { isActive: next })}
                label={`${dayScreenStrings.serviceActiveLabel} · ${service.name}`}
              />
              <Button
                variant="outline"
                aria-expanded={expandedId === service.id}
                onClick={() => {
                  // One service form open at a time: a row's edit closes "خدمة جديدة", and the reverse.
                  setExpandedId(expandedId === service.id ? null : service.id);
                  setNewOpen(false);
                }}
              >
                {dayScreenStrings.serviceEditAction}
              </Button>
            </SetRow>
          ))}
        </SetList>

        {newOpen && (
          <div className="mt-2 rounded-card border border-green-line bg-card p-3.5">
            <ServiceDetailsForm
              idPrefix="service-new"
              initial={null}
              others={othersThan(null)}
              onSave={(details) => saveServiceDetails(db, { serviceId: null, orgId, details })}
              onDone={() => setNewOpen(false)}
            />
          </div>
        )}
      </SetBody>

      <SettingsFooter
        count={
          <>
            <b>{counts.active}</b> {dayScreenStrings.serviceCountActiveUnit} · <b>{counts.inactive}</b>{" "}
            {dayScreenStrings.serviceCountInactiveUnit}
          </>
        }
      >
        {/* Hidden while the new-service form is open, as before — that form's own save is the one action then. */}
        {!newOpen && (
          <Button
            variant="primary"
            onClick={() => {
              setNewOpen(true);
              setExpandedId(null);
            }}
          >
            {dayScreenStrings.serviceNewAction}
          </Button>
        )}
      </SettingsFooter>
    </>
  );
}

/**
 * The service form, for an edit ("تعديل", prefilled) and a new service
 * ("خدمة جديدة", empty): "اسم الخدمة", "المدة بالدقايق" and "السعر الأساسي",
 * held here and written only by "حفظ" — checked by parseServiceForm, then by
 * the writer itself (saveServiceDetails), each refusal shown under its own
 * field. "إلغاء" drops whatever was typed.
 */
function ServiceDetailsForm({
  idPrefix,
  initial,
  others,
  onSave,
  onDone,
}: {
  idPrefix: string;
  initial: Service | null;
  others: readonly Service[];
  onSave: (details: ServiceDetails) => Promise<SaveServiceDetailsResult>;
  onDone: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [duration, setDuration] = useState(initial ? String(initial.duration_minutes) : "");
  const [price, setPrice] = useState(initial ? formatPriceForInput(initial.default_price) : "");
  const [error, setError] = useState<ServiceDetailsError | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const parsed = parseServiceForm({ name, duration, price }, others);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setSaving(true);
    try {
      const result = await onSave(parsed.details);
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      onDone();
    } finally {
      setSaving(false);
    }
  }

  const errorFor = (field: ServiceDetailsField) =>
    error !== null && SERVICE_DETAILS_ERROR_FIELD[error] === field ? DETAILS_ERROR_MESSAGE[error] : undefined;

  return (
    <div className="flex flex-col gap-3">
      <Field label={dayScreenStrings.serviceNameLabel} id={`${idPrefix}-name`} error={errorFor("name")}>
        <TextInput type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={dayScreenStrings.serviceDurationLabel} id={`${idPrefix}-duration`} error={errorFor("duration")}>
          <TextInput
            type="number"
            inputMode="numeric"
            variant="centered"
            min={SERVICE_DURATION_MINUTES.min}
            max={SERVICE_DURATION_MINUTES.max}
            step={SERVICE_DURATION_MINUTES.step}
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
          />
        </Field>
        <Field label={dayScreenStrings.serviceBasePriceLabel} id={`${idPrefix}-price`} error={errorFor("price")}>
          <TextInput type="text" inputMode="decimal" variant="centered" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Field>
      </div>
      <div className="flex gap-2">
        <Button variant="primary" size="sm" className="flex-1" disabled={saving} onClick={save}>
          {dayScreenStrings.settingsSaveAction}
        </Button>
        <Button variant="secondary" size="sm" onClick={onDone}>
          {dayScreenStrings.settingsCancelAction}
        </Button>
      </div>
    </div>
  );
}

type OverrideTarget = "practitioner" | "location";

const TARGET_OPTIONS: readonly { value: OverrideTarget; label: string }[] = [
  { value: "practitioner", label: dayScreenStrings.serviceOverrideTargetPractitioner },
  { value: "location", label: dayScreenStrings.serviceOverrideTargetLocation },
];

function OverridesEditor({
  service,
  overrides,
  practitioners,
  locations,
}: {
  service: Service;
  overrides: ServicePriceOverride[];
  practitioners: Practitioner[];
  locations: Location[];
}) {
  const [adding, setAdding] = useState(false);
  const [targetType, setTargetType] = useState<OverrideTarget>("practitioner");
  const [targetId, setTargetId] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [error, setError] = useState<{ field: "target" | "price"; message: string } | null>(null);

  const practitionerName = (id: string) => practitioners.find((p) => p.id === id)?.full_name ?? id;
  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? id;

  async function saveOverride() {
    const price = parsePoundsToPiastres(priceInput);
    if (!price.ok) {
      setError({ field: "price", message: dayScreenStrings.servicePriceInvalidError });
      return;
    }
    if (targetId === "") {
      setError({ field: "target", message: dayScreenStrings.serviceOverrideTargetError });
      return;
    }
    const result = await addServicePriceOverride(db, {
      serviceId: service.id,
      practitionerId: targetType === "practitioner" ? targetId : null,
      locationId: targetType === "location" ? targetId : null,
      price: price.value,
    });
    if (!result.ok) {
      setError({ field: "target", message: dayScreenStrings.serviceOverrideTargetError });
      return;
    }
    setAdding(false);
    setTargetId("");
    setPriceInput("");
    setError(null);
  }

  const targetFieldId = `override-${service.id}-target`;
  const targetErrorId = `${targetFieldId}-error`;

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-[11px] font-bold tracking-[0.02em] text-muted">{dayScreenStrings.serviceOverridesLink}</p>
      {overrides.map((override) => (
        <div key={override.id} className="flex items-center justify-between gap-2 rounded-control bg-field px-3 py-2 text-[12.5px]">
          <span className="text-muted">
            {override.practitioner_id
              ? `${dayScreenStrings.serviceOverrideTargetPractitioner}: ${practitionerName(override.practitioner_id)}`
              : `${dayScreenStrings.serviceOverrideTargetLocation}: ${locationName(override.location_id!)}`}
          </span>
          <span className="flex items-center gap-2">
            <Price amount={override.price} />
            <Button variant="danger" size="sm" onClick={() => deleteServicePriceOverride(db, override.id)}>
              {dayScreenStrings.serviceOverrideDeleteAction}
            </Button>
          </span>
        </div>
      ))}

      {adding ? (
        <div className="flex flex-col gap-3">
          <ToggleGroup
            variant="filter"
            label={dayScreenStrings.serviceOverrideTargetGroupLabel}
            value={targetType}
            onChange={(next) => {
              setTargetType(next);
              setTargetId("");
            }}
            options={TARGET_OPTIONS}
          />
          <div className="flex flex-col gap-[5px]">
            <label htmlFor={targetFieldId} className="text-[11px] font-bold tracking-[0.02em] text-muted">
              {targetType === "practitioner"
                ? dayScreenStrings.serviceOverrideTargetPractitioner
                : dayScreenStrings.serviceOverrideTargetLocation}
            </label>
            <select
              id={targetFieldId}
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              aria-invalid={error?.field === "target" ? true : undefined}
              aria-describedby={error?.field === "target" ? targetErrorId : undefined}
              className={SELECT_CLASSES}
            >
              <option value="">—</option>
              {(targetType === "practitioner" ? practitioners : locations).map((option) => (
                <option key={option.id} value={option.id}>
                  {targetType === "practitioner" ? (option as Practitioner).full_name : (option as Location).name}
                </option>
              ))}
            </select>
            {error?.field === "target" && (
              <span id={targetErrorId} className="mt-0.5 text-[10.5px] text-danger">
                {error.message}
              </span>
            )}
          </div>
          <Field
            label={dayScreenStrings.servicePriceLabel}
            id={`override-${service.id}-price`}
            error={error?.field === "price" ? error.message : undefined}
          >
            <TextInput type="text" inputMode="decimal" variant="centered" value={priceInput} onChange={(e) => setPriceInput(e.target.value)} />
          </Field>
          <Button variant="primary" size="sm" onClick={saveOverride}>
            {dayScreenStrings.settingsSaveAction}
          </Button>
        </div>
      ) : (
        <Button variant="dashed" className="self-start" onClick={() => setAdding(true)}>
          {dayScreenStrings.serviceOverrideAddAction}
        </Button>
      )}
    </div>
  );
}

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
  addServicePriceOverride,
  createService,
  deleteServicePriceOverride,
  updateService,
} from "../../db/serviceSettings";
import type { Location, Practitioner, Service, ServicePriceOverride } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { formatMoneyAmount } from "../money";
import { countServicesByState } from "./serviceCounts";
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
    <span className="text-sm font-bold tracking-[-0.01em] text-copper tabular-nums">
      <Ltr>{formatMoneyAmount(amount)}</Ltr>
      <i className="ms-[3px] text-[11px] font-semibold not-italic text-copper-2">{CURRENCY_UNIT}</i>
    </span>
  );
}

type NewServiceField = "name" | "price";

/**
 * Panel B, prototype #s13 (`.set-row.svc`, `.svc-name`, `.svc-dur`,
 * `.svc-price`, `.toggle`, `.edit`, `.runrow`): the org's services, each
 * with its active switch, and a per-row "تعديل" that opens its price
 * overrides — the one per-service edit settings has. The footer adds a
 * service and counts active against stopped ones.
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
        services: services.sort((a, b) => a.name.localeCompare(b.name, "ar")),
        overrides,
        practitioners: practitioners.filter((p) => p.is_active),
        locations: locations.filter((l) => l.is_active),
      };
    }, [orgId]) ?? EMPTY;

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDuration, setNewDuration] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newError, setNewError] = useState<{ field: NewServiceField; message: string } | null>(null);

  async function saveNewService() {
    if (newName.trim() === "") {
      setNewError({ field: "name", message: dayScreenStrings.serviceNameRequiredError });
      return;
    }
    const price = parsePoundsToPiastres(newPrice);
    if (!price.ok) {
      setNewError({ field: "price", message: dayScreenStrings.servicePriceInvalidError });
      return;
    }
    await createService(db, {
      orgId,
      name: newName.trim(),
      durationMinutes: Number(newDuration) || 0,
      defaultPrice: price.value,
    });
    setNewOpen(false);
    setNewName("");
    setNewDuration("");
    setNewPrice("");
    setNewError(null);
  }

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
                  <OverridesEditor
                    service={service}
                    overrides={data.overrides.filter((o) => o.service_id === service.id)}
                    practitioners={data.practitioners}
                    locations={data.locations}
                  />
                ) : undefined
              }
            >
              <span className="min-w-0 text-[13.5px] font-semibold text-text">
                {service.name}
                {!service.is_active && (
                  <span className="ms-1.5 text-[10.5px] font-normal text-faint">{dayScreenStrings.serviceInactiveTag}</span>
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
                onClick={() => setExpandedId(expandedId === service.id ? null : service.id)}
              >
                {dayScreenStrings.serviceEditAction}
              </Button>
            </SetRow>
          ))}
        </SetList>

        {newOpen && (
          <div className="mt-2 flex flex-col gap-3 rounded-card border border-green-line bg-card p-3.5">
            <Field label={dayScreenStrings.serviceNameLabel} id="service-new-name" error={newError?.field === "name" ? newError.message : undefined}>
              <TextInput type="text" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label={dayScreenStrings.serviceDurationLabel} id="service-new-duration">
                <TextInput type="number" inputMode="numeric" variant="centered" value={newDuration} onChange={(e) => setNewDuration(e.target.value)} />
              </Field>
              <Field label={dayScreenStrings.servicePriceLabel} id="service-new-price" error={newError?.field === "price" ? newError.message : undefined}>
                <TextInput type="text" inputMode="decimal" variant="centered" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} />
              </Field>
            </div>
            <Button variant="primary" onClick={saveNewService}>
              {dayScreenStrings.settingsSaveAction}
            </Button>
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
          <Button variant="primary" onClick={() => setNewOpen(true)}>
            {dayScreenStrings.serviceNewAction}
          </Button>
        )}
      </SettingsFooter>
    </>
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

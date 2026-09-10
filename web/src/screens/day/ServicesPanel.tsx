import { useState } from "react";
import Ltr from "../../components/Ltr";
import { db } from "../../db/database";
import { formatPiastresForDisplay, parsePoundsToPiastres } from "../../domain/money";
import {
  addServicePriceOverride,
  createService,
  deleteServicePriceOverride,
  updateService,
} from "../../db/serviceSettings";
import type { Location, Practitioner, Service, ServicePriceOverride } from "../../db/types";
import { useLiveQuery } from "../../db/useLiveQuery";
import { dayScreenStrings } from "./strings";

const FIELD_CLASS =
  "w-full rounded-[--radius-el] border border-line bg-paper px-3 py-2 text-start focus:border-green focus:outline-none focus:ring-[3px] focus:ring-green-soft";

interface PanelData {
  services: Service[];
  overrides: ServicePriceOverride[];
  practitioners: Practitioner[];
  locations: Location[];
}

const EMPTY: PanelData = { services: [], overrides: [], practitioners: [], locations: [] };

/** Panel B: the org's services, their active state, and per-service price overrides. */
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
  const [newError, setNewError] = useState<string | null>(null);

  async function saveNewService() {
    if (newName.trim() === "") {
      setNewError(dayScreenStrings.serviceNameRequiredError);
      return;
    }
    const price = parsePoundsToPiastres(newPrice);
    if (!price.ok) {
      setNewError(dayScreenStrings.servicePriceInvalidError);
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

  return (
    <div className="mt-4">
      <ul className="flex flex-col divide-y divide-line-soft">
        {data.services.map((service) => (
          <li key={service.id} className="py-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className={service.is_active ? "font-medium" : "font-medium text-muted line-through"}>
                {service.name}
              </span>
              <span className="flex items-center gap-2 text-sm text-muted">
                <Ltr>{service.duration_minutes}</Ltr> {dayScreenStrings.serviceDurationSuffix}
                <Ltr>{formatPiastresForDisplay(service.default_price)}</Ltr>
                <button
                  type="button"
                  aria-pressed={service.is_active}
                  onClick={() => updateService(db, service.id, { isActive: !service.is_active })}
                  className={
                    service.is_active
                      ? "rounded-[5px] bg-green-soft px-2 py-0.5 text-xs text-green"
                      : "rounded-[5px] bg-line-soft px-2 py-0.5 text-xs text-muted"
                  }
                >
                  {dayScreenStrings.serviceActiveLabel}
                </button>
              </span>
            </div>
            <button
              type="button"
              onClick={() => setExpandedId(expandedId === service.id ? null : service.id)}
              className="mt-1 text-sm text-green"
            >
              {dayScreenStrings.serviceOverridesLink}
            </button>
            {expandedId === service.id && (
              <OverridesEditor
                service={service}
                overrides={data.overrides.filter((o) => o.service_id === service.id)}
                practitioners={data.practitioners}
                locations={data.locations}
              />
            )}
          </li>
        ))}
      </ul>

      {newOpen ? (
        <div className="mt-4 flex flex-col gap-3 rounded-[--radius-el] border border-line p-3">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={dayScreenStrings.serviceNameLabel}
            className={FIELD_CLASS}
          />
          <input
            type="number"
            inputMode="numeric"
            value={newDuration}
            onChange={(e) => setNewDuration(e.target.value)}
            placeholder={dayScreenStrings.serviceDurationLabel}
            className={FIELD_CLASS}
          />
          <input
            type="text"
            inputMode="decimal"
            value={newPrice}
            onChange={(e) => setNewPrice(e.target.value)}
            placeholder={dayScreenStrings.servicePriceLabel}
            className={FIELD_CLASS}
          />
          {newError && <p className="text-sm text-red">{newError}</p>}
          <button
            type="button"
            onClick={saveNewService}
            className="rounded-[--radius-el] bg-green px-4 py-2 text-center font-semibold text-paper"
          >
            {dayScreenStrings.settingsSaveAction}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setNewOpen(true)}
          className="mt-4 w-full rounded-[--radius-el] bg-green px-4 py-3 text-center font-semibold text-paper"
        >
          {dayScreenStrings.serviceNewAction}
        </button>
      )}
    </div>
  );
}

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
  const [targetType, setTargetType] = useState<"practitioner" | "location">("practitioner");
  const [targetId, setTargetId] = useState("");
  const [priceInput, setPriceInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const practitionerName = (id: string) => practitioners.find((p) => p.id === id)?.full_name ?? id;
  const locationName = (id: string) => locations.find((l) => l.id === id)?.name ?? id;

  async function saveOverride() {
    const price = parsePoundsToPiastres(priceInput);
    if (!price.ok) {
      setError(dayScreenStrings.servicePriceInvalidError);
      return;
    }
    if (targetId === "") {
      setError(dayScreenStrings.serviceOverrideTargetError);
      return;
    }
    const result = await addServicePriceOverride(db, {
      serviceId: service.id,
      practitionerId: targetType === "practitioner" ? targetId : null,
      locationId: targetType === "location" ? targetId : null,
      price: price.value,
    });
    if (!result.ok) {
      setError(dayScreenStrings.serviceOverrideTargetError);
      return;
    }
    setAdding(false);
    setTargetId("");
    setPriceInput("");
    setError(null);
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-[--radius-el] bg-line-soft/50 p-3">
      {overrides.map((override) => (
        <div key={override.id} className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted">
            {override.practitioner_id
              ? `${dayScreenStrings.serviceOverrideTargetPractitioner}: ${practitionerName(override.practitioner_id)}`
              : `${dayScreenStrings.serviceOverrideTargetLocation}: ${locationName(override.location_id!)}`}
          </span>
          <span className="flex items-center gap-2">
            <Ltr>{formatPiastresForDisplay(override.price)}</Ltr>
            <button type="button" onClick={() => deleteServicePriceOverride(db, override.id)} className="text-red">
              {dayScreenStrings.serviceOverrideDeleteAction}
            </button>
          </span>
        </div>
      ))}

      {adding ? (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setTargetType("practitioner");
                setTargetId("");
              }}
              className={
                targetType === "practitioner"
                  ? "rounded-[--radius-el] border border-green px-3 py-1 text-sm text-green"
                  : "rounded-[--radius-el] border border-line px-3 py-1 text-sm text-ink"
              }
            >
              {dayScreenStrings.serviceOverrideTargetPractitioner}
            </button>
            <button
              type="button"
              onClick={() => {
                setTargetType("location");
                setTargetId("");
              }}
              className={
                targetType === "location"
                  ? "rounded-[--radius-el] border border-green px-3 py-1 text-sm text-green"
                  : "rounded-[--radius-el] border border-line px-3 py-1 text-sm text-ink"
              }
            >
              {dayScreenStrings.serviceOverrideTargetLocation}
            </button>
          </div>
          <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className={FIELD_CLASS}>
            <option value="">—</option>
            {(targetType === "practitioner" ? practitioners : locations).map((option) => (
              <option key={option.id} value={option.id}>
                {targetType === "practitioner" ? (option as Practitioner).full_name : (option as Location).name}
              </option>
            ))}
          </select>
          <input
            type="text"
            inputMode="decimal"
            value={priceInput}
            onChange={(e) => setPriceInput(e.target.value)}
            placeholder={dayScreenStrings.servicePriceLabel}
            className={FIELD_CLASS}
          />
          {error && <p className="text-sm text-red">{error}</p>}
          <button
            type="button"
            onClick={saveOverride}
            className="rounded-[--radius-el] bg-green px-4 py-2 text-center font-semibold text-paper"
          >
            {dayScreenStrings.settingsSaveAction}
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="self-start text-sm text-green">
          {dayScreenStrings.serviceOverrideAddAction}
        </button>
      )}
    </div>
  );
}

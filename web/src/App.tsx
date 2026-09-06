import { useEffect, useState } from "react";
import Ltr from "./components/Ltr";
import { db } from "./db/database";
import { seedDatabase } from "./db/seed";
import type { Location, Organization, Practitioner, Service } from "./db/types";
import { formatPiastresForDisplay } from "./domain/money";
import { formatEgyptianPhoneForDisplay } from "./domain/phone";

// TEMPORARY DEVELOPMENT SCREEN — remove once real booking/patient screens exist.
// It only exists to verify the local IndexedDB layer: it seeds the database
// and displays what was read back.

interface LoadedData {
  organization: Organization;
  location: Location;
  practitioner: Practitioner;
  services: Service[];
}

export default function App() {
  const [data, setData] = useState<LoadedData | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      await seedDatabase(db);
      const [organization] = await db.organizations.toArray();
      const [location] = await db.locations.toArray();
      const [practitioner] = await db.practitioners.toArray();
      const services = await db.services.toArray();

      if (!cancelled && organization && location && practitioner) {
        setData({ organization, location, practitioner, services });
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!data) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="text-muted">جارٍ التحميل...</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-display text-4xl font-semibold text-green">Clintra</h1>
      <p className="mt-2 text-muted">فحص قاعدة البيانات المحلية بعد تشغيل البيانات التمهيدية.</p>

      <div className="mt-10 rounded-[--radius-frame] border border-line p-6">
        <h2 className="font-display text-xl font-medium">{data.organization.name}</h2>
        <p className="mt-3 leading-7">
          {data.location.name} · <Ltr>{formatEgyptianPhoneForDisplay(data.location.phone)}</Ltr>
        </p>
        <p className="mt-1 text-muted">
          {data.practitioner.full_name} — {data.practitioner.title}
        </p>
      </div>

      <ul className="mt-8 flex flex-col gap-3">
        {data.services.map((service) => (
          <li
            key={service.id}
            className="flex items-center justify-between rounded-[--radius-el] border border-line p-3"
          >
            <span>{service.name}</span>
            <span className="text-muted">
              <Ltr>{formatPiastresForDisplay(service.default_price)}</Ltr>
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}

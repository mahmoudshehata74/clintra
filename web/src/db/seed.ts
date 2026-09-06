import { id } from "../domain/id";
import { Role } from "../domain/role";
import { LocationScope, PractitionerScope } from "../domain/scope";
import type { Piastres } from "../domain/money";
import type { ClintraDatabase } from "./database";
import {
  PlanTier,
  SpecialtyTemplateGeneration,
  SpecialtyTemplatePricingMode,
  type Membership,
  type Organization,
  type Practitioner,
  type PractitionerLocation,
  type Service,
  type SpecialtyTemplate,
  type Location,
  type User,
} from "./types";

const GENERAL_SPECIALTY_KEY = "general";

/**
 * Seeds one organization, one location, one practitioner, one assistant
 * membership and three services with Arabic names. Only runs when the
 * database is empty, and is safe to call more than once.
 */
export async function seedDatabase(db: ClintraDatabase): Promise<void> {
  const existingCount = await db.organizations.count();
  if (existingCount > 0) {
    return;
  }

  const now = new Date().toISOString();

  const organization: Organization = {
    id: id(),
    name: "عيادة النور",
    plan_tier: PlanTier.Small,
    created_at: now,
  };

  const location: Location = {
    id: id(),
    org_id: organization.id,
    name: "الفرع الرئيسي",
    address: "شارع الجمهورية، القاهرة",
    phone: "+20221234567",
    is_active: true,
  };

  const specialtyTemplate: SpecialtyTemplate = {
    id: id(),
    org_id: null,
    key: GENERAL_SPECIALTY_KEY,
    name: "عام",
    generation: SpecialtyTemplateGeneration.None,
    default_count: null,
    gap_days: null,
    resource_type: null,
    pricing_mode: SpecialtyTemplatePricingMode.PerItem,
    stall_days: null,
    unit_label: "زيارة",
    provider_label: "طبيب",
  };

  const practitioner: Practitioner = {
    id: id(),
    org_id: organization.id,
    user_id: null,
    full_name: "أحمد المصري",
    specialty_id: specialtyTemplate.id,
    title: "طبيب عام",
    is_active: true,
  };

  const practitionerLocation: PractitionerLocation = {
    id: id(),
    practitioner_id: practitioner.id,
    location_id: location.id,
    is_active: true,
  };

  const assistantUser: User = {
    id: id(),
    full_name: "سارة حسن",
    phone: "+201123456789",
    email: null,
    is_active: true,
  };

  const assistantMembership: Membership = {
    id: id(),
    user_id: assistantUser.id,
    org_id: organization.id,
    role: Role.Assistant,
    location_scope: LocationScope.All,
    practitioner_scope: PractitionerScope.All,
    practitioner_id: null,
    // Seed data only: not a real password/PIN hash.
    pin_hash: "seed-placeholder-pin-hash",
    is_active: true,
  };

  const services: Service[] = [
    {
      id: id(),
      org_id: organization.id,
      name: "كشف عام",
      duration_minutes: 30,
      default_price: 300_00 as Piastres,
      is_active: true,
    },
    {
      id: id(),
      org_id: organization.id,
      name: "استشارة متابعة",
      duration_minutes: 15,
      default_price: 150_00 as Piastres,
      is_active: true,
    },
    {
      id: id(),
      org_id: organization.id,
      name: "فحص شامل",
      duration_minutes: 45,
      default_price: 500_00 as Piastres,
      is_active: true,
    },
  ];

  await db.transaction(
    "rw",
    [
      db.organizations,
      db.locations,
      db.specialty_templates,
      db.practitioners,
      db.practitioner_locations,
      db.users,
      db.memberships,
      db.services,
    ],
    async () => {
      await db.organizations.add(organization);
      await db.locations.add(location);
      await db.specialty_templates.add(specialtyTemplate);
      await db.practitioners.add(practitioner);
      await db.practitioner_locations.add(practitionerLocation);
      await db.users.add(assistantUser);
      await db.memberships.add(assistantMembership);
      await db.services.bulkAdd(services);
    },
  );
}

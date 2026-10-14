import type { Service } from "../../db/types";

const ARABIC_COLLATOR = new Intl.Collator("ar");

/**
 * Screen 13's list order: by name under Arabic collation, ties broken by id
 * so the order never depends on how the rows were read.
 */
export function sortServicesByName<T extends Pick<Service, "id" | "name">>(services: readonly T[]): T[] {
  return [...services].sort((a, b) => ARABIC_COLLATOR.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Screen 13's `.runrow .count` ("{a} نشطة · {i} موقوفة"): how many of the org's services are active, and how many are stopped. */
export function countServicesByState(services: readonly Pick<Service, "is_active">[]): { active: number; inactive: number } {
  const active = services.filter((service) => service.is_active).length;
  return { active, inactive: services.length - active };
}

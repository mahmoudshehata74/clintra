import type { Service } from "../../db/types";

/** Screen 13's `.runrow .count` ("{a} نشطة · {i} موقوفة"): how many of the org's services are active, and how many are stopped. */
export function countServicesByState(services: readonly Pick<Service, "is_active">[]): { active: number; inactive: number } {
  const active = services.filter((service) => service.is_active).length;
  return { active, inactive: services.length - active };
}

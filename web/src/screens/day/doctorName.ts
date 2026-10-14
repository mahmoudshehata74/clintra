import { dayScreenStrings } from "./strings";

/** A practitioner's name as the prototype writes it on every surface that names the doctor: "د. أحمد المصري". */
export function withDoctorPrefix(name: string): string {
  return `${dayScreenStrings.doctorPrefix} ${name}`;
}

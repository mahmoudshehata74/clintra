import { formatDayMonthName } from "../../domain/displayDate";
import { clockTimeInCairo, todayInCairo, type Instant } from "../../domain/time";
import { dayScreenStrings } from "./strings";

/** A printed page's `.print-foot` time: "طُبعت 7 سبتمبر 18:15" (the app's 24-hour clock). */
export function formatPrintedAt(instant: Instant): string {
  return `${dayScreenStrings.printedAtPrefix} ${formatDayMonthName(todayInCairo(new Date(instant)))} ${clockTimeInCairo(instant)}`;
}

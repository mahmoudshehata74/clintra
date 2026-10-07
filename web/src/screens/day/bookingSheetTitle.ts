import type { ClockTime } from "../../domain/time";
import { dayScreenStrings } from "./strings";

/**
 * The booking sheet's own head title (`.book-head h3`, e.g. "حجز · 11:30 ·
 * د. أحمد المصري"): "حجز" alone until a time is chosen, then "· {time}", then
 * "· {practitioner}" — but only when the caller says more than one
 * practitioner is visible, since a single-practitioner clinic never needs to
 * name one. Walk-in and queue mode keep their own distinct titles entirely
 * (BookingSheet.tsx never calls this for those two).
 */
export function buildBookingSheetTitle(chosenTime: ClockTime | null, practitionerName: string | null): string {
  let title: string = dayScreenStrings.bookingButtonLabel;
  if (chosenTime) {
    title += ` · ${chosenTime}`;
  }
  if (practitionerName) {
    title += ` · ${practitionerName}`;
  }
  return title;
}

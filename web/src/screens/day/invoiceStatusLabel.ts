import { InvoiceStatus } from "../../db/types";
import { dayScreenStrings } from "./strings";

export const STATUS_LABEL: Record<string, string> = {
  [InvoiceStatus.Unpaid]: dayScreenStrings.invoiceStatusUnpaid,
  [InvoiceStatus.Partial]: dayScreenStrings.invoiceStatusPartial,
  [InvoiceStatus.Paid]: dayScreenStrings.invoiceStatusPaid,
  [InvoiceStatus.Void]: dayScreenStrings.invoiceStatusVoid,
};

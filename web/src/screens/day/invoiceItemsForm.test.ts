import { describe, expect, it } from "vitest";
import type { Piastres } from "../../domain/money";
import { piastresToPoundsInput, saveRefusalMessage, validateEditLines, type EditLineInput } from "./invoiceItemsForm";
import { dayScreenStrings } from "./strings";

function line(qtyInput: string, priceInput: string): EditLineInput {
  return { key: "k", id: "a", service_id: "svc", description: "كشف", qtyInput, priceInput };
}

describe("invoiceItemsForm", () => {
  it("starts the price field in pounds", () => {
    expect(piastresToPoundsInput(40_000 as Piastres)).toBe("400");
    expect(piastresToPoundsInput(15_050 as Piastres)).toBe("150.50");
    expect(piastresToPoundsInput(5 as Piastres)).toBe("0.05");
  });

  it("parses each line's quantity and price into piastres", () => {
    expect(validateEditLines([line(" 2 ", "150.50")])).toEqual({
      ok: true,
      draft: [{ id: "a", service_id: "svc", description: "كشف", qty: 2, unit_price: 15_050 }],
    });
  });

  it("refuses no line, a quantity that is not a whole 1 or more, and a price that is not pounds", () => {
    expect(validateEditLines([])).toEqual({ ok: false, error: dayScreenStrings.editItemsNoItemsError });
    for (const qty of ["0", "1.5", "", "٢"]) {
      expect(validateEditLines([line(qty, "100")])).toEqual({ ok: false, error: dayScreenStrings.editItemsQtyError });
    }
    expect(validateEditLines([line("1", "abc")])).toEqual({ ok: false, error: dayScreenStrings.editItemsPriceError });
  });

  it("says why a save was refused in Arabic", () => {
    expect(saveRefusalMessage("has_payments")).toBe("مفيش تعديل بنود بعد تسجيل دفعة");
    expect(saveRefusalMessage("day_closed")).toBe(dayScreenStrings.editItemsDayClosedReason);
  });
});

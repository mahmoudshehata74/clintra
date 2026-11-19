import { describe, expect, it } from "vitest";
import { csvFlag, csvMoney, csvNumber, csvText, piastresToPounds, writeCsv } from "./csv";
import type { Piastres } from "./money";

const p = (value: number) => value as Piastres;

describe("writeCsv", () => {
  it("starts with a UTF-8 byte order mark and ends every line, the last included, with CRLF", () => {
    const csv = writeCsv(["المريض", "المبلغ"], [[csvText("أحمد"), csvMoney(p(1250))]]);

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe("المريض,المبلغ\r\nأحمد,12.50\r\n");
    expect(csv.slice(1).replaceAll("\r\n", "")).not.toContain("\n");
  });

  it.each([["=SUM(A1)"], ["+20"], ["-cmd"], ["@here"], ["\tTab"], ["\rCarriage"]])("prefixes a text cell starting with a formula character (%j)", (value) => {
    const csv = writeCsv(["x"], [[csvText(value)]]);
    const line = csv.slice(1).split("\r\n")[1];
    expect(line.replace(/^"/, "").startsWith(`'${value.slice(0, 1)}`)).toBe(true);
  });

  it("leaves numbers and money numeric, a negative one included", () => {
    const csv = writeCsv(["a", "b", "c"], [[csvNumber(-3), csvMoney(p(-1205)), csvMoney(p(5))]]);
    expect(csv.slice(1).split("\r\n")[1]).toBe("-3,-12.05,0.05");
  });

  it("writes flags as 1 and 0, and null as an empty cell", () => {
    const csv = writeCsv(["a", "b", "c"], [[csvFlag(true), csvFlag(false), null]]);
    expect(csv.slice(1).split("\r\n")[1]).toBe("1,0,");
  });

  it("quotes a cell holding a comma, a quote or a line break, doubling its quotes", () => {
    const csv = writeCsv(["a", "b", "c"], [[csvText("كشف، متابعة,1"), csvText('قال "تمام"'), csvText("سطر\r\nتاني")]]);
    expect(csv.slice(1)).toBe('a,b,c\r\n"كشف، متابعة,1","قال ""تمام""","سطر\r\nتاني"\r\n');
  });

  it("neutralises a header label the same way", () => {
    expect(writeCsv(["=x"], []).slice(1)).toBe("'=x\r\n");
  });
});

describe("piastresToPounds", () => {
  it.each([
    [0, "0.00"],
    [7, "0.07"],
    [100, "1.00"],
    [123456, "1234.56"],
    [-99, "-0.99"],
  ])("%i piastres reads %s", (piastres, pounds) => {
    expect(piastresToPounds(p(piastres))).toBe(pounds);
  });
});

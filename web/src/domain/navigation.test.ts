import { describe, expect, it } from "vitest";
import { sidebarStrings } from "../components/strings";
import { navItemsFor } from "./navigation";
import { Role } from "./role";

describe("navItemsFor", () => {
  it("shows only the day item to an assistant", () => {
    expect(navItemsFor(Role.Assistant)).toEqual([{ key: "day", label: sidebarStrings.navDay }]);
  });

  it("shows only the day item to a practitioner", () => {
    expect(navItemsFor(Role.Practitioner)).toEqual([{ key: "day", label: sidebarStrings.navDay }]);
  });

  it("shows only the day item to a manager", () => {
    expect(navItemsFor(Role.Manager)).toEqual([{ key: "day", label: sidebarStrings.navDay }]);
  });

  it("shows day then settings to an owner", () => {
    expect(navItemsFor(Role.Owner)).toEqual([
      { key: "day", label: sidebarStrings.navDay },
      { key: "settings", label: sidebarStrings.navSettings },
    ]);
  });
});

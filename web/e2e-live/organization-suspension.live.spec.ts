import { mkdir } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { readStore } from "../e2e/support";
import { suspensionStrings } from "../src/sync/organizationSuspension";
import { bookNew, eventually, openDevice, pushed, rowCount, setUpClinic } from "./liveSupport";
import { provisionOrg, removeLiveOrgs, setOrganizationSuspended, startApi, stopApi } from "./liveServer";

test("a suspended clinic keeps A's booking and sends it to B after the CLI enables it", async ({ browser }) => {
  await startApi();
  let orgId: string | undefined;
  try {
    const org = await provisionOrg();
    orgId = org.orgId;
    const a = await openDevice(browser, org, "A");
    const b = await openDevice(browser, org, "B");
    try {
      await setUpClinic(a);
      await eventually([a], () => pushed(a), true);
      await eventually([b], async () => (await readStore(b.page, "services")).length > 0, true);
      await setOrganizationSuspended(org, true);
      await a.page.evaluate(() => window.dispatchEvent(new Event("online")));
      await b.page.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect(a.page.getByText(suspensionStrings.banner)).toBeVisible();
      await expect(b.page.getByText(suspensionStrings.banner)).toBeVisible();
      await mkdir('e2e/admin-shots', { recursive: true });
      await a.page.screenshot({ path: 'e2e/admin-shots/live-disabled.png' });
      const name = "مريض فترة إيقاف الحساب";
      await bookNew(a, name);
      expect(await pushed(a)).toBe(false);
      expect(await rowCount(b, name)).toBe(0);
      await a.page.screenshot({ path: 'e2e/admin-shots/live-queued.png' });
      await setOrganizationSuspended(org, false);
      await a.page.evaluate(() => window.dispatchEvent(new Event("online")));
      await b.page.evaluate(() => window.dispatchEvent(new Event("online")));
      await eventually([a, b], () => rowCount(b, name), 1);
      await eventually([a], () => pushed(a), true);
      await expect(a.page.getByText(suspensionStrings.banner)).toHaveCount(0);
      await expect(b.page.getByText(suspensionStrings.banner)).toHaveCount(0);
      await a.page.screenshot({ path: 'e2e/admin-shots/live-enabled.png' });
      expect(a.errors).toEqual([]);
      expect(b.errors).toEqual([]);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  } finally {
    await stopApi();
    if (orgId) await removeLiveOrgs([orgId]);
  }
});

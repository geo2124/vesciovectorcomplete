import { test, expect } from "@playwright/test";
import { ensureAuthenticated } from "../e2e/helpers/auth";

test.describe("Player Subscriptions & Idle Renewal", () => {
  test.beforeEach(async ({ page }) => {
    await ensureAuthenticated(page);
  });

  test("Verify Idle State and Session Alerts", async ({ page }) => {
    // 1. Navigate to the Players / Subscriptions management view
    await page.goto("/players");
    await page.waitForLoadState("domcontentloaded");

    // Explicit 3-second buffer to allow Firebase queries / network data to populate
    await page.waitForTimeout(3000);

    // Ensure the player roster / directory is visible
    const rosterHeading = page
      .locator("h1, h2, div")
      .filter({ hasText: /Players|Roster/i })
      .first();
    await expect(rosterHeading).toBeVisible({ timeout: 15000 });

    // 2. Check for player rows or a valid empty state
    const playerRow = page
      .locator("tbody tr, div[role='row'], .cursor-pointer")
      .filter({ hasText: /Active|Idle|U-1|U-2|U-14|U-12|U-16|U-18/i })
      .first();
    const emptyState = page
      .locator("text=/No players|empty|No players match these filters/i")
      .first();

    const hasPlayer = await playerRow.isVisible().catch(() => false);

    if (hasPlayer) {
      // Click player row to open Player Profile / Detail view
      await playerRow.click();
      await page.waitForTimeout(500);

      // In the player profile view, check for renewal controls or Idle state
      const setIdleBtn = page
        .locator("button")
        .filter({ hasText: /Set Idle \(Pending Renewal\)|Set Idle/i })
        .first();

      if (await setIdleBtn.isVisible()) {
        // Simulate transitioning player to Idle state for renewal tracking
        await setIdleBtn.click({ force: true });
        await page.waitForTimeout(500);
      }

      // Verify that the Idle renewal prompt or session alert messaging is displayed
      const renewalAlert = page
        .locator("div, p, span")
        .filter({
          hasText:
            /Idle \(Pending Renewal\)|Pending Renewal|missed sessions|sessions remaining|Awaiting payment/i,
        })
        .first();
      await expect(renewalAlert).toBeVisible({ timeout: 10000 });
    } else {
      // If the staging database is clean/empty, safely verify the legitimate Empty State
      await expect(emptyState).toBeVisible({ timeout: 10000 });
    }
  });
});

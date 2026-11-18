import { test, expect } from "@playwright/test";

test.describe("Player Subscriptions & Idle Renewal", () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate as Super Admin for automated headless runs
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "vv_auth_session_user",
        JSON.stringify({
          id: "admin-1",
          email: "geogo3@gmail.com",
          name: "Georges Khoury",
          role: "super_admin",
          branch: "All",
          tenantId: "donbosco",
        }),
      );
    });
  });

  test("Verify Idle State and Session Alerts", async ({ page }) => {
    // 1. Navigate to the Players / Subscriptions management view
    await page.goto("/players");
    await page.waitForLoadState("domcontentloaded");

    // Ensure the player roster / directory is visible
    const rosterHeading = page
      .locator("h1, h2, div")
      .filter({ hasText: /Players|Roster/i })
      .first();
    await expect(rosterHeading).toBeVisible({ timeout: 15000 });

    // 2. Locate a player row or card and click to open the Player Profile / Detail view
    const playerRow = page
      .locator("tbody tr, div[role='row'], .cursor-pointer")
      .filter({ hasText: /Active|Idle|U-1|U-2/i })
      .first();
    await expect(playerRow).toBeVisible({ timeout: 10000 });
    await playerRow.click();

    // 3. In the player profile view, check for renewal controls or Idle state
    const setIdleBtn = page
      .locator("button")
      .filter({ hasText: /Set Idle \(Pending Renewal\)|Set Idle/i })
      .first();

    if (await setIdleBtn.isVisible()) {
      // Simulate transitioning player to Idle state for renewal tracking
      await setIdleBtn.click();
    }

    // 4. Verify that the Idle renewal prompt is visible in the UI
    const idlePrompt = page
      .locator("text=/Idle \\(Pending Renewal\\)|Awaiting payment|missed sessions/i")
      .first();
    await expect(idlePrompt).toBeVisible({ timeout: 10000 });

    // 5. Verify the 3-session alert or renewal prompt messaging is displayed
    const renewalAlert = page
      .locator("div, p, span")
      .filter({
        hasText: /Pending Renewal|missed sessions|sessions remaining|Awaiting payment/i,
      })
      .first();
    await expect(renewalAlert).toBeVisible();
  });
});

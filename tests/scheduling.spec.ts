import { test, expect } from "@playwright/test";

test.describe("Academy Reservations & Scheduling", () => {
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

  test("Book Half-Court HCA/HCB Session", async ({ page }) => {
    // 1. Navigate to the Sessions/Scheduling route
    await page.goto("/sessions");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    // Ensure session page header is loaded
    const pageHeader = page
      .locator("h1, h2, div")
      .filter({ hasText: /Sessions|Schedule/i })
      .first();
    await expect(pageHeader).toBeVisible({ timeout: 15000 });

    // 2. Open "+ New session" modal
    const newSessionBtn = page
      .locator("button")
      .filter({ hasText: /\+ New session|New session/i })
      .first();
    await expect(newSessionBtn).toBeVisible({ timeout: 10000 });
    await newSessionBtn.click();

    // 3. Fill in session title
    const modal = page.locator("div[role='dialog'], .fixed").first();
    await expect(modal).toBeVisible({ timeout: 10000 });

    const titleInput = page
      .locator("input")
      .filter({ hasNot: page.locator("[type='date'], [type='time'], [type='number']") })
      .first();
    await expect(titleInput).toBeVisible({ timeout: 10000 });
    await titleInput.fill("U-16 Half-Court Drill HCA");

    // 4. Explicitly select Half-Court (Half Court - HCA or Half Court - HCB)
    // Wait for the select dropdown to be fully attached and visible before interacting
    const courtAllocationSelect = page
      .locator("select")
      .filter({ has: page.locator('option[value*="Half Court"]') })
      .first();

    await courtAllocationSelect.waitFor({ state: "attached", timeout: 15000 });
    await courtAllocationSelect.waitFor({ state: "visible", timeout: 10000 });
    await page.waitForTimeout(300);
    await courtAllocationSelect.selectOption("Half Court - HCA");

    // 5. Submit and confirm the booking - wait for button to stabilize and use force: true
    const submitBtn = page
      .locator("button")
      .filter({ hasText: /Create session|Save changes|Save session|Confirm/i })
      .first();
    await submitBtn.waitFor({ state: "visible", timeout: 10000 });
    await page.waitForTimeout(500); // let re-renders settle
    await submitBtn.click({ force: true });

    // 6. Verify the session with Half-Court allocation appears correctly in the schedule
    await expect(page.locator("text=U-16 Half-Court Drill HCA").first()).toBeVisible({
      timeout: 15000,
    });
  });
});

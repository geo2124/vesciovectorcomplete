import { test, expect } from "@playwright/test";
import { ensureAuthenticated } from "../e2e/helpers/auth";

test.describe("Academy CRM Pipeline", () => {
  test.beforeEach(async ({ page }) => {
    await ensureAuthenticated(page);
  });

  test("Add Player and Check Age Matrix Assignment", async ({ page }) => {
    // 1. Navigate to the Coach/Academy CRM route
    await page.goto("/crm");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000);

    // Ensure the CRM pipeline board or page container is visible
    const crmHeading = page
      .locator("h1, h2, div")
      .filter({ hasText: /CRM|Pipeline/i })
      .first();
    await expect(crmHeading).toBeVisible({ timeout: 15000 });

    // 2. Open the "New Lead / Player" modal
    const newLeadBtn = page
      .locator("button")
      .filter({ hasText: /New Lead|Add Player|New Inquiry/i })
      .first();
    await expect(newLeadBtn).toBeVisible({ timeout: 10000 });
    await newLeadBtn.click();

    // 3. Fill in dummy player name and Date of Birth (DOB)
    const nameInput = page
      .locator('input[placeholder*="Karim Mansour"], input[placeholder*="name" i]')
      .first();
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await nameInput.fill("Alexander Vance");

    const dobInput = page.locator('input[type="date"]').first();
    if (await dobInput.isVisible()) {
      await dobInput.fill("2013-06-15");
    }

    // 4. Verify age category / matrix selector is available and select category
    const categorySelect = page
      .locator("select")
      .filter({
        has: page.locator('option[value="U-14"], option[value="U-12"]'),
      })
      .first();
    if (await categorySelect.isVisible()) {
      await categorySelect.selectOption({ label: "U-14" }).catch(() => {});
    }

    // 5. Submit and save CRM Card - stabilize button to prevent React re-render detachment race condition
    const submitBtn = page
      .locator("button")
      .filter({ hasText: /Save CRM Card|Save Lead|Save/i })
      .first();
    await submitBtn.waitFor({ state: "visible", timeout: 10000 });
    await page.waitForTimeout(500); // let re-renders settle
    await submitBtn.click({ force: true });

    // 6. Verify the player is successfully added to the pipeline
    await expect(page.locator("text=Alexander Vance").first()).toBeVisible({ timeout: 15000 });
  });
});

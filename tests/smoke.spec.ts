import { test, expect } from "@playwright/test";

test.describe("App Critical Flows", () => {
  test("App loads without crashing", async ({ page }) => {
    await page.goto("/");

    const title = await page.title();
    expect(title.trim().length).toBeGreaterThan(0);

    const body = page.locator("body");
    await expect(body).toBeVisible();
  });
});

import { expect, test } from "@playwright/test";
import { ensureAuthenticated } from "./helpers/auth";

test.describe("Vescio Vector — Full Academy Workflow E2E Suite", () => {
  test.beforeEach(async ({ page }) => {
    await ensureAuthenticated(page);
  });

  test("Test A: Core Academy Operations (Branches, Teams, Players, Sessions, Merchandise)", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const pageErrors: string[] = [];
    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

    // -------------------------------------------------------------------------
    // 1. Branches (/branches)
    // -------------------------------------------------------------------------
    await page.goto("/branches", { waitUntil: "domcontentloaded" });

    await expect(
      page
        .locator("h1, h2, h3, span")
        .filter({ hasText: /Branches|ROSTER \/ BRANCHES/i })
        .first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByPlaceholder("Search branches or cities…")).toBeVisible({
      timeout: 15000,
    });

    const newBranchBtn = page.getByRole("button", { name: /\+ New branch/i }).first();
    const newBranchModalHeading = page
      .locator("h2")
      .filter({ hasText: /^New branch$/i })
      .first();
    await expect(newBranchBtn).toBeVisible({ timeout: 15000 });
    await expect(async () => {
      if (!(await newBranchModalHeading.isVisible())) {
        await newBranchBtn.click();
      }
      await expect(newBranchModalHeading).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });

    const branchNameInput = page.getByPlaceholder("e.g. Beirut Central");
    await expect(branchNameInput).toBeVisible({ timeout: 15000 });
    await branchNameInput.fill("[E2E TEST] Branch Check");
    await expect(branchNameInput).toHaveValue("[E2E TEST] Branch Check");

    await page
      .getByRole("button", { name: /^Cancel$/i })
      .first()
      .click();
    await expect(newBranchModalHeading).toBeHidden({ timeout: 15000 });

    // -------------------------------------------------------------------------
    // 2. Teams (/teams)
    // -------------------------------------------------------------------------
    await page.goto("/teams", { waitUntil: "domcontentloaded" });

    await expect(
      page
        .locator("h1, h2, h3, span")
        .filter({ hasText: /Team list|ROSTER \/ TEAMS/i })
        .first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByPlaceholder("Search teams or coaches…")).toBeVisible({
      timeout: 15000,
    });

    const newTeamBtn = page.getByRole("button", { name: /\+ New team/i }).first();
    const newTeamModalHeading = page
      .locator("h2")
      .filter({ hasText: /^New team$/i })
      .first();
    await expect(newTeamBtn).toBeVisible({ timeout: 15000 });
    await expect(async () => {
      if (!(await newTeamModalHeading.isVisible())) {
        await newTeamBtn.click();
      }
      await expect(newTeamModalHeading).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });

    await expect(page.getByRole("button", { name: /Create team/i }).first()).toBeVisible({
      timeout: 15000,
    });

    await page
      .getByRole("button", { name: /^Cancel$/i })
      .first()
      .click();
    await expect(newTeamModalHeading).toBeHidden({ timeout: 15000 });

    // -------------------------------------------------------------------------
    // 3. Players (/players)
    // -------------------------------------------------------------------------
    await page.goto("/players", { waitUntil: "domcontentloaded" });

    await expect(
      page
        .locator("h1, h2, h3, span")
        .filter({ hasText: /Players|ROSTER \/ PLAYERS/i })
        .first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByPlaceholder("Search name, parent name or phone…")).toBeVisible({
      timeout: 15000,
    });

    const newPlayerBtn = page.getByRole("button", { name: /\+ New player/i }).first();
    const newPlayerModalHeading = page
      .locator("h2")
      .filter({ hasText: /^New player$/i })
      .first();
    await expect(newPlayerBtn).toBeVisible({ timeout: 15000 });
    await expect(async () => {
      if (!(await newPlayerModalHeading.isVisible())) {
        await newPlayerBtn.click();
      }
      await expect(newPlayerModalHeading).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });

    const guardianInput = page.getByPlaceholder("Full name of primary guardian");
    await expect(guardianInput).toBeVisible({ timeout: 15000 });
    await guardianInput.fill("[E2E TEST] Guardian Check");
    await expect(guardianInput).toHaveValue("[E2E TEST] Guardian Check");

    await page
      .getByRole("button", { name: /^Cancel$/i })
      .first()
      .click();
    await expect(newPlayerModalHeading).toBeHidden({ timeout: 15000 });

    // -------------------------------------------------------------------------
    // 4. Sessions (/sessions)
    // -------------------------------------------------------------------------
    await page.goto("/sessions", { waitUntil: "domcontentloaded" });

    await expect(
      page
        .locator("h1, h2, h3, span")
        .filter({ hasText: /Sessions|OPS \/ SESSIONS/i })
        .first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByPlaceholder("Search sessions, coaches…")).toBeVisible({
      timeout: 15000,
    });

    const newSessionBtn = page.getByRole("button", { name: /\+ New session/i }).first();
    const newSessionModalHeading = page
      .locator("h2")
      .filter({ hasText: /^New session$/i })
      .first();
    await expect(newSessionBtn).toBeVisible({ timeout: 15000 });
    await expect(async () => {
      if (!(await newSessionModalHeading.isVisible())) {
        await newSessionBtn.click();
      }
      await expect(newSessionModalHeading).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });

    await expect(page.getByRole("button", { name: /Create session/i }).first()).toBeVisible({
      timeout: 15000,
    });

    await page
      .getByRole("button", { name: /^Cancel$/i })
      .first()
      .click();
    await expect(newSessionModalHeading).toBeHidden({ timeout: 15000 });

    // -------------------------------------------------------------------------
    // 5. Merchandise (/merchandise)
    // -------------------------------------------------------------------------
    await page.goto("/merchandise", { waitUntil: "domcontentloaded" });

    await expect(
      page
        .locator("h1, h2, h3, span")
        .filter({ hasText: /Merchandise|OPS \/ MERCHANDISE/i })
        .first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByPlaceholder("Search items, colors, sizes, suppliers…")).toBeVisible({
      timeout: 15000,
    });

    const newItemBtn = page.getByRole("button", { name: /\+ New item/i }).first();
    const newItemModalHeading = page
      .locator("h2")
      .filter({ hasText: /New inventory item/i })
      .first();
    await expect(newItemBtn).toBeVisible({ timeout: 15000 });
    await expect(async () => {
      if (!(await newItemModalHeading.isVisible())) {
        await newItemBtn.click();
      }
      await expect(newItemModalHeading).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });

    const itemNameInput = page.getByPlaceholder("e.g. Game jersey · home");
    await expect(itemNameInput).toBeVisible({ timeout: 15000 });
    await itemNameInput.fill("[E2E TEST] Jersey Item");
    await expect(itemNameInput).toHaveValue("[E2E TEST] Jersey Item");

    await page
      .getByRole("button", { name: /^Cancel$/i })
      .first()
      .click();
    await expect(newItemModalHeading).toBeHidden({ timeout: 15000 });

    expect(pageErrors, `Uncaught page errors: ${pageErrors.join("; ")}`).toHaveLength(0);
  });

  test("Test B: Technical Portal & Coach Portal (/technical & /coach)", async ({ page }) => {
    test.setTimeout(90_000);

    const pageErrors: string[] = [];
    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

    // -------------------------------------------------------------------------
    // 1. Technical Portal (/technical)
    // -------------------------------------------------------------------------
    await page.goto("/technical", { waitUntil: "domcontentloaded" });

    await expect(
      page
        .locator("h1, h2, h3, span")
        .filter({ hasText: /Technical Portal|Approvals, Curriculum & Match Operations/i })
        .first(),
    ).toBeVisible({ timeout: 15000 });

    // Switch to Practice plans tab and open "+ New plan" modal
    const practicePlansTabBtn = page.getByRole("button", { name: /^Practice plans$/i }).first();
    const newPlanBtn = page.getByRole("button", { name: /\+ New plan/i }).first();
    await expect(practicePlansTabBtn).toBeVisible({ timeout: 15000 });
    await expect(async () => {
      if (!(await newPlanBtn.isVisible())) {
        await practicePlansTabBtn.click();
      }
      await expect(newPlanBtn).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });

    await newPlanBtn.click();
    const createPlanSubmitBtn = page.getByRole("button", { name: /Create plan/i }).first();
    await expect(createPlanSubmitBtn).toBeVisible({ timeout: 15000 });

    await page
      .getByRole("button", { name: /^Cancel$/i })
      .first()
      .click();
    await expect(createPlanSubmitBtn).toBeHidden({ timeout: 15000 });

    // Switch through remaining Technical Portal sub-tabs
    const technicalSubTabs = [
      /^Drill repository$/i,
      /^Resources$/i,
      /^Completed games$/i,
      /^Workshops$/i,
      /^Game approval$/i,
    ];
    for (const tabRegex of technicalSubTabs) {
      const tabBtn = page.getByRole("button", { name: tabRegex }).first();
      await expect(tabBtn).toBeVisible({ timeout: 15000 });
      await tabBtn.click();
    }

    // -------------------------------------------------------------------------
    // 2. Coach Portal (/coach)
    // -------------------------------------------------------------------------
    await page.goto("/coach", { waitUntil: "domcontentloaded" });

    await expect(
      page
        .locator("h1, h2, h3, div, span")
        .filter({ hasText: /Coach Portal|\/COACH/i })
        .first(),
    ).toBeVisible({ timeout: 15000 });

    // Toggle through Coach Portal bottom navigation tabs
    const coachSubTabs = [
      /\bCalendar\b/i,
      /\bGames\b/i,
      /\bDocs\b/i,
      /\bPlans\b/i,
      /\bProfile\b/i,
      /\bHome\b/i,
    ];
    for (const tabRegex of coachSubTabs) {
      const tabBtn = page.getByRole("button", { name: tabRegex }).first();
      await expect(tabBtn).toBeVisible({ timeout: 15000 });
      await tabBtn.click();
    }

    expect(pageErrors, `Uncaught page errors: ${pageErrors.join("; ")}`).toHaveLength(0);
  });
});

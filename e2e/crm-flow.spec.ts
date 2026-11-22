import { expect, test } from "@playwright/test";
import { ensureAuthenticated } from "./helpers/auth";

test.describe("Vescio Vector CRM — Full Pipeline E2E Suite", () => {
  test.beforeEach(async ({ page }) => {
    await ensureAuthenticated(page);
  });

  test("Full CRM Pipeline Flow: Load, Create Lead, Communication Log, Stage Update, Filter, and Cleanup", async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const pageErrors: string[] = [];
    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

    // -------------------------------------------------------------------------
    // 1. CRM Load & Pipeline Views (/crm)
    // -------------------------------------------------------------------------
    await page.goto("/crm", { waitUntil: "domcontentloaded" });

    await expect(page.getByText(/Basketball Academy CRM/i).first()).toBeVisible({
      timeout: 10000,
    });
    const kanbanBoardBtn = page.getByRole("button", { name: /Kanban Board/i }).first();
    await expect(kanbanBoardBtn).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole("button", { name: /List View/i }).first()).toBeVisible({
      timeout: 10000,
    });
    await kanbanBoardBtn.click();
    await expect(
      page
        .locator("h2, h3, h4")
        .filter({ hasText: /New Inquiries \/ Leads/i })
        .first(),
    ).toBeVisible({
      timeout: 10000,
    });

    // -------------------------------------------------------------------------
    // 2. Create Test Lead ([E2E TEST] Pipeline Lead)
    // -------------------------------------------------------------------------
    const newLeadBtn = page.getByRole("button", { name: /New Lead \/ Inquiry|New Lead/i }).first();
    const newLeadModalHeading = page.getByText(/New CRM Lead \/ Client Card/i).first();
    await expect(newLeadBtn).toBeVisible({ timeout: 10000 });
    await expect(async () => {
      if (!(await newLeadModalHeading.isVisible())) {
        await newLeadBtn.click();
      }
      await expect(newLeadModalHeading).toBeVisible({
        timeout: 2000,
      });
    }).toPass({ timeout: 10000 });

    const leadName = "[E2E TEST] Pipeline Lead";
    const playerInput = page.getByPlaceholder("e.g., Karim Mansour");
    await expect(playerInput).toBeVisible({ timeout: 10000 });
    await playerInput.fill(leadName);

    const parentInput = page.getByPlaceholder("Parent Full Name");
    await parentInput.fill("E2E Parent Guardian");

    const phoneInput = page.getByPlaceholder("+961 3 000 000");
    await phoneInput.fill("+961 3 888 999");

    const saveCardBtn = page.getByRole("button", { name: /Save CRM Card/i }).first();
    await saveCardBtn.click();

    await expect(page.getByText(/New CRM Lead \/ Client Card/i).first()).toBeHidden({
      timeout: 10000,
    });

    // Verify the newly created lead appears in the pipeline
    const leadCardHeading = page.locator("h4, td").filter({ hasText: leadName }).first();
    await expect(leadCardHeading).toBeVisible({ timeout: 10000 });

    // -------------------------------------------------------------------------
    // 3. Lead Detail, Communication Log & Stage Update
    // -------------------------------------------------------------------------
    await leadCardHeading.click();

    const detailModalHeading = page
      .locator("h2")
      .filter({ hasText: /CRM Client Profile & Activity Log/i })
      .first();
    await expect(detailModalHeading).toBeVisible({
      timeout: 10000,
    });

    // Add a communication log entry ("E2E follow-up check")
    const commNoteInput = page.getByPlaceholder(
      /Log call outcome, parent feedback, WhatsApp message, or trial notes/i,
    );
    await expect(commNoteInput).toBeVisible({ timeout: 10000 });
    await commNoteInput.fill("E2E follow-up check");

    const logNoteBtn = page.getByRole("button", { name: /^Log Note$/i }).first();
    await logNoteBtn.click();

    await expect(page.getByText("E2E follow-up check").first()).toBeVisible({
      timeout: 10000,
    });

    // Advance/update pipeline stage to Trial Scheduled
    const stageSelectInModal = page
      .locator("select")
      .filter({ hasText: /Stage:\s*New Inquiries \/ Leads/i })
      .first();
    await expect(stageSelectInModal).toBeVisible({ timeout: 10000 });
    await stageSelectInModal.selectOption("trial_scheduled");

    await expect(page.getByText(/Moved pipeline stage to "Trial Scheduled"/i).first()).toBeVisible({
      timeout: 10000,
    });

    // Close detail modal via its Close button (Modal has no Escape handler)
    const closeModalBtn = page.getByRole("button", { name: /^Close$/i }).first();
    await expect(closeModalBtn).toBeVisible({ timeout: 10000 });
    await closeModalBtn.click();
    await expect(detailModalHeading).toBeHidden({ timeout: 10000 });

    // -------------------------------------------------------------------------
    // 4. Filters & Cleanup
    // -------------------------------------------------------------------------
    const searchInput = page.getByPlaceholder(
      /Search player, parent, phone, team, branch, or age category/i,
    );
    await expect(searchInput).toBeVisible({ timeout: 10000 });
    await searchInput.fill(leadName);
    await expect(page.locator("h4, td").filter({ hasText: leadName }).first()).toBeVisible({
      timeout: 10000,
    });

    // Toggle List View and back to Kanban Board to confirm views don't crash
    await page
      .getByRole("button", { name: /List View/i })
      .first()
      .click();
    await expect(page.locator("h4, td").filter({ hasText: leadName }).first()).toBeVisible({
      timeout: 10000,
    });

    await page
      .getByRole("button", { name: /Kanban Board/i })
      .first()
      .click();
    const kanbanLeadHeading = page.locator("h4").filter({ hasText: leadName }).first();
    await expect(kanbanLeadHeading).toBeVisible({ timeout: 10000 });

    // Re-open the test lead and delete it so staging data stays clean
    await kanbanLeadHeading.click();
    await expect(detailModalHeading).toBeVisible({ timeout: 10000 });

    const deleteBtn = page.locator('button[title="Delete CRM Card"]').first();
    await expect(deleteBtn).toBeVisible({ timeout: 10000 });
    await deleteBtn.click();

    await expect(detailModalHeading).toBeHidden({ timeout: 10000 });
    await searchInput.fill("");
    await expect(page.locator("h4, td").filter({ hasText: leadName })).toHaveCount(0, {
      timeout: 10000,
    });

    expect(pageErrors, `Uncaught page errors: ${pageErrors.join("; ")}`).toHaveLength(0);
  });
});

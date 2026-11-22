import { expect, test } from "@playwright/test";

test.describe("Vescio Vector CRM — Full Pipeline E2E Suite", () => {
  test("Full CRM Pipeline Flow: Load, Create Lead, Communication Log, Stage Update, Filter, and Cleanup", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

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

    // -------------------------------------------------------------------------
    // 1. CRM Load & Pipeline Views (/crm)
    // -------------------------------------------------------------------------
    await page.goto("/crm", { waitUntil: "domcontentloaded" });

    await expect(page.getByText(/Basketball Academy CRM/i).first()).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole("button", { name: /Kanban Board/i }).first()).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole("button", { name: /List View/i }).first()).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText(/1\. Inquiry \/ New Lead/i).first()).toBeVisible({
      timeout: 15000,
    });

    // -------------------------------------------------------------------------
    // 2. Create Test Lead ([E2E TEST] Pipeline Lead)
    // -------------------------------------------------------------------------
    const newLeadBtn = page.getByRole("button", { name: /New Lead \/ Inquiry|New Lead/i }).first();
    await expect(newLeadBtn).toBeVisible({ timeout: 15000 });
    await newLeadBtn.click();

    await expect(page.getByText(/New CRM Lead \/ Client Card/i).first()).toBeVisible({
      timeout: 15000,
    });

    const leadName = "[E2E TEST] Pipeline Lead";
    const playerInput = page.getByPlaceholder("e.g., Karim Mansour");
    await expect(playerInput).toBeVisible({ timeout: 15000 });
    await playerInput.fill(leadName);

    const parentInput = page.getByPlaceholder("Parent Full Name");
    await parentInput.fill("E2E Parent Guardian");

    const phoneInput = page.getByPlaceholder("+961 3 000 000");
    await phoneInput.fill("+961 3 888 999");

    const saveCardBtn = page.getByRole("button", { name: /Save CRM Card/i }).first();
    await saveCardBtn.click();

    // Verify the newly created lead appears in the pipeline
    const leadCardText = page.getByText(leadName).first();
    await expect(leadCardText).toBeVisible({ timeout: 15000 });

    // -------------------------------------------------------------------------
    // 3. Lead Detail, Communication Log & Stage Update
    // -------------------------------------------------------------------------
    await leadCardText.click();

    await expect(page.getByText(/CRM Client Profile & Activity Log/i).first()).toBeVisible({
      timeout: 15000,
    });

    // Add a communication log entry ("E2E follow-up check")
    const commNoteInput = page.getByPlaceholder(
      /Log call outcome, parent feedback, WhatsApp message, or trial notes/i,
    );
    await expect(commNoteInput).toBeVisible({ timeout: 15000 });
    await commNoteInput.fill("E2E follow-up check");

    const logNoteBtn = page.getByRole("button", { name: /^Log Note$/i }).first();
    await logNoteBtn.click();

    await expect(page.getByText("E2E follow-up check").first()).toBeVisible({
      timeout: 15000,
    });

    // Advance/update pipeline stage to Trial Scheduled
    const stageSelectInModal = page
      .locator("select")
      .filter({ hasText: "Stage: 1. Inquiry / New Lead" })
      .first();
    await expect(stageSelectInModal).toBeVisible({ timeout: 15000 });
    await stageSelectInModal.selectOption("trial_scheduled");

    await expect(
      page.getByText(/Moved pipeline stage to "2\. Trial Scheduled"/i).first(),
    ).toBeVisible({ timeout: 15000 });

    // Close detail modal temporarily to verify filters
    await page.keyboard.press("Escape");

    // -------------------------------------------------------------------------
    // 4. Filters & Cleanup
    // -------------------------------------------------------------------------
    const searchInput = page.getByPlaceholder(
      /Search player, parent, phone, team, branch, or age category/i,
    );
    await expect(searchInput).toBeVisible({ timeout: 15000 });
    await searchInput.fill(leadName);
    await expect(page.getByText(leadName).first()).toBeVisible({ timeout: 15000 });

    // Toggle List View and back to Kanban Board to confirm views don't crash
    await page
      .getByRole("button", { name: /List View/i })
      .first()
      .click();
    await expect(page.getByText(leadName).first()).toBeVisible({ timeout: 15000 });

    await page
      .getByRole("button", { name: /Kanban Board/i })
      .first()
      .click();
    await expect(page.getByText(leadName).first()).toBeVisible({ timeout: 15000 });

    // Re-open the test lead and delete it so staging data stays clean
    await page.getByText(leadName).first().click();
    const deleteBtn = page.locator('button[title="Delete CRM Card"]').first();
    await expect(deleteBtn).toBeVisible({ timeout: 15000 });
    await deleteBtn.click();

    await searchInput.fill("");
    await expect(page.getByText(leadName)).toHaveCount(0, { timeout: 15000 });

    expect(pageErrors, `Uncaught page errors: ${pageErrors.join("; ")}`).toHaveLength(0);
  });
});

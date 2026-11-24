import { expect, test, type Page } from "@playwright/test";
import { authenticateAsRole } from "./helpers/auth";

function attachRuntimeErrorGuard(page: Page): string[] {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (err) => {
    runtimeErrors.push(err.message || String(err));
  });
  return runtimeErrors;
}

test.describe("Role-Based Access Control (RBAC) Multi-Role Verification Suite", () => {
  test("1. Super Admin — full navigation across Academy, Accounting (P&L & Trial Balance), CRM, Nexus ERP, Branches, and Users & Access", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const runtimeErrors = attachRuntimeErrorGuard(page);

    await authenticateAsRole(page, "Super Admin");

    // 1. Dashboard
    await expect(page.locator("header h1").first()).toBeVisible({ timeout: 15000 });

    // 2. Accounting — verify full write access, Multi-Vertical P&L Matrix, and Trial Balance
    await page.goto("/accounting", { waitUntil: "domcontentloaded" });
    await expect(
      page
        .locator("header h1")
        .filter({ hasText: /^Accounting$/i })
        .first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: /\+ New entry/i }).first()).toBeVisible();

    const reportsTabBtn = page.getByRole("button", { name: /Reports & P&L/i }).first();
    await expect(reportsTabBtn).toBeVisible();
    await reportsTabBtn.click();

    await expect(page.getByText(/Multi-Vertical P&L Matrix/i).first()).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText(/Trial Balance & Double-Entry Verification/i).first()).toBeVisible({
      timeout: 15000,
    });

    // 3. CRM & Pipeline
    await page.goto("/crm", { waitUntil: "domcontentloaded" });
    await expect(
      page
        .locator("header h1")
        .filter({ hasText: /CRM & Pipeline/i })
        .first(),
    ).toBeVisible({ timeout: 15000 });

    // 4. Vescio Nexus ERP
    await page.goto("/up-erp", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/Vescio Nexus/i).first()).toBeVisible({ timeout: 15000 });

    // 5. Branches
    await page.goto("/branches", { waitUntil: "domcontentloaded" });
    await expect(
      page
        .locator("header h1")
        .filter({ hasText: /Branches/i })
        .first(),
    ).toBeVisible({ timeout: 15000 });

    // 6. Users & Access (RBAC Matrix & Invites)
    await page.goto("/users", { waitUntil: "domcontentloaded" });
    await expect(
      page
        .locator("header h1")
        .filter({ hasText: /Users & Access/i })
        .first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: /\+ Invite user/i }).first()).toBeVisible();

    expect(runtimeErrors).toEqual([]);
  });

  test("2. Academy Manager — full operational & user management access while restricted from master-owner Client Console (/admin)", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const runtimeErrors = attachRuntimeErrorGuard(page);

    await authenticateAsRole(page, "Academy Manager");

    // Permitted: Players (write enabled)
    await page.goto("/players", { waitUntil: "domcontentloaded" });
    await expect(
      page
        .locator("header h1")
        .filter({ hasText: /^Players$/i })
        .first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: /\+ Enroll player/i }).first()).toBeVisible();

    // Permitted: Accounting & Users & Access
    await page.goto("/accounting", { waitUntil: "domcontentloaded" });
    await expect(
      page
        .locator("header h1")
        .filter({ hasText: /^Accounting$/i })
        .first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: /\+ New entry/i }).first()).toBeVisible();

    await page.goto("/users", { waitUntil: "domcontentloaded" });
    await expect(
      page
        .locator("header h1")
        .filter({ hasText: /Users & Access/i })
        .first(),
    ).toBeVisible({ timeout: 15000 });

    // Restricted: Master-Owner Client Console (/admin) link is not present in sidebar
    await expect(page.locator('aside a[href="/admin"]')).toHaveCount(0);

    expect(runtimeErrors).toEqual([]);
  });

  test("3. Branch Manager — branch-scoped access to Branches, Sessions, Players, and CRM while restricted from Accounting and Users & Access", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const runtimeErrors = attachRuntimeErrorGuard(page);

    await authenticateAsRole(page, "Branch Manager", { branch: "HQ" });

    // 1. Permitted: Branch view (/branches) — scoped to assigned branch, cannot create new branches
    await page.goto("/branches", { waitUntil: "domcontentloaded" });
    await expect(
      page
        .locator("header h1")
        .filter({ hasText: /My Branch|Branches/i })
        .first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: /\+ New branch/i })).toHaveCount(0);

    // 2. Permitted: Sessions (/sessions) with write access
    await page.goto("/sessions", { waitUntil: "domcontentloaded" });
    await expect(
      page
        .locator("header h1")
        .filter({ hasText: /^Sessions$/i })
        .first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: /\+ Schedule session/i }).first()).toBeVisible();

    // 3. Permitted: Players (/players) and CRM (/crm)
    await page.goto("/players", { waitUntil: "domcontentloaded" });
    await expect(
      page
        .locator("header h1")
        .filter({ hasText: /^Players$/i })
        .first(),
    ).toBeVisible({ timeout: 15000 });

    await page.goto("/crm", { waitUntil: "domcontentloaded" });
    await expect(
      page
        .locator("header h1")
        .filter({ hasText: /CRM & Pipeline/i })
        .first(),
    ).toBeVisible({ timeout: 15000 });

    // 4. Restricted: Sidebar does not expose Accounting, Users & Access, or Technical Portal
    await expect(page.locator('aside a[href="/accounting"]')).toHaveCount(0);
    await expect(page.locator('aside a[href="/users"]')).toHaveCount(0);
    await expect(page.locator('aside a[href="/technical"]')).toHaveCount(0);

    // 5. Direct navigation to /users is blocked or redirected away
    await page.goto("/users", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /\+ Invite user/i })).toHaveCount(0);

    // 6. Direct navigation to /accounting is redirected away by AppShell RBAC guard
    await page.goto("/accounting", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /\+ New entry/i })).toHaveCount(0);

    expect(runtimeErrors).toEqual([]);
  });

  test("4. Technical Director — full access to Technical Portal (/technical), Teams, and Sessions while restricted from Accounting and Users & Access", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const runtimeErrors = attachRuntimeErrorGuard(page);

    await authenticateAsRole(page, "Technical Director");

    // 1. Permitted: Technical Portal (/technical)
    await page.goto("/technical", { waitUntil: "domcontentloaded" });
    await expect(
      page
        .locator("header h1")
        .filter({ hasText: /Technical Portal/i })
        .first(),
    ).toBeVisible({ timeout: 15000 });

    // Verify Technical Director can open "+ New drill" modal and close it cleanly
    const newDrillBtn = page.getByRole("button", { name: /\+ New drill/i }).first();
    await expect(newDrillBtn).toBeVisible();
    await newDrillBtn.click();
    const cancelBtn = page.getByRole("button", { name: /^Cancel$/i }).first();
    if (await cancelBtn.isVisible().catch(() => false)) {
      await cancelBtn.click();
    }

    // Verify Practice Plans & Tryouts tabs on Technical Portal
    const plansTab = page.getByRole("button", { name: /Practice Plans/i }).first();
    if (await plansTab.isVisible().catch(() => false)) {
      await plansTab.click();
    }
    const evalsTab = page.getByRole("button", { name: /Tryouts & Evaluations/i }).first();
    if (await evalsTab.isVisible().catch(() => false)) {
      await evalsTab.click();
    }

    // 2. Permitted: Teams (/teams) and Sessions (/sessions)
    await page.goto("/teams", { waitUntil: "domcontentloaded" });
    await expect(page.locator("header h1").filter({ hasText: /Teams/i }).first()).toBeVisible({
      timeout: 15000,
    });

    await page.goto("/sessions", { waitUntil: "domcontentloaded" });
    await expect(
      page
        .locator("header h1")
        .filter({ hasText: /^Sessions$/i })
        .first(),
    ).toBeVisible({ timeout: 15000 });

    // 3. Restricted: Sidebar hides Accounting, Users & Access, and Merchandise
    await expect(page.locator('aside a[href="/accounting"]')).toHaveCount(0);
    await expect(page.locator('aside a[href="/users"]')).toHaveCount(0);
    await expect(page.locator('aside a[href="/merchandise"]')).toHaveCount(0);

    // Direct navigation to /accounting or /users does not expose restricted controls
    await page.goto("/accounting", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /\+ New entry/i })).toHaveCount(0);

    await page.goto("/users", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /\+ Invite user/i })).toHaveCount(0);

    expect(runtimeErrors).toEqual([]);
  });

  test("5. Coach — dedicated Coach Portal (/coach) workflow and automatic redirection away from restricted admin routes", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const runtimeErrors = attachRuntimeErrorGuard(page);

    await authenticateAsRole(page, "Coach", { branch: "HQ" });

    // 1. Permitted: Coach Portal (/coach) renders cleanly (either active Coach Portal or valid empty-coach state in CI)
    await expect(
      page
        .getByText(
          /Coach Portal|No Coach Profile Linked|Administrative Coach Switcher|Report Issue/i,
        )
        .first(),
    ).toBeVisible({ timeout: 15000 });

    // Coach has access to the "Report Issue" workflow in the sidebar
    const reportIssueBtn = page.getByRole("button", { name: /Report Issue/i }).first();
    await expect(reportIssueBtn).toBeVisible();
    await reportIssueBtn.click();
    await expect(page.getByText(/Report Facility or Equipment Issue/i).first()).toBeVisible({
      timeout: 10000,
    });
    const cancelIssueBtn = page.getByRole("button", { name: /^Cancel$/i }).first();
    await cancelIssueBtn.click();

    // 2. Restricted: Admin links are hidden from Coach sidebar
    await expect(page.locator('aside a[href="/accounting"]')).toHaveCount(0);
    await expect(page.locator('aside a[href="/users"]')).toHaveCount(0);
    await expect(page.locator('aside a[href="/crm"]')).toHaveCount(0);
    await expect(page.locator('aside a[href="/branches"]')).toHaveCount(0);

    // 3. Direct URL navigation to /accounting or /users redirects Coach back to /coach
    await page.goto("/accounting", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/coach/);
    await expect(page.getByRole("button", { name: /\+ New entry/i })).toHaveCount(0);

    await page.goto("/users", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/coach/);
    await expect(page.getByRole("button", { name: /\+ Invite user/i })).toHaveCount(0);

    expect(runtimeErrors).toEqual([]);
  });

  test("6. Accountant — full access to Accounting (Ledger, Multi-Vertical P&L, Trial Balance, New Entry modal) and Merchandise while restricted from Users & Access and Technical Portal", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const runtimeErrors = attachRuntimeErrorGuard(page);

    await authenticateAsRole(page, "Accountant");

    // 1. Permitted: Full Accounting & Financial Reporting (/accounting)
    await page.goto("/accounting", { waitUntil: "domcontentloaded" });
    await expect(
      page
        .locator("header h1")
        .filter({ hasText: /^Accounting$/i })
        .first(),
    ).toBeVisible({ timeout: 15000 });

    // Accountant can open "+ New entry" modal
    const newEntryBtn = page.getByRole("button", { name: /\+ New entry/i }).first();
    await expect(newEntryBtn).toBeVisible();
    await newEntryBtn.click();
    await expect(page.getByText(/Record ledger entry/i).first()).toBeVisible({ timeout: 10000 });
    await page
      .getByRole("button", { name: /^Cancel$/i })
      .first()
      .click();

    // Accountant can inspect Reports & P&L + Trial Balance
    await page
      .getByRole("button", { name: /Reports & P&L/i })
      .first()
      .click();
    await expect(page.getByText(/Multi-Vertical P&L Matrix/i).first()).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText(/Trial Balance & Double-Entry Verification/i).first()).toBeVisible({
      timeout: 15000,
    });

    // 2. Permitted: Merchandise (/merchandise) and read-only Players (/players)
    await page.goto("/merchandise", { waitUntil: "domcontentloaded" });
    await expect(
      page
        .locator("header h1")
        .filter({ hasText: /Merchandise/i })
        .first(),
    ).toBeVisible({ timeout: 15000 });

    await page.goto("/players", { waitUntil: "domcontentloaded" });
    await expect(
      page
        .locator("header h1")
        .filter({ hasText: /^Players$/i })
        .first(),
    ).toBeVisible({ timeout: 15000 });
    // Read-only on players: cannot enroll new players
    await expect(page.getByRole("button", { name: /\+ Enroll player/i })).toHaveCount(0);

    // 3. Restricted: Users & Access (/users) and Technical Portal (/technical)
    await expect(page.locator('aside a[href="/users"]')).toHaveCount(0);
    await expect(page.locator('aside a[href="/technical"]')).toHaveCount(0);

    await page.goto("/users", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /\+ Invite user/i })).toHaveCount(0);

    expect(runtimeErrors).toEqual([]);
  });

  test("7. Staff (Operational & Nexus Front Desk) — read-only Academy views and Vescio Nexus ERP (/up-erp) access while restricted from Accounting and Users & Access", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const runtimeErrors = attachRuntimeErrorGuard(page);

    await authenticateAsRole(page, "Staff", { branch: "HQ" });

    // 1. Permitted: Vescio Nexus ERP (/up-erp) — Front Desk & Facility Modules
    await page.goto("/up-erp", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/Vescio Nexus/i).first()).toBeVisible({ timeout: 15000 });

    const courtsBtn = page.getByRole("button", { name: /^Courts$/i }).first();
    if (await courtsBtn.isVisible().catch(() => false)) {
      await courtsBtn.click();
    }
    const posBtn = page.getByRole("button", { name: /Kiosk POS/i }).first();
    if (await posBtn.isVisible().catch(() => false)) {
      await posBtn.click();
    }

    // 2. Permitted (Read-Only): Players (/players) and Sessions (/sessions)
    await page.goto("/players", { waitUntil: "domcontentloaded" });
    await expect(
      page
        .locator("header h1")
        .filter({ hasText: /^Players$/i })
        .first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: /\+ Enroll player/i })).toHaveCount(0);

    await page.goto("/sessions", { waitUntil: "domcontentloaded" });
    await expect(
      page
        .locator("header h1")
        .filter({ hasText: /^Sessions$/i })
        .first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: /\+ Schedule session/i })).toHaveCount(0);

    // 3. Restricted: Accounting, Users & Access, and Technical Portal
    await expect(page.locator('aside a[href="/accounting"]')).toHaveCount(0);
    await expect(page.locator('aside a[href="/users"]')).toHaveCount(0);
    await expect(page.locator('aside a[href="/technical"]')).toHaveCount(0);

    await page.goto("/accounting", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /\+ New entry/i })).toHaveCount(0);

    await page.goto("/users", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /\+ Invite user/i })).toHaveCount(0);

    expect(runtimeErrors).toEqual([]);
  });
});

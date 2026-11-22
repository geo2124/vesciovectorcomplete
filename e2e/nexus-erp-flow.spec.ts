import { expect, test } from "@playwright/test";
import { ensureAuthenticated } from "./helpers/auth";

test.describe("Vescio Nexus ERP — Full Multi-Module E2E Suite", () => {
  test.beforeEach(async ({ page }) => {
    await ensureAuthenticated(page);
  });

  test("Full Nexus ERP Flow: Overview, Full-Screen Mode, Courts, Gym, Physio, and POS", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => {
      pageErrors.push(err.message);
    });

    // -------------------------------------------------------------------------
    // 1. Nexus Overview & Standalone Full-Screen Mode (/up-erp)
    // -------------------------------------------------------------------------
    await page.goto("/up-erp", { waitUntil: "domcontentloaded" });

    // Verify Overview Hub and KPI cards render
    await expect(
      page
        .getByText(/MULTI-BRANCH HUB|Nexus Overview|Vescio Nexus · Live Executive Command Center/i)
        .first(),
    ).toBeVisible({
      timeout: 15000,
    });
    const overviewKpiCard = page.getByText(/Today's Nexus Revenue/i).first();
    await expect(overviewKpiCard).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Courts Today · Utilization/i).first()).toBeVisible({
      timeout: 15000,
    });

    // Launch Courts module and verify Overview KPI cards are hidden & slim header is visible
    const launchCourtsBtn = page
      .getByRole("button", { name: /Launch Courts|Court Reservation/i })
      .first();
    await expect(launchCourtsBtn).toBeVisible({ timeout: 15000 });
    await expect(launchCourtsBtn).toBeEnabled({ timeout: 15000 });
    await launchCourtsBtn.click();

    await expect(overviewKpiCard).toBeHidden({ timeout: 15000 });
    const backToOverviewBtn = page.getByRole("button", { name: /Overview/i }).first();
    const fullScreenBtn = page.getByRole("button", { name: /Full Screen/i }).first();
    await expect(backToOverviewBtn).toBeVisible({ timeout: 15000 });
    await expect(fullScreenBtn).toBeVisible({ timeout: 15000 });

    // Enter Standalone Full-Screen Mode
    await fullScreenBtn.click();
    const exitFullScreenBtn = page
      .getByRole("button", { name: /Exit Full Screen \/ Back to Nexus/i })
      .first();
    await expect(exitFullScreenBtn).toBeVisible({ timeout: 15000 });

    // Exit Full-Screen Mode cleanly
    await exitFullScreenBtn.click();
    await expect(exitFullScreenBtn).toBeHidden({ timeout: 15000 });
    await expect(fullScreenBtn).toBeVisible({ timeout: 15000 });

    // -------------------------------------------------------------------------
    // 2. Court Reservations Module
    // -------------------------------------------------------------------------
    await expect(
      page.getByText(/Interactive 15-Minute Court Reservation & Rates Engine/i).first(),
    ).toBeVisible({ timeout: 15000 });

    const newBookingBtn = page
      .getByRole("button", { name: /\+ New Booking|New Reservation/i })
      .first();
    await expect(newBookingBtn).toBeVisible({ timeout: 15000 });
    await newBookingBtn.click();

    await expect(page.getByText(/New Court & Facility Booking/i).first()).toBeVisible({
      timeout: 15000,
    });

    const bookingClientInput = page.getByPlaceholder("Enter client, group, or club name");
    await expect(bookingClientInput).toBeVisible({ timeout: 15000 });
    await bookingClientInput.fill("[E2E TEST] Court Booking");
    await expect(bookingClientInput).toHaveValue("[E2E TEST] Court Booking");

    // Verify dynamic pricing summary responds cleanly
    await expect(
      page.getByText(/Session Payable:|Pricing Overrides & Final Snapshot Fee/i).first(),
    ).toBeVisible({ timeout: 15000 });

    // Cancel modal so no orphan test data remains
    await page
      .getByRole("button", { name: /^Cancel$/i })
      .first()
      .click();
    await expect(bookingClientInput).toBeHidden({ timeout: 15000 });

    // -------------------------------------------------------------------------
    // 3. Gym Module
    // -------------------------------------------------------------------------
    const gymTabBtn = page
      .locator("header button")
      .filter({ hasText: /\bGym\b/i })
      .first();
    await expect(gymTabBtn).toBeVisible({ timeout: 15000 });
    await gymTabBtn.click();

    await expect(
      page.getByText(/Gym Clients, Coach-as-Client, Packages & Progress/i).first(),
    ).toBeVisible({ timeout: 15000 });

    // Open member registration modal (+ Enroll Client)
    const enrollClientBtn = page.getByRole("button", { name: /\+ Enroll Client/i }).first();
    await expect(enrollClientBtn).toBeVisible({ timeout: 15000 });
    await enrollClientBtn.click();

    const gymClientNameInput = page.getByPlaceholder("e.g., Karim Mansour");
    await expect(gymClientNameInput).toBeVisible({ timeout: 15000 });
    await gymClientNameInput.fill("[E2E TEST] Gym Member");
    await expect(gymClientNameInput).toHaveValue("[E2E TEST] Gym Member");

    // Close modal cleanly without polluting database
    await page
      .getByRole("button", { name: /^Cancel$/i })
      .first()
      .click();
    await expect(gymClientNameInput).toBeHidden({ timeout: 15000 });

    // Switch across Gym sub-tabs and verify zero runtime errors
    const gymSubTabs = [
      /Clients Directory/i,
      /Coaches & Coach-as-Client/i,
      /Packages & Memberships/i,
      /Progress Tracking & Follow-Up/i,
      /Schedule & Fast Check-In/i,
    ];
    for (const tabPattern of gymSubTabs) {
      const subTabBtn = page.getByRole("button", { name: tabPattern }).first();
      await expect(subTabBtn).toBeVisible({ timeout: 15000 });
      await subTabBtn.click();
    }
    await expect(page.getByText(/Fast Front-Desk Check-In/i).first()).toBeVisible({
      timeout: 15000,
    });

    // -------------------------------------------------------------------------
    // 4. Physiotherapy Module
    // -------------------------------------------------------------------------
    const physioTabBtn = page
      .locator("header button")
      .filter({ hasText: /Physio/i })
      .first();
    await expect(physioTabBtn).toBeVisible({ timeout: 15000 });
    await physioTabBtn.click();

    await expect(page.getByText(/Physiotherapy & Medical Center Module/i).first()).toBeVisible({
      timeout: 15000,
    });

    // Open + Patient Intake modal and verify intake controls render without undefined errors
    const patientIntakeBtn = page.getByRole("button", { name: /\+ Patient Intake/i }).first();
    await expect(patientIntakeBtn).toBeVisible({ timeout: 15000 });
    await patientIntakeBtn.click();

    const patientNameInput = page.getByPlaceholder("Full Legal Name");
    await expect(patientNameInput).toBeVisible({ timeout: 15000 });
    await patientNameInput.fill("[E2E TEST] Physio Patient");
    await expect(patientNameInput).toHaveValue("[E2E TEST] Physio Patient");

    await page
      .getByRole("button", { name: /^Cancel$/i })
      .first()
      .click();
    await expect(patientNameInput).toBeHidden({ timeout: 15000 });

    // -------------------------------------------------------------------------
    // 5. Kiosk / POS Module
    // -------------------------------------------------------------------------
    const posTabBtn = page
      .locator("header button")
      .filter({ hasText: /Kiosk POS/i })
      .first();
    await expect(posTabBtn).toBeVisible({ timeout: 15000 });
    await posTabBtn.click();

    await expect(page.getByText(/Kiosk & Cafeteria POS System/i).first()).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText(/Current Cart & Checkout/i).first()).toBeVisible({
      timeout: 15000,
    });

    // Add a catalog item to the cart from the touch product grid
    const productCards = page.locator("button:not([disabled])").filter({ hasText: /in stock|∞/i });
    const productCount = await productCards.count();
    if (productCount > 0) {
      await productCards.first().click();

      // Verify cart updates with Grand Total and Clear button appears
      const clearCartBtn = page.getByRole("button", { name: /^Clear$/i }).first();
      await expect(clearCartBtn).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(/Grand Total/i).first()).toBeVisible({ timeout: 15000 });
      await expect(
        page.getByRole("button", { name: /Complete Sale & Print Receipt/i }).first(),
      ).toBeEnabled({ timeout: 15000 });

      // Clear the cart cleanly
      await clearCartBtn.click();
      await expect(page.getByText(/Cart is empty\./i).first()).toBeVisible({
        timeout: 15000,
      });
    }

    expect(pageErrors, `Uncaught page errors: ${pageErrors.join("; ")}`).toHaveLength(0);
  });
});

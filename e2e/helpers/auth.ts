import { expect, type Page } from "@playwright/test";

export const E2E_SUPER_ADMIN_USER = {
  id: "admin-1",
  name: "Georges Khoury",
  email: "geogo3@gmail.com",
  role: "Super Admin",
  branch: "All",
  active: true,
  tenantId: "donbosco",
};

/**
 * Shared Playwright E2E authentication helper.
 * - Seeds the deterministic Super Admin session and E2E auth bypass flag before navigation.
 * - Navigates to `/` and checks whether the Login / Auth lock screen is rendered.
 * - Signs in via `process.env.E2E_EMAIL` / `process.env.E2E_PASSWORD` if provided, or falls back
 *   to the `VITE_E2E_BYPASS_AUTH=true` / `localStorage` test session when running under Playwright CI.
 * - Waits for the authenticated AppShell (sidebar / navigation) to be visible before returning.
 */
export async function ensureAuthenticated(page: Page): Promise<void> {
  await page.addInitScript((sessionUser) => {
    window.localStorage.setItem("vv_e2e_bypass_auth", "true");
    window.localStorage.setItem("vv_auth_session_user", JSON.stringify(sessionUser));
    window.sessionStorage.setItem("vv_auth_session_user", JSON.stringify(sessionUser));
  }, E2E_SUPER_ADMIN_USER);

  await page.goto("/", { waitUntil: "domcontentloaded" });

  const loginPrompt = page.getByText(/SYSTEM LOCKED · AUTHENTICATION REQUIRED/i).first();
  const signInBtn = page.getByRole("button", { name: /Sign In to Workspace/i }).first();

  const isLocked =
    (await loginPrompt.isVisible().catch(() => false)) ||
    (await signInBtn.isVisible().catch(() => false));

  if (isLocked) {
    const e2eEmail = process.env.E2E_EMAIL?.trim();
    const e2ePassword = process.env.E2E_PASSWORD?.trim();

    if (e2eEmail && e2ePassword) {
      const emailInput = page.getByPlaceholder(/Enter username or email/i).first();
      const passwordInput = page.getByPlaceholder(/••••••••••••/).first();
      await emailInput.fill(e2eEmail);
      await passwordInput.fill(e2ePassword);
      await signInBtn.click();
    } else {
      await page.evaluate((sessionUser) => {
        window.localStorage.setItem("vv_e2e_bypass_auth", "true");
        window.localStorage.setItem("vv_auth_session_user", JSON.stringify(sessionUser));
        window.sessionStorage.setItem("vv_auth_session_user", JSON.stringify(sessionUser));
      }, E2E_SUPER_ADMIN_USER);
      await page.reload({ waitUntil: "domcontentloaded" });
    }
  }

  // Wait for the authenticated AppShell sidebar / navigation to be visible
  const appShellNav = page.locator("aside, nav").first();
  await expect(appShellNav).toBeVisible({ timeout: 15000 });
}

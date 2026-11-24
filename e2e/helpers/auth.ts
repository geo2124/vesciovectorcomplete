import { expect, type Page } from "@playwright/test";

export const E2E_SUPER_ADMIN_USER = {
  id: "admin-1",
  name: "Georges Khoury",
  email: "geogo3@gmail.com",
  role: "Super Admin",
  branch: "All",
  branchScope: "All branches" as const,
  active: true,
  method: "Password" as const,
  tenantId: "donbosco",
};

export type E2ECanonicalRole =
  | "Super Admin"
  | "Academy Manager"
  | "Branch Manager"
  | "Technical Director"
  | "Accountant"
  | "Coach"
  | "Staff";

export type E2ERoleInput =
  | E2ECanonicalRole
  | "super_admin"
  | "academy_manager"
  | "admin"
  | "branch_manager"
  | "technical_director"
  | "accountant"
  | "coach"
  | "staff"
  | "receptionist"
  | "nexus_staff";

export interface AuthenticateAsRoleOptions {
  branch?: string;
  branchScope?: "All branches" | "Assigned branch only";
  name?: string;
  email?: string;
  id?: string;
  initialPath?: string;
}

const ROLE_ALIAS_MAP: Record<string, E2ECanonicalRole> = {
  "super admin": "Super Admin",
  super_admin: "Super Admin",
  superadmin: "Super Admin",
  "academy manager": "Academy Manager",
  academy_manager: "Academy Manager",
  admin: "Academy Manager",
  "branch manager": "Branch Manager",
  branch_manager: "Branch Manager",
  "technical director": "Technical Director",
  technical_director: "Technical Director",
  accountant: "Accountant",
  coach: "Coach",
  staff: "Staff",
  receptionist: "Staff",
  nexus_staff: "Staff",
};

export function resolveCanonicalE2ERole(role: E2ERoleInput): E2ECanonicalRole {
  const key = String(role).trim().toLowerCase();
  return ROLE_ALIAS_MAP[key] || "Staff";
}

export function buildE2ESessionUser(
  roleInput: E2ERoleInput,
  options: AuthenticateAsRoleOptions = {},
) {
  const canonicalRole = resolveCanonicalE2ERole(roleInput);
  if (canonicalRole === "Super Admin" && !options.email) {
    return {
      ...E2E_SUPER_ADMIN_USER,
      ...(options.branch ? { branch: options.branch } : {}),
      ...(options.name ? { name: options.name } : {}),
    };
  }

  const slug = canonicalRole.toLowerCase().replace(/[^a-z0-9]+/g, ".");
  const idSlug = canonicalRole.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const isBranchScopedByDefault =
    canonicalRole === "Branch Manager" || canonicalRole === "Coach" || canonicalRole === "Staff";

  const branch = options.branch || (isBranchScopedByDefault ? "HQ" : "All");
  const branchScope =
    options.branchScope ||
    (branch !== "All" && isBranchScopedByDefault ? "Assigned branch only" : "All branches");

  return {
    id: options.id || `e2e-${idSlug}`,
    authUid: options.id || `e2e-${idSlug}`,
    name: options.name || `[E2E] ${canonicalRole}`,
    email: options.email || `e2e.${slug}@vescio.test`,
    username: `e2e_${slug.replace(/\./g, "_")}`,
    role: canonicalRole,
    branch,
    branchScope,
    active: true,
    method: "Password" as const,
    tenantId: "donbosco",
  };
}

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
    window.localStorage.removeItem("e2e_test_role");
    window.localStorage.removeItem("e2e_test_branch");
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
        window.localStorage.removeItem("e2e_test_role");
        window.localStorage.removeItem("e2e_test_branch");
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

/**
 * E2E-only role switching helper.
 * Seeds `vv_e2e_bypass_auth`, `e2e_test_role`, `e2e_test_branch`, and `vv_auth_session_user`
 * so the app boots deterministically under the target RBAC role without affecting production builds.
 */
export async function authenticateAsRole(
  page: Page,
  role: E2ERoleInput,
  options: AuthenticateAsRoleOptions = {},
): Promise<void> {
  const sessionUser = buildE2ESessionUser(role, options);
  const defaultLandingPath =
    options.initialPath ||
    (sessionUser.role === "Coach"
      ? "/coach"
      : sessionUser.role === "Technical Director"
        ? "/technical"
        : "/");

  await page.addInitScript((userPayload) => {
    window.localStorage.setItem("vv_e2e_bypass_auth", "true");
    window.localStorage.setItem("e2e_test_role", userPayload.role);
    window.localStorage.setItem("e2e_test_branch", userPayload.branch);
    window.localStorage.setItem("vv_auth_session_user", JSON.stringify(userPayload));
    window.sessionStorage.setItem("vv_auth_session_user", JSON.stringify(userPayload));
  }, sessionUser);

  await page.goto(defaultLandingPath, { waitUntil: "domcontentloaded" });

  // Also ensure current window storage is updated in case the page was already open
  await page.evaluate((userPayload) => {
    window.localStorage.setItem("vv_e2e_bypass_auth", "true");
    window.localStorage.setItem("e2e_test_role", userPayload.role);
    window.localStorage.setItem("e2e_test_branch", userPayload.branch);
    window.localStorage.setItem("vv_auth_session_user", JSON.stringify(userPayload));
    window.sessionStorage.setItem("vv_auth_session_user", JSON.stringify(userPayload));
  }, sessionUser);

  const loginPrompt = page.getByText(/SYSTEM LOCKED · AUTHENTICATION REQUIRED/i).first();
  if (await loginPrompt.isVisible().catch(() => false)) {
    await page.reload({ waitUntil: "domcontentloaded" });
  }

  const appShellNav = page.locator("aside, nav").first();
  await expect(appShellNav).toBeVisible({ timeout: 15000 });
}

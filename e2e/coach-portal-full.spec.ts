import { expect, test, type Page } from "@playwright/test";
import { authenticateAsRole } from "./helpers/auth";

const E2E_COACH_ID = "c-e2e-coach";
const E2E_COACH_NAME = "[E2E TEST] Coach Karim";
const E2E_COACH_EMAIL = "e2e.coach@vescio.test";
const E2E_BRANCH_NAME = "HQ";
const E2E_TEAM_NAME = "[E2E TEST] U-16 Elite";
const E2E_SESSION_ID = "s-e2e-coach-practice";
const E2E_SESSION_TITLE = "[E2E TEST] U-16 Tactical Session";

function attachRuntimeErrorGuard(page: Page): string[] {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (err) => {
    runtimeErrors.push(err.message || String(err));
  });
  return runtimeErrors;
}

/**
 * Seeds a deterministic Coach Portal workspace into `vv_cache_donbosco` before booting
 * as a Coach so `/coach` renders the full linked Coach Portal experience in CI.
 */
async function loginAsLinkedCoach(page: Page): Promise<void> {
  const todayStr = new Date().toISOString().slice(0, 10);

  const seedPayload = {
    branches: [
      {
        id: "b-e2e-hq",
        name: E2E_BRANCH_NAME,
        city: "Beirut",
        manager: "Branch Director",
        address: "Downtown Sports Complex",
        phone: "+961 70 111 222",
        teams: 1,
        players: 2,
        courtsCount: 1,
        courts: [
          {
            id: "court-main",
            name: "Main Court",
            contact: "Branch Director",
            phone: "+961 70 111 222",
            schedule: "08:00 - 22:00",
            operatingHours: "08:00 - 22:00",
          },
        ],
      },
    ],
    coaches: [
      {
        id: E2E_COACH_ID,
        name: E2E_COACH_NAME,
        email: E2E_COACH_EMAIL,
        username: "e2e_coach",
        phone: "+961 71 555 888",
        years: 6,
        level: "FIBA Level 2",
        gender: "M",
        wins: 4,
        losses: 1,
        sessions: 12,
        sessionTarget: 20,
        rate: 45,
        outstanding: 90,
        branch: E2E_BRANCH_NAME,
        branches: [E2E_BRANCH_NAME],
        teams: [E2E_TEAM_NAME],
        team: E2E_TEAM_NAME,
        portal: true,
        finals: 1,
        championships: 1,
        finalsRecord: [
          {
            id: "fin-seed-1",
            tournament: "[E2E TEST] Beirut Spring Cup",
            date: todayStr,
            team: E2E_TEAM_NAME,
            result: "Champion",
            score: "78 - 71",
          },
        ],
      },
    ],
    teams: [
      {
        id: "t-e2e-u16",
        name: E2E_TEAM_NAME,
        category: "U-16",
        gender: "Boys",
        branch: E2E_BRANCH_NAME,
        coach: E2E_COACH_NAME,
        coachId: E2E_COACH_ID,
        headCoach: E2E_COACH_NAME,
        headCoachId: E2E_COACH_ID,
        headCoachRate: 45,
        players: 2,
        cap: 15,
        record: "4-1",
        gamesFrequencyPerMonth: 2,
      },
    ],
    players: [
      {
        id: "p-e2e-1",
        name: "[E2E TEST] Rami Haddad",
        dob: "2011-04-12",
        age: 15,
        category: "U-16",
        gender: "M",
        branch: E2E_BRANCH_NAME,
        teams: [E2E_TEAM_NAME],
        team: E2E_TEAM_NAME,
        position: "Guard",
        status: "Active",
        fee: 120,
        paid: 120,
        parent: "Nabil Haddad",
        phone: "+961 70 222 333",
      },
      {
        id: "p-e2e-2",
        name: "[E2E TEST] Jad Khoury",
        dob: "2011-08-20",
        age: 15,
        category: "U-16",
        gender: "M",
        branch: E2E_BRANCH_NAME,
        teams: [E2E_TEAM_NAME],
        team: E2E_TEAM_NAME,
        position: "Forward",
        status: "Active",
        fee: 120,
        paid: 120,
        parent: "Sami Khoury",
        phone: "+961 70 444 555",
      },
    ],
    sessions: [
      {
        id: E2E_SESSION_ID,
        kind: "Practice",
        title: E2E_SESSION_TITLE,
        team: E2E_TEAM_NAME,
        detail: "Main Court",
        court: "Main Court",
        date: todayStr,
        time: "17:00",
        branch: E2E_BRANCH_NAME,
        coach: E2E_COACH_NAME,
        coachId: E2E_COACH_ID,
        headCoach: E2E_COACH_NAME,
        headCoachId: E2E_COACH_ID,
        status: "Planned",
      },
    ],
    drills: [
      {
        id: "dr-e2e-1",
        name: "[E2E TEST] 3-Man Weave Transition",
        category: "Transition",
        durationMinutes: 15,
        intensity: "High",
        description: "Full-court passing and layup finish without dribbling.",
        createdBy: "Technical Director",
      },
    ],
    workshops: [
      {
        id: "ws-e2e-1",
        title: "[E2E TEST] Modern Zone Offense Clinic",
        date: todayStr,
        time: "19:30",
        location: E2E_BRANCH_NAME,
        presenter: "Technical Directorate",
        status: "Upcoming",
        description: "Ball reversal, high-post flashing, and baseline runner concepts.",
        assignedCoaches: [E2E_COACH_ID],
        assignedLevels: ["FIBA Level 2"],
        attendeeIds: [],
        documents: [],
      },
    ],
    resourceFolders: [
      {
        id: "rf-e2e-1",
        name: "[E2E TEST] Tactical Playbook 2026",
        assignedCoaches: [E2E_COACH_ID],
        assignedLevels: ["FIBA Level 2"],
        items: [
          {
            id: "ri-e2e-quiz",
            name: "[E2E TEST] Defensive Rotations Check",
            type: "Interactive Form",
            quiz: {
              questions: [
                {
                  id: "q-1",
                  prompt: "Who rotates to protect the rim on baseline drive?",
                  type: "Text",
                },
              ],
            },
          },
        ],
      },
    ],
    plans: [],
    attendance: {},
  };

  await page.addInitScript((seed) => {
    try {
      const existingRaw = window.localStorage.getItem("vv_cache_donbosco");
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      const merged = {
        ...existing,
        ...seed,
      };
      window.localStorage.setItem("vv_cache_donbosco", JSON.stringify(merged));
    } catch {
      // ignore storage errors
    }
  }, seedPayload);

  await authenticateAsRole(page, "coach", {
    id: E2E_COACH_ID,
    name: E2E_COACH_NAME,
    email: E2E_COACH_EMAIL,
    branch: E2E_BRANCH_NAME,
    initialPath: "/coach",
  });
}

test.describe("Coach Portal Comprehensive E2E Suite (/coach)", () => {
  test("1. Coach Portal Shell, Navigation & All 6 Sub-Tabs (Home, Calendar, Games, Docs, Plans, Profile)", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const runtimeErrors = attachRuntimeErrorGuard(page);

    await loginAsLinkedCoach(page);

    // Verify Coach Portal header and linked coach banner
    await expect(page.getByText("Coach Portal").first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(E2E_COACH_NAME).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/PORTAL ON/i).first()).toBeVisible();
    await expect(page.getByText(/VERIFIED/i).first()).toBeVisible();

    const bottomNav = page.locator("nav").last();
    await expect(bottomNav).toBeVisible();

    // 1. Home tab (default)
    await expect(page.getByText(/Next session/i).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(E2E_SESSION_TITLE).first()).toBeVisible();

    // 2. Calendar tab
    await bottomNav.getByRole("button", { name: /Calendar/i }).click();
    await expect(page.getByText(/My schedule/i).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: /Calendar View/i }).first()).toBeVisible();
    const gridViewBtn = page.getByRole("button", { name: /Grid View/i }).first();
    await expect(gridViewBtn).toBeVisible();
    await gridViewBtn.click();
    await expect(page.getByText(E2E_SESSION_TITLE).first()).toBeVisible({ timeout: 15000 });

    // Open session detail modal from Calendar Grid View and close it
    await page.getByText(E2E_SESSION_TITLE).first().click();
    await expect(
      page.getByRole("button", { name: /Open Attendance Turnstile/i }).first(),
    ).toBeVisible({ timeout: 15000 });
    await page
      .getByRole("button", { name: /Close modal/i })
      .first()
      .click();

    // 3. Games tab
    await bottomNav.getByRole("button", { name: /Games/i }).click();
    await expect(
      page.getByText(/Monthly Game Frequency & Experience Targets/i).first(),
    ).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: /Start New Game/i }).first()).toBeVisible();

    // 4. Docs tab
    await bottomNav.getByRole("button", { name: /Docs/i }).click();
    await expect(page.getByText(/Assigned Coaching Workshops & Seminars/i).first()).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText(/Shared with me/i).first()).toBeVisible();

    // 5. Plans tab
    await bottomNav.getByRole("button", { name: /Plans/i }).click();
    await expect(page.getByText(/Practice plan builder/i).first()).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole("button", { name: /Open Drill Selector/i }).first()).toBeVisible();
    await expect(page.getByText(/My plans/i).first()).toBeVisible();

    // 6. Profile tab
    await bottomNav.getByRole("button", { name: /Profile/i }).click();
    await expect(page.getByText(/Coach Balance & Payroll Account/i).first()).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText(/Finals & Championship Honors/i).first()).toBeVisible();
    await expect(page.getByText(/Full Payments & Payroll Ledger Records/i).first()).toBeVisible();
    await expect(page.getByText(/Official License & Certification/i).first()).toBeVisible();
    await expect(page.getByText(/My Details & Academy Credentials/i).first()).toBeVisible();

    expect(runtimeErrors).toEqual([]);
  });

  test("2. Session Details, Staff Check-In, Manual Override Modal, QR Scanner & Attendance Submission Flow", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const runtimeErrors = attachRuntimeErrorGuard(page);

    await loginAsLinkedCoach(page);

    // Before check-in, verify attendance turnstile is locked
    await expect(page.getByText(/Attendance Locked: Coach Check-In Required/i).first()).toBeVisible(
      { timeout: 15000 },
    );

    // Open "Branch Manager Manual Check-In (Reason Required)" modal, verify fields, and close cleanly
    const manualOverrideBtn = page
      .getByRole("button", { name: /Branch Manager Manual Check-In/i })
      .first();
    await expect(manualOverrideBtn).toBeVisible();
    await manualOverrideBtn.click();
    await expect(page.getByText(/Mandatory Reason for Manual Check-In/i).first()).toBeVisible({
      timeout: 15000,
    });
    await page
      .getByRole("button", { name: /^Cancel$/i })
      .first()
      .click();

    // Perform Coach Check-In to unlock the attendance turnstile
    const coachCheckInBtn = page
      .getByRole("button", { name: /Coach Check-In \(Court GPS\)|^Coach Check-In$/i })
      .first();
    await expect(coachCheckInBtn).toBeVisible();
    await coachCheckInBtn.click();

    await expect(page.getByText(/Turnstile Unlocked/i).first()).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Turnstile active · Staff verified/i).first()).toBeVisible();

    // Verify player rows appear in the Attendance Turnstile card
    await expect(page.getByText("[E2E TEST] Rami Haddad").first()).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("[E2E TEST] Jad Khoury").first()).toBeVisible();

    // Open QR Scanner modal and close it cleanly
    const scanQrBtn = page.getByRole("button", { name: /Scan QR Pass/i }).first();
    await expect(scanQrBtn).toBeVisible();
    await scanQrBtn.click();
    await page
      .getByRole("button", { name: /Close modal|Cancel|Close/i })
      .first()
      .click();

    // Toggle individual player attendance statuses (Present / Excused)
    const ramiRow = page
      .locator("div")
      .filter({ hasText: /^\[E2E TEST\] Rami Haddad/ })
      .first();
    const ramiPresentBtn = page.getByRole("button", { name: /^P$/ }).first();
    await ramiPresentBtn.click();
    await expect(page.getByText(/Attendance · 1P · 0E · 1A/i).first()).toBeVisible({
      timeout: 15000,
    });

    const jadExcusedBtn = page.getByRole("button", { name: /^E$/ }).nth(1);
    await jadExcusedBtn.click();
    await expect(page.getByText(/Attendance · 1P · 1E · 0A/i).first()).toBeVisible({
      timeout: 15000,
    });

    // Click "✓ Mark All Present" and verify counter updates to 2P · 0E · 0A
    const markAllPresentBtn = page.getByRole("button", { name: /Mark All Present/i }).first();
    await markAllPresentBtn.click();
    await expect(page.getByText(/Attendance · 2P · 0E · 0A/i).first()).toBeVisible({
      timeout: 15000,
    });

    // Complete Practice Session & verify attendance summary in completion modal
    const completePracticeBtn = page
      .getByRole("button", { name: /Complete Practice & Mark Coach Present/i })
      .first();
    await expect(completePracticeBtn).toBeVisible();
    await completePracticeBtn.click();

    await expect(page.getByText(/2 Present · 0 Excused · 0 Absent/i).first()).toBeVisible({
      timeout: 15000,
    });
    await page
      .getByRole("button", { name: /Complete Practice & Mark Present/i })
      .first()
      .click();

    await expect(
      page.getByText(/Practice completed and coach attendance verified as Present/i).first(),
    ).toBeVisible({ timeout: 15000 });

    void ramiRow;
    expect(runtimeErrors).toEqual([]);
  });

  test("3. Coach Actions, Forms & Submissions (Report Issue, Schedule Practice, Plans & Drill Selector, Games, Workshop RSVP, Profile & Record Final)", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const runtimeErrors = attachRuntimeErrorGuard(page);

    await loginAsLinkedCoach(page);

    // A. Report Issue Modal Submission
    const headerReportIssueBtn = page
      .locator("header")
      .getByRole("button", { name: /Report Issue/i })
      .first();
    await expect(headerReportIssueBtn).toBeVisible({ timeout: 15000 });
    await headerReportIssueBtn.click();

    await expect(page.getByText(/Report a Technical Issue/i).first()).toBeVisible({
      timeout: 15000,
    });
    const issueTextarea = page
      .getByPlaceholder(/Briefly describe the problem you encountered/i)
      .first();
    await issueTextarea.fill("[E2E TEST] Coach portal smoke issue");
    await page
      .getByRole("button", { name: /Send Report to Administrator/i })
      .first()
      .click();

    await expect(
      page.getByText(/The problem has been reported to the system administrator\./i).first(),
    ).toBeVisible({ timeout: 15000 });
    await page
      .getByRole("button", { name: /^Done$/i })
      .first()
      .click();

    // B. Schedule Practice Modal Submission (+ Schedule Practice)
    const schedulePracticeBtn = page.getByRole("button", { name: /\+ Schedule Practice/i }).first();
    await expect(schedulePracticeBtn).toBeVisible();
    await schedulePracticeBtn.click();

    await expect(page.getByText(/Schedule Practice Session/i).first()).toBeVisible({
      timeout: 15000,
    });
    const sessionTitleInput = page.getByPlaceholder(/e\.g\. U-16 Tactical Practice/i).first();
    await sessionTitleInput.fill("[E2E TEST] Evening Shooting Practice");
    await page
      .getByRole("button", { name: /^Schedule Practice$/i })
      .first()
      .click();

    await expect(page.getByText("[E2E TEST] Evening Shooting Practice").first()).toBeVisible({
      timeout: 15000,
    });

    const bottomNav = page.locator("nav").last();

    // C. Practice Plan Builder & Drill Selector Drawer (Plans Tab)
    await bottomNav.getByRole("button", { name: /Plans/i }).click();
    await expect(page.getByText(/Practice plan builder/i).first()).toBeVisible({
      timeout: 15000,
    });

    const openDrillSelectorBtn = page.getByRole("button", { name: /Open Drill Selector/i }).first();
    await openDrillSelectorBtn.click();
    await expect(page.getByText("[E2E TEST] 3-Man Weave Transition").first()).toBeVisible({
      timeout: 15000,
    });
    await page
      .getByRole("button", { name: /Close modal|Close/i })
      .first()
      .click();

    const planTitleInput = page.getByPlaceholder("Transition week").first();
    await planTitleInput.fill("[E2E TEST] High Press Transition Plan");
    const planFocusInput = page.getByPlaceholder("Fast break spacing").first();
    await planFocusInput.fill("[E2E TEST] Full-court spacing & defensive balance");

    await page
      .getByRole("button", { name: /Submit for approval/i })
      .first()
      .click();

    await expect(page.getByText("[E2E TEST] High Press Transition Plan").first()).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText("SUBMITTED").first()).toBeVisible();

    // D. Games Tab — Start New Game Modal & Match Frequency Target Proposal
    await bottomNav.getByRole("button", { name: /Games/i }).click();
    const startNewGameBtn = page.getByRole("button", { name: /Start New Game/i }).first();
    await expect(startNewGameBtn).toBeVisible({ timeout: 15000 });
    await startNewGameBtn.click();

    const opponentInput = page.getByPlaceholder(/e\.g\. Beirut Elite/i).first();
    await expect(opponentInput).toBeVisible({ timeout: 15000 });
    await opponentInput.fill("[E2E TEST] Sagesse U16");
    await page
      .getByRole("button", { name: /Create & Schedule Game/i })
      .first()
      .click();

    await expect(page.getByText(/\[E2E TEST\] Sagesse U16/i).first()).toBeVisible({
      timeout: 15000,
    });

    // E. Docs Tab — Confirm Workshop Attendance & Open Shared Quiz Resource
    await bottomNav.getByRole("button", { name: /Docs/i }).click();
    await expect(page.getByText("[E2E TEST] Modern Zone Offense Clinic").first()).toBeVisible({
      timeout: 15000,
    });
    const confirmWorkshopBtn = page.getByRole("button", { name: /Confirm Attendance/i }).first();
    await confirmWorkshopBtn.click();
    await expect(page.getByText(/Registered|CONFIRMED/i).first()).toBeVisible({
      timeout: 15000,
    });

    const folderBtn = page
      .getByRole("button", { name: /\[E2E TEST\] Tactical Playbook 2026/i })
      .first();
    await folderBtn.click();
    await expect(page.getByText("[E2E TEST] Defensive Rotations Check").first()).toBeVisible({
      timeout: 15000,
    });
    await page
      .getByRole("button", { name: /^View$/i })
      .first()
      .click();
    const quizInput = page.getByPlaceholder("Your answer...").first();
    await expect(quizInput).toBeVisible({ timeout: 15000 });
    await quizInput.fill("[E2E TEST] Weak-side low post defender");
    await page
      .getByRole("button", { name: /Submit Quiz/i })
      .first()
      .click();
    await expect(page.getByText(/Response Recorded/i).first()).toBeVisible({ timeout: 15000 });
    await page
      .getByRole("button", { name: /Close modal/i })
      .first()
      .click();

    // F. Profile Tab — Record Final Achievement, Print Statement Modal & Save Profile Details
    await bottomNav.getByRole("button", { name: /Profile/i }).click();
    const recordFinalBtn = page.getByRole("button", { name: /Record Final/i }).first();
    await expect(recordFinalBtn).toBeVisible({ timeout: 15000 });
    await recordFinalBtn.click();

    const tournamentInput = page.getByPlaceholder(/e\.g\. Lebanon Youth Cup 2025/i).first();
    await expect(tournamentInput).toBeVisible({ timeout: 15000 });
    await tournamentInput.fill("[E2E TEST] National Youth Championship 2026");
    await page
      .getByRole("button", { name: /Save Final to Profile/i })
      .first()
      .click();

    await expect(page.getByText("[E2E TEST] National Youth Championship 2026").first()).toBeVisible(
      { timeout: 15000 },
    );

    // Open Printable Statement Modal and close it cleanly
    const printStatementBtn = page.getByRole("button", { name: /Print Statement/i }).first();
    await printStatementBtn.click();
    await page
      .getByRole("button", { name: /Close modal|Close/i })
      .first()
      .click();

    // Save Coach Profile Details
    const saveDetailsBtn = page.getByRole("button", { name: /Save my details/i }).first();
    await saveDetailsBtn.click();
    await expect(page.getByRole("button", { name: /Saved ✓/i }).first()).toBeVisible({
      timeout: 15000,
    });

    expect(runtimeErrors).toEqual([]);
  });

  test("4. Mobile Viewport (390x844) & Sticky Bottom Navigation Check", async ({ page }) => {
    test.setTimeout(90_000);
    const runtimeErrors = attachRuntimeErrorGuard(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await loginAsLinkedCoach(page);

    await expect(page.getByText("Coach Portal").first()).toBeVisible({ timeout: 15000 });
    const bottomNav = page.locator("nav").last();
    await expect(bottomNav).toBeVisible();

    const assertNoHorizontalOverflow = async () => {
      const hasOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 2,
      );
      expect(hasOverflow).toBe(false);
    };

    await assertNoHorizontalOverflow();

    // Navigate across 4 tabs on mobile viewport via sticky bottom nav
    await bottomNav.getByRole("button", { name: /Calendar/i }).click();
    await expect(page.getByText(/My schedule/i).first()).toBeVisible({ timeout: 15000 });
    await assertNoHorizontalOverflow();

    await bottomNav.getByRole("button", { name: /Games/i }).click();
    await expect(page.getByRole("button", { name: /Start New Game/i }).first()).toBeVisible({
      timeout: 15000,
    });
    await assertNoHorizontalOverflow();

    await bottomNav.getByRole("button", { name: /Plans/i }).click();
    await expect(page.getByText(/Practice plan builder/i).first()).toBeVisible({
      timeout: 15000,
    });
    await assertNoHorizontalOverflow();

    await bottomNav.getByRole("button", { name: /Profile/i }).click();
    await expect(page.getByText(/Coach Balance & Payroll Account/i).first()).toBeVisible({
      timeout: 15000,
    });
    await assertNoHorizontalOverflow();

    expect(runtimeErrors).toEqual([]);
  });

  test("5. RBAC Boundary Check — Coach Restricted from Admin Routes (/accounting, /branches, /crm, /users)", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const runtimeErrors = attachRuntimeErrorGuard(page);

    await loginAsLinkedCoach(page);

    // Coach Portal layout does not render administrative sidebar links
    await expect(page.locator('a[href="/accounting"]')).toHaveCount(0);
    await expect(page.locator('a[href="/branches"]')).toHaveCount(0);
    await expect(page.locator('a[href="/crm"]')).toHaveCount(0);
    await expect(page.locator('a[href="/users"]')).toHaveCount(0);

    // Direct navigation to restricted admin routes redirects Coach back to /coach cleanly
    for (const restrictedPath of ["/accounting", "/branches", "/crm", "/users"]) {
      await page.goto(restrictedPath, { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(/\/coach/, { timeout: 15000 });
      await expect(page.getByText("Coach Portal").first()).toBeVisible({ timeout: 15000 });
    }

    expect(runtimeErrors).toEqual([]);
  });
});

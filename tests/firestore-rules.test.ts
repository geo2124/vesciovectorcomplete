import fs from "node:fs";
import path from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const PROJECT_ID = "vescio-vector-rules-test";
const TENANT_A = "tenant-A";
const TENANT_B = "tenant-B";

let testEnv: RulesTestEnvironment;

async function seedMultiTenantFixtures() {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();

    // Seed Tenant A root & role memberships
    await setDoc(doc(adminDb, "tenants", TENANT_A), {
      name: "Tenant A Academy",
      memberEmails: ["admin-a@tenant-a.test", "coach-a@tenant-a.test"],
      roleMap: {
        "uid-admin-a": "Academy Manager",
        "admin-a@tenant-a.test": "Academy Manager",
        "uid-coach-a": "Coach",
        "coach-a@tenant-a.test": "Coach",
      },
    });

    await setDoc(doc(adminDb, "tenants", TENANT_A, "users", "uid-admin-a"), {
      id: "uid-admin-a",
      name: "Admin A",
      email: "admin-a@tenant-a.test",
      role: "Academy Manager",
      uiRole: "Academy Manager",
      active: true,
    });

    await setDoc(doc(adminDb, "tenants", TENANT_A, "users", "uid-coach-a"), {
      id: "uid-coach-a",
      name: "Coach A",
      email: "coach-a@tenant-a.test",
      role: "Coach",
      uiRole: "Coach",
      active: true,
    });

    await setDoc(doc(adminDb, "tenants", TENANT_A, "public", "auth_lookup"), {
      usernameMap: {
        admin_a: "admin-a@tenant-a.test",
      },
    });

    await setDoc(doc(adminDb, "tenants", TENANT_A, "players", "player-a1"), {
      id: "player-a1",
      name: "Adam Khoury",
      branch: "Main Campus",
      fee: 140,
    });

    await setDoc(doc(adminDb, "tenants", TENANT_A, "branches", "branch-a1"), {
      id: "branch-a1",
      name: "Tenant A Main Campus",
      city: "Beirut",
    });

    await setDoc(doc(adminDb, "tenants", TENANT_A, "ledger", "led-a1"), {
      id: "led-a1",
      account: "Player Fees",
      type: "Revenue",
      amount: 140,
    });

    await setDoc(doc(adminDb, "tenants", TENANT_A, "sessions", "sess-a1"), {
      id: "sess-a1",
      title: "U-16 Practice",
      coachId: "uid-coach-a",
      status: "Planned",
    });

    await setDoc(doc(adminDb, "tenants", TENANT_A, "workshops", "ws-a1"), {
      id: "ws-a1",
      title: "Ball-Screen Defense Symposium",
      attendeeIds: [],
    });

    // Seed Tenant B root & documents
    await setDoc(doc(adminDb, "tenants", TENANT_B), {
      name: "Tenant B Academy",
      memberEmails: ["admin-b@tenant-b.test"],
      roleMap: {
        "uid-admin-b": "Academy Manager",
        "admin-b@tenant-b.test": "Academy Manager",
      },
    });

    await setDoc(doc(adminDb, "tenants", TENANT_B, "users", "uid-admin-b"), {
      id: "uid-admin-b",
      name: "Admin B",
      email: "admin-b@tenant-b.test",
      role: "Academy Manager",
      uiRole: "Academy Manager",
      active: true,
    });

    await setDoc(doc(adminDb, "tenants", TENANT_B, "players", "player-b1"), {
      id: "player-b1",
      name: "Tenant B Athlete",
      branch: "North Branch",
      fee: 150,
    });

    await setDoc(doc(adminDb, "tenants", TENANT_B, "branches", "branch-b1"), {
      id: "branch-b1",
      name: "Tenant B North Branch",
      city: "Tripoli",
    });

    await setDoc(doc(adminDb, "tenants", TENANT_B, "ledger", "led-b1"), {
      id: "led-b1",
      account: "Player Fees",
      type: "Revenue",
      amount: 150,
    });
  });
}

describe("Firestore Security Rules Multi-Tenant & RBAC Verification", () => {
  beforeAll(async () => {
    const rulesPath = path.resolve(process.cwd(), "firestore.rules");
    const rules = fs.readFileSync(rulesPath, "utf8");

    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host: "127.0.0.1",
        port: 8080,
        rules,
      },
    });
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await seedMultiTenantFixtures();
  });

  afterAll(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  it("1. Unauthenticated Access: denies reading/writing tenants, users, players, or ledger without auth (except explicitly public paths)", async () => {
    const unauthDb = testEnv.unauthenticatedContext().firestore();

    // Unauthenticated reads must fail
    await assertFails(getDoc(doc(unauthDb, "tenants", TENANT_A)));
    await assertFails(getDoc(doc(unauthDb, "users", "uid-admin-a")));
    await assertFails(getDoc(doc(unauthDb, "tenants", TENANT_A, "users", "uid-admin-a")));
    await assertFails(getDoc(doc(unauthDb, "tenants", TENANT_A, "players", "player-a1")));
    await assertFails(getDoc(doc(unauthDb, "tenants", TENANT_A, "ledger", "led-a1")));

    // Unauthenticated writes must fail
    await assertFails(
      setDoc(doc(unauthDb, "tenants", TENANT_A, "players", "hack-player"), {
        name: "Unauthorized Player",
      }),
    );
    await assertFails(
      setDoc(doc(unauthDb, "tenants", TENANT_A, "ledger", "hack-ledger"), {
        amount: 99999,
      }),
    );
    await assertFails(
      setDoc(doc(unauthDb, "tenants", TENANT_A, "users", "hack-user"), {
        role: "Super Admin",
      }),
    );

    // Explicitly public auth_lookup read is allowed, but unauthenticated write must fail
    await assertSucceeds(getDoc(doc(unauthDb, "tenants", TENANT_A, "public", "auth_lookup")));
    await assertFails(
      setDoc(doc(unauthDb, "tenants", TENANT_A, "public", "auth_lookup"), {
        usernameMap: { hacked: "evil@test.com" },
      }),
    );
  });

  it("2. Cross-Tenant Isolation: denies Authenticated Admin of tenant-A from reading, updating, or deleting any document in tenant-B", async () => {
    const tenantAAdminDb = testEnv
      .authenticatedContext("uid-admin-a", {
        email: "admin-a@tenant-a.test",
        firebase: { sign_in_provider: "password" },
      })
      .firestore();

    // Cross-tenant reads in tenant-B must fail
    await assertFails(getDoc(doc(tenantAAdminDb, "tenants", TENANT_B)));
    await assertFails(getDoc(doc(tenantAAdminDb, "tenants", TENANT_B, "players", "player-b1")));
    await assertFails(getDoc(doc(tenantAAdminDb, "tenants", TENANT_B, "ledger", "led-b1")));
    await assertFails(getDoc(doc(tenantAAdminDb, "tenants", TENANT_B, "branches", "branch-b1")));
    await assertFails(getDoc(doc(tenantAAdminDb, "tenants", TENANT_B, "users", "uid-admin-b")));

    // Cross-tenant updates in tenant-B must fail
    await assertFails(
      updateDoc(doc(tenantAAdminDb, "tenants", TENANT_B, "players", "player-b1"), {
        fee: 0,
      }),
    );
    await assertFails(
      updateDoc(doc(tenantAAdminDb, "tenants", TENANT_B, "ledger", "led-b1"), {
        amount: 0,
      }),
    );

    // Cross-tenant deletes in tenant-B must fail
    await assertFails(deleteDoc(doc(tenantAAdminDb, "tenants", TENANT_B, "players", "player-b1")));
    await assertFails(deleteDoc(doc(tenantAAdminDb, "tenants", TENANT_B, "branches", "branch-b1")));
  });

  it("3. Coach Privilege Escalation: denies Authenticated coach in tenant-A from writing to ledger, modifying branches, or changing user roles", async () => {
    const coachADb = testEnv
      .authenticatedContext("uid-coach-a", {
        email: "coach-a@tenant-a.test",
        firebase: { sign_in_provider: "password" },
      })
      .firestore();

    // Coach reading or writing financial ledger must fail
    await assertFails(getDoc(doc(coachADb, "tenants", TENANT_A, "ledger", "led-a1")));
    await assertFails(
      setDoc(doc(coachADb, "tenants", TENANT_A, "ledger", "led-coach-escalate"), {
        id: "led-coach-escalate",
        account: "Coach Payroll Expense",
        type: "Expense",
        amount: 5000,
      }),
    );

    // Coach modifying or deleting branches must fail
    await assertFails(
      updateDoc(doc(coachADb, "tenants", TENANT_A, "branches", "branch-a1"), {
        name: "Hacked Branch Name",
      }),
    );
    await assertFails(deleteDoc(doc(coachADb, "tenants", TENANT_A, "branches", "branch-a1")));

    // Coach escalating their own role or changing another user's role must fail
    await assertFails(
      updateDoc(doc(coachADb, "tenants", TENANT_A, "users", "uid-coach-a"), {
        role: "Super Admin",
      }),
    );
    await assertFails(
      updateDoc(doc(coachADb, "tenants", TENANT_A, "users", "uid-admin-a"), {
        role: "Staff",
      }),
    );
    await assertFails(
      updateDoc(doc(coachADb, "tenants", TENANT_A), {
        "roleMap.uid-coach-a": "Super Admin",
      }),
    );
  });

  it("4. Authorized Role Access: allows Authenticated Admin / Super Admin in tenant-A to read and write within tenant-A", async () => {
    const tenantAAdminDb = testEnv
      .authenticatedContext("uid-admin-a", {
        email: "admin-a@tenant-a.test",
        firebase: { sign_in_provider: "password" },
      })
      .firestore();

    // Admin reads within tenant-A must succeed
    await assertSucceeds(getDoc(doc(tenantAAdminDb, "tenants", TENANT_A)));
    await assertSucceeds(getDoc(doc(tenantAAdminDb, "tenants", TENANT_A, "players", "player-a1")));
    await assertSucceeds(getDoc(doc(tenantAAdminDb, "tenants", TENANT_A, "ledger", "led-a1")));
    await assertSucceeds(getDoc(doc(tenantAAdminDb, "tenants", TENANT_A, "branches", "branch-a1")));

    // Admin writes within tenant-A must succeed
    await assertSucceeds(
      setDoc(doc(tenantAAdminDb, "tenants", TENANT_A, "players", "player-a2"), {
        id: "player-a2",
        name: "Jude Saliba",
        branch: "Main Campus",
        fee: 120,
      }),
    );
    await assertSucceeds(
      setDoc(doc(tenantAAdminDb, "tenants", TENANT_A, "ledger", "led-a2"), {
        id: "led-a2",
        account: "Tuition",
        type: "Revenue",
        amount: 120,
      }),
    );
    await assertSucceeds(
      updateDoc(doc(tenantAAdminDb, "tenants", TENANT_A, "branches", "branch-a1"), {
        operatingHours: "08:00 - 22:30",
      }),
    );
    await assertSucceeds(
      setDoc(doc(tenantAAdminDb, "tenants", TENANT_A, "users", "uid-staff-a"), {
        id: "uid-staff-a",
        name: "Front Desk Staff",
        email: "staff-a@tenant-a.test",
        role: "Staff",
        active: true,
      }),
    );
  });

  it("5. Role-Scoped Writes: allows Authenticated coach in tenant-A to read sessions, submit attendance, and confirm workshop attendance", async () => {
    const coachADb = testEnv
      .authenticatedContext("uid-coach-a", {
        email: "coach-a@tenant-a.test",
        firebase: { sign_in_provider: "password" },
      })
      .firestore();

    // Coach reading sessions and workshops in tenant-A must succeed
    await assertSucceeds(getDoc(doc(coachADb, "tenants", TENANT_A, "sessions", "sess-a1")));
    await assertSucceeds(getDoc(doc(coachADb, "tenants", TENANT_A, "workshops", "ws-a1")));

    // Coach updating session check-in status and submitting attendance in tenant-A must succeed
    await assertSucceeds(
      updateDoc(doc(coachADb, "tenants", TENANT_A, "sessions", "sess-a1"), {
        coachAttendance: "Present",
        status: "Completed",
      }),
    );
    await assertSucceeds(
      setDoc(doc(coachADb, "tenants", TENANT_A, "attendance", "sess-a1"), {
        id: "sess-a1",
        records: {
          "player-a1": "Present",
        },
      }),
    );

    // Coach confirming workshop attendance via setDoc({ merge: true }) must succeed
    await assertSucceeds(
      setDoc(
        doc(coachADb, "tenants", TENANT_A, "workshops", "ws-a1"),
        {
          id: "ws-a1",
          title: "Ball-Screen Defense Symposium",
          attendeeIds: ["uid-coach-a"],
          attendance: { "uid-coach-a": "Present" },
        },
        { merge: true },
      ),
    );
  });
});

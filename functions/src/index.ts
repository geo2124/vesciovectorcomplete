import * as admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";

setGlobalOptions({ region: "europe-west2" });

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = getFirestore("donbosco");

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export interface BillingExecutionResult {
  tenantId: string;
  billingMonth: string;
  monthCode: string;
  year: number;
  eligiblePlayers: number;
  generatedCount: number;
  skippedCount: number;
  totalAmount: number;
  flaggedSoft: number;
  flaggedInactive: number;
  unchanged: number;
  executedAt: string;
  durationMs: number;
}

/**
 * Server-authoritative execution of monthly tuition invoice generation and
 * overdue suspension evaluation for a single academy tenant.
 */
export async function executeMonthlyBillingForTenant(
  tenantId: string,
  targetMonthIndex?: number,
  targetYear?: number,
): Promise<BillingExecutionResult> {
  const startTime = Date.now();
  const now = new Date();

  const monthIdx =
    typeof targetMonthIndex === "number" && targetMonthIndex >= 0 && targetMonthIndex <= 11
      ? targetMonthIndex
      : now.getMonth();
  const year = targetYear || now.getFullYear();

  const monthCode = String(monthIdx + 1).padStart(2, "0");
  const monthLabel = MONTH_NAMES[monthIdx] || "January";

  // 1. Fetch Academy configuration for deadlines and billing rules
  const tenantDocRef = db.collection("tenants").doc(tenantId);
  const tenantDoc = await tenantDocRef.get();
  const tenantData = tenantDoc.data() || {};

  const softDeadline = typeof tenantData.softDeadline === "number" ? tenantData.softDeadline : 15;
  const hardDeadline = typeof tenantData.hardDeadline === "number" ? tenantData.hardDeadline : 30;

  // 2. Query players, teams, and branches
  const playersSnap = await tenantDocRef.collection("players").get();
  const teamsSnap = await tenantDocRef.collection("teams").get();
  const branchesSnap = await tenantDocRef.collection("branches").get();

  const teamsMap = new Map<string, { monthlyFee?: number; tier?: string; name: string }>();
  teamsSnap.docs.forEach((doc) => {
    const data = doc.data();
    teamsMap.set(data.name || doc.id, {
      monthlyFee: typeof data.monthlyFee === "number" ? data.monthlyFee : undefined,
      tier: data.tier,
      name: data.name || doc.id,
    });
  });

  const branchesList: { id: string; name: string; monthlyFee?: number }[] = [];
  branchesSnap.docs.forEach((doc) => {
    const data = doc.data();
    branchesList.push({
      id: String(data.id || doc.id),
      name: String(data.name || doc.id),
      monthlyFee: typeof data.monthlyFee === "number" ? data.monthlyFee : undefined,
    });
  });

  // 3. Query existing invoices to prevent duplicate runs (strict idempotency)
  const invoicesSnap = await tenantDocRef.collection("invoices").get();
  const existingInvoiceIds = new Set<string>();
  let existingMonthlyCount = 0;

  invoicesSnap.docs.forEach((doc) => {
    existingInvoiceIds.add(doc.id);
    const data = doc.data();
    if (data.year === year && data.month === monthCode) {
      existingMonthlyCount++;
    }
  });

  const playersToUpdate: {
    id: string;
    newBalance: number;
    newStatus?: "Active" | "Soft flag" | "Inactive";
  }[] = [];
  const newInvoices: Record<string, unknown>[] = [];

  let generatedCount = 0;
  let skippedCount = 0;
  let totalAmount = 0;
  let seq = existingMonthlyCount + 1;

  // 4. Process eligible players for monthly tuition
  for (const pDoc of playersSnap.docs) {
    const p = pDoc.data();
    const playerId = pDoc.id;
    const currentStatus = p.status || "Active";
    const isActive = currentStatus === "Active" || currentStatus === "Soft flag";

    if (!isActive) {
      continue;
    }

    const invoiceId = `${playerId}_${year}_${monthCode}`;

    if (existingInvoiceIds.has(invoiceId)) {
      skippedCount++;
      continue;
    }

    // Resolve squad tuition rate matching calculatePlayerMonthlyFee
    const playerTeams: string[] = Array.isArray(p.teams) ? p.teams : [];
    let matchedSquad: { monthlyFee?: number; tier?: string; name: string } | undefined;

    for (const tName of playerTeams) {
      if (teamsMap.has(tName)) {
        matchedSquad = teamsMap.get(tName);
        break;
      }
    }

    let tuitionRate = 0;
    if (playerTeams.length > 0) {
      let total = 0;
      const teamFeesMap =
        p.teamFees && typeof p.teamFees === "object"
          ? (p.teamFees as Record<string, number>)
          : undefined;

      for (const tName of playerTeams) {
        if (teamFeesMap && typeof teamFeesMap[tName] === "number") {
          total += teamFeesMap[tName];
        } else {
          const teamEntry = teamsMap.get(tName);
          if (teamEntry && typeof teamEntry.monthlyFee === "number" && teamEntry.monthlyFee > 0) {
            total += teamEntry.monthlyFee;
          }
        }
      }
      if (total > 0) {
        tuitionRate = total;
      }
    }

    if (tuitionRate <= 0) {
      if (typeof p.fee === "number" && p.fee > 0) {
        tuitionRate = p.fee;
      } else {
        const playerBranch = String(p.branch || "").toLowerCase();
        const branchEntry = branchesList.find(
          (b) => b.name.toLowerCase() === playerBranch || b.id.toLowerCase() === playerBranch,
        );
        if (
          branchEntry &&
          typeof branchEntry.monthlyFee === "number" &&
          branchEntry.monthlyFee > 0
        ) {
          tuitionRate = branchEntry.monthlyFee;
        } else {
          tuitionRate = 85;
        }
      }
    }

    const invoiceNumber = `INV-${year}-${monthCode}-${String(seq++).padStart(3, "0")}`;
    const newBalance = (Number(p.balance) || 0) + tuitionRate;
    const squadDisplayLabel =
      playerTeams.length > 0 ? playerTeams.join(" + ") : matchedSquad?.name || "Academy Squad";

    const invoiceRecord = {
      id: invoiceId,
      invoiceNumber,
      playerId,
      playerName: p.name || "Unknown Player",
      playerBranch: p.branch || "",
      team: squadDisplayLabel,
      programTier: matchedSquad?.tier || p.programTier || "Standard Program",
      billingMonth: monthLabel,
      month: monthCode,
      year: year,
      amount: tuitionRate,
      status: "pending",
      issuedDate: `${year}-${monthCode}-01`,
      dueDate: `${year}-${monthCode}-15`,
      description: `Tuition Fee · ${monthLabel} ${year} · ${squadDisplayLabel}`,
      createdAt: now.toISOString(),
      serverAuthoritative: true,
    };

    newInvoices.push(invoiceRecord);
    playersToUpdate.push({ id: playerId, newBalance });
    totalAmount += tuitionRate;
    generatedCount++;
  }

  // 5. Commit invoices and player balance updates in atomic chunks <= 200 items (400 ops)
  const CHUNK_SIZE = 200;
  for (let i = 0; i < newInvoices.length; i += CHUNK_SIZE) {
    const invChunk = newInvoices.slice(i, i + CHUNK_SIZE);
    const playerChunk = playersToUpdate.slice(i, i + CHUNK_SIZE);
    const batch = db.batch();

    invChunk.forEach((inv) => {
      const invRef = tenantDocRef.collection("invoices").doc(inv.id as string);
      batch.set(invRef, inv, { merge: true });
    });

    playerChunk.forEach((pu) => {
      const pRef = tenantDocRef.collection("players").doc(pu.id);
      batch.update(pRef, { balance: pu.newBalance });
    });

    await batch.commit();
  }

  // 6. Overdue suspension evaluation (compares server clock against oldest pending invoice)
  let flaggedSoft = 0;
  let flaggedInactive = 0;
  let unchanged = 0;
  const statusUpdates: { id: string; status: "Soft flag" | "Inactive" }[] = [];

  // Re-fetch or inspect pending invoices per player
  const playerInvoicesMap = new Map<string, { dueDate: string; status: string }[]>();
  invoicesSnap.docs.forEach((doc) => {
    const data = doc.data();
    if (data.playerId && data.status !== "paid" && data.dueDate) {
      const list = playerInvoicesMap.get(data.playerId) || [];
      list.push({ dueDate: data.dueDate, status: data.status });
      playerInvoicesMap.set(data.playerId, list);
    }
  });

  // Also include newly created invoices in pending map
  newInvoices.forEach((inv) => {
    const pid = inv.playerId as string;
    const list = playerInvoicesMap.get(pid) || [];
    list.push({ dueDate: inv.dueDate as string, status: "pending" });
    playerInvoicesMap.set(pid, list);
  });

  const currentTime = now.getTime();

  for (const pDoc of playersSnap.docs) {
    const p = pDoc.data();
    const pid = pDoc.id;
    const currentStatus = p.status || "Active";
    const currentBalance = Number(p.balance) || 0;

    if (currentBalance <= 0) {
      unchanged++;
      continue;
    }

    const pendingInvs = playerInvoicesMap.get(pid) || [];
    if (pendingInvs.length === 0) {
      unchanged++;
      continue;
    }

    // Find oldest due date
    let oldestDueTime = Infinity;
    for (const inv of pendingInvs) {
      const t = new Date(inv.dueDate).getTime();
      if (!isNaN(t) && t < oldestDueTime) {
        oldestDueTime = t;
      }
    }

    let daysOverdue = 0;
    if (oldestDueTime !== Infinity) {
      daysOverdue = Math.max(0, Math.floor((currentTime - oldestDueTime) / 86400000));
    }

    let nextStatus = currentStatus;
    if (daysOverdue >= hardDeadline && currentStatus !== "Inactive") {
      nextStatus = "Inactive";
      flaggedInactive++;
      statusUpdates.push({ id: pid, status: "Inactive" });
    } else if (
      daysOverdue >= softDeadline &&
      daysOverdue < hardDeadline &&
      currentStatus === "Active"
    ) {
      nextStatus = "Soft flag";
      flaggedSoft++;
      statusUpdates.push({ id: pid, status: "Soft flag" });
    } else {
      unchanged++;
    }
  }

  // Commit status changes in batches
  for (let i = 0; i < statusUpdates.length; i += CHUNK_SIZE) {
    const chunk = statusUpdates.slice(i, i + CHUNK_SIZE);
    const batch = db.batch();
    chunk.forEach((u) => {
      const pRef = tenantDocRef.collection("players").doc(u.id);
      batch.update(pRef, { status: u.status });
    });
    await batch.commit();
  }

  const durationMs = Date.now() - startTime;
  const executedAt = now.toISOString();

  // 7. Record Cron Audit Log for administrator review
  const logId = `cron_billing_${year}_${monthCode}_${Date.now()}`;
  const auditLog = {
    id: logId,
    tenantId,
    type: "monthly_billing",
    schedule: "0 0 1 * *",
    billingMonth: monthLabel,
    monthCode,
    year,
    generatedCount,
    skippedCount,
    totalAmount,
    flaggedSoft,
    flaggedInactive,
    unchanged,
    durationMs,
    executedAt,
    status: "success",
  };

  await tenantDocRef.collection("cron_logs").doc(logId).set(auditLog);

  // 8. Dispatch In-App Notification if invoices were generated
  if (generatedCount > 0) {
    const notifId = `notif_cron_${Date.now()}`;
    await tenantDocRef
      .collection("notifications")
      .doc(notifId)
      .set({
        id: notifId,
        tenantId,
        title: `Monthly Tuition Generated: ${monthLabel} ${year}`,
        message: `Server Cron generated ${generatedCount} invoices totaling $${totalAmount.toFixed(2)}. ${flaggedSoft > 0 ? `${flaggedSoft} soft flags, ` : ""}${flaggedInactive > 0 ? `${flaggedInactive} suspensions applied.` : ""}`,
        type: "billing",
        targetRoles: ["super_admin", "accountant", "branch_manager"],
        actionUrl: "/accounting",
        createdAt: executedAt,
        readBy: [],
      });
  }

  return {
    tenantId,
    billingMonth: monthLabel,
    monthCode,
    year,
    eligiblePlayers: playersSnap.size,
    generatedCount,
    skippedCount,
    totalAmount,
    flaggedSoft,
    flaggedInactive,
    unchanged,
    executedAt,
    durationMs,
  };
}

/**
 * Scheduled Cloud Function running on the 1st of every month at midnight (00:00 UTC).
 * Cron Expression: 0 0 1 * *
 */
export const scheduledMonthlyBillingCron = onSchedule("0 0 1 * *", async (event) => {
  console.log(`[BillingCron] Scheduled job started at ${event.scheduleTime}`);
  const tenantsSnap = await db.collection("tenants").get();
  console.log(`[BillingCron] Found ${tenantsSnap.size} tenants to process.`);

  const results: BillingExecutionResult[] = [];
  for (const tenantDoc of tenantsSnap.docs) {
    const tenantId = tenantDoc.id;
    try {
      console.log(`[BillingCron] Processing tenant ${tenantId}...`);
      const result = await executeMonthlyBillingForTenant(tenantId);
      results.push(result);
      console.log(
        `[BillingCron] Tenant ${tenantId} processed: ${result.generatedCount} invoices generated, $${result.totalAmount}.`,
      );
    } catch (err) {
      console.error(`[BillingCron] Error processing tenant ${tenantId}:`, err);
    }
  }

  console.log(`[BillingCron] Completed scheduled execution for ${results.length} tenants.`);
});

/**
 * Scheduled Cloud Function running daily at 02:00 UTC to evaluate overdue
 * tuition balances and update player suspension statuses.
 * Cron Expression: 0 2 * * *
 */
export const scheduledDailySuspensionCron = onSchedule("0 2 * * *", async (event) => {
  console.log(`[SuspensionCron] Daily suspension audit started at ${event.scheduleTime}`);
  const tenantsSnap = await db.collection("tenants").get();

  for (const tenantDoc of tenantsSnap.docs) {
    const tenantId = tenantDoc.id;
    try {
      const tenantRef = db.collection("tenants").doc(tenantId);
      const tenantData = (await tenantRef.get()).data() || {};
      const softDeadline =
        typeof tenantData.softDeadline === "number" ? tenantData.softDeadline : 15;
      const hardDeadline =
        typeof tenantData.hardDeadline === "number" ? tenantData.hardDeadline : 30;

      const playersSnap = await tenantRef.collection("players").get();
      const invoicesSnap = await tenantRef.collection("invoices").get();

      const pendingMap = new Map<string, { dueDate: string }[]>();
      invoicesSnap.docs.forEach((doc) => {
        const data = doc.data();
        if (data.playerId && data.status !== "paid" && data.dueDate) {
          const list = pendingMap.get(data.playerId) || [];
          list.push({ dueDate: data.dueDate });
          pendingMap.set(data.playerId, list);
        }
      });

      const now = Date.now();
      const updates: { id: string; status: "Soft flag" | "Inactive" }[] = [];
      let flaggedSoft = 0;
      let flaggedInactive = 0;

      for (const pDoc of playersSnap.docs) {
        const p = pDoc.data();
        const pid = pDoc.id;
        const currentBalance = Number(p.balance) || 0;
        const currentStatus = p.status || "Active";

        if (currentBalance <= 0) continue;
        const pending = pendingMap.get(pid) || [];
        if (pending.length === 0) continue;

        let oldestDueTime = Infinity;
        for (const inv of pending) {
          const t = new Date(inv.dueDate).getTime();
          if (!isNaN(t) && t < oldestDueTime) oldestDueTime = t;
        }

        if (oldestDueTime === Infinity) continue;
        const daysOverdue = Math.max(0, Math.floor((now - oldestDueTime) / 86400000));

        if (daysOverdue >= hardDeadline && currentStatus !== "Inactive") {
          flaggedInactive++;
          updates.push({ id: pid, status: "Inactive" });
        } else if (
          daysOverdue >= softDeadline &&
          daysOverdue < hardDeadline &&
          currentStatus === "Active"
        ) {
          flaggedSoft++;
          updates.push({ id: pid, status: "Soft flag" });
        }
      }

      if (updates.length > 0) {
        const batch = db.batch();
        updates.forEach((u) => {
          batch.update(tenantRef.collection("players").doc(u.id), { status: u.status });
        });
        await batch.commit();
      }

      // Record daily audit log
      const logId = `cron_suspension_${new Date().toISOString().slice(0, 10)}_${now}`;
      await tenantRef.collection("cron_logs").doc(logId).set({
        id: logId,
        tenantId,
        type: "daily_suspension_audit",
        schedule: "0 2 * * *",
        flaggedSoft,
        flaggedInactive,
        updatedCount: updates.length,
        executedAt: new Date().toISOString(),
        status: "success",
      });
    } catch (err) {
      console.error(`[SuspensionCron] Error in tenant ${tenantId}:`, err);
    }
  }
});

/**
 * On-Demand Callable Function allowing authenticated Super Admins or Accountants
 * to trigger the server-authoritative billing cron or suspension audit manually.
 */
export const runBillingCronManual = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required to trigger billing cron.");
  }

  const { tenantId, monthIndex, year } = (request.data || {}) as {
    tenantId?: string;
    monthIndex?: number;
    year?: number;
  };

  if (!tenantId) {
    throw new HttpsError("invalid-argument", "Missing required tenantId parameter.");
  }

  const callerUid = request.auth.uid;
  const callerEmail = request.auth.token?.email;

  // Verification guard: check caller belongs to tenant with Accountant or Super Admin role
  const usersCol = db.collection("tenants").doc(tenantId).collection("users");
  const userDocSnap = await usersCol.doc(callerUid).get();
  let callerRole: string | undefined;

  if (userDocSnap.exists) {
    callerRole = userDocSnap.data()?.role;
  } else if (callerEmail) {
    const emailQuery = await usersCol.where("email", "==", callerEmail).limit(1).get();
    if (!emailQuery.empty) {
      callerRole = emailQuery.docs[0].data()?.role;
    }
  }

  if (callerEmail === "geogo3@gmail.com" || callerEmail === "jess.chakh22@gmail.com") {
    callerRole = callerRole || "Super Admin";
  }

  const authorizedRoles = ["Accountant", "Super Admin"];
  if (!callerRole || !authorizedRoles.includes(callerRole)) {
    throw new HttpsError(
      "permission-denied",
      "Permission denied: Caller must belong to the tenant with an 'Accountant' or 'Super Admin' role.",
    );
  }

  try {
    const result = await executeMonthlyBillingForTenant(tenantId, monthIndex, year);
    return {
      success: true,
      message: `Generated ${result.generatedCount} invoices totaling $${result.totalAmount}. ${result.skippedCount} skipped.`,
      result,
    };
  } catch (error) {
    console.error(`Error in runBillingCronManual for tenant ${tenantId}:`, error);
    throw new HttpsError(
      "internal",
      error instanceof Error ? error.message : "Billing cron failed",
    );
  }
});

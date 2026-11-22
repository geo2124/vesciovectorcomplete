import type { Coach, SessionItem } from "./mock-data";
import { coachMatchesBranch, getCoachBranches, type DB, type LedgerEntry } from "./data-store";
import { money } from "@/components/kit";

export interface VerifiedSessionRecord {
  id: string;
  sessionId?: string;
  title: string;
  kind: string;
  date: string;
  time: string;
  branch: string;
  coach: string;
  court?: string;
  status: string;
  attendanceCount: number;
  coachAttendance?: string;
  isVerified: boolean;
  baseSessionFee: number;
  transportFee: number;
  totalSessionEarned: number;
  isOverridden?: boolean;
}

export interface CoachPayrollRow {
  coachId: string;
  coachName: string;
  phone: string;
  email: string;
  branch: string;
  level: string;
  rate: number; // configured rate ($/session or hourly)
  ratePerSession?: number;
  rateType: "per_session" | "hourly";
  verifiedCompletedSessionsCount: number;
  verifiedCompletedHours: number;
  totalCompletedSessionsCount: number;
  unloggedSessionsCount: number;
  unloggedCompletedSessionsCount: number;
  verifiedSessions: VerifiedSessionRecord[];
  unloggedSessions: VerifiedSessionRecord[];
  totalBaseEarned: number;
  totalTransportEarned: number;
  totalPayout: number; // sum of verified sessions (baseSessionFee + transportFee)
  totalEarned: number;
  totalDisbursed: number;
  netBalance: number; // totalEarned - totalDisbursed (negative means Advance / Credit Balance on Account)
  advanceBalance: number;
  hasAdvance: boolean;
  advanceReason?: string;
  linkedAdvanceSessionsCount?: number;
  outstanding: number;
  isDisbursed: boolean;
  disbursedDate?: string;
  ledgerEntryId?: string;
}

export interface PayrollPeriodConfig {
  monthName: string; // e.g. "May", "September", etc.
  monthIndex: number; // 0-11
  year: number; // e.g. 2026
  branchFilter?: string;
  startDate?: string;
  endDate?: string;
}

export interface PayrollComputationResult {
  periodLabel: string;
  monthCode: string; // e.g. "05", "09"
  year: number;
  totalActiveCoaches: number;
  totalVerifiedSessions: number;
  totalProjectedPayout: number;
  totalDisbursedPayout: number;
  totalPendingPayout: number;
  pendingDisbursementCoachesCount: number;
  rows: CoachPayrollRow[];
}

export interface SessionCoachPayoutBreakdown {
  isAssistant: boolean;
  defaultRate: number;
  baseSessionFee: number;
  transportFee: number;
  totalSessionEarned: number;
  isOverridden: boolean;
}

/**
 * Calculates session duration in hours from time and endTime,
 * with standard defaults based on session type.
 */
export function getSessionDurationHours(session: SessionItem): number {
  if (session.time && session.endTime) {
    const [sh, sm] = session.time.split(":").map(Number);
    const [eh, em] = session.endTime.split(":").map(Number);
    if (!isNaN(sh) && !isNaN(sm) && !isNaN(eh) && !isNaN(em)) {
      const diffMinutes = eh * 60 + em - (sh * 60 + sm);
      if (diffMinutes > 0) {
        return Math.round((diffMinutes / 60) * 100) / 100;
      }
    }
  }
  // Standard duration: 1.5 hours for Practice/Game, 1.0 hour for Seminar
  if (session.kind === "Practice" || session.kind === "Game") return 1.5;
  return 1.0;
}

/**
 * Computes the exact session-by-session coach fee (respecting session override or default coach rate)
 * plus optional session-by-session transportation fee.
 */
export function computeSessionCoachPayout(
  session: SessionItem,
  coach: Pick<Coach, "id" | "name" | "rate" | "rateType">,
): SessionCoachPayoutBreakdown {
  const coachNameLower = (coach.name || "").toLowerCase().trim();
  const isHeadOrPrimary =
    (Boolean(session.coachId) && session.coachId === coach.id) ||
    (Boolean(session.headCoachId) && session.headCoachId === coach.id) ||
    Boolean(
      coachNameLower &&
      ((session.coach && session.coach.toLowerCase().trim() === coachNameLower) ||
        (session.headCoach && session.headCoach.toLowerCase().trim() === coachNameLower)),
    );
  const isAssistant =
    !isHeadOrPrimary &&
    ((Boolean(session.assistantCoachId) && session.assistantCoachId === coach.id) ||
      Boolean(
        coachNameLower &&
        session.assistantCoach &&
        session.assistantCoach.toLowerCase().trim() === coachNameLower,
      ));

  const defaultRate = Number(coach.rate) > 0 ? Number(coach.rate) : 35;
  const durationHours = getSessionDurationHours(session);
  const rateType = coach.rateType || "per_session";
  const defaultCalculatedFee =
    rateType === "hourly" ? Math.round(durationHours * defaultRate * 100) / 100 : defaultRate;

  let baseSessionFee = defaultCalculatedFee;
  let transportFee = 0;
  let isOverridden = false;

  if (isAssistant) {
    if (
      session.assistantSessionFee !== undefined &&
      session.assistantSessionFee !== null &&
      String(session.assistantSessionFee) !== "" &&
      Number.isFinite(Number(session.assistantSessionFee))
    ) {
      baseSessionFee = Math.max(0, Number(session.assistantSessionFee));
      isOverridden = baseSessionFee !== defaultCalculatedFee;
    }
    if (
      session.assistantTransportFee !== undefined &&
      session.assistantTransportFee !== null &&
      Number.isFinite(Number(session.assistantTransportFee))
    ) {
      transportFee = Math.max(0, Number(session.assistantTransportFee));
    }
  } else {
    if (
      session.coachSessionFee !== undefined &&
      session.coachSessionFee !== null &&
      String(session.coachSessionFee) !== "" &&
      Number.isFinite(Number(session.coachSessionFee))
    ) {
      baseSessionFee = Math.max(0, Number(session.coachSessionFee));
      isOverridden = baseSessionFee !== defaultCalculatedFee || Boolean(session.rateOverwritten);
    } else if (
      session.coachRate !== undefined &&
      session.coachRate !== null &&
      Number.isFinite(Number(session.coachRate)) &&
      (session.rateOverwritten || Number(session.coachRate) > 0)
    ) {
      const explicitRate = Math.max(0, Number(session.coachRate));
      baseSessionFee = session.rateOverwritten
        ? explicitRate
        : rateType === "hourly"
          ? Math.round(durationHours * explicitRate * 100) / 100
          : explicitRate;
      isOverridden = Boolean(session.rateOverwritten) || baseSessionFee !== defaultCalculatedFee;
    }
    if (
      session.coachTransportFee !== undefined &&
      session.coachTransportFee !== null &&
      Number.isFinite(Number(session.coachTransportFee))
    ) {
      transportFee = Math.max(0, Number(session.coachTransportFee));
    }
  }

  const totalSessionEarned = Math.round((baseSessionFee + transportFee) * 100) / 100;

  return {
    isAssistant,
    defaultRate,
    baseSessionFee,
    transportFee,
    totalSessionEarned,
    isOverridden,
  };
}

/**
 * Checks whether a session has status: 'completed' (or 'official' marking completion)
 * and contains verified attendance logs.
 * Strictly excludes cancelled, draft, planned, pending, or unlogged sessions.
 */
export function isSessionAttendanceVerified(
  session: SessionItem,
  attendanceMap?: Record<string, "Present" | "Absent" | "Excused"> | null,
): { isVerified: boolean; attendanceCount: number; reason?: string } {
  const statusStr = (session.status || "").trim().toLowerCase();

  // 1. Exclude cancelled, draft, planned, pending approval, etc.
  if (
    statusStr === "cancelled" ||
    statusStr === "draft" ||
    statusStr === "planned" ||
    statusStr === "pending approval" ||
    statusStr === "pre-approved"
  ) {
    return {
      isVerified: false,
      attendanceCount: 0,
      reason: `Status is '${session.status}', excluded from payroll`,
    };
  }

  // Must have completed status ('completed' or 'official' completion)
  const isCompleted = statusStr === "completed" || statusStr === "official";
  if (!isCompleted) {
    return {
      isVerified: false,
      attendanceCount: 0,
      reason: `Status is '${session.status}', not completed`,
    };
  }

  // 2. Count attendance logs
  let count = 0;
  if (attendanceMap && typeof attendanceMap === "object") {
    const entries = Object.values(attendanceMap);
    count = entries.filter((s) => s === "Present" || s === "Absent" || s === "Excused").length;
  }

  // Check if coach attendance or session attendance note is marked
  const coachMarked = session.coachAttendance === "Present";
  const detailNote = (session.detail || "").toLowerCase();
  const hasAttendanceLog =
    count > 0 ||
    coachMarked ||
    detailNote.includes("attendance logged") ||
    detailNote.includes("verified");

  if (!hasAttendanceLog) {
    return {
      isVerified: false,
      attendanceCount: 0,
      reason: "No verified attendance log recorded (unlogged session)",
    };
  }

  return {
    isVerified: true,
    attendanceCount: Math.max(count, 1),
  };
}

/**
 * Computes coach payroll based on attendance-verified completed sessions within the target period (or all-time if config omitted).
 */
export function calculateAttendanceVerifiedPayroll(
  db: DB,
  config?: PayrollPeriodConfig,
): PayrollComputationResult {
  const isAllTime = !config;
  const now = new Date();
  const monthIndex = config ? config.monthIndex : now.getMonth();
  const year = config ? config.year : now.getFullYear();
  const branchFilter = config?.branchFilter;
  const monthName = config?.monthName || now.toLocaleString("en-US", { month: "long" });
  const monthCode = String(monthIndex + 1).padStart(2, "0");
  const periodPrefix = `${year}-${monthCode}`;
  const periodLabel = isAllTime ? "All-Time" : `${monthName} ${year}`;

  const coaches = (db.coaches || []).filter((c) =>
    branchFilter ? coachMatchesBranch(c, branchFilter) : true,
  );

  const sessions = db.sessions || [];
  const attendanceState = db.attendance || {};
  const ledger = db.ledger || [];

  // Find disbursed ledger entries for this period
  // Idempotency key pattern: payroll-${coachId}-${year}-${monthCode} or referenceId payroll-${month}-${coachId}
  const disbursedCoachMap = new Map<string, LedgerEntry>();
  ledger.forEach((l) => {
    if (
      (l.account === "Coach Payroll Expense" ||
        l.account === "Coach payroll" ||
        l.category === "Coach Payroll Expense") &&
      l.type === "Expense"
    ) {
      if (l.referenceId && l.referenceId.startsWith("payroll-")) {
        coaches.forEach((c) => {
          if (
            l.referenceId === `payroll-${monthName}-${c.id}` ||
            l.referenceId === `payroll-${monthName.toLowerCase()}-${c.id}` ||
            l.referenceId === `payroll-${monthCode}-${c.id}` ||
            l.referenceId?.endsWith(`-${c.id}`)
          ) {
            disbursedCoachMap.set(c.id, l);
          }
        });
      }
      if (l.id && l.id.includes(`payroll-`)) {
        const match = l.id.match(/payroll-([a-zA-Z0-9_-]+)-(\d{4})-(\d{2})/);
        if (match) {
          const cId = match[1]!;
          const lYear = parseInt(match[2]!, 10);
          const lMonth = match[3]!;
          if (isAllTime || (lYear === year && lMonth === monthCode)) {
            disbursedCoachMap.set(cId, l);
          }
        }
      }
      if (l.note && l.note.includes(periodLabel)) {
        coaches.forEach((c) => {
          if ((l.entry || "").toLowerCase().includes(c.name.toLowerCase())) {
            disbursedCoachMap.set(c.id, l);
          }
        });
      }
    }
  });

  const rows: CoachPayrollRow[] = coaches.map((coach) => {
    // Find all sessions for this coach in this period
    const coachSessions = sessions.filter((s) => {
      if (!s.date) return false;
      if (!isAllTime) {
        const sessionDate = s.date.slice(0, 7); // YYYY-MM
        if (sessionDate !== periodPrefix) return false;
      }

      if (branchFilter && s.branch && s.branch !== branchFilter) return false;

      const coachNameLower = coach.name?.toLowerCase();
      const isAssigned =
        s.coachId === coach.id ||
        s.headCoachId === coach.id ||
        s.assistantCoachId === coach.id ||
        s.coach === coach.id ||
        s.headCoach === coach.id ||
        s.assistantCoach === coach.id ||
        Boolean(
          coachNameLower &&
          (s.coach?.toLowerCase() === coachNameLower ||
            s.headCoach?.toLowerCase() === coachNameLower ||
            s.assistantCoach?.toLowerCase() === coachNameLower),
        );

      return isAssigned;
    });

    const verifiedSessionsList: VerifiedSessionRecord[] = [];
    const unloggedSessionsList: VerifiedSessionRecord[] = [];
    let totalCompleted = 0;
    let unloggedCount = 0;
    let totalBaseEarned = 0;
    let totalTransportEarned = 0;

    coachSessions.forEach((s) => {
      const statusLower = (s.status || "").toLowerCase();
      const isCompleted = statusLower === "completed" || statusLower === "official";
      if (isCompleted) {
        totalCompleted += 1;
      }

      const attendanceMap = attendanceState[s.id] || null;
      const { isVerified, attendanceCount } = isSessionAttendanceVerified(s, attendanceMap);
      const payoutBreakdown = computeSessionCoachPayout(s, coach);

      const record: VerifiedSessionRecord = {
        id: s.id,
        sessionId: s.id,
        title: s.title,
        kind: s.kind || "Practice",
        date: s.date,
        time: s.time,
        branch: s.branch,
        coach: s.coach || coach.name,
        court: s.court || s.detail || s.venue || "Main Court",
        status: s.status,
        attendanceCount,
        coachAttendance: s.coachAttendance,
        isVerified,
        baseSessionFee: payoutBreakdown.baseSessionFee,
        transportFee: payoutBreakdown.transportFee,
        totalSessionEarned: payoutBreakdown.totalSessionEarned,
        isOverridden: payoutBreakdown.isOverridden,
      };

      if (isVerified) {
        verifiedSessionsList.push(record);
        totalBaseEarned += payoutBreakdown.baseSessionFee;
        totalTransportEarned += payoutBreakdown.transportFee;
      } else if (isCompleted) {
        unloggedCount += 1;
        unloggedSessionsList.push(record);
      }
    });

    const verifiedCount = verifiedSessionsList.length;
    const rate = coach.rate && coach.rate > 0 ? coach.rate : 35;
    const rateType: "per_session" | "hourly" =
      (coach as { rateType?: "per_session" | "hourly" }).rateType || "per_session";

    let verifiedHours = 0;
    coachSessions.forEach((s) => {
      if (verifiedSessionsList.some((vs) => vs.id === s.id)) {
        verifiedHours += getSessionDurationHours(s);
      }
    });
    const verifiedCompletedHours = Math.round(verifiedHours * 10) / 10;

    totalBaseEarned = Math.round(totalBaseEarned * 100) / 100;
    totalTransportEarned = Math.round(totalTransportEarned * 100) / 100;
    const totalPayout = Math.round((totalBaseEarned + totalTransportEarned) * 100) / 100;

    const existingDisbursal = disbursedCoachMap.get(coach.id);
    const coachNameLower = (coach.name || "").toLowerCase().trim();

    // Find all coach payroll / salary ledger disbursements for this coach in this period
    const coachPeriodLedgerEntries = ledger.filter((l) => {
      const isExp = l.type === "Expense" || (l.type as string) === "debit";
      if (!isExp) return false;
      const acct = (l.account || l.category || "").toLowerCase();
      const isCoachAccount =
        acct.includes("coach") ||
        acct.includes("payroll") ||
        acct.includes("salary") ||
        acct.includes("salaries") ||
        Boolean(l.coachId);
      if (!isCoachAccount) return false;

      const matchCoach =
        l.coachId === coach.id ||
        l.referenceId === coach.id ||
        l.referenceId?.endsWith(`-${coach.id}`) ||
        Boolean(
          coachNameLower &&
          `${l.entry || ""} ${l.description || ""} ${l.note || ""}`
            .toLowerCase()
            .includes(coachNameLower),
        );
      if (!matchCoach) return false;

      if (isAllTime) return true;

      const inPeriodByDate = Boolean(l.date && l.date.slice(0, 7) === periodPrefix);
      const inPeriodById = Boolean(
        l.id === existingDisbursal?.id ||
        (l.note && l.note.includes(periodLabel)) ||
        l.referenceId === `payroll-${monthName}-${coach.id}`,
      );
      return inPeriodByDate || inPeriodById;
    });

    const periodDisbursed = coachPeriodLedgerEntries.reduce(
      (sum, l) => sum + Math.abs(Number(l.amount || 0)),
      0,
    );
    const totalEarned = totalPayout;
    const totalDisbursed =
      periodDisbursed > 0
        ? periodDisbursed
        : existingDisbursal
          ? Math.abs(Number(existingDisbursal.amount || 0))
          : 0;
    const netBalance = Math.round((totalEarned - totalDisbursed) * 100) / 100;
    const rawOutstanding = Number(coach.outstanding ?? netBalance);
    const advanceBalance =
      netBalance < 0 ? Math.abs(netBalance) : rawOutstanding < 0 ? Math.abs(rawOutstanding) : 0;
    const hasAdvance = netBalance < 0 || rawOutstanding < 0;
    const latestAdvanceEntry = coachPeriodLedgerEntries.find(
      (l) => l.isAdvance || l.advanceReason || l.linkedAdvanceSessionsCount,
    );
    const isDisbursed = Boolean(
      existingDisbursal || (totalDisbursed > 0 && totalDisbursed >= totalEarned),
    );

    return {
      coachId: coach.id,
      coachName: coach.name,
      phone: coach.phone,
      email: coach.email,
      branch: getCoachBranches(coach).join(", ") || coach.branch || "General",
      level: coach.level || "Level 1",
      rate,
      ratePerSession: rate,
      rateType,
      verifiedCompletedSessionsCount: verifiedCount,
      verifiedCompletedHours,
      totalCompletedSessionsCount: totalCompleted,
      unloggedSessionsCount: unloggedCount,
      unloggedCompletedSessionsCount: unloggedCount,
      verifiedSessions: verifiedSessionsList,
      unloggedSessions: unloggedSessionsList,
      totalBaseEarned,
      totalTransportEarned,
      totalPayout,
      totalEarned,
      totalDisbursed,
      netBalance,
      advanceBalance,
      hasAdvance,
      advanceReason: latestAdvanceEntry?.advanceReason,
      linkedAdvanceSessionsCount: latestAdvanceEntry?.linkedAdvanceSessionsCount,
      outstanding: rawOutstanding,
      isDisbursed,
      disbursedDate: existingDisbursal?.date || coachPeriodLedgerEntries[0]?.date,
      ledgerEntryId: existingDisbursal?.id || coachPeriodLedgerEntries[0]?.id,
    };
  });

  // Sort rows: first those with payouts or advances descending, then by name
  rows.sort(
    (a, b) =>
      Math.max(b.totalPayout, b.totalDisbursed) - Math.max(a.totalPayout, a.totalDisbursed) ||
      a.coachName.localeCompare(b.coachName),
  );

  const totalVerifiedSessions = rows.reduce((sum, r) => sum + r.verifiedCompletedSessionsCount, 0);
  const totalProjectedPayout = rows.reduce((sum, r) => sum + r.totalPayout, 0);
  const totalDisbursedPayout = rows.reduce((sum, r) => sum + r.totalDisbursed, 0);
  const totalPendingPayout = rows.reduce((sum, r) => sum + Math.max(0, r.netBalance), 0);
  const pendingDisbursementCoachesCount = rows.filter(
    (r) => !r.isDisbursed && r.netBalance > 0 && r.verifiedCompletedSessionsCount > 0,
  ).length;

  return {
    periodLabel,
    monthCode,
    year,
    totalActiveCoaches: coaches.length,
    totalVerifiedSessions,
    totalProjectedPayout,
    totalDisbursedPayout,
    totalPendingPayout,
    pendingDisbursementCoachesCount,
    rows,
  };
}

/**
 * Generates an accounting ledger debit entry under category 'Coach Payroll Expense'
 * for a disbursed coach payout.
 */
export function createCoachPayrollDebitEntry(params: {
  coach: CoachPayrollRow;
  periodLabel: string;
  year: number;
  monthCode: string;
  customAmount?: number;
  isAdvance?: boolean;
  advanceReason?: string;
  linkedAdvanceSessionsCount?: number;
  linkedAdvanceSessionIds?: string[];
  disbursedBy?: string;
  paymentMethod?: string;
  note?: string;
  referenceId?: string;
  payrollMonth?: string;
}): LedgerEntry {
  const {
    coach,
    periodLabel,
    year,
    monthCode,
    customAmount,
    advanceReason,
    linkedAdvanceSessionsCount,
    linkedAdvanceSessionIds,
    paymentMethod,
    note,
    referenceId,
    payrollMonth,
  } = params;
  const monthName = payrollMonth || periodLabel.split(" ")[0] || monthCode;
  const payoutAmount =
    customAmount !== undefined ? Math.abs(Number(customAmount)) : Math.abs(coach.totalPayout);
  const unpaidVerified = Math.max(
    0,
    (coach.totalEarned ?? coach.totalPayout) - (coach.totalDisbursed || 0),
  );
  const isAdvancePayout =
    payoutAmount > unpaidVerified || coach.verifiedCompletedSessionsCount === 0;
  const advancePortion = isAdvancePayout ? Math.max(0, payoutAmount - unpaidVerified) : 0;

  const detReferenceId = referenceId || `payroll-${monthName}-${coach.coachId}`;
  const entryId = isAdvancePayout
    ? `payroll-${coach.coachId}-${year}-${monthCode}-${Date.now().toString(36)}`
    : `payroll-${coach.coachId}-${year}-${monthCode}`;
  const today = new Date().toISOString().slice(0, 10);
  const rateLabel =
    coach.rateType === "hourly"
      ? `${coach.verifiedCompletedHours} hrs @ ${money(coach.rate)}/hr`
      : `${coach.verifiedCompletedSessionsCount} verified sessions @ ${money(coach.rate)}/session`;

  const entryTitle = isAdvancePayout
    ? `Custom / Advance Payment (On Account) · ${coach.coachName}`
    : `Coach Payroll: ${coach.coachName} (${rateLabel})`;

  const defaultNote = isAdvancePayout
    ? `Custom / Advance Payment (On Account) for ${periodLabel}. Unpaid verified sessions: ${money(unpaidVerified)}. Advance recorded: ${money(advancePortion)}.${advanceReason ? ` Reason: ${advanceReason}.` : ""}${linkedAdvanceSessionsCount ? ` Validated against ${linkedAdvanceSessionsCount} session(s).` : ""} Method: ${paymentMethod || "Bank Transfer"}.`
    : `Attendance-verified coach payroll for ${periodLabel}. Verified completed sessions: ${coach.verifiedCompletedSessionsCount} (${rateLabel}). Method: ${paymentMethod || "Bank Transfer"}.`;

  return {
    id: entryId,
    date: today,
    account: "Coach Payroll Expense",
    category: "Coach Payroll Expense",
    entry: entryTitle,
    description: note ? `${entryTitle} — ${note}` : entryTitle,
    type: "Expense",
    amount: -Math.abs(payoutAmount),
    status: "Paid",
    coachId: coach.coachId,
    referenceId: detReferenceId,
    note: note ? `${defaultNote} (${note})` : defaultNote,
    branch: coach.branch || "HQ",
    ...(isAdvancePayout
      ? {
          isAdvance: true,
          advanceAmount: advancePortion,
          ...(advanceReason ? { advanceReason } : {}),
          ...(linkedAdvanceSessionsCount ? { linkedAdvanceSessionsCount } : {}),
          ...(linkedAdvanceSessionIds && linkedAdvanceSessionIds.length > 0
            ? { linkedAdvanceSessionIds }
            : {}),
        }
      : {}),
  };
}
export const calculateCoachPayroll = calculateAttendanceVerifiedPayroll;

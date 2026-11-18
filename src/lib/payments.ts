import type { Branch, Player, Team } from "./mock-data";

export type SupportedPaymentMethod = "Cash" | "Manual Bank Transfer" | "Cheque";

export const SUPPORTED_PAYMENT_METHODS: readonly SupportedPaymentMethod[] = [
  "Cash",
  "Manual Bank Transfer",
  "Cheque",
] as const;

export interface RecordCashPaymentRequest {
  amount: number;
  currency?: string;
  payerName: string;
  payerEmail?: string;
  payerPhone?: string;
  description: string;
  paymentMethod?: SupportedPaymentMethod;
  authorizedCollector: string;
  receiptNumber?: string;
  metadata?: Record<string, string | number>;
}

export interface CashPaymentRecord {
  id: string;
  amount: number;
  currency: string;
  paymentMethod: SupportedPaymentMethod;
  payerName: string;
  payerEmail?: string;
  payerPhone?: string;
  description: string;
  authorizedCollector: string;
  receiptNumber: string;
  status: "completed";
  recordedAt: string;
  metadata?: Record<string, string | number>;
  isOffline: true;
}

/**
 * Records offline / in-person cash transactions directly with an authorized collector.
 * Online payment gateways (Stripe, Tap, online card checkout, etc.) are strictly disabled.
 */
export async function recordCashPayment(req: RecordCashPaymentRequest): Promise<CashPaymentRecord> {
  const method: SupportedPaymentMethod =
    req.paymentMethod && SUPPORTED_PAYMENT_METHODS.includes(req.paymentMethod)
      ? req.paymentMethod
      : "Cash";

  const now = new Date().toISOString();
  const id = `cash_entry_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const receiptNumber =
    req.receiptNumber ||
    `RCP-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;

  const record: CashPaymentRecord = {
    id,
    amount: Math.abs(req.amount),
    currency: req.currency || "USD",
    paymentMethod: method,
    payerName: req.payerName,
    payerEmail: req.payerEmail,
    payerPhone: req.payerPhone,
    description: req.description,
    authorizedCollector: req.authorizedCollector.trim() || "Authorized Staff",
    receiptNumber,
    status: "completed",
    recordedAt: now,
    metadata: req.metadata,
    isOffline: true,
  };

  return record;
}

// Semantic alias
export const recordOfflinePayment = recordCashPayment;

export interface ProcessPaymentParams {
  invoiceId?: string;
  amount: number;
  currency?: string;
  payerName: string;
  payerEmail?: string;
  payerPhone?: string;
  description?: string;
  paymentMethod?: SupportedPaymentMethod | string;
  authorizedCollector?: string;
  receiptNumber?: string;
  metadata?: Record<string, string | number>;
}

export interface ProcessPaymentResult {
  success: boolean;
  transactionId: string;
  receiptNumber: string;
  paymentMethod: SupportedPaymentMethod;
  amount: number;
  currency: string;
  status: "paid" | "completed";
  paidDate: string;
  isOffline: true;
}

/**
 * FIN-03: Processes payment transactions strictly as offline Cash / Bank Transfer / Cheque receipts.
 * All simulated delays (1200ms setTimeout) and synthetic online gateway card generators (ch_stripe_...)
 * have been permanently removed.
 */
export async function processPayment(params: ProcessPaymentParams): Promise<ProcessPaymentResult> {
  const method: SupportedPaymentMethod =
    params.paymentMethod &&
    SUPPORTED_PAYMENT_METHODS.includes(params.paymentMethod as SupportedPaymentMethod)
      ? (params.paymentMethod as SupportedPaymentMethod)
      : "Cash";

  const receiptNumber =
    params.receiptNumber ||
    `RCP-${Date.now().toString().slice(-6)}-${Math.floor(100 + Math.random() * 900)}`;
  const transactionId = `off_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const paidDate = new Date().toISOString().slice(0, 10);

  return {
    success: true,
    transactionId,
    receiptNumber,
    paymentMethod: method,
    amount: Math.abs(params.amount),
    currency: params.currency || "USD",
    status: "paid",
    paidDate,
    isOffline: true,
  };
}

/**
 * Calculates a player's gross base monthly tuition fee prior to scholarship or special offer discounts.
 */
export function calculatePlayerBaseFee(
  player: Pick<Player, "fee" | "teams" | "teamFees" | "branch"> & {
    isScholarship?: boolean;
    discountPercent?: number;
    discountAmount?: number;
  },
  teams: Pick<Team, "name" | "monthlyFee">[] = [],
  branches: (Pick<Branch, "name"> & { monthlyFee?: number })[] = [],
  defaultFee = 85,
): number {
  const playerTeams = player.teams || [];

  if (player.teamFees && playerTeams.length > 0) {
    let hasExplicit = false;
    const explicitSum = playerTeams.reduce((sum, tName) => {
      const explicitFee = player.teamFees?.[tName];
      if (typeof explicitFee === "number" && explicitFee >= 0) {
        if (explicitFee > 0 || player.isScholarship || player.fee === 0) {
          hasExplicit = true;
          return sum + explicitFee;
        }
      }
      const matchedTeam = teams.find((t) => t.name.toLowerCase() === tName.toLowerCase());
      if (matchedTeam && typeof matchedTeam.monthlyFee === "number" && matchedTeam.monthlyFee > 0) {
        hasExplicit = true;
        return sum + matchedTeam.monthlyFee;
      }
      return sum;
    }, 0);
    if (hasExplicit) return explicitSum;
  }

  if (playerTeams.length > 0 && teams.length > 0) {
    const matchedTeams = playerTeams
      .map((tName) => teams.find((t) => t.name.toLowerCase() === tName.toLowerCase()))
      .filter((t): t is Pick<Team, "name" | "monthlyFee"> => Boolean(t && t.monthlyFee > 0));
    if (matchedTeams.length > 0) {
      if (typeof player.fee === "number" && player.fee > 0) {
        return player.fee;
      }
      return matchedTeams.reduce((sum, t) => sum + t.monthlyFee, 0);
    }
  }

  if (typeof player.fee === "number" && player.fee >= 0) {
    if (player.fee > 0 || player.isScholarship) {
      return player.fee;
    }
  }

  if (player.branch && branches.length > 0) {
    const matchedBranch = branches.find(
      (b) => b.name.toLowerCase() === player.branch.toLowerCase(),
    );
    if (
      matchedBranch &&
      typeof matchedBranch.monthlyFee === "number" &&
      matchedBranch.monthlyFee > 0
    ) {
      return matchedBranch.monthlyFee;
    }
  }

  return defaultFee;
}

/**
 * Calculates a player's net monthly tuition fee by checking:
 * 1. If `player.isScholarship === true` or `player.discountPercent >= 100` or `player.fee === 0` (explicitly set), returns `0`.
 * 2. Explicit per-team fee overrides (`player.teamFees`)
 * 3. Assigned team `monthlyFee` from `db.teams` or player's configured `fee`
 * 4. Branch default fee or academy fallback ($85)
 * 5. Automatically applies `discountPercent` (0-100%) and `discountAmount` ($).
 */
export function calculatePlayerMonthlyFee(
  player: Pick<Player, "fee" | "teams" | "teamFees" | "branch"> & {
    isScholarship?: boolean;
    discountPercent?: number;
    discountAmount?: number;
    specialOffer?: string;
  },
  teams: Pick<Team, "name" | "monthlyFee">[] = [],
  branches: (Pick<Branch, "name"> & { monthlyFee?: number })[] = [],
  defaultFee = 85,
): number {
  if (player.isScholarship === true) {
    return 0;
  }

  const discPct =
    typeof player.discountPercent === "number" && !Number.isNaN(player.discountPercent)
      ? Math.max(0, Math.min(100, player.discountPercent))
      : 0;
  if (discPct >= 100) {
    return 0;
  }

  const teamFeesValues =
    player.teamFees && typeof player.teamFees === "object" ? Object.values(player.teamFees) : [];
  const allTeamFeesZero =
    teamFeesValues.length === 0 || teamFeesValues.every((v) => Number(v) === 0);

  if (typeof player.fee === "number" && player.fee === 0 && allTeamFeesZero) {
    return 0;
  }

  const baseFee = calculatePlayerBaseFee(player, teams, branches, defaultFee);
  const discAmt =
    typeof player.discountAmount === "number" && !Number.isNaN(player.discountAmount)
      ? Math.max(0, player.discountAmount)
      : 0;

  const afterPct = Math.round(baseFee * (1 - discPct / 100));
  return Math.max(0, afterPct - discAmt);
}

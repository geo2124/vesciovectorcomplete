import type { LedgerEntry } from "./data-store";

export type LedgerModule =
  "academy" | "courts" | "gym" | "physio" | "pos" | "merchandise" | "crm" | "general";

export type CoaCategory = "Asset" | "Liability" | "Equity" | "Revenue" | "COGS" | "Expense";

export interface ChartOfAccountItem {
  code: string;
  name: string;
  label: string;
  category: CoaCategory;
  normalBalance: "Debit" | "Credit";
  defaultModule?: LedgerModule;
}

export const CHART_OF_ACCOUNTS: readonly ChartOfAccountItem[] = [
  // 1000–1999 Assets
  {
    code: "1010",
    name: "Cash Drawer (USD)",
    label: "1010 · Cash Drawer (USD)",
    category: "Asset",
    normalBalance: "Debit",
  },
  {
    code: "1015",
    name: "Cash Drawer (LBP — USD Equiv.)",
    label: "1015 · Cash Drawer (LBP — USD Equiv.)",
    category: "Asset",
    normalBalance: "Debit",
  },
  {
    code: "1020",
    name: "Bank / Card Settlement",
    label: "1020 · Bank / Card Settlement",
    category: "Asset",
    normalBalance: "Debit",
  },
  {
    code: "1100",
    name: "Accounts Receivable — Academy",
    label: "1100 · Accounts Receivable — Academy",
    category: "Asset",
    normalBalance: "Debit",
    defaultModule: "academy",
  },
  {
    code: "1110",
    name: "Accounts Receivable — Nexus & Merch",
    label: "1110 · Accounts Receivable — Nexus & Merch",
    category: "Asset",
    normalBalance: "Debit",
  },
  {
    code: "1200",
    name: "Merchandise & Kiosk Inventory Asset",
    label: "1200 · Merchandise & Kiosk Inventory Asset",
    category: "Asset",
    normalBalance: "Debit",
  },

  // 2000–2999 Liabilities
  {
    code: "2010",
    name: "Accounts Payable",
    label: "2010 · Accounts Payable",
    category: "Liability",
    normalBalance: "Credit",
  },
  {
    code: "2100",
    name: "Practitioner & Coach Commissions Payable",
    label: "2100 · Practitioner & Coach Commissions Payable",
    category: "Liability",
    normalBalance: "Credit",
  },
  {
    code: "2200",
    name: "Unearned / Deferred Package Revenue",
    label: "2200 · Unearned / Deferred Package Revenue",
    category: "Liability",
    normalBalance: "Credit",
  },

  // 3000–3999 Equity
  {
    code: "3000",
    name: "Owner's Equity / Retained Earnings",
    label: "3000 · Owner's Equity / Retained Earnings",
    category: "Equity",
    normalBalance: "Credit",
  },

  // 4000–4999 Revenue
  {
    code: "4100",
    name: "Academy Tuition",
    label: "4100 · Academy Tuition",
    category: "Revenue",
    normalBalance: "Credit",
    defaultModule: "academy",
  },
  {
    code: "4110",
    name: "Player Insurance & Registration",
    label: "4110 · Player Insurance & Registration",
    category: "Revenue",
    normalBalance: "Credit",
    defaultModule: "academy",
  },
  {
    code: "4200",
    name: "Nexus Court Rental Income",
    label: "4200 · Nexus Court Rental Income",
    category: "Revenue",
    normalBalance: "Credit",
    defaultModule: "courts",
  },
  {
    code: "4300",
    name: "Nexus Gym & S&C Revenue",
    label: "4300 · Nexus Gym & S&C Revenue",
    category: "Revenue",
    normalBalance: "Credit",
    defaultModule: "gym",
  },
  {
    code: "4400",
    name: "Nexus Physiotherapy Revenue",
    label: "4400 · Nexus Physiotherapy Revenue",
    category: "Revenue",
    normalBalance: "Credit",
    defaultModule: "physio",
  },
  {
    code: "4500",
    name: "Nexus Kiosk POS Sales",
    label: "4500 · Nexus Kiosk POS Sales",
    category: "Revenue",
    normalBalance: "Credit",
    defaultModule: "pos",
  },
  {
    code: "4600",
    name: "Academy Merchandise Store Revenue",
    label: "4600 · Academy Merchandise Store Revenue",
    category: "Revenue",
    normalBalance: "Credit",
    defaultModule: "merchandise",
  },

  // 5000–5999 Direct COGS & Payroll
  {
    code: "5100",
    name: "Academy Coach Payroll & Transport",
    label: "5100 · Academy Coach Payroll & Transport",
    category: "COGS",
    normalBalance: "Debit",
    defaultModule: "academy",
  },
  {
    code: "5150",
    name: "Referee & Match Official Fees",
    label: "5150 · Referee & Match Official Fees",
    category: "COGS",
    normalBalance: "Debit",
    defaultModule: "academy",
  },
  {
    code: "5200",
    name: "Facility & Court Rental Cost",
    label: "5200 · Facility & Court Rental Cost",
    category: "COGS",
    normalBalance: "Debit",
    defaultModule: "courts",
  },
  {
    code: "5400",
    name: "Physiotherapy Practitioner Commissions",
    label: "5400 · Physiotherapy Practitioner Commissions",
    category: "COGS",
    normalBalance: "Debit",
    defaultModule: "physio",
  },
  {
    code: "5500",
    name: "Kiosk POS Cost of Goods Sold (COGS)",
    label: "5500 · Kiosk POS Cost of Goods Sold (COGS)",
    category: "COGS",
    normalBalance: "Debit",
    defaultModule: "pos",
  },
  {
    code: "5600",
    name: "Merchandise Store COGS",
    label: "5600 · Merchandise Store COGS",
    category: "COGS",
    normalBalance: "Debit",
    defaultModule: "merchandise",
  },

  // 6000–6999 Operating Expenses
  {
    code: "6100",
    name: "Facility Fixed Rent & Lease",
    label: "6100 · Facility Fixed Rent & Lease",
    category: "Expense",
    normalBalance: "Debit",
    defaultModule: "general",
  },
  {
    code: "6200",
    name: "Utilities & Internet",
    label: "6200 · Utilities & Internet",
    category: "Expense",
    normalBalance: "Debit",
    defaultModule: "general",
  },
  {
    code: "6300",
    name: "Equipment & Maintenance",
    label: "6300 · Equipment & Maintenance",
    category: "Expense",
    normalBalance: "Debit",
    defaultModule: "general",
  },
  {
    code: "6400",
    name: "Medical & Clinic Consumables",
    label: "6400 · Medical & Clinic Consumables",
    category: "Expense",
    normalBalance: "Debit",
    defaultModule: "physio",
  },
  {
    code: "6500",
    name: "Marketing & Administrative",
    label: "6500 · Marketing & Administrative",
    category: "Expense",
    normalBalance: "Debit",
    defaultModule: "general",
  },
] as const;

export const COA_BY_CODE: Record<string, ChartOfAccountItem> = Object.fromEntries(
  CHART_OF_ACCOUNTS.map((item) => [item.code, item]),
);

export const COA_BY_LABEL: Record<string, ChartOfAccountItem> = Object.fromEntries(
  CHART_OF_ACCOUNTS.map((item) => [item.label, item]),
);

const VALID_MODULES = new Set<LedgerModule>([
  "academy",
  "courts",
  "gym",
  "physio",
  "pos",
  "merchandise",
  "crm",
  "general",
]);

/**
 * Deterministically infers the module/vertical for a LedgerEntry.
 * If `entry.module` is already set and valid, returns it directly.
 * Otherwise inspects `account`, `category`, `entry`, `description`, and entity IDs.
 */
export function inferLedgerModule(entry: Partial<LedgerEntry>): LedgerModule {
  if (entry.module && VALID_MODULES.has(entry.module)) {
    return entry.module;
  }

  const primaryText = `${entry.account ?? ""} ${entry.category ?? ""}`.toLowerCase();
  const fullText =
    `${primaryText} ${entry.entry ?? ""} ${entry.description ?? ""} ${entry.memo ?? ""}`.toLowerCase();

  // 1. Kiosk POS (check before general merchandise so "Kiosk POS & Merch Sales" maps to "pos")
  if (
    primaryText.includes("kiosk") ||
    primaryText.includes("pos") ||
    primaryText.includes("4500") ||
    primaryText.includes("5500") ||
    fullText.includes("kiosk pos")
  ) {
    return "pos";
  }

  // 2. Physiotherapy
  if (
    primaryText.includes("physio") ||
    primaryText.includes("medical") ||
    primaryText.includes("rehab") ||
    primaryText.includes("clinic") ||
    primaryText.includes("4400") ||
    primaryText.includes("5400") ||
    primaryText.includes("6400")
  ) {
    return "physio";
  }

  // 3. Gym & S&C
  if (
    primaryText.includes("gym") ||
    primaryText.includes("s&c") ||
    primaryText.includes("strength") ||
    primaryText.includes("4300")
  ) {
    return "gym";
  }

  // 4. Courts / Facility Reservations
  if (
    primaryText.includes("court") ||
    primaryText.includes("facility reservation") ||
    primaryText.includes("4200") ||
    primaryText.includes("5200") ||
    fullText.includes("court cash-in") ||
    fullText.includes("court rental income")
  ) {
    return "courts";
  }

  // 5. Merchandise Store
  if (
    primaryText.includes("merchandise") ||
    primaryText.includes("merch") ||
    primaryText.includes("uniform") ||
    primaryText.includes("apparel") ||
    primaryText.includes("4600") ||
    primaryText.includes("5600") ||
    Boolean(entry.orderId)
  ) {
    return "merchandise";
  }

  // 6. CRM
  if (
    primaryText.includes("crm") ||
    primaryText.includes("lead") ||
    primaryText.includes("trial fee") ||
    fullText.includes("[crm")
  ) {
    return "crm";
  }

  // 7. Academy (Tuition, Player Insurance, Coach Payroll, Referee Fees, or linked player/coach)
  if (
    primaryText.includes("tuition") ||
    primaryText.includes("insurance") ||
    primaryText.includes("registration") ||
    primaryText.includes("coach") ||
    primaryText.includes("payroll") ||
    primaryText.includes("salaries") ||
    primaryText.includes("referee") ||
    primaryText.includes("official") ||
    primaryText.includes("4100") ||
    primaryText.includes("4110") ||
    primaryText.includes("5100") ||
    primaryText.includes("5150") ||
    Boolean(entry.playerId) ||
    Boolean(entry.coachId) ||
    (Array.isArray(entry.familyPlayerIds) && entry.familyPlayerIds.length > 0)
  ) {
    return "academy";
  }

  return "general";
}

function resolveSettlementAssetAccount(
  entry: Partial<LedgerEntry>,
  module: LedgerModule,
  currency: "USD" | "LBP",
  isRevenueLeg: boolean,
): string {
  const accText = `${entry.account ?? ""} ${entry.category ?? ""}`.toLowerCase();
  const methodText = `${entry.paymentMethod ?? ""}`.toLowerCase();
  const status = entry.status;

  // Pending / Accounts Receivable or Payable
  const isReceivableAccount =
    accText.includes("receivable") || methodText.includes("account charge");

  if (isRevenueLeg && (status === "Pending" || isReceivableAccount)) {
    return module === "academy" || module === "crm"
      ? COA_BY_CODE["1100"].label
      : COA_BY_CODE["1110"].label;
  }

  if (!isRevenueLeg && status === "Pending") {
    if (
      module === "academy" ||
      module === "physio" ||
      accText.includes("coach") ||
      accText.includes("payroll") ||
      accText.includes("commission") ||
      accText.includes("practitioner")
    ) {
      return COA_BY_CODE["2100"].label;
    }
    return COA_BY_CODE["2010"].label;
  }

  // Bank / Card / Transfer / Check / Online / Whish / OMT
  if (
    methodText.includes("bank") ||
    methodText.includes("card") ||
    methodText.includes("transfer") ||
    methodText.includes("check") ||
    methodText.includes("cheque") ||
    methodText.includes("stripe") ||
    methodText.includes("online")
  ) {
    return COA_BY_CODE["1020"].label;
  }

  // Cash in LBP vs USD
  if (currency === "LBP") {
    return COA_BY_CODE["1015"].label;
  }

  return COA_BY_CODE["1010"].label;
}

function resolveNominalAccount(
  entry: Partial<LedgerEntry>,
  module: LedgerModule,
  isRevenueLeg: boolean,
): string {
  const text =
    `${entry.account ?? ""} ${entry.category ?? ""} ${entry.entry ?? ""} ${entry.description ?? ""}`.toLowerCase();

  // Check if entry.account already matches a formal COA code
  for (const coa of CHART_OF_ACCOUNTS) {
    if (
      (entry.account && entry.account.startsWith(`${coa.code} ·`)) ||
      entry.account === coa.code ||
      entry.account === coa.label
    ) {
      // Only use it as nominal account if it's not an Asset (1010/1015/1020/1100/1110)
      if (coa.category !== "Asset") {
        return coa.label;
      }
    }
  }

  // Refund detection: if an Expense entry is actually a refund of POS, Court, Gym, Physio, Merch, or Tuition
  const isRefund =
    text.includes("refund") ||
    text.includes("reversal") ||
    (!isRevenueLeg &&
      (text.includes("kiosk pos & merch sales") ||
        text.includes("court rental income") ||
        text.includes("gym & s&c membership revenue") ||
        text.includes("physiotherapy & medical revenue") ||
        text.includes("merchandise revenue")));

  if (isRevenueLeg || isRefund) {
    if (module === "pos") return COA_BY_CODE["4500"].label;
    if (module === "physio") return COA_BY_CODE["4400"].label;
    if (module === "gym") return COA_BY_CODE["4300"].label;
    if (module === "courts") return COA_BY_CODE["4200"].label;
    if (module === "merchandise") return COA_BY_CODE["4600"].label;
    if (
      text.includes("insurance") ||
      text.includes("registration") ||
      text.includes("trial") ||
      module === "crm"
    ) {
      return COA_BY_CODE["4110"].label;
    }
    return COA_BY_CODE["4100"].label;
  }

  // Expense / COGS classification
  if (text.includes("referee") || text.includes("official")) {
    return COA_BY_CODE["5150"].label;
  }
  if (
    text.includes("coach") ||
    text.includes("payroll") ||
    text.includes("salaries") ||
    text.includes("salary") ||
    Boolean(entry.coachId)
  ) {
    return COA_BY_CODE["5100"].label;
  }
  if (
    module === "physio" &&
    (text.includes("commission") || text.includes("practitioner") || text.includes("payout"))
  ) {
    return COA_BY_CODE["5400"].label;
  }
  if (
    module === "pos" &&
    (text.includes("cogs") || text.includes("restock") || text.includes("inventory"))
  ) {
    return COA_BY_CODE["5500"].label;
  }
  if (
    module === "merchandise" &&
    (text.includes("cogs") ||
      text.includes("restock") ||
      text.includes("inventory") ||
      text.includes("cost"))
  ) {
    return COA_BY_CODE["5600"].label;
  }
  if (text.includes("court rental") || (module === "courts" && text.includes("rental"))) {
    return COA_BY_CODE["5200"].label;
  }
  if (text.includes("rent") || text.includes("lease")) {
    return COA_BY_CODE["6100"].label;
  }
  if (
    text.includes("utilit") ||
    text.includes("electric") ||
    text.includes("water") ||
    text.includes("internet")
  ) {
    return COA_BY_CODE["6200"].label;
  }
  if (text.includes("equipment") || text.includes("maintenance") || text.includes("repair")) {
    return COA_BY_CODE["6300"].label;
  }
  if (
    text.includes("medical") ||
    text.includes("consumable") ||
    text.includes("clinic") ||
    module === "physio"
  ) {
    return COA_BY_CODE["6400"].label;
  }

  return COA_BY_CODE["6500"].label;
}

export type NormalizedLedgerEntry = LedgerEntry & {
  module: LedgerModule;
  debitAccount: string;
  creditAccount: string;
  currency: "USD" | "LBP";
  originalAmount: number;
  exchangeRate: number;
};

export function roundToCents(value: number): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const sign = num < 0 ? -1 : 1;
  return (sign * Math.round((Math.abs(num) + Number.EPSILON) * 100)) / 100;
}

/**
 * Normalizes any new or legacy LedgerEntry into a complete double-entry record
 * with guaranteed `module`, `debitAccount`, `creditAccount`, `currency`,
 * `originalAmount`, and `exchangeRate`, ensuring `Total Debits === Total Credits`.
 */
export function normalizeDoubleEntryLedger(entry: LedgerEntry): NormalizedLedgerEntry {
  const module = inferLedgerModule(entry);
  const currency: "USD" | "LBP" = entry.currency === "LBP" ? "LBP" : "USD";
  const exchangeRate =
    typeof entry.exchangeRate === "number" && entry.exchangeRate > 0
      ? entry.exchangeRate
      : currency === "LBP"
        ? 89500
        : 1;

  const hasExplicitOriginal =
    typeof entry.originalAmount === "number" && !Number.isNaN(entry.originalAmount);

  // If currency is LBP and originalAmount is provided, derive USD amount if amount matches originalAmount or is not yet converted
  let usdAmount = Math.abs(Number(entry.amount) || 0);
  let originalAmount = hasExplicitOriginal ? Math.abs(Number(entry.originalAmount)) : usdAmount;

  if (currency === "LBP" && exchangeRate > 1) {
    if (hasExplicitOriginal && (usdAmount === 0 || usdAmount === originalAmount)) {
      usdAmount = roundToCents(originalAmount / exchangeRate);
    } else if (!hasExplicitOriginal && usdAmount > 0) {
      usdAmount = roundToCents(usdAmount);
      originalAmount = Math.round(usdAmount * exchangeRate);
    } else {
      usdAmount = roundToCents(usdAmount);
      originalAmount = Math.round(originalAmount);
    }
  } else {
    usdAmount = roundToCents(usdAmount);
    originalAmount = hasExplicitOriginal ? roundToCents(originalAmount) : usdAmount;
  }

  const isRevenueType = entry.type === "Revenue" || entry.type === "credit";
  const settlementAccount = resolveSettlementAssetAccount(entry, module, currency, isRevenueType);
  const nominalAccount = resolveNominalAccount(entry, module, isRevenueType);

  // Revenue/Credit: Debit Asset (Cash/Bank/AR), Credit Revenue
  // Expense/Debit (or Refund): Debit Expense/COGS (or Contra-Revenue), Credit Asset (Cash/Bank/AP)
  const defaultDebitAccount = isRevenueType ? settlementAccount : nominalAccount;
  const defaultCreditAccount = isRevenueType ? nominalAccount : settlementAccount;

  const debitAccount =
    entry.debitAccount && entry.debitAccount.trim().length > 0
      ? entry.debitAccount.trim()
      : defaultDebitAccount;

  const creditAccount =
    entry.creditAccount && entry.creditAccount.trim().length > 0
      ? entry.creditAccount.trim()
      : defaultCreditAccount;

  return {
    ...entry,
    amount: usdAmount,
    module,
    debitAccount,
    creditAccount,
    currency,
    originalAmount,
    exchangeRate,
  };
}

/**
 * Generates a deterministic idempotency signature for a normalized ledger entry
 * when `referenceId` is present, preventing double-click duplicate postings.
 */
export function getLedgerIdempotencyKey(entry: LedgerEntry): string {
  const norm = normalizeDoubleEntryLedger(entry);
  const cleanId = (norm.id || "").trim();
  const cleanRef = (norm.referenceId || "").trim();
  if (cleanRef) {
    const amountCents = Math.round((Math.abs(norm.amount) + Number.EPSILON) * 100);
    return `ref:${cleanRef}::${norm.module}::${norm.debitAccount}::${norm.creditAccount}::${norm.type}::${amountCents}::${norm.date}`;
  }
  return `id:${cleanId}`;
}

/**
 * Deduplicates an array of LedgerEntry items against both duplicate `id`s and
 * duplicate `referenceId` double-click submissions, returning normalized entries.
 */
export function deduplicateLedgerEntries(entries: LedgerEntry[]): NormalizedLedgerEntry[] {
  const seenIds = new Set<string>();
  const seenIdempotencyKeys = new Set<string>();
  const result: NormalizedLedgerEntry[] = [];

  for (const raw of entries) {
    if (!raw || typeof raw !== "object") continue;
    const norm = normalizeDoubleEntryLedger(raw);
    const idKey = (norm.id || "").trim();
    if (idKey && seenIds.has(idKey)) {
      continue;
    }
    const idempotencyKey = getLedgerIdempotencyKey(norm);
    if (seenIdempotencyKeys.has(idempotencyKey)) {
      continue;
    }
    if (idKey) seenIds.add(idKey);
    seenIdempotencyKeys.add(idempotencyKey);
    result.push(norm);
  }

  return result;
}

/**
 * Appends a candidate ledger entry to an existing ledger slice only if neither its `id`
 * nor its deterministic `referenceId` idempotency signature already exists.
 */
export function appendIdempotentLedgerEntry(
  existingEntries: LedgerEntry[],
  candidateEntry: LedgerEntry,
): NormalizedLedgerEntry[] {
  return deduplicateLedgerEntries([...existingEntries, candidateEntry]);
}

export interface TrialBalanceRow {
  code: string;
  name: string;
  label: string;
  category: CoaCategory;
  normalBalance: "Debit" | "Credit";
  debitTotal: number;
  creditTotal: number;
  netBalance: number;
  entryCount: number;
}

export interface TrialBalanceResult {
  rows: TrialBalanceRow[];
  totalDebits: number;
  totalCredits: number;
  isBalanced: boolean;
}

function matchCoaAccount(accountLabelOrCode: string): ChartOfAccountItem {
  const trimmed = (accountLabelOrCode || "").trim();
  if (COA_BY_LABEL[trimmed]) return COA_BY_LABEL[trimmed];
  if (COA_BY_CODE[trimmed]) return COA_BY_CODE[trimmed];

  const codePrefix = trimmed.slice(0, 4);
  if (COA_BY_CODE[codePrefix]) return COA_BY_CODE[codePrefix];

  const lower = trimmed.toLowerCase();
  const byName = CHART_OF_ACCOUNTS.find(
    (item) => item.name.toLowerCase() === lower || item.label.toLowerCase() === lower,
  );
  if (byName) return byName;

  // Fallback to 6500 · Marketing & Administrative so no entry is ever dropped
  return COA_BY_CODE["6500"];
}

/**
 * Computes a complete Double-Entry Trial Balance across all normalized LedgerEntry records.
 * Every entry posts an equal Debit and Credit of `normalized.amount` (USD equivalent),
 * guaranteeing `totalDebits === totalCredits` and `isBalanced === true`.
 */
export function computeTrialBalance(
  entries: LedgerEntry[],
  options?: { currency?: "USD" | "LBP"; module?: LedgerModule },
): TrialBalanceResult {
  const accumulator = new Map<
    string,
    {
      coa: ChartOfAccountItem;
      debitCents: number;
      creditCents: number;
      entryCount: number;
    }
  >();

  for (const coa of CHART_OF_ACCOUNTS) {
    accumulator.set(coa.code, {
      coa,
      debitCents: 0,
      creditCents: 0,
      entryCount: 0,
    });
  }

  let totalDebitCents = 0;
  let totalCreditCents = 0;

  const deduplicated = deduplicateLedgerEntries(entries);

  for (const norm of deduplicated) {
    if (options?.currency && norm.currency !== options.currency) continue;
    if (options?.module && norm.module !== options.module) continue;

    const amountCents = Math.round((Math.abs(Number(norm.amount) || 0) + Number.EPSILON) * 100);
    if (amountCents === 0) continue;

    const debitCoa = matchCoaAccount(norm.debitAccount);
    const creditCoa = matchCoaAccount(norm.creditAccount);

    const debitBucket = accumulator.get(debitCoa.code)!;
    debitBucket.debitCents += amountCents;
    debitBucket.entryCount += 1;

    const creditBucket = accumulator.get(creditCoa.code)!;
    creditBucket.creditCents += amountCents;
    if (creditCoa.code !== debitCoa.code) {
      creditBucket.entryCount += 1;
    }

    totalDebitCents += amountCents;
    totalCreditCents += amountCents;
  }

  const rows: TrialBalanceRow[] = [];
  for (const { coa, debitCents, creditCents, entryCount } of accumulator.values()) {
    const debitTotal = Number((debitCents / 100).toFixed(2));
    const creditTotal = Number((creditCents / 100).toFixed(2));
    const netCents =
      coa.normalBalance === "Debit" ? debitCents - creditCents : creditCents - debitCents;

    rows.push({
      code: coa.code,
      name: coa.name,
      label: coa.label,
      category: coa.category,
      normalBalance: coa.normalBalance,
      debitTotal,
      creditTotal,
      netBalance: Number((netCents / 100).toFixed(2)),
      entryCount,
    });
  }

  const totalDebits = Number((totalDebitCents / 100).toFixed(2));
  const totalCredits = Number((totalCreditCents / 100).toFixed(2));

  return {
    rows,
    totalDebits,
    totalCredits,
    isBalanced: totalDebitCents === totalCreditCents,
  };
}

export interface PnlStatementMetrics {
  grossRevenue: number;
  directCogs: number;
  grossProfit: number;
  operatingExpenses: number;
  netOperatingIncome: number;
  entryCount: number;
}

/**
 * Computes integer-cent accurate P&L metrics from a list of LedgerEntry items,
 * with optional module and currency isolation filters.
 */
export function computePnlMetrics(
  entries: LedgerEntry[],
  options?: { currency?: "USD" | "LBP"; module?: LedgerModule; includePending?: boolean },
): PnlStatementMetrics {
  const deduplicated = deduplicateLedgerEntries(entries);

  let grossRevenueCents = 0;
  let directCogsCents = 0;
  let operatingExpensesCents = 0;
  let entryCount = 0;

  for (const norm of deduplicated) {
    if (!options?.includePending && norm.status === "Pending") continue;
    if (options?.currency && norm.currency !== options.currency) continue;
    if (options?.module && norm.module !== options.module) continue;

    const amountCents = Math.round((Math.abs(Number(norm.amount) || 0) + Number.EPSILON) * 100);
    if (amountCents === 0) continue;

    entryCount += 1;
    const debitCoa = matchCoaAccount(norm.debitAccount);
    const creditCoa = matchCoaAccount(norm.creditAccount);

    if (creditCoa.category === "Revenue") {
      grossRevenueCents += amountCents;
    } else if (creditCoa.category === "COGS") {
      directCogsCents -= amountCents;
    } else if (creditCoa.category === "Expense") {
      operatingExpensesCents -= amountCents;
    }

    if (debitCoa.category === "Revenue") {
      grossRevenueCents -= amountCents;
    } else if (debitCoa.category === "COGS") {
      directCogsCents += amountCents;
    } else if (debitCoa.category === "Expense") {
      operatingExpensesCents += amountCents;
    }
  }

  const grossProfitCents = grossRevenueCents - directCogsCents;
  const netOperatingIncomeCents = grossProfitCents - operatingExpensesCents;

  return {
    grossRevenue: Number((grossRevenueCents / 100).toFixed(2)),
    directCogs: Number((directCogsCents / 100).toFixed(2)),
    grossProfit: Number((grossProfitCents / 100).toFixed(2)),
    operatingExpenses: Number((operatingExpensesCents / 100).toFixed(2)),
    netOperatingIncome: Number((netOperatingIncomeCents / 100).toFixed(2)),
    entryCount,
  };
}

export type MultiVerticalPnlMatrix = Record<LedgerModule, PnlStatementMetrics> & {
  consolidated: PnlStatementMetrics;
};

/**
 * Computes the complete per-module P&L matrix across all 8 modules (`academy`, `courts`,
 * `gym`, `physio`, `pos`, `merchandise`, `crm`, `general`) alongside the `consolidated` total.
 */
export function computeMultiVerticalPnlMatrix(
  entries: LedgerEntry[],
  options?: { currency?: "USD" | "LBP"; includePending?: boolean },
): MultiVerticalPnlMatrix {
  const modules: LedgerModule[] = [
    "academy",
    "courts",
    "gym",
    "physio",
    "pos",
    "merchandise",
    "crm",
    "general",
  ];

  const matrix = {} as Record<LedgerModule, PnlStatementMetrics>;
  for (const mod of modules) {
    matrix[mod] = computePnlMetrics(entries, { ...options, module: mod });
  }

  return {
    ...matrix,
    consolidated: computePnlMetrics(entries, options),
  };
}

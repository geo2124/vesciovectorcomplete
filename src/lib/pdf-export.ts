import { downloadCsv, exportPdf, type ExportPdfOptions } from "./report";
import type { TrialBalanceResult } from "./accounting-coa";

export { downloadCsv, exportPdf, type ExportPdfOptions };

export interface PnlPdfLineItem {
  code: string;
  accountName: string;
  section: "Revenue" | "COGS" | "Expense";
  amount: number;
}

export interface ExportPnlStatementPdfInput {
  tenantName: string;
  dateRangeLabel: string;
  branchScopeLabel: string;
  moduleScopeLabel: string;
  currency: string;
  formatMoney: (usdAmount: number) => string;
  grossRevenue: number;
  directCogs: number;
  grossProfit: number;
  grossMarginPct: number;
  operatingExpenses: number;
  netOperatingIncome: number;
  netMarginPct: number;
  lineItems: PnlPdfLineItem[];
  trialBalance: TrialBalanceResult;
  filename?: string;
}

/**
 * Generates a minimalist corporate PDF report for the P&L Statement and
 * Trial Balance verification summary using jsPDF & jspdf-autotable (with HTML print fallback).
 */
export async function exportPnlStatementPdf(input: ExportPnlStatementPdfInput): Promise<void> {
  const {
    tenantName,
    dateRangeLabel,
    branchScopeLabel,
    moduleScopeLabel,
    formatMoney,
    grossRevenue,
    directCogs,
    grossProfit,
    grossMarginPct,
    operatingExpenses,
    netOperatingIncome,
    netMarginPct,
    lineItems,
    trialBalance,
    filename,
  } = input;

  const title = `PROFIT & LOSS STATEMENT — ${moduleScopeLabel.toUpperCase()}`;
  const subtitle = `Period: ${dateRangeLabel} · Branch: ${branchScopeLabel} · Scope: ${moduleScopeLabel}`;
  const verificationStatus = trialBalance.isBalanced
    ? `BALANCED (Debits ${formatMoney(trialBalance.totalDebits)} = Credits ${formatMoney(trialBalance.totalCredits)})`
    : `OUT OF BALANCE (Debits ${formatMoney(trialBalance.totalDebits)} vs Credits ${formatMoney(trialBalance.totalCredits)})`;

  const rows: string[][] = [];

  // 1. Gross Revenue Section (4000-4999)
  rows.push(["4000–4999", "GROSS REVENUE", "Section Header", ""]);
  const revItems = lineItems.filter((i) => i.section === "Revenue" && Math.abs(i.amount) > 0.001);
  if (revItems.length === 0) {
    rows.push(["—", "No revenue recorded in period", "Revenue", formatMoney(0)]);
  } else {
    for (const item of revItems) {
      rows.push([item.code, item.accountName, "Revenue", formatMoney(item.amount)]);
    }
  }
  rows.push(["", "Total Gross Revenue", "Subtotal", formatMoney(grossRevenue)]);

  // 2. Direct COGS & Commissions Section (5000-5999)
  rows.push(["5000–5999", "DIRECT COGS & COMMISSIONS", "Section Header", ""]);
  const cogsItems = lineItems.filter((i) => i.section === "COGS" && Math.abs(i.amount) > 0.001);
  if (cogsItems.length === 0) {
    rows.push(["—", "No direct COGS recorded in period", "COGS", formatMoney(0)]);
  } else {
    for (const item of cogsItems) {
      rows.push([item.code, item.accountName, "COGS", formatMoney(item.amount)]);
    }
  }
  rows.push(["", "Total Direct COGS & Commissions", "Subtotal", formatMoney(directCogs)]);
  rows.push([
    "",
    `GROSS PROFIT (${grossMarginPct.toFixed(1)}% Margin)`,
    "Gross Profit",
    formatMoney(grossProfit),
  ]);

  // 3. Operating Expenses Section (6000-6999)
  rows.push(["6000–6999", "OPERATING EXPENSES", "Section Header", ""]);
  const expItems = lineItems.filter((i) => i.section === "Expense" && Math.abs(i.amount) > 0.001);
  if (expItems.length === 0) {
    rows.push(["—", "No operating expenses recorded in period", "Expense", formatMoney(0)]);
  } else {
    for (const item of expItems) {
      rows.push([item.code, item.accountName, "Expense", formatMoney(item.amount)]);
    }
  }
  rows.push(["", "Total Operating Expenses", "Subtotal", formatMoney(operatingExpenses)]);
  rows.push([
    "",
    `NET OPERATING INCOME (${netMarginPct.toFixed(1)}% Net Margin)`,
    "Net Income",
    formatMoney(netOperatingIncome),
  ]);

  // 4. Trial Balance Verification Footer Rows
  rows.push(["1000–6999", "TRIAL BALANCE DOUBLE-ENTRY VERIFICATION", "Audit", verificationStatus]);

  await exportPdf({
    title,
    subtitle,
    academy: tenantName || "Vescio Vector Academy",
    headers: ["COA Code", "Account / Line Item", "Classification", "Amount"],
    rows,
    summary: [
      { label: "Gross Revenue", value: formatMoney(grossRevenue) },
      { label: "Direct COGS", value: formatMoney(directCogs) },
      {
        label: "Gross Profit",
        value: `${formatMoney(grossProfit)} (${grossMarginPct.toFixed(1)}%)`,
      },
      { label: "Operating Expenses", value: formatMoney(operatingExpenses) },
      {
        label: "Net Operating Income",
        value: `${formatMoney(netOperatingIncome)} (${netMarginPct.toFixed(1)}%)`,
      },
      {
        label: "Trial Balance",
        value: trialBalance.isBalanced ? "BALANCED" : "OUT OF BALANCE",
      },
    ],
    filename:
      filename ||
      `pnl-statement-${moduleScopeLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${new Date().toISOString().slice(0, 10)}.pdf`,
  });
}

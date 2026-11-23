import { describe, expect, it } from "vitest";
import {
  CHART_OF_ACCOUNTS,
  computeTrialBalance,
  inferLedgerModule,
  normalizeDoubleEntryLedger,
} from "../accounting-coa";
import type { LedgerEntry } from "../data-store";

describe("Accounting Chart of Accounts & Double-Entry Engine", () => {
  it("exports the complete formal Chart of Accounts covering Assets, Liabilities, Equity, Revenue, COGS, and Operating Expenses", () => {
    const codes = CHART_OF_ACCOUNTS.map((c) => c.code);
    expect(codes).toEqual([
      "1010",
      "1015",
      "1020",
      "1100",
      "1110",
      "1200",
      "2010",
      "2100",
      "2200",
      "3000",
      "4100",
      "4110",
      "4200",
      "4300",
      "4400",
      "4500",
      "4600",
      "5100",
      "5150",
      "5200",
      "5400",
      "5500",
      "5600",
      "6100",
      "6200",
      "6300",
      "6400",
      "6500",
    ]);
  });

  it("deterministically infers the module vertical for legacy entries without an explicit module tag", () => {
    expect(
      inferLedgerModule({
        account: "Court Rental Income (Vescio Nexus)",
        category: "Facility Reservation",
      }),
    ).toBe("courts");

    expect(
      inferLedgerModule({
        account: "Gym & S&C Membership Revenue",
        category: "Gym & Strength",
      }),
    ).toBe("gym");

    expect(
      inferLedgerModule({
        account: "Physiotherapy & Medical Revenue",
        category: "Physiotherapy",
      }),
    ).toBe("physio");

    expect(
      inferLedgerModule({
        account: "Kiosk POS & Merch Sales",
        category: "Kiosk POS",
      }),
    ).toBe("pos");

    expect(
      inferLedgerModule({
        account: "Merchandise Revenue",
        category: "Merchandise",
      }),
    ).toBe("merchandise");

    expect(
      inferLedgerModule({
        account: "CRM Trial Fee",
        category: "CRM Conversion",
      }),
    ).toBe("crm");

    expect(
      inferLedgerModule({
        account: "Tuition",
        category: "Player Subscription",
      }),
    ).toBe("academy");

    expect(
      inferLedgerModule({
        account: "Coach Payroll Expense",
        coachId: "coach-1",
      }),
    ).toBe("academy");

    expect(
      inferLedgerModule({
        account: "Utilities",
        category: "Electricity & Internet",
      }),
    ).toBe("general");

    // Preserves explicit module tag when present
    expect(
      inferLedgerModule({
        account: "Utilities",
        module: "gym",
      }),
    ).toBe("gym");
  });

  it("normalizes Revenue, Expense, Refund, and LBP-converted entries with balanced Debit and Credit accounts", () => {
    // 1. Legacy Academy Tuition Revenue (Cash USD)
    const tuitionEntry: LedgerEntry = {
      id: "led-1",
      date: "2026-11-01",
      account: "Tuition",
      type: "Revenue",
      amount: 120,
      status: "Collected",
      paymentMethod: "Cash",
    };
    const normTuition = normalizeDoubleEntryLedger(tuitionEntry);
    expect(normTuition.module).toBe("academy");
    expect(normTuition.debitAccount).toBe("1010 · Cash Drawer (USD)");
    expect(normTuition.creditAccount).toBe("4100 · Academy Tuition");
    expect(normTuition.currency).toBe("USD");
    expect(normTuition.originalAmount).toBe(120);
    expect(normTuition.exchangeRate).toBe(1);

    // 2. Coach Payroll Expense (Bank Transfer)
    const payrollEntry: LedgerEntry = {
      id: "led-2",
      date: "2026-11-02",
      account: "Coach Payroll Expense",
      type: "Expense",
      amount: 450,
      status: "Paid",
      paymentMethod: "Bank Transfer",
      coachId: "c-101",
    };
    const normPayroll = normalizeDoubleEntryLedger(payrollEntry);
    expect(normPayroll.module).toBe("academy");
    expect(normPayroll.debitAccount).toBe("5100 · Academy Coach Payroll & Transport");
    expect(normPayroll.creditAccount).toBe("1020 · Bank / Card Settlement");

    // 3. Kiosk POS Refund (Reversing Expense against 4500 POS Sales)
    const posRefundEntry: LedgerEntry = {
      id: "led-3",
      date: "2026-11-03",
      account: "Kiosk POS & Merch Sales",
      category: "Kiosk POS",
      entry: "POS Refund · Receipt #POS-99",
      type: "Expense",
      amount: 15,
      status: "Paid",
      paymentMethod: "Cash",
    };
    const normRefund = normalizeDoubleEntryLedger(posRefundEntry);
    expect(normRefund.module).toBe("pos");
    expect(normRefund.debitAccount).toBe("4500 · Nexus Kiosk POS Sales");
    expect(normRefund.creditAccount).toBe("1010 · Cash Drawer (USD)");

    // 4. LBP Multi-Currency POS Sale (895,000 LBP @ 89,500 = $10.00 USD)
    const lbpPosEntry: LedgerEntry = {
      id: "led-4",
      date: "2026-11-04",
      account: "Kiosk POS & Merch Sales",
      category: "Kiosk POS",
      type: "Revenue",
      amount: 0,
      originalAmount: 895000,
      currency: "LBP",
      exchangeRate: 89500,
      status: "Collected",
      paymentMethod: "Cash",
    };
    const normLbp = normalizeDoubleEntryLedger(lbpPosEntry);
    expect(normLbp.module).toBe("pos");
    expect(normLbp.currency).toBe("LBP");
    expect(normLbp.originalAmount).toBe(895000);
    expect(normLbp.exchangeRate).toBe(89500);
    expect(normLbp.amount).toBe(10);
    expect(normLbp.debitAccount).toBe("1015 · Cash Drawer (LBP — USD Equiv.)");
    expect(normLbp.creditAccount).toBe("4500 · Nexus Kiosk POS Sales");
  });

  it("computes a Trial Balance where totalDebits === totalCredits and isBalanced === true", () => {
    const sampleLedger: LedgerEntry[] = [
      {
        id: "tb-1",
        date: "2026-11-01",
        account: "Tuition",
        type: "Revenue",
        amount: 250,
        status: "Collected",
        paymentMethod: "Cash",
      },
      {
        id: "tb-2",
        date: "2026-11-02",
        account: "Court Rental Income (Vescio Nexus)",
        category: "Facility Reservation",
        type: "Revenue",
        amount: 90,
        status: "Collected",
        paymentMethod: "Card",
      },
      {
        id: "tb-3",
        date: "2026-11-03",
        account: "Gym & S&C Membership Revenue",
        category: "Gym & Strength",
        type: "Revenue",
        amount: 75,
        status: "Collected",
        paymentMethod: "Cash",
      },
      {
        id: "tb-4",
        date: "2026-11-04",
        account: "Physiotherapy & Medical Revenue",
        category: "Physiotherapy",
        type: "Revenue",
        amount: 60,
        status: "Collected",
        paymentMethod: "Cash",
      },
      {
        id: "tb-5",
        date: "2026-11-05",
        account: "Kiosk POS & Merch Sales",
        category: "Kiosk POS",
        type: "Revenue",
        amount: 0,
        originalAmount: 1790000,
        currency: "LBP",
        exchangeRate: 89500,
        status: "Collected",
        paymentMethod: "Cash",
      },
      {
        id: "tb-6",
        date: "2026-11-06",
        account: "Coach Payroll Expense",
        type: "Expense",
        amount: 180,
        status: "Paid",
        paymentMethod: "Bank Transfer",
      },
      {
        id: "tb-7",
        date: "2026-11-07",
        account: "Rental",
        category: "Facility Lease",
        type: "Expense",
        amount: 115.55,
        status: "Paid",
        paymentMethod: "Bank Transfer",
      },
    ];

    const tb = computeTrialBalance(sampleLedger);
    expect(tb.isBalanced).toBe(true);
    expect(tb.totalDebits).toBe(790.55);
    expect(tb.totalCredits).toBe(790.55);

    const cashUsdRow = tb.rows.find((r) => r.code === "1010")!;
    expect(cashUsdRow.debitTotal).toBe(385); // 250 + 75 + 60
    expect(cashUsdRow.netBalance).toBe(385);

    const cashLbpRow = tb.rows.find((r) => r.code === "1015")!;
    expect(cashLbpRow.debitTotal).toBe(20); // 1,790,000 / 89,500
    expect(cashLbpRow.netBalance).toBe(20);
  });
});

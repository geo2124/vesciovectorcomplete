import { describe, expect, it } from "vitest";
import {
  CHART_OF_ACCOUNTS,
  COA_BY_LABEL,
  appendIdempotentLedgerEntry,
  computeMultiVerticalPnlMatrix,
  computePnlMetrics,
  computeTrialBalance,
  deduplicateLedgerEntries,
  inferLedgerModule,
  normalizeDoubleEntryLedger,
  roundToCents,
  type LedgerModule,
} from "../accounting-coa";
import { createCoachPayrollDebitEntry, type CoachPayrollRow } from "../payroll";
import { getGameOfficialFeeEntries, syncGameOfficialFeesToLedger } from "../match-fees";
import { buildRbaDemoDataset } from "../rba-demo-seed";
import type { LedgerEntry, SessionItem } from "../data-store";

describe("Financial Integrity & Double-Entry Accounting Invariants", () => {
  describe("1. Strict Double-Entry Balance (Sum(Debits) === Sum(Credits)) across all module generators", () => {
    const mockCoachPayrollRow: CoachPayrollRow = {
      coachId: "c-invariant-1",
      coachName: "Coach Tariq Mansour",
      phone: "+961 70 111 222",
      email: "tariq@rba.demo",
      branch: "RBA Main Campus",
      level: "FIBA Level 2",
      rate: 55,
      ratePerSession: 55,
      rateType: "per_session",
      verifiedCompletedSessionsCount: 10,
      verifiedCompletedHours: 15,
      totalCompletedSessionsCount: 10,
      unloggedSessionsCount: 0,
      unloggedCompletedSessionsCount: 0,
      verifiedSessions: [],
      unloggedSessions: [],
      totalBaseEarned: 550,
      totalTransportEarned: 100,
      totalPayout: 650,
      totalEarned: 650,
      totalDisbursed: 0,
      netBalance: 650,
      advanceBalance: 0,
      hasAdvance: false,
      outstanding: 650,
      isDisbursed: false,
    };

    const mockGameSession: SessionItem = {
      id: "sess-game-inv-1",
      kind: "Game",
      title: "U-16 Elite vs Cedars",
      detail: "Main Show Court",
      court: "Main Show Court",
      date: "2026-11-15",
      time: "18:00",
      branch: "RBA Main Campus",
      coach: "Coach Tariq Mansour",
      status: "Official",
      referees: [
        {
          id: "ref-1",
          name: "FIBA Ref Rami",
          role: "Crew Chief",
          source: "outsource",
          fee: 45,
        },
      ],
      matchStaff: [
        {
          id: "stf-1",
          name: "Table Scorer Jad",
          role: "Table Official",
          source: "personnel",
          fee: 25,
        },
      ],
    };

    const generatedModuleEntries: Array<{ label: string; entry: LedgerEntry }> = [
      {
        label: "Academy Subscription (Cash USD)",
        entry: normalizeDoubleEntryLedger({
          id: "inv-acad-tuition-1",
          date: "2026-11-01",
          account: "Tuition",
          category: "Player Subscription",
          entry: "Monthly Squad Tuition · Adam Khoury",
          type: "Revenue",
          amount: 140,
          status: "Collected",
          paymentMethod: "Cash",
          playerId: "p-01",
          branch: "RBA Main Campus",
          module: "academy",
        }),
      },
      {
        label: "Academy Player Insurance (Accrued Receivable)",
        entry: normalizeDoubleEntryLedger({
          id: "inv-acad-ins-1",
          date: "2026-11-01",
          account: "Player Insurance",
          category: "Annual Insurance",
          type: "Revenue",
          amount: 30,
          status: "Pending",
          playerId: "p-01",
          branch: "RBA Main Campus",
          module: "academy",
        }),
      },
      {
        label: "Coach Payroll Disbursement Generator",
        entry: createCoachPayrollDebitEntry({
          coach: mockCoachPayrollRow,
          periodLabel: "November 2026",
          year: 2026,
          monthCode: "11",
          paymentMethod: "Bank Transfer",
        }),
      },
      ...getGameOfficialFeeEntries(mockGameSession).map((entry, idx) => ({
        label: `Match Official Fee Generator #${idx + 1}`,
        entry,
      })),
      {
        label: "Branch Court Rental Fee (COGS)",
        entry: normalizeDoubleEntryLedger({
          id: "inv-court-cost-1",
          date: "2026-11-03",
          account: "Court Rental",
          category: "Facility & Court Rental Cost",
          type: "Expense",
          amount: 85,
          status: "Paid",
          paymentMethod: "Bank Transfer",
          branch: "RBA Main Campus",
          module: "courts",
        }),
      },
      {
        label: "Nexus Court Reservation Cash-In",
        entry: normalizeDoubleEntryLedger({
          id: "inv-court-rev-1",
          date: "2026-11-04",
          account: "Court Rental Income (Vescio Nexus)",
          category: "Facility Reservation",
          type: "Revenue",
          amount: 105,
          status: "Collected",
          paymentMethod: "Card",
          branch: "RBA Main Campus",
          module: "courts",
        }),
      },
      {
        label: "Nexus Court Cancellation Refund / Reversal",
        entry: normalizeDoubleEntryLedger({
          id: "inv-court-refund-1",
          date: "2026-11-04",
          account: "Court Rental Refund / Reversal",
          category: "Facility Reservation Reversal",
          type: "Expense",
          amount: 35,
          status: "Paid",
          paymentMethod: "Cash",
          branch: "RBA Main Campus",
          module: "courts",
        }),
      },
      {
        label: "Nexus Gym & S&C Membership Enrollment",
        entry: normalizeDoubleEntryLedger({
          id: "inv-gym-rev-1",
          date: "2026-11-05",
          account: "Gym & S&C Membership Revenue",
          category: "Gym & Strength",
          type: "Revenue",
          amount: 85,
          status: "Collected",
          paymentMethod: "Cash",
          branch: "RBA Main Campus",
          module: "gym",
        }),
      },
      {
        label: "Nexus Physiotherapy Treatment Revenue",
        entry: normalizeDoubleEntryLedger({
          id: "inv-physio-rev-1",
          date: "2026-11-06",
          account: "Physiotherapy & Medical Revenue",
          category: "Physiotherapy",
          type: "Revenue",
          amount: 60,
          status: "Collected",
          paymentMethod: "Cash",
          branch: "RBA Main Campus",
          module: "physio",
        }),
      },
      {
        label: "Nexus Physiotherapy Practitioner Commission (COGS)",
        entry: normalizeDoubleEntryLedger({
          id: "inv-physio-comm-1",
          date: "2026-11-06",
          account: "Physiotherapy Practitioner Commissions",
          category: "Practitioner Commission",
          type: "Expense",
          amount: 24,
          status: "Paid",
          paymentMethod: "Cash",
          branch: "RBA Main Campus",
          module: "physio",
        }),
      },
      {
        label: "Nexus Kiosk POS Sale (USD)",
        entry: normalizeDoubleEntryLedger({
          id: "inv-pos-rev-1",
          date: "2026-11-07",
          account: "Kiosk POS & Merch Sales",
          category: "Kiosk POS",
          type: "Revenue",
          amount: 27.5,
          status: "Collected",
          paymentMethod: "Cash",
          branch: "RBA Main Campus",
          module: "pos",
        }),
      },
      {
        label: "Nexus Kiosk POS Restock Purchase (COGS)",
        entry: normalizeDoubleEntryLedger({
          id: "inv-pos-cogs-1",
          date: "2026-11-07",
          account: "Kiosk POS Cost of Goods Sold (COGS)",
          category: "POS Restock",
          type: "Expense",
          amount: 14.25,
          status: "Paid",
          paymentMethod: "Cash",
          branch: "RBA Main Campus",
          module: "pos",
        }),
      },
      {
        label: "Nexus Kiosk POS Refund / Void Reversal",
        entry: normalizeDoubleEntryLedger({
          id: "inv-pos-refund-1",
          date: "2026-11-07",
          account: "Kiosk POS & Merch Sales",
          category: "Kiosk POS",
          entry: "POS Refund · Receipt #POS-201",
          type: "Expense",
          amount: 5.5,
          status: "Paid",
          paymentMethod: "Cash",
          branch: "RBA Main Campus",
          module: "pos",
        }),
      },
      {
        label: "Merchandise Store Uniform Sale",
        entry: normalizeDoubleEntryLedger({
          id: "inv-merch-rev-1",
          date: "2026-11-08",
          account: "Merchandise Revenue",
          category: "Merchandise",
          type: "Revenue",
          amount: 55,
          status: "Collected",
          paymentMethod: "Card",
          orderId: "ord-101",
          branch: "RBA Main Campus",
          module: "merchandise",
        }),
      },
      {
        label: "Merchandise Store Inventory COGS",
        entry: normalizeDoubleEntryLedger({
          id: "inv-merch-cogs-1",
          date: "2026-11-08",
          account: "Merchandise Store COGS",
          category: "Merchandise COGS",
          type: "Expense",
          amount: 24,
          status: "Paid",
          paymentMethod: "Bank Transfer",
          orderId: "ord-101",
          branch: "RBA Main Campus",
          module: "merchandise",
        }),
      },
      {
        label: "CRM Lead Trial Assessment Fee",
        entry: normalizeDoubleEntryLedger({
          id: "inv-crm-rev-1",
          date: "2026-11-09",
          account: "CRM Trial Fee",
          category: "CRM Conversion",
          type: "Revenue",
          amount: 20,
          status: "Collected",
          paymentMethod: "Cash",
          branch: "RBA Main Campus",
          module: "crm",
        }),
      },
      {
        label: "General Operating Expense (Utilities & Internet)",
        entry: normalizeDoubleEntryLedger({
          id: "inv-gen-exp-1",
          date: "2026-11-10",
          account: "Utilities",
          category: "Utilities & Internet",
          type: "Expense",
          amount: 195.75,
          status: "Paid",
          paymentMethod: "Bank Transfer",
          branch: "RBA Main Campus",
          module: "general",
        }),
      },
    ];

    it("enforces Debit === Credit to the exact cent for every individual module generator entry", () => {
      for (const { label, entry } of generatedModuleEntries) {
        const norm = normalizeDoubleEntryLedger(entry);
        expect(norm.debitAccount, `${label} must have a valid COA debitAccount`).toBeTruthy();
        expect(norm.creditAccount, `${label} must have a valid COA creditAccount`).toBeTruthy();
        expect(COA_BY_LABEL[norm.debitAccount], `${label} debitAccount in COA`).toBeDefined();
        expect(COA_BY_LABEL[norm.creditAccount], `${label} creditAccount in COA`).toBeDefined();
        expect(norm.debitAccount).not.toBe(norm.creditAccount);

        const singleTb = computeTrialBalance([norm]);
        expect(singleTb.isBalanced, `${label} trial balance must be balanced`).toBe(true);
        expect(singleTb.totalDebits).toBe(norm.amount);
        expect(singleTb.totalCredits).toBe(norm.amount);
        expect(singleTb.totalDebits).toBe(singleTb.totalCredits);
      }
    });

    it("maintains strict Sum(Debits) === Sum(Credits) across the combined multi-module ledger and full RBA seed dataset", () => {
      const allEntries = generatedModuleEntries.map((item) => item.entry);
      const combinedTb = computeTrialBalance(allEntries);

      expect(combinedTb.isBalanced).toBe(true);
      expect(combinedTb.totalDebits).toBe(combinedTb.totalCredits);
      expect(combinedTb.totalDebits).toBe(1626);

      // Sum of all individual COA row debits must equal sum of all COA row credits
      const rowDebitsCents = combinedTb.rows.reduce(
        (acc, r) => acc + Math.round(r.debitTotal * 100),
        0,
      );
      const rowCreditsCents = combinedTb.rows.reduce(
        (acc, r) => acc + Math.round(r.creditTotal * 100),
        0,
      );
      expect(rowDebitsCents).toBe(rowCreditsCents);

      // Also verify the full 18-entry RBA Demo dataset
      const rbaDataset = buildRbaDemoDataset("2026-11-15");
      const rbaTb = computeTrialBalance(rbaDataset.ledger);
      expect(rbaTb.isBalanced).toBe(true);
      expect(rbaTb.totalDebits).toBe(rbaTb.totalCredits);
    });
  });

  describe("2. Floating-Point Drift Protection", () => {
    it("eliminates IEEE-754 float precision leaks (0.1 + 0.2, 33.33 * 3, 19.99 * 7, large LBP conversions)", () => {
      expect(0.1 + 0.2).not.toBe(0.3); // Baseline JS float hazard
      expect(roundToCents(0.1 + 0.2)).toBe(0.3);
      expect(roundToCents(33.33 * 3)).toBe(99.99);
      expect(roundToCents(19.99 * 7)).toBe(139.93);

      const floatHazardEntries: LedgerEntry[] = [
        {
          id: "flt-1",
          date: "2026-11-01",
          account: "Kiosk POS & Merch Sales",
          type: "Revenue",
          amount: 0.1 + 0.2, // 0.30000000000000004
          status: "Collected",
          module: "pos",
        },
        {
          id: "flt-2",
          date: "2026-11-01",
          account: "Tuition",
          type: "Revenue",
          amount: 33.33 * 3, // 99.99000000000001
          status: "Collected",
          module: "academy",
        },
        {
          id: "flt-3",
          date: "2026-11-01",
          account: "Merchandise Revenue",
          type: "Revenue",
          amount: 19.99 * 7, // 139.92999999999998
          status: "Collected",
          module: "merchandise",
        },
        {
          id: "flt-4",
          date: "2026-11-01",
          account: "Academy Tuition",
          type: "Revenue",
          amount: 0,
          originalAmount: 89_500_000, // 89.5M LBP @ 89,500 = $1,000.00 exact
          currency: "LBP",
          exchangeRate: 89500,
          status: "Collected",
          module: "academy",
        },
        {
          id: "flt-5",
          date: "2026-11-01",
          account: "Kiosk POS & Merch Sales",
          type: "Revenue",
          amount: 0,
          originalAmount: 2_983_333, // 2,983,333 / 89,500 = 33.3333296... -> $33.33
          currency: "LBP",
          exchangeRate: 89500,
          status: "Collected",
          module: "pos",
        },
        {
          id: "flt-6",
          date: "2026-11-01",
          account: "Equipment & Maintenance",
          type: "Expense",
          amount: 0.1 + 0.2 + 19.99 * 3, // 60.27000000000001
          status: "Paid",
          module: "general",
        },
      ];

      const normalized = floatHazardEntries.map((e) => normalizeDoubleEntryLedger(e));
      expect(normalized[0]!.amount).toBe(0.3);
      expect(normalized[1]!.amount).toBe(99.99);
      expect(normalized[2]!.amount).toBe(139.93);
      expect(normalized[3]!.amount).toBe(1000);
      expect(normalized[4]!.amount).toBe(33.33);
      expect(normalized[5]!.amount).toBe(60.27);

      // Verify no decimal string representation has more than 2 fractional digits
      for (const n of normalized) {
        const decimals = String(n.amount).split(".")[1] || "";
        expect(decimals.length).toBeLessThanOrEqual(2);
      }

      const tb = computeTrialBalance(floatHazardEntries);
      expect(tb.isBalanced).toBe(true);
      expect(tb.totalDebits).toBe(1333.82);
      expect(tb.totalCredits).toBe(1333.82);

      const pnl = computePnlMetrics(floatHazardEntries);
      expect(pnl.grossRevenue).toBe(1273.55); // 0.30 + 99.99 + 139.93 + 1000.00 + 33.33
      expect(pnl.operatingExpenses).toBe(60.27);
      expect(pnl.netOperatingIncome).toBe(1213.28); // 1273.55 - 60.27
    });
  });

  describe("3. Multi-Currency Separation (USD vs. LBP)", () => {
    const mixedCurrencyLedger: LedgerEntry[] = [
      {
        id: "fx-usd-1",
        date: "2026-11-10",
        account: "Tuition",
        type: "Revenue",
        amount: 200,
        currency: "USD",
        status: "Collected",
        paymentMethod: "Cash",
        module: "academy",
      },
      {
        id: "fx-usd-2",
        date: "2026-11-10",
        account: "Coach Payroll Expense",
        type: "Expense",
        amount: 80,
        currency: "USD",
        status: "Paid",
        paymentMethod: "Cash",
        module: "academy",
      },
      {
        id: "fx-lbp-1",
        date: "2026-11-10",
        account: "Kiosk POS & Merch Sales",
        type: "Revenue",
        amount: 8_950_000, // Legacy caller passing raw LBP in amount when originalAmount===amount
        originalAmount: 8_950_000, // 8,950,000 LBP @ 89,500 = $100.00 USD
        currency: "LBP",
        exchangeRate: 89500,
        status: "Collected",
        paymentMethod: "Cash",
        module: "pos",
      },
      {
        id: "fx-lbp-2",
        date: "2026-11-10",
        account: "Utilities",
        type: "Expense",
        amount: 0,
        originalAmount: 4_475_000, // 4,475,000 LBP @ 89,500 = $50.00 USD
        currency: "LBP",
        exchangeRate: 89500,
        status: "Paid",
        paymentMethod: "Cash",
        module: "general",
      },
    ];

    it("never sums raw LBP figures directly into USD amounts and routes cash to separate COA drawers (1010 vs 1015)", () => {
      const normLbpRev = normalizeDoubleEntryLedger(mixedCurrencyLedger[2]!);
      expect(normLbpRev.currency).toBe("LBP");
      expect(normLbpRev.originalAmount).toBe(8_950_000);
      expect(normLbpRev.amount).toBe(100); // Converted to $100.00 USD, never $8,950,000
      expect(normLbpRev.debitAccount).toBe("1015 · Cash Drawer (LBP — USD Equiv.)");

      const normUsdRev = normalizeDoubleEntryLedger(mixedCurrencyLedger[0]!);
      expect(normUsdRev.currency).toBe("USD");
      expect(normUsdRev.amount).toBe(200);
      expect(normUsdRev.debitAccount).toBe("1010 · Cash Drawer (USD)");

      const fullTb = computeTrialBalance(mixedCurrencyLedger);
      expect(fullTb.isBalanced).toBe(true);

      const usdCashDrawer = fullTb.rows.find((r) => r.code === "1010")!;
      const lbpCashDrawer = fullTb.rows.find((r) => r.code === "1015")!;
      expect(usdCashDrawer.debitTotal).toBe(200);
      expect(usdCashDrawer.creditTotal).toBe(80);
      expect(usdCashDrawer.netBalance).toBe(120);

      expect(lbpCashDrawer.debitTotal).toBe(100);
      expect(lbpCashDrawer.creditTotal).toBe(50);
      expect(lbpCashDrawer.netBalance).toBe(50);
    });

    it("keeps currency-filtered Trial Balance and P&L statements strictly isolated and balanced", () => {
      const usdTb = computeTrialBalance(mixedCurrencyLedger, { currency: "USD" });
      const lbpTb = computeTrialBalance(mixedCurrencyLedger, { currency: "LBP" });

      expect(usdTb.isBalanced).toBe(true);
      expect(usdTb.totalDebits).toBe(280); // 200 + 80
      expect(usdTb.rows.find((r) => r.code === "1015")!.entryCount).toBe(0);

      expect(lbpTb.isBalanced).toBe(true);
      expect(lbpTb.totalDebits).toBe(150); // 100 + 50
      expect(lbpTb.rows.find((r) => r.code === "1010")!.entryCount).toBe(0);

      const usdPnl = computePnlMetrics(mixedCurrencyLedger, { currency: "USD" });
      const lbpPnl = computePnlMetrics(mixedCurrencyLedger, { currency: "LBP" });
      const consolidatedPnl = computePnlMetrics(mixedCurrencyLedger);

      expect(usdPnl.grossRevenue).toBe(200);
      expect(usdPnl.directCogs).toBe(80);
      expect(usdPnl.netOperatingIncome).toBe(120);

      expect(lbpPnl.grossRevenue).toBe(100);
      expect(lbpPnl.operatingExpenses).toBe(50);
      expect(lbpPnl.netOperatingIncome).toBe(50);

      expect(roundToCents(usdPnl.netOperatingIncome + lbpPnl.netOperatingIncome)).toBe(
        consolidatedPnl.netOperatingIncome,
      );
    });
  });

  describe("4. Module Tagging & Multi-Vertical P&L Matrix Integrity", () => {
    it("tags every entry with a valid module and guarantees Sum(Per-Module P&L) === Consolidated P&L with zero orphaned entries", () => {
      const dataset = buildRbaDemoDataset("2026-11-15");
      // Include an untagged legacy entry to ensure inferLedgerModule assigns it to "general" so nothing slips through
      const ledgerWithLegacyUntagged: LedgerEntry[] = [
        ...dataset.ledger,
        {
          id: "legacy-untagged-1",
          date: "2026-11-15",
          account: "Miscellaneous Office Supplies",
          type: "Expense",
          amount: 42.15,
          status: "Paid",
          paymentMethod: "Cash",
        },
      ];

      const allModules: LedgerModule[] = [
        "academy",
        "courts",
        "gym",
        "physio",
        "pos",
        "merchandise",
        "crm",
        "general",
      ];

      for (const entry of ledgerWithLegacyUntagged) {
        const mod = inferLedgerModule(entry);
        expect(allModules.includes(mod)).toBe(true);
      }

      const matrix = computeMultiVerticalPnlMatrix(ledgerWithLegacyUntagged);

      const sumGrossRevenue = roundToCents(
        allModules.reduce((sum, mod) => sum + matrix[mod].grossRevenue, 0),
      );
      const sumDirectCogs = roundToCents(
        allModules.reduce((sum, mod) => sum + matrix[mod].directCogs, 0),
      );
      const sumGrossProfit = roundToCents(
        allModules.reduce((sum, mod) => sum + matrix[mod].grossProfit, 0),
      );
      const sumOperatingExpenses = roundToCents(
        allModules.reduce((sum, mod) => sum + matrix[mod].operatingExpenses, 0),
      );
      const sumNetOperatingIncome = roundToCents(
        allModules.reduce((sum, mod) => sum + matrix[mod].netOperatingIncome, 0),
      );
      const sumEntryCounts = allModules.reduce((sum, mod) => sum + matrix[mod].entryCount, 0);

      expect(sumGrossRevenue).toBe(matrix.consolidated.grossRevenue);
      expect(sumDirectCogs).toBe(matrix.consolidated.directCogs);
      expect(sumGrossProfit).toBe(matrix.consolidated.grossProfit);
      expect(sumOperatingExpenses).toBe(matrix.consolidated.operatingExpenses);
      expect(sumNetOperatingIncome).toBe(matrix.consolidated.netOperatingIncome);
      expect(sumEntryCounts).toBe(matrix.consolidated.entryCount);
    });
  });

  describe("5. Idempotency / Double-Click Protection", () => {
    it("rejects duplicate transaction IDs and duplicate referenceId submissions on slow connections", () => {
      const posSaleFirstClick: LedgerEntry = {
        id: "pos-tx-1001",
        referenceId: "receipt-POS-1001",
        date: "2026-11-15",
        account: "Kiosk POS & Merch Sales",
        category: "Kiosk POS",
        type: "Revenue",
        amount: 18.5,
        status: "Collected",
        paymentMethod: "Cash",
        module: "pos",
      };

      // Simulated 2nd click with the exact same ID
      const posSaleDuplicateId: LedgerEntry = { ...posSaleFirstClick };

      // Simulated 3rd click where client generated a new random ID but carries the same deterministic referenceId
      const posSaleDifferentIdSameRef: LedgerEntry = {
        ...posSaleFirstClick,
        id: "pos-tx-1001-retry-click",
        referenceId: "receipt-POS-1001",
      };

      const deduped = deduplicateLedgerEntries([
        posSaleFirstClick,
        posSaleDuplicateId,
        posSaleDifferentIdSameRef,
      ]);
      expect(deduped).toHaveLength(1);
      expect(deduped[0]!.id).toBe("pos-tx-1001");

      // Test appendIdempotentLedgerEntry helper
      let ledgerState: LedgerEntry[] = [];
      ledgerState = appendIdempotentLedgerEntry(ledgerState, posSaleFirstClick);
      expect(ledgerState).toHaveLength(1);

      ledgerState = appendIdempotentLedgerEntry(ledgerState, posSaleDuplicateId);
      expect(ledgerState).toHaveLength(1);

      ledgerState = appendIdempotentLedgerEntry(ledgerState, posSaleDifferentIdSameRef);
      expect(ledgerState).toHaveLength(1);

      // Verify Trial Balance and P&L never double-count when passed raw arrays with duplicate clicks
      const tbWithDuplicates = computeTrialBalance([
        posSaleFirstClick,
        posSaleDuplicateId,
        posSaleDifferentIdSameRef,
      ]);
      expect(tbWithDuplicates.isBalanced).toBe(true);
      expect(tbWithDuplicates.totalDebits).toBe(18.5);
      expect(tbWithDuplicates.totalCredits).toBe(18.5);

      const pnlWithDuplicates = computePnlMetrics([
        posSaleFirstClick,
        posSaleDuplicateId,
        posSaleDifferentIdSameRef,
      ]);
      expect(pnlWithDuplicates.grossRevenue).toBe(18.5);
      expect(pnlWithDuplicates.entryCount).toBe(1);
    });

    it("enforces idempotency when syncing game official fees multiple times for the same session", () => {
      const gameSession: SessionItem = {
        id: "game-idem-99",
        kind: "Game",
        title: "RBA U-18 vs North Hoops",
        detail: "North Arena Court 1",
        date: "2026-11-15",
        time: "19:00",
        branch: "RBA North Court",
        coach: "Coach Rami Nassar",
        status: "Official",
        referees: [{ id: "r1", name: "Ref A", role: "Lead Ref", source: "outsource", fee: 50 }],
      };

      let ledger: LedgerEntry[] = [];
      ledger = syncGameOfficialFeesToLedger(gameSession, ledger);
      expect(ledger).toHaveLength(1);

      // Calling syncGameOfficialFeesToLedger repeatedly (double-save) must replace/deduplicate, never accumulate
      ledger = syncGameOfficialFeesToLedger(gameSession, ledger);
      ledger = syncGameOfficialFeesToLedger(gameSession, ledger);
      expect(ledger).toHaveLength(1);

      const tb = computeTrialBalance(ledger);
      expect(tb.isBalanced).toBe(true);
      expect(tb.totalDebits).toBe(50);
      expect(tb.totalCredits).toBe(50);
    });

    it("preserves distinct legitimate legs that share a parent referenceId (e.g. Merchandise Revenue + Merchandise COGS)", () => {
      const merchSaleRevenue: LedgerEntry = {
        id: "ord-500-rev",
        referenceId: "order-500",
        date: "2026-11-15",
        account: "Merchandise Revenue",
        type: "Revenue",
        amount: 45,
        status: "Collected",
        module: "merchandise",
      };
      const merchSaleCogs: LedgerEntry = {
        id: "ord-500-cogs",
        referenceId: "order-500",
        date: "2026-11-15",
        account: "Merchandise Store COGS",
        type: "Expense",
        amount: 19,
        status: "Paid",
        module: "merchandise",
      };

      // Both legs share referenceId "order-500" but have different accounts & types, so both are preserved
      const deduped = deduplicateLedgerEntries([
        merchSaleRevenue,
        merchSaleCogs,
        { ...merchSaleRevenue, id: "ord-500-rev-doubleclick" }, // Duplicate revenue click is dropped
      ]);
      expect(deduped).toHaveLength(2);

      const pnl = computePnlMetrics(deduped);
      expect(pnl.grossRevenue).toBe(45);
      expect(pnl.directCogs).toBe(19);
      expect(pnl.grossProfit).toBe(26);
      expect(CHART_OF_ACCOUNTS.length).toBeGreaterThanOrEqual(28);
    });
  });
});

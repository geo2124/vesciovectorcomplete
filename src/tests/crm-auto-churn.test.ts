import { describe, it, expect } from "vitest";
import {
  evaluateCrmAutoChurnCandidates,
  type Player,
  type SessionItem,
  type Invoice,
} from "../lib/data-store";

const makeIdlePlayer = (overrides: Partial<Player> = {}): Player => ({
  id: "p-idle-1",
  name: "Tariq Khoury",
  gender: "Boy",
  dob: "2012-03-15",
  category: "U-14",
  teams: ["U-14 Boys Elite"],
  branch: "Downtown Arena",
  phone: "03-555666",
  parent: "Sami Khoury",
  parentPhone: "03-555666",
  school: "College Notre Dame",
  fee: 100,
  status: "Idle",
  idleSinceDate: "2026-05-01",
  missedSessionsSinceIdle: 6,
  balance: 100,
  attendance: "75%",
  ...overrides,
});

describe("CRM Auto-Churn Date & Activity Evaluator", () => {
  it("enforces 1_month (30 days) threshold vs custom_weeks (weeks * 7 days) threshold", () => {
    const player = makeIdlePlayer({ idleSinceDate: "2026-05-01" });

    // On 2026-05-20 (19 days idle):
    // - 1_month (30 days) should NOT churn
    // - custom_weeks = 2 (14 days) SHOULD churn
    const oneMonthCheck = evaluateCrmAutoChurnCandidates({
      players: [player],
      crmSettings: {
        autoChurnEnabled: true,
        autoChurnMode: "1_month",
        autoChurnWeeks: 4,
      },
      referenceDateIso: "2026-05-20",
    });
    expect(oneMonthCheck.thresholdDays).toBe(30);
    expect(oneMonthCheck.churnCandidates).toHaveLength(0);

    const twoWeeksCheck = evaluateCrmAutoChurnCandidates({
      players: [player],
      crmSettings: {
        autoChurnEnabled: true,
        autoChurnMode: "custom_weeks",
        autoChurnWeeks: 2,
      },
      referenceDateIso: "2026-05-20",
    });
    expect(twoWeeksCheck.thresholdDays).toBe(14);
    expect(twoWeeksCheck.churnCandidates).toHaveLength(1);
    expect(twoWeeksCheck.churnCandidates[0].daysIdle).toBe(19);
  });

  it("ignores historical payments/attendance BEFORE idleSinceDate, but prevents churn when payment or attendance occurs ON OR AFTER idleSinceDate", () => {
    const player = makeIdlePlayer({
      id: "p-idle-1",
      idleSinceDate: "2026-05-01",
      // Old payment from previous cycle before idleSinceDate
      payments: [
        {
          id: "pmt-old",
          date: "2026-04-05",
          amount: 100,
          notes: "April tuition",
          paymentMethod: "Cash",
        },
      ],
    });

    const oldSessionBeforeIdle: SessionItem = {
      id: "sess-old",
      title: "U-14 Practice",
      detail: "Court 1",
      coach: "Coach Karim",
      team: "U-14 Boys Elite",
      branch: "Downtown Arena",
      court: "Court 1",
      date: "2026-04-20",
      time: "17:00",
      type: "Practice",
      status: "Completed",
      attendees: ["p-idle-1"],
    };

    const oldInvoiceBeforeIdle: Invoice = {
      id: "inv-old",
      invoiceNumber: "INV-2026-04-001",
      playerId: "p-idle-1",
      playerName: "Tariq Khoury",
      branch: "Downtown Arena",
      team: "U-14 Boys Elite",
      billingMonth: "April",
      month: "04",
      year: 2026,
      amount: 100,
      status: "paid",
      paidDate: "2026-04-05",
      issuedDate: "2026-04-01",
      dueDate: "2026-04-15",
      createdAt: "2026-04-01",
    };

    // With only pre-idle activity, after 35 days (2026-06-05) the player MUST be auto-churned
    const churnWithOnlyOldHistory = evaluateCrmAutoChurnCandidates({
      players: [player],
      crmSettings: {
        autoChurnEnabled: true,
        autoChurnMode: "1_month",
        autoChurnWeeks: 4,
      },
      sessions: [oldSessionBeforeIdle],
      attendance: { "sess-old": { "p-idle-1": "Present" } },
      invoices: [oldInvoiceBeforeIdle],
      referenceDateIso: "2026-06-05",
    });
    expect(churnWithOnlyOldHistory.churnCandidates).toHaveLength(1);

    // With a Present attendance on or after idleSinceDate (2026-05-12), the player must NOT be auto-churned
    const newSessionAfterIdle: SessionItem = {
      ...oldSessionBeforeIdle,
      id: "sess-new",
      date: "2026-05-12",
    };
    const protectedByAttendance = evaluateCrmAutoChurnCandidates({
      players: [player],
      crmSettings: {
        autoChurnEnabled: true,
        autoChurnMode: "1_month",
        autoChurnWeeks: 4,
      },
      sessions: [oldSessionBeforeIdle, newSessionAfterIdle],
      attendance: { "sess-new": { "p-idle-1": "Present" } },
      invoices: [oldInvoiceBeforeIdle],
      referenceDateIso: "2026-06-05",
    });
    expect(protectedByAttendance.churnCandidates).toHaveLength(0);
  });
});

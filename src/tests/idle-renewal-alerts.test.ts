import { describe, it, expect } from "vitest";
import {
  evaluateMonthlyIdleCycleRenewal,
  evaluateIdleSessionCompletionAndAlerts,
  type Player,
  type SessionItem,
  type Invoice,
} from "../lib/data-store";

const makePlayer = (overrides: Partial<Player> = {}): Player => ({
  id: "p-1",
  name: "Ziad Mansour",
  gender: "Boy",
  dob: "2013-04-10",
  category: "U-14",
  teams: ["U-14 Boys Elite"],
  branch: "Downtown Arena",
  phone: "03-111222",
  parent: "Nabil Mansour",
  parentPhone: "03-111222",
  school: "Sagesse High",
  fee: 100,
  status: "Active",
  balance: 0,
  attendance: "100%",
  ...overrides,
});

const makeCompletedSession = (
  id: string,
  date: string,
  overrides: Partial<SessionItem> = {},
): SessionItem => ({
  id,
  title: "U-14 Practice",
  detail: "Court 1",
  coach: "Coach Karim",
  team: "U-14 Boys Elite",
  branch: "Downtown Arena",
  court: "Court 1",
  date,
  time: "17:00",
  endTime: "18:30",
  type: "Practice",
  status: "Completed",
  attendees: [],
  ...overrides,
});

describe("Idle Renewal & 3-Session Alert Engine", () => {
  it("transitions Active unpaid/unattended players to Idle with idleSinceDate and missedSessionsSinceIdle = 0 at monthly renewal", () => {
    const unpaidPlayer = makePlayer({ id: "p-unpaid", status: "Active" });
    const prepaidPlayer = makePlayer({ id: "p-paid", status: "Active" });

    const paidInvoice: Invoice = {
      id: "p-paid_2026_06",
      invoiceNumber: "INV-2026-06-001",
      playerId: "p-paid",
      playerName: "Paid Player",
      branch: "Downtown Arena",
      team: "U-14 Boys Elite",
      billingMonth: "June",
      month: "06",
      year: 2026,
      amount: 100,
      status: "paid",
      paidDate: "2026-06-01",
      issuedDate: "2026-06-01",
      dueDate: "2026-06-15",
      createdAt: "2026-06-01",
    };

    const renewal = evaluateMonthlyIdleCycleRenewal({
      players: [unpaidPlayer, prepaidPlayer],
      sessions: [],
      attendance: {},
      invoices: [paidInvoice],
      targetYm: "2026-06",
      renewalDate: "2026-06-01",
    });

    expect(renewal.transitionedToIdleIds).toEqual(["p-unpaid"]);
    expect(renewal.keptActiveIds).toEqual(["p-paid"]);

    const updatedUnpaid = renewal.updatedPlayers.find((p) => p.id === "p-unpaid")!;
    expect(updatedUnpaid.status).toBe("Idle");
    expect(updatedUnpaid.idleSinceDate).toBe("2026-06-01");
    expect(updatedUnpaid.missedSessionsSinceIdle).toBe(0);
    expect(updatedUnpaid.idleMissedSessionIds).toEqual([]);

    const updatedPaid = renewal.updatedPlayers.find((p) => p.id === "p-paid")!;
    expect(updatedPaid.status).toBe("Active");
    expect(updatedPaid.idleSinceDate).toBe("");
    expect(updatedPaid.missedSessionsSinceIdle).toBe(0);
  });

  it("increments missedSessionsSinceIdle on completed team sessions and fires an alert on every 3rd missed session (3, 6, ...)", () => {
    let players = [
      makePlayer({
        id: "p-1",
        status: "Idle",
        idleSinceDate: "2026-06-01",
        missedSessionsSinceIdle: 0,
        idleMissedSessionIds: [],
      }),
    ];

    const alertCounts: number[] = [];

    for (let i = 1; i <= 6; i++) {
      const sess = makeCompletedSession(`sess-${i}`, `2026-06-0${i}`);
      const res = evaluateIdleSessionCompletionAndAlerts({
        completedSession: sess,
        players,
        attendance: {},
        invoices: [],
      });
      players = res.updatedPlayers;
      expect(players[0].missedSessionsSinceIdle).toBe(i);
      if (res.alerts.length > 0) {
        alertCounts.push(res.alerts[0].missedCount);
      }
    }

    // Alerts must fire strictly on every 3rd completed session (3 and 6)
    expect(alertCounts).toEqual([3, 6]);

    // Re-evaluating the same session ID must be idempotent and not double-increment
    const duplicateRes = evaluateIdleSessionCompletionAndAlerts({
      completedSession: makeCompletedSession("sess-6", "2026-06-06"),
      players,
    });
    expect(duplicateRes.updatedPlayers[0].missedSessionsSinceIdle).toBe(6);
    expect(duplicateRes.alerts).toHaveLength(0);
  });

  it("immediately reactivates an Idle player to Active and resets counters on first Present attendance or payment", () => {
    const idlePlayer = makePlayer({
      id: "p-1",
      status: "Idle",
      idleSinceDate: "2026-06-01",
      missedSessionsSinceIdle: 4,
      idleMissedSessionIds: ["s1", "s2", "s3", "s4"],
    });

    const attendedSession = makeCompletedSession("sess-5", "2026-06-10", {
      attendees: ["p-1"],
    });

    const res = evaluateIdleSessionCompletionAndAlerts({
      completedSession: attendedSession,
      players: [idlePlayer],
      attendance: { "sess-5": { "p-1": "Present" } },
      invoices: [],
    });

    expect(res.reactivatedPlayerIds).toEqual(["p-1"]);
    expect(res.updatedPlayers[0].status).toBe("Active");
    expect(res.updatedPlayers[0].missedSessionsSinceIdle).toBe(0);
    expect(res.updatedPlayers[0].idleSinceDate).toBe("");
    expect(res.updatedPlayers[0].idleMissedSessionIds).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import {
  RBA_DEMO_ROLES,
  RBA_DEMO_TENANT_ID,
  buildRbaDemoDataset,
  wipeRbaDemoData,
} from "../lib/rba-demo-seed";
import { computeTrialBalance } from "../lib/accounting-coa";

describe("RBA Demo Sandbox Seed & Safety Engine", () => {
  it("builds a complete, deterministic RBA dataset covering all modules and roles", () => {
    const dataset = buildRbaDemoDataset("2026-05-15");

    expect(dataset.branches).toHaveLength(2);
    expect(dataset.branches.map((b) => b.name)).toEqual(["RBA Main Campus", "RBA North Court"]);

    expect(dataset.teams).toHaveLength(4);
    expect(dataset.coaches).toHaveLength(5);
    expect(dataset.staff).toHaveLength(3);
    expect(dataset.players).toHaveLength(20);
    expect(dataset.sessions).toHaveLength(12);
    expect(dataset.ledger).toHaveLength(18);
    expect(dataset.workshops).toHaveLength(1);
    expect(dataset.workshops[0]?.id).toBe("rba-ws-1");
    expect(dataset.workshops[0]?.title).toBe(
      "RBA Technical Symposium: Modern European Ball-Screen Defense",
    );
    expect(RBA_DEMO_ROLES).toHaveLength(7);

    // Check past completed sessions have attendance records
    const completedSessions = dataset.sessions.filter(
      (s) => s.status === "Completed" || s.status === "Official",
    );
    expect(completedSessions).toHaveLength(5);
    for (const s of completedSessions) {
      expect(dataset.attendance[s.id]).toBeDefined();
    }

    // Check today's scheduled sessions exist for live Coach Portal attendance testing
    const todaySessions = dataset.sessions.filter((s) => s.date === "2026-05-15");
    expect(todaySessions).toHaveLength(3);

    // Check multi-currency and multi-module coverage in double-entry ledger
    const modules = new Set(dataset.ledger.map((e) => e.module));
    expect(modules.has("academy")).toBe(true);
    expect(modules.has("courts")).toBe(true);
    expect(modules.has("gym")).toBe(true);
    expect(modules.has("physio")).toBe(true);
    expect(modules.has("pos")).toBe(true);
    expect(modules.has("merchandise")).toBe(true);
    expect(modules.has("crm")).toBe(true);
    expect(modules.has("general")).toBe(true);

    const lbpEntries = dataset.ledger.filter((e) => e.currency === "LBP");
    expect(lbpEntries.length).toBeGreaterThanOrEqual(2);

    // Verify double-entry trial balance is strictly balanced
    const tb = computeTrialBalance(dataset.ledger);
    expect(tb.isBalanced).toBe(true);
    expect(tb.totalDebits).toBeGreaterThan(0);
  });

  it("strictly blocks wipeRbaDemoData for any tenant other than rba-demo", async () => {
    expect(RBA_DEMO_TENANT_ID).toBe("rba-demo");
    await expect(wipeRbaDemoData("donbosco")).rejects.toThrow("Wipe blocked: non-demo tenant");
    await expect(wipeRbaDemoData("vescio-main")).rejects.toThrow("Wipe blocked: non-demo tenant");
    await expect(wipeRbaDemoData("")).rejects.toThrow("Wipe blocked: non-demo tenant");
  });
});

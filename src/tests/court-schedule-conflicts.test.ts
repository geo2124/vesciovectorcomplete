import { describe, it, expect } from "vitest";
import {
  checkCourtScheduleConflict,
  applyBranchAndCourtRenameToDB,
  emptyDB,
  type Branch,
  type CourtReservation,
  type SessionItem,
} from "../lib/data-store";

const makeBranch = (overrides: Partial<Branch> = {}): Branch => ({
  id: "br-1",
  name: "Downtown Arena",
  city: "Beirut",
  courtsCount: 2,
  courts: [
    { id: "c-1", name: "Court 1", type: "Indoor", status: "Available" },
    { id: "c-2", name: "Court 2", type: "Indoor", status: "Available" },
  ],
  manager: "Coach Fadi",
  phone: "03-000000",
  players: 40,
  status: "Active",
  offDays: [],
  ...overrides,
});

const makeReservation = (overrides: Partial<CourtReservation> = {}): CourtReservation => ({
  id: "res-1",
  branch: "Downtown Arena",
  court: "Court 1",
  courtAllocation: "Half Court - HCA",
  date: "2026-05-15",
  startTime: "16:00",
  endTime: "17:30",
  durationHours: 1.5,
  clientName: "Private Skills Clinic",
  clientType: "Private Session",
  rateType: "Private Rate",
  unitRate: 45,
  totalAmount: 45,
  finalTotalAmount: 45,
  paymentStatus: "Pending",
  status: "Confirmed",
  ...overrides,
});

const makeSession = (overrides: Partial<SessionItem> = {}): SessionItem => ({
  id: "sess-1",
  title: "U-14 Boys Practice",
  detail: "Court 1",
  team: "U-14 Boys Elite",
  coach: "Coach Fadi",
  branch: "Downtown Arena",
  court: "Court 1",
  courtAllocation: "Full Court",
  date: "2026-05-15",
  time: "18:00",
  endTime: "19:30",
  status: "Planned",
  ...overrides,
});

describe("checkCourtScheduleConflict & Off Days / Rename Cascade", () => {
  it("allows Half Court - HCA and Half Court - HCB bookings on the same court during the exact same time slot", () => {
    const existingHca = makeReservation({
      id: "res-hca",
      courtAllocation: "Half Court - HCA",
      startTime: "16:00",
      endTime: "17:30",
    });

    const conflictResult = checkCourtScheduleConflict(
      {
        branch: "Downtown Arena",
        court: "Court 1",
        courtAllocation: "Half Court - HCB",
        date: "2026-05-15",
        time: "16:00",
        endTime: "17:30",
      },
      [],
      undefined,
      [existingHca],
    );

    expect(conflictResult.hasCourtConflict).toBe(false);
    expect(conflictResult.simultaneousHalfCourtSession?.id).toBe("res-hca");
  });

  it("detects conflict when a Full Court booking overlaps either HCA or HCB on the same court", () => {
    const existingHca = makeReservation({
      id: "res-hca",
      courtAllocation: "Half Court - HCA",
      startTime: "16:00",
      endTime: "17:30",
    });

    const fullCourtAttempt = checkCourtScheduleConflict(
      {
        branch: "Downtown Arena",
        court: "Court 1",
        courtAllocation: "Full Court",
        date: "2026-05-15",
        time: "16:30",
        endTime: "18:00",
      },
      [],
      undefined,
      [existingHca],
    );

    expect(fullCourtAttempt.hasCourtConflict).toBe(true);
    expect(fullCourtAttempt.conflictingCourtSession?.id).toBe("res-hca");
  });

  it("allows adjacent back-to-back time slots where startTime equals previous endTime", () => {
    const existingFull = makeReservation({
      id: "res-full",
      courtAllocation: "Full Court",
      startTime: "16:00",
      endTime: "17:30",
    });

    const adjacentSlot = checkCourtScheduleConflict(
      {
        branch: "Downtown Arena",
        court: "Court 1",
        courtAllocation: "Full Court",
        date: "2026-05-15",
        time: "17:30",
        endTime: "19:00",
      },
      [makeSession({ time: "14:30", endTime: "16:00" })],
      undefined,
      [existingFull],
    );

    expect(adjacentSlot.hasCourtConflict).toBe(false);
  });

  it("enforces Branch Off Days and blocks scheduling on closed dates", () => {
    const branchWithOffDay = makeBranch({
      offDays: [{ id: "od-1", date: "2026-05-20", reason: "National Holiday Closure" }],
    });

    const offDayAttempt = checkCourtScheduleConflict(
      {
        branch: "Downtown Arena",
        court: "Court 1",
        courtAllocation: "Full Court",
        date: "2026-05-20",
        time: "16:00",
        endTime: "17:30",
      },
      [],
      undefined,
      [],
      undefined,
      [branchWithOffDay],
    );

    expect(offDayAttempt.hasCourtConflict).toBe(true);
    expect(offDayAttempt.courtConflictReason).toContain("National Holiday Closure");
  });

  it("cascades branch rename and court rename/removal across referencing records", () => {
    const baseDb = emptyDB();
    const branch = makeBranch({
      name: "New Downtown Hub",
      courts: [{ id: "c-1", name: "Main Show Court", type: "Indoor", status: "Available" }],
    });

    baseDb.branches = [makeBranch()];
    baseDb.players = [
      {
        id: "p-1",
        name: "Rami",
        gender: "Male",
        dob: "2013-01-01",
        category: "U-14",
        teams: ["U-14 Boys"],
        branch: "Downtown Arena",
        phone: "",
        parent: "Parent",
        parentPhone: "",
        fee: 100,
        status: "Active",
        balance: 0,
        attendance: "100%",
      },
    ];
    baseDb.sessions = [
      makeSession({ id: "s-1", branch: "Downtown Arena", court: "Court 1" }),
      makeSession({ id: "s-2", branch: "Downtown Arena", court: "Court 2" }),
    ];
    baseDb.courtReservations = [
      makeReservation({ id: "r-1", branch: "Downtown Arena", court: "Court 1" }),
      makeReservation({ id: "r-2", branch: "Downtown Arena", court: "Court 2" }),
    ];

    const result = applyBranchAndCourtRenameToDB(baseDb, {
      branchId: branch.id,
      updatedBranch: branch,
      oldBranchName: "Downtown Arena",
      newBranchName: "New Downtown Hub",
      courtRenames: { "Court 1": "Main Show Court" },
      removedCourtNames: ["Court 2"],
      fallbackCourtName: "Main Show Court",
    });

    expect(result.nextDb.players[0].branch).toBe("New Downtown Hub");
    expect(result.nextDb.sessions[0].branch).toBe("New Downtown Hub");
    expect(result.nextDb.sessions[0].court).toBe("Main Show Court");
    expect(result.nextDb.sessions[1].court).toBe("Main Show Court");
    expect(result.nextDb.courtReservations[0].branch).toBe("New Downtown Hub");
    expect(result.nextDb.courtReservations[0].court).toBe("Main Show Court");
    expect(result.nextDb.courtReservations[1].court).toBe("Main Show Court");
  });
});

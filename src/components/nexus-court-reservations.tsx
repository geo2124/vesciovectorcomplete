import { useEffect, useMemo, useRef, useState } from "react";
import {
  Ban,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  DollarSign,
  Edit3,
  Lock,
  Plus,
  Repeat,
  Sliders,
  Trash2,
  Unlock,
} from "lucide-react";
import { toast } from "sonner";
import {
  Button,
  Chip,
  EmptyState,
  Field,
  Input,
  Modal,
  Panel,
  Select,
  Table,
  Td,
  Textarea,
  Th,
  money,
} from "@/components/kit";
import {
  COURT_ALLOCATION_OPTIONS,
  atomicBookCourtReservationTransaction,
  calculateSessionDurationHours,
  checkCourtScheduleConflict,
  todayISO,
  uid,
  useDB,
  useTenantUser,
  type Branch,
  type BranchNexusRates,
  type BranchOffDay,
  type Court,
  type CourtAllocationType,
  type CourtRateType,
  type CourtReservation,
  type LedgerEntry,
} from "@/lib/data-store";
import { normalizeDoubleEntryLedger } from "@/lib/accounting-coa";

export interface NexusCourtReservationsProps {
  branchFilter: string;
  onChangeBranchFilter: (branchName: string) => void;
  externalNewBookingTrigger?: number | undefined;
}

type CalendarViewMode = "daily" | "weekly" | "monthly";

type CalendarDisplayItem = {
  key: string;
  source: "nexus" | "academy";
  id: string;
  isProjectedContinuous?: boolean | undefined;
  seedReservation?: CourtReservation | undefined;
  reservation?: CourtReservation | undefined;
  title: string;
  subtitle: string;
  branch: string;
  court: string;
  allocation: CourtAllocationType;
  date: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  totalAmount: number;
  paidAmount: number;
  paymentStatus: string;
  status: string;
  rateType?: CourtRateType | undefined;
  isRecurring?: boolean | undefined;
  recurrenceLabel?: string | undefined;
};

type DragSelectionState = {
  courtName: string;
  date: string;
  anchorCol: "HCA" | "HCB";
  hoverCol: "HCA" | "HCB";
  startSlotIdx: number;
  currentSlotIdx: number;
};

const RATE_TYPE_OPTIONS: Array<{ label: string; value: CourtRateType }> = [
  { label: "Half Court Rate (Hourly)", value: "Half Court Rate" },
  { label: "Full Court Rate (Hourly)", value: "Full Court Rate" },
  { label: "Private Rate (1 Client Base + Extra Player)", value: "Private Rate" },
  { label: "Academy Rate (Hourly)", value: "Academy Rate" },
];

const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function parseIsoParts(iso: string): { y: number; m: number; d: number } {
  const parts = iso.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
    const fallback = todayISO().split("-").map(Number);
    return { y: fallback[0] ?? 2026, m: fallback[1] ?? 1, d: fallback[2] ?? 1 };
  }
  return { y: parts[0] ?? 2026, m: parts[1] ?? 1, d: parts[2] ?? 1 };
}

function addDaysIso(isoDate: string, days: number): string {
  const { y, m, d } = parseIsoParts(isoDate);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function getIsoWeekdayIndexMon0(isoDate: string): number {
  const { y, m, d } = parseIsoParts(isoDate);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  return day === 0 ? 6 : day - 1; // 0=Mon..6=Sun
}

function getMondayOfWeekIso(isoDate: string): string {
  const offset = getIsoWeekdayIndexMon0(isoDate);
  return addDaysIso(isoDate, -offset);
}

function formatReadableDate(isoDate: string): string {
  const { y, m, d } = parseIsoParts(isoDate);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatMonthTitle(isoDate: string): string {
  const { y, m } = parseIsoParts(isoDate);
  const dt = new Date(Date.UTC(y, m - 1, 1));
  return dt.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function timeToMinutes(hhmm: string): number {
  const [hStr, mStr] = (hhmm || "00:00").split(":");
  const h = Number(hStr) || 0;
  const m = Number(mStr) || 0;
  return h * 60 + m;
}

function minutesToTime(totalMinutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, totalMinutes));
  if (clamped === 24 * 60) return "23:59";
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function parseOperatingMinutes(operatingHours?: string): { startMin: number; endMin: number } {
  if (!operatingHours) return { startMin: 8 * 60, endMin: 23 * 60 };
  const match = operatingHours.match(/(\d{1,2}):(\d{2})\s*[-–—to]+\s*(\d{1,2}):(\d{2})/i);
  if (!match) return { startMin: 8 * 60, endMin: 23 * 60 };
  const sh = Number(match[1]);
  const sm = Number(match[2]);
  const eh = Number(match[3]);
  const em = Number(match[4]);
  const startMin = Math.floor((sh * 60 + sm) / 15) * 15;
  let endMin = Math.ceil((eh * 60 + em) / 15) * 15;
  if (endMin <= startMin) endMin = 23 * 60;
  return {
    startMin: Math.max(6 * 60, Math.min(20 * 60, startMin)),
    endMin: Math.max(startMin + 120, Math.min(24 * 60, endMin)),
  };
}

function build15MinSlots(startMin: number, endMin: number): string[] {
  const slots: string[] = [];
  for (let m = startMin; m < endMin; m += 15) {
    slots.push(minutesToTime(m));
  }
  return slots;
}

function resolveBranchNexusRates(branch?: Branch, primaryCourt?: Court): BranchNexusRates {
  const fallbackFull = Number(primaryCourt?.fullCourtHourlyRate ?? branch?.rentalRate ?? 60) || 60;
  const fallbackHalf =
    Number(primaryCourt?.halfCourtHourlyRate ?? Math.round(fallbackFull * 0.6)) || 35;

  return {
    halfCourtHourlyRate:
      branch?.nexusRates?.halfCourtHourlyRate !== undefined
        ? Number(branch.nexusRates.halfCourtHourlyRate)
        : fallbackHalf,
    fullCourtHourlyRate:
      branch?.nexusRates?.fullCourtHourlyRate !== undefined
        ? Number(branch.nexusRates.fullCourtHourlyRate)
        : fallbackFull,
    privateBaseFee:
      branch?.nexusRates?.privateBaseFee !== undefined
        ? Number(branch.nexusRates.privateBaseFee)
        : 40,
    privateExtraPlayerFee:
      branch?.nexusRates?.privateExtraPlayerFee !== undefined
        ? Number(branch.nexusRates.privateExtraPlayerFee)
        : 15,
    academyHourlyRate:
      branch?.nexusRates?.academyHourlyRate !== undefined
        ? Number(branch.nexusRates.academyHourlyRate)
        : 25,
    updatedAt: branch?.nexusRates?.updatedAt,
  };
}

function roundCurrency(val: number): number {
  return Math.round((Number(val) || 0) * 100) / 100;
}

export interface CourtReservationPricingInput {
  startTime: string;
  endTime: string;
  rateType: CourtRateType;
  unitRate: number;
  extraPlayerRate?: number;
  playerCount?: number | string;
  freePass?: boolean;
  discountPercent?: number | string;
  discountFixedAmount?: number | string;
}

export interface CourtReservationPricingResult {
  isTimeValid: boolean;
  durationHours: number;
  unitRate: number;
  extraPlayerRate: number;
  playerCount: number;
  baseCalculatedAmount: number;
  discountPercent: number;
  discountFixedAmount: number;
  pctDeduction: number;
  finalPayable: number;
  effectiveHourly: number;
}

export function calculateCourtReservationPricing(
  input: CourtReservationPricingInput,
): CourtReservationPricingResult {
  const startMin = timeToMinutes(input.startTime);
  const endMin = timeToMinutes(input.endTime);
  const validDurationMinutes = Math.max(0, endMin - startMin);
  const durationHours =
    validDurationMinutes > 0
      ? Math.round((validDurationMinutes / 60) * 100) / 100
      : calculateSessionDurationHours(input.startTime, input.endTime);

  const unitRate = Number(input.unitRate) || 0;
  const extraPlayerRate = Number(input.extraPlayerRate) || 0;
  const pCount = Math.max(1, Math.floor(Number(input.playerCount) || 1));

  const baseCalculatedAmount =
    input.rateType === "Private Rate"
      ? roundCurrency(unitRate + Math.max(0, pCount - 1) * extraPlayerRate)
      : roundCurrency(unitRate * durationHours);

  const pct = Math.max(0, Math.min(100, Number(input.discountPercent) || 0));
  const fixedDisc = Math.max(0, Number(input.discountFixedAmount) || 0);
  const pctDeduction = roundCurrency(baseCalculatedAmount * (pct / 100));
  const afterPct = Math.max(0, roundCurrency(baseCalculatedAmount - pctDeduction));
  const finalPayable = input.freePass ? 0 : Math.max(0, roundCurrency(afterPct - fixedDisc));
  const effectiveHourly =
    durationHours > 0 ? roundCurrency(finalPayable / durationHours) : unitRate;

  return {
    isTimeValid: endMin > startMin,
    durationHours,
    unitRate,
    extraPlayerRate,
    playerCount: pCount,
    baseCalculatedAmount,
    discountPercent: pct,
    discountFixedAmount: fixedDisc,
    pctDeduction,
    finalPayable,
    effectiveHourly,
  };
}

export function calculateCourtCashInMath(params: {
  totalAmount: number;
  alreadyPaidAmount: number;
  collectAmountInput: number | string;
  freePass?: boolean;
  paymentMethod?: CourtReservation["paymentMethod"];
  hasLinkedPlayer?: boolean;
}): {
  confirmedCollectAmount: number;
  newTotalPaid: number;
  updatedFinalTotal: number;
  remainingBalance: number;
  paymentStatus: CourtReservation["paymentStatus"];
} {
  const alreadyPaid = roundCurrency(Number(params.alreadyPaidAmount) || 0);
  const confirmedCollectAmount = params.freePass
    ? 0
    : Math.max(0, roundCurrency(Number(params.collectAmountInput) || 0));
  const newTotalPaid = roundCurrency(alreadyPaid + confirmedCollectAmount);
  const baseTotalAmount = roundCurrency(Number(params.totalAmount) || 0);
  const updatedFinalTotal = params.freePass ? 0 : Math.max(baseTotalAmount, newTotalPaid);
  const remainingBalance = Math.max(0, roundCurrency(updatedFinalTotal - newTotalPaid));

  const paymentStatus: CourtReservation["paymentStatus"] = params.freePass
    ? "Free Pass"
    : params.paymentMethod === "Account Charge" && params.hasLinkedPlayer
      ? "Charged to Account"
      : newTotalPaid >= updatedFinalTotal && updatedFinalTotal > 0
        ? "Paid"
        : newTotalPaid > 0
          ? "Partial"
          : "Pending";

  return {
    confirmedCollectAmount,
    newTotalPaid,
    updatedFinalTotal,
    remainingBalance,
    paymentStatus,
  };
}

export function NexusCourtReservationsModule({
  branchFilter,
  onChangeBranchFilter,
  externalNewBookingTrigger,
}: NexusCourtReservationsProps) {
  const { db, tenantId, setEntity, patchEntity, deleteEntity, runBranchArrayTransaction } = useDB();
  const currentUser = useTenantUser();

  const branches = useMemo(() => db.branches || [], [db.branches]);
  const players = useMemo(() => db.players || [], [db.players]);
  const teams = useMemo(() => db.teams || [], [db.teams]);
  const sessions = useMemo(() => db.sessions || [], [db.sessions]);
  const reservations = useMemo(() => db.courtReservations || [], [db.courtReservations]);

  const today = todayISO();

  // Scoped active branch for calendar columns, rates engine, and off days
  const defaultBranchName = branches[0]?.name || "Main Branch";
  const [localScopedBranch, setLocalScopedBranch] = useState<string>(
    branchFilter !== "All" ? branchFilter : defaultBranchName,
  );

  useEffect(() => {
    if (branchFilter !== "All") {
      setLocalScopedBranch(branchFilter);
    } else if (
      branches.length > 0 &&
      !branches.some((b) => b.name.toLowerCase() === localScopedBranch.toLowerCase())
    ) {
      setLocalScopedBranch(branches[0]?.name || "Main Branch");
    }
  }, [branchFilter, branches, localScopedBranch]);

  const activeBranchName = branchFilter !== "All" ? branchFilter : localScopedBranch;

  const activeBranchObj = useMemo(
    () =>
      branches.find((b) => (b.name || "").toLowerCase() === activeBranchName.toLowerCase()) ||
      branches.find((b) => b.name === defaultBranchName),
    [branches, activeBranchName, defaultBranchName],
  );

  const branchCourts = useMemo<Court[]>(() => {
    if (activeBranchObj?.courts && activeBranchObj.courts.length > 0) {
      return activeBranchObj.courts;
    }
    return [
      {
        id: "default-court-1",
        name: "Court 1",
        contact: activeBranchObj?.manager || "Facility Desk",
        phone: activeBranchObj?.phone || "",
        operatingHours: activeBranchObj?.operatingHours || "08:00 - 23:00",
        enableHalfCourts: true,
        fullCourtHourlyRate: activeBranchObj?.rentalRate ?? 60,
        halfCourtHourlyRate: 35,
      },
    ];
  }, [activeBranchObj]);

  const branchRates = useMemo(
    () => resolveBranchNexusRates(activeBranchObj, branchCourts[0]),
    [activeBranchObj, branchCourts],
  );

  const branchOffDays = useMemo<BranchOffDay[]>(
    () => [...(activeBranchObj?.offDays || [])].sort((a, b) => a.date.localeCompare(b.date)),
    [activeBranchObj?.offDays],
  );

  const offDayMap = useMemo(() => {
    const map = new Map<string, BranchOffDay>();
    for (const item of branchOffDays) {
      map.set(item.date, item);
    }
    return map;
  }, [branchOffDays]);

  // Calendar View State
  const [viewMode, setViewMode] = useState<CalendarViewMode>("daily");
  const [focusDate, setFocusDate] = useState<string>(today);
  const [allowPreviousDates, setAllowPreviousDates] = useState<boolean>(false);
  const [weeklyCourtName, setWeeklyCourtName] = useState<string>(
    branchCourts[0]?.name || "Court 1",
  );
  const [directorySearch, setDirectorySearch] = useState<string>("");

  useEffect(() => {
    if (!branchCourts.some((c) => c.name === weeklyCourtName)) {
      setWeeklyCourtName(branchCourts[0]?.name || "Court 1");
    }
  }, [branchCourts, weeklyCourtName]);

  const operatingBounds = useMemo(
    () => parseOperatingMinutes(activeBranchObj?.operatingHours),
    [activeBranchObj?.operatingHours],
  );

  const slots15 = useMemo(
    () => build15MinSlots(operatingBounds.startMin, operatingBounds.endMin),
    [operatingBounds],
  );

  // Full 15-min time options for Booking Form dropdowns (06:00 to 23:45 + end boundary)
  const formTimeOptions = useMemo(() => {
    const opts: Array<{ label: string; value: string }> = [];
    for (let m = 6 * 60; m <= 23 * 60 + 45; m += 15) {
      const t = minutesToTime(m);
      opts.push({ label: t, value: t });
    }
    opts.push({ label: "23:59", value: "23:59" });
    return opts;
  }, []);

  const isDateLocked = (isoDate: string): boolean => {
    return !allowPreviousDates && isoDate < today;
  };

  const getOffDay = (isoDate: string): BranchOffDay | undefined => {
    return offDayMap.get(isoDate);
  };

  // Helper to ensure an active Branch record exists in Firestore before saving Rates or Off Days
  const ensureBranchRecord = async (): Promise<Branch> => {
    if (activeBranchObj) return activeBranchObj;
    const created: Branch = {
      id: uid("br"),
      name: activeBranchName || "Main Branch",
      city: "Beirut",
      address: "Main Facility Campus",
      manager: currentUser?.name || "Branch Manager",
      operatingHours: "08:00 - 23:00",
      courtsCount: branchCourts.length,
      courts: branchCourts,
      teams: 0,
      players: 0,
      rentalType: "Per session",
      rentalRate: 60,
      gymCapacity: 30,
      physioRoomsCount: 2,
      posRegisterName: `${activeBranchName || "Main Branch"} Kiosk #1`,
      posStartingFloat: 200,
      posStatus: "Open",
    };
    await setEntity("branches", created);
    return created;
  };

  // =========================================================================
  // 1. RATES SETUP MODAL STATE (SNAPSHOT-PROTECTED)
  // =========================================================================
  const [ratesModalOpen, setRatesModalOpen] = useState(false);
  const [ratesDraft, setRatesDraft] = useState<{
    halfCourtHourlyRate: string;
    fullCourtHourlyRate: string;
    privateBaseFee: string;
    privateExtraPlayerFee: string;
    academyHourlyRate: string;
  }>({
    halfCourtHourlyRate: String(branchRates.halfCourtHourlyRate),
    fullCourtHourlyRate: String(branchRates.fullCourtHourlyRate),
    privateBaseFee: String(branchRates.privateBaseFee),
    privateExtraPlayerFee: String(branchRates.privateExtraPlayerFee),
    academyHourlyRate: String(branchRates.academyHourlyRate),
  });

  const openRatesSetupModal = () => {
    setRatesDraft({
      halfCourtHourlyRate: String(branchRates.halfCourtHourlyRate),
      fullCourtHourlyRate: String(branchRates.fullCourtHourlyRate),
      privateBaseFee: String(branchRates.privateBaseFee),
      privateExtraPlayerFee: String(branchRates.privateExtraPlayerFee),
      academyHourlyRate: String(branchRates.academyHourlyRate),
    });
    setRatesModalOpen(true);
  };

  const handleSaveRatesSetup = async () => {
    const nextRates: BranchNexusRates = {
      halfCourtHourlyRate: Math.max(0, roundCurrency(Number(ratesDraft.halfCourtHourlyRate) || 0)),
      fullCourtHourlyRate: Math.max(0, roundCurrency(Number(ratesDraft.fullCourtHourlyRate) || 0)),
      privateBaseFee: Math.max(0, roundCurrency(Number(ratesDraft.privateBaseFee) || 0)),
      privateExtraPlayerFee: Math.max(
        0,
        roundCurrency(Number(ratesDraft.privateExtraPlayerFee) || 0),
      ),
      academyHourlyRate: Math.max(0, roundCurrency(Number(ratesDraft.academyHourlyRate) || 0)),
      updatedAt: new Date().toISOString(),
    };

    try {
      const targetBranch = await ensureBranchRecord();
      await runBranchArrayTransaction(
        targetBranch.id,
        (curr) => {
          const updatedCourts = (curr.courts || branchCourts).map((c) => ({
            ...c,
            fullCourtHourlyRate: nextRates.fullCourtHourlyRate,
            halfCourtHourlyRate: nextRates.halfCourtHourlyRate,
          }));
          return {
            ...curr,
            rentalRate: nextRates.fullCourtHourlyRate,
            courts: updatedCourts,
            nexusRates: nextRates,
          };
        },
        targetBranch,
      );

      setRatesModalOpen(false);
      toast.success(
        `Saved ${targetBranch.name} rate structures. Existing confirmed bookings keep their snapshotted fees.`,
      );
    } catch {
      /* Error toast handled by transaction wrapper */
    }
  };

  // =========================================================================
  // 2. OFF DAYS / CLOSURES MODAL STATE
  // =========================================================================
  const [offDaysModalOpen, setOffDaysModalOpen] = useState(false);
  const [newOffDayDate, setNewOffDayDate] = useState<string>(today);
  const [newOffDayReason, setNewOffDayReason] = useState<string>("");

  const handleAddOffDay = async () => {
    if (!newOffDayDate) {
      toast.error("Please choose a date to mark as an Off Day.");
      return;
    }
    if (offDayMap.has(newOffDayDate)) {
      toast.error(`${newOffDayDate} is already marked as an Off Day for ${activeBranchName}.`);
      return;
    }
    try {
      const targetBranch = await ensureBranchRecord();
      const entry: BranchOffDay = {
        id: uid("off"),
        date: newOffDayDate,
        reason: newOffDayReason.trim() || "Facility Closure / Off Day",
        createdBy: currentUser?.name || "Admin",
        createdAt: new Date().toISOString(),
      };
      await runBranchArrayTransaction(
        targetBranch.id,
        (curr) => ({
          ...curr,
          offDays: [...(curr.offDays || []).filter((o) => o.date !== newOffDayDate), entry].sort(
            (a, b) => a.date.localeCompare(b.date),
          ),
        }),
        targetBranch,
      );
      setNewOffDayReason("");
      toast.success(`Marked ${newOffDayDate} as an Off Day for ${targetBranch.name}.`);
    } catch {
      /* Error toast handled by transaction wrapper */
    }
  };

  const handleRemoveOffDay = async (offDayId: string) => {
    if (!activeBranchObj) return;
    try {
      await runBranchArrayTransaction(
        activeBranchObj.id,
        (curr) => ({
          ...curr,
          offDays: (curr.offDays || []).filter((o) => o.id !== offDayId),
        }),
        activeBranchObj,
      );
      toast.success("Removed Off Day closure.");
    } catch {
      /* Error toast handled by transaction wrapper */
    }
  };

  // =========================================================================
  // 3. BOOKING FORM MODAL STATE, SNAPSHOT RATES & RECURRING ENGINE
  // =========================================================================
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [editingReservation, setEditingReservation] = useState<CourtReservation | null>(null);

  const [bookingForm, setBookingForm] = useState<{
    clientType: CourtReservation["clientType"];
    linkedPlayerId: string;
    linkedTeamName: string;
    clientName: string;
    phone: string;
    branch: string;
    court: string;
    courtAllocation: CourtAllocationType;
    date: string;
    startTime: string;
    endTime: string;
    rateType: CourtRateType;
    playerCount: string;
    useExistingSnapshot: boolean;
    snapshotUnitRate: number;
    snapshotExtraPlayerRate: number;
    bookingType: "walk_in" | "recurring";
    recurrenceSubMode: "weeks" | "continuous";
    recurringWeeks: string;
    freePass: boolean;
    discountPercent: string;
    discountFixedAmount: string;
    collectPaymentNow: boolean;
    notes: string;
  }>({
    clientType: "External Client",
    linkedPlayerId: "",
    linkedTeamName: "",
    clientName: "",
    phone: "",
    branch: activeBranchName,
    court: branchCourts[0]?.name || "Court 1",
    courtAllocation: "Full Court",
    date: today,
    startTime: "18:00",
    endTime: "19:00",
    rateType: "Full Court Rate",
    playerCount: "1",
    useExistingSnapshot: false,
    snapshotUnitRate: branchRates.fullCourtHourlyRate,
    snapshotExtraPlayerRate: 0,
    bookingType: "walk_in",
    recurrenceSubMode: "weeks",
    recurringWeeks: "4",
    freePass: false,
    discountPercent: "0",
    discountFixedAmount: "0",
    collectPaymentNow: false,
    notes: "",
  });

  const resolveDefaultRateSnapshotForType = (
    rType: CourtRateType,
    targetBranchName: string,
    targetCourtName: string,
  ): { unitRate: number; extraPlayerRate: number } => {
    const bObj =
      branches.find((b) => (b.name || "").toLowerCase() === targetBranchName.toLowerCase()) ||
      activeBranchObj;
    const cObj =
      bObj?.courts?.find((c) => (c.name || "").toLowerCase() === targetCourtName.toLowerCase()) ||
      bObj?.courts?.[0];
    const rates = resolveBranchNexusRates(bObj, cObj);
    if (rType === "Half Court Rate") {
      return { unitRate: rates.halfCourtHourlyRate, extraPlayerRate: 0 };
    }
    if (rType === "Full Court Rate") {
      return { unitRate: rates.fullCourtHourlyRate, extraPlayerRate: 0 };
    }
    if (rType === "Private Rate") {
      return { unitRate: rates.privateBaseFee, extraPlayerRate: rates.privateExtraPlayerFee };
    }
    return { unitRate: rates.academyHourlyRate, extraPlayerRate: 0 };
  };

  const openNewBookingModal = (preset?: {
    court?: string;
    courtAllocation?: CourtAllocationType;
    date?: string;
    startTime?: string;
    endTime?: string;
  }) => {
    const targetDate =
      preset?.date || (focusDate >= today || allowPreviousDates ? focusDate : today);
    if (isDateLocked(targetDate)) {
      toast.error(
        `Date ${targetDate} is in the past and locked. Tick "Allow Previous Dates" to book past dates.`,
      );
      return;
    }
    const offDay = getOffDay(targetDate);
    if (offDay) {
      toast.error(`Cannot book on ${targetDate}: marked as Off Day (${offDay.reason}).`);
      return;
    }

    const alloc = preset?.courtAllocation || "Full Court";
    const defaultRateType: CourtRateType =
      alloc === "Full Court" ? "Full Court Rate" : "Half Court Rate";
    const targetCourt = preset?.court || branchCourts[0]?.name || "Court 1";
    const snap = resolveDefaultRateSnapshotForType(defaultRateType, activeBranchName, targetCourt);

    setEditingReservation(null);
    setBookingForm({
      clientType: "External Client",
      linkedPlayerId: "",
      linkedTeamName: "",
      clientName: "",
      phone: "",
      branch: activeBranchName,
      court: targetCourt,
      courtAllocation: alloc,
      date: targetDate,
      startTime: preset?.startTime || "18:00",
      endTime: preset?.endTime || "19:00",
      rateType: defaultRateType,
      playerCount: "1",
      useExistingSnapshot: false,
      snapshotUnitRate: snap.unitRate,
      snapshotExtraPlayerRate: snap.extraPlayerRate,
      bookingType: "walk_in",
      recurrenceSubMode: "weeks",
      recurringWeeks: "4",
      freePass: false,
      discountPercent: "0",
      discountFixedAmount: "0",
      collectPaymentNow: false,
      notes: "",
    });
    setBookingModalOpen(true);
  };

  // Support external "+ New Booking" trigger from Vescio Nexus Hub overview card
  const lastExternalTriggerRef = useRef<number>(externalNewBookingTrigger || 0);
  useEffect(() => {
    if (externalNewBookingTrigger && externalNewBookingTrigger !== lastExternalTriggerRef.current) {
      lastExternalTriggerRef.current = externalNewBookingTrigger;
      openNewBookingModal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalNewBookingTrigger]);

  const openEditBookingModal = (res: CourtReservation) => {
    if (isDateLocked(res.date)) {
      toast.error(
        `Booking on ${res.date} is locked because it is prior to today. Enable "Allow Previous Dates" to edit.`,
      );
      return;
    }
    const preservedRateType: CourtRateType =
      res.rateType ||
      (res.courtAllocation === "Full Court" ? "Full Court Rate" : "Half Court Rate");
    const preservedUnitRate =
      res.snapshotUnitRate !== undefined ? Number(res.snapshotUnitRate) : Number(res.hourlyRate);
    const preservedExtraRate =
      res.snapshotExtraPlayerRate !== undefined ? Number(res.snapshotExtraPlayerRate) : 0;

    setEditingReservation(res);
    setBookingForm({
      clientType: res.clientType || "External Client",
      linkedPlayerId: res.linkedPlayerId || "",
      linkedTeamName: res.linkedTeamName || "",
      clientName: res.clientName || "",
      phone: res.phone || "",
      branch: res.branch || activeBranchName,
      court: res.court || branchCourts[0]?.name || "Court 1",
      courtAllocation: res.courtAllocation || "Full Court",
      date: res.date,
      startTime: res.startTime,
      endTime: res.endTime,
      rateType: preservedRateType,
      playerCount: String(res.playerCount ?? 1),
      useExistingSnapshot: true,
      snapshotUnitRate: preservedUnitRate,
      snapshotExtraPlayerRate: preservedExtraRate,
      bookingType: res.bookingType || (res.isRecurring ? "recurring" : "walk_in"),
      recurrenceSubMode: res.recurrenceMode === "continuous" ? "continuous" : "weeks",
      recurringWeeks: String(res.recurringWeeks ?? 4),
      freePass: Boolean(res.freePass || res.paymentStatus === "Free Pass"),
      discountPercent: String(res.discountPercent ?? 0),
      discountFixedAmount: String(res.discountFixedAmount ?? 0),
      collectPaymentNow: res.paymentStatus === "Paid",
      notes: res.notes || "",
    });
    setBookingModalOpen(true);
  };

  const formBranchObj = useMemo(
    () =>
      branches.find((b) => (b.name || "").toLowerCase() === bookingForm.branch.toLowerCase()) ||
      activeBranchObj,
    [branches, bookingForm.branch, activeBranchObj],
  );

  const formBranchCourts = useMemo<Court[]>(() => {
    if (formBranchObj?.courts && formBranchObj.courts.length > 0) return formBranchObj.courts;
    return branchCourts;
  }, [formBranchObj, branchCourts]);

  // Pricing & Snapshot Calculation Preview
  const pricingPreview = useMemo(() => {
    const liveSnap = resolveDefaultRateSnapshotForType(
      bookingForm.rateType,
      bookingForm.branch,
      bookingForm.court,
    );

    const unitRate = bookingForm.useExistingSnapshot
      ? bookingForm.snapshotUnitRate
      : liveSnap.unitRate;
    const extraPlayerRate = bookingForm.useExistingSnapshot
      ? bookingForm.snapshotExtraPlayerRate
      : liveSnap.extraPlayerRate;

    return calculateCourtReservationPricing({
      startTime: bookingForm.startTime,
      endTime: bookingForm.endTime,
      rateType: bookingForm.rateType,
      unitRate,
      extraPlayerRate,
      playerCount: bookingForm.playerCount,
      freePass: bookingForm.freePass,
      discountPercent: bookingForm.discountPercent,
      discountFixedAmount: bookingForm.discountFixedAmount,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bookingForm.startTime,
    bookingForm.endTime,
    bookingForm.rateType,
    bookingForm.branch,
    bookingForm.court,
    bookingForm.playerCount,
    bookingForm.useExistingSnapshot,
    bookingForm.snapshotUnitRate,
    bookingForm.snapshotExtraPlayerRate,
    bookingForm.freePass,
    bookingForm.discountPercent,
    bookingForm.discountFixedAmount,
    branches,
    activeBranchObj,
  ]);

  const formOffDayBlocked = useMemo(() => {
    const bOffDays = formBranchObj?.offDays || [];
    return bOffDays.find((o) => o.date === bookingForm.date);
  }, [formBranchObj?.offDays, bookingForm.date]);

  const formConflictPreview = useMemo(() => {
    if (!pricingPreview.isTimeValid) {
      return {
        hasCourtConflict: false,
        courtConflictReason: undefined,
        simultaneousHalfCourtSession: undefined,
      };
    }
    return checkCourtScheduleConflict(
      {
        branch: bookingForm.branch,
        court: bookingForm.court,
        courtAllocation: bookingForm.courtAllocation,
        date: bookingForm.date,
        time: bookingForm.startTime,
        endTime: bookingForm.endTime,
        durationHours: pricingPreview.durationHours,
      },
      sessions,
      undefined,
      reservations,
      editingReservation?.id,
    );
  }, [
    bookingForm.branch,
    bookingForm.court,
    bookingForm.courtAllocation,
    bookingForm.date,
    bookingForm.startTime,
    bookingForm.endTime,
    pricingPreview.isTimeValid,
    pricingPreview.durationHours,
    sessions,
    reservations,
    editingReservation?.id,
  ]);

  const handleSaveBooking = async () => {
    if (!bookingForm.clientName.trim()) {
      toast.error("Please enter the Client or Entity Name.");
      return;
    }
    if (!pricingPreview.isTimeValid) {
      toast.error("End Time must be after Start Time.");
      return;
    }
    if (isDateLocked(bookingForm.date)) {
      toast.error(
        `Date ${bookingForm.date} is prior to today and locked. Tick "Allow Previous Dates" first.`,
      );
      return;
    }
    if (formOffDayBlocked) {
      toast.error(
        `Cannot book on ${bookingForm.date}: marked as Off Day (${formOffDayBlocked.reason}).`,
      );
      return;
    }
    if (formConflictPreview.hasCourtConflict) {
      toast.error(
        formConflictPreview.courtConflictReason ||
          "Court conflict detected for this time slot and allocation.",
      );
      return;
    }

    // Ensure branch exists so scoped bookings always match a branch
    await ensureBranchRecord();

    const nowIso = new Date().toISOString();
    const isEditing = Boolean(editingReservation);

    // Case A: Editing an existing single reservation or seed
    if (isEditing && editingReservation) {
      const preservedPaid = bookingForm.freePass
        ? 0
        : Math.min(pricingPreview.finalPayable, Number(editingReservation.paidAmount) || 0);
      const nextPayStatus: CourtReservation["paymentStatus"] = bookingForm.freePass
        ? "Free Pass"
        : editingReservation.paymentStatus === "Charged to Account"
          ? "Charged to Account"
          : preservedPaid >= pricingPreview.finalPayable && pricingPreview.finalPayable > 0
            ? "Paid"
            : preservedPaid > 0
              ? "Partial"
              : "Pending";

      const updated: CourtReservation = {
        ...editingReservation,
        clientName: bookingForm.clientName.trim(),
        clientType: bookingForm.clientType,
        ...(bookingForm.linkedPlayerId ? { linkedPlayerId: bookingForm.linkedPlayerId } : {}),
        ...(bookingForm.linkedTeamName ? { linkedTeamName: bookingForm.linkedTeamName } : {}),
        phone: bookingForm.phone.trim(),
        branch: bookingForm.branch,
        court: bookingForm.court,
        courtAllocation: bookingForm.courtAllocation,
        date: bookingForm.date,
        startTime: bookingForm.startTime,
        endTime: bookingForm.endTime,
        durationHours: pricingPreview.durationHours,
        rateType: bookingForm.rateType,
        snapshotUnitRate: pricingPreview.unitRate,
        snapshotExtraPlayerRate: pricingPreview.extraPlayerRate,
        playerCount: pricingPreview.playerCount,
        baseCalculatedAmount: pricingPreview.baseCalculatedAmount,
        freePass: bookingForm.freePass,
        discountPercent: pricingPreview.discountPercent,
        discountFixedAmount: pricingPreview.discountFixedAmount,
        hourlyRate: pricingPreview.effectiveHourly,
        totalAmount: pricingPreview.finalPayable,
        paidAmount: preservedPaid,
        paymentStatus: nextPayStatus,
        ...(bookingForm.notes.trim() ? { notes: bookingForm.notes.trim() } : {}),
        updatedAt: nowIso,
      };
      try {
        await atomicBookCourtReservationTransaction({
          tenantId,
          ...(formBranchObj?.id
            ? { branchId: formBranchObj.id, fallbackBranch: formBranchObj }
            : {}),
          reservationsToSave: [updated],
          previousReservation: editingReservation,
          localReservations: reservations,
          localSessions: sessions,
        });
        await setEntity("courtReservations", updated);
        setBookingModalOpen(false);
        toast.success(`Updated booking for ${updated.clientName}.`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to save booking due to conflict.";
        toast.error(msg);
      }
      return;
    }

    // Case B: New Continuous Recurring Booking
    if (bookingForm.bookingType === "recurring" && bookingForm.recurrenceSubMode === "continuous") {
      // Check next 8 weeks for immediate conflicts so we warn cleanly before creating continuous seed
      for (let w = 0; w < 8; w++) {
        const checkDate = addDaysIso(bookingForm.date, w * 7);
        const isOff = (formBranchObj?.offDays || []).some((o) => o.date === checkDate);
        if (isOff) continue; // Off days are automatically skipped by continuous projection
        const conflict = checkCourtScheduleConflict(
          {
            branch: bookingForm.branch,
            court: bookingForm.court,
            courtAllocation: bookingForm.courtAllocation,
            date: checkDate,
            time: bookingForm.startTime,
            endTime: bookingForm.endTime,
            durationHours: pricingPreview.durationHours,
          },
          sessions,
          undefined,
          reservations,
        );
        if (conflict.hasCourtConflict) {
          toast.error(
            `Conflict on upcoming week ${w + 1} (${checkDate}): ${conflict.courtConflictReason}`,
          );
          return;
        }
      }

      const groupId = uid("rec-cont");
      const seedRecord: CourtReservation = {
        id: uid("res"),
        clientName: bookingForm.clientName.trim(),
        clientType: bookingForm.clientType,
        ...(bookingForm.linkedPlayerId ? { linkedPlayerId: bookingForm.linkedPlayerId } : {}),
        ...(bookingForm.linkedTeamName ? { linkedTeamName: bookingForm.linkedTeamName } : {}),
        phone: bookingForm.phone.trim(),
        branch: bookingForm.branch,
        court: bookingForm.court,
        courtAllocation: bookingForm.courtAllocation,
        date: bookingForm.date,
        startTime: bookingForm.startTime,
        endTime: bookingForm.endTime,
        durationHours: pricingPreview.durationHours,
        rateType: bookingForm.rateType,
        snapshotUnitRate: pricingPreview.unitRate,
        snapshotExtraPlayerRate: pricingPreview.extraPlayerRate,
        playerCount: pricingPreview.playerCount,
        baseCalculatedAmount: pricingPreview.baseCalculatedAmount,
        freePass: bookingForm.freePass,
        discountPercent: pricingPreview.discountPercent,
        discountFixedAmount: pricingPreview.discountFixedAmount,
        hourlyRate: pricingPreview.effectiveHourly,
        totalAmount: pricingPreview.finalPayable,
        paidAmount: 0,
        paymentStatus: bookingForm.freePass ? "Free Pass" : "Pending",
        bookingType: "recurring",
        recurrenceMode: "continuous",
        isRecurring: true,
        recurringGroupId: groupId,
        seriesStartDate: bookingForm.date,
        continuousActive: true,
        skippedDates: [],
        status: "Confirmed",
        ...(bookingForm.notes.trim() ? { notes: bookingForm.notes.trim() } : {}),
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      try {
        await atomicBookCourtReservationTransaction({
          tenantId,
          ...(formBranchObj?.id
            ? { branchId: formBranchObj.id, fallbackBranch: formBranchObj }
            : {}),
          reservationsToSave: [seedRecord],
          localReservations: reservations,
          localSessions: sessions,
        });
        await setEntity("courtReservations", seedRecord);
        setBookingModalOpen(false);
        toast.success(
          `Activated Continuous weekly booking for ${seedRecord.clientName} (${seedRecord.court} · ${seedRecord.courtAllocation}).`,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to save continuous booking.";
        toast.error(msg);
      }
      return;
    }

    // Case C: Walk-in (1-Time) OR Fixed / Recurring (Specific Weeks)
    const weeksCount =
      bookingForm.bookingType === "recurring"
        ? Math.max(2, Math.min(52, Math.floor(Number(bookingForm.recurringWeeks) || 4)))
        : 1;

    const branchClosures = new Set((formBranchObj?.offDays || []).map((o) => o.date));
    const datesToCreate: string[] = [];
    let skippedOffDaysCount = 0;

    for (let w = 0; w < weeksCount; w++) {
      const slotDate = addDaysIso(bookingForm.date, w * 7);
      if (branchClosures.has(slotDate)) {
        skippedOffDaysCount += 1;
        continue;
      }
      const conflict = checkCourtScheduleConflict(
        {
          branch: bookingForm.branch,
          court: bookingForm.court,
          courtAllocation: bookingForm.courtAllocation,
          date: slotDate,
          time: bookingForm.startTime,
          endTime: bookingForm.endTime,
          durationHours: pricingPreview.durationHours,
        },
        sessions,
        undefined,
        reservations,
      );
      if (conflict.hasCourtConflict) {
        toast.error(`Conflict on week ${w + 1} (${slotDate}): ${conflict.courtConflictReason}`);
        return;
      }
      datesToCreate.push(slotDate);
    }

    if (datesToCreate.length === 0) {
      toast.error("All selected dates fall on branch Off Days.");
      return;
    }

    const shouldCashInUpfront =
      bookingForm.collectPaymentNow && !bookingForm.freePass && pricingPreview.finalPayable > 0;
    const staffName = currentUser?.name || "Facility Staff";
    const groupId = weeksCount > 1 ? uid("rec-wks") : undefined;
    const recordsToCreate: CourtReservation[] = datesToCreate.map((slotDate) => ({
      id: uid("res"),
      clientName: bookingForm.clientName.trim(),
      clientType: bookingForm.clientType,
      ...(bookingForm.linkedPlayerId ? { linkedPlayerId: bookingForm.linkedPlayerId } : {}),
      ...(bookingForm.linkedTeamName ? { linkedTeamName: bookingForm.linkedTeamName } : {}),
      phone: bookingForm.phone.trim(),
      branch: bookingForm.branch,
      court: bookingForm.court,
      courtAllocation: bookingForm.courtAllocation,
      date: slotDate,
      startTime: bookingForm.startTime,
      endTime: bookingForm.endTime,
      durationHours: pricingPreview.durationHours,
      rateType: bookingForm.rateType,
      snapshotUnitRate: pricingPreview.unitRate,
      snapshotExtraPlayerRate: pricingPreview.extraPlayerRate,
      playerCount: pricingPreview.playerCount,
      baseCalculatedAmount: pricingPreview.baseCalculatedAmount,
      freePass: bookingForm.freePass,
      discountPercent: pricingPreview.discountPercent,
      discountFixedAmount: pricingPreview.discountFixedAmount,
      hourlyRate: pricingPreview.effectiveHourly,
      totalAmount: pricingPreview.finalPayable,
      paidAmount: shouldCashInUpfront ? pricingPreview.finalPayable : 0,
      paymentStatus: bookingForm.freePass ? "Free Pass" : shouldCashInUpfront ? "Paid" : "Pending",
      ...(shouldCashInUpfront
        ? { paymentMethod: "Cash" as const, cashedInAt: nowIso, cashedInBy: staffName }
        : {}),
      bookingType: weeksCount > 1 ? "recurring" : "walk_in",
      recurrenceMode: weeksCount > 1 ? "weeks" : "single",
      isRecurring: weeksCount > 1,
      ...(weeksCount > 1 ? { recurringWeeks: weeksCount } : {}),
      ...(groupId ? { recurringGroupId: groupId } : {}),
      ...(weeksCount > 1 ? { seriesStartDate: bookingForm.date } : {}),
      status: "Confirmed",
      ...(bookingForm.notes.trim() ? { notes: bookingForm.notes.trim() } : {}),
      createdAt: nowIso,
      updatedAt: nowIso,
    }));

    try {
      await atomicBookCourtReservationTransaction({
        tenantId,
        ...(formBranchObj?.id ? { branchId: formBranchObj.id, fallbackBranch: formBranchObj } : {}),
        reservationsToSave: recordsToCreate,
        localReservations: reservations,
        localSessions: sessions,
      });
      for (const record of recordsToCreate) {
        if (shouldCashInUpfront && record.paidAmount > 0) {
          const ledId = uid("led-res");
          const upfrontEntry = normalizeDoubleEntryLedger({
            id: ledId,
            date: today,
            account: "Court Rental Income (Vescio Nexus)",
            category: "Facility Reservation",
            module: "courts",
            entry: `Court Cash-In · ${record.clientName} (${record.court} · ${record.courtAllocation})`,
            description: `Session ${record.date} ${record.startTime}-${record.endTime} · ${record.rateType || "Court Rental"} · Cash`,
            type: "Revenue",
            amount: record.paidAmount,
            status: "Collected",
            paymentMethod: "Cash",
            branch: record.branch,
            referenceId: record.id,
          });
          await setEntity("ledger", upfrontEntry);
          record.ledgerEntryId = ledId;
        }
        await setEntity("courtReservations", record);
      }

      setBookingModalOpen(false);
      toast.success(
        weeksCount > 1
          ? `Booked ${datesToCreate.length} weekly session(s) for ${bookingForm.clientName}${
              skippedOffDaysCount > 0 ? ` (${skippedOffDaysCount} Off Day skipped)` : ""
            }.`
          : `Confirmed court booking for ${bookingForm.clientName} (${bookingForm.court} · ${bookingForm.courtAllocation}).`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save court booking.";
      toast.error(msg);
    }
  };

  // =========================================================================
  // 4. UNIFIED SCHEDULE PROJECTION (INCL. CONTINUOUS SERIES + ACADEMY)
  // =========================================================================
  const buildScheduleForDate = (targetDate: string): CalendarDisplayItem[] => {
    const items: CalendarDisplayItem[] = [];
    const targetWeekday = getIsoWeekdayIndexMon0(targetDate);
    const isTargetOffDay = offDayMap.has(targetDate);

    // Safely resolve a booking's court name to an existing branch court so historical/renamed/removed court bookings always render cleanly
    const resolveDisplayCourtName = (rawCourt?: string): string => {
      const fallback = branchCourts[0]?.name || "Court 1";
      if (!rawCourt || !rawCourt.trim()) return fallback;
      const matched = branchCourts.find(
        (c) => c.name.trim().toLowerCase() === rawCourt.trim().toLowerCase(),
      );
      return matched ? matched.name : fallback;
    };

    // 1. Concrete Vescio Nexus CourtReservations on targetDate for activeBranchName
    const concreteForDate = reservations.filter(
      (r) =>
        r.date === targetDate &&
        r.status !== "Cancelled" &&
        (r.branch || "").toLowerCase() === activeBranchName.toLowerCase(),
    );

    const materializedGroupKeys = new Set<string>();
    for (const r of concreteForDate) {
      if (r.recurringGroupId) {
        materializedGroupKeys.add(`${r.recurringGroupId}::${targetDate}`);
      }
      const recLabel =
        r.recurrenceMode === "continuous"
          ? r.continuousActive !== false
            ? "Continuous Weekly"
            : "Continuous (Stopped)"
          : r.isRecurring
            ? `${r.recurringWeeks || "Fixed"} Wks`
            : undefined;

      const resolvedCourt = resolveDisplayCourtName(r.court);
      items.push({
        key: `nexus-${r.id}`,
        source: "nexus",
        id: r.id,
        reservation: r,
        title: r.clientName,
        subtitle: `${r.rateType || "Court Rental"}${r.phone ? ` · ${r.phone}` : ""}`,
        branch: r.branch,
        court: resolvedCourt,
        allocation: r.courtAllocation,
        date: r.date,
        startTime: r.startTime,
        endTime: r.endTime,
        durationHours: r.durationHours,
        totalAmount: Number(r.totalAmount) || 0,
        paidAmount: Number(r.paidAmount) || 0,
        paymentStatus: r.paymentStatus,
        status: r.status,
        rateType: r.rateType,
        isRecurring: r.isRecurring,
        recurrenceLabel: recLabel,
      });
    }

    // 2. Projected occurrences of active Continuous recurring reservations
    if (!isTargetOffDay) {
      const continuousSeeds = reservations.filter(
        (r) =>
          r.status !== "Cancelled" &&
          r.recurrenceMode === "continuous" &&
          (r.branch || "").toLowerCase() === activeBranchName.toLowerCase(),
      );

      for (const seed of continuousSeeds) {
        const seedStart = seed.seriesStartDate || seed.date;
        if (targetDate <= seedStart) continue;
        if (seed.continuousActive === false && !seed.continuousStoppedAfterDate) continue;
        if (seed.continuousStoppedAfterDate && targetDate > seed.continuousStoppedAfterDate) {
          continue;
        }
        if (seed.skippedDates?.includes(targetDate)) continue;
        if (getIsoWeekdayIndexMon0(seedStart) !== targetWeekday) continue;

        const grpId = seed.recurringGroupId || seed.id;
        if (materializedGroupKeys.has(`${grpId}::${targetDate}`)) continue;

        const resolvedSeedCourt = resolveDisplayCourtName(seed.court);
        items.push({
          key: `nexus-proj-${seed.id}-${targetDate}`,
          source: "nexus",
          id: `${seed.id}__${targetDate}`,
          isProjectedContinuous: true,
          seedReservation: seed,
          title: seed.clientName,
          subtitle: `${seed.rateType || "Court Rental"} · Continuous`,
          branch: seed.branch,
          court: resolvedSeedCourt,
          allocation: seed.courtAllocation,
          date: targetDate,
          startTime: seed.startTime,
          endTime: seed.endTime,
          durationHours: seed.durationHours,
          totalAmount: Number(seed.totalAmount) || 0,
          paidAmount: 0,
          paymentStatus: seed.freePass ? "Free Pass" : "Pending",
          status: "Confirmed",
          rateType: seed.rateType,
          isRecurring: true,
          recurrenceLabel: "Continuous Weekly",
        });
      }
    }

    // 3. Synced Academy Sessions on targetDate for activeBranchName
    const academyForDate = sessions.filter(
      (s) =>
        s.date === targetDate &&
        s.status !== "Cancelled" &&
        (s.branch || "").toLowerCase() === activeBranchName.toLowerCase(),
    );

    for (const s of academyForDate) {
      const dur = s.durationHours ?? calculateSessionDurationHours(s.time, s.endTime);
      const endT =
        s.endTime || minutesToTime(timeToMinutes(s.time) + Math.round((dur || 1.5) * 60));
      items.push({
        key: `acad-${s.id}`,
        source: "academy",
        id: s.id,
        title: s.title,
        subtitle: `Academy · ${s.team || s.teamA || s.kind}`,
        branch: s.branch,
        court: resolveDisplayCourtName(s.court),
        allocation: (s.courtAllocation || "Full Court") as CourtAllocationType,
        date: s.date,
        startTime: s.time,
        endTime: endT,
        durationHours: dur,
        totalAmount: Number(s.courtRentalCost) || 0,
        paidAmount: Number(s.courtRentalCost) || 0,
        paymentStatus: "Academy",
        status: s.status,
      });
    }

    return items.sort((a, b) => a.startTime.localeCompare(b.startTime));
  };

  // =========================================================================
  // 5. DRAG-TO-BOOK ENGINE (HCA = Col 1, HCB = Col 2, BOTH = Full Court)
  // =========================================================================
  const [dragState, setDragState] = useState<DragSelectionState | null>(null);
  const dragRef = useRef<DragSelectionState | null>(null);
  dragRef.current = dragState;

  const getDragAllocation = (d: DragSelectionState): CourtAllocationType => {
    if (d.anchorCol !== d.hoverCol) return "Full Court";
    return d.anchorCol === "HCA" ? "Half Court - HCA" : "Half Court - HCB";
  };

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      const activeDrag = dragRef.current;
      if (!activeDrag) return;
      setDragState(null);

      const minIdx = Math.min(activeDrag.startSlotIdx, activeDrag.currentSlotIdx);
      const maxIdx = Math.max(activeDrag.startSlotIdx, activeDrag.currentSlotIdx);
      const startSlot = slots15[minIdx];
      const endSlotStart = slots15[maxIdx];
      if (!startSlot || !endSlotStart) return;

      const endSlot = minutesToTime(timeToMinutes(endSlotStart) + 15);
      const allocation = getDragAllocation(activeDrag);

      openNewBookingModal({
        court: activeDrag.courtName,
        courtAllocation: allocation,
        date: activeDrag.date,
        startTime: startSlot,
        endTime: endSlot,
      });
    };

    window.addEventListener("mouseup", handleGlobalMouseUp);
    return () => {
      window.removeEventListener("mouseup", handleGlobalMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slots15, activeBranchName, allowPreviousDates, focusDate, offDayMap]);

  const handleCellMouseDown = (
    e: React.MouseEvent,
    courtName: string,
    date: string,
    col: "HCA" | "HCB",
    slotIdx: number,
  ) => {
    if (e.button !== 0) return;
    if (isDateLocked(date)) {
      toast.error(
        `Date ${date} is locked. Tick "Allow Previous Dates" in the toolbar to book past dates.`,
      );
      return;
    }
    const offDay = getOffDay(date);
    if (offDay) {
      toast.error(`${date} is marked as an Off Day (${offDay.reason}).`);
      return;
    }
    e.preventDefault();
    setDragState({
      courtName,
      date,
      anchorCol: col,
      hoverCol: col,
      startSlotIdx: slotIdx,
      currentSlotIdx: slotIdx,
    });
  };

  const handleCellMouseEnter = (
    courtName: string,
    date: string,
    col: "HCA" | "HCB",
    slotIdx: number,
  ) => {
    setDragState((prev) => {
      if (!prev) return null;
      if (prev.courtName !== courtName || prev.date !== date) return prev;
      return {
        ...prev,
        hoverCol: col,
        currentSlotIdx: slotIdx,
      };
    });
  };

  // =========================================================================
  // 6. SESSION COMPLETION & CASH-IN MODAL STATE
  // =========================================================================
  const [selectedSessionItem, setSelectedSessionItem] = useState<CalendarDisplayItem | null>(null);
  const [cashInPayableAmount, setCashInPayableAmount] = useState<string>("0");
  const [cashInPaymentMethod, setCashInPaymentMethod] =
    useState<NonNullable<CourtReservation["paymentMethod"]>>("Cash");
  const [cashInNotes, setCashInNotes] = useState<string>("");

  const openSessionDetailsModal = (item: CalendarDisplayItem) => {
    if (item.source === "academy") {
      toast.info(
        `Academy Session "${item.title}" (${item.startTime}–${item.endTime}) is managed in Academy Sessions.`,
      );
      return;
    }
    const res = item.reservation || item.seedReservation;
    const total = Number(item.totalAmount) || 0;
    const paid = item.isProjectedContinuous ? 0 : Number(item.paidAmount) || 0;
    const remaining = Math.max(0, roundCurrency(total - paid));

    setSelectedSessionItem(item);
    setCashInPayableAmount(String(remaining > 0 ? remaining : total));
    setCashInPaymentMethod(res?.paymentMethod || "Cash");
    setCashInNotes(res?.notes || "");
  };

  const materializeProjectedOccurrence = async (
    item: CalendarDisplayItem,
  ): Promise<CourtReservation | null> => {
    if (!item.isProjectedContinuous && item.reservation) {
      return item.reservation;
    }
    const seed = item.seedReservation;
    if (!seed) return null;

    const nowIso = new Date().toISOString();
    const materialized: CourtReservation = {
      ...seed,
      id: uid("res"),
      date: item.date,
      recurrenceMode: "single_materialized",
      recurringGroupId: seed.recurringGroupId || seed.id,
      paidAmount: 0,
      paymentStatus: seed.freePass ? "Free Pass" : "Pending",
      status: "Confirmed",
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await setEntity("courtReservations", materialized);
    return materialized;
  };

  const handleCompleteAndCashIn = async () => {
    if (!selectedSessionItem) return;
    try {
      const concrete = await materializeProjectedOccurrence(selectedSessionItem);
      if (!concrete) return;

      const {
        confirmedCollectAmount,
        newTotalPaid,
        updatedFinalTotal,
        paymentStatus: finalPaymentStatus,
      } = calculateCourtCashInMath({
        totalAmount: Number(concrete.totalAmount) || 0,
        alreadyPaidAmount: Number(concrete.paidAmount) || 0,
        collectAmountInput: cashInPayableAmount,
        freePass: concrete.freePass,
        paymentMethod: cashInPaymentMethod,
        hasLinkedPlayer: Boolean(concrete.linkedPlayerId),
      });

      const nowIso = new Date().toISOString();
      const staffName = currentUser?.name || "Facility Staff";

      let ledgerId = concrete.ledgerEntryId;

      if (confirmedCollectAmount > 0) {
        if (cashInPaymentMethod === "Account Charge" && concrete.linkedPlayerId) {
          const linkedPlayer = players.find((p) => p.id === concrete.linkedPlayerId);
          if (linkedPlayer) {
            await patchEntity("players", linkedPlayer.id, {
              balance: roundCurrency((Number(linkedPlayer.balance) || 0) + confirmedCollectAmount),
            });
          }
        } else {
          ledgerId = uid("led-res");
          const ledgerEntry = normalizeDoubleEntryLedger({
            id: ledgerId,
            date: today,
            account: "Court Rental Income (Vescio Nexus)",
            category: "Facility Reservation",
            module: "courts",
            entry: `Court Cash-In · ${concrete.clientName} (${concrete.court} · ${concrete.courtAllocation})`,
            description: `Session ${concrete.date} ${concrete.startTime}-${concrete.endTime} · ${concrete.rateType || "Court Rental"} · ${cashInPaymentMethod}`,
            type: "Revenue",
            amount: confirmedCollectAmount,
            status: "Collected",
            paymentMethod: cashInPaymentMethod,
            branch: concrete.branch,
            referenceId: concrete.id,
          });
          await setEntity("ledger", ledgerEntry);
        }
      }

      const updatedReservation: CourtReservation = {
        ...concrete,
        totalAmount: updatedFinalTotal,
        paidAmount: concrete.freePass ? 0 : newTotalPaid,
        paymentStatus: finalPaymentStatus,
        paymentMethod: cashInPaymentMethod,
        status: "Completed",
        cashedInAt: nowIso,
        cashedInBy: staffName,
        ...(ledgerId ? { ledgerEntryId: ledgerId } : {}),
        ...(cashInNotes.trim() ? { notes: cashInNotes.trim() } : {}),
        updatedAt: nowIso,
      };

      await setEntity("courtReservations", updatedReservation);
      setSelectedSessionItem(null);

      toast.success(
        concrete.freePass
          ? `Completed Free Pass session for ${concrete.clientName}.`
          : cashInPaymentMethod === "Account Charge" && concrete.linkedPlayerId
            ? `Completed session & charged ${money(confirmedCollectAmount)} to ${concrete.clientName}'s account.`
            : `Completed & Cashed In ${money(confirmedCollectAmount)} (${cashInPaymentMethod}) to the Financial Ledger!`,
      );
    } catch {
      /* Error toast handled by data-store */
    }
  };

  const handleStopContinuousSeries = async (item: CalendarDisplayItem) => {
    const targetSeed =
      item.seedReservation ||
      (item.reservation?.recurrenceMode === "continuous"
        ? item.reservation
        : reservations.find(
            (r) =>
              r.recurrenceMode === "continuous" &&
              r.recurringGroupId &&
              r.recurringGroupId === item.reservation?.recurringGroupId,
          ));

    if (!targetSeed) return;

    try {
      await patchEntity("courtReservations", targetSeed.id, {
        continuousActive: false,
        continuousStoppedAfterDate: item.date,
        updatedAt: new Date().toISOString(),
      });
      setSelectedSessionItem(null);
      toast.success(
        `Stopped continuous weekly recurrence for ${targetSeed.clientName} after ${item.date}.`,
      );
    } catch {
      /* Error toast handled by data-store */
    }
  };

  const handleCancelSingleSession = async (item: CalendarDisplayItem) => {
    try {
      if (item.isProjectedContinuous && item.seedReservation) {
        const nextSkipped = Array.from(
          new Set([...(item.seedReservation.skippedDates || []), item.date]),
        );
        await patchEntity("courtReservations", item.seedReservation.id, {
          skippedDates: nextSkipped,
          updatedAt: new Date().toISOString(),
        });
        setSelectedSessionItem(null);
        toast.success(`Cancelled ${item.date} occurrence for ${item.title}.`);
        return;
      }
      if (item.reservation) {
        const prevPaid = Number(item.reservation.paidAmount) || 0;
        const wasCashedIn =
          prevPaid > 0 &&
          (item.reservation.paymentStatus === "Paid" ||
            item.reservation.paymentStatus === "Partial" ||
            item.reservation.status === "Completed");

        const cancelledRes: CourtReservation = {
          ...item.reservation,
          status: "Cancelled",
          updatedAt: new Date().toISOString(),
        };
        await atomicBookCourtReservationTransaction({
          tenantId,
          reservationsToSave: [cancelledRes],
          previousReservation: item.reservation,
          localReservations: reservations,
          localSessions: sessions,
        }).catch(() => {});
        await patchEntity("courtReservations", item.reservation.id, {
          status: "Cancelled",
          updatedAt: cancelledRes.updatedAt,
        });

        if (wasCashedIn) {
          const reversalEntry = normalizeDoubleEntryLedger({
            id: uid("led-rev"),
            date: today,
            account: "Court Rental Refund / Reversal",
            category: "Facility Reservation",
            module: "courts",
            entry: `Court Rental Refund / Reversal · ${item.reservation.clientName} (${item.reservation.court} · ${item.reservation.courtAllocation})`,
            description: `Cancelled cashed-in session ${item.reservation.date} ${item.reservation.startTime}-${item.reservation.endTime}`,
            type: "Expense",
            amount: prevPaid,
            status: "Paid",
            paymentMethod: item.reservation.paymentMethod || "Cash",
            branch: item.reservation.branch,
            referenceId: item.reservation.id,
          });
          await setEntity("ledger", reversalEntry);
        }

        setSelectedSessionItem(null);
        toast.success(
          wasCashedIn
            ? `Cancelled booking & posted ${money(prevPaid)} refund reversal to the Financial Ledger.`
            : `Cancelled booking for ${item.title} on ${item.date}.`,
        );
      }
    } catch {
      /* Error toast handled by data-store */
    }
  };

  // =========================================================================
  // 7. CALENDAR NAVIGATION & MEMOIZED DATASETS
  // =========================================================================
  const navigateCalendar = (dir: -1 | 1) => {
    if (viewMode === "daily") {
      setFocusDate(addDaysIso(focusDate, dir));
    } else if (viewMode === "weekly") {
      setFocusDate(addDaysIso(focusDate, dir * 7));
    } else {
      const { y, m } = parseIsoParts(focusDate);
      const nextMonth = new Date(Date.UTC(y, m - 1 + dir, 1));
      setFocusDate(nextMonth.toISOString().slice(0, 10));
    }
  };

  const weekMonday = useMemo(() => getMondayOfWeekIso(focusDate), [focusDate]);
  const weekDates = useMemo(
    () => Array.from({ length: 7 }, (_, idx) => addDaysIso(weekMonday, idx)),
    [weekMonday],
  );

  const monthCells = useMemo(() => {
    const { y, m } = parseIsoParts(focusDate);
    const firstOfMonth = `${y}-${String(m).padStart(2, "0")}-01`;
    const leadOffset = getIsoWeekdayIndexMon0(firstOfMonth);
    const gridStart = addDaysIso(firstOfMonth, -leadOffset);
    return Array.from({ length: 42 }, (_, idx) => {
      const iso = addDaysIso(gridStart, idx);
      const parts = parseIsoParts(iso);
      return {
        iso,
        dayNum: parts.d,
        inCurrentMonth: parts.m === m,
      };
    });
  }, [focusDate]);

  const dailySchedule = useMemo(
    () => buildScheduleForDate(focusDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [focusDate, reservations, sessions, activeBranchName, offDayMap],
  );

  const weeklySchedulesByDate = useMemo(() => {
    const map = new Map<string, CalendarDisplayItem[]>();
    for (const d of weekDates) {
      map.set(
        d,
        buildScheduleForDate(d).filter(
          (it) => (it.court || "").toLowerCase() === weeklyCourtName.toLowerCase(),
        ),
      );
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekDates, reservations, sessions, activeBranchName, weeklyCourtName, offDayMap]);

  const monthlySchedulesByDate = useMemo(() => {
    const map = new Map<string, CalendarDisplayItem[]>();
    for (const cell of monthCells) {
      map.set(cell.iso, buildScheduleForDate(cell.iso));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthCells, reservations, sessions, activeBranchName, offDayMap]);

  // Scoped reservations directory
  const scopedDirectoryReservations = useMemo(() => {
    const q = directorySearch.trim().toLowerCase();
    return reservations
      .filter((r) => {
        const branchMatches =
          branchFilter === "All"
            ? (r.branch || "").toLowerCase() === activeBranchName.toLowerCase()
            : (r.branch || "").toLowerCase() === branchFilter.toLowerCase();
        if (!branchMatches) return false;
        if (!q) return true;
        return (
          r.clientName.toLowerCase().includes(q) ||
          (r.phone || "").toLowerCase().includes(q) ||
          r.court.toLowerCase().includes(q) ||
          r.courtAllocation.toLowerCase().includes(q) ||
          (r.rateType || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => `${b.date}T${b.startTime}`.localeCompare(`${a.date}T${a.startTime}`));
  }, [reservations, branchFilter, activeBranchName, directorySearch]);

  // Branch KPI strip
  const branchCourtMetrics = useMemo(() => {
    const activeBranchRes = reservations.filter(
      (r) =>
        r.status !== "Cancelled" &&
        (r.branch || "").toLowerCase() === activeBranchName.toLowerCase(),
    );
    const cashedInTotal = activeBranchRes.reduce((sum, r) => sum + (Number(r.paidAmount) || 0), 0);
    const pendingCashIn = activeBranchRes.reduce(
      (sum, r) => sum + Math.max(0, (Number(r.totalAmount) || 0) - (Number(r.paidAmount) || 0)),
      0,
    );
    const continuousCount = activeBranchRes.filter(
      (r) => r.recurrenceMode === "continuous" && r.continuousActive !== false,
    ).length;
    return {
      totalBookings: activeBranchRes.length,
      cashedInTotal: roundCurrency(cashedInTotal),
      pendingCashIn: roundCurrency(pendingCashIn),
      continuousCount,
    };
  }, [reservations, activeBranchName]);

  // =========================================================================
  // RENDER HELPERS FOR 15-MINUTE TWO-COLUMN (HCA | HCB) COURT TRACK
  // =========================================================================
  const ROW_HEIGHT_PX = 28; // 15-min row height -> 1 hour = 112px

  const renderCourtTwoColumnTrack = (
    courtName: string,
    date: string,
    itemsForCourtAndDate: CalendarDisplayItem[],
  ) => {
    const locked = isDateLocked(date);
    const offDay = getOffDay(date);
    const totalTrackHeight = slots15.length * ROW_HEIGHT_PX;

    const isDraggingThisTrack =
      dragState && dragState.courtName === courtName && dragState.date === date;
    const dragMinIdx = isDraggingThisTrack
      ? Math.min(dragState.startSlotIdx, dragState.currentSlotIdx)
      : -1;
    const dragMaxIdx = isDraggingThisTrack
      ? Math.max(dragState.startSlotIdx, dragState.currentSlotIdx)
      : -1;
    const dragAlloc = isDraggingThisTrack ? getDragAllocation(dragState) : null;

    return (
      <div
        key={`${courtName}-${date}`}
        className={`relative select-none border-r border-ink-800 last:border-r-0 ${
          offDay ? "bg-ink-950/95 opacity-60" : locked ? "bg-ink-950/75" : "bg-ink-900/30"
        }`}
        style={{ height: `${totalTrackHeight}px` }}
      >
        {/* Underlying 2-Column (HCA | HCB) Interactive 15-Minute Cells */}
        <div className="grid grid-cols-2 h-full">
          {(["HCA", "HCB"] as const).map((colKey) => (
            <div key={colKey} className={colKey === "HCA" ? "border-r border-ink-800/60" : ""}>
              {slots15.map((slotTime, slotIdx) => {
                const isHourBoundary = slotTime.endsWith(":00");
                const isHalfHourBoundary = slotTime.endsWith(":30");
                const isHighlighted =
                  isDraggingThisTrack &&
                  slotIdx >= dragMinIdx &&
                  slotIdx <= dragMaxIdx &&
                  (dragAlloc === "Full Court" ||
                    (dragAlloc === "Half Court - HCA" && colKey === "HCA") ||
                    (dragAlloc === "Half Court - HCB" && colKey === "HCB"));

                return (
                  <div
                    key={`${colKey}-${slotTime}`}
                    onMouseDown={(e) => handleCellMouseDown(e, courtName, date, colKey, slotIdx)}
                    onMouseEnter={() => handleCellMouseEnter(courtName, date, colKey, slotIdx)}
                    title={
                      offDay
                        ? `Off Day: ${offDay.reason}`
                        : locked
                          ? `Locked past date (${date}) — Enable "Allow Previous Dates" to book`
                          : `Drag to book ${courtName} · ${colKey} (${slotTime})`
                    }
                    style={{ height: `${ROW_HEIGHT_PX}px` }}
                    className={`border-b transition-colors ${
                      isHourBoundary
                        ? "border-ink-800/90"
                        : isHalfHourBoundary
                          ? "border-ink-800/50"
                          : "border-ink-800/25"
                    } ${
                      offDay || locked
                        ? "cursor-not-allowed"
                        : isHighlighted
                          ? "bg-court-500/30 cursor-ns-resize"
                          : "cursor-crosshair hover:bg-court-500/10"
                    }`}
                  />
                );
              })}
            </div>
          ))}
        </div>

        {/* Off Day Greyed-Out Overlay Banner */}
        {offDay && (
          <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center bg-ink-950/75 p-3 text-center">
            <div className="rounded-md border border-ink-700 bg-ink-900/95 px-3 py-2">
              <div className="font-mono text-[10px] font-semibold uppercase tracking-wider text-ink-300">
                Facility Closed · Off Day
              </div>
              <div className="mt-0.5 text-xs text-ink-400">{offDay.reason}</div>
            </div>
          </div>
        )}

        {/* Active Drag Selection Preview Floating Indicator */}
        {isDraggingThisTrack && dragAlloc && (
          <div
            style={{
              top: `${dragMinIdx * ROW_HEIGHT_PX + 2}px`,
              height: `${Math.max(ROW_HEIGHT_PX - 4, (dragMaxIdx - dragMinIdx + 1) * ROW_HEIGHT_PX - 4)}px`,
              left: dragAlloc === "Half Court - HCB" ? "calc(50% + 2px)" : "2px",
              width: dragAlloc === "Full Court" ? "calc(100% - 4px)" : "calc(50% - 4px)",
            }}
            className="pointer-events-none absolute z-30 rounded-md border border-court-400 bg-court-500/25 px-2 py-1 shadow-sm"
          >
            <div className="truncate font-mono text-[10px] font-bold text-court-300 tabular-nums">
              {dragAlloc === "Full Court"
                ? "Full Court (HCA + HCB)"
                : dragAlloc === "Half Court - HCA"
                  ? "HCA"
                  : "HCB"}{" "}
              · {slots15[dragMinIdx]}–
              {minutesToTime(timeToMinutes(slots15[dragMaxIdx] || "18:00") + 15)}
            </div>
          </div>
        )}

        {/* Scheduled Bookings & Academy Sessions Positioned on 15-Min Grid */}
        {itemsForCourtAndDate.map((item) => {
          const itemStartMin = timeToMinutes(item.startTime);
          const itemEndMin = Math.max(itemStartMin + 15, timeToMinutes(item.endTime));
          const clampedStart = Math.max(operatingBounds.startMin, itemStartMin);
          const clampedEnd = Math.min(operatingBounds.endMin, itemEndMin);
          if (clampedEnd <= operatingBounds.startMin || clampedStart >= operatingBounds.endMin) {
            return null;
          }

          const topPx = ((clampedStart - operatingBounds.startMin) / 15) * ROW_HEIGHT_PX + 1;
          const heightPx = Math.max(
            ROW_HEIGHT_PX - 2,
            ((clampedEnd - clampedStart) / 15) * ROW_HEIGHT_PX - 2,
          );

          const leftCss = item.allocation === "Half Court - HCB" ? "calc(50% + 2px)" : "2px";
          const widthCss =
            item.allocation === "Full Court" ? "calc(100% - 4px)" : "calc(50% - 4px)";

          const isAcademy = item.source === "academy";
          const isCompleted = item.status === "Completed" || item.paymentStatus === "Paid";
          const isFreePass = item.paymentStatus === "Free Pass";

          const cardTone = isAcademy
            ? "border-sky-500/50 bg-sky-950/90 text-sky-100 hover:bg-sky-900/90"
            : isCompleted
              ? "border-emerald-500/50 bg-emerald-950/90 text-emerald-100 hover:bg-emerald-900/90"
              : isFreePass
                ? "border-purple-500/50 bg-purple-950/90 text-purple-100 hover:bg-purple-900/90"
                : "border-court-500/60 bg-ink-900/95 text-ink-100 hover:border-court-400";

          return (
            <button
              key={item.key}
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                openSessionDetailsModal(item);
              }}
              style={{
                top: `${topPx}px`,
                height: `${heightPx}px`,
                left: leftCss,
                width: widthCss,
              }}
              title={`${item.title} (${item.startTime}–${item.endTime}) · ${item.allocation} · Click for Session Details & Cash-In`}
              className={`absolute z-10 flex flex-col justify-between overflow-hidden rounded border px-2 py-1 text-left transition-colors ${cardTone}`}
            >
              <div className="min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <span className="truncate text-[11px] font-semibold leading-tight">
                    {item.title}
                  </span>
                  <span className="shrink-0 font-mono text-[9px] tabular-nums opacity-85">
                    {isAcademy ? "ACAD" : isFreePass ? "FREE" : money(item.totalAmount)}
                  </span>
                </div>
                {heightPx >= 42 && (
                  <div className="mt-0.5 truncate font-mono text-[9px] tabular-nums opacity-80">
                    {item.startTime}–{item.endTime} ·{" "}
                    {item.allocation === "Full Court"
                      ? "Full"
                      : item.allocation === "Half Court - HCA"
                        ? "HCA"
                        : "HCB"}
                    {item.recurrenceLabel ? ` · ↻ ${item.recurrenceLabel}` : ""}
                  </div>
                )}
              </div>
              {heightPx >= 64 && !isAcademy && (
                <div className="flex items-center justify-between gap-1 font-mono text-[9px] opacity-90">
                  <span className="truncate">{item.rateType || "Standard"}</span>
                  <span>{item.status === "Completed" ? "Cashed In" : item.paymentStatus}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="min-w-0 max-w-full space-y-5">
      {/* =================================================================== */}
      {/* TOP MODULE HEADER & BRANCH / RATES / OFF-DAYS / BOOKING CONTROLS    */}
      {/* =================================================================== */}
      <div className="rounded-xl border border-ink-800 bg-ink-900/90 p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink-400">
              <span>Vescio Nexus</span>
              <span aria-hidden="true">·</span>
              <span>Court &amp; Facility Reservations</span>
              <span aria-hidden="true">·</span>
              <span className="font-medium text-court-400">{activeBranchName}</span>
            </div>
            <h2 className="font-display text-xl tracking-tight text-ink-100">
              Interactive 15-Minute Court Reservation &amp; Rates Engine
            </h2>
            <p className="text-xs text-ink-400 max-w-3xl">
              Drag vertically inside <strong className="text-ink-200">HCA</strong> or{" "}
              <strong className="text-ink-200">HCB</strong> for half-court bookings, or drag across{" "}
              <strong className="text-ink-200">both HCA + HCB</strong> to book a Full Court. Click
              any scheduled session to Complete &amp; Cash In to the ledger.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button variant="secondary" size="sm" onClick={openRatesSetupModal}>
              <Sliders className="h-3.5 w-3.5 text-court-400" />
              <span>Rates Setup</span>
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setOffDaysModalOpen(true)}>
              <Ban className="h-3.5 w-3.5 text-amber-400" />
              <span>Off Days ({branchOffDays.length})</span>
            </Button>
            <Button size="sm" onClick={() => openNewBookingModal()}>
              <Plus className="h-4 w-4" />
              <span>+ New Booking</span>
            </Button>
          </div>
        </div>

        {/* Branch Selector Strip (when global filter is All or multiple branches exist) + Snapshot Rate Summary */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-800 pt-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 font-mono text-xs text-ink-400">
              <Building2 className="h-3.5 w-3.5 text-court-400" />
              <span>Facility Branch:</span>
            </div>
            {branches.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1 rounded-lg bg-ink-950 p-1 ring-1 ring-ink-800">
                {branches.map((b) => {
                  const isActive = b.name.toLowerCase() === activeBranchName.toLowerCase();
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => {
                        setLocalScopedBranch(b.name);
                        if (branchFilter !== "All") {
                          onChangeBranchFilter(b.name);
                        }
                      }}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                        isActive
                          ? "bg-court-500 text-ink-950 font-semibold"
                          : "text-ink-300 hover:text-ink-100"
                      }`}
                    >
                      {b.name} ({b.courts?.length || 1} crt)
                    </button>
                  );
                })}
              </div>
            ) : (
              <span className="font-mono text-xs text-ink-200">{activeBranchName}</span>
            )}
          </div>

          {/* Unboxed Clean Rate Summary Metadata */}
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-ink-300 tabular-nums">
            <span>Half: {money(branchRates.halfCourtHourlyRate)}/h</span>
            <span aria-hidden="true" className="text-ink-600">
              ·
            </span>
            <span>Full: {money(branchRates.fullCourtHourlyRate)}/h</span>
            <span aria-hidden="true" className="text-ink-600">
              ·
            </span>
            <span>
              Private: {money(branchRates.privateBaseFee)} +{" "}
              {money(branchRates.privateExtraPlayerFee)}/extra
            </span>
            <span aria-hidden="true" className="text-ink-600">
              ·
            </span>
            <span>Academy: {money(branchRates.academyHourlyRate)}/h</span>
          </div>
        </div>
      </div>

      {/* =================================================================== */}
      {/* CALENDAR NAVIGATION BAR + PREVIOUS DATE LOCK CHECKBOX               */}
      {/* =================================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-800 bg-ink-900/80 px-4 py-3">
        {/* View Mode Segmented Switcher: Daily | Weekly | Monthly */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 rounded-lg bg-ink-950 p-1 ring-1 ring-ink-800">
            {(
              [
                { id: "daily", label: "Daily" },
                { id: "weekly", label: "Weekly" },
                { id: "monthly", label: "Monthly" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setViewMode(tab.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                  viewMode === tab.id
                    ? "bg-ink-800 text-ink-100 ring-1 ring-ink-700"
                    : "text-ink-400 hover:text-ink-100"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Date Navigation */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => navigateCalendar(-1)}
              aria-label="Previous period"
              className="flex h-8 w-8 items-center justify-center rounded-md bg-ink-950 text-ink-200 ring-1 ring-ink-800 hover:bg-ink-800"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setFocusDate(today)}
              className="h-8 rounded-md bg-ink-950 px-2.5 font-mono text-xs text-ink-200 ring-1 ring-ink-800 hover:bg-ink-800 whitespace-nowrap"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => navigateCalendar(1)}
              aria-label="Next period"
              className="flex h-8 w-8 items-center justify-center rounded-md bg-ink-950 text-ink-200 ring-1 ring-ink-800 hover:bg-ink-800"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <input
              type="date"
              aria-label="Jump to calendar date"
              value={focusDate}
              onChange={(e) => {
                if (e.target.value) setFocusDate(e.target.value);
              }}
              className="h-8 rounded-md bg-ink-950 px-2.5 font-mono text-xs text-ink-100 ring-1 ring-ink-800 focus:outline-none focus:ring-court-500/60 tabular-nums"
            />
          </div>

          <span className="font-display text-sm font-semibold text-ink-100">
            {viewMode === "daily"
              ? formatReadableDate(focusDate)
              : viewMode === "weekly"
                ? `${formatReadableDate(weekDates[0] || focusDate)} – ${formatReadableDate(weekDates[6] || focusDate)}`
                : formatMonthTitle(focusDate)}
          </span>
        </div>

        {/* Previous Date Lock Toggle + Weekly Court Picker */}
        <div className="flex flex-wrap items-center gap-3">
          {viewMode === "weekly" && branchCourts.length > 1 && (
            <div className="flex items-center gap-1 rounded-lg bg-ink-950 p-1 ring-1 ring-ink-800">
              {branchCourts.map((crt) => (
                <button
                  key={crt.id}
                  type="button"
                  onClick={() => setWeeklyCourtName(crt.name)}
                  className={`rounded px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors ${
                    weeklyCourtName === crt.name
                      ? "bg-court-500 text-ink-950 font-semibold"
                      : "text-ink-300 hover:text-ink-100"
                  }`}
                >
                  {crt.name}
                </button>
              ))}
            </div>
          )}

          {/* Visible Checkbox Toggle: "Allow Previous Dates" */}
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-ink-750 bg-ink-950 px-3 py-1.5 text-xs text-ink-200 select-none hover:border-ink-700">
            <input
              type="checkbox"
              checked={allowPreviousDates}
              onChange={(e) => setAllowPreviousDates(e.target.checked)}
              className="h-3.5 w-3.5 accent-emerald-500"
            />
            {allowPreviousDates ? (
              <Unlock className="h-3.5 w-3.5 text-amber-400" />
            ) : (
              <Lock className="h-3.5 w-3.5 text-ink-400" />
            )}
            <span className="whitespace-nowrap font-medium">Allow Previous Dates</span>
          </label>
        </div>
      </div>

      {/* =================================================================== */}
      {/* CALENDAR VIEW 1: DAILY 15-MINUTE DRAG-TO-BOOK MATRIX                */}
      {/* =================================================================== */}
      {viewMode === "daily" && (
        <div className="rounded-xl border border-ink-800 bg-ink-900 overflow-hidden">
          {/* Status Banner if Locked Past Date or Off Day */}
          {(isDateLocked(focusDate) || getOffDay(focusDate)) && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-800 bg-ink-950 px-4 py-2.5 text-xs">
              {getOffDay(focusDate) ? (
                <div className="flex items-center gap-2 text-amber-300">
                  <Ban className="h-4 w-4 shrink-0" />
                  <span>
                    <strong>Off Day Closure ({focusDate}):</strong> {getOffDay(focusDate)?.reason} —
                    New bookings are blocked on this date.
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-ink-300">
                  <Lock className="h-4 w-4 shrink-0 text-ink-400" />
                  <span>
                    <strong>Previous Date Locked ({focusDate}):</strong> Dates prior to today (
                    {today}) cannot be booked or edited unless &ldquo;Allow Previous Dates&rdquo; is
                    checked.
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="w-full max-w-full overflow-x-auto">
            <div
              className="min-w-[680px]"
              style={{
                display: "grid",
                gridTemplateColumns: `76px repeat(${branchCourts.length}, minmax(240px, 1fr))`,
              }}
            >
              {/* Sticky Column Headers */}
              <div className="sticky top-0 z-20 border-b border-r border-ink-800 bg-ink-950 px-2 py-2.5 text-center font-mono text-[10px] text-ink-400">
                TIME
                <div className="mt-0.5 text-[9px] text-ink-500">15m slots</div>
              </div>

              {branchCourts.map((crt) => (
                <div
                  key={crt.id}
                  className="sticky top-0 z-20 border-b border-r border-ink-800 last:border-r-0 bg-ink-950"
                >
                  <div className="flex items-center justify-between px-3 py-1.5 border-b border-ink-800/80">
                    <span className="font-display text-sm font-semibold text-ink-100 truncate">
                      {crt.name}
                    </span>
                    <span className="font-mono text-[10px] text-ink-400 tabular-nums">
                      Full {money(branchRates.fullCourtHourlyRate)}/h · Half{" "}
                      {money(branchRates.halfCourtHourlyRate)}/h
                    </span>
                  </div>
                  <div className="grid grid-cols-2 text-center font-mono text-[10px] font-semibold">
                    <div className="border-r border-ink-800/80 py-1 text-sky-300">
                      HCA (Half Court A)
                    </div>
                    <div className="py-1 text-purple-300">HCB (Half Court B)</div>
                  </div>
                </div>
              ))}

              {/* Left 15-Minute Time Gutter */}
              <div className="border-r border-ink-800 bg-ink-950/90">
                {slots15.map((slotTime) => {
                  const isHour = slotTime.endsWith(":00");
                  const isHalf = slotTime.endsWith(":30");
                  return (
                    <div
                      key={slotTime}
                      style={{ height: `${ROW_HEIGHT_PX}px` }}
                      className={`flex items-start justify-end pr-2 pt-0.5 font-mono tabular-nums border-b ${
                        isHour
                          ? "border-ink-800/90 text-[11px] font-semibold text-ink-200"
                          : isHalf
                            ? "border-ink-800/50 text-[10px] text-ink-400"
                            : "border-ink-800/25 text-[9px] text-ink-500"
                      }`}
                    >
                      {slotTime}
                    </div>
                  );
                })}
              </div>

              {/* Court Columns (Each Split into HCA | HCB) */}
              {branchCourts.map((crt) =>
                renderCourtTwoColumnTrack(
                  crt.name,
                  focusDate,
                  dailySchedule.filter(
                    (it) => (it.court || "").toLowerCase() === crt.name.toLowerCase(),
                  ),
                ),
              )}
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* CALENDAR VIEW 2: WEEKLY 15-MINUTE DRAG-TO-BOOK MATRIX               */}
      {/* =================================================================== */}
      {viewMode === "weekly" && (
        <div className="rounded-xl border border-ink-800 bg-ink-900 overflow-hidden">
          <div className="w-full max-w-full overflow-x-auto">
            <div
              className="min-w-[1120px]"
              style={{
                display: "grid",
                gridTemplateColumns: "72px repeat(7, minmax(150px, 1fr))",
              }}
            >
              {/* Header Gutter */}
              <div className="border-b border-r border-ink-800 bg-ink-950 px-2 py-2.5 text-center font-mono text-[10px] text-ink-400">
                {weeklyCourtName}
                <div className="mt-0.5 text-[9px] text-ink-500">15m grid</div>
              </div>

              {/* 7 Day Headers (Each Split into HCA | HCB) */}
              {weekDates.map((iso, idx) => {
                const isToday = iso === today;
                const locked = isDateLocked(iso);
                const off = getOffDay(iso);
                return (
                  <div
                    key={iso}
                    className={`border-b border-r border-ink-800 last:border-r-0 ${
                      off ? "bg-ink-950/90 opacity-65" : "bg-ink-950"
                    }`}
                  >
                    <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-ink-800/80">
                      <button
                        type="button"
                        onClick={() => {
                          setFocusDate(iso);
                          setViewMode("daily");
                        }}
                        className={`font-mono text-xs font-semibold tabular-nums hover:underline ${
                          isToday ? "text-court-400" : "text-ink-100"
                        }`}
                      >
                        {WEEKDAY_SHORT[idx]} {iso.slice(5)}
                      </button>
                      {off ? (
                        <span className="font-mono text-[9px] text-amber-400">OFF</span>
                      ) : locked ? (
                        <Lock className="h-3 w-3 text-ink-500" />
                      ) : null}
                    </div>
                    <div className="grid grid-cols-2 text-center font-mono text-[9px] font-semibold">
                      <div className="border-r border-ink-800/80 py-0.5 text-sky-300">HCA</div>
                      <div className="py-0.5 text-purple-300">HCB</div>
                    </div>
                  </div>
                );
              })}

              {/* Left 15-Minute Time Gutter */}
              <div className="border-r border-ink-800 bg-ink-950/90">
                {slots15.map((slotTime) => {
                  const isHour = slotTime.endsWith(":00");
                  const isHalf = slotTime.endsWith(":30");
                  return (
                    <div
                      key={slotTime}
                      style={{ height: `${ROW_HEIGHT_PX}px` }}
                      className={`flex items-start justify-end pr-2 pt-0.5 font-mono tabular-nums border-b ${
                        isHour
                          ? "border-ink-800/90 text-[11px] font-semibold text-ink-200"
                          : isHalf
                            ? "border-ink-800/50 text-[10px] text-ink-400"
                            : "border-ink-800/25 text-[9px] text-ink-500"
                      }`}
                    >
                      {slotTime}
                    </div>
                  );
                })}
              </div>

              {/* 7 Day Columns (Each Split into HCA | HCB) */}
              {weekDates.map((iso) =>
                renderCourtTwoColumnTrack(
                  weeklyCourtName,
                  iso,
                  weeklySchedulesByDate.get(iso) || [],
                ),
              )}
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* CALENDAR VIEW 3: MONTHLY OVERVIEW GRID                              */}
      {/* =================================================================== */}
      {viewMode === "monthly" && (
        <div className="rounded-xl border border-ink-800 bg-ink-900 overflow-hidden">
          <div className="w-full max-w-full overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-7 border-b border-ink-800 bg-ink-950">
                {WEEKDAY_SHORT.map((dayLabel) => (
                  <div
                    key={dayLabel}
                    className="border-r border-ink-800 last:border-r-0 px-3 py-2 font-mono text-xs font-semibold text-ink-300"
                  >
                    {dayLabel}
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-7">
                {monthCells.map((cell) => {
                  const items = monthlySchedulesByDate.get(cell.iso) || [];
                  const off = getOffDay(cell.iso);
                  const locked = isDateLocked(cell.iso);
                  const isToday = cell.iso === today;

                  return (
                    <div
                      key={cell.iso}
                      className={`min-h-[124px] border-b border-r border-ink-800 p-2 flex flex-col justify-between transition-colors ${
                        !cell.inCurrentMonth
                          ? "bg-ink-950/80 opacity-50"
                          : off
                            ? "bg-ink-950/90 opacity-65"
                            : locked
                              ? "bg-ink-950/50"
                              : "bg-ink-900/40 hover:bg-ink-900/80"
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              setFocusDate(cell.iso);
                              setViewMode("daily");
                            }}
                            className={`font-mono text-xs font-semibold tabular-nums hover:underline ${
                              isToday
                                ? "rounded bg-court-500 px-1.5 py-0.5 text-ink-950"
                                : "text-ink-200"
                            }`}
                          >
                            {cell.dayNum}
                          </button>

                          {off ? (
                            <span className="font-mono text-[9px] text-amber-400 truncate">
                              Off Day
                            </span>
                          ) : locked ? (
                            <Lock className="h-3 w-3 text-ink-500" />
                          ) : (
                            <button
                              type="button"
                              onClick={() => openNewBookingModal({ date: cell.iso })}
                              className="rounded px-1.5 py-0.5 font-mono text-[10px] text-court-400 hover:bg-court-500/15"
                            >
                              + Book
                            </button>
                          )}
                        </div>

                        {off ? (
                          <div className="mt-2 rounded border border-ink-800 bg-ink-950 px-2 py-1.5 text-[10px] text-ink-400">
                            Closed: {off.reason}
                          </div>
                        ) : (
                          <div className="mt-1.5 space-y-1">
                            {items.slice(0, 3).map((it) => (
                              <button
                                key={it.key}
                                type="button"
                                onClick={() => openSessionDetailsModal(it)}
                                className={`flex w-full items-center justify-between gap-1 rounded px-1.5 py-0.5 text-left font-mono text-[10px] tabular-nums truncate ${
                                  it.source === "academy"
                                    ? "bg-sky-500/15 text-sky-300"
                                    : it.status === "Completed" || it.paymentStatus === "Paid"
                                      ? "bg-emerald-500/15 text-emerald-300"
                                      : "bg-court-500/15 text-court-300"
                                }`}
                              >
                                <span className="truncate">
                                  {it.startTime} {it.title}
                                </span>
                                <span className="shrink-0 opacity-80">
                                  {it.allocation === "Full Court"
                                    ? "Full"
                                    : it.allocation === "Half Court - HCA"
                                      ? "HCA"
                                      : "HCB"}
                                </span>
                              </button>
                            ))}
                            {items.length > 3 && (
                              <button
                                type="button"
                                onClick={() => {
                                  setFocusDate(cell.iso);
                                  setViewMode("daily");
                                }}
                                className="w-full text-left font-mono text-[10px] text-ink-400 hover:text-ink-200"
                              >
                                +{items.length - 3} more slots →
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =================================================================== */}
      {/* BRANCH RESERVATIONS LEDGER & CASH-IN DIRECTORY                      */}
      {/* =================================================================== */}
      <Panel
        title={`Branch Court Bookings & Cash-In Directory · ${activeBranchName}`}
        meta={`${branchCourtMetrics.totalBookings} bookings · Cashed In: ${money(branchCourtMetrics.cashedInTotal)} · Pending Cash-In: ${money(branchCourtMetrics.pendingCashIn)} · Active Continuous: ${branchCourtMetrics.continuousCount}`}
        action={
          <div className="w-full sm:w-64">
            <Input
              value={directorySearch}
              onChange={setDirectorySearch}
              placeholder="Search client, phone, court..."
            />
          </div>
        }
      >
        {scopedDirectoryReservations.length === 0 ? (
          <EmptyState
            title={`No court bookings recorded for ${activeBranchName} yet`}
            description="Drag directly on HCA, HCB, or across both columns on the calendar above, or click '+ New Booking'."
            action={
              <Button size="sm" onClick={() => openNewBookingModal()}>
                + New Booking
              </Button>
            }
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date &amp; 15m Slot</Th>
                <Th>Client / Entity</Th>
                <Th>Court &amp; Allocation</Th>
                <Th>Snapshot Rate &amp; Fee</Th>
                <Th>Booking Type</Th>
                <Th>Status</Th>
                <Th className="text-right">Session Actions</Th>
              </tr>
            </thead>
            <tbody>
              {scopedDirectoryReservations.map((r) => {
                const itemWrapper: CalendarDisplayItem = {
                  key: `dir-${r.id}`,
                  source: "nexus",
                  id: r.id,
                  reservation: r,
                  title: r.clientName,
                  subtitle: r.clientType,
                  branch: r.branch,
                  court: r.court,
                  allocation: r.courtAllocation,
                  date: r.date,
                  startTime: r.startTime,
                  endTime: r.endTime,
                  durationHours: r.durationHours,
                  totalAmount: Number(r.totalAmount) || 0,
                  paidAmount: Number(r.paidAmount) || 0,
                  paymentStatus: r.paymentStatus,
                  status: r.status,
                  rateType: r.rateType,
                  isRecurring: r.isRecurring,
                };
                const locked = isDateLocked(r.date);
                const isCashedIn =
                  r.status === "Completed" ||
                  r.paymentStatus === "Paid" ||
                  r.paymentStatus === "Free Pass";

                return (
                  <tr
                    key={r.id}
                    onClick={() => openSessionDetailsModal(itemWrapper)}
                    className="cursor-pointer border-t border-ink-800/70 transition-colors hover:bg-ink-850/60"
                  >
                    <Td>
                      <div className="font-mono text-xs font-semibold text-ink-100 tabular-nums">
                        {r.date}
                      </div>
                      <div className="font-mono text-[11px] text-ink-400 tabular-nums">
                        {r.startTime} – {r.endTime} ({r.durationHours}h)
                      </div>
                    </Td>
                    <Td>
                      <div className="font-medium text-ink-100">{r.clientName}</div>
                      <div className="text-xs text-ink-400">
                        {r.clientType}
                        {r.phone ? ` · ${r.phone}` : ""}
                      </div>
                    </Td>
                    <Td>
                      <div className="text-xs font-medium text-ink-200">{r.court}</div>
                      <div className="font-mono text-[11px] text-court-300">
                        {r.courtAllocation}
                      </div>
                    </Td>
                    <Td>
                      <div className="font-mono text-xs font-semibold text-emerald-400 tabular-nums">
                        {r.freePass || r.paymentStatus === "Free Pass"
                          ? "Free Pass ($0)"
                          : money(r.totalAmount)}
                      </div>
                      <div className="font-mono text-[10px] text-ink-400 tabular-nums">
                        {r.rateType || "Snapshot Rate"}
                        {r.rateType === "Private Rate" && r.playerCount
                          ? ` (${r.playerCount}p)`
                          : r.snapshotUnitRate !== undefined
                            ? ` @ ${money(r.snapshotUnitRate)}/h`
                            : ` @ ${money(r.hourlyRate)}/h`}
                      </div>
                    </Td>
                    <Td>
                      <div className="font-mono text-xs text-ink-200">
                        {r.recurrenceMode === "continuous"
                          ? r.continuousActive !== false
                            ? "Continuous Weekly"
                            : "Continuous (Stopped)"
                          : r.isRecurring
                            ? `Recurring (${r.recurringWeeks || 4} wks)`
                            : "Walk-in (1-Time)"}
                      </div>
                    </Td>
                    <Td>
                      <Chip tone={r.status === "Cancelled" ? "danger" : isCashedIn ? "ok" : "warn"}>
                        {r.status === "Cancelled"
                          ? "Cancelled"
                          : r.status === "Completed"
                            ? `Cashed In (${r.paymentMethod || "Paid"})`
                            : r.paymentStatus}
                      </Chip>
                    </Td>
                    <Td className="text-right">
                      <div
                        className="inline-flex items-center gap-1.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.status !== "Cancelled" && !isCashedIn && (
                          <Button
                            variant="emerald"
                            size="xs"
                            onClick={() => openSessionDetailsModal(itemWrapper)}
                          >
                            Complete &amp; Cash In
                          </Button>
                        )}
                        {r.status !== "Cancelled" && !locked && (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => openEditBookingModal(r)}
                            title="Edit booking"
                          >
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="xs"
                          onClick={async () => {
                            try {
                              await deleteEntity("courtReservations", r.id);
                              toast.success("Booking record deleted.");
                            } catch {
                              /* Error toast handled by data-store */
                            }
                          }}
                          title="Delete booking record"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-ink-400 hover:text-red-400" />
                        </Button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Panel>

      {/* =================================================================== */}
      {/* MODAL A: BRANCH RATES SETUP (SNAPSHOT-PROTECTED)                    */}
      {/* =================================================================== */}
      <Modal
        open={ratesModalOpen}
        title={`Rates Setup · ${activeBranchName}`}
        meta="Snapshot-Protected Engine: Updating rates here applies only to new bookings and never alters confirmed reservations."
        onClose={() => setRatesModalOpen(false)}
        onSubmit={handleSaveRatesSetup}
        submitLabel="Save Branch Rates"
      >
        <div className="p-4 space-y-4">
          <div className="rounded-lg border border-ink-800 bg-ink-950/70 p-3 text-xs text-ink-300">
            Configure the 4 standard rate structures for{" "}
            <strong className="text-ink-100">{activeBranchName}</strong>. Every booking snapshots
            its calculated rate and fee directly onto the booking document when confirmed.
          </div>

          <div className="grid items-end gap-3 sm:grid-cols-2">
            <Field label="1. Half Court Rate (Hourly)" hint="Applied to HCA or HCB hourly bookings">
              <Input
                type="number"
                value={ratesDraft.halfCourtHourlyRate}
                onChange={(v) => setRatesDraft({ ...ratesDraft, halfCourtHourlyRate: v })}
              />
            </Field>
            <Field
              label="2. Full Court Rate (Hourly)"
              hint="Applied to Full Court (HCA + HCB) hourly bookings"
            >
              <Input
                type="number"
                value={ratesDraft.fullCourtHourlyRate}
                onChange={(v) => setRatesDraft({ ...ratesDraft, fullCourtHourlyRate: v })}
              />
            </Field>
          </div>

          <div className="rounded-lg border border-ink-800 bg-ink-950/50 p-3 space-y-3">
            <div className="font-display text-sm font-semibold text-ink-100">
              3. Private Rate Structure
            </div>
            <div className="grid items-end gap-3 sm:grid-cols-2">
              <Field label="Base Fee (1 Client)" hint="Fixed base fee covering the first player">
                <Input
                  type="number"
                  value={ratesDraft.privateBaseFee}
                  onChange={(v) => setRatesDraft({ ...ratesDraft, privateBaseFee: v })}
                />
              </Field>
              <Field label="Extra Fee per Additional Player" hint="Added for each player above 1">
                <Input
                  type="number"
                  value={ratesDraft.privateExtraPlayerFee}
                  onChange={(v) => setRatesDraft({ ...ratesDraft, privateExtraPlayerFee: v })}
                />
              </Field>
            </div>
          </div>

          <Field
            label="4. Academy Rate (Hourly)"
            hint="Preferential hourly rate for internal Academy / partner sessions"
          >
            <Input
              type="number"
              value={ratesDraft.academyHourlyRate}
              onChange={(v) => setRatesDraft({ ...ratesDraft, academyHourlyRate: v })}
            />
          </Field>
        </div>
      </Modal>

      {/* =================================================================== */}
      {/* MODAL B: OFF DAYS / CLOSURES MANAGER                                */}
      {/* =================================================================== */}
      <Modal
        open={offDaysModalOpen}
        title={`Off Days & Facility Closures · ${activeBranchName}`}
        meta="Dates marked as Off Days appear greyed-out on the calendar and block new bookings"
        onClose={() => setOffDaysModalOpen(false)}
      >
        <div className="p-4 space-y-4">
          <div className="rounded-lg border border-ink-800 bg-ink-950/70 p-3 space-y-3">
            <div className="font-display text-sm font-semibold text-ink-100">
              Add New Off Day / Closure
            </div>
            <div className="grid items-end gap-3 sm:grid-cols-2">
              <Field label="Closure Date">
                <Input type="date" value={newOffDayDate} onChange={setNewOffDayDate} />
              </Field>
              <Field label="Reason / Label">
                <Input
                  value={newOffDayReason}
                  onChange={setNewOffDayReason}
                  placeholder="e.g. Public Holiday, Floor Maintenance"
                />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={() => void handleAddOffDay()}>
                Mark Date as Off Day
              </Button>
            </div>
          </div>

          <div className="space-y-2 max-h-[280px] overflow-y-auto">
            {branchOffDays.length === 0 ? (
              <div className="py-6 text-center font-mono text-xs text-ink-400">
                No Off Days configured for {activeBranchName}.
              </div>
            ) : (
              branchOffDays.map((off) => (
                <div
                  key={off.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-ink-800 bg-ink-900 px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="font-mono text-xs font-semibold text-amber-300 tabular-nums">
                      {off.date} ({formatReadableDate(off.date)})
                    </div>
                    <div className="text-xs text-ink-300 truncate">{off.reason}</div>
                  </div>
                  <Button variant="ghost" size="xs" onClick={() => void handleRemoveOffDay(off.id)}>
                    Remove
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </Modal>

      {/* =================================================================== */}
      {/* MODAL C: BOOKING FORM, RECURRING LOGIC & PRICING OVERRIDES          */}
      {/* =================================================================== */}
      <Modal
        open={bookingModalOpen}
        wide
        title={
          editingReservation
            ? `Edit Court Booking · ${editingReservation.clientName}`
            : "New Court & Facility Booking"
        }
        meta={`${bookingForm.branch} · 15-Minute Precision · Snapshot-Protected Pricing`}
        onClose={() => setBookingModalOpen(false)}
        onSubmit={handleSaveBooking}
        submitLabel={
          editingReservation
            ? `Save Booking Changes (${money(pricingPreview.finalPayable)})`
            : `Confirm Booking (${bookingForm.freePass ? "Free Pass $0" : money(pricingPreview.finalPayable)})`
        }
      >
        <div className="p-4 space-y-5">
          {/* Section 1: Client / Entity Identification */}
          <div className="grid items-end gap-3 sm:grid-cols-3">
            <Field label="Client Category">
              <Select
                value={bookingForm.clientType}
                onChange={(v) =>
                  setBookingForm({
                    ...bookingForm,
                    clientType: v as CourtReservation["clientType"],
                  })
                }
                options={[
                  { label: "External Client", value: "External Client" },
                  { label: "Academy Player", value: "Academy Player" },
                  { label: "Academy Team", value: "Academy Team" },
                  { label: "Corporate / Club", value: "Corporate / Club" },
                ]}
              />
            </Field>

            {bookingForm.clientType === "Academy Player" ? (
              <Field label="Select Academy Player">
                <Select
                  value={bookingForm.linkedPlayerId}
                  onChange={(pid) => {
                    const p = players.find((x) => x.id === pid);
                    setBookingForm({
                      ...bookingForm,
                      linkedPlayerId: pid,
                      clientName: p ? p.name : bookingForm.clientName,
                      phone: p ? p.parentPhone || p.phone || "" : bookingForm.phone,
                    });
                  }}
                  options={[
                    { label: "— Choose Player —", value: "" },
                    ...players.map((p) => ({
                      label: `${p.name} (${p.category})`,
                      value: p.id,
                    })),
                  ]}
                />
              </Field>
            ) : bookingForm.clientType === "Academy Team" ? (
              <Field label="Select Academy Team">
                <Select
                  value={bookingForm.linkedTeamName}
                  onChange={(tName) => {
                    setBookingForm({
                      ...bookingForm,
                      linkedTeamName: tName,
                      clientName: tName || bookingForm.clientName,
                      rateType: "Academy Rate",
                      useExistingSnapshot: false,
                    });
                  }}
                  options={[
                    { label: "— Choose Team —", value: "" },
                    ...teams.map((t) => ({ label: `${t.name} (${t.branch})`, value: t.name })),
                  ]}
                />
              </Field>
            ) : (
              <Field label="Client / Entity Name">
                <Input
                  value={bookingForm.clientName}
                  onChange={(v) => setBookingForm({ ...bookingForm, clientName: v })}
                  placeholder="Enter client, group, or club name"
                />
              </Field>
            )}

            <Field label="Contact Phone">
              <Input
                value={bookingForm.phone}
                onChange={(v) => setBookingForm({ ...bookingForm, phone: v })}
                placeholder="+961 70 000 000"
              />
            </Field>
          </div>

          {(bookingForm.clientType === "Academy Player" ||
            bookingForm.clientType === "Academy Team") && (
            <Field label="Confirmed Client / Display Name">
              <Input
                value={bookingForm.clientName}
                onChange={(v) => setBookingForm({ ...bookingForm, clientName: v })}
                placeholder="Display name on schedule"
              />
            </Field>
          )}

          {/* Section 2: Court, Allocation (HCA / HCB / Full), Date & 15-Min Times */}
          <div className="grid items-end gap-2.5 grid-cols-2 sm:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1.3fr)_minmax(96px,0.95fr)_minmax(96px,0.95fr)]">
            <Field label="Branch" labelClassName="whitespace-nowrap">
              <Select
                className="h-10"
                value={bookingForm.branch}
                disabled={branchFilter !== "All"}
                onChange={(bName) => {
                  const bObj = branches.find((b) => b.name === bName);
                  setBookingForm({
                    ...bookingForm,
                    branch: bName,
                    court: bObj?.courts?.[0]?.name || "Court 1",
                    useExistingSnapshot: false,
                  });
                }}
                options={
                  branches.length > 0
                    ? branches.map((b) => ({ label: b.name, value: b.name }))
                    : [{ label: activeBranchName, value: activeBranchName }]
                }
              />
            </Field>

            <Field label="Court" labelClassName="whitespace-nowrap">
              <Select
                className="h-10"
                value={bookingForm.court}
                onChange={(cName) =>
                  setBookingForm({
                    ...bookingForm,
                    court: cName,
                    useExistingSnapshot: false,
                  })
                }
                options={formBranchCourts.map((c) => ({ label: c.name, value: c.name }))}
              />
            </Field>

            <Field label="Allocation" labelClassName="whitespace-nowrap">
              <Select
                className="h-10"
                value={bookingForm.courtAllocation}
                onChange={(v) => {
                  const nextAlloc = v as CourtAllocationType;
                  const autoRate: CourtRateType =
                    bookingForm.rateType === "Private Rate" ||
                    bookingForm.rateType === "Academy Rate"
                      ? bookingForm.rateType
                      : nextAlloc === "Full Court"
                        ? "Full Court Rate"
                        : "Half Court Rate";
                  setBookingForm({
                    ...bookingForm,
                    courtAllocation: nextAlloc,
                    rateType: autoRate,
                    useExistingSnapshot: false,
                  });
                }}
                options={COURT_ALLOCATION_OPTIONS.map((opt) => ({ label: opt, value: opt }))}
              />
            </Field>

            <Field label="Date" labelClassName="whitespace-nowrap">
              <Input
                type="date"
                value={bookingForm.date}
                onChange={(v) => setBookingForm({ ...bookingForm, date: v })}
                className="mt-1.5 h-10 w-full rounded-md bg-ink-850 px-2.5 py-2 font-ui text-sm text-ink-100 ring-1 ring-ink-700 placeholder:text-ink-400 focus:outline-none focus:ring-court-500/60 tabular-nums"
              />
            </Field>

            <Field label="Start (15m)" labelClassName="whitespace-nowrap">
              <Select
                className="h-10 px-2 tabular-nums"
                value={bookingForm.startTime}
                onChange={(v) => {
                  const newStartMin = timeToMinutes(v);
                  const curEndMin = timeToMinutes(bookingForm.endTime);
                  const nextEnd =
                    curEndMin <= newStartMin
                      ? minutesToTime(newStartMin + 60)
                      : bookingForm.endTime;
                  setBookingForm({ ...bookingForm, startTime: v, endTime: nextEnd });
                }}
                options={formTimeOptions}
              />
            </Field>

            <Field label="End (15m)" labelClassName="whitespace-nowrap">
              <Select
                className="h-10 px-2 tabular-nums"
                value={bookingForm.endTime}
                onChange={(v) => setBookingForm({ ...bookingForm, endTime: v })}
                options={formTimeOptions}
              />
            </Field>
          </div>

          {/* Real-Time Availability / Off Day / Lock Validation Strip */}
          {isDateLocked(bookingForm.date) ? (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
              <strong>Date Locked:</strong> {bookingForm.date} is prior to today. Tick &ldquo;Allow
              Previous Dates&rdquo; on the calendar toolbar to book past dates.
            </div>
          ) : formOffDayBlocked ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-300">
              <strong>Off Day Blocked:</strong> {bookingForm.date} is closed (
              {formOffDayBlocked.reason}).
            </div>
          ) : !pricingPreview.isTimeValid ? (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
              End Time must be later than Start Time.
            </div>
          ) : formConflictPreview.hasCourtConflict ? (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-300">
              <strong>Double-Booking Blocked:</strong> {formConflictPreview.courtConflictReason}
            </div>
          ) : formConflictPreview.simultaneousHalfCourtSession ? (
            <div className="rounded-lg border border-sky-500/40 bg-sky-500/10 p-3 text-xs text-sky-300">
              <strong>Simultaneous Half-Court Share:</strong> Opposite half-court is occupied by
              &ldquo;{formConflictPreview.simultaneousHalfCourtSession.title}&rdquo; —{" "}
              {bookingForm.courtAllocation} is open ({pricingPreview.durationHours}h).
            </div>
          ) : (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 font-mono text-xs text-emerald-300 tabular-nums">
              Slot Available · {bookingForm.court} · {bookingForm.courtAllocation} ·{" "}
              {bookingForm.startTime}–{bookingForm.endTime} ({pricingPreview.durationHours}h)
            </div>
          )}

          {/* Section 3: Rate Type & Booking Recurrence Mode */}
          <div className="grid items-start gap-4 sm:grid-cols-2">
            {/* Rate Structure Box */}
            <div className="flex flex-col rounded-lg border border-ink-800 bg-ink-950/60 p-4 pb-4 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-display text-sm font-semibold leading-snug text-ink-100">
                  Rate Structure (Snapshot-Protected)
                </span>
                {editingReservation && bookingForm.useExistingSnapshot && (
                  <button
                    type="button"
                    onClick={() => setBookingForm({ ...bookingForm, useExistingSnapshot: false })}
                    className="font-mono text-[10px] text-court-400 hover:underline"
                  >
                    Refresh from Current Rates
                  </button>
                )}
              </div>

              <Field label="Rate Type" className="h-auto justify-start">
                <Select
                  value={bookingForm.rateType}
                  onChange={(v) =>
                    setBookingForm({
                      ...bookingForm,
                      rateType: v as CourtRateType,
                      useExistingSnapshot: false,
                    })
                  }
                  options={RATE_TYPE_OPTIONS}
                />
              </Field>

              {bookingForm.rateType === "Private Rate" && (
                <Field
                  label="Player Count"
                  className="h-auto justify-start"
                  hint={`Base (1 player): ${money(pricingPreview.unitRate)} + ${money(pricingPreview.extraPlayerRate)} per extra player`}
                >
                  <Input
                    type="number"
                    value={bookingForm.playerCount}
                    onChange={(v) => setBookingForm({ ...bookingForm, playerCount: v })}
                  />
                </Field>
              )}

              <div className="rounded-md bg-ink-900/70 px-3 py-2 font-mono text-xs leading-snug text-ink-300 tabular-nums">
                {bookingForm.rateType === "Private Rate" ? (
                  <span>
                    Formula: {money(pricingPreview.unitRate)} base +{" "}
                    {Math.max(0, pricingPreview.playerCount - 1)} extra ×{" "}
                    {money(pricingPreview.extraPlayerRate)} ={" "}
                    <strong className="text-ink-100">
                      {money(pricingPreview.baseCalculatedAmount)}
                    </strong>
                  </span>
                ) : (
                  <span>
                    Formula: {money(pricingPreview.unitRate)}/hr × {pricingPreview.durationHours}h ={" "}
                    <strong className="text-ink-100">
                      {money(pricingPreview.baseCalculatedAmount)}
                    </strong>
                  </span>
                )}
              </div>
            </div>

            {/* Booking Type: Walk-in (1-Time) vs Fixed / Recurring (Weeks or Continuous) */}
            <div className="flex flex-col rounded-lg border border-ink-800 bg-ink-950/60 p-4 pb-4 space-y-3">
              <div className="font-display text-sm font-semibold leading-snug text-ink-100">
                Booking Type &amp; Recurrence
              </div>

              {editingReservation ? (
                <div className="text-xs leading-snug text-ink-400">
                  Editing single booking record on{" "}
                  <span className="font-mono text-ink-200">{bookingForm.date}</span>.
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setBookingForm({ ...bookingForm, bookingType: "walk_in" })}
                      className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                        bookingForm.bookingType === "walk_in"
                          ? "border-court-500 bg-court-500/15 text-court-300"
                          : "border-ink-800 bg-ink-900 text-ink-300 hover:text-ink-100"
                      }`}
                    >
                      Walk-in (1-Time)
                    </button>
                    <button
                      type="button"
                      onClick={() => setBookingForm({ ...bookingForm, bookingType: "recurring" })}
                      className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                        bookingForm.bookingType === "recurring"
                          ? "border-court-500 bg-court-500/15 text-court-300"
                          : "border-ink-800 bg-ink-900 text-ink-300 hover:text-ink-100"
                      }`}
                    >
                      <Repeat className="h-3.5 w-3.5" />
                      <span>Fixed / Recurring</span>
                    </button>
                  </div>

                  {bookingForm.bookingType === "recurring" && (
                    <div className="space-y-2.5 pt-1">
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setBookingForm({ ...bookingForm, recurrenceSubMode: "weeks" })
                          }
                          className={`rounded border px-2.5 py-1.5 text-xs transition-colors ${
                            bookingForm.recurrenceSubMode === "weeks"
                              ? "border-sky-500/50 bg-sky-500/15 text-sky-200 font-medium"
                              : "border-ink-800 bg-ink-900 text-ink-400"
                          }`}
                        >
                          Specific Weeks
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setBookingForm({ ...bookingForm, recurrenceSubMode: "continuous" })
                          }
                          className={`rounded border px-2.5 py-1.5 text-xs transition-colors ${
                            bookingForm.recurrenceSubMode === "continuous"
                              ? "border-purple-500/50 bg-purple-500/15 text-purple-200 font-medium"
                              : "border-ink-800 bg-ink-900 text-ink-400"
                          }`}
                        >
                          Continuous (Indefinite)
                        </button>
                      </div>

                      {bookingForm.recurrenceSubMode === "weeks" ? (
                        <div className="flex flex-wrap items-center gap-2">
                          {["4", "8", "12"].map((presetW) => (
                            <button
                              key={presetW}
                              type="button"
                              onClick={() =>
                                setBookingForm({ ...bookingForm, recurringWeeks: presetW })
                              }
                              className={`rounded px-2.5 py-1 font-mono text-xs tabular-nums ${
                                bookingForm.recurringWeeks === presetW
                                  ? "bg-court-500 text-ink-950 font-semibold"
                                  : "bg-ink-850 text-ink-300 ring-1 ring-ink-700"
                              }`}
                            >
                              {presetW} wks
                            </button>
                          ))}
                          <div className="flex items-center gap-1.5 ml-auto">
                            <span className="font-mono text-xs text-ink-400">Custom:</span>
                            <input
                              type="number"
                              min="2"
                              max="52"
                              value={bookingForm.recurringWeeks}
                              onChange={(e) =>
                                setBookingForm({
                                  ...bookingForm,
                                  recurringWeeks: e.target.value,
                                })
                              }
                              className="w-16 rounded-md bg-ink-850 px-2 py-1 text-center font-mono text-xs text-ink-100 ring-1 ring-ink-700 tabular-nums"
                            />
                            <span className="font-mono text-xs text-ink-400">wks</span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-ink-300">
                          Repeats every{" "}
                          <strong className="text-purple-300">
                            {WEEKDAY_SHORT[getIsoWeekdayIndexMon0(bookingForm.date)]}
                          </strong>{" "}
                          indefinitely at this snapshotted rate until manually stopped.
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Section 4: Pricing Overrides (Free Pass, Discount %, Fixed Discount) */}
          <div className="rounded-lg border border-ink-800 bg-ink-950/70 p-4 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex flex-col gap-1">
                <span className="font-display text-sm font-semibold leading-snug text-ink-100">
                  Pricing Overrides &amp; Final Snapshot Fee
                </span>
                <span className="font-mono text-xs leading-snug text-ink-400 tabular-nums">
                  {bookingForm.rateType === "Private Rate" ? (
                    <>
                      Formula: {money(pricingPreview.unitRate)} base +{" "}
                      {Math.max(0, pricingPreview.playerCount - 1)} extra ×{" "}
                      {money(pricingPreview.extraPlayerRate)} ={" "}
                      <strong className="text-ink-200">
                        {money(pricingPreview.baseCalculatedAmount)}
                      </strong>
                    </>
                  ) : (
                    <>
                      Formula: {money(pricingPreview.unitRate)}/hr × {pricingPreview.durationHours}h
                      ={" "}
                      <strong className="text-ink-200">
                        {money(pricingPreview.baseCalculatedAmount)}
                      </strong>
                    </>
                  )}
                </span>
              </div>
              <span className="font-mono text-sm font-bold leading-snug text-emerald-400 tabular-nums">
                Session Payable:{" "}
                {bookingForm.freePass ? "$0.00 (Free Pass)" : money(pricingPreview.finalPayable)}
              </span>
            </div>

            <div className="grid items-start gap-3 sm:grid-cols-3">
              <div className="flex min-w-0 flex-col">
                <span className="label-mono mb-1.5 block text-[11px] leading-snug whitespace-nowrap">
                  Fee Waiver
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={bookingForm.freePass}
                  onClick={() =>
                    setBookingForm({ ...bookingForm, freePass: !bookingForm.freePass })
                  }
                  className={`flex h-10 w-full items-center gap-2.5 rounded-md px-3 text-left ring-1 transition-colors ${
                    bookingForm.freePass
                      ? "bg-court-500/10 ring-court-500/40"
                      : "bg-ink-850 ring-ink-700 hover:ring-ink-600"
                  }`}
                >
                  <span
                    className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                      bookingForm.freePass ? "bg-court-500" : "bg-ink-700"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-ink-950 transition-all ${
                        bookingForm.freePass ? "left-4.5" : "left-0.5"
                      }`}
                    />
                  </span>
                  <span className="truncate whitespace-nowrap text-sm font-medium text-ink-100">
                    Free Pass ($0)
                  </span>
                </button>
                <span className="mt-1.5 block font-mono text-[10px] leading-snug text-ink-400">
                  Overrides total payable fee to $0
                </span>
              </div>

              <Field
                label="Discount %"
                labelClassName="whitespace-nowrap"
                className="h-auto justify-start"
              >
                <Input
                  type="number"
                  disabled={bookingForm.freePass}
                  value={bookingForm.discountPercent}
                  onChange={(v) => setBookingForm({ ...bookingForm, discountPercent: v })}
                  placeholder="0"
                  className="tabular-nums disabled:opacity-50"
                />
              </Field>

              <Field
                label="Fixed Discount Amount"
                labelClassName="whitespace-nowrap"
                className="h-auto justify-start"
              >
                <Input
                  type="number"
                  disabled={bookingForm.freePass}
                  value={bookingForm.discountFixedAmount}
                  onChange={(v) => setBookingForm({ ...bookingForm, discountFixedAmount: v })}
                  placeholder="0"
                  className="tabular-nums disabled:opacity-50"
                />
              </Field>
            </div>

            {!editingReservation && !bookingForm.freePass && (
              <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-ink-800 bg-ink-900/80 px-3 py-2 text-xs text-ink-200 hover:border-court-500/40">
                <input
                  type="checkbox"
                  checked={bookingForm.collectPaymentNow}
                  onChange={(e) =>
                    setBookingForm({ ...bookingForm, collectPaymentNow: e.target.checked })
                  }
                  className="h-4 w-4 accent-emerald-500"
                />
                <span className="font-medium text-ink-100">
                  Collect Payment Now (Cash-In on Creation)
                </span>
                <span className="ml-auto font-mono text-[11px] text-emerald-400">
                  {bookingForm.collectPaymentNow
                    ? `Will post ${money(pricingPreview.finalPayable)} to Ledger`
                    : "Pay later on Cash-In"}
                </span>
              </label>
            )}

            <Field label="Booking Notes (Optional)">
              <Textarea
                rows={2}
                value={bookingForm.notes}
                onChange={(v) => setBookingForm({ ...bookingForm, notes: v })}
                placeholder="Equipment requests, lighting, scoreboard, or billing notes..."
              />
            </Field>
          </div>
        </div>
      </Modal>

      {/* =================================================================== */}
      {/* MODAL D: SESSION COMPLETION & CASH-IN DRAWER / MODAL                */}
      {/* =================================================================== */}
      <Modal
        open={Boolean(selectedSessionItem)}
        title={
          selectedSessionItem
            ? `Session Details & Cash-In · ${selectedSessionItem.title}`
            : "Session Details"
        }
        meta={
          selectedSessionItem
            ? `${selectedSessionItem.branch} · ${selectedSessionItem.court} (${selectedSessionItem.allocation}) · ${selectedSessionItem.date}`
            : undefined
        }
        onClose={() => setSelectedSessionItem(null)}
      >
        {selectedSessionItem && (
          <div className="p-4 space-y-4">
            {/* Session Snapshot Summary */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-lg border border-ink-800 bg-ink-950/70 p-3 font-mono text-xs tabular-nums">
              <div>
                <div className="text-[10px] text-ink-400">Date &amp; Time</div>
                <div className="mt-0.5 font-semibold text-ink-100">{selectedSessionItem.date}</div>
                <div className="text-[11px] text-ink-300">
                  {selectedSessionItem.startTime}–{selectedSessionItem.endTime} (
                  {selectedSessionItem.durationHours}h)
                </div>
              </div>
              <div>
                <div className="text-[10px] text-ink-400">Court &amp; Slot</div>
                <div className="mt-0.5 font-semibold text-ink-100">{selectedSessionItem.court}</div>
                <div className="text-[11px] text-court-300">{selectedSessionItem.allocation}</div>
              </div>
              <div>
                <div className="text-[10px] text-ink-400">Snapshotted Total</div>
                <div className="mt-0.5 font-semibold text-emerald-400">
                  {selectedSessionItem.paymentStatus === "Free Pass"
                    ? "Free Pass ($0)"
                    : money(selectedSessionItem.totalAmount)}
                </div>
                <div className="text-[10px] text-ink-400">
                  {selectedSessionItem.rateType || "Court Rental"}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-ink-400">Session Status</div>
                <div className="mt-0.5 font-semibold text-ink-100">
                  {selectedSessionItem.status}
                </div>
                <div className="text-[10px] text-ink-300">
                  Paid: {money(selectedSessionItem.paidAmount)} ({selectedSessionItem.paymentStatus}
                  )
                </div>
              </div>
            </div>

            {/* Complete & Cash-In Workflow */}
            {selectedSessionItem.status === "Completed" ? (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-4 space-y-1">
                <div className="flex items-center gap-2 font-display text-sm font-semibold text-emerald-300">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Session Completed &amp; Cashed In</span>
                </div>
                <div className="font-mono text-xs text-emerald-200/90 tabular-nums">
                  Collected {money(selectedSessionItem.paidAmount)} via{" "}
                  {selectedSessionItem.reservation?.paymentMethod || "Paid"}
                  {selectedSessionItem.reservation?.cashedInBy
                    ? ` · Verified by ${selectedSessionItem.reservation.cashedInBy}`
                    : ""}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-ink-800 bg-ink-950/80 p-4 space-y-3.5">
                <div className="flex items-center gap-2 font-display text-sm font-semibold text-ink-100">
                  <DollarSign className="h-4 w-4 text-emerald-400" />
                  <span>Complete Session &amp; Cash In to Financial Ledger</span>
                </div>

                <div className="grid items-end gap-3 sm:grid-cols-2">
                  <Field
                    label="Final Payable Amount to Cash In"
                    hint="Confirm final amount collected for this session"
                  >
                    <Input
                      type="number"
                      disabled={selectedSessionItem.paymentStatus === "Free Pass"}
                      value={
                        selectedSessionItem.paymentStatus === "Free Pass"
                          ? "0"
                          : cashInPayableAmount
                      }
                      onChange={setCashInPayableAmount}
                    />
                  </Field>

                  <Field label="Payment Method" hint="Select settlement channel for ledger posting">
                    <Select
                      value={cashInPaymentMethod}
                      onChange={(v) =>
                        setCashInPaymentMethod(v as NonNullable<CourtReservation["paymentMethod"]>)
                      }
                      options={[
                        { label: "Cash (Post to Financial Ledger)", value: "Cash" },
                        { label: "Card (Post to Financial Ledger)", value: "Card" },
                        {
                          label: "Bank Transfer (Post to Financial Ledger)",
                          value: "Bank Transfer",
                        },
                        { label: "Wish / OMT (Post to Financial Ledger)", value: "Wish / OMT" },
                        ...(selectedSessionItem.reservation?.linkedPlayerId ||
                        selectedSessionItem.seedReservation?.linkedPlayerId
                          ? [
                              {
                                label: "Charge to Linked Player Account",
                                value: "Account Charge",
                              },
                            ]
                          : []),
                      ]}
                    />
                  </Field>
                </div>

                <Field label="Completion / Cashier Notes (Optional)">
                  <Input
                    value={cashInNotes}
                    onChange={setCashInNotes}
                    placeholder="Receipt reference or session completion remark..."
                  />
                </Field>

                <div className="flex justify-end pt-1">
                  <Button onClick={() => void handleCompleteAndCashIn()}>
                    <CheckCircle2 className="h-4 w-4" />
                    <span>
                      Complete &amp; Cash In (
                      {selectedSessionItem.paymentStatus === "Free Pass"
                        ? "Free Pass $0"
                        : money(Number(cashInPayableAmount) || 0)}
                      )
                    </span>
                  </Button>
                </div>
              </div>
            )}

            {/* Secondary Management Actions: Edit, Stop Continuous Series, Cancel */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-800 pt-3">
              <div className="flex flex-wrap items-center gap-2">
                {!selectedSessionItem.isProjectedContinuous &&
                  selectedSessionItem.reservation &&
                  !isDateLocked(selectedSessionItem.date) && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        const r = selectedSessionItem.reservation;
                        setSelectedSessionItem(null);
                        if (r) openEditBookingModal(r);
                      }}
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      <span>Edit Booking</span>
                    </Button>
                  )}

                {(selectedSessionItem.isProjectedContinuous ||
                  selectedSessionItem.reservation?.recurrenceMode === "continuous") && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleStopContinuousSeries(selectedSessionItem)}
                  >
                    <Clock className="h-3.5 w-3.5 text-amber-400" />
                    <span>Stop Continuous Series After {selectedSessionItem.date}</span>
                  </Button>
                )}
              </div>

              <div className="flex items-center gap-2">
                {selectedSessionItem.status !== "Cancelled" &&
                  selectedSessionItem.status !== "Completed" && (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => void handleCancelSingleSession(selectedSessionItem)}
                    >
                      Cancel Session
                    </Button>
                  )}
                <Button variant="ghost" size="sm" onClick={() => setSelectedSessionItem(null)}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

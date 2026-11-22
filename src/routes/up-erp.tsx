import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Building2,
  Calendar,
  Dumbbell,
  Edit3,
  HeartPulse,
  Layers,
  MapPin,
  Maximize2,
  Minimize2,
  Settings,
  ShoppingCart,
  Sparkles,
  Trash2,
  Wallet,
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
  money,
} from "@/components/kit";
import { NexusCourtReservationsModule } from "@/components/nexus-court-reservations";
import { NexusGymModule } from "@/components/nexus-gym-module";
import { NexusPhysioModule } from "@/components/nexus-physio-module";
import { NexusPosModule } from "@/components/nexus-pos-module";
import { VescioNexusIcon } from "@/components/vescio-nexus-icon";
import {
  DEFAULT_POS_CATALOG,
  projectCourtReservationsForDate,
  todayISO,
  uid,
  useDB,
  useTenantUser,
  type Branch,
  type Court,
  type PosCatalogItem,
} from "@/lib/data-store";

export const Route = createFileRoute("/up-erp")({
  head: () => ({
    meta: [
      { title: "Vescio Nexus — Vescio Vector" },
      {
        name: "description",
        content:
          "Vescio Nexus Multi-Branch Facility ERP: Nexus Branches, Court & Facility Reservations, Gym & Strength, Physiotherapy & Medical, and Kiosk POS.",
      },
    ],
  }),
  component: VescioNexusHub,
});

type VescioNexusModuleTab = "hub" | "branches" | "courts" | "gym" | "physio" | "pos";

function addDaysToIso(isoDate: string, days: number): string {
  const parts = isoDate.split("-").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return isoDate;
  const dt = new Date(Date.UTC(parts[0] ?? 2026, (parts[1] ?? 1) - 1, (parts[2] ?? 1) + days));
  return dt.toISOString().slice(0, 10);
}

type BranchDraftCourt = {
  id: string;
  name: string;
  enableHalfCourts: boolean;
  fullCourtHourlyRate: string;
  halfCourtHourlyRate: string;
  operatingHours: string;
};

function VescioNexusHub() {
  const { db, setEntity, cascadeBranchAndCourtRename } = useDB();
  const currentUser = useTenantUser();

  const [activeModule, setActiveModule] = useState<VescioNexusModuleTab>("hub");
  const [branchFilter, setBranchFilter] = useState<string>("All");
  const [isFullScreen, setIsFullScreen] = useState(false);

  const isLaunchedModule =
    activeModule === "courts" ||
    activeModule === "gym" ||
    activeModule === "physio" ||
    activeModule === "pos";

  const branches = useMemo(() => db.branches || [], [db.branches]);
  const players = useMemo(() => db.players || [], [db.players]);
  const stock = useMemo(() => db.stock || [], [db.stock]);
  const reservations = useMemo(() => db.courtReservations || [], [db.courtReservations]);
  const gymMembers = useMemo(() => db.gymMembers || [], [db.gymMembers]);
  const physioRecords = useMemo(() => db.physioRecords || [], [db.physioRecords]);
  const posCatalog = useMemo(
    () => (db.posCatalog && db.posCatalog.length > 0 ? db.posCatalog : DEFAULT_POS_CATALOG),
    [db.posCatalog],
  );
  const posTransactions = useMemo(() => db.posTransactions || [], [db.posTransactions]);

  const ledger = useMemo(() => db.ledger || [], [db.ledger]);

  const defaultBranchName = branches[0]?.name || "Main Branch";
  const activeScopedBranchName = branchFilter !== "All" ? branchFilter : defaultBranchName;

  const activeBranchObj = useMemo(
    () =>
      branches.find((b) => (b.name || "").toLowerCase() === activeScopedBranchName.toLowerCase()) ||
      branches[0],
    [branches, activeScopedBranchName],
  );

  // Scoped branches list (either all branches or the single selected branch)
  const scopedBranches = useMemo(
    () =>
      branchFilter === "All"
        ? branches
        : branches.filter((b) => (b.name || "").toLowerCase() === branchFilter.toLowerCase()),
    [branches, branchFilter],
  );

  // Filtered datasets by branch
  const filteredReservations = useMemo(
    () =>
      reservations
        .filter(
          (r) =>
            branchFilter === "All" || (r.branch || "").toLowerCase() === branchFilter.toLowerCase(),
        )
        .sort((a, b) => `${b.date}T${b.startTime}`.localeCompare(`${a.date}T${a.startTime}`)),
    [reservations, branchFilter],
  );

  const filteredGymMembers = useMemo(
    () =>
      gymMembers.filter(
        (m) =>
          branchFilter === "All" ||
          m.branchAccess === "All Branches" ||
          (m.branch || "").toLowerCase() === branchFilter.toLowerCase(),
      ),
    [gymMembers, branchFilter],
  );

  const filteredPhysioRecords = useMemo(
    () =>
      physioRecords.filter(
        (p) =>
          branchFilter === "All" || (p.branch || "").toLowerCase() === branchFilter.toLowerCase(),
      ),
    [physioRecords, branchFilter],
  );

  const filteredPosTransactions = useMemo(
    () =>
      posTransactions
        .filter(
          (tx) =>
            branchFilter === "All" ||
            (tx.branch || "").toLowerCase() === branchFilter.toLowerCase(),
        )
        .sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`)),
    [posTransactions, branchFilter],
  );

  const filteredLedger = useMemo(
    () =>
      ledger.filter(
        (l) =>
          branchFilter === "All" ||
          !l.branch ||
          l.branch.toLowerCase() === branchFilter.toLowerCase(),
      ),
    [ledger, branchFilter],
  );

  // Merge POS Catalog with live Academy Merchandise Stock items (scoped by selected branch)
  const unifiedPosCatalog = useMemo<PosCatalogItem[]>(() => {
    const baseItems = posCatalog.filter((c) => {
      if (c.active === false) return false;
      if (
        branchFilter !== "All" &&
        c.branch &&
        c.branch !== "All" &&
        c.branch.toLowerCase() !== branchFilter.toLowerCase()
      ) {
        return false;
      }
      return true;
    });
    const linkedStockIds = new Set(baseItems.map((b) => b.linkedStockId).filter(Boolean));
    const stockMapped: PosCatalogItem[] = stock
      .filter((s) => {
        if (linkedStockIds.has(s.id)) return false;
        if (
          branchFilter !== "All" &&
          s.branch &&
          s.branch !== "All" &&
          s.branch.toLowerCase() !== branchFilter.toLowerCase()
        ) {
          return false;
        }
        return true;
      })
      .map((s) => ({
        id: `stock-pos-${s.id}`,
        name: `${s.item}${s.variant ? ` (${s.variant})` : ""}`,
        category: "Uniforms & Merch" as const,
        price: Number(s.sellingPrice ?? s.price) || 25,
        stock: Number(s.stock) || 0,
        lowStockThreshold: Number(s.reorder) || 5,
        sku: `STK-${s.id.slice(-4).toUpperCase()}`,
        linkedStockId: s.id,
        branch: s.branch,
        active: true,
      }));
    return [...baseItems, ...stockMapped];
  }, [posCatalog, stock, branchFilter]);

  // =========================================================================
  // LIVE CROSS-MODULE KPI ENGINE & UNIFIED OPERATIONS FEED
  // =========================================================================
  const ecosystemKpis = useMemo(() => {
    const today = todayISO();
    const activeReservations = filteredReservations.filter((r) => r.status !== "Cancelled");
    const activeGymMembers = filteredGymMembers.filter((m) => m.status === "Active");
    const activeGymCount = activeGymMembers.length;
    const activeRehabCases = filteredPhysioRecords.filter(
      (r) => r.caseStatus !== "Discharged" && (r.medicalStatus !== "Fit" || r.rtpStage < 5),
    ).length;
    const todayCompletedPosTxs = filteredPosTransactions.filter(
      (tx) => tx.date === today && tx.status === "Completed",
    );
    const todayPosSales = todayCompletedPosTxs.reduce(
      (sum, tx) => sum + (Number(tx.total) || 0),
      0,
    );

    // Fast path: skip heavy Overview-only 14-day projections & feed aggregations when a specific module is active
    if (activeModule !== "hub") {
      return {
        today,
        todayTotalNexusRevenue: 0,
        todayCourtRevenue: 0,
        todayGymRevenue: 0,
        todayPhysioRevenue: 0,
        todayPosSales,
        todayPosTxCount: todayCompletedPosTxs.length,
        totalPosSales: 0,
        activeReservationsCount: activeReservations.length,
        todayCourtBookingsCount: 0,
        todayFullCourtCount: 0,
        todayHcaCount: 0,
        todayHcbCount: 0,
        totalConfiguredCourts: 1,
        courtUtilizationPct: 0,
        courtRevenueCollected: 0,
        courtPendingReceivables: 0,
        activeGymCount,
        activeCoachPoolsCount: 0,
        todayGymCheckIns: 0,
        gymMonthlyRevenue: 0,
        injuredOrLimitedPlayers: 0,
        activeRehabCases,
        todayPhysioApptsCount: 0,
        totalPhysioRooms: 1,
        physioRoomUtilizationPct: 0,
        lowStockAlertsCount: 0,
        todayCourtBookings: [],
        upcomingCourtBookings: [],
        unifiedTodayPhysioSessions: [],
        expiringGymPackages: [],
        lowStockPosItems: [],
        activeOffDays: [],
      };
    }

    const sevenDaysOut = addDaysToIso(today, 7);

    // 1. COURTS & FACILITY RESERVATIONS METRICS (including active Continuous Weekly projections)
    const todayCourtBookings = projectCourtReservationsForDate(today, activeReservations, {
      branchFilter,
      branches: scopedBranches,
    });

    const upcomingHorizonProjected = Array.from({ length: 14 }, (_, offset) => {
      const targetIso = addDaysToIso(today, offset);
      return projectCourtReservationsForDate(targetIso, activeReservations, {
        branchFilter,
        branches: scopedBranches,
      });
    }).flat();

    const projectedIdSet = new Set(upcomingHorizonProjected.map((r) => r.id));
    const beyondHorizonConcrete = activeReservations.filter(
      (r) => r.date > addDaysToIso(today, 13) && !projectedIdSet.has(r.id),
    );
    const upcomingCourtBookings = [...upcomingHorizonProjected, ...beyondHorizonConcrete].sort(
      (a, b) => `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`),
    );

    const todayFullCourtCount = todayCourtBookings.filter(
      (r) => r.courtAllocation === "Full Court",
    ).length;
    const todayHcaCount = todayCourtBookings.filter(
      (r) => r.courtAllocation === "Half Court - HCA",
    ).length;
    const todayHcbCount = todayCourtBookings.filter(
      (r) => r.courtAllocation === "Half Court - HCB",
    ).length;

    const totalConfiguredCourts = Math.max(
      1,
      scopedBranches.reduce((acc, b) => acc + (b.courts?.length || b.courtsCount || 1), 0),
    );
    // Calculate court utilization % based on Full Court equivalent hours booked today vs 14 operating hrs/court
    const todayEquivalentFullCourtHours = todayCourtBookings.reduce((sum, r) => {
      const hrs = Math.max(0.25, Number(r.durationHours) || 1);
      const weight = r.courtAllocation === "Full Court" ? 1 : 0.5;
      return sum + hrs * weight;
    }, 0);
    const availableCourtHoursToday = totalConfiguredCourts * 14;
    const courtUtilizationPct = Math.min(
      100,
      Math.round((todayEquivalentFullCourtHours / Math.max(1, availableCourtHoursToday)) * 100),
    );

    const courtRevenueCollected = activeReservations.reduce(
      (sum, r) => sum + (Number(r.paidAmount) || 0),
      0,
    );
    const courtPendingReceivables = activeReservations.reduce(
      (sum, r) => sum + Math.max(0, (Number(r.totalAmount) || 0) - (Number(r.paidAmount) || 0)),
      0,
    );
    const todayCourtRevenueFromBookings = activeReservations
      .filter((r) => r.date === today || (r.cashedInAt && r.cashedInAt.slice(0, 10) === today))
      .reduce((sum, r) => sum + (Number(r.paidAmount) || 0), 0);
    const todayCourtRevenueFromLedger = filteredLedger
      .filter(
        (l) =>
          l.date === today &&
          l.type === "Revenue" &&
          l.status !== "Pending" &&
          ((l.category || "").toLowerCase().includes("court") ||
            (l.account || "").toLowerCase().includes("court")),
      )
      .reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
    const todayCourtRevenue = Math.max(todayCourtRevenueFromBookings, todayCourtRevenueFromLedger);

    // Active & Upcoming Off Days across scoped branches
    const activeOffDays = scopedBranches
      .flatMap((b) =>
        (b.offDays || []).map((od) => ({
          ...od,
          branchName: b.name,
        })),
      )
      .filter((od) => od.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date));

    // 2. GYM & STRENGTH METRICS
    const scopedGymCoaches = scopedBranches.flatMap((b) => b.gymCoaches || []);
    const activeCoachPoolsCount = scopedGymCoaches.filter(
      (c) => c.isClientEnabled && (c.sessionsRemaining || 0) > 0,
    ).length;

    const scopedGymScheduleSlots = scopedBranches.flatMap((b) => b.gymBookings || []);
    const todayGymSlotsCheckedIn = scopedGymScheduleSlots.filter(
      (s) => s.date === today && (s.status === "Checked In" || s.status === "Completed"),
    ).length;

    const memberCheckInsTodayCount = filteredGymMembers.reduce((sum, m) => {
      const histCount = (m.checkInHistory || []).filter((h) => h.date === today).length;
      if (histCount > 0) return sum + histCount;
      return sum + (m.lastCheckInDate === today ? 1 : 0);
    }, 0);
    const coachPoolCheckInsTodayCount = scopedGymCoaches.reduce(
      (sum, c) => sum + (c.checkInHistory || []).filter((h) => h.date === today).length,
      0,
    );
    const todayGymCheckIns = Math.max(
      todayGymSlotsCheckedIn,
      memberCheckInsTodayCount + coachPoolCheckInsTodayCount,
    );

    const gymMonthlyRevenue = activeGymMembers.reduce(
      (sum, m) => sum + (Number(m.monthlyFee) || 0),
      0,
    );

    const todayGymRevenueFromLedger = filteredLedger
      .filter(
        (l) =>
          l.date === today &&
          l.type === "Revenue" &&
          l.status !== "Pending" &&
          ((l.category || "").toLowerCase().includes("gym") ||
            (l.account || "").toLowerCase().includes("gym")),
      )
      .reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
    const todayGymRevenueFromEnrollments = filteredGymMembers
      .filter((m) => m.startDate === today && (m.balance || 0) === 0)
      .reduce((sum, m) => sum + (Number(m.monthlyFee) || 0), 0);
    const todayGymRevenue = Math.max(todayGymRevenueFromLedger, todayGymRevenueFromEnrollments);

    // Expiring or low-session gym packages
    const expiringGymPackages = filteredGymMembers
      .filter((m) => {
        if (m.status === "Expired") return true;
        const lowSessions =
          typeof m.sessionsRemaining === "number" &&
          (m.totalSessionsIncluded ?? 0) < 900 &&
          m.sessionsRemaining <= 2;
        const expiringSoon = Boolean(m.expiryDate && m.expiryDate <= sevenDaysOut);
        return lowSessions || expiringSoon;
      })
      .sort((a, b) => (a.expiryDate || "").localeCompare(b.expiryDate || ""));

    // 3. PHYSIOTHERAPY & MEDICAL METRICS
    const scopedPlayers = players.filter(
      (p) =>
        branchFilter === "All" || (p.branch || "").toLowerCase() === branchFilter.toLowerCase(),
    );
    const injuredOrLimitedPlayers = scopedPlayers.filter(
      (p) => p.medicalStatus === "Injured" || p.medicalStatus === "Limited",
    ).length;

    const branchPhysioAppointments = scopedBranches
      .flatMap((b) =>
        (b.physioAppointments || []).map((appt) => ({
          ...appt,
          branch: appt.branch || b.name,
        })),
      )
      .filter((a) => a.status !== "Cancelled");

    const todayPhysioAppointments = branchPhysioAppointments
      .filter((a) => a.date === today)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));

    const todayRecordSessions = filteredPhysioRecords.flatMap((rec) =>
      (rec.treatmentSessions || [])
        .filter((s) => s.date === today && s.status !== "Cancelled")
        .map((s) => ({
          id: s.id,
          branch: rec.branch,
          patientName: rec.patientName,
          practitionerName: s.therapistName || rec.therapistName,
          roomName: s.roomName || "Treatment Room 1",
          date: s.date,
          startTime: s.time || "09:00",
          endTime: s.endTime || "09:45",
          modality: s.modality,
          status: s.status || "Completed",
          fee: s.fee,
          paymentStatus: s.paymentStatus,
        })),
    );

    // Unified today's physio sessions list (deduplicated by appointment ID)
    const seenApptIds = new Set(todayPhysioAppointments.map((a) => a.id));
    const unifiedTodayPhysioSessions = [
      ...todayPhysioAppointments.map((a) => ({
        id: a.id,
        branch: a.branch,
        patientName: a.patientName,
        practitionerName: a.practitionerName,
        roomName: a.roomName || "Treatment Room 1",
        date: a.date,
        startTime: a.startTime,
        endTime: a.endTime,
        modality: a.modality,
        status: a.status,
        fee: a.fee,
        paymentStatus: a.paymentStatus,
      })),
      ...todayRecordSessions.filter((s) => !seenApptIds.has(s.id)),
    ].sort((a, b) => a.startTime.localeCompare(b.startTime));

    const todayPhysioApptsCount = unifiedTodayPhysioSessions.length;

    const totalPhysioRooms = Math.max(
      1,
      scopedBranches.reduce(
        (acc, b) => acc + (b.physioRooms?.length || b.physioRoomsCount || 2),
        0,
      ),
    );
    // Calculate room utilization % (based on distinct rooms used or session slots vs 8 daily slots/room)
    const distinctRoomsUsedToday = new Set(
      unifiedTodayPhysioSessions.map((s) => `${s.branch}::${s.roomName}`),
    ).size;
    const slotBasedRoomUtil = Math.round(
      (todayPhysioApptsCount / Math.max(1, totalPhysioRooms * 6)) * 100,
    );
    const activeRoomOccupancyPct =
      todayPhysioApptsCount > 0
        ? Math.max(
            slotBasedRoomUtil,
            Math.round((distinctRoomsUsedToday / Math.max(1, totalPhysioRooms)) * 100),
          )
        : 0;
    const physioRoomUtilizationPct = Math.min(100, activeRoomOccupancyPct);

    const todayPhysioRevenueFromSessions = unifiedTodayPhysioSessions
      .filter((s) => s.paymentStatus === "Paid")
      .reduce((sum, s) => sum + (Number(s.fee) || 0), 0);
    const todayPhysioRevenueFromLedger = filteredLedger
      .filter(
        (l) =>
          l.date === today &&
          l.type === "Revenue" &&
          l.status !== "Pending" &&
          ((l.category || "").toLowerCase().includes("physio") ||
            (l.account || "").toLowerCase().includes("physio")),
      )
      .reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
    const todayPhysioRevenue = Math.max(
      todayPhysioRevenueFromSessions,
      todayPhysioRevenueFromLedger,
    );

    // 4. KIOSK POS & INVENTORY METRICS
    const todayPosTxCount = todayCompletedPosTxs.length;
    const totalPosSales = filteredPosTransactions
      .filter((tx) => tx.status === "Completed")
      .reduce((sum, tx) => sum + (Number(tx.total) || 0), 0);

    const lowStockPosItems = unifiedPosCatalog
      .filter((item) => {
        const threshold = item.lowStockThreshold ?? 10;
        if (threshold <= 0 || item.stock >= 900) return false;
        return item.stock <= threshold;
      })
      .sort((a, b) => a.stock - b.stock);

    const lowStockAlertsCount = lowStockPosItems.length;

    // 5. TODAY'S TOTAL VESCIO NEXUS REVENUE (Combined across all 4 pillars)
    const todayTotalNexusRevenue =
      Math.round((todayCourtRevenue + todayGymRevenue + todayPhysioRevenue + todayPosSales) * 100) /
      100;

    return {
      today,
      todayTotalNexusRevenue,
      todayCourtRevenue,
      todayGymRevenue,
      todayPhysioRevenue,
      todayPosSales,
      todayPosTxCount,
      totalPosSales,
      activeReservationsCount: activeReservations.length,
      todayCourtBookingsCount: todayCourtBookings.length,
      todayFullCourtCount,
      todayHcaCount,
      todayHcbCount,
      totalConfiguredCourts,
      courtUtilizationPct,
      courtRevenueCollected,
      courtPendingReceivables,
      activeGymCount,
      activeCoachPoolsCount,
      todayGymCheckIns,
      gymMonthlyRevenue,
      injuredOrLimitedPlayers,
      activeRehabCases,
      todayPhysioApptsCount,
      totalPhysioRooms,
      physioRoomUtilizationPct,
      lowStockAlertsCount,
      // Feed collections
      todayCourtBookings,
      upcomingCourtBookings,
      unifiedTodayPhysioSessions,
      expiringGymPackages,
      lowStockPosItems,
      activeOffDays,
    };
  }, [
    activeModule,
    filteredReservations,
    filteredGymMembers,
    filteredPhysioRecords,
    filteredPosTransactions,
    filteredLedger,
    unifiedPosCatalog,
    scopedBranches,
    players,
    branchFilter,
  ]);

  // Daily Register Summary for POS (computed only on Overview Hub)
  const posDailyRegister = useMemo(() => {
    if (activeModule !== "hub") {
      return {
        count: 0,
        cashTotal: 0,
        cardTotal: 0,
        accountChargeTotal: 0,
        grandTotal: 0,
      };
    }
    const today = todayISO();
    const todayTxs = filteredPosTransactions.filter(
      (t) => t.date === today && t.status === "Completed",
    );
    const cashTotal = todayTxs.reduce((s, t) => {
      if (t.paymentMethod === "Cash") return s + t.total;
      if (t.paymentMethod === "Split Payment") return s + (Number(t.splitCashAmount) || 0);
      return s;
    }, 0);
    const cardTotal = todayTxs.reduce((s, t) => {
      if (t.paymentMethod === "Card") return s + t.total;
      if (t.paymentMethod === "Split Payment") return s + (Number(t.splitCardAmount) || 0);
      return s;
    }, 0);
    const accountChargeTotal = todayTxs.reduce((s, t) => {
      if (t.paymentMethod === "Charge to Account") return s + t.total;
      if (t.paymentMethod === "Split Payment") return s + (Number(t.splitAccountAmount) || 0);
      return s;
    }, 0);
    return {
      count: todayTxs.length,
      cashTotal: Math.round(cashTotal * 100) / 100,
      cardTotal: Math.round(cardTotal * 100) / 100,
      accountChargeTotal: Math.round(accountChargeTotal * 100) / 100,
      grandTotal: Math.round((cashTotal + cardTotal + accountChargeTotal) * 100) / 100,
    };
  }, [activeModule, filteredPosTransactions]);

  // =========================================================================
  // NEXUS BRANCHES MANAGEMENT STATE & CRUD
  // =========================================================================
  const [branchModalOpen, setBranchModalOpen] = useState(false);
  const [editingBranchId, setEditingBranchId] = useState<string | null>(null);
  const [branchForm, setBranchForm] = useState<{
    name: string;
    city: string;
    address: string;
    manager: string;
    phone: string;
    operatingHours: string;
    courts: BranchDraftCourt[];
    gymCapacity: string;
    gymEquipmentNotes: string;
    gymDefaultMonthlyFee: string;
    physioRoomsCount: string;
    leadPhysiotherapist: string;
    physioClinicStatus: "Open" | "By Appointment" | "Closed";
    posRegisterName: string;
    posStartingFloat: string;
    posStatus: "Open" | "Closed";
  }>({
    name: "",
    city: "Beirut",
    address: "",
    manager: currentUser?.name || "Branch Manager",
    phone: "",
    operatingHours: "08:00 - 22:30",
    courts: [
      {
        id: uid("crt"),
        name: "Court 1",
        enableHalfCourts: true,
        fullCourtHourlyRate: "60",
        halfCourtHourlyRate: "35",
        operatingHours: "08:00 - 22:30",
      },
    ],
    gymCapacity: "30",
    gymEquipmentNotes: "4 Squat Racks, Sled Turf Track, Dumbbells 2-50kg, Plyo Boxes",
    gymDefaultMonthlyFee: "65",
    physioRoomsCount: "2",
    leadPhysiotherapist: "Dr. Rami Khoury (PT)",
    physioClinicStatus: "Open",
    posRegisterName: "Main Kiosk Terminal #1",
    posStartingFloat: "200",
    posStatus: "Open",
  });

  const openCreateBranchModal = () => {
    setEditingBranchId(null);
    setBranchForm({
      name: "",
      city: "Beirut",
      address: "",
      manager: currentUser?.name || "Branch Manager",
      phone: "",
      operatingHours: "08:00 - 22:30",
      courts: [
        {
          id: uid("crt"),
          name: "Court 1",
          enableHalfCourts: true,
          fullCourtHourlyRate: "60",
          halfCourtHourlyRate: "35",
          operatingHours: "08:00 - 22:30",
        },
      ],
      gymCapacity: "30",
      gymEquipmentNotes: "4 Squat Racks, Sled Turf Track, Dumbbells 2-50kg, Plyo Boxes",
      gymDefaultMonthlyFee: "65",
      physioRoomsCount: "2",
      leadPhysiotherapist: "Dr. Rami Khoury (PT)",
      physioClinicStatus: "Open",
      posRegisterName: "Main Kiosk Terminal #1",
      posStartingFloat: "200",
      posStatus: "Open",
    });
    setBranchModalOpen(true);
  };

  const openEditBranchModal = (b: Branch) => {
    setEditingBranchId(b.id);
    const existingCourts: BranchDraftCourt[] =
      b.courts && b.courts.length > 0
        ? b.courts.map((c, idx) => ({
            id: c.id || uid(`crt-${idx}`),
            name: c.name || `Court ${idx + 1}`,
            enableHalfCourts: c.enableHalfCourts !== false,
            fullCourtHourlyRate: String(c.fullCourtHourlyRate ?? b.rentalRate ?? 60),
            halfCourtHourlyRate: String(
              c.halfCourtHourlyRate ?? Math.round((c.fullCourtHourlyRate ?? 60) * 0.6),
            ),
            operatingHours: c.operatingHours || b.operatingHours || "08:00 - 22:30",
          }))
        : [
            {
              id: uid("crt"),
              name: "Court 1",
              enableHalfCourts: true,
              fullCourtHourlyRate: "60",
              halfCourtHourlyRate: "35",
              operatingHours: b.operatingHours || "08:00 - 22:30",
            },
          ];

    setBranchForm({
      name: b.name || "",
      city: b.city || "Beirut",
      address: b.address || "",
      manager: b.manager || currentUser?.name || "Branch Manager",
      phone: b.phone || "",
      operatingHours: b.operatingHours || "08:00 - 22:30",
      courts: existingCourts,
      gymCapacity: String(b.gymCapacity ?? 30),
      gymEquipmentNotes:
        b.gymEquipmentNotes || "4 Squat Racks, Sled Turf Track, Dumbbells 2-50kg, Plyo Boxes",
      gymDefaultMonthlyFee: String(b.gymDefaultMonthlyFee ?? 65),
      physioRoomsCount: String(b.physioRoomsCount ?? 2),
      leadPhysiotherapist: b.leadPhysiotherapist || "Dr. Rami Khoury (PT)",
      physioClinicStatus: b.physioClinicStatus || "Open",
      posRegisterName: b.posRegisterName || `${b.name} Kiosk Terminal #1`,
      posStartingFloat: String(b.posStartingFloat ?? 200),
      posStatus: b.posStatus || "Open",
    });
    setBranchModalOpen(true);
  };

  const handleSaveBranch = async () => {
    if (!branchForm.name.trim()) {
      toast.error("Please enter a branch name.");
      return;
    }
    const existingBranch = editingBranchId
      ? branches.find((b) => b.id === editingBranchId)
      : undefined;

    const courtRenames: Record<string, string> = {};
    const preservedOldCourtIds = new Set<string>();
    const preservedOldCourtNamesLower = new Set<string>();

    const normalizedCourts: Court[] =
      branchForm.courts.length > 0
        ? branchForm.courts.map((c, idx) => {
            const byId = existingBranch?.courts?.find((pc) => pc.id && pc.id === c.id);
            const byName = !byId
              ? existingBranch?.courts?.find(
                  (pc) => pc.name.trim().toLowerCase() === c.name.trim().toLowerCase(),
                )
              : undefined;
            const prevCourt = byId || byName;
            const nextCourtName = c.name.trim() || `Court ${idx + 1}`;
            if (prevCourt) {
              if (prevCourt.id) preservedOldCourtIds.add(prevCourt.id);
              preservedOldCourtNamesLower.add(prevCourt.name.trim().toLowerCase());
              if (
                prevCourt.name.trim() &&
                prevCourt.name.trim().toLowerCase() !== nextCourtName.toLowerCase()
              ) {
                courtRenames[prevCourt.name.trim()] = nextCourtName;
              }
            }
            const fullRate = Math.max(0, Number(c.fullCourtHourlyRate) || 60);
            const halfRate = Math.max(0, Number(c.halfCourtHourlyRate) || 35);
            return {
              ...prevCourt,
              id: c.id || uid(`crt-${idx}`),
              name: nextCourtName,
              contact: prevCourt?.contact || branchForm.manager.trim() || "Facility Desk",
              phone: prevCourt?.phone || branchForm.phone.trim() || "",
              operatingHours: c.operatingHours.trim() || branchForm.operatingHours.trim(),
              enableHalfCourts: c.enableHalfCourts,
              fullCourtHourlyRate: fullRate,
              halfCourtHourlyRate: halfRate,
              feeType: "per_hour",
              feeAmount: fullRate,
            };
          })
        : [
            {
              id: uid("crt"),
              name: "Court 1",
              contact: branchForm.manager.trim() || "Facility Desk",
              phone: branchForm.phone.trim() || "",
              operatingHours: branchForm.operatingHours.trim() || "08:00 - 22:30",
              enableHalfCourts: true,
              fullCourtHourlyRate: 60,
              halfCourtHourlyRate: 35,
              feeType: "per_hour",
              feeAmount: 60,
            },
          ];

    const removedCourtNames: string[] = (existingBranch?.courts || [])
      .filter((pc) => {
        const matchedById = Boolean(pc.id && preservedOldCourtIds.has(pc.id));
        const matchedByName = preservedOldCourtNamesLower.has(pc.name.trim().toLowerCase());
        return !matchedById && !matchedByName;
      })
      .map((pc) => pc.name.trim())
      .filter(Boolean);

    const branchRecord: Branch = {
      ...(existingBranch || {
        teams: 0,
        players: 0,
      }),
      id: editingBranchId || uid("br"),
      name: branchForm.name.trim(),
      city: branchForm.city.trim() || "Beirut",
      address: branchForm.address.trim() || branchForm.city.trim() || "Main Facility Campus",
      manager: branchForm.manager.trim() || "Branch Manager",
      phone: branchForm.phone.trim() || undefined,
      operatingHours: branchForm.operatingHours.trim() || "08:00 - 22:30",
      courtsCount: normalizedCourts.length,
      courts: normalizedCourts,
      rentalType: existingBranch?.rentalType || "Per session",
      rentalRate: normalizedCourts[0]?.fullCourtHourlyRate ?? 60,
      gymCapacity: Math.max(1, Number(branchForm.gymCapacity) || 30),
      gymEquipmentNotes: branchForm.gymEquipmentNotes.trim() || undefined,
      gymDefaultMonthlyFee: Math.max(0, Number(branchForm.gymDefaultMonthlyFee) || 65),
      physioRoomsCount: Math.max(1, Number(branchForm.physioRoomsCount) || 2),
      leadPhysiotherapist: branchForm.leadPhysiotherapist.trim() || "Lead Physiotherapist",
      physioClinicStatus: branchForm.physioClinicStatus,
      posRegisterName:
        branchForm.posRegisterName.trim() || `${branchForm.name.trim()} Kiosk Register #1`,
      posStartingFloat: Math.max(0, Number(branchForm.posStartingFloat) || 200),
      posStatus: branchForm.posStatus,
    };

    try {
      if (existingBranch) {
        const { updatedRecordsCount } = await cascadeBranchAndCourtRename({
          branchId: branchRecord.id,
          updatedBranch: branchRecord,
          oldBranchName: existingBranch.name,
          newBranchName: branchRecord.name,
          courtRenames,
          removedCourtNames,
          fallbackCourtName: normalizedCourts[0]?.name || "Court 1",
        });
        setBranchFilter(branchRecord.name);
        setBranchModalOpen(false);
        toast.success(
          updatedRecordsCount > 0
            ? `Updated Nexus Branch "${branchRecord.name}" and cascaded changes across ${updatedRecordsCount} linked record(s).`
            : `Updated Nexus Branch "${branchRecord.name}" configuration.`,
        );
      } else {
        await setEntity("branches", branchRecord);
        setBranchFilter(branchRecord.name);
        setBranchModalOpen(false);
        toast.success(`Created Nexus Branch "${branchRecord.name}" and switched active view.`);
      }
    } catch {
      /* Error toast handled by data-store */
    }
  };

  const handleSaveNexusBranch = handleSaveBranch;

  // =========================================================================
  // EXTERNAL QUICK-ACTION TRIGGERS FOR SUB-MODULES
  // =========================================================================
  const [courtNewBookingTrigger, setCourtNewBookingTrigger] = useState(0);
  const [gymModalOpen, setGymModalOpen] = useState(false);
  const [physioIntakeOpen, setPhysioIntakeOpen] = useState(false);
  const [opsFeedFilter, setOpsFeedFilter] = useState<
    "all" | "courts" | "physio" | "gym" | "pos" | "offdays"
  >("all");

  // Exit Full Screen when pressing Escape (only when no modal dialog is open)
  useEffect(() => {
    if (!isFullScreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (branchModalOpen || gymModalOpen || physioIntakeOpen) return;
      const openModalEl = document.querySelector(
        '[role="dialog"], [aria-modal="true"], .fixed.inset-0.z-50:not([data-nexus-fullscreen="true"])',
      );
      if (openModalEl) return;
      setIsFullScreen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isFullScreen, branchModalOpen, gymModalOpen, physioIntakeOpen]);

  // Reset full-screen mode if returning to Overview or Branches
  useEffect(() => {
    if (!isLaunchedModule && isFullScreen) {
      setIsFullScreen(false);
    }
  }, [isLaunchedModule, isFullScreen]);

  const activeModuleMeta = useMemo(() => {
    switch (activeModule) {
      case "courts":
        return {
          title: "Court & Facility Reservations",
          shortTitle: "Courts",
          icon: Calendar,
          badgeTone: "bg-court-500/20 text-court-300 ring-court-500/40",
        };
      case "gym":
        return {
          title: "Gym & Strength",
          shortTitle: "Gym",
          icon: Dumbbell,
          badgeTone: "bg-sky-500/20 text-sky-300 ring-sky-500/40",
        };
      case "physio":
        return {
          title: "Physiotherapy & Medical",
          shortTitle: "Physio",
          icon: HeartPulse,
          badgeTone: "bg-rose-500/20 text-rose-300 ring-rose-500/40",
        };
      case "pos":
        return {
          title: "Kiosk POS",
          shortTitle: "POS",
          icon: ShoppingCart,
          badgeTone: "bg-amber-500/20 text-amber-300 ring-amber-500/40",
        };
      default:
        return {
          title: "Vescio Nexus Overview",
          shortTitle: "Overview",
          icon: Layers,
          badgeTone: "bg-emerald-500/20 text-emerald-300 ring-emerald-500/40",
        };
    }
  }, [activeModule]);

  const ActiveModuleIcon = activeModuleMeta.icon;

  return (
    <div
      data-nexus-fullscreen={isFullScreen && isLaunchedModule ? "true" : undefined}
      className={
        isFullScreen && isLaunchedModule
          ? "fixed inset-0 z-50 bg-background bg-ink-950 text-ink-100 overflow-y-auto overflow-x-hidden flex flex-col"
          : "min-h-screen w-full max-w-full overflow-x-hidden bg-ink-950 text-ink-100 flex flex-col"
      }
    >
      {/* =================================================================== */}
      {/* TOP HEADER BAR:                                                     */}
      {/* 1) Standalone Full-Screen Minimal Sticky Bar                        */}
      {/* 2) Compact Single-Row Module Top Bar (when a module is active)      */}
      {/* 3) Full Overview Hub Header (when on Overview / Branches)           */}
      {/* =================================================================== */}
      {isFullScreen && isLaunchedModule ? (
        <header className="sticky top-0 z-30 w-full max-w-full border-b border-ink-800 bg-ink-950/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-2.5 px-4 py-2 lg:px-8">
            <div className="flex min-w-0 items-center gap-2.5">
              <div
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-md ring-1 ${activeModuleMeta.badgeTone}`}
              >
                <ActiveModuleIcon className="h-4 w-4" />
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-display text-sm font-semibold tracking-tight text-ink-100">
                  {activeModuleMeta.title}
                </span>
                <span className="hidden sm:inline-flex rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-emerald-300 ring-1 ring-emerald-500/30">
                  Standalone Full Screen
                </span>
              </div>
            </div>

            <div className="ml-auto flex flex-wrap items-center gap-2">
              {/* Active Branch Selector */}
              <div className="flex items-center gap-1.5 rounded-md bg-ink-900 px-2.5 py-1 ring-1 ring-ink-800">
                <Building2 className="h-3.5 w-3.5 shrink-0 text-court-400" />
                <span className="hidden sm:inline font-mono text-[10px] uppercase tracking-wider text-ink-400">
                  Branch:
                </span>
                <select
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                  aria-label="Full Screen Nexus Branch Selector"
                  className="bg-transparent font-mono text-xs font-semibold text-ink-100 focus:outline-none"
                >
                  <option value="All" className="bg-ink-900">
                    All Branches ({branches.length})
                  </option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.name} className="bg-ink-900">
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => setIsFullScreen(false)}
                title="Exit Full Screen (Esc)"
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/20 px-3 py-1.5 font-mono text-xs font-bold text-emerald-200 ring-1 ring-emerald-500/40 transition-all hover:bg-emerald-500/30"
              >
                <Minimize2 className="h-3.5 w-3.5 shrink-0" />
                <span>Exit Full Screen / Back to Nexus</span>
              </button>
            </div>
          </div>
        </header>
      ) : isLaunchedModule ? (
        /* COMPACT SLIM SINGLE-ROW MODULE TOP BAR (No tall hero header) */
        <header className="sticky top-0 z-30 w-full max-w-full border-b border-ink-800 bg-ink-950/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-[1600px] flex-nowrap items-center justify-between gap-2 overflow-x-auto px-4 py-2 lg:px-8">
            <div className="flex shrink-0 items-center gap-1.5">
              {/* Quick <- Overview Button */}
              <button
                type="button"
                onClick={() => {
                  setIsFullScreen(false);
                  setActiveModule("hub");
                }}
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-ink-900 px-2.5 py-1.5 font-mono text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/35 transition-all hover:bg-emerald-500/15"
              >
                <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
                <span>Overview</span>
              </button>

              <div className="mx-1 h-4 w-px bg-ink-800" />

              {/* Compact Module Switcher Tabs */}
              <button
                type="button"
                onClick={() => setActiveModule("courts")}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 font-mono text-xs font-semibold transition-all ${
                  activeModule === "courts"
                    ? "bg-court-500/20 text-court-300 ring-1 ring-court-500/40"
                    : "text-ink-300 hover:bg-ink-850 hover:text-ink-100"
                }`}
              >
                <Calendar className="h-3.5 w-3.5 shrink-0" />
                <span>Courts</span>
                <span className="rounded bg-ink-950/80 px-1.5 py-0.5 text-[10px] text-court-300">
                  {ecosystemKpis.activeReservationsCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveModule("gym")}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 font-mono text-xs font-semibold transition-all ${
                  activeModule === "gym"
                    ? "bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40"
                    : "text-ink-300 hover:bg-ink-850 hover:text-ink-100"
                }`}
              >
                <Dumbbell className="h-3.5 w-3.5 shrink-0" />
                <span>Gym</span>
                <span className="rounded bg-ink-950/80 px-1.5 py-0.5 text-[10px] text-sky-300">
                  {ecosystemKpis.activeGymCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveModule("physio")}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 font-mono text-xs font-semibold transition-all ${
                  activeModule === "physio"
                    ? "bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/40"
                    : "text-ink-300 hover:bg-ink-850 hover:text-ink-100"
                }`}
              >
                <HeartPulse className="h-3.5 w-3.5 shrink-0" />
                <span>Physio</span>
                <span className="rounded bg-ink-950/80 px-1.5 py-0.5 text-[10px] text-rose-300">
                  {ecosystemKpis.activeRehabCases}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveModule("pos")}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 font-mono text-xs font-semibold transition-all ${
                  activeModule === "pos"
                    ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40"
                    : "text-ink-300 hover:bg-ink-850 hover:text-ink-100"
                }`}
              >
                <ShoppingCart className="h-3.5 w-3.5 shrink-0" />
                <span>Kiosk POS</span>
                <span className="rounded bg-ink-950/80 px-1.5 py-0.5 text-[10px] text-amber-300">
                  {money(ecosystemKpis.todayPosSales)}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsFullScreen(false);
                  setActiveModule("branches");
                }}
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 font-mono text-xs text-ink-300 transition-all hover:bg-ink-850 hover:text-ink-100"
              >
                <Building2 className="h-3.5 w-3.5 shrink-0 text-purple-400" />
                <span>Branches ({branches.length})</span>
              </button>
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-2">
              {/* Branch Filter */}
              <div className="flex items-center gap-1.5 rounded-md bg-ink-900 px-2.5 py-1 ring-1 ring-ink-800">
                <Building2 className="h-3.5 w-3.5 shrink-0 text-court-400" />
                <span className="hidden xl:inline font-mono text-[10px] uppercase tracking-wider text-ink-400">
                  Branch:
                </span>
                <select
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                  aria-label="Global Nexus Branch Selector"
                  className="bg-transparent font-mono text-xs font-semibold text-ink-100 focus:outline-none"
                >
                  <option value="All" className="bg-ink-900">
                    All Branches ({branches.length})
                  </option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.name} className="bg-ink-900">
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Standalone / Full-Screen Toggle Button */}
              <button
                type="button"
                onClick={() => setIsFullScreen(true)}
                title="Launch Standalone Full-Screen Mode"
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-ink-900 px-2.5 py-1.5 font-mono text-xs font-semibold text-emerald-300 ring-1 ring-emerald-500/35 transition-all hover:bg-emerald-500/15"
              >
                <Maximize2 className="h-3.5 w-3.5 shrink-0" />
                <span>Full Screen</span>
              </button>

              <Link
                to="/"
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-court-500 px-2.5 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-ink-950 shadow-sm ring-1 ring-court-400 transition-all hover:bg-court-400"
              >
                <ArrowLeft className="h-3.5 w-3.5 stroke-[2.5]" />
                <span className="hidden sm:inline">Back to Vector</span>
              </Link>
            </div>
          </div>
        </header>
      ) : (
        /* FULL OVERVIEW HUB HEADER (Rendered only on Overview / Branches) */
        <header className="sticky top-0 z-30 w-full max-w-full border-b border-ink-800 bg-ink-950/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-3 lg:px-8">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="grid h-9 w-11 shrink-0 place-items-center rounded-lg bg-emerald-500/10 ring-1 ring-emerald-500/30">
                <VescioNexusIcon className="h-4 w-7" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-display text-base font-semibold tracking-tight text-ink-100">
                    Nexus
                  </span>
                  <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-emerald-300 ring-1 ring-emerald-500/30">
                    MULTI-BRANCH HUB
                  </span>
                </div>
                <div className="truncate font-mono text-[10px] text-ink-400">
                  Synced with {db.academy?.name || "Vescio Vector"} Roster, Courts, Stock &amp;
                  Ledger
                </div>
              </div>
            </div>

            <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
              {/* Global Vescio Nexus Branch Selector Dropdown */}
              <div className="flex items-center gap-2 rounded-md bg-ink-900 px-2.5 py-1.5 ring-1 ring-ink-800">
                <Building2 className="h-3.5 w-3.5 shrink-0 text-court-400" />
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
                  Nexus Branch:
                </span>
                <select
                  value={branchFilter}
                  onChange={(e) => setBranchFilter(e.target.value)}
                  aria-label="Global Nexus Branch Selector"
                  className="bg-transparent font-mono text-xs font-semibold text-ink-100 focus:outline-none"
                >
                  <option value="All" className="bg-ink-900">
                    All Branches ({branches.length})
                  </option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.name} className="bg-ink-900">
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => setActiveModule("branches")}
                className="inline-flex items-center gap-1.5 rounded-md bg-ink-900 px-2.5 py-1.5 font-mono text-xs font-semibold text-court-300 ring-1 ring-court-500/30 hover:bg-court-500/15"
                title="Configure Nexus Branches, Courts, Gym Capacity, Physio Rooms & POS Registers"
              >
                <Settings className="h-3.5 w-3.5 text-court-400" />
                <span>Nexus Branches ({branches.length})</span>
              </button>

              {activeModule !== "hub" && (
                <button
                  type="button"
                  onClick={() => setActiveModule("hub")}
                  className="inline-flex items-center gap-1.5 rounded-md bg-ink-850 px-3 py-1.5 font-mono text-xs text-ink-200 ring-1 ring-ink-700 hover:bg-ink-800 hover:text-ink-100"
                >
                  <Layers className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Vescio Nexus Home</span>
                </button>
              )}
            </div>
          </div>

          {/* Module Navigation Sub-Bar (Compact Single-Row with Back to Vector on Far Right) */}
          <div className="w-full max-w-full border-t border-ink-800/80 bg-ink-900/60">
            <div className="mx-auto flex w-full max-w-[1600px] flex-nowrap items-center gap-1.5 overflow-x-auto px-4 py-2 lg:px-8">
              <button
                type="button"
                onClick={() => setActiveModule("hub")}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 font-mono text-xs font-semibold transition-all ${
                  activeModule === "hub"
                    ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
                    : "text-ink-300 hover:bg-ink-850 hover:text-ink-100"
                }`}
              >
                <Layers className="h-3.5 w-3.5 shrink-0" />
                <span>Nexus Overview</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveModule("branches")}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 font-mono text-xs font-semibold transition-all ${
                  activeModule === "branches"
                    ? "bg-purple-500/20 text-purple-300 ring-1 ring-purple-500/40"
                    : "text-ink-300 hover:bg-ink-850 hover:text-ink-100"
                }`}
              >
                <Building2 className="h-3.5 w-3.5 shrink-0" />
                <span>Branches</span>
                <span className="rounded bg-ink-950/80 px-1.5 py-0.5 text-[10px] text-purple-300">
                  {branches.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveModule("courts")}
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 font-mono text-xs font-semibold text-ink-300 transition-all hover:bg-ink-850 hover:text-ink-100"
              >
                <Calendar className="h-3.5 w-3.5 shrink-0" />
                <span>Court Reservation</span>
                <span className="rounded bg-ink-950/80 px-1.5 py-0.5 text-[10px] text-court-300">
                  {ecosystemKpis.activeReservationsCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveModule("gym")}
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 font-mono text-xs font-semibold text-ink-300 transition-all hover:bg-ink-850 hover:text-ink-100"
              >
                <Dumbbell className="h-3.5 w-3.5 shrink-0" />
                <span>Gym</span>
                <span className="rounded bg-ink-950/80 px-1.5 py-0.5 text-[10px] text-sky-300">
                  {ecosystemKpis.activeGymCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveModule("physio")}
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 font-mono text-xs font-semibold text-ink-300 transition-all hover:bg-ink-850 hover:text-ink-100"
              >
                <HeartPulse className="h-3.5 w-3.5 shrink-0" />
                <span>Physiotherapy</span>
                <span className="rounded bg-ink-950/80 px-1.5 py-0.5 text-[10px] text-rose-300">
                  {ecosystemKpis.activeRehabCases}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setActiveModule("pos")}
                className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 font-mono text-xs font-semibold text-ink-300 transition-all hover:bg-ink-850 hover:text-ink-100"
              >
                <ShoppingCart className="h-3.5 w-3.5 shrink-0" />
                <span>Kiosk POS</span>
                <span className="rounded bg-ink-950/80 px-1.5 py-0.5 text-[10px] text-amber-300">
                  {money(ecosystemKpis.todayPosSales)}
                </span>
              </button>

              <Link
                to="/"
                className="ml-auto inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md bg-court-500 px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-ink-950 shadow-sm ring-1 ring-court-400 transition-all hover:bg-court-400"
              >
                <ArrowLeft className="h-3.5 w-3.5 stroke-[2.5]" />
                <span>Back to Vector</span>
              </Link>
            </div>
          </div>
        </header>
      )}

      {/* =================================================================== */}
      {/* MAIN VESCIO NEXUS CONTENT CONTAINER                                 */}
      {/* =================================================================== */}
      <main
        className={`mx-auto w-full max-w-[1600px] min-w-0 flex-1 px-4 lg:px-8 ${
          isLaunchedModule ? "py-4 space-y-4" : "py-6 space-y-6"
        }`}
      >
        {/* ================================================================= */}
        {/* VIEW 0: VESCIO NEXUS EXECUTIVE COMMAND CENTER HUB (ONLY ON HUB)   */}
        {/* ================================================================= */}
        {activeModule === "hub" && (
          <div className="min-w-0 max-w-full space-y-6">
            {/* 1. LIVE CROSS-MODULE KPI STRIP (5 Executive Command Cards - ONLY ON OVERVIEW) */}
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {/* KPI 1: Today's Total Vescio Nexus Revenue */}
              <div className="flex min-w-0 flex-col justify-between rounded-xl border border-emerald-500/40 bg-gradient-to-br from-emerald-950/35 via-ink-900 to-ink-900 p-4 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-300">
                    Today&apos;s Nexus Revenue
                  </span>
                  <Wallet className="h-4 w-4 shrink-0 text-emerald-400" />
                </div>
                <div className="mt-2 font-display text-2xl font-bold tracking-tight text-ink-100">
                  {money(ecosystemKpis.todayTotalNexusRevenue)}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-ink-800/80 pt-2 font-mono text-[10px] text-ink-300">
                  <span>Courts {money(ecosystemKpis.todayCourtRevenue)}</span>
                  <span>·</span>
                  <span>Gym {money(ecosystemKpis.todayGymRevenue)}</span>
                  <span>·</span>
                  <span>Physio {money(ecosystemKpis.todayPhysioRevenue)}</span>
                  <span>·</span>
                  <span>POS {money(ecosystemKpis.todayPosSales)}</span>
                </div>
              </div>

              {/* KPI 2: Active Court Bookings Today & HCA/HCB/Full Utilization % */}
              <div className="flex min-w-0 flex-col justify-between rounded-xl border border-ink-800 bg-ink-900/90 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[10px] font-bold uppercase tracking-wider text-court-300">
                    Courts Today · Utilization
                  </span>
                  <Calendar className="h-4 w-4 shrink-0 text-court-400" />
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <span className="font-display text-2xl font-bold text-ink-100">
                    {ecosystemKpis.todayCourtBookingsCount} Bookings
                  </span>
                  <span className="rounded bg-court-500/20 px-1.5 py-0.5 font-mono text-xs font-bold text-court-300">
                    {ecosystemKpis.courtUtilizationPct}% Util.
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-1 border-t border-ink-800/80 pt-2 font-mono text-[10px] text-ink-400">
                  <span>
                    Full:{" "}
                    <strong className="text-ink-200">{ecosystemKpis.todayFullCourtCount}</strong> ·
                    HCA: <strong className="text-ink-200">{ecosystemKpis.todayHcaCount}</strong> ·
                    HCB: <strong className="text-ink-200">{ecosystemKpis.todayHcbCount}</strong>
                  </span>
                  <span>{ecosystemKpis.totalConfiguredCourts} court(s)</span>
                </div>
              </div>

              {/* KPI 3: Gym Check-Ins Today & Active Memberships */}
              <div className="flex min-w-0 flex-col justify-between rounded-xl border border-ink-800 bg-ink-900/90 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[10px] font-bold uppercase tracking-wider text-sky-300">
                    Gym Check-Ins &amp; Members
                  </span>
                  <Dumbbell className="h-4 w-4 shrink-0 text-sky-400" />
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <span className="font-display text-2xl font-bold text-ink-100">
                    {ecosystemKpis.todayGymCheckIns} Check-Ins
                  </span>
                  <span className="rounded bg-sky-500/20 px-1.5 py-0.5 font-mono text-xs font-bold text-sky-300">
                    {ecosystemKpis.activeGymCount} Active
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-1 border-t border-ink-800/80 pt-2 font-mono text-[10px] text-ink-400">
                  <span>{money(ecosystemKpis.gymMonthlyRevenue)}/mo recurring</span>
                  <span>{ecosystemKpis.activeCoachPoolsCount} Coach pool(s)</span>
                </div>
              </div>

              {/* KPI 4: Physiotherapy Appointments Today & Room Utilization */}
              <div className="flex min-w-0 flex-col justify-between rounded-xl border border-ink-800 bg-ink-900/90 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[10px] font-bold uppercase tracking-wider text-rose-300">
                    Physio Today · Room Util.
                  </span>
                  <HeartPulse className="h-4 w-4 shrink-0 text-rose-400" />
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <span className="font-display text-2xl font-bold text-ink-100">
                    {ecosystemKpis.todayPhysioApptsCount} Appts
                  </span>
                  <span className="rounded bg-rose-500/20 px-1.5 py-0.5 font-mono text-xs font-bold text-rose-300">
                    {ecosystemKpis.physioRoomUtilizationPct}% Rooms
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-1 border-t border-ink-800/80 pt-2 font-mono text-[10px] text-ink-400">
                  <span>{ecosystemKpis.activeRehabCases} active rehab cases</span>
                  <span>{ecosystemKpis.totalPhysioRooms} room(s)</span>
                </div>
              </div>

              {/* KPI 5: Kiosk POS Sales Today & Low-Stock Inventory Alerts */}
              <div className="flex min-w-0 flex-col justify-between rounded-xl border border-ink-800 bg-ink-900/90 p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300">
                    Kiosk POS &amp; Stock Alerts
                  </span>
                  <ShoppingCart className="h-4 w-4 shrink-0 text-amber-400" />
                </div>
                <div className="mt-2 flex items-baseline justify-between gap-2">
                  <span className="font-display text-2xl font-bold text-ink-100">
                    {money(ecosystemKpis.todayPosSales)}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 font-mono text-xs font-bold ${
                      ecosystemKpis.lowStockAlertsCount > 0
                        ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40"
                        : "bg-emerald-500/15 text-emerald-300"
                    }`}
                  >
                    {ecosystemKpis.lowStockAlertsCount} Low Stock
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-1 border-t border-ink-800/80 pt-2 font-mono text-[10px] text-ink-400">
                  <span>{ecosystemKpis.todayPosTxCount} order(s) today</span>
                  <span>Total: {money(ecosystemKpis.totalPosSales)}</span>
                </div>
              </div>
            </div>
            {/* Executive Command Banner + Active Branch Scope */}
            <div className="rounded-xl border border-emerald-500/30 bg-gradient-to-r from-ink-900 via-ink-900 to-emerald-950/40 p-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0 max-w-3xl space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-emerald-300 ring-1 ring-emerald-500/30">
                      <Sparkles className="h-3 w-3" />
                      <span>Vescio Nexus · Live Executive Command Center</span>
                    </span>
                    <span className="rounded-md bg-purple-500/20 px-2.5 py-1 font-mono text-[10px] font-bold text-purple-200 ring-1 ring-purple-500/30">
                      Scope:{" "}
                      {branchFilter === "All" ? `All Branches (${branches.length})` : branchFilter}
                    </span>
                    <span className="font-mono text-[10px] text-ink-400">
                      Date: {ecosystemKpis.today}
                    </span>
                  </div>
                  <h2 className="font-display text-xl sm:text-2xl tracking-tight text-ink-100">
                    Unified Multi-Branch Facility Operations &amp; Live Telemetry
                  </h2>
                  <p className="text-xs text-ink-300 leading-relaxed">
                    {activeBranchObj
                      ? `${activeBranchObj.name} (${activeBranchObj.city || "Beirut"}) · ${ecosystemKpis.totalConfiguredCourts} Court(s) · Gym Cap: ${activeBranchObj.gymCapacity ?? 30} athletes · Physio Rooms: ${ecosystemKpis.totalPhysioRooms} · POS Terminal: ${activeBranchObj.posRegisterName || "Main Kiosk #1"}`
                      : "All 4 facility pillars are synced in real time with Vescio Vector Roster, Courts, Merchandise Stock, and Financial Ledger."}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="ghost" onClick={openCreateBranchModal}>
                    + New Nexus Branch
                  </Button>
                  <Button variant="ghost" onClick={() => setActiveModule("branches")}>
                    <Building2 className="mr-1.5 h-3.5 w-3.5 text-purple-400" />
                    Configure Branches ({branches.length})
                  </Button>
                </div>
              </div>
            </div>

            {/* 2. MODULE LAUNCH CARDS (Clean, Non-Overflowing 4-Card Grid) */}
            <div className="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-4">
              {/* Card 1: Court & Facility Reservations */}
              <div className="flex min-w-0 flex-col justify-between rounded-xl border border-ink-800 bg-ink-900/90 p-4 transition-all hover:border-court-500/50">
                <div className="min-w-0 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-court-500/15 text-court-400 ring-1 ring-court-500/30">
                        <Calendar className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-mono text-[10px] uppercase tracking-wider text-court-400">
                          Module 01
                        </div>
                        <h3 className="truncate font-display text-base font-semibold text-ink-100">
                          Court &amp; Facility Reservations
                        </h3>
                      </div>
                    </div>
                    <Chip tone="court">{ecosystemKpis.courtUtilizationPct}% Util</Chip>
                  </div>

                  <p className="text-xs text-ink-300 leading-relaxed line-clamp-2">
                    15-min drag-to-book schedule (Full Court, HCA, HCB), snapshot-protected rates,
                    recurring series, Off Days, and direct Cash-In.
                  </p>

                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-ink-800 bg-ink-950/70 p-2.5 font-mono text-xs">
                    <div className="min-w-0">
                      <div className="truncate text-[10px] text-ink-400">Today Bookings</div>
                      <div className="mt-0.5 truncate font-semibold text-ink-100">
                        {ecosystemKpis.todayCourtBookingsCount} ({ecosystemKpis.todayFullCourtCount}
                        F · {ecosystemKpis.todayHcaCount}A · {ecosystemKpis.todayHcbCount}B)
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[10px] text-ink-400">Today Cash-In</div>
                      <div className="mt-0.5 truncate font-semibold text-emerald-400">
                        {money(ecosystemKpis.todayCourtRevenue)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[10px] text-ink-400">Total Collected</div>
                      <div className="mt-0.5 truncate font-semibold text-ink-200">
                        {money(ecosystemKpis.courtRevenueCollected)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[10px] text-ink-400">Open Receivables</div>
                      <div className="mt-0.5 truncate font-semibold text-amber-400">
                        {money(ecosystemKpis.courtPendingReceivables)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-ink-800 pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveModule("courts");
                      setCourtNewBookingTrigger((n) => n + 1);
                    }}
                    className="rounded-md bg-ink-850 px-2.5 py-1.5 font-mono text-[11px] font-semibold text-ink-200 ring-1 ring-ink-700 hover:bg-ink-800"
                  >
                    + New Booking
                  </button>
                  <Button onClick={() => setActiveModule("courts")}>Launch Courts →</Button>
                </div>
              </div>

              {/* Card 2: Gym & Strength */}
              <div className="flex min-w-0 flex-col justify-between rounded-xl border border-ink-800 bg-ink-900/90 p-4 transition-all hover:border-sky-500/50">
                <div className="min-w-0 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-sky-500/15 text-sky-400 ring-1 ring-sky-500/30">
                        <Dumbbell className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-mono text-[10px] uppercase tracking-wider text-sky-400">
                          Module 02
                        </div>
                        <h3 className="truncate font-display text-base font-semibold text-ink-100">
                          Gym &amp; Strength
                        </h3>
                      </div>
                    </div>
                    <Chip tone="info">{ecosystemKpis.activeGymCount} Active</Chip>
                  </div>

                  <p className="text-xs text-ink-300 leading-relaxed line-clamp-2">
                    Memberships &amp; PT session packs, Coach-as-Client session pools, front-desk
                    check-ins, workout logs, and renewal alerts.
                  </p>

                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-ink-800 bg-ink-950/70 p-2.5 font-mono text-xs">
                    <div className="min-w-0">
                      <div className="truncate text-[10px] text-ink-400">Today Check-Ins</div>
                      <div className="mt-0.5 truncate font-semibold text-sky-400">
                        {ecosystemKpis.todayGymCheckIns} athletes
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[10px] text-ink-400">Today Package Sales</div>
                      <div className="mt-0.5 truncate font-semibold text-emerald-400">
                        {money(ecosystemKpis.todayGymRevenue)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[10px] text-ink-400">Coach PT Pools</div>
                      <div className="mt-0.5 truncate font-semibold text-ink-200">
                        {ecosystemKpis.activeCoachPoolsCount} active
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[10px] text-ink-400">Expiring / Low</div>
                      <div
                        className={`mt-0.5 truncate font-semibold ${
                          ecosystemKpis.expiringGymPackages.length > 0
                            ? "text-amber-400"
                            : "text-emerald-400"
                        }`}
                      >
                        {ecosystemKpis.expiringGymPackages.length} alert(s)
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-ink-800 pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveModule("gym");
                      setGymModalOpen(true);
                    }}
                    className="rounded-md bg-ink-850 px-2.5 py-1.5 font-mono text-[11px] font-semibold text-ink-200 ring-1 ring-ink-700 hover:bg-ink-800"
                  >
                    + Enroll Client
                  </button>
                  <Button onClick={() => setActiveModule("gym")}>Launch Gym →</Button>
                </div>
              </div>

              {/* Card 3: Physiotherapy & Medical */}
              <div className="flex min-w-0 flex-col justify-between rounded-xl border border-ink-800 bg-ink-900/90 p-4 transition-all hover:border-rose-500/50">
                <div className="min-w-0 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/30">
                        <HeartPulse className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-mono text-[10px] uppercase tracking-wider text-rose-400">
                          Module 03
                        </div>
                        <h3 className="truncate font-display text-base font-semibold text-ink-100">
                          Physiotherapy &amp; Medical
                        </h3>
                      </div>
                    </div>
                    <Chip tone="warn">{ecosystemKpis.physioRoomUtilizationPct}% Rooms</Chip>
                  </div>

                  <p className="text-xs text-ink-300 leading-relaxed line-clamp-2">
                    Clinical intake, practitioner &amp; room scheduling, SOAP notes, 5-stage Return
                    to Play synced with Academy roster, and billing.
                  </p>

                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-ink-800 bg-ink-950/70 p-2.5 font-mono text-xs">
                    <div className="min-w-0">
                      <div className="truncate text-[10px] text-ink-400">Appointments Today</div>
                      <div className="mt-0.5 truncate font-semibold text-ink-100">
                        {ecosystemKpis.todayPhysioApptsCount} session(s)
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[10px] text-ink-400">Today Billing</div>
                      <div className="mt-0.5 truncate font-semibold text-emerald-400">
                        {money(ecosystemKpis.todayPhysioRevenue)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[10px] text-ink-400">Active Rehab Cases</div>
                      <div className="mt-0.5 truncate font-semibold text-rose-400">
                        {ecosystemKpis.activeRehabCases} case(s)
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[10px] text-ink-400">Roster Limited/Out</div>
                      <div className="mt-0.5 truncate font-semibold text-amber-400">
                        {ecosystemKpis.injuredOrLimitedPlayers} player(s)
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-ink-800 pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveModule("physio");
                      setPhysioIntakeOpen(true);
                    }}
                    className="rounded-md bg-ink-850 px-2.5 py-1.5 font-mono text-[11px] font-semibold text-ink-200 ring-1 ring-ink-700 hover:bg-ink-800"
                  >
                    + Patient Intake
                  </button>
                  <Button onClick={() => setActiveModule("physio")}>Launch Physio →</Button>
                </div>
              </div>

              {/* Card 4: Kiosk POS */}
              <div className="flex min-w-0 flex-col justify-between rounded-xl border border-ink-800 bg-ink-900/90 p-4 transition-all hover:border-amber-500/50">
                <div className="min-w-0 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30">
                        <ShoppingCart className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-mono text-[10px] uppercase tracking-wider text-amber-400">
                          Module 04
                        </div>
                        <h3 className="truncate font-display text-base font-semibold text-ink-100">
                          Kiosk POS
                        </h3>
                      </div>
                    </div>
                    <Chip tone="ok">EN / AR · Barcode</Chip>
                  </div>

                  <p className="text-xs text-ink-300 leading-relaxed line-clamp-2">
                    Bilingual EN/AR touch terminal, barcode scanner listener, split payments, real
                    time stock deduction, and Z-Report shift reconciliation.
                  </p>

                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-ink-800 bg-ink-950/70 p-2.5 font-mono text-xs">
                    <div className="min-w-0">
                      <div className="truncate text-[10px] text-ink-400">Sales Today</div>
                      <div className="mt-0.5 truncate font-semibold text-emerald-400">
                        {money(posDailyRegister.grandTotal)} ({posDailyRegister.count})
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[10px] text-ink-400">Cash / Card</div>
                      <div className="mt-0.5 truncate font-semibold text-ink-100">
                        {money(posDailyRegister.cashTotal + posDailyRegister.cardTotal)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[10px] text-ink-400">Account Charges</div>
                      <div className="mt-0.5 truncate font-semibold text-amber-400">
                        {money(posDailyRegister.accountChargeTotal)}
                      </div>
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-[10px] text-ink-400">Low-Stock Alerts</div>
                      <div
                        className={`mt-0.5 truncate font-semibold ${
                          ecosystemKpis.lowStockAlertsCount > 0
                            ? "text-rose-400"
                            : "text-emerald-400"
                        }`}
                      >
                        {ecosystemKpis.lowStockAlertsCount} item(s)
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-ink-800 pt-3">
                  <span className="truncate font-mono text-[10px] text-ink-400">
                    {unifiedPosCatalog.length} active SKUs
                  </span>
                  <Button onClick={() => setActiveModule("pos")}>Launch Kiosk POS →</Button>
                </div>
              </div>
            </div>

            {/* 3. UNIFIED OPERATIONS FEED: "Today's Schedule & Alerts" */}
            <div className="rounded-xl border border-ink-800 bg-ink-900/90 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-800 pb-3.5">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-emerald-300">
                      Unified Operations Feed
                    </span>
                  </div>
                  <h3 className="mt-0.5 font-display text-lg font-semibold text-ink-100">
                    Today&apos;s Schedule &amp; Alerts ({ecosystemKpis.today})
                  </h3>
                </div>

                {/* Filter Pills for the Unified Feed */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setOpsFeedFilter("all")}
                    className={`rounded-md px-2.5 py-1 font-mono text-xs font-semibold transition-all ${
                      opsFeedFilter === "all"
                        ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40"
                        : "bg-ink-950 text-ink-300 hover:bg-ink-850"
                    }`}
                  >
                    All Streams
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpsFeedFilter("courts")}
                    className={`rounded-md px-2.5 py-1 font-mono text-xs font-semibold transition-all ${
                      opsFeedFilter === "courts"
                        ? "bg-court-500/20 text-court-300 ring-1 ring-court-500/40"
                        : "bg-ink-950 text-ink-300 hover:bg-ink-850"
                    }`}
                  >
                    Court Bookings ({ecosystemKpis.upcomingCourtBookings.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpsFeedFilter("physio")}
                    className={`rounded-md px-2.5 py-1 font-mono text-xs font-semibold transition-all ${
                      opsFeedFilter === "physio"
                        ? "bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/40"
                        : "bg-ink-950 text-ink-300 hover:bg-ink-850"
                    }`}
                  >
                    Physio Sessions ({ecosystemKpis.todayPhysioApptsCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpsFeedFilter("gym")}
                    className={`rounded-md px-2.5 py-1 font-mono text-xs font-semibold transition-all ${
                      opsFeedFilter === "gym"
                        ? "bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40"
                        : "bg-ink-950 text-ink-300 hover:bg-ink-850"
                    }`}
                  >
                    Gym Expiring ({ecosystemKpis.expiringGymPackages.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpsFeedFilter("pos")}
                    className={`rounded-md px-2.5 py-1 font-mono text-xs font-semibold transition-all ${
                      opsFeedFilter === "pos"
                        ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40"
                        : "bg-ink-950 text-ink-300 hover:bg-ink-850"
                    }`}
                  >
                    POS Low Stock ({ecosystemKpis.lowStockAlertsCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpsFeedFilter("offdays")}
                    className={`rounded-md px-2.5 py-1 font-mono text-xs font-semibold transition-all ${
                      opsFeedFilter === "offdays"
                        ? "bg-purple-500/20 text-purple-300 ring-1 ring-purple-500/40"
                        : "bg-ink-950 text-ink-300 hover:bg-ink-850"
                    }`}
                  >
                    Off Days ({ecosystemKpis.activeOffDays.length})
                  </button>
                </div>
              </div>

              {/* Active Off Days Banner (Always highlighted when present and filter is all or offdays) */}
              {(opsFeedFilter === "all" || opsFeedFilter === "offdays") &&
                ecosystemKpis.activeOffDays.length > 0 && (
                  <div className="rounded-lg border border-purple-500/40 bg-purple-950/20 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 font-mono text-xs font-bold text-purple-300">
                        <Calendar className="h-4 w-4 text-purple-400" />
                        <span>
                          Active &amp; Upcoming Facility Off Days (
                          {ecosystemKpis.activeOffDays.length})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveModule("courts")}
                        className="font-mono text-[11px] font-semibold text-purple-300 hover:underline"
                      >
                        Manage Off Days →
                      </button>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {ecosystemKpis.activeOffDays.slice(0, 6).map((od) => (
                        <div
                          key={od.id}
                          className="inline-flex items-center gap-2 rounded-md border border-purple-500/30 bg-ink-950/90 px-2.5 py-1 font-mono text-xs"
                        >
                          <span className="font-bold text-purple-300">{od.date}</span>
                          <span className="text-ink-300">{od.branchName}</span>
                          <span className="text-ink-400">· {od.reason || "Facility Closed"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              {/* 4-Column Live Operational Feed Grid */}
              <div className="grid min-w-0 gap-4 lg:grid-cols-2 xl:grid-cols-4">
                {/* Stream 1: Upcoming & Today's Court Bookings */}
                {(opsFeedFilter === "all" || opsFeedFilter === "courts") && (
                  <div className="flex min-w-0 flex-col justify-between rounded-xl border border-ink-800 bg-ink-950/70 p-3.5 space-y-3">
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between border-b border-ink-800 pb-2">
                        <span className="font-mono text-xs font-bold text-court-300">
                          Upcoming Court Bookings
                        </span>
                        <span className="rounded bg-court-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-court-300">
                          {ecosystemKpis.upcomingCourtBookings.length}
                        </span>
                      </div>

                      {ecosystemKpis.upcomingCourtBookings.length === 0 ? (
                        <div className="py-6 text-center font-mono text-xs text-ink-400">
                          No upcoming court bookings for this branch scope.
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                          {ecosystemKpis.upcomingCourtBookings.slice(0, 6).map((r) => (
                            <div
                              key={r.id}
                              className="rounded-lg border border-ink-800 bg-ink-900/90 p-2.5 space-y-1"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate font-mono text-xs font-semibold text-ink-100">
                                  {r.clientName}
                                </span>
                                <span className="shrink-0 rounded bg-court-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-court-300">
                                  {r.courtAllocation === "Full Court"
                                    ? "FULL"
                                    : r.courtAllocation === "Half Court - HCA"
                                      ? "HCA"
                                      : "HCB"}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center justify-between gap-1 font-mono text-[11px] text-ink-300">
                                <span>
                                  {r.date === ecosystemKpis.today ? "Today" : r.date} ·{" "}
                                  {r.startTime}–{r.endTime}
                                </span>
                                <span className="text-ink-400">{r.court}</span>
                              </div>
                              <div className="flex items-center justify-between font-mono text-[10px]">
                                <span className="text-ink-400">{r.branch}</span>
                                <span
                                  className={
                                    r.paymentStatus === "Paid"
                                      ? "text-emerald-400 font-semibold"
                                      : "text-amber-400 font-semibold"
                                  }
                                >
                                  {r.paymentStatus} · {money(r.totalAmount)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setActiveModule("courts")}
                      className="w-full rounded-md bg-ink-900 py-1.5 text-center font-mono text-[11px] font-semibold text-court-300 ring-1 ring-ink-800 hover:bg-court-500/15"
                    >
                      Open Court Schedule →
                    </button>
                  </div>
                )}

                {/* Stream 2: Active & Today's Physio Sessions */}
                {(opsFeedFilter === "all" || opsFeedFilter === "physio") && (
                  <div className="flex min-w-0 flex-col justify-between rounded-xl border border-ink-800 bg-ink-950/70 p-3.5 space-y-3">
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between border-b border-ink-800 pb-2">
                        <span className="font-mono text-xs font-bold text-rose-300">
                          Active Physio Sessions
                        </span>
                        <span className="rounded bg-rose-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-rose-300">
                          {ecosystemKpis.unifiedTodayPhysioSessions.length} Today
                        </span>
                      </div>

                      {ecosystemKpis.unifiedTodayPhysioSessions.length === 0 &&
                      ecosystemKpis.activeRehabCases === 0 ? (
                        <div className="py-6 text-center font-mono text-xs text-ink-400">
                          No active physio appointments or rehab cases today.
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                          {ecosystemKpis.unifiedTodayPhysioSessions.slice(0, 5).map((s) => (
                            <div
                              key={s.id}
                              className="rounded-lg border border-ink-800 bg-ink-900/90 p-2.5 space-y-1"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate font-mono text-xs font-semibold text-ink-100">
                                  {s.patientName}
                                </span>
                                <span className="shrink-0 rounded bg-rose-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-rose-300">
                                  {s.status}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center justify-between gap-1 font-mono text-[11px] text-ink-300">
                                <span>
                                  {s.startTime}–{s.endTime} · {s.roomName}
                                </span>
                                <span className="truncate text-ink-400">{s.practitionerName}</span>
                              </div>
                              <div className="truncate font-mono text-[10px] text-ink-400">
                                {s.modality} · {money(s.fee)} ({s.paymentStatus})
                              </div>
                            </div>
                          ))}

                          {ecosystemKpis.unifiedTodayPhysioSessions.length === 0 &&
                            filteredPhysioRecords
                              .filter(
                                (r) =>
                                  r.caseStatus !== "Discharged" &&
                                  (r.medicalStatus !== "Fit" || r.rtpStage < 5),
                              )
                              .slice(0, 4)
                              .map((rec) => (
                                <div
                                  key={rec.id}
                                  className="rounded-lg border border-ink-800 bg-ink-900/90 p-2.5 space-y-1"
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="truncate font-mono text-xs font-semibold text-ink-100">
                                      {rec.patientName}
                                    </span>
                                    <span className="shrink-0 rounded bg-rose-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-rose-300">
                                      RTP {rec.rtpStage}/5 · {rec.medicalStatus}
                                    </span>
                                  </div>
                                  <div className="truncate font-mono text-[11px] text-ink-300">
                                    {rec.injuryArea} · {rec.diagnosis}
                                  </div>
                                  <div className="font-mono text-[10px] text-ink-400">
                                    PT: {rec.therapistName} · {rec.branch}
                                  </div>
                                </div>
                              ))}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setActiveModule("physio")}
                      className="w-full rounded-md bg-ink-900 py-1.5 text-center font-mono text-[11px] font-semibold text-rose-300 ring-1 ring-ink-800 hover:bg-rose-500/15"
                    >
                      Open Physiotherapy Clinic →
                    </button>
                  </div>
                )}

                {/* Stream 3: Gym Expiring Packages & Low-Session Alerts */}
                {(opsFeedFilter === "all" || opsFeedFilter === "gym") && (
                  <div className="flex min-w-0 flex-col justify-between rounded-xl border border-ink-800 bg-ink-950/70 p-3.5 space-y-3">
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between border-b border-ink-800 pb-2">
                        <span className="font-mono text-xs font-bold text-sky-300">
                          Gym Expiring Packages
                        </span>
                        <span className="rounded bg-sky-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-sky-300">
                          {ecosystemKpis.expiringGymPackages.length} Alert(s)
                        </span>
                      </div>

                      {ecosystemKpis.expiringGymPackages.length === 0 ? (
                        <div className="py-6 text-center font-mono text-xs text-ink-400">
                          All active gym memberships &amp; session packs are in good standing.
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                          {ecosystemKpis.expiringGymPackages.slice(0, 6).map((m) => {
                            const isLowSess =
                              typeof m.sessionsRemaining === "number" &&
                              (m.totalSessionsIncluded ?? 0) < 900 &&
                              m.sessionsRemaining <= 2;
                            return (
                              <div
                                key={m.id}
                                className="rounded-lg border border-ink-800 bg-ink-900/90 p-2.5 space-y-1"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="truncate font-mono text-xs font-semibold text-ink-100">
                                    {m.memberName}
                                  </span>
                                  <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                                    {m.status === "Expired"
                                      ? "EXPIRED"
                                      : isLowSess
                                        ? `${m.sessionsRemaining} SESS LEFT`
                                        : "EXPIRING SOON"}
                                  </span>
                                </div>
                                <div className="truncate font-mono text-[11px] text-ink-300">
                                  {m.packageName || m.packageType}
                                </div>
                                <div className="flex items-center justify-between font-mono text-[10px] text-ink-400">
                                  <span>Exp: {m.expiryDate || "—"}</span>
                                  <span>{m.branch}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setActiveModule("gym")}
                      className="w-full rounded-md bg-ink-900 py-1.5 text-center font-mono text-[11px] font-semibold text-sky-300 ring-1 ring-ink-800 hover:bg-sky-500/15"
                    >
                      Open Gym Renewals &amp; Roster →
                    </button>
                  </div>
                )}

                {/* Stream 4: POS Low-Stock Inventory Warnings */}
                {(opsFeedFilter === "all" || opsFeedFilter === "pos") && (
                  <div className="flex min-w-0 flex-col justify-between rounded-xl border border-ink-800 bg-ink-950/70 p-3.5 space-y-3">
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between border-b border-ink-800 pb-2">
                        <span className="font-mono text-xs font-bold text-amber-300">
                          POS Low-Stock Warnings
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                            ecosystemKpis.lowStockAlertsCount > 0
                              ? "bg-amber-500/20 text-amber-300"
                              : "bg-emerald-500/15 text-emerald-300"
                          }`}
                        >
                          {ecosystemKpis.lowStockAlertsCount} SKU(s)
                        </span>
                      </div>

                      {ecosystemKpis.lowStockPosItems.length === 0 ? (
                        <div className="py-6 text-center font-mono text-xs text-ink-400">
                          All Kiosk POS &amp; cafeteria products are above low-stock thresholds.
                        </div>
                      ) : (
                        <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                          {ecosystemKpis.lowStockPosItems.slice(0, 6).map((item) => (
                            <div
                              key={item.id}
                              className="rounded-lg border border-ink-800 bg-ink-900/90 p-2.5 space-y-1"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate font-mono text-xs font-semibold text-ink-100">
                                  {item.imageIcon ? `${item.imageIcon} ` : ""}
                                  {item.name}
                                </span>
                                <span
                                  className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                                    item.stock <= 0
                                      ? "bg-rose-500/20 text-rose-300"
                                      : "bg-amber-500/20 text-amber-300"
                                  }`}
                                >
                                  {item.stock <= 0 ? "OUT OF STOCK" : `${item.stock} LEFT`}
                                </span>
                              </div>
                              <div className="flex items-center justify-between font-mono text-[10px] text-ink-400">
                                <span>
                                  {item.sku || "SKU"} · Min: {item.lowStockThreshold ?? 10}
                                </span>
                                <span className="text-ink-200">{money(item.price)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setActiveModule("pos")}
                      className="w-full rounded-md bg-ink-900 py-1.5 text-center font-mono text-[11px] font-semibold text-amber-300 ring-1 ring-ink-800 hover:bg-amber-500/15"
                    >
                      Open POS Inventory &amp; Restock →
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* VIEW 0.5: NEXUS BRANCHES MULTI-BRANCH MANAGEMENT                  */}
        {/* ================================================================= */}
        {activeModule === "branches" && (
          <div className="min-w-0 max-w-full space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-purple-500/30 bg-ink-900/90 p-5">
              <div className="min-w-0 max-w-2xl">
                <div className="font-mono text-[10px] uppercase tracking-widest text-purple-300">
                  Vescio Nexus · Multi-Branch Facility Setup
                </div>
                <h2 className="mt-0.5 font-display text-xl text-ink-100">
                  Nexus Branches &amp; Multi-Vertical Facility Configuration
                </h2>
                <p className="mt-1 text-xs text-ink-300 leading-relaxed">
                  Create, edit, and switch between multiple facility branches. Each branch maintains
                  its own courts (with Full Court and Half-Court HCA/HCB hourly rates), Gym &amp;
                  S&amp;C athlete capacity, Physiotherapy clinic rooms, and Kiosk POS register.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <Button onClick={openCreateBranchModal}>+ Create Nexus Branch</Button>
              </div>
            </div>

            {branches.length === 0 ? (
              <Panel title="Nexus Branches Directory" meta="0 configured branches">
                <EmptyState
                  title="No Nexus Branches configured yet"
                  hint="Click '+ Create Nexus Branch' to configure your first multi-vertical facility branch with courts, gym capacity, physio rooms, and POS register."
                  action={<Button onClick={openCreateBranchModal}>+ Create First Branch</Button>}
                />
              </Panel>
            ) : (
              <div className="grid min-w-0 gap-5 md:grid-cols-2">
                {branches.map((b) => {
                  const isSelected =
                    branchFilter !== "All" &&
                    (b.name || "").toLowerCase() === branchFilter.toLowerCase();
                  const branchCourts = b.courts || [];
                  const branchResCount = reservations.filter(
                    (r) =>
                      r.status !== "Cancelled" &&
                      (r.branch || "").toLowerCase() === (b.name || "").toLowerCase(),
                  ).length;
                  const branchGymCount = gymMembers.filter(
                    (m) =>
                      m.status === "Active" &&
                      (m.branch || "").toLowerCase() === (b.name || "").toLowerCase(),
                  ).length;
                  const branchPhysioCount = physioRecords.filter(
                    (p) => (p.branch || "").toLowerCase() === (b.name || "").toLowerCase(),
                  ).length;
                  const branchPosSales = posTransactions
                    .filter(
                      (t) =>
                        t.status === "Completed" &&
                        (t.branch || "").toLowerCase() === (b.name || "").toLowerCase(),
                    )
                    .reduce((sum, t) => sum + (Number(t.total) || 0), 0);

                  return (
                    <div
                      key={b.id}
                      className={`flex min-w-0 flex-col justify-between rounded-xl border p-5 transition-all ${
                        isSelected
                          ? "border-emerald-500/60 bg-emerald-950/15 ring-1 ring-emerald-500/30"
                          : "border-ink-800 bg-ink-900/90 hover:border-purple-500/40"
                      }`}
                    >
                      <div className="space-y-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-purple-500/15 text-purple-300 ring-1 ring-purple-500/30">
                              <Building2 className="h-5 w-5" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="font-display text-lg text-ink-100 truncate">
                                  {b.name}
                                </h3>
                                {isSelected && <Chip tone="ok">Active Filter</Chip>}
                              </div>
                              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-ink-400">
                                <span className="inline-flex items-center gap-1">
                                  <MapPin className="h-3 w-3 text-purple-400" />
                                  {b.city || "Beirut"}
                                  {b.address ? ` · ${b.address}` : ""}
                                </span>
                                <span>· Mgr: {b.manager || "Unassigned"}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditBranchModal(b)}
                              className="inline-flex items-center gap-1 rounded-md bg-ink-850 px-2.5 py-1.5 font-mono text-xs text-ink-200 ring-1 ring-ink-700 hover:bg-ink-800"
                            >
                              <Edit3 className="h-3.5 w-3.5 text-court-400" />
                              <span>Edit Setup</span>
                            </button>
                          </div>
                        </div>

                        {/* 4 Facility Verticals Configuration Grid */}
                        <div className="grid gap-2.5 sm:grid-cols-2">
                          {/* Courts Box */}
                          <div className="rounded-lg border border-ink-800 bg-ink-950/70 p-3 space-y-1.5">
                            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-court-400">
                              <span>1. Courts ({branchCourts.length})</span>
                              <span>{branchResCount} active bookings</span>
                            </div>
                            {branchCourts.length === 0 ? (
                              <div className="font-mono text-xs text-ink-400">
                                No courts configured
                              </div>
                            ) : (
                              <div className="space-y-1">
                                {branchCourts.map((c, idx) => (
                                  <div
                                    key={c.id || idx}
                                    className="flex flex-wrap items-center justify-between gap-1 font-mono text-xs text-ink-200"
                                  >
                                    <span className="font-semibold">{c.name}</span>
                                    <span className="text-[10px] text-ink-400">
                                      Full: {money(c.fullCourtHourlyRate ?? 60)}/h · HCA/HCB:{" "}
                                      {money(c.halfCourtHourlyRate ?? 35)}/h
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Gym Capacity Box */}
                          <div className="rounded-lg border border-ink-800 bg-ink-950/70 p-3 space-y-1.5">
                            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-sky-400">
                              <span>2. Gym &amp; S&amp;C Floor</span>
                              <span>
                                {branchGymCount}/{b.gymCapacity ?? 30} enrolled
                              </span>
                            </div>
                            <div className="font-mono text-xs font-semibold text-ink-100">
                              Capacity: {b.gymCapacity ?? 30} Athletes · Default{" "}
                              {money(b.gymDefaultMonthlyFee ?? 65)}/mo
                            </div>
                            <div className="truncate font-mono text-[10px] text-ink-400">
                              {b.gymEquipmentNotes || "Full S&C Rack & Turf Zone"}
                            </div>
                          </div>

                          {/* Physio Clinic Box */}
                          <div className="rounded-lg border border-ink-800 bg-ink-950/70 p-3 space-y-1.5">
                            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-rose-400">
                              <span>3. Physiotherapy Clinic</span>
                              <span>{b.physioClinicStatus || "Open"}</span>
                            </div>
                            <div className="font-mono text-xs font-semibold text-ink-100">
                              {b.physioRoomsCount ?? 2} Treatment Room(s) · {branchPhysioCount}{" "}
                              case(s)
                            </div>
                            <div className="truncate font-mono text-[10px] text-ink-400">
                              Lead PT: {b.leadPhysiotherapist || "Dr. Rami Khoury (PT)"}
                            </div>
                          </div>

                          {/* Kiosk POS Register Box */}
                          <div className="rounded-lg border border-ink-800 bg-ink-950/70 p-3 space-y-1.5">
                            <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-amber-400">
                              <span>4. Kiosk POS Register</span>
                              <span>{b.posStatus || "Open"}</span>
                            </div>
                            <div className="font-mono text-xs font-semibold text-ink-100 truncate">
                              {b.posRegisterName || `${b.name} Kiosk Terminal #1`}
                            </div>
                            <div className="font-mono text-[10px] text-ink-400">
                              Drawer Float: {money(b.posStartingFloat ?? 200)} · Sales:{" "}
                              {money(branchPosSales)}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-ink-800 pt-3">
                        <span className="font-mono text-[10px] text-ink-400">
                          Hours: {b.operatingHours || "08:00 - 22:30"}
                        </span>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button
                            variant={isSelected ? "ghost" : "primary"}
                            onClick={() => {
                              const nextBranch = isSelected ? "All" : b.name;
                              setBranchFilter(nextBranch);
                              toast.success(
                                nextBranch === "All"
                                  ? "Switched Vescio Nexus scope to All Branches."
                                  : `Switched Vescio Nexus active branch to "${b.name}".`,
                              );
                            }}
                          >
                            {isSelected ? "Showing This Branch (Reset)" : `Switch to ${b.name} →`}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ================================================================= */}
        {/* VIEW 1: COURT & FACILITY RESERVATION MODULE                       */}
        {/* ================================================================= */}
        {activeModule === "courts" && (
          <NexusCourtReservationsModule
            branchFilter={branchFilter}
            onChangeBranchFilter={setBranchFilter}
            externalNewBookingTrigger={courtNewBookingTrigger}
          />
        )}

        {/* ================================================================= */}
        {/* VIEW 2: GYM & STRENGTH MODULE                                     */}
        {/* ================================================================= */}
        {activeModule === "gym" && (
          <NexusGymModule
            selectedBranch={branchFilter}
            onSelectBranch={setBranchFilter}
            externalEnrollOpen={gymModalOpen}
            onExternalEnrollHandled={() => setGymModalOpen(false)}
          />
        )}

        {/* ================================================================= */}
        {/* VIEW 3: PHYSIOTHERAPY & MEDICAL MODULE                            */}
        {/* ================================================================= */}
        {activeModule === "physio" && (
          <NexusPhysioModule
            selectedBranch={branchFilter}
            onSelectBranch={setBranchFilter}
            externalIntakeOpen={physioIntakeOpen}
            onExternalIntakeHandled={() => setPhysioIntakeOpen(false)}
          />
        )}

        {/* ================================================================= */}
        {/* VIEW 4: KIOSK POS (POINT OF SALE)                                 */}
        {/* ================================================================= */}
        {activeModule === "pos" && (
          <NexusPosModule selectedBranch={branchFilter} onSelectBranch={setBranchFilter} />
        )}
      </main>

      {/* =================================================================== */}
      {/* MODAL 0: CREATE / EDIT VESCIO NEXUS BRANCH                          */}
      {/* =================================================================== */}
      <Modal
        open={branchModalOpen}
        title={
          editingBranchId
            ? `Configure Nexus Branch · ${branchForm.name}`
            : "Create New Vescio Nexus Branch"
        }
        meta="Configure Courts (Full/HCA/HCB rates), Gym Capacity, Physio Rooms & POS Register for this branch"
        onClose={() => setBranchModalOpen(false)}
      >
        <div className="p-4 space-y-5 max-h-[78vh] overflow-y-auto">
          <div className="grid items-end gap-3 sm:grid-cols-3">
            <Field label="Branch Name">
              <Input
                value={branchForm.name}
                onChange={(v) => setBranchForm({ ...branchForm, name: v })}
                placeholder="e.g. Downtown Nexus Arena"
                className="h-10"
              />
            </Field>
            <Field label="City / District">
              <Input
                value={branchForm.city}
                onChange={(v) => setBranchForm({ ...branchForm, city: v })}
                placeholder="e.g. Beirut"
                className="h-10"
              />
            </Field>
            <Field label="Branch Manager">
              <Input
                value={branchForm.manager}
                onChange={(v) => setBranchForm({ ...branchForm, manager: v })}
                placeholder="e.g. Coach Tariq"
                className="h-10"
              />
            </Field>
          </div>

          <div className="grid items-end gap-3 sm:grid-cols-3">
            <Field label="Address / Location">
              <Input
                value={branchForm.address}
                onChange={(v) => setBranchForm({ ...branchForm, address: v })}
                placeholder="Street / Campus Building"
                className="h-10"
              />
            </Field>
            <Field label="Contact Phone">
              <Input
                value={branchForm.phone}
                onChange={(v) => setBranchForm({ ...branchForm, phone: v })}
                placeholder="+961 70 000 000"
                className="h-10"
              />
            </Field>
            <Field label="Operating Hours">
              <Input
                value={branchForm.operatingHours}
                onChange={(v) => setBranchForm({ ...branchForm, operatingHours: v })}
                placeholder="08:00 - 22:30"
                className="h-10"
              />
            </Field>
          </div>

          {/* 1. Courts Configuration */}
          <div className="rounded-xl border border-ink-800 bg-ink-950/70 p-3.5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-mono text-xs font-bold text-court-300">
                  1. Branch Courts &amp; Hourly Rental Rates (Full · HCA · HCB)
                </div>
                <div className="text-[11px] text-ink-400">
                  Add courts and configure Full Court and Half-Court (HCA/HCB) hourly rates.
                </div>
              </div>
              <Button
                variant="ghost"
                onClick={() =>
                  setBranchForm({
                    ...branchForm,
                    courts: [
                      ...branchForm.courts,
                      {
                        id: uid("crt"),
                        name: `Court ${branchForm.courts.length + 1}`,
                        enableHalfCourts: true,
                        fullCourtHourlyRate: "60",
                        halfCourtHourlyRate: "35",
                        operatingHours: branchForm.operatingHours || "08:00 - 22:30",
                      },
                    ],
                  })
                }
              >
                + Add Court
              </Button>
            </div>

            <div className="space-y-2">
              {branchForm.courts.map((crt, idx) => (
                <div
                  key={crt.id}
                  className="grid items-end gap-2 rounded-lg border border-ink-800 bg-ink-900 p-2.5 sm:grid-cols-[1.4fr_1fr_1fr_auto]"
                >
                  <Field label={`Court #${idx + 1} Name`}>
                    <Input
                      value={crt.name}
                      onChange={(v) => {
                        const next = [...branchForm.courts];
                        next[idx] = { ...crt, name: v };
                        setBranchForm({ ...branchForm, courts: next });
                      }}
                      className="h-10"
                    />
                  </Field>
                  <Field label="Full Court ($/hr)">
                    <Input
                      type="number"
                      value={crt.fullCourtHourlyRate}
                      onChange={(v) => {
                        const next = [...branchForm.courts];
                        next[idx] = { ...crt, fullCourtHourlyRate: v };
                        setBranchForm({ ...branchForm, courts: next });
                      }}
                      className="h-10"
                    />
                  </Field>
                  <Field label="Half HCA/HCB ($/hr)">
                    <Input
                      type="number"
                      value={crt.halfCourtHourlyRate}
                      onChange={(v) => {
                        const next = [...branchForm.courts];
                        next[idx] = { ...crt, halfCourtHourlyRate: v };
                        setBranchForm({ ...branchForm, courts: next });
                      }}
                      className="h-10"
                    />
                  </Field>
                  <div className="flex items-end">
                    {branchForm.courts.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setBranchForm({
                            ...branchForm,
                            courts: branchForm.courts.filter((_, i) => i !== idx),
                          })
                        }
                        className="flex h-10 w-10 items-center justify-center rounded-md bg-ink-850 text-ink-400 ring-1 ring-ink-700 hover:text-red-400"
                        title="Remove Court"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 2. Gym & S&C Configuration */}
          <div className="rounded-xl border border-ink-800 bg-ink-950/70 p-3.5 space-y-3">
            <div className="font-mono text-xs font-bold text-sky-300">
              2. Gym &amp; Strength Floor Setup
            </div>
            <div className="grid items-end gap-3 sm:grid-cols-3">
              <Field label="Max Gym Athlete Capacity">
                <Input
                  type="number"
                  value={branchForm.gymCapacity}
                  onChange={(v) => setBranchForm({ ...branchForm, gymCapacity: v })}
                  className="h-10"
                />
              </Field>
              <Field label="Default Monthly S&C Fee ($)">
                <Input
                  type="number"
                  value={branchForm.gymDefaultMonthlyFee}
                  onChange={(v) => setBranchForm({ ...branchForm, gymDefaultMonthlyFee: v })}
                  className="h-10"
                />
              </Field>
              <Field label="Equipment & Zones Summary">
                <Input
                  value={branchForm.gymEquipmentNotes}
                  onChange={(v) => setBranchForm({ ...branchForm, gymEquipmentNotes: v })}
                  placeholder="Racks, turf sled, weights..."
                  className="h-10"
                />
              </Field>
            </div>
          </div>

          {/* 3. Physiotherapy Clinic Rooms */}
          <div className="rounded-xl border border-ink-800 bg-ink-950/70 p-3.5 space-y-3">
            <div className="font-mono text-xs font-bold text-rose-300">
              3. Physiotherapy &amp; Sports Medicine Rooms
            </div>
            <div className="grid items-end gap-3 sm:grid-cols-3">
              <Field label="Physio Treatment Rooms">
                <Input
                  type="number"
                  value={branchForm.physioRoomsCount}
                  onChange={(v) => setBranchForm({ ...branchForm, physioRoomsCount: v })}
                  className="h-10"
                />
              </Field>
              <Field label="Lead Physiotherapist">
                <Input
                  value={branchForm.leadPhysiotherapist}
                  onChange={(v) => setBranchForm({ ...branchForm, leadPhysiotherapist: v })}
                  className="h-10"
                />
              </Field>
              <Field label="Clinic Status">
                <Select
                  value={branchForm.physioClinicStatus}
                  onChange={(v) =>
                    setBranchForm({
                      ...branchForm,
                      physioClinicStatus: v as typeof branchForm.physioClinicStatus,
                    })
                  }
                  options={[
                    { label: "Open", value: "Open" },
                    { label: "By Appointment", value: "By Appointment" },
                    { label: "Closed", value: "Closed" },
                  ]}
                  className="h-10"
                />
              </Field>
            </div>
          </div>

          {/* 4. Kiosk POS Register Setup */}
          <div className="rounded-xl border border-ink-800 bg-ink-950/70 p-3.5 space-y-3">
            <div className="font-mono text-xs font-bold text-amber-300">
              4. On-Site Kiosk POS Register Setup
            </div>
            <div className="grid items-end gap-3 sm:grid-cols-3">
              <Field label="POS Register Terminal Name">
                <Input
                  value={branchForm.posRegisterName}
                  onChange={(v) => setBranchForm({ ...branchForm, posRegisterName: v })}
                  className="h-10"
                />
              </Field>
              <Field label="Starting Cash Float ($)">
                <Input
                  type="number"
                  value={branchForm.posStartingFloat}
                  onChange={(v) => setBranchForm({ ...branchForm, posStartingFloat: v })}
                  className="h-10"
                />
              </Field>
              <Field label="Register Status">
                <Select
                  value={branchForm.posStatus}
                  onChange={(v) =>
                    setBranchForm({
                      ...branchForm,
                      posStatus: v as typeof branchForm.posStatus,
                    })
                  }
                  options={[
                    { label: "Open", value: "Open" },
                    { label: "Closed", value: "Closed" },
                  ]}
                  className="h-10"
                />
              </Field>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setBranchModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleSaveNexusBranch()}>
              {editingBranchId ? "Save Branch Changes" : "Create Nexus Branch"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Building2,
  Calendar,
  CreditCard,
  Dumbbell,
  Edit3,
  HeartPulse,
  Layers,
  MapPin,
  Minus,
  Plus,
  Printer,
  Search,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Trash2,
  UserCheck,
  Users,
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
  Stat,
  Table,
  Td,
  Textarea,
  Th,
  money,
} from "@/components/kit";
import { NexusCourtReservationsModule } from "@/components/nexus-court-reservations";
import { VescioNexusIcon } from "@/components/vescio-nexus-icon";
import {
  DEFAULT_POS_CATALOG,
  todayISO,
  uid,
  useDB,
  useTenantUser,
  type Branch,
  type Court,
  type GymMember,
  type GymWorkoutLog,
  type LedgerEntry,
  type PhysioRecord,
  type PhysioTreatmentSession,
  type PlayerMedicalClearanceStatus,
  type PosCartLineItem,
  type PosCatalogItem,
  type PosItemCategory,
  type PosTransaction,
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

const RTP_STAGES: Array<{
  stage: 1 | 2 | 3 | 4 | 5;
  title: string;
  subtitle: string;
}> = [
  { stage: 1, title: "Stage 1 · Acute & Pain Control", subtitle: "Rest, cryo, edema reduction" },
  {
    stage: 2,
    title: "Stage 2 · Mobility & Early Load",
    subtitle: "ROM restoration, isometric load",
  },
  {
    stage: 3,
    title: "Stage 3 · Strength & Agility",
    subtitle: "Eccentric strength, linear running",
  },
  { stage: 4, title: "Stage 4 · Non-Contact Drills", subtitle: "Modified court drills, cutting" },
  {
    stage: 5,
    title: "Stage 5 · Full Contact Cleared",
    subtitle: "Cleared for 5v5 & official games",
  },
];

const POS_CATEGORIES: Array<"All" | PosItemCategory> = [
  "All",
  "Hydration & Drinks",
  "Snacks & Nutrition",
  "Uniforms & Merch",
  "Court Walk-In & Passes",
  "Recovery & Tape",
];

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
  const { db, setEntity, patchEntity, deleteEntity } = useDB();
  const currentUser = useTenantUser();

  const [activeModule, setActiveModule] = useState<VescioNexusModuleTab>("hub");
  const [branchFilter, setBranchFilter] = useState<string>("All");

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

  const defaultBranchName = branches[0]?.name || "Main Branch";
  const activeScopedBranchName = branchFilter !== "All" ? branchFilter : defaultBranchName;

  const activeBranchObj = useMemo(
    () =>
      branches.find((b) => (b.name || "").toLowerCase() === activeScopedBranchName.toLowerCase()) ||
      branches[0],
    [branches, activeScopedBranchName],
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
          branchFilter === "All" || (m.branch || "").toLowerCase() === branchFilter.toLowerCase(),
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

  // Global Vescio Nexus KPIs
  const ecosystemKpis = useMemo(() => {
    const today = todayISO();
    const activeReservations = filteredReservations.filter((r) => r.status !== "Cancelled");
    const courtRevenueCollected = activeReservations.reduce(
      (sum, r) => sum + (Number(r.paidAmount) || 0),
      0,
    );
    const courtPendingReceivables = activeReservations.reduce(
      (sum, r) => sum + Math.max(0, (Number(r.totalAmount) || 0) - (Number(r.paidAmount) || 0)),
      0,
    );

    const activeGymCount = filteredGymMembers.filter((m) => m.status === "Active").length;
    const todayGymCheckIns = filteredGymMembers.filter((m) => m.lastCheckInDate === today).length;
    const gymMonthlyRevenue = filteredGymMembers
      .filter((m) => m.status === "Active")
      .reduce((sum, m) => sum + (Number(m.monthlyFee) || 0), 0);

    const scopedPlayers = players.filter(
      (p) =>
        branchFilter === "All" || (p.branch || "").toLowerCase() === branchFilter.toLowerCase(),
    );
    const injuredOrLimitedPlayers = scopedPlayers.filter(
      (p) => p.medicalStatus === "Injured" || p.medicalStatus === "Limited",
    ).length;
    const activeRehabCases = filteredPhysioRecords.filter(
      (r) => r.medicalStatus !== "Fit" || r.rtpStage < 5,
    ).length;

    const todayPosSales = filteredPosTransactions
      .filter((tx) => tx.date === today && tx.status === "Completed")
      .reduce((sum, tx) => sum + (Number(tx.total) || 0), 0);
    const totalPosSales = filteredPosTransactions
      .filter((tx) => tx.status === "Completed")
      .reduce((sum, tx) => sum + (Number(tx.total) || 0), 0);

    return {
      activeReservationsCount: activeReservations.length,
      courtRevenueCollected,
      courtPendingReceivables,
      activeGymCount,
      todayGymCheckIns,
      gymMonthlyRevenue,
      injuredOrLimitedPlayers,
      activeRehabCases,
      todayPosSales,
      totalPosSales,
    };
  }, [
    filteredReservations,
    filteredGymMembers,
    filteredPhysioRecords,
    filteredPosTransactions,
    players,
    branchFilter,
  ]);

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

  const handleSaveNexusBranch = async () => {
    if (!branchForm.name.trim()) {
      toast.error("Please enter a branch name.");
      return;
    }
    const existingBranch = editingBranchId
      ? branches.find((b) => b.id === editingBranchId)
      : undefined;

    const normalizedCourts: Court[] =
      branchForm.courts.length > 0
        ? branchForm.courts.map((c, idx) => {
            const prevCourt = existingBranch?.courts?.find(
              (pc) => pc.id === c.id || pc.name === c.name,
            );
            const fullRate = Math.max(0, Number(c.fullCourtHourlyRate) || 60);
            const halfRate = Math.max(0, Number(c.halfCourtHourlyRate) || 35);
            return {
              ...prevCourt,
              id: c.id || uid(`crt-${idx}`),
              name: c.name.trim() || `Court ${idx + 1}`,
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

    await setEntity("branches", branchRecord);
    setBranchFilter(branchRecord.name);
    setBranchModalOpen(false);
    toast.success(
      editingBranchId
        ? `Updated Nexus Branch "${branchRecord.name}" configuration.`
        : `Created Nexus Branch "${branchRecord.name}" and switched active view.`,
    );
  };

  // =========================================================================
  // MODULE 1 TRIGGER: COURT & FACILITY RESERVATIONS
  // =========================================================================
  const [courtNewBookingTrigger, setCourtNewBookingTrigger] = useState(0);

  // =========================================================================
  // MODULE 2 STATE: GYM & STRENGTH MODULE
  // =========================================================================
  const [gymModalOpen, setGymModalOpen] = useState(false);
  const [workoutModalMember, setWorkoutModalMember] = useState<GymMember | null>(null);
  const [gymForm, setGymForm] = useState<{
    memberType: GymMember["memberType"];
    linkedPlayerId: string;
    memberName: string;
    phone: string;
    branch: string;
    packageType: GymMember["packageType"];
    monthlyFee: string;
    totalSessionsIncluded: string;
    startDate: string;
    expiryDate: string;
    paymentMethod: "Cash" | "Card" | "Charge to Player Account";
  }>({
    memberType: "Academy Player",
    linkedPlayerId: "",
    memberName: "",
    phone: "",
    branch: defaultBranchName,
    packageType: "Athlete Pro S&C",
    monthlyFee: "65",
    totalSessionsIncluded: "12",
    startDate: todayISO(),
    expiryDate: addDaysToIso(todayISO(), 30),
    paymentMethod: "Cash",
  });

  const openEnrollGymModal = () => {
    const targetBranch = branchFilter !== "All" ? branchFilter : defaultBranchName;
    const bObj = branches.find((b) => b.name === targetBranch);
    const defaultFee = String(bObj?.gymDefaultMonthlyFee ?? 65);
    setGymForm((prev) => ({
      ...prev,
      branch: targetBranch,
      monthlyFee: defaultFee,
    }));
    setGymModalOpen(true);
  };

  const [workoutForm, setWorkoutForm] = useState<{
    date: string;
    focusArea: GymWorkoutLog["focusArea"];
    exercisesSummary: string;
    setsRepsLoad: string;
    rpe: string;
    personalRecord: string;
    coachName: string;
    notes: string;
  }>({
    date: todayISO(),
    focusArea: "Lower Body Power",
    exercisesSummary: "Trap Bar Deadlift, Bulgarian Split Squat, Box Jumps",
    setsRepsLoad: "4x5 @ 95kg · 3x8 @ 40kg · 4x6 Plyo",
    rpe: "8",
    personalRecord: "",
    coachName: currentUser?.name || "S&C Coach",
    notes: "",
  });

  const handleCreateGymMember = async () => {
    if (!gymForm.memberName.trim()) {
      toast.error("Please enter or select the member's name.");
      return;
    }
    const fee = Math.max(0, Number(gymForm.monthlyFee) || 0);
    const totalSess =
      gymForm.packageType === "Monthly Unlimited"
        ? 999
        : gymForm.packageType === "Walk-In Day Pass"
          ? 1
          : Math.max(1, Number(gymForm.totalSessionsIncluded) || 10);

    const isChargedToAccount = gymForm.paymentMethod === "Charge to Player Account";
    const newMember: GymMember = {
      id: uid("gym"),
      memberName: gymForm.memberName.trim(),
      memberType: gymForm.memberType,
      linkedPlayerId: gymForm.linkedPlayerId || undefined,
      phone: gymForm.phone.trim(),
      branch: gymForm.branch,
      packageName: gymForm.packageType,
      packageType: gymForm.packageType,
      monthlyFee: fee,
      sessionsRemaining: totalSess,
      totalSessionsIncluded: totalSess,
      startDate: gymForm.startDate,
      expiryDate: gymForm.expiryDate,
      status: "Active",
      balance: isChargedToAccount ? fee : 0,
      totalCheckIns: 0,
      checkInHistory: [],
      workoutLogs: [],
      createdAt: new Date().toISOString(),
    };

    await setEntity("gymMembers", newMember);

    if (fee > 0) {
      if (isChargedToAccount && gymForm.linkedPlayerId) {
        const linkedPlayer = players.find((p) => p.id === gymForm.linkedPlayerId);
        if (linkedPlayer) {
          await patchEntity("players", linkedPlayer.id, {
            balance: Math.round(((Number(linkedPlayer.balance) || 0) + fee) * 100) / 100,
          });
        }
      } else {
        const ledgerEntry: LedgerEntry = {
          id: uid("led-gym"),
          date: todayISO(),
          account: "Gym & Strength Memberships (Vescio Nexus)",
          category: "Gym & S&C",
          entry: `Gym Membership · ${newMember.memberName} (${newMember.packageType})`,
          description: `${newMember.memberType} · ${gymForm.paymentMethod}`,
          type: "Revenue",
          amount: fee,
          status: "Collected",
          branch: newMember.branch,
          referenceId: newMember.id,
        };
        await setEntity("ledger", ledgerEntry);
      }
    }

    toast.success(`Enrolled ${newMember.memberName} in ${newMember.packageType}!`);
    setGymModalOpen(false);
  };

  const handleGymCheckIn = async (member: GymMember) => {
    if (member.status !== "Active") {
      toast.error(`${member.memberName}'s membership is ${member.status}. Please renew first.`);
      return;
    }
    const now = new Date();
    const today = todayISO();
    const timeStr = now.toTimeString().slice(0, 5);
    const isUnlimited =
      member.packageType === "Monthly Unlimited" || (member.totalSessionsIncluded ?? 0) >= 999;
    const nextRemaining = isUnlimited ? 999 : Math.max(0, (member.sessionsRemaining ?? 1) - 1);
    const nextStatus: GymMember["status"] =
      !isUnlimited && nextRemaining === 0 ? "Expired" : member.status;

    const nextHistory = [
      { id: uid("chk"), date: today, time: timeStr, note: "Gym Floor & S&C Check-In" },
      ...(member.checkInHistory || []),
    ];

    await patchEntity("gymMembers", member.id, {
      lastCheckInDate: today,
      totalCheckIns: (member.totalCheckIns || 0) + 1,
      sessionsRemaining: nextRemaining,
      status: nextStatus,
      checkInHistory: nextHistory,
      updatedAt: now.toISOString(),
    });

    toast.success(
      isUnlimited
        ? `Checked in ${member.memberName} (Unlimited Access · #${(member.totalCheckIns || 0) + 1}).`
        : `Checked in ${member.memberName} (${nextRemaining} S&C sessions remaining).`,
    );
  };

  const handleAddWorkoutLog = async () => {
    if (!workoutModalMember) return;
    if (!workoutForm.exercisesSummary.trim()) {
      toast.error("Please enter the exercises performed.");
      return;
    }
    const newLog: GymWorkoutLog = {
      id: uid("wlog"),
      date: workoutForm.date || todayISO(),
      focusArea: workoutForm.focusArea,
      exercisesSummary: workoutForm.exercisesSummary.trim(),
      setsRepsLoad: workoutForm.setsRepsLoad.trim(),
      rpe: Math.min(10, Math.max(1, Number(workoutForm.rpe) || 7)),
      personalRecord: workoutForm.personalRecord.trim() || undefined,
      coachName: workoutForm.coachName.trim() || "S&C Coach",
      notes: workoutForm.notes.trim() || undefined,
    };

    const updatedLogs = [newLog, ...(workoutModalMember.workoutLogs || [])];
    await patchEntity("gymMembers", workoutModalMember.id, {
      workoutLogs: updatedLogs,
      updatedAt: new Date().toISOString(),
    });
    setWorkoutModalMember({
      ...workoutModalMember,
      workoutLogs: updatedLogs,
    });
    setWorkoutForm((prev) => ({
      ...prev,
      personalRecord: "",
      notes: "",
    }));
    toast.success(`Logged S&C workout for ${workoutModalMember.memberName}!`);
  };

  // =========================================================================
  // MODULE 3 STATE: PHYSIOTHERAPY & MEDICAL MODULE
  // =========================================================================
  const [physioIntakeOpen, setPhysioIntakeOpen] = useState(false);
  const [activePhysioRecord, setActivePhysioRecord] = useState<PhysioRecord | null>(null);
  const [physioForm, setPhysioForm] = useState<{
    patientType: PhysioRecord["patientType"];
    linkedPlayerId: string;
    patientName: string;
    team: string;
    phone: string;
    branch: string;
    medicalStatus: PlayerMedicalClearanceStatus;
    injuryArea: PhysioRecord["injuryArea"];
    diagnosis: string;
    mechanism: string;
    severity: PhysioRecord["severity"];
    intakeDate: string;
    estimatedReturnDate: string;
    therapistName: string;
    rtpStage: 1 | 2 | 3 | 4 | 5;
    restrictions: string;
  }>({
    patientType: "Academy Player",
    linkedPlayerId: "",
    patientName: "",
    team: "",
    phone: "",
    branch: defaultBranchName,
    medicalStatus: "Limited",
    injuryArea: "Ankle / Foot",
    diagnosis: "",
    mechanism: "Non-contact landing during practice",
    severity: "Mild (Grade 1)",
    intakeDate: todayISO(),
    estimatedReturnDate: addDaysToIso(todayISO(), 14),
    therapistName: currentUser?.name || "Dr. Rami Khoury (PT)",
    rtpStage: 2,
    restrictions: "No 5v5 contact scrimmages; cleared for shooting & controlled footwork.",
  });

  const openPhysioIntakeModal = () => {
    const targetBranch = branchFilter !== "All" ? branchFilter : defaultBranchName;
    const bObj = branches.find((b) => b.name === targetBranch);
    setPhysioForm((prev) => ({
      ...prev,
      branch: targetBranch,
      therapistName: bObj?.leadPhysiotherapist || prev.therapistName,
    }));
    setPhysioIntakeOpen(true);
  };

  const [treatmentForm, setTreatmentForm] = useState<{
    date: string;
    time: string;
    therapistName: string;
    modality: PhysioTreatmentSession["modality"];
    soapNotes: string;
    painScore: string;
    fee: string;
    paymentStatus: PhysioTreatmentSession["paymentStatus"];
  }>({
    date: todayISO(),
    time: "16:30",
    therapistName: currentUser?.name || "Dr. Rami Khoury (PT)",
    modality: "Manual Therapy & Mobilization",
    soapNotes: "",
    painScore: "3",
    fee: "45",
    paymentStatus: "Academy Covered",
  });

  const syncPlayerMedicalStatusToAcademy = async (
    playerId: string | undefined,
    medicalStatus: PlayerMedicalClearanceStatus,
    rtpStage: 1 | 2 | 3 | 4 | 5,
    diagnosisNote?: string,
  ) => {
    if (!playerId) return;
    const player = players.find((p) => p.id === playerId);
    if (!player) return;
    const statusLabel =
      medicalStatus === "Fit"
        ? "Fit (Cleared)"
        : medicalStatus === "Limited"
          ? "Limited / Modified Training"
          : "Injured / Out";
    const summaryNote = diagnosisNote
      ? `[Physio ${todayISO()}] ${statusLabel} · RTP Stage ${rtpStage}/5: ${diagnosisNote}`
      : player.medicalNotes;

    await patchEntity("players", playerId, {
      medicalStatus,
      rtpStage,
      ...(summaryNote ? { medicalNotes: summaryNote } : {}),
    });
  };

  const handleCreatePhysioIntake = async () => {
    if (!physioForm.patientName.trim() || !physioForm.diagnosis.trim()) {
      toast.error("Please enter the patient name and clinical diagnosis.");
      return;
    }
    const nowIso = new Date().toISOString();
    const record: PhysioRecord = {
      id: uid("physio"),
      patientName: physioForm.patientName.trim(),
      patientType: physioForm.patientType,
      linkedPlayerId: physioForm.linkedPlayerId || undefined,
      team: physioForm.team || undefined,
      phone: physioForm.phone.trim() || undefined,
      branch: physioForm.branch,
      medicalStatus: physioForm.medicalStatus,
      injuryArea: physioForm.injuryArea,
      diagnosis: physioForm.diagnosis.trim(),
      mechanism: physioForm.mechanism.trim() || undefined,
      severity: physioForm.severity,
      intakeDate: physioForm.intakeDate,
      estimatedReturnDate: physioForm.estimatedReturnDate || undefined,
      therapistName: physioForm.therapistName.trim() || "Physiotherapist",
      rtpStage: physioForm.rtpStage,
      restrictions: physioForm.restrictions.trim(),
      treatmentSessions: [],
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    await setEntity("physioRecords", record);

    if (record.linkedPlayerId) {
      await syncPlayerMedicalStatusToAcademy(
        record.linkedPlayerId,
        record.medicalStatus,
        record.rtpStage,
        `${record.injuryArea} - ${record.diagnosis} (${record.restrictions})`,
      );
    }

    toast.success(
      `Created Physiotherapy Case for ${record.patientName} & synced Academy status (${record.medicalStatus}).`,
    );
    setPhysioIntakeOpen(false);
  };

  const handleUpdatePhysioRtpAndStatus = async (
    record: PhysioRecord,
    nextStatus: PlayerMedicalClearanceStatus,
    nextStage: 1 | 2 | 3 | 4 | 5,
  ) => {
    const updated: PhysioRecord = {
      ...record,
      medicalStatus: nextStatus,
      rtpStage: nextStage,
      updatedAt: new Date().toISOString(),
    };
    await setEntity("physioRecords", updated);
    if (activePhysioRecord?.id === record.id) {
      setActivePhysioRecord(updated);
    }
    if (record.linkedPlayerId) {
      await syncPlayerMedicalStatusToAcademy(
        record.linkedPlayerId,
        nextStatus,
        nextStage,
        `${record.injuryArea} - ${record.diagnosis} (${record.restrictions})`,
      );
    }
    toast.success(
      `Updated ${record.patientName}: Status "${nextStatus}" · RTP Stage ${nextStage}/5 (Synced with Academy Roster).`,
    );
  };

  const handleAddTreatmentSession = async () => {
    if (!activePhysioRecord) return;
    if (!treatmentForm.soapNotes.trim()) {
      toast.error("Please enter therapist SOAP / clinical notes for this session.");
      return;
    }
    const fee = Math.max(0, Number(treatmentForm.fee) || 0);
    const sessionItem: PhysioTreatmentSession = {
      id: uid("pt-sess"),
      date: treatmentForm.date || todayISO(),
      time: treatmentForm.time || "16:30",
      therapistName: treatmentForm.therapistName.trim() || activePhysioRecord.therapistName,
      modality: treatmentForm.modality,
      soapNotes: treatmentForm.soapNotes.trim(),
      painScore: Math.min(10, Math.max(0, Number(treatmentForm.painScore) || 0)),
      fee,
      paymentStatus: treatmentForm.paymentStatus,
      status: "Completed",
    };

    const nextSessions = [sessionItem, ...(activePhysioRecord.treatmentSessions || [])];
    const updatedRecord: PhysioRecord = {
      ...activePhysioRecord,
      treatmentSessions: nextSessions,
      updatedAt: new Date().toISOString(),
    };
    await setEntity("physioRecords", updatedRecord);
    setActivePhysioRecord(updatedRecord);

    if (fee > 0 && treatmentForm.paymentStatus === "Paid") {
      const ledgerEntry: LedgerEntry = {
        id: uid("led-physio"),
        date: sessionItem.date,
        account: "Physiotherapy & Medical Clinic (Vescio Nexus)",
        category: "Physiotherapy",
        entry: `Physio Session · ${activePhysioRecord.patientName} (${sessionItem.modality})`,
        description: `Therapist: ${sessionItem.therapistName}`,
        type: "Revenue",
        amount: fee,
        status: "Collected",
        branch: activePhysioRecord.branch,
        referenceId: sessionItem.id,
      };
      await setEntity("ledger", ledgerEntry);
    } else if (
      fee > 0 &&
      treatmentForm.paymentStatus === "Charged to Account" &&
      activePhysioRecord.linkedPlayerId
    ) {
      const targetPlayer = players.find((p) => p.id === activePhysioRecord.linkedPlayerId);
      if (targetPlayer) {
        await patchEntity("players", targetPlayer.id, {
          balance: Math.round(((Number(targetPlayer.balance) || 0) + fee) * 100) / 100,
        });
      }
    }

    setTreatmentForm((prev) => ({ ...prev, soapNotes: "" }));
    toast.success(`Recorded treatment session for ${activePhysioRecord.patientName}.`);
  };

  // =========================================================================
  // MODULE 4 STATE: KIOSK POS (POINT OF SALE)
  // =========================================================================
  const [posCategory, setPosCategory] = useState<"All" | PosItemCategory>("All");
  const [posSearch, setPosSearch] = useState("");
  const [posCart, setPosCart] = useState<PosCartLineItem[]>([]);
  const [posDiscount, setPosDiscount] = useState<string>("0");
  const [posCustomerType, setPosCustomerType] = useState<PosTransaction["customerType"]>("Walk-In");
  const [posLinkedPlayerId, setPosLinkedPlayerId] = useState<string>("");
  const [posLinkedGymMemberId, setPosLinkedGymMemberId] = useState<string>("");
  const [posWalkInName, setPosWalkInName] = useState<string>("Walk-In Customer");
  const [posCatalogModalOpen, setPosCatalogModalOpen] = useState(false);
  const [posReceiptModalTx, setPosReceiptModalTx] = useState<PosTransaction | null>(null);
  const [newCatalogItem, setNewCatalogItem] = useState<{
    name: string;
    category: PosItemCategory;
    price: string;
    stock: string;
    sku: string;
    branch: string;
  }>({
    name: "",
    category: "Hydration & Drinks",
    price: "3.00",
    stock: "50",
    sku: "",
    branch: "All",
  });

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
        sku: `STK-${s.id.slice(-4).toUpperCase()}`,
        linkedStockId: s.id,
        branch: s.branch,
        active: true,
      }));
    return [...baseItems, ...stockMapped];
  }, [posCatalog, stock, branchFilter]);

  const filteredPosCatalog = useMemo(() => {
    const q = posSearch.trim().toLowerCase();
    return unifiedPosCatalog.filter((item) => {
      if (posCategory !== "All" && item.category !== posCategory) return false;
      if (
        q &&
        !item.name.toLowerCase().includes(q) &&
        !(item.sku || "").toLowerCase().includes(q) &&
        !item.category.toLowerCase().includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [unifiedPosCatalog, posCategory, posSearch]);

  const posCartTotals = useMemo(() => {
    const subtotal = posCart.reduce((sum, item) => sum + item.subtotal, 0);
    const discount = Math.min(subtotal, Math.max(0, Number(posDiscount) || 0));
    const total = Math.max(0, Math.round((subtotal - discount) * 100) / 100);
    return {
      subtotal: Math.round(subtotal * 100) / 100,
      discount: Math.round(discount * 100) / 100,
      total,
    };
  }, [posCart, posDiscount]);

  const addToPosCart = (item: PosCatalogItem) => {
    if (item.stock <= 0) {
      toast.error(`${item.name} is out of stock.`);
      return;
    }
    setPosCart((prev) => {
      const existing = prev.find((line) => line.itemId === item.id);
      if (existing) {
        if (existing.quantity + 1 > item.stock) {
          toast.error(`Only ${item.stock} unit(s) available for ${item.name}.`);
          return prev;
        }
        return prev.map((line) =>
          line.itemId === item.id
            ? {
                ...line,
                quantity: line.quantity + 1,
                subtotal: Math.round((line.quantity + 1) * line.unitPrice * 100) / 100,
              }
            : line,
        );
      }
      return [
        ...prev,
        {
          itemId: item.id,
          name: item.name,
          category: item.category,
          quantity: 1,
          unitPrice: item.price,
          subtotal: item.price,
          linkedStockId: item.linkedStockId,
        },
      ];
    });
  };

  const updatePosCartQty = (itemId: string, delta: number) => {
    setPosCart((prev) =>
      prev
        .map((line) => {
          if (line.itemId !== itemId) return line;
          const nextQty = line.quantity + delta;
          if (nextQty <= 0) return null;
          return {
            ...line,
            quantity: nextQty,
            subtotal: Math.round(nextQty * line.unitPrice * 100) / 100,
          };
        })
        .filter((x): x is PosCartLineItem => x !== null),
    );
  };

  const handleCompletePosCheckout = async (paymentMethod: PosTransaction["paymentMethod"]) => {
    if (posCart.length === 0) {
      toast.error("Cart is empty. Tap items to add them to the order.");
      return;
    }

    let resolvedCustomerName = posWalkInName.trim() || "Walk-In Customer";
    const selectedPlayer =
      posCustomerType === "Academy Player"
        ? players.find((p) => p.id === posLinkedPlayerId)
        : undefined;
    const selectedGymMember =
      posCustomerType === "Gym Member"
        ? gymMembers.find((m) => m.id === posLinkedGymMemberId)
        : undefined;

    if (posCustomerType === "Academy Player") {
      if (!selectedPlayer) {
        toast.error("Please select the Academy Player for this order.");
        return;
      }
      resolvedCustomerName = selectedPlayer.name;
    } else if (posCustomerType === "Gym Member") {
      if (!selectedGymMember) {
        toast.error("Please select the Gym Member for this order.");
        return;
      }
      resolvedCustomerName = selectedGymMember.memberName;
    }

    if (paymentMethod === "Charge to Account" && posCustomerType === "Walk-In") {
      toast.error(
        "To use 'Charge to Account', please select an Academy Player or Gym Member above.",
      );
      return;
    }

    const now = new Date();
    const today = todayISO();
    const timeStr = now.toTimeString().slice(0, 5);
    const receiptNumber = `POS-${Date.now().toString().slice(-6)}`;
    const activeBranch = branchFilter !== "All" ? branchFilter : defaultBranchName;

    const tx: PosTransaction = {
      id: uid("pos-tx"),
      receiptNumber,
      date: today,
      time: timeStr,
      branch: activeBranch,
      cashierName: currentUser?.name || "POS Cashier",
      customerType: posCustomerType,
      customerName: resolvedCustomerName,
      linkedPlayerId: selectedPlayer?.id,
      linkedGymMemberId: selectedGymMember?.id,
      items: posCart,
      subtotal: posCartTotals.subtotal,
      discount: posCartTotals.discount,
      total: posCartTotals.total,
      paymentMethod,
      status: "Completed",
      createdAt: now.toISOString(),
    };

    await setEntity("posTransactions", tx);

    // Deduct stock from posCatalog and/or db.stock
    for (const line of posCart) {
      if (line.linkedStockId) {
        const stk = stock.find((s) => s.id === line.linkedStockId);
        if (stk) {
          await patchEntity("stock", stk.id, {
            stock: Math.max(0, (Number(stk.stock) || 0) - line.quantity),
          });
        }
      } else {
        const catItem = posCatalog.find((c) => c.id === line.itemId);
        if (catItem && catItem.stock < 900) {
          await setEntity("posCatalog", {
            ...catItem,
            stock: Math.max(0, (Number(catItem.stock) || 0) - line.quantity),
          });
        }
      }
    }

    // Financial posting: Cash/Card -> Collected Revenue in Ledger; Charge to Account -> Player/Member balance + Pending Ledger
    if (paymentMethod === "Charge to Account") {
      if (selectedPlayer) {
        await patchEntity("players", selectedPlayer.id, {
          balance:
            Math.round(((Number(selectedPlayer.balance) || 0) + posCartTotals.total) * 100) / 100,
        });
      } else if (selectedGymMember) {
        await patchEntity("gymMembers", selectedGymMember.id, {
          balance:
            Math.round(((Number(selectedGymMember.balance) || 0) + posCartTotals.total) * 100) /
            100,
        });
      }

      const receivableEntry: LedgerEntry = {
        id: uid("led-pos"),
        date: today,
        account: "Kiosk POS Sales (Vescio Nexus)",
        category: "Kiosk POS",
        entry: `POS Account Charge (${receiptNumber}) · ${resolvedCustomerName}`,
        description: posCart.map((i) => `${i.quantity}x ${i.name}`).join(", "),
        type: "Revenue",
        amount: posCartTotals.total,
        status: "Pending",
        branch: activeBranch,
        referenceId: tx.id,
      };
      await setEntity("ledger", receivableEntry);
    } else {
      const collectedEntry: LedgerEntry = {
        id: uid("led-pos"),
        date: today,
        account: "Kiosk POS Sales (Vescio Nexus)",
        category: "Kiosk POS",
        entry: `POS Sale (${receiptNumber}) · ${paymentMethod} · ${resolvedCustomerName}`,
        description: posCart.map((i) => `${i.quantity}x ${i.name}`).join(", "),
        type: "Revenue",
        amount: posCartTotals.total,
        status: "Collected",
        branch: activeBranch,
        referenceId: tx.id,
      };
      await setEntity("ledger", collectedEntry);
    }

    setPosCart([]);
    setPosDiscount("0");
    setPosReceiptModalTx(tx);
    toast.success(
      paymentMethod === "Charge to Account"
        ? `Charged ${money(tx.total)} to ${resolvedCustomerName}'s account (${receiptNumber}).`
        : `POS Sale completed via ${paymentMethod}: ${money(tx.total)} (${receiptNumber}).`,
    );
  };

  const handleAddPosCatalogItem = async () => {
    if (!newCatalogItem.name.trim()) {
      toast.error("Please enter the product name.");
      return;
    }
    const item: PosCatalogItem = {
      id: uid("pos-item"),
      name: newCatalogItem.name.trim(),
      category: newCatalogItem.category,
      price: Math.max(0, Number(newCatalogItem.price) || 0),
      stock: Math.max(0, Number(newCatalogItem.stock) || 0),
      sku: newCatalogItem.sku.trim() || `POS-${Date.now().toString().slice(-4)}`,
      branch: newCatalogItem.branch === "All" ? undefined : newCatalogItem.branch,
      active: true,
    };
    // Ensure default catalog items are persisted in Firestore alongside the new item
    if (!db.posCatalog || db.posCatalog.length === 0) {
      for (const defItem of DEFAULT_POS_CATALOG) {
        await setEntity("posCatalog", defItem);
      }
    }
    await setEntity("posCatalog", item);
    setNewCatalogItem({
      name: "",
      category: "Hydration & Drinks",
      price: "3.00",
      stock: "50",
      sku: "",
      branch: branchFilter !== "All" ? branchFilter : "All",
    });
    setPosCatalogModalOpen(false);
    toast.success(`Added "${item.name}" to the Vescio Nexus Kiosk POS catalog.`);
  };

  // Daily Register Summary for POS
  const posDailyRegister = useMemo(() => {
    const today = todayISO();
    const todayTxs = filteredPosTransactions.filter(
      (t) => t.date === today && t.status === "Completed",
    );
    const cashTotal = todayTxs
      .filter((t) => t.paymentMethod === "Cash")
      .reduce((s, t) => s + t.total, 0);
    const cardTotal = todayTxs
      .filter((t) => t.paymentMethod === "Card")
      .reduce((s, t) => s + t.total, 0);
    const accountChargeTotal = todayTxs
      .filter((t) => t.paymentMethod === "Charge to Account")
      .reduce((s, t) => s + t.total, 0);
    return {
      count: todayTxs.length,
      cashTotal: Math.round(cashTotal * 100) / 100,
      cardTotal: Math.round(cardTotal * 100) / 100,
      accountChargeTotal: Math.round(accountChargeTotal * 100) / 100,
      grandTotal: Math.round((cashTotal + cardTotal + accountChargeTotal) * 100) / 100,
    };
  }, [filteredPosTransactions]);

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-ink-950 text-ink-100 flex flex-col">
      {/* =================================================================== */}
      {/* STANDALONE VESCIO NEXUS PERSISTENT TOP HEADER BAR                   */}
      {/* =================================================================== */}
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
                Synced with {db.academy?.name || "Vescio Vector"} Roster, Courts, Stock &amp; Ledger
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
              className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 font-mono text-xs font-semibold transition-all ${
                activeModule === "courts"
                  ? "bg-court-500/20 text-court-300 ring-1 ring-court-500/40"
                  : "text-ink-300 hover:bg-ink-850 hover:text-ink-100"
              }`}
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
              <span>Physiotherapy</span>
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

      {/* =================================================================== */}
      {/* MAIN VESCIO NEXUS CONTENT CONTAINER                                 */}
      {/* =================================================================== */}
      <main className="mx-auto w-full max-w-[1600px] min-w-0 flex-1 px-4 py-6 lg:px-8 space-y-6">
        {/* Top KPI Strip */}
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Court Rentals Collected"
            value={money(ecosystemKpis.courtRevenueCollected)}
            sub={`${ecosystemKpis.activeReservationsCount} bookings · ${money(ecosystemKpis.courtPendingReceivables)} pending`}
            accent
          />
          <Stat
            label="Active Gym & S&C Athletes"
            value={String(ecosystemKpis.activeGymCount)}
            sub={`${ecosystemKpis.todayGymCheckIns} checked in today · ${money(ecosystemKpis.gymMonthlyRevenue)}/mo`}
          />
          <Stat
            label="Physio & Medical Roster"
            value={`${ecosystemKpis.activeRehabCases} Active Cases`}
            sub={`${ecosystemKpis.injuredOrLimitedPlayers} Academy player(s) Limited/Out`}
          />
          <Stat
            label="Kiosk POS Sales (Today)"
            value={money(ecosystemKpis.todayPosSales)}
            sub={`Cumulative POS Revenue: ${money(ecosystemKpis.totalPosSales)}`}
            accent
          />
        </div>

        {/* ================================================================= */}
        {/* VIEW 0: VESCIO NEXUS LANDING PAGE                                 */}
        {/* ================================================================= */}
        {activeModule === "hub" && (
          <div className="min-w-0 max-w-full space-y-6">
            <div className="rounded-xl border border-emerald-500/30 bg-gradient-to-r from-ink-900 via-ink-900 to-emerald-950/40 p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="min-w-0 max-w-2xl space-y-1.5">
                  <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-emerald-300 ring-1 ring-emerald-500/30">
                    <Sparkles className="h-3 w-3" />
                    <span>Unified Multi-Branch Sports Facility ERP</span>
                  </div>
                  <h2 className="font-display text-2xl tracking-tight text-ink-100">
                    Welcome to Vescio Nexus
                  </h2>
                  <p className="text-xs text-ink-300 leading-relaxed">
                    All 4 facility pillars share the exact same live Vescio Vector database and
                    multi-branch foundation: court allocations (Full Court, HCA, HCB) prevent
                    double-bookings with Academy practices, Physiotherapy medical statuses update
                    Academy player rosters in real time, and Kiosk POS / Gym charges post directly
                    to player accounts and the central accounting ledger.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <Button variant="ghost" onClick={() => setActiveModule("branches")}>
                    <Building2 className="mr-1.5 h-3.5 w-3.5 text-purple-400" />
                    Manage Nexus Branches ({branches.length})
                  </Button>
                  <Link
                    to="/"
                    className="inline-flex items-center gap-2 rounded-lg bg-ink-850 px-4 py-2.5 font-mono text-xs font-semibold text-ink-100 ring-1 ring-ink-700 hover:bg-ink-800"
                  >
                    <ArrowLeft className="h-4 w-4 text-court-400" />
                    <span>Return to Vescio Vector Academy</span>
                  </Link>
                </div>
              </div>
            </div>

            {/* Active Branch Facility Snapshot Strip */}
            <div className="rounded-xl border border-ink-800 bg-ink-900/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-purple-500/15 text-purple-300 ring-1 ring-purple-500/30">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-purple-300">
                        Active Nexus Scope
                      </span>
                      <span className="rounded bg-purple-500/20 px-2 py-0.5 font-mono text-[10px] font-bold text-purple-200">
                        {branchFilter === "All"
                          ? `All Branches (${branches.length})`
                          : branchFilter}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-ink-300">
                      {activeBranchObj
                        ? `${activeBranchObj.name} · ${activeBranchObj.courts?.length || 1} Court(s) · Gym Capacity: ${activeBranchObj.gymCapacity ?? 30} athletes · Physio Rooms: ${activeBranchObj.physioRoomsCount ?? 2} · POS Register: ${activeBranchObj.posRegisterName || "Main Kiosk #1"}`
                        : "Create or configure branches in Nexus Branches to customize courts, gym capacity, physio rooms, and POS registers."}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="ghost" onClick={openCreateBranchModal}>
                    + New Nexus Branch
                  </Button>
                  <Button onClick={() => setActiveModule("branches")}>
                    Configure Nexus Branches →
                  </Button>
                </div>
              </div>
            </div>

            {/* 4 Module Cards */}
            <div className="grid min-w-0 gap-5 md:grid-cols-2">
              {/* 1. Court & Facility Reservation Module */}
              <div className="flex min-w-0 flex-col justify-between rounded-xl border border-ink-800 bg-ink-900/90 p-5 transition-all hover:border-court-500/50">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-court-500/15 text-court-400 ring-1 ring-court-500/30">
                        <Calendar className="h-5 w-5" />
                      </div>
                      <div>
                        <span className="font-mono text-[10px] uppercase tracking-widest text-court-400">
                          Vescio Nexus · Module 01
                        </span>
                        <h3 className="font-display text-lg text-ink-100">
                          Court &amp; Facility Reservation Module
                        </h3>
                      </div>
                    </div>
                    <Chip tone="court">Full · HCA · HCB</Chip>
                  </div>

                  <p className="text-xs text-ink-300 leading-relaxed">
                    Daily, Weekly, and Monthly 15-minute drag-to-book calendar (HCA, HCB, or Full
                    Court), snapshot-protected branch Rates Setup, Walk-in &amp; Continuous
                    recurring bookings, Off Days closures, and direct Financial Ledger Cash-In.
                  </p>

                  <div className="grid grid-cols-3 gap-2 rounded-lg border border-ink-800 bg-ink-950/70 p-3 font-mono text-xs">
                    <div>
                      <div className="text-[10px] text-ink-400">Active Bookings</div>
                      <div className="mt-0.5 font-semibold text-ink-100">
                        {ecosystemKpis.activeReservationsCount}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-ink-400">Collected Fees</div>
                      <div className="mt-0.5 font-semibold text-emerald-400">
                        {money(ecosystemKpis.courtRevenueCollected)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-ink-400">Open Balance</div>
                      <div className="mt-0.5 font-semibold text-amber-400">
                        {money(ecosystemKpis.courtPendingReceivables)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-ink-800 pt-4">
                  <span className="font-mono text-[11px] text-ink-400">
                    Synced with {branches.reduce((acc, b) => acc + (b.courts?.length || 1), 0)}{" "}
                    branch courts
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setActiveModule("courts");
                        setCourtNewBookingTrigger((n) => n + 1);
                      }}
                    >
                      + New Booking
                    </Button>
                    <Button onClick={() => setActiveModule("courts")}>
                      Open Court Reservations →
                    </Button>
                  </div>
                </div>
              </div>

              {/* 2. Gym & Strength Module */}
              <div className="flex min-w-0 flex-col justify-between rounded-xl border border-ink-800 bg-ink-900/90 p-5 transition-all hover:border-sky-500/50">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-sky-500/15 text-sky-400 ring-1 ring-sky-500/30">
                        <Dumbbell className="h-5 w-5" />
                      </div>
                      <div>
                        <span className="font-mono text-[10px] uppercase tracking-widest text-sky-400">
                          Vescio Nexus · Module 02
                        </span>
                        <h3 className="font-display text-lg text-ink-100">
                          Gym &amp; Strength Module
                        </h3>
                      </div>
                    </div>
                    <Chip tone="info">S&amp;C + Memberships</Chip>
                  </div>

                  <p className="text-xs text-ink-300 leading-relaxed">
                    Manage gym memberships, Strength &amp; Conditioning session packs, daily athlete
                    check-ins, and structured workout logs (sets, reps, load kg, RPE &amp; PRs) for
                    both Academy players and external gym members.
                  </p>

                  <div className="grid grid-cols-3 gap-2 rounded-lg border border-ink-800 bg-ink-950/70 p-3 font-mono text-xs">
                    <div>
                      <div className="text-[10px] text-ink-400">Active Members</div>
                      <div className="mt-0.5 font-semibold text-ink-100">
                        {ecosystemKpis.activeGymCount}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-ink-400">Today Check-Ins</div>
                      <div className="mt-0.5 font-semibold text-sky-400">
                        {ecosystemKpis.todayGymCheckIns}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-ink-400">Monthly Recurring</div>
                      <div className="mt-0.5 font-semibold text-emerald-400">
                        {money(ecosystemKpis.gymMonthlyRevenue)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-ink-800 pt-4">
                  <span className="font-mono text-[11px] text-ink-400">
                    Branch Gym Cap: {activeBranchObj?.gymCapacity ?? 30} athletes
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setActiveModule("gym");
                        openEnrollGymModal();
                      }}
                    >
                      + Enroll Member
                    </Button>
                    <Button onClick={() => setActiveModule("gym")}>
                      Open Gym &amp; Strength →
                    </Button>
                  </div>
                </div>
              </div>

              {/* 3. Physiotherapy & Medical Module */}
              <div className="flex min-w-0 flex-col justify-between rounded-xl border border-ink-800 bg-ink-900/90 p-5 transition-all hover:border-rose-500/50">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/30">
                        <HeartPulse className="h-5 w-5" />
                      </div>
                      <div>
                        <span className="font-mono text-[10px] uppercase tracking-widest text-rose-400">
                          Vescio Nexus · Module 03
                        </span>
                        <h3 className="font-display text-lg text-ink-100">
                          Physiotherapy &amp; Medical Module
                        </h3>
                      </div>
                    </div>
                    <Chip tone="warn">Live Roster Sync</Chip>
                  </div>

                  <p className="text-xs text-ink-300 leading-relaxed">
                    Injury assessment intake, player medical status synced directly with the Academy
                    (Fit, Limited/Modified Training, Injured/Out), treatment session scheduling,
                    therapist SOAP notes, and 5-stage Return-to-Play (RTP) progression tracking.
                  </p>

                  <div className="grid grid-cols-3 gap-2 rounded-lg border border-ink-800 bg-ink-950/70 p-3 font-mono text-xs">
                    <div>
                      <div className="text-[10px] text-ink-400">Active Rehab Cases</div>
                      <div className="mt-0.5 font-semibold text-ink-100">
                        {ecosystemKpis.activeRehabCases}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-ink-400">Players Limited/Out</div>
                      <div className="mt-0.5 font-semibold text-rose-400">
                        {ecosystemKpis.injuredOrLimitedPlayers}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-ink-400">Cleared / Fit</div>
                      <div className="mt-0.5 font-semibold text-emerald-400">
                        {Math.max(0, players.length - ecosystemKpis.injuredOrLimitedPlayers)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-ink-800 pt-4">
                  <span className="font-mono text-[11px] text-ink-400">
                    Clinic Rooms: {activeBranchObj?.physioRoomsCount ?? 2} ·{" "}
                    {activeBranchObj?.leadPhysiotherapist || "Dr. Rami Khoury (PT)"}
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setActiveModule("physio");
                        openPhysioIntakeModal();
                      }}
                    >
                      + Injury Intake
                    </Button>
                    <Button onClick={() => setActiveModule("physio")}>Open Physiotherapy →</Button>
                  </div>
                </div>
              </div>

              {/* 4. Kiosk POS (Point of Sale) */}
              <div className="flex min-w-0 flex-col justify-between rounded-xl border border-ink-800 bg-ink-900/90 p-5 transition-all hover:border-amber-500/50">
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/30">
                        <ShoppingCart className="h-5 w-5" />
                      </div>
                      <div>
                        <span className="font-mono text-[10px] uppercase tracking-widest text-amber-400">
                          Vescio Nexus · Module 04
                        </span>
                        <h3 className="font-display text-lg text-ink-100">
                          Kiosk POS (Point of Sale)
                        </h3>
                      </div>
                    </div>
                    <Chip tone="ok">Touch-Ready POS</Chip>
                  </div>

                  <p className="text-xs text-ink-300 leading-relaxed">
                    Fast touch-friendly POS interface for on-site sales (water, sports drinks,
                    academy uniforms synced with inventory, court walk-in fees, snacks &amp; tape).
                    Supports Cash, Card, or Charge to Player/Member Account with daily sales
                    summary.
                  </p>

                  <div className="grid grid-cols-3 gap-2 rounded-lg border border-ink-800 bg-ink-950/70 p-3 font-mono text-xs">
                    <div>
                      <div className="text-[10px] text-ink-400">Today Register</div>
                      <div className="mt-0.5 font-semibold text-emerald-400">
                        {money(posDailyRegister.grandTotal)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-ink-400">Cash / Card</div>
                      <div className="mt-0.5 font-semibold text-ink-100">
                        {money(posDailyRegister.cashTotal + posDailyRegister.cardTotal)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-ink-400">Account Charges</div>
                      <div className="mt-0.5 font-semibold text-amber-400">
                        {money(posDailyRegister.accountChargeTotal)}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-ink-800 pt-4">
                  <span className="font-mono text-[11px] text-ink-400">
                    {unifiedPosCatalog.length} products &amp; merch items ready
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button onClick={() => setActiveModule("pos")}>
                      Launch Kiosk POS Terminal →
                    </Button>
                  </div>
                </div>
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
          <div className="min-w-0 max-w-full space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-800 bg-ink-900/90 p-4">
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-widest text-sky-400">
                  Vescio Nexus · Module 02 ·{" "}
                  {branchFilter === "All" ? "All Branches" : branchFilter}
                </div>
                <h2 className="font-display text-xl text-ink-100">
                  Gym Memberships, Daily Check-Ins &amp; Strength Logs
                </h2>
                <p className="text-xs text-ink-400">
                  Manage S&amp;C packages, daily gym floor check-ins, and personal record / RPE
                  training logs for Academy athletes and external gym members.
                </p>
              </div>
              <Button onClick={openEnrollGymModal}>+ New Gym / S&amp;C Membership</Button>
            </div>

            <Panel
              title="Gym & Strength Roster"
              meta={`${filteredGymMembers.length} enrolled athlete(s) & member(s)`}
            >
              {filteredGymMembers.length === 0 ? (
                <EmptyState
                  title="No Gym or Strength & Conditioning members enrolled yet"
                  hint="Click '+ New Gym / S&C Membership' to enroll an Academy Player or External Gym Member."
                />
              ) : (
                <div className="w-full max-w-full overflow-x-auto">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Member / Athlete</Th>
                        <Th>Type &amp; Branch</Th>
                        <Th>Package &amp; Access</Th>
                        <Th>Check-Ins &amp; Last Visit</Th>
                        <Th>Workout Logs</Th>
                        <Th>Status</Th>
                        <Th className="text-right">Actions</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredGymMembers.map((m) => (
                        <tr key={m.id} className="border-t border-ink-800/70">
                          <Td>
                            <div className="font-medium text-ink-100">{m.memberName}</div>
                            <div className="font-mono text-[10px] text-ink-400">
                              {m.phone || "No phone"} · Valid {m.startDate} → {m.expiryDate}
                            </div>
                          </Td>
                          <Td>
                            <Chip tone={m.memberType === "Academy Player" ? "court" : "info"}>
                              {m.memberType}
                            </Chip>
                            <div className="mt-1 font-mono text-[10px] text-ink-400">
                              {m.branch}
                            </div>
                          </Td>
                          <Td>
                            <div className="text-xs font-semibold text-ink-100">
                              {m.packageType}
                            </div>
                            <div className="font-mono text-[10px] text-emerald-400">
                              {money(m.monthlyFee)} ·{" "}
                              {(m.totalSessionsIncluded ?? 0) >= 999
                                ? "Unlimited Sessions"
                                : `${m.sessionsRemaining ?? 0}/${m.totalSessionsIncluded ?? 10} sessions left`}
                            </div>
                          </Td>
                          <Td>
                            <div className="font-mono text-xs font-semibold text-ink-100">
                              {m.totalCheckIns || 0} check-ins
                            </div>
                            <div className="font-mono text-[10px] text-ink-400">
                              Last: {m.lastCheckInDate || "Never"}
                            </div>
                          </Td>
                          <Td>
                            <button
                              type="button"
                              onClick={() => setWorkoutModalMember(m)}
                              className="inline-flex items-center gap-1.5 rounded bg-sky-500/15 px-2.5 py-1 font-mono text-[10px] font-semibold text-sky-300 ring-1 ring-sky-500/30 hover:bg-sky-500/25"
                            >
                              <Dumbbell className="h-3 w-3" />
                              <span>{(m.workoutLogs || []).length} Workout Log(s)</span>
                            </button>
                          </Td>
                          <Td>
                            <Chip
                              tone={
                                m.status === "Active"
                                  ? "ok"
                                  : m.status === "Paused"
                                    ? "warn"
                                    : "danger"
                              }
                            >
                              {m.status}
                            </Chip>
                          </Td>
                          <Td className="text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => void handleGymCheckIn(m)}
                                className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-2.5 py-1 font-mono text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/30"
                              >
                                <UserCheck className="h-3 w-3" />
                                <span>Check In</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setWorkoutModalMember(m)}
                                className="rounded bg-ink-850 px-2 py-1 font-mono text-[10px] text-ink-200 ring-1 ring-ink-700 hover:bg-ink-800"
                              >
                                + Log Workout
                              </button>
                              <button
                                type="button"
                                onClick={() => void deleteEntity("gymMembers", m.id)}
                                className="rounded bg-ink-850 p-1 text-ink-400 hover:text-red-400"
                                title="Delete member"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </Panel>
          </div>
        )}

        {/* ================================================================= */}
        {/* VIEW 3: PHYSIOTHERAPY & MEDICAL MODULE                            */}
        {/* ================================================================= */}
        {activeModule === "physio" && (
          <div className="min-w-0 max-w-full space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-800 bg-ink-900/90 p-4">
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-widest text-rose-400">
                  Vescio Nexus · Module 03 ·{" "}
                  {branchFilter === "All" ? "All Branches" : branchFilter}
                </div>
                <h2 className="font-display text-xl text-ink-100">
                  Physiotherapy, Injury Intake &amp; Return-to-Play (RTP)
                </h2>
                <p className="text-xs text-ink-400">
                  Medical clearance statuses (Fit, Limited/Modified Training, Injured/Out) sync
                  automatically with Academy player profiles.
                </p>
              </div>
              <Button onClick={openPhysioIntakeModal}>+ New Injury Assessment Intake</Button>
            </div>

            {/* Active Physiotherapy & RTP Clinical Cases */}
            <Panel
              title="Physiotherapy Clinical Roster & Return-to-Play (RTP) Progression"
              meta={`${filteredPhysioRecords.length} clinical record(s)`}
            >
              {filteredPhysioRecords.length === 0 ? (
                <EmptyState
                  title="No Physiotherapy or Injury Assessment records logged"
                  hint="Click '+ New Injury Assessment Intake' to log an injury assessment, set Academy clearance status, and track Return-to-Play stages."
                />
              ) : (
                <div className="w-full max-w-full overflow-x-auto">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Patient / Athlete</Th>
                        <Th>Injury &amp; Diagnosis</Th>
                        <Th>Academy Medical Status</Th>
                        <Th>Return-to-Play (RTP) Stage</Th>
                        <Th>Sessions</Th>
                        <Th className="text-right">Clinical Actions</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPhysioRecords.map((rec) => (
                        <tr key={rec.id} className="border-t border-ink-800/70">
                          <Td>
                            <div className="font-medium text-ink-100">{rec.patientName}</div>
                            <div className="font-mono text-[10px] text-ink-400">
                              {rec.patientType} {rec.team ? `· ${rec.team}` : ""} · {rec.branch}
                            </div>
                          </Td>
                          <Td>
                            <div className="text-xs font-semibold text-ink-100">
                              {rec.injuryArea} ·{" "}
                              <span className="text-rose-300">{rec.severity}</span>
                            </div>
                            <div className="text-xs text-ink-300">{rec.diagnosis}</div>
                            {rec.restrictions && (
                              <div className="mt-0.5 font-mono text-[10px] text-amber-300/90">
                                Restriction: {rec.restrictions}
                              </div>
                            )}
                          </Td>
                          <Td>
                            <select
                              value={rec.medicalStatus}
                              onChange={(e) =>
                                void handleUpdatePhysioRtpAndStatus(
                                  rec,
                                  e.target.value as PlayerMedicalClearanceStatus,
                                  e.target.value === "Fit" ? 5 : rec.rtpStage,
                                )
                              }
                              className={`rounded-md px-2.5 py-1 font-mono text-xs font-bold ring-1 focus:outline-none ${
                                rec.medicalStatus === "Fit"
                                  ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                                  : rec.medicalStatus === "Limited"
                                    ? "bg-amber-500/15 text-amber-300 ring-amber-500/30"
                                    : "bg-red-500/15 text-red-300 ring-red-500/30"
                              }`}
                            >
                              <option value="Fit" className="bg-ink-900 text-emerald-300">
                                Fit (Cleared)
                              </option>
                              <option value="Limited" className="bg-ink-900 text-amber-300">
                                Limited / Modified Training
                              </option>
                              <option value="Injured" className="bg-ink-900 text-red-300">
                                Injured / Out
                              </option>
                            </select>
                          </Td>
                          <Td>
                            <div className="flex items-center gap-1.5">
                              {[1, 2, 3, 4, 5].map((st) => (
                                <button
                                  key={st}
                                  type="button"
                                  onClick={() =>
                                    void handleUpdatePhysioRtpAndStatus(
                                      rec,
                                      st === 5 ? "Fit" : rec.medicalStatus,
                                      st as 1 | 2 | 3 | 4 | 5,
                                    )
                                  }
                                  className={`h-6 w-6 rounded font-mono text-[10px] font-bold transition-all ${
                                    rec.rtpStage >= st
                                      ? st === 5
                                        ? "bg-emerald-500 text-ink-950"
                                        : "bg-court-500 text-ink-950"
                                      : "bg-ink-850 text-ink-400 hover:bg-ink-800"
                                  }`}
                                  title={RTP_STAGES[st - 1]?.title}
                                >
                                  {st}
                                </button>
                              ))}
                            </div>
                            <div className="mt-1 font-mono text-[10px] text-ink-400">
                              {RTP_STAGES[rec.rtpStage - 1]?.title}
                            </div>
                          </Td>
                          <Td>
                            <span className="font-mono text-xs text-ink-200">
                              {(rec.treatmentSessions || []).length} session(s)
                            </span>
                          </Td>
                          <Td className="text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setActivePhysioRecord(rec)}
                                className="rounded bg-rose-500/15 px-2.5 py-1 font-mono text-[10px] font-semibold text-rose-300 ring-1 ring-rose-500/30 hover:bg-rose-500/25"
                              >
                                SOAP Notes &amp; Sessions
                              </button>
                              <button
                                type="button"
                                onClick={() => void deleteEntity("physioRecords", rec.id)}
                                className="rounded bg-ink-850 p-1 text-ink-400 hover:text-red-400"
                                title="Delete clinical record"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </Panel>

            {/* Direct Academy Roster Medical Status Board */}
            <Panel
              title="Academy Players Live Medical Status Board (Synced with Players Module)"
              meta={`${players.length} Academy player(s)`}
            >
              {players.length === 0 ? (
                <EmptyState
                  title="No Academy players registered yet"
                  hint="Players registered in Vescio Vector Academy appear here automatically for instant medical clearance syncing."
                />
              ) : (
                <div className="w-full max-w-full overflow-x-auto">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Player Name</Th>
                        <Th>Category &amp; Team(s)</Th>
                        <Th>Branch</Th>
                        <Th>Medical Notes</Th>
                        <Th>Synced Medical Clearance</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {players
                        .filter(
                          (p) =>
                            branchFilter === "All" ||
                            (p.branch || "").toLowerCase() === branchFilter.toLowerCase(),
                        )
                        .slice(0, 25)
                        .map((p) => {
                          const medStatus: PlayerMedicalClearanceStatus = p.medicalStatus || "Fit";
                          return (
                            <tr key={p.id} className="border-t border-ink-800/70">
                              <Td>
                                <div className="font-medium text-ink-100">{p.name}</div>
                              </Td>
                              <Td>
                                <span className="font-mono text-xs text-ink-300">
                                  {p.category} · {(p.teams || []).join(", ") || "Unassigned"}
                                </span>
                              </Td>
                              <Td>
                                <span className="font-mono text-xs text-ink-400">{p.branch}</span>
                              </Td>
                              <Td>
                                <span className="text-xs text-ink-300">
                                  {p.medicalNotes || "No restrictions recorded"}
                                </span>
                              </Td>
                              <Td>
                                <div className="inline-flex items-center gap-1.5">
                                  {(["Fit", "Limited", "Injured"] as const).map((statusOpt) => (
                                    <button
                                      key={statusOpt}
                                      type="button"
                                      onClick={() => {
                                        void syncPlayerMedicalStatusToAcademy(
                                          p.id,
                                          statusOpt,
                                          statusOpt === "Fit" ? 5 : statusOpt === "Limited" ? 3 : 1,
                                        );
                                        toast.success(
                                          `Synced ${p.name}'s Academy medical status to "${statusOpt}".`,
                                        );
                                      }}
                                      className={`rounded px-2.5 py-1 font-mono text-[10px] font-bold transition-all ${
                                        medStatus === statusOpt
                                          ? statusOpt === "Fit"
                                            ? "bg-emerald-500 text-ink-950"
                                            : statusOpt === "Limited"
                                              ? "bg-amber-400 text-ink-950"
                                              : "bg-red-500 text-white"
                                          : "bg-ink-850 text-ink-400 hover:bg-ink-800"
                                      }`}
                                    >
                                      {statusOpt === "Fit"
                                        ? "Fit"
                                        : statusOpt === "Limited"
                                          ? "Limited"
                                          : "Injured / Out"}
                                    </button>
                                  ))}
                                </div>
                              </Td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </Table>
                </div>
              )}
            </Panel>
          </div>
        )}

        {/* ================================================================= */}
        {/* VIEW 4: KIOSK POS (POINT OF SALE)                                 */}
        {/* ================================================================= */}
        {activeModule === "pos" && (
          <div className="min-w-0 max-w-full space-y-6">
            {/* POS Top Bar & Daily Register Summary Strip */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-ink-800 bg-ink-900/90 p-4">
              <div className="min-w-0">
                <div className="font-mono text-[10px] uppercase tracking-widest text-amber-400">
                  Vescio Nexus · Module 04 ·{" "}
                  {activeBranchObj?.posRegisterName || "Touch POS Terminal"} (
                  {branchFilter === "All" ? "All Branches" : branchFilter})
                </div>
                <h2 className="font-display text-xl text-ink-100">
                  On-Site Kiosk Point of Sale (POS)
                </h2>
                <p className="text-xs text-ink-400">
                  Instant checkout for drinks, snacks, academy uniforms, court walk-in passes &amp;
                  physio tape.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-wrap items-center gap-4 rounded-lg border border-ink-800 bg-ink-950 px-4 py-2 font-mono text-xs">
                  <div>
                    <span className="text-[10px] text-ink-400 block">Today Cash</span>
                    <span className="font-bold text-emerald-400">
                      {money(posDailyRegister.cashTotal)}
                    </span>
                  </div>
                  <div className="h-6 w-px bg-ink-800" />
                  <div>
                    <span className="text-[10px] text-ink-400 block">Today Card</span>
                    <span className="font-bold text-sky-400">
                      {money(posDailyRegister.cardTotal)}
                    </span>
                  </div>
                  <div className="h-6 w-px bg-ink-800" />
                  <div>
                    <span className="text-[10px] text-ink-400 block">Charged to Account</span>
                    <span className="font-bold text-amber-400">
                      {money(posDailyRegister.accountChargeTotal)}
                    </span>
                  </div>
                </div>

                <Button
                  variant="ghost"
                  onClick={() => {
                    setNewCatalogItem((prev) => ({
                      ...prev,
                      branch: branchFilter !== "All" ? branchFilter : "All",
                    }));
                    setPosCatalogModalOpen(true);
                  }}
                >
                  + Add POS Product
                </Button>
              </div>
            </div>

            {/* POS Main Touch Interface: Left Product Grid + Right Cart & Checkout */}
            <div className="grid min-w-0 max-w-full gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
              {/* Left: Product Grid */}
              <div className="min-w-0 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {POS_CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setPosCategory(cat)}
                        className={`rounded-lg px-3 py-2 font-mono text-xs font-semibold transition-all ${
                          posCategory === cat
                            ? "bg-amber-400 text-ink-950 shadow-sm"
                            : "bg-ink-900 text-ink-300 ring-1 ring-ink-800 hover:bg-ink-850"
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>

                  <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-ink-400" />
                    <input
                      type="text"
                      value={posSearch}
                      onChange={(e) => setPosSearch(e.target.value)}
                      placeholder="Search item or SKU..."
                      className="w-full rounded-lg border border-ink-800 bg-ink-900 py-2 pl-9 pr-3 text-xs text-ink-100 placeholder:text-ink-500 focus:border-amber-400 focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredPosCatalog.map((item) => {
                    const inCartQty =
                      posCart.find((line) => line.itemId === item.id)?.quantity || 0;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => addToPosCart(item)}
                        className={`group relative flex min-w-0 flex-col justify-between rounded-xl border p-4 text-left transition-all cursor-pointer ${
                          inCartQty > 0
                            ? "border-amber-400 bg-amber-500/10 ring-1 ring-amber-400/40"
                            : "border-ink-800 bg-ink-900/90 hover:border-amber-500/40 hover:bg-ink-850"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <span className="truncate font-mono text-[10px] uppercase tracking-wider text-ink-400">
                              {item.category}
                            </span>
                            {inCartQty > 0 && (
                              <span className="shrink-0 rounded-full bg-amber-400 px-2 py-0.5 font-mono text-[10px] font-bold text-ink-950">
                                {inCartQty} in cart
                              </span>
                            )}
                          </div>
                          <div className="mt-1.5 font-semibold text-sm text-ink-100 group-hover:text-amber-300">
                            {item.name}
                          </div>
                        </div>

                        <div className="mt-4 flex items-baseline justify-between border-t border-ink-800/80 pt-3">
                          <span className="font-display text-lg text-emerald-400">
                            {money(item.price)}
                          </span>
                          <span className="font-mono text-[10px] text-ink-400">
                            {item.stock >= 900 ? "Unlimited Pass" : `Stock: ${item.stock}`}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Right: Active POS Cart & Checkout Terminal */}
              <div className="flex min-w-0 flex-col justify-between rounded-xl border border-ink-800 bg-ink-900 p-5 space-y-5 h-fit lg:sticky lg:top-32">
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-ink-800 pb-3">
                    <div className="flex items-center gap-2">
                      <ShoppingCart className="h-4 w-4 text-amber-400" />
                      <h3 className="font-display text-base text-ink-100">Current Order Cart</h3>
                    </div>
                    {posCart.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setPosCart([])}
                        className="font-mono text-[10px] text-red-400 hover:underline"
                      >
                        Clear Cart
                      </button>
                    )}
                  </div>

                  {/* Customer / Account Selector */}
                  <div className="space-y-2 rounded-lg border border-ink-800 bg-ink-950/70 p-3">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
                      Customer / Account Assignment
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(["Walk-In", "Academy Player", "Gym Member"] as const).map((typeOpt) => (
                        <button
                          key={typeOpt}
                          type="button"
                          onClick={() => setPosCustomerType(typeOpt)}
                          className={`rounded py-1.5 font-mono text-[10px] font-semibold transition-all ${
                            posCustomerType === typeOpt
                              ? "bg-court-500 text-ink-950"
                              : "bg-ink-900 text-ink-300 hover:bg-ink-850"
                          }`}
                        >
                          {typeOpt}
                        </button>
                      ))}
                    </div>

                    {posCustomerType === "Walk-In" && (
                      <Input
                        value={posWalkInName}
                        onChange={setPosWalkInName}
                        placeholder="Walk-in customer name (optional)"
                      />
                    )}

                    {posCustomerType === "Academy Player" && (
                      <Select
                        value={posLinkedPlayerId}
                        onChange={setPosLinkedPlayerId}
                        options={[
                          { label: "— Select Academy Player —", value: "" },
                          ...players.map((p) => ({
                            label: `${p.name} (${p.category} · Bal: ${money(p.balance)})`,
                            value: p.id,
                          })),
                        ]}
                      />
                    )}

                    {posCustomerType === "Gym Member" && (
                      <Select
                        value={posLinkedGymMemberId}
                        onChange={setPosLinkedGymMemberId}
                        options={[
                          { label: "— Select Gym Member —", value: "" },
                          ...gymMembers.map((m) => ({
                            label: `${m.memberName} (${m.packageType})`,
                            value: m.id,
                          })),
                        ]}
                      />
                    )}
                  </div>

                  {/* Cart Line Items */}
                  {posCart.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-ink-800 py-10 text-center">
                      <ShoppingBag className="mx-auto h-7 w-7 text-ink-500" />
                      <div className="mt-2 text-xs text-ink-400">
                        Tap any item on the left to add it to the POS cart
                      </div>
                    </div>
                  ) : (
                    <div className="max-h-[280px] space-y-2 overflow-y-auto pr-1">
                      {posCart.map((line) => (
                        <div
                          key={line.itemId}
                          className="flex items-center justify-between gap-2 rounded-lg border border-ink-800 bg-ink-950/80 px-3 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-medium text-ink-100">
                              {line.name}
                            </div>
                            <div className="font-mono text-[10px] text-ink-400">
                              {money(line.unitPrice)} each
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => updatePosCartQty(line.itemId, -1)}
                              className="grid h-6 w-6 place-items-center rounded bg-ink-850 text-ink-200 hover:bg-ink-800"
                            >
                              <Minus className="h-3 w-3" />
                            </button>
                            <span className="w-6 text-center font-mono text-xs font-bold text-ink-100">
                              {line.quantity}
                            </span>
                            <button
                              type="button"
                              onClick={() => updatePosCartQty(line.itemId, 1)}
                              className="grid h-6 w-6 place-items-center rounded bg-ink-850 text-ink-200 hover:bg-ink-800"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          </div>
                          <div className="w-16 text-right font-mono text-xs font-semibold text-emerald-400">
                            {money(line.subtotal)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Totals & 3 Instant Payment Buttons */}
                <div className="space-y-3 border-t border-ink-800 pt-4">
                  <div className="flex items-center justify-between text-xs text-ink-300">
                    <span>Subtotal</span>
                    <span className="font-mono">{money(posCartTotals.subtotal)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-xs text-ink-300">
                    <span>Discount ($)</span>
                    <input
                      type="number"
                      min="0"
                      step="0.5"
                      value={posDiscount}
                      onChange={(e) => setPosDiscount(e.target.value)}
                      className="w-24 rounded border border-ink-800 bg-ink-950 px-2 py-1 text-right font-mono text-xs text-ink-100"
                    />
                  </div>
                  <div className="flex items-baseline justify-between border-t border-ink-800 pt-2">
                    <span className="font-mono text-xs uppercase tracking-wider text-ink-300">
                      Total Due
                    </span>
                    <span className="font-display text-2xl text-emerald-400">
                      {money(posCartTotals.total)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => void handleCompletePosCheckout("Cash")}
                      className="flex items-center justify-center gap-2 rounded-lg bg-emerald-500 py-3 font-mono text-xs font-bold text-ink-950 shadow-sm hover:bg-emerald-400 cursor-pointer"
                    >
                      <Wallet className="h-4 w-4" />
                      <span>Pay Cash</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleCompletePosCheckout("Card")}
                      className="flex items-center justify-center gap-2 rounded-lg bg-sky-500 py-3 font-mono text-xs font-bold text-ink-950 shadow-sm hover:bg-sky-400 cursor-pointer"
                    >
                      <CreditCard className="h-4 w-4" />
                      <span>Pay Card</span>
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCompletePosCheckout("Charge to Account")}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-400 py-2.5 font-mono text-xs font-bold text-ink-950 shadow-sm hover:bg-amber-300 cursor-pointer"
                  >
                    <Users className="h-4 w-4" />
                    <span>Charge to Player / Member Account</span>
                  </button>
                </div>
              </div>
            </div>

            {/* POS Daily Register & Receipt History Table */}
            <Panel
              title="Daily Register Sales Summary & Receipt History"
              meta={`${filteredPosTransactions.length} completed receipt(s)`}
            >
              {filteredPosTransactions.length === 0 ? (
                <EmptyState
                  title="No Kiosk POS receipts recorded yet"
                  hint="Completed Cash, Card, and Account Charge transactions appear here with printable receipts."
                />
              ) : (
                <div className="w-full max-w-full overflow-x-auto">
                  <Table>
                    <thead>
                      <tr>
                        <Th>Receipt #</Th>
                        <Th>Date &amp; Time</Th>
                        <Th>Customer</Th>
                        <Th>Items Purchased</Th>
                        <Th>Payment Method</Th>
                        <Th>Total</Th>
                        <Th className="text-right">Receipt</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredPosTransactions.map((tx) => (
                        <tr key={tx.id} className="border-t border-ink-800/70">
                          <Td>
                            <span className="font-mono text-xs font-bold text-amber-300">
                              {tx.receiptNumber}
                            </span>
                          </Td>
                          <Td>
                            <span className="font-mono text-xs text-ink-200">
                              {tx.date} · {tx.time}
                            </span>
                          </Td>
                          <Td>
                            <div className="font-medium text-ink-100">{tx.customerName}</div>
                            <div className="font-mono text-[10px] text-ink-400">
                              {tx.customerType} · {tx.branch}
                            </div>
                          </Td>
                          <Td>
                            <div className="text-xs text-ink-200">
                              {(tx.items || []).map((i) => `${i.quantity}x ${i.name}`).join(", ")}
                            </div>
                          </Td>
                          <Td>
                            <Chip
                              tone={
                                tx.paymentMethod === "Cash"
                                  ? "ok"
                                  : tx.paymentMethod === "Card"
                                    ? "info"
                                    : "warn"
                              }
                            >
                              {tx.paymentMethod}
                            </Chip>
                          </Td>
                          <Td>
                            <span className="font-mono text-xs font-bold text-emerald-400">
                              {money(tx.total)}
                            </span>
                          </Td>
                          <Td className="text-right">
                            <button
                              type="button"
                              onClick={() => setPosReceiptModalTx(tx)}
                              className="inline-flex items-center gap-1 rounded bg-ink-850 px-2.5 py-1 font-mono text-[10px] text-ink-200 ring-1 ring-ink-700 hover:bg-ink-800"
                            >
                              <Printer className="h-3 w-3 text-court-400" />
                              <span>View Receipt</span>
                            </button>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              )}
            </Panel>
          </div>
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

      {/* =================================================================== */}
      {/* MODAL 2: ENROLL GYM / S&C MEMBER                                    */}
      {/* =================================================================== */}
      <Modal
        open={gymModalOpen}
        title="Enroll Gym & Strength Member"
        meta="Supports both Academy Players and External Gym Members"
        onClose={() => setGymModalOpen(false)}
      >
        <div className="p-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Member Type">
              <Select
                value={gymForm.memberType}
                onChange={(v) =>
                  setGymForm({ ...gymForm, memberType: v as GymMember["memberType"] })
                }
                options={[
                  { label: "Academy Player", value: "Academy Player" },
                  { label: "External Gym Member", value: "External Member" },
                ]}
              />
            </Field>

            {gymForm.memberType === "Academy Player" ? (
              <Field label="Select Academy Player">
                <Select
                  value={gymForm.linkedPlayerId}
                  onChange={(pid) => {
                    const p = players.find((x) => x.id === pid);
                    setGymForm({
                      ...gymForm,
                      linkedPlayerId: pid,
                      memberName: p ? p.name : gymForm.memberName,
                      phone: p ? p.parentPhone || p.phone || "" : gymForm.phone,
                      branch: p?.branch || gymForm.branch,
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
            ) : (
              <Field label="Member Full Name">
                <Input
                  value={gymForm.memberName}
                  onChange={(v) => setGymForm({ ...gymForm, memberName: v })}
                  placeholder="Enter full name"
                />
              </Field>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Phone">
              <Input
                value={gymForm.phone}
                onChange={(v) => setGymForm({ ...gymForm, phone: v })}
                placeholder="+961 70 000 000"
              />
            </Field>
            <Field label="Branch">
              <Select
                value={gymForm.branch}
                onChange={(v) => setGymForm({ ...gymForm, branch: v })}
                options={
                  branches.length > 0
                    ? branches.map((b) => ({ label: b.name, value: b.name }))
                    : [{ label: "Main Branch", value: "Main Branch" }]
                }
              />
            </Field>
            <Field label="S&C / Gym Package">
              <Select
                value={gymForm.packageType}
                onChange={(v) => {
                  const pkg = v as GymMember["packageType"];
                  const fee =
                    pkg === "Monthly Unlimited"
                      ? "75"
                      : pkg === "10-Session S&C Pack"
                        ? "90"
                        : pkg === "Athlete Pro S&C"
                          ? "65"
                          : "12";
                  const sess =
                    pkg === "Monthly Unlimited"
                      ? "999"
                      : pkg === "10-Session S&C Pack"
                        ? "10"
                        : pkg === "Athlete Pro S&C"
                          ? "12"
                          : "1";
                  setGymForm({
                    ...gymForm,
                    packageType: pkg,
                    monthlyFee: fee,
                    totalSessionsIncluded: sess,
                  });
                }}
                options={[
                  { label: "Athlete Pro S&C (12 Sessions)", value: "Athlete Pro S&C" },
                  { label: "10-Session S&C Pack", value: "10-Session S&C Pack" },
                  { label: "Monthly Unlimited Gym", value: "Monthly Unlimited" },
                  { label: "Walk-In Day Pass", value: "Walk-In Day Pass" },
                ]}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Package Fee ($)">
              <Input
                type="number"
                value={gymForm.monthlyFee}
                onChange={(v) => setGymForm({ ...gymForm, monthlyFee: v })}
              />
            </Field>
            <Field label="Start Date">
              <Input
                type="date"
                value={gymForm.startDate}
                onChange={(v) => setGymForm({ ...gymForm, startDate: v })}
              />
            </Field>
            <Field label="Expiry Date">
              <Input
                type="date"
                value={gymForm.expiryDate}
                onChange={(v) => setGymForm({ ...gymForm, expiryDate: v })}
              />
            </Field>
          </div>

          <Field label="Payment Method">
            <Select
              value={gymForm.paymentMethod}
              onChange={(v) =>
                setGymForm({
                  ...gymForm,
                  paymentMethod: v as typeof gymForm.paymentMethod,
                })
              }
              options={[
                { label: "Cash (Post to Ledger)", value: "Cash" },
                { label: "Card (Post to Ledger)", value: "Card" },
                { label: "Charge to Player Account", value: "Charge to Player Account" },
              ]}
            />
          </Field>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setGymModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreateGymMember()}>Enroll Member</Button>
          </div>
        </div>
      </Modal>

      {/* =================================================================== */}
      {/* MODAL 3: GYM WORKOUT & STRENGTH LOG DRAWER                          */}
      {/* =================================================================== */}
      <Modal
        open={Boolean(workoutModalMember)}
        title={
          workoutModalMember
            ? `Strength & Conditioning Logs · ${workoutModalMember.memberName}`
            : "Workout Logs"
        }
        meta="Track exercises, sets/reps/load, RPE, and Personal Records (1RM)"
        onClose={() => setWorkoutModalMember(null)}
      >
        {workoutModalMember && (
          <div className="p-4 space-y-4">
            <div className="rounded-lg border border-ink-800 bg-ink-950/70 p-3 space-y-3">
              <div className="font-mono text-xs font-semibold text-sky-300">
                + Log New Strength / Conditioning Session
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Date">
                  <Input
                    type="date"
                    value={workoutForm.date}
                    onChange={(v) => setWorkoutForm({ ...workoutForm, date: v })}
                  />
                </Field>
                <Field label="Focus Area">
                  <Select
                    value={workoutForm.focusArea}
                    onChange={(v) =>
                      setWorkoutForm({
                        ...workoutForm,
                        focusArea: v as GymWorkoutLog["focusArea"],
                      })
                    }
                    options={[
                      { label: "Lower Body Power", value: "Lower Body Power" },
                      { label: "Upper Body Strength", value: "Upper Body Strength" },
                      { label: "Plyometrics & Speed", value: "Plyometrics & Speed" },
                      { label: "Core & Mobility", value: "Core & Mobility" },
                      {
                        label: "Energy System Conditioning",
                        value: "Energy System Conditioning",
                      },
                    ]}
                  />
                </Field>
                <Field label="Session RPE (1-10)">
                  <Input
                    type="number"
                    value={workoutForm.rpe}
                    onChange={(v) => setWorkoutForm({ ...workoutForm, rpe: v })}
                  />
                </Field>
              </div>
              <Field label="Exercises Performed">
                <Input
                  value={workoutForm.exercisesSummary}
                  onChange={(v) => setWorkoutForm({ ...workoutForm, exercisesSummary: v })}
                  placeholder="e.g. Back Squat, Nordic Hamstring Curl, Depth Jumps"
                />
              </Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Sets × Reps @ Load (kg)">
                  <Input
                    value={workoutForm.setsRepsLoad}
                    onChange={(v) => setWorkoutForm({ ...workoutForm, setsRepsLoad: v })}
                    placeholder="e.g. 4x6 @ 100kg · 3x8 BW"
                  />
                </Field>
                <Field label="Personal Record (PR) Achieved (Optional)">
                  <Input
                    value={workoutForm.personalRecord}
                    onChange={(v) => setWorkoutForm({ ...workoutForm, personalRecord: v })}
                    placeholder="e.g. Trap Bar Deadlift 125kg PR"
                  />
                </Field>
              </div>
              <div className="flex justify-end">
                <Button onClick={() => void handleAddWorkoutLog()}>Save Workout Log</Button>
              </div>
            </div>

            <div className="space-y-2 max-h-[280px] overflow-y-auto">
              {(workoutModalMember.workoutLogs || []).length === 0 ? (
                <div className="text-center py-6 font-mono text-xs text-ink-400">
                  No workout logs recorded for {workoutModalMember.memberName} yet.
                </div>
              ) : (
                (workoutModalMember.workoutLogs || []).map((log) => (
                  <div
                    key={log.id}
                    className="rounded-lg border border-ink-800 bg-ink-900 p-3 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold text-sky-300">
                        {log.date} · {log.focusArea}
                      </span>
                      <span className="font-mono text-[10px] text-ink-300">
                        RPE {log.rpe}/10 · {log.coachName}
                      </span>
                    </div>
                    <div className="text-xs font-medium text-ink-100">{log.exercisesSummary}</div>
                    <div className="font-mono text-[11px] text-ink-300">{log.setsRepsLoad}</div>
                    {log.personalRecord && (
                      <div className="inline-block rounded bg-amber-400/20 px-2 py-0.5 font-mono text-[10px] font-bold text-amber-300">
                        ★ PR: {log.personalRecord}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* =================================================================== */}
      {/* MODAL 4: PHYSIOTHERAPY INJURY ASSESSMENT INTAKE                     */}
      {/* =================================================================== */}
      <Modal
        open={physioIntakeOpen}
        title="New Physiotherapy & Injury Assessment Intake"
        meta="Automatically syncs clearance status (Fit, Limited, Injured) with the Academy Player Roster"
        onClose={() => setPhysioIntakeOpen(false)}
      >
        <div className="p-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Patient Type">
              <Select
                value={physioForm.patientType}
                onChange={(v) =>
                  setPhysioForm({
                    ...physioForm,
                    patientType: v as PhysioRecord["patientType"],
                  })
                }
                options={[
                  { label: "Academy Player", value: "Academy Player" },
                  { label: "External Patient", value: "External Patient" },
                ]}
              />
            </Field>

            {physioForm.patientType === "Academy Player" ? (
              <Field label="Select Academy Player">
                <Select
                  value={physioForm.linkedPlayerId}
                  onChange={(pid) => {
                    const p = players.find((x) => x.id === pid);
                    setPhysioForm({
                      ...physioForm,
                      linkedPlayerId: pid,
                      patientName: p ? p.name : physioForm.patientName,
                      team: p?.teams?.[0] || "",
                      phone: p ? p.parentPhone || p.phone || "" : physioForm.phone,
                      branch: p?.branch || physioForm.branch,
                    });
                  }}
                  options={[
                    { label: "— Choose Academy Player —", value: "" },
                    ...players.map((p) => ({
                      label: `${p.name} (${p.category} · ${(p.teams || []).join(", ") || "No team"})`,
                      value: p.id,
                    })),
                  ]}
                />
              </Field>
            ) : (
              <Field label="Patient Full Name">
                <Input
                  value={physioForm.patientName}
                  onChange={(v) => setPhysioForm({ ...physioForm, patientName: v })}
                  placeholder="Enter patient name"
                />
              </Field>
            )}

            <Field label="Facility Branch">
              <Select
                value={physioForm.branch}
                onChange={(v) => setPhysioForm({ ...physioForm, branch: v })}
                options={
                  branches.length > 0
                    ? branches.map((b) => ({ label: b.name, value: b.name }))
                    : [{ label: "Main Branch", value: "Main Branch" }]
                }
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Injury Location / Body Area">
              <Select
                value={physioForm.injuryArea}
                onChange={(v) =>
                  setPhysioForm({
                    ...physioForm,
                    injuryArea: v as PhysioRecord["injuryArea"],
                  })
                }
                options={[
                  { label: "Ankle / Foot", value: "Ankle / Foot" },
                  { label: "Knee / ACL / Meniscus", value: "Knee / ACL / Meniscus" },
                  { label: "Hamstring / Groin", value: "Hamstring / Groin" },
                  { label: "Shoulder / Rotator Cuff", value: "Shoulder / Rotator Cuff" },
                  { label: "Lumbar / Lower Back", value: "Lumbar / Lower Back" },
                  { label: "Wrist / Hand", value: "Wrist / Hand" },
                  { label: "Concussion / General", value: "Concussion / General" },
                ]}
              />
            </Field>
            <Field label="Severity">
              <Select
                value={physioForm.severity}
                onChange={(v) =>
                  setPhysioForm({ ...physioForm, severity: v as PhysioRecord["severity"] })
                }
                options={[
                  { label: "Mild (Grade 1)", value: "Mild (Grade 1)" },
                  { label: "Moderate (Grade 2)", value: "Moderate (Grade 2)" },
                  { label: "Severe (Grade 3)", value: "Severe (Grade 3)" },
                ]}
              />
            </Field>
            <Field label="Synced Academy Clearance Status">
              <Select
                value={physioForm.medicalStatus}
                onChange={(v) =>
                  setPhysioForm({
                    ...physioForm,
                    medicalStatus: v as PlayerMedicalClearanceStatus,
                  })
                }
                options={[
                  { label: "Limited / Modified Training", value: "Limited" },
                  { label: "Injured / Out", value: "Injured" },
                  { label: "Fit (Cleared)", value: "Fit" },
                ]}
              />
            </Field>
          </div>

          <Field label="Clinical Diagnosis & Assessment">
            <Input
              value={physioForm.diagnosis}
              onChange={(v) => setPhysioForm({ ...physioForm, diagnosis: v })}
              placeholder="e.g. Grade 1 Lateral Ankle Sprain (ATFL)"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Return-to-Play (RTP) Stage (1-5)">
              <Select
                value={String(physioForm.rtpStage)}
                onChange={(v) =>
                  setPhysioForm({
                    ...physioForm,
                    rtpStage: Number(v) as 1 | 2 | 3 | 4 | 5,
                  })
                }
                options={RTP_STAGES.map((s) => ({
                  label: s.title,
                  value: String(s.stage),
                }))}
              />
            </Field>
            <Field label="Estimated Return Date">
              <Input
                type="date"
                value={physioForm.estimatedReturnDate}
                onChange={(v) => setPhysioForm({ ...physioForm, estimatedReturnDate: v })}
              />
            </Field>
            <Field label="Lead Physiotherapist">
              <Input
                value={physioForm.therapistName}
                onChange={(v) => setPhysioForm({ ...physioForm, therapistName: v })}
              />
            </Field>
          </div>

          <Field label="Training Restrictions & Coaching Notes">
            <Textarea
              rows={2}
              value={physioForm.restrictions}
              onChange={(v) => setPhysioForm({ ...physioForm, restrictions: v })}
              placeholder="Specify load limits, non-contact rules, or taping requirements for coaches..."
            />
          </Field>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setPhysioIntakeOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreatePhysioIntake()}>
              Save Intake &amp; Sync Academy Status
            </Button>
          </div>
        </div>
      </Modal>

      {/* =================================================================== */}
      {/* MODAL 5: PHYSIO TREATMENT SESSIONS & THERAPIST SOAP NOTES           */}
      {/* =================================================================== */}
      <Modal
        open={Boolean(activePhysioRecord)}
        title={
          activePhysioRecord
            ? `Clinical Treatment & SOAP Notes · ${activePhysioRecord.patientName}`
            : "Treatment Sessions"
        }
        meta="Schedule or log physiotherapy treatment sessions and pain progression"
        onClose={() => setActivePhysioRecord(null)}
      >
        {activePhysioRecord && (
          <div className="p-4 space-y-4">
            <div className="rounded-lg border border-ink-800 bg-ink-950/70 p-3 space-y-3">
              <div className="font-mono text-xs font-semibold text-rose-300">
                + Record Treatment Session &amp; Therapist SOAP Note
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Date">
                  <Input
                    type="date"
                    value={treatmentForm.date}
                    onChange={(v) => setTreatmentForm({ ...treatmentForm, date: v })}
                  />
                </Field>
                <Field label="Modality">
                  <Select
                    value={treatmentForm.modality}
                    onChange={(v) =>
                      setTreatmentForm({
                        ...treatmentForm,
                        modality: v as PhysioTreatmentSession["modality"],
                      })
                    }
                    options={[
                      {
                        label: "Manual Therapy & Mobilization",
                        value: "Manual Therapy & Mobilization",
                      },
                      {
                        label: "Dry Needling / Electrotherapy",
                        value: "Dry Needling / Electrotherapy",
                      },
                      { label: "Cryotherapy & Compression", value: "Cryotherapy & Compression" },
                      { label: "Rehab Gym Load Protocol", value: "Rehab Gym Load Protocol" },
                      {
                        label: "Return-to-Play Biomechanical Test",
                        value: "Return-to-Play Biomechanical Test",
                      },
                    ]}
                  />
                </Field>
                <Field label="Pain Score (0-10)">
                  <Input
                    type="number"
                    value={treatmentForm.painScore}
                    onChange={(v) => setTreatmentForm({ ...treatmentForm, painScore: v })}
                  />
                </Field>
              </div>

              <Field label="Therapist Clinical / SOAP Notes">
                <Textarea
                  rows={2}
                  value={treatmentForm.soapNotes}
                  onChange={(v) => setTreatmentForm({ ...treatmentForm, soapNotes: v })}
                  placeholder="Subjective, Objective, Assessment & Plan notes..."
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Session Fee ($)">
                  <Input
                    type="number"
                    value={treatmentForm.fee}
                    onChange={(v) => setTreatmentForm({ ...treatmentForm, fee: v })}
                  />
                </Field>
                <Field label="Billing / Coverage">
                  <Select
                    value={treatmentForm.paymentStatus}
                    onChange={(v) =>
                      setTreatmentForm({
                        ...treatmentForm,
                        paymentStatus: v as PhysioTreatmentSession["paymentStatus"],
                      })
                    }
                    options={[
                      { label: "Academy Covered (Included)", value: "Academy Covered" },
                      { label: "Paid (Post to Ledger)", value: "Paid" },
                      { label: "Charge to Player Account", value: "Charged to Account" },
                    ]}
                  />
                </Field>
              </div>

              <div className="flex justify-end">
                <Button onClick={() => void handleAddTreatmentSession()}>
                  Save Treatment Session
                </Button>
              </div>
            </div>

            <div className="space-y-2 max-h-[260px] overflow-y-auto">
              {(activePhysioRecord.treatmentSessions || []).length === 0 ? (
                <div className="py-6 text-center font-mono text-xs text-ink-400">
                  No treatment sessions logged yet.
                </div>
              ) : (
                (activePhysioRecord.treatmentSessions || []).map((s) => (
                  <div
                    key={s.id}
                    className="rounded-lg border border-ink-800 bg-ink-900 p-3 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-bold text-rose-300">
                        {s.date} · {s.modality}
                      </span>
                      <span className="font-mono text-[10px] text-ink-300">
                        Pain: {s.painScore}/10 · {s.paymentStatus}
                      </span>
                    </div>
                    <div className="text-xs text-ink-200">{s.soapNotes}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* =================================================================== */}
      {/* MODAL 6: ADD POS CATALOG PRODUCT                                    */}
      {/* =================================================================== */}
      <Modal
        open={posCatalogModalOpen}
        title="Add Kiosk POS Product"
        meta="Add drinks, snacks, walk-in passes, or recovery items to the Vescio Nexus Kiosk POS grid"
        onClose={() => setPosCatalogModalOpen(false)}
      >
        <div className="p-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Product Name">
              <Input
                value={newCatalogItem.name}
                onChange={(v) => setNewCatalogItem({ ...newCatalogItem, name: v })}
                placeholder="e.g. Electrolyte Recovery Drink (500ml)"
              />
            </Field>
            <Field label="Branch Scope">
              <Select
                value={newCatalogItem.branch}
                onChange={(v) => setNewCatalogItem({ ...newCatalogItem, branch: v })}
                options={[
                  { label: "All Branches (Shared)", value: "All" },
                  ...branches.map((b) => ({ label: b.name, value: b.name })),
                ]}
              />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Category">
              <Select
                value={newCatalogItem.category}
                onChange={(v) =>
                  setNewCatalogItem({ ...newCatalogItem, category: v as PosItemCategory })
                }
                options={[
                  { label: "Hydration & Drinks", value: "Hydration & Drinks" },
                  { label: "Snacks & Nutrition", value: "Snacks & Nutrition" },
                  { label: "Uniforms & Merch", value: "Uniforms & Merch" },
                  { label: "Court Walk-In & Passes", value: "Court Walk-In & Passes" },
                  { label: "Recovery & Tape", value: "Recovery & Tape" },
                ]}
              />
            </Field>
            <Field label="Unit Price ($)">
              <Input
                type="number"
                value={newCatalogItem.price}
                onChange={(v) => setNewCatalogItem({ ...newCatalogItem, price: v })}
              />
            </Field>
            <Field label="Initial Stock">
              <Input
                type="number"
                value={newCatalogItem.stock}
                onChange={(v) => setNewCatalogItem({ ...newCatalogItem, stock: v })}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPosCatalogModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleAddPosCatalogItem()}>Save POS Product</Button>
          </div>
        </div>
      </Modal>

      {/* =================================================================== */}
      {/* MODAL 7: POS RECEIPT VIEWER                                         */}
      {/* =================================================================== */}
      <Modal
        open={Boolean(posReceiptModalTx)}
        title={
          posReceiptModalTx ? `POS Receipt · ${posReceiptModalTx.receiptNumber}` : "POS Receipt"
        }
        meta="Official Vescio Nexus Kiosk Point-of-Sale Transaction Receipt"
        onClose={() => setPosReceiptModalTx(null)}
      >
        {posReceiptModalTx && (
          <div className="p-4 space-y-4 font-mono text-xs">
            <div className="rounded-lg border border-ink-800 bg-ink-950 p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-ink-800 pb-2">
                <div>
                  <div className="font-bold text-ink-100">
                    {db.academy?.name || "Vescio Vector"} · Vescio Nexus Kiosk POS
                  </div>
                  <div className="text-[10px] text-ink-400">
                    Branch: {posReceiptModalTx.branch} · Cashier: {posReceiptModalTx.cashierName}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-amber-300">{posReceiptModalTx.receiptNumber}</div>
                  <div className="text-[10px] text-ink-400">
                    {posReceiptModalTx.date} {posReceiptModalTx.time}
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-ink-300">
                Customer:{" "}
                <span className="text-ink-100 font-semibold">{posReceiptModalTx.customerName}</span>{" "}
                ({posReceiptModalTx.customerType}) · Payment:{" "}
                <span className="text-emerald-400 font-semibold">
                  {posReceiptModalTx.paymentMethod}
                </span>
              </div>

              <div className="space-y-1 border-t border-b border-ink-800 py-2">
                {posReceiptModalTx.items.map((item) => (
                  <div key={item.itemId} className="flex justify-between">
                    <span>
                      {item.quantity}x {item.name}
                    </span>
                    <span>{money(item.subtotal)}</span>
                  </div>
                ))}
              </div>

              <div className="space-y-1">
                <div className="flex justify-between text-ink-400">
                  <span>Subtotal</span>
                  <span>{money(posReceiptModalTx.subtotal)}</span>
                </div>
                {posReceiptModalTx.discount > 0 && (
                  <div className="flex justify-between text-amber-400">
                    <span>Discount</span>
                    <span>-{money(posReceiptModalTx.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold text-emerald-400 pt-1">
                  <span>Total</span>
                  <span>{money(posReceiptModalTx.total)}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button onClick={() => setPosReceiptModalTx(null)}>Done</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

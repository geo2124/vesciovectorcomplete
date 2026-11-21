import React, { useState, useMemo, useEffect } from "react";
import {
  useDB,
  DEFAULT_GYM_PACKAGES,
  MAX_BRANCH_LOG_ENTRIES,
  atomicGymCheckInTransaction,
  type GymMember,
  type GymWorkoutLog,
  type GymProgressMetricEntry,
  type GymCheckInEntry,
  type GymPackageConfig,
  type GymPackageCategory,
  type GymCoachProfile,
  type GymScheduleSlot,
  type GymScheduleSlotType,
  type BranchOffDay,
  type LedgerEntry,
} from "@/lib/data-store";
import { useAuth } from "@/lib/auth";
import {
  Button as Btn,
  Chip,
  Field,
  Input,
  Select,
  Modal,
  money as kitMoney,
} from "@/components/kit";
import {
  Dumbbell,
  Users,
  UserCheck,
  Package,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Search,
  Plus,
  Edit2,
  Trash2,
  Activity,
  TrendingUp,
  ChevronLeft,
  ChevronRight,
  CalendarOff,
} from "lucide-react";
import { toast } from "sonner";

const Card: React.FC<{ className?: string; children: React.ReactNode }> = ({
  className = "",
  children,
}) => (
  <div className={`rounded-xl border border-ink-800 bg-ink-900/90 ${className}`}>{children}</div>
);

const Badge: React.FC<{
  tone?: "amber" | "green" | "red" | "blue" | "gray";
  children: React.ReactNode;
}> = ({ tone = "gray", children }) => {
  const toneMap: Record<
    string,
    "neutral" | "accent" | "court" | "info" | "good" | "ok" | "warn" | "bad" | "danger"
  > = {
    amber: "warn",
    green: "ok",
    red: "danger",
    blue: "info",
    gray: "neutral",
  };
  return <Chip tone={toneMap[tone] || "neutral"}>{children}</Chip>;
};

const money = (_db: unknown, amount: number) => kitMoney(amount);

export interface NexusGymModuleProps {
  selectedBranch: string;
  onSelectBranch: (branch: string) => void;
  externalEnrollOpen?: boolean;
  onExternalEnrollHandled?: () => void;
}

type GymSubTab = "schedule_checkin" | "clients" | "coaches" | "packages" | "tracking_followup";

export const NexusGymModule: React.FC<NexusGymModuleProps> = ({
  selectedBranch,
  onSelectBranch,
  externalEnrollOpen,
  onExternalEnrollHandled,
}) => {
  const { db, tenantId, setEntity, deleteEntity, runBranchArrayTransaction } = useDB();
  const { role } = useAuth();
  const isSuperAdmin = role === "Super Admin";

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [activeSubTab, setActiveSubTab] = useState<GymSubTab>("schedule_checkin");

  // Active branch resolution
  const activeBranchName = useMemo(() => {
    if (selectedBranch !== "All") return selectedBranch;
    return db.branches[0]?.name || "Main Branch";
  }, [selectedBranch, db.branches]);

  const activeBranchObj = useMemo(() => {
    return db.branches.find((b) => b.name === activeBranchName) || db.branches[0];
  }, [db.branches, activeBranchName]);

  // Aggregate or branch-scoped Packages
  const branchPackages = useMemo<GymPackageConfig[]>(() => {
    if (activeBranchObj?.gymPackages && activeBranchObj.gymPackages.length > 0) {
      return activeBranchObj.gymPackages;
    }
    return DEFAULT_GYM_PACKAGES.map((pkg) => ({
      ...pkg,
      branch: activeBranchName,
    }));
  }, [activeBranchObj, activeBranchName]);

  // Aggregate or branch-scoped Gym Coaches
  const allGymCoaches = useMemo<GymCoachProfile[]>(() => {
    const list: GymCoachProfile[] = [];
    const seen = new Set<string>();
    for (const b of db.branches) {
      for (const c of b.gymCoaches || []) {
        if (!seen.has(c.id)) {
          seen.add(c.id);
          list.push(c);
        }
      }
    }
    return list;
  }, [db.branches]);

  const filteredGymCoaches = useMemo(() => {
    if (selectedBranch === "All") return allGymCoaches;
    return allGymCoaches.filter(
      (c) => c.branch === selectedBranch || c.branchAccess === "All Branches",
    );
  }, [allGymCoaches, selectedBranch]);

  // Aggregate or branch-scoped Gym Schedule Bookings
  const allGymBookings = useMemo<GymScheduleSlot[]>(() => {
    const list: GymScheduleSlot[] = [];
    const seen = new Set<string>();
    for (const b of db.branches) {
      for (const slot of b.gymBookings || []) {
        if (!seen.has(slot.id)) {
          seen.add(slot.id);
          list.push(slot);
        }
      }
    }
    return list.sort((a, b) =>
      `${a.date}_${a.startTime}`.localeCompare(`${b.date}_${b.startTime}`),
    );
  }, [db.branches]);

  const filteredGymMembers = useMemo(() => {
    const all = db.gymMembers || [];
    if (selectedBranch === "All") return all;
    return all.filter((m) => m.branch === selectedBranch || m.branchAccess === "All Branches");
  }, [db.gymMembers, selectedBranch]);

  // Shared Off Days for the active branch (synced with Court Reservations)
  const branchOffDays = useMemo<BranchOffDay[]>(() => {
    return (activeBranchObj?.offDays || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  }, [activeBranchObj]);

  // Schedule Date & Past-Date Toggle
  const [scheduleDate, setScheduleDate] = useState<string>(todayStr);
  const [allowPastDates, setAllowPastDates] = useState<boolean>(false);
  const [scheduleTypeFilter, setScheduleTypeFilter] = useState<string>("All");

  const activeDateOffDay = useMemo(() => {
    return branchOffDays.find((od) => od.date === scheduleDate);
  }, [branchOffDays, scheduleDate]);

  // Helper to calculate days until expiry
  const getDaysUntilExpiry = (expiryDate?: string): number => {
    if (!expiryDate) return 999;
    const now = new Date(todayStr + "T00:00:00").getTime();
    const exp = new Date(expiryDate + "T00:00:00").getTime();
    return Math.ceil((exp - now) / 86400000);
  };

  // Helper to calculate attendance frequency (check-ins in last 30 days & weekly avg)
  const getMemberAttendanceStats = (member: GymMember) => {
    const history = member.checkInHistory || [];
    const cutoff30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    const cutoff7 = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const last30Count = history.filter((h) => h.date >= cutoff30).length;
    const last7Count = history.filter((h) => h.date >= cutoff7).length;
    const weeklyAvg = Number((last30Count / 4.3).toFixed(1));
    return { last30Count, last7Count, weeklyAvg };
  };

  // Expiring / Low-Session Follow-Up items
  const followUpMembers = useMemo(() => {
    return filteredGymMembers.filter((m) => {
      const daysLeft = getDaysUntilExpiry(m.expiryDate);
      const lowSessions = m.sessionsRemaining !== undefined && m.sessionsRemaining <= 2;
      const expiringSoon = daysLeft <= 7;
      const isExpired = m.status === "Expired" || daysLeft < 0;
      const hasBalance = (m.balance || 0) > 0;
      return lowSessions || expiringSoon || isExpired || hasBalance;
    });
  }, [filteredGymMembers, todayStr]);

  // Also coaches whose Coach-as-Client session pool is running low (<= 2 sessions)
  const followUpCoaches = useMemo(() => {
    return filteredGymCoaches.filter((c) => {
      if (!c.isClientEnabled) return false;
      const daysLeft = getDaysUntilExpiry(c.packageExpiryDate);
      return c.sessionsRemaining <= 2 || daysLeft <= 7;
    });
  }, [filteredGymCoaches, todayStr]);

  // ---------------------------------------------------------------------------
  // 1. FAST FRONT-DESK CHECK-IN SYSTEM STATE
  // ---------------------------------------------------------------------------
  const [checkInMode, setCheckInMode] = useState<"client" | "coach_as_client">("client");
  const [checkInSearch, setCheckInSearch] = useState("");
  const [selectedCheckInMemberId, setSelectedCheckInMemberId] = useState<string>("");
  const [selectedCheckInCoachId, setSelectedCheckInCoachId] = useState<string>("");
  const [privateClientNameForCoach, setPrivateClientNameForCoach] = useState<string>("");
  const [selectedCheckInSlotId, setSelectedCheckInSlotId] = useState<string>("");
  const [checkInNote, setCheckInNote] = useState<string>("");

  const matchingCheckInMembers = useMemo(() => {
    const q = checkInSearch.trim().toLowerCase();
    return filteredGymMembers.filter((m) => {
      if (!q) return true;
      return (
        m.memberName.toLowerCase().includes(q) ||
        (m.phone || "").toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        (m.packageName || "").toLowerCase().includes(q)
      );
    });
  }, [filteredGymMembers, checkInSearch]);

  const matchingCheckInCoaches = useMemo(() => {
    const q = checkInSearch.trim().toLowerCase();
    return filteredGymCoaches
      .filter((c) => c.isClientEnabled)
      .filter((c) => {
        if (!q) return true;
        return (
          c.name.toLowerCase().includes(q) ||
          (c.phone || "").toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q)
        );
      });
  }, [filteredGymCoaches, checkInSearch]);

  const activeCheckInMember = useMemo(
    () =>
      filteredGymMembers.find((m) => m.id === selectedCheckInMemberId) ||
      matchingCheckInMembers[0] ||
      null,
    [filteredGymMembers, selectedCheckInMemberId, matchingCheckInMembers],
  );

  const activeCheckInCoach = useMemo(
    () =>
      filteredGymCoaches.find((c) => c.id === selectedCheckInCoachId) ||
      matchingCheckInCoaches[0] ||
      null,
    [filteredGymCoaches, selectedCheckInCoachId, matchingCheckInCoaches],
  );

  // Slots for the selected scheduleDate & branch
  const slotsForScheduleDate = useMemo(() => {
    return allGymBookings.filter((s) => {
      const branchOk = selectedBranch === "All" || s.branch === selectedBranch;
      const dateOk = s.date === scheduleDate;
      const typeOk = scheduleTypeFilter === "All" || s.slotType === scheduleTypeFilter;
      return branchOk && dateOk && typeOk;
    });
  }, [allGymBookings, selectedBranch, scheduleDate, scheduleTypeFilter]);

  // Execute Front-Desk Check-In (Client OR Coach-as-Client) via atomic Firestore transaction
  const handleExecuteFrontDeskCheckIn = async () => {
    if (activeDateOffDay) {
      toast.error(
        `Facility is closed on ${scheduleDate} (${activeDateOffDay.reason}). Cannot check in on an Off Day.`,
      );
      return;
    }

    const nowTime = new Date().toTimeString().slice(0, 5);
    const linkedSlot = allGymBookings.find((s) => s.id === selectedCheckInSlotId);

    if (checkInMode === "client") {
      const member = activeCheckInMember;
      if (!member) {
        toast.error("Select a client to check in.");
        return;
      }

      // Validate branch access rule
      if (
        member.branchAccess === "Single Branch" &&
        selectedBranch !== "All" &&
        member.branch !== selectedBranch
      ) {
        toast.error(
          `${member.memberName}'s package (${member.packageName}) is valid for ${member.branch} only.`,
        );
        return;
      }

      // Validate expiry
      const daysLeft = getDaysUntilExpiry(member.expiryDate);
      if (member.status === "Expired" || daysLeft < 0) {
        toast.error(
          `${member.memberName}'s membership expired on ${member.expiryDate}. Please renew package before checking in.`,
        );
        return;
      }

      // Validate session pack balance
      if (member.sessionsRemaining !== undefined && member.sessionsRemaining <= 0) {
        toast.error(
          `${member.memberName} has 0 remaining sessions on ${member.packageName}. Please top up or renew.`,
        );
        return;
      }

      const nextSessions =
        member.sessionsRemaining !== undefined
          ? Math.max(0, member.sessionsRemaining - 1)
          : undefined;

      const checkInEntry: GymCheckInEntry = {
        id: `chk-${Date.now()}`,
        date: scheduleDate,
        time: nowTime,
        branch: activeBranchName,
        slotId: linkedSlot?.id,
        slotTitle: linkedSlot?.title,
        deductionType:
          member.sessionsRemaining !== undefined ? "Client Session Pack" : "Membership",
        coachId: linkedSlot?.coachId || member.assignedCoachId,
        coachName: linkedSlot?.coachName || member.assignedCoachName,
        sessionsRemainingAfter: nextSessions,
        note:
          checkInNote.trim() ||
          (linkedSlot
            ? `Checked in for ${linkedSlot.title} (${linkedSlot.startTime})`
            : nextSessions !== undefined
              ? `Session deducted (${nextSessions} left)`
              : "Gym floor check-in"),
      };

      const targetBranch =
        db.branches.find((b) => b.name === (linkedSlot?.branch || activeBranchName)) ||
        activeBranchObj;
      if (!targetBranch) {
        toast.error("Active branch not found.");
        return;
      }

      try {
        const result = await atomicGymCheckInTransaction({
          tenantId,
          branchId: targetBranch.id,
          fallbackBranch: targetBranch,
          mode: "client",
          client: member,
          ...(linkedSlot?.id ? { bookingId: linkedSlot.id } : {}),
          checkInEntry,
          checkInDate: scheduleDate,
          checkInTime: nowTime,
        });

        if (result.updatedMember) {
          await setEntity("gymMembers", result.updatedMember);
        }
        await setEntity("branches", result.updatedBranch);

        setCheckInNote("");
        toast.success(
          result.remainingSessions !== undefined
            ? `Checked in ${member.memberName} · 1 session deducted (${result.remainingSessions} remaining)`
            : `Checked in ${member.memberName} · Active Membership verified`,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to complete gym check-in.";
        toast.error(msg);
      }
    } else {
      // Coach-as-Client Check-In (Deducts from Coach's purchased session pool)
      const coach = activeCheckInCoach;
      if (!coach) {
        toast.error("Select an eligible Coach-as-Client to check in.");
        return;
      }
      if (!coach.isClientEnabled) {
        toast.error(`${coach.name} is not enabled for Coach-as-Client session pool.`);
        return;
      }
      if (coach.sessionsRemaining <= 0) {
        toast.error(
          `${coach.name} has 0 remaining sessions in their Coach-as-Client pool. Purchase a Coach Session Pack first.`,
        );
        return;
      }
      if (coach.packageExpiryDate && getDaysUntilExpiry(coach.packageExpiryDate) < 0) {
        toast.error(
          `${coach.name}'s Coach-as-Client package expired on ${coach.packageExpiryDate}.`,
        );
        return;
      }

      const clientTrainee =
        privateClientNameForCoach.trim() ||
        linkedSlot?.privateClientName ||
        linkedSlot?.clientName ||
        "Private Trainee";

      const nextCoachSessions = Math.max(0, coach.sessionsRemaining - 1);
      const checkInEntry: GymCheckInEntry = {
        id: `chk-coach-${Date.now()}`,
        date: scheduleDate,
        time: nowTime,
        branch: activeBranchName,
        slotId: linkedSlot?.id,
        slotTitle: linkedSlot?.title || `Private PT with ${clientTrainee}`,
        deductionType: "Coach Session Pool",
        coachId: coach.id,
        coachName: coach.name,
        privateClientName: clientTrainee,
        sessionsRemainingAfter: nextCoachSessions,
        note:
          checkInNote.trim() ||
          `Coach-as-Client Private PT (${clientTrainee}) · 1 session deducted from ${coach.name}'s pool (${nextCoachSessions} left)`,
      };

      const targetBranch = db.branches.find((b) => b.name === coach.branch) || activeBranchObj;
      if (!targetBranch) {
        toast.error("Branch record not found.");
        return;
      }

      const linkedMember = (db.gymMembers || []).find(
        (m) => m.linkedGymCoachId === coach.id || m.id === coach.linkedClientMemberId,
      );

      try {
        const result = await atomicGymCheckInTransaction({
          tenantId,
          branchId: targetBranch.id,
          fallbackBranch: {
            ...targetBranch,
            gymCoaches: targetBranch.gymCoaches?.length
              ? targetBranch.gymCoaches
              : allGymCoaches.filter((c) => c.branch === targetBranch.name),
          },
          mode: "coach_credit",
          client: linkedMember || null,
          coachId: coach.id,
          privateClientName: clientTrainee,
          ...(linkedSlot?.id ? { bookingId: linkedSlot.id } : {}),
          checkInEntry,
          checkInDate: scheduleDate,
          checkInTime: nowTime,
        });

        await setEntity("branches", result.updatedBranch);
        if (result.updatedMember) {
          await setEntity("gymMembers", result.updatedMember);
        }

        setPrivateClientNameForCoach("");
        setCheckInNote("");
        const remAfter = result.remainingSessions ?? nextCoachSessions;
        toast.success(
          `Coach-as-Client Check-In: Deducted 1 session from ${coach.name}'s pool for training ${clientTrainee} (${remAfter} remaining)`,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to complete coach check-in.";
        toast.error(msg);
      }
    }
  };

  // Helpers to persist branch-scoped entities into db.branches via atomic Firestore transactions
  const saveCoachToBranch = async (branchName: string, coach: GymCoachProfile) => {
    const targetBranch = db.branches.find((b) => b.name === branchName) || activeBranchObj;
    if (!targetBranch) return;
    const cappedCoach: GymCoachProfile = {
      ...coach,
      ...(Array.isArray(coach.checkInHistory)
        ? { checkInHistory: coach.checkInHistory.slice(0, MAX_BRANCH_LOG_ENTRIES) }
        : {}),
    };
    await runBranchArrayTransaction(
      targetBranch.id,
      (curr) => {
        const existing = curr.gymCoaches || [];
        const exists = existing.some((c) => c.id === cappedCoach.id);
        const nextCoaches = exists
          ? existing.map((c) => (c.id === cappedCoach.id ? cappedCoach : c))
          : [...existing, cappedCoach];
        return {
          ...curr,
          gymCoaches: nextCoaches,
        };
      },
      targetBranch,
    );
  };

  const deleteCoachFromBranch = async (branchName: string, coachId: string) => {
    const targetBranch = db.branches.find((b) => b.name === branchName) || activeBranchObj;
    if (!targetBranch) return;
    await runBranchArrayTransaction(
      targetBranch.id,
      (curr) => ({
        ...curr,
        gymCoaches: (curr.gymCoaches || []).filter((c) => c.id !== coachId),
      }),
      targetBranch,
    );
  };

  const updateBookingInBranch = async (branchName: string, slot: GymScheduleSlot) => {
    const targetBranch = db.branches.find((b) => b.name === branchName) || activeBranchObj;
    if (!targetBranch) return;
    await runBranchArrayTransaction(
      targetBranch.id,
      (curr) => {
        const existing = curr.gymBookings || [];
        const exists = existing.some((s) => s.id === slot.id);
        const nextBookings = exists
          ? existing.map((s) => (s.id === slot.id ? slot : s))
          : [...existing, slot];
        return {
          ...curr,
          gymBookings: nextBookings.slice(-MAX_BRANCH_LOG_ENTRIES),
        };
      },
      targetBranch,
    );
  };

  const deleteBookingFromBranch = async (branchName: string, slotId: string) => {
    const targetBranch = db.branches.find((b) => b.name === branchName) || activeBranchObj;
    if (!targetBranch) return;
    await runBranchArrayTransaction(
      targetBranch.id,
      (curr) => ({
        ...curr,
        gymBookings: (curr.gymBookings || []).filter((s) => s.id !== slotId),
      }),
      targetBranch,
    );
  };

  const savePackagesToBranch = async (nextPackages: GymPackageConfig[]) => {
    if (!activeBranchObj) return;
    await runBranchArrayTransaction(
      activeBranchObj.id,
      (curr) => ({
        ...curr,
        gymPackages: nextPackages,
      }),
      activeBranchObj,
    );
  };

  // ---------------------------------------------------------------------------
  // 2. CLIENT ENROLLMENT & PROFILE MODAL STATE
  // ---------------------------------------------------------------------------
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [clientSearch, setClientSearch] = useState("");
  const [clientStatusFilter, setClientStatusFilter] = useState<string>("All");
  const [clientForm, setClientForm] = useState<{
    memberName: string;
    memberType: "Academy Player" | "External Member" | "Coach-as-Client";
    linkedPlayerId: string;
    phone: string;
    email: string;
    emergencyContactName: string;
    emergencyContactPhone: string;
    emergencyContactRelation: string;
    fitnessGoals: string;
    medicalNotes: string;
    assignedCoachId: string;
    branch: string;
    packageId: string;
    startDate: string;
    paidNow: boolean;
    followUpNotes: string;
  }>({
    memberName: "",
    memberType: "External Member",
    linkedPlayerId: "",
    phone: "",
    email: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    emergencyContactRelation: "Parent / Spouse",
    fitnessGoals: "Strength & Hypertrophy, Athletic Conditioning",
    medicalNotes: "",
    assignedCoachId: "",
    branch: activeBranchName,
    packageId: DEFAULT_GYM_PACKAGES[0].id,
    startDate: todayStr,
    paidNow: true,
    followUpNotes: "",
  });

  // Trigger from external "+ Enroll Member" button on Nexus Overview hub card
  useEffect(() => {
    if (externalEnrollOpen) {
      openNewClientModal();
      onExternalEnrollHandled?.();
    }
  }, [externalEnrollOpen]);

  const openNewClientModal = () => {
    setEditingClientId(null);
    setClientForm({
      memberName: "",
      memberType: "External Member",
      linkedPlayerId: "",
      phone: "",
      email: "",
      emergencyContactName: "",
      emergencyContactPhone: "",
      emergencyContactRelation: "Parent / Spouse",
      fitnessGoals: "Strength & Conditioning, Mobility & Power",
      medicalNotes: "",
      assignedCoachId: filteredGymCoaches[0]?.id || "",
      branch: activeBranchName,
      packageId: branchPackages[0]?.id || DEFAULT_GYM_PACKAGES[0].id,
      startDate: todayStr,
      paidNow: true,
      followUpNotes: "",
    });
    setClientModalOpen(true);
  };

  const openEditClientModal = (member: GymMember) => {
    setEditingClientId(member.id);
    setClientForm({
      memberName: member.memberName,
      memberType: member.memberType,
      linkedPlayerId: member.linkedPlayerId || "",
      phone: member.phone,
      email: member.email || "",
      emergencyContactName: member.emergencyContactName || "",
      emergencyContactPhone: member.emergencyContactPhone || "",
      emergencyContactRelation: member.emergencyContactRelation || "Parent / Spouse",
      fitnessGoals: member.fitnessGoals || "",
      medicalNotes: member.medicalNotes || "",
      assignedCoachId: member.assignedCoachId || "",
      branch: member.branch,
      packageId: member.packageId || branchPackages[0]?.id || DEFAULT_GYM_PACKAGES[0].id,
      startDate: member.startDate,
      paidNow: member.balance === 0,
      followUpNotes: member.followUpNotes || "",
    });
    setClientModalOpen(true);
  };

  const handleSaveClient = async () => {
    if (!clientForm.memberName.trim()) {
      toast.error("Please enter the client's full name.");
      return;
    }

    const pkg =
      branchPackages.find((p) => p.id === clientForm.packageId) ||
      DEFAULT_GYM_PACKAGES.find((p) => p.id === clientForm.packageId) ||
      branchPackages[0];

    const startMs = new Date((clientForm.startDate || todayStr) + "T12:00:00").getTime();
    const expiryDate = new Date(startMs + (pkg?.durationDays || 30) * 86400000)
      .toISOString()
      .slice(0, 10);

    const assignedCoach = allGymCoaches.find((c) => c.id === clientForm.assignedCoachId);
    const existingMember = editingClientId
      ? (db.gymMembers || []).find((m) => m.id === editingClientId)
      : undefined;

    const fee = pkg ? pkg.price : 60;
    const isSessionBased = pkg?.billingModel === "Session-Based";

    const memberRecord: GymMember = {
      id: existingMember ? existingMember.id : `gym-mem-${Date.now()}`,
      memberName: clientForm.memberName.trim(),
      memberType: clientForm.memberType,
      linkedPlayerId: clientForm.linkedPlayerId || undefined,
      phone: clientForm.phone.trim() || "—",
      email: clientForm.email.trim() || undefined,
      emergencyContactName: clientForm.emergencyContactName.trim() || undefined,
      emergencyContactPhone: clientForm.emergencyContactPhone.trim() || undefined,
      emergencyContactRelation: clientForm.emergencyContactRelation.trim() || undefined,
      fitnessGoals: clientForm.fitnessGoals.trim() || undefined,
      medicalNotes: clientForm.medicalNotes.trim() || undefined,
      assignedCoachId: assignedCoach?.id,
      assignedCoachName: assignedCoach?.name,
      branch: clientForm.branch || activeBranchName,
      branchAccess: pkg?.branchAccess || "Single Branch",
      packageId: pkg?.id,
      packageName: pkg?.name || "Monthly Unlimited Gym",
      packageType: pkg?.name || "Monthly Unlimited",
      monthlyFee: fee,
      sessionsRemaining: existingMember
        ? existingMember.sessionsRemaining
        : isSessionBased
          ? pkg?.sessionsIncluded || 10
          : undefined,
      totalSessionsIncluded: isSessionBased ? pkg?.sessionsIncluded || 10 : undefined,
      startDate: clientForm.startDate || todayStr,
      expiryDate: existingMember ? existingMember.expiryDate : expiryDate,
      status: "Active",
      balance: clientForm.paidNow ? 0 : fee,
      totalCheckIns: existingMember?.totalCheckIns || 0,
      lastCheckInDate: existingMember?.lastCheckInDate,
      checkInHistory: existingMember?.checkInHistory || [],
      workoutLogs: existingMember?.workoutLogs || [],
      progressMetrics: existingMember?.progressMetrics || [],
      followUpStatus: existingMember?.followUpStatus || "None",
      followUpNotes: clientForm.followUpNotes.trim() || existingMember?.followUpNotes,
      createdAt: existingMember?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      await setEntity("gymMembers", memberRecord);

      if (!existingMember && clientForm.paidNow && fee > 0) {
        const ledgerEntry: LedgerEntry = {
          id: `led-gym-${Date.now()}`,
          date: todayStr,
          account: "Gym & S&C Membership Revenue",
          category: "Gym & Strength",
          entry: `[Vescio Nexus Gym] ${memberRecord.memberName} (${memberRecord.packageName} - ${memberRecord.branch})`,
          memo: `[Vescio Nexus Gym] ${memberRecord.memberName} (${memberRecord.packageName} - ${memberRecord.branch})`,
          type: "Revenue",
          amount: fee,
          status: "Collected",
          branch: memberRecord.branch,
        };
        await setEntity("ledger", ledgerEntry);
      }

      setClientModalOpen(false);
      toast.success(
        existingMember
          ? `Updated client profile for ${memberRecord.memberName}`
          : `Enrolled ${memberRecord.memberName} in ${memberRecord.packageName}`,
      );
    } catch {
      /* Error toast handled by data-store */
    }
  };

  // Renew / Assign New Package Modal for an existing Client
  const [renewMember, setRenewMember] = useState<GymMember | null>(null);
  const [renewPackageId, setRenewPackageId] = useState<string>("");
  const [renewPaidNow, setRenewPaidNow] = useState<boolean>(true);

  const handleConfirmRenewClient = async () => {
    if (!renewMember) return;
    const pkg =
      branchPackages.find((p) => p.id === renewPackageId) ||
      DEFAULT_GYM_PACKAGES.find((p) => p.id === renewPackageId) ||
      branchPackages[0];
    if (!pkg) return;

    const startMs = new Date(todayStr + "T12:00:00").getTime();
    const nextExpiry = new Date(startMs + pkg.durationDays * 86400000).toISOString().slice(0, 10);
    const isSessionBased = pkg.billingModel === "Session-Based";
    const addedSessions = isSessionBased ? pkg.sessionsIncluded || 10 : undefined;

    const updated: GymMember = {
      ...renewMember,
      packageId: pkg.id,
      packageName: pkg.name,
      packageType: pkg.name,
      branchAccess: pkg.branchAccess,
      monthlyFee: pkg.price,
      startDate: todayStr,
      expiryDate: nextExpiry,
      sessionsRemaining: isSessionBased
        ? (renewMember.sessionsRemaining || 0) + (addedSessions || 0)
        : undefined,
      totalSessionsIncluded: isSessionBased
        ? (renewMember.totalSessionsIncluded || 0) + (addedSessions || 0)
        : undefined,
      status: "Active",
      balance: renewPaidNow ? 0 : (renewMember.balance || 0) + pkg.price,
      followUpStatus: "Renewed",
      lastFollowUpDate: todayStr,
      updatedAt: new Date().toISOString(),
    };

    try {
      await setEntity("gymMembers", updated);

      if (renewPaidNow && pkg.price > 0) {
        await setEntity("ledger", {
          id: `led-gym-renew-${Date.now()}`,
          date: todayStr,
          account: "Gym & S&C Membership Revenue",
          category: "Gym & Strength",
          entry: `[Vescio Nexus Gym Renewal] ${renewMember.memberName} · ${pkg.name} (${renewMember.branch})`,
          memo: `[Vescio Nexus Gym Renewal] ${renewMember.memberName} · ${pkg.name} (${renewMember.branch})`,
          type: "Revenue",
          amount: pkg.price,
          status: "Collected",
          branch: renewMember.branch,
        });
      }

      setRenewMember(null);
      toast.success(`Renewed ${renewMember.memberName} on ${pkg.name} until ${nextExpiry}`);
    } catch {
      /* Error toast handled by data-store */
    }
  };

  // ---------------------------------------------------------------------------
  // 3. COACHES DIRECTORY & "COACH-AS-CLIENT" SYSTEM STATE
  // ---------------------------------------------------------------------------
  const [coachModalOpen, setCoachModalOpen] = useState(false);
  const [editingCoachId, setEditingCoachId] = useState<string | null>(null);
  const [coachForm, setCoachForm] = useState<{
    name: string;
    phone: string;
    email: string;
    branch: string;
    specialty: string;
    certifications: string;
    hourlyPtRate: number;
    status: "Active" | "On Leave" | "Inactive";
    isClientEnabled: boolean;
    initialPackageId: string;
    notes: string;
  }>({
    name: "",
    phone: "",
    email: "",
    branch: activeBranchName,
    specialty: "Strength & Conditioning / Athletic Performance",
    certifications: "CSCS, NASM-CPT",
    hourlyPtRate: 40,
    status: "Active",
    isClientEnabled: true,
    initialPackageId: "gym-pkg-coach-pool-15",
    notes: "",
  });

  // Coach Purchase / Top-Up Session Pool Modal
  const [coachTopUpTarget, setCoachTopUpTarget] = useState<GymCoachProfile | null>(null);
  const [coachTopUpPackageId, setCoachTopUpPackageId] = useState<string>("gym-pkg-coach-pool-15");
  const [coachTopUpPaidNow, setCoachTopUpPaidNow] = useState<boolean>(true);

  const openNewCoachModal = () => {
    setEditingCoachId(null);
    setCoachForm({
      name: "",
      phone: "",
      email: "",
      branch: activeBranchName,
      specialty: "Strength & Conditioning / Personal Training",
      certifications: "CSCS, EXOS Performance Specialist",
      hourlyPtRate: 45,
      status: "Active",
      isClientEnabled: true,
      initialPackageId: "gym-pkg-coach-pool-15",
      notes: "",
    });
    setCoachModalOpen(true);
  };

  const openEditCoachModal = (coach: GymCoachProfile) => {
    setEditingCoachId(coach.id);
    setCoachForm({
      name: coach.name,
      phone: coach.phone,
      email: coach.email || "",
      branch: coach.branch,
      specialty: coach.specialty,
      certifications: coach.certifications || "",
      hourlyPtRate: coach.hourlyPtRate || 45,
      status: coach.status,
      isClientEnabled: coach.isClientEnabled,
      initialPackageId: coach.activePackageId || "gym-pkg-coach-pool-15",
      notes: coach.notes || "",
    });
    setCoachModalOpen(true);
  };

  const handleSaveCoach = async () => {
    if (!coachForm.name.trim()) {
      toast.error("Please enter the coach's name.");
      return;
    }

    const existing = editingCoachId
      ? allGymCoaches.find((c) => c.id === editingCoachId)
      : undefined;

    const selectedPkg =
      branchPackages.find((p) => p.id === coachForm.initialPackageId) ||
      DEFAULT_GYM_PACKAGES.find((p) => p.id === coachForm.initialPackageId);

    const startMs = new Date(todayStr + "T12:00:00").getTime();
    const expiryDate = new Date(startMs + (selectedPkg?.durationDays || 90) * 86400000)
      .toISOString()
      .slice(0, 10);

    const coachId = existing ? existing.id : `gym-coach-${Date.now()}`;
    const linkedMemberId = existing?.linkedClientMemberId || `gym-coach-client-${coachId}`;

    const sessionsToAssign = existing
      ? existing.sessionsRemaining
      : coachForm.isClientEnabled
        ? selectedPkg?.sessionsIncluded || 15
        : 0;

    const coachRecord: GymCoachProfile = {
      id: coachId,
      name: coachForm.name.trim(),
      phone: coachForm.phone.trim() || "—",
      email: coachForm.email.trim() || undefined,
      branch: coachForm.branch || activeBranchName,
      specialty: coachForm.specialty.trim() || "Strength & Conditioning",
      certifications: coachForm.certifications.trim() || undefined,
      hourlyPtRate: Number(coachForm.hourlyPtRate) || 0,
      status: coachForm.status,
      isClientEnabled: coachForm.isClientEnabled,
      linkedClientMemberId: coachForm.isClientEnabled ? linkedMemberId : undefined,
      activePackageId: coachForm.isClientEnabled ? selectedPkg?.id : undefined,
      activePackageName: coachForm.isClientEnabled
        ? selectedPkg?.name || "Coach-as-Client Session Pool"
        : undefined,
      sessionsRemaining: sessionsToAssign,
      totalSessionsPurchased: existing
        ? existing.totalSessionsPurchased
        : coachForm.isClientEnabled
          ? selectedPkg?.sessionsIncluded || 15
          : 0,
      packageStartDate: existing?.packageStartDate || todayStr,
      packageExpiryDate: existing?.packageExpiryDate || expiryDate,
      branchAccess: selectedPkg?.branchAccess || "All Branches",
      totalPrivateClientsTrained: existing?.totalPrivateClientsTrained || 0,
      privateClientsList: existing?.privateClientsList || [],
      checkInHistory: existing?.checkInHistory || [],
      notes: coachForm.notes.trim() || undefined,
      createdAt: existing?.createdAt || new Date().toISOString(),
    };

    try {
      await saveCoachToBranch(coachRecord.branch, coachRecord);

      // If Coach-as-Client is enabled, also mirror/sync them in Clients Directory (`db.gymMembers`)
      if (coachRecord.isClientEnabled) {
        const existingMirrored = (db.gymMembers || []).find(
          (m) => m.id === linkedMemberId || m.linkedGymCoachId === coachRecord.id,
        );
        const mirroredMember: GymMember = {
          id: existingMirrored ? existingMirrored.id : linkedMemberId,
          memberName: `${coachRecord.name} (Coach-as-Client)`,
          memberType: "Coach-as-Client",
          linkedGymCoachId: coachRecord.id,
          phone: coachRecord.phone,
          email: coachRecord.email,
          fitnessGoals: `Private Client PT Facility Pool (${coachRecord.specialty})`,
          branch: coachRecord.branch,
          branchAccess: coachRecord.branchAccess || "All Branches",
          packageId: coachRecord.activePackageId,
          packageName: coachRecord.activePackageName || "Coach-as-Client Session Pool",
          packageType: "Coach PT Session Pool",
          monthlyFee: selectedPkg?.price || 210,
          sessionsRemaining: coachRecord.sessionsRemaining,
          totalSessionsIncluded: coachRecord.totalSessionsPurchased,
          startDate: coachRecord.packageStartDate || todayStr,
          expiryDate: coachRecord.packageExpiryDate || expiryDate,
          status: coachRecord.sessionsRemaining > 0 ? "Active" : "Expired",
          balance: 0,
          totalCheckIns: existingMirrored?.totalCheckIns || 0,
          lastCheckInDate: existingMirrored?.lastCheckInDate,
          checkInHistory: coachRecord.checkInHistory || [],
          workoutLogs: existingMirrored?.workoutLogs || [],
          progressMetrics: existingMirrored?.progressMetrics || [],
          createdAt: existingMirrored?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await setEntity("gymMembers", mirroredMember);

        if (!existing && selectedPkg && selectedPkg.price > 0) {
          await setEntity("ledger", {
            id: `led-coach-pool-${Date.now()}`,
            date: todayStr,
            account: "Gym & S&C Membership Revenue",
            category: "Gym & Strength",
            entry: `[Vescio Nexus Coach-as-Client Pool] ${coachRecord.name} purchased ${selectedPkg.name} (${coachRecord.branch})`,
            memo: `[Vescio Nexus Coach-as-Client Pool] ${coachRecord.name} purchased ${selectedPkg.name}`,
            type: "Revenue",
            amount: selectedPkg.price,
            status: "Collected",
            branch: coachRecord.branch,
          });
        }
      }

      setCoachModalOpen(false);
      toast.success(
        existing
          ? `Updated coach profile for ${coachRecord.name}`
          : `Added Gym Coach ${coachRecord.name}${coachRecord.isClientEnabled ? ` with ${coachRecord.sessionsRemaining} Coach-as-Client sessions` : ""}`,
      );
    } catch {
      /* Error toast handled by data-store */
    }
  };

  const handleConfirmCoachTopUp = async () => {
    if (!coachTopUpTarget) return;
    const pkg =
      branchPackages.find((p) => p.id === coachTopUpPackageId) ||
      DEFAULT_GYM_PACKAGES.find((p) => p.id === coachTopUpPackageId) ||
      DEFAULT_GYM_PACKAGES.find((p) => p.forCoachClientPool) ||
      branchPackages[0];
    if (!pkg) return;

    const addedSessions = pkg.sessionsIncluded || 15;
    const startMs = new Date(todayStr + "T12:00:00").getTime();
    const nextExpiry = new Date(startMs + (pkg.durationDays || 90) * 86400000)
      .toISOString()
      .slice(0, 10);

    const nextRemaining = (coachTopUpTarget.sessionsRemaining || 0) + addedSessions;
    const nextTotal = (coachTopUpTarget.totalSessionsPurchased || 0) + addedSessions;
    const linkedMemberId =
      coachTopUpTarget.linkedClientMemberId || `gym-coach-client-${coachTopUpTarget.id}`;

    const updatedCoach: GymCoachProfile = {
      ...coachTopUpTarget,
      isClientEnabled: true,
      linkedClientMemberId: linkedMemberId,
      activePackageId: pkg.id,
      activePackageName: pkg.name,
      sessionsRemaining: nextRemaining,
      totalSessionsPurchased: nextTotal,
      packageStartDate: todayStr,
      packageExpiryDate: nextExpiry,
      branchAccess: pkg.branchAccess,
    };

    try {
      await saveCoachToBranch(updatedCoach.branch, updatedCoach);

      // Sync mirrored Coach-as-Client record in Clients Directory
      const existingMirrored = (db.gymMembers || []).find(
        (m) => m.id === linkedMemberId || m.linkedGymCoachId === updatedCoach.id,
      );
      const mirroredMember: GymMember = {
        id: existingMirrored ? existingMirrored.id : linkedMemberId,
        memberName: `${updatedCoach.name} (Coach-as-Client)`,
        memberType: "Coach-as-Client",
        linkedGymCoachId: updatedCoach.id,
        phone: updatedCoach.phone,
        email: updatedCoach.email,
        fitnessGoals: `Private Client PT Facility Pool (${updatedCoach.specialty})`,
        branch: updatedCoach.branch,
        branchAccess: updatedCoach.branchAccess || "All Branches",
        packageId: pkg.id,
        packageName: pkg.name,
        packageType: "Coach PT Session Pool",
        monthlyFee: pkg.price,
        sessionsRemaining: nextRemaining,
        totalSessionsIncluded: nextTotal,
        startDate: todayStr,
        expiryDate: nextExpiry,
        status: "Active",
        balance: coachTopUpPaidNow ? 0 : pkg.price,
        totalCheckIns: existingMirrored?.totalCheckIns || 0,
        lastCheckInDate: existingMirrored?.lastCheckInDate,
        checkInHistory: updatedCoach.checkInHistory || [],
        workoutLogs: existingMirrored?.workoutLogs || [],
        progressMetrics: existingMirrored?.progressMetrics || [],
        createdAt: existingMirrored?.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await setEntity("gymMembers", mirroredMember);

      if (coachTopUpPaidNow && pkg.price > 0) {
        await setEntity("ledger", {
          id: `led-coach-topup-${Date.now()}`,
          date: todayStr,
          account: "Gym & S&C Membership Revenue",
          category: "Gym & Strength",
          entry: `[Vescio Nexus Coach-as-Client Top-Up] ${updatedCoach.name} purchased ${pkg.name} (+${addedSessions} sessions)`,
          memo: `[Vescio Nexus Coach-as-Client Top-Up] ${updatedCoach.name} purchased ${pkg.name} (+${addedSessions} sessions)`,
          type: "Revenue",
          amount: pkg.price,
          status: "Collected",
          branch: updatedCoach.branch,
        });
      }

      setCoachTopUpTarget(null);
      toast.success(
        `Credited +${addedSessions} sessions to ${updatedCoach.name}'s Coach-as-Client pool (${nextRemaining} total available)`,
      );
    } catch {
      /* Error toast handled by data-store */
    }
  };

  // ---------------------------------------------------------------------------
  // 4. PACKAGES & MEMBERSHIPS MANAGEMENT STATE
  // ---------------------------------------------------------------------------
  const [packageModalOpen, setPackageModalOpen] = useState(false);
  const [editingPackageId, setEditingPackageId] = useState<string | null>(null);
  const [packageForm, setPackageForm] = useState<{
    name: string;
    category: GymPackageCategory;
    billingModel: "Unlimited Duration" | "Session-Based";
    price: number;
    durationDays: number;
    sessionsIncluded: number;
    branchAccess: "Single Branch" | "All Branches";
    forCoachClientPool: boolean;
    description: string;
    active: boolean;
  }>({
    name: "",
    category: "Monthly",
    billingModel: "Unlimited Duration",
    price: 65,
    durationDays: 30,
    sessionsIncluded: 10,
    branchAccess: "Single Branch",
    forCoachClientPool: false,
    description: "",
    active: true,
  });

  const openNewPackageModal = () => {
    setEditingPackageId(null);
    setPackageForm({
      name: "",
      category: "Session Pack",
      billingModel: "Session-Based",
      price: 180,
      durationDays: 60,
      sessionsIncluded: 10,
      branchAccess: "Single Branch",
      forCoachClientPool: false,
      description: "",
      active: true,
    });
    setPackageModalOpen(true);
  };

  const openEditPackageModal = (pkg: GymPackageConfig) => {
    setEditingPackageId(pkg.id);
    setPackageForm({
      name: pkg.name,
      category: pkg.category,
      billingModel: pkg.billingModel,
      price: pkg.price,
      durationDays: pkg.durationDays,
      sessionsIncluded: pkg.sessionsIncluded || 10,
      branchAccess: pkg.branchAccess,
      forCoachClientPool: Boolean(pkg.forCoachClientPool),
      description: pkg.description || "",
      active: pkg.active,
    });
    setPackageModalOpen(true);
  };

  const handleSavePackage = async () => {
    if (!packageForm.name.trim()) {
      toast.error("Please enter a package name.");
      return;
    }

    const pkgRecord: GymPackageConfig = {
      id: editingPackageId || `gym-pkg-${Date.now()}`,
      name: packageForm.name.trim(),
      category: packageForm.category,
      billingModel: packageForm.billingModel,
      price: Number(packageForm.price) || 0,
      durationDays: Math.max(1, Number(packageForm.durationDays) || 30),
      sessionsIncluded:
        packageForm.billingModel === "Session-Based"
          ? Math.max(1, Number(packageForm.sessionsIncluded) || 10)
          : undefined,
      branchAccess: packageForm.branchAccess,
      branch: activeBranchName,
      forCoachClientPool: packageForm.forCoachClientPool,
      description: packageForm.description.trim() || undefined,
      active: packageForm.active,
    };

    const exists = branchPackages.some((p) => p.id === pkgRecord.id);
    const nextPackages = exists
      ? branchPackages.map((p) => (p.id === pkgRecord.id ? pkgRecord : p))
      : [...branchPackages, pkgRecord];

    try {
      await savePackagesToBranch(nextPackages);
      setPackageModalOpen(false);
      toast.success(
        exists ? `Updated package "${pkgRecord.name}"` : `Created package "${pkgRecord.name}"`,
      );
    } catch {
      /* Error toast handled by transaction wrapper */
    }
  };

  // ---------------------------------------------------------------------------
  // 5. GYM SCHEDULE BOOKING MODAL & SHARED OFF DAYS MODAL STATE
  // ---------------------------------------------------------------------------
  const [slotModalOpen, setSlotModalOpen] = useState(false);
  const [slotForm, setSlotForm] = useState<{
    branch: string;
    date: string;
    startTime: string;
    endTime: string;
    slotType: GymScheduleSlotType;
    title: string;
    coachId: string;
    clientMemberId: string;
    privateClientName: string;
    maxCapacity: number;
    deductionMode: "Client Package" | "Coach Session Pool";
    notes: string;
  }>({
    branch: activeBranchName,
    date: scheduleDate,
    startTime: "10:00",
    endTime: "11:00",
    slotType: "Personal Training (PT)",
    title: "1-on-1 Strength & Hypertrophy PT",
    coachId: "",
    clientMemberId: "",
    privateClientName: "",
    maxCapacity: 1,
    deductionMode: "Client Package",
    notes: "",
  });

  const openNewSlotModal = (presetType?: GymScheduleSlotType) => {
    const type = presetType || "Personal Training (PT)";
    setSlotForm({
      branch: activeBranchName,
      date: scheduleDate,
      startTime: "10:00",
      endTime: "11:00",
      slotType: type,
      title:
        type === "Group Strength Class"
          ? "Explosive Power & Conditioning Circuit"
          : type === "Coach-as-Client Private PT"
            ? "Coach Private Client PT Session"
            : type === "Gym Floor Slot"
              ? "Open Gym Floor Strength Slot"
              : "1-on-1 Personal Training Session",
      coachId: filteredGymCoaches[0]?.id || "",
      clientMemberId: filteredGymMembers[0]?.id || "",
      privateClientName: "",
      maxCapacity:
        type === "Group Strength Class"
          ? 12
          : type === "Gym Floor Slot"
            ? activeBranchObj?.gymCapacity || 25
            : 1,
      deductionMode:
        type === "Coach-as-Client Private PT" ? "Coach Session Pool" : "Client Package",
      notes: "",
    });
    setSlotModalOpen(true);
  };

  const handleSaveScheduleSlot = async () => {
    const targetBranch = db.branches.find((b) => b.name === slotForm.branch) || activeBranchObj;
    const offDayMatch = (targetBranch?.offDays || []).find((od) => od.date === slotForm.date);
    if (offDayMatch) {
      toast.error(
        `Cannot book gym slot on ${slotForm.date}: Branch is closed for Off Day (${offDayMatch.reason}).`,
      );
      return;
    }

    if (!allowPastDates && slotForm.date < todayStr) {
      toast.error("Enable 'Allow Past Dates' to schedule slots on previous dates.");
      return;
    }

    const coach = allGymCoaches.find((c) => c.id === slotForm.coachId);
    const client = (db.gymMembers || []).find((m) => m.id === slotForm.clientMemberId);

    if (slotForm.deductionMode === "Coach Session Pool") {
      if (!coach) {
        toast.error("Please select the Coach whose session pool will be used.");
        return;
      }
      if (!coach.isClientEnabled || coach.sessionsRemaining <= 0) {
        toast.error(
          `${coach.name} has 0 remaining sessions in their Coach-as-Client pool. Top up their pool first.`,
        );
        return;
      }
    }

    const newSlot: GymScheduleSlot = {
      id: `gym-slot-${Date.now()}`,
      branch: slotForm.branch || activeBranchName,
      date: slotForm.date,
      startTime: slotForm.startTime,
      endTime: slotForm.endTime,
      slotType: slotForm.slotType,
      title: slotForm.title.trim() || slotForm.slotType,
      coachId: coach?.id,
      coachName: coach?.name,
      clientMemberId: slotForm.deductionMode === "Client Package" ? client?.id : undefined,
      clientName: slotForm.deductionMode === "Client Package" ? client?.memberName : undefined,
      privateClientName:
        slotForm.deductionMode === "Coach Session Pool"
          ? slotForm.privateClientName.trim() || "Private PT Client"
          : undefined,
      maxCapacity: Math.max(1, Number(slotForm.maxCapacity) || 1),
      attendeeIds: client && slotForm.deductionMode === "Client Package" ? [client.id] : [],
      attendeeNames:
        client && slotForm.deductionMode === "Client Package" ? [client.memberName] : [],
      deductionMode: slotForm.deductionMode,
      status: "Booked",
      notes: slotForm.notes.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    try {
      await updateBookingInBranch(newSlot.branch, newSlot);
      setSlotModalOpen(false);
      toast.success(`Scheduled "${newSlot.title}" on ${newSlot.date} at ${newSlot.startTime}`);
    } catch {
      /* Error toast handled by transaction wrapper */
    }
  };

  // Direct 1-click Check-In from a Schedule Slot card via atomic Firestore transaction
  const handleCheckInBookedSlot = async (slot: GymScheduleSlot) => {
    if (slot.status === "Checked In" || slot.status === "Completed") {
      toast.info("This slot is already checked in.");
      return;
    }

    const nowTime = new Date().toTimeString().slice(0, 5);
    const targetBranch = db.branches.find((b) => b.name === slot.branch) || activeBranchObj;
    if (!targetBranch) {
      toast.error("Branch record not found.");
      return;
    }

    if (slot.deductionMode === "Coach Session Pool") {
      const coach = allGymCoaches.find((c) => c.id === slot.coachId);
      if (!coach) {
        toast.error("Assigned Coach not found.");
        return;
      }
      if (coach.sessionsRemaining <= 0) {
        toast.error(`${coach.name} has 0 sessions remaining in their Coach-as-Client pool.`);
        return;
      }

      const nextSessions = Math.max(0, coach.sessionsRemaining - 1);
      const trainee = slot.privateClientName || "Private Client";
      const entry: GymCheckInEntry = {
        id: `chk-slot-coach-${Date.now()}`,
        date: slot.date,
        time: nowTime,
        branch: slot.branch,
        slotId: slot.id,
        slotTitle: slot.title,
        deductionType: "Coach Session Pool",
        coachId: coach.id,
        coachName: coach.name,
        privateClientName: trainee,
        sessionsRemainingAfter: nextSessions,
        note: `Checked in via schedule slot "${slot.title}" · Trained ${trainee} (${nextSessions} coach sessions left)`,
      };

      const linkedMember = (db.gymMembers || []).find(
        (m) => m.linkedGymCoachId === coach.id || m.id === coach.linkedClientMemberId,
      );

      try {
        const result = await atomicGymCheckInTransaction({
          tenantId,
          branchId: targetBranch.id,
          fallbackBranch: {
            ...targetBranch,
            gymCoaches: targetBranch.gymCoaches?.length
              ? targetBranch.gymCoaches
              : allGymCoaches.filter((c) => c.branch === targetBranch.name),
          },
          mode: "coach_credit",
          client: linkedMember || null,
          coachId: coach.id,
          privateClientName: trainee,
          bookingId: slot.id,
          checkInEntry: entry,
          checkInDate: slot.date,
          checkInTime: nowTime,
        });

        await setEntity("branches", result.updatedBranch);
        if (result.updatedMember) {
          await setEntity("gymMembers", result.updatedMember);
        }

        const remAfter = result.remainingSessions ?? nextSessions;
        toast.success(
          `Checked in ${coach.name} + ${trainee} · Deducted 1 session from Coach pool (${remAfter} left)`,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to check in slot.";
        toast.error(msg);
      }
      return;
    }

    // Standard Client Package check-in from slot
    const member = (db.gymMembers || []).find((m) => m.id === slot.clientMemberId);
    if (member) {
      if (member.sessionsRemaining !== undefined && member.sessionsRemaining <= 0) {
        toast.error(`${member.memberName} has 0 remaining sessions. Please renew package first.`);
        return;
      }

      const nextSessions =
        member.sessionsRemaining !== undefined
          ? Math.max(0, member.sessionsRemaining - 1)
          : undefined;

      const entry: GymCheckInEntry = {
        id: `chk-slot-${Date.now()}`,
        date: slot.date,
        time: nowTime,
        branch: slot.branch,
        slotId: slot.id,
        slotTitle: slot.title,
        deductionType: nextSessions !== undefined ? "Client Session Pack" : "Membership",
        coachId: slot.coachId,
        coachName: slot.coachName,
        sessionsRemainingAfter: nextSessions,
        note: `Checked in for scheduled slot "${slot.title}" (${slot.startTime})`,
      };

      try {
        const result = await atomicGymCheckInTransaction({
          tenantId,
          branchId: targetBranch.id,
          fallbackBranch: targetBranch,
          mode: "client",
          client: member,
          bookingId: slot.id,
          checkInEntry: entry,
          checkInDate: slot.date,
          checkInTime: nowTime,
        });

        if (result.updatedMember) {
          await setEntity("gymMembers", result.updatedMember);
        }
        await setEntity("branches", result.updatedBranch);
        toast.success(`Slot "${slot.title}" checked in!`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to check in slot.";
        toast.error(msg);
      }
      return;
    }

    try {
      await updateBookingInBranch(slot.branch, {
        ...slot,
        status: "Checked In",
        checkedInAt: `${slot.date} ${nowTime}`,
      });
      toast.success(`Slot "${slot.title}" checked in!`);
    } catch {
      /* Error toast handled by transaction wrapper */
    }
  };

  // Shared Off Days Modal State
  const [offDaysModalOpen, setOffDaysModalOpen] = useState(false);
  const [newOffDayDate, setNewOffDayDate] = useState(scheduleDate);
  const [newOffDayReason, setNewOffDayReason] = useState("");

  const handleAddOffDay = async () => {
    if (!activeBranchObj) return;
    if (!newOffDayDate) {
      toast.error("Select a date for the Off Day.");
      return;
    }
    const existing = activeBranchObj.offDays || [];
    if (existing.some((od) => od.date === newOffDayDate)) {
      toast.error(`${newOffDayDate} is already marked as an Off Day.`);
      return;
    }
    const entry: BranchOffDay = {
      id: `offday-gym-${Date.now()}`,
      date: newOffDayDate,
      reason: newOffDayReason.trim() || "Facility Maintenance / Holiday Closure",
      createdBy: role || "Admin",
      createdAt: new Date().toISOString(),
    };
    try {
      await runBranchArrayTransaction(
        activeBranchObj.id,
        (curr) => ({
          ...curr,
          offDays: [...(curr.offDays || []).filter((od) => od.date !== newOffDayDate), entry],
        }),
        activeBranchObj,
      );
      setNewOffDayReason("");
      toast.success(
        `Added Off Day on ${newOffDayDate} for ${activeBranchObj.name} (synced across Gym & Courts)`,
      );
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
          offDays: (curr.offDays || []).filter((od) => od.id !== offDayId),
        }),
        activeBranchObj,
      );
      toast.success("Removed Off Day.");
    } catch {
      /* Error toast handled by transaction wrapper */
    }
  };

  // ---------------------------------------------------------------------------
  // 6. CLIENT PROGRESS TRACKING (BODY METRICS, BENCHMARKS, WORKOUT LOGS)
  // ---------------------------------------------------------------------------
  const [selectedProfileMemberId, setSelectedProfileMemberId] = useState<string>("");
  const activeProfileMember = useMemo(
    () =>
      filteredGymMembers.find((m) => m.id === selectedProfileMemberId) ||
      filteredGymMembers[0] ||
      null,
    [filteredGymMembers, selectedProfileMemberId],
  );

  const [metricModalOpen, setMetricModalOpen] = useState(false);
  const [metricForm, setMetricForm] = useState<{
    date: string;
    weightKg: string;
    bodyFatPct: string;
    muscleMassKg: string;
    benchPress1RM: string;
    backSquat1RM: string;
    deadlift1RM: string;
    verticalJumpCm: string;
    notes: string;
  }>({
    date: todayStr,
    weightKg: "",
    bodyFatPct: "",
    muscleMassKg: "",
    benchPress1RM: "",
    backSquat1RM: "",
    deadlift1RM: "",
    verticalJumpCm: "",
    notes: "",
  });

  const handleSaveProgressMetric = async () => {
    if (!activeProfileMember) return;
    const entry: GymProgressMetricEntry = {
      id: `prog-${Date.now()}`,
      date: metricForm.date || todayStr,
      weightKg: metricForm.weightKg ? Number(metricForm.weightKg) : undefined,
      bodyFatPct: metricForm.bodyFatPct ? Number(metricForm.bodyFatPct) : undefined,
      muscleMassKg: metricForm.muscleMassKg ? Number(metricForm.muscleMassKg) : undefined,
      benchPress1RM: metricForm.benchPress1RM ? Number(metricForm.benchPress1RM) : undefined,
      backSquat1RM: metricForm.backSquat1RM ? Number(metricForm.backSquat1RM) : undefined,
      deadlift1RM: metricForm.deadlift1RM ? Number(metricForm.deadlift1RM) : undefined,
      verticalJumpCm: metricForm.verticalJumpCm ? Number(metricForm.verticalJumpCm) : undefined,
      recordedBy: role || "S&C Coach",
      notes: metricForm.notes.trim() || undefined,
    };

    try {
      await setEntity("gymMembers", {
        ...activeProfileMember,
        progressMetrics: [entry, ...(activeProfileMember.progressMetrics || [])],
        updatedAt: new Date().toISOString(),
      });
      setMetricModalOpen(false);
      toast.success(`Logged body & strength metrics for ${activeProfileMember.memberName}`);
    } catch {
      /* Error toast handled by data-store */
    }
  };

  const [workoutModalOpen, setWorkoutModalOpen] = useState(false);
  const [workoutForm, setWorkoutForm] = useState<{
    date: string;
    focusArea: GymWorkoutLog["focusArea"];
    exercisesSummary: string;
    setsRepsLoad: string;
    rpe: number;
    personalRecord: string;
    coachName: string;
    notes: string;
  }>({
    date: todayStr,
    focusArea: "Lower Body Power",
    exercisesSummary: " Trap Bar Deadlift, Bulgarian Split Squat, Box Jumps",
    setsRepsLoad: "4x5 @ 120kg · 3x8 @ 24kg DBs · 4x4 Explosive",
    rpe: 8,
    personalRecord: "",
    coachName: filteredGymCoaches[0]?.name || "Coach Marcus",
    notes: "",
  });

  const handleSaveWorkoutLog = async () => {
    if (!activeProfileMember) return;
    if (!workoutForm.exercisesSummary.trim()) {
      toast.error("Please enter the exercises summary.");
      return;
    }
    const newLog: GymWorkoutLog = {
      id: `wk-${Date.now()}`,
      date: workoutForm.date || todayStr,
      focusArea: workoutForm.focusArea,
      exercisesSummary: workoutForm.exercisesSummary.trim(),
      setsRepsLoad: workoutForm.setsRepsLoad.trim() || "4x8 @ RPE 8",
      rpe: Number(workoutForm.rpe) || 8,
      personalRecord: workoutForm.personalRecord.trim() || undefined,
      coachName: workoutForm.coachName.trim() || "S&C Coach",
      notes: workoutForm.notes.trim() || undefined,
    };

    try {
      await setEntity("gymMembers", {
        ...activeProfileMember,
        workoutLogs: [newLog, ...(activeProfileMember.workoutLogs || [])],
        updatedAt: new Date().toISOString(),
      });
      setWorkoutModalOpen(false);
      toast.success(`Logged workout session for ${activeProfileMember.memberName}`);
    } catch {
      /* Error toast handled by data-store */
    }
  };

  // Update Follow-Up Status / Note inline
  const handleUpdateFollowUp = async (
    member: GymMember,
    status: GymMember["followUpStatus"],
    notes?: string,
  ) => {
    try {
      await setEntity("gymMembers", {
        ...member,
        followUpStatus: status,
        followUpNotes: notes !== undefined ? notes : member.followUpNotes,
        lastFollowUpDate: todayStr,
        updatedAt: new Date().toISOString(),
      });
      toast.success(`Updated follow-up status for ${member.memberName} to "${status}"`);
    } catch {
      /* Error toast handled by data-store */
    }
  };

  // Filtered Clients Directory list
  const directoryClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    return filteredGymMembers.filter((m) => {
      const statusOk =
        clientStatusFilter === "All" ||
        (clientStatusFilter === "Coach-as-Client"
          ? m.memberType === "Coach-as-Client"
          : m.status === clientStatusFilter);
      if (!statusOk) return false;
      if (!q) return true;
      return (
        m.memberName.toLowerCase().includes(q) ||
        (m.phone || "").toLowerCase().includes(q) ||
        (m.packageName || "").toLowerCase().includes(q) ||
        (m.fitnessGoals || "").toLowerCase().includes(q)
      );
    });
  }, [filteredGymMembers, clientSearch, clientStatusFilter]);

  // Summary KPIs
  const activeMembersCount = useMemo(
    () => filteredGymMembers.filter((m) => m.status === "Active").length,
    [filteredGymMembers],
  );
  const coachClientPoolsCount = useMemo(
    () => filteredGymCoaches.filter((c) => c.isClientEnabled).length,
    [filteredGymCoaches],
  );
  const todayCheckInsCount = useMemo(() => {
    let count = 0;
    for (const m of filteredGymMembers) {
      count += (m.checkInHistory || []).filter((h) => h.date === todayStr).length;
    }
    return count;
  }, [filteredGymMembers, todayStr]);

  return (
    <div className="space-y-6">
      {/* TOP BRANCH & KPI HEADER BAR */}
      <Card className="p-5 bg-gradient-to-br from-amber-500/10 via-vv-card to-vv-card border-amber-500/25">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <Dumbbell className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-black text-white tracking-tight">
                    Gym & Strength Facility Module
                  </h2>
                  <Badge tone="amber">{activeBranchName}</Badge>
                  {activeDateOffDay && <Badge tone="red">OFF DAY: {activeDateOffDay.reason}</Badge>}
                </div>
                <p className="text-xs text-vv-muted">
                  Clients Directory · Coaches & Coach-as-Client Session Pools · Flexible Packages ·
                  Schedule & Fast Check-In · Progress & Follow-Up
                </p>
              </div>
            </div>
          </div>

          {/* Branch Switcher Pills + Quick Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center bg-black/30 border border-vv-border rounded-xl p-1">
              <button
                type="button"
                onClick={() => onSelectBranch("All")}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  selectedBranch === "All"
                    ? "bg-amber-500 text-black shadow"
                    : "text-vv-muted hover:text-white"
                }`}
              >
                All Branches
              </button>
              {db.branches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onSelectBranch(b.name)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    selectedBranch === b.name
                      ? "bg-amber-500 text-black shadow"
                      : "text-vv-muted hover:text-white"
                  }`}
                >
                  {b.name}
                </button>
              ))}
            </div>

            <Btn
              variant="secondary"
              size="sm"
              onClick={() => {
                setNewOffDayDate(scheduleDate);
                setOffDaysModalOpen(true);
              }}
            >
              <CalendarOff className="w-3.5 h-3.5 text-rose-400" /> Off Days ({branchOffDays.length}
              )
            </Btn>
            <Btn variant="secondary" size="sm" onClick={() => openNewSlotModal()}>
              <Calendar className="w-3.5 h-3.5 text-sky-400" /> + Book Gym Slot
            </Btn>
            <Btn variant="secondary" size="sm" onClick={openNewCoachModal}>
              <UserCheck className="w-3.5 h-3.5 text-emerald-400" /> + Add Coach
            </Btn>
            <Btn variant="primary" size="sm" onClick={openNewClientModal}>
              <Plus className="w-3.5 h-3.5" /> + Enroll Client
            </Btn>
          </div>
        </div>

        {/* 4 Summary Metrics Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-5 pt-4 border-t border-vv-border/60">
          <div className="p-3 rounded-xl bg-black/25 border border-vv-border/70">
            <div className="text-[10px] font-bold uppercase tracking-wider text-vv-muted">
              Active Clients & Memberships
            </div>
            <div className="text-xl font-black text-white mt-0.5">
              {activeMembersCount}{" "}
              <span className="text-xs font-normal text-vv-muted">
                / {filteredGymMembers.length} total
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-black/25 border border-vv-border/70">
            <div className="text-[10px] font-bold uppercase tracking-wider text-vv-muted">
              Coaches & Coach-as-Client Pools
            </div>
            <div className="text-xl font-black text-emerald-400 mt-0.5">
              {filteredGymCoaches.length} Coaches{" "}
              <span className="text-xs font-semibold text-sky-400">
                ({coachClientPoolsCount} Client Pools)
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-black/25 border border-vv-border/70">
            <div className="text-[10px] font-bold uppercase tracking-wider text-vv-muted">
              Today&apos;s Check-Ins & Scheduled Slots
            </div>
            <div className="text-xl font-black text-amber-400 mt-0.5">
              {todayCheckInsCount} Check-Ins{" "}
              <span className="text-xs font-normal text-vv-muted">
                · {slotsForScheduleDate.length} slots on {scheduleDate}
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-black/25 border border-vv-border/70">
            <div className="text-[10px] font-bold uppercase tracking-wider text-vv-muted">
              Expiring / Low-Session Follow-Up
            </div>
            <div className="text-xl font-black text-rose-400 mt-0.5">
              {followUpMembers.length + followUpCoaches.length}{" "}
              <span className="text-xs font-normal text-vv-muted">requiring renewal attention</span>
            </div>
          </div>
        </div>
      </Card>

      {/* MODULE SUB-NAVIGATION TABS */}
      <div className="flex flex-wrap items-center gap-2 border-b border-vv-border pb-3">
        {[
          {
            id: "schedule_checkin" as GymSubTab,
            label: "Schedule & Fast Check-In",
            icon: Calendar,
            badge: slotsForScheduleDate.length,
          },
          {
            id: "clients" as GymSubTab,
            label: "Clients Directory",
            icon: Users,
            badge: filteredGymMembers.length,
          },
          {
            id: "coaches" as GymSubTab,
            label: "Coaches & Coach-as-Client",
            icon: UserCheck,
            badge: filteredGymCoaches.length,
          },
          {
            id: "packages" as GymSubTab,
            label: "Packages & Memberships",
            icon: Package,
            badge: branchPackages.length,
          },
          {
            id: "tracking_followup" as GymSubTab,
            label: "Progress Tracking & Follow-Up",
            icon: Activity,
            badge: followUpMembers.length + followUpCoaches.length,
          },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSubTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
                active
                  ? "bg-amber-500 text-black border-amber-400 shadow-md"
                  : "bg-vv-card text-vv-muted border-vv-border hover:text-white hover:border-amber-500/40"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              <span
                className={`px-1.5 py-0.5 rounded-md text-[10px] font-black ${
                  active ? "bg-black/20 text-black" : "bg-white/5 text-vv-muted"
                }`}
              >
                {tab.badge}
              </span>
            </button>
          );
        })}
      </div>

      {/* =====================================================================
          SUB-TAB 1: GYM SCHEDULE, BOOKINGS & FAST FRONT-DESK CHECK-IN
      ===================================================================== */}
      {activeSubTab === "schedule_checkin" && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* LEFT 5 COLS: FAST FRONT-DESK CHECK-IN CONSOLE */}
          <Card className="xl:col-span-5 p-5 space-y-4 border-emerald-500/30">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">
                    Fast Front-Desk Check-In
                  </h3>
                  <p className="text-[11px] text-vv-muted">
                    Validates membership / remaining sessions & deducts automatically
                  </p>
                </div>
              </div>
              <Badge tone="green">Live Desk</Badge>
            </div>

            {/* Mode Switcher: Client Check-In vs Coach-as-Client Private PT */}
            <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-black/30 border border-vv-border">
              <button
                type="button"
                onClick={() => setCheckInMode("client")}
                className={`py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  checkInMode === "client"
                    ? "bg-emerald-500 text-black shadow"
                    : "text-vv-muted hover:text-white"
                }`}
              >
                Client Check-In
              </button>
              <button
                type="button"
                onClick={() => setCheckInMode("coach_as_client")}
                className={`py-2 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  checkInMode === "coach_as_client"
                    ? "bg-sky-500 text-black shadow"
                    : "text-vv-muted hover:text-white"
                }`}
              >
                Coach-as-Client PT Pool
              </button>
            </div>

            {/* Instant Search by Name, Phone, or ID */}
            <div className="relative">
              <Search className="w-4 h-4 text-vv-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={checkInSearch}
                onChange={(e) => setCheckInSearch(e.target.value)}
                placeholder={
                  checkInMode === "client"
                    ? "Search client by name, phone, or ID..."
                    : "Search coach by name, phone, or ID..."
                }
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-black/30 border border-vv-border text-xs text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            {checkInMode === "client" ? (
              <div className="space-y-3">
                <Field label="Select Client">
                  <Select
                    value={activeCheckInMember?.id || ""}
                    onChange={(e) => setSelectedCheckInMemberId(e.target.value)}
                  >
                    {matchingCheckInMembers.length === 0 && (
                      <option value="">No matching clients found</option>
                    )}
                    {matchingCheckInMembers.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.memberName} ({m.phone}) — {m.packageName}
                      </option>
                    ))}
                  </Select>
                </Field>

                {/* Live Validation Summary Card */}
                {activeCheckInMember && (
                  <div className="p-3.5 rounded-xl bg-black/35 border border-vv-border space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-black text-white">
                          {activeCheckInMember.memberName}
                        </div>
                        <div className="text-[11px] text-vv-muted">
                          {activeCheckInMember.phone} · {activeCheckInMember.branch} (
                          {activeCheckInMember.branchAccess || "Single Branch"})
                        </div>
                      </div>
                      <Badge
                        tone={
                          activeCheckInMember.status === "Active" &&
                          getDaysUntilExpiry(activeCheckInMember.expiryDate) >= 0 &&
                          (activeCheckInMember.sessionsRemaining === undefined ||
                            activeCheckInMember.sessionsRemaining > 0)
                            ? "green"
                            : "red"
                        }
                      >
                        {activeCheckInMember.status}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-vv-border/60 text-xs">
                      <div>
                        <span className="text-vv-muted block text-[10px]">Active Package</span>
                        <span className="font-bold text-amber-400">
                          {activeCheckInMember.packageName}
                        </span>
                      </div>
                      <div>
                        <span className="text-vv-muted block text-[10px]">Sessions / Validity</span>
                        <span className="font-bold text-white">
                          {activeCheckInMember.sessionsRemaining !== undefined
                            ? `${activeCheckInMember.sessionsRemaining} / ${activeCheckInMember.totalSessionsIncluded || activeCheckInMember.sessionsRemaining} sessions left`
                            : `Unlimited · ${getDaysUntilExpiry(activeCheckInMember.expiryDate)}d left`}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                <Field label="Select Coach (Operating as Client)">
                  <Select
                    value={activeCheckInCoach?.id || ""}
                    onChange={(e) => setSelectedCheckInCoachId(e.target.value)}
                  >
                    {matchingCheckInCoaches.length === 0 && (
                      <option value="">No Coach-as-Client pools available</option>
                    )}
                    {matchingCheckInCoaches.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} — {c.sessionsRemaining} / {c.totalSessionsPurchased} pool sessions
                        left
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Private Client Being Trained">
                  <Input
                    value={privateClientNameForCoach}
                    onChange={(e) => setPrivateClientNameForCoach(e.target.value)}
                    placeholder="e.g., Rami Haddad (Private PT Trainee)"
                  />
                </Field>

                {activeCheckInCoach && (
                  <div className="p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/30 space-y-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-black text-white">
                          {activeCheckInCoach.name}
                        </div>
                        <div className="text-[11px] text-sky-300">
                          {activeCheckInCoach.activePackageName || "Coach-as-Client Session Pool"}
                        </div>
                      </div>
                      <Badge tone={activeCheckInCoach.sessionsRemaining > 0 ? "blue" : "red"}>
                        {activeCheckInCoach.sessionsRemaining} Pool Credits Left
                      </Badge>
                    </div>
                    <p className="text-[11px] text-vv-muted">
                      Checking in will deduct <strong>1 session</strong> directly from{" "}
                      {activeCheckInCoach.name}&apos;s purchased Coach-as-Client session pool.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Link to a Booked Gym Schedule Slot (Optional) */}
            <Field label={`Link to Booked Gym Slot on ${scheduleDate} (Optional)`}>
              <Select
                value={selectedCheckInSlotId}
                onChange={(e) => setSelectedCheckInSlotId(e.target.value)}
              >
                <option value="">Walk-In / Unscheduled Floor Session</option>
                {slotsForScheduleDate.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.startTime}–{s.endTime} · {s.title} ({s.slotType}) [{s.status}]
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Check-In Note (Optional)">
              <Input
                value={checkInNote}
                onChange={(e) => setCheckInNote(e.target.value)}
                placeholder="e.g., Locker key #14, Lower body strength day..."
              />
            </Field>

            <Btn
              variant="primary"
              className="w-full justify-center py-2.5"
              onClick={handleExecuteFrontDeskCheckIn}
              disabled={Boolean(activeDateOffDay)}
            >
              <CheckCircle2 className="w-4 h-4" />
              {checkInMode === "client"
                ? "Verify & Check In Client"
                : "Check In Coach & Deduct 1 Coach Pool Session"}
            </Btn>
          </Card>

          {/* RIGHT 7 COLS: GYM SCHEDULE & BOOKINGS CALENDAR */}
          <Card className="xl:col-span-7 p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-amber-400" />
                  Gym Floor, Personal Training & Group Strength Schedule
                </h3>
                <p className="text-[11px] text-vv-muted">
                  Synced with {activeBranchName} Off Days & Coach-as-Client private sessions
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-1.5 text-[11px] text-vv-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowPastDates}
                    onChange={(e) => setAllowPastDates(e.target.checked)}
                    className="rounded border-vv-border"
                  />
                  Allow Past Dates
                </label>

                <div className="flex items-center gap-1 bg-black/30 border border-vv-border rounded-xl p-1">
                  <button
                    type="button"
                    onClick={() => {
                      const prev = new Date(
                        new Date(scheduleDate + "T12:00:00").getTime() - 86400000,
                      )
                        .toISOString()
                        .slice(0, 10);
                      if (!allowPastDates && prev < todayStr) {
                        toast.info("Enable 'Allow Past Dates' to view previous dates.");
                        return;
                      }
                      setScheduleDate(prev);
                    }}
                    className="p-1 rounded-lg hover:bg-white/10 text-vv-muted hover:text-white cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <input
                    type="date"
                    value={scheduleDate}
                    min={allowPastDates ? undefined : todayStr}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    className="bg-transparent text-xs font-bold text-white px-2 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const next = new Date(
                        new Date(scheduleDate + "T12:00:00").getTime() + 86400000,
                      )
                        .toISOString()
                        .slice(0, 10);
                      setScheduleDate(next);
                    }}
                    className="p-1 rounded-lg hover:bg-white/10 text-vv-muted hover:text-white cursor-pointer"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                <Btn variant="secondary" size="sm" onClick={() => setScheduleDate(todayStr)}>
                  Today
                </Btn>
              </div>
            </div>

            {/* Slot Type Filters + Quick Book Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-vv-border/60">
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  "All",
                  "Gym Floor Slot",
                  "Personal Training (PT)",
                  "Coach-as-Client Private PT",
                  "Group Strength Class",
                ].map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setScheduleTypeFilter(type)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${
                      scheduleTypeFilter === type
                        ? "bg-amber-500 text-black"
                        : "bg-white/5 text-vv-muted hover:text-white"
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>

              <Btn
                variant="primary"
                size="sm"
                onClick={() => openNewSlotModal()}
                disabled={Boolean(activeDateOffDay)}
              >
                <Plus className="w-3.5 h-3.5" /> Book Slot
              </Btn>
            </div>

            {/* SHARED OFF DAY BANNER IF FACILITY IS CLOSED ON SELECTED DATE */}
            {activeDateOffDay && (
              <div className="p-4 rounded-xl bg-rose-500/15 border border-rose-500/40 flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <CalendarOff className="w-6 h-6 text-rose-400 shrink-0" />
                  <div>
                    <div className="text-sm font-black text-rose-300">
                      Facility Closed — Branch Off Day ({scheduleDate})
                    </div>
                    <div className="text-xs text-rose-200/80">
                      Reason: <strong>{activeDateOffDay.reason}</strong> · Gym floor bookings and
                      check-ins are automatically blocked on this date (synced with Court
                      Reservations).
                    </div>
                  </div>
                </div>
                <Btn variant="secondary" size="sm" onClick={() => setOffDaysModalOpen(true)}>
                  Manage Off Days
                </Btn>
              </div>
            )}

            {/* SCHEDULE SLOTS LIST FOR SELECTED DATE */}
            {slotsForScheduleDate.length === 0 ? (
              <div className="py-12 text-center border border-dashed border-vv-border rounded-xl space-y-2">
                <Calendar className="w-8 h-8 text-vv-muted mx-auto opacity-50" />
                <div className="text-sm font-bold text-white">
                  No gym slots scheduled for {scheduleDate}
                </div>
                <p className="text-xs text-vv-muted max-w-md mx-auto">
                  Book a Gym Floor Slot, 1-on-1 Personal Training session, Coach-as-Client Private
                  PT session, or Group Strength Class.
                </p>
                {!activeDateOffDay && (
                  <div className="flex justify-center gap-2 pt-2">
                    <Btn
                      variant="secondary"
                      size="sm"
                      onClick={() => openNewSlotModal("Personal Training (PT)")}
                    >
                      + Book 1-on-1 PT
                    </Btn>
                    <Btn
                      variant="secondary"
                      size="sm"
                      onClick={() => openNewSlotModal("Coach-as-Client Private PT")}
                    >
                      + Coach-as-Client PT
                    </Btn>
                    <Btn
                      variant="secondary"
                      size="sm"
                      onClick={() => openNewSlotModal("Group Strength Class")}
                    >
                      + Group Strength Class
                    </Btn>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2.5">
                {slotsForScheduleDate.map((slot) => {
                  const isCoachPool = slot.deductionMode === "Coach Session Pool";
                  return (
                    <div
                      key={slot.id}
                      className="p-3.5 rounded-xl bg-black/30 border border-vv-border hover:border-amber-500/40 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-400 font-mono text-xs font-black">
                            {slot.startTime} – {slot.endTime}
                          </span>
                          <span className="text-sm font-black text-white">{slot.title}</span>
                          <Badge
                            tone={
                              slot.slotType === "Coach-as-Client Private PT"
                                ? "blue"
                                : slot.slotType === "Group Strength Class"
                                  ? "amber"
                                  : "gray"
                            }
                          >
                            {slot.slotType}
                          </Badge>
                          <Badge
                            tone={
                              slot.status === "Checked In" || slot.status === "Completed"
                                ? "green"
                                : slot.status === "Cancelled"
                                  ? "red"
                                  : "amber"
                            }
                          >
                            {slot.status}
                          </Badge>
                        </div>

                        <div className="text-xs text-vv-muted flex flex-wrap items-center gap-3">
                          {slot.coachName && (
                            <span>
                              Coach: <strong className="text-white">{slot.coachName}</strong>
                            </span>
                          )}
                          {isCoachPool ? (
                            <span className="text-sky-400 font-semibold">
                              Private Client: {slot.privateClientName || "Private Trainee"} (Deducts
                              Coach Pool)
                            </span>
                          ) : slot.clientName ? (
                            <span>
                              Client: <strong className="text-white">{slot.clientName}</strong>
                            </span>
                          ) : (
                            <span>
                              Capacity: {(slot.attendeeIds || []).length} / {slot.maxCapacity}
                            </span>
                          )}
                          {slot.checkedInAt && (
                            <span className="text-emerald-400">
                              ✓ Checked in at {slot.checkedInAt}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {slot.status === "Booked" && !activeDateOffDay && (
                          <Btn
                            variant="primary"
                            size="sm"
                            onClick={() => handleCheckInBookedSlot(slot)}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" /> Check In & Deduct
                          </Btn>
                        )}
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await deleteBookingFromBranch(slot.branch, slot.id);
                              toast.success(`Removed schedule slot "${slot.title}"`);
                            } catch {
                              /* Error toast handled by transaction wrapper */
                            }
                          }}
                          className="p-1.5 rounded-lg text-vv-muted hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                          title="Delete Slot"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* =====================================================================
          SUB-TAB 2: CLIENTS DIRECTORY
      ===================================================================== */}
      {activeSubTab === "clients" && (
        <Card className="p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-wider">
                Gym Clients Directory ({directoryClients.length})
              </h3>
              <p className="text-xs text-vv-muted">
                Contact info, emergency contacts, fitness goals, active packages, remaining
                sessions/days, check-in history & follow-up notes
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-vv-muted absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  placeholder="Search clients, phone, goals..."
                  className="pl-8 pr-3 py-1.5 rounded-xl bg-black/30 border border-vv-border text-xs text-white focus:outline-none focus:border-amber-500"
                />
              </div>

              <Select
                value={clientStatusFilter}
                onChange={(e) => setClientStatusFilter(e.target.value)}
              >
                <option value="All">All Statuses</option>
                <option value="Active">Active</option>
                <option value="Expired">Expired</option>
                <option value="Paused">Paused</option>
                <option value="Coach-as-Client">Coach-as-Client Pools</option>
              </Select>

              <Btn variant="primary" size="sm" onClick={openNewClientModal}>
                <Plus className="w-3.5 h-3.5" /> + Enroll Client
              </Btn>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-vv-border text-[10px] font-black uppercase tracking-wider text-vv-muted">
                  <th className="py-3 px-3">Client & Contact</th>
                  <th className="py-3 px-3">Emergency Contact & Goals</th>
                  <th className="py-3 px-3">Package & Branch Access</th>
                  <th className="py-3 px-3">Remaining / Expiry</th>
                  <th className="py-3 px-3">Attendance & Check-Ins</th>
                  <th className="py-3 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-vv-border/50 text-xs">
                {directoryClients.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-vv-muted">
                      No gym clients match your filter. Click &ldquo;+ Enroll Client&rdquo; to add a
                      client profile.
                    </td>
                  </tr>
                ) : (
                  directoryClients.map((member) => {
                    const daysLeft = getDaysUntilExpiry(member.expiryDate);
                    const stats = getMemberAttendanceStats(member);
                    return (
                      <tr key={member.id} className="hover:bg-white/[0.02]">
                        <td className="py-3 px-3">
                          <div className="font-bold text-white flex items-center gap-1.5">
                            <span>{member.memberName}</span>
                            {member.memberType === "Coach-as-Client" && (
                              <Badge tone="blue">Coach Pool</Badge>
                            )}
                            {member.memberType === "Academy Player" && (
                              <Badge tone="amber">Academy</Badge>
                            )}
                          </div>
                          <div className="text-[11px] text-vv-muted">
                            {member.phone} {member.email ? `· ${member.email}` : ""}
                          </div>
                          {member.assignedCoachName && (
                            <div className="text-[10px] text-emerald-400 mt-0.5">
                              Coach: {member.assignedCoachName}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3 max-w-xs">
                          {member.emergencyContactName ? (
                            <div className="text-[11px] text-white">
                              ICE: {member.emergencyContactName} ({member.emergencyContactPhone})
                            </div>
                          ) : (
                            <div className="text-[11px] text-vv-muted">No emergency contact</div>
                          )}
                          {member.fitnessGoals && (
                            <div className="text-[11px] text-amber-300/90 truncate">
                              Goal: {member.fitnessGoals}
                            </div>
                          )}
                          {member.followUpNotes && (
                            <div className="text-[10px] text-sky-400 truncate">
                              Note: {member.followUpNotes}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-3">
                          <div className="font-bold text-white">{member.packageName}</div>
                          <div className="text-[11px] text-vv-muted">
                            {member.branch} · {member.branchAccess || "Single Branch"} ·{" "}
                            {money(db, member.monthlyFee)}
                          </div>
                        </td>

                        <td className="py-3 px-3">
                          <div className="flex items-center gap-1.5">
                            <Badge
                              tone={
                                member.status === "Active" && daysLeft >= 0
                                  ? daysLeft <= 7 ||
                                    (member.sessionsRemaining !== undefined &&
                                      member.sessionsRemaining <= 2)
                                    ? "amber"
                                    : "green"
                                  : "red"
                              }
                            >
                              {member.status}
                            </Badge>
                            {member.sessionsRemaining !== undefined ? (
                              <span className="font-bold text-white">
                                {member.sessionsRemaining} sessions left
                              </span>
                            ) : (
                              <span className="text-vv-muted">Unlimited</span>
                            )}
                          </div>
                          <div className="text-[11px] text-vv-muted mt-0.5">
                            Expires {member.expiryDate} (
                            {daysLeft >= 0 ? `${daysLeft}d left` : `${Math.abs(daysLeft)}d ago`})
                          </div>
                        </td>

                        <td className="py-3 px-3">
                          <div className="font-bold text-white">
                            {member.totalCheckIns} total check-ins
                          </div>
                          <div className="text-[11px] text-vv-muted">
                            {stats.last30Count} in 30d ({stats.weeklyAvg}/wk) · Last:{" "}
                            {member.lastCheckInDate || "Never"}
                          </div>
                        </td>

                        <td className="py-3 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Btn
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setSelectedCheckInMemberId(member.id);
                                setCheckInMode("client");
                                setActiveSubTab("schedule_checkin");
                              }}
                            >
                              Check In
                            </Btn>
                            <Btn
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setRenewMember(member);
                                setRenewPackageId(
                                  member.packageId ||
                                    branchPackages[0]?.id ||
                                    DEFAULT_GYM_PACKAGES[0].id,
                                );
                                setRenewPaidNow(true);
                              }}
                            >
                              Renew
                            </Btn>
                            <Btn
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                setSelectedProfileMemberId(member.id);
                                setActiveSubTab("tracking_followup");
                              }}
                            >
                              Progress
                            </Btn>
                            <button
                              type="button"
                              onClick={() => openEditClientModal(member)}
                              className="p-1.5 rounded-lg text-vv-muted hover:text-white hover:bg-white/10 cursor-pointer"
                              title="Edit Profile"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            {isSuperAdmin && (
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await deleteEntity("gymMembers", member.id);
                                    toast.success(`Removed ${member.memberName}`);
                                  } catch {
                                    /* Error toast handled by data-store */
                                  }
                                }}
                                className="p-1.5 rounded-lg text-vv-muted hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                                title="Delete Client"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* =====================================================================
          SUB-TAB 3: COACHES DIRECTORY & "COACH-AS-CLIENT" SYSTEM
      ===================================================================== */}
      {activeSubTab === "coaches" && (
        <div className="space-y-5">
          <Card className="p-5 bg-gradient-to-r from-sky-500/10 via-vv-card to-vv-card border-sky-500/30">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <UserCheck className="w-5 h-5 text-sky-400" />
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">
                    Gym Coaches & &ldquo;Coach-as-Client&rdquo; Session Pool System
                  </h3>
                  <Badge tone="blue">Dual Role Enabled</Badge>
                </div>
                <p className="text-xs text-vv-muted mt-1">
                  Coaches can purchase their own facility session packs and deduct credits from
                  their personal pool whenever they train their own private clients at the branch.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Btn
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setActiveSubTab("schedule_checkin");
                    setCheckInMode("coach_as_client");
                  }}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" /> Coach-as-Client Check-In
                </Btn>
                <Btn variant="primary" size="sm" onClick={openNewCoachModal}>
                  <Plus className="w-3.5 h-3.5" /> + Add Gym Coach
                </Btn>
              </div>
            </div>
          </Card>

          {filteredGymCoaches.length === 0 ? (
            <Card className="p-10 text-center space-y-3">
              <UserCheck className="w-10 h-10 text-vv-muted mx-auto opacity-50" />
              <div className="text-sm font-bold text-white">No Gym Coaches Registered Yet</div>
              <p className="text-xs text-vv-muted max-w-md mx-auto">
                Add your Strength & Conditioning coaches and enable their
                &ldquo;Coach-as-Client&rdquo; session pool so they can buy session packs and train
                private clients.
              </p>
              <Btn variant="primary" size="sm" onClick={openNewCoachModal}>
                <Plus className="w-3.5 h-3.5" /> + Create First Gym Coach
              </Btn>
            </Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredGymCoaches.map((coach) => (
                <Card
                  key={coach.id}
                  className="p-5 space-y-4 border-vv-border hover:border-sky-500/40 transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-base font-black text-white">{coach.name}</h4>
                        <Badge tone={coach.status === "Active" ? "green" : "gray"}>
                          {coach.status}
                        </Badge>
                        {coach.isClientEnabled && <Badge tone="blue">Coach-as-Client Pool</Badge>}
                      </div>
                      <div className="text-xs text-vv-muted mt-0.5">
                        {coach.specialty} · {coach.branch} ({coach.phone})
                      </div>
                      {coach.certifications && (
                        <div className="text-[11px] text-amber-400/90 mt-0.5">
                          Certifications: {coach.certifications}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEditCoachModal(coach)}
                        className="p-1.5 rounded-lg text-vv-muted hover:text-white hover:bg-white/10 cursor-pointer"
                        title="Edit Coach"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await deleteCoachFromBranch(coach.branch, coach.id);
                            toast.success(`Removed coach ${coach.name}`);
                          } catch {
                            /* Error toast handled by transaction wrapper */
                          }
                        }}
                        className="p-1.5 rounded-lg text-vv-muted hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                        title="Delete Coach"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Coach-as-Client Session Pool Card */}
                  <div className="p-3.5 rounded-xl bg-black/35 border border-sky-500/25 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-sky-400">
                        Coach-as-Client Session Pool
                      </span>
                      <span className="text-xs font-black text-white">
                        {coach.sessionsRemaining} / {coach.totalSessionsPurchased} Sessions Left
                      </span>
                    </div>

                    <div className="w-full h-2 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-sky-400 transition-all"
                        style={{
                          width: `${
                            coach.totalSessionsPurchased > 0
                              ? Math.min(
                                  100,
                                  Math.round(
                                    (coach.sessionsRemaining / coach.totalSessionsPurchased) * 100,
                                  ),
                                )
                              : 0
                          }%`,
                        }}
                      />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-vv-muted">
                      <span>
                        Package:{" "}
                        <strong className="text-white">
                          {coach.activePackageName || "No Active Pool"}
                        </strong>
                      </span>
                      <span>
                        Private Sessions Trained:{" "}
                        <strong className="text-emerald-400">
                          {coach.totalPrivateClientsTrained || 0}
                        </strong>
                      </span>
                    </div>

                    {/* Recent Coach-as-Client Deductions */}
                    {(coach.checkInHistory || []).length > 0 && (
                      <div className="pt-2 border-t border-vv-border/60 space-y-1">
                        <div className="text-[10px] font-bold uppercase text-vv-muted">
                          Recent Private Client Sessions Deducted
                        </div>
                        {(coach.checkInHistory || []).slice(0, 2).map((h) => (
                          <div
                            key={h.id}
                            className="text-[11px] text-vv-muted flex items-center justify-between"
                          >
                            <span>
                              {h.date} {h.time} · Trainee:{" "}
                              <strong className="text-white">
                                {h.privateClientName || "Private Client"}
                              </strong>
                            </span>
                            <span className="text-sky-400">{h.sessionsRemainingAfter} left</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Btn
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        setCoachTopUpTarget(coach);
                        setCoachTopUpPackageId("gym-pkg-coach-pool-15");
                        setCoachTopUpPaidNow(true);
                      }}
                    >
                      <Package className="w-3.5 h-3.5" /> Buy / Top-Up Session Pack
                    </Btn>
                    <Btn
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setSelectedCheckInCoachId(coach.id);
                        setCheckInMode("coach_as_client");
                        setActiveSubTab("schedule_checkin");
                      }}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Use Session (Train
                      Private Client)
                    </Btn>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          SUB-TAB 4: PACKAGES & MEMBERSHIPS
      ===================================================================== */}
      {activeSubTab === "packages" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-black text-white uppercase tracking-wider">
                Flexible Gym Packages & Memberships ({branchPackages.length})
              </h3>
              <p className="text-xs text-vv-muted">
                Configure Monthly/Quarterly/Annual memberships, 10/20-Session PT packs, and
                Coach-as-Client facility pools with pricing, duration, and branch access rules
              </p>
            </div>
            <Btn variant="primary" size="sm" onClick={openNewPackageModal}>
              <Plus className="w-3.5 h-3.5" /> + Create Package
            </Btn>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {branchPackages.map((pkg) => (
              <Card
                key={pkg.id}
                className={`p-5 space-y-3 border ${
                  pkg.forCoachClientPool ? "border-sky-500/40 bg-sky-500/5" : "border-vv-border"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge
                        tone={
                          pkg.forCoachClientPool
                            ? "blue"
                            : pkg.billingModel === "Session-Based"
                              ? "amber"
                              : "green"
                        }
                      >
                        {pkg.category}
                      </Badge>
                      <Badge tone="gray">{pkg.branchAccess}</Badge>
                      {!pkg.active && <Badge tone="red">Inactive</Badge>}
                    </div>
                    <h4 className="text-base font-black text-white mt-2">{pkg.name}</h4>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-black text-amber-400">{money(db, pkg.price)}</div>
                    <div className="text-[10px] text-vv-muted">{pkg.durationDays} days valid</div>
                  </div>
                </div>

                {pkg.description && (
                  <p className="text-xs text-vv-muted leading-relaxed">{pkg.description}</p>
                )}

                <div className="pt-2 border-t border-vv-border/60 flex items-center justify-between text-xs">
                  <span className="text-vv-muted">
                    Model:{" "}
                    <strong className="text-white">
                      {pkg.billingModel === "Session-Based"
                        ? `${pkg.sessionsIncluded || 10} Sessions`
                        : "Unlimited Access"}
                    </strong>
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => openEditPackageModal(pkg)}
                      className="p-1.5 rounded-lg text-vv-muted hover:text-white hover:bg-white/10 cursor-pointer"
                      title="Edit Package"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await savePackagesToBranch(
                            branchPackages.filter((item) => item.id !== pkg.id),
                          );
                          toast.success(`Removed package "${pkg.name}"`);
                        } catch {
                          /* Error toast handled by transaction wrapper */
                        }
                      }}
                      className="p-1.5 rounded-lg text-vv-muted hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
                      title="Delete Package"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* =====================================================================
          SUB-TAB 5: PROGRESS TRACKING & EXPIRING / LOW-SESSION FOLLOW-UP
      ===================================================================== */}
      {activeSubTab === "tracking_followup" && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* LEFT 5 COLS: EXPIRING MEMBERSHIP & LOW-SESSION FOLLOW-UP QUEUE */}
          <Card className="xl:col-span-5 p-5 space-y-4 border-rose-500/30">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-400" />
                  Expiring & Low-Session Follow-Up List
                </h3>
                <p className="text-[11px] text-vv-muted">
                  Members expiring within ≤7 days, expired, or with ≤2 sessions left
                </p>
              </div>
              <Badge tone="red">{followUpMembers.length + followUpCoaches.length}</Badge>
            </div>

            {followUpMembers.length === 0 && followUpCoaches.length === 0 ? (
              <div className="py-10 text-center text-xs text-vv-muted border border-dashed border-vv-border rounded-xl">
                All clients and Coach-as-Client session pools have healthy balances and validity!
              </div>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                {followUpMembers.map((m) => {
                  const daysLeft = getDaysUntilExpiry(m.expiryDate);
                  return (
                    <div
                      key={m.id}
                      className="p-3.5 rounded-xl bg-black/35 border border-vv-border space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-black text-white">{m.memberName}</div>
                          <div className="text-[11px] text-vv-muted">
                            {m.phone} · {m.packageName}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          {m.sessionsRemaining !== undefined && m.sessionsRemaining <= 2 && (
                            <Badge tone="red">{m.sessionsRemaining} Sessions Left</Badge>
                          )}
                          {daysLeft <= 7 && (
                            <Badge tone={daysLeft < 0 ? "red" : "amber"}>
                              {daysLeft < 0
                                ? `Expired ${Math.abs(daysLeft)}d ago`
                                : `Expires in ${daysLeft}d`}
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Select
                          value={m.followUpStatus || "None"}
                          onChange={(e) =>
                            handleUpdateFollowUp(m, e.target.value as GymMember["followUpStatus"])
                          }
                        >
                          <option value="None">Follow-Up: None</option>
                          <option value="Pending Follow-Up">Pending Follow-Up</option>
                          <option value="Contacted">Contacted Client</option>
                          <option value="Renewal Offered">Renewal Offered</option>
                          <option value="Renewed">Renewed</option>
                        </Select>

                        <Btn
                          variant="primary"
                          size="sm"
                          onClick={() => {
                            setRenewMember(m);
                            setRenewPackageId(
                              m.packageId || branchPackages[0]?.id || DEFAULT_GYM_PACKAGES[0].id,
                            );
                            setRenewPaidNow(true);
                          }}
                        >
                          Quick Renew
                        </Btn>
                      </div>

                      <input
                        type="text"
                        defaultValue={m.followUpNotes || ""}
                        onBlur={(e) =>
                          handleUpdateFollowUp(m, m.followUpStatus || "Contacted", e.target.value)
                        }
                        placeholder="Add follow-up note (saves on blur)..."
                        className="w-full px-2.5 py-1.5 rounded-lg bg-black/30 border border-vv-border text-xs text-white"
                      />
                    </div>
                  );
                })}

                {followUpCoaches.map((c) => (
                  <div
                    key={c.id}
                    className="p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="text-xs font-black text-white">
                        {c.name} (Coach-as-Client Pool)
                      </div>
                      <div className="text-[11px] text-sky-300">
                        Only {c.sessionsRemaining} sessions left · Expires{" "}
                        {c.packageExpiryDate || "—"}
                      </div>
                    </div>
                    <Btn
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        setCoachTopUpTarget(c);
                        setCoachTopUpPackageId("gym-pkg-coach-pool-15");
                        setCoachTopUpPaidNow(true);
                      }}
                    >
                      Top Up Pool
                    </Btn>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* RIGHT 7 COLS: CLIENT PROGRESS, BODY METRICS, BENCHMARKS & WORKOUT LOGS */}
          <Card className="xl:col-span-7 p-5 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-emerald-400" />
                  Client Progress, Benchmarks & Workout Logs
                </h3>
                <p className="text-[11px] text-vv-muted">
                  Body composition, 1RM strength benchmarks, S&C workout logs & attendance frequency
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Select
                  value={activeProfileMember?.id || ""}
                  onChange={(e) => setSelectedProfileMemberId(e.target.value)}
                >
                  {filteredGymMembers.length === 0 && (
                    <option value="">No clients available</option>
                  )}
                  {filteredGymMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.memberName} ({m.packageName})
                    </option>
                  ))}
                </Select>
              </div>
            </div>

            {!activeProfileMember ? (
              <div className="py-12 text-center text-xs text-vv-muted">
                Enroll a client to start tracking body metrics, strength benchmarks, and workouts.
              </div>
            ) : (
              <div className="space-y-5">
                {/* Client Snapshot & Attendance Frequency Bar */}
                {(() => {
                  const stats = getMemberAttendanceStats(activeProfileMember);
                  const latestMetric = (activeProfileMember.progressMetrics || [])[0];
                  return (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 p-3.5 rounded-xl bg-black/30 border border-vv-border">
                        <div>
                          <div className="text-base font-black text-white">
                            {activeProfileMember.memberName}
                          </div>
                          <div className="text-xs text-vv-muted">
                            Goal:{" "}
                            <strong className="text-amber-400">
                              {activeProfileMember.fitnessGoals ||
                                "General Strength & Conditioning"}
                            </strong>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Btn
                            variant="secondary"
                            size="sm"
                            onClick={() => setMetricModalOpen(true)}
                          >
                            <Activity className="w-3.5 h-3.5 text-sky-400" /> + Log Body / 1RM
                            Benchmark
                          </Btn>
                          <Btn
                            variant="primary"
                            size="sm"
                            onClick={() => setWorkoutModalOpen(true)}
                          >
                            <Dumbbell className="w-3.5 h-3.5" /> + Log Workout
                          </Btn>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        <div className="p-3 rounded-xl bg-black/25 border border-vv-border">
                          <div className="text-[10px] uppercase text-vv-muted">
                            Attendance Frequency
                          </div>
                          <div className="text-base font-black text-emerald-400 mt-0.5">
                            {stats.weeklyAvg}x / week
                          </div>
                          <div className="text-[10px] text-vv-muted">
                            {stats.last30Count} visits in 30d ({activeProfileMember.totalCheckIns}{" "}
                            total)
                          </div>
                        </div>

                        <div className="p-3 rounded-xl bg-black/25 border border-vv-border">
                          <div className="text-[10px] uppercase text-vv-muted">
                            Weight / Body Fat
                          </div>
                          <div className="text-base font-black text-white mt-0.5">
                            {latestMetric?.weightKg ? `${latestMetric.weightKg} kg` : "—"}
                            {latestMetric?.bodyFatPct ? ` · ${latestMetric.bodyFatPct}%` : ""}
                          </div>
                          <div className="text-[10px] text-vv-muted">
                            Muscle:{" "}
                            {latestMetric?.muscleMassKg ? `${latestMetric.muscleMassKg} kg` : "—"}
                          </div>
                        </div>

                        <div className="p-3 rounded-xl bg-black/25 border border-vv-border">
                          <div className="text-[10px] uppercase text-vv-muted">
                            Bench / Squat 1RM
                          </div>
                          <div className="text-base font-black text-amber-400 mt-0.5">
                            {latestMetric?.benchPress1RM ? `${latestMetric.benchPress1RM}kg` : "—"}{" "}
                            / {latestMetric?.backSquat1RM ? `${latestMetric.backSquat1RM}kg` : "—"}
                          </div>
                          <div className="text-[10px] text-vv-muted">Max Strength Benchmarks</div>
                        </div>

                        <div className="p-3 rounded-xl bg-black/25 border border-vv-border">
                          <div className="text-[10px] uppercase text-vv-muted">
                            Deadlift / Vert Jump
                          </div>
                          <div className="text-base font-black text-sky-400 mt-0.5">
                            {latestMetric?.deadlift1RM ? `${latestMetric.deadlift1RM}kg` : "—"} /{" "}
                            {latestMetric?.verticalJumpCm
                              ? `${latestMetric.verticalJumpCm}cm`
                              : "—"}
                          </div>
                          <div className="text-[10px] text-vv-muted">Power & Explosiveness</div>
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Body Metrics & Strength Benchmark History */}
                {(activeProfileMember.progressMetrics || []).length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-black uppercase tracking-wider text-vv-muted">
                      Body Metrics & 1RM Benchmark History
                    </div>
                    <div className="space-y-1.5">
                      {(activeProfileMember.progressMetrics || []).map((pm) => (
                        <div
                          key={pm.id}
                          className="p-2.5 rounded-xl bg-black/25 border border-vv-border flex flex-wrap items-center justify-between gap-2 text-xs"
                        >
                          <span className="font-mono text-amber-400 font-bold">{pm.date}</span>
                          <span>
                            Wt: <strong>{pm.weightKg ?? "—"}kg</strong> · BF:{" "}
                            <strong>{pm.bodyFatPct ?? "—"}%</strong>
                          </span>
                          <span>
                            Bench: <strong>{pm.benchPress1RM ?? "—"}kg</strong> · Squat:{" "}
                            <strong>{pm.backSquat1RM ?? "—"}kg</strong> · DL:{" "}
                            <strong>{pm.deadlift1RM ?? "—"}kg</strong>
                          </span>
                          {pm.notes && <span className="text-vv-muted italic">{pm.notes}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Workout Logs Timeline */}
                <div className="space-y-2">
                  <div className="text-xs font-black uppercase tracking-wider text-vv-muted">
                    S&C Workout Logs ({(activeProfileMember.workoutLogs || []).length})
                  </div>
                  {(activeProfileMember.workoutLogs || []).length === 0 ? (
                    <div className="p-4 rounded-xl bg-black/20 border border-dashed border-vv-border text-xs text-vv-muted text-center">
                      No workouts logged yet for {activeProfileMember.memberName}.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {(activeProfileMember.workoutLogs || []).map((wk) => (
                        <div
                          key={wk.id}
                          className="p-3 rounded-xl bg-black/30 border border-vv-border space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-xs text-amber-400 font-bold">
                                {wk.date}
                              </span>
                              <Badge tone="amber">{wk.focusArea}</Badge>
                              {wk.personalRecord && (
                                <Badge tone="green">PR: {wk.personalRecord}</Badge>
                              )}
                            </div>
                            <span className="text-[11px] text-vv-muted">
                              RPE {wk.rpe}/10 · {wk.coachName}
                            </span>
                          </div>
                          <div className="text-xs font-bold text-white">{wk.exercisesSummary}</div>
                          <div className="text-[11px] text-vv-muted">{wk.setsRepsLoad}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Check-In History Audit Log */}
                <div className="space-y-2">
                  <div className="text-xs font-black uppercase tracking-wider text-vv-muted">
                    Timestamped Check-In History (
                    {(activeProfileMember.checkInHistory || []).length})
                  </div>
                  {(activeProfileMember.checkInHistory || []).length === 0 ? (
                    <div className="p-4 rounded-xl bg-black/20 border border-dashed border-vv-border text-xs text-vv-muted text-center">
                      No check-ins recorded yet.
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {(activeProfileMember.checkInHistory || []).map((chk) => (
                        <div
                          key={chk.id}
                          className="px-3 py-2 rounded-lg bg-black/25 border border-vv-border/60 flex items-center justify-between text-xs"
                        >
                          <div>
                            <span className="font-mono text-emerald-400 font-bold">
                              {chk.date} {chk.time}
                            </span>{" "}
                            · <span className="text-white">{chk.note || "Gym Check-In"}</span>
                          </div>
                          {chk.deductionType && <Badge tone="gray">{chk.deductionType}</Badge>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* =====================================================================
          MODAL 1: ENROLL / EDIT GYM CLIENT PROFILE
      ===================================================================== */}
      <Modal
        open={clientModalOpen}
        onClose={() => setClientModalOpen(false)}
        title={editingClientId ? "Edit Gym Client Profile" : "Enroll Gym Client"}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Client Type">
              <Select
                value={clientForm.memberType}
                onChange={(e) =>
                  setClientForm((f) => ({
                    ...f,
                    memberType: e.target.value as GymMember["memberType"],
                  }))
                }
              >
                <option value="External Member">External Gym Client</option>
                <option value="Academy Player">Academy Player</option>
              </Select>
            </Field>

            {clientForm.memberType === "Academy Player" && (
              <Field label="Link Academy Player">
                <Select
                  value={clientForm.linkedPlayerId}
                  onChange={(e) => {
                    const pid = e.target.value;
                    const p = db.players.find((pl) => pl.id === pid);
                    setClientForm((f) => ({
                      ...f,
                      linkedPlayerId: pid,
                      memberName: p ? p.name : f.memberName,
                      phone: p?.phone || p?.parentPhone || f.phone,
                      branch: p?.branch || f.branch,
                      emergencyContactName: p?.parentName || f.emergencyContactName,
                      emergencyContactPhone: p?.parentPhone || f.emergencyContactPhone,
                    }));
                  }}
                >
                  <option value="">Select Player...</option>
                  {db.players.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.team})
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            <Field label="Full Name">
              <Input
                value={clientForm.memberName}
                onChange={(e) => setClientForm((f) => ({ ...f, memberName: e.target.value }))}
                placeholder="e.g., Karim Mansour"
              />
            </Field>

            <Field label="Phone Number">
              <Input
                value={clientForm.phone}
                onChange={(e) => setClientForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="+961 70 123 456"
              />
            </Field>

            <Field label="Email (Optional)">
              <Input
                value={clientForm.email}
                onChange={(e) => setClientForm((f) => ({ ...f, email: e.target.value }))}
                placeholder="client@example.com"
              />
            </Field>

            <Field label="Branch">
              <Select
                value={clientForm.branch}
                onChange={(e) => setClientForm((f) => ({ ...f, branch: e.target.value }))}
              >
                {db.branches.map((b) => (
                  <option key={b.id} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {/* Emergency Contact Section */}
          <div className="p-3.5 rounded-xl bg-black/25 border border-vv-border space-y-3">
            <div className="text-[11px] font-black uppercase tracking-wider text-amber-400">
              Emergency Contact & Medical / Fitness Goals
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Emergency Contact Name">
                <Input
                  value={clientForm.emergencyContactName}
                  onChange={(e) =>
                    setClientForm((f) => ({ ...f, emergencyContactName: e.target.value }))
                  }
                  placeholder="Contact Name"
                />
              </Field>
              <Field label="Emergency Phone">
                <Input
                  value={clientForm.emergencyContactPhone}
                  onChange={(e) =>
                    setClientForm((f) => ({ ...f, emergencyContactPhone: e.target.value }))
                  }
                  placeholder="+961 ..."
                />
              </Field>
              <Field label="Relation">
                <Input
                  value={clientForm.emergencyContactRelation}
                  onChange={(e) =>
                    setClientForm((f) => ({ ...f, emergencyContactRelation: e.target.value }))
                  }
                  placeholder="Parent / Spouse"
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Primary Fitness Goals">
                <Input
                  value={clientForm.fitnessGoals}
                  onChange={(e) => setClientForm((f) => ({ ...f, fitnessGoals: e.target.value }))}
                  placeholder="e.g., Lower body explosion, +5kg lean mass"
                />
              </Field>
              <Field label="Assigned Gym Coach">
                <Select
                  value={clientForm.assignedCoachId}
                  onChange={(e) =>
                    setClientForm((f) => ({ ...f, assignedCoachId: e.target.value }))
                  }
                >
                  <option value="">Unassigned / Open Floor</option>
                  {allGymCoaches.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.specialty})
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </div>

          {/* Package Assignment */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Membership / Session Package">
              <Select
                value={clientForm.packageId}
                onChange={(e) => setClientForm((f) => ({ ...f, packageId: e.target.value }))}
              >
                {branchPackages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {money(db, p.price)} ({p.durationDays}d · {p.branchAccess})
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Start Date">
              <Input
                type="date"
                value={clientForm.startDate}
                onChange={(e) => setClientForm((f) => ({ ...f, startDate: e.target.value }))}
              />
            </Field>
          </div>

          <Field label="Follow-Up Notes">
            <Input
              value={clientForm.followUpNotes}
              onChange={(e) => setClientForm((f) => ({ ...f, followUpNotes: e.target.value }))}
              placeholder="Notes on preferences, renewal reminders, or schedule..."
            />
          </Field>

          {!editingClientId && (
            <label className="flex items-center gap-2 text-xs text-white cursor-pointer">
              <input
                type="checkbox"
                checked={clientForm.paidNow}
                onChange={(e) => setClientForm((f) => ({ ...f, paidNow: e.target.checked }))}
              />
              Collect payment now & post to Financial Ledger
            </label>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-vv-border">
            <Btn variant="secondary" onClick={() => setClientModalOpen(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" onClick={handleSaveClient}>
              {editingClientId ? "Save Changes" : "Enroll Client"}
            </Btn>
          </div>
        </div>
      </Modal>

      {/* =====================================================================
          MODAL 2: RENEW / ASSIGN PACKAGE TO CLIENT
      ===================================================================== */}
      <Modal
        open={Boolean(renewMember)}
        onClose={() => setRenewMember(null)}
        title={`Renew / Assign Package — ${renewMember?.memberName || ""}`}
      >
        {renewMember && (
          <div className="space-y-4">
            <Field label="Select New Package">
              <Select value={renewPackageId} onChange={(e) => setRenewPackageId(e.target.value)}>
                {branchPackages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {money(db, p.price)} ({p.durationDays} days ·{" "}
                    {p.billingModel === "Session-Based"
                      ? `${p.sessionsIncluded} sessions`
                      : "Unlimited"}
                    )
                  </option>
                ))}
              </Select>
            </Field>

            <label className="flex items-center gap-2 text-xs text-white cursor-pointer">
              <input
                type="checkbox"
                checked={renewPaidNow}
                onChange={(e) => setRenewPaidNow(e.target.checked)}
              />
              Payment received now (posts to Financial Ledger)
            </label>

            <div className="flex justify-end gap-2 pt-3 border-t border-vv-border">
              <Btn variant="secondary" onClick={() => setRenewMember(null)}>
                Cancel
              </Btn>
              <Btn variant="primary" onClick={handleConfirmRenewClient}>
                Confirm Renewal
              </Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* =====================================================================
          MODAL 3: CREATE / EDIT GYM COACH & COACH-AS-CLIENT SETUP
      ===================================================================== */}
      <Modal
        open={coachModalOpen}
        onClose={() => setCoachModalOpen(false)}
        title={editingCoachId ? "Edit Gym Coach" : "Add Gym Coach & Coach-as-Client Pool"}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Import Existing Academy Coach (Optional)">
              <Select
                value=""
                onChange={(e) => {
                  const found = db.coaches.find((c) => c.id === e.target.value);
                  if (found) {
                    setCoachForm((f) => ({
                      ...f,
                      name: found.name,
                      phone: found.phone || f.phone,
                      branch: found.branch || f.branch,
                    }));
                  }
                }}
              >
                <option value="">Or type custom coach name below...</option>
                {db.coaches.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.role})
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Coach Full Name">
              <Input
                value={coachForm.name}
                onChange={(e) => setCoachForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g., Coach Tarek Mansour"
              />
            </Field>

            <Field label="Phone">
              <Input
                value={coachForm.phone}
                onChange={(e) => setCoachForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="+961 71 000 111"
              />
            </Field>

            <Field label="Branch">
              <Select
                value={coachForm.branch}
                onChange={(e) => setCoachForm((f) => ({ ...f, branch: e.target.value }))}
              >
                {db.branches.map((b) => (
                  <option key={b.id} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Specialty">
              <Input
                value={coachForm.specialty}
                onChange={(e) => setCoachForm((f) => ({ ...f, specialty: e.target.value }))}
                placeholder="Strength & Conditioning / Hypertrophy"
              />
            </Field>

            <Field label="Certifications">
              <Input
                value={coachForm.certifications}
                onChange={(e) => setCoachForm((f) => ({ ...f, certifications: e.target.value }))}
                placeholder="CSCS, NASM-CPT"
              />
            </Field>
          </div>

          {/* Coach-as-Client System Configuration */}
          <div className="p-4 rounded-xl bg-sky-500/10 border border-sky-500/30 space-y-3">
            <label className="flex items-center gap-2 text-xs font-bold text-white cursor-pointer">
              <input
                type="checkbox"
                checked={coachForm.isClientEnabled}
                onChange={(e) => setCoachForm((f) => ({ ...f, isClientEnabled: e.target.checked }))}
              />
              Enable &ldquo;Coach-as-Client&rdquo; Mode (Coach can purchase session packs & deduct
              sessions when training private clients)
            </label>

            {coachForm.isClientEnabled && !editingCoachId && (
              <Field label="Initial Coach-as-Client Session Pack">
                <Select
                  value={coachForm.initialPackageId}
                  onChange={(e) =>
                    setCoachForm((f) => ({ ...f, initialPackageId: e.target.value }))
                  }
                >
                  {branchPackages
                    .filter((p) => p.billingModel === "Session-Based")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {p.sessionsIncluded} sessions ({money(db, p.price)})
                      </option>
                    ))}
                </Select>
              </Field>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-vv-border">
            <Btn variant="secondary" onClick={() => setCoachModalOpen(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" onClick={handleSaveCoach}>
              {editingCoachId ? "Update Coach" : "Save Coach"}
            </Btn>
          </div>
        </div>
      </Modal>

      {/* =====================================================================
          MODAL 4: COACH-AS-CLIENT SESSION POOL TOP-UP
      ===================================================================== */}
      <Modal
        open={Boolean(coachTopUpTarget)}
        onClose={() => setCoachTopUpTarget(null)}
        title={`Purchase Coach-as-Client Session Pack — ${coachTopUpTarget?.name || ""}`}
      >
        {coachTopUpTarget && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/30 text-xs text-sky-200">
              Current Pool Balance: <strong>{coachTopUpTarget.sessionsRemaining} sessions</strong>.
              Purchasing a pack adds sessions to {coachTopUpTarget.name}&apos;s pool so they can
              deduct sessions whenever training their private clients at the facility.
            </div>

            <Field label="Select Session Pack">
              <Select
                value={coachTopUpPackageId}
                onChange={(e) => setCoachTopUpPackageId(e.target.value)}
              >
                {branchPackages
                  .filter((p) => p.billingModel === "Session-Based")
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — +{p.sessionsIncluded} Sessions ({money(db, p.price)})
                    </option>
                  ))}
              </Select>
            </Field>

            <label className="flex items-center gap-2 text-xs text-white cursor-pointer">
              <input
                type="checkbox"
                checked={coachTopUpPaidNow}
                onChange={(e) => setCoachTopUpPaidNow(e.target.checked)}
              />
              Record payment in Financial Ledger now
            </label>

            <div className="flex justify-end gap-2 pt-3 border-t border-vv-border">
              <Btn variant="secondary" onClick={() => setCoachTopUpTarget(null)}>
                Cancel
              </Btn>
              <Btn variant="primary" onClick={handleConfirmCoachTopUp}>
                Credit Coach Session Pool
              </Btn>
            </div>
          </div>
        )}
      </Modal>

      {/* =====================================================================
          MODAL 5: CREATE / EDIT GYM PACKAGE
      ===================================================================== */}
      <Modal
        open={packageModalOpen}
        onClose={() => setPackageModalOpen(false)}
        title={editingPackageId ? "Edit Gym Package" : "Create Gym Package / Membership"}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Package Name">
              <Input
                value={packageForm.name}
                onChange={(e) => setPackageForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g., 10-Session Pro PT Pack"
              />
            </Field>

            <Field label="Category">
              <Select
                value={packageForm.category}
                onChange={(e) => {
                  const cat = e.target.value as GymPackageCategory;
                  const isSession =
                    cat === "Session Pack" || cat === "Coach PT Pack" || cat === "Day Pass";
                  setPackageForm((f) => ({
                    ...f,
                    category: cat,
                    billingModel: isSession ? "Session-Based" : "Unlimited Duration",
                    forCoachClientPool: cat === "Coach PT Pack",
                  }));
                }}
              >
                <option value="Monthly">Monthly Membership</option>
                <option value="Quarterly">Quarterly Membership</option>
                <option value="Annual">Annual Membership</option>
                <option value="Session Pack">Session Pack (10 / 20 PT)</option>
                <option value="Coach PT Pack">Coach-as-Client Facility Pool</option>
                <option value="Day Pass">Walk-In Day Pass</option>
              </Select>
            </Field>

            <Field label="Billing / Access Model">
              <Select
                value={packageForm.billingModel}
                onChange={(e) =>
                  setPackageForm((f) => ({
                    ...f,
                    billingModel: e.target.value as "Unlimited Duration" | "Session-Based",
                  }))
                }
              >
                <option value="Unlimited Duration">Unlimited Duration</option>
                <option value="Session-Based">Session-Based Deduction</option>
              </Select>
            </Field>

            <Field label="Price">
              <Input
                type="number"
                value={packageForm.price}
                onChange={(e) => setPackageForm((f) => ({ ...f, price: Number(e.target.value) }))}
              />
            </Field>

            <Field label="Validity Duration (Days)">
              <Input
                type="number"
                value={packageForm.durationDays}
                onChange={(e) =>
                  setPackageForm((f) => ({ ...f, durationDays: Number(e.target.value) }))
                }
              />
            </Field>

            {packageForm.billingModel === "Session-Based" && (
              <Field label="Included Sessions">
                <Input
                  type="number"
                  value={packageForm.sessionsIncluded}
                  onChange={(e) =>
                    setPackageForm((f) => ({
                      ...f,
                      sessionsIncluded: Number(e.target.value),
                    }))
                  }
                />
              </Field>
            )}

            <Field label="Branch Access Rule">
              <Select
                value={packageForm.branchAccess}
                onChange={(e) =>
                  setPackageForm((f) => ({
                    ...f,
                    branchAccess: e.target.value as "Single Branch" | "All Branches",
                  }))
                }
              >
                <option value="Single Branch">Single Branch Only</option>
                <option value="All Branches">All Nexus Branches</option>
              </Select>
            </Field>
          </div>

          <Field label="Description">
            <Input
              value={packageForm.description}
              onChange={(e) => setPackageForm((f) => ({ ...f, description: e.target.value }))}
              placeholder="Package entitlements & rules..."
            />
          </Field>

          <div className="flex justify-end gap-2 pt-3 border-t border-vv-border">
            <Btn variant="secondary" onClick={() => setPackageModalOpen(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" onClick={handleSavePackage}>
              Save Package
            </Btn>
          </div>
        </div>
      </Modal>

      {/* =====================================================================
          MODAL 6: BOOK GYM SCHEDULE SLOT
      ===================================================================== */}
      <Modal
        open={slotModalOpen}
        onClose={() => setSlotModalOpen(false)}
        title="Book Gym Floor, PT or Group Strength Slot"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Slot Type">
              <Select
                value={slotForm.slotType}
                onChange={(e) => {
                  const st = e.target.value as GymScheduleSlotType;
                  setSlotForm((f) => ({
                    ...f,
                    slotType: st,
                    deductionMode:
                      st === "Coach-as-Client Private PT" ? "Coach Session Pool" : "Client Package",
                    maxCapacity: st === "Group Strength Class" ? 12 : 1,
                  }));
                }}
              >
                <option value="Personal Training (PT)">Personal Training (PT)</option>
                <option value="Coach-as-Client Private PT">
                  Coach-as-Client Private PT (Deducts Coach Pool)
                </option>
                <option value="Group Strength Class">Group Strength Class</option>
                <option value="Gym Floor Slot">Gym Floor Slot</option>
              </Select>
            </Field>

            <Field label="Session Title">
              <Input
                value={slotForm.title}
                onChange={(e) => setSlotForm((f) => ({ ...f, title: e.target.value }))}
              />
            </Field>

            <Field label="Date">
              <Input
                type="date"
                value={slotForm.date}
                min={allowPastDates ? undefined : todayStr}
                onChange={(e) => setSlotForm((f) => ({ ...f, date: e.target.value }))}
              />
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Start Time">
                <Input
                  type="time"
                  value={slotForm.startTime}
                  onChange={(e) => setSlotForm((f) => ({ ...f, startTime: e.target.value }))}
                />
              </Field>
              <Field label="End Time">
                <Input
                  type="time"
                  value={slotForm.endTime}
                  onChange={(e) => setSlotForm((f) => ({ ...f, endTime: e.target.value }))}
                />
              </Field>
            </div>

            <Field label="Coach">
              <Select
                value={slotForm.coachId}
                onChange={(e) => setSlotForm((f) => ({ ...f, coachId: e.target.value }))}
              >
                <option value="">No Coach / Open Floor</option>
                {filteredGymCoaches.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.sessionsRemaining} pool sessions)
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Session Deduction Source">
              <Select
                value={slotForm.deductionMode}
                onChange={(e) =>
                  setSlotForm((f) => ({
                    ...f,
                    deductionMode: e.target.value as "Client Package" | "Coach Session Pool",
                  }))
                }
              >
                <option value="Client Package">Client Membership / Session Pack</option>
                <option value="Coach Session Pool">Coach-as-Client Purchased Session Pool</option>
              </Select>
            </Field>

            {slotForm.deductionMode === "Client Package" ? (
              <Field label="Client">
                <Select
                  value={slotForm.clientMemberId}
                  onChange={(e) => setSlotForm((f) => ({ ...f, clientMemberId: e.target.value }))}
                >
                  <option value="">Open / Group Slot</option>
                  {filteredGymMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.memberName} ({m.packageName})
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <Field label="Coach's Private Client Name">
                <Input
                  value={slotForm.privateClientName}
                  onChange={(e) =>
                    setSlotForm((f) => ({ ...f, privateClientName: e.target.value }))
                  }
                  placeholder="Name of private trainee"
                />
              </Field>
            )}

            <Field label="Max Capacity">
              <Input
                type="number"
                value={slotForm.maxCapacity}
                onChange={(e) =>
                  setSlotForm((f) => ({ ...f, maxCapacity: Number(e.target.value) }))
                }
              />
            </Field>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-vv-border">
            <Btn variant="secondary" onClick={() => setSlotModalOpen(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" onClick={handleSaveScheduleSlot}>
              Book Gym Slot
            </Btn>
          </div>
        </div>
      </Modal>

      {/* =====================================================================
          MODAL 7: SHARED BRANCH OFF DAYS (SYNCED WITH COURT RESERVATIONS)
      ===================================================================== */}
      <Modal
        open={offDaysModalOpen}
        onClose={() => setOffDaysModalOpen(false)}
        title={`Shared Branch Off Days — ${activeBranchName}`}
      >
        <div className="space-y-4">
          <p className="text-xs text-vv-muted">
            Off Days added here automatically block both the{" "}
            <strong className="text-white">Gym & Strength Schedule</strong> and the{" "}
            <strong className="text-white">Court Reservation Schedule</strong> for{" "}
            {activeBranchName}.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <Input
              type="date"
              value={newOffDayDate}
              onChange={(e) => setNewOffDayDate(e.target.value)}
            />
            <Input
              value={newOffDayReason}
              onChange={(e) => setNewOffDayReason(e.target.value)}
              placeholder="Holiday / Maintenance reason..."
            />
            <Btn variant="primary" onClick={handleAddOffDay}>
              + Add Off Day
            </Btn>
          </div>

          <div className="space-y-2 max-h-60 overflow-y-auto">
            {branchOffDays.length === 0 ? (
              <div className="py-6 text-center text-xs text-vv-muted">
                No Off Days configured for {activeBranchName}.
              </div>
            ) : (
              branchOffDays.map((od) => (
                <div
                  key={od.id}
                  className="p-2.5 rounded-xl bg-black/30 border border-vv-border flex items-center justify-between text-xs"
                >
                  <div>
                    <span className="font-mono font-bold text-rose-400">{od.date}</span> ·{" "}
                    <span className="text-white font-semibold">{od.reason}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRemoveOffDay(od.id)}
                    className="p-1 text-vv-muted hover:text-rose-400 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </Modal>

      {/* =====================================================================
          MODAL 8: LOG BODY METRICS & STRENGTH BENCHMARKS
      ===================================================================== */}
      <Modal
        open={metricModalOpen}
        onClose={() => setMetricModalOpen(false)}
        title={`Log Body Metrics & Strength Benchmarks — ${activeProfileMember?.memberName || ""}`}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Field label="Date">
              <Input
                type="date"
                value={metricForm.date}
                onChange={(e) => setMetricForm((f) => ({ ...f, date: e.target.value }))}
              />
            </Field>
            <Field label="Body Weight (kg)">
              <Input
                type="number"
                value={metricForm.weightKg}
                onChange={(e) => setMetricForm((f) => ({ ...f, weightKg: e.target.value }))}
                placeholder="78.5"
              />
            </Field>
            <Field label="Body Fat (%)">
              <Input
                type="number"
                value={metricForm.bodyFatPct}
                onChange={(e) => setMetricForm((f) => ({ ...f, bodyFatPct: e.target.value }))}
                placeholder="12.4"
              />
            </Field>
            <Field label="Muscle Mass (kg)">
              <Input
                type="number"
                value={metricForm.muscleMassKg}
                onChange={(e) => setMetricForm((f) => ({ ...f, muscleMassKg: e.target.value }))}
                placeholder="38.2"
              />
            </Field>
            <Field label="Bench Press 1RM (kg)">
              <Input
                type="number"
                value={metricForm.benchPress1RM}
                onChange={(e) => setMetricForm((f) => ({ ...f, benchPress1RM: e.target.value }))}
                placeholder="105"
              />
            </Field>
            <Field label="Back Squat 1RM (kg)">
              <Input
                type="number"
                value={metricForm.backSquat1RM}
                onChange={(e) => setMetricForm((f) => ({ ...f, backSquat1RM: e.target.value }))}
                placeholder="140"
              />
            </Field>
            <Field label="Deadlift 1RM (kg)">
              <Input
                type="number"
                value={metricForm.deadlift1RM}
                onChange={(e) => setMetricForm((f) => ({ ...f, deadlift1RM: e.target.value }))}
                placeholder="175"
              />
            </Field>
            <Field label="Vertical Jump (cm)">
              <Input
                type="number"
                value={metricForm.verticalJumpCm}
                onChange={(e) => setMetricForm((f) => ({ ...f, verticalJumpCm: e.target.value }))}
                placeholder="68"
              />
            </Field>
          </div>
          <Field label="Assessment Notes">
            <Input
              value={metricForm.notes}
              onChange={(e) => setMetricForm((f) => ({ ...f, notes: e.target.value }))}
              placeholder="e.g., +5kg Squat 1RM improvement over last 4-week block"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-3 border-t border-vv-border">
            <Btn variant="secondary" onClick={() => setMetricModalOpen(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" onClick={handleSaveProgressMetric}>
              Save Benchmarks
            </Btn>
          </div>
        </div>
      </Modal>

      {/* =====================================================================
          MODAL 9: LOG S&C WORKOUT
      ===================================================================== */}
      <Modal
        open={workoutModalOpen}
        onClose={() => setWorkoutModalOpen(false)}
        title={`Log S&C Workout — ${activeProfileMember?.memberName || ""}`}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Focus Area">
              <Select
                value={workoutForm.focusArea}
                onChange={(e) =>
                  setWorkoutForm((f) => ({
                    ...f,
                    focusArea: e.target.value as GymWorkoutLog["focusArea"],
                  }))
                }
              >
                <option value="Lower Body Power">Lower Body Power</option>
                <option value="Upper Body Strength">Upper Body Strength</option>
                <option value="Core & Mobility">Core & Mobility</option>
                <option value="Plyometrics & Speed">Plyometrics & Speed</option>
                <option value="Energy System Conditioning">Energy System Conditioning</option>
              </Select>
            </Field>

            <Field label="Coach">
              <Input
                value={workoutForm.coachName}
                onChange={(e) => setWorkoutForm((f) => ({ ...f, coachName: e.target.value }))}
              />
            </Field>

            <Field label="Exercises Summary">
              <Input
                value={workoutForm.exercisesSummary}
                onChange={(e) =>
                  setWorkoutForm((f) => ({ ...f, exercisesSummary: e.target.value }))
                }
              />
            </Field>

            <Field label="Sets / Reps / Load">
              <Input
                value={workoutForm.setsRepsLoad}
                onChange={(e) => setWorkoutForm((f) => ({ ...f, setsRepsLoad: e.target.value }))}
              />
            </Field>

            <Field label="RPE (1–10)">
              <Input
                type="number"
                min={1}
                max={10}
                value={workoutForm.rpe}
                onChange={(e) => setWorkoutForm((f) => ({ ...f, rpe: Number(e.target.value) }))}
              />
            </Field>

            <Field label="Personal Record (Optional)">
              <Input
                value={workoutForm.personalRecord}
                onChange={(e) => setWorkoutForm((f) => ({ ...f, personalRecord: e.target.value }))}
                placeholder="e.g., Trap Bar DL 160kg x 3"
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-3 border-t border-vv-border">
            <Btn variant="secondary" onClick={() => setWorkoutModalOpen(false)}>
              Cancel
            </Btn>
            <Btn variant="primary" onClick={handleSaveWorkoutLog}>
              Save Workout Log
            </Btn>
          </div>
        </div>
      </Modal>
    </div>
  );
};

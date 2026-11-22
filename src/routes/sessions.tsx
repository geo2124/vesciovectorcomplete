import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { AppShell } from "@/components/app-shell";
import {
  Button,
  Chip,
  EmptyState,
  Field,
  FilterSelect,
  Input,
  Modal,
  Panel,
  Row,
  RowActions,
  Search,
  Select,
  Stat,
  Table,
  Td,
  Textarea,
  Th,
  money,
} from "@/components/kit";
import { VirtualTable } from "@/components/virtual-table";
import {
  useDB,
  useCollection,
  useTenantUser,
  useModulePermissions,
  coachMatchesBranch,
  findPlayerNextSession,
  getPlayerMonthlyPresentCount,
  COURT_ALLOCATION_OPTIONS,
  calculateSessionCourtRentalCost,
  calculateSessionTotalCostSummary,
  checkCourtScheduleConflict,
  type CourtAllocationType,
} from "@/lib/data-store";
import { useAuth } from "@/lib/auth";
import type { SessionItem } from "@/lib/mock-data";
import { fetchCourtWeather, type WeatherData } from "@/lib/weather";
import { useEffect } from "react";
import { Camera, MessageSquare, ExternalLink, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { calculatePlayer30DayAttendance } from "@/lib/attendance-utils";
import { QrAttendanceScanner } from "@/components/qr-attendance-scanner";
import { GameOfficialsForm } from "@/components/game-officials-form";
import { syncGameOfficialFeesToLedger, removeGameOfficialFeesFromLedger } from "@/lib/match-fees";
import { WhatsAppShareModal } from "@/components/whatsapp-share-modal";

export const Route = createFileRoute("/sessions")({
  head: () => ({
    meta: [
      { title: "Sessions — Vescio Vector" },
      {
        name: "description",
        content:
          "Practices, games, camps and seminars with attendance tracking, approvals and coach assignment.",
      },
      { property: "og:title", content: "Sessions — Vescio Vector" },
      {
        property: "og:description",
        content: "Plan sessions, approve games and take attendance in one place.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SessionsPage,
});

const statuses: SessionItem["status"][] = [
  "Planned",
  "Pending approval",
  "Pre-approved",
  "Official",
  "Live",
  "Completed",
  "Cancelled",
];

const statusTone: Record<SessionItem["status"], "accent" | "good" | "warn" | "neutral"> = {
  Live: "accent",
  Planned: "neutral",
  "Pending approval": "warn",
  "Pre-approved": "good",
  Official: "accent",
  Completed: "good",
  Cancelled: "warn",
};

const blank: Omit<SessionItem, "id"> = {
  kind: "Practice",
  title: "",
  detail: "",
  date: new Date().toISOString().slice(0, 10),
  time: "17:00",
  branch: "",
  coach: "",
  status: "Planned",
};

const MAX_RECURRING_ITERATIONS = 52;

function generateRecurringSessionDates(startDateStr: string, endDateStr?: string): string[] {
  const cleanStart =
    typeof startDateStr === "string" && /^\d{4}-\d{2}-\d{2}$/.test(startDateStr.trim())
      ? startDateStr.trim()
      : new Date().toISOString().slice(0, 10);
  const cleanEnd =
    typeof endDateStr === "string" && /^\d{4}-\d{2}-\d{2}$/.test(endDateStr.trim())
      ? endDateStr.trim()
      : "";

  if (!cleanEnd || cleanEnd <= cleanStart) {
    return [cleanStart];
  }

  const startMs = new Date(`${cleanStart}T00:00:00Z`).getTime();
  const endMs = new Date(`${cleanEnd}T00:00:00Z`).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    return [cleanStart];
  }

  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const dates: string[] = [];

  for (let i = 0; i < MAX_RECURRING_ITERATIONS; i++) {
    const stepDate = new Date(startMs + i * ONE_WEEK_MS);
    if (stepDate.getTime() > endMs) {
      break;
    }
    dates.push(stepDate.toISOString().slice(0, 10));
  }

  return dates.length > 0 ? dates : [cleanStart];
}

function SessionsPage() {
  const {
    db,
    update,
    setEntity,
    deleteEntity,
    patchEntity,
    recordAttendance,
    dispatchNotification,
    ready,
  } = useDB();
  const { user: authUser, loading: authLoading } = useAuth();
  const { items: sessions } = useCollection("sessions");
  const { items: rawBranches } = useCollection("branches");
  const { items: rawCoaches } = useCollection("coaches");
  const { items: rawPlayers } = useCollection("players");
  const { items: rawTeams } = useCollection("teams");
  useCollection("ledger");

  const branches = useMemo(() => rawBranches.map((b) => b.name), [rawBranches]);
  const coachNames = useMemo(() => rawCoaches.map((c) => c.name), [rawCoaches]);

  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [branch, setBranch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SessionItem | null>(null);
  const [form, setForm] = useState<Omit<SessionItem, "id">>(blank);
  const [attendFor, setAttendFor] = useState<SessionItem | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [shareSession, setShareSession] = useState<SessionItem | null>(null);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [gameScoreModal, setGameScoreModal] = useState<SessionItem | null>(null);
  const [gameScore, setGameScore] = useState("");
  const [gameReport, setGameReport] = useState("");
  const [coachPresenceStatus, setCoachPresenceStatus] = useState<"Present" | "Absent" | "Excused">(
    "Present",
  );

  // Strictly limited to Practice and Game as required
  const sessionTypes: string[] = ["Practice", "Game"];

  const selectedBranchObj = useMemo(
    () => rawBranches.find((b) => b.name === (branch || branches[0])),
    [rawBranches, branch, branches],
  );
  const branchCourtGps = selectedBranchObj?.courts.find(
    (c) => typeof c.lat === "number" && typeof c.lng === "number",
  );

  useEffect(() => {
    if (branchCourtGps?.lat && branchCourtGps?.lng) {
      fetchCourtWeather(branchCourtGps.lat, branchCourtGps.lng).then(setWeather);
    } else {
      fetchCourtWeather(33.8938, 35.5018).then(setWeather);
    }
  }, [branchCourtGps?.lat, branchCourtGps?.lng]);

  const currentUser = useTenantUser();
  const { canWrite: canWriteSessions, canDelete: canDeleteSessions } =
    useModulePermissions("sessions");
  const isBranchManager =
    (currentUser?.role === "Branch Manager" ||
      currentUser?.branchScope === "Assigned branch only") &&
    Boolean(currentUser?.branch);
  const userBranch = isBranchManager ? currentUser?.branch || "" : "";

  const accessibleSessions = isBranchManager
    ? sessions.filter((s) => s.branch?.toLowerCase() === userBranch.toLowerCase())
    : sessions;

  const filtered = accessibleSessions.filter(
    (s) =>
      (!q.trim() ||
        [s.title, s.detail, s.coach].join(" ").toLowerCase().includes(q.toLowerCase())) &&
      (!kind || s.kind === kind) &&
      (isBranchManager || !branch || s.branch === branch),
  );

  const canApprove =
    currentUser?.role === "Branch Manager" ||
    currentUser?.role === "Academy Manager" ||
    currentUser?.role === "Super Admin";
  const canMakeOfficial =
    currentUser?.role === "Technical Director" ||
    currentUser?.role === "Academy Manager" ||
    currentUser?.role === "Super Admin";

  const requireGameConfirmation =
    db.academy?.requireGameConfirmation !== false && !db.academy?.autoConfirmGames;

  const pending = accessibleSessions.filter((s) => s.status === "Pending approval").length;
  const preApproved = accessibleSessions.filter((s) => s.status === "Pre-approved").length;
  const games = accessibleSessions.filter((s) => s.kind === "Game").length;

  const allowedStatuses = useMemo(() => {
    if (canMakeOfficial) return statuses;
    if (canApprove) return statuses.filter((s) => s !== "Official" && s !== "Completed");
    return statuses.filter((s) => s === "Planned" || s === "Pending approval");
  }, [canApprove, canMakeOfficial]);

  const canManageSessionFee =
    Boolean(currentUser) &&
    (currentUser?.role === "Super Admin" ||
      currentUser?.role === "Academy Manager" ||
      currentUser?.role === "Branch Manager" ||
      currentUser?.role === "Accountant");

  const [attendCoachFee, setAttendCoachFee] = useState<string>("");
  const [attendTransportFee, setAttendTransportFee] = useState<string>("0");

  function openAttendanceModal(s: SessionItem) {
    setAttendFor(s);
    setCoachPresenceStatus(s.coachAttendance || "Present");
    const targetCoachName = (s.coach || s.headCoach || "").trim();
    const matched = rawCoaches.find(
      (c) =>
        (s.coachId && c.id === s.coachId) ||
        (s.headCoachId && c.id === s.headCoachId) ||
        (targetCoachName && c.name.toLowerCase() === targetCoachName.toLowerCase()),
    );
    const initialFee =
      s.coachSessionFee !== undefined && s.coachSessionFee !== null
        ? s.coachSessionFee
        : s.coachRate !== undefined && s.coachRate !== null && Number(s.coachRate) > 0
          ? s.coachRate
          : (matched?.rate ?? 0);
    setAttendCoachFee(String(initialFee));
    setAttendTransportFee(String(s.coachTransportFee ?? 0));
  }

  function openNew(defaultK?: string | unknown) {
    if (!canWriteSessions) return;
    const defaultKind: SessionItem["kind"] = defaultK === "Game" ? "Game" : "Practice";
    setEditing(null);
    const initialCoachName = coachNames[0] ?? "";
    const matchedCoach = rawCoaches.find((c) => c.name === initialCoachName);
    const defaultRate = matchedCoach?.rate ?? 0;
    const defaultGameStatus: SessionItem["status"] = requireGameConfirmation
      ? "Pending approval"
      : "Official";

    setForm({
      ...blank,
      kind: defaultKind,
      status: defaultKind === "Game" ? defaultGameStatus : "Planned",
      branch: isBranchManager ? userBranch : (branches[0] ?? ""),
      coach: initialCoachName,
      coachId: matchedCoach?.id,
      headCoach: initialCoachName,
      headCoachId: matchedCoach?.id,
      courtAllocation: "Full Court",
      coachRate: defaultRate,
      coachSessionFee: defaultRate,
      coachTransportFee: 0,
      assistantSessionFee: null,
      assistantTransportFee: 0,
      rateOverwritten: false,
      referees: [],
      matchStaff: [],
    });
    setOpen(true);
  }
  function openEdit(s: SessionItem) {
    if (!canWriteSessions) return;
    setEditing(s);
    const { id: _id, ...rest } = s;
    const targetCoachName = (rest.coach || rest.headCoach || "").trim();
    const matched = rawCoaches.find(
      (c) =>
        (rest.coachId && c.id === rest.coachId) ||
        (targetCoachName && c.name.toLowerCase() === targetCoachName.toLowerCase()),
    );
    const resolvedSessionFee =
      rest.coachSessionFee !== undefined && rest.coachSessionFee !== null
        ? rest.coachSessionFee
        : rest.coachRate !== undefined && rest.coachRate !== null
          ? rest.coachRate
          : (matched?.rate ?? 0);
    setForm({
      ...rest,
      kind: rest.kind === "Game" ? "Game" : "Practice",
      courtAllocation: rest.courtAllocation || "Full Court",
      coachId: matched?.id || rest.coachId,
      headCoachId: rest.headCoachId || matched?.id,
      coachRate: resolvedSessionFee,
      coachSessionFee: resolvedSessionFee,
      coachTransportFee: rest.coachTransportFee ?? 0,
      assistantSessionFee: rest.assistantSessionFee ?? null,
      assistantTransportFee: rest.assistantTransportFee ?? 0,
    });
    setOpen(true);
  }

  function handleSaveGameScoreAndReport(e?: React.FormEvent) {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    if (!gameScoreModal) return;
    if (!gameScore.trim()) {
      toast.error("Please enter the final game score (e.g. 82 - 76).");
      return;
    }
    if (!gameReport.trim()) {
      toast.error("Please enter a game report or match summary.");
      return;
    }
    patchEntity("sessions", gameScoreModal.id, {
      status: "Completed",
      score: gameScore.trim(),
      report: gameReport.trim(),
    });
    void dispatchNotification({
      title: `Match Completed: ${gameScoreModal.title}`,
      message: `${currentUser?.name || currentUser?.role || "Staff"} submitted final score (${gameScore.trim()}) and match report.`,
      type: "curriculum",
      targetRoles: ["technical_director", "super_admin", "branch_manager"],
      targetBranchId: gameScoreModal.branch || undefined,
      actionUrl: "/technical",
      createdAt: new Date().toISOString(),
      readBy: [],
    }).catch(() => {});
    toast.success(`Game "${gameScoreModal.title}" completed and score recorded.`);
    setGameScoreModal(null);
    setGameScore("");
    setGameReport("");
  }

  function submit(e?: React.FormEvent) {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    if (!canWriteSessions) return;
    if (!form.title || !form.title.trim()) {
      toast.error("Please enter a session title.");
      return;
    }
    const safeKind: SessionItem["kind"] = form.kind === "Game" ? "Game" : "Practice";
    const normalizedForm = { ...form, kind: safeKind };
    const defaultGameStatus: SessionItem["status"] = requireGameConfirmation
      ? "Pending approval"
      : "Official";

    const finalForm: Omit<SessionItem, "id"> =
      safeKind === "Game"
        ? {
            ...normalizedForm,
            status: editing ? editing.status || defaultGameStatus : defaultGameStatus,
            approvalStatus:
              editing?.approvalStatus || (requireGameConfirmation ? "Pending" : "Approved"),
            ...(editing
              ? {}
              : requireGameConfirmation
                ? {}
                : { confirmedBy: "Auto-Confirmed (TD Policy)" }),
          }
        : {
            ...normalizedForm,
            status: (normalizedForm.status || "Planned") as SessionItem["status"],
          };
    const targetId = editing ? editing.id : `e-${Date.now().toString(36)}`;

    const targetCoachName = (finalForm.coach || finalForm.headCoach || "").trim();
    const matchedCoach = (rawCoaches || db.coaches || []).find(
      (c) =>
        (finalForm.coachId && c.id === finalForm.coachId) ||
        (targetCoachName && c.name.toLowerCase() === targetCoachName.toLowerCase()),
    );
    const targetHeadCoachName = (finalForm.headCoach || targetCoachName).trim();
    const matchedHeadCoach = (rawCoaches || db.coaches || []).find(
      (c) =>
        (finalForm.headCoachId && c.id === finalForm.headCoachId) ||
        (targetHeadCoachName && c.name.toLowerCase() === targetHeadCoachName.toLowerCase()),
    );
    const targetAssistantName = (finalForm.assistantCoach || "").trim();
    const matchedAssistant = targetAssistantName
      ? (rawCoaches || db.coaches || []).find(
          (c) =>
            (finalForm.assistantCoachId && c.id === finalForm.assistantCoachId) ||
            c.name.toLowerCase() === targetAssistantName.toLowerCase(),
        )
      : undefined;

    const resolvedBranchName = isBranchManager ? userBranch : finalForm.branch || "HQ";
    const resolvedCourtName = finalForm.court || finalForm.detail || "";
    const courtRentalCalc = calculateSessionCourtRentalCost(
      {
        ...finalForm,
        branch: resolvedBranchName,
        court: resolvedCourtName,
        detail: finalForm.detail || resolvedCourtName,
      },
      rawBranches || db.branches || [],
    );

    const baseSession: SessionItem = {
      ...finalForm,
      id: targetId,
      kind: safeKind,
      title: finalForm.title.trim(),
      detail: finalForm.detail || courtRentalCalc.courtName || "",
      court: resolvedCourtName || courtRentalCalc.courtName || "",
      courtAllocation: courtRentalCalc.allocation,
      durationHours: courtRentalCalc.durationHours,
      courtRentalCost: courtRentalCalc.rentalCost,
      branch: resolvedBranchName,
      coach: matchedCoach?.name || targetCoachName,
      coachId: matchedCoach?.id || finalForm.coachId || undefined,
      headCoach:
        matchedHeadCoach?.name || finalForm.headCoach || matchedCoach?.name || targetCoachName,
      headCoachId:
        matchedHeadCoach?.id ||
        finalForm.headCoachId ||
        matchedCoach?.id ||
        finalForm.coachId ||
        undefined,
      ...(matchedAssistant || finalForm.assistantCoach
        ? {
            assistantCoach: matchedAssistant?.name || finalForm.assistantCoach,
            assistantCoachId: matchedAssistant?.id || finalForm.assistantCoachId || undefined,
          }
        : {}),
    };

    const scheduleDates = editing
      ? [baseSession.date]
      : generateRecurringSessionDates(baseSession.date, baseSession.endDate);

    const generatedSessions: SessionItem[] = scheduleDates.map((dateStr, idx) => ({
      ...baseSession,
      id: idx === 0 ? targetId : `${targetId}-r${idx}`,
      date: dateStr,
    }));
    const savedSession = generatedSessions[0]!;

    if (savedSession.status !== "Cancelled" && savedSession.date && savedSession.time) {
      for (const candidateSess of generatedSessions) {
        const conflictResult = checkCourtScheduleConflict(
          candidateSess,
          db.sessions || [],
          editing ? targetId : undefined,
          db.courtReservations || [],
          undefined,
          db.branches || [],
        );
        if (conflictResult.hasCourtConflict) {
          toast.error(
            conflictResult.courtConflictReason ||
              "Court schedule conflict detected. Full Court bookings cannot overlap with HCA/HCB or another Full Court session.",
          );
          return;
        }
        if (candidateSess.id === savedSession.id) {
          if (conflictResult.simultaneousHalfCourtSession) {
            const other = conflictResult.simultaneousHalfCourtSession;
            toast.info(
              `Simultaneous Half-Court booking confirmed: ${savedSession.courtAllocation} shares ${savedSession.court || savedSession.detail} with "${other.title}" (${other.courtAllocation || "Half Court"}).`,
            );
          }
          if (conflictResult.hasCoachConflict && conflictResult.coachConflictReason) {
            toast.warning(conflictResult.coachConflictReason);
          }
        }
      }
    }

    const canManageFin =
      Boolean(currentUser) &&
      (currentUser?.role === "Super Admin" ||
        currentUser?.role === "Academy Manager" ||
        currentUser?.role === "Accountant" ||
        currentUser?.role === "Branch Manager");

    if (generatedSessions.length > 1) {
      update((prev) => {
        let nextLedger = prev.ledger;
        if (canManageFin && savedSession.kind === "Game") {
          for (const sess of generatedSessions) {
            nextLedger = syncGameOfficialFeesToLedger(sess, nextLedger);
          }
        }
        return {
          ...prev,
          sessions: [...generatedSessions, ...prev.sessions],
          ledger: nextLedger,
        };
      });
    } else if (canManageFin && savedSession.kind === "Game") {
      update((prev) => {
        const updatedSessions = editing
          ? prev.sessions.map((s) => (s.id === targetId ? savedSession : s))
          : [savedSession, ...prev.sessions];
        const updatedLedger = syncGameOfficialFeesToLedger(savedSession, prev.ledger);
        return {
          ...prev,
          sessions: updatedSessions,
          ledger: updatedLedger,
        };
      });
    } else {
      setEntity("sessions", savedSession);
    }

    if (!editing && savedSession.kind === "Game") {
      void dispatchNotification({
        title: requireGameConfirmation
          ? `Game Approval Requested: ${savedSession.title}`
          : `New Game Scheduled (Auto-Confirmed): ${savedSession.title}`,
        message: `${savedSession.coach || currentUser?.name || "Staff"} scheduled ${savedSession.title} on ${savedSession.date} at ${savedSession.time} (${savedSession.branch}).`,
        type: "curriculum",
        targetRoles: ["technical_director", "super_admin", "branch_manager"],
        targetCoachId: savedSession.coachId || savedSession.headCoachId,
        targetCoachName: savedSession.coach || savedSession.headCoach,
        targetTeam: savedSession.teamA || savedSession.team,
        targetBranchId: savedSession.branch || undefined,
        actionUrl: "/technical",
        createdAt: new Date().toISOString(),
        readBy: [],
      }).catch(() => {});
    }

    toast.success(
      editing
        ? `Session "${savedSession.title}" updated.`
        : generatedSessions.length > 1
          ? `Created ${generatedSessions.length} recurring sessions for "${savedSession.title}".`
          : savedSession.kind === "Game" && !requireGameConfirmation
            ? `Game "${savedSession.title}" auto-confirmed & scheduled.`
            : `Session "${savedSession.title}" created successfully.`,
    );
    setOpen(false);
  }
  const [deleteTarget, setDeleteTarget] = useState<SessionItem | null>(null);
  function remove(s: SessionItem) {
    if (!canDeleteSessions) return;
    setDeleteTarget(s);
  }
  function confirmRemove() {
    if (!canDeleteSessions || !deleteTarget) return;
    const s = deleteTarget;
    setDeleteTarget(null);

    const canManageFin =
      Boolean(currentUser) &&
      (currentUser?.role === "Super Admin" ||
        currentUser?.role === "Academy Manager" ||
        currentUser?.role === "Accountant" ||
        currentUser?.role === "Branch Manager");

    if (canManageFin && s.kind === "Game") {
      update((prev) => ({
        ...prev,
        sessions: prev.sessions.filter((x) => x.id !== s.id),
        ledger: removeGameOfficialFeesFromLedger(s.id, prev.ledger),
      }));
    } else {
      deleteEntity("sessions", s.id);
    }
    toast.success(`"${s.title}" deleted.`);
  }
  function setStatus(s: SessionItem, status: SessionItem["status"]) {
    const approvalStatus: SessionItem["approvalStatus"] =
      status === "Planned" ? "Rejected" : "Approved";
    const confirmedBy =
      status === "Planned" ? undefined : currentUser?.name || "Technical Director";
    patchEntity("sessions", s.id, { status, approvalStatus, confirmedBy });
    if (s.kind === "Game") {
      const actionLabel =
        status === "Planned" ? "Rejected" : status === "Official" ? "Marked Official" : "Approved";
      void dispatchNotification({
        title: `Game ${actionLabel}: ${s.title}`,
        message:
          status === "Planned"
            ? `Game "${s.title}" (${s.date}) was rejected.`
            : status === "Official"
              ? `Game "${s.title}" (${s.date}) has been verified and marked Official.`
              : `Game "${s.title}" scheduled for ${s.date} at ${s.time} has been approved.`,
        type: "curriculum",
        targetRoles: ["coach", "branch_manager", "super_admin"],
        targetCoachId: s.coachId || s.headCoachId,
        targetCoachName: s.coach || s.headCoach,
        targetTeam: s.teamA || s.team,
        targetBranchId: s.branch || undefined,
        actionUrl: "/coach",
        createdAt: new Date().toISOString(),
        readBy: [],
      }).catch(() => {});
    }
  }

  const attendanceRecords = attendFor ? (db.attendance[attendFor.id] ?? {}) : {};
  const [scannedPlayerId, setScannedPlayerId] = useState<string | null>(null);
  const locationSearch = useRouterState({ select: (s) => s.location.searchStr });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(locationSearch || window.location.search);
    const scanId = params.get("scanPlayerId") || params.get("playerId");
    const sessionIdParam = params.get("sessionId");
    if (!scanId) return;
    if (rawPlayers.length === 0 && sessions.length === 0) return;

    const matchedPlayer = rawPlayers.find((p) => p.id === scanId);
    const pool = accessibleSessions.length > 0 ? accessibleSessions : sessions;
    const matchedSession =
      (sessionIdParam ? pool.find((s) => s.id === sessionIdParam) : null) ||
      (matchedPlayer ? findPlayerNextSession(matchedPlayer, pool) : null) ||
      pool[0] ||
      null;

    setScannedPlayerId(scanId);
    if (matchedSession) {
      setAttendFor(matchedSession);
    }
  }, [locationSearch, rawPlayers, sessions, accessibleSessions]);

  const scannedPlayer = useMemo(
    () => (scannedPlayerId ? rawPlayers.find((p) => p.id === scannedPlayerId) || null : null),
    [scannedPlayerId, rawPlayers],
  );

  const roster = useMemo(() => {
    if (!attendFor) return [];
    const base = (rawPlayers || []).filter((p) => {
      if (attendFor.branch && p.branch && p.branch !== attendFor.branch) {
        return false;
      }
      const targetTeams = [attendFor.team, attendFor.teamA, attendFor.teamB].filter(
        (t): t is string => Boolean(t && t.trim()),
      );
      if (targetTeams.length > 0) {
        const pTeams = p.teams || [];
        return targetTeams.some((teamName) => pTeams.includes(teamName));
      }
      return true;
    });
    if (scannedPlayer && !base.some((p) => p.id === scannedPlayer.id)) {
      return [scannedPlayer, ...base];
    }
    return base;
  }, [attendFor, rawPlayers, scannedPlayer]);
  const presentCount = Object.values(attendanceRecords).filter(
    (status) => status === "Present",
  ).length;
  const excusedCount = Object.values(attendanceRecords).filter(
    (status) => status === "Excused",
  ).length;
  const absentCount = Math.max(0, (roster.length || 0) - presentCount - excusedCount);

  function setAttendance(playerId: string, status: "Present" | "Absent" | "Excused") {
    if (!attendFor) return;
    const p = roster.find((player) => player.id === playerId);
    let flag: "low_attendance_warning" | undefined = undefined;
    if (p && status === "Present") {
      const stats = calculatePlayer30DayAttendance(p.id, p, sessions, db.attendance);
      if (stats.isLowAttendance) {
        flag = "low_attendance_warning";
        toast.warning(
          `⚠️ Low Attendance Warning: ${p.name} (Rate: ${stats.rate}% over last 30 days).`,
        );
      }
    }
    recordAttendance(
      attendFor.id,
      playerId,
      status,
      new Date().toISOString(),
      flag ? { method: "manual", flag } : { method: "manual" },
    );
  }

  if (authLoading && !currentUser && !authUser) {
    return (
      <AppShell crumb="OPS / SESSIONS" title="Sessions">
        <div className="flex h-64 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-court-500 border-t-transparent" />
          <span className="ml-3 font-mono text-xs text-ink-400">Loading scheduled sessions…</span>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb="OPS / SESSIONS" title="Sessions">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={isBranchManager ? `Scheduled (${userBranch})` : "Scheduled"}
          value={String(accessibleSessions.length)}
          note={isBranchManager ? "assigned facility" : "all upcoming activity"}
          accent
        />
        <Stat label="Games" value={String(games)} />
        <Stat label="Awaiting approval" value={String(pending)} note="technical direction" />
        <Stat
          label="Attendance marked"
          value={String(
            isBranchManager
              ? accessibleSessions.reduce(
                  (a, s) =>
                    a +
                    Object.values(db.attendance[s.id] || {}).filter((x) => x === "Present").length,
                  0,
                )
              : Object.values(db.attendance).reduce(
                  (a, v) => a + Object.values(v).filter((x) => x === "Present").length,
                  0,
                ),
          )}
          note="player check-ins"
          accent
        />
      </div>

      {scannedPlayer && (
        <div className="mt-3 rounded-lg border border-court-500/40 bg-court-500/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-[10px] uppercase tracking-wider font-bold text-court-300 bg-court-500/20 px-2 py-0.5 rounded">
                QR Pass Scanned
              </span>
              <span className="text-sm font-bold text-ink-100">{scannedPlayer.name}</span>
              <span className="font-mono text-xs text-ink-400">
                ({scannedPlayer.category} · {scannedPlayer.teams?.join(", ") || "No team"})
              </span>
            </div>
            <div className="mt-1 font-mono text-xs text-ink-300">
              {(() => {
                const nextSess = attendFor || findPlayerNextSession(scannedPlayer, sessions);
                if (!nextSess) {
                  return <span>No upcoming session scheduled yet for this player.</span>;
                }
                const currentStatus = db.attendance[nextSess.id]?.[scannedPlayer.id];
                return (
                  <span>
                    Next Session: <strong className="text-ink-100">{nextSess.title}</strong> (
                    {nextSess.date} · {nextSess.time}) · Attendance:{" "}
                    <strong className="text-court-300">{currentStatus || "Pending"}</strong>
                  </span>
                );
              })()}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(() => {
              const nextSess = attendFor || findPlayerNextSession(scannedPlayer, sessions);
              if (!nextSess) return null;
              const currentStatus = db.attendance[nextSess.id]?.[scannedPlayer.id];
              return (
                <>
                  {currentStatus !== "Present" ? (
                    <button
                      type="button"
                      onClick={async () => {
                        await recordAttendance(
                          nextSess.id,
                          scannedPlayer.id,
                          "Present",
                          new Date().toISOString(),
                          { method: "qr_scan" },
                        );
                        toast.success(
                          `✅ Marked ${scannedPlayer.name} Present for ${nextSess.title}!`,
                        );
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md bg-good px-3 py-1.5 font-mono text-xs font-bold text-ink-950 shadow hover:opacity-90 transition-opacity"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>✅ Mark {scannedPlayer.name} Present Now</span>
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-md bg-good/20 px-2.5 py-1.5 font-mono text-xs font-bold text-good ring-1 ring-good/40">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Checked In (Present)</span>
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setAttendFor(nextSess)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-court-500 px-3 py-1.5 font-mono text-xs font-bold text-ink-950 hover:bg-court-400 transition-colors"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Open Session Attendance</span>
                  </button>
                </>
              );
            })()}
            <Link
              to="/players"
              search={{ playerId: scannedPlayer.id } as never}
              className="inline-flex items-center gap-1.5 rounded-md bg-ink-850 px-3 py-1.5 font-mono text-xs font-semibold text-court-300 ring-1 ring-court-500/40 hover:bg-ink-800 transition-colors"
            >
              <span>View Player Profile ↗</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      )}

      {weather && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md bg-ink-900 px-4 py-2.5 ring-1 ring-ink-800">
          <div className="flex items-center gap-3">
            <span className="text-xl">
              {weather.condition.toLowerCase().includes("rain") ||
              weather.condition.toLowerCase().includes("drizzle")
                ? "🌧️"
                : weather.condition.toLowerCase().includes("cloud")
                  ? "⛅"
                  : weather.condition.toLowerCase().includes("fog")
                    ? "🌫️"
                    : "☀️"}
            </span>
            <div>
              <div className="flex items-center gap-2 font-mono text-xs text-ink-100 font-semibold">
                <span>
                  {weather.temp}°C {weather.condition}
                </span>
                <span className="text-ink-500">·</span>
                <span className="text-ink-400 font-normal">Wind: {weather.windSpeed} km/h</span>
                <span className="text-ink-500">·</span>
                <span className="text-ink-400 font-normal">Humidity: {weather.humidity}%</span>
              </div>
              <div className="font-mono text-[10px] text-court-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                <span>
                  {selectedBranchObj ? `${selectedBranchObj.name} Branch: ` : "Court Advisory: "}{" "}
                  {weather.courtRecommendation}
                </span>
                {branchCourtGps?.lat && branchCourtGps?.lng ? (
                  <span className="text-good font-bold">
                    📍 GPS ({branchCourtGps.lat.toFixed(3)}, {branchCourtGps.lng.toFixed(3)})
                  </span>
                ) : (
                  <span className="text-warn">⚠️ No GPS configured (using regional fallback)</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`font-mono text-[10px] px-2 py-0.5 rounded uppercase font-semibold ${
                weather.isOutdoorSafe
                  ? "bg-good/15 text-good ring-1 ring-good/30"
                  : "bg-warn/15 text-warn ring-1 ring-warn/30"
              }`}
            >
              {weather.isOutdoorSafe ? "Outdoor Safe" : "Indoor Advised"}
            </span>
            <span className="font-mono text-[9px] text-ink-500">{weather.source}</span>
          </div>
        </div>
      )}

      <Panel
        className="mt-4"
        title={isBranchManager ? `Activity list · ${userBranch}` : "Activity list"}
        meta="Practices, games, camps and seminars"
        action={
          <>
            <FilterSelect label="Type" value={kind} onChange={setKind} options={sessionTypes} />
            {!isBranchManager ? (
              <FilterSelect label="Branch" value={branch} onChange={setBranch} options={branches} />
            ) : (
              <div className="flex items-center gap-1.5 rounded-md bg-ink-850 px-2.5 py-1.5 border border-ink-800 text-xs font-mono text-ink-300">
                <span className="text-[10px] text-ink-500 uppercase">Branch:</span>
                <span className="text-court-400 font-semibold">{userBranch}</span>
              </div>
            )}
            <Button
              variant="outline"
              onClick={() => setScannerOpen(true)}
              className="flex items-center gap-1.5 text-court-300 border-court-500/30 hover:bg-court-500/10"
            >
              <Camera className="w-3.5 h-3.5 text-court-400" />
              <span>Scan Player QR</span>
            </Button>
            {canWriteSessions && <Button onClick={() => openNew()}>+ New session</Button>}
          </>
        }
      >
        <div className="border-b border-ink-800 px-4 py-3">
          <Search value={q} onChange={setQ} placeholder="Search sessions, coaches…" />
        </div>
        <VirtualTable
          head={
            <>
              <Th>ACTIVITY</Th>
              <Th>TYPE</Th>
              <Th hide>WHEN</Th>
              <Th hide>COACH</Th>
              <Th>
                <span className="block text-right">STATUS</span>
              </Th>
            </>
          }
          data={filtered}
          colSpan={5}
          maxHeight="640px"
          estimateRowHeight={58}
          emptyState={<EmptyState>No sessions match these filters.</EmptyState>}
          footer={`SHOWING ${filtered.length} OF ${accessibleSessions.length}`}
          renderRow={(s) => (
            <>
              <Td strong>
                <div className="leading-tight">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span>{s.title}</span>
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold ring-1 ${
                        s.courtAllocation === "Half Court - HCA" ||
                        s.courtAllocation === "Half Court - HCB"
                          ? "bg-court-500/15 text-court-300 ring-court-500/30"
                          : "bg-ink-800 text-ink-300 ring-ink-700"
                      }`}
                    >
                      {s.courtAllocation || "Full Court"}
                    </span>
                  </div>
                  <div className="font-mono text-[10px] text-ink-400 mt-0.5">
                    {s.detail || s.court || "—"} · {s.branch || "—"}
                    {(() => {
                      const costSummary = calculateSessionTotalCostSummary(
                        s,
                        rawBranches,
                        rawCoaches,
                        rawTeams,
                      );
                      return (
                        <span className="ml-1.5 text-court-300">
                          · Court Rent: {money(costSummary.rentalCost)} ({costSummary.durationHours}
                          h) · Total Cost: {money(costSummary.totalDirectCost)}
                        </span>
                      );
                    })()}
                  </div>
                </div>
              </Td>
              <Td>
                <Chip>{String(s.kind || "Practice").toUpperCase()}</Chip>
              </Td>
              <Td hide>
                <span className="font-mono text-xs">
                  {s.date} · {s.time}
                  {s.endTime ? `–${s.endTime}` : ""}
                </span>
              </Td>
              <Td hide>
                <div>
                  <span>{s.coach || s.headCoach || "—"}</span>
                  {(() => {
                    const feeVal =
                      s.coachSessionFee !== undefined && s.coachSessionFee !== null
                        ? Number(s.coachSessionFee)
                        : s.coachRate !== undefined && Number(s.coachRate) > 0
                          ? Number(s.coachRate)
                          : undefined;
                    const transVal = Number(s.coachTransportFee || 0);
                    if (feeVal === undefined && transVal <= 0) return null;
                    return (
                      <span
                        className="ml-1.5 font-mono text-[10px] text-court-300"
                        title={
                          s.rateOverwritten
                            ? `Session rate (${money(feeVal || 0)}) by ${s.rateOverwrittenBy || "Manager"}${transVal > 0 ? ` + Transport ${money(transVal)}` : ""}`
                            : `Coach session fee: ${money(feeVal || 0)}${transVal > 0 ? ` + Transport ${money(transVal)}` : ""}`
                        }
                      >
                        ({feeVal !== undefined ? money(feeVal) : ""}
                        {s.rateOverwritten ? "*" : ""}
                        {transVal > 0 ? ` + ${money(transVal)} trans.` : ""})
                      </span>
                    );
                  })()}
                </div>
              </Td>
              <Td right>
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  {s.score && (
                    <span className="px-2 py-0.5 rounded bg-court-500/15 border border-court-500/30 font-mono text-[10px] font-bold text-court-300">
                      Score: {s.score}
                    </span>
                  )}
                  <Chip tone={statusTone[s.status] || "neutral"}>
                    {String(s.status || "Planned").toUpperCase()}
                  </Chip>
                  {s.kind === "Game" && (
                    <button
                      type="button"
                      onClick={() => {
                        setGameScoreModal(s);
                        setGameScore(s.score || "");
                        setGameReport(s.report || "");
                      }}
                      className="rounded px-2 py-1 font-mono text-[10px] text-accent ring-1 ring-ink-700 hover:bg-accent/10 whitespace-nowrap"
                      title={
                        s.status === "Completed"
                          ? "Edit match score & report"
                          : "Submit score & report to complete game"
                      }
                    >
                      {s.status === "Completed" ? "SCORE & REPORT" : "SUBMIT SCORE"}
                    </button>
                  )}
                  {s.status === "Pending approval" && canApprove ? (
                    <button
                      type="button"
                      onClick={() => setStatus(s, "Pre-approved")}
                      className="rounded px-2 py-1 font-mono text-[10px] text-good ring-1 ring-ink-700 hover:bg-good/10"
                    >
                      APPROVE
                    </button>
                  ) : null}
                  {s.status === "Pre-approved" && canMakeOfficial ? (
                    <button
                      type="button"
                      onClick={() => setStatus(s, "Official")}
                      className="rounded px-2 py-1 font-mono text-[10px] text-accent ring-1 ring-ink-700 hover:bg-accent/10"
                    >
                      MAKE OFFICIAL
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => openAttendanceModal(s)}
                    className="rounded px-2 py-1 font-mono text-[10px] text-court-400 ring-1 ring-ink-700 hover:bg-court-500/10"
                  >
                    ATTENDANCE
                  </button>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => {
                      setAttendFor(s);
                      setScannerOpen(true);
                    }}
                    title="Turnstile QR Scanner"
                    className="h-7 w-7 p-0 text-court-400 border-court-500/30 hover:bg-court-500/10"
                  >
                    <Camera className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="emerald"
                    size="xs"
                    onClick={() => setShareSession(s)}
                    title="Push to WhatsApp"
                    className="h-7 w-7 p-0"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                  </Button>
                  <RowActions
                    onEdit={canWriteSessions ? () => openEdit(s) : undefined}
                    onDelete={canDeleteSessions ? () => remove(s) : undefined}
                  />
                </div>
              </Td>
            </>
          )}
        />
      </Panel>

      <Modal
        open={open}
        title={editing ? "Edit session" : "New session"}
        meta="Type, schedule, branch and coach"
        onClose={() => setOpen(false)}
        onSubmit={submit}
        submitLabel={editing ? "Save changes" : "Create session"}
        wide
      >
        <div className="grid items-end gap-3 p-4 sm:grid-cols-2">
          <Field label="Type">
            <Select
              value={
                typeof form.kind === "string" && form.kind
                  ? form.kind
                  : (sessionTypes[0] ?? "Practice")
              }
              onChange={(v) => {
                setForm({ ...form, kind: v as SessionItem["kind"] });
              }}
              options={sessionTypes}
            />
          </Field>

          <Field label="Title">
            <Input value={form.title ?? ""} onChange={(v) => setForm({ ...form, title: v })} />
          </Field>

          {form.kind === "Practice" && (
            <>
              <Field label="Team">
                <Input
                  value={form.team ?? ""}
                  onChange={(v) => {
                    const t = rawTeams.find((x) => x.name === v);
                    const head = t?.headCoach ?? "";
                    const assist = t?.assistant ?? "";
                    const matchedHead = rawCoaches.find(
                      (c) =>
                        (t?.headCoachId && c.id === t.headCoachId) ||
                        (head && c.name.toLowerCase() === head.toLowerCase()),
                    );
                    const matchedAssist = rawCoaches.find(
                      (c) =>
                        (t?.assistantId && c.id === t.assistantId) ||
                        (assist && c.name.toLowerCase() === assist.toLowerCase()),
                    );
                    const headRate = t?.headCoachRate ?? matchedHead?.rate ?? 0;
                    const assistRate = t?.assistantRate ?? matchedAssist?.rate ?? null;
                    setForm({
                      ...form,
                      team: v,
                      headCoach: head,
                      headCoachId: matchedHead?.id || t?.headCoachId,
                      assistantCoach: assist,
                      assistantCoachId: matchedAssist?.id || t?.assistantId,
                      coach: head,
                      coachId: matchedHead?.id || t?.headCoachId,
                      coachRate: form.rateOverwritten ? form.coachRate : headRate,
                      coachSessionFee: form.rateOverwritten
                        ? (form.coachSessionFee ?? form.coachRate)
                        : headRate,
                      assistantSessionFee: form.assistantSessionFee ?? assistRate,
                    });
                  }}
                  list="teams-list"
                />
              </Field>

              <Field label="Date">
                <Input
                  type="date"
                  value={form.date ?? ""}
                  onChange={(v) => setForm({ ...form, date: v })}
                />
              </Field>

              <Field label="Start Time">
                <Input
                  type="time"
                  value={form.time ?? ""}
                  onChange={(v) => setForm({ ...form, time: v })}
                />
              </Field>

              <Field label="End Time">
                <Input
                  type="time"
                  value={form.endTime ?? ""}
                  onChange={(v) => setForm({ ...form, endTime: v })}
                />
              </Field>

              <Field label="Branch">
                {isBranchManager ? (
                  <div className="h-10 rounded-md bg-ink-850 px-3 py-2 font-mono text-xs text-court-300 ring-1 ring-ink-700 flex items-center justify-between">
                    <span>{userBranch}</span>
                    <span className="text-[10px] text-ink-500 uppercase">Assigned Facility</span>
                  </div>
                ) : (
                  <Select
                    value={form.branch ?? ""}
                    onChange={(v) => {
                      const b = rawBranches.find((x) => x.name === v);
                      const courtName = b?.courts?.[0]?.name ?? "";
                      setForm({ ...form, branch: v, detail: courtName });
                    }}
                    options={["", ...branches, "HQ"]}
                  />
                )}
              </Field>

              <Field label="Main Court (Location)">
                {(() => {
                  const branchObj = rawBranches.find(
                    (b) => b.name?.toLowerCase() === (form.branch || "").toLowerCase(),
                  );
                  const branchCourts = (branchObj?.courts || []).filter((c) => c.name?.trim());
                  const matchedCourt = branchCourts.find(
                    (c) => c.name.toLowerCase() === (form.detail || form.court || "").toLowerCase(),
                  );
                  const courtSchedule =
                    matchedCourt?.schedule ||
                    matchedCourt?.operatingHours ||
                    branchObj?.operatingHours ||
                    "";

                  return (
                    <div className="space-y-1.5">
                      {branchCourts.length > 0 && (
                        <Select
                          value={
                            matchedCourt
                              ? matchedCourt.name
                              : form.detail
                                ? "__custom__"
                                : branchCourts[0]?.name || ""
                          }
                          onChange={(v) => {
                            if (v === "__custom__") {
                              setForm({ ...form, detail: "", court: "" });
                            } else {
                              setForm({ ...form, detail: v, court: v });
                            }
                          }}
                          options={[...branchCourts.map((c) => c.name), "__custom__"]}
                        />
                      )}
                      {(!matchedCourt || branchCourts.length === 0) && (
                        <Input
                          value={form.detail ?? ""}
                          placeholder="Enter court or venue name"
                          onChange={(v) => setForm({ ...form, detail: v, court: v })}
                        />
                      )}
                      {courtSchedule && (
                        <div className="rounded bg-ink-900/80 px-2 py-1 font-mono text-[10px] text-court-300 ring-1 ring-ink-800">
                          Court Schedule ({matchedCourt?.name || "Branch Master"}):{" "}
                          <span className="text-ink-100">{courtSchedule}</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </Field>

              <Field
                label="Court Allocation (Full vs. Half Court HCA / HCB)"
                hint="Full Court occupies both HCA & HCB. HCA and HCB allow simultaneous sessions on the same court."
              >
                <Select
                  value={form.courtAllocation || "Full Court"}
                  onChange={(v) => setForm({ ...form, courtAllocation: v as CourtAllocationType })}
                  options={COURT_ALLOCATION_OPTIONS}
                />
              </Field>

              <Field label="Head Coach">
                <Input
                  value={form.headCoach ?? ""}
                  onChange={(v) => {
                    const coachObj = rawCoaches.find(
                      (c) => c.name.toLowerCase() === v.toLowerCase(),
                    );
                    const t = rawTeams.find((x) => x.name === form.team);
                    const inheritedRate = t?.headCoachRate ?? coachObj?.rate ?? 0;
                    setForm({
                      ...form,
                      headCoach: v,
                      headCoachId: coachObj?.id,
                      coach: v,
                      coachId: coachObj?.id,
                      coachRate: form.rateOverwritten ? form.coachRate : inheritedRate,
                      coachSessionFee: form.rateOverwritten
                        ? (form.coachSessionFee ?? form.coachRate)
                        : inheritedRate,
                    });
                  }}
                  list="coaches-list"
                />
              </Field>

              <Field label="Assistant Coach">
                <Input
                  value={form.assistantCoach ?? ""}
                  onChange={(v) => {
                    const assistObj = rawCoaches.find(
                      (c) => c.name.toLowerCase() === v.toLowerCase(),
                    );
                    setForm({
                      ...form,
                      assistantCoach: v,
                      assistantCoachId: assistObj?.id,
                      assistantSessionFee:
                        form.assistantSessionFee ?? (assistObj ? (assistObj.rate ?? 0) : null),
                    });
                  }}
                  list="coaches-list"
                />
              </Field>

              {canManageSessionFee &&
                (() => {
                  const t = rawTeams.find((x) => x.name === form.team);
                  const coachObj = rawCoaches.find(
                    (c) =>
                      (form.coachId && c.id === form.coachId) ||
                      c.name.toLowerCase() === (form.headCoach || form.coach || "").toLowerCase(),
                  );
                  const defaultRate = t?.headCoachRate ?? coachObj?.rate ?? 0;
                  const currentFeeVal =
                    form.coachSessionFee !== undefined && form.coachSessionFee !== null
                      ? form.coachSessionFee
                      : form.coachRate !== undefined
                        ? form.coachRate
                        : defaultRate;
                  const currentTransportVal = form.coachTransportFee ?? 0;

                  return (
                    <div className="sm:col-span-2 rounded-lg border border-ink-800 bg-ink-900/60 p-3 space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-court-300">
                          Session Coach Fee &amp; Optional Transportation Allowance
                        </div>
                        <span className="rounded bg-court-500/15 px-2 py-0.5 font-mono text-[10px] text-court-300 ring-1 ring-court-500/30">
                          Default Coach Rate: {money(defaultRate)} — Editable for this session
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 items-end gap-3">
                        <Field
                          label={`Coach Session Fee (${db.academy?.currency || "USD"})`}
                          hint={
                            form.rateOverwritten
                              ? `Custom session rate set by ${form.rateOverwrittenBy || "Manager"}`
                              : `Auto-filled from ${coachObj?.name || "coach"} profile (${money(defaultRate)})`
                          }
                        >
                          <div className="flex gap-2">
                            <Input
                              type="number"
                              value={currentFeeVal !== undefined ? String(currentFeeVal) : ""}
                              placeholder={String(defaultRate || 50)}
                              onChange={(v) => {
                                const val = v === "" ? undefined : Number(v);
                                setForm({
                                  ...form,
                                  coachRate: val,
                                  coachSessionFee: val ?? null,
                                  rateOverwritten: val !== undefined && val !== defaultRate,
                                  rateOverwrittenBy:
                                    currentUser?.name || currentUser?.role || "Branch Manager",
                                });
                              }}
                            />
                            {form.rateOverwritten && (
                              <button
                                type="button"
                                onClick={() => {
                                  setForm({
                                    ...form,
                                    coachRate: defaultRate,
                                    coachSessionFee: defaultRate,
                                    rateOverwritten: false,
                                    rateOverwrittenBy: undefined,
                                  });
                                }}
                                className="px-2.5 py-1 text-[10px] font-mono rounded bg-ink-800 text-ink-300 hover:text-ink-100 ring-1 ring-ink-700 whitespace-nowrap"
                                title="Reset to default coach rate"
                              >
                                RESET
                              </button>
                            )}
                          </div>
                        </Field>
                        <Field
                          label={`Optional Transportation Fee (${db.academy?.currency || "USD"})`}
                          hint="Added to coach's session payout when verified ($0 default)"
                        >
                          <Input
                            type="number"
                            value={String(currentTransportVal)}
                            placeholder="0"
                            onChange={(v) => {
                              const val = v === "" ? 0 : Math.max(0, Number(v) || 0);
                              setForm({
                                ...form,
                                coachTransportFee: val,
                              });
                            }}
                          />
                        </Field>
                      </div>
                      {Boolean(form.assistantCoach?.trim()) && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 items-end gap-3 pt-2 border-t border-ink-800/80">
                          <Field
                            label={`Assistant Coach Session Fee (${db.academy?.currency || "USD"})`}
                            hint={`Assigned: ${form.assistantCoach}`}
                          >
                            <Input
                              type="number"
                              value={
                                form.assistantSessionFee !== undefined &&
                                form.assistantSessionFee !== null
                                  ? String(form.assistantSessionFee)
                                  : ""
                              }
                              placeholder="Default assistant rate"
                              onChange={(v) => {
                                const val = v === "" ? null : Math.max(0, Number(v) || 0);
                                setForm({ ...form, assistantSessionFee: val });
                              }}
                            />
                          </Field>
                          <Field
                            label={`Assistant Transportation Fee (${db.academy?.currency || "USD"})`}
                            hint="Optional transport fee for assistant coach"
                          >
                            <Input
                              type="number"
                              value={String(form.assistantTransportFee ?? 0)}
                              placeholder="0"
                              onChange={(v) => {
                                const val = v === "" ? 0 : Math.max(0, Number(v) || 0);
                                setForm({ ...form, assistantTransportFee: val });
                              }}
                            />
                          </Field>
                        </div>
                      )}
                    </div>
                  );
                })()}
            </>
          )}

          {form.kind === "Game" && (
            <>
              <Field label="Team A">
                <Input
                  value={form.teamA ?? ""}
                  onChange={(v) => setForm({ ...form, teamA: v })}
                  list="teams-list"
                />
              </Field>

              <Field label="Team B">
                <Input
                  value={form.teamB ?? ""}
                  onChange={(v) => setForm({ ...form, teamB: v })}
                  list="teams-list"
                />
              </Field>

              <Field label="Game Type">
                <Select
                  value={form.gameType ?? ""}
                  onChange={(v) => setForm({ ...form, gameType: v })}
                  options={["", ...(db.lists?.["Game types"] ?? [])]}
                />
              </Field>

              <Field label="Branch">
                {isBranchManager ? (
                  <div className="h-10 rounded-md bg-ink-850 px-3 py-2 font-mono text-xs text-court-300 ring-1 ring-ink-700 flex items-center justify-between">
                    <span>{userBranch}</span>
                    <span className="text-[10px] text-ink-500 uppercase">Assigned Facility</span>
                  </div>
                ) : (
                  <Select
                    value={form.branch ?? ""}
                    onChange={(v) => {
                      const b = db.branches.find((x) => x.name === v);
                      const courtName = b?.courts?.[0]?.name ?? "";
                      setForm({ ...form, branch: v, detail: courtName || form.detail });
                    }}
                    options={["", ...branches, "HQ"]}
                  />
                )}
              </Field>

              <Field label="Assigned Coach">
                <Input
                  value={form.coach ?? ""}
                  onChange={(v) => {
                    const matched = rawCoaches.find(
                      (c) => c.name.toLowerCase() === v.toLowerCase(),
                    );
                    const inheritedRate = matched?.rate ?? 0;
                    setForm({
                      ...form,
                      coach: v,
                      coachId: matched?.id,
                      headCoach: v,
                      headCoachId: matched?.id,
                      coachRate: form.rateOverwritten ? form.coachRate : inheritedRate,
                      coachSessionFee: form.rateOverwritten
                        ? (form.coachSessionFee ?? form.coachRate)
                        : inheritedRate,
                    });
                  }}
                  list="coaches-list"
                />
              </Field>

              {canManageSessionFee &&
                (() => {
                  const coachObj = rawCoaches.find(
                    (c) =>
                      (form.coachId && c.id === form.coachId) ||
                      c.name.toLowerCase() === (form.coach || form.headCoach || "").toLowerCase(),
                  );
                  const defaultRate = coachObj?.rate ?? 0;
                  const currentFeeVal =
                    form.coachSessionFee !== undefined && form.coachSessionFee !== null
                      ? form.coachSessionFee
                      : form.coachRate !== undefined
                        ? form.coachRate
                        : defaultRate;
                  const currentTransportVal = form.coachTransportFee ?? 0;

                  return (
                    <div className="sm:col-span-2 rounded-lg border border-ink-800 bg-ink-900/60 p-3 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-court-300">
                          Game Coach Fee &amp; Optional Transportation Allowance
                        </span>
                        <span className="rounded bg-court-500/15 px-2 py-0.5 font-mono text-[10px] text-court-300 ring-1 ring-court-500/30">
                          Default Coach Rate: {money(defaultRate)} — Editable for this game
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 items-end gap-3">
                        <Field
                          label={`Coach Game Fee (${db.academy?.currency || "USD"})`}
                          hint="Editable for this specific game session"
                        >
                          <Input
                            type="number"
                            value={currentFeeVal !== undefined ? String(currentFeeVal) : ""}
                            placeholder={String(defaultRate || 50)}
                            onChange={(v) => {
                              const val = v === "" ? undefined : Number(v);
                              setForm({
                                ...form,
                                coachRate: val,
                                coachSessionFee: val ?? null,
                                rateOverwritten: val !== undefined && val !== defaultRate,
                                rateOverwrittenBy:
                                  currentUser?.name || currentUser?.role || "Branch Manager",
                              });
                            }}
                          />
                        </Field>
                        <Field
                          label={`Optional Transportation Fee (${db.academy?.currency || "USD"})`}
                          hint="Added to coach's game payout when verified ($0 default)"
                        >
                          <Input
                            type="number"
                            value={String(currentTransportVal)}
                            placeholder="0"
                            onChange={(v) => {
                              const val = v === "" ? 0 : Math.max(0, Number(v) || 0);
                              setForm({
                                ...form,
                                coachTransportFee: val,
                              });
                            }}
                          />
                        </Field>
                      </div>
                    </div>
                  );
                })()}

              <Field label="Date">
                <Input
                  type="date"
                  value={form.date ?? ""}
                  onChange={(v) => setForm({ ...form, date: v })}
                />
              </Field>

              <Field label="Start Time">
                <Input
                  type="time"
                  value={form.time ?? ""}
                  onChange={(v) => setForm({ ...form, time: v })}
                />
              </Field>

              <Field label="End Time">
                <Input
                  type="time"
                  value={form.endTime ?? ""}
                  onChange={(v) => setForm({ ...form, endTime: v })}
                />
              </Field>

              <Field label="Location / Court">
                {(() => {
                  const branchObj = rawBranches.find(
                    (b) => b.name?.toLowerCase() === (form.branch || "").toLowerCase(),
                  );
                  const branchCourts = (branchObj?.courts || []).filter((c) => c.name?.trim());
                  const matchedCourt = branchCourts.find(
                    (c) => c.name.toLowerCase() === (form.detail || form.court || "").toLowerCase(),
                  );
                  const courtSchedule =
                    matchedCourt?.schedule ||
                    matchedCourt?.operatingHours ||
                    branchObj?.operatingHours ||
                    "";

                  return (
                    <div className="space-y-1.5">
                      {branchCourts.length > 0 && (
                        <Select
                          value={matchedCourt ? matchedCourt.name : form.detail ? "__custom__" : ""}
                          onChange={(v) => {
                            if (v === "__custom__") {
                              setForm({ ...form, detail: "", court: "" });
                            } else if (v) {
                              setForm({ ...form, detail: v, court: v });
                            }
                          }}
                          options={["", ...branchCourts.map((c) => c.name), "__custom__"]}
                        />
                      )}
                      {(!matchedCourt || branchCourts.length === 0) && (
                        <Input
                          value={form.detail ?? ""}
                          placeholder="Select branch court above or enter custom venue"
                          onChange={(v) => setForm({ ...form, detail: v, court: v })}
                        />
                      )}
                      {courtSchedule && (
                        <div className="rounded bg-ink-900/80 px-2 py-1 font-mono text-[10px] text-court-300 ring-1 ring-ink-800">
                          Court Schedule ({matchedCourt?.name || "Branch Master"}):{" "}
                          <span className="text-ink-100">{courtSchedule}</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </Field>

              <Field
                label="Court Allocation (Full vs. Half Court HCA / HCB)"
                hint="Full Court occupies both HCA & HCB. HCA and HCB allow simultaneous bookings."
              >
                <Select
                  value={form.courtAllocation || "Full Court"}
                  onChange={(v) => setForm({ ...form, courtAllocation: v as CourtAllocationType })}
                  options={COURT_ALLOCATION_OPTIONS}
                />
              </Field>

              <GameOfficialsForm
                referees={form.referees || []}
                matchStaff={form.matchStaff || []}
                onChangeReferees={(referees) => setForm({ ...form, referees })}
                onChangeMatchStaff={(matchStaff) => setForm({ ...form, matchStaff })}
              />
            </>
          )}

          {form.kind !== "Practice" && form.kind !== "Game" && (
            <>
              <Field label="Date">
                <Input
                  type="date"
                  value={form.date ?? ""}
                  onChange={(v) => setForm({ ...form, date: v })}
                />
              </Field>
              <Field label="Time">
                <Input
                  type="time"
                  value={form.time ?? ""}
                  onChange={(v) => setForm({ ...form, time: v })}
                />
              </Field>
              <Field label="Branch">
                {isBranchManager ? (
                  <div className="h-10 rounded-md bg-ink-850 px-3 py-2 font-mono text-xs text-court-300 ring-1 ring-ink-700 flex items-center justify-between">
                    <span>{userBranch}</span>
                    <span className="text-[10px] text-ink-500 uppercase">Assigned Facility</span>
                  </div>
                ) : (
                  <Select
                    value={form.branch ?? ""}
                    onChange={(v) => setForm({ ...form, branch: v })}
                    options={["", ...branches, "HQ"]}
                  />
                )}
              </Field>
              <Field label="Coach">
                <Input
                  value={form.coach ?? ""}
                  onChange={(v) => setForm({ ...form, coach: v })}
                  list="coaches-list"
                />
              </Field>
              <Field label="Court / Venue Detail">
                {(() => {
                  const branchObj = rawBranches.find(
                    (b) => b.name?.toLowerCase() === (form.branch || "").toLowerCase(),
                  );
                  const branchCourts = (branchObj?.courts || []).filter((c) => c.name?.trim());
                  const matchedCourt = branchCourts.find(
                    (c) => c.name.toLowerCase() === (form.detail || form.court || "").toLowerCase(),
                  );
                  const courtSchedule =
                    matchedCourt?.schedule ||
                    matchedCourt?.operatingHours ||
                    branchObj?.operatingHours ||
                    "";

                  return (
                    <div className="space-y-1.5">
                      {branchCourts.length > 0 && (
                        <Select
                          value={matchedCourt ? matchedCourt.name : form.detail ? "__custom__" : ""}
                          onChange={(v) => {
                            if (v === "__custom__") {
                              setForm({ ...form, detail: "", court: "" });
                            } else if (v) {
                              setForm({ ...form, detail: v, court: v });
                            }
                          }}
                          options={["", ...branchCourts.map((c) => c.name), "__custom__"]}
                        />
                      )}
                      {(!matchedCourt || branchCourts.length === 0) && (
                        <Input
                          value={form.detail ?? ""}
                          placeholder="Enter court or venue detail"
                          onChange={(v) => setForm({ ...form, detail: v, court: v })}
                        />
                      )}
                      {courtSchedule && (
                        <div className="rounded bg-ink-900/80 px-2 py-1 font-mono text-[10px] text-court-300 ring-1 ring-ink-800">
                          Court Schedule ({matchedCourt?.name || "Branch Master"}):{" "}
                          <span className="text-ink-100">{courtSchedule}</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </Field>
              <Field
                label={`Coach Session Rate (${db.academy?.currency || "USD"})`}
                hint={
                  form.rateOverwritten
                    ? `Overwritten by ${form.rateOverwrittenBy || "Manager"}`
                    : "Inherited from coach profile"
                }
              >
                <Input
                  type="number"
                  value={form.coachRate !== undefined ? String(form.coachRate) : ""}
                  placeholder="e.g. 50"
                  onChange={(v) => {
                    const val = v === "" ? undefined : Number(v);
                    setForm({
                      ...form,
                      coachRate: val,
                      rateOverwritten: true,
                      rateOverwrittenBy: currentUser?.name || currentUser?.role || "Branch Manager",
                    });
                  }}
                />
              </Field>
            </>
          )}

          {form.kind === "Practice" ? (
            <Field
              label="Status (Optional)"
              hint="Optional for practices. Defaults to 'Planned' if left unselected."
            >
              <Select
                value={form.status || "Planned"}
                onChange={(v) =>
                  setForm({ ...form, status: (v || "Planned") as SessionItem["status"] })
                }
                options={["Planned", "Live", "Completed", "Cancelled"]}
              />
            </Field>
          ) : (
            <div className="sm:col-span-2">
              {requireGameConfirmation ? (
                <div className="rounded-lg bg-warn/10 border border-warn/30 p-3 text-xs flex items-center justify-between">
                  <div>
                    <span className="font-bold text-warn">
                      Status: {editing ? editing.status || "Pending approval" : "Pending approval"}
                    </span>
                    <p className="text-[11px] text-ink-300 mt-0.5">
                      Technical Director confirmation is required by academy policy for games.
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded text-[10px] font-mono font-bold bg-warn/20 text-warn border border-warn/40">
                    TD Confirmation Required
                  </span>
                </div>
              ) : (
                <div className="rounded-lg bg-good/10 border border-good/30 p-3 text-xs flex items-center justify-between">
                  <div>
                    <span className="font-bold text-good">
                      Status: {editing ? editing.status || "Official" : "Official"}
                    </span>
                    <p className="text-[11px] text-ink-300 mt-0.5">
                      Technical Director auto-confirmation policy is active. Games are immediately
                      official.
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded text-[10px] font-mono font-bold bg-good/20 text-good border border-good/40">
                    Auto-Confirmed
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Live Session Cost Summary & Court Allocation Conflict Check */}
          {(() => {
            const candidateBranch = isBranchManager ? userBranch : form.branch || "HQ";
            const candidateCourt = form.court || form.detail || "";
            const costSummary = calculateSessionTotalCostSummary(
              {
                ...form,
                branch: candidateBranch,
                court: candidateCourt,
              },
              rawBranches,
              rawCoaches,
              rawTeams,
            );
            const conflictPreview = checkCourtScheduleConflict(
              {
                ...form,
                branch: candidateBranch,
                court: candidateCourt || costSummary.courtName,
              },
              db.sessions || [],
              editing?.id,
              db.courtReservations || [],
              undefined,
              rawBranches,
            );
            return (
              <div className="sm:col-span-2 rounded-lg bg-ink-950/80 p-3.5 ring-1 ring-ink-800 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-800 pb-2">
                  <div>
                    <span className="font-mono text-xs font-bold uppercase text-court-300 block">
                      Session Cost Summary &amp; Court Allocation Impact
                    </span>
                    <span className="font-mono text-[10px] text-ink-400">
                      {costSummary.courtName} ({candidateBranch}) · {costSummary.allocation} ·{" "}
                      {costSummary.durationHours} hr(s) × {money(costSummary.hourlyRate)}/hr
                    </span>
                  </div>
                  <span className="rounded bg-court-500/15 px-2.5 py-1 font-mono text-xs font-bold text-court-300 ring-1 ring-court-500/30">
                    Total Session Cost: {money(costSummary.totalDirectCost)}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xs">
                  <div className="rounded bg-ink-900 p-2 ring-1 ring-ink-800">
                    <span className="block text-[9px] uppercase text-ink-400">
                      Court Rental ({costSummary.isHalfCourt ? "Half Rate" : "Full Rate"})
                    </span>
                    <span className="font-bold text-court-300">
                      {money(costSummary.rentalCost)}
                    </span>
                    <span className="block text-[9px] text-ink-500">
                      {costSummary.durationHours}h × {money(costSummary.hourlyRate)}/hr
                    </span>
                  </div>
                  <div className="rounded bg-ink-900 p-2 ring-1 ring-ink-800">
                    <span className="block text-[9px] uppercase text-ink-400">Head Coach Cost</span>
                    <span className="font-bold text-ink-100">
                      {money(costSummary.headCoachCost)}
                    </span>
                  </div>
                  <div className="rounded bg-ink-900 p-2 ring-1 ring-ink-800">
                    <span className="block text-[9px] uppercase text-ink-400">Assistant Cost</span>
                    <span className="font-bold text-ink-100">
                      {money(costSummary.assistantCoachCost)}
                    </span>
                  </div>
                  <div className="rounded bg-ink-900 p-2 ring-1 ring-ink-800">
                    <span className="block text-[9px] uppercase text-ink-400">Match Officials</span>
                    <span className="font-bold text-ink-100">
                      {money(costSummary.officialsCost)}
                    </span>
                  </div>
                </div>

                {conflictPreview.hasCourtConflict ? (
                  <div className="rounded bg-bad/15 px-3 py-2 font-mono text-[11px] text-bad ring-1 ring-bad/40 font-semibold">
                    ⚠️ {conflictPreview.courtConflictReason}
                  </div>
                ) : conflictPreview.simultaneousHalfCourtSession ? (
                  <div className="rounded bg-court-500/15 px-3 py-2 font-mono text-[11px] text-court-300 ring-1 ring-court-500/40">
                    ✓ Simultaneous Half-Court Operation: Shares {costSummary.courtName} with &quot;
                    {conflictPreview.simultaneousHalfCourtSession.title}&quot; (
                    {conflictPreview.simultaneousHalfCourtSession.courtAllocation || "Half Court"})
                    without conflict.
                  </div>
                ) : (
                  <div className="rounded bg-good/10 px-3 py-1.5 font-mono text-[10px] text-good ring-1 ring-good/30">
                    ✓ Court time slot available for {costSummary.allocation}.
                  </div>
                )}
              </div>
            );
          })()}
        </div>
        <datalist id="coaches-list">
          {(() => {
            const branchCoaches = form.branch
              ? rawCoaches.filter((c) => coachMatchesBranch(c, form.branch))
              : rawCoaches;
            const list = branchCoaches.length > 0 ? branchCoaches : rawCoaches;
            return list.map((c) => <option key={c.id} value={c.name} />);
          })()}
        </datalist>
        <datalist id="teams-list">
          {rawTeams.map((t) => (
            <option key={t.id} value={t.name} />
          ))}
        </datalist>
      </Modal>

      <Modal
        open={attendFor !== null}
        title={attendFor ? `Attendance · ${attendFor.title}` : ""}
        meta={
          attendFor
            ? `${presentCount} Present · ${excusedCount} Excused · ${absentCount} Absent (${roster.length} Total)`
            : ""
        }
        onClose={() => {
          setAttendFor(null);
          setScannedPlayerId(null);
        }}
        wide
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-800 p-4 pb-3">
          <div className="text-xs text-court-300">
            <span className="font-semibold text-ink-100">Pitch-side Check-In:</span> Scan passes
            with camera turnstile or toggle manual P/E/A buttons.
          </div>
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-court-500 hover:bg-court-400 text-ink-950 font-mono text-xs font-bold shadow transition-colors"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>📷 Scan Player QR</span>
          </button>
        </div>

        {scannedPlayer && attendFor && (
          <div className="mx-4 mt-3 rounded-lg border border-court-500/40 bg-court-500/10 p-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wider font-bold text-court-300 bg-court-500/20 px-2 py-0.5 rounded">
                  QR Scanned Player
                </span>
                <span className="text-sm font-bold text-ink-100">{scannedPlayer.name}</span>
                <span className="font-mono text-xs text-ink-400">
                  ({scannedPlayer.category} · {scannedPlayer.teams?.join(", ") || "No team"})
                </span>
              </div>
              <div className="mt-1 font-mono text-[11px] text-ink-300">
                Next Session: <strong className="text-ink-100">{attendFor.title}</strong> (
                {attendFor.date} at {attendFor.time}) · Status:{" "}
                <strong className="text-court-300">
                  {attendanceRecords[scannedPlayer.id] || "Not marked yet"}
                </strong>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {attendanceRecords[scannedPlayer.id] !== "Present" ? (
                <button
                  type="button"
                  onClick={() => {
                    setAttendance(scannedPlayer.id, "Present");
                    toast.success(`Marked ${scannedPlayer.name} PRESENT for ${attendFor.title}`);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md bg-good px-3 py-1.5 font-mono text-xs font-bold text-ink-950 shadow hover:opacity-90 transition-opacity"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Mark Present</span>
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-md bg-good/20 px-2.5 py-1 font-mono text-xs font-bold text-good ring-1 ring-good/40">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Checked In (Present)</span>
                </span>
              )}
              <Link
                to="/players"
                search={{ playerId: scannedPlayer.id } as never}
                onClick={() => {
                  setAttendFor(null);
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-ink-850 px-3 py-1.5 font-mono text-xs font-semibold text-court-300 ring-1 ring-court-500/40 hover:bg-ink-800 transition-colors"
              >
                <span>Player Profile</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        )}

        <div className="max-h-[60vh] space-y-1 overflow-y-auto p-4">
          {roster.length === 0 ? (
            <div className="py-8 text-center font-mono text-[11px] text-ink-400">
              No players registered for this branch yet.
            </div>
          ) : (
            roster.map((p) => {
              const status = attendanceRecords[p.id] || "Absent";
              const isBlocked =
                p.status?.toLowerCase() === "inactive" || p.status?.toLowerCase() === "suspended";
              const player30d = calculatePlayer30DayAttendance(p.id, p, sessions, db.attendance);
              const isScannedHighlight = scannedPlayer?.id === p.id;
              return (
                <div
                  key={p.id}
                  className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left ring-1 transition-colors ${
                    isScannedHighlight
                      ? "bg-court-500/15 ring-court-400"
                      : status === "Present"
                        ? "bg-good/10 ring-good/40"
                        : status === "Excused"
                          ? "bg-accent/10 ring-accent/40"
                          : "bg-ink-850 ring-ink-700"
                  } ${isBlocked ? "opacity-45" : ""}`}
                >
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-ink-100">{p.name}</span>
                      <Link
                        to="/players"
                        search={{ playerId: p.id } as never}
                        onClick={() => setAttendFor(null)}
                        className="inline-flex items-center gap-1 rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[9px] text-court-400 ring-1 ring-ink-700 hover:text-court-300 hover:ring-court-500/40 transition-colors"
                        title={`Open ${p.name}'s profile`}
                      >
                        <span>Profile</span>
                        <ExternalLink className="w-2.5 h-2.5" />
                      </Link>
                      {isBlocked && (
                        <span className="rounded bg-bad/20 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-bad ring-1 ring-bad/30">
                          {p.status}
                        </span>
                      )}
                      {player30d.isLowAttendance && (
                        <span
                          className="rounded bg-warn/15 px-1.5 py-0.5 font-mono text-[9px] font-medium text-warn ring-1 ring-warn/30"
                          title={`30-day attendance rate: ${player30d.rate}%`}
                        >
                          ⚠️ {player30d.rate}% ATT
                        </span>
                      )}
                      {(() => {
                        const allowedCap = Number(p.allowedPracticesPerMonth || 0);
                        if (allowedCap <= 0) return null;
                        const mtdPresent = getPlayerMonthlyPresentCount(
                          p.id,
                          sessions,
                          db.attendance,
                          attendFor?.date?.slice(0, 7),
                        );
                        const isOverCap = allowedCap < 999 && mtdPresent > allowedCap;
                        return (
                          <span
                            className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold ${
                              isOverCap
                                ? "bg-bad/20 text-bad ring-1 ring-bad/40"
                                : "bg-court-500/15 text-court-300 ring-1 ring-court-500/30"
                            }`}
                          >
                            {isOverCap
                              ? `⚠️ ${mtdPresent}/${allowedCap} Practices Used (Limit Exceeded)`
                              : `${mtdPresent}/${allowedCap >= 999 ? "∞" : allowedCap} Practices`}
                          </span>
                        );
                      })()}
                    </span>
                    <span className="block font-mono text-[10px] text-ink-400">
                      {p.category} · {p.teams?.length ? p.teams.join(", ") : "no team"}
                    </span>
                    {p.status !== "Active" ? (
                      <span className="block font-mono text-[9px] text-warn mt-1">
                        {isBlocked ? "BLOCKED · ON HOLD" : "PAYMENT DUE"}
                      </span>
                    ) : null}
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={isBlocked}
                      onClick={() => setAttendance(p.id, "Absent")}
                      className={`rounded px-2 py-1 font-mono text-[10px] ring-1 transition-colors ${
                        status === "Absent"
                          ? "bg-bad text-white ring-bad"
                          : "text-ink-400 ring-ink-700 hover:bg-ink-800"
                      } ${isBlocked ? "cursor-not-allowed opacity-40" : ""}`}
                    >
                      ABSENT
                    </button>
                    <button
                      type="button"
                      disabled={isBlocked}
                      onClick={() => setAttendance(p.id, "Excused")}
                      className={`rounded px-2 py-1 font-mono text-[10px] ring-1 transition-colors ${
                        status === "Excused"
                          ? "bg-warn text-ink-950 ring-warn"
                          : "text-ink-400 ring-ink-700 hover:bg-ink-800"
                      } ${isBlocked ? "cursor-not-allowed opacity-40" : ""}`}
                    >
                      EXCUSED
                    </button>
                    <button
                      type="button"
                      disabled={isBlocked}
                      onClick={() => setAttendance(p.id, "Present")}
                      className={`rounded px-2 py-1 font-mono text-[10px] ring-1 transition-colors ${
                        status === "Present"
                          ? "bg-good text-ink-950 ring-good"
                          : "text-ink-400 ring-ink-700 hover:bg-ink-800"
                      } ${isBlocked ? "cursor-not-allowed opacity-40" : ""}`}
                    >
                      PRESENT
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {attendFor && (
          <div className="border-t border-ink-800 bg-ink-900/60 p-4 space-y-3">
            {canManageSessionFee &&
              (() => {
                const targetCoachName = (attendFor.coach || attendFor.headCoach || "").trim();
                const matchedAttendCoach = rawCoaches.find(
                  (c) =>
                    (attendFor.coachId && c.id === attendFor.coachId) ||
                    (attendFor.headCoachId && c.id === attendFor.headCoachId) ||
                    (targetCoachName && c.name.toLowerCase() === targetCoachName.toLowerCase()),
                );
                const defaultRate = matchedAttendCoach?.rate ?? 0;
                const parsedFee =
                  attendCoachFee.trim() !== ""
                    ? Math.max(0, Number(attendCoachFee) || 0)
                    : defaultRate;
                const parsedTransport = Math.max(0, Number(attendTransportFee) || 0);
                const totalSessionPayout = Math.round((parsedFee + parsedTransport) * 100) / 100;

                return (
                  <div className="rounded-lg border border-ink-800 bg-ink-950/70 p-3 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-court-300">
                        Coach Session Fee &amp; Transportation Verification
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-ink-850 px-2 py-0.5 font-mono text-[10px] text-ink-300 ring-1 ring-ink-700">
                          Default Coach Rate: {money(defaultRate)} — Editable for this session
                        </span>
                        <span className="rounded bg-court-500/15 px-2 py-0.5 font-mono text-[10px] font-bold text-court-300 ring-1 ring-court-500/30">
                          Session Total: {money(parsedFee)}
                          {parsedTransport > 0
                            ? ` + ${money(parsedTransport)} Transport`
                            : ""} = {money(totalSessionPayout)}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-end">
                      <div>
                        <span className="text-[10px] font-mono uppercase text-ink-400 block mb-1">
                          Coach Session Fee ({db.academy?.currency || "USD"})
                        </span>
                        <Input
                          type="number"
                          value={attendCoachFee}
                          placeholder={String(defaultRate || 50)}
                          onChange={(v) => setAttendCoachFee(v)}
                        />
                      </div>
                      <div>
                        <span className="text-[10px] font-mono uppercase text-ink-400 block mb-1">
                          Optional Transportation Fee ({db.academy?.currency || "USD"})
                        </span>
                        <Input
                          type="number"
                          value={attendTransportFee}
                          placeholder="0"
                          onChange={(v) => setAttendTransportFee(v)}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          patchEntity("sessions", attendFor.id, {
                            coachRate: parsedFee,
                            coachSessionFee: parsedFee,
                            coachTransportFee: parsedTransport,
                            rateOverwritten: parsedFee !== defaultRate,
                            rateOverwrittenBy:
                              currentUser?.name || currentUser?.role || "Branch Manager",
                            coachAttendance: coachPresenceStatus,
                          });
                          setAttendFor({
                            ...attendFor,
                            coachRate: parsedFee,
                            coachSessionFee: parsedFee,
                            coachTransportFee: parsedTransport,
                            rateOverwritten: parsedFee !== defaultRate,
                            coachAttendance: coachPresenceStatus,
                          });
                          toast.success(
                            `Saved session fee (${money(parsedFee)}) + transport (${money(parsedTransport)}) = ${money(totalSessionPayout)} for ${attendFor.coach || attendFor.headCoach || "Coach"}.`,
                          );
                        }}
                        className="rounded-md bg-ink-800 hover:bg-ink-750 px-3 py-2 font-mono text-xs font-semibold text-court-300 ring-1 ring-court-500/40 transition-colors"
                      >
                        Save Session &amp; Transport Fee
                      </button>
                    </div>
                  </div>
                );
              })()}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-xs text-ink-300 font-mono">
                  Coach:{" "}
                  <strong className="text-ink-100">
                    {attendFor.coach || attendFor.headCoach || "Assigned Coach"}
                  </strong>
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="text-ink-400 font-mono text-[11px]">Coach Presence:</span>
                  <select
                    value={coachPresenceStatus}
                    onChange={(e) =>
                      setCoachPresenceStatus(e.target.value as "Present" | "Absent" | "Excused")
                    }
                    className="rounded bg-ink-850 border border-ink-700 px-2 py-1 text-xs text-ink-100 font-mono focus:border-court-500"
                  >
                    <option value="Present">Present (Verified)</option>
                    <option value="Absent">Absent</option>
                    <option value="Excused">Excused</option>
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {attendFor.kind === "Practice" && (
                  <button
                    type="button"
                    onClick={() => {
                      if (coachPresenceStatus !== "Present") {
                        toast.error(
                          "Practice sessions require the coach to be marked Present to complete.",
                        );
                        return;
                      }
                      const targetCoachName = (attendFor.coach || attendFor.headCoach || "").trim();
                      const matchedAttendCoach = rawCoaches.find(
                        (c) =>
                          (attendFor.coachId && c.id === attendFor.coachId) ||
                          (attendFor.headCoachId && c.id === attendFor.headCoachId) ||
                          (targetCoachName &&
                            c.name.toLowerCase() === targetCoachName.toLowerCase()),
                      );
                      const defaultRate = matchedAttendCoach?.rate ?? 0;
                      const parsedFee =
                        attendCoachFee.trim() !== ""
                          ? Math.max(0, Number(attendCoachFee) || 0)
                          : defaultRate;
                      const parsedTransport = Math.max(0, Number(attendTransportFee) || 0);

                      patchEntity("sessions", attendFor.id, {
                        status: "Completed",
                        coachAttendance: "Present",
                        ...(canManageSessionFee
                          ? {
                              coachRate: parsedFee,
                              coachSessionFee: parsedFee,
                              coachTransportFee: parsedTransport,
                              rateOverwritten: parsedFee !== defaultRate,
                              rateOverwrittenBy:
                                currentUser?.name || currentUser?.role || "Branch Manager",
                            }
                          : {}),
                      });
                      toast.success(
                        `Practice "${attendFor.title}" completed and coach attendance verified as Present.`,
                      );
                      setAttendFor(null);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md bg-good px-3 py-1.5 font-mono text-xs font-bold text-ink-950 shadow hover:opacity-90 transition-opacity"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Complete Practice (Verify Attendance &amp; Coach Present)</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </Modal>

      <QrAttendanceScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        session={attendFor}
        defaultSessionId={attendFor?.id}
        roster={roster}
      />

      {gameScoreModal && (
        <Modal
          open={!!gameScoreModal}
          title={`Submit Final Score & Report · ${gameScoreModal.title}`}
          meta={`Game · ${gameScoreModal.date} at ${gameScoreModal.time}`}
          onClose={() => {
            setGameScoreModal(null);
            setGameScore("");
            setGameReport("");
          }}
          onSubmit={handleSaveGameScoreAndReport}
          submitLabel="Complete Game & Submit Report"
        >
          <div className="p-4 space-y-4">
            <div className="rounded bg-ink-850 p-3 border border-ink-700 text-xs text-ink-300">
              <p>
                Games are officially completed when the coach or branch manager submits the final
                match score and technical match report.
              </p>
            </div>

            <Field label="Final Score (Required)" hint="Format: e.g. 88 - 82">
              <Input placeholder="e.g. 88 - 82" value={gameScore} onChange={setGameScore} />
            </Field>

            <Field label="Match Report & Technical Notes (Required)">
              <Textarea
                placeholder="Provide game overview, key player performances, defensive schemes, fouls/cards..."
                value={gameReport}
                onChange={setGameReport}
                rows={4}
              />
            </Field>
          </div>
        </Modal>
      )}

      {shareSession && (
        <WhatsAppShareModal
          open={!!shareSession}
          onClose={() => setShareSession(null)}
          session={shareSession}
        />
      )}

      <Modal
        open={Boolean(deleteTarget)}
        title="Delete session"
        meta={deleteTarget ? `Remove "${deleteTarget.title}"` : undefined}
        onClose={() => setDeleteTarget(null)}
        onSubmit={confirmRemove}
        submitLabel="Delete session"
      >
        <div className="p-4 text-sm text-ink-200">
          Are you sure you want to delete{" "}
          <span className="font-semibold text-ink-100">{deleteTarget?.title}</span>? This action
          cannot be undone.
        </div>
      </Modal>
    </AppShell>
  );
}

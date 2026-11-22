import { createFileRoute } from "@tanstack/react-router";
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
  Th,
  Toggle,
  money,
} from "@/components/kit";
import {
  useDB,
  useTenantUser,
  useModulePermissions,
  getCoachBranches,
  coachMatchesBranch,
  getCoachTeams,
} from "@/lib/data-store";
import { useAuth, provisionFirebaseAuthUser } from "@/lib/auth";
import {
  uploadCoachLicense,
  uploadDocumentAttachment,
  type DocumentAttachment,
} from "@/lib/storage";
import { toast } from "sonner";
import type { Coach } from "@/lib/mock-data";
import {
  calculateAttendanceVerifiedPayroll,
  isSessionAttendanceVerified,
  computeSessionCoachPayout,
} from "@/lib/payroll";
import { CoachStatementModal } from "@/components/coach-statement-modal";
import { createAcademyNotification } from "@/lib/notifications";
import { FileText, Upload, Trash2 } from "lucide-react";

function exportCSV(
  listName: string,
  coachesList: Coach[],
  db?: { lists?: Record<string, string[]> },
) {
  const headers = ["Coach,Phone,Level,Rate,Outstanding"];
  const rows = coachesList.map(
    (c) =>
      `"${c.name}","${c.phone}","${(db?.lists?.["Coaching levels"] || db?.lists?.["Coach levels"])?.find((l: string) => l.toLowerCase() === c.level.toLowerCase()) || c.level}",${c.rate},${c.outstanding}`,
  );
  const csv = headers.concat(rows).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Vescio_${listName}_Coach_Payments_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function exportPDF(
  listName: string,
  coachesList: Coach[],
  db?: { lists?: Record<string, string[]> },
) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF();
  doc.text(`Vescio Vector - ${listName} Coach Payments`, 14, 15);
  autoTable(doc, {
    startY: 20,
    head: [["Coach", "Phone", "Level", "Rate", "Outstanding"]],
    body: coachesList.map((c) => [
      c.name,
      c.phone,
      (db?.lists?.["Coaching levels"] || db?.lists?.["Coach levels"])?.find(
        (l: string) => l.toLowerCase() === c.level.toLowerCase(),
      ) || c.level,
      String(c.rate),
      String(c.outstanding),
    ]),
  });
  doc.save(`Vescio_${listName}_Coach_Payments.pdf`);
}

export const Route = createFileRoute("/coaches")({
  head: () => ({
    meta: [
      { title: "Coaches — Vescio Vector" },
      {
        name: "description",
        content:
          "Coach database with levels, portal access, win-loss records, session counts and outstanding balances.",
      },
      { property: "og:title", content: "Coaches — Vescio Vector" },
      {
        property: "og:description",
        content: "Manage coaches, their records, payments and portal access.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CoachesPage,
});

const blank: Omit<Coach, "id"> = {
  name: "",
  phone: "",
  years: 0,
  level: "",
  gender: "M",
  wins: 0,
  losses: 0,
  sessions: 0,
  sessionTarget: 30,
  outstanding: 0,
  branch: "",
  branches: [],
  teams: [],
  portal: false,
  rate: 25,
  rateType: "per_session",
  email: "",
};

function CoachesPage() {
  const {
    db,
    update,
    setEntity,
    patchEntity,
    deleteEntity,
    editLedgerTransaction,
    deleteLedgerTransaction,
    tenantId,
    ready,
  } = useDB();
  const { user: authUser, passwordUser, loading: authLoading } = useAuth();
  const currentUser = useTenantUser();
  const roleLower = (currentUser?.role || "").toLowerCase();
  const canManageCompensation =
    Boolean(currentUser) &&
    (currentUser?.role === "Super Admin" ||
      currentUser?.role === "Academy Manager" ||
      currentUser?.role === "Technical Director" ||
      currentUser?.role === "Accountant" ||
      currentUser?.role === "Branch Manager" ||
      roleLower.includes("super") ||
      roleLower.includes("director") ||
      roleLower.includes("accountant") ||
      roleLower.includes("branch"));

  const coaches = db.coaches;
  const branches = db.branches.map((b) => b.name);

  const [q, setQ] = useState("");
  const [level, setLevel] = useState("");
  const [branch, setBranch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Coach | null>(null);
  const [form, setForm] = useState<Omit<Coach, "id">>(blank);
  const [selected, setSelected] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [payMode, setPayMode] = useState("By rate");
  const [payAmount, setPayAmount] = useState("0");
  const [payNote, setPayNote] = useState("");
  const [advanceReason, setAdvanceReason] = useState("");
  const [linkedAdvanceSessionsCount, setLinkedAdvanceSessionsCount] = useState("");
  const [validatingAdvanceLedger, setValidatingAdvanceLedger] = useState<{
    id: string;
    advanceReason: string;
    linkedAdvanceSessionsCount: string;
  } | null>(null);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [licenseUploading, setLicenseUploading] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);
  const [showAllCoachPayouts, setShowAllCoachPayouts] = useState(false);
  const [editingSessionFee, setEditingSessionFee] = useState<{
    sessionId: string;
    sessionFee: string;
    transportFee: string;
    isAssistant: boolean;
  } | null>(null);

  const { canWrite: canWriteStaff, canDelete: canDeleteStaff } = useModulePermissions("staff");
  const isBranchManager =
    (currentUser?.role === "Branch Manager" ||
      currentUser?.branchScope === "Assigned branch only") &&
    Boolean(currentUser?.branch);
  const userBranch = isBranchManager ? currentUser?.branch || "" : "";

  const accessibleCoaches = isBranchManager
    ? coaches.filter((c) => coachMatchesBranch(c, userBranch))
    : coaches;

  const filtered = accessibleCoaches.filter((c) => {
    const needle = q.trim().toLowerCase();
    const cBranches = getCoachBranches(c);
    const cTeams = getCoachTeams(c, db.teams);
    return (
      (!needle ||
        [c.name, c.phone, c.email, ...cBranches, ...cTeams]
          .join(" ")
          .toLowerCase()
          .includes(needle)) &&
      (!level || c.level === level) &&
      (isBranchManager || !branch || coachMatchesBranch(c, branch))
    );
  });

  const now = new Date();
  const currentMonthName = now.toLocaleString("en-US", { month: "long" });
  const currentMonthIndex = now.getMonth();
  const currentYear = now.getFullYear();

  const payrollComputation = useMemo(() => {
    return calculateAttendanceVerifiedPayroll(db, {
      monthIndex: currentMonthIndex,
      monthName: currentMonthName,
      year: currentYear,
    });
  }, [db, currentMonthIndex, currentMonthName, currentYear]);

  const coachPayrollMap = useMemo(() => {
    const map = new Map<
      string,
      {
        sessions: number;
        outstanding: number;
        netBalance: number;
        advanceBalance: number;
        hasAdvance: boolean;
        totalEarned: number;
        totalDisbursed: number;
        totalPayout: number;
      }
    >();
    payrollComputation.rows.forEach((row) => {
      map.set(row.coachId, {
        sessions: row.verifiedCompletedSessionsCount,
        outstanding: row.netBalance,
        netBalance: row.netBalance,
        advanceBalance: row.advanceBalance,
        hasAdvance: row.hasAdvance,
        totalEarned: row.totalEarned,
        totalDisbursed: row.totalDisbursed,
        totalPayout: row.totalPayout,
      });
    });
    return map;
  }, [payrollComputation]);

  const outstanding = accessibleCoaches.reduce(
    (a, c) => a + Math.max(0, coachPayrollMap.get(c.id)?.outstanding ?? c.outstanding),
    0,
  );
  const portalCount = accessibleCoaches.filter((c) => c.portal).length;
  const sessionsTarget = accessibleCoaches.reduce((a, c) => a + c.sessionTarget, 0);
  const detail = accessibleCoaches.find((c) => c.id === selected) ?? accessibleCoaches[0];

  const coachStatsMap = useMemo(() => {
    const map = new Map<string, { wins: number; losses: number; completedSessions: number }>();
    const sessionList = db.sessions || [];
    const teamList = db.teams || [];

    coaches.forEach((c) => {
      const cNameLower = c.name?.toLowerCase().trim();
      const coachTeamNames = new Set(
        getCoachTeams(c, teamList).map((tName) => tName.toLowerCase().trim()),
      );

      const matchedSessions = sessionList.filter((s) => {
        return (
          (s.coachId && s.coachId === c.id) ||
          (s.headCoachId && s.headCoachId === c.id) ||
          Boolean(
            cNameLower &&
            ((s.coach && s.coach.toLowerCase().trim() === cNameLower) ||
              (s.headCoach && s.headCoach.toLowerCase().trim() === cNameLower)),
          ) ||
          (s.kind === "Game" &&
            Boolean(
              (s.teamA && coachTeamNames.has(s.teamA.toLowerCase().trim())) ||
              (s.teamB && coachTeamNames.has(s.teamB.toLowerCase().trim())),
            ))
        );
      });

      const completed = matchedSessions.filter((s) => {
        const st = (s.status || "").toLowerCase();
        return st === "completed" || st === "official";
      });

      let wins = 0;
      let losses = 0;
      let hasGameStats = false;
      completed.forEach((s) => {
        if (s.kind === "Game" && s.score) {
          const parts = s.score.split("-").map((p) => parseInt(p.trim(), 10));
          const p0 = parts[0];
          const p1 = parts[1];
          if (
            parts.length === 2 &&
            p0 !== undefined &&
            p1 !== undefined &&
            !isNaN(p0) &&
            !isNaN(p1)
          ) {
            hasGameStats = true;
            const isTeamB =
              Boolean(s.teamB && coachTeamNames.has(s.teamB.toLowerCase().trim())) ||
              (s.team && s.teamB && s.team.toLowerCase().trim() === s.teamB.toLowerCase().trim());
            if (isTeamB) {
              if (p1 > p0) wins++;
              else if (p1 < p0) losses++;
            } else {
              if (p0 > p1) wins++;
              else if (p0 < p1) losses++;
            }
          }
        }
      });

      map.set(c.id, {
        wins: hasGameStats ? wins : (c.wins ?? 0),
        losses: hasGameStats ? losses : (c.losses ?? 0),
        completedSessions: completed.length > 0 ? completed.length : (c.sessions ?? 0),
      });
    });

    return map;
  }, [coaches, db.sessions, db.teams]);

  const sessionsDone = accessibleCoaches.reduce(
    (a, c) => a + (coachStatsMap.get(c.id)?.completedSessions ?? c.sessions),
    0,
  );

  const detailStats = detail
    ? coachStatsMap.get(detail.id) || {
        wins: detail.wins ?? 0,
        losses: detail.losses ?? 0,
        completedSessions: detail.sessions ?? 0,
      }
    : null;

  const detailOutstanding = detail
    ? (coachPayrollMap.get(detail.id)?.outstanding ?? detail.outstanding)
    : 0;

  function openNew() {
    if (!canWriteStaff) return;
    setEditing(null);
    const defaultBranch = isBranchManager ? userBranch : (branches[0] ?? "");
    setForm({
      ...blank,
      branch: defaultBranch,
      branches: defaultBranch ? [defaultBranch] : [],
      teams: [],
      level: (db.lists["Coaching levels"] || db.lists["Coach levels"])?.[0] ?? "",
    });
    setOpen(true);
  }
  function openEdit(c: Coach) {
    if (!canWriteStaff) return;
    setEditing(c);
    const { id: _id, ...rest } = c;
    const coachBranches = getCoachBranches(c);
    const coachTeams = getCoachTeams(c, db.teams);
    setForm({
      ...rest,
      branch: coachBranches[0] || c.branch || "",
      branches: coachBranches,
      teams: coachTeams,
      team: coachTeams[0] || c.team || "",
    });
    setOpen(true);
  }
  async function submit() {
    if (!canWriteStaff) {
      toast.error("You do not have permission to modify coaches.");
      return;
    }
    if (!form.name.trim()) {
      toast.error("Please enter a coach name.");
      return;
    }
    const oldName = editing?.name?.trim();
    const newName = form.name.trim();

    const assignedBranches = getCoachBranches({
      branch: form.branch,
      branches: form.branches,
    });
    const primaryBranch = assignedBranches[0] || form.branch || "";
    const assignedTeams = Array.from(
      new Set((form.teams || []).map((t) => t.trim()).filter(Boolean)),
    );
    const assignedTeamsLower = new Set(assignedTeams.map((t) => t.toLowerCase()));

    const finalForm = canManageCompensation
      ? form
      : {
          ...form,
          rate: editing ? editing.rate : 25,
          rateType: editing ? editing.rateType : "per_session",
          outstanding: editing ? editing.outstanding : 0,
        };
    const sanitizedDocs: DocumentAttachment[] = Array.isArray(finalForm.documents)
      ? finalForm.documents
          .filter((d) => Boolean(d && d.url))
          .map((d) => ({
            id: String(d.id || `doc-${Date.now().toString(36)}`),
            name: String(d.name || "Coaching License"),
            type: String(d.type || "application/octet-stream"),
            url: String(d.url),
            uploadedAt: String(d.uploadedAt || new Date().toISOString()),
            size: Number(d.size || 0),
          }))
      : [];
    const primaryLicenseUrl = sanitizedDocs[0]?.url || finalForm.licenseUrl;
    const primaryLicenseName = sanitizedDocs[0]?.name || finalForm.licenseName;

    if (finalForm.portal && finalForm.password?.trim()) {
      const coachEmail =
        finalForm.email?.trim().toLowerCase() ||
        `${(finalForm.username || newName.toLowerCase().replace(/[^a-z0-9]/g, "")).trim().toLowerCase()}@${tenantId}.academy`;
      void provisionFirebaseAuthUser(coachEmail, finalForm.password.trim());
    }

    const { password: _coachPassword, ...cleanFinalForm } = finalForm;

    const cData: Coach = editing
      ? {
          ...editing,
          ...cleanFinalForm,
          name: newName,
          branch: primaryBranch,
          branches: assignedBranches,
          teams: assignedTeams,
          team: assignedTeams[0] || "",
          ...(primaryLicenseUrl ? { licenseUrl: primaryLicenseUrl } : {}),
          ...(primaryLicenseName ? { licenseName: primaryLicenseName } : {}),
          documents: sanitizedDocs,
        }
      : {
          ...cleanFinalForm,
          name: newName,
          branch: primaryBranch,
          branches: assignedBranches,
          teams: assignedTeams,
          team: assignedTeams[0] || "",
          ...(primaryLicenseUrl ? { licenseUrl: primaryLicenseUrl } : {}),
          ...(primaryLicenseName ? { licenseName: primaryLicenseName } : {}),
          documents: sanitizedDocs,
          id: `c-${Date.now().toString(36)}`,
        };
    delete (cData as Record<string, unknown>).password;
    delete (cData as Record<string, unknown>).passwordHash;

    const nameChanged = Boolean(editing && oldName && oldName !== newName);
    const oldNameLower = oldName?.toLowerCase();
    const newNameLower = newName.toLowerCase();

    update((prev) => {
      const exists = prev.coaches.some((c) => c.id === cData.id);
      const nextCoaches = exists
        ? prev.coaches.map((c) => (c.id === cData.id ? cData : c))
        : [cData, ...prev.coaches];

      const nextTeams = prev.teams.map((t) => {
        let modified = false;
        let head = t.headCoach;
        let headId = t.headCoachId;
        let headRate = t.headCoachRate;
        let asst = t.assistant;
        let asstId = t.assistantId;

        const isSelectedTeam = assignedTeamsLower.has(t.name.trim().toLowerCase());
        const wasHead =
          (headId && headId === cData.id) ||
          (oldNameLower && head?.trim().toLowerCase() === oldNameLower) ||
          head?.trim().toLowerCase() === newNameLower;
        const wasAsst =
          (asstId && asstId === cData.id) ||
          (oldNameLower && asst?.trim().toLowerCase() === oldNameLower) ||
          asst?.trim().toLowerCase() === newNameLower;

        if (isSelectedTeam) {
          if (wasAsst) {
            if (asst !== newName || asstId !== cData.id) {
              asst = newName;
              asstId = cData.id;
              modified = true;
            }
          } else {
            if (head !== newName || headId !== cData.id) {
              head = newName;
              headId = cData.id;
              headRate = headRate ?? cData.rate ?? 50;
              modified = true;
            }
          }
        } else if (editing) {
          // Coach was unchecked from this team
          if (wasHead) {
            head = "";
            headId = undefined;
            modified = true;
          }
          if (wasAsst) {
            asst = "";
            asstId = undefined;
            modified = true;
          }
        }

        return modified
          ? {
              ...t,
              headCoach: head,
              headCoachId: headId,
              headCoachRate: headRate,
              assistant: asst,
              assistantId: asstId,
            }
          : t;
      });

      const nextSessions = nameChanged
        ? prev.sessions.map((s) => {
            let modified = false;
            let sc = s.coach;
            let shc = s.headCoach;
            let sac = s.assistantCoach;
            if (oldName && s.coach === oldName) {
              sc = newName;
              modified = true;
            }
            if (oldName && s.headCoach === oldName) {
              shc = newName;
              modified = true;
            }
            if (oldName && s.assistantCoach === oldName) {
              sac = newName;
              modified = true;
            }
            return modified ? { ...s, coach: sc, headCoach: shc, assistantCoach: sac } : s;
          })
        : prev.sessions;

      const nextPlans = nameChanged
        ? (prev.plans || []).map((p) => {
            if (oldName && p.coach === oldName) {
              return { ...p, coach: newName };
            }
            return p;
          })
        : prev.plans;

      return {
        ...prev,
        coaches: nextCoaches,
        teams: nextTeams,
        sessions: nextSessions,
        plans: nextPlans,
      };
    });

    toast.success(
      nameChanged
        ? `Coach "${oldName}" renamed to "${newName}" and synced across branches & teams.`
        : editing
          ? `Coach "${cData.name}" updated across ${assignedBranches.length || 1} branch(es) and ${assignedTeams.length} team(s).`
          : `Coach "${cData.name}" created.`,
    );
    setOpen(false);
  }
  const [deleteTarget, setDeleteTarget] = useState<Coach | null>(null);
  function remove(c: Coach) {
    if (!canDeleteStaff) return;
    setDeleteTarget(c);
  }
  function confirmRemove() {
    if (!canDeleteStaff || !deleteTarget) return;
    const c = deleteTarget;
    setDeleteTarget(null);
    const coachNameLower = c.name?.trim().toLowerCase();
    const coachId = c.id;

    update((prev) => {
      const nextCoaches = prev.coaches.filter((coach) => coach.id !== coachId);

      const nextTeams = prev.teams.map((t) => {
        let modified = false;
        let headCoach = t.headCoach;
        let headCoachId = t.headCoachId;
        let assistant = t.assistant;
        let assistantId = t.assistantId;

        if (
          (headCoachId && headCoachId === coachId) ||
          (headCoach && headCoach.trim().toLowerCase() === coachNameLower)
        ) {
          headCoach = "";
          headCoachId = undefined;
          modified = true;
        }

        if (
          (assistantId && assistantId === coachId) ||
          (assistant && assistant.trim().toLowerCase() === coachNameLower)
        ) {
          assistant = "";
          assistantId = undefined;
          modified = true;
        }

        return modified ? { ...t, headCoach, headCoachId, assistant, assistantId } : t;
      });

      const todayIso = new Date().toISOString().slice(0, 10);
      const nextSessions = prev.sessions.map((s) => {
        if (s.date >= todayIso) {
          let modified = false;
          let sCoach = s.coach;
          let sCoachId = s.coachId;
          let sHeadCoach = s.headCoach;
          let sHeadCoachId = s.headCoachId;
          let sAsstCoach = s.assistantCoach;
          let sAsstCoachId = s.assistantCoachId;

          if (
            (sCoachId && sCoachId === coachId) ||
            (sCoach && sCoach.trim().toLowerCase() === coachNameLower)
          ) {
            sCoach = "";
            sCoachId = undefined;
            modified = true;
          }
          if (
            (sHeadCoachId && sHeadCoachId === coachId) ||
            (sHeadCoach && sHeadCoach.trim().toLowerCase() === coachNameLower)
          ) {
            sHeadCoach = "";
            sHeadCoachId = undefined;
            modified = true;
          }
          if (
            (sAsstCoachId && sAsstCoachId === coachId) ||
            (sAsstCoach && sAsstCoach.trim().toLowerCase() === coachNameLower)
          ) {
            sAsstCoach = "";
            sAsstCoachId = undefined;
            modified = true;
          }

          return modified
            ? {
                ...s,
                coach: sCoach,
                coachId: sCoachId,
                headCoach: sHeadCoach,
                headCoachId: sHeadCoachId,
                assistantCoach: sAsstCoach,
                assistantCoachId: sAsstCoachId,
              }
            : s;
        }
        return s;
      });

      return {
        ...prev,
        coaches: nextCoaches,
        teams: nextTeams,
        sessions: nextSessions,
      };
    });
    toast.success(
      `Coach "${c.name}" deleted and unassigned from affected teams and upcoming sessions.`,
    );
  }

  async function payCoach() {
    if (!canManageCompensation) {
      toast.error(
        "Unauthorized: Only Super Admin, Academy Manager, Branch Manager, Technical Director, or Accountant can record payments.",
      );
      return;
    }
    if (!detail) return;
    const verifiedPayroll = calculateAttendanceVerifiedPayroll(db, {
      monthIndex: currentMonthIndex,
      monthName: currentMonthName,
      year: currentYear,
    });
    const verifiedRow = verifiedPayroll.rows.find((r) => r.coachId === detail.id);
    const verifiedSessions = verifiedRow?.verifiedCompletedSessionsCount ?? 0;
    const unpaidVerifiedAmount = Math.max(
      0,
      (verifiedRow?.totalEarned ?? 0) - (verifiedRow?.totalDisbursed ?? 0),
    );
    const amount = payMode === "By rate" ? unpaidVerifiedAmount : Math.abs(Number(payAmount) || 0);
    if (!amount || amount <= 0) {
      toast.error(
        payMode === "By rate" && unpaidVerifiedAmount <= 0
          ? 'This coach has $0 in unpaid verified sessions. Switch Method to "Fixed amount" to record a Custom / Advance Payment.'
          : "Please enter a valid payment amount.",
      );
      return;
    }

    const isAdvancePayment = amount > unpaidVerifiedAmount || verifiedSessions === 0;
    const advancePortion = isAdvancePayment ? Math.max(0, amount - unpaidVerifiedAmount) : 0;

    if (isAdvancePayment && !advanceReason.trim()) {
      toast.error(
        "Mandatory Reason Required: Please enter the reason for this Advance / Custom Payment.",
      );
      return;
    }

    const parsedLinkedSessions =
      linkedAdvanceSessionsCount.trim() && Number(linkedAdvanceSessionsCount) > 0
        ? Math.round(Number(linkedAdvanceSessionsCount))
        : undefined;

    const todayStr = new Date().toISOString().slice(0, 10);
    const monthCode = String(currentMonthIndex + 1).padStart(2, "0");
    const entryId = `payroll-${detail.id}-${currentYear}-${monthCode}-${Date.now().toString(36)}`;
    const entryTitle = isAdvancePayment
      ? `Custom / Advance Payment (On Account) · ${detail.name}`
      : `Coach Payroll: ${detail.name} · ${payMode.toLowerCase()}`;
    const entryNote = isAdvancePayment
      ? `Custom / Advance Payment (On Account) for ${detail.name}. Unpaid verified sessions: ${money(unpaidVerifiedAmount)}. Advance recorded: ${money(advancePortion)}. Reason: ${advanceReason.trim()}.${parsedLinkedSessions ? ` Validated against ${parsedLinkedSessions} session(s).` : ""}${payNote ? ` Note: ${payNote}` : ""}`
      : payNote ||
        `Coach payroll disbursement for ${detail.name} (${currentMonthName} ${currentYear}).`;

    const currentBaseBalance =
      detail.outstanding !== undefined && detail.outstanding !== 0
        ? detail.outstanding
        : unpaidVerifiedAmount;
    const nextOutstanding = Math.round((currentBaseBalance - amount) * 100) / 100;

    try {
      await setEntity("ledger", {
        id: entryId,
        date: todayStr,
        account: "Coach Payroll Expense",
        category: "Coach Payroll Expense",
        entry: entryTitle,
        description: entryNote,
        type: "Expense",
        amount: Math.abs(amount),
        status: "Paid",
        branch: detail.branch || userBranch || "HQ",
        referenceId: `payroll-${currentMonthName}-${detail.id}`,
        coachId: detail.id,
        note: entryNote,
        ...(isAdvancePayment
          ? {
              isAdvance: true,
              advanceAmount: advancePortion,
              advanceReason: advanceReason.trim(),
              ...(parsedLinkedSessions ? { linkedAdvanceSessionsCount: parsedLinkedSessions } : {}),
            }
          : {}),
      });
      await patchEntity("coaches", detail.id, {
        outstanding: nextOutstanding,
      });

      if (isAdvancePayment) {
        void createAcademyNotification(tenantId, {
          title: `Coach Advance Payment Recorded: ${detail.name}`,
          message: `Paid ${money(amount)} to ${detail.name} (${money(unpaidVerifiedAmount)} unpaid verified sessions; ${money(advancePortion)} recorded as Advance / On-Account). Reason: ${advanceReason.trim()}.${parsedLinkedSessions ? ` Linked to ${parsedLinkedSessions} session(s).` : ""}`,
          type: "billing",
          branch: detail.branch || userBranch || undefined,
          targetBranchId: detail.branch || userBranch || undefined,
          targetRoles: ["super_admin", "accountant", "branch_manager"],
          actionUrl: "/coaches",
          createdAt: new Date().toISOString(),
          readBy: [],
          dismissedBy: [],
        }).catch(() => {});
      }

      toast.success(
        isAdvancePayment
          ? `Recorded Custom / Advance Payment of ${money(amount)} (${money(advancePortion)} on account) for ${detail.name}.`
          : `Recorded payment of ${money(amount)} for ${detail.name}.`,
      );
      setPayOpen(false);
      setPayNote("");
      setAdvanceReason("");
      setLinkedAdvanceSessionsCount("");
    } catch (err) {
      console.error("Failed to record coach payment:", err);
      toast.error("Failed to record coach payment.");
    }
  }

  if (authLoading && !currentUser && !authUser && !passwordUser) {
    return (
      <AppShell crumb="ROSTER / COACHES" title="Coaches">
        <div className="flex h-64 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-court-500 border-t-transparent" />
          <span className="ml-3 font-mono text-xs text-ink-400">Loading coaches…</span>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb="ROSTER / COACHES" title="Coaches">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={isBranchManager ? `Coaches (${userBranch})` : "Coaches"}
          value={String(accessibleCoaches.length)}
          note={isBranchManager ? "assigned facility" : "on staff"}
        />
        <Stat label="Portal enabled" value={String(portalCount)} note="Google or credentials" />
        <Stat
          label="Sessions delivered"
          value={String(sessionsDone)}
          note={`of ${sessionsTarget} planned`}
        />
        <Stat
          label="Outstanding"
          value={canManageCompensation ? money(outstanding) : "••••"}
          accent={canManageCompensation}
          note={canManageCompensation ? "payable to coaches" : "Restricted access"}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
        <Panel
          title={isBranchManager ? `Coach database · ${userBranch}` : "Coach database"}
          meta="Search by name, phone or email"
          action={
            <>
              <FilterSelect
                label="Level"
                value={level}
                onChange={setLevel}
                options={db.lists["Coaching levels"] || db.lists["Coach levels"] || []}
              />
              {!isBranchManager ? (
                <FilterSelect
                  label="Branch"
                  value={branch}
                  onChange={setBranch}
                  options={branches}
                />
              ) : (
                <div className="flex items-center gap-1.5 rounded-md bg-ink-850 px-2.5 py-1.5 border border-ink-800 text-xs font-mono text-ink-300">
                  <span className="text-[10px] text-ink-500 uppercase">Branch:</span>
                  <span className="text-court-400 font-semibold">{userBranch}</span>
                </div>
              )}
              {canWriteStaff && (
                <Button size="md" onClick={openNew}>
                  + New coach
                </Button>
              )}
            </>
          }
        >
          <div className="flex flex-col sm:flex-row gap-3 border-b border-ink-800 px-4 py-3">
            {canManageCompensation && (
              <Button
                variant="outline"
                size="md"
                onClick={() => setReportsOpen(true)}
                className="shrink-0 font-medium"
              >
                Payments Report
              </Button>
            )}
            <div className="flex-1">
              <Search value={q} onChange={setQ} placeholder="Search coaches by name or phone…" />
            </div>
          </div>
          {/* Table View */}
          <div className="overflow-x-auto w-full -mx-4 px-4 sm:mx-0 sm:px-0">
            <Table
              head={
                <>
                  <Th>COACH</Th>
                  <Th>LEVEL</Th>
                  <Th hide>{canManageCompensation ? "RATE" : ""}</Th>
                  <Th hide>W–L</Th>
                  <Th hide>SESSIONS</Th>
                  <Th>
                    <span className="block text-right">
                      {canManageCompensation ? "OUTSTANDING" : ""}
                    </span>
                  </Th>
                </>
              }
              footer={`SHOWING ${filtered.length} OF ${accessibleCoaches.length}`}
            >
              {filtered.length === 0 ? (
                <EmptyState>No coaches match these filters.</EmptyState>
              ) : (
                filtered.map((c) => {
                  const stats = coachStatsMap.get(c.id) || {
                    wins: c.wins ?? 0,
                    losses: c.losses ?? 0,
                    completedSessions: c.sessions ?? 0,
                  };
                  const coachBranches = getCoachBranches(c);
                  const coachTeams = getCoachTeams(c, db.teams);
                  return (
                    <Row key={c.id}>
                      <Td strong>
                        <button
                          type="button"
                          onClick={() => setSelected(c.id)}
                          className="block text-left leading-tight"
                        >
                          <div className="flex items-center gap-2 flex-wrap">
                            <span>{c.name}</span>
                            {c.portal ? <Chip tone="accent">PORTAL</Chip> : null}
                          </div>
                          <div className="font-mono text-[10px] text-ink-400 mt-0.5">
                            {c.phone} · {c.years} yrs ·{" "}
                            {coachBranches.length > 0 ? coachBranches.join(", ") : "—"}
                          </div>
                          {coachTeams.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {coachTeams.map((tName) => (
                                <span
                                  key={tName}
                                  className="inline-flex items-center rounded bg-court-500/10 px-1.5 py-0.5 font-mono text-[9px] text-court-300 ring-1 ring-court-500/25"
                                >
                                  {tName}
                                </span>
                              ))}
                            </div>
                          )}
                        </button>
                      </Td>
                      <Td>
                        <Chip>
                          {db.lists["Coach levels"]?.find(
                            (l) => l.toLowerCase() === c.level.toLowerCase(),
                          ) || c.level}
                        </Chip>
                      </Td>
                      <Td hide>
                        {canManageCompensation ? (
                          <span className="font-mono text-xs">
                            {money(c.rate)}
                            <span className="text-[10px] text-ink-400">
                              {c.rateType === "hourly" ? "/hr" : "/sess"}
                            </span>
                          </span>
                        ) : (
                          <span className="font-mono text-xs text-ink-500">••••</span>
                        )}
                      </Td>
                      <Td hide>
                        <span className="font-mono text-xs">
                          {stats.wins}–{stats.losses}
                        </span>
                      </Td>
                      <Td hide>
                        <span className="font-mono text-xs text-ink-300">
                          {stats.completedSessions} / {c.sessionTarget}
                        </span>
                      </Td>
                      <Td right>
                        <div className="flex items-center justify-end gap-2">
                          {canManageCompensation ? (
                            (() => {
                              const pInfo = coachPayrollMap.get(c.id);
                              const rawBal = pInfo?.netBalance ?? c.outstanding;
                              const isAdv =
                                rawBal < 0 || c.outstanding < 0 || Boolean(pInfo?.hasAdvance);
                              const advAmt =
                                c.outstanding < 0
                                  ? Math.abs(c.outstanding)
                                  : Math.abs(Math.min(0, rawBal));
                              if (isAdv && advAmt > 0) {
                                return (
                                  <span
                                    className="rounded bg-warn/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-warn ring-1 ring-warn/30"
                                    title="Coach has an Advance / Credit Balance on Account"
                                  >
                                    Advance / On Account: -{money(advAmt)} (Prepaid / Borrowed)
                                  </span>
                                );
                              }
                              return (
                                <span
                                  className={`font-mono text-xs ${
                                    rawBal > 0 ? "text-court-400" : "text-ink-400"
                                  }`}
                                >
                                  {money(Math.max(0, rawBal))}
                                </span>
                              );
                            })()
                          ) : (
                            <span className="font-mono text-xs text-ink-500">••••</span>
                          )}
                          <RowActions
                            onEdit={canWriteStaff ? () => openEdit(c) : undefined}
                            onDelete={canDeleteStaff ? () => remove(c) : undefined}
                          />
                        </div>
                      </Td>
                    </Row>
                  );
                })
              )}
            </Table>
          </div>

          {/* Mobile Card-Based View (< 640px) */}
          <div className="hidden divide-y divide-ink-800">
            {filtered.length === 0 ? (
              <EmptyState asTableRow={false}>No coaches match these filters.</EmptyState>
            ) : (
              filtered.map((c) => {
                const stats = coachStatsMap.get(c.id) || {
                  wins: c.wins ?? 0,
                  losses: c.losses ?? 0,
                  completedSessions: c.sessions ?? 0,
                };
                const coachBranches = getCoachBranches(c);
                const coachTeams = getCoachTeams(c, db.teams);
                return (
                  <div
                    key={c.id}
                    onClick={() => setSelected(c.id)}
                    className="p-3.5 space-y-2.5 transition hover:bg-ink-850/50 cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 font-semibold text-ink-100 truncate text-sm">
                          <span className="truncate">{c.name}</span>
                          {c.portal ? <Chip tone="accent">PORTAL</Chip> : null}
                        </div>
                        <div className="font-mono text-[10px] text-ink-400 mt-0.5">
                          {c.phone} · {c.years} yrs ·{" "}
                          {coachBranches.length > 0 ? coachBranches.join(", ") : "HQ"}
                        </div>
                        {coachTeams.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {coachTeams.map((tName) => (
                              <span
                                key={tName}
                                className="inline-flex items-center rounded bg-court-500/10 px-1.5 py-0.5 font-mono text-[9px] text-court-300 ring-1 ring-court-500/25"
                              >
                                {tName}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <Chip>
                        {db.lists["Coach levels"]?.find(
                          (l) => l.toLowerCase() === c.level.toLowerCase(),
                        ) || c.level}
                      </Chip>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-xs font-mono bg-ink-900/60 p-2 rounded border border-ink-850">
                      <div>
                        <span className="text-[10px] text-ink-400 block uppercase">Rate</span>
                        <span className="text-ink-200 block truncate">
                          {canManageCompensation ? (
                            <>
                              {money(c.rate)}
                              <span className="text-[10px] text-ink-400">
                                {c.rateType === "hourly" ? "/hr" : "/sess"}
                              </span>
                            </>
                          ) : (
                            <span className="text-ink-500">••••</span>
                          )}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-ink-400 block uppercase">Sessions</span>
                        <span className="text-ink-200 block truncate">
                          {stats.completedSessions}/{c.sessionTarget}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-ink-400 block uppercase">Payable</span>
                        <span
                          className={`block font-semibold truncate ${
                            (coachPayrollMap.get(c.id)?.outstanding ?? c.outstanding) &&
                            canManageCompensation
                              ? "text-court-400"
                              : "text-ink-400"
                          }`}
                        >
                          {canManageCompensation
                            ? money(coachPayrollMap.get(c.id)?.outstanding ?? c.outstanding)
                            : "••••"}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[11px] font-mono text-ink-400">
                        Record:{" "}
                        <span className="text-ink-200">
                          {stats.wins}W – {stats.losses}L
                        </span>
                      </span>
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        <RowActions
                          onEdit={canWriteStaff ? () => openEdit(c) : undefined}
                          onDelete={canDeleteStaff ? () => remove(c) : undefined}
                        />
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div className="p-3 border-t border-ink-800 text-center font-mono text-[10px] text-ink-400 uppercase">
              SHOWING {filtered.length} OF {accessibleCoaches.length}
            </div>
          </div>
        </Panel>

        {detail ? (
          <Panel title={detail.name} meta="Performance & financials">
            <div className="grid grid-cols-2 gap-2 p-4">
              <MiniStat
                label="Record"
                value={`${detailStats?.wins ?? detail.wins}–${detailStats?.losses ?? detail.losses}`}
              />
              <MiniStat
                label="Rate"
                value={
                  canManageCompensation
                    ? `${money(detail.rate)}${detail.rateType === "hourly" ? "/hr" : "/sess"}`
                    : "••••"
                }
              />
              <MiniStat
                label="Sessions"
                value={`${detailStats?.completedSessions ?? detail.sessions}`}
              />
              <MiniStat
                label={
                  detailOutstanding < 0 || detail.outstanding < 0
                    ? "Advance / On Account"
                    : "Outstanding"
                }
                value={
                  canManageCompensation
                    ? detailOutstanding < 0 || detail.outstanding < 0
                      ? `-${money(Math.abs(detail.outstanding < 0 ? detail.outstanding : detailOutstanding))}`
                      : money(Math.max(0, detailOutstanding))
                    : "••••"
                }
                accent={canManageCompensation}
              />
            </div>
            {canManageCompensation && (detailOutstanding < 0 || detail.outstanding < 0) && (
              <div className="mx-4 mb-3 rounded-md border border-warn/40 bg-warn/15 px-3 py-2 font-mono text-[11px] font-semibold text-warn flex items-center justify-between gap-2">
                <span>
                  Advance / On Account: -
                  {money(Math.abs(detail.outstanding < 0 ? detail.outstanding : detailOutstanding))}{" "}
                  (Prepaid / Borrowed)
                </span>
                <Chip tone="warn">ON ACCOUNT</Chip>
              </div>
            )}
            <div className="space-y-2 border-t border-ink-800 px-4 py-3 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-300">Email</span>
                <span className="font-mono text-xs text-ink-100">{detail.email || "—"}</span>
              </div>
              <div className="flex justify-between items-start gap-2">
                <span className="text-ink-300 shrink-0">Branches</span>
                <div className="flex flex-wrap justify-end gap-1">
                  {getCoachBranches(detail).length > 0 ? (
                    getCoachBranches(detail).map((bName) => (
                      <span
                        key={bName}
                        className="rounded bg-ink-850 px-2 py-0.5 font-mono text-[10px] text-ink-100 ring-1 ring-ink-700"
                      >
                        {bName}
                      </span>
                    ))
                  ) : (
                    <span className="font-mono text-xs text-ink-400">—</span>
                  )}
                </div>
              </div>
              <div className="flex justify-between items-start gap-2 pt-1 border-t border-ink-850">
                <span className="text-ink-300 shrink-0">Assigned Teams</span>
                <div className="flex flex-wrap justify-end gap-1">
                  {getCoachTeams(detail, db.teams).length > 0 ? (
                    getCoachTeams(detail, db.teams).map((tName) => (
                      <span
                        key={tName}
                        className="rounded bg-court-500/10 px-2 py-0.5 font-mono text-[10px] text-court-300 ring-1 ring-court-500/30"
                      >
                        {tName}
                      </span>
                    ))
                  ) : (
                    <span className="font-mono text-xs text-ink-500">Unassigned</span>
                  )}
                </div>
              </div>
              <div className="pt-2 border-t border-ink-850 space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-ink-300 text-xs font-mono uppercase">
                    License &amp; Documents
                  </span>
                  {canWriteStaff && (
                    <label className="cursor-pointer inline-flex items-center gap-1 rounded bg-court-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-court-400 ring-1 ring-court-500/30 hover:bg-court-500/20 transition-colors">
                      <Upload className="w-3 h-3" />
                      <span>{licenseUploading ? "Uploading..." : "+ Attach"}</span>
                      <input
                        type="file"
                        accept="image/*,.pdf"
                        disabled={licenseUploading}
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file || !detail) return;
                          e.target.value = "";
                          if (file.size > 15 * 1024 * 1024) {
                            toast.error("Document must be under 15MB");
                            return;
                          }
                          try {
                            setLicenseUploading(true);
                            const uploadedDoc = await uploadDocumentAttachment(
                              tenantId,
                              "coaches",
                              detail.id,
                              file,
                            );
                            const existingDocs: DocumentAttachment[] = Array.isArray(
                              detail.documents,
                            )
                              ? detail.documents.map((d) => ({
                                  id: String(d.id || `doc-${Date.now().toString(36)}`),
                                  name: String(d.name || "Coaching License"),
                                  type: String(d.type || "application/octet-stream"),
                                  url: String(d.url || ""),
                                  uploadedAt: String(d.uploadedAt || new Date().toISOString()),
                                  size: Number(d.size || 0),
                                }))
                              : detail.licenseUrl
                                ? [
                                    {
                                      id: `doc-legacy-${detail.id}`,
                                      name: String(detail.licenseName || "Official License"),
                                      type: "application/pdf",
                                      url: String(detail.licenseUrl),
                                      uploadedAt: new Date().toISOString(),
                                      size: 0,
                                    },
                                  ]
                                : [];
                            const nextDocs = [...existingDocs, uploadedDoc];
                            await patchEntity("coaches", detail.id, {
                              documents: nextDocs,
                              licenseUrl: nextDocs[0]?.url || uploadedDoc.url,
                              licenseName: nextDocs[0]?.name || uploadedDoc.name,
                            });
                            toast.success(
                              `Document "${uploadedDoc.name}" attached to ${detail.name}.`,
                            );
                          } catch (err) {
                            console.error("Coach document upload failed:", err);
                            toast.error("Failed to attach document.");
                          } finally {
                            setLicenseUploading(false);
                          }
                        }}
                      />
                    </label>
                  )}
                </div>
                {(() => {
                  const docsList: DocumentAttachment[] =
                    Array.isArray(detail.documents) && detail.documents.length > 0
                      ? detail.documents
                      : detail.licenseUrl
                        ? [
                            {
                              id: `doc-legacy-${detail.id}`,
                              name: detail.licenseName || "View License",
                              type: "application/pdf",
                              url: detail.licenseUrl,
                              uploadedAt: "",
                              size: 0,
                            },
                          ]
                        : [];
                  if (docsList.length === 0) {
                    return <div className="font-mono text-xs text-ink-500">Not uploaded</div>;
                  }
                  return (
                    <div className="space-y-1.5">
                      {docsList.map((docItem) => (
                        <div
                          key={docItem.id}
                          className="flex items-center justify-between gap-2 rounded bg-ink-900/70 px-2.5 py-1.5 border border-ink-800 text-xs"
                        >
                          <a
                            href={docItem.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 font-mono text-[11px] text-court-400 hover:underline truncate"
                          >
                            <FileText className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate">{docItem.name}</span>
                          </a>
                          {canWriteStaff && (
                            <button
                              type="button"
                              onClick={async () => {
                                const remaining = docsList.filter((d) => d.id !== docItem.id);
                                await patchEntity("coaches", detail.id, {
                                  documents: remaining,
                                  licenseUrl: remaining[0]?.url || "",
                                  licenseName: remaining[0]?.name || "",
                                });
                                toast.success("Document removed.");
                              }}
                              className="text-bad/80 hover:text-bad p-0.5 shrink-0"
                              title="Remove document"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Delivered Sessions & Games History */}
              {(() => {
                const detailNameLower = detail.name.toLowerCase().trim();
                const coachTeamNames = new Set(
                  getCoachTeams(detail, db.teams).map((tName) => tName.toLowerCase().trim()),
                );
                const coachSessions = (db.sessions || [])
                  .filter((s) => {
                    return (
                      (s.coachId && s.coachId === detail.id) ||
                      (s.headCoachId && s.headCoachId === detail.id) ||
                      (s.assistantCoachId && s.assistantCoachId === detail.id) ||
                      Boolean(
                        detailNameLower &&
                        ((s.coach && s.coach.toLowerCase().trim() === detailNameLower) ||
                          (s.headCoach && s.headCoach.toLowerCase().trim() === detailNameLower) ||
                          (s.assistantCoach &&
                            s.assistantCoach.toLowerCase().trim() === detailNameLower)),
                      ) ||
                      Boolean(
                        s.team &&
                        coachTeamNames.has(s.team.toLowerCase().trim()) &&
                        !s.coach &&
                        !s.headCoach,
                      )
                    );
                  })
                  .sort((a, b) =>
                    `${b.date || ""} ${b.time || ""}`.localeCompare(
                      `${a.date || ""} ${a.time || ""}`,
                    ),
                  );

                return (
                  <div className="pt-2 border-t border-ink-850 space-y-1.5">
                    <div className="font-mono text-[10px] text-ink-400 uppercase tracking-wider">
                      Delivered Sessions &amp; Games History ({coachSessions.length})
                    </div>
                    {coachSessions.length === 0 ? (
                      <div className="rounded bg-ink-900/50 p-2 font-mono text-[10px] text-ink-500">
                        No sessions or games assigned yet.
                      </div>
                    ) : (
                      <div className="space-y-1.5 max-h-64 overflow-y-auto pr-0.5">
                        {coachSessions.map((sess) => {
                          const isVerified = isSessionAttendanceVerified(
                            sess,
                            db.attendance?.[sess.id] || null,
                          ).isVerified;
                          const breakdown = computeSessionCoachPayout(sess, detail);
                          const teamLabel =
                            sess.team ||
                            [sess.teamA, sess.teamB].filter(Boolean).join(" vs ") ||
                            "—";
                          const isEditingThis = editingSessionFee?.sessionId === sess.id;

                          return (
                            <div
                              key={sess.id}
                              className="rounded bg-ink-900/70 p-2 border border-ink-800 text-xs space-y-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[9px] uppercase text-court-300 shrink-0">
                                    {sess.kind || "Practice"}
                                  </span>
                                  <span className="font-semibold text-ink-100 truncate">
                                    {sess.title}
                                  </span>
                                </div>
                                <span className="font-mono text-[11px] font-bold text-court-400 shrink-0">
                                  {money(breakdown.totalSessionEarned)}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] text-ink-300">
                                <span>
                                  Session Fee: <strong>{money(breakdown.baseSessionFee)}</strong>
                                  {breakdown.transportFee > 0 ? (
                                    <span className="text-court-300">
                                      {" "}
                                      + Transport: <strong>+{money(breakdown.transportFee)}</strong>
                                    </span>
                                  ) : null}
                                  {breakdown.isOverridden ? (
                                    <span className="ml-1 text-amber-300">(Custom)</span>
                                  ) : null}
                                </span>
                                {canManageCompensation && !isEditingThis && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditingSessionFee({
                                        sessionId: sess.id,
                                        sessionFee: String(breakdown.baseSessionFee),
                                        transportFee: String(breakdown.transportFee),
                                        isAssistant: breakdown.isAssistant,
                                      })
                                    }
                                    className="rounded bg-ink-850 hover:bg-ink-800 px-1.5 py-0.5 text-[9px] font-mono text-court-400 ring-1 ring-ink-700"
                                  >
                                    Edit Fee / Transport
                                  </button>
                                )}
                              </div>
                              {isEditingThis && editingSessionFee && (
                                <div className="rounded bg-ink-950/90 p-2 border border-ink-700 space-y-2">
                                  <div className="font-mono text-[9px] text-court-300">
                                    Default Coach Rate: {money(breakdown.defaultRate)} — Editable
                                    for this session
                                  </div>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <span className="block font-mono text-[9px] uppercase text-ink-400 mb-0.5">
                                        Session Fee ($)
                                      </span>
                                      <Input
                                        type="number"
                                        value={editingSessionFee.sessionFee}
                                        onChange={(v) =>
                                          setEditingSessionFee({
                                            ...editingSessionFee,
                                            sessionFee: v,
                                          })
                                        }
                                      />
                                    </div>
                                    <div>
                                      <span className="block font-mono text-[9px] uppercase text-ink-400 mb-0.5">
                                        Transport Fee ($)
                                      </span>
                                      <Input
                                        type="number"
                                        value={editingSessionFee.transportFee}
                                        onChange={(v) =>
                                          setEditingSessionFee({
                                            ...editingSessionFee,
                                            transportFee: v,
                                          })
                                        }
                                      />
                                    </div>
                                  </div>
                                  <div className="flex items-center justify-end gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => setEditingSessionFee(null)}
                                      className="rounded bg-ink-800 px-2 py-1 font-mono text-[10px] text-ink-300"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        const nextFee = Math.max(
                                          0,
                                          Number(editingSessionFee.sessionFee) || 0,
                                        );
                                        const nextTransport = Math.max(
                                          0,
                                          Number(editingSessionFee.transportFee) || 0,
                                        );
                                        if (editingSessionFee.isAssistant) {
                                          void patchEntity("sessions", sess.id, {
                                            assistantSessionFee: nextFee,
                                            assistantTransportFee: nextTransport,
                                          });
                                        } else {
                                          void patchEntity("sessions", sess.id, {
                                            coachRate: nextFee,
                                            coachSessionFee: nextFee,
                                            coachTransportFee: nextTransport,
                                            rateOverwritten: nextFee !== breakdown.defaultRate,
                                            rateOverwrittenBy:
                                              currentUser?.name ||
                                              currentUser?.role ||
                                              "Branch Manager",
                                          });
                                        }
                                        toast.success(
                                          `Updated "${sess.title}": Session Fee ${money(nextFee)} + Transport ${money(nextTransport)}.`,
                                        );
                                        setEditingSessionFee(null);
                                      }}
                                      className="rounded bg-court-500 px-2.5 py-1 font-mono text-[10px] font-bold text-ink-950"
                                    >
                                      Save
                                    </button>
                                  </div>
                                </div>
                              )}
                              <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-ink-400">
                                <span className="truncate">
                                  {sess.date} · {sess.branch || "HQ"} · {teamLabel}
                                </span>
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[9px] font-bold uppercase shrink-0 ${
                                    isVerified
                                      ? "bg-good/15 text-good ring-1 ring-good/30"
                                      : "bg-warn/15 text-warn ring-1 ring-warn/30"
                                  }`}
                                >
                                  {isVerified ? "Verified" : "Pending"}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Recent Coach Payouts with Inline Undo / Delete & View All Toggle */}
              {canManageCompensation &&
                (() => {
                  const detailNameLower = detail.name.toLowerCase().trim();
                  const coachPayouts = (db.ledger || [])
                    .filter((l) => {
                      const isExp = l.type === "Expense" || (l.type as string) === "debit";
                      if (!isExp) return false;
                      if (l.coachId === detail.id) return true;
                      if (l.referenceId && l.referenceId.endsWith(`-${detail.id}`)) return true;
                      if (l.id.startsWith(`payroll-${detail.id}-`)) return true;
                      const acc = (l.account || l.category || "").toLowerCase();
                      const text = `${l.entry || ""} ${l.description || ""}`.toLowerCase();
                      return (
                        acc.includes("payroll") &&
                        Boolean(detailNameLower && text.includes(detailNameLower))
                      );
                    })
                    .sort((a, b) => b.date.localeCompare(a.date));

                  if (coachPayouts.length === 0) return null;

                  const visiblePayouts = showAllCoachPayouts
                    ? coachPayouts
                    : coachPayouts.slice(0, 6);

                  return (
                    <div className="pt-2 border-t border-ink-850 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="font-mono text-[10px] text-ink-400 uppercase tracking-wider">
                          Recent Payouts ({coachPayouts.length})
                        </div>
                        {coachPayouts.length > 6 && (
                          <button
                            type="button"
                            onClick={() => setShowAllCoachPayouts((v) => !v)}
                            className="font-mono text-[10px] text-court-400 hover:underline"
                          >
                            {showAllCoachPayouts
                              ? "Show Less"
                              : `View All (${coachPayouts.length})`}
                          </button>
                        )}
                      </div>
                      <div className="space-y-1.5 max-h-60 overflow-y-auto pr-0.5">
                        {visiblePayouts.map((pmt) => {
                          const isAdvPmt =
                            Boolean(pmt.isAdvance) ||
                            Boolean(pmt.advanceReason) ||
                            (pmt.entry || "").toLowerCase().includes("advance");
                          const isEditingValidation = validatingAdvanceLedger?.id === pmt.id;
                          return (
                            <div
                              key={pmt.id}
                              className="rounded bg-ink-900/70 p-2 border border-ink-800 text-xs space-y-1.5"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-mono text-[11px] font-semibold text-court-400">
                                    {money(Math.abs(pmt.amount))}
                                  </span>
                                  {isAdvPmt && (
                                    <span className="rounded bg-warn/15 px-1.5 py-0.5 font-mono text-[9px] font-bold text-warn ring-1 ring-warn/30">
                                      Custom / Advance Payment (On Account)
                                    </span>
                                  )}
                                  {pmt.linkedAdvanceSessionsCount ? (
                                    <span className="rounded bg-court-500/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-court-300 ring-1 ring-court-500/30">
                                      Covers {pmt.linkedAdvanceSessionsCount} session(s)
                                    </span>
                                  ) : null}
                                </div>
                                <span className="font-mono text-[10px] text-ink-400 shrink-0">
                                  {pmt.date}
                                </span>
                              </div>
                              {pmt.advanceReason && (
                                <div className="font-mono text-[10px] text-warn">
                                  Reason: {pmt.advanceReason}
                                </div>
                              )}
                              <div className="flex items-center justify-between gap-2 pt-0.5">
                                <span className="font-mono text-[10px] text-ink-400 truncate">
                                  {pmt.note || pmt.entry}
                                </span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setValidatingAdvanceLedger(
                                        isEditingValidation
                                          ? null
                                          : {
                                              id: pmt.id,
                                              advanceReason: pmt.advanceReason || "",
                                              linkedAdvanceSessionsCount:
                                                pmt.linkedAdvanceSessionsCount
                                                  ? String(pmt.linkedAdvanceSessionsCount)
                                                  : "",
                                            },
                                      )
                                    }
                                    className="rounded bg-ink-850 px-2 py-0.5 font-mono text-[10px] text-court-300 ring-1 ring-ink-700 hover:bg-ink-800"
                                    title="Link / Validate Advance Against Sessions"
                                  >
                                    Link Sessions
                                  </button>
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      await deleteLedgerTransaction(pmt.id);
                                      toast.success(
                                        `Undid ${money(Math.abs(pmt.amount))} payout and restored ${detail.name}'s balance.`,
                                      );
                                    }}
                                    className="rounded bg-bad/15 px-2 py-0.5 font-mono text-[10px] text-bad ring-1 ring-bad/30 hover:bg-bad/25 shrink-0"
                                  >
                                    Undo / Delete
                                  </button>
                                </div>
                              </div>

                              {isEditingValidation && validatingAdvanceLedger && (
                                <div className="mt-1.5 rounded bg-ink-950/90 p-2 border border-court-500/40 space-y-2">
                                  <div className="font-mono text-[10px] font-bold uppercase text-court-300">
                                    Link / Validate Advance Against Sessions
                                  </div>
                                  <div className="grid gap-2 sm:grid-cols-2">
                                    <Input
                                      type="number"
                                      placeholder="Sessions covered (e.g. 4)"
                                      value={validatingAdvanceLedger.linkedAdvanceSessionsCount}
                                      onChange={(v) =>
                                        setValidatingAdvanceLedger({
                                          ...validatingAdvanceLedger,
                                          linkedAdvanceSessionsCount: v,
                                        })
                                      }
                                    />
                                    <Input
                                      placeholder="Advance reason / note"
                                      value={validatingAdvanceLedger.advanceReason}
                                      onChange={(v) =>
                                        setValidatingAdvanceLedger({
                                          ...validatingAdvanceLedger,
                                          advanceReason: v,
                                        })
                                      }
                                    />
                                  </div>
                                  <div className="flex justify-end gap-1.5">
                                    <Button
                                      size="xs"
                                      variant="outline"
                                      onClick={() => setValidatingAdvanceLedger(null)}
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      size="xs"
                                      onClick={async () => {
                                        const countNum = Number(
                                          validatingAdvanceLedger.linkedAdvanceSessionsCount,
                                        );
                                        await editLedgerTransaction(pmt.id, {
                                          isAdvance: true,
                                          advanceReason:
                                            validatingAdvanceLedger.advanceReason.trim() ||
                                            pmt.advanceReason,
                                          linkedAdvanceSessionsCount:
                                            countNum > 0 ? Math.round(countNum) : undefined,
                                        });
                                        toast.success(
                                          `Validated advance against ${countNum > 0 ? Math.round(countNum) : 0} session(s).`,
                                        );
                                        setValidatingAdvanceLedger(null);
                                      }}
                                    >
                                      Save Validation
                                    </Button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
            </div>
            {canWriteStaff && (
              <div className="border-t border-ink-800 px-4 py-3">
                <Toggle
                  on={detail.portal}
                  onChange={(v) =>
                    update((d) => ({
                      ...d,
                      coaches: d.coaches.map((c) => (c.id === detail.id ? { ...c, portal: v } : c)),
                    }))
                  }
                  label="Coach portal access"
                  note="Google sign-in or fixed credentials"
                />
              </div>
            )}
            {(canManageCompensation || canWriteStaff) && (
              <div className="flex flex-wrap gap-2 border-t border-ink-800 px-4 py-3">
                {canManageCompensation && (
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      const pInfo = coachPayrollMap.get(detail.id);
                      const unpaidVerified = Math.max(
                        0,
                        (pInfo?.totalEarned ?? 0) - (pInfo?.totalDisbursed ?? 0),
                      );
                      if (unpaidVerified > 0) {
                        setPayMode("By rate");
                        setPayAmount(String(unpaidVerified));
                      } else {
                        setPayMode("Fixed amount");
                        setPayAmount(String(detail.rate || 0));
                      }
                      setAdvanceReason("");
                      setLinkedAdvanceSessionsCount("");
                      setPayOpen(true);
                    }}
                  >
                    Record payment
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1"
                  onClick={() => setStatementOpen(true)}
                >
                  Full Account Statement
                </Button>
                {canWriteStaff && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => openEdit(detail)}
                  >
                    Edit
                  </Button>
                )}
              </div>
            )}
            {canManageCompensation && (
              <div className="px-4 pb-3">
                <a
                  href="/accounting?tab=payroll"
                  className="block w-full text-center text-xs font-mono text-court-400 hover:text-court-300 py-1.5 px-2 rounded bg-court-500/10 ring-1 ring-court-500/20 hover:bg-court-500/20 transition-colors"
                >
                  Verified Payroll in Accounting &rarr;
                </a>
              </div>
            )}
          </Panel>
        ) : null}
      </div>

      {detail && (
        <CoachStatementModal
          coach={detail}
          open={statementOpen}
          onClose={() => setStatementOpen(false)}
          sessions={db.sessions}
          ledger={db.ledger}
        />
      )}

      <Modal
        open={open}
        title={editing ? `Edit ${editing.name}` : "New coach"}
        meta="Profile, rate and portal access"
        onClose={() => setOpen(false)}
        onSubmit={submit}
        submitLabel={editing ? "Save changes" : "Create coach"}
        wide
      >
        <div className="grid items-end gap-3 p-4 sm:grid-cols-2">
          <Field label="Full name">
            <Input value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
          </Field>
          <Field label="Email">
            <Input value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          </Field>
          <Field label="Level">
            <Select
              value={form.level}
              onChange={(v) => setForm({ ...form, level: v as Coach["level"] })}
              options={db.lists["Coaching levels"] || db.lists["Coach levels"] || []}
            />
          </Field>
          <Field label="Gender">
            <Select
              value={form.gender}
              onChange={(v) => setForm({ ...form, gender: v as Coach["gender"] })}
              options={["M", "F"]}
            />
          </Field>
          <div className="sm:col-span-2 space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-ink-300">
                Assigned Branches (Multi-Branch Assignment)
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const all = [...branches];
                    setForm({ ...form, branches: all, branch: all[0] || "" });
                  }}
                  className="text-[10px] font-mono text-court-400 hover:text-court-300 underline"
                >
                  All Branches
                </button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 p-2.5 rounded-lg bg-ink-850 border border-ink-800">
              {branches.map((bName) => {
                const isSelected = (form.branches || []).includes(bName);
                return (
                  <button
                    key={bName}
                    type="button"
                    onClick={() => {
                      const current = new Set(form.branches || []);
                      if (current.has(bName)) {
                        current.delete(bName);
                      } else {
                        current.add(bName);
                      }
                      const updated = Array.from(current);
                      const updatedLower = new Set(updated.map((b) => b.toLowerCase()));
                      const prunedTeams = (form.teams || []).filter((teamName) => {
                        const matchedTeam = (db.teams || []).find(
                          (t) => t.name.toLowerCase() === teamName.toLowerCase(),
                        );
                        if (!matchedTeam || !matchedTeam.branch) {
                          return updatedLower.size > 0;
                        }
                        return updatedLower.has(matchedTeam.branch.toLowerCase());
                      });
                      setForm({
                        ...form,
                        branches: updated,
                        branch: updated[0] || "",
                        teams: prunedTeams,
                        team: prunedTeams[0] || "",
                      });
                    }}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono transition border ${
                      isSelected
                        ? "bg-court-500/20 border-court-500/40 text-court-300 font-semibold"
                        : "bg-ink-900 border-ink-800 text-ink-400 hover:text-ink-200"
                    }`}
                  >
                    <span>{isSelected ? "✓" : "+"}</span>
                    <span>{bName}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-ink-400 font-mono">
              Assigned to: {(form.branches || []).join(", ") || form.branch || "None"}
            </p>
          </div>
          <div className="sm:col-span-2 space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-ink-300">
                Assigned Teams (Multi-Team Assignment)
              </label>
              <div className="flex items-center gap-2">
                {(form.teams || []).length > 0 && (
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, teams: [], team: "" })}
                    className="text-[10px] font-mono text-ink-400 hover:text-ink-200 underline"
                  >
                    Clear Teams
                  </button>
                )}
              </div>
            </div>
            {(() => {
              const selectedBranchesLower = new Set(
                (form.branches || []).map((b) => b.toLowerCase()),
              );
              const availableTeams =
                selectedBranchesLower.size === 0
                  ? []
                  : (db.teams || []).filter((t) =>
                      Boolean(t.branch && selectedBranchesLower.has(t.branch.toLowerCase())),
                    );
              if (selectedBranchesLower.size === 0) {
                return (
                  <div className="p-2.5 rounded-lg bg-ink-850 border border-ink-800 text-xs font-mono text-ink-500">
                    Select at least one branch above to view available teams in that branch.
                  </div>
                );
              }
              if (availableTeams.length === 0) {
                return (
                  <div className="p-2.5 rounded-lg bg-ink-850 border border-ink-800 text-xs font-mono text-ink-500">
                    No teams created yet for the selected branch(es).
                  </div>
                );
              }
              return (
                <div className="flex flex-wrap gap-2 p-2.5 rounded-lg bg-ink-850 border border-ink-800">
                  {availableTeams.map((t) => {
                    const isSelected = (form.teams || []).includes(t.name);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          const current = new Set(form.teams || []);
                          if (current.has(t.name)) {
                            current.delete(t.name);
                          } else {
                            current.add(t.name);
                          }
                          const updatedTeams = Array.from(current);
                          // Also ensure the team's branch is in form.branches if not empty
                          const nextBranchesSet = new Set(form.branches || []);
                          if (current.has(t.name) && t.branch) {
                            nextBranchesSet.add(t.branch);
                          }
                          const updatedBranches = Array.from(nextBranchesSet);
                          setForm({
                            ...form,
                            teams: updatedTeams,
                            team: updatedTeams[0] || "",
                            branches: updatedBranches,
                            branch: updatedBranches[0] || form.branch || "",
                          });
                        }}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-mono transition border ${
                          isSelected
                            ? "bg-court-500/20 border-court-500/40 text-court-300 font-semibold"
                            : "bg-ink-900 border-ink-800 text-ink-400 hover:text-ink-200"
                        }`}
                      >
                        <span>{isSelected ? "✓" : "+"}</span>
                        <span>{t.name}</span>
                        {t.branch && <span className="text-[10px] text-ink-500">({t.branch})</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })()}
            <p className="text-[11px] text-ink-400 font-mono">
              Assigned teams: {(form.teams || []).join(", ") || "None"}
            </p>
          </div>
          <Field label="Years of experience">
            <Input
              type="number"
              value={String(form.years)}
              onChange={(v) => setForm({ ...form, years: Number(v) || 0 })}
            />
          </Field>
          {canManageCompensation ? (
            <>
              <Field label="Rate" hint={db.academy?.currency || "USD"}>
                <Input
                  type="number"
                  value={String(form.rate)}
                  onChange={(v) => setForm({ ...form, rate: Number(v) || 0 })}
                />
              </Field>
              <Field label="Rate Structure" hint="Per session or hourly">
                <Select
                  value={form.rateType || "per_session"}
                  onChange={(v) => setForm({ ...form, rateType: v as "per_session" | "hourly" })}
                  options={["per_session", "hourly"]}
                />
              </Field>
              <Field label="Session target">
                <Input
                  type="number"
                  value={String(form.sessionTarget)}
                  onChange={(v) => setForm({ ...form, sessionTarget: Number(v) || 0 })}
                />
              </Field>
              <Field label="Outstanding">
                <Input
                  type="number"
                  value={String(form.outstanding)}
                  onChange={(v) => setForm({ ...form, outstanding: Number(v) || 0 })}
                />
              </Field>
            </>
          ) : (
            <>
              <Field label="Session target">
                <Input
                  type="number"
                  value={String(form.sessionTarget)}
                  onChange={(v) => setForm({ ...form, sessionTarget: Number(v) || 0 })}
                />
              </Field>
              <div className="col-span-1 rounded bg-ink-900/60 p-3 border border-ink-800 text-xs font-mono text-ink-400 flex items-center gap-2">
                <span>🔒</span>
                <span>
                  Rates and balances restricted to Super Admin, Technical Director, & Accountant.
                </span>
              </div>
            </>
          )}
          <div className="col-span-1 sm:col-span-2 pt-2 border-t border-ink-800">
            <Toggle
              on={form.portal}
              onChange={(v) => setForm({ ...form, portal: v })}
              label="Coach portal access"
            />
            {form.portal && (
              <div className="mt-4 grid items-end gap-3 sm:grid-cols-2">
                <Field label="Portal Username" hint="Leave blank to use email for Google login">
                  <Input
                    value={form.username || ""}
                    onChange={(v) => setForm({ ...form, username: v })}
                  />
                </Field>
                <Field label="Portal Password" hint="Required if setting a custom username">
                  <Input
                    type="password"
                    value={form.password || ""}
                    onChange={(v) => setForm({ ...form, password: v })}
                  />
                </Field>
              </div>
            )}
          </div>

          <div className="col-span-1 sm:col-span-2 pt-2 border-t border-ink-800">
            <Field
              label="Official License / Certification Documents"
              hint="Upload FIBA or federation license (PDF or image)"
            >
              <div className="space-y-2">
                <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    disabled={licenseUploading}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      e.target.value = "";
                      if (file.size > 15 * 1024 * 1024) {
                        toast.error("License file must be under 15MB");
                        return;
                      }
                      try {
                        setLicenseUploading(true);
                        const targetCoachId = editing?.id || `c-${Date.now().toString(36)}`;
                        const uploadedDoc = await uploadDocumentAttachment(
                          tenantId,
                          "coaches",
                          targetCoachId,
                          file,
                        );
                        setForm((prev) => {
                          const existingDocs = Array.isArray(prev.documents) ? prev.documents : [];
                          const nextDocs = [...existingDocs, uploadedDoc];
                          return {
                            ...prev,
                            licenseUrl: nextDocs[0]?.url || uploadedDoc.url,
                            licenseName: nextDocs[0]?.name || uploadedDoc.name,
                            documents: nextDocs,
                          };
                        });
                        toast.success(`License "${uploadedDoc.name}" attached.`);
                      } catch (err) {
                        console.error("License upload failed:", err);
                        toast.error("Failed to upload license document.");
                      } finally {
                        setLicenseUploading(false);
                      }
                    }}
                    className="w-full rounded-md bg-ink-850 px-3 py-2 font-ui text-sm text-ink-200 ring-1 ring-ink-700 file:mr-3 file:rounded file:border-0 file:bg-court-500 file:px-2 file:py-1 file:text-xs file:font-semibold file:text-ink-950 disabled:opacity-50"
                  />
                </div>
                {(Array.isArray(form.documents) && form.documents.length > 0) || form.licenseUrl ? (
                  <div className="space-y-1.5">
                    {(Array.isArray(form.documents) && form.documents.length > 0
                      ? form.documents
                      : form.licenseUrl
                        ? [
                            {
                              id: "doc-primary",
                              name: form.licenseName || "Official License",
                              type: "application/pdf",
                              url: form.licenseUrl,
                              uploadedAt: "",
                              size: 0,
                            },
                          ]
                        : []
                    ).map((docItem) => (
                      <div
                        key={docItem.id}
                        className="flex items-center justify-between gap-2 rounded bg-ink-900/80 px-3 py-1.5 border border-ink-800 text-xs"
                      >
                        <a
                          href={docItem.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 font-mono text-[11px] text-court-400 hover:underline truncate"
                        >
                          <FileText className="w-3.5 h-3.5 shrink-0" />
                          <span className="truncate">{docItem.name}</span>
                        </a>
                        <button
                          type="button"
                          onClick={() =>
                            setForm((prev) => {
                              const nextDocs = (prev.documents || []).filter(
                                (d) => d.id !== docItem.id,
                              );
                              const copy = { ...prev, documents: nextDocs };
                              if (nextDocs.length > 0) {
                                copy.licenseUrl = nextDocs[0].url;
                                copy.licenseName = nextDocs[0].name;
                              } else {
                                delete copy.licenseUrl;
                                delete copy.licenseName;
                              }
                              return copy;
                            })
                          }
                          className="text-bad hover:underline font-mono text-[10px] shrink-0"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              {licenseUploading && (
                <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-court-400">
                  <div className="h-1.5 w-1.5 rounded-full bg-court-400 animate-ping" />
                  Uploading license document...
                </div>
              )}
            </Field>
          </div>
        </div>
      </Modal>

      <Modal
        open={payOpen && canManageCompensation}
        title="Record coach payment"
        meta={detail?.name}
        onClose={() => setPayOpen(false)}
        onSubmit={() => void payCoach()}
        submitLabel="Pay coach"
      >
        {(() => {
          const pInfo = detail ? coachPayrollMap.get(detail.id) : undefined;
          const verifiedSessionsCount = pInfo?.sessions ?? 0;
          const unpaidVerifiedAmount = Math.max(
            0,
            (pInfo?.totalEarned ?? 0) - (pInfo?.totalDisbursed ?? 0),
          );
          const enteredAmount =
            payMode === "By rate" ? unpaidVerifiedAmount : Math.abs(Number(payAmount) || 0);
          const isAdvanceOrCustom =
            enteredAmount > unpaidVerifiedAmount ||
            (verifiedSessionsCount === 0 && enteredAmount > 0);
          const advanceDelta = Math.max(0, enteredAmount - unpaidVerifiedAmount);

          return (
            <div className="grid gap-3 p-4">
              <Field label="Method">
                <Select
                  value={payMode}
                  onChange={(v) => {
                    setPayMode(v);
                    if (v === "Fixed amount" && (!payAmount || Number(payAmount) === 0)) {
                      setPayAmount(String(unpaidVerifiedAmount || detail?.rate || 0));
                    }
                  }}
                  options={["By rate", "Fixed amount"]}
                />
              </Field>
              {payMode === "By rate" ? (
                <div className="rounded-md bg-ink-850 px-3 py-2 font-mono text-xs text-ink-200 ring-1 ring-ink-700 space-y-1">
                  <div>
                    {verifiedSessionsCount} verified sessions × ${detail?.rate} ={" "}
                    <span className="text-court-400 font-bold">{money(unpaidVerifiedAmount)}</span>
                  </div>
                  {verifiedSessionsCount === 0 && (
                    <div className="text-[11px] text-warn">
                      0 unpaid verified sessions this month. Switch Method to &quot;Fixed
                      amount&quot; to record a Custom / Advance Payment.
                    </div>
                  )}
                </div>
              ) : (
                <Field label={`Amount (${db.academy?.currency || "USD"})`}>
                  <Input type="number" value={payAmount} onChange={setPayAmount} />
                </Field>
              )}

              {isAdvanceOrCustom && (
                <div className="rounded-lg border border-warn/40 bg-warn/15 p-3 font-mono text-xs text-warn space-y-3">
                  <div className="leading-relaxed">
                    ⚠️ <strong>Advance / Custom Payment Warning:</strong> This coach currently has{" "}
                    <strong>{money(unpaidVerifiedAmount)}</strong> in unpaid verified sessions.
                    Paying <strong>{money(enteredAmount)}</strong> will record an{" "}
                    <strong>Advance / On-Account balance of {money(advanceDelta)}</strong>.
                  </div>
                  <Field
                    label="Mandatory Advance / Custom Payment Reason *"
                    hint="Required before submitting an advance or unverified-session payout"
                  >
                    <Input
                      value={advanceReason}
                      onChange={setAdvanceReason}
                      placeholder="e.g., Salary advance, Prepaid 4 sessions, Bonus / retainer"
                    />
                  </Field>
                  <Field
                    label="Link / Validate Advance Against Sessions (Optional)"
                    hint="Number of future or unverified sessions this advance payment covers"
                  >
                    <Input
                      type="number"
                      value={linkedAdvanceSessionsCount}
                      onChange={setLinkedAdvanceSessionsCount}
                      placeholder="e.g., 4"
                    />
                  </Field>
                </div>
              )}

              <Field label="Additional Note (Optional)">
                <Input
                  value={payNote}
                  onChange={setPayNote}
                  placeholder="e.g., Bank transfer ref or memo"
                />
              </Field>
            </div>
          );
        })()}
      </Modal>

      <Modal
        open={reportsOpen && canManageCompensation}
        title="Coach Payment Reports"
        onClose={() => setReportsOpen(false)}
        submitLabel="Close"
        onSubmit={() => setReportsOpen(false)}
      >
        <div className="grid gap-2 p-4">
          <Button
            variant="outline"
            onClick={() =>
              exportCSV(
                "Fully_Paid",
                coaches.filter((c) => c.outstanding === 0),
              )
            }
          >
            Download Fully Paid (CSV)
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              exportPDF(
                "Fully_Paid",
                coaches.filter((c) => c.outstanding === 0),
              )
            }
          >
            Download Fully Paid (PDF)
          </Button>
          <div className="my-2 h-px bg-ink-800" />
          <Button
            variant="outline"
            onClick={() =>
              exportCSV(
                "Outstanding",
                coaches.filter((c) => c.outstanding > 0),
              )
            }
          >
            Download Outstanding (CSV)
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              exportPDF(
                "Outstanding",
                coaches.filter((c) => c.outstanding > 0),
              )
            }
          >
            Download Outstanding (PDF)
          </Button>
          <div className="my-2 h-px bg-ink-800" />
          <Button variant="outline" onClick={() => exportCSV("All_Coaches", coaches)}>
            Download All Coaches (CSV)
          </Button>
          <Button variant="outline" onClick={() => exportPDF("All_Coaches", coaches)}>
            Download All Coaches (PDF)
          </Button>
          <div className="my-2 h-px bg-ink-800" />
          <a
            href="/accounting?tab=payroll"
            className="flex items-center justify-center gap-1.5 w-full py-2 px-3 rounded bg-court-500/10 text-court-400 font-mono text-xs hover:bg-court-500/20 ring-1 ring-court-500/30 transition-colors text-center"
          >
            <span>⚡</span> Open Attendance-Verified Payroll in Accounting &rarr;
          </a>
        </div>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        title="Remove coach"
        meta={deleteTarget ? `Remove "${deleteTarget.name}"` : undefined}
        onClose={() => setDeleteTarget(null)}
        onSubmit={confirmRemove}
        submitLabel="Remove coach"
      >
        <div className="p-4 text-sm text-ink-200">
          Are you sure you want to remove coach{" "}
          <span className="font-semibold text-ink-100">{deleteTarget?.name}</span>? Their team and
          session assignments will be cleared.
        </div>
      </Modal>
    </AppShell>
  );
}

function MiniStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded bg-ink-850 p-2.5 ring-1 ring-ink-700">
      <div className="label-mono">{label}</div>
      <div
        className={`font-display mt-1 text-2xl tracking-tight ${
          accent ? "text-court-400" : "text-ink-100"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

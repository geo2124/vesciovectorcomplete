import { createFileRoute } from "@tanstack/react-router";
import { useState, lazy, Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import {
  Button,
  Chip,
  Field,
  Input,
  Modal,
  Panel,
  Search,
  Select,
  Stat,
  money,
} from "@/components/kit";
import {
  useDB,
  useTenantUser,
  useModulePermissions,
  resolveCourtHourlyRates,
  calculateBranchCourtUtilizationAnalytics,
} from "@/lib/data-store";
import { useAuth } from "@/lib/auth";
import { uploadExpenseReceipt } from "@/lib/storage";
import { createAcademyNotification } from "@/lib/notifications";
import { toast } from "sonner";
import {
  Download,
  FileSpreadsheet,
  FileText,
  MessageSquare,
  Edit2,
  Trash2,
  Receipt,
  Clock,
} from "lucide-react";
import type { Branch, Court, BranchScheduleSlot } from "@/lib/mock-data";
import {
  BranchScheduleBuilder,
  buildWeeklySchedule,
  computeOperatingHoursFromWeekly,
  createDefaultWeeklySchedule,
  weeklyToScheduleSlots,
} from "@/components/branch-schedule-builder";

const CameraCapture = lazy(() =>
  import("@/components/camera-capture").then((m) => ({ default: m.CameraCapture })),
);

import { WhatsAppGroupsManager } from "@/components/whatsapp-groups-manager";

export const Route = createFileRoute("/branches")({
  head: () => ({
    meta: [
      { title: "Branches — Vescio Vector" },
      {
        name: "description",
        content:
          "Academy branches with addresses, managers, courts and per-branch team and player counts.",
      },
      { property: "og:title", content: "Branches — Vescio Vector" },
      {
        property: "og:description",
        content: "Manage every branch, its courts and its local contacts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: BranchesPage,
});

type FormState = Omit<Branch, "id">;

const defaultWeekly = createDefaultWeeklySchedule();

const blank: FormState = {
  name: "",
  city: "",
  address: "",
  manager: "",
  phone: "",
  email: "",
  rentalType: "Per session",
  rentalRate: 0,
  fixedExpenses: 0,
  courts: [],
  teams: 0,
  players: 0,
  notes: "",
  operatingHours: computeOperatingHoursFromWeekly(defaultWeekly),
  schedules: weeklyToScheduleSlots(defaultWeekly),
  weeklySchedule: defaultWeekly,
};

function BranchesPage() {
  const {
    db,
    setEntity,
    deleteEntity,
    patchEntity,
    editLedgerTransaction,
    deleteLedgerTransaction,
    update,
    tenantId,
    ready,
  } = useDB();
  const { user: authUser, passwordUser, loading: authLoading } = useAuth();
  const user = useTenantUser();
  const currency = db.academy?.currency || "USD";

  const { canWrite: canWriteBranches, canDelete: canDeleteBranches } =
    useModulePermissions("branches");
  const { canWrite: canWriteAccounting, canDelete: canDeleteAccounting } =
    useModulePermissions("accounting");
  const isBranchManager =
    (user?.role === "Branch Manager" || user?.branchScope === "Assigned branch only") &&
    Boolean(user?.branch);
  const canCreateBranch = canWriteBranches && !isBranchManager;
  const canDeleteBranch = canDeleteBranches && !isBranchManager;
  const canEdit = canWriteBranches || isBranchManager;

  const [expenseOpen, setExpenseOpen] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);
  const [expenseBranch, setExpenseBranch] = useState("");
  const [expenseForm, setExpenseForm] = useState({ amount: 0, note: "", type: "Rental" });
  const [expenseSaved, setExpenseSaved] = useState(false);
  const [expenseAttachment, setExpenseAttachment] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [whatsAppBranch, setWhatsAppBranch] = useState<Branch | null>(null);
  const [allBranchWhatsAppOpen, setAllBranchWhatsAppOpen] = useState(false);
  const [deletingBranch, setDeletingBranch] = useState<Branch | null>(null);
  const [isDeletingBranch, setIsDeletingBranch] = useState(false);

  async function confirmDeleteBranch() {
    if (!canDeleteBranch || !deletingBranch) return;
    const branchName = deletingBranch.name;
    const bId = deletingBranch.id;
    setIsDeletingBranch(true);
    try {
      // Cascade clear branch assignments cleanly for active teams, players, and coaches
      update((d) => ({
        ...d,
        branches: d.branches.filter((x) => x.id !== bId),
        teams: d.teams.map((t) =>
          t.branch?.toLowerCase() === branchName.toLowerCase() ? { ...t, branch: "" } : t,
        ),
        players: d.players.map((p) =>
          p.branch?.toLowerCase() === branchName.toLowerCase() ? { ...p, branch: "" } : p,
        ),
        coaches: d.coaches.map((c) =>
          c.branch?.toLowerCase() === branchName.toLowerCase() ? { ...c, branch: "" } : c,
        ),
      }));

      const affectedTeams = db.teams.filter(
        (t) => t.branch?.toLowerCase() === branchName.toLowerCase(),
      );
      for (const t of affectedTeams) {
        await patchEntity("teams", t.id, { branch: "" });
      }
      const affectedPlayers = db.players.filter(
        (p) => p.branch?.toLowerCase() === branchName.toLowerCase(),
      );
      for (const p of affectedPlayers) {
        await patchEntity("players", p.id, { branch: "" });
      }
      const affectedCoaches = db.coaches.filter(
        (c) => c.branch?.toLowerCase() === branchName.toLowerCase(),
      );
      for (const c of affectedCoaches) {
        await patchEntity("coaches", c.id, { branch: "" });
      }

      await deleteEntity("branches", bId);
      toast.success(`Branch "${branchName}" deleted and linked assignments cleared.`);
      setDeletingBranch(null);
    } catch (err) {
      console.error("Failed to delete branch:", err);
      toast.error("Failed to delete branch.");
    } finally {
      setIsDeletingBranch(false);
    }
  }

  function countBranchGroups(branchName: string, branchId: string) {
    return (db.groups || []).filter(
      (g) =>
        g.branchId === branchId ||
        g.branchName?.toLowerCase() === branchName.toLowerCase() ||
        g.scope?.toLowerCase().includes(branchName.toLowerCase()),
    ).length;
  }

  async function recordExpense(e?: React.FormEvent) {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    if (!expenseForm.amount || expenseForm.amount <= 0) {
      toast.error("Please enter a valid expense amount.");
      return;
    }
    setIsUploading(true);
    let attachmentUrl = "";
    if (expenseAttachment) {
      try {
        attachmentUrl = await uploadExpenseReceipt(tenantId, expenseBranch, expenseAttachment);
      } catch (err) {
        console.error("Failed to upload receipt:", err);
        toast.error("Failed to upload receipt to Storage.");
      }
    }
    if (editingExpenseId) {
      try {
        await editLedgerTransaction(editingExpenseId, {
          account: expenseForm.type,
          category: expenseForm.type,
          amount: Math.abs(expenseForm.amount),
          note: expenseForm.note,
          ...(attachmentUrl ? { attachment: attachmentUrl } : {}),
        });
        toast.success(`Branch expense updated (${money(expenseForm.amount)}).`);
      } catch (e) {
        console.warn("Notice updating expense:", e);
      }
      setIsUploading(false);
      setExpenseAttachment(null);
      setEditingExpenseId(null);
      setExpenseOpen(false);
      return;
    }

    const isDirectApproveRole =
      user?.role === "Super Admin" ||
      user?.role === "Academy Manager" ||
      user?.role === "Accountant";
    const expenseStatus: "Paid" | "Pending" =
      user?.role === "Branch Manager" || !isDirectApproveRole ? "Pending" : "Paid";
    const newEntry = {
      id: `l-${Date.now().toString(36)}`,
      date: new Date().toISOString().slice(0, 10),
      account: expenseForm.type,
      entry: `Branch Expense: ${expenseBranch}`,
      type: "Expense" as const,
      amount: Math.abs(expenseForm.amount),
      status: expenseStatus,
      note: expenseForm.note,
      branch: expenseBranch,
      ...(attachmentUrl ? { attachment: attachmentUrl } : {}),
    };
    try {
      await setEntity("ledger", newEntry);
      void createAcademyNotification(tenantId, {
        title:
          expenseStatus === "Pending"
            ? `Branch Expense Pending Approval: ${expenseBranch}`
            : `Branch Expense Recorded: ${expenseBranch}`,
        message: `${user?.name || "Branch Manager"} submitted a ${expenseForm.type} expense of ${money(expenseForm.amount, currency)} for ${expenseBranch}${expenseForm.note ? ` (${expenseForm.note})` : ""}. Status: ${expenseStatus}.`,
        type: "billing",
        targetRoles: ["super_admin", "accountant"],
        targetBranchId: expenseBranch || undefined,
        actionUrl: "/accounting",
        createdAt: new Date().toISOString(),
        readBy: [],
        dismissedBy: [],
      }).catch(() => {});
      toast.success(
        expenseStatus === "Pending"
          ? `Expense of ${money(expenseForm.amount)} submitted for Accountant approval (${expenseBranch}).`
          : `Expense of ${money(expenseForm.amount)} recorded for ${expenseBranch}.`,
      );
    } catch (e) {
      console.warn("Notice saving expense:", e);
    }
    setIsUploading(false);
    setExpenseAttachment(null);
    setExpenseSaved(true);
    setTimeout(() => {
      setExpenseSaved(false);
      setExpenseOpen(false);
    }, 600);
  }

  const branches = db.branches;
  const managers = db.staff.map((s) => s.name);

  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [form, setForm] = useState<FormState>(blank);
  const [scheduleTarget, setScheduleTarget] = useState<"branch" | number>("branch");
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState("");

  const allowedBranches = isBranchManager
    ? branches.filter(
        (b) =>
          b.name.toLowerCase() === user.branch.toLowerCase() ||
          b.id.toLowerCase() === user.branch.toLowerCase(),
      )
    : branches;
  const filtered = allowedBranches.filter(
    (b) =>
      !q.trim() ||
      [b.name, b.city, b.address, b.manager].join(" ").toLowerCase().includes(q.toLowerCase()),
  );

  const targetBranch =
    branches.find((b) => b.id === selectedBranchId) || filtered[0] || allowedBranches[0];

  function handleDownloadBranchCSV() {
    if (!targetBranch) return;
    const branchTeams = db.teams.filter((t) => t.branch === targetBranch.name);
    const branchPlayers = db.players.filter((p) => p.branch === targetBranch.name);
    const branchExpenses = db.ledger.filter(
      (l) => l.branch === targetBranch.name && l.type === "Expense",
    );
    const totalExpenses = branchExpenses.reduce((a, l) => a + Math.abs(l.amount), 0);

    const lines: string[] = [];
    lines.push(`=== BRANCH DATA REPORT: ${targetBranch.name.toUpperCase()} ===`);
    lines.push(`Export Date,${new Date().toISOString().slice(0, 10)}`);
    lines.push(`City,${targetBranch.city}`);
    lines.push(`Address,"${(targetBranch.address || "").replace(/"/g, '""')}"`);
    lines.push(`Manager,${targetBranch.manager || "Unassigned"}`);
    lines.push(`Total Courts,${targetBranch.courts.length}`);
    lines.push(`Total Teams,${branchTeams.length}`);
    lines.push(`Total Players,${branchPlayers.length}`);
    lines.push(`Total Branch Expenses Recorded,${totalExpenses}`);
    lines.push("");

    lines.push("--- COURTS & FACILITIES ---");
    lines.push(
      "Court Name,Contact Person,Phone Number,Available Schedule,Google Maps Link,Latitude,Longitude",
    );
    targetBranch.courts.forEach((c) => {
      const courtSchedule =
        c.operatingHours ||
        (c.weeklySchedule ? computeOperatingHoursFromWeekly(c.weeklySchedule) : "") ||
        targetBranch.operatingHours ||
        "";
      lines.push(
        `"${c.name.replace(/"/g, '""')}","${(c.contact || "").replace(/"/g, '""')}","${(c.phone || "").replace(/"/g, '""')}","${courtSchedule.replace(/"/g, '""')}","${(c.mapsLink || "").replace(/"/g, '""')}",${c.lat ?? ""},${c.lng ?? ""}`,
      );
    });
    lines.push("");

    lines.push("--- TEAMS & SQUADS ---");
    lines.push("Team Name,Category,Head Coach,Player Count");
    branchTeams.forEach((t) => {
      lines.push(
        `"${t.name.replace(/"/g, '""')}","${t.category}","${t.headCoach || t.coach || "—"}",${t.players || t.playersCount || 0}`,
      );
    });
    lines.push("");

    lines.push("--- REGISTERED PLAYERS ---");
    lines.push("Player ID,Player Name,Category,Team,Parent Phone,Status,Registration Date");
    branchPlayers.forEach((p) => {
      lines.push(
        `"${p.id}","${p.name.replace(/"/g, '""')}","${p.category}","${p.teams?.join("; ") || "—"}","${p.parentPhone || p.phone || ""}","${p.status}","${p.registered || ""}"`,
      );
    });

    const csvContent = lines.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const branchSlug = targetBranch.name.replace(/\s+/g, "_");
    a.download = `Branch_Data_${branchSlug}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Branch data for "${targetBranch.name}" (CSV) downloaded successfully.`);
    setDownloadModalOpen(false);
  }

  async function handleDownloadBranchPDF() {
    if (!targetBranch) return;
    try {
      const { default: jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const academyName = db.academy?.name || "Vescio Vector";
      const branchTeams = db.teams.filter((t) => t.branch === targetBranch.name);
      const branchPlayers = db.players.filter((p) => p.branch === targetBranch.name);
      const branchExpenses = db.ledger.filter(
        (l) => l.branch === targetBranch.name && l.type === "Expense",
      );
      const totalExpenses = branchExpenses.reduce((a, l) => a + Math.abs(l.amount), 0);

      // Top Banner
      doc.setFillColor(15, 23, 42); // slate-900
      doc.rect(0, 0, 210, 26, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(14);
      doc.setTextColor(255, 255, 255);
      doc.text(`${targetBranch.name.toUpperCase()} · BRANCH DOSSIER`, 14, 11);

      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(45, 212, 191);
      doc.text(
        `${academyName} | City: ${targetBranch.city} | Manager: ${targetBranch.manager || "Unassigned"} | Date: ${new Date().toLocaleDateString()}`,
        14,
        18,
      );

      // Address & Summary Info Box
      doc.setFontSize(8.5);
      doc.setTextColor(40, 40, 40);
      doc.text(`Address: ${targetBranch.address || "No address specified"}`, 14, 33);
      doc.text(
        `Facilities: ${targetBranch.courts.length} Courts  |  Active Teams: ${branchTeams.length}  |  Enrolled Players: ${branchPlayers.length}  |  Recorded Expenses: ${money(totalExpenses)}`,
        14,
        38,
      );

      // Section 1: Courts & Facilities Table
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      doc.text("Courts & Facility Locations", 14, 46);

      const courtRows = targetBranch.courts.map((c) => [
        c.name,
        c.contact || "—",
        c.phone || "—",
        c.operatingHours ||
          (c.weeklySchedule ? computeOperatingHoursFromWeekly(c.weeklySchedule) : "") ||
          targetBranch.operatingHours ||
          "—",
        c.mapsLink ? "Maps Link Available" : c.lat ? `${c.lat}, ${c.lng}` : "—",
      ]);

      autoTable(doc, {
        startY: 49,
        head: [["Court / Pitch", "Contact Person", "Phone", "Available Schedule", "Location"]],
        body: courtRows.length > 0 ? courtRows : [["No courts registered yet", "—", "—", "—", "—"]],
        theme: "striped",
        headStyles: { fillColor: [15, 23, 42], fontSize: 8 },
        styles: { fontSize: 7.5, cellPadding: 2 },
      });

      // Section 2: Teams Roster Table
      const finalY1 =
        (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || 70;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      doc.text("Teams & Squads at this Branch", 14, finalY1 + 8);

      const teamRows = branchTeams.map((t) => [
        t.name,
        t.category,
        t.headCoach || t.coach || "—",
        String(t.players || t.playersCount || 0),
      ]);

      autoTable(doc, {
        startY: finalY1 + 11,
        head: [["Team Name", "Category", "Head Coach", "Roster Size"]],
        body: teamRows.length > 0 ? teamRows : [["No teams assigned yet", "—", "—", "0"]],
        theme: "striped",
        headStyles: { fillColor: [15, 23, 42], fontSize: 8 },
        styles: { fontSize: 7.5, cellPadding: 2 },
      });

      // Section 3: Registered Players Table
      const finalY2 =
        (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ||
        finalY1 + 40;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      doc.text("Registered Players at this Branch", 14, finalY2 + 8);

      const playerRows = branchPlayers.map((p) => [
        p.id,
        p.name,
        p.category,
        p.teams?.join(", ") || "—",
        p.parentPhone || p.phone || "—",
        p.status,
      ]);

      autoTable(doc, {
        startY: finalY2 + 11,
        head: [["ID", "Player Name", "Category", "Squad", "Contact Phone", "Status"]],
        body:
          playerRows.length > 0
            ? playerRows
            : [["—", "No players registered at this branch yet", "—", "—", "—", "—"]],
        theme: "striped",
        headStyles: { fillColor: [15, 23, 42], fontSize: 8 },
        styles: { fontSize: 7, cellPadding: 2 },
      });

      const branchSlug = targetBranch.name.replace(/\s+/g, "_");
      doc.save(`Branch_Data_${branchSlug}_${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success(`Branch dossier for "${targetBranch.name}" (PDF) downloaded successfully.`);
      setDownloadModalOpen(false);
    } catch (err) {
      console.error("PDF generation error:", err);
      toast.error("Failed to generate branch PDF.");
    }
  }

  const countPlayers = (name: string) => db.players.filter((p) => p.branch === name).length;
  const countTeams = (name: string) => db.teams.filter((t) => t.branch === name).length;
  const totalCourts = branches.reduce((a, b) => a + b.courts.length, 0);

  function openNew() {
    if (!canCreateBranch) return;
    const branchesLimit = db.academy.branchesLimit || 10;
    if (db.branches.length >= branchesLimit) {
      toast.error(
        `Branch limit reached (${branchesLimit} branches max). Upgrade your plan or increase the quota in System Settings.`,
      );
      return;
    }
    setEditing(null);
    setScheduleTarget("branch");
    const freshWeekly = createDefaultWeeklySchedule();
    setForm({
      ...blank,
      weeklySchedule: freshWeekly,
      schedules: weeklyToScheduleSlots(freshWeekly),
      operatingHours: computeOperatingHoursFromWeekly(freshWeekly),
      courts: [
        {
          name: "",
          contact: "",
          phone: "",
          mapsLink: "",
          lat: undefined,
          lng: undefined,
          weeklySchedule: freshWeekly,
          schedules: weeklyToScheduleSlots(freshWeekly),
          operatingHours: computeOperatingHoursFromWeekly(freshWeekly),
          feeType: "per_hour",
          feeAmount: undefined,
          enableHalfCourts: true,
          fullCourtHourlyRate: undefined,
          halfCourtHourlyRate: undefined,
        },
      ],
    });
    setOpen(true);
  }
  function openEdit(b: Branch) {
    if (!canEdit) return;
    if (
      isBranchManager &&
      !canWriteBranches &&
      b.name.toLowerCase() !== (user?.branch || "").toLowerCase() &&
      b.id.toLowerCase() !== (user?.branch || "").toLowerCase()
    ) {
      return;
    }
    setEditing(b);
    setScheduleTarget("branch");
    const { id: _id, ...rest } = b;
    const resolvedBranchWeekly = buildWeeklySchedule(b.weeklySchedule, b.schedules);
    const resolvedBranchHours = computeOperatingHoursFromWeekly(resolvedBranchWeekly);
    const resolvedBranchSlots = weeklyToScheduleSlots(resolvedBranchWeekly);
    setForm({
      ...blank,
      ...rest,
      name: b.name || "",
      city: b.city || "",
      address: b.address || "",
      manager: b.manager || "",
      phone: b.phone || "",
      email: b.email || "",
      rentalType: (b.rentalType as "Per session" | "Fixed amount") || "Per session",
      rentalRate: b.rentalRate ?? 0,
      fixedExpenses: b.fixedExpenses ?? 0,
      teams: countTeams(b.name) || b.teams || 0,
      players: countPlayers(b.name) || b.players || 0,
      notes: b.notes || "",
      operatingHours: resolvedBranchHours || b.operatingHours || "",
      schedules: resolvedBranchSlots,
      weeklySchedule: resolvedBranchWeekly,
      courts: (b.courts || []).map((c) => {
        const courtWeekly =
          c.weeklySchedule && c.weeklySchedule.length > 0
            ? buildWeeklySchedule(c.weeklySchedule, c.schedules)
            : c.schedules && c.schedules.length > 0
              ? buildWeeklySchedule(undefined, c.schedules)
              : undefined;
        const courtHours = courtWeekly
          ? computeOperatingHoursFromWeekly(courtWeekly)
          : c.operatingHours || c.schedule || "";
        const resolvedFullRate =
          typeof c.fullCourtHourlyRate === "number" && Number.isFinite(c.fullCourtHourlyRate)
            ? c.fullCourtHourlyRate
            : typeof c.feeAmount === "number" &&
                Number.isFinite(c.feeAmount) &&
                c.feeType !== "fixed"
              ? c.feeAmount
              : undefined;
        const resolvedHalfRate =
          typeof c.halfCourtHourlyRate === "number" && Number.isFinite(c.halfCourtHourlyRate)
            ? c.halfCourtHourlyRate
            : resolvedFullRate !== undefined
              ? Math.round((resolvedFullRate / 2) * 100) / 100
              : undefined;
        return {
          id: c.id || `court-${c.name || "main"}`,
          name: c.name || "",
          contact: c.contact || "",
          phone: c.phone || "",
          mapsLink: c.mapsLink || "",
          lat: typeof c.lat === "number" && Number.isFinite(c.lat) ? c.lat : undefined,
          lng: typeof c.lng === "number" && Number.isFinite(c.lng) ? c.lng : undefined,
          schedule: courtHours,
          weeklySchedule: courtWeekly,
          schedules: courtWeekly ? weeklyToScheduleSlots(courtWeekly) : c.schedules,
          operatingHours: courtHours,
          feeType: c.feeType || (b.rentalType === "Fixed amount" ? "fixed" : "per_hour"),
          feeAmount:
            typeof c.feeAmount === "number" && Number.isFinite(c.feeAmount)
              ? c.feeAmount
              : resolvedFullRate,
          enableHalfCourts: Boolean(c.enableHalfCourts),
          fullCourtHourlyRate: resolvedFullRate,
          halfCourtHourlyRate: resolvedHalfRate,
        };
      }),
    });
    setOpen(true);
  }

  function syncBranchRentFromCourts(prev: FormState, nextCourts: Branch["courts"]): FormState {
    const hasAnyCourtFee = nextCourts.some(
      (c) =>
        (c.feeAmount !== undefined && Number(c.feeAmount) >= 0) ||
        (c.fullCourtHourlyRate !== undefined && Number(c.fullCourtHourlyRate) >= 0),
    );
    if (!hasAnyCourtFee) {
      return { ...prev, courts: nextCourts };
    }
    const fixedSum = nextCourts.reduce(
      (sum, c) => (c.feeType === "fixed" ? sum + (Number(c.feeAmount) || 0) : sum),
      0,
    );
    const sessionSum = nextCourts.reduce(
      (sum, c) =>
        c.feeType !== "fixed" ? sum + (Number(c.fullCourtHourlyRate ?? c.feeAmount) || 0) : sum,
      0,
    );
    const totalSum = fixedSum + sessionSum;

    let nextRentalType = prev.rentalType || "Per session";
    let nextRentalRate = prev.rentalRate ?? 0;
    let nextFixedExpenses = prev.fixedExpenses ?? 0;

    if (fixedSum > 0 && sessionSum === 0) {
      nextRentalType = "Fixed amount";
      nextRentalRate = fixedSum;
      nextFixedExpenses = fixedSum;
    } else if (sessionSum > 0 && fixedSum === 0) {
      nextRentalType = "Per session";
      nextRentalRate = sessionSum;
    } else if (fixedSum > 0 && sessionSum > 0) {
      nextRentalType = "Per session";
      nextRentalRate = sessionSum;
      nextFixedExpenses = fixedSum;
    } else {
      nextRentalRate = totalSum;
    }

    return {
      ...prev,
      courts: nextCourts,
      rentalType: nextRentalType,
      rentalRate: nextRentalRate,
      fixedExpenses: nextFixedExpenses,
    };
  }
  async function submit(e?: React.FormEvent) {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    if (!editing && !canCreateBranch) return;
    if (editing && !canEdit) return;
    const branchesLimit = db.academy.branchesLimit || 10;
    if (db.branches.length >= branchesLimit && !editing) {
      toast.error(
        `Branch limit reached (${branchesLimit} branches max). Upgrade your plan or increase the quota in System Settings.`,
      );
      return;
    }
    if (!form.name.trim()) {
      toast.error("Please enter a branch name.");
      return;
    }
    const oldName = editing?.name?.trim();
    const newName = form.name.trim();

    const rawValidCourts = form.courts.filter((c) => c.name.trim());
    const effectiveCourts =
      rawValidCourts.length > 0
        ? rawValidCourts
        : [
            {
              id: "court-1",
              name: "Main Court",
              contact: form.manager || "",
              phone: form.phone || "",
              schedule: form.operatingHours || "",
              operatingHours: form.operatingHours || "",
              weeklySchedule: form.weeklySchedule,
              schedules: form.schedules,
            },
          ];

    const normalizedCourts = effectiveCourts.map((c, idx) => {
      if (effectiveCourts.length === 1) {
        const masterHours =
          (form.weeklySchedule && form.weeklySchedule.length > 0
            ? computeOperatingHoursFromWeekly(form.weeklySchedule)
            : form.operatingHours) || "";
        return {
          ...c,
          id: c.id || `court-${idx + 1}`,
          name: c.name.trim() || "Main Court",
          schedule: masterHours,
          operatingHours: masterHours,
          weeklySchedule: form.weeklySchedule,
          schedules: form.schedules,
        };
      }
      const cHours =
        (c.weeklySchedule && c.weeklySchedule.length > 0
          ? computeOperatingHoursFromWeekly(c.weeklySchedule)
          : c.operatingHours || c.schedule) ||
        form.operatingHours ||
        "";
      return {
        ...c,
        id: c.id || `court-${idx + 1}`,
        name: c.name.trim() || `Court ${idx + 1}`,
        schedule: cHours,
        operatingHours: cHours,
      };
    });

    const clean = {
      ...form,
      courtsCount: normalizedCourts.length,
      courts: normalizedCourts,
    };
    const bData: Branch = editing
      ? { ...editing, ...clean, name: newName }
      : { ...clean, name: newName, id: `b-${Date.now().toString(36)}` };

    if (editing && oldName && oldName !== newName) {
      update((prev) => {
        const nextBranches = prev.branches.map((b) => (b.id === bData.id ? bData : b));
        const nextPlayers = prev.players.map((p) =>
          p.branch === oldName ? { ...p, branch: newName } : p,
        );
        const nextTeams = prev.teams.map((t) =>
          t.branch === oldName ? { ...t, branch: newName } : t,
        );
        const nextCoaches = prev.coaches.map((c) => {
          let modified = false;
          let primaryBranch = c.branch;
          let assignedBranches = c.branches;

          if (c.branch === oldName) {
            primaryBranch = newName;
            modified = true;
          }
          if (c.branches && c.branches.includes(oldName)) {
            assignedBranches = c.branches.map((b) => (b === oldName ? newName : b));
            modified = true;
          }
          return modified ? { ...c, branch: primaryBranch, branches: assignedBranches } : c;
        });
        const nextStaff = prev.staff.map((s) => {
          let modified = false;
          let primaryBranch = s.branch;
          let assignedBranches = s.branches;

          if (s.branch === oldName) {
            primaryBranch = newName;
            modified = true;
          }
          if (s.branches && s.branches.includes(oldName)) {
            assignedBranches = s.branches.map((b) => (b === oldName ? newName : b));
            modified = true;
          }
          return modified ? { ...s, branch: primaryBranch, branches: assignedBranches } : s;
        });
        const nextSessions = prev.sessions.map((s) =>
          s.branch === oldName ? { ...s, branch: newName } : s,
        );
        const nextLedger = prev.ledger.map((l) =>
          l.branch === oldName ? { ...l, branch: newName } : l,
        );

        return {
          ...prev,
          branches: nextBranches,
          players: nextPlayers,
          teams: nextTeams,
          coaches: nextCoaches,
          staff: nextStaff,
          sessions: nextSessions,
          ledger: nextLedger,
        };
      });
      toast.success(`Branch "${oldName}" renamed to "${newName}" and cascaded across records.`);
    } else {
      try {
        await setEntity("branches", bData);
        toast.success(
          editing
            ? `Branch "${bData.name}" details updated successfully.`
            : `Branch "${bData.name}" created successfully.`,
        );
      } catch (e) {
        console.warn("Notice saving branch:", e);
      }
    }
    setOpen(false);
  }
  function remove(b: Branch) {
    if (!canDeleteBranch) return;
    setDeletingBranch(b);
  }

  if (authLoading && !user && !authUser) {
    return (
      <AppShell crumb="ROSTER / BRANCHES" title="Branches">
        <div className="flex h-64 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-court-500 border-t-transparent" />
          <span className="ml-3 font-mono text-xs text-ink-400">Loading branches…</span>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      crumb={isBranchManager ? `ROSTER / ${user.branch.toUpperCase()}` : "ROSTER / BRANCHES"}
      title={isBranchManager ? `My Branch (${user.branch})` : "Branches"}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={isBranchManager ? "My Branch" : "Branches"}
          value={String(allowedBranches.length)}
          note={isBranchManager ? user.branch : `limit ${db.academy.branchesLimit || 10}`}
          accent
        />
        <Stat
          label="Courts"
          value={String(allowedBranches.reduce((a, b) => a + (b.courts?.length || 0), 0))}
          note={isBranchManager ? "facility courts" : "all locations"}
        />
        <Stat
          label="Teams"
          value={String(
            isBranchManager
              ? db.teams.filter((t) => t.branch?.toLowerCase() === user.branch?.toLowerCase())
                  .length
              : db.teams.length,
          )}
        />
        <Stat
          label="Players"
          value={String(
            isBranchManager
              ? db.players.filter((p) => p.branch?.toLowerCase() === user.branch?.toLowerCase())
                  .length
              : db.players.length,
          )}
        />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="md"
          className="text-court-300 font-medium shrink-0"
          onClick={() => {
            const firstBranch = filtered[0] || allowedBranches[0];
            if (firstBranch) setSelectedBranchId(firstBranch.id);
            setDownloadModalOpen(true);
          }}
        >
          <Download className="w-4 h-4 text-court-400" />
          <span>Download Branch Data</span>
        </Button>

        <Button
          variant="emerald"
          size="md"
          className="shrink-0 font-medium"
          onClick={() => setAllBranchWhatsAppOpen(true)}
        >
          <MessageSquare className="w-4 h-4 text-emerald-400" />
          <span>WhatsApp Hub ({db.groups?.length || 0})</span>
        </Button>

        <div className="flex-1 min-w-[200px]">
          <Search value={q} onChange={setQ} placeholder="Search branches or cities…" />
        </div>

        {canCreateBranch && (
          <div className="ml-auto">
            <Button size="md" onClick={openNew}>
              + New branch
            </Button>
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((b) => (
          <Panel
            key={b.id}
            title={b.name}
            meta={`${b.city} · manager ${b.manager || "—"}`}
            action={
              canEdit ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="text-court-300 font-medium"
                  onClick={() => openEdit(b)}
                >
                  Edit Branch
                </Button>
              ) : null
            }
          >
            <div className="space-y-3 p-4">
              <div className="text-sm text-ink-200">{b.address || "No address yet"}</div>
              <div className="flex gap-2">
                <Chip tone="accent">{countTeams(b.name) || b.teams} TEAMS</Chip>
                <Chip>{countPlayers(b.name) || b.players} PLAYERS</Chip>
              </div>
              <div>
                <div className="flex justify-between items-center bg-ink-850 p-2 rounded mb-3 border border-ink-800">
                  <div className="text-center flex-1 border-r border-ink-800">
                    <div className="text-[10px] font-mono text-ink-400">MONTHLY FIXED</div>
                    <div className="text-sm text-court-400">{money(b.fixedExpenses || 0)}</div>
                  </div>
                  <div className="text-center flex-1">
                    <div className="text-[10px] font-mono text-ink-400 uppercase">
                      {b.rentalType || "PER SESSION"}
                    </div>
                    <div className="text-sm text-court-400">{money(b.rentalRate || 0)}</div>
                  </div>
                </div>
                <div className="flex justify-between border-t border-ink-800 pt-3 mb-3">
                  <div>
                    <div className="text-[10px] font-mono text-ink-400">INCOME</div>
                    <div className="text-sm text-ink-100">
                      {money(
                        db.ledger
                          .filter(
                            (l) =>
                              l.branch === b.name &&
                              l.type === "Revenue" &&
                              l.status === "Collected",
                          )
                          .reduce((sum, l) => sum + Math.abs(l.amount), 0),
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono text-ink-400">EXPENSES</div>
                    <div className="text-sm text-ink-100">
                      {money(
                        db.ledger
                          .filter(
                            (l) =>
                              l.branch === b.name && l.type === "Expense" && l.status === "Paid",
                          )
                          .reduce((sum, l) => sum + Math.abs(l.amount), 0),
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-mono text-ink-400">BALANCE</div>
                    <div className="text-sm text-court-400">
                      {money(
                        db.ledger
                          .filter(
                            (l) =>
                              l.branch === b.name &&
                              l.type === "Revenue" &&
                              l.status === "Collected",
                          )
                          .reduce((sum, l) => sum + Math.abs(l.amount), 0) -
                          db.ledger
                            .filter(
                              (l) =>
                                l.branch === b.name && l.type === "Expense" && l.status === "Paid",
                            )
                            .reduce((sum, l) => sum + Math.abs(l.amount), 0),
                      )}
                    </div>
                  </div>
                </div>
                {(b.operatingHours ||
                  (b.weeklySchedule && b.weeklySchedule.length > 0) ||
                  (b.schedules && b.schedules.length > 0)) && (
                  <div className="mb-3 rounded bg-ink-850 px-2.5 py-2 ring-1 ring-ink-700">
                    <div className="flex items-center gap-1.5 text-xs text-ink-300 font-medium">
                      <Clock className="h-3.5 w-3.5 text-court-400 shrink-0" />
                      <span>Available Schedule</span>
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-ink-200 leading-relaxed">
                      {b.weeklySchedule && b.weeklySchedule.length > 0
                        ? computeOperatingHoursFromWeekly(b.weeklySchedule)
                        : b.operatingHours}
                    </div>
                  </div>
                )}
                {b.notes && (
                  <div className="mb-3 rounded bg-ink-850/60 px-2.5 py-1.5 text-[11px] text-ink-400 font-mono border border-ink-800">
                    <span className="text-ink-300 font-semibold">Features:</span> {b.notes}
                  </div>
                )}
                <div className="label-mono mb-1.5">Courts</div>
                <div className="space-y-1.5">
                  {b.courts.length === 0 ? (
                    <div className="font-mono text-[10px] text-ink-400">No courts registered</div>
                  ) : (
                    b.courts.map((c) => {
                      const courtScheduleText =
                        (c.weeklySchedule && c.weeklySchedule.length > 0
                          ? computeOperatingHoursFromWeekly(c.weeklySchedule)
                          : c.operatingHours) ||
                        (b.weeklySchedule && b.weeklySchedule.length > 0
                          ? computeOperatingHoursFromWeekly(b.weeklySchedule)
                          : b.operatingHours);
                      const courtRates = resolveCourtHourlyRates(c, b);
                      return (
                        <div
                          key={c.name}
                          className="rounded bg-ink-850 px-2.5 py-2 ring-1 ring-ink-700"
                        >
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-1.5">
                              <div className="text-xs text-ink-100 font-medium">{c.name}</div>
                              {courtRates.enableHalfCourts ? (
                                <span className="rounded bg-court-500/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-court-300 ring-1 ring-court-500/30">
                                  HCA / HCB SUBDIVISION
                                </span>
                              ) : (
                                <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[9px] text-ink-400 ring-1 ring-ink-700">
                                  FULL COURT ONLY
                                </span>
                              )}
                            </div>
                            {typeof c.lat === "number" && typeof c.lng === "number" ? (
                              <span className="font-mono text-[9px] text-good bg-good/10 px-1.5 py-0.5 rounded ring-1 ring-good/30">
                                GPS: {c.lat.toFixed(4)}, {c.lng.toFixed(4)}
                              </span>
                            ) : (
                              <span className="font-mono text-[9px] text-warn bg-warn/10 px-1.5 py-0.5 rounded ring-1 ring-warn/30">
                                NO GPS (BEIRUT FALLBACK)
                              </span>
                            )}
                          </div>
                          <div className="font-mono text-[10px] text-ink-400 mt-0.5">
                            {c.contact} · {c.phone}
                          </div>
                          <div className="mt-1.5 grid grid-cols-2 gap-1.5 rounded bg-ink-900/90 px-2 py-1.5 font-mono text-[10px] ring-1 ring-ink-800">
                            <div>
                              <span className="text-ink-400 block text-[9px] uppercase">
                                Full Court Rate
                              </span>
                              <span className="text-court-300 font-semibold">
                                {money(courtRates.fullCourtHourlyRate)} / hr
                              </span>
                            </div>
                            <div>
                              <span className="text-ink-400 block text-[9px] uppercase">
                                Half Court (HCA / HCB)
                              </span>
                              <span className="text-ink-100 font-semibold">
                                {money(courtRates.halfCourtHourlyRate)} / hr
                              </span>
                            </div>
                          </div>
                          {courtScheduleText && (
                            <div className="mt-1.5 flex items-start gap-1.5 rounded bg-ink-900/80 px-2 py-1 font-mono text-[10px] text-ink-200 ring-1 ring-ink-800">
                              <Clock className="h-3 w-3 text-court-400 shrink-0 mt-0.5" />
                              <span className="leading-snug">{courtScheduleText}</span>
                            </div>
                          )}
                          {c.mapsLink && (
                            <a
                              href={c.mapsLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] text-court-400 hover:underline"
                            >
                              <span>Open Map</span>
                              <svg
                                width="10"
                                height="10"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                                <polyline points="15 3 21 3 21 9" />
                                <line x1="10" y1="14" x2="21" y2="3" />
                              </svg>
                            </a>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>

                {/* Branch Court Utilization & Rental Analytics (Full vs. HCA / HCB) */}
                {(() => {
                  const [branchUtil] = calculateBranchCourtUtilizationAnalytics(
                    [b],
                    db.sessions || [],
                    db.ledger || [],
                    db.teams || [],
                    db.coaches || [],
                  );
                  if (!branchUtil) return null;
                  return (
                    <div className="mt-3 rounded-md bg-ink-950/70 p-2.5 ring-1 ring-ink-800 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] font-semibold uppercase text-court-300">
                          Court Utilization &amp; Rental Impact
                        </span>
                        <span className="font-mono text-[10px] text-ink-400">
                          {branchUtil.totalSessions} sess · {branchUtil.totalHours} hrs
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-1.5 text-center font-mono text-[10px]">
                        <div className="rounded bg-ink-900 p-1.5 ring-1 ring-ink-800">
                          <span className="block text-[9px] text-ink-400">FULL</span>
                          <span className="font-bold text-ink-100">
                            {branchUtil.fullCourtSessions}
                          </span>
                        </div>
                        <div className="rounded bg-ink-900 p-1.5 ring-1 ring-ink-800">
                          <span className="block text-[9px] text-court-400">HCA</span>
                          <span className="font-bold text-court-300">{branchUtil.hcaSessions}</span>
                        </div>
                        <div className="rounded bg-ink-900 p-1.5 ring-1 ring-ink-800">
                          <span className="block text-[9px] text-court-400">HCB</span>
                          <span className="font-bold text-court-300">{branchUtil.hcbSessions}</span>
                        </div>
                        <div className="rounded bg-ink-900 p-1.5 ring-1 ring-ink-800">
                          <span className="block text-[9px] text-ink-400">COURT RENT</span>
                          <span className="font-bold text-warn">
                            {money(branchUtil.sessionCourtRentalCost)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })()}
                {/* Branch Expense History with Quick Edit & Undo / Delete */}
                {(() => {
                  const branchExpenses = (db.ledger || [])
                    .filter(
                      (l) =>
                        l.branch?.toLowerCase() === b.name.toLowerCase() &&
                        (l.type === "Expense" || (l.type as string) === "debit"),
                    )
                    .sort((a, x) => x.date.localeCompare(a.date));

                  if (branchExpenses.length === 0) return null;

                  return (
                    <div className="mt-3 pt-2.5 border-t border-ink-800 space-y-1.5">
                      <div className="label-mono">Branch Expenses ({branchExpenses.length})</div>
                      <div className="space-y-1.5 max-h-44 overflow-y-auto pr-0.5">
                        {branchExpenses.slice(0, 6).map((exp) => {
                          const canModifyExpense =
                            canWriteAccounting ||
                            canDeleteAccounting ||
                            user?.role === "Super Admin" ||
                            user?.role === "Academy Manager" ||
                            user?.role === "Accountant" ||
                            (canEdit && exp.status === "Pending");
                          return (
                            <div
                              key={exp.id}
                              className="rounded bg-ink-850 px-2.5 py-1.5 ring-1 ring-ink-700/80 text-xs space-y-1"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-[11px] font-semibold text-ink-100 truncate">
                                  {exp.account} · {money(Math.abs(exp.amount))}
                                </span>
                                <Chip tone={exp.status === "Pending" ? "warn" : "good"}>
                                  {exp.status.toUpperCase()}
                                </Chip>
                              </div>
                              <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-ink-400">
                                <span className="truncate">{exp.note || exp.entry}</span>
                                <span className="shrink-0">{exp.date}</span>
                              </div>
                              {canModifyExpense && (
                                <div className="flex items-center justify-end gap-1.5 pt-0.5">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingExpenseId(exp.id);
                                      setExpenseBranch(b.name);
                                      setExpenseForm({
                                        amount: Math.abs(exp.amount),
                                        note: exp.note || "",
                                        type: exp.account || "Rental",
                                      });
                                      setExpenseOpen(true);
                                    }}
                                    className="rounded bg-ink-900 px-2 py-0.5 font-mono text-[10px] text-ink-200 ring-1 ring-ink-700 hover:text-court-300"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      await deleteLedgerTransaction(exp.id);
                                      toast.success(
                                        `Undid ${money(Math.abs(exp.amount))} branch expense for ${b.name}.`,
                                      );
                                    }}
                                    className="rounded bg-bad/15 px-2 py-0.5 font-mono text-[10px] text-bad ring-1 ring-bad/30 hover:bg-bad/25"
                                  >
                                    Undo / Delete
                                  </button>
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
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t border-ink-800 bg-ink-950/40 px-4 py-2.5">
              {canEdit && (
                <Button variant="outline" size="sm" onClick={() => openEdit(b)}>
                  <Edit2 className="h-3.5 w-3.5" />
                  <span>Edit</span>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="text-court-400 border-court-500/30 hover:bg-court-500/10"
                onClick={() => {
                  setEditingExpenseId(null);
                  setExpenseBranch(b.name);
                  setExpenseOpen(true);
                  setExpenseForm({
                    amount: 0,
                    note: "",
                    type: db.lists?.["Expense accounts"]?.[0] || "Rental",
                  });
                }}
              >
                <Receipt className="h-3.5 w-3.5" />
                <span>Record Expense</span>
              </Button>
              <Button variant="emerald" size="sm" onClick={() => setWhatsAppBranch(b)}>
                <MessageSquare className="h-3.5 w-3.5" />
                <span>WhatsApp ({countBranchGroups(b.name, b.id)})</span>
              </Button>
              {canDeleteBranch && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-bad/80 hover:text-bad hover:bg-bad/10"
                  onClick={() => remove(b)}
                  title="Delete branch"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Delete</span>
                </Button>
              )}
            </div>
          </Panel>
        ))}
      </div>

      <Modal
        open={expenseOpen}
        title={editingExpenseId ? "Edit Branch Expense" : "Record Branch Expense"}
        onClose={() => {
          setExpenseOpen(false);
          setEditingExpenseId(null);
        }}
        submitLabel={
          isUploading
            ? "Uploading..."
            : expenseSaved
              ? "Recorded ✓"
              : editingExpenseId
                ? "Save Changes"
                : canEdit
                  ? "Approve & Pay"
                  : "Submit for Approval"
        }
        onSubmit={recordExpense}
      >
        <div className="grid gap-4 p-4">
          <Field label="Expense Type">
            <select
              value={expenseForm.type}
              onChange={(e) => setExpenseForm({ ...expenseForm, type: e.target.value })}
              className="w-full rounded bg-ink-850 px-3 py-2 text-sm text-ink-100 ring-1 ring-ink-700"
            >
              {(db.lists?.["Expense accounts"]?.length
                ? db.lists["Expense accounts"]
                : ["Rental", "Equipment", "Maintenance", "Other"]
              ).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`Amount (${currency})`}>
            <Input
              type="number"
              value={String(expenseForm.amount)}
              onChange={(v) => setExpenseForm({ ...expenseForm, amount: Number(v) || 0 })}
            />
          </Field>
          <Field label="Note">
            <Input
              value={expenseForm.note}
              onChange={(v) => setExpenseForm({ ...expenseForm, note: v })}
              placeholder="Expense details..."
            />
          </Field>
          <Field label="Receipt / Quotation (Optional)">
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md bg-court-500/10 px-4 py-2 text-sm font-medium text-court-400 hover:bg-court-500/20 flex-1 text-center transition-colors">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" x2="12" y1="3" y2="15" />
                  </svg>
                  Upload File
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => setExpenseAttachment(e.target.files?.[0] || null)}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  className="flex cursor-pointer items-center justify-center gap-2 rounded-md bg-court-500/10 px-4 py-2 text-sm font-medium text-court-400 hover:bg-court-500/20 flex-1 text-center transition-colors"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
                    <circle cx="12" cy="13" r="3" />
                  </svg>
                  Take Photo
                </button>
              </div>
              {expenseAttachment && (
                <div className="text-xs text-ink-300 flex items-center gap-2 bg-ink-900 p-2 rounded border border-ink-800">
                  <span className="truncate flex-1">{expenseAttachment.name}</span>
                  <button
                    type="button"
                    onClick={() => setExpenseAttachment(null)}
                    className="text-bad hover:text-bad/80"
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M18 6 6 18" />
                      <path d="m6 6 12 12" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </Field>
        </div>
      </Modal>

      <Modal
        open={open}
        title={editing ? `Edit Branch: ${editing.name}` : "New branch"}
        meta="Location, facilities, manager, and operational costs"
        onClose={() => setOpen(false)}
        onSubmit={submit}
        submitLabel={editing ? "Save changes" : "Create branch"}
        wide
      >
        <div className="grid gap-3 p-4 sm:grid-cols-2 min-w-0 max-w-full overflow-x-hidden box-border">
          <div className="min-w-0">
            <Field label="Branch name">
              <Input
                value={form.name}
                onChange={(v) => setForm({ ...form, name: v })}
                placeholder="e.g. Beirut Central"
              />
            </Field>
          </div>
          <div className="min-w-0">
            <Field label="City">
              <Input
                value={form.city}
                onChange={(v) => setForm({ ...form, city: v })}
                placeholder="e.g. Beirut, Broumana, Dubai"
              />
            </Field>
          </div>
          <div className="min-w-0">
            <Field label="Address">
              <Input
                value={form.address}
                onChange={(v) => setForm({ ...form, address: v })}
                placeholder="Full facility address / venue"
              />
            </Field>
          </div>
          <div className="min-w-0">
            <Field label="Branch Manager">
              <Input
                value={form.manager}
                onChange={(v) => setForm({ ...form, manager: v })}
                placeholder={managers[0] ?? "Manager name"}
              />
            </Field>
          </div>
          <div className="min-w-0">
            <Field label="Branch Phone (Contact)">
              <Input
                value={form.phone || ""}
                onChange={(v) => setForm({ ...form, phone: v })}
                placeholder="+961 70 000 000"
              />
            </Field>
          </div>
          <div className="min-w-0">
            <Field label="Branch Email">
              <Input
                value={form.email || ""}
                onChange={(v) => setForm({ ...form, email: v })}
                placeholder="branch@vesciovector.com"
              />
            </Field>
          </div>
          {(() => {
            const courtsFixedSum = form.courts.reduce(
              (sum, c) => (c.feeType === "fixed" ? sum + (Number(c.feeAmount) || 0) : sum),
              0,
            );
            const courtsSessionSum = form.courts.reduce(
              (sum, c) => (c.feeType !== "fixed" ? sum + (Number(c.feeAmount) || 0) : sum),
              0,
            );
            const courtsTotalSum = courtsFixedSum + courtsSessionSum;

            return (
              <>
                <div className="min-w-0">
                  <Field
                    label={`Monthly Fixed Expenses (${currency}/mo)`}
                    hint={
                      courtsFixedSum > 0
                        ? `Auto-summed from fixed court fees (${money(courtsFixedSum)}) — remains editable`
                        : "Permanent monthly overhead: utilities, ground fees"
                    }
                  >
                    <Input
                      type="number"
                      value={String(form.fixedExpenses ?? 0)}
                      onChange={(v) => setForm({ ...form, fixedExpenses: Number(v) || 0 })}
                    />
                  </Field>
                </div>
                <div className="min-w-0 space-y-1.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 min-w-0">
                    <div className="min-w-0">
                      <Field label="Rental Type">
                        <Select
                          value={form.rentalType || "Per session"}
                          onChange={(v) =>
                            setForm({ ...form, rentalType: v as "Per session" | "Fixed amount" })
                          }
                          options={["Per session", "Fixed amount"]}
                        />
                      </Field>
                    </div>
                    <div className="min-w-0">
                      <Field
                        label={`Rental Rate (${currency})`}
                        hint={
                          courtsTotalSum > 0
                            ? `Courts total: ${money(courtsTotalSum)} (editable)`
                            : undefined
                        }
                      >
                        <Input
                          type="number"
                          value={String(form.rentalRate ?? 0)}
                          onChange={(v) => setForm({ ...form, rentalRate: Number(v) || 0 })}
                        />
                      </Field>
                    </div>
                  </div>
                  {courtsTotalSum > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded bg-court-500/10 px-2.5 py-1.5 ring-1 ring-court-500/30">
                      <span className="font-mono text-[10px] text-court-300">
                        Courts Sum:{" "}
                        <strong className="text-ink-100">{money(courtsTotalSum)}</strong>
                        {courtsFixedSum > 0 && courtsSessionSum > 0
                          ? ` (${money(courtsFixedSum)} Fixed + ${money(courtsSessionSum)} Session)`
                          : courtsFixedSum > 0
                            ? " (Fixed Amount)"
                            : " (Per Session / Hour)"}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setForm((prev) => syncBranchRentFromCourts(prev, prev.courts))
                        }
                        className="rounded bg-court-500/20 hover:bg-court-500/30 px-2 py-0.5 font-mono text-[10px] font-bold text-court-300 ring-1 ring-court-500/40 transition-colors"
                      >
                        ↻ Sync Sum from Courts ({money(courtsTotalSum)})
                      </button>
                    </div>
                  )}
                </div>
              </>
            );
          })()}
          <div className="sm:col-span-2 space-y-4 min-w-0">
            {/* Number of Courts & Single-Court vs Multi-Court Schedule Configuration */}
            <div className="rounded-lg border border-ink-800 bg-ink-900/70 p-3 space-y-2 min-w-0">
              <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
                <div className="min-w-0">
                  <span className="font-mono text-xs font-bold uppercase text-court-300">
                    Facility Courts &amp; Schedule Mode
                  </span>
                  <p className="text-[11px] text-ink-400">
                    {form.courts.length <= 1
                      ? "1 Court (Single-Court Mode): The branch schedule acts as the master schedule for this court."
                      : `${form.courts.length} Courts (Multi-Court Mode): Configure a dedicated schedule and rent fee for each court below.`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[10px] uppercase text-ink-400 mr-1">
                    Courts Count:
                  </span>
                  {[1, 2, 3, 4].map((count) => {
                    const activeCount = Math.max(1, form.courts.length);
                    return (
                      <button
                        key={count}
                        type="button"
                        onClick={() => {
                          setForm((prev) => {
                            const current = [...prev.courts];
                            if (count === current.length) return prev;
                            if (count < current.length) {
                              const sliced = current.slice(0, count);
                              if (typeof scheduleTarget === "number" && scheduleTarget >= count) {
                                setScheduleTarget("branch");
                              }
                              const synced = syncBranchRentFromCourts(prev, sliced);
                              return { ...synced, courtsCount: count };
                            }
                            const nextCourts = [...current];
                            while (nextCourts.length < count) {
                              const idx = nextCourts.length + 1;
                              const clonedWeekly = buildWeeklySchedule(
                                prev.weeklySchedule,
                                prev.schedules,
                              );
                              const clonedHours = computeOperatingHoursFromWeekly(clonedWeekly);
                              nextCourts.push({
                                id: `court-${idx}`,
                                name: idx === 1 ? "Court 1 (Main)" : `Court ${idx}`,
                                contact: prev.manager || "",
                                phone: prev.phone || "",
                                schedule: clonedHours,
                                operatingHours: clonedHours,
                                weeklySchedule: clonedWeekly,
                                schedules: weeklyToScheduleSlots(clonedWeekly),
                                feeType:
                                  prev.rentalType === "Fixed amount" ? "fixed" : "per_session",
                                feeAmount: undefined,
                              });
                            }
                            const synced = syncBranchRentFromCourts(prev, nextCourts);
                            return { ...synced, courtsCount: count };
                          });
                        }}
                        className={`rounded px-2.5 py-1 font-mono text-xs transition ${
                          activeCount === count
                            ? "bg-court-500 text-ink-950 font-bold ring-1 ring-court-400"
                            : "bg-ink-850 text-ink-300 ring-1 ring-ink-700 hover:bg-ink-800"
                        }`}
                      >
                        {count === 1 ? "1 Court (Master)" : `${count} Courts`}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="min-w-0 max-w-full overflow-x-hidden">
              <BranchScheduleBuilder
                value={form.operatingHours || ""}
                schedules={form.schedules}
                weeklySchedule={form.weeklySchedule}
                courts={form.courts}
                selectedTarget={scheduleTarget}
                onSelectTarget={setScheduleTarget}
                onChange={(formattedText, newSchedules, newWeekly) =>
                  setForm((prev) => ({
                    ...prev,
                    operatingHours: formattedText,
                    schedules: newSchedules,
                    weeklySchedule: newWeekly,
                  }))
                }
                onCourtsChange={(nextCourts) =>
                  setForm((prev) => ({
                    ...prev,
                    courtsCount: nextCourts.length,
                    courts: nextCourts,
                  }))
                }
              />
            </div>

            <div className="min-w-0">
              <Field
                label="Facility Notes & Features"
                hint="Flooring type, lighting, parking, amenities, court material"
              >
                <Input
                  value={form.notes || ""}
                  onChange={(v) => setForm({ ...form, notes: v })}
                  placeholder="e.g. Hardwood FIBA court, free parking, locker rooms"
                />
              </Field>
            </div>
          </div>
        </div>
        <div className="border-t border-ink-800 p-4 min-w-0 max-w-full overflow-x-hidden box-border">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="label-mono">Courts &amp; Per-Court Rent / Fee Setup</div>
            <div className="font-mono text-[10px] text-ink-400">
              Configure each court&apos;s contact, schedule, rent fee, and GPS coordinates
            </div>
          </div>
          <div className="space-y-3 min-w-0">
            {form.courts.map((c, i) => (
              <div
                key={i}
                className="p-3.5 rounded-xl border border-ink-800 bg-ink-900/50 space-y-3 min-w-0 max-w-full overflow-hidden box-border"
              >
                {/* Row 1: Court Name, Contact Person, Phone, and Action Buttons */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 items-end min-w-0">
                  <div className="min-w-0">
                    <span className="text-[10px] font-mono uppercase text-ink-400 block mb-1">
                      Court Name #{i + 1}
                    </span>
                    <Input
                      className="min-w-0 w-full"
                      value={c.name}
                      placeholder="Court name (e.g. Court 1)"
                      onChange={(v) =>
                        setForm({
                          ...form,
                          courts: form.courts.map((x, xi) => (xi === i ? { ...x, name: v } : x)),
                        })
                      }
                    />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] font-mono uppercase text-ink-400 block mb-1">
                      Contact / Manager
                    </span>
                    <Input
                      className="min-w-0 w-full"
                      value={c.contact}
                      placeholder="Contact person"
                      onChange={(v) =>
                        setForm({
                          ...form,
                          courts: form.courts.map((x, xi) => (xi === i ? { ...x, contact: v } : x)),
                        })
                      }
                    />
                  </div>
                  <div className="min-w-0">
                    <span className="text-[10px] font-mono uppercase text-ink-400 block mb-1">
                      Contact Phone
                    </span>
                    <Input
                      className="min-w-0 w-full"
                      value={c.phone}
                      placeholder="Phone number"
                      onChange={(v) =>
                        setForm({
                          ...form,
                          courts: form.courts.map((x, xi) => (xi === i ? { ...x, phone: v } : x)),
                        })
                      }
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <button
                      type="button"
                      onClick={() => setScheduleTarget(i)}
                      className={`flex-1 min-w-[120px] rounded-md px-2.5 py-2 font-mono text-[10px] ring-1 transition-colors text-center ${
                        scheduleTarget === i
                          ? "bg-court-500 text-ink-950 font-bold ring-court-400"
                          : "text-court-300 ring-ink-700 hover:bg-court-500/10"
                      }`}
                    >
                      {scheduleTarget === i ? "EDITING SCHEDULE ↑" : "COURT SCHEDULE"}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setForm((prev) => {
                          const nextCourts = prev.courts.filter((_, xi) => xi !== i);
                          return syncBranchRentFromCourts(prev, nextCourts);
                        })
                      }
                      className="rounded-md px-2.5 py-2 font-mono text-[10px] text-bad ring-1 ring-ink-700 hover:bg-bad/10 shrink-0"
                    >
                      REMOVE
                    </button>
                  </div>
                </div>

                {/* Row 2: Per-Court Subdivision (Full Court vs. HCA / HCB) & Hourly Rental Rates */}
                <div className="rounded-lg bg-ink-950/60 p-3 ring-1 ring-ink-800/90 space-y-3 min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-800/80 pb-2.5">
                    <div>
                      <span className="text-[11px] font-mono uppercase text-court-300 font-semibold block">
                        Court Subdivision &amp; Hourly Rental Rates
                      </span>
                      <span className="font-mono text-[10px] text-ink-400">
                        Configure Full Court (`fullCourtHourlyRate`) and Half-Court (`HCA` / `HCB` —
                        `halfCourtHourlyRate`) rates
                      </span>
                    </div>
                    <label className="inline-flex items-center gap-2 rounded-md bg-ink-850 px-3 py-1.5 ring-1 ring-ink-700 cursor-pointer hover:ring-court-500/50 transition-colors">
                      <input
                        type="checkbox"
                        checked={Boolean(c.enableHalfCourts)}
                        onChange={(e) => {
                          const enabled = e.target.checked;
                          setForm((prev) => ({
                            ...prev,
                            courts: prev.courts.map((x, xi) =>
                              xi === i
                                ? {
                                    ...x,
                                    enableHalfCourts: enabled,
                                    halfCourtHourlyRate:
                                      x.halfCourtHourlyRate !== undefined
                                        ? x.halfCourtHourlyRate
                                        : x.fullCourtHourlyRate !== undefined
                                          ? Math.round((x.fullCourtHourlyRate / 2) * 100) / 100
                                          : undefined,
                                  }
                                : x,
                            ),
                          }));
                        }}
                        className="h-4 w-4 accent-court-500"
                      />
                      <span className="font-mono text-xs font-semibold text-ink-100">
                        Enable Half-Court Subdivision (HCA &amp; HCB)
                      </span>
                    </label>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 items-start min-w-0">
                    <div className="min-w-0">
                      <span className="text-[10px] font-mono uppercase text-court-300 font-semibold block mb-1">
                        Full Court Hourly Rate ({currency}/hr)
                      </span>
                      <Input
                        type="number"
                        className="min-w-0 w-full"
                        value={
                          c.fullCourtHourlyRate !== undefined
                            ? String(c.fullCourtHourlyRate)
                            : c.feeType !== "fixed" && c.feeAmount !== undefined
                              ? String(c.feeAmount)
                              : ""
                        }
                        placeholder="e.g. 60"
                        onChange={(v) => {
                          const parsed = v === "" ? undefined : Number(v);
                          const cleanFull =
                            parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined;
                          setForm((prev) => {
                            const nextCourts = prev.courts.map((x, xi) => {
                              if (xi !== i) return x;
                              const nextHalf =
                                x.halfCourtHourlyRate !== undefined
                                  ? x.halfCourtHourlyRate
                                  : cleanFull !== undefined
                                    ? Math.round((cleanFull / 2) * 100) / 100
                                    : undefined;
                              return {
                                ...x,
                                fullCourtHourlyRate: cleanFull,
                                halfCourtHourlyRate: nextHalf,
                                feeAmount: x.feeType === "fixed" ? x.feeAmount : cleanFull,
                              };
                            });
                            return syncBranchRentFromCourts(prev, nextCourts);
                          });
                        }}
                      />
                    </div>

                    <div className="min-w-0">
                      <span className="text-[10px] font-mono uppercase text-court-300 font-semibold block mb-1">
                        Half Court (HCA / HCB) Rate ({currency}/hr)
                      </span>
                      <Input
                        type="number"
                        className="min-w-0 w-full"
                        value={
                          c.halfCourtHourlyRate !== undefined ? String(c.halfCourtHourlyRate) : ""
                        }
                        placeholder="e.g. 35"
                        onChange={(v) => {
                          const parsed = v === "" ? undefined : Number(v);
                          const cleanHalf =
                            parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined;
                          setForm((prev) => ({
                            ...prev,
                            courts: prev.courts.map((x, xi) =>
                              xi === i
                                ? {
                                    ...x,
                                    halfCourtHourlyRate: cleanHalf,
                                  }
                                : x,
                            ),
                          }));
                        }}
                      />
                    </div>

                    <div className="min-w-0">
                      <span className="text-[10px] font-mono uppercase text-ink-400 font-semibold block mb-1">
                        Rent Accounting Mode
                      </span>
                      <select
                        value={
                          c.feeType || (form.rentalType === "Fixed amount" ? "fixed" : "per_hour")
                        }
                        onChange={(e) => {
                          const nextType = e.target.value as "fixed" | "per_session" | "per_hour";
                          setForm((prev) => {
                            const nextCourts = prev.courts.map((x, xi) =>
                              xi === i ? { ...x, feeType: nextType } : x,
                            );
                            return syncBranchRentFromCourts(prev, nextCourts);
                          });
                        }}
                        className="w-full min-w-0 rounded-md bg-ink-850 px-2.5 py-1.5 font-mono text-xs text-ink-100 ring-1 ring-ink-700 focus:outline-none focus:ring-court-500"
                      >
                        <option value="per_hour">Per Hour Rate (Full / Half Court)</option>
                        <option value="per_session">Per Session Rate</option>
                        <option value="fixed">Fixed Amount (Monthly)</option>
                      </select>
                    </div>

                    <div className="min-w-0 font-mono text-[10px] text-ink-400 leading-relaxed pt-1">
                      <div className="text-court-300 font-semibold">
                        Full: {money(Number(c.fullCourtHourlyRate ?? c.feeAmount ?? 0))}/hr · Half
                        (HCA/HCB):{" "}
                        {money(
                          Number(
                            c.halfCourtHourlyRate ??
                              Math.round(
                                (Number(c.fullCourtHourlyRate ?? c.feeAmount ?? 0) / 2) * 100,
                              ) / 100,
                          ),
                        )}
                        /hr
                      </div>
                      <div className="text-ink-400 mt-0.5">
                        {c.enableHalfCourts
                          ? "✓ Simultaneous HCA & HCB session bookings enabled."
                          : "Full Court only (enable toggle above to subdivide into HCA & HCB)."}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Row 3: Schedule Summary Pill (wraps cleanly without horizontal overflow) */}
                <div className="flex items-start gap-2 rounded bg-ink-950/60 px-2.5 py-1.5 font-mono text-xs text-ink-300 ring-1 ring-ink-800 min-w-0">
                  <Clock className="h-3.5 w-3.5 text-court-400 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1 whitespace-normal break-words leading-relaxed text-xs">
                    <span className="text-ink-400 mr-1.5">Available Schedule:</span>
                    <span className="text-ink-100">
                      {(c.weeklySchedule && c.weeklySchedule.length > 0
                        ? computeOperatingHoursFromWeekly(c.weeklySchedule)
                        : c.operatingHours) ||
                        form.operatingHours ||
                        "Inherits branch schedule"}
                    </span>
                  </div>
                </div>

                {/* Row 4: Location / Maps URL & Coordinates */}
                <div className="space-y-2.5 min-w-0">
                  <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center min-w-0">
                    <div className="min-w-0 flex-1">
                      <Input
                        className="min-w-0 w-full truncate"
                        value={c.mapsLink || ""}
                        placeholder="Google Maps URL or paste coordinates (e.g. 33.8938, 35.5018)"
                        onChange={(v) => {
                          let lat: number | undefined = c.lat;
                          let lng: number | undefined = c.lng;
                          const urlMatch = v.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
                          const rawMatch = v.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
                          if (urlMatch && urlMatch[1] && urlMatch[2]) {
                            lat = parseFloat(urlMatch[1]);
                            lng = parseFloat(urlMatch[2]);
                          } else if (rawMatch && rawMatch[1] && rawMatch[2]) {
                            lat = parseFloat(rawMatch[1]);
                            lng = parseFloat(rawMatch[2]);
                          }
                          setForm({
                            ...form,
                            courts: form.courts.map((x, xi) =>
                              xi === i ? { ...x, mapsLink: v, lat, lng } : x,
                            ),
                          });
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (!navigator.geolocation) {
                          toast.error("Geolocation not supported on this device.");
                          return;
                        }
                        navigator.geolocation.getCurrentPosition(
                          (pos) => {
                            const lat = pos.coords.latitude;
                            const lng = pos.coords.longitude;
                            setForm({
                              ...form,
                              courts: form.courts.map((x, xi) =>
                                xi === i
                                  ? {
                                      ...x,
                                      lat,
                                      lng,
                                      mapsLink: `https://www.google.com/maps/@${lat},${lng},17z`,
                                    }
                                  : x,
                              ),
                            });
                            toast.success(
                              `Acquired current GPS: ${lat.toFixed(4)}, ${lng.toFixed(4)}`,
                            );
                          },
                          (err) => {
                            toast.error(`Could not get GPS location: ${err.message}`);
                          },
                          { enableHighAccuracy: true, timeout: 10000 },
                        );
                      }}
                      className="rounded bg-ink-800 hover:bg-ink-750 px-3 py-2 font-mono text-[11px] text-court-400 ring-1 ring-ink-700 whitespace-nowrap shrink-0"
                    >
                      📍 My Location
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 items-center min-w-0">
                    <div className="min-w-0">
                      <div className="flex justify-between items-center mb-0.5">
                        <span className="text-[10px] font-mono text-ink-400 block truncate">
                          LATITUDE (-90..90)
                        </span>
                        {c.lat !== undefined && (c.lat < -90 || c.lat > 90) && (
                          <span className="text-[9px] font-mono text-bad shrink-0">INVALID</span>
                        )}
                      </div>
                      <input
                        type="number"
                        step="any"
                        min="-90"
                        max="90"
                        placeholder="e.g. 33.8938"
                        value={c.lat !== undefined ? c.lat : ""}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          let val: number | undefined = undefined;
                          if (raw !== "") {
                            const parsed = parseFloat(raw);
                            if (Number.isFinite(parsed)) {
                              val = parsed;
                            }
                          }
                          setForm({
                            ...form,
                            courts: form.courts.map((x, xi) => (xi === i ? { ...x, lat: val } : x)),
                          });
                        }}
                        className={`w-full min-w-0 rounded bg-ink-850 px-2 py-1.5 font-mono text-xs text-ink-100 ring-1 ${
                          c.lat !== undefined && (c.lat < -90 || c.lat > 90)
                            ? "ring-bad text-bad"
                            : "ring-ink-700"
                        }`}
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="flex justify-between items-center mb-0.5">
                        <span className="text-[10px] font-mono text-ink-400 block truncate">
                          LONGITUDE (-180..180)
                        </span>
                        {c.lng !== undefined && (c.lng < -180 || c.lng > 180) && (
                          <span className="text-[9px] font-mono text-bad shrink-0">INVALID</span>
                        )}
                      </div>
                      <input
                        type="number"
                        step="any"
                        min="-180"
                        max="180"
                        placeholder="e.g. 35.5018"
                        value={c.lng !== undefined ? c.lng : ""}
                        onChange={(e) => {
                          const raw = e.target.value.trim();
                          let val: number | undefined = undefined;
                          if (raw !== "") {
                            const parsed = parseFloat(raw);
                            if (Number.isFinite(parsed)) {
                              val = parsed;
                            }
                          }
                          setForm({
                            ...form,
                            courts: form.courts.map((x, xi) => (xi === i ? { ...x, lng: val } : x)),
                          });
                        }}
                        className={`w-full min-w-0 rounded bg-ink-850 px-2 py-1.5 font-mono text-xs text-ink-100 ring-1 ${
                          c.lng !== undefined && (c.lng < -180 || c.lng > 180)
                            ? "ring-bad text-bad"
                            : "ring-ink-700"
                        }`}
                      />
                    </div>
                    <div className="min-w-0">
                      <span className="text-[10px] font-mono text-ink-400 block mb-0.5 truncate">
                        CITY PRESETS (LEBANON &amp; MENA)
                      </span>
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          const presets: Record<string, { lat: number; lng: number }> = {
                            beirut: { lat: 33.8938, lng: 35.5018 },
                            broumana: { lat: 33.8794, lng: 35.6172 },
                            jounieh: { lat: 33.9808, lng: 35.6178 },
                            byblos: { lat: 34.123, lng: 35.6519 },
                            tripoli: { lat: 34.4367, lng: 35.8497 },
                            saida: { lat: 33.5631, lng: 35.3689 },
                            zahle: { lat: 33.8463, lng: 35.902 },
                            batroun: { lat: 34.2553, lng: 35.6581 },
                            tyre: { lat: 33.2733, lng: 35.1939 },
                            dubai: { lat: 25.2048, lng: 55.2708 },
                            riyadh: { lat: 24.7136, lng: 46.6753 },
                            cairo: { lat: 30.0444, lng: 31.2357 },
                            doha: { lat: 25.2854, lng: 51.531 },
                          };
                          const p = presets[e.target.value];
                          if (p) {
                            setForm({
                              ...form,
                              courts: form.courts.map((x, xi) =>
                                xi === i
                                  ? {
                                      ...x,
                                      lat: Number(p.lat),
                                      lng: Number(p.lng),
                                      mapsLink: `https://www.google.com/maps/@${p.lat},${p.lng},17z`,
                                    }
                                  : x,
                              ),
                            });
                            toast.success(`Applied coordinate preset: ${p.lat}, ${p.lng}`);
                          }
                          e.target.value = "";
                        }}
                        className="w-full min-w-0 rounded bg-ink-850 px-2 py-1.5 font-mono text-xs text-ink-300 ring-1 ring-ink-700"
                      >
                        <option value="">Select city coordinate preset…</option>
                        <optgroup label="Lebanon">
                          <option value="beirut">Beirut (33.894, 35.502)</option>
                          <option value="broumana">Broumana / Metn (33.879, 35.617)</option>
                          <option value="jounieh">Jounieh / Kaslik (33.981, 35.618)</option>
                          <option value="byblos">Byblos / Jbeil (34.123, 35.652)</option>
                          <option value="batroun">Batroun (34.255, 35.658)</option>
                          <option value="tripoli">Tripoli (34.437, 35.850)</option>
                          <option value="zahle">Zahle / Bekaa (33.846, 35.902)</option>
                          <option value="saida">Saida / Sidon (33.563, 35.369)</option>
                          <option value="tyre">Tyre / Sour (33.273, 35.194)</option>
                        </optgroup>
                        <optgroup label="MENA Region">
                          <option value="dubai">Dubai, UAE (25.205, 55.271)</option>
                          <option value="riyadh">Riyadh, KSA (24.714, 46.675)</option>
                          <option value="doha">Doha, QA (25.285, 51.531)</option>
                          <option value="cairo">Cairo, EG (30.044, 31.236)</option>
                        </optgroup>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                const baseWeekly =
                  form.weeklySchedule && form.weeklySchedule.length > 0
                    ? form.weeklySchedule
                    : createDefaultWeeklySchedule();
                const clonedWeekly = baseWeekly.map((d) => ({
                  day: d.day,
                  available: d.available,
                  windows: d.windows.map((w, idx) => ({
                    id: `win-${d.day.toLowerCase()}-${Date.now().toString(36)}-${idx}`,
                    startTime: w.startTime,
                    endTime: w.endTime,
                  })),
                }));
                setForm({
                  ...form,
                  courts: [
                    ...form.courts,
                    {
                      name: "",
                      contact: "",
                      phone: "",
                      mapsLink: "",
                      lat: undefined,
                      lng: undefined,
                      weeklySchedule: clonedWeekly,
                      schedules: weeklyToScheduleSlots(clonedWeekly),
                      operatingHours: computeOperatingHoursFromWeekly(clonedWeekly),
                      feeType: form.rentalType === "Fixed amount" ? "fixed" : "per_hour",
                      feeAmount: undefined,
                      enableHalfCourts: true,
                      fullCourtHourlyRate: undefined,
                      halfCourtHourlyRate: undefined,
                    },
                  ],
                });
              }}
            >
              + Add court
            </Button>
          </div>
        </div>
      </Modal>

      {/* MODAL: Download Branch Data as CSV or PDF */}
      <Modal
        open={downloadModalOpen}
        title="Download Branch Data"
        meta="Download comprehensive facility dossier for 1 branch at a time"
        onClose={() => setDownloadModalOpen(false)}
      >
        <div className="space-y-4 p-4">
          <p className="text-xs text-ink-300">
            Select a branch showing in this page to generate and download its full profile, court
            locations, coaching teams, and player rosters.
          </p>

          <Field label="Select Branch">
            <Select
              value={targetBranch?.id || ""}
              onChange={(id) => setSelectedBranchId(id)}
              options={allowedBranches.map((b) => b.id)}
              labels={Object.fromEntries(
                allowedBranches.map((b) => [b.id, `${b.name} — ${b.city}`]),
              )}
            />
          </Field>

          {targetBranch && (
            <div className="rounded-lg border border-ink-800 bg-ink-900/60 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-display font-bold text-sm text-ink-100">
                  {targetBranch.name}
                </span>
                <Chip tone="accent">{targetBranch.city}</Chip>
              </div>
              <div className="text-xs text-ink-300">
                <span className="text-ink-400">Manager:</span>{" "}
                {targetBranch.manager || "Unassigned"}
              </div>
              <div className="text-xs text-ink-300">
                <span className="text-ink-400">Address:</span>{" "}
                {targetBranch.address || "No address yet"}
              </div>
              <div className="flex flex-wrap gap-2 pt-1 border-t border-ink-800/80 text-[11px] font-mono text-ink-400">
                <span>{targetBranch.courts.length} Courts</span>
                <span>·</span>
                <span>{db.teams.filter((t) => t.branch === targetBranch.name).length} Teams</span>
                <span>·</span>
                <span>
                  {db.players.filter((p) => p.branch === targetBranch.name).length} Players
                </span>
              </div>
            </div>
          )}

          <div className="pt-2 flex flex-col sm:flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1 flex items-center justify-center gap-2 py-2 text-xs bg-ink-850 hover:bg-ink-800 border-ink-700 text-ink-100"
              onClick={handleDownloadBranchCSV}
              disabled={!targetBranch}
            >
              <FileSpreadsheet className="w-4 h-4 text-good" />
              <span>Download Branch CSV</span>
            </Button>

            <Button
              type="button"
              variant="primary"
              className="flex-1 flex items-center justify-center gap-2 py-2 text-xs bg-court-500 hover:bg-court-400 text-ink-950 font-bold"
              onClick={handleDownloadBranchPDF}
              disabled={!targetBranch}
            >
              <FileText className="w-4 h-4" />
              <span>Download Branch PDF</span>
            </Button>
          </div>
        </div>
      </Modal>

      {cameraOpen && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 font-mono text-xs text-white">
              Starting camera...
            </div>
          }
        >
          <CameraCapture
            onCancel={() => setCameraOpen(false)}
            onCapture={(file) => {
              setExpenseAttachment(file);
              setCameraOpen(false);
            }}
          />
        </Suspense>
      )}

      {/* Branch WhatsApp Groups Modal */}
      <Modal
        open={!!whatsAppBranch}
        title={`${whatsAppBranch?.name || ""} Branch — WhatsApp Groups & Links`}
        meta={`Manage group invite links, coach broadcasts, and parent QR codes for ${whatsAppBranch?.name || ""} facility`}
        onClose={() => setWhatsAppBranch(null)}
        wide
      >
        {whatsAppBranch && (
          <div className="p-4">
            <Suspense
              fallback={
                <div className="p-8 text-center font-mono text-xs text-ink-400">
                  Loading WhatsApp Group Hub...
                </div>
              }
            >
              <WhatsAppGroupsManager
                embedded
                filterBranchId={whatsAppBranch.id}
                title={`${whatsAppBranch.name} WhatsApp Groups`}
              />
            </Suspense>
          </div>
        )}
      </Modal>

      {/* All Academy Branches WhatsApp Hub Modal */}
      <Modal
        open={allBranchWhatsAppOpen}
        title="Academy WhatsApp Groups & Channel Directory"
        meta="Manage invite links across all branches and teams"
        onClose={() => setAllBranchWhatsAppOpen(false)}
        wide
      >
        <div className="p-4">
          <Suspense
            fallback={
              <div className="p-8 text-center font-mono text-xs text-ink-400">
                Loading WhatsApp Group Hub...
              </div>
            }
          >
            <WhatsAppGroupsManager embedded />
          </Suspense>
        </div>
      </Modal>

      {/* Branch Deletion Confirmation Modal */}
      <Modal
        title={deletingBranch ? `Delete Branch: ${deletingBranch.name}` : "Delete Branch"}
        open={Boolean(deletingBranch)}
        onClose={() => setDeletingBranch(null)}
      >
        {deletingBranch && (
          <div className="space-y-4 p-4">
            <div className="text-sm text-ink-200">
              Are you sure you want to permanently delete the{" "}
              <strong className="text-ink-100">{deletingBranch.name}</strong> branch?
            </div>

            {(() => {
              const assignedTeams = countTeams(deletingBranch.name);
              const assignedPlayers = countPlayers(deletingBranch.name);
              const assignedCoaches = db.coaches.filter(
                (c) => c.branch?.toLowerCase() === deletingBranch.name.toLowerCase(),
              ).length;
              const hasAssignments =
                assignedTeams > 0 || assignedPlayers > 0 || assignedCoaches > 0;

              return hasAssignments ? (
                <div className="rounded-md bg-warn/10 p-3 border border-warn/30 space-y-1.5 text-xs">
                  <div className="font-semibold text-warn flex items-center gap-1.5">
                    <span>⚠️</span>
                    <span>Active Linked Assignments Detected</span>
                  </div>
                  <p className="text-ink-300">This branch currently has:</p>
                  <ul className="list-disc list-inside text-ink-200 font-mono space-y-0.5">
                    {assignedTeams > 0 && <li>{assignedTeams} assigned team(s)</li>}
                    {assignedPlayers > 0 && <li>{assignedPlayers} enrolled player(s)</li>}
                    {assignedCoaches > 0 && <li>{assignedCoaches} assigned coach(es)</li>}
                  </ul>
                  <p className="text-ink-300 mt-1">
                    Deleting this branch will cascade-clear these branch assignments to unassigned.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-ink-400">
                  No active teams or players are assigned to this branch. It can be safely removed.
                </p>
              );
            })()}

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDeletingBranch(null)}
                disabled={isDeletingBranch}
              >
                Cancel
              </Button>
              <Button
                variant="bad"
                size="sm"
                onClick={confirmDeleteBranch}
                disabled={isDeletingBranch}
              >
                {isDeletingBranch ? "Deleting..." : "Confirm & Delete"}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}

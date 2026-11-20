import { createFileRoute, Link, useRouterState } from "@tanstack/react-router";
import { useMemo, useState, useEffect, lazy, Suspense, type ReactNode } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
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
  money,
  Pagination,
  CategoryBadge,
} from "@/components/kit";
import { VirtualTable } from "@/components/virtual-table";
import {
  useDB,
  useCollection,
  useTenantUser,
  useModulePermissions,
  defaultRoleDefinitions,
  checkPlayerAgeEligibility,
  calculatePlayerAgeFromDob,
  resolveCategoryFromDob,
  evaluateTeamEligibilityForDob,
  formatAgeDate,
  findPlayerNextSession,
  getPlayerMonthlyPresentCount,
  DEFAULT_INSURANCE_COMPANIES,
  DEFAULT_TRAINING_PACKAGES,
  DEFAULT_SPECIAL_OFFERS,
  type InsuranceCompany,
  type TrainingPackage,
  type SpecialOfferConfig,
} from "@/lib/data-store";
import { useAuth } from "@/lib/auth";
import {
  uploadPlayerIdCard,
  uploadDocumentAttachment,
  type DocumentAttachment,
} from "@/lib/storage";
import { calculatePlayerMonthlyFee, calculatePlayerBaseFee } from "@/lib/payments";
import {
  detectFamilyGroups,
  exportFamilyStatementPdf,
  type FamilyGroup,
} from "@/lib/family-invoicing";
import { toast } from "sonner";
import type { Player, Invoice } from "@/lib/mock-data";
import type { LedgerEntry } from "@/lib/data-store";
import {
  QrCode,
  MessageSquare,
  FileText,
  Upload,
  Trash2,
  Calendar,
  Users,
  Wallet,
  Sparkles,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { openDirectWhatsApp } from "@/lib/whatsapp";
import { createAcademyNotification } from "@/lib/notifications";

const PlayerPassModal = lazy(() =>
  import("@/components/player-pass-modal").then((m) => ({ default: m.PlayerPassModal })),
);

function exportCSV(listName: string, playersList: Player[]) {
  const headers = [
    "Player,Primary Guardian,Primary Phone,2nd Guardian,2nd Phone,Fee,Balance,Status",
  ];
  const rows = playersList.map(
    (p) =>
      `"${p.name}","${p.parent}","${p.parentPhone}","${p.guardian2Name || ""}","${p.guardian2Phone || ""}",${p.fee},${p.balance},"${p.status}"`,
  );
  const csv = headers.concat(rows).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Vescio_${listName}_Payments_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function exportPDF(listName: string, playersList: Player[]) {
  const { default: jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF();
  doc.text(`Vescio Vector - ${listName} Payments`, 14, 15);
  autoTable(doc, {
    startY: 20,
    head: [["Player", "Primary Guardian", "Phone", "2nd Guardian", "Fee", "Balance", "Status"]],
    body: playersList.map((p) => [
      p.name,
      p.parent,
      p.parentPhone,
      p.guardian2Name ? `${p.guardian2Name} (${p.guardian2Phone || "—"})` : "—",
      String(p.fee),
      String(p.balance),
      p.status,
    ]),
  });
  doc.save(`Vescio_${listName}_Payments.pdf`);
}
export const Route = createFileRoute("/players")({
  head: () => ({
    meta: [
      { title: "Players — Vescio Vector" },
      {
        name: "description",
        content:
          "Player database with age categories, teams, guardians, monthly fees and payment status.",
      },
      { property: "og:title", content: "Players — Vescio Vector" },
      {
        property: "og:description",
        content: "Search, register and track players, teams and monthly fees.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PlayersPage,
});

const statusTone = {
  Active: "good",
  Idle: "warn",
  "Soft flag": "warn",
  Inactive: "bad",
  Suspended: "bad",
} as const;

const playerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  gender: z.enum(["Boy", "Girl"]),
  dob: z.string().min(1, "Date of birth is required"),
  category: z.string().optional(),
  teams: z.array(z.string()).optional(),
  feeNote: z.string().optional(),
  insuranceStatus: z.enum(["Academy insured", "Self insured", "Not insured"]).optional(),
  branch: z.string().min(1, "Branch is required"),
  phone: z.string().optional(),
  nationality: z.string().optional(),
  bloodType: z.string().optional(),
  medicalNotes: z.string().optional(),
  parent: z.string().min(2, "Primary guardian name is required"),
  parentPhone: z.string().min(6, "Valid phone number is required"),
  guardian2Name: z.string().optional(),
  guardian2Phone: z.string().optional(),
  school: z.string(),
  fee: z.number().min(0, "Fee cannot be negative"),
  teamFees: z.record(z.string(), z.number()).optional(),
  isScholarship: z.boolean().optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  discountAmount: z.number().min(0).optional(),
  specialOffer: z.string().optional(),
  specialOfferId: z.string().optional(),
  packageId: z.string().optional(),
  packageName: z.string().optional(),
  allowedPracticesPerMonth: z.number().min(0).optional(),
  familyId: z.string().optional(),
  balance: z.number(),
  status: z.enum(["Active", "Idle", "Soft flag", "Inactive", "Suspended"]),
  isInsured: z.boolean().optional(),
  insuranceCompanyId: z.string().optional(),
  insuranceCompanyName: z.string().optional(),
  insuranceFee: z.number().min(0).optional(),
  insurancePaid: z.boolean().optional(),
  insuranceBilledToBalance: z.boolean().optional(),
  insuranceLedgerId: z.string().optional(),
  insuranceExpiryDate: z.string().optional(),
  idCardUrl: z.string().optional(),
});

type PlayerFormValues = z.infer<typeof playerSchema>;

const blank: Omit<Player, "id"> = {
  name: "",
  gender: "Boy",
  dob: "",
  category: "",
  teams: [],
  branch: "",
  phone: "",
  nationality: "",
  bloodType: "",
  medicalNotes: "",
  parent: "",
  parentPhone: "",
  guardian2Name: "",
  guardian2Phone: "",
  school: "",
  fee: 85,
  teamFees: {},
  isScholarship: false,
  discountPercent: 0,
  discountAmount: 0,
  specialOffer: "",
  specialOfferId: "",
  packageId: "",
  packageName: "",
  allowedPracticesPerMonth: 0,
  familyId: "",
  balance: 0,
  status: "Active",
  feeNote: "",
  insuranceStatus: "Not insured",
  isInsured: false,
  insuranceCompanyId: "",
  insuranceCompanyName: "",
  insuranceFee: 0,
  insurancePaid: false,
  insuranceBilledToBalance: false,
  insuranceLedgerId: "",
  insuranceExpiryDate: "",
  idCardUrl: undefined,
};

function PlayersPage() {
  const {
    db,
    update,
    setEntity,
    deleteEntity,
    patchEntity,
    payInvoice,
    payFamilyBalance,
    editLedgerTransaction,
    deleteLedgerTransaction,
    movePlayerToCrmFollowUp,
    setPlayerIdleForRenewal,
    tenantId,
    ready,
  } = useDB();
  const { user, passwordUser, loading: authLoading } = useAuth();
  const { items: players } = useCollection("players");
  const { items: rawTeams } = useCollection("teams");
  const { items: rawBranches } = useCollection("branches");
  const currentUser = useTenantUser();
  const { canWrite, canDelete } = useModulePermissions("players");
  const rawRoles =
    db.customRoles && db.customRoles.length > 0 ? db.customRoles : defaultRoleDefinitions;
  const userRoleDef = rawRoles.find((r) => r.name === currentUser?.role);
  const roleLower = (currentUser?.role || "").toLowerCase();

  // Branch restriction: restricted to assigned facility if user is Branch Manager or branchScope is assigned branch only
  const isBranchRestricted = Boolean(
    currentUser &&
    currentUser.role !== "Super Admin" &&
    currentUser.role !== "Academy Manager" &&
    (currentUser.role === "Branch Manager" ||
      currentUser.branchScope === "Assigned branch only" ||
      userRoleDef?.scope === "Assigned branch only" ||
      userRoleDef?.defaultBranchScope === "Assigned branch only") &&
    Boolean(currentUser.branch) &&
    currentUser.branch !== "All",
  );
  const userBranch = isBranchRestricted ? currentUser?.branch || "" : "";

  // Authorized billing roles: Super Admin, Academy Manager, Accountant, or users with accounting write permissions
  const canManageBilling = Boolean(
    currentUser &&
    (currentUser.role === "Super Admin" ||
      currentUser.role === "Academy Manager" ||
      currentUser.role === "Accountant" ||
      roleLower.includes("super") ||
      roleLower.includes("accountant") ||
      Boolean(userRoleDef?.permissions?.["accounting"]?.write)),
  );

  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [branch, setBranch] = useState("");
  const [status, setStatus] = useState("");
  const [editing, setEditing] = useState<Player | null>(null);
  const [open, setOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentNote, setPaymentNote] = useState<string>("");
  const [reportsOpen, setReportsOpen] = useState(false);
  const [idUploading, setIdUploading] = useState(false);
  const [formDocuments, setFormDocuments] = useState<DocumentAttachment[]>([]);
  const [editingPaymentEntry, setEditingPaymentEntry] = useState<LedgerEntry | null>(null);
  const [editPayAmount, setEditPayAmount] = useState<number>(0);
  const [editPayDate, setEditPayDate] = useState<string>("");
  const [editPayNote, setEditPayNote] = useState<string>("");
  const [digitalPassPlayer, setDigitalPassPlayer] = useState<Player | null>(null);
  const [deletingPlayer, setDeletingPlayer] = useState<Player | null>(null);
  const [familyPaymentGroup, setFamilyPaymentGroup] = useState<FamilyGroup | null>(null);
  const [familyPayAmount, setFamilyPayAmount] = useState<number>(0);
  const [familyPayMethod, setFamilyPayMethod] = useState<string>("Cash");
  const [familyPayNote, setFamilyPayNote] = useState<string>("");
  const [isSubmittingFamilyPay, setIsSubmittingFamilyPay] = useState(false);
  const [showAllPlayerPayments, setShowAllPlayerPayments] = useState(false);
  const [showAttendanceLog, setShowAttendanceLog] = useState(true);
  const [insurancePaymentHandling, setInsurancePaymentHandling] = useState<
    "collect_now" | "add_to_balance"
  >("collect_now");

  // Upgrade / Change Package Modal State
  const [upgradeModalPlayer, setUpgradeModalPlayer] = useState<Player | null>(null);
  const [upgradeTargetPkgId, setUpgradeTargetPkgId] = useState<string>("");
  const [upgradeMode, setUpgradeMode] = useState<"mid_month" | "new_month">("mid_month");
  const [upgradePaymentHandling, setUpgradePaymentHandling] = useState<
    "collect_now" | "bill_balance"
  >("collect_now");
  const [upgradePaymentMethod, setUpgradePaymentMethod] = useState<string>("Cash");
  const [isUpgradingPackage, setIsUpgradingPackage] = useState(false);

  const insuranceCompanies: InsuranceCompany[] = useMemo(
    () =>
      Array.isArray(db.academy?.insuranceCompanies) && db.academy.insuranceCompanies.length > 0
        ? db.academy.insuranceCompanies.filter((c) => c.active !== false)
        : DEFAULT_INSURANCE_COMPANIES,
    [db.academy?.insuranceCompanies],
  );

  const trainingPackages: TrainingPackage[] = useMemo(
    () =>
      Array.isArray(db.academy?.trainingPackages) && db.academy.trainingPackages.length > 0
        ? db.academy.trainingPackages.filter((p) => p.active !== false)
        : DEFAULT_TRAINING_PACKAGES,
    [db.academy?.trainingPackages],
  );

  const specialOffers: SpecialOfferConfig[] = useMemo(
    () =>
      Array.isArray(db.academy?.specialOffers) && db.academy.specialOffers.length > 0
        ? db.academy.specialOffers.filter((o) => o.active !== false)
        : DEFAULT_SPECIAL_OFFERS,
    [db.academy?.specialOffers],
  );

  const {
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<PlayerFormValues>({
    resolver: zodResolver(playerSchema),
    defaultValues: blank,
  });

  const watchedTeams = watch("teams") || [];
  const watchedTeamFees = watch("teamFees") || {};
  const watchedFee = watch("fee") ?? 0;
  const watchedIsScholarship = Boolean(watch("isScholarship"));
  const watchedDiscountPercent = Number(watch("discountPercent") || 0);
  const watchedDiscountAmount = Number(watch("discountAmount") || 0);
  const watchedSpecialOffer = watch("specialOffer") || "";
  const watchedSpecialOfferId = watch("specialOfferId") || "";
  const watchedPackageId = watch("packageId") || "";
  const watchedIsInsured = Boolean(watch("isInsured"));
  const watchedInsuranceCompanyId = watch("insuranceCompanyId") || "";
  const watchedInsuranceFee = Number(watch("insuranceFee") || 0);
  const watchedDob = watch("dob");
  const watchedCategory = watch("category");
  const isDobMatrixMode = (db.academy?.assignmentMode || "direct") === "dob_matrix";
  const watchedAgeInfo = useMemo(() => calculatePlayerAgeFromDob(watchedDob), [watchedDob]);
  const autoResolvedCategory = useMemo(
    () =>
      resolveCategoryFromDob(
        watchedDob,
        db.ageCategoryRules,
        db.lists?.["Age categories"] ?? ["U-10", "U-12", "U-14", "U-16", "U-18", "Senior"],
      ),
    [watchedDob, db.ageCategoryRules, db.lists],
  );
  const formAgeCheck = useMemo(
    () =>
      checkPlayerAgeEligibility(
        watchedDob,
        isDobMatrixMode ? autoResolvedCategory : watchedCategory,
        db.ageCategoryRules,
      ),
    [watchedDob, isDobMatrixMode, autoResolvedCategory, watchedCategory, db.ageCategoryRules],
  );

  const [selected, setSelected] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const locationSearch = useRouterState({ select: (s) => s.location.searchStr });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(locationSearch || window.location.search);
    const pid = params.get("playerId") || params.get("scanPlayerId");
    if (pid) {
      setSelected(pid);
    }
  }, [locationSearch]);

  const accessiblePlayers = useMemo(() => {
    if (!isBranchRestricted || !userBranch) return players;
    return players.filter((p) => p.branch?.toLowerCase() === userBranch.toLowerCase());
  }, [players, isBranchRestricted, userBranch]);

  const categories = useMemo(
    () =>
      Array.from(
        new Set([
          ...(db.lists["Age categories"] || []),
          ...accessiblePlayers.map((p) => p.category).filter(Boolean),
        ]),
      ),
    [db.lists, accessiblePlayers],
  );
  const branches = useMemo(() => rawBranches.map((b) => b.name), [rawBranches]);
  const teams = useMemo(() => rawTeams.map((t) => t.name), [rawTeams]);

  const filtered = accessiblePlayers.filter((p) => {
    const needle = q.trim().toLowerCase();
    const match =
      !needle ||
      [p.name, p.parent, p.parentPhone, p.school, (p.teams || []).join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    return (
      match &&
      (!cat || p.category === cat) &&
      (isBranchRestricted || !branch || p.branch === branch) &&
      (!status || p.status === status)
    );
  });

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [q, cat, branch, status]);

  const pagedPlayers = filtered.slice((page - 1) * pageSize, page * pageSize);

  const due = accessiblePlayers.reduce((a, p) => a + Math.max(0, p.balance || 0), 0);
  const active = accessiblePlayers.filter((p) => p.status === "Active").length;
  const flagged = accessiblePlayers.filter((p) => p.status === "Soft flag").length;
  const academyPlayerLimit = db.academy?.playersLimit || 400;
  const atLimit = (db.players?.length || 0) >= academyPlayerLimit;

  const detail = accessiblePlayers.find((p) => p.id === selected) ?? accessiblePlayers[0];
  const payFor = detail;

  // Detect all multi-athlete family groups to link siblings in the Player Profile Drawer
  const allFamilyGroups = useMemo(() => {
    const now = new Date();
    const monthName = now.toLocaleString("en-US", { month: "long" });
    return detectFamilyGroups(
      db.players,
      rawTeams,
      rawBranches,
      db.invoices || [],
      monthName,
      now.getFullYear(),
    );
  }, [db.players, rawTeams, rawBranches, db.invoices]);

  const detailFamilyGroup = useMemo(() => {
    if (!detail) return null;
    return allFamilyGroups.find((fg) => fg.children.some((c) => c.player.id === detail.id)) || null;
  }, [allFamilyGroups, detail]);

  const playerAttendanceStats = useMemo(() => {
    if (!detail) return null;
    let present = 0;
    let excused = 0;
    let absent = 0;
    let totalLogged = 0;
    const assignedTeams = detail.teams || [];

    const playerSessions = db.sessions.filter(
      (session) =>
        (session.team && assignedTeams.includes(session.team)) ||
        (session.teamA && assignedTeams.includes(session.teamA)) ||
        (session.teamB && assignedTeams.includes(session.teamB)),
    );

    for (const session of playerSessions) {
      const isBranchMatch = !session.branch || session.branch === detail.branch;
      const sessionRec = db.attendance[session.id] || {};
      const status = sessionRec[detail.id];

      const sessionAttendees = (session as { attendees?: string[] }).attendees;
      if (
        status === "Present" ||
        (Array.isArray(sessionAttendees) && sessionAttendees.includes(detail.id))
      ) {
        present++;
        totalLogged++;
      } else if (status === "Excused") {
        excused++;
        totalLogged++;
      } else if (status === "Absent") {
        absent++;
        totalLogged++;
      } else if (isBranchMatch && session.status === "Completed") {
        absent++;
        totalLogged++;
      }
    }

    const reliabilityRate =
      totalLogged > 0 ? Math.round(((present + excused) / totalLogged) * 100) : 100;
    const presentOnlyRate = totalLogged > 0 ? Math.round((present / totalLogged) * 100) : 100;

    return { present, excused, absent, totalLogged, reliabilityRate, presentOnlyRate };
  }, [detail, db.sessions, db.attendance]);

  function openNew() {
    if (!canWrite) return;
    if (atLimit) {
      toast.error(
        `Academy player limit of ${academyPlayerLimit} has been reached. You cannot register new players.`,
      );
      return;
    }
    setEditing(null);
    setFormDocuments([]);
    setInsurancePaymentHandling("collect_now");
    const firstTeam = teams[0];
    const firstTeamObj = rawTeams.find((t) => t.name === firstTeam);
    const defaultTeamFee = firstTeamObj?.monthlyFee || 85;
    const initialTeams = isDobMatrixMode ? [] : firstTeam ? [firstTeam] : [];
    const initialFees: Record<string, number> = {};
    if (!isDobMatrixMode && firstTeam) {
      initialFees[firstTeam] = defaultTeamFee;
    }
    reset({
      ...blank,
      branch: isBranchRestricted ? userBranch : (branches[0] ?? ""),
      teams: initialTeams,
      teamFees: initialFees,
      fee: initialTeams.length ? defaultTeamFee : 85,
      category: db.lists["Age categories"]?.[0] ?? "U-12",
    });
    setOpen(true);
  }

  function openEdit(p: Player) {
    if (!canWrite) return;
    setEditing(p);
    setInsurancePaymentHandling(
      p.insuranceBilledToBalance && !p.insurancePaid ? "add_to_balance" : "collect_now",
    );
    const existingDocs: DocumentAttachment[] = Array.isArray(p.documents)
      ? p.documents.map((d) => ({
          id: String(d.id || `doc-${Date.now().toString(36)}`),
          name: String(d.name || "Official Document"),
          type: String(d.type || "application/octet-stream"),
          url: String(d.url || ""),
          uploadedAt: String(d.uploadedAt || new Date().toISOString()),
          size: Number(d.size || 0),
        }))
      : p.idCardUrl
        ? [
            {
              id: `doc-legacy-${p.id}`,
              name: String(p.idCardName || "Official ID Document"),
              type: "image/jpeg",
              url: String(p.idCardUrl),
              uploadedAt: new Date().toISOString(),
              size: 0,
            },
          ]
        : [];
    setFormDocuments(existingDocs);
    const { id: _id, ...rest } = p;
    const initialFees: Record<string, number> = { ...(p.teamFees || {}) };
    const playerTeams = p.teams || [];
    if (playerTeams.length > 0) {
      playerTeams.forEach((t) => {
        if (initialFees[t] === undefined) {
          initialFees[t] = p.isScholarship
            ? 0
            : Math.round((p.fee ?? 0) / Math.max(1, playerTeams.length));
        }
      });
    }
    const isIns = Boolean(p.isInsured || p.insuranceStatus === "Academy insured");
    reset({
      ...blank,
      ...rest,
      teamFees: initialFees,
      isScholarship: Boolean(p.isScholarship),
      discountPercent: Number(p.discountPercent || 0),
      discountAmount: Number(p.discountAmount || 0),
      specialOffer: p.specialOffer || "",
      specialOfferId: p.specialOfferId || "",
      packageId: p.packageId || "",
      packageName: p.packageName || "",
      allowedPracticesPerMonth: Number(p.allowedPracticesPerMonth || 0),
      isInsured: isIns,
      insuranceCompanyId: p.insuranceCompanyId || "",
      insuranceCompanyName: p.insuranceCompanyName || "",
      insuranceFee: Number(p.insuranceFee || 0),
      insurancePaid: Boolean(p.insurancePaid),
      insuranceBilledToBalance: Boolean(p.insuranceBilledToBalance),
      insuranceLedgerId: p.insuranceLedgerId || "",
      insuranceExpiryDate: p.insuranceExpiryDate || "",
      familyId: p.familyId || "",
      phone: p.phone || "",
      nationality: p.nationality || "",
      bloodType: p.bloodType || "",
      medicalNotes: p.medicalNotes || "",
    });
    setOpen(true);
  }

  function submit(data: PlayerFormValues) {
    if (!canWrite) return;
    if (!editing && (db.players?.length || 0) >= academyPlayerLimit) {
      toast.error(
        `Academy player limit of ${academyPlayerLimit} has been reached. You cannot register new players.`,
      );
      return;
    }
    const effectiveTeams = isDobMatrixMode
      ? editing
        ? editing.teams || []
        : []
      : data.teams || [];
    if (!isDobMatrixMode && effectiveTeams.length === 0 && teams.length > 0) {
      toast.error("At least one team is required in Direct Assignment mode.");
      return;
    }
    const effectiveCategory = isDobMatrixMode
      ? resolveCategoryFromDob(
          data.dob,
          db.ageCategoryRules,
          db.lists?.["Age categories"] ?? ["U-10", "U-12", "U-14", "U-16", "U-18", "Senior"],
        )
      : data.category ||
        resolveCategoryFromDob(
          data.dob,
          db.ageCategoryRules,
          db.lists?.["Age categories"] ?? ["U-10", "U-12", "U-14", "U-16", "U-18", "Senior"],
        );
    const finalBranch = isBranchRestricted ? userBranch : data.branch;
    const isScholarship = canManageBilling
      ? Boolean(data.isScholarship)
      : editing
        ? Boolean(editing.isScholarship)
        : Boolean(data.isScholarship);
    const discountPercent = canManageBilling
      ? Math.max(0, Math.min(100, Number(data.discountPercent) || 0))
      : editing
        ? Number(editing.discountPercent || 0)
        : Math.max(0, Math.min(100, Number(data.discountPercent) || 0));
    const discountAmount = canManageBilling
      ? Math.max(0, Number(data.discountAmount) || 0)
      : editing
        ? Number(editing.discountAmount || 0)
        : Math.max(0, Number(data.discountAmount) || 0);
    const specialOffer = canManageBilling
      ? (data.specialOffer || "").trim()
      : editing
        ? editing.specialOffer || ""
        : (data.specialOffer || "").trim();

    const selectedPkg = trainingPackages.find((pk) => pk.id === data.packageId);
    const resolvedPackageId = selectedPkg ? selectedPkg.id : data.packageId || "";
    const resolvedPackageName = selectedPkg ? selectedPkg.name : data.packageName || "";
    const resolvedAllowedPractices = selectedPkg
      ? selectedPkg.practicesPerMonth
      : Number(data.allowedPracticesPerMonth || 0);

    const rawFee = canManageBilling ? Number(data.fee) : editing ? editing.fee : Number(data.fee);
    const rawTeamFees = canManageBilling
      ? data.teamFees
      : editing
        ? editing.teamFees
        : data.teamFees;

    const finalTeamFees: Record<string, number> = {};
    if (isScholarship || discountPercent >= 100) {
      effectiveTeams.forEach((t) => {
        finalTeamFees[t] = 0;
      });
    } else if (rawTeamFees) {
      Object.assign(finalTeamFees, rawTeamFees);
    }

    const isExplicitZero =
      isScholarship ||
      discountPercent >= 100 ||
      (typeof rawFee === "number" && !Number.isNaN(rawFee) && rawFee === 0);

    const finalFee = isExplicitZero
      ? 0
      : selectedPkg
        ? Math.max(
            0,
            Math.round(selectedPkg.monthlyPrice * (1 - discountPercent / 100)) - discountAmount,
          )
        : calculatePlayerMonthlyFee(
            {
              fee: rawFee,
              teams: effectiveTeams,
              teamFees: finalTeamFees,
              branch: finalBranch,
              isScholarship,
              discountPercent,
              discountAmount,
              specialOffer,
            },
            rawTeams,
            rawBranches,
          );
    let finalBalance = canManageBilling ? data.balance : editing ? editing.balance : data.balance;

    // Multi-Company Player Insurance & Ledger Processing (Point 5)
    const isInsured = Boolean(data.isInsured || data.insuranceStatus === "Academy insured");
    const matchedInsComp = insuranceCompanies.find((c) => c.id === data.insuranceCompanyId);
    const insCompanyId = isInsured ? matchedInsComp?.id || data.insuranceCompanyId || "" : "";
    const insCompanyName = isInsured
      ? matchedInsComp?.name || data.insuranceCompanyName || "Academy Insurance"
      : "";
    const insFee = isInsured ? Math.max(0, Number(data.insuranceFee) || 0) : 0;

    let insPaid = Boolean(editing?.insurancePaid);
    let insBilledToBalance = Boolean(editing?.insuranceBilledToBalance);
    let insLedgerId = editing?.insuranceLedgerId || "";
    const playerId = editing ? editing.id : `p-${Date.now().toString(36)}`;

    let newInsuranceLedgerEntry: LedgerEntry | null = null;
    if (isInsured && insFee > 0) {
      if (insurancePaymentHandling === "collect_now" && !insPaid) {
        const ledgerId = `l-ins-${playerId}-${Date.now().toString(36)}`;
        newInsuranceLedgerEntry = {
          id: ledgerId,
          date: new Date().toISOString().slice(0, 10),
          account: "Player Insurance",
          category: "Insurance",
          entry: `Player Insurance · ${data.name} · ${insCompanyName}`,
          description: `Player Insurance · ${data.name} · ${insCompanyName}`,
          type: "Revenue",
          status: "Collected",
          amount: insFee,
          paymentMethod: "Cash",
          branch: finalBranch,
          playerId,
          referenceId: playerId,
          insuranceCompanyId: insCompanyId,
          insuranceCompanyName: insCompanyName,
          note: `Insurance policy (${insCompanyName}) collected for ${data.name}`,
        };
        insPaid = true;
        insLedgerId = ledgerId;
        if (insBilledToBalance) {
          finalBalance = Math.max(0, (finalBalance || 0) - insFee);
          insBilledToBalance = false;
        }
      } else if (insurancePaymentHandling === "add_to_balance" && !insPaid && !insBilledToBalance) {
        insPaid = false;
        insBilledToBalance = true;
        finalBalance = Math.max(0, (finalBalance || 0) + insFee);
      }
    } else if (!isInsured) {
      insPaid = false;
      insBilledToBalance = false;
      insLedgerId = "";
    }

    const sanitizedDocs: DocumentAttachment[] = formDocuments
      .filter((d) => Boolean(d && d.url))
      .map((d) => ({
        id: String(d.id || `doc-${Date.now().toString(36)}`),
        name: String(d.name || "Official Document"),
        type: String(d.type || "application/octet-stream"),
        url: String(d.url),
        uploadedAt: String(d.uploadedAt || new Date().toISOString()),
        size: Number(d.size || 0),
      }));
    const primaryDocUrl = sanitizedDocs[0]?.url || data.idCardUrl;

    const pData: Player = {
      id: playerId,
      name: data.name,
      gender: data.gender,
      dob: data.dob,
      category: effectiveCategory,
      teams: effectiveTeams,
      teamFees: finalTeamFees,
      branch: finalBranch,
      parent: data.parent,
      parentPhone: data.parentPhone,
      ...(data.guardian2Name ? { guardian2Name: data.guardian2Name } : {}),
      ...(data.guardian2Phone ? { guardian2Phone: data.guardian2Phone } : {}),
      school: data.school || "",
      fee: finalFee,
      isScholarship,
      ...(discountPercent > 0 ? { discountPercent } : { discountPercent: 0 }),
      ...(discountAmount > 0 ? { discountAmount } : { discountAmount: 0 }),
      ...(specialOffer ? { specialOffer } : { specialOffer: "" }),
      ...(data.specialOfferId ? { specialOfferId: data.specialOfferId } : { specialOfferId: "" }),
      ...(resolvedPackageId ? { packageId: resolvedPackageId } : { packageId: "" }),
      ...(resolvedPackageName ? { packageName: resolvedPackageName } : { packageName: "" }),
      ...(resolvedAllowedPractices > 0
        ? { allowedPracticesPerMonth: resolvedAllowedPractices }
        : { allowedPracticesPerMonth: 0 }),
      ...(data.familyId?.trim() ? { familyId: data.familyId.trim() } : {}),
      balance: Math.max(0, finalBalance || 0),
      status: data.status,
      ...(data.status === "Idle"
        ? {
            idleSinceDate: editing?.idleSinceDate || new Date().toISOString().slice(0, 10),
            missedSessionsSinceIdle: editing?.missedSessionsSinceIdle ?? 0,
            idleMissedSessionIds: editing?.idleMissedSessionIds ?? [],
          }
        : {
            idleSinceDate: "",
            missedSessionsSinceIdle: 0,
            idleMissedSessionIds: [],
          }),
      ...(editing?.crmFollowUpStatus ? { crmFollowUpStatus: editing.crmFollowUpStatus } : {}),
      ...(editing?.crmMovedAt ? { crmMovedAt: editing.crmMovedAt } : {}),
      phone: data.phone || "",
      nationality: data.nationality || "",
      bloodType: data.bloodType || "",
      medicalNotes: data.medicalNotes || "",
      ...(editing?.medicalStatus ? { medicalStatus: editing.medicalStatus } : {}),
      ...(editing?.rtpStage ? { rtpStage: editing.rtpStage } : {}),
      ...(data.feeNote ? { feeNote: data.feeNote } : {}),
      insuranceStatus: isInsured
        ? "Academy insured"
        : data.insuranceStatus === "Self insured"
          ? "Self insured"
          : "Not insured",
      isInsured,
      insuranceCompanyId: insCompanyId,
      insuranceCompanyName: insCompanyName,
      insuranceFee: insFee,
      insurancePaid: insPaid,
      insuranceBilledToBalance: insBilledToBalance,
      insuranceLedgerId: insLedgerId,
      ...(data.insuranceExpiryDate ? { insuranceExpiryDate: data.insuranceExpiryDate } : {}),
      ...(primaryDocUrl ? { idCardUrl: primaryDocUrl } : {}),
      documents: sanitizedDocs,
    };

    setEntity("players", pData);
    if (newInsuranceLedgerEntry) {
      setEntity("ledger", newInsuranceLedgerEntry);
      toast.success(
        `Insurance fee ($${insFee} · ${insCompanyName}) collected and logged in Accounting Ledger.`,
      );
    }
    const ageCheck = checkPlayerAgeEligibility(data.dob, data.category, db.ageCategoryRules);
    if (ageCheck.isExceeding) {
      toast.warning(
        `⚠️ Age Limit Warning: ${data.name} exceeds the ${data.category} age limit! An overage warning sign will remain next to his name on the team.`,
        { duration: 6000 },
      );
    }
    setOpen(false);
  }

  function remove(p: Player) {
    if (!canDelete) return;
    setDeletingPlayer(p);
  }

  function confirmDeletePlayer() {
    if (!canDelete || !deletingPlayer) return;
    const p = deletingPlayer;
    update((prev) => {
      const nextPlayers = prev.players.filter((player) => player.id !== p.id);

      const nextAttendance = { ...prev.attendance };
      Object.keys(nextAttendance).forEach((sId) => {
        if (nextAttendance[sId] && p.id in nextAttendance[sId]) {
          const { [p.id]: _, ...rest } = nextAttendance[sId];
          nextAttendance[sId] = rest;
        }
      });

      const nextAttendanceMeta = prev.attendanceMeta ? { ...prev.attendanceMeta } : undefined;
      if (nextAttendanceMeta) {
        Object.keys(nextAttendanceMeta).forEach((sId) => {
          if (nextAttendanceMeta[sId] && p.id in nextAttendanceMeta[sId]) {
            const { [p.id]: _, ...rest } = nextAttendanceMeta[sId];
            nextAttendanceMeta[sId] = rest;
          }
        });
      }

      const nextSessions = prev.sessions.map((s) => {
        if (s.attendees && s.attendees.includes(p.id)) {
          return { ...s, attendees: s.attendees.filter((aId) => aId !== p.id) };
        }
        return s;
      });

      return {
        ...prev,
        players: nextPlayers,
        sessions: nextSessions,
        attendance: nextAttendance,
        ...(nextAttendanceMeta ? { attendanceMeta: nextAttendanceMeta } : {}),
      };
    });
    toast.success(`Player "${p.name}" deleted and attendance records cleaned up.`);
    setDeletingPlayer(null);
  }

  function submitPay(e?: React.FormEvent) {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    if (!canManageBilling) {
      toast.error(
        "Unauthorized: Billing collections are restricted to authorized financial personnel.",
      );
      return;
    }
    if (!payFor) return;
    const amount = Math.abs(Number(paymentAmount) || 0);
    if (!amount || Number.isNaN(amount)) return;
    const todayIso = new Date().toISOString().slice(0, 10);
    let remainingToSettle = amount;
    const invoicesToSettle = (db.invoices || [])
      .filter(
        (inv) =>
          inv.playerId === payFor.id && (inv.status === "pending" || inv.status === "overdue"),
      )
      .sort((a, b) =>
        (a.dueDate || a.issuedDate || "").localeCompare(b.dueDate || b.issuedDate || ""),
      )
      .filter((inv) => {
        if (remainingToSettle <= 0) return false;
        remainingToSettle -= inv.amount;
        return true;
      });
    const unpaidIdsToSettle = new Set(invoicesToSettle.map((inv) => inv.id));

    update((d) => ({
      ...d,
      players: d.players.map((p) =>
        p.id === payFor.id
          ? {
              ...p,
              balance: Math.max(0, (p.balance || 0) - amount),
              status: p.status === "Idle" || (p.balance || 0) - amount <= 0 ? "Active" : p.status,
              ...(p.status === "Idle" || (p.balance || 0) - amount <= 0
                ? {
                    idleSinceDate: "",
                    missedSessionsSinceIdle: 0,
                    idleMissedSessionIds: [],
                  }
                : {}),
            }
          : p,
      ),
      invoices: (d.invoices || []).map((inv) =>
        unpaidIdsToSettle.has(inv.id)
          ? {
              ...inv,
              status: "paid" as const,
              paidDate: todayIso,
              paidAmount: inv.amount,
              paymentMethod: "Cash",
            }
          : inv,
      ),
      ledger: [
        {
          id: `l-${Date.now().toString(36)}`,
          date: todayIso,
          account: "Monthly fees",
          entry: `${payFor.name} · payment`,
          type: "Revenue" as const,
          amount: Math.abs(amount),
          status: "Collected" as const,
          paymentMethod: "Cash",
          branch: payFor.branch || "",
          note: paymentNote,
          playerId: payFor.id,
          ...(invoicesToSettle[0]?.id ? { referenceId: invoicesToSettle[0].id } : {}),
        },
        ...d.ledger,
      ],
    }));

    for (const inv of invoicesToSettle) {
      void patchEntity("invoices", inv.id, {
        status: "paid",
        paidDate: todayIso,
        paidAt: todayIso,
        paidAmount: inv.amount,
        paymentMethod: "Cash",
      } as Partial<(typeof db.invoices)[number]>);
    }
    void createAcademyNotification(tenantId, {
      title: `Tuition Payment Collected: ${payFor.name}`,
      message: `Collected ${money(amount, db.academy?.currency)} tuition payment from ${payFor.name}${payFor.branch ? ` (${payFor.branch})` : ""}.`,
      type: "billing",
      targetRoles: ["super_admin", "accountant", "branch_manager"],
      targetBranchId: payFor.branch || undefined,
      actionUrl: "/accounting",
      createdAt: new Date().toISOString(),
      readBy: [],
      dismissedBy: [],
    }).catch(() => {});
    setPaymentOpen(false);
  }

  if (authLoading && !currentUser && !user && !passwordUser) {
    return (
      <AppShell crumb="ROSTER / PLAYERS" title="Players">
        <div className="flex h-64 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-court-500 border-t-transparent" />
          <span className="ml-3 font-mono text-xs text-ink-400">Loading player roster…</span>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb="ROSTER / PLAYERS" title="Players">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={isBranchRestricted ? `Players (${userBranch})` : "Total players"}
          value={String(accessiblePlayers.length)}
          note={isBranchRestricted ? "assigned facility" : `limit ${db.academy.playersLimit}`}
          accent
        />
        <Stat label="Active" value={String(active)} note="in good standing" />
        <Stat label="Flagged" value={String(flagged)} note="soft deadline passed" />
        <Stat label="Open balance" value={money(due)} note="accessible players" accent />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_260px]">
        <Panel
          title={isBranchRestricted ? `Player database · ${userBranch}` : "Player database"}
          meta="Search by player, guardian, school or phone"
          action={
            <>
              <Button variant="outline" onClick={() => setReportsOpen(true)} className="shrink-0">
                Payments Report
              </Button>
              <FilterSelect label="Category" value={cat} onChange={setCat} options={categories} />
              {!isBranchRestricted ? (
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
              <FilterSelect
                label="Status"
                value={status}
                onChange={setStatus}
                options={["Active", "Idle", "Soft flag", "Inactive"]}
              />
              {canWrite && (
                <Button
                  onClick={openNew}
                  disabled={atLimit}
                  className={atLimit ? "opacity-60 cursor-not-allowed" : ""}
                  title={atLimit ? `Player limit reached (${academyPlayerLimit} max)` : ""}
                >
                  + New player
                </Button>
              )}
            </>
          }
        >
          {atLimit ? (
            <div className="border-b border-ink-800 bg-warn/10 px-4 py-2 font-mono text-[11px] text-warn">
              Player limit reached for this package — upgrade to add more.
            </div>
          ) : null}
          <div className="border-b border-ink-800 px-4 py-3">
            <Search value={q} onChange={setQ} placeholder="Search name, parent name or phone…" />
          </div>
          {/* Virtualized Table View */}
          <div className="overflow-x-auto w-full -mx-4 px-4 sm:mx-0 sm:px-0">
            <VirtualTable
              data={pagedPlayers}
              colSpan={6}
              head={
                <>
                  <Th>PLAYER</Th>
                  <Th>CATEGORY</Th>
                  <Th hide>TEAM</Th>
                  <Th hide>GUARDIAN</Th>
                  <Th>FEE</Th>
                  <Th>
                    <span className="block text-right">STATUS</span>
                  </Th>
                </>
              }
              footer={
                <Pagination
                  page={page}
                  pageSize={pageSize}
                  total={filtered.length}
                  setPage={setPage}
                />
              }
              emptyState={<EmptyState>No players match these filters.</EmptyState>}
              renderRow={(p) => (
                <>
                  <Td strong>
                    <button
                      type="button"
                      onClick={() => setSelected(p.id)}
                      className="block text-left leading-tight"
                    >
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span>{p.name}</span>
                        {p.isScholarship ? (
                          <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-300 ring-1 ring-emerald-500/40">
                            <span>🎓</span>
                            <span>Scholarship / Free</span>
                          </span>
                        ) : null}
                        {p.specialOffer ? (
                          <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-300 ring-1 ring-amber-500/40">
                            <span>★</span>
                            <span>{p.specialOffer}</span>
                          </span>
                        ) : null}
                        {p.medicalStatus && p.medicalStatus !== "Fit" ? (
                          <span
                            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[9px] font-bold ring-1 ${
                              p.medicalStatus === "Injured"
                                ? "bg-red-500/20 text-red-300 ring-red-500/40"
                                : "bg-amber-500/20 text-amber-300 ring-amber-500/40"
                            }`}
                            title="Synced from Vescio Nexus Physiotherapy Module"
                          >
                            <span>
                              {p.medicalStatus === "Injured"
                                ? "🏥 INJURED / OUT"
                                : "⚕️ LIMITED TRAINING"}
                            </span>
                            {p.rtpStage ? <span>(RTP {p.rtpStage}/5)</span> : null}
                          </span>
                        ) : null}
                        {p.medicalNotes ? (
                          <span
                            className="inline-flex items-center gap-1 rounded bg-rose-500/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-rose-300 ring-1 ring-rose-500/40"
                            title={`Medical / Allergy Alert: ${p.medicalNotes}`}
                          >
                            <span>🩸</span>
                            <span>MED ALERT</span>
                          </span>
                        ) : null}
                        {(() => {
                          const ageCheck = checkPlayerAgeEligibility(
                            p.dob,
                            p.category,
                            db.ageCategoryRules,
                          );
                          if (ageCheck.isExceeding) {
                            return (
                              <span
                                className="rounded bg-bad/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-bad ring-1 ring-bad/30"
                                title={ageCheck.reason}
                              >
                                ⚠️ OVERAGE
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </div>
                      <div className="font-mono text-[10px] text-ink-400 flex items-center gap-1.5 flex-wrap">
                        <span>
                          {p.gender} · {p.dob ? formatAgeDate(p.dob) : "—"} · {p.branch || "—"}
                        </span>
                        {p.nationality ? (
                          <span className="text-ink-300">· {p.nationality}</span>
                        ) : null}
                        {p.bloodType ? (
                          <span className="text-rose-400 font-semibold">· {p.bloodType}</span>
                        ) : null}
                        {p.phone ? <span className="text-court-400">· 📱 {p.phone}</span> : null}
                        {p.medicalNotes ? (
                          <span
                            className="rounded bg-rose-500/15 px-1 py-0.5 text-[9px] font-bold text-rose-400 ring-1 ring-rose-500/30"
                            title={`Medical Alert: ${p.medicalNotes}`}
                          >
                            🩸 MED ALERT
                          </span>
                        ) : null}
                      </div>
                    </button>
                  </Td>
                  <Td>
                    <CategoryBadge category={p.category} />
                  </Td>
                  <Td hide>{p.teams?.join(", ") || "—"}</Td>
                  <Td hide>
                    <div className="leading-tight space-y-1">
                      <div>
                        <div className="text-xs text-ink-100 font-medium">{p.parent || "—"}</div>
                        {p.parentPhone ? (
                          <div className="flex items-center gap-1.5 font-mono text-[10px] text-ink-400">
                            <span>{p.parentPhone}</span>
                            <button
                              type="button"
                              title={`WhatsApp ${p.parent || "Guardian 1"} (${p.parentPhone})`}
                              onClick={(e) => {
                                e.stopPropagation();
                                openDirectWhatsApp(
                                  p.parentPhone,
                                  `Hello ${p.parent || "Guardian"}, reaching out from ${db.academy?.name || "Vescio Vector Academy"} regarding ${p.name}.`,
                                );
                              }}
                              className="inline-flex items-center gap-0.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-400 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 transition-colors"
                            >
                              <MessageSquare className="w-2.5 h-2.5" />
                              <span>WA</span>
                            </button>
                          </div>
                        ) : null}
                      </div>
                      {(p.guardian2Name || p.guardian2Phone) && (
                        <div className="pt-1 border-t border-ink-800/60">
                          <span className="text-[9px] font-mono text-ink-400 uppercase tracking-wider block">
                            Guardian 2
                          </span>
                          <div className="text-xs text-ink-200">{p.guardian2Name || "—"}</div>
                          {p.guardian2Phone ? (
                            <div className="flex items-center gap-1.5 font-mono text-[10px] text-ink-400">
                              <span>{p.guardian2Phone}</span>
                              <button
                                type="button"
                                title={`WhatsApp ${p.guardian2Name || "Guardian 2"} (${p.guardian2Phone})`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openDirectWhatsApp(
                                    p.guardian2Phone!,
                                    `Hello ${p.guardian2Name || "Guardian"}, reaching out from ${db.academy?.name || "Vescio Vector Academy"} regarding ${p.name}.`,
                                  );
                                }}
                                className="inline-flex items-center gap-0.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-400 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 transition-colors"
                              >
                                <MessageSquare className="w-2.5 h-2.5" />
                                <span>WA</span>
                              </button>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  </Td>
                  <Td>
                    {p.isScholarship || p.fee === 0 ? (
                      <span className="inline-flex items-center rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-500/30">
                        FREE ($0)
                      </span>
                    ) : (
                      <div className="leading-tight">
                        <span className="font-mono text-xs">{money(p.fee)}/mo</span>
                        {p.discountPercent || p.discountAmount ? (
                          <div className="font-mono text-[9px] text-amber-300">
                            {p.discountPercent ? `-${p.discountPercent}%` : ""}
                            {p.discountAmount ? ` -$${p.discountAmount}` : ""}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </Td>
                  <Td right>
                    <div className="flex flex-col items-end gap-1">
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {p.balance > 0 ? (
                          <span className="font-mono text-xs text-court-400">
                            {money(Math.max(0, p.balance))}
                          </span>
                        ) : null}
                        <Chip tone={statusTone[p.status] || "neutral"}>
                          {p.status === "Idle"
                            ? "IDLE (PENDING RENEWAL)"
                            : String(p.status || "Active").toUpperCase()}
                        </Chip>
                        <button
                          type="button"
                          title="View Member Digital Pass"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDigitalPassPlayer(p);
                          }}
                          className="p-1 rounded text-court-400 hover:text-court-300 hover:bg-court-500/10 transition-colors"
                        >
                          <QrCode className="w-4 h-4" />
                        </button>
                        <RowActions
                          onEdit={canWrite ? () => openEdit(p) : undefined}
                          onDelete={canDelete ? () => remove(p) : undefined}
                        />
                      </div>
                      {p.status === "Idle" && (
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          <span className="font-mono text-[10px] text-amber-300">
                            Idle since {p.idleSinceDate || "cycle renewal"} ·{" "}
                            {Number(p.missedSessionsSinceIdle) || 0} missed
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void movePlayerToCrmFollowUp(p.id, "idle_followup");
                            }}
                            className="rounded border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 font-mono text-[9px] font-semibold text-amber-300 hover:bg-amber-500/25 transition-colors"
                          >
                            Idle Follow-Up
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              void movePlayerToCrmFollowUp(p.id, "lost_churned");
                            }}
                            className="rounded border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 font-mono text-[9px] font-semibold text-rose-300 hover:bg-rose-500/25 transition-colors"
                          >
                            Lost Clients
                          </button>
                        </div>
                      )}
                      {p.crmFollowUpStatus && (
                        <span className="rounded bg-court-500/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-court-300 border border-court-500/30">
                          {p.crmFollowUpStatus}
                        </span>
                      )}
                    </div>
                  </Td>
                </>
              )}
            />
          </div>

          {/* Mobile Card-Based View (< 640px) */}
          <div className="hidden divide-y divide-ink-800">
            {pagedPlayers.length === 0 ? (
              <EmptyState>No players match these filters.</EmptyState>
            ) : (
              pagedPlayers.map((p) => (
                <div
                  key={p.id}
                  onClick={() => setSelected(p.id)}
                  className="p-3.5 space-y-2.5 transition hover:bg-ink-850/50 cursor-pointer"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-ink-100 truncate text-sm">
                          {p.name}
                        </span>
                        {(() => {
                          const ageCheck = checkPlayerAgeEligibility(
                            p.dob,
                            p.category,
                            db.ageCategoryRules,
                          );
                          if (ageCheck.isExceeding) {
                            return (
                              <span
                                className="rounded bg-bad/20 px-1 py-0.5 font-mono text-[9px] font-bold text-bad ring-1 ring-bad/30"
                                title={ageCheck.reason}
                              >
                                ⚠️ OVERAGE
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </div>
                      <div className="font-mono text-[10px] text-ink-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                        <span>
                          {p.gender} · {p.dob ? formatAgeDate(p.dob) : "—"} · {p.branch || "HQ"}
                        </span>
                        {p.nationality ? <span>· {p.nationality}</span> : null}
                        {p.bloodType ? (
                          <span className="text-rose-400 font-semibold">· {p.bloodType}</span>
                        ) : null}
                        {p.phone ? <span className="text-court-400">· 📱 {p.phone}</span> : null}
                        {p.medicalNotes ? (
                          <span
                            className="rounded bg-rose-500/15 px-1 py-0.5 text-[9px] font-bold text-rose-400 ring-1 ring-rose-500/30"
                            title={`Medical Alert: ${p.medicalNotes}`}
                          >
                            🩸 MED ALERT
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <CategoryBadge category={p.category} />
                      <Chip tone={statusTone[p.status] || "neutral"}>
                        {p.status === "Idle"
                          ? "IDLE (PENDING RENEWAL)"
                          : String(p.status || "Active").toUpperCase()}
                      </Chip>
                    </div>
                  </div>
                  {p.status === "Idle" && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5">
                      <span className="font-mono text-[10px] text-amber-300">
                        Idle since {p.idleSinceDate || "cycle renewal"} ·{" "}
                        {Number(p.missedSessionsSinceIdle) || 0} missed sessions
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void movePlayerToCrmFollowUp(p.id, "idle_followup");
                          }}
                          className="rounded border border-amber-500/40 bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-200 hover:bg-amber-500/30 transition-colors"
                        >
                          Idle Follow-Up
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void movePlayerToCrmFollowUp(p.id, "lost_churned");
                          }}
                          className="rounded border border-rose-500/40 bg-rose-500/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-rose-200 hover:bg-rose-500/30 transition-colors"
                        >
                          Lost Clients
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2 text-xs font-mono bg-ink-900/60 p-2 rounded border border-ink-850">
                    <div>
                      <span className="text-[10px] text-ink-400 block uppercase">Team</span>
                      <span className="text-ink-200 truncate block">
                        {p.teams?.join(", ") || "—"}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-ink-400 block uppercase">
                        Fee / Balance
                      </span>
                      <span className="text-ink-200 block">
                        {money(p.fee)}/mo{" "}
                        {p.balance > 0 ? (
                          <span className="text-court-400 font-semibold">
                            ({money(Math.max(0, p.balance))})
                          </span>
                        ) : null}
                      </span>
                    </div>
                    {p.parent && (
                      <div className="col-span-2 space-y-1">
                        <div>
                          <span className="text-[10px] text-ink-400 block uppercase font-mono">
                            Guardian 1
                          </span>
                          <span className="text-ink-200 truncate block">
                            {p.parent} {p.parentPhone ? `· ${p.parentPhone}` : ""}
                          </span>
                        </div>
                        {(p.guardian2Name || p.guardian2Phone) && (
                          <div className="pt-1 border-t border-ink-800/60">
                            <span className="text-[10px] text-ink-400 block uppercase font-mono">
                              Guardian 2
                            </span>
                            <span className="text-ink-300 truncate block">
                              {p.guardian2Name || "—"}{" "}
                              {p.guardian2Phone ? `· ${p.guardian2Phone}` : ""}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDigitalPassPlayer(p);
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-mono text-court-400 hover:text-court-300 py-1 px-2 rounded bg-court-500/10 border border-court-500/20"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      <span>Digital Pass</span>
                    </button>
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <RowActions
                        onEdit={canWrite ? () => openEdit(p) : undefined}
                        onDelete={canDelete ? () => remove(p) : undefined}
                      />
                    </div>
                  </div>
                </div>
              ))
            )}
            <div className="p-3 border-t border-ink-800">
              <Pagination
                page={page}
                pageSize={pageSize}
                total={filtered.length}
                setPage={setPage}
              />
            </div>
          </div>
        </Panel>

        <div className="space-y-4">
          {detail ? (
            <Panel
              title={
                <div className="flex items-center gap-2 flex-wrap">
                  <span>{detail.name}</span>
                  {detail.isScholarship ? (
                    <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-500/40">
                      🎓 SCHOLARSHIP / FREE
                    </span>
                  ) : null}
                  {detail.specialOffer ? (
                    <span className="rounded bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-300 ring-1 ring-amber-500/40">
                      ★ {detail.specialOffer}
                    </span>
                  ) : null}
                  {detail.medicalStatus && detail.medicalStatus !== "Fit" ? (
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-bold ring-1 ${
                        detail.medicalStatus === "Injured"
                          ? "bg-red-500/20 text-red-300 ring-red-500/40"
                          : "bg-amber-500/20 text-amber-300 ring-amber-500/40"
                      }`}
                    >
                      {detail.medicalStatus === "Injured"
                        ? "🏥 INJURED / OUT"
                        : "⚕️ LIMITED TRAINING"}
                      {detail.rtpStage ? ` · RTP ${detail.rtpStage}/5` : ""}
                    </span>
                  ) : null}
                  {detail.medicalNotes ? (
                    <span className="rounded bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-300 ring-1 ring-rose-500/40">
                      🩸 MEDICAL ALERT
                    </span>
                  ) : null}
                </div>
              }
              meta="Profile & financials"
            >
              <div className="px-4 pt-4 pb-1 flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-court-500/15 font-mono text-sm font-bold text-court-400 ring-1 ring-court-400/30 shrink-0">
                  {detail.name
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()}
                </div>
                <div>
                  <div className="text-sm font-semibold text-ink-100">{detail.name}</div>
                  <div className="font-mono text-xs text-court-400">
                    {detail.category} · {detail.gender}
                  </div>
                </div>
              </div>
              <div className="space-y-2 p-4 text-sm">
                {detail.status === "Idle" && (
                  <div
                    className={`rounded-lg border p-3 space-y-2 ${
                      (Number(detail.missedSessionsSinceIdle) || 0) >= 3
                        ? "border-bad/50 bg-bad/15"
                        : "border-amber-500/40 bg-amber-500/10"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-amber-300">
                        Idle (Pending Renewal)
                      </span>
                      <span className="font-mono text-[10px] text-ink-300">
                        Since {detail.idleSinceDate || "cycle end"} ·{" "}
                        {Number(detail.missedSessionsSinceIdle) || 0} missed sessions
                      </span>
                    </div>
                    {(Number(detail.missedSessionsSinceIdle) || 0) >= 3 ? (
                      <p className="text-xs font-medium text-ink-100">
                        {detail.name} has missed {Number(detail.missedSessionsSinceIdle) || 0}{" "}
                        sessions while Idle since{" "}
                        {detail.idleSinceDate || new Date().toISOString().slice(0, 10)} without
                        payment or attendance.
                      </p>
                    ) : (
                      <p className="text-xs text-ink-300">
                        Awaiting payment or first Present team attendance for the new month to
                        transition to Active.
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => void movePlayerToCrmFollowUp(detail.id, "idle_followup")}
                        className="rounded-md border border-amber-500/40 bg-amber-500/20 px-2.5 py-1 font-mono text-[10px] font-semibold text-amber-200 hover:bg-amber-500/30 transition-colors"
                      >
                        Move to Idle / At-Risk Follow-Up
                      </button>
                      <button
                        type="button"
                        onClick={() => void movePlayerToCrmFollowUp(detail.id, "lost_churned")}
                        className="rounded-md border border-rose-500/40 bg-rose-500/20 px-2.5 py-1 font-mono text-[10px] font-semibold text-rose-200 hover:bg-rose-500/30 transition-colors"
                      >
                        Move to Lost Clients
                      </button>
                      {detail.crmFollowUpStatus && (
                        <span className="rounded bg-court-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-court-300 border border-court-500/30">
                          {detail.crmFollowUpStatus}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {detail.status === "Active" && canWrite && (
                  <div className="flex items-center justify-between gap-2 rounded-lg border border-ink-800 bg-ink-900/50 px-3 py-2">
                    <span className="font-mono text-[10px] text-ink-400">
                      Subscription status: Active
                    </span>
                    <button
                      type="button"
                      onClick={() => void setPlayerIdleForRenewal(detail.id)}
                      className="rounded border border-ink-700 bg-ink-850 px-2 py-0.5 font-mono text-[10px] text-ink-200 hover:border-amber-500/40 hover:text-amber-300 transition-colors"
                    >
                      Set Idle (Pending Renewal)
                    </button>
                  </div>
                )}
                <LineRow
                  label="Category & Age"
                  value={
                    <span className="inline-flex items-center gap-1.5 flex-wrap justify-end">
                      <span>{`${detail.category} · ${detail.teams?.join(", ") || "Unassigned"}`}</span>
                      {detail.dob && calculatePlayerAgeFromDob(detail.dob) && (
                        <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] text-court-300 ring-1 ring-ink-700">
                          {calculatePlayerAgeFromDob(detail.dob)?.formattedSummary}
                        </span>
                      )}
                    </span>
                  }
                />
                <LineRow label="Branch" value={detail.branch || "—"} />

                {/* Available Teams for Player (Two-Way Smart Assignment Workflow) */}
                {(() => {
                  const candidateTeams = (rawTeams || []).filter(
                    (t) =>
                      !isBranchRestricted ||
                      !userBranch ||
                      t.branch?.toLowerCase() === userBranch.toLowerCase(),
                  );
                  const evaluatedTeams = candidateTeams
                    .map((teamObj) => ({
                      team: teamObj,
                      eligibility: evaluateTeamEligibilityForDob(
                        detail.dob,
                        teamObj,
                        db.ageCategoryRules,
                      ),
                      isAssigned: Boolean(detail.teams && detail.teams.includes(teamObj.name)),
                    }))
                    .filter((item) => item.eligibility.eligible || item.isAssigned)
                    .sort((a, b) => {
                      if (a.isAssigned !== b.isAssigned) return a.isAssigned ? -1 : 1;
                      const rank = { exact: 0, younger: 1, older: 2, ineligible: 3 };
                      return rank[a.eligibility.matchType] - rank[b.eligibility.matchType];
                    });

                  const handleAssignOrTransfer = (
                    targetTeam: (typeof rawTeams)[number],
                    mode: "add" | "transfer" | "remove",
                    badgeLabel?: string,
                  ) => {
                    const currentTeams = detail.teams || [];
                    let nextTeams: string[];
                    const nextTeamFees: Record<string, number> = { ...(detail.teamFees || {}) };
                    const defaultTeamFee = targetTeam.monthlyFee || detail.fee || 85;

                    if (mode === "remove") {
                      nextTeams = currentTeams.filter((tn) => tn !== targetTeam.name);
                      delete nextTeamFees[targetTeam.name];
                    } else if (mode === "transfer") {
                      nextTeams = [targetTeam.name];
                      Object.keys(nextTeamFees).forEach((k) => {
                        if (k !== targetTeam.name) delete nextTeamFees[k];
                      });
                      if (nextTeamFees[targetTeam.name] === undefined) {
                        nextTeamFees[targetTeam.name] = detail.isScholarship ? 0 : defaultTeamFee;
                      }
                    } else {
                      nextTeams = currentTeams.includes(targetTeam.name)
                        ? currentTeams
                        : [...currentTeams, targetTeam.name];
                      if (nextTeamFees[targetTeam.name] === undefined) {
                        nextTeamFees[targetTeam.name] = detail.isScholarship ? 0 : defaultTeamFee;
                      }
                    }

                    const updatedFee = detail.isScholarship
                      ? 0
                      : calculatePlayerMonthlyFee(
                          {
                            ...detail,
                            teams: nextTeams,
                            teamFees: nextTeamFees,
                          },
                          rawTeams,
                          rawBranches,
                        );

                    update((d) => ({
                      ...d,
                      players: d.players.map((x) =>
                        x.id === detail.id
                          ? {
                              ...x,
                              teams: nextTeams,
                              teamFees: nextTeamFees,
                              fee: updatedFee,
                            }
                          : x,
                      ),
                    }));

                    if (mode === "remove") {
                      toast.success(`Removed ${detail.name} from ${targetTeam.name}.`);
                    } else if (mode === "transfer") {
                      toast.success(
                        `Transferred ${detail.name} to ${targetTeam.name}${badgeLabel ? ` (${badgeLabel})` : ""}.`,
                      );
                    } else {
                      toast.success(
                        `Added ${detail.name} to ${targetTeam.name}${badgeLabel ? ` (${badgeLabel})` : ""}.`,
                      );
                    }
                  };

                  return (
                    <div className="my-2 rounded-lg border border-ink-800 bg-ink-900/60 p-3 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-court-300">
                            Available Teams for Player ({evaluatedTeams.length})
                          </div>
                          <div className="font-mono text-[10px] text-ink-400">
                            {detail.dob
                              ? `Matched by DOB (${formatAgeDate(detail.dob)}) & Team Exception Rules`
                              : "Enter player DOB to compute eligible teams"}
                          </div>
                        </div>
                      </div>

                      {evaluatedTeams.length === 0 ? (
                        <div className="rounded bg-ink-950/60 p-2.5 text-center font-mono text-[11px] text-ink-400">
                          {detail.dob
                            ? "No teams match this player's DOB or Playing Up / Over-Age exception rules."
                            : "Set a Date of Birth on this player profile to see eligible teams."}
                        </div>
                      ) : (
                        <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                          {evaluatedTeams.map(({ team: tObj, eligibility, isAssigned }) => (
                            <div
                              key={tObj.id}
                              className={`flex items-center justify-between gap-2 rounded-md px-2.5 py-2 ring-1 ${
                                isAssigned
                                  ? "bg-court-500/10 ring-court-500/40"
                                  : "bg-ink-850 ring-ink-700"
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-xs font-semibold text-ink-100">
                                    {tObj.name}
                                  </span>
                                  <CategoryBadge category={tObj.category} />
                                  {eligibility.matchType === "exact" && (
                                    <span className="rounded bg-good/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-good ring-1 ring-good/30">
                                      Exact Match
                                    </span>
                                  )}
                                  {eligibility.matchType === "younger" && (
                                    <span className="rounded bg-court-500/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-court-300 ring-1 ring-court-500/40">
                                      Playing Up - Younger
                                    </span>
                                  )}
                                  {eligibility.matchType === "older" && (
                                    <span className="rounded bg-warn/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-warn ring-1 ring-warn/40">
                                      Over-Age Exception
                                    </span>
                                  )}
                                </div>
                                <div className="font-mono text-[10px] text-ink-400 mt-0.5">
                                  {tObj.branch || "All Branches"}
                                  {tObj.headCoach ? ` · Coach ${tObj.headCoach}` : ""}
                                </div>
                              </div>
                              {canWrite && (
                                <div className="flex items-center gap-1 shrink-0">
                                  {isAssigned ? (
                                    <button
                                      type="button"
                                      onClick={() => handleAssignOrTransfer(tObj, "remove")}
                                      className="rounded bg-bad/15 px-2 py-1 font-mono text-[10px] font-semibold text-bad ring-1 ring-bad/30 hover:bg-bad/25 transition-colors"
                                    >
                                      Remove
                                    </button>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleAssignOrTransfer(
                                            tObj,
                                            "add",
                                            eligibility.badgeLabel,
                                          )
                                        }
                                        className="rounded bg-court-500 px-2 py-1 font-mono text-[10px] font-bold text-ink-950 hover:bg-court-400 transition-colors"
                                      >
                                        + Add
                                      </button>
                                      {(detail.teams?.length || 0) > 0 && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleAssignOrTransfer(
                                              tObj,
                                              "transfer",
                                              eligibility.badgeLabel,
                                            )
                                          }
                                          className="rounded bg-ink-800 px-2 py-1 font-mono text-[10px] font-semibold text-ink-200 ring-1 ring-ink-700 hover:ring-court-500/50 transition-colors"
                                          title="Replace current team assignment with this team"
                                        >
                                          ⇄ Transfer
                                        </button>
                                      )}
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
                {detail.phone ? (
                  <LineRow
                    label="Player Phone"
                    value={
                      <span className="inline-flex items-center gap-1.5">
                        <span>{detail.phone}</span>
                        <button
                          type="button"
                          title={`WhatsApp ${detail.name} (${detail.phone})`}
                          onClick={() =>
                            openDirectWhatsApp(
                              detail.phone!,
                              `Hello ${detail.name}, reaching out from ${db.academy?.name || "Vescio Vector Academy"}.`,
                            )
                          }
                          className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-400 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 transition-colors"
                        >
                          <MessageSquare className="w-3 h-3" />
                          <span>WhatsApp</span>
                        </button>
                      </span>
                    }
                  />
                ) : null}
                {detail.nationality ? (
                  <LineRow label="Nationality" value={detail.nationality} />
                ) : null}
                {detail.bloodType ? <LineRow label="Blood Type" value={detail.bloodType} /> : null}
                <LineRow
                  label="Guardian 1 (Primary)"
                  value={
                    <span className="inline-flex items-center gap-1.5 flex-wrap justify-end">
                      <span>{`${detail.parent} · ${detail.parentPhone}`}</span>
                      {detail.parentPhone ? (
                        <button
                          type="button"
                          title={`WhatsApp ${detail.parent || "Guardian 1"} (${detail.parentPhone})`}
                          onClick={() =>
                            openDirectWhatsApp(
                              detail.parentPhone,
                              `Hello ${detail.parent || "Guardian"}, reaching out from ${db.academy?.name || "Vescio Vector Academy"} regarding ${detail.name}.`,
                            )
                          }
                          className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-400 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 transition-colors"
                        >
                          <MessageSquare className="w-3 h-3" />
                          <span>WhatsApp</span>
                        </button>
                      ) : null}
                    </span>
                  }
                />
                {(detail.guardian2Name || detail.guardian2Phone) && (
                  <LineRow
                    label="Guardian 2 (Emergency)"
                    value={
                      <span className="inline-flex items-center gap-1.5 flex-wrap justify-end">
                        <span>{`${detail.guardian2Name || "—"}${detail.guardian2Phone ? ` · ${detail.guardian2Phone}` : ""}`}</span>
                        {detail.guardian2Phone ? (
                          <button
                            type="button"
                            title={`WhatsApp ${detail.guardian2Name || "Guardian 2"} (${detail.guardian2Phone})`}
                            onClick={() =>
                              openDirectWhatsApp(
                                detail.guardian2Phone!,
                                `Hello ${detail.guardian2Name || "Guardian"}, reaching out from ${db.academy?.name || "Vescio Vector Academy"} regarding ${detail.name}.`,
                              )
                            }
                            className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-emerald-400 ring-1 ring-emerald-500/30 hover:bg-emerald-500/25 transition-colors"
                          >
                            <MessageSquare className="w-3 h-3" />
                            <span>WhatsApp</span>
                          </button>
                        ) : null}
                      </span>
                    }
                  />
                )}
                <LineRow label="School" value={detail.school || "—"} />
                <LineRow
                  label="Insurance"
                  value={
                    detail.isInsured || detail.insuranceStatus === "Academy insured" ? (
                      <div className="flex flex-col items-end gap-1">
                        <span className="inline-flex items-center gap-1.5 flex-wrap justify-end">
                          <span className="text-court-300 font-semibold">
                            🛡️ {detail.insuranceCompanyName || "Academy Insured"}
                          </span>
                          {detail.insuranceFee ? (
                            <span className="text-ink-300">({money(detail.insuranceFee)})</span>
                          ) : null}
                          {detail.insurancePaid ? (
                            <span className="rounded bg-good/20 px-1.5 py-0.5 text-[10px] font-bold text-good ring-1 ring-good/40">
                              PAID
                            </span>
                          ) : (
                            <span className="rounded bg-warn/20 px-1.5 py-0.5 text-[10px] font-bold text-warn ring-1 ring-warn/40">
                              UNPAID
                            </span>
                          )}
                        </span>
                        {!detail.insurancePaid &&
                          (detail.insuranceFee || 0) > 0 &&
                          canManageBilling && (
                            <button
                              type="button"
                              onClick={async () => {
                                const feeVal = Number(detail.insuranceFee || 0);
                                const compName = detail.insuranceCompanyName || "Academy Insurance";
                                const ledgerId = `l-ins-${detail.id}-${Date.now().toString(36)}`;
                                const insEntry: LedgerEntry = {
                                  id: ledgerId,
                                  date: new Date().toISOString().slice(0, 10),
                                  account: "Player Insurance",
                                  category: "Insurance",
                                  entry: `Player Insurance · ${detail.name} · ${compName}`,
                                  description: `Player Insurance · ${detail.name} · ${compName}`,
                                  type: "Revenue",
                                  status: "Collected",
                                  amount: feeVal,
                                  paymentMethod: "Cash",
                                  branch: detail.branch || "",
                                  playerId: detail.id,
                                  referenceId: detail.id,
                                  insuranceCompanyId: detail.insuranceCompanyId || "",
                                  insuranceCompanyName: compName,
                                  note: `Insurance policy (${compName}) collected for ${detail.name}`,
                                };
                                await setEntity("ledger", insEntry);
                                const nextBal = detail.insuranceBilledToBalance
                                  ? Math.max(0, (detail.balance || 0) - feeVal)
                                  : detail.balance || 0;
                                await patchEntity("players", detail.id, {
                                  insurancePaid: true,
                                  insuranceLedgerId: ledgerId,
                                  balance: nextBal,
                                });
                                toast.success(
                                  `Collected $${feeVal} insurance fee (${compName}) for ${detail.name}.`,
                                );
                              }}
                              className="rounded bg-emerald-500/20 hover:bg-emerald-500/30 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-500/40 transition-colors"
                            >
                              Collect Insurance Fee ({money(detail.insuranceFee || 0)})
                            </button>
                          )}
                      </div>
                    ) : (
                      detail.insuranceStatus || "Not insured"
                    )
                  }
                />
                {(() => {
                  const monthlyPresentCount = getPlayerMonthlyPresentCount(
                    detail.id,
                    db.sessions,
                    db.attendance,
                  );
                  const allowedLimit = Number(detail.allowedPracticesPerMonth || 0);
                  const isOverLimit =
                    allowedLimit > 0 && allowedLimit < 999 && monthlyPresentCount > allowedLimit;
                  return (
                    <div className="rounded-lg border border-ink-800 bg-ink-900/60 p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
                          Training Package &amp; Monthly Cap
                        </span>
                        {(canWrite || canManageBilling) && (
                          <button
                            type="button"
                            onClick={() => {
                              setUpgradeModalPlayer(detail);
                              const fallbackPkg =
                                trainingPackages.find((p) => p.id !== detail.packageId) ||
                                trainingPackages[0];
                              setUpgradeTargetPkgId(fallbackPkg?.id || "");
                              setUpgradeMode("mid_month");
                              setUpgradePaymentHandling("collect_now");
                            }}
                            className="rounded bg-court-500/15 hover:bg-court-500/25 px-2 py-0.5 font-mono text-[10px] font-bold text-court-300 ring-1 ring-court-500/30 transition-colors"
                          >
                            ⚡ Upgrade / Change Package
                          </button>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs font-mono">
                        <span className="text-ink-200 font-semibold">
                          {detail.packageName ||
                            (allowedLimit > 0
                              ? `${allowedLimit >= 999 ? "Unlimited" : allowedLimit} Practices/Mo`
                              : "Standard Program")}
                        </span>
                        {allowedLimit > 0 ? (
                          <span
                            className={`rounded px-2 py-0.5 text-[10px] font-bold ${
                              isOverLimit
                                ? "bg-bad/20 text-bad ring-1 ring-bad/40"
                                : "bg-court-500/15 text-court-300 ring-1 ring-court-500/30"
                            }`}
                          >
                            {isOverLimit
                              ? `⚠️ ${monthlyPresentCount}/${allowedLimit} Practices Used (Limit Exceeded)`
                              : `${monthlyPresentCount}/${allowedLimit >= 999 ? "∞" : allowedLimit} Practices Used`}
                          </span>
                        ) : (
                          <span className="text-ink-400 text-[11px]">
                            {monthlyPresentCount} Practices Attended (MTD)
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })()}
                {detail.medicalNotes ? (
                  <div className="mt-2 rounded-lg bg-rose-500/10 border border-rose-500/30 p-2.5 space-y-1">
                    <div className="flex items-center justify-between text-xs font-semibold text-rose-400 font-mono">
                      <span>🩸 MEDICAL ALERT & ALLERGIES</span>
                      {detail.bloodType ? (
                        <span className="bg-rose-500/20 px-1.5 py-0.5 rounded text-[10px]">
                          {detail.bloodType}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs text-ink-200 leading-relaxed font-sans">
                      {detail.medicalNotes}
                    </div>
                  </div>
                ) : null}
                <div className="pt-2 border-t border-ink-850 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-ink-400 text-xs font-mono uppercase">
                      Official Documents
                    </span>
                    {canWrite && (
                      <label className="cursor-pointer inline-flex items-center gap-1 rounded bg-court-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-court-400 ring-1 ring-court-500/30 hover:bg-court-500/20 transition-colors">
                        <Upload className="w-3 h-3" />
                        <span>{idUploading ? "Uploading..." : "+ Attach Doc"}</span>
                        <input
                          type="file"
                          accept="image/*,.pdf"
                          disabled={idUploading}
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file || !detail) return;
                            e.target.value = "";
                            if (file.size > 15 * 1024 * 1024) {
                              toast.error("Document file must be under 15MB");
                              return;
                            }
                            try {
                              setIdUploading(true);
                              const uploadedDoc = await uploadDocumentAttachment(
                                tenantId,
                                "players",
                                detail.id,
                                file,
                              );
                              const existingDocs: DocumentAttachment[] = Array.isArray(
                                detail.documents,
                              )
                                ? detail.documents.map((d) => ({
                                    id: String(d.id || `doc-${Date.now().toString(36)}`),
                                    name: String(d.name || "Official Document"),
                                    type: String(d.type || "application/octet-stream"),
                                    url: String(d.url || ""),
                                    uploadedAt: String(d.uploadedAt || new Date().toISOString()),
                                    size: Number(d.size || 0),
                                  }))
                                : detail.idCardUrl
                                  ? [
                                      {
                                        id: `doc-legacy-${detail.id}`,
                                        name: String(detail.idCardName || "Official ID Document"),
                                        type: "image/jpeg",
                                        url: String(detail.idCardUrl),
                                        uploadedAt: new Date().toISOString(),
                                        size: 0,
                                      },
                                    ]
                                  : [];
                              const nextDocs = [...existingDocs, uploadedDoc];
                              await patchEntity("players", detail.id, {
                                documents: nextDocs,
                                idCardUrl: nextDocs[0]?.url || uploadedDoc.url,
                              });
                              toast.success(
                                `Document "${uploadedDoc.name}" attached to ${detail.name}.`,
                              );
                            } catch (err) {
                              console.error("Document upload failed:", err);
                              toast.error("Failed to attach document.");
                            } finally {
                              setIdUploading(false);
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
                        : detail.idCardUrl
                          ? [
                              {
                                id: `doc-legacy-${detail.id}`,
                                name: detail.idCardName || "Official ID Document",
                                type: "image/jpeg",
                                url: detail.idCardUrl,
                                uploadedAt: "",
                                size: 0,
                              },
                            ]
                          : [];
                    if (docsList.length === 0) {
                      return (
                        <div className="font-mono text-xs text-ink-500">
                          No documents attached yet
                        </div>
                      );
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
                            {canWrite && (
                              <button
                                type="button"
                                onClick={async () => {
                                  const remaining = docsList.filter((d) => d.id !== docItem.id);
                                  await patchEntity("players", detail.id, {
                                    documents: remaining,
                                    idCardUrl: remaining[0]?.url || "",
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
                {detail.feeNote && <LineRow label="Fee Note" value={detail.feeNote} />}
                <LineRow
                  label="Monthly fee"
                  value={
                    detail.isScholarship || detail.fee === 0 ? (
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/20 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-300 ring-1 ring-emerald-500/40">
                        Scholarship / Free ($0)
                      </span>
                    ) : (
                      <span>
                        {money(detail.fee)}
                        {detail.discountPercent || detail.discountAmount ? (
                          <span className="ml-1.5 text-[10px] text-amber-300">
                            ({detail.discountPercent ? `-${detail.discountPercent}%` : ""}
                            {detail.discountAmount ? ` -$${detail.discountAmount}` : ""})
                          </span>
                        ) : null}
                      </span>
                    )
                  }
                />
                {detail.specialOffer && (
                  <LineRow
                    label="Special Offer"
                    value={
                      <span className="text-amber-300 font-semibold">{detail.specialOffer}</span>
                    }
                  />
                )}
                {detail.teamFees && Object.keys(detail.teamFees).length > 1 && (
                  <div className="rounded bg-ink-900/60 p-2.5 border border-ink-800 text-xs">
                    <div className="font-mono text-[10px] text-ink-400 uppercase tracking-wider mb-1.5">
                      Fee Breakdown by Team
                    </div>
                    <div className="space-y-1">
                      {Object.entries(detail.teamFees).map(([teamName, teamAmount]) => (
                        <div key={teamName} className="flex justify-between font-mono text-[11px]">
                          <span className="text-ink-300">{teamName}</span>
                          <span className="font-semibold text-ink-100">{money(teamAmount)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <LineRow label="Outstanding" value={money(Math.max(0, detail.balance || 0))} />

                {/* Linked Sibling & Unified Family Package Card */}
                {detailFamilyGroup && (
                  <div className="pt-2 border-t border-ink-850">
                    <div className="rounded-lg border border-court-500/30 bg-court-500/5 p-3 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-wider text-court-300">
                          <Users className="w-3.5 h-3.5 text-court-400" />
                          <span>Family Package ({detailFamilyGroup.children.length} Siblings)</span>
                        </div>
                        <span className="font-mono text-[10px] text-ink-400">
                          {detailFamilyGroup.guardianName}
                        </span>
                      </div>

                      <div className="divide-y divide-ink-850/80 text-xs font-mono">
                        {detailFamilyGroup.children.map((sib) => (
                          <div
                            key={sib.player.id}
                            className="py-1.5 flex items-center justify-between gap-2"
                          >
                            <button
                              type="button"
                              onClick={() => setSelected(sib.player.id)}
                              className={`text-left truncate hover:underline ${
                                sib.player.id === detail.id
                                  ? "font-bold text-court-300"
                                  : "text-ink-200"
                              }`}
                            >
                              #{sib.siblingRank} {sib.player.name}
                            </button>
                            <div className="shrink-0 text-right text-[10px]">
                              <span className="text-ink-300">{money(sib.netFee)}/mo</span>
                              {sib.discountPercent > 0 && (
                                <span className="ml-1 text-emerald-400">
                                  (-{sib.discountPercent}%)
                                </span>
                              )}
                              {sib.currentBalance > 0 && (
                                <span className="ml-1.5 text-amber-400 font-bold">
                                  Due: {money(sib.currentBalance)}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="pt-1.5 border-t border-ink-800/80 flex items-center justify-between font-mono text-[11px]">
                        <span className="text-ink-400">Combined Family Balance:</span>
                        <span className="font-bold text-amber-400">
                          {money(detailFamilyGroup.combinedBalance)}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 pt-1">
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              const now = new Date();
                              const mName = now.toLocaleString("en-US", { month: "long" });
                              await exportFamilyStatementPdf(
                                detailFamilyGroup,
                                mName,
                                now.getFullYear(),
                                db.academy?.name || "Vescio Vector Academy",
                                db.academy?.currency || "USD",
                              );
                              toast.success(
                                `Exported Family PDF Statement for ${detailFamilyGroup.guardianName}.`,
                              );
                            } catch (err) {
                              console.error("Failed to export family PDF:", err);
                              toast.error("Failed to generate Family PDF Statement.");
                            }
                          }}
                          className="flex items-center justify-center gap-1 rounded bg-ink-900 hover:bg-ink-850 px-2 py-1.5 font-mono text-[10px] font-semibold text-court-300 ring-1 ring-ink-750 transition-colors"
                        >
                          <FileText className="w-3 h-3 text-court-400" />
                          <span>Family PDF Statement</span>
                        </button>

                        {canManageBilling && (
                          <button
                            type="button"
                            onClick={() => {
                              setFamilyPaymentGroup(detailFamilyGroup);
                              setFamilyPayAmount(
                                detailFamilyGroup.combinedBalance > 0
                                  ? detailFamilyGroup.combinedBalance
                                  : detailFamilyGroup.totalNet,
                              );
                              setFamilyPayMethod("Cash");
                              setFamilyPayNote("");
                            }}
                            className="flex items-center justify-center gap-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 px-2 py-1.5 font-mono text-[10px] font-bold text-emerald-300 ring-1 ring-emerald-500/40 transition-colors"
                          >
                            <Wallet className="w-3 h-3 text-emerald-400" />
                            <span>Pay Family Balance</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Player Invoices & Billing History */}
                {(() => {
                  const playerInvoices = (db.invoices || [])
                    .filter((inv) => inv.playerId === detail.id)
                    .sort((a, b) => (b.dueDate || "").localeCompare(a.dueDate || ""));

                  if (playerInvoices.length === 0) return null;

                  return (
                    <div className="pt-2 border-t border-ink-850 space-y-1.5">
                      <div className="font-mono text-[10px] text-ink-400 uppercase tracking-wider">
                        Invoices &amp; Billing History ({playerInvoices.length})
                      </div>
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                        {playerInvoices.map((inv) => {
                          const statusLower = (inv.status || "pending").toLowerCase();
                          const isPaid = statusLower === "paid";
                          const isOverdue = statusLower === "overdue";
                          return (
                            <div
                              key={inv.id}
                              className="rounded bg-ink-900/70 p-2 border border-ink-800 text-xs space-y-1"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono text-[11px] font-semibold text-ink-100 truncate">
                                  {inv.month ? `${inv.month} ${inv.year || ""}` : inv.id}
                                </span>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <span className="font-mono text-[11px] font-bold text-court-300">
                                    {money(inv.amount)}
                                  </span>
                                  <span
                                    className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${
                                      isPaid
                                        ? "bg-good/15 text-good ring-1 ring-good/30"
                                        : isOverdue
                                          ? "bg-bad/15 text-bad ring-1 ring-bad/30"
                                          : "bg-warn/15 text-warn ring-1 ring-warn/30"
                                    }`}
                                  >
                                    {statusLower}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-ink-400">
                                <span className="truncate">
                                  #{inv.id.slice(-8)} · Due: {inv.dueDate || "—"}
                                </span>
                                {!isPaid && canManageBilling && (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      await payInvoice(inv.id, "Cash");
                                      toast.success(
                                        `Paid invoice ${inv.month || inv.id} (${money(inv.amount)}) for ${detail.name}.`,
                                      );
                                    }}
                                    className="rounded bg-good px-2 py-0.5 font-mono text-[10px] font-bold text-ink-950 hover:opacity-90 shrink-0"
                                  >
                                    Pay
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* Player Payment History with Quick Edit, Undo / Delete & View All Toggle */}
                {(() => {
                  const playerInvoiceIds = new Set(
                    (db.invoices || [])
                      .filter((inv) => inv.playerId === detail.id)
                      .map((inv) => inv.id),
                  );
                  const detailNameLower = detail.name.toLowerCase().trim();
                  const playerLedgerPayments = (db.ledger || [])
                    .filter((l) => {
                      const isRev = l.type === "Revenue" || (l.type as string) === "credit";
                      if (!isRev) return false;
                      if (l.playerId === detail.id) return true;
                      if (l.familyPlayerIds && l.familyPlayerIds.includes(detail.id)) return true;
                      if (l.referenceId && playerInvoiceIds.has(l.referenceId)) return true;
                      const text = `${l.entry || ""} ${l.description || ""}`.toLowerCase();
                      return Boolean(detailNameLower && text.includes(detailNameLower));
                    })
                    .sort((a, b) => b.date.localeCompare(a.date));

                  if (playerLedgerPayments.length === 0) return null;

                  const visiblePayments = showAllPlayerPayments
                    ? playerLedgerPayments
                    : playerLedgerPayments.slice(0, 8);

                  return (
                    <div className="pt-2 border-t border-ink-850 space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="font-mono text-[10px] text-ink-400 uppercase tracking-wider">
                          Recent Payments ({playerLedgerPayments.length})
                        </div>
                        {playerLedgerPayments.length > 8 && (
                          <button
                            type="button"
                            onClick={() => setShowAllPlayerPayments((v) => !v)}
                            className="font-mono text-[10px] text-court-400 hover:underline"
                          >
                            {showAllPlayerPayments
                              ? "Show Less"
                              : `View All (${playerLedgerPayments.length})`}
                          </button>
                        )}
                      </div>
                      <div className="space-y-1.5 max-h-56 overflow-y-auto pr-0.5">
                        {visiblePayments.map((pmt) => (
                          <div
                            key={pmt.id}
                            className="rounded bg-ink-900/70 p-2 border border-ink-800 text-xs space-y-1"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-[11px] font-semibold text-court-400">
                                {money(Math.abs(pmt.amount))}
                              </span>
                              <span className="font-mono text-[10px] text-ink-400">{pmt.date}</span>
                            </div>
                            {(pmt.note || pmt.entry) && (
                              <div className="font-mono text-[10px] text-ink-400 truncate">
                                {pmt.note || pmt.entry}
                              </div>
                            )}
                            {canManageBilling && (
                              <div className="flex items-center justify-end gap-1.5 pt-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingPaymentEntry(pmt);
                                    setEditPayAmount(Math.abs(pmt.amount));
                                    setEditPayDate(pmt.date);
                                    setEditPayNote(pmt.note || "");
                                  }}
                                  className="rounded bg-ink-850 px-2 py-0.5 font-mono text-[10px] text-ink-200 ring-1 ring-ink-700 hover:text-court-300"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await deleteLedgerTransaction(pmt.id);
                                    toast.success(
                                      `Undid ${money(Math.abs(pmt.amount))} payment and restored ${detail.name}'s balance.`,
                                    );
                                  }}
                                  className="rounded bg-bad/15 px-2 py-0.5 font-mono text-[10px] text-bad ring-1 ring-bad/30 hover:bg-bad/25"
                                >
                                  Undo / Delete
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {playerAttendanceStats && (
                  <div className="pt-2 border-t border-ink-850 space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-ink-400">Attendance Rate</span>
                      <span
                        className={`font-mono font-semibold ${
                          playerAttendanceStats.reliabilityRate >= 80
                            ? "text-good"
                            : playerAttendanceStats.reliabilityRate >= 60
                              ? "text-court-400"
                              : "text-warn"
                        }`}
                      >
                        {playerAttendanceStats.reliabilityRate}%
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-1 font-mono text-[9px] text-center pt-1">
                      <div className="bg-good/10 text-good rounded py-1 border border-good/20">
                        <span className="block font-bold text-xs">
                          {playerAttendanceStats.present}
                        </span>
                        <span>PRESENT</span>
                      </div>
                      <div className="bg-warn/10 text-warn rounded py-1 border border-warn/20">
                        <span className="block font-bold text-xs">
                          {playerAttendanceStats.excused}
                        </span>
                        <span>EXCUSED</span>
                      </div>
                      <div className="bg-bad/10 text-bad rounded py-1 border border-bad/20">
                        <span className="block font-bold text-xs">
                          {playerAttendanceStats.absent}
                        </span>
                        <span>ABSENT</span>
                      </div>
                    </div>

                    {/* Chronological Session Attendance History Log */}
                    {(() => {
                      const playerTeamsSet = new Set(
                        (detail.teams || []).map((t) => t.toLowerCase().trim()),
                      );
                      const sessionHistory = (db.sessions || [])
                        .filter((s) => {
                          const explicitMark = db.attendance?.[s.id]?.[detail.id];
                          if (explicitMark) return true;
                          const sTeams = [s.team, s.teamA, s.teamB]
                            .filter((t): t is string => Boolean(t && t.trim()))
                            .map((t) => t.toLowerCase().trim());
                          if (sTeams.length > 0) {
                            return sTeams.some((t) => playerTeamsSet.has(t));
                          }
                          return Boolean(detail.branch && s.branch === detail.branch);
                        })
                        .sort((a, b) =>
                          `${b.date || ""} ${b.time || ""}`.localeCompare(
                            `${a.date || ""} ${a.time || ""}`,
                          ),
                        );

                      return (
                        <div className="pt-2 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
                              Session Attendance Log ({sessionHistory.length})
                            </span>
                            <button
                              type="button"
                              onClick={() => setShowAttendanceLog((v) => !v)}
                              className="font-mono text-[10px] text-court-400 hover:underline"
                            >
                              {showAttendanceLog ? "Hide Log" : "Show Log"}
                            </button>
                          </div>
                          {showAttendanceLog && (
                            <div className="max-h-52 space-y-1.5 overflow-y-auto pr-0.5">
                              {sessionHistory.length === 0 ? (
                                <div className="rounded bg-ink-900/50 p-2 font-mono text-[10px] text-ink-500">
                                  No scheduled or recorded sessions yet.
                                </div>
                              ) : (
                                sessionHistory.map((sess) => {
                                  const rawStatus =
                                    db.attendance?.[sess.id]?.[detail.id] || "Absent";
                                  const meta = db.attendanceMeta?.[sess.id]?.[detail.id];
                                  const isQr = meta?.method === "qr" || meta?.method === "qr_scan";
                                  const methodLabel = meta
                                    ? isQr
                                      ? "QR Scan"
                                      : "Manual"
                                    : rawStatus === "Present"
                                      ? "Manual"
                                      : "—";
                                  const timeLabel = meta?.timestamp
                                    ? new Date(meta.timestamp).toLocaleTimeString([], {
                                        hour: "2-digit",
                                        minute: "2-digit",
                                      })
                                    : sess.time || "";
                                  const teamLabel =
                                    sess.team ||
                                    [sess.teamA, sess.teamB].filter(Boolean).join(" vs ") ||
                                    sess.branch ||
                                    "—";

                                  return (
                                    <div
                                      key={sess.id}
                                      className="rounded bg-ink-900/70 p-2 border border-ink-800 text-xs space-y-1"
                                    >
                                      <div className="flex items-center justify-between gap-2">
                                        <span className="font-semibold text-ink-100 truncate">
                                          {sess.title}
                                        </span>
                                        <span
                                          className={`rounded px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase shrink-0 ${
                                            rawStatus === "Present"
                                              ? "bg-good/15 text-good ring-1 ring-good/30"
                                              : rawStatus === "Excused"
                                                ? "bg-warn/15 text-warn ring-1 ring-warn/30"
                                                : "bg-bad/15 text-bad ring-1 ring-bad/30"
                                          }`}
                                        >
                                          {rawStatus}
                                        </span>
                                      </div>
                                      <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-ink-400">
                                        <span className="truncate">
                                          {sess.date} · {teamLabel}
                                        </span>
                                        <span className="shrink-0 text-ink-300">
                                          {methodLabel}
                                          {timeLabel ? ` (${timeLabel})` : ""}
                                        </span>
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Player Activity & Audit Trail */}
                {(() => {
                  const nameLower = detail.name.toLowerCase().trim();
                  const rawAudit = (db.auditLogs || []).filter((log) => {
                    if (log.targetId === detail.id) return true;
                    const hay =
                      `${log.targetName || ""} ${log.action || ""} ${log.title || ""} ${log.details || ""} ${log.message || ""}`.toLowerCase();
                    return (
                      hay.includes(detail.id.toLowerCase()) ||
                      (nameLower && hay.includes(nameLower))
                    );
                  });

                  const notifAudit = (db.notifications || [])
                    .filter((n) => {
                      const hay = `${n.title || ""} ${n.message || ""}`.toLowerCase();
                      return (
                        hay.includes(detail.id.toLowerCase()) ||
                        (nameLower && hay.includes(nameLower))
                      );
                    })
                    .map((n) => ({
                      id: `notif-${n.id}`,
                      timestamp: n.createdAt,
                      title: n.title,
                      details: n.message,
                      actor: "System",
                    }));

                  const combinedAudit = [
                    ...rawAudit.map((a) => ({
                      id: a.id,
                      timestamp: a.timestamp || a.createdAt || "",
                      title: a.action || a.title || "Audit Entry",
                      details: a.details || a.message || "",
                      actor: a.actor || "Admin",
                    })),
                    ...notifAudit,
                  ].sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));

                  return (
                    <div className="pt-2 border-t border-ink-850 space-y-1.5">
                      <div className="font-mono text-[10px] text-ink-400 uppercase tracking-wider">
                        Activity &amp; Audit Trail ({combinedAudit.length})
                      </div>
                      {combinedAudit.length === 0 ? (
                        <div className="rounded bg-ink-900/50 p-2 font-mono text-[10px] text-ink-500">
                          No audit events recorded for {detail.name}.
                        </div>
                      ) : (
                        <div className="max-h-40 space-y-1.5 overflow-y-auto pr-0.5">
                          {combinedAudit.slice(0, 15).map((item) => (
                            <div
                              key={item.id}
                              className="rounded bg-ink-900/70 p-2 border border-ink-800 text-[11px] space-y-0.5"
                            >
                              <div className="flex items-center justify-between gap-2 font-mono">
                                <span className="font-semibold text-court-300 truncate">
                                  {item.title}
                                </span>
                                <span className="text-[9px] text-ink-400 shrink-0">
                                  {(item.timestamp || "").slice(0, 10)}
                                </span>
                              </div>
                              {item.details && (
                                <div className="text-[10px] text-ink-300 line-clamp-2">
                                  {item.details}
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
                {(() => {
                  const nextSess = findPlayerNextSession(detail, db.sessions);
                  const origin =
                    typeof window !== "undefined" && window.location.origin
                      ? window.location.origin
                      : "https://vesciovector.app";
                  const profileUrl = `${origin}/players?playerId=${encodeURIComponent(detail.id)}`;
                  const qrAttendanceUrl = `${origin}/sessions?scanPlayerId=${encodeURIComponent(
                    detail.id,
                  )}${nextSess ? `&sessionId=${encodeURIComponent(nextSess.id)}` : ""}&profileUrl=${encodeURIComponent(
                    profileUrl,
                  )}`;

                  return (
                    <div className="pt-2 border-t border-ink-850 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
                          Attendance &amp; Profile QR Code
                        </span>
                        <button
                          type="button"
                          onClick={() => setDigitalPassPlayer(detail)}
                          className="font-mono text-[10px] text-court-400 hover:underline"
                        >
                          Full Pass ↗
                        </button>
                      </div>
                      <div className="flex items-center gap-3 rounded-lg bg-ink-900/80 p-2.5 border border-ink-800">
                        <button
                          type="button"
                          onClick={() => setDigitalPassPlayer(detail)}
                          className="rounded-md bg-white p-1.5 shrink-0 shadow-sm hover:ring-2 hover:ring-court-400 transition-all"
                          title="Click to enlarge Member Digital Pass"
                        >
                          <QRCodeSVG
                            value={qrAttendanceUrl}
                            size={64}
                            level="M"
                            includeMargin={false}
                            fgColor="#090d16"
                            bgColor="#ffffff"
                          />
                        </button>
                        <div className="min-w-0 flex-1 space-y-1 font-mono text-[10px]">
                          <div className="text-ink-200 font-semibold truncate">
                            {nextSess ? `Next: ${nextSess.title}` : "Next Session Check-In"}
                          </div>
                          <div className="text-ink-400 truncate">
                            {nextSess
                              ? `${nextSess.date} · ${nextSess.time}`
                              : "Auto-routes to next scheduled session"}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 pt-0.5">
                            <Link
                              to="/sessions"
                              search={
                                {
                                  scanPlayerId: detail.id,
                                  ...(nextSess ? { sessionId: nextSess.id } : {}),
                                  profileUrl,
                                } as never
                              }
                              className="text-court-400 hover:underline font-semibold"
                            >
                              Attendance →
                            </Link>
                            <span className="text-ink-600">·</span>
                            <Link
                              to="/players"
                              search={{ playerId: detail.id } as never}
                              className="text-emerald-400 hover:underline font-semibold"
                            >
                              Profile Link →
                            </Link>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
              <div className="p-4 pt-1 space-y-2 border-t border-ink-800">
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="primary"
                    className="w-full flex items-center justify-center gap-1.5 bg-court-500 hover:bg-court-400 text-ink-950 font-bold text-xs"
                    onClick={() => setDigitalPassPlayer(detail)}
                  >
                    <QrCode className="w-4 h-4 shrink-0" />
                    <span>Digital Pass</span>
                  </Button>
                  <Link
                    to="/sessions"
                    search={
                      {
                        scanPlayerId: detail.id,
                        ...(findPlayerNextSession(detail, db.sessions)
                          ? { sessionId: findPlayerNextSession(detail, db.sessions)!.id }
                          : {}),
                      } as never
                    }
                    className="w-full flex items-center justify-center gap-1.5 rounded-md bg-ink-850 hover:bg-ink-800 px-3 py-2 font-mono text-xs font-semibold text-court-300 ring-1 ring-court-500/40 transition-colors"
                  >
                    <Calendar className="w-3.5 h-3.5 shrink-0" />
                    <span>Next Attendance</span>
                  </Link>
                </div>
                <div className="flex flex-wrap gap-2 pt-1">
                  {canManageBilling && (
                    <Button
                      className="flex-1"
                      onClick={() => {
                        setPaymentAmount(detail.balance || detail.fee);
                        setPaymentNote("");
                        setPaymentOpen(true);
                      }}
                    >
                      Record payment
                    </Button>
                  )}
                  {canWrite && (
                    <Button
                      variant="ghost"
                      className={canManageBilling ? "flex-1" : "w-full"}
                      onClick={() => openEdit(detail)}
                    >
                      Edit profile
                    </Button>
                  )}
                </div>
              </div>
            </Panel>
          ) : null}
        </div>
      </div>

      <Modal
        open={open}
        title={editing ? `Edit ${editing.name}` : "New player"}
        meta="Profile, guardian and monthly fee"
        onClose={() => setOpen(false)}
        onSubmit={(e) => {
          if (e && typeof e.preventDefault === "function") {
            e.preventDefault();
          }
          void handleSubmit(submit)(e);
        }}
        submitLabel={editing ? "Save changes" : "Create player"}
        wide
      >
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <Controller
            control={control}
            name="name"
            render={({ field }) => (
              <Field label="Full name" error={errors.name?.message}>
                <Input value={field.value} onChange={field.onChange} />
              </Field>
            )}
          />
          <Controller
            control={control}
            name="gender"
            render={({ field }) => (
              <Field label="Gender" error={errors.gender?.message}>
                <Select value={field.value} onChange={field.onChange} options={["Boy", "Girl"]} />
              </Field>
            )}
          />
          <Controller
            control={control}
            name="dob"
            render={({ field }) => (
              <Field
                label="Date of birth"
                error={errors.dob?.message}
                hint={
                  watchedAgeInfo
                    ? `${watchedAgeInfo.formattedSummary} · Auto Category: ${autoResolvedCategory}`
                    : "Enter DOB to calculate exact age & birth year"
                }
              >
                <Input
                  type="date"
                  value={field.value}
                  onChange={(v) => {
                    field.onChange(v);
                    if (v) {
                      const nextCat = resolveCategoryFromDob(
                        v,
                        db.ageCategoryRules,
                        db.lists?.["Age categories"] ?? [
                          "U-10",
                          "U-12",
                          "U-14",
                          "U-16",
                          "U-18",
                          "Senior",
                        ],
                      );
                      if (isDobMatrixMode || !getValues("category")) {
                        setValue("category", nextCat);
                      }
                    }
                  }}
                />
              </Field>
            )}
          />
          {isDobMatrixMode ? (
            <div className="rounded-md bg-court-500/10 p-3 ring-1 ring-court-500/30 flex flex-col justify-between">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-mono text-[10px] font-bold uppercase text-court-300">
                  Mode B · DOB / Age-Matrix Driven
                </span>
                {watchedDob && <CategoryBadge category={autoResolvedCategory} />}
              </div>
              <div className="mt-1 text-xs text-ink-100 font-medium">
                {watchedAgeInfo ? (
                  <span>
                    Calculated: <strong>{watchedAgeInfo.exactAge} yrs old</strong> (Birth Year{" "}
                    <strong>{watchedAgeInfo.birthYear}</strong>) →{" "}
                    <strong>{autoResolvedCategory}</strong>
                  </span>
                ) : (
                  <span className="text-ink-400">
                    Select Date of Birth to auto-calculate exact age, birth year &amp; category.
                  </span>
                )}
              </div>
              <div className="mt-1 font-mono text-[10px] text-ink-400">
                Category &amp; Team fields are hidden. Assign teams after registration via Player
                Profile or Team Roster smart matching.
              </div>
            </div>
          ) : (
            <Controller
              control={control}
              name="category"
              render={({ field }) => (
                <Field label="Category" error={errors.category?.message}>
                  <Select
                    value={field.value || ""}
                    onChange={field.onChange}
                    options={
                      db.lists["Age categories"] ?? [
                        "U-10",
                        "U-12",
                        "U-14",
                        "U-16",
                        "U-18",
                        "Senior",
                      ]
                    }
                  />
                </Field>
              )}
            />
          )}
          {!isDobMatrixMode && formAgeCheck.isExceeding && (
            <div className="sm:col-span-2 rounded-md bg-bad/15 p-2.5 ring-1 ring-bad/40 text-xs text-bad flex items-start gap-2">
              <span className="text-base leading-none">⚠️</span>
              <div>
                <div className="font-bold">Exceeds Age Limit for {watchedCategory}</div>
                <div className="font-mono text-[11px] mt-0.5 text-bad/90">
                  Player birth date ({formatAgeDate(watchedDob)}) is older than the allowed birth
                  window ({formAgeCheck.formattedRange}). A persistent overage warning sign will
                  remain next to his name on the team.
                </div>
              </div>
            </div>
          )}
          {!isDobMatrixMode && (
            <Controller
              control={control}
              name="teams"
              render={({ field }) => (
                <Field label="Teams" error={errors.teams?.message}>
                  <div className="flex flex-col gap-1 max-h-32 overflow-y-auto rounded-md bg-ink-850 p-2 ring-1 ring-ink-700">
                    {teams.map((t) => (
                      <label key={t} className="flex items-center gap-2 text-sm text-ink-100">
                        <input
                          type="checkbox"
                          className="accent-court-500 rounded bg-ink-900 border-ink-700 text-court-500 focus:ring-court-500"
                          checked={(field.value || []).includes(t)}
                          onChange={(e) => {
                            const current = new Set(field.value || []);
                            const currentFees = { ...(getValues("teamFees") || {}) };
                            if (e.target.checked) {
                              current.add(t);
                              if (currentFees[t] === undefined) {
                                const teamObj = rawTeams.find((tm) => tm.name === t);
                                currentFees[t] = teamObj?.monthlyFee || 85;
                              }
                            } else {
                              current.delete(t);
                              delete currentFees[t];
                            }
                            const newTeams = Array.from(current);
                            field.onChange(newTeams);
                            setValue("teamFees", currentFees);
                            const sum = newTeams.reduce((acc, item) => {
                              const teamObj = rawTeams.find((tm) => tm.name === item);
                              return acc + (currentFees[item] ?? teamObj?.monthlyFee ?? 85);
                            }, 0);
                            setValue("fee", sum);
                          }}
                        />
                        {t}
                      </label>
                    ))}
                    {teams.length === 0 && (
                      <span className="text-xs text-ink-400">No teams available</span>
                    )}
                  </div>
                </Field>
              )}
            />
          )}
          <Controller
            control={control}
            name="branch"
            render={({ field }) => (
              <Field label="Branch" error={errors.branch?.message}>
                {isBranchRestricted ? (
                  <div className="rounded-md bg-ink-850 px-3 py-2 font-mono text-xs text-court-300 ring-1 ring-ink-700 flex items-center justify-between">
                    <span>{userBranch}</span>
                    <span className="text-[10px] text-ink-500 uppercase">Assigned Facility</span>
                  </div>
                ) : (
                  <Select
                    value={field.value}
                    onChange={field.onChange}
                    options={["", ...branches]}
                  />
                )}
              </Field>
            )}
          />
          <div className="col-span-1 sm:col-span-2 rounded-lg border border-ink-800 bg-ink-900/60 p-3 space-y-3">
            <div className="font-mono text-xs font-semibold text-court-400 uppercase tracking-wide">
              Guardian 1 (Primary Contact)
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Controller
                control={control}
                name="parent"
                render={({ field }) => (
                  <Field label="Guardian 1 name" error={errors.parent?.message}>
                    <Input
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="Full name of primary guardian"
                    />
                  </Field>
                )}
              />
              <Controller
                control={control}
                name="parentPhone"
                render={({ field }) => (
                  <Field label="Guardian 1 phone" error={errors.parentPhone?.message}>
                    <Input
                      value={field.value}
                      onChange={field.onChange}
                      placeholder="+961 3 000 000"
                    />
                  </Field>
                )}
              />
            </div>
          </div>

          <div className="col-span-1 sm:col-span-2 rounded-lg border border-ink-800 bg-ink-900/40 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-semibold text-ink-300 uppercase tracking-wide">
                Guardian 2 (Secondary Contact — Optional)
              </span>
              <Chip tone="neutral">OPTIONAL</Chip>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Controller
                control={control}
                name="guardian2Name"
                render={({ field }) => (
                  <Field label="Guardian 2 name (optional)" error={errors.guardian2Name?.message}>
                    <Input
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      placeholder="Secondary guardian (optional)"
                    />
                  </Field>
                )}
              />
              <Controller
                control={control}
                name="guardian2Phone"
                render={({ field }) => (
                  <Field label="Guardian 2 phone (optional)" error={errors.guardian2Phone?.message}>
                    <Input
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      placeholder="Phone number (optional)"
                    />
                  </Field>
                )}
              />
            </div>
          </div>
          <Controller
            control={control}
            name="school"
            render={({ field }) => (
              <Field label="School" error={errors.school?.message}>
                <Input value={field.value ?? ""} onChange={field.onChange} />
              </Field>
            )}
          />
          {/* Point 5: Multi-Company Player Insurance & Audited Ledger Section */}
          <div className="col-span-1 sm:col-span-2 rounded-lg border border-court-500/30 bg-court-500/5 p-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold text-ink-100 flex items-center gap-1.5">
                  <span>🛡️ Multi-Company Player Insurance</span>
                </div>
                <div className="text-[11px] text-ink-400">
                  Select an insurance provider, auto-fill the basic policy fee, and log collection
                  directly to the Accounting Ledger
                </div>
              </div>
              <label className="inline-flex items-center gap-2 cursor-pointer font-mono text-xs text-court-300 font-semibold">
                <input
                  type="checkbox"
                  checked={watchedIsInsured}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setValue("isInsured", checked);
                    setValue("insuranceStatus", checked ? "Academy insured" : "Not insured");
                    if (checked && !watchedInsuranceCompanyId && insuranceCompanies.length > 0) {
                      const firstComp = insuranceCompanies[0];
                      setValue("insuranceCompanyId", firstComp.id);
                      setValue("insuranceCompanyName", firstComp.name);
                      setValue("insuranceFee", firstComp.defaultFee);
                    }
                  }}
                  className="h-4 w-4 rounded border-ink-700 bg-ink-900 text-court-500 focus:ring-court-500"
                />
                <span>Insured by Academy</span>
              </label>
            </div>

            {!watchedIsInsured ? (
              <Controller
                control={control}
                name="insuranceStatus"
                render={({ field }) => (
                  <Field label="External / Non-Academy Insurance Status">
                    <Select
                      value={
                        field.value === "Academy insured"
                          ? "Not insured"
                          : field.value || "Not insured"
                      }
                      onChange={(val) => {
                        field.onChange(val as "Academy insured" | "Self insured" | "Not insured");
                        if (val === "Academy insured") {
                          setValue("isInsured", true);
                        }
                      }}
                      options={["Not insured", "Self insured"]}
                    />
                  </Field>
                )}
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-4 pt-2 border-t border-ink-800/80">
                <div className="sm:col-span-2">
                  <Field label="Insurance Company" hint="Auto-fills default basic fee">
                    <select
                      value={watchedInsuranceCompanyId}
                      onChange={(e) => {
                        const compId = e.target.value;
                        const comp = insuranceCompanies.find((c) => c.id === compId);
                        setValue("insuranceCompanyId", compId);
                        if (comp) {
                          setValue("insuranceCompanyName", comp.name);
                          setValue("insuranceFee", comp.defaultFee);
                        }
                      }}
                      className="w-full rounded-md border border-ink-750 bg-ink-900 px-3 py-2 text-xs text-ink-100 focus:border-court-500 focus:outline-none"
                    >
                      <option value="">— Select Insurance Provider —</option>
                      {insuranceCompanies.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} (Default Basic Fee: ${c.defaultFee})
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <Controller
                  control={control}
                  name="insuranceFee"
                  render={({ field }) => (
                    <Field label="Insurance Fee ($)" hint="Editable policy fee">
                      <Input
                        type="number"
                        value={String(field.value ?? 0)}
                        onChange={(v) => field.onChange(Math.max(0, Number(v) || 0))}
                      />
                    </Field>
                  )}
                />

                <Controller
                  control={control}
                  name="insuranceExpiryDate"
                  render={({ field }) => (
                    <Field label="Expiry Date (Optional)">
                      <Input type="date" value={field.value ?? ""} onChange={field.onChange} />
                    </Field>
                  )}
                />

                <div className="sm:col-span-4">
                  <Field
                    label="Billing / Payment Handling"
                    hint={
                      editing?.insurancePaid
                        ? "Insurance fee already collected and recorded in Accounting Ledger"
                        : "Choose whether to collect the insurance fee now or bill it to the player's balance"
                    }
                  >
                    <div className="grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        disabled={Boolean(editing?.insurancePaid)}
                        onClick={() => setInsurancePaymentHandling("collect_now")}
                        className={`rounded-md border px-3 py-2 text-left font-mono text-xs transition-colors ${
                          insurancePaymentHandling === "collect_now"
                            ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-300 font-bold"
                            : "border-ink-750 bg-ink-900 text-ink-300"
                        }`}
                      >
                        ✅ Collect Insurance Fee Now (${watchedInsuranceFee}) — Logs to Ledger
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(editing?.insurancePaid)}
                        onClick={() => setInsurancePaymentHandling("add_to_balance")}
                        className={`rounded-md border px-3 py-2 text-left font-mono text-xs transition-colors ${
                          insurancePaymentHandling === "add_to_balance"
                            ? "border-amber-500/60 bg-amber-500/15 text-amber-300 font-bold"
                            : "border-ink-750 bg-ink-900 text-ink-300"
                        }`}
                      >
                        ⏳ Unpaid — Add ${watchedInsuranceFee} to Player Balance
                      </button>
                    </div>
                  </Field>
                </div>
              </div>
            )}
          </div>

          <Controller
            control={control}
            name="phone"
            render={({ field }) => (
              <Field label="Player Phone (Personal Mobile)" error={errors.phone?.message}>
                <Input
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  placeholder="+961 70 000 000"
                />
              </Field>
            )}
          />

          <Controller
            control={control}
            name="nationality"
            render={({ field }) => (
              <Field label="Nationality" error={errors.nationality?.message}>
                <Input
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  placeholder="e.g. Lebanese, French, American, Canadian..."
                />
              </Field>
            )}
          />

          <div className="col-span-1 sm:col-span-2 rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs font-semibold text-rose-400 uppercase tracking-wide flex items-center gap-1.5">
                <span>🩸 Medical Information & Blood Type</span>
              </span>
              <Chip tone="warn">CRITICAL SAFETY</Chip>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Controller
                  control={control}
                  name="bloodType"
                  render={({ field }) => (
                    <Field label="Blood Type" error={errors.bloodType?.message}>
                      <Select
                        value={field.value || ""}
                        onChange={field.onChange}
                        options={["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "Unknown"]}
                      />
                    </Field>
                  )}
                />
              </div>
              <div className="sm:col-span-2">
                <Controller
                  control={control}
                  name="medicalNotes"
                  render={({ field }) => (
                    <Field
                      label="Important Medical Information & Allergies"
                      hint="Asthma, chronic illnesses, food/drug allergies, emergency protocols"
                      error={errors.medicalNotes?.message}
                    >
                      <Input
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        placeholder="e.g. Asthma inhaler required, peanut allergy, past knee surgery..."
                      />
                    </Field>
                  )}
                />
              </div>
            </div>
          </div>

          <div className="col-span-1 sm:col-span-2 rounded-lg border border-ink-800 bg-ink-900/60 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-ink-100">
                  Training Package, Scholarship &amp; Special Offer Concessions
                </div>
                <div className="text-[11px] text-ink-400">
                  Step 1: Select Training Package (Practices/Month) · Step 2: Apply Special Offer or
                  Scholarship
                </div>
              </div>
              <div className="text-right">
                <span className="font-mono text-xs text-ink-400">Net Monthly Tuition:</span>
                <span className="ml-2 font-mono text-sm font-bold text-court-400">
                  {watchedIsScholarship || watchedDiscountPercent >= 100
                    ? "FREE ($0)"
                    : `$${watchedFee}`}
                </span>
              </div>
            </div>

            {!canManageBilling && (
              <div className="rounded bg-ink-900/80 p-2.5 border border-ink-800 text-xs font-mono text-ink-400 flex items-center gap-2">
                <span>🔒</span>
                <span>
                  Fee &amp; balance adjustments are restricted to authorized billing roles (Super
                  Admin &amp; Accountant).
                </span>
              </div>
            )}

            {/* Point 6B: Step 1 — Select Training Package & Step 2 — Select Special Offer */}
            <div className="grid gap-3 sm:grid-cols-2 pt-1 border-t border-ink-800/80">
              <Field
                label="Step 1 — Select Training Package"
                hint="Sets monthly practice cap & base monthly price"
              >
                <select
                  disabled={!canManageBilling}
                  value={watchedPackageId}
                  onChange={(e) => {
                    if (!canManageBilling) return;
                    const pkgId = e.target.value;
                    const pkg = trainingPackages.find((p) => p.id === pkgId);
                    setValue("packageId", pkgId);
                    if (pkg) {
                      setValue("packageName", pkg.name);
                      setValue("allowedPracticesPerMonth", pkg.practicesPerMonth);
                      if (!watchedIsScholarship) {
                        const net = Math.max(
                          0,
                          Math.round(pkg.monthlyPrice * (1 - watchedDiscountPercent / 100)) -
                            watchedDiscountAmount,
                        );
                        setValue("fee", net);
                      }
                    } else {
                      setValue("packageName", "");
                      setValue("allowedPracticesPerMonth", 0);
                    }
                  }}
                  className="w-full rounded-md border border-ink-750 bg-ink-900 px-3 py-2 text-xs text-ink-100 focus:border-court-500 focus:outline-none disabled:opacity-50"
                >
                  <option value="">— Standard Team Fee (No Package Cap) —</option>
                  {trainingPackages.map((pkg) => (
                    <option key={pkg.id} value={pkg.id}>
                      {pkg.name} —{" "}
                      {pkg.practicesPerMonth >= 999
                        ? "Unlimited Practices/Mo"
                        : `${pkg.practicesPerMonth} Practices/Mo`}{" "}
                      (${pkg.monthlyPrice})
                    </option>
                  ))}
                </select>
              </Field>

              <Field
                label="Step 2 — Select Special Offer (Optional)"
                hint="Applies promotional or sibling discount on top of package/team fee"
              >
                <select
                  disabled={!canManageBilling || watchedIsScholarship}
                  value={watchedSpecialOfferId}
                  onChange={(e) => {
                    if (!canManageBilling) return;
                    const offId = e.target.value;
                    setValue("specialOfferId", offId);
                    const off = specialOffers.find((o) => o.id === offId);
                    const selectedPkg = trainingPackages.find((p) => p.id === watchedPackageId);
                    const basePrice = selectedPkg
                      ? selectedPkg.monthlyPrice
                      : calculatePlayerBaseFee(
                          {
                            fee: 85,
                            teams: watchedTeams,
                            teamFees: watchedTeamFees,
                            branch: getValues("branch"),
                          },
                          rawTeams,
                          rawBranches,
                        );
                    if (off) {
                      const pct = Number(off.discountPercent || 0);
                      const amt = Number(off.discountAmount || 0);
                      setValue("specialOffer", off.name);
                      setValue("discountPercent", pct);
                      setValue("discountAmount", amt);
                      const net = Math.max(0, Math.round(basePrice * (1 - pct / 100)) - amt);
                      setValue("fee", net);
                    } else {
                      setValue("specialOffer", "");
                      setValue("discountPercent", 0);
                      setValue("discountAmount", 0);
                      setValue("fee", basePrice);
                    }
                  }}
                  className="w-full rounded-md border border-ink-750 bg-ink-900 px-3 py-2 text-xs text-ink-100 focus:border-court-500 focus:outline-none disabled:opacity-50"
                >
                  <option value="">— No Special Offer —</option>
                  {specialOffers
                    .filter(
                      (o) =>
                        !o.applicablePackageIds ||
                        o.applicablePackageIds.length === 0 ||
                        !watchedPackageId ||
                        o.applicablePackageIds.includes(watchedPackageId),
                    )
                    .map((off) => (
                      <option key={off.id} value={off.id}>
                        {off.name} ({off.discountPercent ? `-${off.discountPercent}%` : ""}
                        {off.discountAmount ? ` -$${off.discountAmount}` : ""})
                      </option>
                    ))}
                </select>
              </Field>
            </div>

            {/* 100% Free / Full Scholarship Toggle */}
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                  <span>🎓 100% Free / Full Scholarship (Exempt from Monthly Billing)</span>
                </div>
                <div className="text-[11px] font-mono text-ink-300">
                  Sets tuition to $0, skips monthly invoice generation, and exempts athlete from
                  overdue suspension locks.
                </div>
              </div>
              <input
                type="checkbox"
                disabled={!canManageBilling}
                checked={watchedIsScholarship}
                onChange={(e) => {
                  if (!canManageBilling) return;
                  const checked = e.target.checked;
                  setValue("isScholarship", checked);
                  if (checked) {
                    setValue("fee", 0);
                    setValue("discountPercent", 100);
                    const zeroFees: Record<string, number> = {};
                    watchedTeams.forEach((t) => {
                      zeroFees[t] = 0;
                    });
                    setValue("teamFees", zeroFees);
                    if (!watchedSpecialOffer) {
                      setValue("specialOffer", "Full Scholarship");
                    }
                  } else {
                    setValue("discountPercent", 0);
                    if (watchedSpecialOffer === "Full Scholarship") {
                      setValue("specialOffer", "");
                    }
                    const selectedPkg = trainingPackages.find((p) => p.id === watchedPackageId);
                    const restoredFees: Record<string, number> = {};
                    let sum = 0;
                    watchedTeams.forEach((t) => {
                      const tm = rawTeams.find((x) => x.name === t);
                      const rate = tm?.monthlyFee || 85;
                      restoredFees[t] = rate;
                      sum += rate;
                    });
                    setValue("teamFees", restoredFees);
                    setValue(
                      "fee",
                      selectedPkg ? selectedPkg.monthlyPrice : watchedTeams.length > 0 ? sum : 85,
                    );
                  }
                }}
                className="h-4 w-4 rounded border-ink-700 bg-ink-900 text-emerald-500 focus:ring-emerald-500 disabled:opacity-50"
              />
            </div>

            {/* Special Offer & Discount Controls */}
            <div className="grid gap-3 sm:grid-cols-4 pt-1 border-t border-ink-800/80">
              <div className="sm:col-span-2">
                <Controller
                  control={control}
                  name="specialOffer"
                  render={({ field }) => (
                    <Field
                      label="Special Offer Label"
                      hint="e.g. Full Scholarship, Early Bird -20%, Sibling -10%"
                    >
                      <Input
                        disabled={!canManageBilling}
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        placeholder="Optional offer label..."
                      />
                    </Field>
                  )}
                />
                {canManageBilling && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {[
                      { label: "Full Scholarship", pct: 100, amt: 0, sch: true },
                      { label: "Early Bird -20%", pct: 20, amt: 0, sch: false },
                      { label: "Sibling -15%", pct: 15, amt: 0, sch: false },
                      { label: "Promo -$15", pct: 0, amt: 15, sch: false },
                    ].map((preset) => (
                      <button
                        key={preset.label}
                        type="button"
                        onClick={() => {
                          setValue("specialOffer", preset.label);
                          setValue("isScholarship", preset.sch);
                          setValue("discountPercent", preset.pct);
                          setValue("discountAmount", preset.amt);
                          if (preset.sch) {
                            setValue("fee", 0);
                            const zeroFees: Record<string, number> = {};
                            watchedTeams.forEach((t) => {
                              zeroFees[t] = 0;
                            });
                            setValue("teamFees", zeroFees);
                          } else {
                            const selectedPkg = trainingPackages.find(
                              (p) => p.id === watchedPackageId,
                            );
                            const base = selectedPkg
                              ? selectedPkg.monthlyPrice
                              : calculatePlayerBaseFee(
                                  {
                                    fee: 85,
                                    teams: watchedTeams,
                                    teamFees: watchedTeamFees,
                                    branch: getValues("branch"),
                                  },
                                  rawTeams,
                                  rawBranches,
                                );
                            const net = Math.max(
                              0,
                              Math.round(base * (1 - preset.pct / 100)) - preset.amt,
                            );
                            setValue("fee", net);
                          }
                        }}
                        className="rounded bg-ink-850 hover:bg-ink-800 px-2 py-0.5 font-mono text-[10px] text-amber-300 ring-1 ring-amber-500/30 transition-colors"
                      >
                        <Sparkles className="inline w-2.5 h-2.5 mr-1" />
                        {preset.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <Controller
                control={control}
                name="discountPercent"
                render={({ field }) => (
                  <Field label="Discount (%)" hint="0–100%">
                    <Input
                      type="number"
                      disabled={!canManageBilling || watchedIsScholarship}
                      value={String(field.value ?? 0)}
                      onChange={(v) => {
                        if (!canManageBilling) return;
                        const pct = Math.max(0, Math.min(100, Number(v) || 0));
                        field.onChange(pct);
                        if (pct >= 100) {
                          setValue("fee", 0);
                        } else {
                          const selectedPkg = trainingPackages.find(
                            (p) => p.id === watchedPackageId,
                          );
                          const base = selectedPkg
                            ? selectedPkg.monthlyPrice
                            : calculatePlayerBaseFee(
                                {
                                  fee: 85,
                                  teams: watchedTeams,
                                  teamFees: watchedTeamFees,
                                  branch: getValues("branch"),
                                },
                                rawTeams,
                                rawBranches,
                              );
                          const net = Math.max(
                            0,
                            Math.round(base * (1 - pct / 100)) - watchedDiscountAmount,
                          );
                          setValue("fee", net);
                        }
                      }}
                    />
                  </Field>
                )}
              />

              <Controller
                control={control}
                name="discountAmount"
                render={({ field }) => (
                  <Field label="Fixed Discount ($)" hint="USD off tuition">
                    <Input
                      type="number"
                      disabled={!canManageBilling || watchedIsScholarship}
                      value={String(field.value ?? 0)}
                      onChange={(v) => {
                        if (!canManageBilling) return;
                        const amt = Math.max(0, Number(v) || 0);
                        field.onChange(amt);
                        const selectedPkg = trainingPackages.find((p) => p.id === watchedPackageId);
                        const base = selectedPkg
                          ? selectedPkg.monthlyPrice
                          : calculatePlayerBaseFee(
                              {
                                fee: 85,
                                teams: watchedTeams,
                                teamFees: watchedTeamFees,
                                branch: getValues("branch"),
                              },
                              rawTeams,
                              rawBranches,
                            );
                        const net = Math.max(
                          0,
                          Math.round(base * (1 - watchedDiscountPercent / 100)) - amt,
                        );
                        setValue("fee", net);
                      }}
                    />
                  </Field>
                )}
              />
            </div>

            {watchedTeams.length > 1 && (
              <div className="grid gap-2 sm:grid-cols-2 pt-1 border-t border-ink-800/80">
                {watchedTeams.map((tName) => {
                  const currentTeamFee = watchedIsScholarship ? 0 : (watchedTeamFees[tName] ?? 85);
                  return (
                    <div
                      key={tName}
                      className="flex items-center justify-between rounded bg-ink-850 px-2.5 py-1.5 border border-ink-750"
                    >
                      <span
                        className="text-xs font-medium text-ink-200 truncate pr-2"
                        title={tName}
                      >
                        {tName}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-xs text-ink-400 font-mono">
                          {db.academy?.currency || "USD"}
                        </span>
                        <input
                          type="number"
                          min="0"
                          disabled={!canManageBilling || watchedIsScholarship}
                          className="w-20 rounded bg-ink-900 px-2 py-1 text-right font-mono text-xs text-ink-100 ring-1 ring-ink-700 focus:outline-none focus:ring-court-500 disabled:opacity-60 disabled:cursor-not-allowed"
                          value={currentTeamFee}
                          onChange={(e) => {
                            if (!canManageBilling) return;
                            const newAmount = Math.max(0, Number(e.target.value) || 0);
                            const updatedFees = { ...watchedTeamFees, [tName]: newAmount };
                            setValue("teamFees", updatedFees);
                            const baseSum = watchedTeams.reduce(
                              (acc, t) => acc + (updatedFees[t] ?? 0),
                              0,
                            );
                            const netSum = Math.max(
                              0,
                              Math.round(baseSum * (1 - watchedDiscountPercent / 100)) -
                                watchedDiscountAmount,
                            );
                            setValue("fee", netSum);
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 pt-1 border-t border-ink-800/80">
              <Controller
                control={control}
                name="fee"
                render={({ field }) => (
                  <Field
                    label={
                      watchedTeams.length > 1 ? "Net Monthly Fee (All Teams)" : "Net Monthly Fee"
                    }
                    hint="USD, recurring until stopped ($0 allowed for exempt athletes)"
                    error={errors.fee?.message}
                  >
                    <Input
                      type="number"
                      disabled={!canManageBilling}
                      value={String(field.value)}
                      onChange={(v) => {
                        if (!canManageBilling) return;
                        const total = Math.max(0, Number(v) || 0);
                        field.onChange(total);
                        if (total > 0 && watchedIsScholarship) {
                          setValue("isScholarship", false);
                        }
                        if (watchedTeams.length > 0) {
                          const split = Math.round(total / watchedTeams.length);
                          const updated: Record<string, number> = {};
                          watchedTeams.forEach((t, idx) => {
                            if (idx === watchedTeams.length - 1) {
                              updated[t] = total - split * (watchedTeams.length - 1);
                            } else {
                              updated[t] = split;
                            }
                          });
                          setValue("teamFees", updated);
                        }
                      }}
                    />
                  </Field>
                )}
              />

              <Controller
                control={control}
                name="familyId"
                render={({ field }) => (
                  <Field
                    label="Family Group ID (Optional)"
                    hint="Shared family key to link siblings if guardian phones differ"
                  >
                    <Input
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      placeholder="Auto-grouped by guardian phone/name..."
                    />
                  </Field>
                )}
              />
            </div>
          </div>
          <Controller
            control={control}
            name="balance"
            render={({ field }) => (
              <Field label="Outstanding balance" error={errors.balance?.message}>
                <Input
                  type="number"
                  disabled={!canManageBilling}
                  value={String(field.value)}
                  onChange={(v) => {
                    if (!canManageBilling) return;
                    field.onChange(Number(v) || 0);
                  }}
                />
              </Field>
            )}
          />
          <Controller
            control={control}
            name="status"
            render={({ field }) => (
              <Field label="Status" error={errors.status?.message}>
                <Select
                  value={field.value}
                  onChange={field.onChange}
                  options={["Active", "Idle", "Soft flag", "Inactive"]}
                />
              </Field>
            )}
          />

          <div className="col-span-1 sm:col-span-2 pt-2 border-t border-ink-800">
            <Field
              label="Player Official Documents (ID Card / Passport / Birth Certificate / Medical)"
              hint="Attach PDF, JPG, or PNG documents (multiple documents supported)"
            >
              <div className="space-y-2.5">
                <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    disabled={idUploading}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      e.target.value = "";
                      if (file.size > 15 * 1024 * 1024) {
                        toast.error("Document file must be under 15MB");
                        return;
                      }
                      try {
                        setIdUploading(true);
                        const targetPlayerId = editing?.id || `p-${Date.now().toString(36)}`;
                        const uploadedDoc = await uploadDocumentAttachment(
                          tenantId,
                          "players",
                          targetPlayerId,
                          file,
                        );
                        setFormDocuments((prev) => {
                          const next = [...prev, uploadedDoc];
                          setValue("idCardUrl", next[0]?.url || uploadedDoc.url);
                          return next;
                        });
                        toast.success(`Document "${uploadedDoc.name}" attached.`);
                      } catch (err) {
                        console.error("Document upload failed:", err);
                        toast.error("Failed to upload document.");
                      } finally {
                        setIdUploading(false);
                      }
                    }}
                    className="w-full rounded-md bg-ink-850 px-3 py-2 font-ui text-sm text-ink-200 ring-1 ring-ink-700 file:mr-3 file:rounded file:border-0 file:bg-court-500 file:px-2 file:py-1 file:text-xs file:font-semibold file:text-ink-950 disabled:opacity-50"
                  />
                </div>
                {formDocuments.length > 0 && (
                  <div className="space-y-1.5">
                    {formDocuments.map((docItem) => (
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
                          onClick={() => {
                            setFormDocuments((prev) => {
                              const next = prev.filter((d) => d.id !== docItem.id);
                              setValue("idCardUrl", next[0]?.url || undefined);
                              return next;
                            });
                          }}
                          className="text-bad hover:underline font-mono text-[10px] shrink-0"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {idUploading && (
                <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-court-400">
                  <div className="h-1.5 w-1.5 rounded-full bg-court-400 animate-ping" />
                  Uploading document...
                </div>
              )}
            </Field>
          </div>
        </div>
      </Modal>

      <Modal
        open={paymentOpen && canManageBilling}
        title={`Record Payment · ${payFor?.name}`}
        meta={payFor ? `Outstanding: ${money(Math.max(0, payFor.balance || 0))}` : undefined}
        onClose={() => setPaymentOpen(false)}
        onSubmit={submitPay}
        submitLabel="Confirm Payment"
      >
        <div className="p-4 space-y-3">
          {payFor && (
            <div className="rounded bg-ink-900/70 px-3 py-2 text-xs font-mono text-ink-300 border border-ink-800 flex items-center justify-between">
              <span>Current Balance</span>
              <span className="text-court-400 font-semibold">
                {`Outstanding: ${money(Math.max(0, payFor.balance || 0))}`}
              </span>
            </div>
          )}
          <Field label="Amount (USD)">
            <Input
              type="number"
              value={String(paymentAmount)}
              onChange={(v) => setPaymentAmount(Number(v) || 0)}
            />
          </Field>
          <Field label="Note (Optional)">
            <Input
              value={paymentNote}
              onChange={(v) => setPaymentNote(v)}
              placeholder="Optional payment notes..."
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(editingPaymentEntry) && canManageBilling}
        title="Edit Recorded Payment"
        meta={editingPaymentEntry?.entry}
        onClose={() => setEditingPaymentEntry(null)}
        onSubmit={async (e) => {
          if (e && typeof e.preventDefault === "function") e.preventDefault();
          if (!editingPaymentEntry) return;
          await editLedgerTransaction(editingPaymentEntry.id, {
            amount: Math.abs(Number(editPayAmount) || 0),
            date: editPayDate,
            note: editPayNote,
          });
          toast.success("Payment updated and player balance automatically reconciled.");
          setEditingPaymentEntry(null);
        }}
        submitLabel="Save & Reconcile"
      >
        <div className="p-4 space-y-3">
          <Field label="Amount (USD)">
            <Input
              type="number"
              value={String(editPayAmount)}
              onChange={(v) => setEditPayAmount(Number(v) || 0)}
            />
          </Field>
          <Field label="Payment Date">
            <Input type="date" value={editPayDate} onChange={setEditPayDate} />
          </Field>
          <Field label="Note">
            <Input value={editPayNote} onChange={setEditPayNote} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={reportsOpen}
        title="Payment Reports"
        onClose={() => setReportsOpen(false)}
        submitLabel="Close"
        onSubmit={(e) => {
          if (e && typeof e.preventDefault === "function") {
            e.preventDefault();
          }
          setReportsOpen(false);
        }}
      >
        <div className="grid gap-2 p-4">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              exportCSV(
                "Paid",
                players.filter((p) => p.balance === 0),
              )
            }
          >
            Download Paid (CSV)
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              exportPDF(
                "Paid",
                players.filter((p) => p.balance === 0),
              )
            }
          >
            Download Paid (PDF)
          </Button>
          <div className="my-2 h-px bg-ink-800" />
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              exportCSV(
                "Soft_Deadline",
                players.filter((p) => p.status === "Soft flag"),
              )
            }
          >
            Download Soft Deadline (CSV)
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              exportPDF(
                "Soft_Deadline",
                players.filter((p) => p.status === "Soft flag"),
              )
            }
          >
            Download Soft Deadline (PDF)
          </Button>
          <div className="my-2 h-px bg-ink-800" />
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              exportCSV(
                "Inactive",
                players.filter((p) => p.status === "Inactive"),
              )
            }
          >
            Download Inactive (CSV)
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              exportPDF(
                "Inactive",
                players.filter((p) => p.status === "Inactive"),
              )
            }
          >
            Download Inactive (PDF)
          </Button>
          <div className="my-2 h-px bg-ink-800" />
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              exportCSV(
                "All_Due",
                players.filter((p) => p.balance > 0),
              )
            }
          >
            Download All Due (CSV)
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              exportPDF(
                "All_Due",
                players.filter((p) => p.balance > 0),
              )
            }
          >
            Download All Due (PDF)
          </Button>
        </div>
      </Modal>

      <datalist id="teams-list">
        {teams.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      {digitalPassPlayer && (
        <Suspense fallback={null}>
          <PlayerPassModal
            open={!!digitalPassPlayer}
            player={digitalPassPlayer}
            onClose={() => setDigitalPassPlayer(null)}
          />
        </Suspense>
      )}

      {/* Unified Family Balance Payment Modal */}
      <Modal
        open={Boolean(familyPaymentGroup) && canManageBilling}
        title={
          familyPaymentGroup
            ? `Pay Family Balance · ${familyPaymentGroup.guardianName}`
            : "Pay Family Balance"
        }
        meta="Single receipt automatically settles open invoices and balances across all siblings"
        onClose={() => {
          if (!isSubmittingFamilyPay) setFamilyPaymentGroup(null);
        }}
        onSubmit={async (e) => {
          if (e && typeof e.preventDefault === "function") e.preventDefault();
          if (!familyPaymentGroup) return;
          const amt = Math.abs(Number(familyPayAmount) || 0);
          if (amt <= 0) {
            toast.error("Please enter a valid payment amount greater than 0.");
            return;
          }
          try {
            setIsSubmittingFamilyPay(true);
            const sibIds = familyPaymentGroup.children.map((c) => c.player.id);
            await payFamilyBalance(sibIds, amt, familyPayMethod, familyPayNote);
            setFamilyPaymentGroup(null);
          } catch (err) {
            console.error("Failed to record family payment:", err);
            toast.error("Failed to record unified family payment.");
          } finally {
            setIsSubmittingFamilyPay(false);
          }
        }}
        submitLabel={isSubmittingFamilyPay ? "Recording..." : "Confirm Family Payment"}
      >
        {familyPaymentGroup && (
          <div className="p-4 space-y-3.5">
            <div className="rounded-lg border border-ink-800 bg-ink-900/80 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-ink-400 uppercase">Linked Siblings</span>
                <span className="text-court-300 font-bold">
                  {familyPaymentGroup.children.length} Athletes
                </span>
              </div>
              <div className="divide-y divide-ink-850 text-xs font-mono">
                {familyPaymentGroup.children.map((sib) => (
                  <div key={sib.player.id} className="py-1.5 flex items-center justify-between">
                    <div>
                      <span className="text-ink-100 font-semibold">{sib.player.name}</span>
                      <span className="text-[10px] text-ink-400 ml-1.5">({sib.squadName})</span>
                    </div>
                    <div className="text-right">
                      <span className="text-ink-300">Bal: {money(sib.currentBalance)}</span>
                      <span className="text-ink-500 mx-1">·</span>
                      <span className="text-court-400">Net: {money(sib.netFee)}/mo</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="pt-2 border-t border-ink-800 flex items-center justify-between font-mono text-xs">
                <span className="text-ink-300">Combined Family Balance:</span>
                <span className="text-sm font-bold text-amber-400">
                  {money(familyPaymentGroup.combinedBalance)}
                </span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`Total Payment Amount (${db.academy?.currency || "USD"})`}>
                <Input
                  type="number"
                  value={String(familyPayAmount)}
                  onChange={(v) => setFamilyPayAmount(Math.max(0, Number(v) || 0))}
                />
              </Field>
              <Field label="Payment Method">
                <Select
                  value={familyPayMethod}
                  onChange={setFamilyPayMethod}
                  options={["Cash", "Whish Money", "OMT", "Bank Transfer", "Check"]}
                />
              </Field>
            </div>

            <Field label="Receipt Notes (Optional)">
              <Input
                value={familyPayNote}
                onChange={setFamilyPayNote}
                placeholder="e.g. Unified family package payment at front desk..."
              />
            </Field>
          </div>
        )}
      </Modal>

      {/* Point 6D: Upgrade / Change Training Package Modal */}
      <Modal
        open={Boolean(upgradeModalPlayer)}
        title={
          upgradeModalPlayer
            ? `Upgrade / Change Package · ${upgradeModalPlayer.name}`
            : "Upgrade Training Package"
        }
        meta="Switch practice cap mid-month (charge difference) or start a fresh monthly cycle"
        onClose={() => {
          if (!isUpgradingPackage) setUpgradeModalPlayer(null);
        }}
        onSubmit={async (e) => {
          if (e && typeof e.preventDefault === "function") e.preventDefault();
          if (!upgradeModalPlayer) return;
          const newPkg = trainingPackages.find((p) => p.id === upgradeTargetPkgId);
          if (!newPkg) {
            toast.error("Please select a target training package.");
            return;
          }
          const currentPkg = trainingPackages.find((p) => p.id === upgradeModalPlayer.packageId);
          const currentBasePrice = currentPkg
            ? currentPkg.monthlyPrice
            : upgradeModalPlayer.fee || 0;
          const priceDiff = Math.max(0, newPkg.monthlyPrice - currentBasePrice);
          const discPct = Number(upgradeModalPlayer.discountPercent || 0);
          const discAmt = Number(upgradeModalPlayer.discountAmount || 0);
          const nextMonthlyFee = upgradeModalPlayer.isScholarship
            ? 0
            : Math.max(0, Math.round(newPkg.monthlyPrice * (1 - discPct / 100)) - discAmt);

          try {
            setIsUpgradingPackage(true);
            const oldPkgLabel =
              upgradeModalPlayer.packageName ||
              (upgradeModalPlayer.allowedPracticesPerMonth
                ? `${upgradeModalPlayer.allowedPracticesPerMonth} Practices/Mo`
                : "Standard Program");

            let nextBalance = upgradeModalPlayer.balance || 0;

            if (upgradeMode === "mid_month" && priceDiff > 0) {
              const todayIso = new Date().toISOString().slice(0, 10);
              if (upgradePaymentHandling === "collect_now") {
                const upgLedgerId = `l-upg-${upgradeModalPlayer.id}-${Date.now().toString(36)}`;
                const upgEntry: LedgerEntry = {
                  id: upgLedgerId,
                  date: todayIso,
                  account: "Tuition",
                  category: "Tuition",
                  entry: `Package Upgrade · ${upgradeModalPlayer.name} (${oldPkgLabel} → ${newPkg.name})`,
                  description: `Package Upgrade · ${upgradeModalPlayer.name} (${oldPkgLabel} → ${newPkg.name})`,
                  type: "Revenue",
                  status: "Collected",
                  amount: priceDiff,
                  paymentMethod: upgradePaymentMethod,
                  branch: upgradeModalPlayer.branch || "",
                  playerId: upgradeModalPlayer.id,
                  referenceId: upgradeModalPlayer.id,
                  note: `Mid-month package upgrade difference (${oldPkgLabel} → ${newPkg.name})`,
                };
                await setEntity("ledger", upgEntry);
              } else {
                const now = new Date();
                const mName = now.toLocaleString("en-US", { month: "long" });
                const upgInvId = `inv-upg-${upgradeModalPlayer.id}-${Date.now().toString(36)}`;
                const upgInvoice: Invoice = {
                  id: upgInvId,
                  invoiceNumber: `UPG-${Date.now().toString().slice(-6)}`,
                  playerId: upgradeModalPlayer.id,
                  playerName: upgradeModalPlayer.name,
                  playerBranch: upgradeModalPlayer.branch || "",
                  team: (upgradeModalPlayer.teams || [])[0] || upgradeModalPlayer.category,
                  programTier: newPkg.name,
                  month: mName,
                  billingMonth: mName,
                  year: now.getFullYear(),
                  amount: priceDiff,
                  status: "pending",
                  issuedDate: todayIso,
                  dueDate: todayIso,
                  description: `Package Upgrade Adjustment (${oldPkgLabel} → ${newPkg.name})`,
                };
                await setEntity("invoices", upgInvoice);
                nextBalance += priceDiff;
              }
            }

            await patchEntity("players", upgradeModalPlayer.id, {
              packageId: newPkg.id,
              packageName: newPkg.name,
              allowedPracticesPerMonth: newPkg.practicesPerMonth,
              fee: nextMonthlyFee,
              balance: nextBalance,
            });

            toast.success(
              upgradeMode === "mid_month" && priceDiff > 0
                ? upgradePaymentHandling === "collect_now"
                  ? `Upgraded ${upgradeModalPlayer.name} to ${newPkg.name} and collected $${priceDiff} difference in Ledger.`
                  : `Upgraded ${upgradeModalPlayer.name} to ${newPkg.name} and billed $${priceDiff} difference to player balance.`
                : `Updated ${upgradeModalPlayer.name} to ${newPkg.name} (${newPkg.practicesPerMonth >= 999 ? "Unlimited" : `${newPkg.practicesPerMonth} practices/mo`}).`,
            );
            setUpgradeModalPlayer(null);
          } catch (err) {
            console.error("Failed to upgrade package:", err);
            toast.error("Failed to upgrade player package.");
          } finally {
            setIsUpgradingPackage(false);
          }
        }}
        submitLabel={isUpgradingPackage ? "Applying..." : "Confirm Package Change"}
      >
        {upgradeModalPlayer &&
          (() => {
            const currentPkg = trainingPackages.find((p) => p.id === upgradeModalPlayer.packageId);
            const currentBasePrice = currentPkg
              ? currentPkg.monthlyPrice
              : upgradeModalPlayer.fee || 0;
            const targetPkg = trainingPackages.find((p) => p.id === upgradeTargetPkgId);
            const priceDiff = targetPkg
              ? Math.max(0, targetPkg.monthlyPrice - currentBasePrice)
              : 0;
            const mtdPresent = getPlayerMonthlyPresentCount(
              upgradeModalPlayer.id,
              db.sessions,
              db.attendance,
            );
            return (
              <div className="p-4 space-y-4">
                <div className="rounded-lg border border-ink-800 bg-ink-900/80 p-3 space-y-1.5 font-mono text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-ink-400">Current Package:</span>
                    <span className="font-bold text-ink-100">
                      {upgradeModalPlayer.packageName || "Standard Program"} ($
                      {currentBasePrice}/mo)
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-ink-400">Current Month Attendance:</span>
                    <span className="font-bold text-court-300">
                      {mtdPresent} /{" "}
                      {upgradeModalPlayer.allowedPracticesPerMonth
                        ? upgradeModalPlayer.allowedPracticesPerMonth >= 999
                          ? "∞"
                          : upgradeModalPlayer.allowedPracticesPerMonth
                        : "—"}{" "}
                      Practices Attended
                    </span>
                  </div>
                </div>

                <Field label="Target Training Package">
                  <select
                    value={upgradeTargetPkgId}
                    onChange={(e) => setUpgradeTargetPkgId(e.target.value)}
                    className="w-full rounded-md border border-ink-750 bg-ink-900 px-3 py-2 text-xs text-ink-100 focus:border-court-500 focus:outline-none"
                  >
                    {trainingPackages.map((pkg) => (
                      <option key={pkg.id} value={pkg.id}>
                        {pkg.name} —{" "}
                        {pkg.practicesPerMonth >= 999
                          ? "Unlimited Practices/Mo"
                          : `${pkg.practicesPerMonth} Practices/Mo`}{" "}
                        (${pkg.monthlyPrice}/mo)
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label="Upgrade / Cycle Mode">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => setUpgradeMode("mid_month")}
                      className={`rounded-md border p-2.5 text-left font-mono text-xs transition-colors ${
                        upgradeMode === "mid_month"
                          ? "border-court-500 bg-court-500/15 text-court-300 font-bold"
                          : "border-ink-750 bg-ink-900 text-ink-300"
                      }`}
                    >
                      <div>Option A — Mid-Month Upgrade</div>
                      <div className="text-[10px] font-normal text-ink-400 mt-0.5">
                        Keep {mtdPresent} attended sessions &amp; charge price difference ($
                        {priceDiff})
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setUpgradeMode("new_month")}
                      className={`rounded-md border p-2.5 text-left font-mono text-xs transition-colors ${
                        upgradeMode === "new_month"
                          ? "border-emerald-500 bg-emerald-500/15 text-emerald-300 font-bold"
                          : "border-ink-750 bg-ink-900 text-ink-300"
                      }`}
                    >
                      <div>Option B — New Month Fresh Start</div>
                      <div className="text-[10px] font-normal text-ink-400 mt-0.5">
                        Update package for new billing cycle ($0 difference charged now)
                      </div>
                    </button>
                  </div>
                </Field>

                {upgradeMode === "mid_month" && priceDiff > 0 && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 space-y-3">
                    <div className="flex items-center justify-between font-mono text-xs">
                      <span className="text-amber-200 font-semibold">
                        Upgrade Price Difference:
                      </span>
                      <span className="text-sm font-bold text-amber-300">${priceDiff}</span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setUpgradePaymentHandling("collect_now")}
                        className={`rounded border px-3 py-2 text-left font-mono text-xs ${
                          upgradePaymentHandling === "collect_now"
                            ? "border-emerald-500 bg-emerald-500/20 text-emerald-200 font-bold"
                            : "border-ink-750 bg-ink-900 text-ink-300"
                        }`}
                      >
                        ✅ Collect Difference Now (${priceDiff})
                      </button>
                      <button
                        type="button"
                        onClick={() => setUpgradePaymentHandling("bill_balance")}
                        className={`rounded border px-3 py-2 text-left font-mono text-xs ${
                          upgradePaymentHandling === "bill_balance"
                            ? "border-amber-500 bg-amber-500/20 text-amber-200 font-bold"
                            : "border-ink-750 bg-ink-900 text-ink-300"
                        }`}
                      >
                        🧾 Bill Difference to Balance (+${priceDiff})
                      </button>
                    </div>
                    {upgradePaymentHandling === "collect_now" && (
                      <Field label="Payment Method">
                        <Select
                          value={upgradePaymentMethod}
                          onChange={setUpgradePaymentMethod}
                          options={["Cash", "Whish Money", "OMT", "Bank Transfer", "Check"]}
                        />
                      </Field>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
      </Modal>

      {/* Player Deletion Confirmation Modal */}
      <Modal
        title={deletingPlayer ? `Remove ${deletingPlayer.name} from Roster` : "Delete Player"}
        open={Boolean(deletingPlayer)}
        onClose={() => setDeletingPlayer(null)}
      >
        {deletingPlayer && (
          <div className="space-y-4 p-4">
            <p className="text-sm text-ink-200">
              Are you sure you want to permanently delete{" "}
              <strong className="text-ink-100">{deletingPlayer.name}</strong> from the roster? This
              action cannot be undone and will clean up all associated session attendance records.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button variant="outline" size="sm" onClick={() => setDeletingPlayer(null)}>
                Cancel
              </Button>
              <Button variant="bad" size="sm" onClick={confirmDeletePlayer}>
                Confirm & Remove
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}

function LineRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-300">{label}</span>
      <span className="text-right font-mono text-xs text-ink-100">{value}</span>
    </div>
  );
}

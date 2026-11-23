import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo, lazy, Suspense } from "react";
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
  money as kitMoney,
  Pagination,
} from "@/components/kit";
import { downloadCsv, exportPdf } from "@/lib/report";
import {
  useDB,
  useCollection,
  useTenantUser,
  useModulePermissions,
  defaultRoleDefinitions,
  calculateTeamOperatingCostReport,
  calculateBranchCourtUtilizationAnalytics,
  type SuspensionAuditResult,
} from "@/lib/data-store";
import { useAuth } from "@/lib/auth";
import { VirtualTable } from "@/components/virtual-table";
import type { LedgerEntry } from "@/lib/data-store";
import type { Invoice } from "@/lib/mock-data";
import {
  calculateAttendanceVerifiedPayroll,
  createCoachPayrollDebitEntry,
  type CoachPayrollRow,
} from "@/lib/payroll";
import { uploadAccountingReceipt } from "@/lib/storage";
import { dispatchNotification, createAcademyNotification } from "@/lib/notifications";
import { openDirectWhatsApp } from "@/lib/whatsapp";
import {
  recordCashPayment,
  SUPPORTED_PAYMENT_METHODS,
  calculatePlayerMonthlyFee,
  type SupportedPaymentMethod,
} from "@/lib/payments";
import { toast } from "sonner";
import { MonthlyInvoicingModal } from "@/components/monthly-invoicing-modal";
import { FamilyBundledInvoicingModal } from "@/components/family-bundled-invoicing-modal";
import { normalizeDoubleEntryLedger, type LedgerModule } from "@/lib/accounting-coa";

const AccountingCharts = lazy(() => import("@/components/accounting-charts"));

export const Route = createFileRoute("/accounting")({
  head: () => ({
    meta: [
      { title: "Accounting — Vescio Vector" },
      {
        name: "description",
        content:
          "Academy ledger: fee collections, attendance-verified coach payroll, court rental, merchandise costs and outstanding balances.",
      },
    ],
  }),
  component: AccountingPage,
});

const DEFAULT_ACCOUNTS = [
  "Tuition",
  "Monthly fees",
  "Player Insurance",
  "Insurance",
  "Merchandise Revenue",
  "Accounts Receivable - Merchandise",
  "Sponsorship",
  "Camp income",
  "Staff Salaries",
  "Coach Payroll Expense",
  "Coach payroll",
  "Referee & Official Fees",
  "Rental",
  "Court Rental",
  "Court rental",
  "Maintenance",
  "Equipment",
  "Merchandise Expense",
  "Merchandise",
  "Utilities",
  "Other",
];

const MODULE_COST_CENTER_OPTIONS: Array<{ label: string; value: LedgerModule }> = [
  { label: "Academy", value: "academy" },
  { label: "Nexus Courts", value: "courts" },
  { label: "Nexus Gym", value: "gym" },
  { label: "Nexus Physio", value: "physio" },
  { label: "Nexus Kiosk POS", value: "pos" },
  { label: "Merchandise", value: "merchandise" },
  { label: "General / Shared", value: "general" },
];

const MONTH_OPTIONS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const COLORS = [
  "#10b981",
  "#3b82f6",
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
  "#14b8a6",
  "#ef4444",
  "#6366f1",
];

const blank: Omit<LedgerEntry, "id"> = {
  date: new Date().toISOString().slice(0, 10),
  account: "Tuition",
  entry: "",
  type: "Revenue",
  amount: 0,
  status: "Collected",
  paymentMethod: "Cash",
  note: "",
  branch: "",
  module: "general",
};

function AccountingPage() {
  const {
    db,
    tenantId,
    ready,
    setEntity,
    patchEntity,
    deleteEntity,
    generateMonthlyInvoices,
    checkOverdueSuspensions,
    triggerServerBillingCron,
    payInvoice,
    editLedgerTransaction,
    deleteLedgerTransaction,
    update,
  } = useDB();
  const { items: rawLedger } = useCollection("ledger");
  const { items: rawInvoices } = useCollection("invoices");
  const { items: rawPlayers } = useCollection("players");
  const { items: rawCoaches } = useCollection("coaches");
  const { items: rawBranches } = useCollection("branches");
  const { items: rawTeams } = useCollection("teams");
  const { user, passwordUser, loading: authLoading } = useAuth();
  const currentUser = useTenantUser();
  const {
    canRead: canReadAccounting,
    canWrite: canWriteAccounting,
    canDelete: canDeleteAccounting,
  } = useModulePermissions("accounting");

  const isBranchScoped =
    (currentUser?.role === "Branch Manager" ||
      currentUser?.branchScope === "Assigned branch only") &&
    Boolean(currentUser?.branch);
  const userBranch = isBranchScoped ? currentUser?.branch || "" : "";

  const userRoleDef = useMemo(() => {
    const roleName = currentUser?.role;
    if (!roleName) return undefined;
    const defaultDef = defaultRoleDefinitions.find(
      (r) => r.name.toLowerCase() === roleName.toLowerCase(),
    );
    const customDef = (db.customRoles || []).find(
      (r) => r.name.toLowerCase() === roleName.toLowerCase(),
    );
    if (!customDef && !defaultDef) return undefined;
    return {
      ...defaultDef,
      ...customDef,
      permissions: { ...defaultDef?.permissions, ...customDef?.permissions },
    };
  }, [currentUser?.role, db.customRoles]);

  const hasAccess =
    currentUser?.role === "Super Admin" ||
    currentUser?.role === "Academy Manager" ||
    currentUser?.role === "Accountant" ||
    canReadAccounting ||
    Boolean(userRoleDef?.permissions?.["accounting"]?.read) ||
    user?.email === "geogo3@gmail.com" ||
    passwordUser?.email === "geogo3@gmail.com";

  const hasFeature = db.academy?.features?.includes("accounting") !== false;

  const primaryCurrency = db.academy?.currency || db.academy?.currencies?.[0] || "USD";
  const [currency, setCurrency] = useState<string>(primaryCurrency);
  const [exchangeRate, setExchangeRate] = useState<number>(89500);

  useEffect(() => {
    setCurrency(primaryCurrency);
  }, [primaryCurrency]);

  const money = (val: number) => {
    if (currency === "LBP" && primaryCurrency !== "LBP") {
      const converted = Math.round((val || 0) * exchangeRate);
      return `${converted.toLocaleString()} L.L.`;
    }
    return kitMoney(val);
  };

  const [activeTab, setActiveTab] = useState<
    "dashboard" | "invoices" | "payroll" | "reports" | "ledger"
  >("dashboard");

  useEffect(() => {
    try {
      const param = new URLSearchParams(window.location.search).get("tab");
      if (
        param === "payroll" ||
        param === "invoices" ||
        param === "reports" ||
        param === "ledger" ||
        param === "dashboard"
      ) {
        setActiveTab(param);
      }
    } catch {
      // ignore
    }
  }, []);

  // Coach Payroll Tab State
  const [payrollMonth, setPayrollMonth] = useState(
    () => MONTH_OPTIONS[new Date().getMonth()] || "May",
  );
  const [payrollYear, setPayrollYear] = useState(() => new Date().getFullYear());
  const [payrollBranch, setPayrollBranch] = useState(isBranchScoped ? userBranch : "");
  const [payrollQuery, setPayrollQuery] = useState("");
  const [selectedCoachSessions, setSelectedCoachSessions] = useState<CoachPayrollRow | null>(null);
  const [disburseModalCoach, setDisburseModalCoach] = useState<CoachPayrollRow | null>(null);
  const [disburseAmount, setDisburseAmount] = useState<number>(0);
  const [disbursePaymentMethod, setDisbursePaymentMethod] = useState("Bank Transfer");
  const [disburseNote, setDisburseNote] = useState("");
  const [disburseAdvanceReason, setDisburseAdvanceReason] = useState("");
  const [disburseLinkedSessionsCount, setDisburseLinkedSessionsCount] = useState<number>(0);
  const [isDisbursing, setIsDisbursing] = useState(false);
  const [batchDisburseOpen, setBatchDisburseOpen] = useState(false);

  // Invoicing Generator Modal State
  const [invoicingModalOpen, setInvoicingModalOpen] = useState(false);
  const [familyModalOpen, setFamilyModalOpen] = useState(false);
  const [targetMonth, setTargetMonth] = useState(() => {
    return MONTH_OPTIONS[new Date().getMonth()];
  });
  const [targetYear, setTargetYear] = useState(new Date().getFullYear());
  const [targetBranch, setTargetBranch] = useState(isBranchScoped ? userBranch : "");

  // Server Billing Cron & Suspension Audit State
  const [isAuditingSuspensions, setIsAuditingSuspensions] = useState(false);
  const [suspensionAuditModalOpen, setSuspensionAuditModalOpen] = useState(false);
  const [suspensionAuditResult, setSuspensionAuditResult] = useState<SuspensionAuditResult | null>(
    null,
  );
  const [cronHistoryModalOpen, setCronHistoryModalOpen] = useState(false);

  const handleRunSuspensionAudit = async () => {
    try {
      setIsAuditingSuspensions(true);
      const res = await checkOverdueSuspensions();
      setSuspensionAuditResult(res);
      setSuspensionAuditModalOpen(true);
      if (res.changes.length > 0) {
        toast.warning(
          `Overdue audit complete: ${res.flaggedSoft} soft flags, ${res.flaggedInactive} inactive suspensions updated.`,
        );
      } else {
        toast.success(
          `Audit complete: All ${res.evaluated} accounts evaluated. No status modifications needed.`,
        );
      }
    } catch (e) {
      console.error("Failed to run overdue suspension audit:", e);
      toast.error("Failed to execute overdue suspension check.");
    } finally {
      setIsAuditingSuspensions(false);
    }
  };

  // Invoices Tab State
  const [invoiceQuery, setInvoiceQuery] = useState("");
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<string>("");
  const [invoiceMonthFilter, setInvoiceMonthFilter] = useState<string>("");
  const [invoiceBranchFilter, setInvoiceBranchFilter] = useState<string>("");
  const [invoicePage, setInvoicePage] = useState(1);
  const invoicePageSize = 15;

  // Cash / Offline Payment Modal State
  const [cashPaymentModalOpen, setCashPaymentModalOpen] = useState(false);
  const [selectedInvoiceForPayment, setSelectedInvoiceForPayment] = useState<Invoice | null>(null);
  const [cashPaymentMethod, setCashPaymentMethod] = useState<SupportedPaymentMethod>("Cash");
  const [authorizedCollector, setAuthorizedCollector] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [isRecordingPayment, setIsRecordingPayment] = useState(false);

  const openRecordCashModal = (inv: Invoice) => {
    setSelectedInvoiceForPayment(inv);
    setCashPaymentMethod("Cash");
    setAuthorizedCollector(currentUser?.name || user?.displayName || "Authorized Cashier");
    setPaymentNotes("");
    setCashPaymentModalOpen(true);
  };

  const handleRecordCashPayment = async (e?: React.FormEvent) => {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    if (!selectedInvoiceForPayment) return;
    const collector = authorizedCollector.trim() || currentUser?.name || "Authorized Staff";

    try {
      setIsRecordingPayment(true);
      const cashRecord = await recordCashPayment({
        amount: selectedInvoiceForPayment.amount,
        payerName: selectedInvoiceForPayment.playerName,
        description: `Tuition Collection · ${selectedInvoiceForPayment.playerName} · ${selectedInvoiceForPayment.billingMonth} ${selectedInvoiceForPayment.year}`,
        paymentMethod: cashPaymentMethod,
        authorizedCollector: collector,
        metadata: {
          invoiceId: selectedInvoiceForPayment.id,
          invoiceNumber: selectedInvoiceForPayment.invoiceNumber,
          notes: paymentNotes,
        },
      });

      await payInvoice(selectedInvoiceForPayment.id, cashPaymentMethod);

      toast.success(
        `Recorded ${money(selectedInvoiceForPayment.amount)} offline payment (${cashPaymentMethod}) by ${collector}. Ref: ${cashRecord.receiptNumber}`,
      );
      setCashPaymentModalOpen(false);
      setSelectedInvoiceForPayment(null);
    } catch (err) {
      console.error("Failed to record cash payment:", err);
      toast.error("Failed to record cash payment. Please try again.");
    } finally {
      setIsRecordingPayment(false);
    }
  };

  // Ledger state
  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [account, setAccount] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<LedgerEntry | null>(null);
  const [form, setForm] = useState<Omit<LedgerEntry, "id">>(blank);
  const [page, setPage] = useState(1);
  const [receiptUploading, setReceiptUploading] = useState(false);
  const [receiptUploadStatus, setReceiptUploadStatus] = useState("");
  const [deletingLedgerEntry, setDeletingLedgerEntry] = useState<LedgerEntry | null>(null);
  const pageSize = 20;

  const canEditLedgerEntry = (l: LedgerEntry) =>
    canWriteAccounting ||
    Boolean(
      isBranchScoped &&
      userBranch &&
      l.branch?.toLowerCase() === userBranch.toLowerCase() &&
      l.status === "Pending",
    );

  const canDeleteLedgerEntry = (l: LedgerEntry) =>
    canDeleteAccounting ||
    Boolean(
      isBranchScoped &&
      userBranch &&
      l.branch?.toLowerCase() === userBranch.toLowerCase() &&
      l.status === "Pending",
    );

  async function confirmDeleteLedgerEntry() {
    if (!deletingLedgerEntry) return;
    if (!canDeleteLedgerEntry(deletingLedgerEntry)) return;
    const entry = deletingLedgerEntry;
    setDeletingLedgerEntry(null);

    await deleteLedgerTransaction(entry.id);
    toast.success("Transaction undone and linked balances reconciled.");
  }

  // Report state
  const [reportBranch, setReportBranch] = useState(isBranchScoped ? userBranch : "");
  const [reportMonth, setReportMonth] = useState("");

  useEffect(() => {
    if (isBranchScoped && userBranch) {
      setPayrollBranch(userBranch);
      setInvoiceBranchFilter(userBranch);
      setReportBranch(userBranch);
      setTargetBranch(userBranch);
    }
  }, [isBranchScoped, userBranch]);

  useEffect(() => {
    setPage(1);
  }, [q, type, account]);

  useEffect(() => {
    setInvoicePage(1);
  }, [invoiceQuery, invoiceStatusFilter, invoiceMonthFilter, invoiceBranchFilter]);

  // Base Data from granular slices
  const baseLedger = useMemo(
    () =>
      rawLedger.filter((l) =>
        isBranchScoped ? l.branch?.toLowerCase() === userBranch.toLowerCase() : true,
      ),
    [rawLedger, isBranchScoped, userBranch],
  );

  const accounts = useMemo(() => {
    const expenseAccounts = db.lists?.["Expense accounts"] || [];
    const customCategories = db.lists?.["Accounting categories"] || [];
    const ledgerAccounts = baseLedger
      .map((l) => l.account || l.category)
      .filter((a): a is string => Boolean(a && a.trim()));
    return Array.from(
      new Set([...DEFAULT_ACCOUNTS, ...expenseAccounts, ...customCategories, ...ledgerAccounts]),
    );
  }, [db.lists, baseLedger]);

  const realizedLedger = useMemo(
    () =>
      baseLedger.filter(
        (l) =>
          (l.status === "Collected" || l.status === "Paid") &&
          (l.status as string) !== "Pending" &&
          (l.status as string) !== "Voided",
      ),
    [baseLedger],
  );

  const players = useMemo(
    () =>
      rawPlayers.filter((p) =>
        isBranchScoped ? p.branch?.toLowerCase() === userBranch.toLowerCase() : true,
      ),
    [rawPlayers, isBranchScoped, userBranch],
  );

  // Invoices Tab Base Data
  const baseInvoices = useMemo(() => {
    return (rawInvoices || []).filter((inv) =>
      isBranchScoped ? inv.playerBranch?.toLowerCase() === userBranch.toLowerCase() : true,
    );
  }, [rawInvoices, isBranchScoped, userBranch]);

  const filteredInvoices = useMemo(() => {
    return baseInvoices
      .filter((inv) => {
        const matchesQ =
          !invoiceQuery.trim() ||
          [inv.invoiceNumber, inv.playerName, inv.team, inv.programTier]
            .join(" ")
            .toLowerCase()
            .includes(invoiceQuery.toLowerCase());
        const matchesStatus = !invoiceStatusFilter || inv.status === invoiceStatusFilter;
        const matchesMonth =
          !invoiceMonthFilter ||
          inv.billingMonth === invoiceMonthFilter ||
          inv.month === invoiceMonthFilter;
        const matchesBranch = !invoiceBranchFilter || inv.playerBranch === invoiceBranchFilter;
        return matchesQ && matchesStatus && matchesMonth && matchesBranch;
      })
      .sort((a, b) => b.issuedDate.localeCompare(a.issuedDate) || b.id.localeCompare(a.id));
  }, [baseInvoices, invoiceQuery, invoiceStatusFilter, invoiceMonthFilter, invoiceBranchFilter]);

  const pagedInvoices = useMemo(() => {
    return filteredInvoices.slice(
      (invoicePage - 1) * invoicePageSize,
      invoicePage * invoicePageSize,
    );
  }, [filteredInvoices, invoicePage]);

  const invoiceStats = useMemo(() => {
    const totalAmount = baseInvoices.reduce((sum, inv) => sum + inv.amount, 0);
    const collectedAmount = baseInvoices
      .filter((inv) => inv.status === "paid")
      .reduce((sum, inv) => sum + (inv.paidAmount || inv.amount), 0);
    const pendingAmount = baseInvoices
      .filter((inv) => inv.status === "pending" || inv.status === "overdue")
      .reduce((sum, inv) => sum + inv.amount, 0);
    const paidCount = baseInvoices.filter((inv) => inv.status === "paid").length;
    const pendingCount = baseInvoices.filter(
      (inv) => inv.status === "pending" || inv.status === "overdue",
    ).length;
    const collectionRate = totalAmount > 0 ? Math.round((collectedAmount / totalAmount) * 100) : 0;
    return {
      totalAmount,
      collectedAmount,
      pendingAmount,
      paidCount,
      pendingCount,
      collectionRate,
    };
  }, [baseInvoices]);

  // ---- DASHBOARD CHARTS DATA (Realized Only: Collected / Paid, excluding Pending & Voided) ----
  const monthlyData = useMemo(() => {
    const months: Record<string, { name: string; Revenue: number; Expense: number }> = {};
    realizedLedger.forEach((l) => {
      const m = l.date.slice(0, 7); // YYYY-MM
      if (!months[m]) months[m] = { name: m, Revenue: 0, Expense: 0 };
      const isRev = l.type === "Revenue" || (l.type as string) === "credit";
      const isExp = l.type === "Expense" || (l.type as string) === "debit";
      if (isRev) months[m].Revenue += Math.abs(l.amount);
      if (isExp) months[m].Expense += Math.abs(l.amount);
    });
    return Object.values(months).sort((a, b) => a.name.localeCompare(b.name));
  }, [realizedLedger]);

  const revenueByCategory = useMemo(() => {
    const cats: Record<string, number> = {};
    realizedLedger
      .filter((l) => l.type === "Revenue" || (l.type as string) === "credit")
      .forEach((l) => {
        let accName = l.account || l.category || "General Revenue";
        if (accName === "Merchandise") accName = "Merchandise Revenue";
        cats[accName] = (cats[accName] || 0) + Math.abs(l.amount);
      });
    return Object.entries(cats)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [realizedLedger]);

  const expensesByCategory = useMemo(() => {
    const cats: Record<string, number> = {};
    realizedLedger
      .filter((l) => l.type === "Expense" || (l.type as string) === "debit")
      .forEach((l) => {
        const accName = l.account || l.category || "General Expense";
        cats[accName] = (cats[accName] || 0) + Math.abs(l.amount);
      });
    return Object.entries(cats)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [realizedLedger]);

  const branchData = useMemo(() => {
    const branches: Record<string, { name: string; Net: number }> = {};
    realizedLedger.forEach((l) => {
      const b = l.branch || "Headquarters";
      if (!branches[b]) branches[b] = { name: b, Net: 0 };
      const isRev = l.type === "Revenue" || (l.type as string) === "credit";
      const isExp = l.type === "Expense" || (l.type as string) === "debit";
      if (isRev) branches[b].Net += Math.abs(l.amount);
      if (isExp) branches[b].Net -= Math.abs(l.amount);
    });
    return Object.values(branches).sort((a, b) => b.Net - a.Net);
  }, [realizedLedger]);

  // ---- COACH PAYROLL CALCULATIONS ----
  const payrollComputation = useMemo(() => {
    const monthIdx = MONTH_OPTIONS.findIndex((m) => m.toLowerCase() === payrollMonth.toLowerCase());
    return calculateAttendanceVerifiedPayroll(db, {
      monthName: payrollMonth,
      monthIndex: monthIdx !== -1 ? monthIdx : new Date().getMonth(),
      year: payrollYear,
      branchFilter: isBranchScoped ? userBranch : payrollBranch,
    });
  }, [db, payrollMonth, payrollYear, payrollBranch, isBranchScoped, userBranch]);

  const filteredPayrollRows = useMemo(() => {
    if (!payrollQuery.trim()) return payrollComputation.rows;
    const q = payrollQuery.toLowerCase();
    return payrollComputation.rows.filter(
      (r) =>
        r.coachName.toLowerCase().includes(q) ||
        r.branch.toLowerCase().includes(q) ||
        r.level.toLowerCase().includes(q) ||
        r.phone.toLowerCase().includes(q) ||
        r.email.toLowerCase().includes(q),
    );
  }, [payrollComputation.rows, payrollQuery]);

  if (authLoading && !currentUser && !user && !passwordUser) {
    return (
      <AppShell crumb="CONTROL / ACCOUNTING" title="Accounting">
        <div className="flex h-64 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-court-500 border-t-transparent" />
          <span className="ml-3 font-mono text-xs text-ink-400">Loading financial records…</span>
        </div>
      </AppShell>
    );
  }

  if (!hasFeature) {
    return (
      <AppShell crumb="CONTROL / ACCOUNTING" title="Accounting">
        <div className="py-10 text-center font-mono text-[11px] text-ink-400">
          This feature is not included in your current plan.
        </div>
      </AppShell>
    );
  }

  if (!hasAccess) {
    return (
      <AppShell crumb="CONTROL / ACCOUNTING" title="Accounting">
        <div className="mx-auto max-w-xl py-16 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-warn/10 text-warn border border-warn/20">
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h2 className="font-display text-xl font-bold tracking-tight text-ink-100">
            Access Restricted
          </h2>
          <p className="mt-2 text-sm text-ink-300">
            You do not have permission to view financial records.
          </p>
        </div>
      </AppShell>
    );
  }

  // Stats (Realized Only: Collected / Paid, excluding Pending & Voided)
  const revenue = realizedLedger
    .filter((l) => l.type === "Revenue" || (l.type as string) === "credit")
    .reduce((acc, l) => acc + Math.abs(l.amount), 0);
  const expense = realizedLedger
    .filter((l) => l.type === "Expense" || (l.type as string) === "debit")
    .reduce((acc, l) => acc + Math.abs(l.amount), 0);
  const outstandingPlayers = players.reduce((acc, p) => acc + Math.max(0, p.balance || 0), 0);

  // ---- LEDGER TAB ----
  const filteredLedger = baseLedger
    .filter(
      (l) =>
        (!q.trim() || [l.entry, l.account].join(" ").toLowerCase().includes(q.toLowerCase())) &&
        (!type || l.type === type) &&
        (!account || l.account === account),
    )
    .sort((a, b) => b.date.localeCompare(a.date));

  const pagedLedger = filteredLedger.slice((page - 1) * pageSize, page * pageSize);

  const exportCsv = () => {
    downloadCsv(
      "ledger.csv",
      ["Date", "Type", "Account", "Entry", `Amount (${currency})`, "Status", "Branch"],
      filteredLedger.map((l) => [
        l.date,
        l.type,
        l.account,
        l.entry || l.description || "",
        String(
          currency === "LBP" ? Math.round(Math.abs(l.amount) * exchangeRate) : Math.abs(l.amount),
        ),
        l.status,
        l.branch || "",
      ]),
    );
  };

  const exportPdfReport = () => {
    exportPdf(
      "Ledger Report",
      ["Date", "Type", "Account", "Entry", "Amount"],
      filteredLedger.map((l) => [
        l.date,
        l.type,
        l.account,
        l.entry || l.description || "",
        money(Math.abs(l.amount)),
      ]),
    );
  };

  const submit = async (e?: React.FormEvent) => {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    if (editing ? !canEditLedgerEntry(editing) : !canWriteAccounting) return;
    if (!form.entry || !form.amount) return;
    const finalAmount = Math.abs(form.amount);
    const finalBranch = isBranchScoped ? userBranch : form.branch;
    if (editing) {
      const normalizedUpdate = normalizeDoubleEntryLedger({
        ...editing,
        ...form,
        branch: finalBranch,
        amount: finalAmount,
      });
      await editLedgerTransaction(editing.id, normalizedUpdate);
      toast.success("Transaction updated and linked balances reconciled.");
    } else {
      const entryData: LedgerEntry = normalizeDoubleEntryLedger({
        ...form,
        branch: finalBranch,
        id: `l-${Date.now()}`,
        amount: finalAmount,
      });
      await setEntity("ledger", entryData);
      toast.success("Ledger entry added.");
    }
    setOpen(false);
  };

  // ---- REPORTS TAB ----
  const reportLedger = realizedLedger.filter(
    (l) =>
      (!reportBranch || l.branch === reportBranch) &&
      (!reportMonth || l.date.startsWith(reportMonth)),
  );

  const reportRevenue = reportLedger
    .filter((l) => l.type === "Revenue" || (l.type as string) === "credit")
    .reduce((a, l) => a + Math.abs(l.amount), 0);
  const reportExpense = reportLedger
    .filter((l) => l.type === "Expense" || (l.type as string) === "debit")
    .reduce((a, l) => a + Math.abs(l.amount), 0);

  const reportPlayers = players
    .filter((p) => !reportBranch || p.branch === reportBranch)
    .filter((p) => !p.isScholarship && (p.balance || 0) > 0);

  // Get unique months for filter
  const allMonths = Array.from(new Set(baseLedger.map((l) => l.date.slice(0, 7))))
    .sort((a, b) => a.localeCompare(b))
    .reverse();

  // ---- COACH PAYROLL ACTIONS (FIN-02) ----
  const handlePostSinglePayout = async (
    coachRow: CoachPayrollRow,
    paymentMethod = "Bank Transfer",
    note = "",
    customAmountOverride?: number,
    advanceReasonOverride?: string,
    linkedSessionsOverride?: number,
  ) => {
    const unpaidVerified = Math.max(0, coachRow.netBalance);
    const finalPayoutAmount =
      typeof customAmountOverride === "number" && customAmountOverride > 0
        ? customAmountOverride
        : coachRow.totalPayout;

    if (finalPayoutAmount <= 0) {
      toast.error("Please enter a valid disbursement amount greater than 0.");
      return;
    }

    const isAdvancePayout =
      finalPayoutAmount > unpaidVerified || coachRow.verifiedCompletedSessionsCount === 0;
    const trimmedAdvanceReason = (advanceReasonOverride ?? disburseAdvanceReason).trim();

    if (isAdvancePayout && !trimmedAdvanceReason) {
      toast.error(
        "Advance / Custom Payment Warning: Please enter a mandatory reason before disbursing an advance or unverified payout.",
      );
      return;
    }

    const detReferenceId = isAdvancePayout
      ? `payroll-adv-${payrollMonth}-${coachRow.coachId}-${Date.now().toString(36)}`
      : `payroll-${payrollMonth}-${coachRow.coachId}`;
    const detReferenceIdLower = `payroll-${payrollMonth.toLowerCase()}-${coachRow.coachId}`;

    if (!isAdvancePayout) {
      const alreadyExists = db.ledger.some(
        (l) =>
          l.referenceId === detReferenceId ||
          l.referenceId === detReferenceIdLower ||
          l.id ===
            `payroll-${coachRow.coachId}-${payrollComputation.year}-${payrollComputation.monthCode}`,
      );
      if (alreadyExists) {
        toast.info(
          `Standard payroll for ${coachRow.coachName} is already recorded in the ledger for ${payrollComputation.periodLabel}.`,
        );
        setDisburseModalCoach(null);
        setIsDisbursing(false);
        return;
      }
    }

    setIsDisbursing(true);
    try {
      const linkedSessionsVal =
        typeof linkedSessionsOverride === "number" && linkedSessionsOverride > 0
          ? linkedSessionsOverride
          : disburseLinkedSessionsCount > 0
            ? disburseLinkedSessionsCount
            : undefined;

      const rawDebitEntry = createCoachPayrollDebitEntry({
        coach: coachRow,
        periodLabel: payrollComputation.periodLabel,
        year: payrollComputation.year,
        monthCode: payrollComputation.monthCode,
        paymentMethod,
        note: note.trim() || undefined,
        referenceId: detReferenceId,
        payrollMonth,
        customAmount: finalPayoutAmount,
        isAdvance: isAdvancePayout,
        advanceReason: isAdvancePayout ? trimmedAdvanceReason : undefined,
        linkedAdvanceSessionsCount: linkedSessionsVal,
      });
      const debitEntry: LedgerEntry = normalizeDoubleEntryLedger({
        ...rawDebitEntry,
        id: isAdvancePayout
          ? `${rawDebitEntry.id}-adv-${Date.now().toString(36)}`
          : rawDebitEntry.id,
        type: "Expense",
        amount: Math.abs(rawDebitEntry.amount),
        referenceId: detReferenceId,
        module: "academy",
      });

      const matchedCoachObj = db.coaches.find((c) => c.id === coachRow.coachId);
      const currentCoachOutstanding =
        typeof matchedCoachObj?.outstanding === "number"
          ? matchedCoachObj.outstanding
          : coachRow.outstanding || 0;
      const nextOutstanding = currentCoachOutstanding - finalPayoutAmount;

      // Persist to database and reactive store (allowing negative outstanding for Advance / Credit Balance)
      try {
        await setEntity("ledger", debitEntry);
        await patchEntity("coaches", coachRow.coachId, {
          outstanding: nextOutstanding,
        });
      } catch (saveErr) {
        console.warn("Could not sync payroll to cloud persistence:", saveErr);
      }

      const unitsDescription = isAdvancePayout
        ? `Custom / Advance Payment (On Account)${trimmedAdvanceReason ? ` · Reason: ${trimmedAdvanceReason}` : ""}`
        : coachRow.rateType === "hourly"
          ? `${coachRow.verifiedCompletedHours} verified hrs @ ${money(coachRow.rate)}/hr`
          : `${coachRow.verifiedCompletedSessionsCount} verified sessions @ ${money(coachRow.rate)}/session`;

      void createAcademyNotification(tenantId, {
        title: isAdvancePayout
          ? `Coach Advance Disbursed: ${coachRow.coachName} (${money(finalPayoutAmount)})`
          : `Payroll Disbursed: ${coachRow.coachName} (${payrollComputation.periodLabel})`,
        message: isAdvancePayout
          ? `Custom / Advance Payment (On Account) of ${money(finalPayoutAmount)} disbursed to ${coachRow.coachName} (${matchedCoachObj?.branch || coachRow.branch || "HQ"}). Unpaid verified sessions: ${money(unpaidVerified)}. Reason: ${trimmedAdvanceReason}`
          : `Your coach payout of ${money(finalPayoutAmount)} (${unitsDescription}) has been disbursed via ${paymentMethod}.`,
        type: "billing",
        targetRoles: isAdvancePayout
          ? ["super_admin", "accountant", "branch_manager", "coach"]
          : ["coach", "branch_manager"],
        targetCoachId: coachRow.coachId,
        targetCoachName: coachRow.coachName,
        targetBranchId: matchedCoachObj?.branch || coachRow.branch || undefined,
        actionUrl: "/accounting",
        createdAt: new Date().toISOString(),
        readBy: [],
        dismissedBy: [],
      }).catch(() => {});

      toast.success(
        isAdvancePayout
          ? `Recorded Advance / On-Account payment of ${money(finalPayoutAmount)} to ${coachRow.coachName}.`
          : `Disbursed ${money(finalPayoutAmount)} to ${coachRow.coachName} (${unitsDescription}). Debit entry recorded under 'Coach Payroll Expense'.`,
      );
      setDisburseModalCoach(null);
      setDisburseNote("");
      setDisburseAdvanceReason("");
      setDisburseLinkedSessionsCount(0);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to disburse payroll";
      toast.error(msg);
    } finally {
      setIsDisbursing(false);
    }
  };

  const handleDisbursePayroll = handlePostSinglePayout;

  const handlePostPayroll = async (e?: React.FormEvent) => {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    // FIN-02: Automatically filter out any coach or staff who already has a ledger entry with deterministic referenceId for payrollMonth
    const eligibleRows = filteredPayrollRows.filter((r) => {
      if (r.isDisbursed || r.totalPayout <= 0 || r.verifiedCompletedSessionsCount <= 0) {
        return false;
      }
      const refId = `payroll-${payrollMonth}-${r.coachId}`;
      const refIdLower = `payroll-${payrollMonth.toLowerCase()}-${r.coachId}`;
      const refIdMonthCode = `payroll-${payrollComputation.monthCode}-${r.coachId}`;
      const entryId = `payroll-${r.coachId}-${payrollComputation.year}-${payrollComputation.monthCode}`;
      const hasExistingLedger = db.ledger.some(
        (l) =>
          l.referenceId === refId ||
          l.referenceId === refIdLower ||
          l.referenceId === refIdMonthCode ||
          l.id === entryId ||
          (l.referenceId?.startsWith("payroll-") && l.referenceId?.endsWith(`-${r.coachId}`)),
      );
      return !hasExistingLedger;
    });

    if (eligibleRows.length === 0) {
      toast.info(
        `No undisbursed verified coach sessions to process for ${payrollComputation.periodLabel}.`,
      );
      setBatchDisburseOpen(false);
      return;
    }

    const newEntries = eligibleRows.map((r) => {
      const detReferenceId = `payroll-${payrollMonth}-${r.coachId}`;
      const raw = createCoachPayrollDebitEntry({
        coach: r,
        periodLabel: payrollComputation.periodLabel,
        year: payrollComputation.year,
        monthCode: payrollComputation.monthCode,
        paymentMethod: "Batch Payroll Transfer",
        referenceId: detReferenceId,
        payrollMonth,
      });
      return normalizeDoubleEntryLedger({
        ...raw,
        type: "Expense" as const,
        amount: Math.abs(raw.amount),
        referenceId: detReferenceId,
        module: "academy",
      });
    });

    const existingRefIds = new Set(db.ledger.map((l) => l.referenceId).filter(Boolean));
    const existingIds = new Set(db.ledger.map((l) => l.id));
    const finalEntries = newEntries.filter(
      (e) => !existingIds.has(e.id) && (!e.referenceId || !existingRefIds.has(e.referenceId)),
    );

    if (finalEntries.length === 0) {
      toast.info("All eligible payroll entries are already logged in the accounting ledger.");
      setBatchDisburseOpen(false);
      return;
    }

    const totalBatchSum = finalEntries.reduce((sum, e) => sum + Math.abs(e.amount), 0);

    setIsDisbursing(true);
    try {
      for (const entry of finalEntries) {
        try {
          await setEntity("ledger", entry);
        } catch (saveErr) {
          console.warn("Could not sync payroll batch entry to cloud persistence:", saveErr);
        }
      }
      for (const row of eligibleRows) {
        try {
          await patchEntity("coaches", row.coachId, {
            outstanding: Math.max(0, (row.outstanding || 0) - row.totalPayout),
          });
        } catch (saveErr) {
          console.warn("Could not sync coach balance:", saveErr);
        }
        const matchedCoachObj = db.coaches.find((c) => c.id === row.coachId);
        void createAcademyNotification(tenantId, {
          title: `Payroll Disbursed: ${row.coachName} (${payrollComputation.periodLabel})`,
          message: `Your coach payout of ${money(row.totalPayout)} for ${payrollComputation.periodLabel} has been disbursed.`,
          type: "billing",
          targetRoles: ["coach", "branch_manager"],
          targetCoachId: row.coachId,
          targetCoachName: row.coachName,
          targetBranchId: matchedCoachObj?.branch || row.branch || undefined,
          actionUrl: "/coach",
          createdAt: new Date().toISOString(),
          readBy: [],
          dismissedBy: [],
        }).catch(() => {});
      }

      toast.success(
        `Disbursed ${money(totalBatchSum)} across ${finalEntries.length} coaches for ${payrollComputation.periodLabel}. Debit entries created under 'Coach Payroll Expense'.`,
      );
      setBatchDisburseOpen(false);
    } catch (err) {
      console.error("Batch disburse error:", err);
      toast.error("Failed to disburse batch payroll.");
    } finally {
      setIsDisbursing(false);
    }
  };

  const handleBatchDisbursePayroll = handlePostPayroll;

  const exportPayrollCsv = () => {
    downloadCsv(
      `coach-payroll-${payrollComputation.year}-${payrollComputation.monthCode}.csv`,
      [
        "Coach Name",
        "Level",
        "Branch",
        `Rate (${currency}/Session)`,
        "Verified Completed Sessions",
        `Total Payout (${currency})`,
        "Status",
        "Disbursed Date",
        "Ledger Reference",
      ],
      filteredPayrollRows.map((r) => [
        r.coachName,
        r.level,
        r.branch,
        String(currency === "LBP" ? Math.round(r.rate * exchangeRate) : r.rate),
        String(r.verifiedCompletedSessionsCount),
        String(currency === "LBP" ? Math.round(r.totalPayout * exchangeRate) : r.totalPayout),
        r.isDisbursed ? "Disbursed" : "Pending",
        r.disbursedDate || "—",
        r.ledgerEntryId || "—",
      ]),
    );
  };

  const exportPayrollPdfReport = () => {
    exportPdf({
      title: `COACH PAYROLL BREAKDOWN — ${payrollComputation.periodLabel.toUpperCase()}`,
      subtitle: `Attendance-verified session calculations for ${payrollComputation.totalActiveCoaches} active coaches.`,
      headers: [
        "Coach Name",
        "Branch",
        "Level",
        "Rate",
        "Verified Sessions",
        "Total Payout",
        "Status",
      ],
      rows: filteredPayrollRows.map((r) => [
        r.coachName,
        r.branch,
        r.level,
        money(r.rate),
        `${r.verifiedCompletedSessionsCount} sessions`,
        money(r.totalPayout),
        r.isDisbursed ? "PAID" : "PENDING",
      ]),
      summary: [
        { label: "Pay Period", value: payrollComputation.periodLabel },
        {
          label: "Total Verified Sessions",
          value: `${payrollComputation.totalVerifiedSessions} sessions`,
        },
        { label: "Total Period Payout", value: money(payrollComputation.totalProjectedPayout) },
        { label: "Total Disbursed", value: money(payrollComputation.totalDisbursedPayout) },
        { label: "Total Pending", value: money(payrollComputation.totalPendingPayout) },
      ],
      filename: `coach-payroll-${payrollComputation.year}-${payrollComputation.monthCode}.pdf`,
    });
  };

  return (
    <AppShell
      crumb="CONTROL / ACCOUNTING"
      title="Accounting"
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            size="md"
            onClick={() => setInvoicingModalOpen(true)}
            className="shrink-0 font-semibold"
          >
            <span className="text-amber-400">⚡</span> Run Monthly Invoicing
          </Button>
        </div>
      }
    >
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-ink-800 pb-2">
        <div className="flex flex-wrap gap-2 overflow-x-auto no-scrollbar">
          {(
            [
              { id: "dashboard", label: "Dashboard" },
              { id: "invoices", label: "Invoices & Tuition" },
              { id: "payroll", label: "Coach Payroll" },
              { id: "reports", label: "Reports & P&L" },
              { id: "ledger", label: "Ledger" },
            ] as const
          ).map((t) => (
            <button
              type="button"
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === t.id
                  ? "border-b-2 border-court-400 text-ink-100"
                  : "text-ink-400 hover:text-ink-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-lg bg-ink-900 border border-ink-750 p-1">
            <button
              type="button"
              onClick={() => setCurrency(primaryCurrency)}
              className={`px-3 py-1 text-xs font-mono font-medium rounded transition-colors ${
                currency === primaryCurrency
                  ? "bg-court-500 text-ink-950 font-bold shadow"
                  : "text-ink-400 hover:text-ink-200"
              }`}
            >
              {primaryCurrency}
            </button>
            {primaryCurrency !== "LBP" && (
              <button
                type="button"
                onClick={() => setCurrency("LBP")}
                className={`px-3 py-1 text-xs font-mono font-medium rounded transition-colors ${
                  currency === "LBP"
                    ? "bg-court-500 text-ink-950 font-bold shadow"
                    : "text-ink-400 hover:text-ink-200"
                }`}
              >
                LBP (L.L.)
              </button>
            )}
          </div>
          {currency === "LBP" && primaryCurrency !== "LBP" && (
            <div className="flex items-center gap-1 font-mono text-[11px] text-ink-400 bg-ink-850 px-2 py-1 rounded border border-ink-750">
              <span>Rate:</span>
              <span className="text-court-300 font-semibold">
                {exchangeRate.toLocaleString()} L.L. / {primaryCurrency}
              </span>
            </div>
          )}
        </div>
      </div>

      {activeTab === "dashboard" && (
        <div className="space-y-6 flex flex-col min-h-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5 sm:gap-4">
            <Stat
              label="Total Revenue"
              value={money(revenue)}
              note="all time recorded income"
              accent
            />
            <Stat label="Total Expenses" value={money(expense)} note="all time recorded costs" />
            <Stat label="Net Income" value={money(revenue - expense)} accent />
            <Stat
              label="Outstanding Balances"
              value={money(outstandingPlayers)}
              note={`from ${players.filter((p) => p.balance > 0).length} players`}
            />
          </div>

          {/* Point 5D: Multi-Company Player Insurance Summary */}
          {(() => {
            const insuredPlayers = players.filter(
              (p) => p.isInsured || p.insuranceStatus === "Academy insured",
            );
            const unpaidInsuredCount = insuredPlayers.filter(
              (p) => !p.insurancePaid && (p.insuranceFee || 0) > 0,
            ).length;
            const unpaidInsuranceSum = insuredPlayers
              .filter((p) => !p.insurancePaid && (p.insuranceFee || 0) > 0)
              .reduce((sum, p) => sum + Number(p.insuranceFee || 0), 0);

            const insuranceLedgerEntries = realizedLedger.filter(
              (l) =>
                (l.type === "Revenue" || (l.type as string) === "credit") &&
                (l.account === "Player Insurance" ||
                  l.account === "Insurance" ||
                  l.category === "Insurance" ||
                  l.id.startsWith("l-ins-")),
            );
            const totalInsuranceCollected = insuranceLedgerEntries.reduce(
              (sum, l) => sum + Math.abs(l.amount || 0),
              0,
            );

            const byCompany: Record<string, { count: number; collected: number }> = {};
            for (const p of insuredPlayers) {
              const cName = p.insuranceCompanyName || "Academy Insurance";
              if (!byCompany[cName]) byCompany[cName] = { count: 0, collected: 0 };
              byCompany[cName].count += 1;
            }
            for (const entry of insuranceLedgerEntries) {
              let cName = entry.insuranceCompanyName || "";
              if (!cName) {
                const parts = (entry.entry || "").split("·").map((s) => s.trim());
                cName = parts.length >= 3 ? parts[2] : "Academy Insurance";
              }
              if (!byCompany[cName]) byCompany[cName] = { count: 0, collected: 0 };
              byCompany[cName].collected += Math.abs(entry.amount || 0);
            }

            return (
              <div className="rounded-xl border border-court-500/25 bg-ink-900/70 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-mono font-bold uppercase tracking-wider text-court-300 flex items-center gap-2">
                      <span>🛡️ Player Insurance Summary &amp; Provider Breakdown</span>
                    </div>
                    <div className="text-xs text-ink-400 mt-0.5">
                      Audited insurance collections synced with Player Profiles &amp; Accounting
                      Ledger
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-court-500/15 px-3 py-1 font-mono text-xs font-bold text-court-300 ring-1 ring-court-500/30">
                      Insured Players: {insuredPlayers.length}
                    </span>
                    <span className="rounded-full bg-emerald-500/15 px-3 py-1 font-mono text-xs font-bold text-emerald-300 ring-1 ring-emerald-500/30">
                      Collected: {money(totalInsuranceCollected)}
                    </span>
                    {unpaidInsuredCount > 0 && (
                      <span className="rounded-full bg-amber-500/15 px-3 py-1 font-mono text-xs font-bold text-amber-300 ring-1 ring-amber-500/30">
                        Unpaid Policies: {unpaidInsuredCount} ({money(unpaidInsuranceSum)})
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setAccount("Player Insurance");
                        setActiveTab("ledger");
                      }}
                      className="rounded-md bg-ink-850 hover:bg-ink-800 px-2.5 py-1 font-mono text-[11px] font-semibold text-court-400 ring-1 ring-ink-750 transition-colors"
                    >
                      View Insurance Ledger ↗
                    </button>
                  </div>
                </div>

                {Object.keys(byCompany).length > 0 && (
                  <div className="grid gap-2.5 sm:grid-cols-3 pt-2 border-t border-ink-850">
                    {Object.entries(byCompany).map(([compName, stats]) => (
                      <div
                        key={compName}
                        className="rounded-lg border border-ink-800 bg-ink-950/60 px-3 py-2 flex items-center justify-between font-mono text-xs"
                      >
                        <div>
                          <div className="font-semibold text-ink-100">{compName}</div>
                          <div className="text-[10px] text-ink-400">
                            {stats.count} insured athlete{stats.count === 1 ? "" : "s"}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold text-emerald-400">{money(stats.collected)}</div>
                          <div className="text-[10px] text-ink-500">collected</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}

          {/* Level D: Overall Academy Court Rental & Multi-Level Operating Cost Summary */}
          {(() => {
            const scopedBranches = isBranchScoped
              ? (db.branches || []).filter(
                  (b) => b.name.toLowerCase() === (userBranch || "").toLowerCase(),
                )
              : db.branches || [];
            const branchUtilRows = calculateBranchCourtUtilizationAnalytics(
              scopedBranches,
              db.sessions || [],
              baseLedger,
              db.teams || [],
              db.coaches || [],
            );
            const totalFull = branchUtilRows.reduce((s, r) => s + r.fullCourtSessions, 0);
            const totalHca = branchUtilRows.reduce((s, r) => s + r.hcaSessions, 0);
            const totalHcb = branchUtilRows.reduce((s, r) => s + r.hcbSessions, 0);
            const totalHours = branchUtilRows.reduce((s, r) => s + r.totalHours, 0);
            const totalSessionRent = branchUtilRows.reduce(
              (s, r) => s + r.sessionCourtRentalCost,
              0,
            );
            const totalFixedFacility = branchUtilRows.reduce(
              (s, r) => s + r.fixedFacilityOverhead,
              0,
            );

            return (
              <div className="rounded-xl border border-court-500/25 bg-ink-900/90 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-2 w-2 rounded-full bg-court-400" />
                      <h4 className="font-mono text-xs font-bold uppercase tracking-wider text-court-300">
                        Academy Court Rental &amp; Subdivision Impact (Full Court vs. HCA / HCB)
                      </h4>
                    </div>
                    <p className="text-xs text-ink-400 mt-0.5">
                      Real-time propagation of Full Court (`fullCourtHourlyRate`) and Half-Court
                      (`halfCourtHourlyRate`) session costs across {scopedBranches.length} branch
                      {scopedBranches.length === 1 ? "" : "es"}.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab("reports")}
                    className="rounded-md bg-ink-850 hover:bg-ink-800 px-2.5 py-1 font-mono text-[11px] font-semibold text-court-400 ring-1 ring-ink-750 transition-colors"
                  >
                    Open Team &amp; Branch Cost Reports ↗
                  </button>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 font-mono text-xs">
                  <div className="rounded-lg bg-ink-950/70 p-2.5 ring-1 ring-ink-800">
                    <span className="text-[10px] text-ink-400 uppercase block">
                      Full Court Sessions
                    </span>
                    <span className="text-base font-bold text-ink-100">{totalFull}</span>
                  </div>
                  <div className="rounded-lg bg-ink-950/70 p-2.5 ring-1 ring-ink-800">
                    <span className="text-[10px] text-court-400 uppercase block">
                      Half Court — HCA
                    </span>
                    <span className="text-base font-bold text-court-300">{totalHca}</span>
                  </div>
                  <div className="rounded-lg bg-ink-950/70 p-2.5 ring-1 ring-ink-800">
                    <span className="text-[10px] text-court-400 uppercase block">
                      Half Court — HCB
                    </span>
                    <span className="text-base font-bold text-court-300">{totalHcb}</span>
                  </div>
                  <div className="rounded-lg bg-ink-950/70 p-2.5 ring-1 ring-ink-800">
                    <span className="text-[10px] text-ink-400 uppercase block">
                      Session Court Rental
                    </span>
                    <span className="text-base font-bold text-warn">{money(totalSessionRent)}</span>
                    <span className="text-[9px] text-ink-500 block">{totalHours} total hrs</span>
                  </div>
                  <div className="rounded-lg bg-ink-950/70 p-2.5 ring-1 ring-ink-800">
                    <span className="text-[10px] text-ink-400 uppercase block">
                      Total Facility Rent
                    </span>
                    <span className="text-base font-bold text-bad">
                      {money(totalSessionRent + totalFixedFacility)}
                    </span>
                    <span className="text-[9px] text-ink-500 block">
                      Incl. {money(totalFixedFacility)} fixed
                    </span>
                  </div>
                </div>
              </div>
            );
          })()}

          <Suspense
            fallback={
              <div className="flex h-64 items-center justify-center rounded-xl border border-ink-800 bg-ink-900/50">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-court-500 border-t-transparent" />
                <span className="ml-3 font-mono text-xs text-ink-400">
                  Loading analytics visuals…
                </span>
              </div>
            }
          >
            <AccountingCharts
              monthlyData={monthlyData}
              branchData={branchData}
              revenueByCategory={revenueByCategory}
              expensesByCategory={expensesByCategory}
              money={money}
              colors={COLORS}
            />
          </Suspense>
        </div>
      )}

      {activeTab === "invoices" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5 sm:gap-4">
            <Stat
              label="Total Invoiced"
              value={money(invoiceStats.totalAmount)}
              note={`${baseInvoices.length} total generated`}
            />
            <Stat
              label="Collected Tuition"
              value={money(invoiceStats.collectedAmount)}
              note={`${invoiceStats.paidCount} paid invoices`}
              accent
            />
            <Stat
              label="Pending Receivables"
              value={money(invoiceStats.pendingAmount)}
              note={`${invoiceStats.pendingCount} unpaid invoices`}
            />
            <Stat
              label="Collection Rate"
              value={`${invoiceStats.collectionRate}%`}
              note="of total monthly billings"
              accent
            />
          </div>

          {/* Server-Authoritative Billing Cron Console */}
          <div className="rounded-xl border border-court-500/20 bg-linear-to-r from-ink-900 via-ink-900/90 to-ink-950 p-4 sm:p-5 shadow-sm">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1.5 max-w-2xl">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono font-medium bg-court-500/10 text-court-400 border border-court-500/30">
                    <span className="h-1.5 w-1.5 rounded-full bg-court-400 animate-pulse" />
                    Cloud Function Active
                  </span>
                  <span className="font-mono text-xs text-ink-400 bg-ink-800/60 px-2 py-0.5 rounded border border-ink-750">
                    Cron: 0 0 1 * * (1st of month 00:00 UTC)
                  </span>
                  <span className="font-mono text-xs text-ink-400 bg-ink-800/60 px-2 py-0.5 rounded border border-ink-750">
                    Daily Audit: 0 2 * * * (02:00 UTC)
                  </span>
                </div>
                <h4 className="text-sm font-semibold text-ink-100 flex items-center gap-2">
                  Server-Authoritative Billing Cron &amp; Suspension Engine
                </h4>
                <p className="text-xs text-ink-300 leading-relaxed">
                  Monthly tuition generation and overdue suspension flags execute automatically on
                  scheduled Google Cloud Functions. Browser tab closures, client clock drift, and
                  multi-admin concurrent logins cannot double-run or delay invoices.
                </p>
                <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono text-ink-400 pt-1">
                  <span>
                    Soft Deadline:{" "}
                    <strong className="text-ink-200">{db.academy?.softDeadline ?? 15}d</strong>{" "}
                    (Soft flag)
                  </span>
                  <span>
                    Hard Deadline:{" "}
                    <strong className="text-ink-200">{db.academy?.hardDeadline ?? 30}d</strong>{" "}
                    (Suspension Lock)
                  </span>
                  <span>
                    Idempotency:{" "}
                    <strong className="text-court-400">Strict (playerId_year_month)</strong>
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <Button
                  variant="secondary"
                  onClick={handleRunSuspensionAudit}
                  disabled={isAuditingSuspensions}
                >
                  {isAuditingSuspensions ? "Auditing Deadlines..." : "🔒 Run Overdue Audit"}
                </Button>
                <Button variant="secondary" onClick={() => setFamilyModalOpen(true)}>
                  👨‍👩‍👧‍👦 Family Statements &amp; Sibling Discounts
                </Button>
                <Button variant="primary" onClick={() => setInvoicingModalOpen(true)}>
                  ⚡ Run Monthly Invoicing
                </Button>
                <Button variant="ghost" onClick={() => setCronHistoryModalOpen(true)}>
                  📋 Automation Specs
                </Button>
              </div>
            </div>
          </div>

          <Panel
            title="Monthly Tuition Invoices"
            meta="Automated player billing records · Offline / In-Person Payment Only"
            action={
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-ink-850 text-court-400 border border-ink-750 font-mono text-xs">
                  <span className="h-1.5 w-1.5 rounded-full bg-court-400 animate-pulse" />
                  Offline / In-Person Payment
                </div>
                <FilterSelect
                  label="Month"
                  value={invoiceMonthFilter}
                  onChange={setInvoiceMonthFilter}
                  options={["", ...MONTH_OPTIONS]}
                />
                <FilterSelect
                  label="Status"
                  value={invoiceStatusFilter}
                  onChange={setInvoiceStatusFilter}
                  options={["", "pending", "paid", "overdue"]}
                />
                {!isBranchScoped && (
                  <FilterSelect
                    label="Branch"
                    value={invoiceBranchFilter}
                    onChange={setInvoiceBranchFilter}
                    options={["", ...db.branches.map((b) => b.name)]}
                  />
                )}
                <Button
                  variant="ghost"
                  onClick={() => {
                    downloadCsv(
                      "tuition-invoices.csv",
                      [
                        "Invoice #",
                        "Player",
                        "Squad",
                        "Tier",
                        "Month",
                        "Year",
                        `Amount (${currency})`,
                        "Status",
                        "Due Date",
                        "Branch",
                      ],
                      filteredInvoices.map((i) => [
                        i.invoiceNumber,
                        i.playerName,
                        i.team || "",
                        i.programTier || "",
                        i.billingMonth,
                        String(i.year),
                        String(currency === "LBP" ? Math.round(i.amount * exchangeRate) : i.amount),
                        i.status,
                        i.dueDate,
                        i.playerBranch || "",
                      ]),
                    );
                  }}
                >
                  Export CSV
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    exportPdf(
                      "Monthly Tuition Invoices Summary",
                      ["Invoice #", "Player", "Squad", "Period", "Amount", "Status"],
                      filteredInvoices.map((i) => [
                        i.invoiceNumber,
                        i.playerName,
                        i.team || "Squad",
                        `${i.billingMonth} ${i.year}`,
                        money(i.amount),
                        i.status.toUpperCase(),
                      ]),
                    );
                  }}
                >
                  Export PDF
                </Button>
                <Button
                  variant="secondary"
                  onClick={handleRunSuspensionAudit}
                  disabled={isAuditingSuspensions}
                >
                  🔒 Audit Deadlines
                </Button>
                <Button variant="secondary" onClick={() => setFamilyModalOpen(true)}>
                  👨‍👩‍👧‍👦 Family Bundles
                </Button>
                <Button variant="primary" onClick={() => setInvoicingModalOpen(true)}>
                  ⚡ Run Invoicing
                </Button>
              </div>
            }
          >
            {/* Offline / In-Person Payment Notice Indicator */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-ink-950/70 border-b border-ink-850 text-xs font-mono">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-court-500/10 text-court-400 border border-court-500/20 font-semibold text-[11px]">
                  <span className="h-1.5 w-1.5 rounded-full bg-court-400" />
                  Offline / In-Person Payment
                </span>
                <span className="text-ink-400 inline">
                  Online gateways (Stripe/Tap) disabled · In-person cash, manual bank transfer, and
                  cheque collections
                </span>
              </div>
              <div className="text-ink-400 text-[11px]">
                Supported: Cash · Manual Bank Transfer · Cheque
              </div>
            </div>
            <div className="border-b border-ink-800 px-4 py-3">
              <Search
                value={invoiceQuery}
                onChange={setInvoiceQuery}
                placeholder="Search by player name, invoice #, or squad…"
              />
            </div>
            {/* Invoices Table */}
            <div className="overflow-x-auto w-full -mx-4 px-4 sm:mx-0 sm:px-0">
              <Table
                head={
                  <>
                    <Th>INVOICE #</Th>
                    <Th>PLAYER & SQUAD</Th>
                    <Th hide>TIER / PROGRAM</Th>
                    <Th hide>DUE DATE</Th>
                    <Th>
                      <span className="block text-right">AMOUNT</span>
                    </Th>
                    <Th hide>STATUS</Th>
                    <Th>
                      <span className="block text-right">ACTION</span>
                    </Th>
                  </>
                }
                footer={
                  <Pagination
                    page={invoicePage}
                    pageSize={invoicePageSize}
                    total={filteredInvoices.length}
                    setPage={setInvoicePage}
                  />
                }
              >
                {pagedInvoices.length === 0 ? (
                  <EmptyState>No invoices found matching these filters.</EmptyState>
                ) : (
                  pagedInvoices.map((inv) => (
                    <Row key={inv.id}>
                      <Td>
                        <div className="flex flex-col">
                          <span className="font-mono text-xs font-semibold text-ink-100">
                            {inv.invoiceNumber}
                          </span>
                          <span className="font-mono text-[10px] text-ink-400">
                            {inv.billingMonth} {inv.year}
                          </span>
                        </div>
                      </Td>
                      <Td strong>
                        <div className="flex flex-col">
                          <span className="text-ink-100">{inv.playerName}</span>
                          <span className="font-mono text-[10px] text-ink-400">
                            {inv.team || "Academy Squad"}
                            {inv.playerBranch ? ` · ${inv.playerBranch}` : ""}
                          </span>
                        </div>
                      </Td>
                      <Td hide>
                        <Chip>{inv.programTier || "Standard Program"}</Chip>
                      </Td>
                      <Td hide>
                        <span className="font-mono text-xs text-ink-300">{inv.dueDate}</span>
                      </Td>
                      <Td right>
                        <span className="font-mono text-xs font-bold text-court-400">
                          {money(inv.amount)}
                        </span>
                      </Td>
                      <Td hide>
                        <Chip
                          tone={
                            inv.status === "paid"
                              ? "good"
                              : inv.status === "pending"
                                ? "warn"
                                : "bad"
                          }
                        >
                          {inv.status.toUpperCase()}
                        </Chip>
                      </Td>
                      <Td right>
                        <div className="flex items-center justify-end gap-1.5">
                          {inv.status === "pending" && (
                            <>
                              <Button
                                variant="outline"
                                size="xs"
                                className="font-mono text-[10px] text-court-400"
                                onClick={async () => {
                                  const player = db.players.find((p) => p.id === inv.playerId);
                                  const guardianPhone =
                                    player?.parentPhone ||
                                    player?.guardianPhone ||
                                    player?.guardian2Phone ||
                                    player?.phone;
                                  const reminderMessage = `Dear Guardian, this is a reminder that tuition invoice ${inv.invoiceNumber} for ${inv.playerName} (${money(inv.amount)}) for ${inv.billingMonth} ${inv.year} is due on ${inv.dueDate}.`;
                                  if (guardianPhone) {
                                    openDirectWhatsApp(guardianPhone, reminderMessage);
                                  }
                                  const notif = db.academy.notificationServices;
                                  const result = await dispatchNotification(
                                    {
                                      recipientName: inv.playerName,
                                      recipientPhone: guardianPhone,
                                      recipientEmail: player?.guardianEmail,
                                      subject: `Invoice Reminder: ${inv.invoiceNumber} - ${db.academy.name}`,
                                      message: reminderMessage,
                                      channel: "WhatsApp",
                                      amount: inv.amount,
                                      receiptNumber: inv.invoiceNumber,
                                    },
                                    notif,
                                  );
                                  if (guardianPhone) {
                                    toast.success(
                                      `Opened WhatsApp reminder for ${inv.playerName} (${guardianPhone})`,
                                    );
                                  } else if (result.fallbackToInApp) {
                                    toast.info(
                                      result.statusMessage ||
                                        "Logged to In-App Notification Center (External SMS/Email webhook not configured)",
                                    );
                                  } else {
                                    toast.success(
                                      `Reminder sent to ${guardianPhone || player?.guardianEmail || inv.playerName} via ${result.channel}`,
                                    );
                                  }
                                }}
                              >
                                Remind
                              </Button>
                              <Button
                                size="xs"
                                variant="primary"
                                onClick={() => openRecordCashModal(inv)}
                                className="font-mono text-[10px]"
                              >
                                Record Cash
                              </Button>
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              exportPdf(
                                `INVOICE - ${inv.invoiceNumber}`,
                                [
                                  "Item / Description",
                                  "Billing Period",
                                  "Squad / Program",
                                  "Branch",
                                  "Amount Due",
                                ],
                                [
                                  [
                                    inv.description || "Monthly Tuition Fee",
                                    `${inv.billingMonth} ${inv.year}`,
                                    `${inv.team || "Squad"} (${inv.programTier || "Standard"})`,
                                    inv.playerBranch || "Headquarters",
                                    money(inv.amount),
                                  ],
                                ],
                              );
                            }}
                            className="rounded bg-ink-800 px-2 py-1 font-mono text-[10px] text-ink-300 ring-1 ring-ink-700 hover:bg-ink-750 transition-colors"
                          >
                            PDF
                          </button>
                        </div>
                      </Td>
                    </Row>
                  ))
                )}
              </Table>
            </div>

            {/* Mobile Invoices Card View (< 640px) */}
            <div className="hidden divide-y divide-ink-800">
              {pagedInvoices.length === 0 ? (
                <EmptyState>No invoices found matching these filters.</EmptyState>
              ) : (
                pagedInvoices.map((inv) => (
                  <div key={inv.id} className="p-3.5 space-y-2.5 transition hover:bg-ink-850/50">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-mono text-xs font-semibold text-ink-100 block">
                          {inv.invoiceNumber}
                        </span>
                        <div className="text-sm font-medium text-ink-100 truncate mt-0.5">
                          {inv.playerName}
                        </div>
                        <div className="font-mono text-[10px] text-ink-400">
                          {inv.team || "Squad"} · {inv.playerBranch || "HQ"}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono text-sm font-bold text-court-400">
                          {money(inv.amount)}
                        </div>
                        <Chip
                          tone={
                            inv.status === "paid"
                              ? "good"
                              : inv.status === "pending"
                                ? "warn"
                                : "bad"
                          }
                        >
                          {inv.status.toUpperCase()}
                        </Chip>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs font-mono bg-ink-900/60 p-2 rounded border border-ink-850">
                      <div>
                        <span className="text-[10px] text-ink-400 block uppercase">Period</span>
                        <span className="text-ink-200 block truncate">
                          {inv.billingMonth} {inv.year}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-ink-400 block uppercase">Due Date</span>
                        <span className="text-ink-200 block truncate">{inv.dueDate}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1">
                      {inv.status === "pending" && (
                        <>
                          <Button
                            variant="outline"
                            size="xs"
                            className="font-mono text-[10px] text-court-400"
                            onClick={async () => {
                              const player = db.players.find((p) => p.id === inv.playerId);
                              const guardianPhone =
                                player?.parentPhone ||
                                player?.guardianPhone ||
                                player?.guardian2Phone ||
                                player?.phone;
                              const reminderMessage = `Dear Guardian, this is a reminder that tuition invoice ${inv.invoiceNumber} for ${inv.playerName} (${money(inv.amount)}) for ${inv.billingMonth} ${inv.year} is due on ${inv.dueDate}.`;
                              if (guardianPhone) {
                                openDirectWhatsApp(guardianPhone, reminderMessage);
                              }
                              const notif = db.academy.notificationServices;
                              const result = await dispatchNotification(
                                {
                                  recipientName: inv.playerName,
                                  recipientPhone: guardianPhone,
                                  recipientEmail: player?.guardianEmail,
                                  subject: `Invoice Reminder: ${inv.invoiceNumber} - ${db.academy.name}`,
                                  message: reminderMessage,
                                  channel: "WhatsApp",
                                  amount: inv.amount,
                                  receiptNumber: inv.invoiceNumber,
                                },
                                notif,
                              );
                              if (guardianPhone) {
                                toast.success(
                                  `Opened WhatsApp reminder for ${inv.playerName} (${guardianPhone})`,
                                );
                              } else if (result.fallbackToInApp) {
                                toast.info(
                                  result.statusMessage ||
                                    "Logged to In-App Notification Center (External SMS/Email webhook not configured)",
                                );
                              } else {
                                toast.success(
                                  `Reminder sent to ${guardianPhone || player?.guardianEmail || inv.playerName} via ${result.channel}`,
                                );
                              }
                            }}
                          >
                            Remind
                          </Button>
                          <Button
                            size="xs"
                            variant="primary"
                            onClick={() => openRecordCashModal(inv)}
                            className="font-mono text-[10px]"
                          >
                            Record Cash
                          </Button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          exportPdf(
                            `INVOICE - ${inv.invoiceNumber}`,
                            [
                              "Item / Description",
                              "Billing Period",
                              "Squad / Program",
                              "Branch",
                              "Amount Due",
                            ],
                            [
                              [
                                inv.description || "Monthly Tuition Fee",
                                `${inv.billingMonth} ${inv.year}`,
                                `${inv.team || "Squad"} (${inv.programTier || "Standard"})`,
                                inv.playerBranch || "Headquarters",
                                money(inv.amount),
                              ],
                            ],
                          );
                        }}
                        className="rounded bg-ink-800 px-2 py-1 font-mono text-[10px] text-ink-300 ring-1 ring-ink-700 hover:bg-ink-750 transition-colors"
                      >
                        PDF
                      </button>
                    </div>
                  </div>
                ))
              )}
              <div className="p-3 border-t border-ink-800">
                <Pagination
                  page={invoicePage}
                  pageSize={invoicePageSize}
                  total={filteredInvoices.length}
                  setPage={setInvoicePage}
                />
              </div>
            </div>
          </Panel>
        </div>
      )}

      {activeTab === "payroll" && (
        <div className="space-y-6 flex flex-col min-h-0">
          {/* Top Controls Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-ink-900/90 p-4 border border-ink-800 backdrop-blur-sm">
            <div className="flex flex-wrap items-center gap-3">
              <div className="w-36">
                <Select value={payrollMonth} onChange={setPayrollMonth} options={MONTH_OPTIONS} />
              </div>
              <div className="w-24">
                <Input
                  type="number"
                  value={String(payrollYear)}
                  onChange={(v) => setPayrollYear(Number(v) || new Date().getFullYear())}
                />
              </div>
              {!isBranchScoped && (
                <div className="w-44">
                  <Select
                    value={payrollBranch}
                    onChange={setPayrollBranch}
                    options={["", ...db.branches.map((b) => b.name)]}
                  />
                </div>
              )}
              <div className="w-60">
                <Search
                  value={payrollQuery}
                  onChange={setPayrollQuery}
                  placeholder="Search coach, branch..."
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={exportPayrollCsv}>
                📊 CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={exportPayrollPdfReport}
                className="text-court-300"
              >
                📄 PDF Report
              </Button>
              <Button variant="primary" size="sm" onClick={() => setBatchDisburseOpen(true)}>
                <span>⚡</span> Disburse All Verified (
                {payrollComputation.pendingDisbursementCoachesCount})
              </Button>
            </div>
          </div>

          {/* KPI Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5 sm:gap-4">
            <Stat
              label="Active Coaches"
              value={String(payrollComputation.totalActiveCoaches)}
              note={`in ${payrollComputation.periodLabel}`}
            />
            <Stat
              label="Verified Sessions"
              value={`${payrollComputation.totalVerifiedSessions} sessions`}
              note="Attendance check-ins verified"
              accent
            />
            <Stat
              label="Total Payroll Payout"
              value={money(payrollComputation.totalProjectedPayout)}
              note="Sessions × coach rate"
              accent
            />
            <Stat
              label="Disbursed Payout"
              value={money(payrollComputation.totalDisbursedPayout)}
              note={`${money(payrollComputation.totalPendingPayout)} pending`}
            />
          </div>

          {/* Verification Policy Banner */}
          <div className="rounded-lg bg-court-950/40 p-3.5 border border-court-800/40 text-xs text-ink-200 flex items-start gap-3 shadow-inner">
            <div className="rounded-full bg-court-500/20 p-1 text-court-400 font-bold shrink-0 mt-0.5">
              ✓
            </div>
            <div>
              <strong className="text-court-300">Attendance-Verified Integrity Rule:</strong> Coach
              payroll calculations query sessions with{" "}
              <code className="font-mono text-court-300">status: 'completed'</code> within the pay
              period and verify attendance logs (player check-ins recorded or coach attendance
              confirmed). Draft, scheduled, cancelled, or unlogged sessions are strictly excluded
              from payroll calculations.
            </div>
          </div>

          {/* Payroll Breakdown Table */}
          <Panel
            title={`Coach Payroll Breakdown — ${payrollComputation.periodLabel}`}
            meta={`${filteredPayrollRows.length} coaches calculated · Rate × Verified Sessions`}
          >
            {/* Payroll Table */}
            <div className="overflow-x-auto w-full -mx-4 px-4 sm:mx-0 sm:px-0">
              <Table
                head={
                  <>
                    <Th>COACH NAME</Th>
                    <Th>LEVEL &amp; BRANCH</Th>
                    <Th>
                      <span className="block text-right">RATE</span>
                    </Th>
                    <Th>
                      <span className="block text-center">VERIFIED SESSIONS</span>
                    </Th>
                    <Th>
                      <span className="block text-right">TOTAL PAYOUT</span>
                    </Th>
                    <Th>
                      <span className="block text-right">DISBURSEMENT &amp; ACTIONS</span>
                    </Th>
                  </>
                }
              >
                {filteredPayrollRows.length === 0 ? (
                  <EmptyState>
                    No coach payroll records found for {payrollComputation.periodLabel}.
                  </EmptyState>
                ) : (
                  filteredPayrollRows.map((r) => (
                    <Row key={r.coachId}>
                      <Td strong>
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-court-500/10 text-court-400 font-bold text-xs font-mono ring-1 ring-court-500/30">
                            {r.coachName
                              .split(" ")
                              .map((n) => n[0])
                              .slice(0, 2)
                              .join("")}
                          </div>
                          <div>
                            <div className="font-semibold text-ink-100">{r.coachName}</div>
                            <div className="text-[11px] font-mono text-ink-400">
                              {r.phone || r.email || "—"}
                            </div>
                          </div>
                        </div>
                      </Td>

                      <Td>
                        <div className="flex items-center gap-1.5">
                          <Chip>{r.level || "Coach"}</Chip>
                          <span className="text-xs text-ink-400">{r.branch || "Headquarters"}</span>
                        </div>
                      </Td>

                      <Td right>
                        <div className="font-mono text-sm font-semibold text-ink-200">
                          {money(r.rate)}
                          <span className="text-[10px] text-ink-400 font-normal">
                            {r.rateType === "hourly" ? " / hr" : " / session"}
                          </span>
                        </div>
                      </Td>

                      <Td className="text-center">
                        <div className="flex flex-col items-center gap-1">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium font-mono ${
                                r.verifiedCompletedSessionsCount > 0
                                  ? "bg-court-500/15 text-court-300 ring-1 ring-court-500/30"
                                  : "bg-ink-800 text-ink-400"
                              }`}
                            >
                              <span>✓</span> {r.verifiedCompletedSessionsCount} Sessions
                              {r.rateType === "hourly" && ` (${r.verifiedCompletedHours} hrs)`}
                            </span>
                            <button
                              type="button"
                              onClick={() => setSelectedCoachSessions(r)}
                              className="text-[10px] text-court-400 hover:text-court-300 underline font-mono cursor-pointer"
                            >
                              Details
                            </button>
                          </div>
                          {r.unloggedCompletedSessionsCount > 0 && (
                            <span className="text-[10px] font-mono text-amber-400">
                              ({r.unloggedCompletedSessionsCount} unlogged excluded)
                            </span>
                          )}
                        </div>
                      </Td>

                      <Td right>
                        <div className="space-y-1">
                          <div className="font-mono text-base font-bold text-court-400">
                            {money(r.totalPayout)}
                          </div>
                          <div className="text-[10px] font-mono text-ink-400">
                            {r.totalTransportEarned > 0
                              ? `Session: ${money(r.totalBaseEarned)} + Transport: +${money(r.totalTransportEarned)}`
                              : r.rateType === "hourly"
                                ? `${r.verifiedCompletedHours} hrs × ${money(r.rate)}`
                                : `${r.verifiedCompletedSessionsCount} sess × ${money(r.rate)}`}
                          </div>
                          {(r.hasAdvance || r.netBalance < 0 || r.outstanding < 0) && (
                            <div className="inline-flex flex-col items-end gap-0.5 rounded bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-300 ring-1 ring-amber-500/30">
                              <span>
                                Advance / On Account: -
                                {money(Math.abs(r.netBalance < 0 ? r.netBalance : r.outstanding))}{" "}
                                (Prepaid / Borrowed)
                              </span>
                              <span className="text-[9px] text-amber-200/90">
                                Custom / Advance Payment (On Account)
                                {r.linkedAdvanceSessionsCount
                                  ? ` · Covers ${r.linkedAdvanceSessionsCount} sess`
                                  : ""}
                              </span>
                            </div>
                          )}
                        </div>
                      </Td>

                      <Td right>
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {r.isDisbursed && (
                            <div className="flex items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 rounded bg-good/15 px-2 py-1 font-mono text-[10px] font-semibold text-good ring-1 ring-good/30">
                                <span>✓</span> PAID ({money(r.totalDisbursed)})
                              </span>
                              {r.disbursedDate && (
                                <span className="text-[10px] font-mono text-ink-400">
                                  {r.disbursedDate}
                                </span>
                              )}
                              {canDeleteAccounting && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const detRef = `payroll-${payrollMonth}-${r.coachId}`;
                                    const detRefLower = `payroll-${payrollMonth.toLowerCase()}-${r.coachId}`;
                                    const detId = `payroll-${r.coachId}-${payrollComputation.year}-${payrollComputation.monthCode}`;
                                    const matchingEntry = db.ledger.find(
                                      (l) =>
                                        l.referenceId === detRef ||
                                        l.referenceId === detRefLower ||
                                        l.id === detId ||
                                        l.id.startsWith(`${detId}-`) ||
                                        (l.coachId === r.coachId &&
                                          l.date.startsWith(
                                            `${payrollComputation.year}-${payrollComputation.monthCode}`,
                                          )),
                                    );
                                    if (matchingEntry) {
                                      setDeletingLedgerEntry(matchingEntry);
                                    } else {
                                      toast.error("Could not locate matching ledger payout entry.");
                                    }
                                  }}
                                  className="rounded bg-bad/15 px-2 py-1 font-mono text-[10px] font-semibold text-bad ring-1 ring-bad/30 hover:bg-bad/25 transition-colors"
                                  title="Undo / Delete this coach payroll disbursement"
                                >
                                  Undo
                                </button>
                              )}
                            </div>
                          )}
                          {canWriteAccounting && (
                            <Button
                              variant={r.totalPayout > 0 && !r.isDisbursed ? "primary" : "outline"}
                              onClick={() => {
                                setDisburseModalCoach(r);
                                const defaultAmt =
                                  r.netBalance > 0 ? r.netBalance : r.rate > 0 ? r.rate : 50;
                                setDisburseAmount(defaultAmt);
                                setDisbursePaymentMethod("Bank Transfer");
                                setDisburseNote("");
                                setDisburseAdvanceReason("");
                                setDisburseLinkedSessionsCount(0);
                              }}
                              className="text-xs px-2.5 py-1 font-semibold flex items-center gap-1"
                            >
                              <span>⚡</span>{" "}
                              {r.totalPayout > 0 && !r.isDisbursed
                                ? "Disburse Payroll"
                                : "Advance / Pay"}
                            </Button>
                          )}
                        </div>
                      </Td>
                    </Row>
                  ))
                )}
              </Table>
            </div>

            {/* Mobile Payroll Cards (< 640px) */}
            <div className="hidden divide-y divide-ink-800">
              {filteredPayrollRows.length === 0 ? (
                <EmptyState>
                  No coach payroll records found for {payrollComputation.periodLabel}.
                </EmptyState>
              ) : (
                filteredPayrollRows.map((r) => (
                  <div key={r.coachId} className="p-3.5 space-y-2.5 transition hover:bg-ink-850/50">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-ink-100 truncate text-sm">
                          {r.coachName}
                        </div>
                        <div className="font-mono text-[10px] text-ink-400 mt-0.5">
                          {r.branch || "HQ"} · {r.phone || r.email || "—"}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-mono text-sm font-bold text-court-400">
                          {money(r.totalPayout)}
                        </div>
                        <Chip>{r.level || "Coach"}</Chip>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs font-mono bg-ink-900/60 p-2 rounded border border-ink-850">
                      <div>
                        <span className="text-[10px] text-ink-400 block uppercase">Rate</span>
                        <span className="text-ink-200 block truncate">
                          {money(r.rate)}
                          <span className="text-[10px] text-ink-400">
                            {r.rateType === "hourly" ? " / hr" : " / sess"}
                          </span>
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-ink-400 block uppercase">
                          Verified Sessions
                        </span>
                        <div className="flex items-center gap-1">
                          <span className="text-ink-200 font-semibold">
                            ✓ {r.verifiedCompletedSessionsCount}
                          </span>
                          <button
                            type="button"
                            onClick={() => setSelectedCoachSessions(r)}
                            className="text-[10px] text-court-400 underline"
                          >
                            (view)
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <div>
                        {r.isDisbursed ? (
                          <span className="inline-flex items-center gap-1 rounded bg-good/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-good ring-1 ring-good/30">
                            <span>✓</span> PAID {r.disbursedDate ? `(${r.disbursedDate})` : ""}
                          </span>
                        ) : (
                          <span className="font-mono text-[10px] text-ink-400">
                            Pending Disbursement
                          </span>
                        )}
                      </div>
                      {!r.isDisbursed && r.totalPayout > 0 && (
                        <Button
                          variant="primary"
                          onClick={() => {
                            setDisburseModalCoach(r);
                            setDisbursePaymentMethod("Bank Transfer");
                            setDisburseNote("");
                          }}
                          className="text-xs px-2.5 py-1 font-semibold flex items-center gap-1"
                        >
                          <span>⚡</span> Disburse
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Panel>
        </div>
      )}

      {activeTab === "reports" && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-4 items-center rounded-md bg-ink-900 p-4 border border-ink-800">
            <span className="text-sm font-medium text-ink-300">Filters:</span>
            {!isBranchScoped && (
              <FilterSelect
                label="Branch"
                value={reportBranch}
                onChange={setReportBranch}
                options={["", ...db.branches.map((b) => b.name)]}
              />
            )}
            <FilterSelect
              label="Month"
              value={reportMonth}
              onChange={setReportMonth}
              options={["", ...allMonths]}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 sm:gap-4">
            <Stat
              label="Period Revenue"
              value={money(reportRevenue)}
              note="Filtered collections"
              accent
            />
            <Stat
              label="Period Expenses"
              value={money(reportExpense)}
              note="Filtered disbursements"
            />
            <Stat
              label="Net Profit / (Loss)"
              value={money(reportRevenue - reportExpense)}
              note={reportRevenue >= reportExpense ? "Net Positive" : "Deficit"}
              accent={reportRevenue >= reportExpense}
            />
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <Panel
              title="Profit & Loss Statement"
              meta={`${reportMonth || "All Time"} ${reportBranch ? `(${reportBranch})` : ""}`}
            >
              <div className="p-4 space-y-4">
                <div>
                  <h4 className="text-xs font-mono text-ink-400 mb-2 border-b border-ink-800 pb-1">
                    REVENUE
                  </h4>
                  {accounts.map((acc) => {
                    const amt = reportLedger
                      .filter(
                        (l) =>
                          (l.type === "Revenue" || (l.type as string) === "credit") &&
                          (l.account || l.category || "Other") === acc,
                      )
                      .reduce((a, l) => a + Math.abs(l.amount), 0);
                    if (amt === 0) return null;
                    return (
                      <div key={acc} className="flex justify-between text-sm py-1">
                        <span className="text-ink-200">{acc}</span>
                        <span className="text-court-400">{money(amt)}</span>
                      </div>
                    );
                  })}
                  <div className="flex justify-between text-sm font-bold py-2 mt-2 border-t border-ink-800">
                    <span>Total Revenue</span>
                    <span className="text-court-400">{money(reportRevenue)}</span>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-mono text-ink-400 mb-2 border-b border-ink-800 pb-1">
                    EXPENSES
                  </h4>
                  {accounts.map((acc) => {
                    const amt = reportLedger
                      .filter(
                        (l) =>
                          (l.type === "Expense" || (l.type as string) === "debit") &&
                          (l.account || l.category || "Other") === acc,
                      )
                      .reduce((a, l) => a + Math.abs(l.amount), 0);
                    if (amt === 0) return null;
                    return (
                      <div key={acc} className="flex justify-between text-sm py-1">
                        <span className="text-ink-200">{acc}</span>
                        <span className="text-bad">{money(amt)}</span>
                      </div>
                    );
                  })}
                  {(() => {
                    const targetBranches = reportBranch
                      ? (db.branches || []).filter((b) => b.name === reportBranch)
                      : isBranchScoped
                        ? (db.branches || []).filter(
                            (b) => b.name.toLowerCase() === (userBranch || "").toLowerCase(),
                          )
                        : db.branches || [];
                    const utilRows = calculateBranchCourtUtilizationAnalytics(
                      targetBranches,
                      db.sessions || [],
                      reportLedger,
                      db.teams || [],
                      db.coaches || [],
                      reportMonth || undefined,
                    );
                    const computedCourtRental = utilRows.reduce(
                      (s, r) => s + r.sessionCourtRentalCost,
                      0,
                    );
                    if (computedCourtRental <= 0) return null;
                    return (
                      <div className="flex justify-between text-sm py-1 border-t border-ink-800/60 mt-1 pt-1.5">
                        <span className="text-ink-200">
                          Session Court Rental (Full Court + HCA / HCB)
                        </span>
                        <span className="text-warn font-mono">{money(computedCourtRental)}</span>
                      </div>
                    );
                  })()}
                  <div className="flex justify-between text-sm font-bold py-2 mt-2 border-t border-ink-800">
                    <span>Total Ledger Expenses</span>
                    <span className="text-bad">{money(reportExpense)}</span>
                  </div>
                </div>

                <div className="flex justify-between text-base font-bold py-3 mt-4 border-t-2 border-ink-700">
                  <span>NET INCOME</span>
                  <span className={reportRevenue - reportExpense >= 0 ? "text-good" : "text-bad"}>
                    {money(reportRevenue - reportExpense)}
                  </span>
                </div>
              </div>
            </Panel>

            <Panel
              title="Outstanding Player Balances"
              meta="Current unpaid fees & automated collection"
            >
              <Table
                head={
                  <>
                    <Th>PLAYER</Th>
                    <Th>BRANCH</Th>
                    <Th>
                      <span className="block text-right">BALANCE</span>
                    </Th>
                    <Th>
                      <span className="block text-right">ACTION</span>
                    </Th>
                  </>
                }
              >
                {reportPlayers.length === 0 ? (
                  <EmptyState>No outstanding balances.</EmptyState>
                ) : (
                  reportPlayers.map((p) => (
                    <Row key={p.id}>
                      <Td strong>{p.name}</Td>
                      <Td>{p.branch}</Td>
                      <Td right>
                        <span className="text-bad font-mono text-sm">{money(p.balance)}</span>
                      </Td>
                      <Td right>
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={async () => {
                              const guardianPhone =
                                p.parentPhone || p.guardianPhone || p.guardian2Phone || p.phone;
                              const reminderMessage = `Dear Guardian, this is a reminder for ${p.name}'s outstanding balance of ${money(p.balance)} for ${db.academy.name}.`;
                              if (guardianPhone) {
                                openDirectWhatsApp(guardianPhone, reminderMessage);
                              }
                              const notif = db.academy.notificationServices;
                              const result = await dispatchNotification(
                                {
                                  recipientName: p.name,
                                  recipientPhone: guardianPhone,
                                  recipientEmail: p.guardianEmail,
                                  subject: `Payment Reminder: ${db.academy.name}`,
                                  message: reminderMessage,
                                  channel: "WhatsApp",
                                  amount: p.balance,
                                },
                                notif,
                              );
                              toast.success(
                                guardianPhone
                                  ? `Opened WhatsApp reminder for ${p.name} (${guardianPhone})`
                                  : `Reminder sent to ${p.guardianEmail || p.name} via ${result.channel}`,
                              );
                            }}
                            className="rounded bg-ink-800 px-2 py-1 font-mono text-[10px] text-court-400 ring-1 ring-ink-700 hover:bg-ink-750"
                          >
                            Remind
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              const payAmount = Math.abs(p.balance);
                              const todayIso = new Date().toISOString().slice(0, 10);
                              const unpaidInvoices = (db.invoices || []).filter(
                                (inv) =>
                                  inv.playerId === p.id &&
                                  (inv.status === "pending" || inv.status === "overdue"),
                              );

                              const newEntry: LedgerEntry = {
                                id: `l-${Date.now().toString(36)}`,
                                date: todayIso,
                                description: `Tuition & Fee Collection - ${p.name}`,
                                entry: `Tuition & Fee Collection - ${p.name}`,
                                type: "Revenue",
                                account: "Tuition",
                                branch: p.branch,
                                amount: payAmount,
                                status: "Collected",
                                referenceId: unpaidInvoices[0]?.id,
                              };
                              await setEntity("ledger", newEntry);
                              await patchEntity("players", p.id, { balance: 0 });
                              for (const inv of unpaidInvoices) {
                                await patchEntity("invoices", inv.id, {
                                  status: "paid",
                                  paidDate: todayIso,
                                  paidAmount: inv.amount,
                                  paymentMethod: "Cash",
                                });
                              }

                              if (db.academy.notificationServices?.autoSendReceipts) {
                                await dispatchNotification(
                                  {
                                    recipientName: p.name,
                                    recipientPhone:
                                      p.parentPhone ||
                                      p.guardianPhone ||
                                      p.guardian2Phone ||
                                      p.phone,
                                    recipientEmail: p.guardianEmail,
                                    subject: `Receipt: Payment Received - ${db.academy.name}`,
                                    message: `Payment of ${money(payAmount)} for ${p.name} confirmed. Balance is now $0.`,
                                    channel: "Email",
                                    amount: payAmount,
                                    receiptNumber: newEntry.id,
                                  },
                                  db.academy.notificationServices,
                                );
                              }
                              void createAcademyNotification(tenantId, {
                                title: `Tuition Payment Collected: ${p.name}`,
                                message: `Collected ${money(payAmount)} tuition balance from ${p.name}${p.branch ? ` (${p.branch})` : ""}.`,
                                type: "billing",
                                targetRoles: ["super_admin", "accountant", "branch_manager"],
                                targetBranchId: p.branch || undefined,
                                actionUrl: "/accounting",
                                createdAt: new Date().toISOString(),
                                readBy: [],
                                dismissedBy: [],
                              }).catch(() => {});
                              toast.success(
                                `Collected ${money(payAmount)} from ${p.name}. Ledger and invoices settled.`,
                              );
                            }}
                            className="rounded bg-court-500 px-2.5 py-1 font-mono text-[10px] font-semibold text-ink-950 hover:bg-court-400"
                          >
                            Collect
                          </button>
                        </div>
                      </Td>
                    </Row>
                  ))
                )}
              </Table>
            </Panel>
          </div>

          {/* Level C: Branch Revenue & Court Utilization Analytics (Full vs. HCA / HCB) */}
          {(() => {
            const targetBranches = reportBranch
              ? (db.branches || []).filter((b) => b.name === reportBranch)
              : isBranchScoped
                ? (db.branches || []).filter(
                    (b) => b.name.toLowerCase() === (userBranch || "").toLowerCase(),
                  )
                : db.branches || [];
            const branchRows = calculateBranchCourtUtilizationAnalytics(
              targetBranches,
              db.sessions || [],
              reportLedger,
              db.teams || [],
              db.coaches || [],
              reportMonth || undefined,
            );
            const teamRows = calculateTeamOperatingCostReport(
              db.teams || [],
              db.sessions || [],
              db.players || [],
              db.branches || [],
              db.coaches || [],
              reportMonth || undefined,
              reportBranch || (isBranchScoped ? userBranch : undefined),
            );

            return (
              <div className="space-y-6">
                <Panel
                  title="Branch Revenue & Court Utilization Analytics (Full Court vs. HCA / HCB)"
                  meta={`${reportMonth || "All Time"} · Per-court Full vs. Half-Court (HCA / HCB) utilization, session rental costs, and branch operating margin`}
                >
                  <Table
                    head={
                      <>
                        <Th>BRANCH &amp; COURTS</Th>
                        <Th>SESSIONS (FULL / HCA / HCB)</Th>
                        <Th hide>HOURS</Th>
                        <Th>
                          <span className="block text-right">COURT RENTAL COST</span>
                        </Th>
                        <Th hide>
                          <span className="block text-right">COACH &amp; FIXED COST</span>
                        </Th>
                        <Th>
                          <span className="block text-right">COLLECTED REVENUE</span>
                        </Th>
                        <Th>
                          <span className="block text-right">BRANCH NET</span>
                        </Th>
                      </>
                    }
                  >
                    {branchRows.length === 0 ? (
                      <EmptyState>No branch court utilization records found.</EmptyState>
                    ) : (
                      branchRows.map((bRow) => (
                        <Row key={bRow.branchId}>
                          <Td strong>
                            <div>{bRow.branchName}</div>
                            <div className="font-mono text-[10px] text-ink-400">
                              {bRow.courtsCount} court(s) · {bRow.halfCourtEnabledCount} HCA/HCB
                              enabled
                            </div>
                          </Td>
                          <Td>
                            <div className="flex items-center gap-1.5 font-mono text-xs flex-wrap">
                              <span className="font-bold text-ink-100">
                                {bRow.totalSessions} total
                              </span>
                              <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-300">
                                Full: {bRow.fullCourtSessions}
                              </span>
                              <span className="rounded bg-court-500/15 px-1.5 py-0.5 text-[10px] text-court-300">
                                HCA: {bRow.hcaSessions}
                              </span>
                              <span className="rounded bg-court-500/15 px-1.5 py-0.5 text-[10px] text-court-300">
                                HCB: {bRow.hcbSessions}
                              </span>
                            </div>
                          </Td>
                          <Td hide>
                            <span className="font-mono text-xs text-ink-200">
                              {bRow.totalHours} hrs
                            </span>
                          </Td>
                          <Td right>
                            <span className="font-mono text-xs font-semibold text-warn">
                              {money(bRow.sessionCourtRentalCost)}
                            </span>
                          </Td>
                          <Td hide right>
                            <span className="font-mono text-xs text-ink-300">
                              {money(bRow.coachAndOfficialsCost + bRow.fixedFacilityOverhead)}
                            </span>
                          </Td>
                          <Td right>
                            <span className="font-mono text-xs font-semibold text-court-300">
                              {money(bRow.branchCollectedRevenue)}
                            </span>
                          </Td>
                          <Td right>
                            <span
                              className={`font-mono text-xs font-bold ${
                                bRow.branchNetProfit >= 0 ? "text-good" : "text-bad"
                              }`}
                            >
                              {money(bRow.branchNetProfit)}
                            </span>
                          </Td>
                        </Row>
                      ))
                    )}
                  </Table>
                </Panel>

                {/* Level B: Team Monthly Operating Cost / Profitability Report */}
                <Panel
                  title="Team Monthly Operating Cost / Profitability Report"
                  meta={`${reportMonth || "All Time"} · Propagated Full Court & Half-Court (HCA / HCB) rental fees + coach payroll vs. team tuition`}
                >
                  <Table
                    head={
                      <>
                        <Th>TEAM</Th>
                        <Th>SESSIONS (FULL / HCA / HCB)</Th>
                        <Th>
                          <span className="block text-right">COURT RENTAL</span>
                        </Th>
                        <Th hide>
                          <span className="block text-right">COACH PAYROLL</span>
                        </Th>
                        <Th>
                          <span className="block text-right">OPERATING COST</span>
                        </Th>
                        <Th hide>
                          <span className="block text-right">TUITION REVENUE</span>
                        </Th>
                        <Th>
                          <span className="block text-right">PROFITABILITY</span>
                        </Th>
                      </>
                    }
                  >
                    {teamRows.length === 0 ? (
                      <EmptyState>No team profitability data for selected filters.</EmptyState>
                    ) : (
                      teamRows.map((tRow) => (
                        <Row key={tRow.teamId}>
                          <Td strong>
                            <div>{tRow.teamName}</div>
                            <div className="font-mono text-[10px] text-ink-400">
                              {tRow.category} · {tRow.branch || "HQ"} · {tRow.activePlayersCount}{" "}
                              active players
                            </div>
                          </Td>
                          <Td>
                            <div className="flex items-center gap-1.5 font-mono text-xs flex-wrap">
                              <span className="font-semibold text-ink-100">
                                {tRow.sessionsCount} ({tRow.totalHours}h)
                              </span>
                              <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-300">
                                Full: {tRow.fullCourtSessions}
                              </span>
                              <span className="rounded bg-court-500/15 px-1.5 py-0.5 text-[10px] text-court-300">
                                HCA: {tRow.hcaSessions}
                              </span>
                              <span className="rounded bg-court-500/15 px-1.5 py-0.5 text-[10px] text-court-300">
                                HCB: {tRow.hcbSessions}
                              </span>
                            </div>
                          </Td>
                          <Td right>
                            <span className="font-mono text-xs font-semibold text-warn">
                              {money(tRow.courtRentalCost)}
                            </span>
                          </Td>
                          <Td hide right>
                            <span className="font-mono text-xs text-ink-200">
                              {money(tRow.coachPayrollCost + tRow.officialsCost)}
                            </span>
                          </Td>
                          <Td right>
                            <span className="font-mono text-xs font-bold text-bad">
                              {money(tRow.totalOperatingCost)}
                            </span>
                          </Td>
                          <Td hide right>
                            <span className="font-mono text-xs text-court-300">
                              {money(tRow.tuitionRevenue)}
                            </span>
                          </Td>
                          <Td right>
                            <span
                              className={`font-mono text-xs font-bold ${
                                tRow.netMargin >= 0 ? "text-good" : "text-bad"
                              }`}
                            >
                              {money(tRow.netMargin)}
                            </span>
                          </Td>
                        </Row>
                      ))
                    )}
                  </Table>
                </Panel>
              </div>
            );
          })()}
        </div>
      )}

      {activeTab === "ledger" && (
        <Panel
          title="Ledger"
          meta="Every revenue and expense line"
          action={
            <>
              <FilterSelect
                label="Type"
                value={type}
                onChange={setType}
                options={["Revenue", "Expense"]}
              />
              <FilterSelect
                label="Account"
                value={account}
                onChange={setAccount}
                options={accounts}
              />
              <Button variant="outline" size="md" onClick={exportCsv}>
                Export CSV
              </Button>
              <Button variant="outline" size="md" onClick={exportPdfReport}>
                Export PDF
              </Button>
              {canWriteAccounting && (
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => {
                    setEditing(null);
                    setForm({ ...blank, branch: isBranchScoped ? userBranch : "" });
                    setOpen(true);
                  }}
                >
                  + New entry
                </Button>
              )}
            </>
          }
        >
          <div className="border-b border-ink-800 px-4 py-3">
            <Search value={q} onChange={setQ} placeholder="Search ledger entries…" />
          </div>
          {/* Virtualized Ledger Table */}
          <div className="overflow-x-auto w-full -mx-4 px-4 sm:mx-0 sm:px-0">
            <VirtualTable
              data={pagedLedger}
              colSpan={5}
              head={
                <>
                  <Th>DATE</Th>
                  <Th>ENTRY</Th>
                  <Th hide>ACCOUNT</Th>
                  <Th hide>STATUS</Th>
                  <Th>
                    <span className="block text-right">AMOUNT</span>
                  </Th>
                </>
              }
              footer={
                <Pagination
                  page={page}
                  pageSize={pageSize}
                  total={filteredLedger.length}
                  setPage={setPage}
                />
              }
              emptyState={<EmptyState>No ledger entries match these filters.</EmptyState>}
              renderRow={(l) => (
                <>
                  <Td>
                    <span className="font-mono text-xs text-ink-300">{l.date}</span>
                  </Td>
                  <Td strong>
                    <div className="flex flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{l.entry}</span>
                        {(l.isAdvance || l.entry?.includes("Custom / Advance Payment")) && (
                          <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-300 ring-1 ring-amber-500/30">
                            ⚡ Custom / Advance Payment (On Account)
                            {l.linkedAdvanceSessionsCount
                              ? ` · Validated ${l.linkedAdvanceSessionsCount} sess`
                              : ""}
                          </span>
                        )}
                        {l.attachment && (
                          <a
                            href={l.attachment}
                            target="_blank"
                            rel="noreferrer"
                            className="text-court-400 hover:text-court-300"
                            title="View Receipt"
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
                              <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                            </svg>
                          </a>
                        )}
                      </div>
                      {(l.note || l.advanceReason) && (
                        <span className="text-[10px] font-mono text-ink-400 font-normal">
                          {l.note}
                          {l.advanceReason && !l.note?.includes(l.advanceReason)
                            ? ` · Advance Reason: ${l.advanceReason}`
                            : ""}
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td hide>
                    <Chip>{l.account}</Chip>
                  </Td>
                  <Td hide>
                    <Chip tone={l.status === "Pending" ? "warn" : "good"}>
                      {l.status.toUpperCase()}
                    </Chip>
                  </Td>
                  <Td right>
                    <div className="flex items-center justify-end gap-2">
                      <span
                        className={`font-mono text-xs ${
                          l.type === "Expense" ? "text-bad" : "text-court-400"
                        }`}
                      >
                        {l.type === "Expense"
                          ? `-${money(Math.abs(l.amount))}`
                          : money(Math.abs(l.amount))}
                      </span>
                      <div className="flex items-center gap-2">
                        {(currentUser?.role === "Super Admin" ||
                          currentUser?.role === "Academy Manager" ||
                          currentUser?.role === "Accountant") &&
                          l.status === "Pending" && (
                            <button
                              type="button"
                              onClick={() => {
                                void patchEntity("ledger", l.id, { status: "Paid" });
                                void createAcademyNotification(tenantId, {
                                  title: `Branch Expense Approved: ${l.branch || "Academy"}`,
                                  message: `Expense "${l.entry}" of ${money(Math.abs(l.amount))} (${l.account}) has been approved and marked Paid.`,
                                  type: "billing",
                                  targetRoles: ["branch_manager"],
                                  targetBranchId: l.branch || undefined,
                                  actionUrl: "/branches",
                                  createdAt: new Date().toISOString(),
                                  readBy: [],
                                  dismissedBy: [],
                                }).catch(() => {});
                              }}
                              className="text-[10px] font-mono bg-good/15 text-good px-2 py-1 rounded hover:bg-good/25 transition-colors"
                            >
                              APPROVE
                            </button>
                          )}
                        {canEditLedgerEntry(l) && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditing(l);
                              const { id: _id, ...rest } = l;
                              setForm({
                                ...rest,
                                amount: Math.abs(rest.amount),
                                paymentMethod: rest.paymentMethod || "Cash",
                              });
                              setOpen(true);
                            }}
                            className="rounded bg-ink-850 px-2 py-1 font-mono text-[10px] text-ink-200 ring-1 ring-ink-700 hover:bg-ink-800 hover:text-court-300 transition-colors"
                          >
                            Edit
                          </button>
                        )}
                        {canDeleteLedgerEntry(l) && (
                          <button
                            type="button"
                            onClick={() => setDeletingLedgerEntry(l)}
                            className="rounded bg-bad/15 px-2 py-1 font-mono text-[10px] text-bad ring-1 ring-bad/30 hover:bg-bad/25 transition-colors"
                          >
                            Undo / Delete
                          </button>
                        )}
                      </div>
                    </div>
                  </Td>
                </>
              )}
            />
          </div>

          {/* Mobile Ledger Cards (< 640px) */}
          <div className="hidden divide-y divide-ink-800">
            {pagedLedger.length === 0 ? (
              <EmptyState>No ledger entries match these filters.</EmptyState>
            ) : (
              pagedLedger.map((l) => (
                <div key={l.id} className="p-3.5 space-y-2.5 transition hover:bg-ink-850/50">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-medium text-ink-100 text-sm">
                        <span className="truncate">{l.entry}</span>
                        {l.attachment && (
                          <a
                            href={l.attachment}
                            target="_blank"
                            rel="noreferrer"
                            className="text-court-400 shrink-0"
                            title="View Receipt"
                          >
                            📎
                          </a>
                        )}
                      </div>
                      <div className="font-mono text-[10px] text-ink-400 mt-0.5">
                        {l.date} · {l.branch || "All Branches"}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div
                        className={`font-mono text-sm font-bold ${
                          l.type === "Expense" ? "text-bad" : "text-court-400"
                        }`}
                      >
                        {l.type === "Expense"
                          ? `-${money(Math.abs(l.amount))}`
                          : money(Math.abs(l.amount))}
                      </div>
                      <Chip tone={l.status === "Pending" ? "warn" : "good"}>
                        {l.status.toUpperCase()}
                      </Chip>
                    </div>
                  </div>

                  {l.note && (
                    <div className="text-xs font-mono text-ink-400 bg-ink-900/60 p-2 rounded border border-ink-850">
                      {l.note}
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    <Chip>{l.account}</Chip>
                    <div className="flex items-center gap-2">
                      {(currentUser?.role === "Super Admin" ||
                        currentUser?.role === "Academy Manager" ||
                        currentUser?.role === "Accountant") &&
                        l.status === "Pending" && (
                          <button
                            type="button"
                            onClick={() => {
                              void patchEntity("ledger", l.id, { status: "Paid" });
                              void createAcademyNotification(tenantId, {
                                title: `Branch Expense Approved: ${l.branch || "Academy"}`,
                                message: `Expense "${l.entry}" of ${money(Math.abs(l.amount))} (${l.account}) has been approved and marked Paid.`,
                                type: "billing",
                                targetRoles: ["branch_manager"],
                                targetBranchId: l.branch || undefined,
                                actionUrl: "/branches",
                                createdAt: new Date().toISOString(),
                                readBy: [],
                                dismissedBy: [],
                              }).catch(() => {});
                            }}
                            className="text-[10px] font-mono bg-good/15 text-good px-2 py-0.5 rounded hover:bg-good/25 transition-colors"
                          >
                            APPROVE
                          </button>
                        )}
                      {canEditLedgerEntry(l) && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditing(l);
                            const { id: _id, ...rest } = l;
                            setForm({
                              ...rest,
                              amount: Math.abs(rest.amount),
                              paymentMethod: rest.paymentMethod || "Cash",
                            });
                            setOpen(true);
                          }}
                          className="rounded bg-ink-850 px-2 py-0.5 font-mono text-[10px] text-ink-200 ring-1 ring-ink-700 hover:bg-ink-800 hover:text-court-300 transition-colors"
                        >
                          Edit
                        </button>
                      )}
                      {canDeleteLedgerEntry(l) && (
                        <button
                          type="button"
                          onClick={() => setDeletingLedgerEntry(l)}
                          className="rounded bg-bad/15 px-2 py-0.5 font-mono text-[10px] text-bad ring-1 ring-bad/30 hover:bg-bad/25 transition-colors"
                        >
                          Undo / Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
            <div className="p-3 border-t border-ink-800">
              <Pagination
                page={page}
                pageSize={pageSize}
                total={filteredLedger.length}
                setPage={setPage}
              />
            </div>
          </div>
        </Panel>
      )}

      <Modal
        open={open}
        title={editing ? "Edit ledger entry" : "New ledger entry"}
        onClose={() => setOpen(false)}
        onSubmit={submit}
        submitLabel={editing ? "Save changes" : "Add entry"}
        wide
      >
        <div className="grid items-end gap-3 p-4 sm:grid-cols-2">
          <Field label="Date">
            <Input type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
          </Field>
          <Field label="Account">
            <Select
              value={form.account}
              onChange={(v) => setForm({ ...form, account: v })}
              options={accounts}
            />
          </Field>
          <Field label="Description">
            <Input value={form.entry || ""} onChange={(v) => setForm({ ...form, entry: v })} />
          </Field>
          <Field label="Note (Optional)">
            <Input value={form.note || ""} onChange={(v) => setForm({ ...form, note: v })} />
          </Field>
          {!isBranchScoped && (
            <Field label="Branch (Optional)">
              <Select
                value={form.branch || ""}
                onChange={(v) => setForm({ ...form, branch: v })}
                options={["", ...db.branches.map((b) => b.name)]}
              />
            </Field>
          )}
          <Field label="Type">
            <Select
              value={form.type}
              onChange={(v) => setForm({ ...form, type: v as LedgerEntry["type"] })}
              options={["Revenue", "Expense"]}
            />
          </Field>
          <Field label="Amount" hint={`${primaryCurrency}, positive number`}>
            <Input
              type="number"
              value={String(form.amount)}
              onChange={(v) => setForm({ ...form, amount: Number(v) || 0 })}
            />
          </Field>
          <Field label="Status">
            <Select
              value={form.status}
              onChange={(v) => setForm({ ...form, status: v as LedgerEntry["status"] })}
              options={["Collected", "Paid", "Pending"]}
            />
          </Field>
          <Field label="Payment Method">
            <Select
              value={form.paymentMethod || "Cash"}
              onChange={(v) => setForm({ ...form, paymentMethod: v })}
              options={[...SUPPORTED_PAYMENT_METHODS]}
            />
          </Field>
          <Field label="Module / Cost Center">
            <Select
              value={form.module || "general"}
              onChange={(v) => setForm({ ...form, module: v as LedgerModule })}
              options={MODULE_COST_CENTER_OPTIONS}
            />
          </Field>

          {(form.isAdvance ||
            form.account === "Coach Salaries" ||
            form.account === "Coach Payroll Expense" ||
            Boolean(form.coachId)) && (
            <div className="col-span-1 sm:col-span-2 grid items-end gap-3 sm:grid-cols-2 rounded-lg border border-amber-500/30 bg-amber-950/20 p-3">
              <Field
                label="Link / Validate Advance Against Sessions"
                hint="Number of coaching sessions covered or offset by this advance"
              >
                <Input
                  type="number"
                  value={String(form.linkedAdvanceSessionsCount || 0)}
                  onChange={(v) =>
                    setForm({
                      ...form,
                      isAdvance: true,
                      linkedAdvanceSessionsCount: Math.max(0, Number(v) || 0),
                    })
                  }
                />
              </Field>
              <Field
                label="Advance / On-Account Reason"
                hint="Recorded justification for coach advance payment"
              >
                <Input
                  value={form.advanceReason || ""}
                  onChange={(v) =>
                    setForm({
                      ...form,
                      isAdvance: Boolean(v.trim()) || form.isAdvance,
                      advanceReason: v,
                    })
                  }
                  placeholder="e.g. Prepaid 4 sessions for May"
                />
              </Field>
            </div>
          )}

          <div className="col-span-1 sm:col-span-2 pt-2 border-t border-ink-800">
            <Field
              label="Receipt / Invoice Voucher (PDF or Image)"
              hint="Max 25MB · High-res camera photos automatically compressed for fast upload"
            >
              <div className="flex flex-col sm:flex-row gap-2 items-start sm:items-center">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf,.pdf,.jpg,.jpeg,.png,.webp"
                  disabled={receiptUploading}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      setReceiptUploading(true);
                      setReceiptUploadStatus("Validating file & optimizing photo...");
                      const targetId = editing?.id || `l-${Date.now().toString(36)}`;
                      const url = await uploadAccountingReceipt(tenantId, targetId, file, (msg) =>
                        setReceiptUploadStatus(msg),
                      );
                      setForm({ ...form, attachment: url });
                      toast.success("Receipt verified & uploaded to Cloud Storage.");
                    } catch (err) {
                      console.error("Receipt upload failed:", err);
                      const errMsg =
                        err instanceof Error ? err.message : "Failed to upload receipt.";
                      toast.error(errMsg);
                    } finally {
                      setReceiptUploading(false);
                      setReceiptUploadStatus("");
                    }
                  }}
                  className="w-full rounded-md bg-ink-850 px-3 py-2 font-ui text-sm text-ink-200 ring-1 ring-ink-700 file:mr-3 file:rounded file:border-0 file:bg-court-500 file:px-2 file:py-1 file:text-xs file:font-semibold file:text-ink-950 disabled:opacity-50"
                />
                {form.attachment && (
                  <div className="flex items-center gap-2 whitespace-nowrap">
                    <a
                      href={form.attachment}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-[11px] text-court-400 bg-court-500/10 px-2.5 py-1.5 rounded ring-1 ring-court-400/30 hover:bg-court-500/20"
                    >
                      View Receipt
                    </a>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, attachment: undefined })}
                      className="text-bad hover:underline font-mono text-[10px]"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
              {receiptUploading && (
                <div className="mt-1.5 flex items-center gap-2 font-mono text-[11px] text-court-400">
                  <div className="h-1.5 w-1.5 rounded-full bg-court-400 animate-ping" />
                  <span>
                    {receiptUploadStatus || "Uploading receipt to Firebase Cloud Storage..."}
                  </span>
                </div>
              )}
            </Field>
          </div>
        </div>
      </Modal>

      {/* Monthly Invoicing Generator Modal */}
      <MonthlyInvoicingModal
        open={invoicingModalOpen}
        onClose={() => setInvoicingModalOpen(false)}
        onSuccess={() => {
          setActiveTab("invoices");
        }}
        initialMonth={targetMonth}
        initialYear={targetYear}
        initialBranch={targetBranch}
        isBranchScoped={isBranchScoped}
        userBranch={userBranch}
      />

      {/* Family Bundles & Sibling Discounts Modal */}
      <FamilyBundledInvoicingModal
        open={familyModalOpen}
        onClose={() => setFamilyModalOpen(false)}
        onSuccess={() => {
          setActiveTab("invoices");
        }}
        initialMonth={targetMonth}
        initialYear={targetYear}
        initialBranch={targetBranch}
        isBranchScoped={isBranchScoped}
        userBranch={userBranch}
      />

      {/* Verified Sessions Details Modal */}
      <Modal
        open={Boolean(selectedCoachSessions)}
        title={`${selectedCoachSessions?.coachName || "Coach"} — Verified Sessions`}
        meta={`Attendance audit for ${payrollComputation.periodLabel} · ${selectedCoachSessions?.verifiedCompletedSessionsCount || 0} verified sessions`}
        onClose={() => setSelectedCoachSessions(null)}
        wide
      >
        <div className="p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded bg-ink-950 border border-ink-800 text-xs">
            <div>
              <span className="text-ink-400">Default Rate: </span>
              <strong className="text-court-400 font-mono">
                {money(selectedCoachSessions?.rate || 0)} / session
              </strong>
            </div>
            <div>
              <span className="text-ink-400">Calculated Payout: </span>
              <strong className="text-court-400 font-mono">
                {money(selectedCoachSessions?.totalPayout || 0)}
              </strong>
              {(selectedCoachSessions?.totalTransportEarned || 0) > 0 && (
                <span className="ml-1.5 font-mono text-[10px] text-ink-300">
                  ({money(selectedCoachSessions?.totalBaseEarned || 0)} Sess +{" "}
                  {money(selectedCoachSessions?.totalTransportEarned || 0)} Transport)
                </span>
              )}
            </div>
            <div>
              <span className="text-ink-400">Branch: </span>
              <strong className="text-ink-200">
                {selectedCoachSessions?.branch || "Headquarters"}
              </strong>
            </div>
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-mono font-semibold uppercase tracking-wider text-ink-400">
              Verified Completed Sessions ({selectedCoachSessions?.verifiedSessions.length || 0})
            </h4>
            {selectedCoachSessions?.verifiedSessions.length === 0 ? (
              <div className="p-4 rounded bg-ink-950 border border-ink-800 text-center text-xs text-ink-400">
                No verified completed sessions for this period.
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {selectedCoachSessions?.verifiedSessions.map((s) => (
                  <div
                    key={s.sessionId || s.id}
                    className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded bg-ink-950 border border-ink-800 text-xs"
                  >
                    <div>
                      <div className="font-semibold text-ink-100 flex items-center gap-2 flex-wrap">
                        <span>{s.title}</span>
                        <span className="rounded bg-court-500/10 px-1.5 py-0.5 text-[10px] font-mono text-court-300">
                          {s.kind}
                        </span>
                        {s.isOverridden && (
                          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-mono text-amber-300">
                            Custom Session Rate
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-ink-400 mt-0.5">
                        {s.date} · {s.time} · {s.court}
                      </div>
                      <div className="text-[10px] font-mono text-court-300 mt-0.5">
                        Session Fee: {money(s.baseSessionFee)}
                        {s.transportFee > 0 ? ` + Transport: +${money(s.transportFee)}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="rounded bg-good/15 px-2 py-0.5 text-[10px] font-mono text-good font-semibold">
                        ✓ {s.attendanceCount} check-ins verified
                      </span>
                      <span className="font-mono text-xs text-court-400 font-bold">
                        +{money(s.totalSessionEarned)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedCoachSessions && selectedCoachSessions.unloggedSessions.length > 0 && (
            <div className="space-y-2 pt-2 border-t border-ink-850">
              <h4 className="text-xs font-mono font-semibold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                <span>⚠️</span> Excluded Unlogged Sessions (
                {selectedCoachSessions.unloggedSessions.length})
              </h4>
              <p className="text-[11px] text-ink-400">
                The following sessions were marked completed but do not have verified player/coach
                attendance records, so they are excluded from payroll:
              </p>
              <div className="space-y-1.5 max-h-36 overflow-y-auto">
                {selectedCoachSessions.unloggedSessions.map((s) => (
                  <div
                    key={s.sessionId}
                    className="flex items-center justify-between p-2 rounded bg-amber-950/20 border border-amber-800/30 text-xs"
                  >
                    <div>
                      <span className="font-medium text-ink-200">{s.title}</span>
                      <span className="text-[11px] font-mono text-ink-400 ml-2">
                        {s.date} {s.time}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-amber-400">No attendance logs</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Disburse Single Coach Payroll Modal */}
      <Modal
        open={Boolean(disburseModalCoach)}
        title={`Disburse Payroll — ${disburseModalCoach?.coachName || "Coach"}`}
        meta={`Pay Period: ${payrollComputation.periodLabel} · Verified Due: ${money(Math.max(0, disburseModalCoach?.netBalance || 0))}`}
        onClose={() => setDisburseModalCoach(null)}
        onSubmit={(e) => {
          if (e && typeof e.preventDefault === "function") {
            e.preventDefault();
          }
          if (disburseModalCoach) {
            handleDisbursePayroll(
              disburseModalCoach,
              disbursePaymentMethod,
              disburseNote,
              disburseAmount,
              disburseAdvanceReason,
              disburseLinkedSessionsCount,
            );
          }
        }}
        submitLabel={
          isDisbursing ? "Recording Payout..." : `Disburse ${money(disburseAmount || 0)}`
        }
      >
        <div className="p-4 space-y-4">
          <div className="rounded-lg bg-ink-950 p-3 border border-ink-800 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-ink-400">Coach:</span>
              <strong className="text-ink-100">{disburseModalCoach?.coachName}</strong>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-ink-400">Verified Completed Sessions:</span>
              <span className="font-mono text-ink-200 font-bold">
                {disburseModalCoach?.verifiedCompletedSessionsCount} sessions
              </span>
            </div>
            {disburseModalCoach?.rateType === "hourly" && (
              <div className="flex justify-between text-xs">
                <span className="text-ink-400">Verified Completed Hours:</span>
                <span className="font-mono text-ink-200 font-bold">
                  {disburseModalCoach?.verifiedCompletedHours} hrs
                </span>
              </div>
            )}
            <div className="flex justify-between text-xs">
              <span className="text-ink-400">Configured Rate:</span>
              <span className="font-mono text-ink-200">
                {money(disburseModalCoach?.rate || 0)}{" "}
                {disburseModalCoach?.rateType === "hourly" ? "/ hr" : "/ session"}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-ink-400">Earned This Period (Verified):</span>
              <span className="font-mono text-court-400 font-bold">
                {money(disburseModalCoach?.totalEarned || 0)}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-ink-400">Already Disbursed This Period:</span>
              <span className="font-mono text-ink-200">
                {money(disburseModalCoach?.totalDisbursed || 0)}
              </span>
            </div>
            <div className="flex justify-between text-sm font-bold pt-2 border-t border-ink-800">
              <span className="text-ink-100">Net Balance / Verified Due:</span>
              <span
                className={`font-mono ${
                  (disburseModalCoach?.netBalance || 0) < 0 ? "text-amber-400" : "text-court-400"
                }`}
              >
                {(disburseModalCoach?.netBalance || 0) < 0
                  ? `Advance / On Account: -${money(Math.abs(disburseModalCoach?.netBalance || 0))} (Prepaid / Borrowed)`
                  : money(disburseModalCoach?.netBalance || 0)}
              </span>
            </div>
          </div>

          <Field
            label={`Disbursement Amount (${primaryCurrency})`}
            hint="Enter verified payout or a custom / advance amount on account"
          >
            <Input
              type="number"
              value={String(disburseAmount)}
              onChange={(v) => setDisburseAmount(Math.max(0, Number(v) || 0))}
            />
          </Field>

          {disburseModalCoach &&
            (disburseAmount > Math.max(0, disburseModalCoach.netBalance) ||
              disburseModalCoach.verifiedCompletedSessionsCount === 0) && (
              <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 p-3.5 space-y-3">
                <div className="text-xs font-mono text-amber-300 leading-relaxed">
                  ⚠️ <strong>Advance / Custom Payment Warning:</strong> This coach currently has{" "}
                  <strong>{money(Math.max(0, disburseModalCoach.netBalance))}</strong> in unpaid
                  verified sessions. Paying <strong>{money(disburseAmount)}</strong> will record an{" "}
                  <strong>
                    Advance / On-Account balance of{" "}
                    {money(
                      Math.max(0, disburseAmount - Math.max(0, disburseModalCoach.netBalance)),
                    )}
                  </strong>
                  .
                </div>
                <Field
                  label="Mandatory Reason for Advance / Custom Payment *"
                  hint="Required: explain why an advance or unverified payment is being issued"
                >
                  <Input
                    value={disburseAdvanceReason}
                    onChange={setDisburseAdvanceReason}
                    placeholder="e.g. Salary advance requested for May — to be deducted from upcoming sessions"
                  />
                </Field>
                <Field
                  label="Link / Validate Advance Against Sessions (Optional)"
                  hint="How many future or unverified coaching sessions does this advance cover?"
                >
                  <Input
                    type="number"
                    value={String(disburseLinkedSessionsCount)}
                    onChange={(v) => setDisburseLinkedSessionsCount(Math.max(0, Number(v) || 0))}
                  />
                </Field>
              </div>
            )}

          <Field label="Disbursement Method">
            <Select
              value={disbursePaymentMethod}
              onChange={setDisbursePaymentMethod}
              options={["Bank Transfer", "Direct Deposit", "Cash", "Check", "Mobile Money"]}
            />
          </Field>

          <Field label="Accounting Ledger Note (Optional)">
            <Input
              value={disburseNote}
              onChange={setDisburseNote}
              placeholder="e.g. Wire reference #W-9821, verified by Head of Finance"
            />
          </Field>

          <div className="rounded bg-ink-950 p-3 border border-ink-800 text-[11px] text-ink-300 flex items-start gap-2">
            <span className="text-court-400 font-bold">⚡</span>
            <span>
              <strong>Accounting Action:</strong> Submitting will create a verified debit entry
              under category <code className="font-mono text-court-300">Coach Payroll Expense</code>{" "}
              in the accounting ledger and update the coach&apos;s balance (supporting negative
              Advance / On-Account balances when prepaid).
            </span>
          </div>
        </div>
      </Modal>

      {/* Batch Disburse Confirmation Modal */}
      <Modal
        open={batchDisburseOpen}
        title="Disburse All Verified Coach Payroll"
        meta={`Pay Period: ${payrollComputation.periodLabel}`}
        onClose={() => setBatchDisburseOpen(false)}
        onSubmit={handleBatchDisbursePayroll}
        submitLabel={`Confirm & Disburse All (${money(payrollComputation.totalPendingPayout)})`}
      >
        <div className="p-4 space-y-4">
          <div className="rounded-lg bg-ink-950 p-3.5 border border-ink-800 space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-ink-400">Eligible Coaches:</span>
              <strong className="text-ink-100">
                {payrollComputation.pendingDisbursementCoachesCount} coaches
              </strong>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-ink-400">Total Verified Sessions:</span>
              <span className="font-mono text-ink-200 font-bold">
                {payrollComputation.totalVerifiedSessions} sessions
              </span>
            </div>
            <div className="flex justify-between text-sm font-bold pt-2 border-t border-ink-800">
              <span className="text-ink-100">Total Batch Payout:</span>
              <span className="text-court-400 font-mono">
                {money(payrollComputation.totalPendingPayout)}
              </span>
            </div>
          </div>

          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            <div className="text-[11px] font-mono text-ink-400 uppercase">Coaches in Batch:</div>
            {filteredPayrollRows
              .filter((r) => !r.isDisbursed && r.totalPayout > 0)
              .map((r) => (
                <div
                  key={r.coachId}
                  className="flex items-center justify-between p-2 rounded bg-ink-950 border border-ink-800 text-xs"
                >
                  <span className="font-semibold text-ink-200">{r.coachName}</span>
                  <span className="font-mono text-court-400">
                    {r.verifiedCompletedSessionsCount} sess × {money(r.rate)} ={" "}
                    {money(r.totalPayout)}
                  </span>
                </div>
              ))}
          </div>

          <div className="rounded bg-court-500/10 p-3 border border-court-500/20 text-[11px] text-ink-300 flex items-start gap-2">
            <span className="text-court-400 font-bold">✓</span>
            <span>
              Creates individual debit transactions under{" "}
              <code className="font-mono text-court-300">Coach Payroll Expense</code> for every
              eligible coach in the ledger, with deduplication protection.
            </span>
          </div>
        </div>
      </Modal>

      {/* Overdue Deadlines & Suspension Audit Modal */}
      <Modal
        open={suspensionAuditModalOpen}
        onClose={() => setSuspensionAuditModalOpen(false)}
        title="🔒 Overdue Deadlines & Suspension Audit"
        meta="Server-authoritative evaluation of player payment deadlines & account status"
        wide
      >
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
            <div className="rounded bg-ink-950 p-3 border border-ink-800">
              <div className="text-[11px] font-mono text-ink-400">TOTAL EVALUATED</div>
              <div className="text-lg font-bold text-ink-100">
                {suspensionAuditResult?.evaluated || 0}
              </div>
            </div>
            <div className="rounded bg-ink-950 p-3 border border-ink-800">
              <div className="text-[11px] font-mono text-amber-400">SOFT FLAGGED</div>
              <div className="text-lg font-bold text-amber-400">
                {suspensionAuditResult?.flaggedSoft || 0}
              </div>
            </div>
            <div className="rounded bg-ink-950 p-3 border border-ink-800">
              <div className="text-[11px] font-mono text-red-400">LOCKED INACTIVE</div>
              <div className="text-lg font-bold text-red-400">
                {suspensionAuditResult?.flaggedInactive || 0}
              </div>
            </div>
            <div className="rounded bg-ink-950 p-3 border border-ink-800">
              <div className="text-[11px] font-mono text-court-400">COMPLIANT / OK</div>
              <div className="text-lg font-bold text-court-400">
                {suspensionAuditResult?.unchanged || 0}
              </div>
            </div>
          </div>

          <div className="rounded bg-ink-950 p-3 border border-ink-800 text-xs text-ink-300 flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="text-ink-400">Academy Deadlines: </span>
              <strong className="text-ink-200">Soft: {db.academy?.softDeadline ?? 15} days</strong>
              <span className="text-ink-500 mx-2">|</span>
              <strong className="text-ink-200">
                Hard (Lockout): {db.academy?.hardDeadline ?? 30} days
              </strong>
              <span className="text-ink-500 mx-2">|</span>
              <span className="text-emerald-400 font-mono text-[11px]">
                100% Scholarship Athletes Exempt
              </span>
            </div>
            <span className="font-mono text-[11px] text-court-400 bg-court-500/10 px-2 py-0.5 rounded border border-court-500/20">
              Server Authoritative
            </span>
          </div>

          {suspensionAuditResult && suspensionAuditResult.changes.length > 0 ? (
            <div className="space-y-2">
              <div className="text-xs font-mono font-semibold text-ink-300 uppercase tracking-wide">
                Status Modifications Applied ({suspensionAuditResult.changes.length}):
              </div>
              <div className="max-h-64 overflow-y-auto rounded border border-ink-800 divide-y divide-ink-800/80 bg-ink-950">
                {suspensionAuditResult.changes.map((c) => (
                  <div key={c.playerId} className="p-2.5 flex items-center justify-between text-xs">
                    <div className="space-y-0.5">
                      <div className="font-semibold text-ink-100">{c.playerName}</div>
                      <div className="text-[11px] font-mono text-ink-400">
                        Old Status: <span className="text-ink-300">{c.oldStatus}</span> · Overdue:{" "}
                        <strong className="text-amber-400">{c.daysOverdue} days</strong>
                      </div>
                    </div>
                    <div>
                      <Chip
                        tone={
                          c.newStatus === "Inactive"
                            ? "bad"
                            : c.newStatus === "Soft flag"
                              ? "warn"
                              : "neutral"
                        }
                      >
                        {c.newStatus}
                      </Chip>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-lg bg-court-500/5 border border-court-500/20 p-4 text-center space-y-1">
              <div className="text-court-400 text-sm font-semibold">
                ✓ All Player Accounts Compliant
              </div>
              <p className="text-xs text-ink-400 max-w-md mx-auto">
                No player balance is currently past the soft or hard payment deadlines. All active
                accounts are in good standing or within the acceptable billing grace window.
              </p>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button
              type="button"
              variant="primary"
              onClick={() => setSuspensionAuditModalOpen(false)}
            >
              Done
            </Button>
          </div>
        </div>
      </Modal>

      {/* Cloud Function Automation Specs & Architecture Modal */}
      <Modal
        open={cronHistoryModalOpen}
        onClose={() => setCronHistoryModalOpen(false)}
        title="📋 Server-Authoritative Billing Cron Architecture"
        meta="Technical specifications for scheduled monthly tuition generation & suspension engine"
        wide
      >
        <div className="p-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="rounded-lg bg-ink-950 p-4 border border-ink-800 space-y-2">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-court-400" />
                <span className="text-xs font-mono font-bold text-ink-200">
                  MONTHLY TUITION GENERATOR
                </span>
              </div>
              <div className="text-xs text-ink-300 space-y-1">
                <div>
                  <span className="text-ink-400 font-mono">Schedule:</span>{" "}
                  <code className="text-court-300 font-mono">0 0 1 * *</code> (1st of month at 00:00
                  UTC)
                </div>
                <div>
                  <span className="text-ink-400 font-mono">Function:</span>{" "}
                  <code className="text-court-300 font-mono">scheduledMonthlyBillingCron</code>
                </div>
                <div>
                  <span className="text-ink-400 font-mono">Trigger:</span> Server-Authoritative
                  Cloud Scheduler
                </div>
                <div>
                  <span className="text-ink-400 font-mono">Idempotency Key:</span>{" "}
                  <code className="text-court-300 font-mono">
                    ${`{playerId}_${`{year}`}_${`{monthCode}`}`}
                  </code>
                </div>
              </div>
              <p className="text-[11px] text-ink-400 leading-relaxed pt-1">
                Generates tuition invoices for all active/soft-flagged players across each tenant.
                Calculates squad tier fees and increments player balances using atomic Firestore
                write batches.
              </p>
            </div>

            <div className="rounded-lg bg-ink-950 p-4 border border-ink-800 space-y-2">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                <span className="text-xs font-mono font-bold text-ink-200">
                  DAILY OVERDUE SUSPENSION CRON
                </span>
              </div>
              <div className="text-xs text-ink-300 space-y-1">
                <div>
                  <span className="text-ink-400 font-mono">Schedule:</span>{" "}
                  <code className="text-amber-300 font-mono">0 2 * * *</code> (Daily at 02:00 UTC)
                </div>
                <div>
                  <span className="text-ink-400 font-mono">Function:</span>{" "}
                  <code className="text-amber-300 font-mono">scheduledDailySuspensionCron</code>
                </div>
                <div>
                  <span className="text-ink-400 font-mono">Trigger:</span> Server-Authoritative
                  Cloud Scheduler
                </div>
                <div>
                  <span className="text-ink-400 font-mono">Deadlines:</span> Soft (
                  {db.academy?.softDeadline ?? 15}d), Hard ({db.academy?.hardDeadline ?? 30}d)
                </div>
              </div>
              <p className="text-[11px] text-ink-400 leading-relaxed pt-1">
                Daily server evaluation of unpaid invoices against the server clock. Automatically
                applies "Soft flag" warnings and "Inactive" lockout flags without requiring an
                administrator to log in.
              </p>
            </div>
          </div>

          <div className="rounded-lg bg-ink-950 p-4 border border-ink-800 space-y-3">
            <div className="text-xs font-mono font-semibold text-ink-200 uppercase tracking-wide">
              Key Engineering Benefits
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-ink-300">
              <div className="p-3 rounded bg-ink-900 border border-ink-800 space-y-1">
                <div className="font-semibold text-court-400">Zero Browser Dependency</div>
                <div className="text-[11px] text-ink-400">
                  Billing runs automatically even if all staff are on leave or browser tabs close
                  unexpectedly mid-operation.
                </div>
              </div>
              <div className="p-3 rounded bg-ink-900 border border-ink-800 space-y-1">
                <div className="font-semibold text-court-400">Strict Idempotency</div>
                <div className="text-[11px] text-ink-400">
                  Immutable composite keys prevent duplicate invoice generation or double-charging
                  across concurrent sessions.
                </div>
              </div>
              <div className="p-3 rounded bg-ink-900 border border-ink-800 space-y-1">
                <div className="font-semibold text-court-400">Atomic Batch Integrity</div>
                <div className="text-[11px] text-ink-400">
                  Updates to invoices, player balances, and status changes are committed in chunked
                  batches (≤ 200 items / 400 ops).
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button type="button" variant="primary" onClick={() => setCronHistoryModalOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </Modal>

      {/* Record Cash Payment Modal */}
      <Modal
        open={cashPaymentModalOpen}
        onClose={() => {
          if (!isRecordingPayment) {
            setCashPaymentModalOpen(false);
            setSelectedInvoiceForPayment(null);
          }
        }}
        title="Record Cash Payment"
        meta="Offline / In-Person Payment Entry"
        onSubmit={handleRecordCashPayment}
        submitLabel={
          isRecordingPayment
            ? "Recording Cash Entry..."
            : `Confirm & Record ${money(selectedInvoiceForPayment?.amount || 0)}`
        }
      >
        <div className="space-y-4">
          {/* Offline / In-Person Payment Indicator Callout */}
          <div className="rounded-lg bg-court-500/10 border border-court-500/20 p-3.5 flex items-start gap-3">
            <span className="mt-1 inline-block h-2 w-2 rounded-full bg-court-400 shrink-0 animate-pulse" />
            <div className="text-xs space-y-1">
              <div className="font-mono font-semibold text-court-300 flex items-center gap-2">
                <span>Offline / In-Person Payment Only</span>
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-ink-900 text-ink-300 border border-ink-800">
                  Gateways Disabled
                </span>
              </div>
              <div className="text-ink-300 leading-relaxed">
                Online gateway integrations (Stripe, Tap, credit cards) are disabled. All receipts
                must be collected in person or via direct offline bank transfer and assigned to an
                authorized staff collector.
              </div>
            </div>
          </div>

          {selectedInvoiceForPayment && (
            <div className="rounded-lg bg-ink-950 p-3.5 border border-ink-800 grid grid-cols-2 gap-3 text-xs font-mono">
              <div>
                <span className="text-ink-400 block text-[10px] uppercase">Invoice #</span>
                <span className="text-ink-100 font-semibold">
                  {selectedInvoiceForPayment.invoiceNumber}
                </span>
              </div>
              <div>
                <span className="text-ink-400 block text-[10px] uppercase">Amount Due</span>
                <span className="text-court-400 font-bold text-sm">
                  {money(selectedInvoiceForPayment.amount)}
                </span>
              </div>
              <div>
                <span className="text-ink-400 block text-[10px] uppercase">Student / Player</span>
                <span className="text-ink-200">{selectedInvoiceForPayment.playerName}</span>
              </div>
              <div>
                <span className="text-ink-400 block text-[10px] uppercase">Billing Period</span>
                <span className="text-ink-200">
                  {selectedInvoiceForPayment.billingMonth} {selectedInvoiceForPayment.year}
                </span>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <Field label="Payment Method">
              <Select
                value={cashPaymentMethod}
                onChange={(v) => setCashPaymentMethod(v as SupportedPaymentMethod)}
                options={[...SUPPORTED_PAYMENT_METHODS]}
              />
            </Field>

            <Field label="Authorized Collector Name">
              <Input
                value={authorizedCollector}
                onChange={setAuthorizedCollector}
                placeholder="Full name of staff collecting cash"
              />
            </Field>

            <Field label="Cash Receipt / Reference Notes (Optional)">
              <Input
                value={paymentNotes}
                onChange={setPaymentNotes}
                placeholder="e.g. In-person counter drawer #1, physical receipt #, or cheque #"
              />
            </Field>
          </div>
        </div>
      </Modal>

      {/* Ledger Entry Deletion Confirmation Modal */}
      <Modal
        title="Delete Ledger Entry"
        open={Boolean(deletingLedgerEntry)}
        onClose={() => setDeletingLedgerEntry(null)}
      >
        {deletingLedgerEntry && (
          <div className="space-y-4 p-4">
            <p className="text-sm text-ink-200">
              Are you sure you want to permanently delete the ledger entry for{" "}
              <strong className="text-ink-100">
                {deletingLedgerEntry.entry || deletingLedgerEntry.account}
              </strong>{" "}
              (
              <span className="font-mono text-xs text-court-300">
                {money(Math.abs(deletingLedgerEntry.amount))}
              </span>
              )?
            </p>
            <p className="text-xs text-ink-400">
              Date: {deletingLedgerEntry.date} · Type: {deletingLedgerEntry.type} · Account:{" "}
              {deletingLedgerEntry.account}
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button variant="outline" size="sm" onClick={() => setDeletingLedgerEntry(null)}>
                Cancel
              </Button>
              <Button variant="danger" size="sm" onClick={confirmDeleteLedgerEntry}>
                Confirm & Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}

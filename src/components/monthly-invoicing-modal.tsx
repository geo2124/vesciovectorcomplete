import { useState, useMemo, useEffect } from "react";
import { useDB, type InvoicingResult, type Player } from "@/lib/data-store";
import { money, Chip, Field, Input, Select, Modal, Button } from "@/components/kit";
import { calculatePlayerMonthlyFee } from "@/lib/payments";
import {
  Calendar,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Info,
  Search,
  ShieldCheck,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { toast } from "sonner";

export interface MonthlyInvoicingModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: (result: InvoicingResult) => void;
  initialMonth?: string;
  initialYear?: number;
  initialBranch?: string;
  isBranchScoped?: boolean;
  userBranch?: string;
}

const MONTH_NAMES = [
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

export function MonthlyInvoicingModal({
  open,
  onClose,
  onSuccess,
  initialMonth,
  initialYear,
  initialBranch = "",
  isBranchScoped = false,
  userBranch = "",
}: MonthlyInvoicingModalProps) {
  const { db, generateMonthlyInvoices } = useDB();

  const currentMonthIdx = new Date().getMonth();
  const [targetMonth, setTargetMonth] = useState<string>(
    () => initialMonth || MONTH_NAMES[currentMonthIdx],
  );
  const [targetYear, setTargetYear] = useState<number>(
    () => initialYear || new Date().getFullYear(),
  );
  const [targetBranch, setTargetBranch] = useState<string>(() =>
    isBranchScoped ? userBranch : initialBranch,
  );
  const [targetSquad, setTargetSquad] = useState<string>("All");
  const [activeSubTab, setActiveSubTab] = useState<"overview" | "roster" | "settings">("overview");

  // Due Date & Custom Description options
  const [dueDatePreset, setDueDatePreset] = useState<"15th" | "eom" | "net15" | "net30" | "custom">(
    "15th",
  );
  const [customDueDate, setCustomDueDate] = useState<string>("");
  const [customMemo, setCustomMemo] = useState<string>("Tuition Fee · {MONTH} {YEAR} · {PROGRAM}");
  const [notifyAdmins, setNotifyAdmins] = useState<boolean>(true);

  // Search & Filters inside Athlete Roster Tab
  const [rosterQuery, setRosterQuery] = useState("");
  const [rosterFilter, setRosterFilter] = useState<"all" | "pending" | "alreadyBilled">("all");

  // Excluded athlete IDs (unchecked in roster)
  const [excludedPlayerIds, setExcludedPlayerIds] = useState<Set<string>>(new Set());

  // Sibling discount toggle
  const [applySiblingDiscounts, setApplySiblingDiscounts] = useState<boolean>(true);

  // Processing state
  const [isProcessing, setIsProcessing] = useState(false);

  // Reset target branch if user is branch scoped
  useEffect(() => {
    if (isBranchScoped && userBranch) {
      setTargetBranch(userBranch);
    }
  }, [isBranchScoped, userBranch]);

  // Derive 2-digit monthCode (e.g. "05")
  const monthCode = useMemo(() => {
    const idx = MONTH_NAMES.findIndex((m) => m.toLowerCase() === targetMonth.toLowerCase());
    return String((idx !== -1 ? idx : currentMonthIdx) + 1).padStart(2, "0");
  }, [targetMonth, currentMonthIdx]);

  // Compute calculated Due Date string (YYYY-MM-DD)
  const computedDueDate = useMemo(() => {
    if (dueDatePreset === "custom" && customDueDate) {
      return customDueDate;
    }
    const y = targetYear;
    const m = monthCode;
    if (dueDatePreset === "15th") {
      return `${y}-${m}-15`;
    }
    if (dueDatePreset === "eom") {
      const lastDay = new Date(y, parseInt(m, 10), 0).getDate();
      return `${y}-${m}-${String(lastDay).padStart(2, "0")}`;
    }
    if (dueDatePreset === "net15") {
      const d = new Date();
      d.setDate(d.getDate() + 15);
      return d.toISOString().slice(0, 10);
    }
    if (dueDatePreset === "net30") {
      const d = new Date();
      d.setDate(d.getDate() + 30);
      return d.toISOString().slice(0, 10);
    }
    return `${y}-${m}-15`;
  }, [dueDatePreset, customDueDate, targetYear, monthCode]);

  // Existing invoices index (for idempotency checks)
  const existingInvoiceMap = useMemo(() => {
    const map = new Map<string, string>(); // invoiceId -> invoiceNumber
    (db.invoices || []).forEach((inv) => {
      map.set(inv.id, inv.invoiceNumber || inv.id);
    });
    return map;
  }, [db.invoices]);

  // Filter all active athletes in scope
  const activeInScopePlayers = useMemo(() => {
    const effectiveBranch = isBranchScoped ? userBranch : targetBranch;
    const squadFilterLower = targetSquad !== "All" ? targetSquad.toLowerCase() : "";

    return (db.players || []).filter((p) => {
      const isActive = p.status === "Active" || p.status === "Idle" || p.status === "Soft flag";
      const branchMatch =
        !effectiveBranch || (p.branch && p.branch.toLowerCase() === effectiveBranch.toLowerCase());
      const squadMatch =
        !squadFilterLower ||
        (p.teams && p.teams.some((tm) => tm.toLowerCase() === squadFilterLower));
      return isActive && branchMatch && squadMatch;
    });
  }, [db.players, isBranchScoped, userBranch, targetBranch, targetSquad]);

  // Group in-scope athletes by guardian to identify multi-athlete families and sibling discounts
  const siblingDiscountMap = useMemo(() => {
    if (!applySiblingDiscounts)
      return new Map<string, { rank: number; discountPercent: number; discountAmount: number }>();
    const buckets = new Map<string, Player[]>();

    activeInScopePlayers.forEach((p) => {
      if (p.isScholarship === true) return;
      const normFam = p.familyId ? p.familyId.trim().toLowerCase() : "";
      const normPhone = (p.parentPhone || p.guardianPhone || "").replace(/[^\d+]/g, "").trim();
      const normName = (p.parent || p.guardianName || "").trim().toLowerCase();
      const key = normFam
        ? `fam_${normFam}`
        : normPhone
          ? `tel_${normPhone}`
          : normName
            ? `name_${normName}`
            : "";
      if (!key) return;
      const arr = buckets.get(key) || [];
      arr.push(p);
      buckets.set(key, arr);
    });

    const res = new Map<
      string,
      { rank: number; discountPercent: number; discountAmount: number }
    >();
    buckets.forEach((kids) => {
      if (kids.length >= 2) {
        const sorted = [...kids].sort((a, b) => {
          const feeA = calculatePlayerMonthlyFee(a, db.teams, db.branches);
          const feeB = calculatePlayerMonthlyFee(b, db.teams, db.branches);
          return feeB - feeA;
        });
        sorted.forEach((kid, idx) => {
          const rank = idx + 1;
          const discountPercent = rank === 2 ? 10 : rank >= 3 ? 15 : 0;
          const standard = calculatePlayerMonthlyFee(kid, db.teams, db.branches);
          const discountAmount = Math.round((standard * discountPercent) / 100);
          res.set(kid.id, { rank, discountPercent, discountAmount });
        });
      }
    });

    return res;
  }, [applySiblingDiscounts, activeInScopePlayers, db.teams, db.branches]);

  // Build elaborated athlete audit model
  const athleteAuditList = useMemo(() => {
    return activeInScopePlayers.map((p) => {
      const invoiceId = `${p.id}_${targetYear}_${monthCode}`;
      const isAlreadyBilled = existingInvoiceMap.has(invoiceId);
      const existingInvoiceNumber = existingInvoiceMap.get(invoiceId);
      const standardRate = calculatePlayerMonthlyFee(p, db.teams, db.branches);
      const sib = siblingDiscountMap.get(p.id);
      const discountPercent = sib?.discountPercent || 0;
      const discountAmount = sib?.discountAmount || 0;
      const rate = Math.max(0, standardRate - discountAmount);
      const isExempt = Boolean(p.isScholarship === true || rate <= 0);

      const currentBalance = typeof p.balance === "number" ? p.balance : 0;
      const isExcluded = excludedPlayerIds.has(p.id) || isExempt;
      const isSelected = !isAlreadyBilled && !isExcluded && !isExempt;
      const projectedBalance = isSelected ? currentBalance + rate : currentBalance;

      const squad = (db.teams || []).find((t) => p.teams && p.teams.includes(t.name));
      const squadName =
        p.teams && p.teams.length > 0 ? p.teams.join(" · ") : squad?.name || "Academy Program";
      const tier = squad?.tier || p.programTier || "Standard Program";

      return {
        player: p,
        invoiceId,
        isAlreadyBilled,
        existingInvoiceNumber,
        rate,
        standardRate,
        isExempt,
        siblingRank: sib?.rank,
        discountPercent,
        discountAmount,
        currentBalance,
        isExcluded,
        isSelected,
        projectedBalance,
        squadName,
        tier,
      };
    });
  }, [
    activeInScopePlayers,
    targetYear,
    monthCode,
    existingInvoiceMap,
    db.teams,
    db.branches,
    excludedPlayerIds,
    siblingDiscountMap,
  ]);

  // Filtered list for Roster Tab
  const filteredRoster = useMemo(() => {
    return athleteAuditList.filter((item) => {
      if (rosterFilter === "pending" && (item.isAlreadyBilled || item.isExcluded || item.isExempt))
        return false;
      if (rosterFilter === "alreadyBilled" && !item.isAlreadyBilled) return false;
      if (rosterQuery.trim()) {
        const q = rosterQuery.toLowerCase();
        const p = item.player;
        const matches =
          p.name.toLowerCase().includes(q) ||
          (p.guardianName && p.guardianName.toLowerCase().includes(q)) ||
          item.squadName.toLowerCase().includes(q) ||
          (p.branch && p.branch.toLowerCase().includes(q));
        if (!matches) return false;
      }
      return true;
    });
  }, [athleteAuditList, rosterFilter, rosterQuery]);

  // Aggregate stats
  const stats = useMemo(() => {
    const totalActive = athleteAuditList.length;
    const alreadyBilled = athleteAuditList.filter((a) => a.isAlreadyBilled);
    const exemptList = athleteAuditList.filter((a) => !a.isAlreadyBilled && a.isExempt);
    const pendingEligible = athleteAuditList.filter((a) => !a.isAlreadyBilled && !a.isExempt);
    const selectedToBill = pendingEligible.filter((a) => !a.isExcluded);
    const projectedReceivables = selectedToBill.reduce((sum, a) => sum + a.rate, 0);
    const avgFee = selectedToBill.length > 0 ? projectedReceivables / selectedToBill.length : 0;

    // Squad Breakdown
    const squadMap: Record<
      string,
      { squad: string; tier: string; rate: number; count: number; subtotal: number }
    > = {};

    selectedToBill.forEach((item) => {
      const key = `${item.squadName}__${item.rate}`;
      if (!squadMap[key]) {
        squadMap[key] = {
          squad: item.squadName,
          tier: item.tier,
          rate: item.rate,
          count: 0,
          subtotal: 0,
        };
      }
      squadMap[key].count += 1;
      squadMap[key].subtotal += item.rate;
    });

    return {
      totalActive,
      alreadyBilledCount: alreadyBilled.length,
      exemptCount: exemptList.length,
      pendingCount: selectedToBill.length,
      excludedCount: pendingEligible.length - selectedToBill.length,
      projectedReceivables,
      avgFee,
      breakdown: Object.values(squadMap).sort((a, b) => b.subtotal - a.subtotal),
    };
  }, [athleteAuditList]);

  // Handlers for athlete inclusion/exclusion
  const handleToggleAthlete = (playerId: string) => {
    setExcludedPlayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) {
        next.delete(playerId);
      } else {
        next.add(playerId);
      }
      return next;
    });
  };

  const handleSelectAllPending = () => {
    setExcludedPlayerIds(new Set());
    toast.info("Selected all pending athletes for this billing run.");
  };

  const handleDeselectAllPending = () => {
    const allPendingIds = athleteAuditList
      .filter((a) => !a.isAlreadyBilled)
      .map((a) => a.player.id);
    setExcludedPlayerIds(new Set(allPendingIds));
    toast.info("Deselected all athletes.");
  };

  // Export Pre-Billing Audit CSV
  const handleExportAuditCSV = () => {
    if (athleteAuditList.length === 0) {
      toast.info("No athletes to export.");
      return;
    }
    const headers = [
      "Player ID",
      "Player Name",
      "Branch",
      "Squad",
      "Program Tier",
      "Current Balance",
      "Tuition Rate",
      "Projected New Balance",
      "Audit Status",
      "Invoice ID",
      "Due Date",
    ];
    const rows = athleteAuditList.map((a) => [
      a.player.id,
      `"${a.player.name.replace(/"/g, '""')}"`,
      `"${(a.player.branch || "HQ").replace(/"/g, '""')}"`,
      `"${a.squadName.replace(/"/g, '""')}"`,
      `"${a.tier.replace(/"/g, '""')}"`,
      a.currentBalance,
      a.rate,
      a.projectedBalance,
      a.isAlreadyBilled ? "ALREADY_BILLED" : a.isExcluded ? "EXCLUDED" : "READY_TO_BILL",
      a.existingInvoiceNumber || a.invoiceId,
      computedDueDate,
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `billing_preview_${targetYear}_${monthCode}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Pre-billing audit spreadsheet downloaded.");
  };

  // Execute Invoicing Run
  const handleExecuteInvoicing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (stats.pendingCount === 0) {
      toast.warning(
        "No pending athletes selected to invoice. All athletes in this scope may already be billed.",
      );
      return;
    }

    setIsProcessing(true);
    try {
      const includedIds = athleteAuditList.filter((a) => a.isSelected).map((a) => a.player.id);

      const result = await generateMonthlyInvoices(
        targetMonth,
        targetYear,
        (isBranchScoped ? userBranch : targetBranch) || undefined,
        {
          dueDate: computedDueDate,
          customDescription: customMemo,
          includedPlayerIds: includedIds,
          squadFilter: targetSquad !== "All" ? targetSquad : undefined,
          applySiblingDiscounts,
        },
      );

      toast.success(
        `Generated ${result.generatedCount} invoices (${money(result.totalAmount)}). ${result.skippedCount > 0 ? `${result.skippedCount} athletes were safely skipped.` : ""}`,
      );

      if (onSuccess) {
        onSuccess(result);
      }
      onClose();
    } catch (err) {
      console.error("Monthly invoicing execution failed:", err);
      toast.error("Failed to generate monthly invoices. Reverting state.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        if (!isProcessing) onClose();
      }}
      title="⚡ Run Monthly Invoicing & Tuition Generator"
      meta="Automated squad fee calculation, composite key idempotency protection, and instant balance synchronization"
      wide
    >
      <form onSubmit={handleExecuteInvoicing} className="p-4 sm:p-6 space-y-5">
        {/* Top Scope & Timing Control Bar */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 rounded-xl border border-ink-800 bg-ink-950 p-3.5">
          <Field label="Billing Month" hint="Accounting period">
            <Select value={targetMonth} onChange={(m) => setTargetMonth(m)} options={MONTH_NAMES} />
          </Field>

          <Field label="Billing Year" hint="Fiscal calendar year">
            <Input
              type="number"
              value={String(targetYear)}
              onChange={(v) => setTargetYear(Number(v) || new Date().getFullYear())}
            />
          </Field>

          <Field label="Facility / Branch" hint="Filter by assigned facility">
            {isBranchScoped ? (
              <div className="mt-1.5 rounded-md bg-ink-900 px-3 py-2 font-mono text-xs text-court-300 ring-1 ring-ink-750">
                {userBranch} (Assigned)
              </div>
            ) : (
              <Select
                value={targetBranch}
                onChange={setTargetBranch}
                options={["", ...db.branches.map((b) => b.name)]}
              />
            )}
          </Field>

          <Field label="Squad / Program" hint="Filter by squad tier">
            <Select
              value={targetSquad}
              onChange={setTargetSquad}
              options={["All", ...(db.teams || []).map((t) => t.name)]}
            />
          </Field>
        </div>

        {/* 4 Hero KPI Cards (Tabular Figures & High-Density Display) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-ink-800 bg-ink-900/90 p-3.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
                Active in Scope
              </span>
              <Users className="h-4 w-4 text-ink-400" />
            </div>
            <div className="mt-2 text-2xl font-bold font-mono text-ink-100 tabular-nums">
              {stats.totalActive}
            </div>
            <div className="mt-0.5 text-[11px] text-ink-400 font-mono">Registered athletes</div>
          </div>

          <div className="rounded-xl border border-ink-800 bg-ink-900/90 p-3.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
                Already Invoiced
              </span>
              <ShieldCheck className="h-4 w-4 text-amber-400" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-amber-400 tabular-nums">
                {stats.alreadyBilledCount}
              </span>
              <span className="text-[10px] font-mono text-ink-400">Skipped (safe)</span>
            </div>
            <div className="mt-0.5 text-[11px] text-amber-400/80 font-mono">
              Idempotency protected
            </div>
          </div>

          <div className="rounded-xl border border-ink-800 bg-ink-900/90 p-3.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
                Pending to Bill
              </span>
              <Zap className="h-4 w-4 text-court-400" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold font-mono text-court-400 tabular-nums">
                {stats.pendingCount}
              </span>
              {stats.excludedCount > 0 && (
                <span className="text-[10px] font-mono text-ink-400">
                  ({stats.excludedCount} on hold)
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-court-300 font-mono">Selected for batch</div>
          </div>

          <div className="rounded-xl border border-court-500/30 bg-court-500/10 p-3.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-court-300">
                Projected Gross Tuition
              </span>
              <Sparkles className="h-4 w-4 text-court-400" />
            </div>
            <div className="mt-2 text-2xl font-bold font-mono text-court-400 tabular-nums">
              {money(stats.projectedReceivables)}
            </div>
            <div className="mt-0.5 text-[11px] text-court-300 font-mono tabular-nums">
              Avg {money(stats.avgFee)} / athlete
            </div>
          </div>
        </div>

        {/* Sub-Tabs Navigation inside Modal */}
        <div className="flex border-b border-ink-800 bg-ink-950 rounded-lg p-1 gap-1">
          <button
            type="button"
            onClick={() => setActiveSubTab("overview")}
            className={`flex items-center gap-2 rounded-md px-3.5 py-1.5 font-mono text-xs font-semibold transition-all ${
              activeSubTab === "overview"
                ? "bg-court-500 text-ink-950 font-bold shadow-sm"
                : "text-ink-400 hover:text-ink-200"
            }`}
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span>Overview &amp; Squad Rates</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab("roster")}
            className={`flex items-center gap-2 rounded-md px-3.5 py-1.5 font-mono text-xs font-semibold transition-all ${
              activeSubTab === "roster"
                ? "bg-court-500 text-ink-950 font-bold shadow-sm"
                : "text-ink-400 hover:text-ink-200"
            }`}
          >
            <Users className="h-3.5 w-3.5" />
            <span>
              Athlete Roster Audit ({stats.pendingCount}/{stats.totalActive})
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab("settings")}
            className={`flex items-center gap-2 rounded-md px-3.5 py-1.5 font-mono text-xs font-semibold transition-all ${
              activeSubTab === "settings"
                ? "bg-court-500 text-ink-950 font-bold shadow-sm"
                : "text-ink-400 hover:text-ink-200"
            }`}
          >
            <Calendar className="h-3.5 w-3.5" />
            <span>Due Dates &amp; Memo Setup</span>
          </button>
        </div>

        {/* SUBTAB 1: Overview & Squad Rates Breakdown */}
        {activeSubTab === "overview" && (
          <div className="space-y-4">
            <div className="rounded-xl border border-ink-800 bg-ink-950 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-mono font-semibold uppercase tracking-wider text-court-400">
                  Squad &amp; Program Tier Rate Breakdown
                </div>
                <span className="font-mono text-[11px] text-ink-400">
                  {stats.breakdown.length} active squad billing tier(s)
                </span>
              </div>

              {stats.breakdown.length === 0 ? (
                <div className="py-6 text-center font-mono text-xs text-ink-500">
                  No active athletes pending billing in this selection.
                </div>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2 max-h-56 overflow-y-auto pr-1">
                  {stats.breakdown.map((item) => (
                    <div
                      key={`${item.squad}_${item.rate}`}
                      className="rounded-lg border border-ink-850 bg-ink-900/90 p-3 flex items-center justify-between text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-ink-100 truncate">{item.squad}</div>
                        <div className="font-mono text-[10px] text-ink-400 mt-0.5">
                          {item.tier} · <span className="text-court-400">{money(item.rate)}</span> /
                          month
                        </div>
                      </div>
                      <div className="text-right font-mono shrink-0 pl-2">
                        <div className="text-xs font-bold text-ink-100 tabular-nums">
                          {item.count} player{item.count !== 1 ? "s" : ""}
                        </div>
                        <div className="text-[11px] font-semibold text-court-400 tabular-nums">
                          {money(item.subtotal)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Idempotency & Safeguard Guarantee Banner */}
            <div className="rounded-xl border border-court-500/20 bg-court-500/5 p-4 flex items-start gap-3 text-xs">
              <ShieldCheck className="h-5 w-5 text-court-400 shrink-0 mt-0.5" />
              <div className="space-y-1 text-ink-300">
                <div className="font-semibold text-ink-100 flex items-center gap-2">
                  <span>Deterministic Idempotency Guarantee</span>
                  <Chip tone="good">Active</Chip>
                </div>
                <p className="leading-relaxed">
                  Every invoice utilizes an immutable composite key format (
                  <code className="font-mono text-court-300">playerId_year_monthCode</code>). If an
                  athlete was already billed for {targetMonth} {targetYear}, the engine will
                  automatically skip them and prevent duplicate debits.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* SUBTAB 2: Athlete Roster Audit & Individual Inclusions/Exclusions */}
        {activeSubTab === "roster" && (
          <div className="space-y-3">
            {/* Filter & Search Bar */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
                <input
                  type="text"
                  value={rosterQuery}
                  onChange={(e) => setRosterQuery(e.target.value)}
                  placeholder="Search athletes by name, guardian, branch, or team..."
                  className="w-full rounded-md bg-ink-950 py-1.5 pl-8 pr-3 font-mono text-xs text-ink-100 placeholder:text-ink-500 ring-1 ring-ink-800 focus:outline-none focus:ring-1 focus:ring-court-500"
                />
              </div>

              <div className="flex items-center gap-1">
                {(["all", "pending", "alreadyBilled"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setRosterFilter(mode)}
                    className={`rounded px-2.5 py-1 font-mono text-[11px] transition-colors ${
                      rosterFilter === mode
                        ? "bg-court-500 text-ink-950 font-bold"
                        : "bg-ink-900 text-ink-400 hover:text-ink-200 ring-1 ring-ink-800"
                    }`}
                  >
                    {mode === "all"
                      ? `All (${athleteAuditList.length})`
                      : mode === "pending"
                        ? `Pending (${stats.pendingCount})`
                        : `Billed (${stats.alreadyBilledCount})`}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleSelectAllPending}
                  className="rounded bg-ink-900 px-2 py-1 font-mono text-[10px] text-court-300 ring-1 ring-ink-800 hover:bg-ink-850"
                >
                  Select All
                </button>
                <button
                  type="button"
                  onClick={handleDeselectAllPending}
                  className="rounded bg-ink-900 px-2 py-1 font-mono text-[10px] text-ink-400 ring-1 ring-ink-800 hover:bg-ink-850 hover:text-ink-200"
                >
                  Deselect All
                </button>
              </div>
            </div>

            {/* Athlete Table */}
            <div className="rounded-xl border border-ink-800 bg-ink-950 overflow-hidden">
              <div className="max-h-80 overflow-y-auto overflow-x-auto">
                <table className="w-full min-w-[640px] text-left font-ui text-xs">
                  <thead className="sticky top-0 bg-ink-900 text-[10px] font-mono uppercase text-ink-400 border-b border-ink-800 z-10">
                    <tr>
                      <th className="py-2.5 pl-3 pr-2 w-8 text-center">✓</th>
                      <th className="py-2.5 px-2">Athlete / Guardian</th>
                      <th className="py-2.5 px-2">Squad &amp; Branch</th>
                      <th className="py-2.5 px-2 text-right">Current Balance</th>
                      <th className="py-2.5 px-2 text-right">Tuition Fee</th>
                      <th className="py-2.5 px-2 text-right">Projected Balance</th>
                      <th className="py-2.5 pr-3 pl-2 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-850 font-mono text-[11px]">
                    {filteredRoster.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-ink-500">
                          No athletes match your query or filter.
                        </td>
                      </tr>
                    ) : (
                      filteredRoster.map((item) => {
                        const p = item.player;
                        return (
                          <tr
                            key={p.id}
                            className={`hover:bg-ink-900/60 transition-colors ${
                              item.isAlreadyBilled
                                ? "opacity-60 bg-ink-950/40"
                                : item.isExcluded
                                  ? "opacity-50"
                                  : ""
                            }`}
                          >
                            <td className="py-2 pl-3 pr-2 text-center">
                              {item.isAlreadyBilled ? (
                                <CheckCircle2 className="h-4 w-4 text-amber-400 mx-auto" />
                              ) : item.isExempt ? (
                                <ShieldCheck className="h-4 w-4 text-emerald-400 mx-auto" />
                              ) : (
                                <input
                                  type="checkbox"
                                  checked={!item.isExcluded}
                                  onChange={() => handleToggleAthlete(p.id)}
                                  className="h-3.5 w-3.5 rounded border-ink-700 bg-ink-900 text-court-500 focus:ring-court-500"
                                />
                              )}
                            </td>
                            <td className="py-2 px-2">
                              <div className="font-semibold text-ink-100 font-ui text-xs flex items-center gap-1.5 flex-wrap">
                                <span>{p.name}</span>
                                {p.isScholarship && (
                                  <span className="inline-flex items-center rounded bg-emerald-500/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-300 ring-1 ring-emerald-500/40">
                                    Scholarship / Free
                                  </span>
                                )}
                                {p.specialOffer && (
                                  <span className="inline-flex items-center rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-amber-300 ring-1 ring-amber-500/40">
                                    {p.specialOffer}
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] text-ink-400">
                                {p.guardianName || p.parent
                                  ? `Guardian: ${p.guardianName || p.parent}`
                                  : p.category}
                              </div>
                            </td>
                            <td className="py-2 px-2">
                              <div className="text-ink-200">{item.squadName}</div>
                              <div className="text-[10px] text-ink-400">{p.branch || "HQ"}</div>
                            </td>
                            <td className="py-2 px-2 text-right tabular-nums">
                              <span
                                className={
                                  item.currentBalance > 0
                                    ? "text-amber-400 font-bold"
                                    : "text-ink-400"
                                }
                              >
                                {money(item.currentBalance)}
                              </span>
                            </td>
                            <td className="py-2 px-2 text-right tabular-nums">
                              <div className="font-bold text-court-400">
                                {item.isExempt ? "FREE ($0)" : money(item.rate)}
                              </div>
                              {item.discountPercent > 0 && (
                                <div className="text-[9px] font-mono text-emerald-400">
                                  -{item.discountPercent}% Sibling #{item.siblingRank}
                                </div>
                              )}
                              {!item.isExempt && (p.discountPercent || p.discountAmount) ? (
                                <div className="text-[9px] font-mono text-amber-300">
                                  {p.discountPercent ? `-${p.discountPercent}%` : ""}
                                  {p.discountAmount ? ` -$${p.discountAmount}` : ""} Offer
                                </div>
                              ) : null}
                            </td>
                            <td className="py-2 px-2 text-right font-semibold text-ink-100 tabular-nums">
                              {money(item.projectedBalance)}
                            </td>
                            <td className="py-2 pr-3 pl-2 text-center">
                              {item.isAlreadyBilled ? (
                                <span className="inline-flex items-center rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-300 ring-1 ring-amber-500/30">
                                  Billed
                                </span>
                              ) : item.isExempt ? (
                                <span className="inline-flex items-center rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-300 ring-1 ring-emerald-500/30">
                                  Exempt ($0)
                                </span>
                              ) : item.isExcluded ? (
                                <span className="inline-flex items-center rounded bg-ink-800 px-1.5 py-0.5 text-[9px] font-bold uppercase text-ink-400 ring-1 ring-ink-700">
                                  On Hold
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-300 ring-1 ring-emerald-500/30">
                                  Ready
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* SUBTAB 3: Due Dates, Memo Template & Dispatch Settings */}
        {activeSubTab === "settings" && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-ink-800 bg-ink-950 p-4 space-y-3">
                <div className="text-xs font-mono font-semibold uppercase tracking-wider text-court-400">
                  Payment Due Date Rules
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    { key: "15th", label: `15th of ${targetMonth}` },
                    { key: "eom", label: "End of Month" },
                    { key: "net15", label: "Net 15 Days" },
                    { key: "net30", label: "Net 30 Days" },
                    { key: "custom", label: "Custom Date" },
                  ].map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => {
                        setDueDatePreset(preset.key as typeof dueDatePreset);
                        if (preset.key === "custom" && !customDueDate) {
                          setCustomDueDate(`${targetYear}-${monthCode}-20`);
                        }
                      }}
                      className={`rounded-md p-2 text-xs font-mono transition-all text-left ${
                        dueDatePreset === preset.key
                          ? "border border-court-500 bg-court-500/15 text-court-300 font-bold"
                          : "border border-ink-800 bg-ink-900 text-ink-400 hover:text-ink-200"
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                {dueDatePreset === "custom" && (
                  <div className="pt-2">
                    <Field label="Choose Custom Due Date">
                      <Input type="date" value={customDueDate} onChange={setCustomDueDate} />
                    </Field>
                  </div>
                )}

                <div className="pt-2 border-t border-ink-850">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-ink-400">Effective Due Date:</span>
                    <span className="font-bold text-court-400 tabular-nums">{computedDueDate}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-ink-800 bg-ink-950 p-4 space-y-3">
                <div className="text-xs font-mono font-semibold uppercase tracking-wider text-court-400">
                  Invoice Description Pattern
                </div>

                <Field
                  label="Description / Memo Template"
                  hint="Supports {MONTH}, {YEAR}, and {PROGRAM}"
                >
                  <Input value={customMemo} onChange={setCustomMemo} />
                </Field>

                <div className="rounded bg-ink-900 p-2.5 text-[11px] font-mono text-ink-300 border border-ink-850">
                  <span className="text-ink-400">Preview: </span>
                  {customMemo
                    .replace("{MONTH}", targetMonth)
                    .replace("{YEAR}", String(targetYear))
                    .replace("{PROGRAM}", "U16 Elite Squad")}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-ink-800 bg-ink-950 p-4 flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-ink-100 flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-court-400" />
                  <span>Automatic Family Sibling Discounts</span>
                </div>
                <div className="text-[11px] font-mono text-ink-400">
                  Automatically discounts 2nd sibling (-10%) and 3rd+ siblings (-15%) sharing the
                  same guardian.
                </div>
              </div>
              <input
                type="checkbox"
                checked={applySiblingDiscounts}
                onChange={(e) => setApplySiblingDiscounts(e.target.checked)}
                className="h-4 w-4 rounded border-ink-700 bg-ink-900 text-court-500 focus:ring-court-500"
              />
            </div>

            <div className="rounded-xl border border-ink-800 bg-ink-950 p-4 flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-ink-100 flex items-center gap-1.5">
                  <Zap className="h-4 w-4 text-court-400" />
                  <span>Dispatch In-App Finance Notification</span>
                </div>
                <div className="text-[11px] font-mono text-ink-400">
                  Broadcasts a real-time summary to Super Admins, Accountants, and Branch Managers.
                </div>
              </div>
              <input
                type="checkbox"
                checked={notifyAdmins}
                onChange={(e) => setNotifyAdmins(e.target.checked)}
                className="h-4 w-4 rounded border-ink-700 bg-ink-900 text-court-500 focus:ring-court-500"
              />
            </div>
          </div>
        )}

        {/* Action Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-ink-800">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleExportAuditCSV}
              className="font-mono text-xs"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              <span>Export Pre-Run CSV</span>
            </Button>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={onClose}
              disabled={isProcessing}
            >
              Cancel
            </Button>

            <button
              type="submit"
              disabled={isProcessing || stats.pendingCount === 0}
              className="flex items-center gap-2 rounded-lg bg-court-500 hover:bg-court-400 disabled:opacity-50 disabled:cursor-not-allowed px-5 py-2.5 font-mono text-xs font-bold uppercase tracking-wide text-ink-950 shadow-md transition-all active:scale-95"
            >
              <Zap className="h-4 w-4 fill-current" />
              <span>
                {isProcessing
                  ? "Generating Invoices & Syncing Balances..."
                  : `Generate ${stats.pendingCount} Invoices (${money(stats.projectedReceivables)})`}
              </span>
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export default MonthlyInvoicingModal;

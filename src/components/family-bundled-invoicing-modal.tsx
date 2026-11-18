import { useState, useMemo } from "react";
import { useDB, type Player } from "@/lib/data-store";
import { Modal, Button, Field, Input, Select, Chip, money } from "@/components/kit";
import {
  detectFamilyGroups,
  exportFamilyStatementPdf,
  formatFamilyWhatsAppStatement,
  type FamilyGroup,
  type SiblingDiscountConfig,
  DEFAULT_SIBLING_DISCOUNT_CONFIG,
} from "@/lib/family-invoicing";
import { openDirectWhatsApp } from "@/lib/whatsapp";
import {
  Download,
  FileText,
  MessageSquare,
  Search,
  Sparkles,
  Users,
  Zap,
  ShieldCheck,
  CheckCircle2,
  Percent,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

export interface FamilyBundledInvoicingModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
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

export function FamilyBundledInvoicingModal({
  open,
  onClose,
  onSuccess,
  initialMonth,
  initialYear,
  initialBranch = "",
  isBranchScoped = false,
  userBranch = "",
}: FamilyBundledInvoicingModalProps) {
  const { db, generateMonthlyInvoices, payFamilyBalance } = useDB();

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

  // Sibling Discount Config State
  const [discountConfig, setDiscountConfig] = useState<SiblingDiscountConfig>(
    DEFAULT_SIBLING_DISCOUNT_CONFIG,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [isProcessingFamily, setIsProcessingFamily] = useState<string | null>(null);
  const [isProcessingAll, setIsProcessingAll] = useState(false);

  // Unified Family Payment Collection Modal State
  const [collectingFamily, setCollectingFamily] = useState<FamilyGroup | null>(null);
  const [familyPaymentAmount, setFamilyPaymentAmount] = useState<number>(0);
  const [familyPaymentMethod, setFamilyPaymentMethod] = useState<string>("Cash");
  const [familyPaymentNotes, setFamilyPaymentNotes] = useState<string>("");
  const [isSubmittingFamilyPayment, setIsSubmittingFamilyPayment] = useState(false);

  const effectiveBranch = isBranchScoped ? userBranch : targetBranch;

  // Detect and rank all family groups
  const familyGroups = useMemo(() => {
    return detectFamilyGroups(
      db.players as Player[],
      db.teams,
      db.branches,
      db.invoices,
      targetMonth,
      targetYear,
      discountConfig,
      effectiveBranch || undefined,
    );
  }, [
    db.players,
    db.teams,
    db.branches,
    db.invoices,
    targetMonth,
    targetYear,
    discountConfig,
    effectiveBranch,
  ]);

  // Filtered families by search query
  const filteredFamilies = useMemo(() => {
    if (!searchQuery.trim()) return familyGroups;
    const q = searchQuery.toLowerCase().trim();
    return familyGroups.filter((f) => {
      const matchGuardian = f.guardianName.toLowerCase().includes(q);
      const matchPhone = f.guardianPhone.includes(q);
      const matchChild = f.children.some((c) => c.player.name.toLowerCase().includes(q));
      return matchGuardian || matchPhone || matchChild;
    });
  }, [familyGroups, searchQuery]);

  // Aggregate Hero KPI metrics
  const stats = useMemo(() => {
    let totalChildren = 0;
    let grossTuition = 0;
    let totalSavings = 0;
    let netTuition = 0;
    let pendingBillingCount = 0;

    familyGroups.forEach((f) => {
      totalChildren += f.children.length;
      grossTuition += f.totalStandard;
      totalSavings += f.totalDiscount;
      netTuition += f.totalNet;
      pendingBillingCount += f.pendingCount;
    });

    return {
      totalFamilies: familyGroups.length,
      totalChildren,
      grossTuition,
      totalSavings,
      netTuition,
      pendingBillingCount,
    };
  }, [familyGroups]);

  // PDF statement export handler
  const handleExportFamilyPdf = async (family: FamilyGroup) => {
    try {
      await exportFamilyStatementPdf(
        family,
        targetMonth,
        targetYear,
        db.academy?.name || "Vescio Vector Academy",
        db.academy?.currency || "USD",
      );
      toast.success(`Exported Unified Family Statement for ${family.guardianName}.`);
    } catch (err) {
      console.error("Family PDF export failed:", err);
      toast.error("Failed to generate Family Statement PDF.");
    }
  };

  // WhatsApp statement handler
  const handleSendWhatsApp = (family: FamilyGroup) => {
    if (!family.guardianPhone) {
      toast.error(`No phone number found for guardian ${family.guardianName}.`);
      return;
    }
    const message = formatFamilyWhatsAppStatement(
      family,
      targetMonth,
      targetYear,
      db.academy?.name || "Vescio Vector Academy",
      db.academy?.currency || "USD",
    );
    openDirectWhatsApp(family.guardianPhone, message);
    toast.success(`Opened WhatsApp statement for ${family.guardianName}.`);
  };

  // Generate invoices for single family with sibling discounts applied
  const handleGenerateFamilyInvoices = async (family: FamilyGroup) => {
    const pendingKids = family.children.filter((c) => !c.isAlreadyBilled && c.netFee > 0);
    if (pendingKids.length === 0) {
      toast.info(`All billable athletes in ${family.guardianName}'s family are already invoiced.`);
      return;
    }

    try {
      setIsProcessingFamily(family.familyKey);
      const includedIds = pendingKids.map((c) => c.player.id);
      const customRates: Record<string, number> = {};
      pendingKids.forEach((c) => {
        customRates[c.player.id] = c.netFee;
      });

      const result = await generateMonthlyInvoices(
        targetMonth,
        targetYear,
        effectiveBranch || undefined,
        {
          includedPlayerIds: includedIds,
          applySiblingDiscounts: true,
          siblingDiscountConfig: discountConfig,
          customRates,
          customPlayerRates: customRates,
          customDescription: `Tuition Fee · {MONTH} {YEAR} · {PROGRAM} (Family Sibling Concession applied)`,
        },
      );

      toast.success(
        `Generated ${result.generatedCount} invoices for ${family.guardianName}'s family (${money(result.totalAmount, db.academy?.currency)}).`,
      );

      if (onSuccess) onSuccess();
    } catch (err) {
      console.error("Family invoice generation failed:", err);
      toast.error("Failed to generate family invoices.");
    } finally {
      setIsProcessingFamily(null);
    }
  };

  // Generate invoices for all detected multi-sibling families
  const handleGenerateAllFamilies = async () => {
    const customRates: Record<string, number> = {};
    const allPendingKids = familyGroups.flatMap((f) =>
      f.children
        .filter((c) => !c.isAlreadyBilled && c.netFee > 0)
        .map((c) => {
          customRates[c.player.id] = c.netFee;
          return c.player.id;
        }),
    );

    if (allPendingKids.length === 0) {
      toast.info("All athletes across all detected families are already invoiced.");
      return;
    }

    try {
      setIsProcessingAll(true);
      const result = await generateMonthlyInvoices(
        targetMonth,
        targetYear,
        effectiveBranch || undefined,
        {
          includedPlayerIds: allPendingKids,
          applySiblingDiscounts: true,
          siblingDiscountConfig: discountConfig,
          customRates,
          customPlayerRates: customRates,
          customDescription: `Tuition Fee · {MONTH} {YEAR} · {PROGRAM} (Family Sibling Concession applied)`,
        },
      );

      toast.success(
        `Successfully generated ${result.generatedCount} bundled invoices across ${familyGroups.length} families (${money(result.totalAmount, db.academy?.currency)}).`,
      );

      if (onSuccess) onSuccess();
    } catch (err) {
      console.error("Bulk family invoice generation failed:", err);
      toast.error("Failed to generate bundled family invoices.");
    } finally {
      setIsProcessingAll(false);
    }
  };

  const openCollectFamilyModal = (family: FamilyGroup) => {
    setCollectingFamily(family);
    const defaultPayable = family.combinedBalance > 0 ? family.combinedBalance : family.totalNet;
    setFamilyPaymentAmount(defaultPayable);
    setFamilyPaymentMethod("Cash");
    setFamilyPaymentNotes("");
  };

  const handleConfirmFamilyPayment = async (e?: React.FormEvent) => {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    if (!collectingFamily) return;
    const amt = Math.abs(Number(familyPaymentAmount) || 0);
    if (amt <= 0) {
      toast.error("Please enter a valid payment amount greater than 0.");
      return;
    }
    try {
      setIsSubmittingFamilyPayment(true);
      const siblingIds = collectingFamily.children.map((c) => c.player.id);
      await payFamilyBalance(siblingIds, amt, familyPaymentMethod, familyPaymentNotes);
      setCollectingFamily(null);
      if (onSuccess) onSuccess();
    } catch (err) {
      console.error("Failed to collect family payment:", err);
      toast.error("Failed to record family payment.");
    } finally {
      setIsSubmittingFamilyPayment(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="👨‍👩‍👧‍👦 Family Bundles & Sibling Discounts"
      meta="Automated sibling detection, concession rule configuration, and Unified Family Statements"
      wide
    >
      <div className="p-4 sm:p-6 space-y-5">
        {/* Top Control Bar: Month, Year, Branch & Sibling Discount Rates */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 rounded-xl border border-ink-800 bg-ink-950 p-3.5">
          <Field label="Billing Month">
            <Select value={targetMonth} onChange={(m) => setTargetMonth(m)} options={MONTH_NAMES} />
          </Field>

          <Field label="Billing Year">
            <Input
              type="number"
              value={String(targetYear)}
              onChange={(v) => setTargetYear(Number(v) || new Date().getFullYear())}
            />
          </Field>

          <Field label="Target Facility">
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

          <div className="grid grid-cols-2 gap-2">
            <Field label="2nd Child" hint="Discount %">
              <Input
                type="number"
                value={String(discountConfig.secondChildPercent)}
                onChange={(v) =>
                  setDiscountConfig((prev) => ({
                    ...prev,
                    secondChildPercent: Math.max(0, Math.min(100, Number(v) || 0)),
                  }))
                }
              />
            </Field>
            <Field label="3rd+ Child" hint="Discount %">
              <Input
                type="number"
                value={String(discountConfig.thirdPlusChildPercent)}
                onChange={(v) =>
                  setDiscountConfig((prev) => ({
                    ...prev,
                    thirdPlusChildPercent: Math.max(0, Math.min(100, Number(v) || 0)),
                  }))
                }
              />
            </Field>
          </div>
        </div>

        {/* 4 Hero KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-ink-800 bg-ink-900/90 p-3.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
                Multi-Athlete Families
              </span>
              <Users className="h-4 w-4 text-ink-400" />
            </div>
            <div className="mt-2 text-2xl font-bold font-mono text-ink-100 tabular-nums">
              {stats.totalFamilies}
            </div>
            <div className="mt-0.5 text-[11px] text-ink-400 font-mono">
              {stats.totalChildren} enrolled siblings
            </div>
          </div>

          <div className="rounded-xl border border-ink-800 bg-ink-900/90 p-3.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
                Gross Standard Total
              </span>
              <span className="font-mono text-xs text-ink-400">100% Rate</span>
            </div>
            <div className="mt-2 text-2xl font-bold font-mono text-ink-100 tabular-nums">
              {money(stats.grossTuition, db.academy?.currency)}
            </div>
            <div className="mt-0.5 text-[11px] text-ink-400 font-mono">Prior to concession</div>
          </div>

          <div className="rounded-xl border border-court-500/30 bg-court-500/10 p-3.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-court-300">
                Sibling Savings
              </span>
              <Percent className="h-4 w-4 text-court-400" />
            </div>
            <div className="mt-2 text-2xl font-bold font-mono text-court-400 tabular-nums">
              {money(stats.totalSavings, db.academy?.currency)}
            </div>
            <div className="mt-0.5 text-[11px] text-court-300 font-mono">Concessions applied</div>
          </div>

          <div className="rounded-xl border border-ink-800 bg-ink-900/90 p-3.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-court-300">
                Net Bundled Receivables
              </span>
              <Sparkles className="h-4 w-4 text-court-400" />
            </div>
            <div className="mt-2 text-2xl font-bold font-mono text-court-300 tabular-nums">
              {money(stats.netTuition, db.academy?.currency)}
            </div>
            <div className="mt-0.5 text-[11px] text-ink-400 font-mono">
              {stats.pendingBillingCount} pending invoices
            </div>
          </div>
        </div>

        {/* Search & Actions Bar */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search families by guardian name, phone, or child's name..."
              className="w-full rounded-md bg-ink-950 py-1.5 pl-8 pr-3 font-mono text-xs text-ink-100 placeholder:text-ink-500 ring-1 ring-ink-800 focus:outline-none focus:ring-1 focus:ring-court-500"
            />
          </div>

          {stats.pendingBillingCount > 0 && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={isProcessingAll}
              onClick={handleGenerateAllFamilies}
              className="font-mono text-xs whitespace-nowrap"
            >
              <Zap className="h-3.5 w-3.5 mr-1" />
              <span>
                {isProcessingAll
                  ? "Generating All..."
                  : `Batch Invoice All Families (${stats.pendingBillingCount} athletes)`}
              </span>
            </Button>
          )}
        </div>

        {/* Family Cards Roster List */}
        <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
          {filteredFamilies.length === 0 ? (
            <div className="rounded-xl border border-ink-800 bg-ink-950 p-8 text-center">
              <Users className="h-8 w-8 text-ink-500 mx-auto mb-2 opacity-50" />
              <div className="font-mono text-xs text-ink-400">
                {searchQuery
                  ? "No multi-athlete families match your search query."
                  : "No multi-athlete families (2+ registered siblings) detected in this branch."}
              </div>
            </div>
          ) : (
            filteredFamilies.map((family) => (
              <div
                key={family.familyKey}
                className="rounded-xl border border-ink-800 bg-ink-950 p-4 space-y-3.5 hover:border-ink-750 transition-colors"
              >
                {/* Family Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2.5 border-b border-ink-850">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-ink-100 text-sm">
                        {family.guardianName}
                      </span>
                      <Chip tone="accent">{family.children.length} Enrolled Siblings</Chip>
                      <span className="text-[11px] font-mono text-ink-400">
                        {family.primaryBranch}
                      </span>
                    </div>
                    {family.guardianPhone && (
                      <div className="text-[11px] font-mono text-ink-400 mt-0.5">
                        Contact: {family.guardianPhone}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleExportFamilyPdf(family)}
                      className="font-mono text-xs"
                      title="Download branded multi-sibling PDF statement"
                    >
                      <FileText className="h-3.5 w-3.5 mr-1 text-court-400" />
                      <span>Family PDF</span>
                    </Button>

                    {family.guardianPhone && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => handleSendWhatsApp(family)}
                        className="font-mono text-xs"
                        title="Send formatted statement via WhatsApp"
                      >
                        <MessageSquare className="h-3.5 w-3.5 mr-1 text-emerald-400" />
                        <span>WhatsApp</span>
                      </Button>
                    )}

                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => openCollectFamilyModal(family)}
                      className="font-mono text-xs border border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                      title="Collect single unified payment across all siblings in this family"
                    >
                      <Wallet className="h-3.5 w-3.5 mr-1 text-emerald-400" />
                      <span>
                        Collect Family Payment
                        {family.combinedBalance > 0
                          ? ` (${money(family.combinedBalance, db.academy?.currency)})`
                          : ""}
                      </span>
                    </Button>

                    <button
                      type="button"
                      disabled={
                        isProcessingFamily === family.familyKey || family.pendingCount === 0
                      }
                      onClick={() => handleGenerateFamilyInvoices(family)}
                      className="flex items-center gap-1.5 rounded bg-court-500 hover:bg-court-400 disabled:opacity-40 disabled:cursor-not-allowed px-3 py-1.5 font-mono text-xs font-bold text-ink-950 transition-all"
                    >
                      <Zap className="h-3.5 w-3.5 fill-current" />
                      <span>
                        {isProcessingFamily === family.familyKey
                          ? "Generating..."
                          : family.pendingCount === 0
                            ? "All Invoiced"
                            : `Bill Family (${money(family.totalNet, db.academy?.currency)})`}
                      </span>
                    </button>
                  </div>
                </div>

                {/* Siblings Table */}
                <div className="rounded-lg border border-ink-850 bg-ink-900/60 overflow-hidden">
                  <table className="w-full text-left font-ui text-xs">
                    <thead className="bg-ink-900 text-[10px] font-mono uppercase text-ink-400 border-b border-ink-800">
                      <tr>
                        <th className="py-2 pl-3 pr-2 w-16">Rank</th>
                        <th className="py-2 px-2">Athlete</th>
                        <th className="py-2 px-2">Squad &amp; Branch</th>
                        <th className="py-2 px-2 text-right">Standard</th>
                        <th className="py-2 px-2 text-right">Concession</th>
                        <th className="py-2 px-2 text-right">Net Tuition</th>
                        <th className="py-2 pr-3 pl-2 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-850 font-mono text-[11px]">
                      {family.children.map((child) => (
                        <tr key={child.player.id} className="hover:bg-ink-900/80">
                          <td className="py-2 pl-3 pr-2">
                            <span
                              className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                child.siblingRank === 1
                                  ? "bg-ink-800 text-ink-300"
                                  : child.siblingRank === 2
                                    ? "bg-court-500/20 text-court-300 ring-1 ring-court-400/40"
                                    : "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40"
                              }`}
                            >
                              Child #{child.siblingRank}
                            </span>
                          </td>
                          <td className="py-2 px-2">
                            <span className="font-semibold text-ink-100 font-ui text-xs">
                              {child.player.name}
                            </span>
                          </td>
                          <td className="py-2 px-2">
                            <span className="text-ink-300">{child.squadName}</span>
                            <span className="text-[10px] text-ink-400 ml-1.5">
                              ({child.branch})
                            </span>
                          </td>
                          <td className="py-2 px-2 text-right tabular-nums text-ink-400">
                            {money(child.standardFee, db.academy?.currency)}
                          </td>
                          <td className="py-2 px-2 text-right tabular-nums">
                            {child.discountPercent > 0 ? (
                              <span className="text-court-400 font-semibold">
                                -{child.discountPercent}% (
                                {money(child.discountAmount, db.academy?.currency)})
                              </span>
                            ) : (
                              <span className="text-ink-500">None (1st)</span>
                            )}
                          </td>
                          <td className="py-2 px-2 text-right font-bold text-ink-100 tabular-nums">
                            {money(child.netFee, db.academy?.currency)}
                          </td>
                          <td className="py-2 pr-3 pl-2 text-center">
                            {child.isAlreadyBilled ? (
                              <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-amber-300 ring-1 ring-amber-500/30">
                                <CheckCircle2 className="h-3 w-3" />
                                <span>Billed</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-300 ring-1 ring-emerald-500/30">
                                Pending
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Family Financial Totals Footer */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs font-mono">
                  <div className="flex items-center gap-3 text-ink-400">
                    <span>
                      Gross:{" "}
                      <strong className="text-ink-300 tabular-nums">
                        {money(family.totalStandard, db.academy?.currency)}
                      </strong>
                    </span>
                    {family.totalDiscount > 0 && (
                      <span className="text-court-400">
                        Savings:{" "}
                        <strong className="tabular-nums">
                          -{money(family.totalDiscount, db.academy?.currency)}
                        </strong>
                      </span>
                    )}
                    {family.combinedBalance > 0 && (
                      <span className="text-amber-400">
                        Prior Balance:{" "}
                        <strong className="tabular-nums">
                          {money(family.combinedBalance, db.academy?.currency)}
                        </strong>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-ink-400">Net Family Total:</span>
                    <span className="font-bold text-sm text-court-300 tabular-nums">
                      {money(family.totalNet, db.academy?.currency)}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Modal Close Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-ink-800">
          <div className="text-[11px] font-mono text-ink-400 flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-court-400" />
            <span>Sibling discounts automatically recalculate based on active family members.</span>
          </div>

          <Button type="button" variant="ghost" size="md" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>

      {/* Collect Unified Family Payment Modal */}
      <Modal
        open={Boolean(collectingFamily)}
        onClose={() => {
          if (!isSubmittingFamilyPayment) setCollectingFamily(null);
        }}
        title={
          collectingFamily
            ? `Collect Family Payment · ${collectingFamily.guardianName}`
            : "Collect Family Payment"
        }
        meta="Single cash or transfer receipt automatically settles open invoices and balances across all siblings"
        onSubmit={handleConfirmFamilyPayment}
        submitLabel={isSubmittingFamilyPayment ? "Recording..." : "Confirm Unified Family Payment"}
      >
        {collectingFamily && (
          <div className="p-4 space-y-3.5">
            <div className="rounded-lg border border-ink-800 bg-ink-900/80 p-3 space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-ink-400 uppercase">Enrolled Siblings</span>
                <span className="text-court-300 font-bold">
                  {collectingFamily.children.length} Athletes
                </span>
              </div>
              <div className="divide-y divide-ink-850 text-xs font-mono">
                {collectingFamily.children.map((c) => (
                  <div key={c.player.id} className="py-1.5 flex items-center justify-between">
                    <div>
                      <span className="text-ink-100 font-semibold">{c.player.name}</span>
                      <span className="text-[10px] text-ink-400 ml-1.5">({c.squadName})</span>
                    </div>
                    <div className="text-right">
                      <span className="text-ink-300">
                        Bal: {money(c.currentBalance, db.academy?.currency)}
                      </span>
                      <span className="text-ink-500 mx-1">·</span>
                      <span className="text-court-400">
                        Net: {money(c.netFee, db.academy?.currency)}/mo
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="pt-2 border-t border-ink-800 flex items-center justify-between font-mono text-xs">
                <span className="text-ink-300">Combined Family Balance:</span>
                <span className="text-sm font-bold text-amber-400">
                  {money(collectingFamily.combinedBalance, db.academy?.currency)}
                </span>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={`Total Payment Amount (${db.academy?.currency || "USD"})`}>
                <Input
                  type="number"
                  value={String(familyPaymentAmount)}
                  onChange={(v) => setFamilyPaymentAmount(Math.max(0, Number(v) || 0))}
                />
              </Field>
              <Field label="Payment Method">
                <Select
                  value={familyPaymentMethod}
                  onChange={setFamilyPaymentMethod}
                  options={["Cash", "Whish Money", "OMT", "Bank Transfer", "Check"]}
                />
              </Field>
            </div>

            <Field label="Receipt Notes (Optional)">
              <Input
                value={familyPaymentNotes}
                onChange={setFamilyPaymentNotes}
                placeholder="e.g. Settled full family package at front desk..."
              />
            </Field>
          </div>
        )}
      </Modal>
    </Modal>
  );
}

export default FamilyBundledInvoicingModal;

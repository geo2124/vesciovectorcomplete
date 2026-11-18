import { useState, useMemo } from "react";
import { Modal, Button, Chip, Select, money } from "@/components/kit";
import type { Coach, SessionItem } from "@/lib/mock-data";
import { useDB, type LedgerEntry } from "@/lib/data-store";
import { isSessionAttendanceVerified, computeSessionCoachPayout } from "@/lib/payroll";
import { exportPdf } from "@/lib/report";
import {
  Printer,
  Download,
  Wallet,
  CheckCircle2,
  DollarSign,
  Calendar,
  FileText,
} from "lucide-react";
import { toast } from "sonner";

interface CoachStatementModalProps {
  coach: Coach;
  open: boolean;
  onClose: () => void;
  sessions?: SessionItem[];
  ledger?: LedgerEntry[];
}

export type StatementItem = {
  id: string;
  date: string;
  type: "Session Earning" | "Payout Disbursement";
  description: string;
  reference: string;
  earned: number;
  baseSessionFee?: number;
  transportFee?: number;
  isOverridden?: boolean;
  disbursed: number;
  balance: number;
};

export function CoachStatementModal({
  coach,
  open,
  onClose,
  sessions: sessionsProp,
  ledger: ledgerProp,
}: CoachStatementModalProps) {
  const { db } = useDB();
  const sessions = sessionsProp ?? db.sessions;
  const ledger = ledgerProp ?? db.ledger;
  const [selectedYear, setSelectedYear] = useState<string>("All");
  const [selectedType, setSelectedType] = useState<string>("All");
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const rate = Number(coach.rate || 0);
  const academyName = db.academy?.name || "Vescio Vector Academy";
  const currency = db.academy?.currency || "USD";

  const computeSessionEarning = (s: SessionItem) => {
    return computeSessionCoachPayout(s, coach).totalSessionEarned;
  };

  // 1. Gather all attendance-verified sessions completed by this coach
  const completedSessions = useMemo(() => {
    const coachNameLower = coach.name?.toLowerCase().trim();
    return sessions.filter((s) => {
      const isAssigned =
        s.coachId === coach.id ||
        s.headCoachId === coach.id ||
        s.assistantCoachId === coach.id ||
        Boolean(
          coachNameLower &&
          (s.coach?.toLowerCase().trim() === coachNameLower ||
            s.headCoach?.toLowerCase().trim() === coachNameLower ||
            s.assistantCoach?.toLowerCase().trim() === coachNameLower),
        );
      if (!isAssigned) return false;
      return isSessionAttendanceVerified(s, db.attendance?.[s.id] || null).isVerified;
    });
  }, [sessions, coach.id, coach.name, db.attendance]);

  // 2. Gather all verified payroll ledger disbursement records (excluding Voided)
  const coachDisbursements = useMemo(() => {
    const q = coach.name.toLowerCase();
    return ledger.filter((l) => {
      if ((l.status as string) === "Voided") return false;
      const matchCoach =
        l.account?.toLowerCase().includes("coach") ||
        l.entry?.toLowerCase().includes(q) ||
        l.id.includes(coach.id);
      const isDisbursed =
        l.type === "Expense" ||
        l.type === "debit" ||
        l.account === "Coach Payroll Expense" ||
        l.account === "Coach payroll";
      return matchCoach && isDisbursed;
    });
  }, [ledger, coach.name, coach.id]);

  // 3. Compile chronological stream of all items for running balance
  const allStatementItems = useMemo(() => {
    const items: Array<{
      id: string;
      date: string;
      type: "Session Earning" | "Payout Disbursement";
      description: string;
      reference: string;
      earned: number;
      baseSessionFee?: number;
      transportFee?: number;
      isOverridden?: boolean;
      disbursed: number;
    }> = [];

    // Add session earnings
    completedSessions.forEach((s) => {
      const breakdown = computeSessionCoachPayout(s, coach);
      const feeBreakdownSuffix =
        breakdown.transportFee > 0
          ? ` — Session Fee: ${money(breakdown.baseSessionFee)} + Transport: ${money(breakdown.transportFee)}`
          : breakdown.isOverridden
            ? ` — Session Fee: ${money(breakdown.baseSessionFee)}`
            : "";
      items.push({
        id: s.id,
        date: s.date,
        type: "Session Earning",
        description: `${s.title} (${s.kind}${s.team ? ` · ${s.team}` : ""})${feeBreakdownSuffix}`,
        reference: s.id,
        earned: breakdown.totalSessionEarned,
        baseSessionFee: breakdown.baseSessionFee,
        transportFee: breakdown.transportFee,
        isOverridden: breakdown.isOverridden,
        disbursed: 0,
      });
    });

    // Add payroll disbursements
    coachDisbursements.forEach((d) => {
      const baseDesc =
        d.isAdvance || completedSessions.length === 0
          ? `Custom / Advance Payment (On Account)${d.advanceReason ? ` · ${d.advanceReason}` : ""}${d.linkedAdvanceSessionsCount ? ` · Covers ${d.linkedAdvanceSessionsCount} session(s)` : ""}`
          : d.entry || "Coach Payroll Disbursement Payout";
      items.push({
        id: d.id,
        date: d.date,
        type: "Payout Disbursement",
        description: baseDesc,
        reference: d.referenceId || d.id,
        earned: 0,
        disbursed: Math.abs(d.amount),
      });
    });

    // Sort ascending by date for chronological balance calculation
    items.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    let running = 0;
    const computed: StatementItem[] = items.map((item) => {
      running += item.earned - item.disbursed;
      const isAdvanceRow =
        item.type === "Payout Disbursement" &&
        (running < 0 || item.description.includes("Custom / Advance Payment"));
      return {
        ...item,
        description:
          isAdvanceRow && !item.description.includes("Custom / Advance Payment")
            ? `Custom / Advance Payment (On Account) — ${item.description}`
            : item.description,
        balance: running,
      };
    });

    return computed;
  }, [completedSessions, coachDisbursements, coach]);

  // Available year options
  const yearOptions = useMemo(() => {
    const years = new Set<string>();
    allStatementItems.forEach((item) => {
      if (item.date) years.add(item.date.slice(0, 4));
    });
    return [
      "All",
      ...Array.from(years)
        .sort((a, b) => a.localeCompare(b))
        .reverse(),
    ];
  }, [allStatementItems]);

  // Filtered view according to selected year & type
  const displayedItems = useMemo(() => {
    return allStatementItems
      .filter((item) => {
        const matchYear = selectedYear === "All" || item.date.startsWith(selectedYear);
        const matchType =
          selectedType === "All" ||
          (selectedType === "Earnings" && item.type === "Session Earning") ||
          (selectedType === "Payouts" && item.type === "Payout Disbursement");
        return matchYear && matchType;
      })
      .reverse(); // Display most recent first in table
  }, [allStatementItems, selectedYear, selectedType]);

  // Summary figures
  const totalBaseEarned = useMemo(
    () =>
      completedSessions.reduce(
        (sum, s) => sum + computeSessionCoachPayout(s, coach).baseSessionFee,
        0,
      ),
    [completedSessions, coach],
  );
  const totalTransportEarned = useMemo(
    () =>
      completedSessions.reduce(
        (sum, s) => sum + computeSessionCoachPayout(s, coach).transportFee,
        0,
      ),
    [completedSessions, coach],
  );
  const totalEarned = useMemo(
    () =>
      completedSessions.reduce(
        (sum, s) => sum + computeSessionCoachPayout(s, coach).totalSessionEarned,
        0,
      ),
    [completedSessions, coach],
  );
  const totalDisbursed = useMemo(
    () => coachDisbursements.reduce((acc, l) => acc + Math.abs(l.amount), 0),
    [coachDisbursements],
  );
  const netBalance = totalEarned - totalDisbursed;
  const netOutstanding = Math.max(0, netBalance);
  const advanceBalance = netBalance < 0 ? Math.abs(netBalance) : 0;

  // Clean, official HTML statement print generator
  const handlePrint = () => {
    const printDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    const printableItems = [...allStatementItems].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

    const rowsHtml = printableItems
      .map(
        (item) => `
        <tr>
          <td>${item.date}</td>
          <td><strong>${item.type === "Session Earning" ? "EARNED" : "PAYOUT"}</strong></td>
          <td>${item.description} <span style="color:#64748b; font-size:8px;">(Ref: ${item.reference})</span></td>
          <td class="text-right ${item.earned > 0 ? "earned-val" : ""}">${item.earned > 0 ? `+${money(item.earned)}` : "—"}</td>
          <td class="text-right ${item.disbursed > 0 ? "disbursed-val" : ""}">${item.disbursed > 0 ? `-${money(item.disbursed)}` : "—"}</td>
          <td class="text-right balance-val">${money(item.balance)}</td>
        </tr>`,
      )
      .join("");

    const printHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Official Coach Account Statement - ${coach.name}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 0;
      font-size: 10px;
      line-height: 1.35;
    }
    .statement-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #0f766e;
      padding-bottom: 12px;
      margin-bottom: 14px;
    }
    .academy-title { font-size: 16px; font-weight: 800; color: #0f766e; text-transform: uppercase; letter-spacing: 0.05em; }
    .statement-badge { font-size: 11px; font-weight: 700; color: #334155; margin-top: 2px; }
    .date-meta { font-size: 9px; color: #64748b; margin-top: 3px; }
    .coach-profile-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      padding: 8px 12px;
      margin-bottom: 14px;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
    }
    .field-label { font-size: 8px; font-weight: 700; text-transform: uppercase; color: #64748b; }
    .field-val { font-size: 11px; font-weight: 600; color: #0f172a; margin-top: 1px; }
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 6px;
      margin-bottom: 14px;
    }
    .kpi-cell {
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      padding: 6px 8px;
      text-align: center;
      background: #ffffff;
    }
    .kpi-cell.highlight {
      border-color: #0f766e;
      background: #f0fdfa;
    }
    .kpi-title { font-size: 8px; font-weight: 700; text-transform: uppercase; color: #475569; }
    .kpi-amount { font-size: 13px; font-weight: 800; color: #0f172a; margin-top: 1px; }
    .kpi-cell.highlight .kpi-amount { color: #0f766e; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 9.5px; }
    th {
      background: #f1f5f9;
      color: #334155;
      font-weight: 700;
      padding: 5px 6px;
      border-bottom: 1.5px solid #94a3b8;
      text-align: left;
      font-size: 8.5px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    td { padding: 5px 6px; border-bottom: 1px solid #e2e8f0; }
    tr:nth-child(even) td { background: #fafafa; }
    .text-right { text-align: right; }
    .earned-val { color: #047857; font-weight: 700; }
    .disbursed-val { color: #b91c1c; font-weight: 700; }
    .balance-val { font-weight: 700; color: #0f172a; }
    .footer-signoff {
      margin-top: 20px;
      padding-top: 10px;
      border-top: 1px solid #cbd5e1;
      display: flex;
      justify-content: space-between;
      font-size: 8.5px;
      color: #64748b;
    }
    @media print {
      body { margin: 0; padding: 0; }
    }
  </style>
</head>
<body>
  <div class="statement-header">
    <div>
      <div class="academy-title">${academyName}</div>
      <div class="statement-badge">Official Coach Account & Payroll Statement</div>
      <div class="date-meta">Statement Generated: ${printDate} · Period: ${selectedYear === "All" ? "All Time" : selectedYear}</div>
    </div>
    <div style="text-align:right;">
      <div style="font-weight:700; font-size:11px; color:#0f766e;">FINANCIAL CERTIFIED</div>
      <div style="font-size:9px; color:#64748b;">Ref: STM-${coach.id.toUpperCase()}-${new Date().getFullYear()}</div>
    </div>
  </div>

  <div class="coach-profile-box">
    <div>
      <div class="field-label">Coach Name</div>
      <div class="field-val">${coach.name}</div>
    </div>
    <div>
      <div class="field-label">Email / Contact</div>
      <div class="field-val">${coach.email || "academy@vescio.io"}</div>
    </div>
    <div>
      <div class="field-label">Contracted Rate</div>
      <div class="field-val">${currency} ${rate} / Session</div>
    </div>
    <div>
      <div class="field-label">Account Status</div>
      <div class="field-val">${netBalance < 0 ? `Advance / On Account: -${money(advanceBalance)} (Prepaid / Borrowed)` : netOutstanding > 0 ? "Disbursement Due" : "Settled Up-To-Date"}</div>
    </div>
  </div>

  <div class="kpi-grid">
    <div class="kpi-cell">
      <div class="kpi-title">Verified Sessions</div>
      <div class="kpi-amount">${completedSessions.length}</div>
    </div>
    <div class="kpi-cell">
      <div class="kpi-title">Total Earned Value</div>
      <div class="kpi-amount">${money(totalEarned)}</div>
    </div>
    <div class="kpi-cell">
      <div class="kpi-title">Total Disbursed</div>
      <div class="kpi-amount">${money(totalDisbursed)}</div>
    </div>
    <div class="kpi-cell highlight">
      <div class="kpi-title">${netBalance < 0 ? "Advance / On Account" : "Net Outstanding Due"}</div>
      <div class="kpi-amount">${netBalance < 0 ? `-${money(advanceBalance)} (Prepaid)` : money(netOutstanding)}</div>
    </div>
  </div>

  <div style="font-weight:700; font-size:10px; margin-top:10px; text-transform:uppercase; color:#334155; border-bottom:1px solid #cbd5e1; padding-bottom:3px;">
    Itemized Activity & Disbursements Ledger (${printableItems.length} records)
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:75px;">Date</th>
        <th style="width:70px;">Type</th>
        <th>Description / Reference</th>
        <th class="text-right" style="width:85px;">Earned (+)</th>
        <th class="text-right" style="width:85px;">Disbursed (-)</th>
        <th class="text-right" style="width:85px;">Balance</th>
      </tr>
    </thead>
    <tbody>
      ${rowsHtml}
    </tbody>
  </table>

  <div class="footer-signoff">
    <div>Certified by: Technical Directorate & Finance Office · Vescio Vector Academy Management</div>
    <div>Page 1 of 1 · Confirmed Authentic Record</div>
  </div>
</body>
</html>`;

    // Print using clean isolated iframe
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    iframe.style.zIndex = "-9999";
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      window.print();
      return;
    }

    doc.open();
    doc.write(printHtml);
    doc.close();

    iframe.contentWindow?.focus();
    setTimeout(() => {
      try {
        iframe.contentWindow?.print();
      } catch (e) {
        console.warn("Iframe print error, falling back to window.print:", e);
        window.print();
      }
      setTimeout(() => {
        if (document.body.contains(iframe)) {
          document.body.removeChild(iframe);
        }
      }, 1500);
    }, 250);
  };

  // Direct PDF Download handler using report exportPdf
  const handleDownloadPdf = async () => {
    try {
      setIsExportingPdf(true);
      const rows = allStatementItems.map((item) => [
        item.date,
        item.type === "Session Earning" ? "EARNED" : "PAYOUT",
        item.description,
        item.earned > 0 ? `+${money(item.earned)}` : "-",
        item.disbursed > 0 ? `-${money(item.disbursed)}` : "-",
        money(item.balance),
      ]);

      await exportPdf({
        title: `Coach Account Statement — ${coach.name}`,
        subtitle: `Rate: ${currency} ${rate}/sess · Total Disbursed: ${money(totalDisbursed)} · ${netBalance < 0 ? `Advance / On Account: -${money(advanceBalance)} (Prepaid / Borrowed)` : `Outstanding Due: ${money(netOutstanding)}`}`,
        academy: academyName,
        columns: [
          "Date",
          "Type",
          "Description / Ref",
          "Earned (+)",
          "Disbursed (-)",
          "Running Bal",
        ],
        rows,
        summary: [
          { label: "Rate", value: `${currency} ${rate}/sess` },
          { label: "Verified Sessions", value: `${completedSessions.length}` },
          { label: "Total Earned", value: money(totalEarned) },
          { label: "Total Disbursed", value: money(totalDisbursed) },
          {
            label: netBalance < 0 ? "Advance / On Account" : "Net Outstanding",
            value:
              netBalance < 0
                ? `-${money(advanceBalance)} (Prepaid / Borrowed)`
                : money(netOutstanding),
          },
        ],
        filename: `coach-statement-${coach.name.toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.pdf`,
      });
      toast.success("Coach statement PDF exported successfully.");
    } catch (err) {
      console.error("PDF export error:", err);
      toast.error("Failed to generate PDF statement.");
    } finally {
      setIsExportingPdf(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Coach Remuneration & Payroll Statement"
      meta={`${coach.name} · Contracted Rate: ${currency} ${rate}/session · Verified Academy Ledger`}
      wide
    >
      <div className="space-y-4">
        {/* Top Controls & Print/Download Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-ink-900 p-3 ring-1 ring-ink-750">
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-32">
              <Select value={selectedYear} onChange={setSelectedYear} options={yearOptions} />
            </div>
            <div className="w-40">
              <Select
                value={selectedType}
                onChange={setSelectedType}
                options={[
                  { value: "All", label: "All Records" },
                  { value: "Earnings", label: "Sessions Only" },
                  { value: "Payouts", label: "Disbursements Only" },
                ]}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="flex items-center gap-1.5 rounded bg-court-600 hover:bg-court-500 px-3 py-1.5 font-mono text-xs font-bold text-ink-950 transition-colors shadow-sm"
              title="Print official clean statement"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Print Statement</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={isExportingPdf}
              className="flex items-center gap-1.5 rounded bg-ink-800 hover:bg-ink-700 px-3 py-1.5 font-mono text-xs text-ink-200 ring-1 ring-ink-600 transition-colors disabled:opacity-50"
              title="Export statement as PDF"
            >
              <Download className="h-3.5 w-3.5 text-court-400" />
              <span>{isExportingPdf ? "Generating PDF..." : "Download PDF"}</span>
            </button>
          </div>
        </div>

        {/* Financial KPI Summary Cards */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 font-mono text-xs">
          <div className="rounded-lg bg-ink-850 p-2.5 ring-1 ring-ink-750">
            <div className="text-[10px] text-ink-400 uppercase">Verified Sessions</div>
            <div className="text-lg font-bold text-ink-100 mt-0.5">{completedSessions.length}</div>
            <div className="text-[10px] text-court-300 mt-0.5">
              {currency} {rate} / session
            </div>
          </div>
          <div className="rounded-lg bg-ink-850 p-2.5 ring-1 ring-ink-750">
            <div className="text-[10px] text-ink-400 uppercase">Total Earned Value</div>
            <div className="text-lg font-bold text-court-300 mt-0.5">{money(totalEarned)}</div>
            <div className="text-[10px] text-ink-400 mt-0.5">
              {totalTransportEarned > 0
                ? `${money(totalBaseEarned)} Sess + ${money(totalTransportEarned)} Trans.`
                : "All-time coaching"}
            </div>
          </div>
          <div className="rounded-lg bg-ink-850 p-2.5 ring-1 ring-ink-750">
            <div className="text-[10px] text-ink-400 uppercase">Total Disbursed</div>
            <div className="text-lg font-bold text-ink-100 mt-0.5">{money(totalDisbursed)}</div>
            <div className="text-[10px] text-ink-500 mt-0.5">
              {coachDisbursements.length} payouts
            </div>
          </div>
          <div
            className={`rounded-lg p-2.5 ring-1 ${
              netBalance < 0 ? "bg-warn/15 ring-warn/40" : "bg-court-500/10 ring-court-400/30"
            }`}
          >
            <div
              className={`text-[10px] uppercase ${netBalance < 0 ? "text-warn" : "text-court-300"}`}
            >
              {netBalance < 0 ? "Advance / On Account" : "Net Outstanding Due"}
            </div>
            <div
              className={`text-lg font-bold mt-0.5 ${
                netBalance < 0 ? "text-warn" : "text-court-400"
              }`}
            >
              {netBalance < 0 ? `-${money(advanceBalance)}` : money(netOutstanding)}
            </div>
            <div
              className={`text-[10px] mt-0.5 ${
                netBalance < 0 ? "text-warn font-semibold" : "text-court-300/80"
              }`}
            >
              {netBalance < 0
                ? `Advance / On Account: -${money(advanceBalance)} (Prepaid / Borrowed)`
                : netOutstanding > 0
                  ? "Pending Payout"
                  : "Settled"}
            </div>
          </div>
        </div>

        {netBalance < 0 && (
          <div className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 font-mono text-xs text-warn flex items-center justify-between gap-2">
            <span>
              <strong>Advance / On Account: -{money(advanceBalance)} (Prepaid / Borrowed)</strong> —
              Total disbursed ({money(totalDisbursed)}) exceeds verified session earnings (
              {money(totalEarned)}).
            </span>
            <Chip tone="warn">ON ACCOUNT</Chip>
          </div>
        )}

        {/* Ledger Activity Table */}
        <div className="rounded-lg bg-ink-900 ring-1 ring-ink-800 overflow-hidden">
          <div className="flex items-center justify-between border-b border-ink-800 bg-ink-850 px-3 py-2 text-xs font-mono text-ink-300">
            <span>Statement Transactions ({displayedItems.length})</span>
            <span className="text-[10px] text-ink-500">Sorted by Date (Latest First)</span>
          </div>

          {displayedItems.length === 0 ? (
            <div className="py-8 text-center font-mono text-xs text-ink-500">
              No transactions match the selected filters.
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto divide-y divide-ink-800/80 text-xs font-mono">
              {displayedItems.map((item) => {
                const isAdvanceItem =
                  item.type === "Payout Disbursement" &&
                  (item.balance < 0 || item.description.includes("Custom / Advance Payment"));
                return (
                  <div
                    key={item.id}
                    className="p-2.5 flex items-center justify-between gap-3 hover:bg-ink-850/50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-ink-400 text-[11px]">{item.date}</span>
                        <Chip
                          tone={
                            item.type === "Session Earning"
                              ? "good"
                              : isAdvanceItem
                                ? "warn"
                                : "neutral"
                          }
                        >
                          {item.type === "Session Earning"
                            ? "EARNED"
                            : isAdvanceItem
                              ? "CUSTOM / ADVANCE PAYMENT (ON ACCOUNT)"
                              : "PAYOUT"}
                        </Chip>
                        {item.type === "Session Earning" && item.baseSessionFee !== undefined && (
                          <span className="rounded bg-ink-850 px-1.5 py-0.5 text-[10px] text-court-300 ring-1 ring-ink-700">
                            Session Fee: {money(item.baseSessionFee)}
                            {item.transportFee && item.transportFee > 0
                              ? ` + Transport: +${money(item.transportFee)}`
                              : ""}
                          </span>
                        )}
                      </div>
                      <div className="text-ink-100 font-medium text-sm mt-0.5 truncate">
                        {item.description}
                      </div>
                      <div className="text-[10px] text-ink-500 mt-0.5">Ref: {item.reference}</div>
                    </div>

                    <div className="text-right shrink-0">
                      {item.earned > 0 && (
                        <div className="font-bold text-court-300 text-sm">
                          +{money(item.earned)}
                        </div>
                      )}
                      {item.disbursed > 0 && (
                        <div className="font-bold text-ink-200 text-sm">
                          -{money(item.disbursed)}
                        </div>
                      )}
                      <div className="text-[10px] text-ink-400 mt-0.5">
                        Bal:{" "}
                        <span
                          className={`font-semibold ${
                            item.balance < 0 ? "text-warn" : "text-ink-200"
                          }`}
                        >
                          {item.balance < 0
                            ? `-${money(Math.abs(item.balance))} (Advance)`
                            : money(item.balance)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer info & Actions */}
        <div className="flex items-center justify-between border-t border-ink-800 pt-3 text-xs font-mono text-ink-400">
          <div className="flex items-center gap-1.5 text-[11px]">
            <CheckCircle2 className="h-3.5 w-3.5 text-court-400" />
            <span>Official Academy Accounting Record</span>
          </div>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}

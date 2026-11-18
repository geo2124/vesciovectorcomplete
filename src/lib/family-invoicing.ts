import type { Player, Team, Branch, Invoice } from "@/lib/mock-data";
import { calculatePlayerMonthlyFee } from "@/lib/payments";
import { money as kitMoney } from "@/components/kit";

export interface SiblingDiscountConfig {
  secondChildPercent: number; // e.g. 10 for 10%
  thirdPlusChildPercent: number; // e.g. 15 for 15%
}

export const DEFAULT_SIBLING_DISCOUNT_CONFIG: SiblingDiscountConfig = {
  secondChildPercent: 10,
  thirdPlusChildPercent: 15,
};

export interface SiblingChild {
  player: Player;
  squadName: string;
  programTier: string;
  branch: string;
  standardFee: number;
  siblingRank: number; // 1 = 1st child (full fee), 2 = 2nd child (-10%), 3+ = 3rd+ child (-15%)
  discountPercent: number;
  discountAmount: number;
  netFee: number;
  currentBalance: number;
  isAlreadyBilled: boolean;
  existingInvoiceId?: string;
  existingInvoiceNumber?: string;
}

export interface FamilyGroup {
  familyKey: string;
  guardianName: string;
  guardianPhone: string;
  guardianEmail?: string;
  primaryBranch: string;
  children: SiblingChild[];
  totalStandard: number;
  totalDiscount: number;
  totalNet: number;
  combinedBalance: number;
  pendingCount: number;
  alreadyBilledCount: number;
}

/**
 * Normalizes phone numbers by stripping non-digit characters (except leading +).
 */
export function normalizePhone(rawPhone?: string): string {
  if (!rawPhone) return "";
  const cleaned = rawPhone.replace(/[^\d+]/g, "").trim();
  return cleaned;
}

/**
 * Normalizes guardian name for robust grouping.
 */
export function normalizeName(name?: string): string {
  if (!name) return "";
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Detects all families with 2 or more enrolled athletes and computes automatic
 * sibling discount pricing.
 */
export function detectFamilyGroups(
  players: Player[],
  teams: Team[],
  branches: Branch[],
  invoices: Invoice[],
  targetMonth: string,
  targetYear: number,
  config: SiblingDiscountConfig = DEFAULT_SIBLING_DISCOUNT_CONFIG,
  branchFilter?: string,
): FamilyGroup[] {
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
  const monthIdx = MONTH_NAMES.findIndex((m) => m.toLowerCase() === targetMonth.toLowerCase());
  const monthCode = String((monthIdx !== -1 ? monthIdx : new Date().getMonth()) + 1).padStart(
    2,
    "0",
  );

  const existingInvoiceMap = new Map<string, Invoice>();
  (invoices || []).forEach((inv) => {
    existingInvoiceMap.set(inv.id, inv);
  });

  // 1. Group active players by Guardian Phone OR Guardian Name
  const familyBuckets = new Map<string, Player[]>();

  (players || []).forEach((p) => {
    const isActive = p.status === "Active" || p.status === "Idle" || p.status === "Soft flag";
    if (!isActive) return;

    if (branchFilter && p.branch && p.branch.toLowerCase() !== branchFilter.toLowerCase()) {
      return;
    }

    const normFamilyId = p.familyId ? p.familyId.trim().toLowerCase() : "";
    const normPhone = normalizePhone(p.parentPhone || p.guardianPhone);
    const normName = normalizeName(p.parent || p.guardianName);

    // Prefer explicit familyId if provided, then phone (e.g. +96170123456), fallback to normalized guardian name
    const familyKey = normFamilyId
      ? `fam_${normFamilyId}`
      : normPhone
        ? `tel_${normPhone}`
        : normName
          ? `name_${normName}`
          : "";
    if (!familyKey) return;

    const existing = familyBuckets.get(familyKey) || [];
    existing.push(p);
    familyBuckets.set(familyKey, existing);
  });

  const familyGroups: FamilyGroup[] = [];

  // 2. Filter buckets with 2 or more athletes (Multi-Athlete / Sibling Families)
  familyBuckets.forEach((familyPlayers, familyKey) => {
    if (familyPlayers.length < 2) return;

    // Resolve primary guardian contact info from children
    const guardianName =
      familyPlayers.find((p) => p.parent?.trim())?.parent?.trim() ||
      familyPlayers.find((p) => p.guardianName?.trim())?.guardianName?.trim() ||
      "Guardian";

    const guardianPhone =
      familyPlayers.find((p) => p.parentPhone?.trim())?.parentPhone?.trim() ||
      familyPlayers.find((p) => p.guardianPhone?.trim())?.guardianPhone?.trim() ||
      "";

    const guardianEmail =
      familyPlayers.find((p) => p.guardianEmail?.trim())?.guardianEmail?.trim() || undefined;

    const primaryBranch = familyPlayers[0]?.branch || "Headquarters";

    // 3. Calculate individual fees and sort descending by rate
    // Highest fee is Child #1 (100%), 2nd is Child #2 (e.g. -10%), 3rd+ is Child #3+ (e.g. -15%)
    const ratedChildren = familyPlayers.map((p) => {
      const standardFee = calculatePlayerMonthlyFee(p, teams, branches);
      const isExempt = Boolean(p.isScholarship || standardFee <= 0);
      const squad = (teams || []).find((t) => p.teams && p.teams.includes(t.name));
      const squadName =
        p.teams && p.teams.length > 0 ? p.teams.join(" + ") : squad?.name || p.category || "Squad";
      const programTier = squad?.tier || p.programTier || "Standard Program";
      const invoiceId = `${p.id}_${targetYear}_${monthCode}`;
      const existingInv = existingInvoiceMap.get(invoiceId);

      return {
        player: p,
        squadName,
        programTier,
        branch: p.branch || "HQ",
        standardFee,
        currentBalance: p.balance || 0,
        isAlreadyBilled: Boolean(existingInv) || isExempt,
        existingInvoiceId: existingInv?.id,
        existingInvoiceNumber: existingInv?.invoiceNumber,
      };
    });

    // Sort by standard fee descending so largest tuition is Child 1
    ratedChildren.sort((a, b) => b.standardFee - a.standardFee);

    // Apply sibling discount ranks
    let totalStandard = 0;
    let totalDiscount = 0;
    let totalNet = 0;
    let combinedBalance = 0;
    let pendingCount = 0;
    let alreadyBilledCount = 0;

    const childrenWithDiscount: SiblingChild[] = ratedChildren.map((child, index) => {
      const siblingRank = index + 1;
      let discountPercent = 0;

      if (child.standardFee > 0) {
        if (siblingRank === 2) {
          discountPercent = config.secondChildPercent;
        } else if (siblingRank >= 3) {
          discountPercent = config.thirdPlusChildPercent;
        }
      }

      const discountAmount = Math.round((child.standardFee * discountPercent) / 100);
      const netFee = Math.max(0, child.standardFee - discountAmount);

      totalStandard += child.standardFee;
      totalDiscount += discountAmount;
      totalNet += netFee;
      combinedBalance += child.currentBalance;

      if (child.isAlreadyBilled) {
        alreadyBilledCount += 1;
      } else {
        pendingCount += 1;
      }

      return {
        ...child,
        siblingRank,
        discountPercent,
        discountAmount,
        netFee,
      };
    });

    familyGroups.push({
      familyKey,
      guardianName,
      guardianPhone,
      guardianEmail,
      primaryBranch,
      children: childrenWithDiscount,
      totalStandard,
      totalDiscount,
      totalNet,
      combinedBalance,
      pendingCount,
      alreadyBilledCount,
    });
  });

  // Sort families by number of siblings descending, then by net tuition descending
  return familyGroups.sort((a, b) => {
    if (b.children.length !== a.children.length) {
      return b.children.length - a.children.length;
    }
    return b.totalNet - a.totalNet;
  });
}

/**
 * Formats a clean, high-clarity WhatsApp statement message for the guardian.
 */
export function formatFamilyWhatsAppStatement(
  family: FamilyGroup,
  monthName: string,
  year: number,
  academyName = "Vescio Vector Academy",
  currency = "USD",
): string {
  const lines: string[] = [
    `🏀 *${academyName.toUpperCase()}*`,
    `👨‍👩‍👧‍👦 *UNIFIED FAMILY STATEMENT · ${monthName.toUpperCase()} ${year}*`,
    `Guardian: *${family.guardianName}*`,
    `Enrolled Siblings: *${family.children.length} athletes*`,
    `----------------------------------------`,
  ];

  family.children.forEach((c) => {
    const rankLabel =
      c.siblingRank === 1
        ? "1st Athlete (Standard)"
        : c.siblingRank === 2
          ? `2nd Athlete (-${c.discountPercent}% Sibling Discount)`
          : `${c.siblingRank}rd+ Athlete (-${c.discountPercent}% Sibling Discount)`;

    lines.push(`• *${c.player.name}* (${c.squadName})`);
    lines.push(`  Tier: ${rankLabel}`);
    if (c.discountPercent > 0) {
      lines.push(
        `  Tuition: ~${kitMoney(c.standardFee, currency)}~ ➔ *${kitMoney(c.netFee, currency)}* (Saved ${kitMoney(c.discountAmount, currency)})`,
      );
    } else {
      lines.push(`  Tuition: *${kitMoney(c.netFee, currency)}*`);
    }
  });

  lines.push(`----------------------------------------`);
  lines.push(`Standard Gross Total: ${kitMoney(family.totalStandard, currency)}`);
  if (family.totalDiscount > 0) {
    lines.push(`🎁 Total Sibling Savings: -${kitMoney(family.totalDiscount, currency)}`);
  }
  lines.push(`⭐ *NET FAMILY TUITION DUE: ${kitMoney(family.totalNet, currency)}*`);

  if (family.combinedBalance > 0) {
    lines.push(`Outstanding Prior Balance: ${kitMoney(family.combinedBalance, currency)}`);
    lines.push(
      `💰 *Total Balance Payable: ${kitMoney(family.totalNet + family.combinedBalance, currency)}*`,
    );
  }

  lines.push(``);
  lines.push(
    `Thank you for being part of our basketball family! For cash or transfer settlement, please visit the front desk.`,
  );

  return lines.join("\n");
}

/**
 * Generates and downloads a branded PDF "Unified Family Statement".
 */
export async function exportFamilyStatementPdf(
  family: FamilyGroup,
  monthName: string,
  year: number,
  academyName = "Vescio Vector Academy",
  currency = "USD",
): Promise<void> {
  const [{ default: jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const doc = new jsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  const pageWidth = doc.internal.pageSize.width;

  // Header Brand Ribbon
  doc.setFillColor(18, 125, 117); // #127d75 court primary
  doc.rect(14, 12, pageWidth - 28, 2.5, "F");

  // Title & Academy
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(24, 34, 45);
  doc.text(academyName.toUpperCase(), 14, 22);

  doc.setFontSize(12);
  doc.setTextColor(18, 125, 117);
  doc.text("UNIFIED FAMILY STATEMENT · TUITION & SIBLING CONCESSION", 14, 29);

  // Statement Meta Info Box
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);

  const statementRef = `FAM-${year}-${monthName.slice(0, 3).toUpperCase()}-${Math.abs(
    family.guardianName.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0),
  )
    .toString()
    .slice(-4)}`;

  doc.text(
    `Statement Date: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
    14,
    37,
  );
  doc.text(`Reference No: ${statementRef}`, 14, 42);
  doc.text(`Billing Period: ${monthName} ${year}`, 14, 47);

  // Guardian Box
  doc.setFont("helvetica", "bold");
  doc.setTextColor(24, 34, 45);
  doc.text(`Guardian: ${family.guardianName}`, pageWidth - 14, 37, { align: "right" });
  doc.setFont("helvetica", "normal");
  if (family.guardianPhone) {
    doc.text(`Contact: ${family.guardianPhone}`, pageWidth - 14, 42, { align: "right" });
  }
  doc.text(
    `Enrolled Athletes: ${family.children.length} Siblings · Facility: ${family.primaryBranch}`,
    pageWidth - 14,
    47,
    { align: "right" },
  );

  // Divider line
  doc.setDrawColor(226, 232, 240);
  doc.line(14, 52, pageWidth - 14, 52);

  // Table of Siblings
  const tableData = family.children.map((c) => {
    const concessionLabel =
      c.discountPercent > 0
        ? `-${c.discountPercent}% (${kitMoney(c.discountAmount, currency)})`
        : "None (1st Child)";

    return [
      `#${c.siblingRank}`,
      c.player.name,
      c.squadName,
      c.branch,
      kitMoney(c.standardFee, currency),
      concessionLabel,
      kitMoney(c.netFee, currency),
    ];
  });

  autoTable(doc, {
    startY: 56,
    head: [
      [
        "#",
        "Athlete Name",
        "Squad / Program",
        "Branch",
        "Standard",
        "Sibling Concession",
        "Net Tuition",
      ],
    ],
    body: tableData,
    theme: "striped",
    headStyles: {
      fillColor: [24, 34, 45],
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 9,
      halign: "left",
    },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      1: { cellWidth: 40, fontStyle: "bold" },
      2: { cellWidth: 38 },
      3: { cellWidth: 24 },
      4: { cellWidth: 24, halign: "right" },
      5: { cellWidth: 32, halign: "right", textColor: [18, 125, 117] },
      6: { cellWidth: 24, halign: "right", fontStyle: "bold" },
    },
    styles: {
      fontSize: 8.5,
      cellPadding: 3,
    },
    margin: { left: 14, right: 14 },
  });

  // Financial Summary Box below table
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalY = (doc as any).lastAutoTable?.finalY || 130;
  const summaryX = pageWidth - 90;

  doc.setFillColor(248, 250, 252);
  doc.rect(summaryX - 5, finalY + 6, 81, 46, "F");
  doc.setDrawColor(226, 232, 240);
  doc.rect(summaryX - 5, finalY + 6, 81, 46, "S");

  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text("Standard Gross Tuition:", summaryX, finalY + 14);
  doc.text(kitMoney(family.totalStandard, currency), pageWidth - 16, finalY + 14, {
    align: "right",
  });

  if (family.totalDiscount > 0) {
    doc.setTextColor(18, 125, 117);
    doc.text("Total Sibling Savings:", summaryX, finalY + 21);
    doc.text(`-${kitMoney(family.totalDiscount, currency)}`, pageWidth - 16, finalY + 21, {
      align: "right",
    });
  }

  doc.setTextColor(24, 34, 45);
  doc.setFont("helvetica", "bold");
  doc.text(`Net ${monthName} Tuition:`, summaryX, finalY + 28);
  doc.text(kitMoney(family.totalNet, currency), pageWidth - 16, finalY + 28, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setTextColor(100, 116, 139);
  doc.text("Prior Outstanding Balance:", summaryX, finalY + 35);
  doc.text(kitMoney(family.combinedBalance, currency), pageWidth - 16, finalY + 35, {
    align: "right",
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(18, 125, 117);
  doc.text("Total Amount Due:", summaryX, finalY + 44);
  doc.text(
    kitMoney(family.totalNet + family.combinedBalance, currency),
    pageWidth - 16,
    finalY + 44,
    { align: "right" },
  );

  // Policy & Signature Footer
  const footerY = Math.max(finalY + 60, 230);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(148, 163, 184);
  doc.text(
    "Policy Notice: Sibling concession rates apply to active athletes from the same immediate family registered under the academy's official multi-athlete policy. Invoices are settled in-person via cash or direct bank wire.",
    14,
    footerY,
    { maxWidth: pageWidth - 28 },
  );

  doc.setDrawColor(203, 213, 225);
  doc.line(14, footerY + 15, 60, footerY + 15);
  doc.text("Authorized Finance Signature / Stamp", 14, footerY + 20);

  doc.save(
    `family-statement-${family.guardianName.toLowerCase().replace(/[^a-z0-9]/g, "-")}-${monthName}-${year}.pdf`,
  );
}

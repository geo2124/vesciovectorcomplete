import type { SessionItem } from "./mock-data";
import type { LedgerEntry } from "./data-store";
import { money } from "@/components/kit";
import { normalizeDoubleEntryLedger } from "./accounting-coa";

export function getGameOfficialFeeEntries(session: SessionItem): LedgerEntry[] {
  const sessionId = String(session?.id || "");
  if (!sessionId) return [];

  const newEntries: LedgerEntry[] = [];
  const sessionDate =
    typeof session.date === "string" && session.date
      ? session.date
      : new Date().toISOString().slice(0, 10);
  const sessionBranch =
    typeof session.branch === "string" && session.branch ? session.branch : "HQ";
  const matchTitle =
    typeof session.title === "string" && session.title
      ? session.title
      : `${session.teamA || "Team A"} vs ${session.teamB || "Team B"}`;

  // Add Referees
  const referees = Array.isArray(session.referees) ? session.referees : [];
  referees.forEach((ref, index) => {
    if (!ref || typeof ref !== "object") return;
    const fee = Number(ref.fee) || 0;
    if (fee > 0) {
      const officialName =
        (typeof ref.name === "string" ? ref.name.trim() : "") ||
        (ref.source === "outsource" ? "Outsourced Referee" : "Personnel Official");
      const roleName = typeof ref.role === "string" && ref.role ? ref.role : "Referee";
      const sourceLabel = ref.source === "outsource" ? "Outsourced" : "Personnel";

      newEntries.push(
        normalizeDoubleEntryLedger({
          id: `match-fee-ref-${sessionId}-${String(ref.id || index)}`,
          date: sessionDate,
          account: "Referee & Official Fees",
          category: "Officials & Game Staff",
          entry: `Referee: ${roleName} — ${officialName} (${sourceLabel}) · ${matchTitle}`,
          description: `Official compensation for ${matchTitle}`,
          type: "Expense",
          amount: -Math.abs(fee),
          status: "Paid",
          branch: sessionBranch,
          referenceId: sessionId,
          module: "academy",
          note: `Assigned referee (${roleName}) fee: ${money(fee)}`,
        }),
      );
    }
  });

  // Add Match Staff
  const matchStaff = Array.isArray(session.matchStaff) ? session.matchStaff : [];
  matchStaff.forEach((st, index) => {
    if (!st || typeof st !== "object") return;
    const fee = Number(st.fee) || 0;
    if (fee > 0) {
      const staffName =
        (typeof st.name === "string" ? st.name.trim() : "") ||
        (st.source === "outsource" ? "Outsourced Staff" : "Personnel Staff");
      const roleName = typeof st.role === "string" && st.role ? st.role : "Staff";
      const sourceLabel = st.source === "outsource" ? "Outsourced" : "Personnel";

      newEntries.push(
        normalizeDoubleEntryLedger({
          id: `match-fee-staff-${sessionId}-${String(st.id || index)}`,
          date: sessionDate,
          account: "Referee & Official Fees",
          category: "Officials & Game Staff",
          entry: `Game Staff: ${roleName} — ${staffName} (${sourceLabel}) · ${matchTitle}`,
          description: `Staff compensation for ${matchTitle}`,
          type: "Expense",
          amount: -Math.abs(fee),
          status: "Paid",
          branch: sessionBranch,
          referenceId: sessionId,
          module: "academy",
          note: `Assigned match staff (${roleName}) fee: ${money(fee)}`,
        }),
      );
    }
  });

  return newEntries;
}

export function syncGameOfficialFeesToLedger(
  session: SessionItem,
  currentLedger: LedgerEntry[],
): LedgerEntry[] {
  const safeLedger = Array.isArray(currentLedger) ? currentLedger : [];
  const sessionId = String(session?.id || "");
  if (!sessionId) return safeLedger;

  // Remove existing ledger entries for this game's officials to prevent duplicates
  const cleanedLedger = safeLedger.filter(
    (l) =>
      !(
        l.referenceId === sessionId &&
        (l.account === "Referee & Official Fees" ||
          l.account === "Match Operations" ||
          l.category === "Officials & Game Staff" ||
          l.id.startsWith("match-fee-") ||
          l.id.startsWith("ledger-ref-") ||
          l.id.startsWith("ledger-staff-"))
      ),
  );

  const newEntries = getGameOfficialFeeEntries(session);

  if (newEntries.length === 0 && cleanedLedger.length === safeLedger.length) {
    return safeLedger;
  }

  return [...newEntries, ...cleanedLedger];
}

export function removeGameOfficialFeesFromLedger(
  sessionId: string,
  currentLedger: LedgerEntry[],
): LedgerEntry[] {
  const safeLedger = Array.isArray(currentLedger) ? currentLedger : [];
  const filtered = safeLedger.filter(
    (l) =>
      !(
        l.referenceId === sessionId &&
        (l.account === "Referee & Official Fees" ||
          l.account === "Match Operations" ||
          l.category === "Officials & Game Staff" ||
          l.id.startsWith("match-fee-") ||
          l.id.startsWith("ledger-ref-") ||
          l.id.startsWith("ledger-staff-"))
      ),
  );
  return filtered.length === safeLedger.length ? safeLedger : filtered;
}

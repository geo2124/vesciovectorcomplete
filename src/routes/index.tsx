import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { AppShell } from "@/components/app-shell";
import { Chip, Panel, Row, Stat, Table, Td, Th, money } from "@/components/kit";
import { useDB, useTenantUser, calculateBranchCourtUtilizationAnalytics } from "@/lib/data-store";
import { calculateCoachPayroll } from "@/lib/payroll";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Vescio Vector" },
      {
        name: "description",
        content:
          "Academy overview: players, active teams, weekly sessions, collections, package usage and inventory alerts.",
      },
      { property: "og:title", content: "Dashboard — Vescio Vector" },
      {
        property: "og:description",
        content: "Academy overview with players, teams, sessions and collections at a glance.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { db, movePlayerToCrmFollowUp } = useDB();
  const currentUser = useTenantUser();
  const isBranchManager =
    (currentUser?.role === "Branch Manager" ||
      currentUser?.branchScope === "Assigned branch only") &&
    Boolean(currentUser?.branch);
  const userBranch = isBranchManager ? currentUser?.branch || "" : "";

  const allPlayers = db.players;
  const allTeams = db.teams;
  const allSessions = db.sessions;
  const allCoaches = db.coaches;
  const allBranches = db.branches;
  const allLedger = db.ledger;
  const academy = db.academy;

  const players = isBranchManager
    ? allPlayers.filter((p) => p.branch?.toLowerCase() === userBranch.toLowerCase())
    : allPlayers;
  const teams = isBranchManager
    ? allTeams.filter((t) => t.branch?.toLowerCase() === userBranch.toLowerCase())
    : allTeams;
  const sessions = isBranchManager
    ? allSessions.filter((s) => s.branch?.toLowerCase() === userBranch.toLowerCase())
    : allSessions;
  const coaches = isBranchManager
    ? allCoaches.filter((c) => c.branch?.toLowerCase() === userBranch.toLowerCase())
    : allCoaches;
  const branches = isBranchManager
    ? allBranches.filter(
        (b) =>
          b.name.toLowerCase() === userBranch.toLowerCase() ||
          b.id.toLowerCase() === userBranch.toLowerCase(),
      )
    : allBranches;
  const ledger = isBranchManager
    ? allLedger.filter((l) => l.branch?.toLowerCase() === userBranch.toLowerCase())
    : allLedger;

  const now = new Date();
  const currentMonthName = now.toLocaleString("en-US", { month: "long" });
  const currentMonthIndex = now.getMonth();
  const currentYear = now.getFullYear();
  const currentYearMonth = `${currentYear}-${String(currentMonthIndex + 1).padStart(2, "0")}`;

  const collected = ledger
    .filter(
      (l) =>
        (l.type === "Revenue" || (l.type as string) === "credit") &&
        l.status === "Collected" &&
        (l.status as string) !== "Voided",
    )
    .reduce((a, l) => a + Math.abs(l.amount), 0);

  const monthRevenue = ledger
    .filter(
      (l) =>
        (l.type === "Revenue" || (l.type as string) === "credit") &&
        l.status === "Collected" &&
        (l.status as string) !== "Voided" &&
        l.date?.startsWith(currentYearMonth),
    )
    .reduce((a, l) => a + Math.abs(l.amount), 0);

  const expenses = ledger
    .filter(
      (l) =>
        (l.type === "Expense" || (l.type as string) === "debit") &&
        (l.status === "Paid" || l.status === "Collected") &&
        (l.status as string) !== "Voided" &&
        (l.status as string) !== "Pending" &&
        l.date?.startsWith(currentYearMonth),
    )
    .reduce((a, l) => a + Math.abs(l.amount), 0);

  const coachPayrollMap = useMemo(() => {
    const res = calculateCoachPayroll(db, {
      monthIndex: currentMonthIndex,
      monthName: currentMonthName,
      year: currentYear,
      branchFilter: isBranchManager ? userBranch : undefined,
    });
    const map = new Map<string, number>();
    res.rows.forEach((row) => {
      if (row.totalPayout > 0 || row.totalDisbursed > 0) {
        map.set(row.coachId, row.isDisbursed ? 0 : Math.max(0, row.netBalance));
      }
    });
    return map;
  }, [db, currentMonthIndex, currentMonthName, currentYear, isBranchManager, userBranch]);
  const open = players.reduce((a, p) => a + p.balance, 0);
  const games = sessions.filter((s) => s.kind === "Game").length;
  const low = db.stock.filter(
    (s) =>
      s.stock <= s.reorder &&
      (!isBranchManager ||
        !s.branch ||
        s.branch.toLowerCase() === "all" ||
        s.branch.toLowerCase() === userBranch.toLowerCase()),
  );
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = [...sessions].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const todays = upcoming.filter((s) => s.date >= today).slice(0, 4);

  const coachStatsMap = useMemo(() => {
    const map = new Map<string, { wins: number; losses: number; completedSessions: number }>();
    const sessionList = db.sessions || [];

    const teamList = db.teams || [];
    coaches.forEach((c) => {
      const cNameLower = c.name?.toLowerCase().trim();
      const coachTeams = teamList.filter((t) => {
        return (
          t.coachId === c.id ||
          t.headCoachId === c.id ||
          t.assistantId === c.id ||
          Boolean(
            cNameLower &&
            (t.headCoach?.toLowerCase().trim() === cNameLower ||
              t.assistant?.toLowerCase().trim() === cNameLower ||
              t.coach?.toLowerCase().trim() === cNameLower),
          )
        );
      });
      const coachTeamNames = new Set(coachTeams.map((t) => t.name.toLowerCase().trim()));

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
        wins,
        losses,
        completedSessions: completed.length,
      });
    });

    return map;
  }, [coaches, db.sessions, db.teams]);

  return (
    <AppShell
      crumb={isBranchManager ? `OPS / DASHBOARD · ${userBranch}` : "OPS / DASHBOARD"}
      title={isBranchManager ? `Overview · ${userBranch}` : "Overview"}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={isBranchManager ? `Players (${userBranch})` : "Total players"}
          value={String(players.length)}
          note={isBranchManager ? "assigned facility" : `of ${academy.playersLimit || 400} allowed`}
          accent
        />
        <Stat
          label="Active teams"
          value={String(teams.length)}
          note={isBranchManager ? userBranch : `${branches.length} branches`}
        />
        <Stat label="Scheduled activity" value={String(sessions.length)} note={`${games} games`} />
        <Stat
          label={`Collected (${currentMonthName})`}
          value={money(monthRevenue || collected)}
          note={`${money(expenses)} mo. exp · ${money(open)} open${monthRevenue ? ` · ${money(collected)} total` : " (all-time)"}`}
          accent
        />
      </div>

      {/* Level D: Overall Academy Financial Dashboard — Court Rental & Utilization Summary */}
      {(() => {
        const scopedBranches = isBranchManager
          ? allBranches.filter((b) => b.name?.toLowerCase() === userBranch.toLowerCase())
          : allBranches;
        const utilRows = calculateBranchCourtUtilizationAnalytics(
          scopedBranches,
          sessions,
          ledger,
          teams,
          coaches,
        );
        const totalFull = utilRows.reduce((s, r) => s + r.fullCourtSessions, 0);
        const totalHca = utilRows.reduce((s, r) => s + r.hcaSessions, 0);
        const totalHcb = utilRows.reduce((s, r) => s + r.hcbSessions, 0);
        const totalHours = utilRows.reduce((s, r) => s + r.totalHours, 0);
        const totalCourtRent = utilRows.reduce((s, r) => s + r.sessionCourtRentalCost, 0);
        const totalFixedRent = utilRows.reduce((s, r) => s + r.fixedFacilityOverhead, 0);

        return (
          <div className="mt-4 rounded-xl border border-ink-800 bg-ink-900/80 p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-2 w-2 rounded-full bg-court-400" />
                <span className="font-mono text-xs font-bold uppercase text-court-300">
                  Court Allocation &amp; Multi-Level Rental Impact (Full Court vs. HCA / HCB)
                </span>
              </div>
              <Link
                to="/accounting"
                className="font-mono text-[11px] font-semibold text-court-400 hover:text-court-300"
              >
                Open Financial Dashboard →
              </Link>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 font-mono text-xs">
              <div className="rounded bg-ink-950/70 p-2 ring-1 ring-ink-800">
                <span className="block text-[9px] uppercase text-ink-400">Full Court Bookings</span>
                <span className="font-bold text-ink-100">{totalFull} sessions</span>
              </div>
              <div className="rounded bg-ink-950/70 p-2 ring-1 ring-ink-800">
                <span className="block text-[9px] uppercase text-court-400">Half Court — HCA</span>
                <span className="font-bold text-court-300">{totalHca} sessions</span>
              </div>
              <div className="rounded bg-ink-950/70 p-2 ring-1 ring-ink-800">
                <span className="block text-[9px] uppercase text-court-400">Half Court — HCB</span>
                <span className="font-bold text-court-300">{totalHcb} sessions</span>
              </div>
              <div className="rounded bg-ink-950/70 p-2 ring-1 ring-ink-800">
                <span className="block text-[9px] uppercase text-ink-400">Session Court Rent</span>
                <span className="font-bold text-warn">
                  {money(totalCourtRent)} ({totalHours}h)
                </span>
              </div>
              <div className="rounded bg-ink-950/70 p-2 ring-1 ring-ink-800">
                <span className="block text-[9px] uppercase text-ink-400">Total Facility Cost</span>
                <span className="font-bold text-bad">{money(totalCourtRent + totalFixedRent)}</span>
              </div>
            </div>
          </div>
        );
      })()}

      {players.some(
        (p) => p.status === "Idle" && (Number(p.missedSessionsSinceIdle) || 0) >= 3,
      ) && (
        <div className="mt-4 rounded-xl border border-bad/40 bg-bad/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2">
              <span className="rounded bg-bad/20 px-2 py-0.5 font-mono text-[10px] font-bold text-bad border border-bad/40">
                HIGH-PRIORITY IDLE RENEWAL ALERTS
              </span>
              <span className="font-mono text-xs text-ink-200">
                Every-3-Sessions Missed While Idle Engine
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Link
                to="/crm"
                className="font-mono text-[11px] font-semibold text-amber-300 hover:text-amber-200"
              >
                Open CRM Pipeline →
              </Link>
              <Link
                to="/players"
                className="font-mono text-[11px] font-semibold text-court-400 hover:text-court-300"
              >
                View all Idle players →
              </Link>
            </div>
          </div>
          <div className="space-y-2.5">
            {players
              .filter((p) => p.status === "Idle" && (Number(p.missedSessionsSinceIdle) || 0) >= 3)
              .map((p) => {
                const missedCount = Number(p.missedSessionsSinceIdle) || 0;
                const idleSince = p.idleSinceDate || today;
                return (
                  <div
                    key={p.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg border border-ink-800 bg-ink-950/90 px-3.5 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          to="/players"
                          search={{ playerId: p.id } as never}
                          className="text-sm font-semibold text-ink-100 hover:text-court-400"
                        >
                          {p.name}
                        </Link>
                        <Chip tone="warn">IDLE · {missedCount} MISSED</Chip>
                        {p.crmFollowUpStatus && <Chip tone="accent">{p.crmFollowUpStatus}</Chip>}
                      </div>
                      <p className="mt-1 text-xs text-ink-200">
                        {p.name} has missed {missedCount} sessions while Idle since {idleSince}{" "}
                        without payment or attendance.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => void movePlayerToCrmFollowUp(p.id, "idle_followup")}
                        className="rounded-md border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 font-mono text-[11px] font-semibold text-amber-300 hover:bg-amber-500/25 transition-colors"
                      >
                        Move to Idle Follow-Up
                      </button>
                      <button
                        type="button"
                        onClick={() => void movePlayerToCrmFollowUp(p.id, "lost_churned")}
                        className="rounded-md border border-rose-500/40 bg-rose-500/15 px-3 py-1.5 font-mono text-[11px] font-semibold text-rose-300 hover:bg-rose-500/25 transition-colors"
                      >
                        Move to Lost Clients
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_320px]">
        <Panel
          title="Coaches"
          meta={`${coaches.length} on staff · ${coaches.filter((c) => c.portal).length} portal enabled`}
          action={
            <Link
              to="/coaches"
              className="rounded-md bg-court-500 px-3.5 py-2 text-sm font-semibold text-ink-950 hover:bg-court-400"
            >
              Manage coaches
            </Link>
          }
        >
          <Table
            head={
              <>
                <Th>COACH</Th>
                <Th>LEVEL</Th>
                <Th hide>W–L</Th>
                <Th hide>SESSIONS</Th>
                <Th>
                  <span className="block text-right">OUTSTANDING</span>
                </Th>
              </>
            }
            footer={`SHOWING ${Math.min(5, coaches.length)} OF ${coaches.length}`}
          >
            {coaches.slice(0, 5).map((c) => {
              const stats = coachStatsMap.get(c.id) || {
                wins: 0,
                losses: 0,
                completedSessions: 0,
              };
              const coachOutstanding = coachPayrollMap.get(c.id) ?? c.outstanding;
              return (
                <Row key={c.id}>
                  <Td strong>
                    <div className="leading-tight">
                      <div>{c.name}</div>
                      <div className="font-mono text-[10px] text-ink-400">
                        {c.phone} · {c.years} yrs
                      </div>
                    </div>
                  </Td>
                  <Td>
                    <Chip>
                      {db.lists["Coach levels"]?.find(
                        (l) => l.toLowerCase() === c.level.toLowerCase(),
                      ) || c.level}
                    </Chip>
                  </Td>
                  <Td hide>
                    <span className="font-mono text-xs">
                      {stats.wins}–{stats.losses}
                    </span>
                  </Td>
                  <Td hide>
                    <span className="font-mono text-xs text-ink-300">
                      {stats.completedSessions} / {c.sessionTarget || 30}
                    </span>
                  </Td>
                  <Td right>
                    <span
                      className={`font-mono text-xs ${
                        coachOutstanding ? "text-court-400" : "text-ink-400"
                      }`}
                    >
                      {money(coachOutstanding)}
                    </span>
                  </Td>
                </Row>
              );
            })}
          </Table>
        </Panel>

        <div className="flex flex-col gap-4">
          <div className="panel p-4">
            <div className="flex items-center justify-between">
              <div className="label-mono">Package usage</div>
              <Chip tone="accent">{academy.plan}</Chip>
            </div>
            <div className="mt-4 space-y-3.5">
              <Meter label="Players" used={players.length} limit={academy.playersLimit} />
              <Meter label="Branches" used={branches.length} limit={academy.branchesLimit} />
              <Meter label="Storage (GB)" used={academy.storageUsed} limit={academy.storageLimit} />
            </div>
          </div>

          <div className="panel p-4">
            <div className="label-mono mb-3">Inventory alerts</div>
            <div className="space-y-2 text-sm">
              {low.length === 0 ? (
                <div className="font-mono text-[11px] text-ink-400">Everything above reorder.</div>
              ) : (
                low.map((s) => (
                  <div key={s.id} className="flex items-center justify-between gap-3">
                    <span className="truncate text-ink-200">
                      {s.item} · {s.variant}
                    </span>
                    <span className="font-mono text-[11px] text-warn">{s.stock} left</span>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="panel flex-1 p-4">
            <div className="label-mono mb-3">Next up</div>
            <div className="space-y-2">
              {todays.length === 0 ? (
                <div className="font-mono text-[11px] text-ink-400">Nothing scheduled.</div>
              ) : (
                todays.map((s) => (
                  <div key={s.id} className="flex items-center gap-3">
                    <span
                      className={`w-10 font-mono text-[10px] ${
                        s.status === "Live" ? "text-court-400" : "text-ink-400"
                      }`}
                    >
                      {s.time}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink-100">{s.title}</div>
                      <div className="truncate font-mono text-[10px] text-ink-400">
                        {s.date} · {s.branch}
                      </div>
                    </div>
                    <Chip tone={s.status === "Live" ? "accent" : "neutral"}>
                      {String(s.status || "Planned").toUpperCase()}
                    </Chip>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div>
      <div className="flex justify-between font-mono text-[11px] text-ink-200">
        <span>{label}</span>
        <span>
          {used}/{limit}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-ink-800">
        <div className="h-full bg-court-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

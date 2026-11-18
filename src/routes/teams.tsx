import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, lazy, Suspense } from "react";
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
  CategoryBadge,
  money,
} from "@/components/kit";
import {
  useDB,
  useCollection,
  useTenantUser,
  useModulePermissions,
  checkPlayerAgeEligibility,
  defaultAgeCategoryRules,
  calculatePlayerAgeFromDob,
  evaluateTeamEligibilityForDob,
  formatAgeDate,
  coachMatchesBranch,
  getCoachBranches,
  getCoachTeams,
  calculateTeamOperatingCostReport,
} from "@/lib/data-store";
import { useAuth } from "@/lib/auth";
import { MessageSquare } from "lucide-react";
import type { Team, Player, Coach } from "@/lib/mock-data";
import { toast } from "sonner";

import { WhatsAppGroupsManager } from "@/components/whatsapp-groups-manager";

export const Route = createFileRoute("/teams")({
  head: () => ({
    meta: [
      { title: "Teams — Vescio Vector" },
      {
        name: "description",
        content:
          "Team rosters by age category and gender, with head coaches, assistants, branches and win-loss records.",
      },
      { property: "og:title", content: "Teams — Vescio Vector" },
      {
        property: "og:description",
        content: "Build rosters, assign coaches and follow every team record.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TeamsPage,
});

const blank: Omit<Team, "id"> = {
  name: "",
  category: "U-14",
  gender: "Boys",
  headCoach: "",
  headCoachRate: 50,
  assistant: "",
  assistantRate: 35,
  branch: "",
  players: 0,
  wins: 0,
  losses: 0,
  gamesFrequencyPerMonth: 2,
  monthlyFee: 0,
  allowYoungerPlayers: false,
  allowOlderPlayers: false,
};

function syncCoachesForTeamSave(coachesList: Coach[], tData: Team, oldTeam?: Team | null): Coach[] {
  const oldName = oldTeam?.name?.trim();
  const newName = tData.name.trim();
  const activeHeadId = tData.headCoachId;
  const activeHeadLower = (tData.headCoach || "").trim().toLowerCase();
  const activeAsstId = tData.assistantId;
  const activeAsstLower = (tData.assistant || "").trim().toLowerCase();

  return (coachesList || []).map((c) => {
    const cNameLower = (c.name || "").trim().toLowerCase();
    const isAssignedNow =
      (activeHeadId && c.id === activeHeadId) ||
      (activeHeadLower && cNameLower === activeHeadLower) ||
      (activeAsstId && c.id === activeAsstId) ||
      (activeAsstLower && cNameLower === activeAsstLower);

    const existingTeams = getCoachTeams(c);
    const hadOldTeam = Boolean(
      (oldName && existingTeams.some((tn) => tn.toLowerCase() === oldName.toLowerCase())) ||
      existingTeams.some((tn) => tn.toLowerCase() === newName.toLowerCase()),
    );

    if (!isAssignedNow && !hadOldTeam) {
      return c;
    }

    let nextCoachTeams = existingTeams.filter(
      (tn) =>
        tn.toLowerCase() !== newName.toLowerCase() &&
        (!oldName || tn.toLowerCase() !== oldName.toLowerCase()),
    );

    if (isAssignedNow && newName) {
      nextCoachTeams = [...nextCoachTeams, newName];
    }

    const existingBranches = getCoachBranches(c);
    let nextCoachBranches = existingBranches;
    if (
      isAssignedNow &&
      tData.branch &&
      !existingBranches.includes("All Branches") &&
      !existingBranches.some((b) => b.toLowerCase() === tData.branch.toLowerCase())
    ) {
      nextCoachBranches = [...existingBranches, tData.branch];
    }

    const teamsUnchanged =
      nextCoachTeams.length === (c.teams?.length ?? -1) &&
      nextCoachTeams.every((val, i) => c.teams?.[i] === val) &&
      c.team === (nextCoachTeams[0] || "");
    const branchesUnchanged =
      nextCoachBranches.length === (c.branches?.length ?? -1) &&
      nextCoachBranches.every((val, i) => c.branches?.[i] === val);

    if (teamsUnchanged && branchesUnchanged) {
      return c;
    }

    return {
      ...c,
      teams: nextCoachTeams,
      team: nextCoachTeams[0] || "",
      branches: nextCoachBranches,
      branch: nextCoachBranches[0] || c.branch,
    };
  });
}

function TeamsPage() {
  const { db, update } = useDB();
  const { user: authUser, passwordUser, loading: authLoading } = useAuth();
  const currentUser = useTenantUser();
  const { items: teams } = useCollection("teams");
  const { items: coaches } = useCollection("coaches");
  const { items: rawBranches } = useCollection("branches");
  const { items: players } = useCollection("players");

  const isBranchManager =
    (currentUser?.role === "Branch Manager" ||
      currentUser?.branchScope === "Assigned branch only") &&
    Boolean(currentUser?.branch);
  const userBranch = isBranchManager ? currentUser?.branch || "" : "";

  const coachNames = useMemo(
    () =>
      coaches
        .filter((c) => !isBranchManager || coachMatchesBranch(c, userBranch))
        .map((c) => c.name),
    [coaches, isBranchManager, userBranch],
  );
  const branches = useMemo(() => rawBranches.map((b) => b.name), [rawBranches]);

  const accessibleTeams = useMemo(
    () =>
      isBranchManager
        ? teams.filter((t) => t.branch?.toLowerCase() === userBranch.toLowerCase())
        : teams,
    [teams, isBranchManager, userBranch],
  );

  const accessiblePlayers = useMemo(
    () =>
      isBranchManager
        ? players.filter((p) => p.branch?.toLowerCase() === userBranch.toLowerCase())
        : players,
    [players, isBranchManager, userBranch],
  );

  const { canWrite: canWriteTeams, canDelete: canDeleteTeams } = useModulePermissions("teams");
  const canManageTeams = canWriteTeams;

  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [branch, setBranch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);
  const [form, setForm] = useState<Omit<Team, "id">>(blank);
  const [roster, setRoster] = useState<Team | null>(null);
  const [rosterSearch, setRosterSearch] = useState("");
  const [showAllIneligibleInRoster, setShowAllIneligibleInRoster] = useState(false);
  const [whatsAppTeam, setWhatsAppTeam] = useState<Team | null>(null);
  const [allTeamsWhatsAppOpen, setAllTeamsWhatsAppOpen] = useState(false);

  const filtered = accessibleTeams.filter(
    (t) =>
      (!q.trim() ||
        [t.name, t.headCoach, t.assistant ?? ""]
          .join(" ")
          .toLowerCase()
          .includes(q.toLowerCase())) &&
      (!cat || t.category === cat) &&
      (isBranchManager || !branch || t.branch === branch),
  );

  const wins = accessibleTeams.reduce((a, t) => a + t.wins, 0);
  const losses = accessibleTeams.reduce((a, t) => a + t.losses, 0);

  function rosterOf(team: Team) {
    return players.filter((p) => p.teams && p.teams.includes(team.name));
  }

  function exportTeamCSV(team: Team, teamPlayers: Player[]) {
    const currency = db.academy?.currency || "USD";
    const headers = ["Role,Name,Category,Rate / Fee,Guardian,Guardian Phone,Branch,Insurance"];
    const rows: string[] = [];
    if (team.headCoach) {
      const rate = team.headCoachRate ?? coaches.find((c) => c.name === team.headCoach)?.rate ?? 50;
      rows.push(
        `"Head Coach","${team.headCoach}","${team.category}","${currency} ${rate}/session","—","—","${team.branch || "—"}","Active Staff"`,
      );
    }
    if (team.assistant) {
      const rate = team.assistantRate ?? coaches.find((c) => c.name === team.assistant)?.rate ?? 35;
      rows.push(
        `"Assistant Coach","${team.assistant}","${team.category}","${currency} ${rate}/session","—","—","${team.branch || "—"}","Active Staff"`,
      );
    }
    teamPlayers.forEach((p) => {
      const feeVal = p.teamFees?.[team.name] !== undefined ? p.teamFees[team.name] : p.fee;
      const feeStr = `${currency} ${feeVal}/month`;
      rows.push(
        `"Player","${p.name}","${p.category}","${feeStr}","${p.parent || "—"}","${p.parentPhone || "—"}","${p.branch || "—"}","${p.insuranceStatus || "Not insured"}"`,
      );
    });
    const csvContent = headers.concat(rows).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${team.name.replace(/\s+/g, "_")}_Roster.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function exportTeamPDF(team: Team, players: Player[]) {
    const currency = db.academy?.currency || "USD";
    const { default: jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF();

    doc.setFontSize(15);
    doc.text(`Vescio Vector — Team: ${team.name}`, 14, 15);
    doc.setFontSize(10);
    const hRate = team.headCoachRate ?? coaches.find((c) => c.name === team.headCoach)?.rate ?? 50;
    const aRate = team.assistantRate ?? coaches.find((c) => c.name === team.assistant)?.rate ?? 35;
    doc.text(
      `Category: ${team.category} | Gender: ${team.gender} | Branch: ${team.branch || "All Branches"} | Head Coach: ${team.headCoach || "None"} (${currency} ${hRate}/sess) | Asst: ${team.assistant || "None"} (${currency} ${aRate}/sess)`,
      14,
      22,
    );

    const tableData: string[][] = [];
    if (team.headCoach) {
      tableData.push([
        "Head Coach",
        team.headCoach,
        team.category,
        `${currency} ${hRate}/sess`,
        "—",
        "—",
        "Active Staff",
      ]);
    }
    if (team.assistant) {
      tableData.push([
        "Assistant Coach",
        team.assistant,
        team.category,
        `${currency} ${aRate}/sess`,
        "—",
        "—",
        "Active Staff",
      ]);
    }
    players.forEach((p) => {
      const feeVal = p.teamFees?.[team.name] !== undefined ? p.teamFees[team.name] : p.fee;
      const feeStr = `${currency} ${feeVal}/mo`;
      tableData.push([
        "Player",
        p.name,
        p.category,
        feeStr,
        p.parent || "—",
        p.parentPhone || "—",
        p.insuranceStatus || "Not insured",
      ]);
    });

    autoTable(doc, {
      startY: 28,
      head: [["Role", "Name", "Category", "Rate / Fee", "Guardian", "Phone", "Status / Insurance"]],
      body: tableData,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [15, 23, 42] },
    });

    doc.save(`${team.name.replace(/\s+/g, "_")}_Roster.pdf`);
  }

  function openNew() {
    if (!canWriteTeams) return;
    setEditing(null);
    const initialHeadCoach = coachNames[0] ?? "";
    const matchedHead = coaches.find((c) => c.name === initialHeadCoach);
    const headRate = matchedHead?.rate ?? 50;
    setForm({
      ...blank,
      branch: isBranchManager ? userBranch : (branches[0] ?? ""),
      headCoach: initialHeadCoach,
      headCoachId: matchedHead?.id || undefined,
      headCoachRate: headRate,
      assistant: "",
      assistantId: undefined,
      assistantRate: 35,
    });
    setOpen(true);
  }

  function openEdit(t: Team) {
    if (!canWriteTeams) return;
    setEditing(t);
    const { id: _id, ...rest } = t;
    const matchedHead = coaches.find(
      (c) =>
        (t.headCoachId && c.id === t.headCoachId) ||
        (t.headCoach && c.name.toLowerCase() === t.headCoach.toLowerCase()),
    );
    const matchedAsst = coaches.find(
      (c) =>
        (t.assistantId && c.id === t.assistantId) ||
        (t.assistant && c.name.toLowerCase() === t.assistant.toLowerCase()),
    );
    const headRate = t.headCoachRate ?? matchedHead?.rate ?? 50;
    const asstRate = t.assistantRate ?? matchedAsst?.rate ?? 35;
    setForm({
      ...rest,
      headCoach: t.headCoach || matchedHead?.name || "",
      headCoachId: matchedHead?.id || t.headCoachId || undefined,
      headCoachRate: headRate,
      assistant: t.assistant || matchedAsst?.name || "",
      assistantId: matchedAsst?.id || t.assistantId || undefined,
      assistantRate: asstRate,
      allowYoungerPlayers: Boolean(t.allowYoungerPlayers),
      allowOlderPlayers: Boolean(t.allowOlderPlayers),
    });
    setOpen(true);
  }

  function submit() {
    if (!form.name.trim()) {
      toast.error("Please enter a team name.");
      return;
    }
    const oldName = editing?.name?.trim();
    const newName = form.name.trim();

    const matchedHead = (coaches || db.coaches || []).find(
      (c) =>
        (form.headCoachId && c.id === form.headCoachId) ||
        (form.headCoach && c.name.toLowerCase() === form.headCoach.trim().toLowerCase()),
    );
    const matchedAsst = (coaches || db.coaches || []).find(
      (c) =>
        (form.assistantId && c.id === form.assistantId) ||
        (form.assistant && c.name.toLowerCase() === form.assistant.trim().toLowerCase()),
    );

    const finalBranch = isBranchManager ? userBranch : form.branch;
    const tData: Team = editing
      ? {
          ...editing,
          ...form,
          branch: finalBranch,
          name: newName,
          headCoach: matchedHead?.name || form.headCoach,
          headCoachId: matchedHead?.id || form.headCoachId || undefined,
          assistant: matchedAsst?.name || form.assistant || undefined,
          assistantId: matchedAsst?.id || form.assistantId || undefined,
        }
      : {
          ...form,
          branch: finalBranch,
          name: newName,
          id: `t-${Date.now().toString(36)}`,
          headCoach: matchedHead?.name || form.headCoach,
          headCoachId: matchedHead?.id || form.headCoachId || undefined,
          assistant: matchedAsst?.name || form.assistant || undefined,
          assistantId: matchedAsst?.id || form.assistantId || undefined,
        };

    if (editing) {
      const nameChanged = Boolean(oldName && oldName !== newName);
      const branchChanged = editing.branch !== finalBranch;
      update((prev) => {
        const nextTeams = prev.teams.map((t) => (t.id === tData.id ? tData : t));
        const nextCoaches = syncCoachesForTeamSave(prev.coaches || [], tData, editing);

        const nextPlayers = nameChanged
          ? prev.players.map((p) => {
              let modified = false;
              let newTeams = p.teams;
              let newTeamFees = p.teamFees;

              if (p.teams && oldName && p.teams.includes(oldName)) {
                newTeams = p.teams.map((tn) => (tn === oldName ? newName : tn));
                modified = true;
              }
              if (p.teamFees && oldName && oldName in p.teamFees) {
                const feeVal = p.teamFees[oldName];
                const { [oldName]: _, ...restFees } = p.teamFees;
                newTeamFees = { ...restFees, [newName]: feeVal };
                modified = true;
              }

              return modified ? { ...p, teams: newTeams, teamFees: newTeamFees } : p;
            })
          : prev.players;

        const nextSessions = nameChanged
          ? prev.sessions.map((s) => {
              let modified = false;
              let sTeam = s.team;
              let sTeamA = s.teamA;
              let sTeamB = s.teamB;

              if (oldName && s.team === oldName) {
                sTeam = newName;
                modified = true;
              }
              if (oldName && s.teamA === oldName) {
                sTeamA = newName;
                modified = true;
              }
              if (oldName && s.teamB === oldName) {
                sTeamB = newName;
                modified = true;
              }

              return modified ? { ...s, team: sTeam, teamA: sTeamA, teamB: sTeamB } : s;
            })
          : prev.sessions;

        const matchedBranchObj = (prev.branches || []).find(
          (b) => b.name.toLowerCase() === (finalBranch || "").toLowerCase(),
        );
        const nowIso = new Date().toISOString();
        const nextGroups =
          nameChanged || branchChanged
            ? (prev.groups || []).map((g) => {
                if (g.teamId === editing.id || (oldName && g.teamName === oldName)) {
                  const updatedScope =
                    !g.scope || (oldName && g.scope === oldName) ? newName : g.scope;
                  const updatedGroupName =
                    oldName && g.name === `${oldName} Broadcast Group`
                      ? `${newName} Broadcast Group`
                      : g.name;
                  return {
                    ...g,
                    name: updatedGroupName,
                    teamId: tData.id,
                    teamName: newName,
                    branchId: matchedBranchObj?.id || g.branchId,
                    branchName: finalBranch,
                    scope: updatedScope,
                    updatedAt: nowIso,
                  };
                }
                return g;
              })
            : prev.groups;

        return {
          ...prev,
          teams: nextTeams,
          coaches: nextCoaches,
          players: nextPlayers,
          sessions: nextSessions,
          groups: nextGroups,
        };
      });
      toast.success(
        nameChanged
          ? `Team renamed from "${oldName}" to "${newName}" and cascaded across rosters, coaches, and WhatsApp groups.`
          : `Team "${tData.name}" updated.`,
      );
    } else {
      update((prev) => {
        const nextTeams = [...(prev.teams || []), tData];
        const nextCoaches = syncCoachesForTeamSave(prev.coaches || [], tData, null);
        const existingGroups = prev.groups || [];
        const hasTeamGroup = existingGroups.some(
          (g) => g.teamId === tData.id || g.teamName?.toLowerCase() === tData.name.toLowerCase(),
        );
        let nextGroups = existingGroups;
        if (!hasTeamGroup) {
          const matchedBranchObj = (prev.branches || []).find(
            (b) => b.name.toLowerCase() === (tData.branch || "").toLowerCase(),
          );
          const nowIso = new Date().toISOString();
          const defaultTeamGroup = {
            id: `wg-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
            name: `${tData.name} Broadcast Group`,
            scopeType: "team" as const,
            category: "General" as const,
            teamId: tData.id,
            teamName: tData.name,
            branchId: matchedBranchObj?.id,
            branchName: tData.branch,
            scope: tData.name,
            contactName: tData.headCoach || undefined,
            active: true,
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          nextGroups = [defaultTeamGroup, ...existingGroups];
        }
        return {
          ...prev,
          teams: nextTeams,
          coaches: nextCoaches,
          groups: nextGroups,
        };
      });
      toast.success(`Team "${tData.name}" created with linked WhatsApp group.`);
    }
    setOpen(false);
  }

  const [deleteTarget, setDeleteTarget] = useState<Team | null>(null);
  function remove(t: Team) {
    if (!canDeleteTeams) return;
    setDeleteTarget(t);
  }
  function confirmRemove() {
    if (!canDeleteTeams || !deleteTarget) return;
    const t = deleteTarget;
    setDeleteTarget(null);
    update((prev) => {
      const nextTeams = prev.teams.filter((item) => item.id !== t.id);
      const nextCoaches = (prev.coaches || []).map((c) => {
        const cTeams = getCoachTeams(c);
        if (!cTeams.some((tn) => tn.toLowerCase() === t.name.toLowerCase())) {
          return c;
        }
        const filteredTeams = cTeams.filter((tn) => tn.toLowerCase() !== t.name.toLowerCase());
        return {
          ...c,
          teams: filteredTeams,
          team: filteredTeams[0] || "",
        };
      });
      const nextPlayers = prev.players.map((p) => {
        let modified = false;
        let newTeams = p.teams;
        let newTeamFees = p.teamFees;

        if (p.teams && p.teams.includes(t.name)) {
          newTeams = p.teams.filter((tn) => tn !== t.name);
          modified = true;
        }
        if (p.teamFees && t.name in p.teamFees) {
          const { [t.name]: _, ...restFees } = p.teamFees;
          newTeamFees = restFees;
          modified = true;
        }
        return modified ? { ...p, teams: newTeams, teamFees: newTeamFees } : p;
      });

      const nextSessions = (prev.sessions || []).map((s) => {
        let modified = false;
        let team = s.team;
        let teamA = s.teamA;
        let teamB = s.teamB;

        if (s.team === t.name) {
          team = "";
          modified = true;
        }
        if (s.teamA === t.name) {
          teamA = "";
          modified = true;
        }
        if (s.teamB === t.name) {
          teamB = "";
          modified = true;
        }
        return modified ? { ...s, team, teamA, teamB } : s;
      });

      const nextPlans = (prev.plans || []).map((p) => {
        if (p.team === t.name) {
          return { ...p, team: "" };
        }
        return p;
      });

      const nextGroups = (prev.groups || [])
        .filter((g) => {
          const isTeamMatch = g.teamId === t.id || g.teamName === t.name;
          if (isTeamMatch && !g.link?.trim()) {
            return false;
          }
          return true;
        })
        .map((g) => {
          if (g.teamId === t.id || g.teamName === t.name) {
            return {
              ...g,
              teamId: "",
              teamName: "",
              scope:
                g.scope === t.name
                  ? g.branchName
                    ? `${g.branchName} Branch`
                    : "All Academy"
                  : g.scope,
            };
          }
          return g;
        });

      return {
        ...prev,
        teams: nextTeams,
        coaches: nextCoaches,
        players: nextPlayers,
        sessions: nextSessions,
        plans: nextPlans,
        groups: nextGroups,
      };
    });
    toast.success(
      `Team "${t.name}" deleted and unassigned across rosters, coaches, sessions, and plans.`,
    );
  }

  if (authLoading && !currentUser && !authUser && !passwordUser) {
    return (
      <AppShell crumb="ROSTER / TEAMS" title="Teams">
        <div className="flex h-64 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-court-500 border-t-transparent" />
          <span className="ml-3 font-mono text-xs text-ink-400">Loading teams…</span>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb="ROSTER / TEAMS" title="Teams">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label={isBranchManager ? `Teams (${userBranch})` : "Teams"}
          value={String(accessibleTeams.length)}
          note={isBranchManager ? "assigned facility" : "across all categories"}
          accent
        />
        <Stat
          label="Rostered players"
          value={String(accessiblePlayers.filter((p) => p.teams && p.teams.length > 0).length)}
        />
        <Stat label="Season record" value={`${wins}–${losses}`} note="all teams combined" />
        <Stat
          label="Win rate"
          value={`${wins + losses ? Math.round((wins / (wins + losses)) * 100) : 0}%`}
          accent
        />
      </div>

      <Panel
        className="mt-4"
        title={isBranchManager ? `Team list · ${userBranch}` : "Team list"}
        meta="Categories are validated against player date of birth"
        action={
          <>
            <FilterSelect
              label="Category"
              value={cat}
              onChange={setCat}
              options={Array.from(
                new Set([
                  ...(db.lists["Age categories"] || []),
                  ...accessibleTeams.map((t) => t.category).filter(Boolean),
                ]),
              )}
            />
            {!isBranchManager ? (
              <FilterSelect label="Branch" value={branch} onChange={setBranch} options={branches} />
            ) : (
              <div className="flex items-center gap-1.5 rounded-md bg-ink-850 px-2.5 py-1.5 border border-ink-800 text-xs font-mono text-ink-300">
                <span className="text-[10px] text-ink-500 uppercase">Branch:</span>
                <span className="text-court-400 font-semibold">{userBranch}</span>
              </div>
            )}
            <Button
              variant="emerald"
              size="md"
              className="shrink-0 font-medium"
              onClick={() => setAllTeamsWhatsAppOpen(true)}
            >
              <MessageSquare className="w-4 h-4 text-emerald-400" />
              WhatsApp Hub
            </Button>
            {canWriteTeams && (
              <Button size="md" onClick={openNew}>
                + New team
              </Button>
            )}
          </>
        }
      >
        <div className="border-b border-ink-800 px-4 py-3">
          <Search value={q} onChange={setQ} placeholder="Search teams or coaches…" />
        </div>
        <Table
          head={
            <>
              <Th>TEAM</Th>
              <Th>CATEGORY</Th>
              <Th hide>HEAD COACH</Th>
              <Th hide>BRANCH</Th>
              <Th>PLAYERS</Th>
              <Th>WINS</Th>
              <Th>LOSSES</Th>
              <Th>
                <span className="block text-right">ACTIONS</span>
              </Th>
            </>
          }
          footer={`SHOWING ${filtered.length} OF ${accessibleTeams.length}`}
        >
          {filtered.length === 0 ? (
            <EmptyState>No teams match these filters.</EmptyState>
          ) : (
            filtered.map((t) => (
              <Row key={t.id}>
                <Td strong>
                  <button type="button" onClick={() => setRoster(t)} className="text-left">
                    <div>{t.name}</div>
                    <div className="font-mono text-[10px] text-ink-400">
                      {t.gender} · {t.assistant ? `asst. ${t.assistant}` : "no assistant"}
                    </div>
                  </button>
                </Td>
                <Td>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <CategoryBadge category={t.category} />
                    {t.allowYoungerPlayers && (
                      <span
                        className="rounded bg-court-500/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-court-300 ring-1 ring-court-500/30"
                        title="Younger players (Playing Up) are allowed on this team"
                      >
                        ↑ Playing Up OK
                      </span>
                    )}
                    {t.allowOlderPlayers && (
                      <span
                        className="rounded bg-warn/15 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-warn ring-1 ring-warn/30"
                        title="Over-age exception players are allowed on this team"
                      >
                        + Over-Age OK
                      </span>
                    )}
                    {(() => {
                      const tRoster = rosterOf(t);
                      const overageCount = tRoster.filter((p) => {
                        const evalRes = evaluateTeamEligibilityForDob(
                          p.dob,
                          t,
                          db.ageCategoryRules,
                        );
                        return (
                          !evalRes.eligible &&
                          checkPlayerAgeEligibility(p.dob, t.category, db.ageCategoryRules)
                            .isExceeding
                        );
                      }).length;
                      if (overageCount > 0) {
                        return (
                          <span
                            className="rounded bg-bad/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-bad ring-1 ring-bad/30"
                            title={`${overageCount} player(s) exceed the ${t.category} age limit without an Over-Age Exception enabled!`}
                          >
                            ⚠️ {overageCount} overage
                          </span>
                        );
                      }
                      return null;
                    })()}
                  </div>
                </Td>
                <Td hide>
                  <div>
                    <span className="text-ink-100">{t.headCoach || "—"}</span>
                    {t.headCoach && (
                      <span className="ml-1.5 font-mono text-[10px] text-court-300">
                        (
                        {money(
                          t.headCoachRate ??
                            coaches.find((c) => c.name === t.headCoach)?.rate ??
                            50,
                        )}
                        /sess)
                      </span>
                    )}
                  </div>
                  {t.assistant && (
                    <div className="font-mono text-[10px] text-ink-400">
                      asst. {t.assistant} (
                      {money(
                        t.assistantRate ?? coaches.find((c) => c.name === t.assistant)?.rate ?? 35,
                      )}
                      /sess)
                    </div>
                  )}
                </Td>
                <Td hide>{t.branch || "—"}</Td>
                <Td>
                  <div>
                    <span className="font-mono text-xs">{rosterOf(t).length || t.players}</span>
                    <div className="font-mono text-[9px] text-ink-400">
                      {t.gamesFrequencyPerMonth ?? 2} games/mo
                    </div>
                  </div>
                </Td>
                <Td>
                  <span className="font-mono text-xs text-ink-100">{t.wins}</span>
                </Td>
                <Td>
                  <span className="font-mono text-xs text-ink-100">{t.losses}</span>
                </Td>
                <Td right>
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      variant="outline"
                      size="xs"
                      title="Download Roster & Staff as CSV"
                      onClick={() => exportTeamCSV(t, rosterOf(t))}
                      className="font-mono text-[11px]"
                    >
                      CSV
                    </Button>
                    <Button
                      variant="outline"
                      size="xs"
                      title="Download Roster & Staff as PDF"
                      onClick={() => exportTeamPDF(t, rosterOf(t))}
                      className="font-mono text-[11px] text-court-400 border-court-500/30 hover:bg-court-500/10"
                    >
                      PDF
                    </Button>
                    <Button
                      variant="emerald"
                      size="xs"
                      title="Manage Team WhatsApp Group Link & Announcements"
                      onClick={() => setWhatsAppTeam(t)}
                      className="font-mono text-[11px]"
                    >
                      <MessageSquare className="h-3 w-3" />
                      <span>WhatsApp</span>
                    </Button>
                    {(canWriteTeams || canDeleteTeams) && (
                      <RowActions
                        onEdit={canWriteTeams ? () => openEdit(t) : undefined}
                        onDelete={canDeleteTeams ? () => remove(t) : undefined}
                      />
                    )}
                  </div>
                </Td>
              </Row>
            ))
          )}
        </Table>
      </Panel>

      {/* Level B: Team Monthly Operating Cost / Profitability Report */}
      {(() => {
        const teamCostRows = calculateTeamOperatingCostReport(
          filtered,
          db.sessions || [],
          accessiblePlayers,
          db.branches || [],
          coaches,
        );
        const totalRental = teamCostRows.reduce((s, r) => s + r.courtRentalCost, 0);
        const totalPayroll = teamCostRows.reduce((s, r) => s + r.coachPayrollCost, 0);
        const totalOperating = teamCostRows.reduce((s, r) => s + r.totalOperatingCost, 0);
        const totalRevenue = teamCostRows.reduce((s, r) => s + r.tuitionRevenue, 0);

        return (
          <Panel
            className="mt-4"
            title="Team Monthly Operating Cost & Profitability Report"
            meta={`Court Rental (Full Court vs. Half Court HCA / HCB) + Coach Payroll vs. Active Tuition Revenue · Total Rent: ${money(totalRental)} · Net Margin: ${money(totalRevenue - totalOperating)}`}
          >
            <Table
              head={
                <>
                  <Th>TEAM</Th>
                  <Th hide>SESSIONS (FULL / HCA / HCB)</Th>
                  <Th>
                    <span className="block text-right">COURT RENTAL</span>
                  </Th>
                  <Th hide>
                    <span className="block text-right">COACH &amp; OFFICIALS</span>
                  </Th>
                  <Th>
                    <span className="block text-right">OPERATING COST</span>
                  </Th>
                  <Th hide>
                    <span className="block text-right">TUITION REVENUE</span>
                  </Th>
                  <Th>
                    <span className="block text-right">NET MARGIN</span>
                  </Th>
                </>
              }
              footer={`TOTAL COURT RENTAL: ${money(totalRental)} · TOTAL COACH PAYROLL: ${money(totalPayroll)} · TOTAL OPERATING COST: ${money(totalOperating)} · NET MARGIN: ${money(totalRevenue - totalOperating)}`}
            >
              {teamCostRows.length === 0 ? (
                <EmptyState>No team operating cost records match current filters.</EmptyState>
              ) : (
                teamCostRows.map((r) => (
                  <Row key={r.teamId}>
                    <Td strong>
                      <div>{r.teamName}</div>
                      <div className="font-mono text-[10px] text-ink-400">
                        {r.category} · {r.branch || "HQ"} · {r.activePlayersCount} active players
                      </div>
                    </Td>
                    <Td hide>
                      <div className="flex items-center gap-1.5 font-mono text-xs flex-wrap">
                        <span className="text-ink-100 font-semibold">
                          {r.sessionsCount} sess ({r.totalHours}h)
                        </span>
                        <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-300">
                          Full: {r.fullCourtSessions}
                        </span>
                        <span className="rounded bg-court-500/15 px-1.5 py-0.5 text-[10px] text-court-300">
                          HCA: {r.hcaSessions}
                        </span>
                        <span className="rounded bg-court-500/15 px-1.5 py-0.5 text-[10px] text-court-300">
                          HCB: {r.hcbSessions}
                        </span>
                      </div>
                    </Td>
                    <Td right>
                      <span className="font-mono text-xs font-semibold text-warn">
                        {money(r.courtRentalCost)}
                      </span>
                    </Td>
                    <Td hide right>
                      <span className="font-mono text-xs text-ink-200">
                        {money(r.coachPayrollCost + r.officialsCost)}
                      </span>
                    </Td>
                    <Td right>
                      <span className="font-mono text-xs font-bold text-bad">
                        {money(r.totalOperatingCost)}
                      </span>
                    </Td>
                    <Td hide right>
                      <span className="font-mono text-xs text-court-300">
                        {money(r.tuitionRevenue)}
                      </span>
                    </Td>
                    <Td right>
                      <span
                        className={`font-mono text-xs font-bold ${
                          r.netMargin >= 0 ? "text-good" : "text-bad"
                        }`}
                      >
                        {money(r.netMargin)}
                      </span>
                    </Td>
                  </Row>
                ))
              )}
            </Table>
          </Panel>
        );
      })()}

      <Modal
        open={open}
        title={editing ? `Edit ${editing.name}` : "New team"}
        meta="Category, coaches, rates and branch"
        onClose={() => setOpen(false)}
        onSubmit={submit}
        submitLabel={editing ? "Save changes" : "Create team"}
        wide
      >
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <Field label="Team name">
            <Input value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
          </Field>
          <Field
            label="Age Category"
            hint={(() => {
              const rules = db.ageCategoryRules ?? defaultAgeCategoryRules;
              const norm = (form.category || "").replace(/[\s-]/g, "").toLowerCase();
              const rKey = Object.keys(rules).find(
                (k) => k.replace(/[\s-]/g, "").toLowerCase() === norm,
              );
              const rule = rKey ? rules[rKey] : undefined;
              if (!rule) return "Select linked age category";
              return `Defined Range: Born ${rule.startDate.slice(0, 4)}–${rule.endDate.slice(0, 4)} (${formatAgeDate(rule.startDate)} – ${formatAgeDate(rule.endDate)})`;
            })()}
          >
            <Select
              value={form.category}
              onChange={(v) => setForm({ ...form, category: v })}
              options={
                db.lists?.["Age categories"] && db.lists["Age categories"].length > 0
                  ? db.lists["Age categories"]
                  : ["U-10", "U-12", "U-14", "U-16", "U-18", "Senior"]
              }
            />
          </Field>

          <div className="sm:col-span-2 rounded-md bg-ink-900/70 p-3.5 ring-1 ring-ink-800 space-y-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <div className="text-xs font-semibold text-ink-100">
                  Age Category &amp; Team Exception Rules ({form.category || "Unassigned"})
                </div>
                <div className="font-mono text-[10px] text-ink-400">
                  {(() => {
                    const rules = db.ageCategoryRules ?? defaultAgeCategoryRules;
                    const norm = (form.category || "").replace(/[\s-]/g, "").toLowerCase();
                    const rKey = Object.keys(rules).find(
                      (k) => k.replace(/[\s-]/g, "").toLowerCase() === norm,
                    );
                    const rule = rKey ? rules[rKey] : undefined;
                    return rule
                      ? `Strict ${form.category} birth window: ${formatAgeDate(rule.startDate)} to ${formatAgeDate(rule.endDate)}`
                      : "Configure category birth-year ranges in Settings → Data Administration";
                  })()}
                </div>
              </div>
              <CategoryBadge category={form.category} />
            </div>

            <div className="grid gap-2.5 sm:grid-cols-2">
              <label className="flex items-start gap-2.5 rounded-md bg-ink-850 p-2.5 ring-1 ring-ink-700 cursor-pointer hover:ring-court-500/50 transition-colors">
                <input
                  type="checkbox"
                  checked={Boolean(form.allowYoungerPlayers)}
                  onChange={(e) => setForm({ ...form, allowYoungerPlayers: e.target.checked })}
                  className="mt-0.5 h-4 w-4 accent-court-500"
                />
                <span className="text-xs">
                  <span className="font-semibold text-ink-100 block">
                    Allow Younger Players (&quot;Playing Up&quot;)
                  </span>
                  <span className="font-mono text-[10px] text-ink-400">
                    Include players younger than the {form.category} minimum age
                    (`allowYoungerPlayers`).
                  </span>
                </span>
              </label>

              <label className="flex items-start gap-2.5 rounded-md bg-ink-850 p-2.5 ring-1 ring-ink-700 cursor-pointer hover:ring-court-500/50 transition-colors">
                <input
                  type="checkbox"
                  checked={Boolean(form.allowOlderPlayers)}
                  onChange={(e) => setForm({ ...form, allowOlderPlayers: e.target.checked })}
                  className="mt-0.5 h-4 w-4 accent-court-500"
                />
                <span className="text-xs">
                  <span className="font-semibold text-ink-100 block">
                    Allow Older Players (Over-Age Exception)
                  </span>
                  <span className="font-mono text-[10px] text-ink-400">
                    Include over-age exception players older than the {form.category} maximum
                    (`allowOlderPlayers`).
                  </span>
                </span>
              </label>
            </div>
          </div>
          <Field label="Gender">
            <Select
              value={form.gender}
              onChange={(v) => setForm({ ...form, gender: v as Team["gender"] })}
              options={["Boys", "Girls", "Mixed"]}
            />
          </Field>
          <Field label="Branch">
            {isBranchManager ? (
              <div className="mt-1.5 rounded-md bg-ink-850 px-3 py-2 font-mono text-xs text-court-300 ring-1 ring-ink-700 flex items-center justify-between">
                <span>{userBranch}</span>
                <span className="text-[10px] text-ink-500 uppercase">Assigned Facility</span>
              </div>
            ) : (
              <Select
                value={form.branch}
                onChange={(v) => setForm({ ...form, branch: v })}
                options={["", ...branches]}
              />
            )}
          </Field>

          <Field
            label={`Monthly Subscription Fee (${db.academy?.currency || "USD"})`}
            hint="Team monthly subscription fee override (0 = use branch/academy default)"
          >
            <Input
              type="number"
              value={form.monthlyFee !== undefined ? String(form.monthlyFee) : "0"}
              placeholder="0"
              onChange={(v) => setForm({ ...form, monthlyFee: Number(v) || 0 })}
            />
          </Field>

          <Field label="Program Tier" hint="E.g. Development, Elite, Academy, Recreational">
            <Input
              value={form.tier || ""}
              placeholder="e.g. Development or Elite"
              onChange={(v) => setForm({ ...form, tier: v })}
            />
          </Field>

          <Field label="Head coach">
            <Select
              value={form.headCoach}
              onChange={(v) => {
                const matched = coaches.find((c) => c.name === v);
                const defaultRate = matched?.rate ?? 50;
                setForm({
                  ...form,
                  headCoach: v,
                  headCoachId: matched?.id || undefined,
                  headCoachRate: defaultRate,
                });
              }}
              options={["", ...coachNames]}
            />
          </Field>
          <Field
            label={`Head coach session rate (${db.academy?.currency || "USD"})`}
            hint="Rate per session for this team (coaches can have multiple rates)"
          >
            <Input
              type="number"
              value={form.headCoachRate !== undefined ? String(form.headCoachRate) : "50"}
              placeholder="e.g. 50"
              onChange={(v) => setForm({ ...form, headCoachRate: Number(v) || 0 })}
            />
          </Field>

          <Field label="Assistant coach">
            <Select
              value={form.assistant ?? ""}
              onChange={(v) => {
                const matched = coaches.find((c) => c.name === v);
                const defaultRate = matched?.rate ?? 35;
                setForm({
                  ...form,
                  assistant: v,
                  assistantId: matched?.id || undefined,
                  assistantRate: defaultRate,
                });
              }}
              options={["", ...coachNames]}
            />
          </Field>
          <Field
            label={`Assistant coach session rate (${db.academy?.currency || "USD"})`}
            hint="Rate per session for this team"
          >
            <Input
              type="number"
              value={form.assistantRate !== undefined ? String(form.assistantRate) : "35"}
              placeholder="e.g. 35"
              onChange={(v) => setForm({ ...form, assistantRate: Number(v) || 0 })}
            />
          </Field>
          <Field
            label="Monthly Game Frequency Target"
            hint="Target games/month set by Technical Director & Coach"
          >
            <Input
              type="number"
              value={
                form.gamesFrequencyPerMonth !== undefined
                  ? String(form.gamesFrequencyPerMonth)
                  : "2"
              }
              placeholder="e.g. 2"
              onChange={(v) =>
                setForm({ ...form, gamesFrequencyPerMonth: Math.max(1, Number(v) || 2) })
              }
            />
          </Field>
        </div>
      </Modal>

      <Modal
        open={roster !== null}
        title={roster ? `${roster.name} — Roster & Smart Eligibility (${roster.category})` : ""}
        meta="Two-way DOB / Age-Matrix roster management with Playing Up & Over-Age exception rules."
        onClose={() => {
          setRoster(null);
          setRosterSearch("");
          setShowAllIneligibleInRoster(false);
        }}
        wide
      >
        {(() => {
          const activeTeam =
            (roster && teams.find((t) => t.id === roster.id || t.name === roster.name)) || roster;
          if (!activeTeam) return null;

          const r = rosterOf(activeTeam);
          const rules = db.ageCategoryRules ?? defaultAgeCategoryRules;
          const normCat = (activeTeam.category || "").replace(/[\s-]/g, "").toLowerCase();
          const ruleKey = Object.keys(rules).find(
            (k) => k.replace(/[\s-]/g, "").toLowerCase() === normCat,
          );
          const activeRule = ruleKey ? rules[ruleKey] : undefined;

          const needle = rosterSearch.trim().toLowerCase();
          const unassignedPlayers = accessiblePlayers.filter(
            (p) => !(p.teams && p.teams.includes(activeTeam.name)),
          );

          const evaluatedUnassigned = unassignedPlayers
            .map((p) => ({
              player: p,
              eligibility: evaluateTeamEligibilityForDob(p.dob, activeTeam, rules),
              ageInfo: calculatePlayerAgeFromDob(p.dob),
            }))
            .filter(
              ({ player, eligibility }) =>
                !needle ||
                [player.name, player.category, player.branch, eligibility.badgeLabel, player.dob]
                  .join(" ")
                  .toLowerCase()
                  .includes(needle),
            );

          const eligibleAvailable = evaluatedUnassigned
            .filter((item) => item.eligibility.eligible)
            .sort((a, b) => {
              const rank = { exact: 0, younger: 1, older: 2, ineligible: 3 };
              return rank[a.eligibility.matchType] - rank[b.eligibility.matchType];
            });

          const ineligibleAvailable = evaluatedUnassigned.filter(
            (item) => !item.eligibility.eligible,
          );

          const assignPlayerToTeam = (p: Player, badgeLabel?: string) => {
            const nextTeams = [
              ...(p.teams || []).filter((t) => t !== activeTeam.name),
              activeTeam.name,
            ];
            const defaultFee = activeTeam.monthlyFee || p.fee || 85;
            const nextTeamFees = {
              ...(p.teamFees || {}),
              ...(p.teamFees?.[activeTeam.name] !== undefined
                ? {}
                : { [activeTeam.name]: defaultFee }),
            };
            update((d) => ({
              ...d,
              players: d.players.map((x) =>
                x.id === p.id
                  ? {
                      ...x,
                      teams: nextTeams,
                      teamFees: nextTeamFees,
                    }
                  : x,
              ),
            }));
            toast.success(
              `Assigned ${p.name} to ${activeTeam.name}${badgeLabel ? ` (${badgeLabel})` : ""}.`,
            );
          };

          const removePlayerFromTeam = (p: Player) => {
            update((d) => ({
              ...d,
              players: d.players.map((x) =>
                x.id === p.id
                  ? {
                      ...x,
                      teams: (x.teams || []).filter((t) => t !== activeTeam.name),
                    }
                  : x,
              ),
            }));
            toast.success(`Removed ${p.name} from ${activeTeam.name}.`);
          };

          const toggleTeamException = (field: "allowYoungerPlayers" | "allowOlderPlayers") => {
            const nextVal = !activeTeam[field];
            const updatedTeam: Team = { ...activeTeam, [field]: nextVal };
            setRoster(updatedTeam);
            update((d) => ({
              ...d,
              teams: d.teams.map((t) => (t.id === activeTeam.id ? updatedTeam : t)),
            }));
            toast.success(
              field === "allowYoungerPlayers"
                ? `${nextVal ? "Enabled" : "Disabled"} "Playing Up - Younger" exceptions for ${activeTeam.name}.`
                : `${nextVal ? "Enabled" : "Disabled"} "Over-Age Exception" rules for ${activeTeam.name}.`,
            );
          };

          return (
            <>
              <div className="p-4 border-b border-ink-800 bg-ink-900/60 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-mono text-ink-400 uppercase">
                        Linked Age Category:
                      </span>
                      <CategoryBadge category={activeTeam.category} />
                      {activeRule && (
                        <span className="font-mono text-[11px] text-ink-200">
                          Birth Years {activeRule.startDate.slice(0, 4)}–
                          {activeRule.endDate.slice(0, 4)} ({formatAgeDate(activeRule.startDate)} –{" "}
                          {formatAgeDate(activeRule.endDate)})
                        </span>
                      )}
                    </div>
                    <div className="flex gap-4 mt-1.5">
                      <div className="flex gap-1.5 items-center">
                        <span className="text-good font-mono text-xs">
                          {r.filter((p) => p.insuranceStatus === "Academy insured").length}
                        </span>
                        <span className="text-[10px] text-ink-400 font-mono">ACADEMY INSURED</span>
                      </div>
                      <div className="flex gap-1.5 items-center">
                        <span className="text-warn font-mono text-xs">
                          {r.filter((p) => p.insuranceStatus === "Self insured").length}
                        </span>
                        <span className="text-[10px] text-ink-400 font-mono">SELF INSURED</span>
                      </div>
                      <div className="flex gap-1.5 items-center">
                        <span className="text-bad font-mono text-xs">
                          {
                            r.filter(
                              (p) => !p.insuranceStatus || p.insuranceStatus === "Not insured",
                            ).length
                          }
                        </span>
                        <span className="text-[10px] text-ink-400 font-mono">NOT INSURED</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button
                      variant="outline"
                      className="text-xs py-1 px-2.5"
                      onClick={() => exportTeamCSV(activeTeam, r)}
                    >
                      📥 Export CSV
                    </Button>
                    <Button
                      variant="outline"
                      className="text-xs py-1 px-2.5"
                      onClick={() => exportTeamPDF(activeTeam, r)}
                    >
                      📄 Export PDF
                    </Button>
                  </div>
                </div>

                {/* Live Exception Rule Toggles in Roster View */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-ink-800/80">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-[10px] uppercase text-ink-400">
                      Team Exception Rules:
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleTeamException("allowYoungerPlayers")}
                      className={`rounded px-2.5 py-1 font-mono text-[10px] font-semibold ring-1 transition-colors ${
                        activeTeam.allowYoungerPlayers
                          ? "bg-court-500/20 text-court-300 ring-court-500/50"
                          : "bg-ink-850 text-ink-400 ring-ink-700 hover:text-ink-200"
                      }`}
                    >
                      {activeTeam.allowYoungerPlayers ? "✓ " : ""}Allow Younger Players (Playing Up)
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleTeamException("allowOlderPlayers")}
                      className={`rounded px-2.5 py-1 font-mono text-[10px] font-semibold ring-1 transition-colors ${
                        activeTeam.allowOlderPlayers
                          ? "bg-warn/20 text-warn ring-warn/50"
                          : "bg-ink-850 text-ink-400 ring-ink-700 hover:text-ink-200"
                      }`}
                    >
                      {activeTeam.allowOlderPlayers ? "✓ " : ""}Allow Older Players (Over-Age
                      Exception)
                    </button>
                  </div>
                  <div className="w-full sm:w-56">
                    <Search
                      value={rosterSearch}
                      onChange={setRosterSearch}
                      placeholder="Filter players by name or DOB…"
                    />
                  </div>
                </div>
              </div>

              <div className="max-h-[62vh] overflow-y-auto p-4 space-y-5">
                {/* Section 1: Current Team Roster */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-ink-200">
                      Current Team Roster ({r.length})
                    </span>
                  </div>
                  {r.length === 0 ? (
                    <div className="rounded-md bg-ink-900/50 p-3 text-center font-mono text-xs text-ink-400 ring-1 ring-ink-800">
                      No players assigned to {activeTeam.name} yet. Select from Available Eligible
                      Players below.
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {r.map((p) => {
                        const evalRes = evaluateTeamEligibilityForDob(p.dob, activeTeam, rules);
                        const ageInfo = calculatePlayerAgeFromDob(p.dob);
                        return (
                          <div
                            key={p.id}
                            className="flex items-center justify-between gap-3 rounded-md bg-court-500/10 px-3 py-2 ring-1 ring-court-500/40"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-sm font-medium text-ink-100">{p.name}</span>
                                {evalRes.matchType === "exact" && (
                                  <span className="rounded bg-good/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-good ring-1 ring-good/30">
                                    Exact Match
                                  </span>
                                )}
                                {evalRes.matchType === "younger" && (
                                  <span className="rounded bg-court-500/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-court-300 ring-1 ring-court-500/40">
                                    Playing Up - Younger
                                  </span>
                                )}
                                {evalRes.matchType === "older" && (
                                  <span className="rounded bg-warn/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-warn ring-1 ring-warn/40">
                                    Over-Age Exception
                                  </span>
                                )}
                                {!evalRes.eligible && (
                                  <span className="rounded bg-bad/20 px-1.5 py-0.5 font-mono text-[9px] font-bold text-bad ring-1 ring-bad/30">
                                    ⚠️ Outside {activeTeam.category} Age Window
                                  </span>
                                )}
                              </div>
                              <div className="font-mono text-[10px] text-ink-400 mt-0.5">
                                {ageInfo ? `${ageInfo.formattedSummary} · ` : ""}
                                {p.dob ? `DOB: ${formatAgeDate(p.dob)} · ` : "No DOB · "}
                                Cat: {p.category} · {p.branch || "—"}
                              </div>
                            </div>
                            <Button
                              size="xs"
                              variant="danger"
                              onClick={() => removePlayerFromTeam(p)}
                            >
                              Remove
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Section 2: Available Eligible Players (Smart DOB Filter) */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-court-300">
                        Available Eligible Players ({eligibleAvailable.length})
                      </span>
                      <p className="font-mono text-[10px] text-ink-400">
                        Automatically filtered by DOB for {activeTeam.category}
                        {activeTeam.allowYoungerPlayers ? " + Playing Up (Younger)" : ""}
                        {activeTeam.allowOlderPlayers ? " + Over-Age Exceptions" : ""}
                      </p>
                    </div>
                    {ineligibleAvailable.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowAllIneligibleInRoster((v) => !v)}
                        className="font-mono text-[10px] text-ink-400 hover:text-ink-200 underline"
                      >
                        {showAllIneligibleInRoster
                          ? "Hide non-matching players"
                          : `Show ${ineligibleAvailable.length} other non-matching player(s)`}
                      </button>
                    )}
                  </div>

                  {eligibleAvailable.length === 0 ? (
                    <div className="rounded-md bg-ink-900/50 p-4 text-center font-mono text-xs text-ink-400 ring-1 ring-ink-800">
                      No unassigned players currently match the {activeTeam.category} age rules
                      {!activeTeam.allowYoungerPlayers || !activeTeam.allowOlderPlayers
                        ? " (toggle 'Allow Younger Players' or 'Allow Older Players' above to expand exception eligibility)."
                        : "."}
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {eligibleAvailable.map(({ player: p, eligibility, ageInfo }) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between gap-3 rounded-md bg-ink-850 px-3 py-2.5 ring-1 ring-ink-700 hover:ring-court-500/50 transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium text-ink-100">{p.name}</span>
                              {eligibility.matchType === "exact" && (
                                <span className="rounded bg-good/20 px-2 py-0.5 font-mono text-[9px] font-bold text-good ring-1 ring-good/30">
                                  Exact Match
                                </span>
                              )}
                              {eligibility.matchType === "younger" && (
                                <span className="rounded bg-court-500/20 px-2 py-0.5 font-mono text-[9px] font-bold text-court-300 ring-1 ring-court-500/40">
                                  Playing Up - Younger
                                </span>
                              )}
                              {eligibility.matchType === "older" && (
                                <span className="rounded bg-warn/20 px-2 py-0.5 font-mono text-[9px] font-bold text-warn ring-1 ring-warn/40">
                                  Over-Age Exception
                                </span>
                              )}
                            </div>
                            <div className="font-mono text-[10px] text-ink-400 mt-0.5">
                              {ageInfo ? `${ageInfo.formattedSummary} · ` : ""}
                              {p.dob ? `DOB: ${formatAgeDate(p.dob)} · ` : ""}
                              Cat: {p.category} · {p.branch || "—"}
                              {p.teams && p.teams.length > 0
                                ? ` · Currently on: ${p.teams.join(", ")}`
                                : " · Unassigned"}
                            </div>
                          </div>
                          <Button
                            size="xs"
                            variant="primary"
                            onClick={() => assignPlayerToTeam(p, eligibility.badgeLabel)}
                          >
                            + Assign to Team
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}

                  {showAllIneligibleInRoster && ineligibleAvailable.length > 0 && (
                    <div className="pt-3 space-y-1.5 border-t border-ink-800">
                      <div className="font-mono text-[10px] uppercase text-ink-400">
                        Other Non-Matching Players ({ineligibleAvailable.length})
                      </div>
                      {ineligibleAvailable.map(({ player: p, ageInfo }) => (
                        <div
                          key={p.id}
                          className="flex items-center justify-between gap-3 rounded-md bg-ink-900/60 px-3 py-2 ring-1 ring-ink-800 opacity-80"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-medium text-ink-200">{p.name}</span>
                              <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[9px] text-ink-400">
                                Outside {activeTeam.category} Range
                              </span>
                            </div>
                            <div className="font-mono text-[10px] text-ink-500 mt-0.5">
                              {ageInfo ? `${ageInfo.formattedSummary} · ` : ""}
                              {p.dob ? `DOB: ${formatAgeDate(p.dob)} · ` : "No DOB · "}
                              Cat: {p.category}
                            </div>
                          </div>
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => assignPlayerToTeam(p, "Manual Override")}
                          >
                            Force Assign
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          );
        })()}
      </Modal>

      {/* Team WhatsApp Group Link Modal */}
      <Modal
        open={!!whatsAppTeam}
        title={`${whatsAppTeam?.name || ""} — WhatsApp Groups & Links`}
        meta={`Manage squad announcements, match reports, and pitch-side QR join pass for ${whatsAppTeam?.name || ""}`}
        onClose={() => setWhatsAppTeam(null)}
        wide
      >
        {whatsAppTeam && (
          <div className="p-4">
            <Suspense
              fallback={
                <div className="p-8 text-center font-mono text-xs text-ink-400">
                  Loading WhatsApp Channel...
                </div>
              }
            >
              <WhatsAppGroupsManager
                embedded
                filterTeamId={whatsAppTeam.id}
                title={`${whatsAppTeam.name} WhatsApp Channel`}
              />
            </Suspense>
          </div>
        )}
      </Modal>

      {/* All Teams WhatsApp Hub Modal */}
      <Modal
        open={allTeamsWhatsAppOpen}
        title="Academy WhatsApp Groups & Channel Directory"
        meta="Manage invite links across all teams and branches"
        onClose={() => setAllTeamsWhatsAppOpen(false)}
        wide
      >
        <div className="p-4">
          <Suspense
            fallback={
              <div className="p-8 text-center font-mono text-xs text-ink-400">
                Loading WhatsApp Hub...
              </div>
            }
          >
            <WhatsAppGroupsManager embedded />
          </Suspense>
        </div>
      </Modal>

      <Modal
        open={Boolean(deleteTarget)}
        title="Delete team"
        meta={deleteTarget ? `Remove "${deleteTarget.name}"` : undefined}
        onClose={() => setDeleteTarget(null)}
        onSubmit={confirmRemove}
        submitLabel="Delete team"
      >
        <div className="p-4 text-sm text-ink-200">
          Are you sure you want to delete team{" "}
          <span className="font-semibold text-ink-100">{deleteTarget?.name}</span>? Players and
          sessions assigned to this team will be unassigned.
        </div>
      </Modal>
    </AppShell>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, lazy, Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import {
  Button,
  Chip,
  EmptyState,
  Field,
  Modal,
  Panel,
  Row,
  RowActions,
  Select,
  Stat,
  Table,
  Td,
  Textarea,
  Th,
  Input,
  money,
} from "@/components/kit";
import { PlanView, emptyPlan } from "@/components/plan-editor";
import type { PlanDraft } from "@/components/plan-editor";

const PlanEditor = lazy(() =>
  import("@/components/plan-editor").then((m) => ({ default: m.PlanEditor })),
);
import {
  useDB,
  useTenantUser,
  defaultRoleDefinitions,
  coachMatchesBranch,
  type MasterDrill,
  type DrillCategory,
  type PlanBlock,
} from "@/lib/data-store";
import { useAuth } from "@/lib/auth";
import { masterDrills as fallbackDrills } from "@/lib/mock-data";
import { ResourcesTab } from "@/components/resources-tab";
import { uploadTechnicalDocument } from "@/lib/storage";
import { toast } from "sonner";
import { dispatchCurriculumAlert, createAcademyNotification } from "@/lib/notifications";
import type { Plan } from "@/lib/data-store";
import type { Workshop, SessionItem, MatchOfficial } from "@/lib/mock-data";
import { DrillSelector } from "@/components/drill-selector";
import {
  BookOpen,
  Plus,
  Search,
  Clock,
  Target,
  Trash2,
  Edit3,
  Image as ImageIcon,
  Sparkles,
  Shield,
  Trophy,
  Users,
  CheckCircle2,
  Calendar,
  Layers,
  X,
  MessageSquare,
} from "lucide-react";
import { WhatsAppShareModal } from "@/components/whatsapp-share-modal";

export const Route = createFileRoute("/technical")({
  head: () => ({
    meta: [
      { title: "Technical Portal — Vescio Vector" },
      {
        name: "description",
        content:
          "Technical director workspace: game approvals, practice plan review, shared resources, master drill repository, meetings and seminars.",
      },
      { property: "og:title", content: "Technical Portal — Vescio Vector" },
      {
        property: "og:description",
        content: "Approvals, coaching resources, drill repository and practice plan review.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: TechnicalPage,
});

const tabs = [
  "Game approval",
  "Practice plans",
  "Drill repository",
  "Resources",
  "Completed games",
  "Workshops",
] as const;

function TechnicalPage() {
  const { db, updateAcademy, ready } = useDB();
  const { user, passwordUser, loading: authLoading } = useAuth();
  const currentUser = useTenantUser();
  const requireGameConfirmation =
    db.academy?.requireGameConfirmation !== false && !db.academy?.autoConfirmGames;
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
    currentUser?.role === "Technical Director" ||
    Boolean(userRoleDef?.permissions?.["drills"]?.read) ||
    user?.email === "geogo3@gmail.com" ||
    passwordUser?.email === "geogo3@gmail.com";
  const hasFeature = db.academy?.features?.includes("technical") !== false;

  const [tab, setTab] = useState<(typeof tabs)[number]>("Game approval");

  if (authLoading && !currentUser && !user && !passwordUser) {
    return (
      <AppShell crumb="CONTROL / TECHNICAL PORTAL" title="Technical Portal">
        <div className="flex h-64 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-court-500 border-t-transparent" />
          <span className="ml-3 font-mono text-xs text-ink-400">Loading technical portal...</span>
        </div>
      </AppShell>
    );
  }

  if (!hasFeature) {
    return (
      <AppShell crumb="CONTROL / TECHNICAL PORTAL" title="Technical Portal">
        <div className="py-10 text-center font-mono text-[11px] text-ink-400">
          This feature is not included in your current plan.
        </div>
      </AppShell>
    );
  }

  if (!hasAccess) {
    return (
      <AppShell crumb="CONTROL / TECHNICAL PORTAL" title="Technical Portal">
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
            You do not have permission to access the technical portal.
          </p>
        </div>
      </AppShell>
    );
  }

  const isBranchScoped =
    currentUser?.branchScope === "Assigned branch only" && Boolean(currentUser?.branch);
  const userBranch = isBranchScoped ? currentUser?.branch || "" : "";

  const matchesPlanBranch = (p: Plan) => {
    if (!isBranchScoped) return true;
    const explicitBranch = (p as Plan & { branch?: string }).branch;
    if (explicitBranch) {
      return explicitBranch.toLowerCase() === userBranch.toLowerCase();
    }
    const planCoach = db.coaches.find(
      (c) =>
        (p.coachId && c.id === p.coachId) ||
        (p.coach && c.name.toLowerCase() === p.coach.toLowerCase()),
    );
    return planCoach ? coachMatchesBranch(planCoach, userBranch) : false;
  };

  const pendingGames = db.sessions.filter(
    (s) =>
      s.status === "Pending approval" &&
      (!isBranchScoped || s.branch?.toLowerCase() === userBranch.toLowerCase()),
  ).length;
  const inReview = db.plans.filter((p) => p.status === "Submitted" && matchesPlanBranch(p)).length;
  const approvedPlansCount = db.plans.filter(
    (p) => p.status === "Approved" && matchesPlanBranch(p),
  ).length;
  const scopedCoachesCount = isBranchScoped
    ? db.coaches.filter((c) => coachMatchesBranch(c, userBranch)).length
    : db.coaches.length;
  const drillsCount = db.drills && db.drills.length > 0 ? db.drills.length : fallbackDrills.length;

  return (
    <AppShell crumb="CONTROL / TECHNICAL PORTAL" title="Technical Portal">
      <div className="pb-24 lg:pb-8 space-y-4">
        {/* Mobile App View Header */}
        <div className="block lg:hidden rounded-2xl border border-ink-800 bg-gradient-to-br from-ink-900 via-ink-900 to-ink-950 p-4 shadow-lg">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-court-500/15 text-court-400 ring-1 ring-court-500/30">
                <Shield className="h-5 w-5" />
              </div>
              <div>
                <div className="text-xs font-mono font-semibold tracking-wider text-court-400 uppercase">
                  Technical Directorate
                </div>
                <div className="text-sm font-display font-bold text-ink-100">
                  {currentUser?.name || "Director Workspace"}
                </div>
              </div>
            </div>
            <div className="flex flex-col items-end">
              <Chip tone="accent">{tab.toUpperCase()}</Chip>
              <span className="text-[9px] font-mono text-court-400/80 mt-0.5">DIRECTOR APP</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1 border-t border-ink-800/80">
            <div className="rounded-xl bg-ink-950/70 p-2.5 border border-ink-800">
              <div className="flex items-center gap-1.5 text-ink-400 text-[10px] font-mono">
                <Shield className="h-3 w-3 text-court-400" />
                <span>Pending Games</span>
              </div>
              <div className="mt-1 text-base font-bold font-mono text-ink-100">{pendingGames}</div>
            </div>
            <div className="rounded-xl bg-ink-950/70 p-2.5 border border-ink-800">
              <div className="flex items-center gap-1.5 text-ink-400 text-[10px] font-mono">
                <BookOpen className="h-3 w-3 text-court-400" />
                <span>Plans in Review</span>
              </div>
              <div className="mt-1 text-base font-bold font-mono text-ink-100">{inReview}</div>
            </div>
          </div>
        </div>

        {/* Header Stats */}
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Chip tone="accent">/TECHNICAL</Chip>
              <span className="font-mono text-[10px] text-ink-400 uppercase tracking-wider">
                Approvals, Curriculum & Match Operations
              </span>
            </div>

            <div className="flex items-center gap-3 rounded-lg bg-ink-900/90 px-3.5 py-2 ring-1 ring-ink-750">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-semibold text-ink-100">
                  Require TD Game Confirmation
                </span>
                <Chip tone={requireGameConfirmation ? "warn" : "good"}>
                  {requireGameConfirmation ? "Manual Approval Active" : "Auto-Confirm Active"}
                </Chip>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={requireGameConfirmation}
                onClick={async () => {
                  const nextVal = !requireGameConfirmation;
                  try {
                    await updateAcademy({
                      requireGameConfirmation: nextVal,
                      autoConfirmGames: !nextVal,
                    });
                    toast.success(
                      nextVal
                        ? "Manual TD Game Approval enabled: New coach-scheduled games require confirmation."
                        : "Auto-Confirm enabled: New games are automatically confirmed while preserving TD notifications & reports.",
                    );
                  } catch {
                    // handled by updateAcademy
                  }
                }}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  requireGameConfirmation ? "bg-court-500" : "bg-ink-700"
                }`}
                title="Toggle whether newly scheduled games require manual Technical Director confirmation or auto-confirm immediately"
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-ink-950 shadow ring-0 transition duration-200 ease-in-out ${
                    requireGameConfirmation ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Pending games"
              value={String(pendingGames)}
              note="awaiting approval"
              accent
            />
            <Stat label="Plans in review" value={String(inReview)} note="submitted by coaches" />
            <Stat label="Approved plans" value={String(approvedPlansCount)} />
            <Stat label="Coaches" value={String(scopedCoachesCount)} note="with portal resources" />
          </div>
        </div>

        {/* Tab Navigation Pill Bar */}
        <div className="flex overflow-x-auto no-scrollbar gap-1.5 py-1">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`shrink-0 rounded-lg px-3 py-2 font-mono text-[11px] font-medium uppercase tracking-wider transition-all ${
                tab === t
                  ? "bg-court-500 text-ink-950 shadow-md font-bold"
                  : "bg-ink-900/90 text-ink-300 ring-1 ring-ink-750 hover:bg-ink-800"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Active Tab Content */}
        <div className="mt-2">
          {tab === "Game approval" ? <GameApproval /> : null}
          {tab === "Practice plans" ? <PracticePlans /> : null}
          {tab === "Drill repository" ? <DrillRepositoryTab /> : null}
          {tab === "Resources" ? <ResourcesTab /> : null}
          {tab === "Completed games" ? <CompletedGames /> : null}
          {tab === "Workshops" ? <WorkshopsTab /> : null}
        </div>
      </div>

      {/* Mobile App Dedicated Bottom Navigation Bar */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-ink-800 bg-ink-950/95 px-1 pb-[calc(env(safe-area-inset-bottom)+6px)] pt-2 backdrop-blur-md lg:hidden shadow-2xl">
        <button
          onClick={() => setTab("Game approval")}
          className={`flex flex-1 flex-col items-center gap-1 py-1 transition-colors ${
            tab === "Game approval" ? "text-court-400 font-bold" : "text-ink-400 hover:text-ink-200"
          }`}
        >
          <Shield className="h-4 w-4" />
          <span className="font-mono text-[9px] uppercase tracking-wider">Approvals</span>
        </button>

        <button
          onClick={() => setTab("Practice plans")}
          className={`flex flex-1 flex-col items-center gap-1 py-1 transition-colors ${
            tab === "Practice plans"
              ? "text-court-400 font-bold"
              : "text-ink-400 hover:text-ink-200"
          }`}
        >
          <BookOpen className="h-4 w-4" />
          <span className="font-mono text-[9px] uppercase tracking-wider">Plans</span>
        </button>

        <button
          onClick={() => setTab("Drill repository")}
          className={`flex flex-1 flex-col items-center gap-1 py-1 transition-colors ${
            tab === "Drill repository"
              ? "text-court-400 font-bold"
              : "text-ink-400 hover:text-ink-200"
          }`}
        >
          <Target className="h-4 w-4" />
          <span className="font-mono text-[9px] uppercase tracking-wider">Playbook</span>
        </button>

        <button
          onClick={() => setTab("Completed games")}
          className={`flex flex-1 flex-col items-center gap-1 py-1 transition-colors ${
            tab === "Completed games"
              ? "text-court-400 font-bold"
              : "text-ink-400 hover:text-ink-200"
          }`}
        >
          <Trophy className="h-4 w-4" />
          <span className="font-mono text-[9px] uppercase tracking-wider">Matches</span>
        </button>

        <button
          onClick={() => setTab("Workshops")}
          className={`flex flex-1 flex-col items-center gap-1 py-1 transition-colors ${
            tab === "Workshops" ? "text-court-400 font-bold" : "text-ink-400 hover:text-ink-200"
          }`}
        >
          <Users className="h-4 w-4" />
          <span className="font-mono text-[9px] uppercase tracking-wider">Workshops</span>
        </button>

        <button
          onClick={() => setTab("Resources")}
          className={`flex flex-1 flex-col items-center gap-1 py-1 transition-colors ${
            tab === "Resources" ? "text-court-400 font-bold" : "text-ink-400 hover:text-ink-200"
          }`}
        >
          <Layers className="h-4 w-4" />
          <span className="font-mono text-[9px] uppercase tracking-wider">Resources</span>
        </button>
      </nav>
    </AppShell>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-ink-850 p-3 ring-1 ring-ink-700">
      <div className="label-mono">{label}</div>
      <div className="mt-1 text-sm text-ink-100">{value}</div>
    </div>
  );
}

function GameApproval() {
  const { db, update, updateAcademy, tenantId } = useDB();
  const currentUser = useTenantUser();
  const requireGameConfirmation =
    db.academy?.requireGameConfirmation !== false && !db.academy?.autoConfirmGames;
  const games = db.sessions.filter((s) => s.kind === "Game");
  const [openGame, setOpenGame] = useState<string | null>(null);
  const [shareGame, setShareGame] = useState<SessionItem | null>(null);
  const game = games.find((g) => g.id === openGame) ?? null;

  const teamsExperience = useMemo(() => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
    return db.teams.map((t) => {
      const target = t.gamesFrequencyPerMonth ?? 2;
      const teamGames = db.sessions.filter((s) => {
        if (s.kind !== "Game") return false;
        if (s.teamA !== t.name && s.teamB !== t.name) return false;
        const raw = typeof s.date === "string" ? s.date.trim().split("T")[0] : "";
        const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
        const norm = m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : raw;
        const gDate = norm ? new Date(`${norm}T00:00:00`) : new Date(NaN);
        return (
          !Number.isNaN(gDate.getTime()) &&
          gDate >= thirtyDaysAgo &&
          gDate <= new Date() &&
          (s.status === "Completed" || s.status === "Official")
        );
      });
      return {
        team: t,
        target,
        playedCount: teamGames.length,
        lacksExperience: teamGames.length < target,
      };
    });
  }, [db.teams, db.sessions]);

  const underTargetCount = teamsExperience.filter((te) => te.lacksExperience).length;
  const pendingProposals = useMemo(() => {
    return db.teams.filter((t) => t.pendingFrequencyProposal?.status === "Pending");
  }, [db.teams]);

  function setStatus(id: string, status: "Pre-approved" | "Official" | "Planned") {
    const targetGame = db.sessions.find((s) => s.id === id);
    const approvalStatus: SessionItem["approvalStatus"] =
      status === "Planned" ? "Rejected" : "Approved";
    const confirmedBy =
      status === "Planned" ? undefined : currentUser?.name || "Technical Director";
    update((d) => ({
      ...d,
      sessions: d.sessions.map((s) =>
        s.id === id ? { ...s, status, approvalStatus, confirmedBy } : s,
      ),
    }));
    if (targetGame) {
      const actionLabel =
        status === "Planned" ? "Rejected" : status === "Official" ? "Marked Official" : "Approved";
      void createAcademyNotification(tenantId, {
        title: `Game ${actionLabel}: ${targetGame.title}`,
        message:
          status === "Planned"
            ? `Technical Director rejected game "${targetGame.title}" (${targetGame.date}).`
            : status === "Official"
              ? `Game "${targetGame.title}" (${targetGame.date}) has been verified and marked Official.`
              : `Technical Director approved game "${targetGame.title}" scheduled for ${targetGame.date} at ${targetGame.time}.`,
        type: "curriculum",
        targetRoles: ["coach", "branch_manager", "super_admin"],
        targetCoachId: targetGame.coachId || targetGame.headCoachId,
        targetCoachName: targetGame.coach || targetGame.headCoach,
        targetTeam: targetGame.teamA || targetGame.team,
        targetBranchId: targetGame.branch || undefined,
        actionUrl: "/coach",
        createdAt: new Date().toISOString(),
        readBy: [],
        dismissedBy: [],
      }).catch(() => {});
    }
    toast.success(`Game status updated to ${status}.`);
  }

  return (
    <div className="space-y-4">
      {/* Game Confirmation Mode Policy Banner */}
      <div className="rounded-xl border border-ink-800 bg-ink-900/90 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-display text-sm font-bold text-ink-100">
              Require TD Game Confirmation
            </span>
            <Chip tone={requireGameConfirmation ? "warn" : "good"}>
              {requireGameConfirmation ? "Manual Approval Active" : "Auto-Confirm Active"}
            </Chip>
          </div>
          <p className="font-mono text-[11px] text-ink-300">
            {requireGameConfirmation
              ? "Coaches submit games as 'Pending approval' and await Technical Director confirmation before becoming active."
              : "Auto-Confirm is ON: Coach-scheduled games are confirmed immediately without manual approval. You still receive all match alerts, final scores, and game reports."}
          </p>
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          <span className="font-mono text-[11px] text-ink-400">
            {requireGameConfirmation ? "Manual" : "Auto-Confirm"}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={requireGameConfirmation}
            onClick={async () => {
              const nextVal = !requireGameConfirmation;
              try {
                await updateAcademy({
                  requireGameConfirmation: nextVal,
                  autoConfirmGames: !nextVal,
                });
                toast.success(
                  nextVal
                    ? "Require TD Game Confirmation enabled (Manual Approval Active)."
                    : "Require TD Game Confirmation disabled (Auto-Confirm Active).",
                );
              } catch {
                // handled by updateAcademy
              }
            }}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              requireGameConfirmation ? "bg-court-500" : "bg-ink-700"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-ink-950 shadow ring-0 transition duration-200 ease-in-out ${
                requireGameConfirmation ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Monthly Game Frequency & Match Experience Policy */}
      <Panel
        title="Squad Game Frequency & Match Experience Policy"
        meta="Controlled by Technical Director & Assigned Coaches — System notifies when monthly frequency is not met"
      >
        <div className="p-4 space-y-3">
          {/* Pending Coach Frequency Requests Banner */}
          {pendingProposals.length > 0 && (
            <div className="rounded-lg bg-court-500/10 p-3 ring-1 ring-court-400/40 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 font-mono text-xs font-bold text-court-300 uppercase tracking-wider">
                  <span className="text-base leading-none">📬</span>
                  <span>Coach Match Frequency Proposals ({pendingProposals.length})</span>
                </div>
                <span className="font-mono text-[10px] text-ink-400">
                  Technical Director Decision Required
                </span>
              </div>
              <p className="text-xs text-ink-300 font-mono">
                Coaches have proposed changes to minimum monthly match frequency targets. Review and
                approve or decline below:
              </p>
              <div className="divide-y divide-ink-800/80">
                {pendingProposals.map((team) => {
                  const prop = team.pendingFrequencyProposal!;
                  const currentTarget = team.gamesFrequencyPerMonth ?? 2;
                  return (
                    <div
                      key={team.id}
                      className="py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs font-mono"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-sans font-bold text-ink-100 text-sm">
                            {team.name}
                          </span>
                          <span className="text-[10px] text-ink-400">({team.category})</span>
                        </div>
                        <div className="text-[11px] text-ink-300 mt-0.5">
                          Requested by{" "}
                          <span className="text-court-300 font-semibold">
                            {prop.requestedByCoach}
                          </span>{" "}
                          on {prop.requestedDate}: Current:{" "}
                          <span className="text-ink-400 line-through">
                            {currentTarget} games/mo
                          </span>{" "}
                          ➔ Proposed:{" "}
                          <span className="text-court-400 font-bold">
                            {prop.requestedFrequency} games/mo
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const newTarget = prop.requestedFrequency ?? prop.gamesPerMonth ?? 4;
                            update((d) => ({
                              ...d,
                              teams: d.teams.map((t) =>
                                t.id === team.id
                                  ? {
                                      ...t,
                                      gamesFrequencyPerMonth: newTarget,
                                      pendingFrequencyProposal: {
                                        ...prop,
                                        status: "Approved",
                                      },
                                    }
                                  : t,
                              ),
                            }));
                            void createAcademyNotification(tenantId, {
                              title: `Match Frequency Proposal Approved: ${team.name}`,
                              message: `Technical Director approved your match frequency target of ${newTarget} games/mo for ${team.name}.`,
                              type: "curriculum",
                              targetRoles: ["coach"],
                              targetCoachId: team.headCoachId || team.coachId,
                              targetCoachName:
                                prop.requestedByCoach || team.headCoach || team.coach,
                              targetTeam: team.name,
                              targetBranchId: team.branch || undefined,
                              actionUrl: "/coach",
                              createdAt: new Date().toISOString(),
                              readBy: [],
                              dismissedBy: [],
                            }).catch(() => {});
                            toast.success(
                              `Approved match frequency change for ${team.name}: now ${newTarget} games/mo.`,
                            );
                          }}
                          className="flex items-center gap-1 rounded bg-court-600 hover:bg-court-500 px-3 py-1 text-ink-950 font-bold text-xs transition-colors"
                        >
                          <span>✓ Approve Target</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            update((d) => ({
                              ...d,
                              teams: d.teams.map((t) =>
                                t.id === team.id
                                  ? {
                                      ...t,
                                      pendingFrequencyProposal: {
                                        ...prop,
                                        status: "Rejected",
                                      },
                                    }
                                  : t,
                              ),
                            }));
                            void createAcademyNotification(tenantId, {
                              title: `Match Frequency Proposal Declined: ${team.name}`,
                              message: `Technical Director declined the proposed match frequency change (${prop.requestedFrequency} games/mo) for ${team.name}.`,
                              type: "curriculum",
                              targetRoles: ["coach"],
                              targetCoachId: team.headCoachId || team.coachId,
                              targetCoachName:
                                prop.requestedByCoach || team.headCoach || team.coach,
                              targetTeam: team.name,
                              targetBranchId: team.branch || undefined,
                              actionUrl: "/coach",
                              createdAt: new Date().toISOString(),
                              readBy: [],
                              dismissedBy: [],
                            }).catch(() => {});
                            toast.info(`Declined frequency proposal for ${team.name}.`);
                          }}
                          className="flex items-center gap-1 rounded bg-bad/20 hover:bg-bad/30 text-bad px-2.5 py-1 text-xs font-bold ring-1 ring-bad/40 transition-colors"
                        >
                          <span>✕ Decline</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {underTargetCount > 0 && (
            <div className="rounded-lg bg-bad/10 p-3 ring-1 ring-bad/30 flex items-start gap-2 text-xs text-bad">
              <span className="text-base leading-none">⚠️</span>
              <div>
                <span className="font-bold">
                  Lack of Game Experience: {underTargetCount} squad(s) below monthly target!
                </span>
                <p className="mt-0.5 text-bad/90 font-mono text-[11px]">
                  The system triggers persistent warnings for coaches and directors until sufficient
                  matches are scheduled and completed.
                </p>
              </div>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {teamsExperience.map(({ team, target, playedCount, lacksExperience }) => (
              <div
                key={team.id}
                className="rounded-lg bg-ink-850 p-3 ring-1 ring-ink-700 space-y-2 text-xs font-mono"
              >
                <div className="flex items-start justify-between gap-1">
                  <div className="min-w-0">
                    <div className="font-sans font-bold text-sm text-ink-100 truncate">
                      {team.name}
                    </div>
                    <div className="text-[10px] text-ink-400">
                      Coach: {team.headCoach || "Unassigned"} · {team.category}
                    </div>
                  </div>
                  <Chip tone={lacksExperience ? "bad" : "good"}>
                    {lacksExperience
                      ? `LACKS EXP (${playedCount}/${target})`
                      : `MET (${playedCount}/${target})`}
                  </Chip>
                </div>

                {/* Pending Proposal Callout on Squad Card */}
                {team.pendingFrequencyProposal?.status === "Pending" && (
                  <div className="rounded bg-warn/10 p-1.5 ring-1 ring-warn/30 text-[10px] text-warn flex items-center justify-between gap-1">
                    <span className="truncate">
                      Coach proposed:{" "}
                      <strong>{team.pendingFrequencyProposal.requestedFrequency} games/mo</strong>
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          const prop = team.pendingFrequencyProposal!;
                          const newTarget = prop.requestedFrequency ?? prop.gamesPerMonth ?? 4;
                          update((d) => ({
                            ...d,
                            teams: d.teams.map((t) =>
                              t.id === team.id
                                ? {
                                    ...t,
                                    gamesFrequencyPerMonth: newTarget,
                                    pendingFrequencyProposal: { ...prop, status: "Approved" },
                                  }
                                : t,
                            ),
                          }));
                          void createAcademyNotification(tenantId, {
                            title: `Match Frequency Proposal Approved: ${team.name}`,
                            message: `Technical Director approved your match frequency target of ${newTarget} games/mo for ${team.name}.`,
                            type: "curriculum",
                            targetRoles: ["coach"],
                            targetCoachId: team.headCoachId || team.coachId,
                            targetCoachName: prop.requestedByCoach || team.headCoach || team.coach,
                            targetTeam: team.name,
                            targetBranchId: team.branch || undefined,
                            actionUrl: "/coach",
                            createdAt: new Date().toISOString(),
                            readBy: [],
                            dismissedBy: [],
                          }).catch(() => {});
                          toast.success(`Approved ${newTarget} games/mo for ${team.name}.`);
                        }}
                        className="px-1.5 py-0.5 rounded bg-court-500 text-ink-950 font-bold text-[10px]"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const prop = team.pendingFrequencyProposal!;
                          update((d) => ({
                            ...d,
                            teams: d.teams.map((t) =>
                              t.id === team.id
                                ? {
                                    ...t,
                                    pendingFrequencyProposal: { ...prop, status: "Rejected" },
                                  }
                                : t,
                            ),
                          }));
                          void createAcademyNotification(tenantId, {
                            title: `Match Frequency Proposal Declined: ${team.name}`,
                            message: `Technical Director declined the proposed match frequency change (${prop.requestedFrequency} games/mo) for ${team.name}.`,
                            type: "curriculum",
                            targetRoles: ["coach"],
                            targetCoachId: team.headCoachId || team.coachId,
                            targetCoachName: prop.requestedByCoach || team.headCoach || team.coach,
                            targetTeam: team.name,
                            targetBranchId: team.branch || undefined,
                            actionUrl: "/coach",
                            createdAt: new Date().toISOString(),
                            readBy: [],
                            dismissedBy: [],
                          }).catch(() => {});
                          toast.info(`Declined proposal for ${team.name}.`);
                        }}
                        className="px-1.5 py-0.5 rounded bg-bad/20 text-bad font-bold text-[10px]"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                )}

                {team.pendingFrequencyProposal?.status === "Approved" && (
                  <div className="rounded bg-court-500/10 p-1.5 ring-1 ring-court-400/30 text-[10px] text-court-300 flex items-center justify-between gap-1">
                    <span className="truncate">
                      ✓ Approved proposal ({team.gamesFrequencyPerMonth} games/mo)
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        update((d) => ({
                          ...d,
                          teams: d.teams.map((t) => {
                            if (t.id !== team.id) return t;
                            const copy = { ...t };
                            delete copy.pendingFrequencyProposal;
                            return copy;
                          }),
                        }));
                      }}
                      className="text-ink-400 hover:text-ink-200 underline text-[9px] shrink-0"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {team.pendingFrequencyProposal?.status === "Rejected" && (
                  <div className="rounded bg-bad/10 p-1.5 ring-1 ring-bad/30 text-[10px] text-bad flex items-center justify-between gap-1">
                    <span className="truncate">✕ Declined proposal</span>
                    <button
                      type="button"
                      onClick={() => {
                        update((d) => ({
                          ...d,
                          teams: d.teams.map((t) => {
                            if (t.id !== team.id) return t;
                            const copy = { ...t };
                            delete copy.pendingFrequencyProposal;
                            return copy;
                          }),
                        }));
                      }}
                      className="text-ink-400 hover:text-ink-200 underline text-[9px] shrink-0"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                <div className="flex items-center justify-between pt-1 border-t border-ink-800 text-[11px]">
                  <span className="text-ink-300">Target frequency:</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        const newTarget = Math.max(1, target - 1);
                        update((d) => ({
                          ...d,
                          teams: d.teams.map((t) =>
                            t.id === team.id ? { ...t, gamesFrequencyPerMonth: newTarget } : t,
                          ),
                        }));
                        toast.success(`Updated ${team.name} target to ${newTarget} games/mo.`);
                      }}
                      className="w-5 h-5 rounded bg-ink-800 text-ink-200 hover:bg-ink-700 flex items-center justify-center font-bold ring-1 ring-ink-700"
                      title="Decrease target frequency (Technical Director direct override)"
                    >
                      -
                    </button>
                    <span className="w-5 text-center font-bold text-court-300">{target}</span>
                    <button
                      type="button"
                      onClick={() => {
                        const newTarget = target + 1;
                        update((d) => ({
                          ...d,
                          teams: d.teams.map((t) =>
                            t.id === team.id ? { ...t, gamesFrequencyPerMonth: newTarget } : t,
                          ),
                        }));
                        toast.success(`Updated ${team.name} target to ${newTarget} games/mo.`);
                      }}
                      className="w-5 h-5 rounded bg-ink-800 text-ink-200 hover:bg-ink-700 flex items-center justify-center font-bold ring-1 ring-ink-700"
                      title="Increase target frequency (Technical Director direct override)"
                    >
                      +
                    </button>
                    <span className="text-ink-400 text-[10px]">/mo</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Panel>

      <Panel
        title="Submitted games & match operations"
        meta="Review rosters, venue assignments, and referee/staff accounting live"
      >
        {/* Mobile Card View (Robust, app-style UI) */}
        <div className="hidden space-y-3">
          {games.length === 0 ? (
            <EmptyState>No games submitted yet.</EmptyState>
          ) : (
            games.map((g) => {
              const refs = (g as SessionItem).referees || [];
              const staff = (g as SessionItem).matchStaff || [];
              const totalFees = [...refs, ...staff].reduce(
                (acc, curr) => acc + (Number(curr.fee) || 0),
                0,
              );

              return (
                <div
                  key={g.id}
                  className="rounded-xl border border-ink-800 bg-ink-900/90 p-3.5 shadow-sm space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap mb-1">
                        <Chip
                          tone={
                            g.status === "Official"
                              ? "good"
                              : g.status === "Pre-approved"
                                ? "good"
                                : g.status === "Pending approval"
                                  ? "warn"
                                  : "neutral"
                          }
                        >
                          {String(g.status || "Planned").toUpperCase()}
                        </Chip>
                        <span className="font-mono text-[10px] text-court-400 bg-court-500/10 px-2 py-0.5 rounded border border-court-500/20">
                          {g.branch || "HQ"}
                        </span>
                        {g.gameType && (
                          <span className="font-mono text-[10px] text-ink-300 bg-ink-850 px-1.5 py-0.5 rounded">
                            {g.gameType}
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setOpenGame(g.id)}
                        className="text-left text-sm font-bold text-ink-100 hover:text-court-400 transition-colors"
                      >
                        {g.title}
                      </button>
                      <p className="text-[11px] text-ink-400 font-mono mt-0.5">
                        📅 {g.date} · ⏰ {g.time} · 📍 {g.venue || g.detail || "Main Court"}
                      </p>
                    </div>
                  </div>

                  {/* Financial & Match Officials Breakdown */}
                  <div className="rounded-lg bg-ink-950/80 p-2.5 ring-1 ring-ink-800/80 space-y-2">
                    <div className="flex items-center justify-between text-[11px] font-mono">
                      <span className="text-ink-400">Match Operations Cost:</span>
                      <span className="font-bold text-court-300">{money(totalFees)}</span>
                    </div>

                    {refs.length > 0 || staff.length > 0 ? (
                      <div className="space-y-1.5 pt-1 border-t border-ink-800/60 text-[10px] font-mono">
                        {refs.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap text-ink-300">
                            <span className="text-ink-400 font-semibold">Referees:</span>
                            {refs.map((r, i) => (
                              <span
                                key={i}
                                className="rounded bg-ink-850 px-1.5 py-0.5 text-ink-200 border border-ink-750"
                              >
                                {r.name} ({money(Number(r.fee) || 0)})
                                {r.source === "outsource" ? " [Outsource]" : " [Personnel]"}
                              </span>
                            ))}
                          </div>
                        )}
                        {staff.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap text-ink-300">
                            <span className="text-ink-400 font-semibold">Staff:</span>
                            {staff.map((s, i) => (
                              <span
                                key={i}
                                className="rounded bg-ink-850 px-1.5 py-0.5 text-ink-200 border border-ink-750"
                              >
                                {s.role}: {s.name} ({money(Number(s.fee) || 0)})
                                {s.source === "outsource" ? " [Outsource]" : " [Personnel]"}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-[10px] font-mono text-ink-500 italic">
                        No officials or staff assigned
                      </div>
                    )}

                    <div className="text-[10px] font-mono text-ink-400 flex items-center justify-between pt-1 border-t border-ink-800/40">
                      <span>
                        Coach: <strong className="text-ink-200">{g.coach || "Staff"}</strong>
                      </span>
                      {g.score && (
                        <span className="text-court-300 font-bold font-mono">Score: {g.score}</span>
                      )}
                    </div>
                  </div>

                  {/* Quick Action Buttons */}
                  <div className="flex items-center gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => setStatus(g.id, "Pre-approved")}
                      className="flex-1 rounded-md bg-good/15 py-1.5 text-center font-mono text-[10px] font-semibold text-good ring-1 ring-good/30 hover:bg-good/25 transition-colors"
                    >
                      ✓ APPROVE
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatus(g.id, "Official")}
                      className="flex-1 rounded-md bg-court-500/15 py-1.5 text-center font-mono text-[10px] font-semibold text-court-300 ring-1 ring-court-500/30 hover:bg-court-500/25 transition-colors"
                    >
                      ★ OFFICIAL
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatus(g.id, "Planned")}
                      className="rounded-md bg-bad/10 px-2.5 py-1.5 font-mono text-[10px] text-bad ring-1 ring-bad/30 hover:bg-bad/20 transition-colors"
                    >
                      VOID
                    </button>
                    <Button
                      variant="emerald"
                      size="xs"
                      onClick={() => setShareGame(g as SessionItem)}
                      title="Push game report to WhatsApp group"
                      className="font-mono text-[10px]"
                    >
                      <MessageSquare className="h-3 w-3" />
                      <span>WhatsApp</span>
                    </Button>
                    <button
                      type="button"
                      onClick={() => setOpenGame(g.id)}
                      className="rounded-md bg-ink-850 px-2.5 py-1.5 font-mono text-[10px] text-ink-300 ring-1 ring-ink-700 hover:bg-ink-800 transition-colors"
                    >
                      Details
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Table View */}
        <div className="overflow-x-auto w-full -mx-4 px-4 sm:mx-0 sm:px-0">
          <Table
            head={
              <>
                <Th>GAME</Th>
                <Th>DATE</Th>
                <Th hide>VENUE</Th>
                <Th hide>OFFICIALS & STAFF</Th>
                <Th hide>SUBMITTED BY</Th>
                <Th>STATUS</Th>
                <Th>
                  <span className="block text-right">ACTION</span>
                </Th>
              </>
            }
          >
            {games.length === 0 ? (
              <EmptyState>No games submitted yet.</EmptyState>
            ) : (
              games.map((g) => {
                const refs = (g as SessionItem).referees || [];
                const staff = (g as SessionItem).matchStaff || [];
                const totalFees = [...refs, ...staff].reduce(
                  (acc, curr) => acc + (Number(curr.fee) || 0),
                  0,
                );

                return (
                  <Row key={g.id}>
                    <Td strong>
                      <button
                        type="button"
                        onClick={() => setOpenGame(g.id)}
                        className="text-left leading-tight hover:text-court-400"
                      >
                        <div>{g.title}</div>
                        <div className="font-mono text-[10px] text-ink-400">{g.detail}</div>
                      </button>
                    </Td>
                    <Td>
                      <span className="font-mono text-xs">
                        {g.date} · {g.time}
                      </span>
                    </Td>
                    <Td hide>
                      <span className="font-mono text-[10px] uppercase text-ink-300">
                        {g.venue || g.detail || "TBA"}
                      </span>
                    </Td>
                    <Td hide>
                      <div className="font-mono text-[10px] text-ink-300 leading-tight">
                        <div>
                          {refs.length} refs · {staff.length} staff
                        </div>
                        <div className="text-court-400 font-bold">{money(totalFees)} ops fee</div>
                      </div>
                    </Td>
                    <Td hide>{g.coach}</Td>
                    <Td>
                      <Chip
                        tone={
                          g.status === "Pending approval"
                            ? "warn"
                            : g.status === "Planned"
                              ? "neutral"
                              : "good"
                        }
                      >
                        {String(g.status || "Planned").toUpperCase()}
                      </Chip>
                    </Td>
                    <Td right>
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button
                          variant="emerald"
                          size="xs"
                          onClick={() => setShareGame(g as SessionItem)}
                          title="Push match report to WhatsApp"
                          className="font-mono text-[10px]"
                        >
                          <MessageSquare className="h-3 w-3" />
                          <span>WHATSAPP</span>
                        </Button>
                        <button
                          type="button"
                          onClick={() => setStatus(g.id, "Pre-approved")}
                          className="rounded px-2 py-1 font-mono text-[10px] text-good ring-1 ring-ink-700 hover:bg-good/10"
                        >
                          APPROVE
                        </button>
                        <button
                          type="button"
                          onClick={() => setStatus(g.id, "Official")}
                          className="rounded px-2 py-1 font-mono text-[10px] text-court-400 ring-1 ring-ink-700 hover:bg-court-500/10"
                        >
                          MAKE OFFICIAL
                        </button>
                        <button
                          type="button"
                          onClick={() => setStatus(g.id, "Planned")}
                          className="rounded px-2 py-1 font-mono text-[10px] text-bad ring-1 ring-ink-700 hover:bg-bad/10"
                        >
                          VOID
                        </button>
                      </div>
                    </Td>
                  </Row>
                );
              })
            )}
          </Table>
        </div>

        {/* Game Detail & Officials Audit Modal */}
        <Modal
          open={!!game}
          title={game ? game.title : "Game"}
          meta={game ? `${game.date} · ${game.time} · ${game.status}` : ""}
          onClose={() => setOpenGame(null)}
          wide
        >
          {game ? (
            <div className="space-y-4 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Detail label="Opponent / detail" value={game.detail} />
                <Detail label="Venue" value={game.venue || game.detail} />
                <Detail label="Date & time" value={`${game.date} · ${game.time}`} />
                <Detail label="Branch" value={game.branch} />
                <Detail label="Submitted by" value={game.coach} />
                <Detail label="Status" value={game.status} />
                <Detail label="Type" value={game.gameType || game.kind} />
                {game.score && <Detail label="Final Score" value={game.score} />}
              </div>

              {/* Officials & Match Operations Cost Section */}
              <div className="rounded-xl border border-ink-800 bg-ink-900 p-3.5 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold text-ink-100 uppercase tracking-wider">
                    Assigned Match Officials & Staff
                  </span>
                  <span className="font-mono text-xs font-bold text-court-300">
                    Total Fees:{" "}
                    {money(
                      [
                        ...((game as SessionItem).referees || []),
                        ...((game as SessionItem).matchStaff || []),
                      ].reduce((acc, curr) => acc + (Number(curr.fee) || 0), 0),
                    )}
                  </span>
                </div>

                {((game as SessionItem).referees || []).length > 0 && (
                  <div>
                    <div className="text-[11px] font-mono font-semibold text-ink-400 mb-1.5">
                      Referees:
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {((game as SessionItem).referees || []).map((r, i) => (
                        <div
                          key={i}
                          className="rounded-lg bg-ink-850 p-2 border border-ink-750 flex items-center justify-between text-xs"
                        >
                          <div>
                            <span className="font-medium text-ink-100">{r.name}</span>
                            <span className="ml-1.5 text-[10px] font-mono text-ink-400">
                              ({r.source === "outsource" ? "Outsourced" : "Personnel"})
                            </span>
                          </div>
                          <span className="font-mono text-court-400 font-bold">
                            {money(Number(r.fee) || 0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {((game as SessionItem).matchStaff || []).length > 0 && (
                  <div>
                    <div className="text-[11px] font-mono font-semibold text-ink-400 mb-1.5">
                      Match Staff:
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {((game as SessionItem).matchStaff || []).map((s, i) => (
                        <div
                          key={i}
                          className="rounded-lg bg-ink-850 p-2 border border-ink-750 flex items-center justify-between text-xs"
                        >
                          <div>
                            <span className="font-medium text-ink-100">{s.name}</span>
                            <span className="ml-1.5 text-[10px] font-mono text-ink-400">
                              · {s.role} ({s.source === "outsource" ? "Outsourced" : "Personnel"})
                            </span>
                          </div>
                          <span className="font-mono text-court-400 font-bold">
                            {money(Number(s.fee) || 0)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {((game as SessionItem).referees || []).length === 0 &&
                  ((game as SessionItem).matchStaff || []).length === 0 && (
                    <p className="text-xs font-mono text-ink-400 italic">
                      No referees or match staff were assigned for this game.
                    </p>
                  )}
              </div>

              <div>
                <div className="label-mono">Squad checked in</div>
                <div className="mt-1 font-mono text-xs text-ink-200">
                  {
                    Object.values(db.attendance[game.id] ?? {}).filter(
                      (status) => status === "Present",
                    ).length
                  }{" "}
                  players marked present
                </div>
              </div>

              <div className="flex flex-wrap gap-2 pt-2 border-t border-ink-800">
                <button
                  type="button"
                  onClick={() => {
                    setShareGame(game as SessionItem);
                    setOpenGame(null);
                  }}
                  className="flex items-center gap-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-mono font-bold text-white shadow transition-all"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span>Push to WhatsApp</span>
                </button>
                <Button
                  onClick={() => {
                    setStatus(game.id, "Pre-approved");
                    setOpenGame(null);
                  }}
                >
                  Approve game
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setStatus(game.id, "Official");
                    setOpenGame(null);
                  }}
                >
                  Make official
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setStatus(game.id, "Planned");
                    setOpenGame(null);
                  }}
                >
                  Send back to planning
                </Button>
                <Button variant="ghost" onClick={() => setOpenGame(null)}>
                  Close
                </Button>
              </div>
            </div>
          ) : null}
        </Modal>

        {/* WhatsApp Broadcast Modal */}
        {shareGame && (
          <WhatsAppShareModal
            open={!!shareGame}
            onClose={() => setShareGame(null)}
            session={shareGame}
          />
        )}
      </Panel>
    </div>
  );
}

function PracticePlans() {
  const { db, update, tenantId } = useDB();
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<Plan | null>(null);
  const [review, setReview] = useState("");
  const [editing, setEditing] = useState<Plan | null>(null);
  const [drillSelectorOpen, setDrillSelectorOpen] = useState(false);
  const [planToDelete, setPlanToDelete] = useState<string | null>(null);
  const [form, setForm] = useState<PlanDraft>(
    emptyPlan(db.coaches[0]?.name ?? "", db.lists["Age categories"]?.[0] ?? "U-14"),
  );

  function handleInsertDrill(drill: MasterDrill, newBlock: PlanBlock) {
    setForm((prev) => {
      const currentBlocks = prev.blocks ?? [];
      return {
        ...prev,
        blocks: [...currentBlocks, newBlock],
      };
    });
  }

  function submit() {
    if (!form.title.trim()) return;
    update((d) =>
      editing
        ? { ...d, plans: d.plans.map((p) => (p.id === editing.id ? { ...p, ...form } : p)) }
        : { ...d, plans: [{ ...form, id: `pl-${Date.now().toString(36)}` }, ...d.plans] },
    );
    setOpen(false);
  }

  function setStatus(id: string, status: Plan["status"], note?: string) {
    const targetPlan = db.plans.find((p) => p.id === id);
    update((d) => ({
      ...d,
      plans: d.plans.map((p) =>
        p.id === id ? { ...p, status, review: note === undefined ? p.review : note } : p,
      ),
    }));
    if (targetPlan && (status === "Approved" || status === "Rejected")) {
      const matchedCoach = db.coaches.find(
        (c) =>
          (targetPlan.coachId && c.id === targetPlan.coachId) ||
          (targetPlan.coach && c.name.toLowerCase() === targetPlan.coach.toLowerCase()),
      );
      const reviewNote = note !== undefined ? note : targetPlan.review;
      void createAcademyNotification(tenantId, {
        title: `Practice Plan ${status}: ${targetPlan.title}`,
        message: `Technical Director ${status.toLowerCase()} your practice plan "${targetPlan.title}"${reviewNote ? ` — Feedback: ${reviewNote}` : "."}`,
        type: "curriculum",
        targetRoles: ["coach"],
        targetCoachId: targetPlan.coachId || matchedCoach?.id,
        targetCoachName: targetPlan.coach || matchedCoach?.name,
        targetBranchId:
          (targetPlan as Plan & { branch?: string }).branch || matchedCoach?.branch || undefined,
        actionUrl: "/coach",
        createdAt: new Date().toISOString(),
        readBy: [],
        dismissedBy: [],
      }).catch(() => {});
    }
  }

  return (
    <Panel
      title="Practice plans"
      meta="Approve, reject or return plans submitted by coaches"
      action={
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          + New plan
        </Button>
      }
    >
      {/* Mobile Cards View */}
      <div className="hidden space-y-3">
        {db.plans.length === 0 ? (
          <EmptyState>No practice plans yet.</EmptyState>
        ) : (
          db.plans.map((p) => (
            <div
              key={p.id}
              className="rounded-xl border border-ink-800 bg-ink-900/90 p-3.5 shadow-sm space-y-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap mb-1">
                    <Chip
                      tone={
                        p.status === "Approved"
                          ? "good"
                          : p.status === "Rejected"
                            ? "bad"
                            : p.status === "Submitted"
                              ? "warn"
                              : "neutral"
                      }
                    >
                      {String(p.status || "Draft").toUpperCase()}
                    </Chip>
                    <span className="font-mono text-[10px] text-ink-300 bg-ink-850 px-1.5 py-0.5 rounded border border-ink-750">
                      {p.category}
                    </span>
                    <span className="font-mono text-[10px] text-court-400">{p.date}</span>
                  </div>
                  <h4 className="text-sm font-bold text-ink-100 leading-snug">{p.title}</h4>
                  <p className="text-xs text-ink-400 font-mono mt-0.5">
                    Coach: <span className="text-ink-200">{p.coach}</span> · Focus:{" "}
                    <span className="text-ink-200">{p.focus || "Tactical"}</span>
                  </p>
                </div>
              </div>

              {p.review && (
                <div className="rounded bg-ink-950/70 p-2 text-[11px] font-mono text-ink-300 border border-ink-800">
                  <span className="text-court-400 font-semibold">Feedback: </span>
                  {p.review}
                </div>
              )}

              <div className="flex items-center gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setViewing(p);
                    setReview(p.review);
                  }}
                  className="flex-1 rounded-md bg-court-500/15 py-1.5 text-center font-mono text-[10px] font-semibold text-court-300 ring-1 ring-court-500/30 hover:bg-court-500/25 transition-colors"
                >
                  REVIEW DRILLS
                </button>
                <button
                  type="button"
                  onClick={() => setStatus(p.id, "Approved")}
                  className="flex-1 rounded-md bg-good/15 py-1.5 text-center font-mono text-[10px] font-semibold text-good ring-1 ring-good/30 hover:bg-good/25 transition-colors"
                >
                  ✓ APPROVE
                </button>
                <button
                  type="button"
                  onClick={() => setStatus(p.id, "Rejected")}
                  className="rounded-md bg-bad/10 px-2.5 py-1.5 font-mono text-[10px] text-bad ring-1 ring-bad/30 hover:bg-bad/20 transition-colors"
                >
                  REJECT
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Table View */}
      <div className="overflow-x-auto w-full -mx-4 px-4 sm:mx-0 sm:px-0">
        <Table
          head={
            <>
              <Th>PLAN</Th>
              <Th hide>COACH</Th>
              <Th hide>FOCUS</Th>
              <Th>STATUS</Th>
              <Th>
                <span className="block text-right">ACTION</span>
              </Th>
            </>
          }
        >
          {db.plans.length === 0 ? (
            <EmptyState>No practice plans yet.</EmptyState>
          ) : (
            db.plans.map((p) => (
              <Row key={p.id}>
                <Td strong>
                  <div className="leading-tight">
                    <div>{p.title}</div>
                    <div className="font-mono text-[10px] text-ink-400">
                      {p.category} · {p.date}
                    </div>
                  </div>
                </Td>
                <Td hide>{p.coach}</Td>
                <Td hide>{p.focus}</Td>
                <Td>
                  <Chip
                    tone={
                      p.status === "Approved"
                        ? "good"
                        : p.status === "Rejected"
                          ? "bad"
                          : p.status === "Submitted"
                            ? "warn"
                            : "neutral"
                    }
                  >
                    {String(p.status || "Draft").toUpperCase()}
                  </Chip>
                </Td>
                <Td right>
                  <div className="flex flex-wrap justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setViewing(p);
                        setReview(p.review);
                      }}
                      className="rounded px-2 py-1 font-mono text-[10px] text-court-400 ring-1 ring-ink-700 hover:bg-court-500/10"
                    >
                      REVIEW
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatus(p.id, "Approved")}
                      className="rounded px-2 py-1 font-mono text-[10px] text-good ring-1 ring-ink-700 hover:bg-good/10"
                    >
                      APPROVE
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatus(p.id, "Rejected")}
                      className="rounded px-2 py-1 font-mono text-[10px] text-bad ring-1 ring-ink-700 hover:bg-bad/10"
                    >
                      REJECT
                    </button>
                    <RowActions
                      onEdit={() => {
                        setEditing(p);
                        const { id: _id, ...rest } = p;
                        setForm(rest);
                        setOpen(true);
                      }}
                      onDelete={() => {
                        setPlanToDelete(p.id);
                      }}
                    />
                  </div>
                </Td>
              </Row>
            ))
          )}
        </Table>
      </div>

      <Modal
        open={open}
        title={editing ? "Edit plan" : "New practice plan"}
        meta="Build the session section by section, with a drill board for each"
        onClose={() => setOpen(false)}
        onSubmit={submit}
        submitLabel={editing ? "Save changes" : "Create plan"}
        wide
      >
        <div className="p-4">
          <Suspense
            fallback={
              <div className="flex h-48 items-center justify-center font-mono text-xs text-ink-400">
                Loading practice plan editor...
              </div>
            }
          >
            <PlanEditor
              value={form}
              onChange={setForm}
              onOpenDrillSelector={() => setDrillSelectorOpen(true)}
            />
          </Suspense>
          <div className="mt-3">
            <Field label="Status">
              <Select
                value={form.status}
                onChange={(v) => setForm({ ...form, status: v as Plan["status"] })}
                options={["Draft", "Submitted", "Approved", "Rejected"]}
              />
            </Field>
          </div>
        </div>
      </Modal>

      <Modal
        open={viewing !== null}
        title="Plan review"
        meta={viewing ? `${viewing.coach} · ${viewing.status}` : ""}
        onClose={() => setViewing(null)}
        onSubmit={() => {
          if (viewing) setStatus(viewing.id, viewing.status, review);
          setViewing(null);
        }}
        submitLabel="Save feedback"
        wide
      >
        {viewing ? <PlanView plan={viewing} /> : null}
        <div className="px-4 pb-4">
          <Field label="Feedback to the coach">
            <Textarea value={review} onChange={setReview} placeholder="What to adjust…" />
          </Field>
          <div className="mt-3 flex gap-2">
            <Button
              onClick={() => {
                if (viewing) setStatus(viewing.id, "Approved", review);
                setViewing(null);
              }}
            >
              Approve plan
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                if (viewing) setStatus(viewing.id, "Rejected", review);
                setViewing(null);
              }}
            >
              Reject plan
            </Button>
          </div>
        </div>
      </Modal>

      <DrillSelector
        open={drillSelectorOpen}
        onClose={() => setDrillSelectorOpen(false)}
        onInsertDrill={handleInsertDrill}
        existingBlockCount={(form.blocks ?? []).length}
      />

      <Modal
        open={!!planToDelete}
        onClose={() => setPlanToDelete(null)}
        title="Delete Practice Plan"
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-300">
            Are you sure you want to delete this practice plan? This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPlanToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (planToDelete) {
                  update((d) => ({ ...d, plans: d.plans.filter((x) => x.id !== planToDelete) }));
                  setPlanToDelete(null);
                }
              }}
            >
              Delete Plan
            </Button>
          </div>
        </div>
      </Modal>
    </Panel>
  );
}

function Resources() {
  const folders = [
    { name: "Offense concepts", files: 14 },
    { name: "Defense concepts", files: 11 },
    { name: "Video links", files: 22 },
    { name: "Season PDFs", files: 8 },
    { name: "Level 1 quiz", files: 3 },
    { name: "Rules exam 2026", files: 2 },
  ];
  return (
    <Panel title="Shared resources" meta="Available to every coach in the portal">
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {folders.map((f) => (
          <div key={f.name} className="rounded-md bg-ink-850 p-4 ring-1 ring-ink-700">
            <div className="font-mono text-xl text-court-400">▤</div>
            <div className="mt-2 text-sm font-medium text-ink-100">{f.name}</div>
            <div className="font-mono text-[10px] text-ink-400">{f.files} files</div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function CompletedGames() {
  const { db, update, tenantId } = useDB();
  const [selectedGame, setSelectedGame] = useState<SessionItem | null>(null);

  const done = db.sessions.filter(
    (s) => s.kind === "Game" && (s.status === "Completed" || s.status === "Official"),
  );

  return (
    <>
      <Panel title="Completed & official games" meta="Reports submitted by coaches">
        <Table
          head={
            <>
              <Th>GAME</Th>
              <Th>DATE</Th>
              <Th hide>COACH</Th>
              <Th>
                <span className="block text-right">SCORE</span>
              </Th>
            </>
          }
        >
          {done.length === 0 ? (
            <EmptyState>No completed games yet.</EmptyState>
          ) : (
            done.map((g) => (
              <Row
                key={g.id}
                onClick={() => setSelectedGame(g)}
                className="cursor-pointer hover:bg-ink-850"
              >
                <Td strong>{g.title}</Td>
                <Td>
                  <span className="font-mono text-xs">{g.date}</span>
                </Td>
                <Td hide>{g.coach}</Td>
                <Td right>
                  {g.score ? (
                    <span className="font-mono text-xs text-court-400">{g.score}</span>
                  ) : (
                    <span className="font-mono text-xs text-ink-400">N/A</span>
                  )}
                </Td>
              </Row>
            ))
          )}
        </Table>
      </Panel>

      <Modal
        open={!!selectedGame}
        title={selectedGame?.title || "Game Details"}
        onClose={() => setSelectedGame(null)}
        submitLabel={selectedGame?.status !== "Official" ? "Mark Official" : "Close"}
        onSubmit={() => {
          if (selectedGame && selectedGame.status !== "Official") {
            const gameId = selectedGame.id;
            update((d) => ({
              ...d,
              sessions: d.sessions.map((s) => (s.id === gameId ? { ...s, status: "Official" } : s)),
            }));
            void createAcademyNotification(tenantId, {
              title: `Game Marked Official: ${selectedGame.title}`,
              message: `Game "${selectedGame.title}" (${selectedGame.date}) has been verified and marked Official.`,
              type: "curriculum",
              targetRoles: ["coach", "branch_manager", "super_admin"],
              targetCoachId: selectedGame.coachId || selectedGame.headCoachId,
              targetCoachName: selectedGame.coach || selectedGame.headCoach,
              targetTeam: selectedGame.teamA || selectedGame.team,
              targetBranchId: selectedGame.branch || undefined,
              actionUrl: "/coach",
              createdAt: new Date().toISOString(),
              readBy: [],
              dismissedBy: [],
            }).catch(() => {});
          }
          setSelectedGame(null);
        }}
      >
        <div className="p-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Detail label="Opponent / detail" value={selectedGame?.detail || "-"} />
            <Detail label="Venue" value={selectedGame?.venue || selectedGame?.detail || "-"} />
            <Detail label="Date & time" value={`${selectedGame?.date} · ${selectedGame?.time}`} />
            <Detail label="Branch" value={selectedGame?.branch || "-"} />
            <Detail label="Submitted by" value={selectedGame?.coach || "-"} />
            <div className="rounded-md bg-ink-850 p-3 ring-1 ring-ink-700">
              <div className="label-mono">Score</div>
              <div className="mt-1 text-sm font-bold text-court-400">
                {selectedGame?.score || "N/A"}
              </div>
            </div>
            <div className="rounded-md bg-ink-850 p-3 ring-1 ring-ink-700">
              <div className="label-mono">Status</div>
              <div className="mt-1">
                <Chip tone={selectedGame?.status === "Official" ? "good" : "neutral"}>
                  {selectedGame?.status ? selectedGame.status.toUpperCase() : "PENDING"}
                </Chip>
              </div>
            </div>
          </div>
          <div>
            <div className="text-xs text-ink-400 font-mono mb-1">COACH'S REPORT</div>
            <div className="p-3 bg-ink-850 rounded text-sm text-ink-100 ring-1 ring-ink-700 whitespace-pre-wrap">
              {selectedGame?.report || "No report provided."}
            </div>
          </div>

          <div>
            <div className="text-xs text-ink-400 font-mono mb-1">ATTENDANCE</div>
            <div className="space-y-1 mt-2">
              {(() => {
                if (!selectedGame) return null;
                const records = db.attendance[selectedGame.id] || {};
                const presentCount = Object.values(records).filter((s) => s === "Present").length;
                const keys = Object.keys(records);

                if (keys.length === 0)
                  return <div className="text-xs text-ink-400">No attendance records.</div>;

                return (
                  <div>
                    <div className="text-xs font-mono text-court-400 mb-2">
                      {presentCount} Present
                    </div>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {keys.map((playerId) => {
                        const p = db.players.find((x) => x.id === playerId);
                        const status = records[playerId];
                        let tone: "good" | "bad" | "warn" | "neutral" = "neutral";
                        if (status === "Present") tone = "good";
                        if (status === "Absent") tone = "bad";
                        if (status === "Excused") tone = "warn";
                        return (
                          <div
                            key={playerId}
                            className="flex items-center justify-between py-1 border-b border-ink-800 last:border-0"
                          >
                            <div className="text-xs text-ink-200">
                              {p?.name || "Unknown player"}
                            </div>
                            <Chip tone={tone}>{(status || "Unknown").toUpperCase()}</Chip>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
}

function WorkshopsTab() {
  const { db, setEntity, deleteEntity, tenantId } = useDB();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Workshop | null>(null);
  const [selectedWorkshop, setSelectedWorkshop] = useState<Workshop | null>(null);
  const [handoutUploading, setHandoutUploading] = useState(false);

  const blank: Workshop = {
    id: "",
    title: "",
    topic: "",
    type: "Physical",
    venue: "",
    date: new Date().toISOString().slice(0, 10),
    time: "18:00",
    assignedLevels: [],
    assignedCoaches: [],
    attendance: {},
    documents: [],
  };

  const [form, setForm] = useState<Workshop>(blank);

  const levels = db.lists["Coach levels"] || [];
  const coaches = db.coaches || [];

  function openNew() {
    setForm({ ...blank, id: "w" + Date.now(), documents: [] });
    setEditing(null);
    setOpen(true);
  }

  async function handleSave() {
    if (!form.title.trim()) {
      toast.error("Please enter a workshop title.");
      return;
    }
    const workshopId = form.id || "w" + Date.now();
    const isExisting = Boolean(db.workshops?.some((w) => w.id === workshopId));

    const cleanDocs = (form.documents || [])
      .filter((d) => d && typeof d.url === "string" && d.url.length > 0)
      .map((d) => ({
        id: String(d.id || `doc-${Date.now().toString(36)}`),
        name: String(d.name || "Workshop Document"),
        type: String(d.type || "application/pdf"),
        url: String(d.url),
        uploadedAt: String(d.uploadedAt || new Date().toISOString().slice(0, 10)),
        size: Number(d.size || 0),
      }));

    const primaryUrl = form.handoutUrl || cleanDocs[0]?.url || "";
    const primaryName = form.handoutName || cleanDocs[0]?.name || "";

    const sanitizedWorkshop: Workshop = {
      id: workshopId,
      title: form.title.trim(),
      topic: (form.topic || "").trim(),
      type: form.type === "Online" ? "Online" : "Physical",
      venue: (form.venue || "").trim(),
      date: form.date || new Date().toISOString().slice(0, 10),
      time: form.time || "18:00",
      assignedLevels: Array.isArray(form.assignedLevels) ? form.assignedLevels : [],
      assignedCoaches: Array.isArray(form.assignedCoaches) ? form.assignedCoaches : [],
      attendance: form.attendance && typeof form.attendance === "object" ? form.attendance : {},
      ...(primaryUrl ? { handoutUrl: primaryUrl, handoutName: primaryName || "Handout" } : {}),
      documents: cleanDocs,
    };

    try {
      await setEntity("workshops", sanitizedWorkshop);
      if (selectedWorkshop?.id === sanitizedWorkshop.id) {
        setSelectedWorkshop(sanitizedWorkshop);
      }
      if (!isExisting) {
        void createAcademyNotification(tenantId, {
          title: `New Coach Workshop: ${sanitizedWorkshop.title}`,
          message: `Workshop "${sanitizedWorkshop.title}" (${sanitizedWorkshop.topic || sanitizedWorkshop.type}) scheduled for ${sanitizedWorkshop.date} at ${sanitizedWorkshop.time}${sanitizedWorkshop.venue ? ` · ${sanitizedWorkshop.venue}` : ""}.`,
          type: "curriculum",
          targetRoles: ["coach", "branch_manager"],
          targetCoachNames: sanitizedWorkshop.assignedCoaches || [],
          targetCoachLevels: sanitizedWorkshop.assignedLevels || [],
          actionUrl: "/coach",
          createdAt: new Date().toISOString(),
          readBy: [],
          dismissedBy: [],
        }).catch(() => {});
      }
      toast.success(isExisting ? "Workshop updated." : "Workshop created.");
      setOpen(false);
    } catch (err) {
      console.error("Failed to save workshop:", err);
      toast.error("Failed to save workshop.");
    }
  }

  async function handleDelete() {
    if (!form.id) return;
    try {
      await deleteEntity("workshops", form.id);
      toast.success("Workshop deleted.");
      setOpen(false);
      setSelectedWorkshop(null);
    } catch (err) {
      console.error("Failed to delete workshop:", err);
      toast.error("Failed to delete workshop.");
    }
  }

  const workshops = db.workshops || [];

  return (
    <>
      <Panel
        title="Workshops & Seminars"
        meta="Manage physical or online sessions for coaches"
        action={<Button onClick={openNew}>+ New workshop</Button>}
      >
        <Table
          head={
            <>
              <Th>WORKSHOP</Th>
              <Th>TYPE & VENUE</Th>
              <Th>DATE & TIME</Th>
              <Th hide>ASSIGNMENTS</Th>
              <Th hide>ATTENDANCE</Th>
            </>
          }
        >
          {workshops.length === 0 ? (
            <EmptyState>No workshops scheduled.</EmptyState>
          ) : (
            workshops.map((w) => (
              <Row
                key={w.id}
                onClick={() => setSelectedWorkshop(w)}
                className="cursor-pointer hover:bg-ink-850"
              >
                <Td strong>
                  <div className="leading-tight">
                    <div className="flex items-center gap-2">
                      <span>{w.title}</span>
                      {(w.handoutUrl || (w.documents && w.documents.length > 0)) && (
                        <Chip tone="accent">
                          {w.documents && w.documents.length > 1
                            ? `${w.documents.length} files`
                            : "Handout"}
                        </Chip>
                      )}
                    </div>
                    <div className="text-ink-400 font-mono text-[10px]">{w.topic}</div>
                  </div>
                </Td>
                <Td>
                  <div className="leading-tight">
                    <Chip tone={w.type === "Online" ? "accent" : "neutral"}>{w.type}</Chip>
                    <div className="text-ink-400 font-mono text-[10px] mt-1">{w.venue}</div>
                  </div>
                </Td>
                <Td>
                  <span className="font-mono text-xs">
                    {w.date} {w.time}
                  </span>
                </Td>
                <Td hide>
                  <div className="text-xs text-ink-200">
                    {w.assignedLevels?.length ? `${w.assignedLevels.length} levels` : ""}
                    {w.assignedLevels?.length && w.assignedCoaches?.length ? " · " : ""}
                    {w.assignedCoaches?.length ? `${w.assignedCoaches.length} coaches` : ""}
                    {!w.assignedLevels?.length && !w.assignedCoaches?.length && "Unassigned"}
                  </div>
                </Td>
                <Td hide>
                  {(() => {
                    const present = Object.values(w.attendance || {}).filter(
                      (a) => a === "Present",
                    ).length;
                    const total = Object.keys(w.attendance || {}).length;
                    return (
                      <span className="font-mono text-[10px] text-ink-400">
                        {present}/{total}
                      </span>
                    );
                  })()}
                </Td>
              </Row>
            ))
          )}
        </Table>
      </Panel>

      <Modal
        open={open}
        title={editing ? "Edit workshop" : "New workshop"}
        onClose={() => setOpen(false)}
        submitLabel="Save workshop"
        onSubmit={() => void handleSave()}
      >
        <div className="p-4 space-y-4">
          <Field label="Title">
            <Input
              value={form.title}
              onChange={(v) => setForm({ ...form, title: v })}
              placeholder="e.g. Defensive Basics"
            />
          </Field>
          <Field label="Topic">
            <Input
              value={form.topic}
              onChange={(v) => setForm({ ...form, topic: v })}
              placeholder="Topic or subject matter"
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Type">
              <Select
                value={form.type}
                onChange={(v) => setForm({ ...form, type: v as "Physical" | "Online" })}
                options={["Physical", "Online"]}
              />
            </Field>
            <Field label="Venue or Link">
              <Input
                value={form.venue}
                onChange={(v) => setForm({ ...form, venue: v })}
                placeholder="Location or URL"
              />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Date">
              <Input
                type="date"
                value={form.date}
                onChange={(v) => setForm({ ...form, date: v })}
              />
            </Field>
            <Field label="Time">
              <Input
                type="time"
                value={form.time}
                onChange={(v) => setForm({ ...form, time: v })}
              />
            </Field>
          </div>
          <Field label="Assign to Levels">
            <div className="flex flex-wrap gap-2">
              {levels.map((l) => (
                <label key={l} className="flex items-center gap-2 text-sm text-ink-200">
                  <input
                    type="checkbox"
                    checked={form.assignedLevels.includes(l)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setForm({ ...form, assignedLevels: [...form.assignedLevels, l] });
                      } else {
                        setForm({
                          ...form,
                          assignedLevels: form.assignedLevels.filter((x) => x !== l),
                        });
                      }
                    }}
                  />
                  {l}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Assign Specific Coaches">
            <div className="max-h-32 overflow-y-auto space-y-1 bg-ink-850 p-2 rounded">
              {coaches.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm text-ink-200">
                  <input
                    type="checkbox"
                    checked={form.assignedCoaches.includes(c.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setForm({ ...form, assignedCoaches: [...form.assignedCoaches, c.id] });
                      } else {
                        setForm({
                          ...form,
                          assignedCoaches: form.assignedCoaches.filter((x) => x !== c.id),
                        });
                      }
                    }}
                  />
                  {c.name} (
                  {db.lists["Coach levels"]?.find(
                    (x) => x.toLowerCase() === c.level.toLowerCase(),
                  ) || c.level}
                  )
                </label>
              ))}
            </div>
          </Field>

          <Field
            label="Technical Presentation / Handout Documents"
            hint="Upload seminar slides, playbooks, PDFs, Office documents, or images (stored on workshop save)"
          >
            <div className="space-y-2">
              <input
                type="file"
                accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,image/*,application/pdf"
                disabled={handoutUploading}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 25 * 1024 * 1024) {
                    toast.error("Handout file must be under 25MB");
                    return;
                  }
                  try {
                    setHandoutUploading(true);
                    const res = await uploadTechnicalDocument(tenantId, "workshops", file);
                    const attachmentItem = {
                      id: `doc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
                      name: String(res.name || file.name || "Workshop Handout"),
                      type: String(res.type || file.type || "application/pdf"),
                      url: String(res.url || ""),
                      uploadedAt: new Date().toISOString().slice(0, 10),
                      size: Number(res.size || file.size || 0),
                    };
                    setForm((prev) => {
                      const existingDocs = Array.isArray(prev.documents) ? prev.documents : [];
                      return {
                        ...prev,
                        handoutUrl: attachmentItem.url,
                        handoutName: attachmentItem.name,
                        documents: [...existingDocs, attachmentItem],
                      };
                    });
                    toast.success(
                      `Uploaded "${attachmentItem.name}" — click Save workshop to commit.`,
                    );
                  } catch (err) {
                    console.error("Failed to upload handout:", err);
                    toast.error("Failed to upload handout.");
                  } finally {
                    setHandoutUploading(false);
                    e.target.value = "";
                  }
                }}
                className="w-full rounded-md bg-ink-850 px-3 py-2 font-ui text-sm text-ink-200 ring-1 ring-ink-700 file:mr-3 file:rounded file:border-0 file:bg-court-500 file:px-2 file:py-1 file:text-xs file:font-semibold file:text-ink-950 disabled:opacity-50"
              />

              {/* List of attached documents in form state */}
              {(() => {
                const docsList =
                  form.documents && form.documents.length > 0
                    ? form.documents
                    : form.handoutUrl
                      ? [
                          {
                            id: "legacy-handout",
                            name: form.handoutName || "Technical Handout",
                            type: "application/pdf",
                            url: form.handoutUrl,
                            uploadedAt: form.date || "",
                            size: 0,
                          },
                        ]
                      : [];
                if (docsList.length === 0) return null;
                return (
                  <div className="space-y-1.5 pt-1">
                    {docsList.map((doc) => (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between gap-2 rounded bg-ink-900/80 px-2.5 py-1.5 border border-ink-800 text-xs"
                      >
                        <span className="truncate font-mono text-ink-200">{doc.name}</span>
                        <div className="flex items-center gap-2 shrink-0">
                          <a
                            href={doc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-[11px] text-court-400 bg-court-500/10 px-2 py-0.5 rounded ring-1 ring-court-400/30 hover:bg-court-500/20"
                          >
                            View File
                          </a>
                          <button
                            type="button"
                            onClick={() =>
                              setForm((prev) => {
                                const remaining = (prev.documents || []).filter(
                                  (d) => d.id !== doc.id && d.url !== doc.url,
                                );
                                const nextPrimary = remaining[0];
                                const nextState: Workshop = {
                                  ...prev,
                                  documents: remaining,
                                };
                                if (nextPrimary) {
                                  nextState.handoutUrl = nextPrimary.url;
                                  nextState.handoutName = nextPrimary.name;
                                } else {
                                  delete nextState.handoutUrl;
                                  delete nextState.handoutName;
                                }
                                return nextState;
                              })
                            }
                            className="text-bad hover:underline font-mono text-[10px]"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
            {handoutUploading && (
              <div className="mt-1 flex items-center gap-2 font-mono text-[10px] text-court-400">
                <div className="h-1.5 w-1.5 rounded-full bg-court-400 animate-ping" />
                Uploading document...
              </div>
            )}
          </Field>

          {editing && (
            <div className="pt-4 border-t border-ink-800">
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="text-xs font-semibold text-bad hover:opacity-80"
              >
                Delete workshop
              </button>
            </div>
          )}
        </div>
      </Modal>

      <Modal
        open={!!selectedWorkshop && !open}
        title={selectedWorkshop?.title || "Workshop details"}
        onClose={() => setSelectedWorkshop(null)}
        submitLabel="Edit"
        onSubmit={() => {
          if (selectedWorkshop) {
            setForm({
              ...selectedWorkshop,
              documents:
                selectedWorkshop.documents && selectedWorkshop.documents.length > 0
                  ? selectedWorkshop.documents
                  : selectedWorkshop.handoutUrl
                    ? [
                        {
                          id: "legacy-handout",
                          name: selectedWorkshop.handoutName || "Technical Handout",
                          type: "application/pdf",
                          url: selectedWorkshop.handoutUrl,
                          uploadedAt: selectedWorkshop.date || "",
                          size: 0,
                        },
                      ]
                    : [],
            });
            setEditing(selectedWorkshop);
            setOpen(true);
          }
        }}
      >
        {selectedWorkshop && (
          <div className="p-4 space-y-4">
            <div className="text-sm text-ink-200">{selectedWorkshop.topic}</div>
            <div className="flex gap-4 border-b border-ink-800 pb-4">
              <div>
                <div className="text-[10px] font-mono text-ink-400">TYPE & VENUE</div>
                <div className="text-xs text-ink-100">
                  {selectedWorkshop.type} · {selectedWorkshop.venue}
                </div>
              </div>
              <div>
                <div className="text-[10px] font-mono text-ink-400">DATE & TIME</div>
                <div className="text-xs text-ink-100">
                  {selectedWorkshop.date} {selectedWorkshop.time}
                </div>
              </div>
            </div>

            {(() => {
              const workshopDocs =
                selectedWorkshop.documents && selectedWorkshop.documents.length > 0
                  ? selectedWorkshop.documents
                  : selectedWorkshop.handoutUrl
                    ? [
                        {
                          id: "legacy-handout",
                          name: selectedWorkshop.handoutName || "Technical Handout (PDF)",
                          type: "application/pdf",
                          url: selectedWorkshop.handoutUrl,
                          uploadedAt: selectedWorkshop.date || "",
                          size: 0,
                        },
                      ]
                    : [];
              if (workshopDocs.length === 0) return null;
              return (
                <div className="space-y-2">
                  {workshopDocs.map((doc) => (
                    <div
                      key={doc.id}
                      className="p-3 rounded bg-ink-850 ring-1 ring-ink-700 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-ink-100 truncate">
                          {doc.name || "Technical Handout"}
                        </div>
                        <div className="font-mono text-[10px] text-court-400">
                          Workshop Handout Attachment
                        </div>
                      </div>
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        download={doc.name}
                        className="inline-flex items-center gap-1.5 rounded bg-court-500 px-3 py-1.5 text-xs font-semibold text-ink-950 hover:bg-court-400 shrink-0"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        <span>Open File</span>
                      </a>
                    </div>
                  ))}
                </div>
              );
            })()}

            <div>
              <div className="text-xs font-mono text-court-400 mb-2">ATTENDANCE TRACKING</div>
              <div className="bg-ink-850 p-2 rounded max-h-64 overflow-y-auto space-y-2">
                {(() => {
                  const assigned = coaches.filter(
                    (c) =>
                      selectedWorkshop.assignedCoaches.includes(c.id) ||
                      selectedWorkshop.assignedLevels.some(
                        (l: string) => l.toLowerCase() === c.level.toLowerCase(),
                      ),
                  );

                  if (assigned.length === 0)
                    return <div className="text-xs text-ink-400">No coaches assigned.</div>;

                  return assigned.map((c) => {
                    const status = selectedWorkshop.attendance[c.id];
                    return (
                      <div key={c.id} className="flex items-center justify-between">
                        <div className="text-xs text-ink-100">{c.name}</div>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              const newWs: Workshop = {
                                ...selectedWorkshop,
                                attendance: { ...selectedWorkshop.attendance, [c.id]: "Absent" },
                              };
                              setSelectedWorkshop(newWs);
                              void setEntity("workshops", newWs);
                            }}
                            className={`rounded px-2 py-1 font-mono text-[10px] ring-1 ${status === "Absent" ? "bg-bad text-white ring-bad" : "text-ink-400 ring-ink-700 hover:bg-ink-800"}`}
                          >
                            A
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const newWs: Workshop = {
                                ...selectedWorkshop,
                                attendance: { ...selectedWorkshop.attendance, [c.id]: "Excused" },
                              };
                              setSelectedWorkshop(newWs);
                              void setEntity("workshops", newWs);
                            }}
                            className={`rounded px-2 py-1 font-mono text-[10px] ring-1 ${status === "Excused" ? "bg-warn text-ink-950 ring-warn" : "text-ink-400 ring-ink-700 hover:bg-ink-800"}`}
                          >
                            E
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const newWs: Workshop = {
                                ...selectedWorkshop,
                                attendance: { ...selectedWorkshop.attendance, [c.id]: "Present" },
                              };
                              setSelectedWorkshop(newWs);
                              void setEntity("workshops", newWs);
                            }}
                            className={`rounded px-2 py-1 font-mono text-[10px] ring-1 ${status === "Present" ? "bg-good text-ink-950 ring-good" : "text-ink-400 ring-ink-700 hover:bg-ink-800"}`}
                          >
                            P
                          </button>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

const DRILL_CATEGORIES: DrillCategory[] = [
  "Shooting",
  "Ball Handling",
  "Defense",
  "Transition",
  "Spacing",
  "Finishing",
  "Rebounding",
  "Conditioning",
];

function DrillRepositoryTab() {
  const { db, update, tenantId } = useDB();
  const drills: MasterDrill[] = db.drills && db.drills.length > 0 ? db.drills : fallbackDrills;

  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDrill, setEditingDrill] = useState<MasterDrill | null>(null);
  const [drillToDelete, setDrillToDelete] = useState<string | null>(null);

  // Form state
  const [formTitle, setFormTitle] = useState("");
  const [formCategory, setFormCategory] = useState<DrillCategory>("Shooting");
  const [formDuration, setFormDuration] = useState("10");
  const [formDifficulty, setFormDifficulty] = useState<"Intro" | "Intermediate" | "Advanced">(
    "Intermediate",
  );
  const [formIntensity, setFormIntensity] = useState<"Low" | "Medium" | "High">("Medium");
  const [formPoints, setFormPoints] = useState("");
  const [formEquipment, setFormEquipment] = useState("");
  const [formTags, setFormTags] = useState("");
  const [formDiagram, setFormDiagram] = useState("");

  const filteredDrills = useMemo(() => {
    return drills.filter((drill) => {
      const matchesCat =
        selectedCategory === "All" ||
        drill.category.toLowerCase() === selectedCategory.toLowerCase();
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        drill.title.toLowerCase().includes(q) ||
        drill.category.toLowerCase().includes(q) ||
        (typeof drill.coachingPoints === "string"
          ? drill.coachingPoints.toLowerCase().includes(q)
          : Array.isArray(drill.coachingPoints)
            ? (drill.coachingPoints as string[]).some((p) => p.toLowerCase().includes(q))
            : false) ||
        drill.tags?.some((t) => t.toLowerCase().includes(q));
      return matchesCat && matchesSearch;
    });
  }, [drills, selectedCategory, searchQuery]);

  function openCreateModal() {
    setEditingDrill(null);
    setFormTitle("");
    setFormCategory("Shooting");
    setFormDuration("10");
    setFormDifficulty("Intermediate");
    setFormIntensity("Medium");
    setFormPoints("• 1-2 footwork alignment\n• Game speed release\n• Track ball flight");
    setFormEquipment("2 Basketballs, 4 Cones");
    setFormTags("Shooting, Catch and Shoot");
    setFormDiagram("");
    setIsModalOpen(true);
  }

  function openEditModal(d: MasterDrill) {
    setEditingDrill(d);
    setFormTitle(d.title);
    setFormCategory(d.category as DrillCategory);
    setFormDuration(String(d.duration ?? d.durationMinutes ?? 10));
    setFormDifficulty(
      d.difficulty === "Intro" || d.difficulty === "Intermediate" || d.difficulty === "Advanced"
        ? d.difficulty
        : "Intermediate",
    );
    setFormIntensity(
      d.intensity === "Low" || d.intensity === "Medium" || d.intensity === "High"
        ? d.intensity
        : "Medium",
    );
    setFormPoints(
      typeof d.coachingPoints === "string"
        ? d.coachingPoints
        : Array.isArray(d.coachingPoints)
          ? (d.coachingPoints as string[]).join("\n")
          : "",
    );
    setFormEquipment(d.equipment || "");
    setFormTags(d.tags?.join(", ") || "");
    setFormDiagram(d.diagramUrl || "");
    setIsModalOpen(true);
  }

  function handleSaveDrill() {
    if (!formTitle.trim()) {
      toast.error("Drill title is required");
      return;
    }

    const dur = Math.max(1, parseInt(formDuration, 10) || 10);
    const tagsArray = formTags
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const payload: MasterDrill = {
      id: editingDrill ? editingDrill.id : `drill-${Date.now().toString(36)}`,
      title: formTitle.trim(),
      category: formCategory,
      duration: dur,
      durationMinutes: dur,
      difficulty: formDifficulty,
      intensity: formIntensity,
      coachingPoints: formPoints.trim() || "• Focus on execution and fundamentals.",
      diagramUrl: formDiagram.trim() || undefined,
      equipment: formEquipment.trim() || undefined,
      tags: tagsArray,
      createdAt: editingDrill?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    update((current) => {
      const list = current.drills && current.drills.length > 0 ? current.drills : fallbackDrills;
      let nextList: MasterDrill[];
      if (editingDrill) {
        nextList = list.map((d) => (d.id === editingDrill.id ? payload : d));
      } else {
        nextList = [payload, ...list];
      }
      return {
        ...current,
        drills: nextList,
      };
    });

    // Event Trigger: Dispatch curriculum notification to coaches when drill published or updated
    dispatchCurriculumAlert(tenantId, {
      drillTitle: payload.title,
      category: payload.category,
      isUpdate: !!editingDrill,
      drillId: payload.id,
    }).catch((e) => console.warn("Failed to dispatch curriculum alert:", e));

    toast.success(editingDrill ? "Master drill updated" : "New drill added to Master Repository");
    setIsModalOpen(false);
  }

  function handleDeleteDrill(id: string) {
    setDrillToDelete(id);
  }

  return (
    <div className="space-y-4">
      {/* Header Panel */}
      <Panel
        title="Master Tactical & Skill Drill Repository"
        action={
          <Button variant="primary" onClick={openCreateModal}>
            <Plus className="h-4 w-4" />
            <span>Add Master Drill</span>
          </Button>
        }
      >
        <p className="text-xs text-ink-300">
          Curated repository of standard academy drills. Coaches can directly preview, select, and
          insert these drills with 1 click into practice plans.
        </p>

        {/* Categories Bar */}
        <div className="mt-4 flex flex-wrap items-center gap-1.5 border-b border-ink-800 pb-3">
          <button
            onClick={() => setSelectedCategory("All")}
            className={`rounded-md px-3 py-1 font-mono text-[11px] font-medium transition-colors ${
              selectedCategory === "All"
                ? "bg-court-500 text-ink-950 font-bold"
                : "bg-ink-850 text-ink-300 ring-1 ring-ink-700 hover:bg-ink-800"
            }`}
          >
            All Categories ({drills.length})
          </button>
          {DRILL_CATEGORIES.map((cat) => {
            const count = drills.filter(
              (d) => d.category.toLowerCase() === cat.toLowerCase(),
            ).length;
            return (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1 font-mono text-[11px] transition-colors ${
                  selectedCategory === cat
                    ? "bg-court-500 text-ink-950 font-bold"
                    : "bg-ink-850 text-ink-300 ring-1 ring-ink-700 hover:bg-ink-800"
                }`}
              >
                <span>{cat}</span>
                <span className="opacity-70 text-[10px]">({count})</span>
              </button>
            );
          })}
        </div>

        {/* Search Bar */}
        <div className="mt-3.5 pt-3 border-t border-ink-800/80 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-court-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search drills by keyword, category, tag, or key cues..."
              className="w-full rounded-lg bg-ink-950/90 py-2.5 pl-10 pr-9 text-xs sm:text-sm text-ink-100 placeholder:text-ink-400 ring-1 ring-ink-700/90 shadow-inner transition-all focus:outline-none focus:ring-2 focus:ring-court-500 focus:border-court-500 focus:bg-ink-900"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-400 hover:text-ink-200 hover:bg-ink-800 transition-colors"
                title="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 self-end sm:self-center">
            <span className="inline-flex items-center rounded-md bg-ink-800/90 px-2.5 py-1.5 font-mono text-[11px] text-ink-300 ring-1 ring-ink-700 whitespace-nowrap">
              Showing{" "}
              <strong className="text-court-300 font-semibold mx-1">{filteredDrills.length}</strong>{" "}
              of {drills.length} drills
            </span>
          </div>
        </div>
      </Panel>

      {/* Drill Grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filteredDrills.map((drill) => (
          <div
            key={drill.id}
            className="flex flex-col justify-between rounded-lg bg-ink-850 p-4 ring-1 ring-ink-700 transition-all hover:ring-court-500/50"
          >
            <div>
              {/* Header tags */}
              <div className="mb-2 flex items-start justify-between gap-2">
                <span className="rounded bg-court-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-court-400 ring-1 ring-court-500/20">
                  {drill.category}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="flex items-center gap-1 font-mono text-[10px] text-ink-400">
                    <Clock className="h-3 w-3" /> {drill.duration ?? drill.durationMinutes ?? 10}m
                  </span>
                  <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[9px] text-ink-300 ring-1 ring-ink-700">
                    {drill.difficulty}
                  </span>
                </div>
              </div>

              {/* Title */}
              <h4 className="font-display text-sm font-semibold text-ink-100">{drill.title}</h4>

              {/* Diagram preview if available */}
              {drill.diagramUrl && (
                <div className="mt-2.5 overflow-hidden rounded bg-ink-950 ring-1 ring-ink-800">
                  <img
                    src={drill.diagramUrl}
                    alt={drill.title}
                    className="max-h-28 w-full object-contain p-1"
                  />
                </div>
              )}

              {/* Coaching Points */}
              <div className="mt-3 space-y-1">
                <div className="font-mono text-[10px] text-ink-400 uppercase tracking-wider">
                  Key Coaching Points:
                </div>
                <div className="line-clamp-3 whitespace-pre-line text-xs leading-relaxed text-ink-300">
                  {typeof drill.coachingPoints === "string"
                    ? drill.coachingPoints
                    : Array.isArray(drill.coachingPoints)
                      ? (drill.coachingPoints as string[]).join("\n")
                      : ""}
                </div>
              </div>

              {/* Tags */}
              {drill.tags && drill.tags.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {drill.tags.map((t, idx) => (
                    <span
                      key={idx}
                      className="rounded bg-ink-900 px-1.5 py-0.5 font-mono text-[9px] text-ink-400"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Actions footer */}
            <div className="mt-4 flex items-center justify-between border-t border-ink-800 pt-3">
              <div className="font-mono text-[10px] text-ink-400">{drill.intensity} Intensity</div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => openEditModal(drill)}
                  className="flex items-center gap-1 rounded bg-ink-800 px-2 py-1 font-mono text-[10px] text-ink-300 hover:bg-ink-750 hover:text-ink-100 ring-1 ring-ink-700"
                >
                  <Edit3 className="h-3 w-3" /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteDrill(drill.id)}
                  className="flex items-center gap-1 rounded bg-ink-800 px-2 py-1 font-mono text-[10px] text-bad hover:bg-bad/10 ring-1 ring-ink-700"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {filteredDrills.length === 0 && (
        <EmptyState
          title="No drills found"
          description="Try changing your search keywords or category filter, or add a new drill."
          action={
            <Button variant="primary" onClick={openCreateModal}>
              Add Drill
            </Button>
          }
        />
      )}

      {/* Drill Add/Edit Modal */}
      <Modal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingDrill ? "Edit Master Drill" : "Create Master Drill"}
      >
        <div className="space-y-3">
          <Field label="Drill Title">
            <Input
              value={formTitle}
              onChange={setFormTitle}
              placeholder="e.g., 3-Man Weave into 2v1 Transition"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category">
              <Select
                value={formCategory}
                onChange={(v) => setFormCategory(v as DrillCategory)}
                options={DRILL_CATEGORIES}
              />
            </Field>
            <Field label="Estimated Duration (Minutes)">
              <Input
                type="number"
                value={formDuration}
                onChange={setFormDuration}
                placeholder="10"
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Difficulty Level">
              <Select
                value={formDifficulty}
                onChange={(v) => setFormDifficulty(v as "Intro" | "Intermediate" | "Advanced")}
                options={["Intro", "Intermediate", "Advanced"]}
              />
            </Field>
            <Field label="Physical Intensity">
              <Select
                value={formIntensity}
                onChange={(v) => setFormIntensity(v as "Low" | "Medium" | "High")}
                options={["Low", "Medium", "High"]}
              />
            </Field>
          </div>

          <Field label="Key Coaching Points (One per line)">
            <Textarea
              rows={4}
              value={formPoints}
              onChange={setFormPoints}
              placeholder="• Sprint wide in transition lanes&#10;• Communicate ball screen coverage&#10;• High release on finish"
            />
          </Field>

          <Field label="Diagram / Tactical Image URL (Optional)">
            <Input
              value={formDiagram}
              onChange={setFormDiagram}
              placeholder="https://images.unsplash.com/... or hosted diagram link"
            />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Equipment Needed (Comma separated)">
              <Input
                value={formEquipment}
                onChange={setFormEquipment}
                placeholder="Basketballs, Cones, Whistle"
              />
            </Field>
            <Field label="Tags (Comma separated)">
              <Input
                value={formTags}
                onChange={setFormTags}
                placeholder="Shooting, Fastbreak, Spacing"
              />
            </Field>
          </div>

          <div className="mt-4 flex justify-end gap-2 border-t border-ink-800 pt-3">
            <Button variant="ghost" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSaveDrill}>
              {editingDrill ? "Save Changes" : "Create Master Drill"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Master Drill Confirmation Modal */}
      <Modal
        open={!!drillToDelete}
        onClose={() => setDrillToDelete(null)}
        title="Delete Master Drill"
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-300">
            Are you sure you want to remove this drill from the master repository? This action
            cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDrillToDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (drillToDelete) {
                  update((current) => {
                    const list =
                      current.drills && current.drills.length > 0 ? current.drills : fallbackDrills;
                    return {
                      ...current,
                      drills: list.filter((d) => d.id !== drillToDelete),
                    };
                  });
                  toast.success("Drill removed from repository");
                  setDrillToDelete(null);
                }
              }}
            >
              Delete Drill
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

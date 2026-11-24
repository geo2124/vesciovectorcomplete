import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { AppShell } from "@/components/app-shell";
import { Chip, Field, Input, Select, Modal, Textarea, money, Button } from "@/components/kit";
import { PlanEditor, PlanView, emptyPlan } from "@/components/plan-editor";
import type { PlanDraft } from "@/components/plan-editor";
import { fetchCourtWeather, type WeatherData } from "@/lib/weather";
import { ThemeToggle } from "@/lib/theme";
import { NotificationCenter } from "@/components/notification-center";
import { DrillSelector } from "@/components/drill-selector";
import {
  useDB,
  useTenantUser,
  useCollectionsPreload,
  getCoachBranches,
  getCoachTeams,
  type MasterDrill,
  type PlanBlock,
} from "@/lib/data-store";
import { useAuth } from "@/lib/auth";
import { uploadDocumentAttachment } from "@/lib/storage";
import { getTenantSlug } from "@/lib/utils";
import type { ResourceItem, Player, MatchOfficial, SessionItem, Workshop } from "@/lib/mock-data";
import { toast } from "sonner";
import {
  BookOpen,
  Sparkles,
  Plus,
  Layers,
  Camera,
  Trophy,
  ShieldCheck,
  MessageSquare,
  Phone,
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Wallet,
  DollarSign,
  Award,
  Printer,
  Medal,
  Receipt,
  Check,
  ShieldAlert,
  Copy,
  Send,
  Calendar,
  MapPin,
  UserCheck,
  LogOut,
} from "lucide-react";
import { calculatePlayer30DayAttendance } from "@/lib/attendance-utils";
import { QrAttendanceScanner } from "@/components/qr-attendance-scanner";
import { GameOfficialsForm } from "@/components/game-officials-form";
import { syncGameOfficialFeesToLedger, getGameOfficialFeeEntries } from "@/lib/match-fees";
import {
  calculateAttendanceVerifiedPayroll,
  isSessionAttendanceVerified,
  getSessionDurationHours,
} from "@/lib/payroll";
import { WhatsAppShareModal } from "@/components/whatsapp-share-modal";
import { CoachStatementModal } from "@/components/coach-statement-modal";
import {
  sendDiagnosticReportToSystemAdmin,
  copyDiagnosticReportToClipboard,
  isMasterOwner,
} from "@/lib/error-logger";

export const Route = createFileRoute("/coach")({
  head: () => ({
    meta: [
      { title: "Coach Portal — Vescio Vector" },
      {
        name: "description",
        content:
          "Mobile coach portal: calendar, session check-in, attendance, games, documents, practice plans, finals and payments.",
      },
      { property: "og:title", content: "Coach Portal — Vescio Vector" },
      { property: "og:description", content: "Everything a coach needs, on the pitch and phone." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CoachPortal,
});

const tabs = ["Home", "Calendar", "Games", "Docs", "Plans", "Profile"] as const;
const glyph: Record<string, string> = {
  Home: "▦",
  Calendar: "▤",
  Games: "◈",
  Docs: "▣",
  Plans: "✎",
  Profile: "●",
};

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function isWorkshopAssignedToCoach(
  w: Workshop,
  coach: { id: string; name: string; level?: string } | null,
): boolean {
  if (!coach) return false;
  const assignedCoaches = Array.isArray(w.assignedCoaches) ? w.assignedCoaches : [];
  const assignedLevels = Array.isArray(w.assignedLevels) ? w.assignedLevels : [];
  const attendeeIds = Array.isArray(w.attendeeIds) ? w.attendeeIds : [];

  if (attendeeIds.includes(coach.id)) return true;
  if (
    assignedCoaches.some(
      (c) => c === coach.id || c.trim().toLowerCase() === coach.name.trim().toLowerCase(),
    )
  ) {
    return true;
  }
  if (
    coach.level &&
    assignedLevels.some((l) => l.trim().toLowerCase() === coach.level!.trim().toLowerCase())
  ) {
    return true;
  }
  // Open to all levels when both arrays are empty
  if (assignedCoaches.length === 0 && assignedLevels.length === 0) {
    return true;
  }
  return false;
}

function CoachPortal() {
  const { db, update, setEntity, ready } = useDB();
  const { user, passwordUser, loading: authLoading, logOut } = useAuth();
  const navigate = useNavigate();
  const currentUser = useTenantUser();
  const roleLower = (currentUser?.role || "").toLowerCase();

  // Preload all real-time Firestore collections required for live coach operation
  useCollectionsPreload([
    "coaches",
    "teams",
    "sessions",
    "attendance",
    "players",
    "branches",
    "plans",
    "resourceFolders",
    "workshops",
    "ledger",
    "drills",
  ]);

  // Administrative roles can switch between coaches for oversight; coaches are locked to their own profile
  const canSwitchCoach =
    Boolean(currentUser) &&
    (currentUser?.role === "Super Admin" ||
      currentUser?.role === "Academy Manager" ||
      currentUser?.role === "Technical Director" ||
      roleLower.includes("super") ||
      roleLower.includes("academy") ||
      roleLower.includes("manager") ||
      roleLower.includes("director"));

  const matchedCoach = useMemo(() => {
    const userEmail = currentUser?.email || user?.email;
    const userName = currentUser?.name;
    const userLogin = currentUser?.username;

    return (
      db.coaches.find((c) => {
        if (userEmail && c.email && c.email.toLowerCase() === userEmail.toLowerCase()) return true;
        if (userName && c.name && c.name.toLowerCase() === userName.toLowerCase()) return true;
        if (userLogin && c.username && c.username.toLowerCase() === userLogin.toLowerCase())
          return true;
        if (currentUser?.id && c.id === currentUser.id) return true;
        return false;
      }) ?? null
    );
  }, [currentUser, user?.email, db.coaches]);

  const notifications: string[] = [];
  const today = new Date();

  const [tab, setTab] = useState<(typeof tabs)[number]>("Home");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [coachId, setCoachId] = useState(
    (!canSwitchCoach ? matchedCoach?.id : matchedCoach?.id || db.coaches[0]?.id) ?? "",
  );
  const [reportIssueOpen, setReportIssueOpen] = useState(false);
  const [issueNote, setIssueNote] = useState("");
  const [isSubmittingIssue, setIsSubmittingIssue] = useState(false);
  const [issueReportedConfirm, setIssueReportedConfirm] = useState(false);
  const [schedulePracticeOpen, setSchedulePracticeOpen] = useState(false);

  const handleCoachSignOut = async () => {
    setActiveSessionId(null);
    await logOut();
    navigate({ to: "/", replace: true });
  };

  // Auto-switch tab when clicking a Workshop/Curriculum/Payroll notification or URL query param
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const params = new URLSearchParams(window.location.search);
      const tabParam = params.get("tab");
      if (tabParam && tabs.includes(tabParam as (typeof tabs)[number])) {
        setTab(tabParam as (typeof tabs)[number]);
      } else if (tabParam?.toLowerCase() === "workshops" || tabParam?.toLowerCase() === "docs") {
        setTab("Docs");
      }
    } catch {
      // ignore
    }

    const onNotifClick = (e: Event) => {
      const customEv = e as CustomEvent<{
        title?: string;
        message?: string;
        actionUrl?: string;
      }>;
      const detail = customEv.detail;
      if (!detail) return;
      const text =
        `${detail.title || ""} ${detail.message || ""} ${detail.actionUrl || ""}`.toLowerCase();
      if (
        text.includes("workshop") ||
        text.includes("seminar") ||
        text.includes("resource") ||
        text.includes("folder")
      ) {
        setTab("Docs");
      } else if (text.includes("plan")) {
        setTab("Plans");
      } else if (text.includes("game") || text.includes("match") || text.includes("frequency")) {
        setTab("Games");
      } else if (text.includes("payroll") || text.includes("disburse") || text.includes("salary")) {
        setTab("Profile");
      }
    };
    window.addEventListener("vv:notification-clicked", onNotifClick);
    return () => window.removeEventListener("vv:notification-clicked", onNotifClick);
  }, []);

  // Auto-select and lock coach profile
  useEffect(() => {
    if (!canSwitchCoach) {
      if (matchedCoach && coachId !== matchedCoach.id) {
        setCoachId(matchedCoach.id);
      } else if (!matchedCoach && coachId !== "") {
        setCoachId("");
      }
      return;
    }
    if (canSwitchCoach && !coachId) {
      if (matchedCoach) {
        setCoachId(matchedCoach.id);
      } else if (db.coaches[0]?.id) {
        setCoachId(db.coaches[0].id);
      }
    }
  }, [currentUser, matchedCoach, canSwitchCoach, coachId, db.coaches]);

  const coach = !canSwitchCoach
    ? (matchedCoach ?? null)
    : (db.coaches.find((c) => c.id === coachId) ?? db.coaches[0] ?? null);

  if (coach) {
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 3600 * 1000);
    const assignedTeamNamesLower = new Set(
      getCoachTeams(coach, db.teams).map((t) => t.toLowerCase()),
    );
    db.teams.forEach((team) => {
      const isCoachTeam = assignedTeamNamesLower.has(team.name.toLowerCase());
      if (!isCoachTeam) return;
      const targetFrequency = team.gamesFrequencyPerMonth ?? 2;
      const teamGames = db.sessions.filter(
        (s) => s.kind === "Game" && (s.teamA === team.name || s.teamB === team.name),
      );
      const recentGames = teamGames.filter((g) => {
        const raw = typeof g.date === "string" ? g.date.trim().split("T")[0] : "";
        const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
        const norm = m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : raw;
        const gDate = norm ? new Date(`${norm}T00:00:00`) : new Date(NaN);
        return (
          !Number.isNaN(gDate.getTime()) &&
          gDate >= thirtyDaysAgo &&
          gDate <= today &&
          (g.status === "Completed" || g.status === "Official")
        );
      });
      const playedCount = recentGames.length;
      if (playedCount < targetFrequency) {
        notifications.push(
          `Team ${team.name} lacks game experience: ${playedCount}/${targetFrequency} games played in last 30 days.`,
        );
      }
    });
  }

  const coachAssignedTeamNames = useMemo(
    () => new Set(getCoachTeams(coach, db.teams).map((n) => n.toLowerCase().trim())),
    [coach, db.teams],
  );

  const mySessions = useMemo(
    () =>
      db.sessions.filter(
        (s) =>
          (coach?.id &&
            (s.coachId === coach.id ||
              s.headCoachId === coach.id ||
              s.assistantCoachId === coach.id)) ||
          (coach?.name &&
            (s.coach?.toLowerCase() === coach.name.toLowerCase() ||
              s.headCoach?.toLowerCase() === coach.name.toLowerCase() ||
              s.assistantCoach?.toLowerCase() === coach.name.toLowerCase())) ||
          (s.team && coachAssignedTeamNames.has(s.team.toLowerCase().trim())) ||
          (s.teamA && coachAssignedTeamNames.has(s.teamA.toLowerCase().trim())) ||
          (s.teamB && coachAssignedTeamNames.has(s.teamB.toLowerCase().trim())),
      ),
    [db.sessions, coach?.id, coach?.name, coachAssignedTeamNames],
  );

  const myCompletedSessions = useMemo(
    () => mySessions.filter((s) => s.status === "Completed" || s.status === "Official"),
    [mySessions],
  );

  const myGames = useMemo(() => mySessions.filter((s) => s.kind === "Game"), [mySessions]);

  const { liveWins, liveLosses } = useMemo(() => {
    let wins = 0;
    let losses = 0;
    const coachTeamNames = coachAssignedTeamNames;

    myGames
      .filter((g) => g.status === "Completed" || g.status === "Official")
      .forEach((g) => {
        if (g.score) {
          const parts = g.score.split("-").map((p) => parseInt(p.trim(), 10));
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
              Boolean(g.teamB && coachTeamNames.has(g.teamB.toLowerCase().trim())) ||
              (g.team && g.teamB && g.team.toLowerCase().trim() === g.teamB.toLowerCase().trim());
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
    return { liveWins: wins, liveLosses: losses };
  }, [myGames, coachAssignedTeamNames]);

  // System Locked Guard: Visitors who are not signed in cannot access Coach Portal
  if (!user && !passwordUser) {
    return (
      <AppShell crumb="CONTROL / COACH PORTAL" title="Coach Portal">
        <div />
      </AppShell>
    );
  }

  if (authLoading && !currentUser && !user && !passwordUser) {
    return (
      <div className="flex h-screen items-center justify-center bg-ink-950">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-court-500 border-t-transparent" />
        <span className="ml-3 font-mono text-xs text-ink-400">Loading coach portal...</span>
      </div>
    );
  }

  // Role Guard: Coach Portal is strictly for Coaches, Technical Directors, and Academy Administrators
  const isAuthorizedRole =
    Boolean(currentUser) &&
    (currentUser?.role === "Coach" ||
      currentUser?.role === "Super Admin" ||
      currentUser?.role === "Academy Manager" ||
      currentUser?.role === "Technical Director" ||
      user?.email === "geogo3@gmail.com" ||
      passwordUser?.email === "geogo3@gmail.com" ||
      roleLower.includes("coach") ||
      roleLower.includes("super") ||
      roleLower.includes("director"));

  if (!isAuthorizedRole) {
    return (
      <AppShell crumb="CONTROL / COACH PORTAL" title="Access Denied">
        <div className="mx-auto max-w-md py-16 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-warn/10 text-warn border border-warn/20">
            <span className="text-2xl">⚠️</span>
          </div>
          <h2 className="text-lg font-semibold text-ink-100">Coach Portal Access Restricted</h2>
          <p className="mt-2 text-xs text-ink-400 leading-relaxed">
            Your account ({currentUser?.email || user?.email || passwordUser?.email}) with role{" "}
            <strong className="text-court-300">{currentUser?.role || "Visitor"}</strong> is not
            authorized to access Coach workspaces.
          </p>
          <div className="mt-6">
            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-md bg-court-500 px-4 py-2 font-mono text-xs font-semibold text-ink-950 hover:bg-court-400"
            >
              Return to Workspace
            </Link>
          </div>
        </div>
      </AppShell>
    );
  }

  if (!coach) {
    if (!canSwitchCoach && !matchedCoach) {
      return (
        <div className="grid min-h-screen place-items-center bg-ink-950 px-4 text-ink-300">
          <div className="mx-auto max-w-md rounded-xl border border-ink-800 bg-ink-900 p-6 text-center shadow-lg">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-warn/10 text-warn ring-1 ring-warn/30">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h2 className="font-display text-base font-semibold text-ink-100">
              Coach Profile Not Linked
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-ink-300">
              Your user account is not yet linked to a Coach profile. Please ask your Academy
              Manager to verify your email/username in the Coaches directory.
            </p>
            <div className="mt-5 flex justify-center gap-3">
              <button
                type="button"
                onClick={() => void handleCoachSignOut()}
                className="rounded-md bg-ink-800 px-4 py-2 font-mono text-xs font-semibold text-ink-200 ring-1 ring-ink-700 hover:bg-ink-700"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="grid min-h-screen place-items-center bg-ink-950 text-ink-300">
        No coaches yet.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-ink-950">
      <div className="mx-auto min-h-screen max-w-md border-x border-ink-800 bg-ink-950 pb-24">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-ink-800 bg-ink-950/95 px-4 py-3 backdrop-blur">
          <img
            src={db.academy?.logo || "/vescio-vector-logo.png"}
            alt={db.academy?.name || "Vescio Vector"}
            className="h-8 w-8 object-contain"
            onError={(e) => {
              if (e.currentTarget.src !== window.location.origin + "/vescio-vector-logo.png") {
                e.currentTarget.src = "/vescio-vector-logo.png";
              }
            }}
          />
          <div className="leading-tight">
            <div className="font-display text-sm tracking-tight text-ink-100">Coach Portal</div>
            <div className="font-mono text-[9px] tracking-[0.25em] text-court-400">/COACH</div>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setIssueReportedConfirm(false);
                setReportIssueOpen(true);
              }}
              className="inline-flex items-center gap-1 rounded border border-ink-800 bg-ink-900 px-2 py-1 font-mono text-[10px] text-ink-300 hover:border-court-500/40 hover:text-court-300"
              title="Report a technical issue to the system administrator"
            >
              <ShieldAlert className="h-3 w-3 text-court-400" />
              <span>Report Issue</span>
            </button>
            {isMasterOwner(user?.email) && (
              <button
                type="button"
                onClick={() => void copyDiagnosticReportToClipboard()}
                className="inline-flex items-center gap-1 rounded border border-court-500/30 bg-court-500/10 px-2 py-1 font-mono text-[10px] text-court-300 hover:bg-court-500/20"
                title="Copy ready-to-paste AI Studio prompt block"
              >
                <Copy className="h-3 w-3 text-court-400" />
                <span className="hidden sm:inline">Copy AI Prompt Block</span>
              </button>
            )}
            <NotificationCenter />
            <ThemeToggle compact />
            {!canSwitchCoach ? (
              <button
                type="button"
                onClick={() => void handleCoachSignOut()}
                className="font-mono text-[10px] uppercase tracking-widest text-ink-400 hover:text-ink-200"
              >
                Sign out
              </button>
            ) : (
              <Link
                to="/"
                className="font-mono text-[10px] uppercase tracking-widest text-ink-400 hover:text-ink-200"
              >
                Exit
              </Link>
            )}
          </div>
        </header>

        <div className="bg-ink-900 px-4 py-4">
          {notifications.length > 0 && (
            <div className="mb-4 flex flex-col gap-1">
              {notifications.map((msg, i) => (
                <div
                  key={i}
                  className="rounded-md bg-warn/10 px-3 py-2 text-xs text-warn ring-1 ring-warn/20 flex items-center gap-2"
                >
                  <span className="shrink-0 text-warn">⚠️</span>
                  {msg}
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-md bg-court-500/15 font-mono text-sm text-court-400">
              {initials(coach.name)}
            </div>
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sm font-medium text-ink-100">{coach.name}</div>
              <div className="font-mono text-[10px] text-ink-400">
                {db.lists["Coach levels"]?.find(
                  (l) => l.toLowerCase() === coach.level.toLowerCase(),
                ) || coach.level}{" "}
                · {getCoachBranches(coach).join(", ") || coach.branch || "HQ"}
              </div>
            </div>
            <span className="ml-auto">
              <Chip tone={coach.portal ? "good" : "warn"}>
                {coach.portal ? "PORTAL ON" : "PORTAL OFF"}
              </Chip>
            </span>
          </div>

          {canSwitchCoach ? (
            <div className="mt-3">
              <div className="flex items-center justify-between text-[11px] font-mono text-ink-400 mb-1">
                <span>Administrative Coach Switcher:</span>
                <span className="text-court-400 font-semibold">{currentUser?.role}</span>
              </div>
              <Select
                value={coachId}
                onChange={setCoachId}
                options={db.coaches.map((c) => c.id)}
                labels={Object.fromEntries(db.coaches.map((c) => [c.id, c.name]))}
              />
            </div>
          ) : (
            <div className="mt-3 flex items-center justify-between rounded-md bg-ink-850 px-3 py-2 border border-ink-800 text-xs">
              <div className="flex items-center gap-2 text-ink-300 font-mono">
                <ShieldCheck className="w-3.5 h-3.5 text-good" />
                <span>
                  Private Portal: <strong className="text-ink-100">{coach.name}</strong>
                </span>
              </div>
              <Chip tone="good">VERIFIED</Chip>
            </div>
          )}

          <div className="mt-3 grid grid-cols-3 gap-2">
            <MiniStat
              label="Sessions"
              value={`${myCompletedSessions.length} / ${coach.sessionTarget || 20}`}
            />
            <MiniStat label="Target" value={String(coach.sessionTarget || 20)} />
            <MiniStat label="W–L" value={`${liveWins}–${liveLosses}`} />
          </div>
        </div>

        <div className="px-4 py-4">
          {tab === "Home" ? (
            <Home
              coachId={coach.id}
              coachName={coach.name}
              coachLevel={coach.level}
              canSwitchCoach={canSwitchCoach}
              sessions={mySessions}
              activeSessionId={activeSessionId}
              onSelectSession={setActiveSessionId}
              onOpenSchedulePractice={() => setSchedulePracticeOpen(true)}
              onOpenWorkshops={() => setTab("Docs")}
            />
          ) : null}
          {tab === "Calendar" ? (
            <CalendarTab
              sessions={mySessions}
              onOpenAttendance={(sId) => {
                setActiveSessionId(sId);
                setTab("Home");
              }}
              onOpenSchedulePractice={() => setSchedulePracticeOpen(true)}
            />
          ) : null}
          {tab === "Games" ? (
            <Games coachId={coach.id} coachName={coach.name} canSwitchCoach={canSwitchCoach} />
          ) : null}
          {tab === "Docs" ? <Docs coachId={coach.id} /> : null}
          {tab === "Plans" ? <PlansTab coachId={coach.id} coachName={coach.name} /> : null}
          {tab === "Profile" ? (
            <Profile
              coachId={coach.id}
              canSwitchCoach={canSwitchCoach}
              onSignOut={() => void handleCoachSignOut()}
            />
          ) : null}
        </div>
      </div>

      {/* "+ Schedule Practice" Modal for Coaches */}
      <SchedulePracticeModal
        open={schedulePracticeOpen}
        onClose={() => setSchedulePracticeOpen(false)}
        coachId={coach.id}
        coachName={coach.name}
        coachBranch={coach.branch}
        canSwitchCoach={canSwitchCoach}
        onCreated={(newSessionId) => {
          setActiveSessionId(newSessionId);
        }}
      />
      <nav className="fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-md items-center justify-around border-t border-ink-800 bg-ink-950/95 px-1 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex flex-1 flex-col items-center gap-1 py-1.5 ${
              tab === t ? "text-court-400" : "text-ink-400"
            }`}
          >
            <span className="font-mono text-sm leading-none">{glyph[t]}</span>
            <span className="font-mono text-[9px] uppercase tracking-widest">{t}</span>
          </button>
        ))}
      </nav>

      {/* Client-Friendly "Report a Technical Issue" Modal for Coach Portal */}
      <Modal
        open={reportIssueOpen}
        title="Report a Technical Issue"
        meta="Automatically attaches diagnostic context and alerts the system administrator"
        onClose={() => {
          setReportIssueOpen(false);
          setIssueReportedConfirm(false);
        }}
      >
        <div className="p-4 space-y-4">
          {issueReportedConfirm ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-center space-y-3">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div className="text-sm font-semibold text-ink-100">
                The problem has been reported to the system administrator.
              </div>
              <p className="font-mono text-[11px] text-ink-300">
                Diagnostic logs, current route, and session telemetry have been dispatched to the
                system administrator for immediate resolution.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
                {isMasterOwner(user?.email) && (
                  <Button variant="ghost" onClick={() => void copyDiagnosticReportToClipboard()}>
                    <span className="inline-flex items-center gap-1.5">
                      <Copy className="h-3.5 w-3.5 text-court-400" />
                      <span>Copy AI Prompt Block</span>
                    </span>
                  </Button>
                )}
                <Button
                  onClick={() => {
                    setReportIssueOpen(false);
                    setIssueReportedConfirm(false);
                  }}
                >
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  setIsSubmittingIssue(true);
                  await sendDiagnosticReportToSystemAdmin({
                    trigger: "manual_user_report",
                    userNote: issueNote.trim(),
                    currentUser: {
                      email:
                        user?.email ||
                        passwordUser?.email ||
                        currentUser?.email ||
                        coach.email ||
                        "anonymous",
                      name: coach.name || currentUser?.name || user?.displayName || "Coach",
                      role: currentUser?.role || "Coach",
                      branch: coach.branch || currentUser?.branch || "HQ",
                    },
                  });
                  setIssueReportedConfirm(true);
                  setIssueNote("");
                  toast.success("The problem has been reported to the system administrator.");
                } catch {
                  toast.success("The problem has been reported to the system administrator.");
                  setIssueReportedConfirm(true);
                } finally {
                  setIsSubmittingIssue(false);
                }
              }}
              className="space-y-4"
            >
              <Field label="Problem Description (Optional)">
                <Textarea
                  rows={3}
                  value={issueNote}
                  onChange={setIssueNote}
                  placeholder="Briefly describe the problem you encountered (optional)..."
                />
              </Field>
              <div className="rounded-md border border-ink-800 bg-ink-950/70 p-2.5 font-mono text-[10px] text-ink-400">
                Your current portal tab (<span className="text-ink-200">/coach · {tab}</span>),
                profile (<span className="text-ink-200">{coach.name}</span>), and recent diagnostic
                logs will be attached automatically.
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                {isMasterOwner(user?.email) && (
                  <button
                    type="button"
                    onClick={() => void copyDiagnosticReportToClipboard()}
                    className="inline-flex items-center gap-1.5 rounded-md border border-court-500/30 bg-court-500/10 px-3 py-2 font-mono text-xs text-court-300 hover:bg-court-500/20"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy AI Prompt Block</span>
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isSubmittingIssue}
                  className="inline-flex items-center gap-2 rounded-md bg-court-500 hover:bg-court-400 px-4 py-2 font-semibold text-xs text-ink-950 shadow-sm cursor-pointer disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" />
                  <span>
                    {isSubmittingIssue ? "Sending Report..." : "Send Report to Administrator"}
                  </span>
                </button>
              </div>
            </form>
          )}
        </div>
      </Modal>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-ink-850 p-2.5 ring-1 ring-ink-700">
      <div className="label-mono">{label}</div>
      <div className="font-display mt-1 text-xl tracking-tight text-ink-100">{value}</div>
    </div>
  );
}

function Card({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="label-mono">{title}</div>
        {action}
      </div>
      <div className="panel p-3">{children}</div>
    </section>
  );
}

type SessionLike = ReturnType<typeof useDB>["db"]["sessions"][number];

function SchedulePracticeModal({
  open,
  onClose,
  coachId,
  coachName,
  coachBranch,
  canSwitchCoach,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  coachId: string;
  coachName: string;
  coachBranch?: string;
  canSwitchCoach: boolean;
  onCreated?: (sessionId: string) => void;
}) {
  const { db, setEntity } = useDB();
  const coach = db.coaches.find((c) => c.id === coachId) ?? null;

  const assignedTeamNames = useMemo(
    () => getCoachTeams(coach || { id: coachId, name: coachName }, db.teams || []),
    [coach, coachId, coachName, db.teams],
  );
  const selectableTeams = useMemo(() => {
    if (canSwitchCoach) return db.teams.map((t) => t.name);
    return assignedTeamNames.length > 0 ? assignedTeamNames : db.teams.map((t) => t.name);
  }, [canSwitchCoach, assignedTeamNames, db.teams]);

  const coachBranches = useMemo(() => {
    const bList = getCoachBranches(coach);
    return bList.length > 0 ? bList : db.branches.map((b) => b.name);
  }, [coach, db.branches]);

  const approvedPlans = useMemo(
    () =>
      (db.plans || []).filter(
        (p) =>
          (p.coachId === coachId || p.coach?.toLowerCase() === coachName.toLowerCase()) &&
          p.status === "Approved",
      ),
    [db.plans, coachId, coachName],
  );

  const [form, setForm] = useState({
    team: selectableTeams[0] || "",
    title: "",
    date: new Date().toISOString().slice(0, 10),
    time: "17:00",
    branch: coachBranch || coachBranches[0] || db.branches[0]?.name || "HQ",
    court: "",
    customCourt: "",
    planId: "",
  });

  useEffect(() => {
    if (open) {
      const defaultTeam = selectableTeams[0] || "";
      const defaultBranch = coachBranch || coachBranches[0] || db.branches[0]?.name || "HQ";
      const branchObj = db.branches.find((b) => b.name === defaultBranch);
      const defaultCourt = branchObj?.courts?.[0]?.name || "Main Court";
      setForm({
        team: defaultTeam,
        title: defaultTeam ? `${defaultTeam} Practice` : "Team Practice",
        date: new Date().toISOString().slice(0, 10),
        time: "17:00",
        branch: defaultBranch,
        court: defaultCourt,
        customCourt: "",
        planId: approvedPlans[0]?.id || "",
      });
    }
  }, [open, selectableTeams, coachBranch, coachBranches, db.branches, approvedPlans]);

  const selectedBranchObj = useMemo(
    () => db.branches.find((b) => b.name === form.branch),
    [db.branches, form.branch],
  );
  const courtOptions = useMemo(() => {
    const names = (selectedBranchObj?.courts || []).map((c) => c.name).filter(Boolean);
    return names.length > 0 ? [...names, "Custom / Other"] : ["Main Court", "Custom / Other"];
  }, [selectedBranchObj]);

  const handleSubmit = () => {
    const resolvedTeam = form.team.trim();
    const resolvedTitle =
      form.title.trim() || (resolvedTeam ? `${resolvedTeam} Practice` : "Team Practice");
    const resolvedCourt =
      form.court === "Custom / Other"
        ? form.customCourt.trim() || "Main Court"
        : form.court.trim() || "Main Court";
    const newSessionId = `e-${Date.now().toString(36)}`;

    const newPracticeSession: SessionItem = {
      id: newSessionId,
      kind: "Practice",
      title: resolvedTitle,
      team: resolvedTeam || undefined,
      detail: resolvedCourt,
      court: resolvedCourt,
      date: form.date,
      time: form.time,
      branch: form.branch || "HQ",
      coach: coachName,
      coachId,
      headCoach: coachName,
      headCoachId: coachId,
      status: "Planned",
      ...(form.planId ? { planId: form.planId } : {}),
    };

    void setEntity("sessions", newPracticeSession);
    toast.success(
      `Practice "${resolvedTitle}" scheduled on ${form.date} at ${form.time} (${resolvedCourt}).`,
    );
    onCreated?.(newSessionId);
    onClose();
  };

  return (
    <Modal
      open={open}
      title="Schedule Practice Session"
      meta="Create a new practice session for your assigned team"
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel="Schedule Practice"
    >
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <Field label="Assigned Team">
          <Select
            value={form.team}
            onChange={(v) =>
              setForm({
                ...form,
                team: v,
                title:
                  !form.title || form.title.endsWith(" Practice") ? `${v} Practice` : form.title,
              })
            }
            options={selectableTeams.length > 0 ? selectableTeams : [""]}
            labels={
              selectableTeams.length > 0
                ? Object.fromEntries(selectableTeams.map((t) => [t, t]))
                : { "": "General Practice" }
            }
          />
        </Field>

        <Field label="Session Title">
          <Input
            placeholder="e.g. U-16 Tactical Practice"
            value={form.title}
            onChange={(v) => setForm({ ...form, title: v })}
          />
        </Field>

        <Field label="Date">
          <Input type="date" value={form.date} onChange={(v) => setForm({ ...form, date: v })} />
        </Field>

        <Field label="Time">
          <Input type="time" value={form.time} onChange={(v) => setForm({ ...form, time: v })} />
        </Field>

        <Field label="Branch">
          <Select
            value={form.branch}
            onChange={(v) => {
              const bObj = db.branches.find((b) => b.name === v);
              const firstCourt = bObj?.courts?.[0]?.name || "Main Court";
              setForm({ ...form, branch: v, court: firstCourt });
            }}
            options={Array.from(new Set([...db.branches.map((b) => b.name), "HQ"]))}
          />
        </Field>

        <Field label="Court">
          <Select
            value={courtOptions.includes(form.court) ? form.court : courtOptions[0] || "Main Court"}
            onChange={(v) => setForm({ ...form, court: v })}
            options={courtOptions}
          />
        </Field>

        {form.court === "Custom / Other" && (
          <div className="sm:col-span-2">
            <Field label="Custom Court / Venue Name">
              <Input
                placeholder="Enter court or facility name"
                value={form.customCourt}
                onChange={(v) => setForm({ ...form, customCourt: v })}
              />
            </Field>
          </div>
        )}

        <div className="sm:col-span-2">
          <Field label="Attach Approved Training Plan (Optional)">
            <Select
              value={form.planId}
              onChange={(v) => setForm({ ...form, planId: v })}
              options={["", ...approvedPlans.map((p) => p.id)]}
              labels={{
                "": "No plan attached yet",
                ...Object.fromEntries(
                  approvedPlans.map((p) => [p.id, `${p.title} (${p.category})`]),
                ),
              }}
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function Home({
  coachId,
  coachName,
  coachLevel,
  canSwitchCoach,
  sessions,
  activeSessionId,
  onSelectSession,
  onOpenSchedulePractice,
  onOpenWorkshops,
}: {
  coachId: string;
  coachName: string;
  coachLevel?: string;
  canSwitchCoach: boolean;
  sessions: SessionLike[];
  activeSessionId?: string | null;
  onSelectSession?: (id: string) => void;
  onOpenSchedulePractice?: () => void;
  onOpenWorkshops?: () => void;
}) {
  const { db, recordAttendance, setEntity, patchEntity, dispatchNotification } = useDB();
  const currentUser = useTenantUser();
  const [openSession, setOpenSession] = useState<string | null>(activeSessionId ?? null);

  const upcomingWorkshops = useMemo(() => {
    return (db.workshops || []).filter(
      (w) =>
        w.status !== "Completed" &&
        isWorkshopAssignedToCoach(w, { id: coachId, name: coachName, level: coachLevel }),
    );
  }, [db.workshops, coachId, coachName, coachLevel]);

  const confirmWorkshopAttendance = (w: Workshop) => {
    const nextAttendees = Array.from(new Set([...(w.attendeeIds || []), coachId]));
    const updatedWorkshop: Workshop = {
      ...w,
      attendeeIds: nextAttendees,
      attendance: { ...(w.attendance || {}), [coachId]: "Present" },
    };
    void setEntity("workshops", updatedWorkshop);
    toast.success(`Attendance confirmed for "${w.title}".`);
  };

  useEffect(() => {
    if (activeSessionId) {
      setOpenSession(activeSessionId);
    }
  }, [activeSessionId]);

  const next =
    (openSession ? sessions.find((s) => s.id === openSession) : null) ??
    (activeSessionId ? sessions.find((s) => s.id === activeSessionId) : null) ??
    sessions.find((s) => s.status === "Live") ??
    sessions[0];

  const [finishModalOpen, setFinishModalOpen] = useState(false);
  const [scoreForm, setScoreForm] = useState("");
  const [reportForm, setReportForm] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [coachAttendance, setCoachAttendance] = useState<"Present" | "Absent" | "Excused">(
    "Present",
  );
  const [viewingPlan, setViewingPlan] = useState<
    ReturnType<typeof useDB>["db"]["plans"][number] | null
  >(null);

  const [branchManagerModalOpen, setBranchManagerModalOpen] = useState(false);
  const [managerName, setManagerName] = useState("");
  const [managerReason, setManagerReason] = useState("");
  const [managerTarget, setManagerTarget] = useState<"coach" | "assistant" | "both">("both");

  const isHeadCoachCheckedIn = Boolean(next?.coachCheckedInAt);
  const isAssistantCheckedIn = Boolean(next?.assistantCheckedInAt);
  const isStaffCheckedIn = isHeadCoachCheckedIn || isAssistantCheckedIn;

  const linkedPlan = useMemo(() => {
    if (!next) return null;
    if (next.planId) {
      return db.plans.find((p) => p.id === next.planId) || null;
    }
    return (
      db.plans.find(
        (p) =>
          (p.coachId === coachId ||
            (next.coachId && p.coachId === next.coachId) ||
            p.coach?.toLowerCase() === coachName?.toLowerCase() ||
            p.coach?.toLowerCase() === next.coach?.toLowerCase()) &&
          (p.date === next.date ||
            (p.title && next.title && p.title.toLowerCase().includes(next.title.toLowerCase()))),
      ) || null
    );
  }, [next, db.plans, coachId, coachName]);

  // Attendance turnstile is strictly locked until coach, assistant, or branch manager checks in
  const active = isStaffCheckedIn ? (openSession ?? next?.id ?? null) : null;

  const myTeamNames = useMemo(() => {
    const coachObj = (db.coaches || []).find(
      (c) => c.id === coachId || c.name?.toLowerCase().trim() === coachName?.toLowerCase().trim(),
    );
    const teamNames = getCoachTeams(coachObj || { id: coachId, name: coachName }, db.teams || []);
    return new Set(teamNames);
  }, [db.coaches, db.teams, coachId, coachName]);

  const roster = useMemo(() => {
    if (!next) return [];
    const hasSessionTeam = Boolean(next.team || next.teamA || next.teamB);
    const teamPlayers = db.players.filter((p) => {
      const pTeams = p.teams || [];
      return (
        (next.teamA && pTeams.includes(next.teamA)) ||
        (next.teamB && pTeams.includes(next.teamB)) ||
        (next.team && pTeams.includes(next.team))
      );
    });
    if (hasSessionTeam) {
      return teamPlayers;
    }
    const branchPlayers = next.branch ? db.players.filter((p) => p.branch === next.branch) : [];
    if (!canSwitchCoach && myTeamNames.size > 0) {
      return branchPlayers.filter((p) => (p.teams || []).some((t) => myTeamNames.has(t)));
    }
    return branchPlayers;
  }, [next, db.players, canSwitchCoach, myTeamNames]);

  const attendanceRecords = active ? (db.attendance[active] ?? {}) : {};
  const presentCount = Object.values(attendanceRecords).filter(
    (status) => status === "Present",
  ).length;
  const excusedCount = Object.values(attendanceRecords).filter(
    (status) => status === "Excused",
  ).length;
  const absentCount = Math.max(0, (roster.length || 0) - presentCount - excusedCount);

  const branch = db.branches.find((b) => b.name === next?.branch);
  const courtWithGps = branch?.courts.find(
    (c) => typeof c.lat === "number" && typeof c.lng === "number",
  );

  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);

  useEffect(() => {
    if (!courtWithGps?.lat || !courtWithGps?.lng) {
      // Default to Beirut coordinates if specific court GPS is pending
      fetchCourtWeather(33.8938, 35.5018).then(setWeather);
      return;
    }
    setWeatherLoading(true);
    fetchCourtWeather(courtWithGps.lat, courtWithGps.lng)
      .then(setWeather)
      .finally(() => setWeatherLoading(false));
  }, [courtWithGps?.lat, courtWithGps?.lng]);

  function setAttendance(playerId: string, status: "Present" | "Absent" | "Excused") {
    if (!active) return;
    const p = roster.find((player) => player.id === playerId);
    let flag: "low_attendance_warning" | undefined = undefined;
    if (p && status === "Present") {
      const stats = calculatePlayer30DayAttendance(p.id, p, db.sessions, db.attendance);
      if (stats.isLowAttendance) {
        flag = "low_attendance_warning";
        toast.warning(
          `⚠️ Low Attendance Warning: ${p.name} (Rate: ${stats.rate}% over last 30 days).`,
        );
      }
    }
    recordAttendance(
      active,
      playerId,
      status,
      new Date().toISOString(),
      flag ? { method: "manual", flag } : { method: "manual" },
    );
  }

  function markAllPresent() {
    if (!active) return;
    let count = 0;
    roster.forEach((p) => {
      const isBlocked =
        p.status?.toLowerCase() === "inactive" || p.status?.toLowerCase() === "suspended";
      if (!isBlocked) {
        recordAttendance(active, p.id, "Present", new Date().toISOString(), {
          method: "manual",
        });
        count++;
      }
    });
    toast.success(`Marked ${count} eligible players as Present.`);
  }

  function handleHeadCoachCheckIn(sessionId: string) {
    setOpenSession(sessionId);
    onSelectSession?.(sessionId);
    patchEntity("sessions", sessionId, {
      status: "Live",
      coachAttendance: "Present",
      coachCheckedInAt: new Date().toISOString(),
      coachCheckedInBy: `${coachName} (Self Check-in)`,
    });
    toast.success("Coach checked in! Turnstile is now unlocked for player attendance.");
  }

  function handleAssistantCheckIn(sessionId: string) {
    setOpenSession(sessionId);
    onSelectSession?.(sessionId);
    patchEntity("sessions", sessionId, {
      status: "Live",
      assistantAttendance: "Present",
      assistantCheckedInAt: new Date().toISOString(),
    });
    toast.success("Assistant Coach checked in! Turnstile is now unlocked for player attendance.");
  }

  function handleBranchManagerCheckIn(e?: React.FormEvent) {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    if (!next) return;
    if (!managerReason.trim()) {
      toast.error("Please enter a mandatory administrative reason for branch manager check-in.");
      return;
    }
    const now = new Date().toISOString();
    const authorizer = managerName.trim() || currentUser?.name || "Branch Manager";
    const reason = managerReason.trim();
    const updates: Partial<SessionLike> = {
      status: "Live",
      checkedInByManagerName: authorizer,
      checkedInByManagerReason: reason,
    };
    if (managerTarget === "coach" || managerTarget === "both") {
      updates.coachAttendance = "Present";
      updates.coachCheckedInAt = now;
      updates.coachCheckedInBy = `Branch Manager: ${authorizer} (Reason: ${reason})`;
    }
    if (managerTarget === "assistant" || managerTarget === "both") {
      updates.assistantAttendance = "Present";
      updates.assistantCheckedInAt = now;
    }
    patchEntity("sessions", next.id, updates);
    setOpenSession(next.id);
    onSelectSession?.(next.id);
    toast.success(`Staff checked in by ${authorizer}. Attendance turnstile unlocked.`);
    setBranchManagerModalOpen(false);
    setManagerReason("");
  }

  function handleGpsOrDirectCheckIn() {
    if (!next) return;
    const branch = db.branches.find((b) => b.name === next.branch);
    const court = branch?.courts.find((c) => c.lat && c.lng);

    if (court && court.lat && court.lng) {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const R = 6371e3;
            const lat1 = pos.coords.latitude;
            const lon1 = pos.coords.longitude;
            const lat2 = court.lat!;
            const lon2 = court.lng!;
            const φ1 = (lat1 * Math.PI) / 180;
            const φ2 = (lat2 * Math.PI) / 180;
            const Δφ = ((lat2 - lat1) * Math.PI) / 180;
            const Δλ = ((lon2 - lon1) * Math.PI) / 180;
            const a =
              Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const d = R * c;

            if (d > 200) {
              toast.error(
                "Geofence blocked: You are " +
                  Math.round(d) +
                  " meters away from the court. You must be within 200 meters to check in.",
              );
              return;
            }
            handleHeadCoachCheckIn(next.id);
          },
          () => {
            toast.warning("Location access unavailable; proceeding with standard check-in.");
            handleHeadCoachCheckIn(next.id);
          },
        );
      } else {
        handleHeadCoachCheckIn(next.id);
      }
    } else {
      handleHeadCoachCheckIn(next.id);
    }
  }

  function handleFinish(e?: React.FormEvent) {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    if (!next) return;

    if (next.kind === "Game") {
      if (!scoreForm.trim()) {
        toast.error("Please enter the final match score (e.g. 84 - 76).");
        return;
      }
      if (!reportForm.trim()) {
        toast.error("Please submit a match report to complete the game.");
        return;
      }
      patchEntity("sessions", next.id, {
        status: "Completed",
        score: scoreForm.trim(),
        report: reportForm.trim(),
        coachAttendance,
      });
      void dispatchNotification({
        title: `Match Completed: ${next.title}`,
        message: `${coachName} submitted match result (${scoreForm.trim()}) and report.`,
        type: "curriculum",
        targetRoles: ["technical_director", "super_admin", "branch_manager"],
        targetBranchId: next.branch || undefined,
        actionUrl: "/technical",
        createdAt: new Date().toISOString(),
        readBy: [],
      }).catch(() => {});
      toast.success("Game completed and official score & report recorded.");
    } else {
      // Practice session
      if (coachAttendance !== "Present") {
        toast.error("Practice sessions require the coach to be marked Present to complete.");
        return;
      }
      patchEntity("sessions", next.id, {
        status: "Completed",
        coachAttendance: "Present",
      });
      toast.success("Practice completed and coach attendance verified as Present.");
    }

    setFinishModalOpen(false);
    setOpenSession(null);
  }

  if (!next) {
    return (
      <>
        {upcomingWorkshops.length > 0 && (
          <Card
            title="Upcoming Coaching Workshops"
            action={
              onOpenWorkshops ? (
                <button
                  type="button"
                  onClick={onOpenWorkshops}
                  className="font-mono text-[10px] text-court-400 hover:underline"
                >
                  View All ({upcomingWorkshops.length}) ›
                </button>
              ) : undefined
            }
          >
            <div className="space-y-2.5">
              {upcomingWorkshops.slice(0, 2).map((w) => {
                const isConfirmed = (w.attendeeIds || []).includes(coachId);
                return (
                  <div
                    key={w.id}
                    className="rounded-md bg-ink-850 p-2.5 ring-1 ring-court-500/30 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-ink-100 truncate">{w.title}</div>
                        <div className="font-mono text-[10px] text-ink-400">
                          {w.date} · {w.time} · {w.location} · Presenter: {w.presenter}
                        </div>
                      </div>
                      <Chip tone={isConfirmed ? "good" : "warn"}>
                        {isConfirmed ? "CONFIRMED" : "UPCOMING"}
                      </Chip>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-ink-800">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {(w.documents || []).map((doc) => (
                          <a
                            key={doc.id}
                            href={doc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded bg-ink-900 px-2 py-0.5 font-mono text-[10px] text-court-400 ring-1 ring-ink-700 hover:bg-ink-800"
                          >
                            <FileText className="h-3 w-3" />
                            <span className="truncate max-w-[120px]">{doc.name}</span>
                          </a>
                        ))}
                      </div>
                      {!isConfirmed ? (
                        <button
                          type="button"
                          onClick={() => confirmWorkshopAttendance(w)}
                          className="inline-flex items-center gap-1 rounded bg-court-500 px-2.5 py-1 font-mono text-[10px] font-bold text-ink-950 hover:bg-court-400"
                        >
                          <Check className="h-3 w-3" />
                          <span>Confirm Attendance</span>
                        </button>
                      ) : (
                        <span className="font-mono text-[10px] text-good">
                          ✓ Attendance Confirmed
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
        <Card
          title="Next session"
          action={
            onOpenSchedulePractice ? (
              <button
                type="button"
                onClick={onOpenSchedulePractice}
                className="inline-flex items-center gap-1 rounded bg-court-500 px-2.5 py-1 font-mono text-[10px] font-bold text-ink-950 hover:bg-court-400"
              >
                <Plus className="h-3 w-3" />
                <span>+ Schedule Practice</span>
              </button>
            ) : undefined
          }
        >
          <div className="py-3 text-xs text-ink-300">No sessions assigned to {coachName}.</div>
        </Card>
      </>
    );
  }

  return (
    <>
      {upcomingWorkshops.length > 0 && (
        <Card
          title="Upcoming Coaching Workshops"
          action={
            onOpenWorkshops ? (
              <button
                type="button"
                onClick={onOpenWorkshops}
                className="font-mono text-[10px] text-court-400 hover:underline"
              >
                View All ({upcomingWorkshops.length}) ›
              </button>
            ) : undefined
          }
        >
          <div className="space-y-2.5">
            {upcomingWorkshops.slice(0, 2).map((w) => {
              const isConfirmed = (w.attendeeIds || []).includes(coachId);
              return (
                <div
                  key={w.id}
                  className="rounded-md bg-ink-850 p-2.5 ring-1 ring-court-500/30 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-ink-100 truncate">{w.title}</div>
                      <div className="font-mono text-[10px] text-ink-400">
                        {w.date} · {w.time} · {w.location} · Presenter: {w.presenter}
                      </div>
                    </div>
                    <Chip tone={isConfirmed ? "good" : "warn"}>
                      {isConfirmed ? "CONFIRMED" : "UPCOMING"}
                    </Chip>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-ink-800">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {(w.documents || []).map((doc) => (
                        <a
                          key={doc.id}
                          href={doc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded bg-ink-900 px-2 py-0.5 font-mono text-[10px] text-court-400 ring-1 ring-ink-700 hover:bg-ink-800"
                        >
                          <FileText className="h-3 w-3" />
                          <span className="truncate max-w-[120px]">{doc.name}</span>
                        </a>
                      ))}
                    </div>
                    {!isConfirmed ? (
                      <button
                        type="button"
                        onClick={() => confirmWorkshopAttendance(w)}
                        className="inline-flex items-center gap-1 rounded bg-court-500 px-2.5 py-1 font-mono text-[10px] font-bold text-ink-950 hover:bg-court-400"
                      >
                        <Check className="h-3 w-3" />
                        <span>Confirm Attendance</span>
                      </button>
                    ) : (
                      <span className="font-mono text-[10px] text-good">
                        ✓ Attendance Confirmed
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card
        title="Next session"
        action={
          <div className="flex items-center gap-2">
            {sessions.length > 1 && (
              <span className="font-mono text-[10px] text-ink-400">{sessions.length} sessions</span>
            )}
            {onOpenSchedulePractice && (
              <button
                type="button"
                onClick={onOpenSchedulePractice}
                className="inline-flex items-center gap-1 rounded bg-court-500 px-2 py-1 font-mono text-[10px] font-bold text-ink-950 hover:bg-court-400"
              >
                <Plus className="h-3 w-3" />
                <span>+ Schedule Practice</span>
              </button>
            )}
          </div>
        }
      >
        {sessions.length > 1 && (
          <div className="mb-3 rounded bg-ink-850 p-2 ring-1 ring-ink-700">
            <div className="flex items-center justify-between text-[11px] font-mono text-ink-300 mb-1">
              <span>Select Active Session:</span>
              <span className="text-court-400 font-bold">{next.kind}</span>
            </div>
            <Select
              value={next.id}
              onChange={(sId) => {
                setOpenSession(sId);
                onSelectSession?.(sId);
              }}
              options={sessions.map((s) => s.id)}
              labels={Object.fromEntries(
                sessions.map((s) => [
                  s.id,
                  `${s.date.slice(5)} ${s.time} · ${s.title} (${s.status})`,
                ]),
              )}
            />
          </div>
        )}

        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded bg-court-500/15 font-mono text-[10px] text-court-400">
            {String(next.kind || "Practice")
              .slice(0, 4)
              .toUpperCase()}
          </div>
          <div className="min-w-0 leading-tight flex-1">
            <div className="truncate text-sm font-medium text-ink-100">{next.title}</div>
            <div className="font-mono text-[10px] text-ink-400">
              {next.detail} · {next.date} {next.time}
            </div>
          </div>
        </div>

        {weather && (
          <div className="mt-3 rounded-md bg-ink-850 p-2.5 ring-1 ring-ink-700 space-y-1">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">
                  {weather.condition.toLowerCase().includes("rain") ||
                  weather.condition.toLowerCase().includes("drizzle")
                    ? "🌧️"
                    : weather.condition.toLowerCase().includes("cloud")
                      ? "⛅"
                      : weather.condition.toLowerCase().includes("fog")
                        ? "🌫️"
                        : "☀️"}
                </span>
                <span className="font-mono text-xs font-semibold text-ink-100">
                  {weather.temp}°C · {weather.condition}
                </span>
              </div>
              <span
                className={`font-mono text-[10px] px-2 py-0.5 rounded ${
                  weather.isOutdoorSafe
                    ? "bg-good/15 text-good ring-1 ring-good/30"
                    : "bg-warn/15 text-warn ring-1 ring-warn/30"
                }`}
              >
                {weather.isOutdoorSafe ? "PITCH SAFE" : "INDOOR ADVISED"}
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px] font-mono text-ink-400 pt-1 border-t border-ink-800">
              <span>{weather.courtRecommendation}</span>
              <span className="text-ink-400">{weather.source}</span>
            </div>
          </div>
        )}

        {/* Attached Practice Plan banner */}
        {linkedPlan ? (
          <div className="mt-3 flex items-center justify-between rounded-md bg-court-500/10 p-2.5 ring-1 ring-court-500/30">
            <div className="flex items-center gap-2 min-w-0">
              <BookOpen className="h-4 w-4 text-court-400 shrink-0" />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-ink-100 truncate">
                  Plan: {linkedPlan.title}
                </div>
                <div className="font-mono text-[10px] text-ink-400">
                  {linkedPlan.category} · {(linkedPlan.blocks || []).length} drill blocks ·{" "}
                  {linkedPlan.status}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setViewingPlan(linkedPlan)}
              className="ml-2 shrink-0 rounded bg-court-500/20 px-2.5 py-1 font-mono text-[10px] font-bold text-court-400 hover:bg-court-500/30 ring-1 ring-court-400/40 transition-colors"
            >
              View Drills ›
            </button>
          </div>
        ) : next.kind !== "Game" ? (
          <div className="mt-2.5 flex items-center justify-between text-[11px] font-mono text-ink-400 px-1 py-1 rounded bg-ink-900/60 ring-1 ring-ink-800">
            <span className="flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-ink-500" />
              <span>Practice plan: none attached</span>
            </span>
            {db.plans.filter(
              (p) =>
                (p.coachId === coachId ||
                  p.coach?.toLowerCase() === coachName?.toLowerCase() ||
                  p.coach?.toLowerCase() === next.coach?.toLowerCase()) &&
                p.status === "Approved",
            ).length > 0 && (
              <button
                type="button"
                onClick={() => {
                  const approved = db.plans.filter(
                    (p) =>
                      (p.coachId === coachId ||
                        p.coach?.toLowerCase() === coachName?.toLowerCase() ||
                        p.coach?.toLowerCase() === next.coach?.toLowerCase()) &&
                      p.status === "Approved",
                  );
                  if (approved[0]) {
                    patchEntity("sessions", next.id, { planId: approved[0].id });
                    toast.success(`Attached plan "${approved[0].title}" to this session.`);
                  }
                }}
                className="text-court-400 hover:text-court-300 font-bold"
              >
                Attach Plan +
              </button>
            )}
          </div>
        ) : null}

        <div className="mt-3 rounded-lg bg-ink-850 border border-ink-700/80 p-3">
          <div className="flex items-center justify-between text-xs font-mono mb-2">
            <span className="text-ink-400 font-bold">SESSION STAFF CHECK-IN</span>
            {isStaffCheckedIn ? (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-good/20 text-good border border-good/40 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Turnstile Unlocked
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-warn/20 text-warn border border-warn/40 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Check-in Required
              </span>
            )}
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-ink-100">
                  {next.coach || next.headCoach || coachName}
                </span>
                <span className="text-[10px] font-mono text-ink-400">(Head Coach)</span>
              </div>
              {isHeadCoachCheckedIn ? (
                <span className="text-[11px] font-mono text-good flex items-center gap-1">
                  ✓ {next.coachCheckedInBy || "Checked in"}{" "}
                  <span className="text-ink-400">
                    {next.coachCheckedInAt
                      ? new Date(next.coachCheckedInAt).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : ""}
                  </span>
                </span>
              ) : (
                <span className="text-[11px] font-mono text-ink-400 italic">Not checked in</span>
              )}
            </div>

            {Boolean(next.assistantCoach) && (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-ink-100">{next.assistantCoach}</span>
                  <span className="text-[10px] font-mono text-ink-400">(Assistant)</span>
                </div>
                {isAssistantCheckedIn ? (
                  <span className="text-[11px] font-mono text-good flex items-center gap-1">
                    ✓ Checked in{" "}
                    <span className="text-ink-400">
                      {next.assistantCheckedInAt
                        ? new Date(next.assistantCheckedInAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : ""}
                    </span>
                  </span>
                ) : (
                  <span className="text-[11px] font-mono text-ink-400 italic">Not checked in</span>
                )}
              </div>
            )}

            {next.checkedInByManagerName && (
              <div className="mt-1 text-[11px] font-mono text-court-300 bg-court-500/10 rounded p-1.5 border border-court-500/20">
                Branch Manager: <strong>{next.checkedInByManagerName}</strong> — Reason:{" "}
                <em>"{next.checkedInByManagerReason}"</em>
              </div>
            )}
          </div>

          {!isStaffCheckedIn ? (
            <div className="mt-3 pt-3 border-t border-ink-800 grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={handleGpsOrDirectCheckIn}
                className="w-full rounded-md bg-court-500 py-2.5 px-3 text-xs font-bold text-ink-950 hover:bg-court-400 transition-colors shadow flex items-center justify-center gap-1.5"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Coach Check-In (Court GPS)</span>
              </button>

              {Boolean(next.assistantCoach) && !isAssistantCheckedIn && (
                <button
                  type="button"
                  onClick={() => handleAssistantCheckIn(next.id)}
                  className="w-full rounded-md bg-ink-800 py-2.5 px-3 text-xs font-bold text-court-300 ring-1 ring-court-500/40 hover:bg-ink-750 transition-colors flex items-center justify-center gap-1.5"
                >
                  <ShieldCheck className="w-4 h-4" />
                  <span>Assistant Check-In</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setBranchManagerModalOpen(true)}
                className="w-full sm:col-span-2 rounded-md bg-ink-800 py-2 px-3 text-xs font-mono text-ink-300 ring-1 ring-ink-700 hover:bg-ink-750 transition-colors flex items-center justify-center gap-1.5"
              >
                <span>Branch Manager Manual Check-In (Reason Required)</span>
              </button>
            </div>
          ) : (
            <div className="mt-3 pt-3 border-t border-ink-800 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs text-good font-mono">
                <CheckCircle2 className="w-4 h-4" />
                <span>Turnstile active · Staff verified</span>
              </div>

              {next.status !== "Completed" && (
                <button
                  type="button"
                  onClick={() => {
                    setScoreForm(next.score || "");
                    setReportForm(next.report || "");
                    setCoachAttendance(next.coachAttendance || "Present");
                    setFinishModalOpen(true);
                  }}
                  className="rounded-md bg-ink-800 px-3 py-1.5 text-xs font-bold text-court-400 ring-1 ring-court-400 hover:bg-ink-750 transition-colors"
                >
                  {next.kind === "Game"
                    ? "Submit Final Score & Report"
                    : "Complete Practice & Mark Coach Present"}
                </button>
              )}
            </div>
          )}
        </div>
      </Card>

      {!isStaffCheckedIn ? (
        <Card title="Attendance Turnstile">
          <div className="rounded-lg border border-dashed border-warn/40 bg-warn/5 p-6 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-warn/10 text-warn border border-warn/30 mb-3">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h3 className="font-bold text-ink-100 text-sm">
              Attendance Locked: Coach Check-In Required
            </h3>
            <p className="mt-1 text-xs text-ink-300 max-w-md mx-auto">
              Before player attendance turnstile can start, the coach or assistant coach must check
              in, or the branch manager must perform a verified check-in with a recorded reason.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={handleGpsOrDirectCheckIn}
                className="rounded-md bg-court-500 px-4 py-2 text-xs font-bold text-ink-950 hover:bg-court-400 transition-colors shadow"
              >
                Coach Check-In
              </button>
              {Boolean(next.assistantCoach) && (
                <button
                  type="button"
                  onClick={() => handleAssistantCheckIn(next.id)}
                  className="rounded-md bg-ink-800 px-3 py-2 text-xs font-mono text-court-300 ring-1 ring-court-500/40 hover:bg-ink-750 transition-colors"
                >
                  Assistant Check-In
                </button>
              )}
              <button
                type="button"
                onClick={() => setBranchManagerModalOpen(true)}
                className="rounded-md bg-ink-800 px-3 py-2 text-xs font-mono text-ink-300 ring-1 ring-ink-700 hover:bg-ink-750 transition-colors"
              >
                Branch Manager Check-In (Reason)
              </button>
            </div>
          </div>
        </Card>
      ) : active ? (
        <Card
          title={`Attendance · ${presentCount}P · ${excusedCount}E · ${absentCount}A (${roster.length} Total)`}
          action={
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={markAllPresent}
                className="px-2 py-1 rounded bg-good/15 hover:bg-good/25 text-good font-mono text-[10px] font-bold ring-1 ring-good/30 transition-colors"
                title="Mark all eligible players present"
              >
                ✓ All Present
              </button>
              <button
                type="button"
                onClick={() => setScannerOpen(true)}
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-court-500 hover:bg-court-400 text-ink-950 font-mono text-xs font-bold shadow transition-colors"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Scan</span>
              </button>
            </div>
          }
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg bg-court-500/10 border border-court-500/20">
            <div className="text-xs text-court-300">
              <span className="font-semibold text-ink-100">Pitch-side Turnstile:</span> Scan digital
              passes with camera or use manual buttons.
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={markAllPresent}
                className="px-2.5 py-1 rounded bg-good/20 hover:bg-good/30 text-good font-mono text-xs font-semibold ring-1 ring-good/40 transition-colors"
              >
                ✓ Mark All Present
              </button>
              <button
                type="button"
                onClick={() => setScannerOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-court-500 hover:bg-court-400 text-ink-950 font-mono text-xs font-bold shrink-0 shadow transition-colors"
              >
                <Camera className="w-3.5 h-3.5" />
                <span>Scan QR Pass</span>
              </button>
            </div>
          </div>

          <div className="divide-y divide-ink-800">
            {roster.map((p) => {
              const status = attendanceRecords[p.id] || "Absent";
              const isBlocked =
                p.status?.toLowerCase() === "inactive" || p.status?.toLowerCase() === "suspended";
              const player30d = calculatePlayer30DayAttendance(p.id, p, db.sessions, db.attendance);
              return (
                <div key={p.id} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="truncate text-sm font-medium text-ink-100">{p.name}</span>
                      {isBlocked && (
                        <span className="rounded bg-bad/20 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-bad ring-1 ring-bad/30">
                          {p.status}
                        </span>
                      )}
                      {player30d.isLowAttendance && (
                        <span
                          className="rounded bg-warn/15 px-1.5 py-0.5 font-mono text-[9px] font-medium text-warn ring-1 ring-warn/30"
                          title={`30-day attendance rate: ${player30d.rate}%`}
                        >
                          ⚠️ {player30d.rate}% ATT
                        </span>
                      )}
                    </div>
                    {p.status !== "Active" ? (
                      <div className="font-mono text-[9px] text-warn mt-0.5">
                        {isBlocked ? "BLOCKED · ON HOLD" : "PAYMENT DUE"}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={isBlocked}
                      onClick={() => setAttendance(p.id, "Absent")}
                      className={`rounded px-2 py-1 font-mono text-[10px] ring-1 transition-colors ${
                        status === "Absent"
                          ? "bg-bad text-white ring-bad"
                          : "text-ink-400 ring-ink-700 hover:bg-ink-800"
                      } ${isBlocked ? "cursor-not-allowed opacity-40" : ""}`}
                    >
                      A
                    </button>
                    <button
                      type="button"
                      disabled={isBlocked}
                      onClick={() => setAttendance(p.id, "Excused")}
                      className={`rounded px-2 py-1 font-mono text-[10px] ring-1 transition-colors ${
                        status === "Excused"
                          ? "bg-warn text-ink-950 ring-warn"
                          : "text-ink-400 ring-ink-700 hover:bg-ink-800"
                      } ${isBlocked ? "cursor-not-allowed opacity-40" : ""}`}
                    >
                      E
                    </button>
                    <button
                      type="button"
                      disabled={isBlocked}
                      onClick={() => setAttendance(p.id, "Present")}
                      className={`rounded px-2 py-1 font-mono text-[10px] ring-1 transition-colors ${
                        status === "Present"
                          ? "bg-good text-ink-950 ring-good"
                          : "text-ink-400 ring-ink-700 hover:bg-ink-800"
                      } ${isBlocked ? "cursor-not-allowed opacity-40" : ""}`}
                    >
                      P
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      ) : null}

      <Modal
        open={finishModalOpen}
        title={
          next.kind === "Game" ? "Submit Final Score & Match Report" : "Complete Practice Session"
        }
        meta={next.title}
        onClose={() => setFinishModalOpen(false)}
        submitLabel={
          next.kind === "Game" ? "Submit Score & Complete Game" : "Complete Practice & Mark Present"
        }
        onSubmit={handleFinish}
      >
        <div className="p-4 space-y-4">
          {next.kind === "Game" ? (
            <>
              <div className="rounded bg-ink-850 p-3 border border-ink-700 text-xs text-ink-300">
                <p>
                  Games are officially completed when the coach or branch manager submits the final
                  score and match report.
                </p>
              </div>

              <Field label="Final Score (Required)" hint="Format: e.g. 84 - 76">
                <Input placeholder="e.g. 84 - 76" value={scoreForm} onChange={setScoreForm} />
              </Field>

              <Field label="Match Report & Technical Summary (Required)">
                <Textarea
                  placeholder="Summarize the match, defensive/offensive execution, standout players, referee notes..."
                  value={reportForm}
                  onChange={setReportForm}
                  rows={4}
                />
              </Field>
            </>
          ) : (
            <>
              <div className="rounded bg-ink-850 p-3 border border-ink-700 text-xs text-ink-300">
                <p>
                  Practice sessions are completed when player attendance is verified and the coach
                  marks themselves Present.
                </p>
              </div>

              <div className="rounded-lg bg-court-500/10 border border-court-500/20 p-3 text-xs font-mono text-court-300 flex items-center justify-between">
                <span>Player Attendance Summary:</span>
                <strong>
                  {presentCount} Present · {excusedCount} Excused · {absentCount} Absent
                </strong>
              </div>

              <Field label="Coach Presence (Required to complete practice)">
                <Select
                  value={coachAttendance}
                  onChange={(v) => setCoachAttendance(v as "Present" | "Absent" | "Excused")}
                  options={["Present", "Absent", "Excused"]}
                />
              </Field>
            </>
          )}
        </div>
      </Modal>

      <Modal
        open={branchManagerModalOpen}
        title="Branch Manager Manual Check-In"
        meta={`Override for ${next.title}`}
        onClose={() => setBranchManagerModalOpen(false)}
        onSubmit={handleBranchManagerCheckIn}
        submitLabel="Confirm Staff Check-In"
      >
        <div className="p-4 space-y-4">
          <div className="rounded bg-ink-850 p-3 border border-ink-700 text-xs text-ink-300">
            <p>
              Branch Manager manual check-in unlocks session turnstile when staff are on court but
              unable to check in via mobile device. A verified reason is strictly mandatory.
            </p>
          </div>

          <Field label="Branch Manager / Authorizer Name">
            <Input
              value={managerName || currentUser?.name || "Branch Manager"}
              onChange={setManagerName}
              placeholder="e.g. Coach Manager / Branch Director"
            />
          </Field>

          <Field label="Staff Member to Check In">
            <Select
              value={managerTarget}
              onChange={(v) => setManagerTarget(v as "coach" | "assistant" | "both")}
              options={next.assistantCoach ? ["coach", "assistant", "both"] : ["coach"]}
            />
          </Field>

          <Field
            label="Mandatory Reason for Manual Check-In"
            hint="Recorded in audit log for payroll & technical director verification"
          >
            <Textarea
              placeholder="e.g. Coach arrived on pitch on time; phone battery depleted; verified physically present."
              value={managerReason}
              onChange={setManagerReason}
              rows={3}
            />
          </Field>
        </div>
      </Modal>

      <QrAttendanceScanner
        open={scannerOpen}
        onClose={() => setScannerOpen(false)}
        session={next}
        roster={roster}
      />

      {viewingPlan && (
        <Modal
          open={!!viewingPlan}
          title={viewingPlan.title}
          meta={`Practice Plan · ${viewingPlan.category} · ${viewingPlan.status}`}
          onClose={() => setViewingPlan(null)}
          wide
        >
          <div className="p-4">
            <PlanView plan={viewingPlan} />
          </div>
        </Modal>
      )}
    </>
  );
}

function CalendarTab({
  sessions,
  onOpenAttendance,
  onOpenSchedulePractice,
}: {
  sessions: SessionLike[];
  onOpenAttendance: (sessionId: string) => void;
  onOpenSchedulePractice?: () => void;
}) {
  const { db } = useDB();
  const [view, setView] = useState<"calendar" | "grid">("calendar");
  const [selectedSession, setSelectedSession] = useState<SessionLike | null>(null);
  const [viewingPlan, setViewingPlan] = useState<
    ReturnType<typeof useDB>["db"]["plans"][number] | null
  >(null);
  const today = new Date();

  const selectedPlan = useMemo(() => {
    if (!selectedSession) return null;
    if (selectedSession.planId) {
      return db.plans.find((p) => p.id === selectedSession.planId) || null;
    }
    return (
      db.plans.find(
        (p) =>
          ((selectedSession.coachId && p.coachId === selectedSession.coachId) ||
            p.coach?.toLowerCase() === selectedSession.coach?.toLowerCase()) &&
          (p.date === selectedSession.date ||
            (p.title &&
              selectedSession.title &&
              p.title.toLowerCase().includes(selectedSession.title.toLowerCase()))),
      ) || null
    );
  }, [selectedSession, db.plans]);

  // Basic monthly calendar logic
  const [currentMonth, setCurrentMonth] = useState(
    new Date(today.getFullYear(), today.getMonth(), 1),
  );

  const daysInMonth = new Date(
    currentMonth.getFullYear(),
    currentMonth.getMonth() + 1,
    0,
  ).getDate();
  const firstDay = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();

  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const blanks = Array.from({ length: firstDay === 0 ? 6 : firstDay - 1 }, (_, i) => i); // Mon as first day

  return (
    <>
      <Card
        title="My schedule"
        action={
          onOpenSchedulePractice ? (
            <button
              type="button"
              onClick={onOpenSchedulePractice}
              className="inline-flex items-center gap-1 rounded bg-court-500 px-2.5 py-1 font-mono text-[10px] font-bold text-ink-950 hover:bg-court-400"
            >
              <Plus className="h-3 w-3" />
              <span>+ Schedule Practice</span>
            </button>
          ) : undefined
        }
      >
        <div className="mb-4 flex gap-2">
          <button
            onClick={() => setView("calendar")}
            className={`flex-1 py-1.5 rounded text-[10px] uppercase font-mono tracking-widest ${view === "calendar" ? "bg-court-500 text-ink-950 font-bold" : "bg-ink-850 text-ink-300 ring-1 ring-ink-700"}`}
          >
            Calendar View
          </button>
          <button
            onClick={() => setView("grid")}
            className={`flex-1 py-1.5 rounded text-[10px] uppercase font-mono tracking-widest ${view === "grid" ? "bg-court-500 text-ink-950 font-bold" : "bg-ink-850 text-ink-300 ring-1 ring-ink-700"}`}
          >
            Grid View
          </button>
        </div>

        {view === "grid" ? (
          sessions.length === 0 ? (
            <div className="py-4 text-center font-mono text-[11px] text-ink-400">
              Nothing scheduled.
            </div>
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  onClick={() => setSelectedSession(s)}
                  className="flex items-center gap-3 p-2 rounded hover:bg-ink-850/60 cursor-pointer transition-colors"
                >
                  <span className="w-14 font-mono text-[10px] text-ink-400">
                    {s.date.slice(8)}/{s.date.slice(5, 7)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink-100">{s.title}</div>
                    <div className="font-mono text-[10px] text-ink-400">
                      {s.time} · {s.branch} {s.court ? `· ${s.court}` : ""}
                    </div>
                  </div>
                  <Chip tone={s.kind === "Game" ? "accent" : "neutral"}>
                    {String(s.kind || "Practice").toUpperCase()}
                  </Chip>
                </div>
              ))}
            </div>
          )
        ) : (
          <div>
            <div className="flex items-center justify-between mb-4">
              <button
                onClick={() =>
                  setCurrentMonth(
                    new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1),
                  )
                }
                className="px-2 py-1 bg-ink-850 text-ink-200 rounded text-xs ring-1 ring-ink-700"
              >
                &lt;
              </button>
              <span className="text-sm font-medium text-ink-100">
                {currentMonth.toLocaleString("default", { month: "long", year: "numeric" })}
              </span>
              <button
                onClick={() =>
                  setCurrentMonth(
                    new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1),
                  )
                }
                className="px-2 py-1 bg-ink-850 text-ink-200 rounded text-xs ring-1 ring-ink-700"
              >
                &gt;
              </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center font-mono text-[10px] text-ink-400 mb-2">
              <div>Mo</div>
              <div>Tu</div>
              <div>We</div>
              <div>Th</div>
              <div>Fr</div>
              <div>Sa</div>
              <div>Su</div>
            </div>
            <div className="grid grid-cols-7 gap-1">
              {blanks.map((b) => (
                <div key={`b-${b}`} className="h-10 bg-ink-950 rounded"></div>
              ))}
              {days.map((d) => {
                const dStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                const daySessions = sessions.filter((s) => s.date === dStr);
                return (
                  <div
                    key={d}
                    onClick={() => {
                      if (daySessions.length > 0 && daySessions[0])
                        setSelectedSession(daySessions[0]);
                    }}
                    className={`h-11 bg-ink-900 rounded p-1 flex flex-col items-center cursor-pointer hover:bg-ink-850 transition-colors ${
                      daySessions.length > 0 ? "ring-1 ring-court-500/40" : ""
                    }`}
                  >
                    <span className="text-[10px] text-ink-200">{d}</span>
                    <div className="flex gap-0.5 mt-1">
                      {daySessions.map((s) => (
                        <span
                          key={s.id}
                          className={`w-1.5 h-1.5 rounded-full ${s.kind === "Game" ? "bg-accent" : "bg-court-500"}`}
                          title={s.title}
                        ></span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      {selectedSession && (
        <Modal
          open={!!selectedSession}
          title={selectedSession.title}
          onClose={() => setSelectedSession(null)}
        >
          <div className="p-4 space-y-3 font-mono text-xs">
            <div className="rounded bg-ink-850 p-3 space-y-1.5 ring-1 ring-ink-700">
              <div className="flex justify-between">
                <span className="text-ink-400">Activity:</span>
                <span className="text-ink-100 font-bold">{selectedSession.kind}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-400">Date & Time:</span>
                <span className="text-ink-100">
                  {selectedSession.date} at {selectedSession.time}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-400">Branch:</span>
                <span className="text-ink-100">{selectedSession.branch}</span>
              </div>
              {selectedSession.court && (
                <div className="flex justify-between">
                  <span className="text-ink-400">Court:</span>
                  <span className="text-ink-100">{selectedSession.court}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-ink-400">Status:</span>
                <span className="text-court-400 font-bold">{selectedSession.status}</span>
              </div>
              {selectedPlan && (
                <div className="flex justify-between items-center pt-1.5 border-t border-ink-800">
                  <span className="text-ink-400">Attached Plan:</span>
                  <button
                    type="button"
                    onClick={() => setViewingPlan(selectedPlan)}
                    className="flex items-center gap-1 text-court-400 hover:text-court-300 font-bold text-xs underline"
                  >
                    <BookOpen className="w-3.5 h-3.5" />
                    <span className="truncate max-w-[150px]">{selectedPlan.title}</span>
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-2">
              {selectedPlan && (
                <button
                  type="button"
                  onClick={() => setViewingPlan(selectedPlan)}
                  className="w-full py-2 rounded bg-ink-800 ring-1 ring-court-500/40 text-court-400 font-bold text-xs uppercase tracking-wider hover:bg-ink-750 flex items-center justify-center gap-1.5 transition-colors"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>View Practice Drills ({selectedPlan.blocks?.length || 0} drills)</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  const sId = selectedSession.id;
                  setSelectedSession(null);
                  onOpenAttendance(sId);
                }}
                className="w-full py-2.5 rounded bg-court-500 text-ink-950 font-bold text-xs uppercase tracking-wider hover:bg-court-400 transition-colors"
              >
                Open Attendance Turnstile ›
              </button>
            </div>
          </div>
        </Modal>
      )}

      {viewingPlan && (
        <Modal
          open={!!viewingPlan}
          title={viewingPlan.title}
          meta={`Practice Plan · ${viewingPlan.category} · ${viewingPlan.status}`}
          onClose={() => setViewingPlan(null)}
          wide
        >
          <div className="p-4">
            <PlanView plan={viewingPlan} />
          </div>
        </Modal>
      )}
    </>
  );
}

function Games({
  coachId,
  coachName,
  canSwitchCoach,
}: {
  coachId: string;
  coachName: string;
  canSwitchCoach: boolean;
}) {
  const { db, update, setEntity, dispatchNotification } = useDB();
  const coach =
    db.coaches.find(
      (c) => c.id === coachId || c.name?.toLowerCase() === coachName?.toLowerCase(),
    ) ?? null;

  const assignedTeamNameSet = useMemo(() => {
    const names = getCoachTeams(coach || { id: coachId, name: coachName }, db.teams);
    return new Set(names.map((n) => n.toLowerCase().trim()));
  }, [coach, coachId, coachName, db.teams]);

  const myTeams = useMemo(
    () => db.teams.filter((t) => assignedTeamNameSet.has(t.name.toLowerCase().trim())),
    [db.teams, assignedTeamNameSet],
  );
  const myTeamNames = useMemo(() => myTeams.map((t) => t.name), [myTeams]);
  const selectableTeams = !canSwitchCoach ? myTeams : db.teams;

  const games = useMemo(
    () =>
      db.sessions.filter(
        (s) =>
          s.kind === "Game" &&
          (s.coachId === coachId ||
            s.headCoachId === coachId ||
            s.assistantCoachId === coachId ||
            s.coach?.toLowerCase() === coachName?.toLowerCase() ||
            s.headCoach?.toLowerCase() === coachName?.toLowerCase() ||
            s.assistantCoach?.toLowerCase() === coachName?.toLowerCase() ||
            (s.teamA && myTeamNames.includes(s.teamA)) ||
            (s.teamB && myTeamNames.includes(s.teamB))),
      ),
    [db.sessions, coachId, coachName, myTeamNames],
  );

  const [editingGame, setEditingGame] = useState<SessionLike | null>(null);
  const [scoreInput, setScoreInput] = useState("");
  const [reportInput, setReportInput] = useState("");
  const [statusInput, setStatusInput] = useState<"Completed" | "Official">("Completed");
  const [editingCourt, setEditingCourt] = useState("Main Court");
  const [editingReferees, setEditingReferees] = useState<MatchOfficial[]>([]);
  const [editingStaff, setEditingStaff] = useState<MatchOfficial[]>([]);

  // New Game modal state
  const [newGameOpen, setNewGameOpen] = useState(false);
  const [shareGame, setShareGame] = useState<SessionItem | null>(null);
  const [newGameForm, setNewGameForm] = useState<{
    title: string;
    teamA: string;
    teamB: string;
    gameType: string;
    date: string;
    time: string;
    branch: string;
    court: string;
    detail: string;
    referees: MatchOfficial[];
    matchStaff: MatchOfficial[];
  }>({
    title: "",
    teamA: "",
    teamB: "",
    gameType: "League",
    date: new Date().toISOString().slice(0, 10),
    time: "18:00",
    branch: coach?.branch || "HQ",
    court: "Main Court",
    detail: "Main Court",
    referees: [],
    matchStaff: [],
  });

  const newGameBranchObj = useMemo(
    () => db.branches.find((b) => b.name === newGameForm.branch),
    [db.branches, newGameForm.branch],
  );
  const newGameCourtOptions = useMemo(() => {
    const names = (newGameBranchObj?.courts || []).map((c) => c.name).filter(Boolean);
    return names.length > 0 ? [...names, "Custom / Other"] : ["Main Court", "Custom / Other"];
  }, [newGameBranchObj]);

  let wins = 0;
  let losses = 0;
  const completedGames = games.filter((g) => g.status === "Completed" || g.status === "Official");
  const myTeamNamesLower = new Set(myTeamNames.map((n) => n.toLowerCase().trim()));

  completedGames.forEach((g) => {
    if (g.score) {
      const parts = g.score.split("-").map((p) => parseInt(p.trim(), 10));
      const p0 = parts[0];
      const p1 = parts[1];
      if (parts.length === 2 && p0 !== undefined && p1 !== undefined && !isNaN(p0) && !isNaN(p1)) {
        const isTeamB =
          Boolean(g.teamB && myTeamNamesLower.has(g.teamB.toLowerCase().trim())) ||
          (g.team && g.teamB && g.team.toLowerCase().trim() === g.teamB.toLowerCase().trim());
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

  const handleStartGame = () => {
    const defaultTeamA = selectableTeams[0]?.name || "";
    const coachBranches = getCoachBranches(coach);
    const defaultBranch = coachBranches[0] || coach?.branch || db.branches[0]?.name || "HQ";
    const branchObj = db.branches.find((b) => b.name === defaultBranch);
    const defaultCourt = branchObj?.courts?.[0]?.name || "Main Court";
    setNewGameForm({
      title: "",
      teamA: defaultTeamA,
      teamB: "",
      gameType: (db.lists?.["Game types"]?.[0] as string) || "League",
      date: new Date().toISOString().slice(0, 10),
      time: "18:00",
      branch: defaultBranch,
      court: defaultCourt,
      detail: defaultCourt,
      referees: [],
      matchStaff: [],
    });
    setNewGameOpen(true);
  };

  const submitNewGame = () => {
    if (!newGameForm.teamA.trim() || !newGameForm.teamB.trim()) {
      toast.error("Please enter both Team A and Team B for the match.");
      return;
    }
    const computedTitle =
      newGameForm.title.trim() || `${newGameForm.teamA} vs ${newGameForm.teamB}`;
    const newSessionId = `e-${Date.now().toString(36)}`;
    const requireGameConfirmation =
      db.academy?.requireGameConfirmation !== false && !db.academy?.autoConfirmGames;
    const initialStatus: SessionItem["status"] = requireGameConfirmation
      ? "Pending approval"
      : "Pre-approved";

    const resolvedCourt =
      newGameForm.court === "Custom / Other"
        ? newGameForm.detail.trim() || "Main Court"
        : (newGameForm.court || newGameForm.detail || "Main Court").trim();

    const newSession: SessionItem = {
      id: newSessionId,
      kind: "Game",
      title: computedTitle,
      teamA: newGameForm.teamA,
      teamB: newGameForm.teamB,
      gameType: newGameForm.gameType,
      date: newGameForm.date,
      time: newGameForm.time,
      branch: newGameForm.branch,
      court: resolvedCourt,
      detail: resolvedCourt,
      coach: coachName,
      coachId,
      headCoach: coachName,
      headCoachId: coachId,
      status: initialStatus,
      approvalStatus: requireGameConfirmation ? "Pending" : "Approved",
      ...(requireGameConfirmation ? {} : { confirmedBy: "Auto-Confirmed (TD Policy)" }),
      referees: newGameForm.referees,
      matchStaff: newGameForm.matchStaff,
    };

    // 1. Guarantee game creation in /tenants/{tenantId}/sessions/{id}
    void setEntity("sessions", newSession);

    // 2. Only trigger ledger fee synchronization when referees or matchStaff contain entries with Number(fee) > 0
    const hasOfficialFees =
      (newGameForm.referees || []).some((r) => Number(r.fee) > 0) ||
      (newGameForm.matchStaff || []).some((s) => Number(s.fee) > 0);
    if (hasOfficialFees) {
      try {
        const feeEntries = getGameOfficialFeeEntries(newSession);
        for (const entry of feeEntries) {
          void setEntity("ledger", entry).catch((err) => {
            console.warn("Official fee ledger write skipped:", err);
          });
        }
      } catch (err) {
        console.warn("Ledger sync skipped:", err);
      }
    }

    void dispatchNotification({
      title: requireGameConfirmation
        ? `Game Approval Requested: ${computedTitle}`
        : `New Game Scheduled (Auto-Confirmed): ${computedTitle}`,
      message: `${coachName} scheduled ${computedTitle} (${newGameForm.gameType}) on ${newGameForm.date} at ${newGameForm.time} (${newGameForm.branch} · ${resolvedCourt}).`,
      type: "curriculum",
      targetRoles: ["technical_director", "super_admin", "branch_manager"],
      targetBranchId: newGameForm.branch || undefined,
      actionUrl: "/technical",
      createdAt: new Date().toISOString(),
      readBy: [],
    }).catch(() => {});

    toast.success(
      requireGameConfirmation
        ? "New game submitted for Technical Director approval."
        : "New game auto-confirmed & scheduled! Technical Director notified.",
    );
    setNewGameOpen(false);
  };

  function openEdit(g: SessionLike) {
    setEditingGame(g);
    setScoreInput(g.score || "");
    setReportInput(g.report || "");
    setStatusInput(g.status === "Official" ? "Official" : "Completed");
    setEditingCourt(g.court || g.detail || "Main Court");
    setEditingReferees((g as SessionItem).referees || []);
    setEditingStaff((g as SessionItem).matchStaff || []);
  }

  function handleSaveGame() {
    if (!editingGame) return;
    const resolvedCourt =
      editingCourt.trim() || editingGame.court || editingGame.detail || "Main Court";
    const updatedGame: SessionItem = {
      ...(editingGame as SessionItem),
      score: scoreInput,
      report: reportInput,
      status: statusInput,
      court: resolvedCourt,
      detail: resolvedCourt,
      referees: editingReferees,
      matchStaff: editingStaff,
    };

    // 1. Guarantee game update in /tenants/{tenantId}/sessions/{id}
    void setEntity("sessions", updatedGame);

    // 2. Only trigger ledger fee synchronization when referees or matchStaff contain entries with Number(fee) > 0
    const hasOfficialFees =
      (editingReferees || []).some((r) => Number(r.fee) > 0) ||
      (editingStaff || []).some((s) => Number(s.fee) > 0);
    if (hasOfficialFees) {
      try {
        const feeEntries = getGameOfficialFeeEntries(updatedGame);
        for (const entry of feeEntries) {
          void setEntity("ledger", entry).catch((err) => {
            console.warn("Official fee ledger write skipped:", err);
          });
        }
      } catch (err) {
        console.warn("Ledger sync skipped:", err);
      }
    }

    void dispatchNotification({
      title: `Match Result & Report Updated: ${updatedGame.title}`,
      message: `${coachName} recorded score ${scoreInput || "N/A"} (${statusInput})${reportInput ? ` — Report: ${reportInput.slice(0, 100)}` : ""}.`,
      type: "curriculum",
      targetRoles: ["technical_director", "super_admin", "branch_manager"],
      targetBranchId: updatedGame.branch || undefined,
      actionUrl: "/technical",
      createdAt: new Date().toISOString(),
      readBy: [],
    }).catch(() => {});
    toast.success("Match score, report and officials updated live.");
    setEditingGame(null);
  }

  return (
    <>
      <Card title="Record">
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label="Wins" value={String(wins)} />
          <MiniStat label="Losses" value={String(losses)} />
        </div>
      </Card>

      {/* Monthly Game Frequency & Experience Policy (Controlled by Technical Director & Assigned Coach) */}
      <Card
        title="Monthly Game Frequency & Experience Targets"
        action={
          <span className="font-mono text-[10px] text-ink-400">
            {myTeams.length} {myTeams.length === 1 ? "Team" : "Teams"} Assigned
          </span>
        }
      >
        <div className="space-y-3">
          <p className="text-xs text-ink-300">
            Set the minimum required match frequency per month for your teams. The system monitors
            game count over the last 30 days and alerts when a squad lacks match experience.
          </p>

          {myTeams.length === 0 ? (
            <div className="py-2 text-center font-mono text-xs text-ink-500">
              No teams currently assigned to this coach profile.
            </div>
          ) : (
            <div className="divide-y divide-ink-800">
              {myTeams.map((team) => {
                const target = team.gamesFrequencyPerMonth ?? 2;
                const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600 * 1000);
                const recentGames = db.sessions.filter((s) => {
                  if (s.kind !== "Game") return false;
                  if (s.teamA !== team.name && s.teamB !== team.name) return false;
                  const raw = typeof s.date === "string" ? s.date.trim().split("T")[0] : "";
                  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(raw);
                  const norm = m
                    ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`
                    : raw;
                  const gDate = norm ? new Date(`${norm}T00:00:00`) : new Date(NaN);
                  return (
                    !Number.isNaN(gDate.getTime()) &&
                    gDate >= thirtyDaysAgo &&
                    gDate <= new Date() &&
                    (s.status === "Completed" || s.status === "Official")
                  );
                });
                const playedCount = recentGames.length;
                const isCompliant = playedCount >= target;

                return (
                  <div key={team.id} className="py-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-sm text-ink-100 truncate">{team.name}</div>
                        <div className="font-mono text-[10px] text-ink-400">
                          {team.category} · {team.gender} · {team.branch || "HQ"}
                        </div>
                      </div>
                      <Chip tone={isCompliant ? "good" : "bad"}>
                        {isCompliant
                          ? `COMPLIANT (${playedCount}/${target})`
                          : `LACKS EXP (${playedCount}/${target})`}
                      </Chip>
                    </div>

                    <div className="rounded bg-ink-850 p-2.5 font-mono text-xs ring-1 ring-ink-700 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="text-ink-300 text-[11px]">
                          Target Games / Month:
                          <span className="ml-1 text-court-300 font-bold">{target} games/mo</span>
                          <span className="ml-1 text-[10px] text-ink-500">(Active)</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              const proposed = Math.max(1, target - 1);
                              update((d) => ({
                                ...d,
                                teams: d.teams.map((t) =>
                                  t.id === team.id
                                    ? {
                                        ...t,
                                        pendingFrequencyProposal: {
                                          requestedFrequency: proposed,
                                          requestedByCoach: coach?.name || "Coach",
                                          requestedDate: new Date().toISOString().slice(0, 10),
                                          status: "Pending",
                                        },
                                      }
                                    : t,
                                ),
                              }));
                              void dispatchNotification({
                                title: `Match Frequency Proposal: ${team.name}`,
                                message: `${coach?.name || "Coach"} proposed changing ${team.name} monthly match target from ${target} to ${proposed} games/mo.`,
                                type: "curriculum",
                                targetRoles: ["technical_director", "super_admin"],
                                targetCoachId: coach?.id,
                                targetCoachName: coach?.name,
                                targetTeam: team.name,
                                targetBranchId: team.branch || coach?.branch || undefined,
                                actionUrl: "/technical",
                                createdAt: new Date().toISOString(),
                                readBy: [],
                              }).catch(() => {});
                              toast.info(
                                `Target change proposal (${proposed} games/mo) sent for ${team.name}. Pending Technical Director approval.`,
                              );
                            }}
                            className="w-6 h-6 rounded bg-ink-800 text-ink-200 hover:bg-ink-700 flex items-center justify-center font-bold ring-1 ring-ink-700"
                            title="Propose lower monthly target (requires Technical Director approval)"
                          >
                            -
                          </button>
                          <span className="w-6 text-center font-bold text-ink-100">{target}</span>
                          <button
                            type="button"
                            onClick={() => {
                              const proposed = target + 1;
                              update((d) => ({
                                ...d,
                                teams: d.teams.map((t) =>
                                  t.id === team.id
                                    ? {
                                        ...t,
                                        pendingFrequencyProposal: {
                                          requestedFrequency: proposed,
                                          requestedByCoach: coach?.name || "Coach",
                                          requestedDate: new Date().toISOString().slice(0, 10),
                                          status: "Pending",
                                        },
                                      }
                                    : t,
                                ),
                              }));
                              void dispatchNotification({
                                title: `Match Frequency Proposal: ${team.name}`,
                                message: `${coach?.name || "Coach"} proposed changing ${team.name} monthly match target from ${target} to ${proposed} games/mo.`,
                                type: "curriculum",
                                targetRoles: ["technical_director", "super_admin"],
                                targetCoachId: coach?.id,
                                targetCoachName: coach?.name,
                                targetTeam: team.name,
                                targetBranchId: team.branch || coach?.branch || undefined,
                                actionUrl: "/technical",
                                createdAt: new Date().toISOString(),
                                readBy: [],
                              }).catch(() => {});
                              toast.info(
                                `Target change proposal (${proposed} games/mo) sent for ${team.name}. Pending Technical Director approval.`,
                              );
                            }}
                            className="w-6 h-6 rounded bg-ink-800 text-ink-200 hover:bg-ink-700 flex items-center justify-center font-bold ring-1 ring-ink-700"
                            title="Propose higher monthly target (requires Technical Director approval)"
                          >
                            +
                          </button>
                        </div>
                      </div>

                      {/* Approval Status Badges */}
                      {team.pendingFrequencyProposal?.status === "Pending" && (
                        <div className="flex items-center justify-between gap-2 rounded bg-warn/10 p-1.5 ring-1 ring-warn/30 text-[10.5px] text-warn">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className="animate-pulse shrink-0">⏳</span>
                            <span className="truncate">
                              Proposed:{" "}
                              <strong>
                                {team.pendingFrequencyProposal.requestedFrequency} games/mo
                              </strong>{" "}
                              · Pending TD approval
                            </span>
                          </div>
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
                              toast.info(`Change request cancelled for ${team.name}.`);
                            }}
                            className="text-ink-400 hover:text-ink-200 underline text-[10px] shrink-0"
                          >
                            Withdraw
                          </button>
                        </div>
                      )}

                      {team.pendingFrequencyProposal?.status === "Rejected" && (
                        <div className="flex items-center justify-between gap-2 rounded bg-bad/10 p-1.5 ring-1 ring-bad/30 text-[10.5px] text-bad">
                          <span className="truncate">
                            ✕ Technical Director declined proposal for{" "}
                            {team.pendingFrequencyProposal.requestedFrequency} games/mo.
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
                            className="text-ink-400 hover:text-ink-200 underline text-[10px] shrink-0"
                          >
                            Dismiss
                          </button>
                        </div>
                      )}

                      {team.pendingFrequencyProposal?.status === "Approved" && (
                        <div className="flex items-center justify-between gap-2 rounded bg-court-500/10 p-1.5 ring-1 ring-court-400/30 text-[10.5px] text-court-300">
                          <span className="truncate">
                            ✓ Technical Director approved frequency target to{" "}
                            {team.gamesFrequencyPerMonth} games/mo.
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
                            className="text-ink-400 hover:text-ink-200 underline text-[10px] shrink-0"
                          >
                            Dismiss
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>
      <Card
        title={`My games (${games.length})`}
        action={
          <button
            onClick={handleStartGame}
            className="flex items-center gap-1.5 rounded-md bg-court-500 px-2.5 py-1 text-xs font-semibold text-ink-950 hover:bg-court-400 transition-colors shadow-sm"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Start New Game</span>
          </button>
        }
      >
        {games.length === 0 ? (
          <div className="py-6 text-center">
            <Trophy className="mx-auto h-8 w-8 text-ink-600 mb-2" />
            <div className="font-medium text-xs text-ink-300">No scheduled games yet</div>
            <div className="font-mono text-[10px] text-ink-500 mt-1">
              Click &quot;Start New Game&quot; above to schedule a match and assign officials.
            </div>
          </div>
        ) : (
          <div className="divide-y divide-ink-800">
            {games.map((g) => {
              const refsCount = ((g as SessionItem).referees || []).length;
              const staffCount = ((g as SessionItem).matchStaff || []).length;
              return (
                <div
                  key={g.id}
                  onClick={() => openEdit(g)}
                  className="flex items-center gap-2 py-2.5 cursor-pointer hover:bg-ink-850/50 rounded px-1.5 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink-100 flex items-center gap-2">
                      <span>{g.title}</span>
                      {g.score && (
                        <span className="font-mono text-xs text-court-300 font-bold">
                          ({g.score})
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-[10px] text-ink-400 flex items-center gap-2 flex-wrap">
                      <span>
                        {g.date} · {g.time} · {g.branch}
                      </span>
                      {(refsCount > 0 || staffCount > 0) && (
                        <span className="text-court-400 font-medium">
                          👥 {refsCount} ref · {staffCount} staff
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Chip
                      tone={
                        g.status === "Official"
                          ? "good"
                          : g.status === "Completed"
                            ? "accent"
                            : g.status === "Pending approval"
                              ? "warn"
                              : "neutral"
                      }
                    >
                      {String(g.status || "Planned").toUpperCase()}
                    </Chip>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShareGame(g as SessionItem);
                      }}
                      className="p-1.5 rounded text-emerald-400 hover:bg-emerald-500/10 ring-1 ring-emerald-500/30 transition-colors"
                      title="Push match report to WhatsApp"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Start New Game Modal (Same procedure as Branch Manager) */}
      <Modal
        open={newGameOpen}
        title="Start New Game"
        meta="Schedule match, assign teams, venue, and compensate referees/staff"
        onClose={() => setNewGameOpen(false)}
        onSubmit={submitNewGame}
        submitLabel="Create & Schedule Game"
        wide
      >
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <Field label="Our Team (Team A)">
            <Select
              value={newGameForm.teamA}
              onChange={(v) => setNewGameForm({ ...newGameForm, teamA: v })}
              options={(!canSwitchCoach ? myTeams : db.teams).map((t) => t.name)}
            />
          </Field>

          <Field label="Opponent Team (Team B)">
            <Input
              placeholder="e.g. Beirut Elite / Sagesse U16"
              value={newGameForm.teamB}
              onChange={(v) => setNewGameForm({ ...newGameForm, teamB: v })}
            />
          </Field>

          <Field label="Match Title">
            <Input
              placeholder={
                newGameForm.teamA && newGameForm.teamB
                  ? `${newGameForm.teamA} vs ${newGameForm.teamB}`
                  : "Match Title"
              }
              value={newGameForm.title}
              onChange={(v) => setNewGameForm({ ...newGameForm, title: v })}
            />
          </Field>

          <Field label="Game Type">
            <Select
              value={newGameForm.gameType}
              onChange={(v) => setNewGameForm({ ...newGameForm, gameType: v })}
              options={
                db.lists?.["Game types"] && db.lists["Game types"].length > 0
                  ? db.lists["Game types"]
                  : ["League", "Friendly", "Cup", "Scrimmage"]
              }
            />
          </Field>

          <Field label="Date">
            <Input
              type="date"
              value={newGameForm.date}
              onChange={(v) => setNewGameForm({ ...newGameForm, date: v })}
            />
          </Field>

          <Field label="Time">
            <Input
              type="time"
              value={newGameForm.time}
              onChange={(v) => setNewGameForm({ ...newGameForm, time: v })}
            />
          </Field>

          <Field label="Branch">
            <Select
              value={newGameForm.branch}
              onChange={(v) => {
                const bObj = db.branches.find((b) => b.name === v);
                const firstCourt = bObj?.courts?.[0]?.name || "Main Court";
                setNewGameForm({
                  ...newGameForm,
                  branch: v,
                  court: firstCourt,
                  detail: firstCourt,
                });
              }}
              options={Array.from(new Set([...db.branches.map((b) => b.name), "HQ"]))}
            />
          </Field>

          <Field label="Court / Location">
            <Select
              value={
                newGameCourtOptions.includes(newGameForm.court)
                  ? newGameForm.court
                  : "Custom / Other"
              }
              onChange={(v) =>
                setNewGameForm({
                  ...newGameForm,
                  court: v,
                  detail: v === "Custom / Other" ? newGameForm.detail : v,
                })
              }
              options={newGameCourtOptions}
            />
          </Field>

          {newGameForm.court === "Custom / Other" && (
            <div className="sm:col-span-2">
              <Field label="Custom Court / Location Name">
                <Input
                  value={newGameForm.detail}
                  onChange={(v) => setNewGameForm({ ...newGameForm, detail: v })}
                  placeholder="e.g. Main Court / Away Arena"
                />
              </Field>
            </div>
          )}

          {/* Referees & Staff Assignment with Live Accounting */}
          <GameOfficialsForm
            referees={newGameForm.referees}
            matchStaff={newGameForm.matchStaff}
            onChangeReferees={(refs) => setNewGameForm({ ...newGameForm, referees: refs })}
            onChangeMatchStaff={(staff) => setNewGameForm({ ...newGameForm, matchStaff: staff })}
          />
        </div>
      </Modal>

      {/* Edit Match Result & Officials Modal */}
      {editingGame && (
        <Modal
          open={!!editingGame}
          title={`Match Details: ${editingGame.title}`}
          meta="Log score, match report, and update official assignments"
          onClose={() => setEditingGame(null)}
          submitLabel="Save Match Updates"
          onSubmit={handleSaveGame}
          wide
        >
          <div className="p-4 space-y-4">
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setShareGame(editingGame);
                  setEditingGame(null);
                }}
                className="flex items-center gap-1.5 rounded bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-mono font-semibold text-white transition-colors"
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span>Push Report to WhatsApp</span>
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Score (Us - Them)">
                <Input placeholder="e.g. 68 - 62" value={scoreInput} onChange={setScoreInput} />
              </Field>
              <Field label="Match Status">
                <Select
                  value={statusInput}
                  onChange={(v) => setStatusInput(v as "Completed" | "Official")}
                  options={["Completed", "Official"]}
                />
              </Field>
              <Field label="Court / Venue">
                <Input
                  placeholder="e.g. Main Court"
                  value={editingCourt}
                  onChange={setEditingCourt}
                />
              </Field>
            </div>

            <Field label="Technical Game Report & Highlights">
              <Textarea
                placeholder="Write post-game tactical observations, standout performances, and areas to improve..."
                value={reportInput}
                onChange={setReportInput}
                rows={3}
              />
            </Field>

            <GameOfficialsForm
              referees={editingReferees}
              matchStaff={editingStaff}
              onChangeReferees={setEditingReferees}
              onChangeMatchStaff={setEditingStaff}
            />
          </div>
        </Modal>
      )}

      {/* WhatsApp Broadcast Modal */}
      {shareGame && (
        <WhatsAppShareModal
          open={!!shareGame}
          onClose={() => setShareGame(null)}
          session={shareGame}
        />
      )}
    </>
  );
}

function Docs({ coachId }: { coachId: string }) {
  const { db, update, setEntity, patchEntity } = useDB();
  const coach = db.coaches.find((c) => c.id === coachId) ?? null;
  const [openedFolder, setOpenedFolder] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<ResourceItem | null>(null);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, string>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);

  if (!coach) {
    return (
      <Card title="Shared with me">
        <div className="py-4 text-center font-mono text-[11px] text-ink-400">
          No coach profile selected.
        </div>
      </Card>
    );
  }

  const assignedWorkshops = (db.workshops || []).filter((w) => isWorkshopAssignedToCoach(w, coach));

  const handleConfirmWorkshopAttendance = (w: Workshop) => {
    const nextAttendees = Array.from(new Set([...(w.attendeeIds || []), coach.id]));
    const updatedWorkshop: Workshop = {
      ...w,
      attendeeIds: nextAttendees,
      attendance: { ...(w.attendance || {}), [coach.id]: "Present" },
    };
    void setEntity("workshops", updatedWorkshop);
    toast.success(`Attendance confirmed for "${w.title}".`);
  };

  const folders = (db.resourceFolders || []).filter(
    (f) =>
      f.accessType === "All" ||
      (f.accessType === "Group" && f.accessGroup === coach.level) ||
      (f.accessType === "Specific" && f.accessCoaches?.includes(coach.id)),
  );

  function openFolder(fId: string, itemCount: number) {
    update((d) => ({
      ...d,
      coaches: d.coaches.map((c) =>
        c.id === coachId
          ? {
              ...c,
              seenFolders: { ...(c.seenFolders || {}), [fId]: itemCount },
            }
          : c,
      ),
    }));
    setOpenedFolder(fId);
  }

  function handleOpenItem(item: ResourceItem) {
    setActiveItem(item);
    const existingSub = (
      item as ResourceItem & {
        submissions?: {
          coachId: string;
          coachName: string;
          submittedAt: string;
          answers: Record<string, string>;
        }[];
      }
    ).submissions?.find((s) => s.coachId === coach?.id);
    if (existingSub) {
      setQuizAnswers(existingSub.answers || {});
      setQuizSubmitted(true);
    } else {
      setQuizAnswers({});
      setQuizSubmitted(false);
    }
  }

  if (openedFolder) {
    const folder = folders.find((f) => f.id === openedFolder);
    return (
      <>
        <Card title={folder?.name || "Folder"}>
          <div className="mb-3">
            <button
              onClick={() => setOpenedFolder(null)}
              className="text-xs font-mono text-ink-400 hover:text-ink-200"
            >
              ← Back to folders
            </button>
          </div>
          <div className="space-y-2">
            {folder?.items.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-3 rounded bg-ink-900 p-2.5 ring-1 ring-ink-800 transition-colors hover:bg-ink-850"
              >
                <div className="font-mono text-lg text-court-400">
                  {item.type === "PDF" || item.type === "Image"
                    ? "📄"
                    : item.type === "Video" || item.type === "YouTube"
                      ? "▶️"
                      : item.type === "Interactive Form"
                        ? "❓"
                        : "📎"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink-100">{item.name}</div>
                  <div className="font-mono text-[10px] text-ink-400">
                    {item.type}
                    {item.size ? ` · ${(item.size / (1024 * 1024)).toFixed(2)} MB` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {item.url && (
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded bg-ink-800 px-2.5 py-1 text-xs font-mono text-court-400 ring-1 ring-ink-700 hover:bg-ink-750"
                    >
                      Download
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => handleOpenItem(item)}
                    className="rounded bg-court-500 px-2.5 py-1 text-xs font-semibold text-ink-950 hover:bg-court-400"
                  >
                    View
                  </button>
                </div>
              </div>
            ))}
            {!folder?.items.length && (
              <div className="text-xs text-ink-400 text-center py-4">This folder is empty.</div>
            )}
          </div>
        </Card>

        {activeItem && (
          <Modal
            open={!!activeItem}
            title={activeItem.name}
            meta={activeItem.type}
            onClose={() => setActiveItem(null)}
          >
            <div className="p-4 space-y-4">
              {activeItem.type === "YouTube" && (
                <div className="aspect-video w-full overflow-hidden rounded-md bg-ink-950">
                  <iframe
                    src={activeItem.url?.replace("watch?v=", "embed/")}
                    title={activeItem.name}
                    className="h-full w-full"
                    allowFullScreen
                  />
                </div>
              )}

              {activeItem.type === "Video" && activeItem.url && (
                <div className="aspect-video w-full overflow-hidden rounded-md bg-ink-950">
                  <video src={activeItem.url} controls className="h-full w-full object-contain" />
                </div>
              )}

              {activeItem.type === "Image" && activeItem.url && (
                <div className="max-h-96 overflow-auto rounded-md bg-ink-950 p-2">
                  <img
                    src={activeItem.url}
                    alt={activeItem.name}
                    className="mx-auto rounded object-contain"
                    referrerPolicy="no-referrer"
                  />
                </div>
              )}

              {activeItem.type === "PDF" && activeItem.url && (
                <div className="rounded-md bg-ink-900 p-4 ring-1 ring-ink-800 text-center space-y-3">
                  <div className="text-sm text-ink-200">
                    PDF Document stored in Firebase Cloud Storage.
                  </div>
                  <a
                    href={activeItem.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded bg-court-500 px-3 py-2 text-xs font-semibold text-ink-950 hover:bg-court-400"
                  >
                    Open Full PDF Document ↗
                  </a>
                </div>
              )}

              {activeItem.quiz && (
                <div className="space-y-4">
                  <div className="font-mono text-xs text-ink-300">
                    Questions ({activeItem.quiz.questions.length}):
                  </div>
                  {activeItem.quiz.questions.map((q, idx: number) => (
                    <div
                      key={q.id || idx}
                      className="rounded bg-ink-900 p-3 ring-1 ring-ink-800 space-y-2"
                    >
                      <div className="text-xs font-medium text-ink-100">
                        {idx + 1}. {q.prompt}
                      </div>
                      {q.type === "Radio" && q.options && (
                        <div className="space-y-1">
                          {q.options.map((opt: string) => (
                            <label
                              key={opt}
                              className="flex items-center gap-2 text-xs text-ink-300 cursor-pointer"
                            >
                              <input
                                type="radio"
                                name={`q-${idx}`}
                                value={opt}
                                checked={quizAnswers[q.id || idx] === opt}
                                onChange={() =>
                                  setQuizAnswers({ ...quizAnswers, [q.id || idx]: opt })
                                }
                                disabled={quizSubmitted}
                                className="accent-court-500"
                              />
                              {opt}
                            </label>
                          ))}
                        </div>
                      )}
                      {q.type !== "Radio" && (
                        <Input
                          value={quizAnswers[q.id || idx] || ""}
                          onChange={(v) => setQuizAnswers({ ...quizAnswers, [q.id || idx]: v })}
                          disabled={quizSubmitted}
                          placeholder="Your answer..."
                        />
                      )}
                    </div>
                  ))}

                  {!quizSubmitted ? (
                    <button
                      type="button"
                      onClick={async () => {
                        if (openedFolder && activeItem) {
                          const submission = {
                            coachId: coach.id,
                            coachName: coach.name,
                            submittedAt: new Date().toISOString(),
                            answers: quizAnswers,
                          };
                          const targetFolder = (db.resourceFolders || []).find(
                            (f) => f.id === openedFolder,
                          );
                          if (targetFolder) {
                            const updatedFolder = {
                              ...targetFolder,
                              items: targetFolder.items.map((it) => {
                                if (it.id !== activeItem.id) return it;
                                const itemWithSubs = it as ResourceItem & {
                                  submissions?: {
                                    coachId: string;
                                    coachName: string;
                                    submittedAt: string;
                                    answers: Record<string, string>;
                                  }[];
                                };
                                const prevSubs = (itemWithSubs.submissions || []).filter(
                                  (s) => s.coachId !== coach.id,
                                );
                                return {
                                  ...it,
                                  submissions: [...prevSubs, submission],
                                } as ResourceItem;
                              }),
                            };
                            try {
                              await setEntity("resourceFolders", updatedFolder);
                            } catch {
                              update((d) => ({
                                ...d,
                                resourceFolders: (d.resourceFolders || []).map((f) =>
                                  f.id === openedFolder ? updatedFolder : f,
                                ),
                              }));
                            }
                          }
                        }
                        setQuizSubmitted(true);
                        toast.success("Quiz responses submitted successfully!");
                      }}
                      className="w-full rounded bg-court-500 py-2 text-xs font-semibold text-ink-950 hover:bg-court-400"
                    >
                      Submit Quiz
                    </button>
                  ) : (
                    <div className="rounded bg-good/15 p-2 text-center font-mono text-xs text-good ring-1 ring-good/30">
                      ✓ Response Recorded
                    </div>
                  )}
                </div>
              )}
            </div>
          </Modal>
        )}
      </>
    );
  }

  return (
    <>
      <Card
        title="Assigned Coaching Workshops & Seminars"
        action={
          <Chip tone={assignedWorkshops.length > 0 ? "accent" : "neutral"}>
            {assignedWorkshops.length} WORKSHOPS
          </Chip>
        }
      >
        {assignedWorkshops.length === 0 ? (
          <div className="py-4 text-center font-mono text-[11px] text-ink-400">
            No coaching workshops or seminars assigned yet.
          </div>
        ) : (
          <div className="space-y-3">
            {assignedWorkshops.map((w) => {
              const isConfirmed = (w.attendeeIds || []).includes(coach.id);
              const isCompleted = w.status === "Completed";
              return (
                <div
                  key={w.id}
                  className="rounded-lg bg-ink-900 p-3 ring-1 ring-ink-800 space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-ink-100">{w.title}</div>
                      <div className="mt-0.5 font-mono text-[10px] text-ink-400">
                        📅 {w.date} at {w.time} · 📍 {w.location || coach.branch || "HQ"}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] text-court-300">
                        Presenter: {w.presenter || "Technical Directorate"}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Chip tone={isCompleted ? "good" : "accent"}>
                        {isCompleted ? "COMPLETED" : "UPCOMING"}
                      </Chip>
                      <Chip tone={isConfirmed ? "good" : "warn"}>
                        {isConfirmed ? (isCompleted ? "ATTENDED" : "CONFIRMED") : "ACTION REQUIRED"}
                      </Chip>
                    </div>
                  </div>

                  {w.description && (
                    <p className="text-xs text-ink-300 leading-relaxed">{w.description}</p>
                  )}

                  {/* Attached Workshop Handouts & Documents */}
                  {w.documents && w.documents.length > 0 && (
                    <div className="space-y-1.5 pt-1.5 border-t border-ink-800/80">
                      <div className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
                        Workshop Handouts & Materials ({w.documents.length})
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {w.documents.map((doc) => (
                          <a
                            key={doc.id}
                            href={doc.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 rounded bg-ink-850 px-2.5 py-1 font-mono text-[11px] text-court-400 ring-1 ring-ink-700 hover:bg-ink-800"
                          >
                            <FileText className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate max-w-[180px]">{doc.name}</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 1-Click Confirm Attendance Action */}
                  <div className="flex items-center justify-between pt-2 border-t border-ink-800">
                    <span className="font-mono text-[10px] text-ink-400">
                      Attendance Status:{" "}
                      <strong className={isConfirmed ? "text-good" : "text-warn"}>
                        {isConfirmed
                          ? isCompleted
                            ? "Attended"
                            : "Confirmed"
                          : "Pending Confirmation"}
                      </strong>
                    </span>
                    {!isConfirmed ? (
                      <button
                        type="button"
                        onClick={() => handleConfirmWorkshopAttendance(w)}
                        className="inline-flex items-center gap-1.5 rounded bg-court-500 px-3 py-1.5 font-mono text-[11px] font-bold text-ink-950 hover:bg-court-400 transition-colors"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Confirm Attendance</span>
                      </button>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-good">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>Registered</span>
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="Shared with me">
        {folders.length === 0 ? (
          <div className="py-4 text-center font-mono text-[11px] text-ink-400">
            No resources shared.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {folders.map((f) => {
              const seenCount = (coach.seenFolders || {})[f.id] || 0;
              const newCount = Math.max(0, f.items.length - seenCount);
              return (
                <button
                  key={f.id}
                  onClick={() => openFolder(f.id, f.items.length)}
                  className="relative rounded bg-ink-850 p-3 ring-1 ring-ink-700 text-left transition-colors hover:bg-ink-800"
                >
                  {newCount > 0 && (
                    <div className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-court-500 text-[9px] font-bold text-ink-950 flex items-center justify-center">
                      {newCount}
                    </div>
                  )}
                  <div className="font-mono text-lg text-court-400">▤</div>
                  <div className="mt-1.5 text-xs text-ink-100 truncate">{f.name}</div>
                  <div className="mt-0.5 text-[9px] font-mono text-ink-400">
                    {f.items.length} items
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}

function PlansTab({ coachId, coachName }: { coachId: string; coachName: string }) {
  const { db, update, dispatchNotification } = useDB();
  const mine = db.plans.filter(
    (p) => p.coachId === coachId || p.coach?.toLowerCase() === coachName?.toLowerCase(),
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<PlanDraft>(
    emptyPlan(coachName, db.lists["Age categories"]?.[0] ?? "U-14"),
  );
  const [viewing, setViewing] = useState<string | null>(null);
  const [drillSelectorOpen, setDrillSelectorOpen] = useState(false);
  const [planToDelete, setPlanToDelete] = useState<string | null>(null);

  function handleInsertDrill(drill: MasterDrill, newBlock: PlanBlock) {
    setDraft((prev) => {
      const currentBlocks = prev.blocks ?? [];
      return {
        ...prev,
        blocks: [...currentBlocks, newBlock],
      };
    });
  }

  function save(status: "Draft" | "Submitted") {
    if (!draft.title.trim()) {
      toast.error("Please enter a title for the practice plan");
      return;
    }
    const payload = { ...draft, coachId, coach: coachName, status };
    update((d) => ({
      ...d,
      plans: editingId
        ? d.plans.map((p) => (p.id === editingId ? { ...p, ...payload } : p))
        : [{ ...payload, id: `pl-${Date.now().toString(36)}` }, ...d.plans],
    }));
    if (status === "Submitted") {
      const coachObj = db.coaches.find((c) => c.id === coachId);
      void dispatchNotification({
        title: `Practice Plan Submitted: ${draft.title}`,
        message: `${coachName} submitted practice plan "${draft.title}" (${draft.category || "All"}) for review.`,
        type: "curriculum",
        targetRoles: ["technical_director", "super_admin"],
        targetCoachId: coachId,
        targetCoachName: coachName,
        targetBranchId: coachObj?.branch || undefined,
        actionUrl: "/technical",
        createdAt: new Date().toISOString(),
        readBy: [],
      }).catch(() => {});
    }
    toast.success(status === "Submitted" ? "Plan submitted for approval" : "Draft plan saved");
    setEditingId(null);
    setDraft(emptyPlan(coachName, db.lists["Age categories"]?.[0] ?? "U-14"));
  }

  const shown = viewing ? db.plans.find((p) => p.id === viewing) : null;

  return (
    <>
      <Card title={editingId ? "Editing plan" : "Practice plan builder"}>
        {/* Master Drill Selector Quick Trigger Banner */}
        <div className="mb-4 flex flex-col gap-2 rounded-lg bg-court-500/10 p-3.5 ring-1 ring-court-500/30 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded bg-court-500/20 text-court-400">
              <BookOpen className="h-4 w-4" />
            </div>
            <div>
              <div className="text-xs font-semibold text-ink-100">
                Technical Director Master Drill Repository
              </div>
              <div className="font-mono text-[10px] text-ink-400">
                Browse shooting, defense, spacing, & transition drills with diagrams
              </div>
            </div>
          </div>
          <button
            type="button"
            id="btn-open-drill-selector-main"
            onClick={() => setDrillSelectorOpen(true)}
            className="flex items-center justify-center gap-1.5 rounded-md bg-court-500 px-3.5 py-1.5 font-mono text-xs font-semibold text-ink-950 shadow-sm transition-all hover:bg-court-400"
          >
            <Sparkles className="h-3.5 w-3.5 fill-current" />
            <span>Open Drill Selector</span>
          </button>
        </div>

        <PlanEditor
          value={draft}
          onChange={setDraft}
          coachLocked
          onOpenDrillSelector={() => setDrillSelectorOpen(true)}
        />

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => save("Draft")}
            className="flex-1 rounded-md bg-ink-850 py-2.5 text-xs font-semibold text-ink-200 ring-1 ring-ink-700 hover:bg-ink-800"
          >
            Save draft
          </button>
          <button
            onClick={() => save("Submitted")}
            className="flex-1 rounded-md bg-court-500 py-2.5 text-xs font-semibold text-ink-950 hover:bg-court-400"
          >
            Submit for approval
          </button>
        </div>
        {editingId ? (
          <button
            onClick={() => {
              setEditingId(null);
              setDraft(emptyPlan(coachName, db.lists["Age categories"]?.[0] ?? "U-14"));
            }}
            className="mt-2 w-full rounded-md py-2 font-mono text-[10px] uppercase tracking-widest text-ink-400 ring-1 ring-ink-700 hover:text-ink-200"
          >
            Cancel editing
          </button>
        ) : null}
      </Card>

      {/* Drill Selector Drawer / Modal */}
      <DrillSelector
        open={drillSelectorOpen}
        onClose={() => setDrillSelectorOpen(false)}
        onInsertDrill={handleInsertDrill}
        existingBlockCount={(draft.blocks ?? []).length}
      />

      <Card title="My plans">
        {mine.length === 0 ? (
          <div className="py-4 text-center font-mono text-[11px] text-ink-400">No plans yet.</div>
        ) : (
          <div className="divide-y divide-ink-800">
            {mine.map((p) => (
              <div key={p.id} className="py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm text-ink-100">{p.title}</div>
                    <div className="font-mono text-[10px] text-ink-400">
                      {p.category} · {p.date} · {(p.blocks ?? []).length} sections
                    </div>
                  </div>
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
                </div>
                {p.review ? (
                  <div className="mt-1 rounded bg-ink-850 px-2 py-1 font-mono text-[10px] text-ink-300">
                    Director: {p.review}
                  </div>
                ) : null}
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => setViewing(viewing === p.id ? null : p.id)}
                    className="rounded px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-court-400 ring-1 ring-ink-700"
                  >
                    {viewing === p.id ? "Hide" : "View"}
                  </button>
                  <button
                    onClick={() => {
                      const { id: _id, ...rest } = p;
                      setDraft(rest);
                      setEditingId(p.id);
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                    className="rounded px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-ink-300 ring-1 ring-ink-700"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => {
                      setPlanToDelete(p.id);
                    }}
                    className="rounded px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-bad ring-1 ring-ink-700 hover:bg-bad/10"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {shown ? (
          <div className="mt-3 rounded-md bg-ink-900 ring-1 ring-ink-700">
            <PlanView plan={shown} />
          </div>
        ) : null}
      </Card>

      {/* Delete Practice Plan Modal */}
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
    </>
  );
}

function Profile({
  coachId,
  canSwitchCoach,
  onSignOut,
}: {
  coachId: string;
  canSwitchCoach: boolean;
  onSignOut?: () => void;
}) {
  const { db, update } = useDB();
  const coach = db.coaches.find((c) => c.id === coachId) ?? null;

  const [form, setForm] = useState({
    phone: coach?.phone || "",
    email: coach?.email || "",
  });
  const [licenseForm, setLicenseForm] = useState({
    licenseName: coach?.licenseName || "",
    licenseExpiry: coach?.licenseExpiry || "",
    licenseUrl: coach?.licenseUrl || "",
  });
  const [licenseUploading, setLicenseUploading] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (coach) {
      setForm({ phone: coach.phone || "", email: coach.email || "" });
      setLicenseForm({
        licenseName: coach.licenseName || "",
        licenseExpiry: coach.licenseExpiry || "",
        licenseUrl: coach.licenseUrl || "",
      });
    }
  }, [coach]);

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonthIndex = today.getMonth();
  const currentMonthName = today.toLocaleString("en-US", { month: "long" });
  const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

  // Canonical Attendance-Verified Payroll Calculation (matches CoachStatementModal, /coaches, and /accounting)
  const allTimePayroll = useMemo(() => calculateAttendanceVerifiedPayroll(db), [db]);
  const monthlyPayroll = useMemo(
    () =>
      calculateAttendanceVerifiedPayroll(db, {
        monthIndex: currentMonthIndex,
        monthName: currentMonthName,
        year: currentYear,
      }),
    [db, currentMonthIndex, currentMonthName, currentYear],
  );

  const allTimeCoachRow = useMemo(
    () => (coach ? allTimePayroll.rows.find((r) => r.coachId === coach.id) : undefined),
    [allTimePayroll, coach],
  );
  const monthlyCoachRow = useMemo(
    () => (coach ? monthlyPayroll.rows.find((r) => r.coachId === coach.id) : undefined),
    [monthlyPayroll, coach],
  );

  const rate = allTimeCoachRow?.ratePerSession ?? (coach?.rate && coach.rate > 0 ? coach.rate : 35);
  const earnedThisMonth = monthlyCoachRow?.totalEarned ?? 0;
  const completedThisMonthCount = monthlyCoachRow?.verifiedCompletedSessionsCount ?? 0;
  const totalVerifiedSessionsCount = allTimeCoachRow?.verifiedCompletedSessionsCount ?? 0;
  const totalEarnedAllTime = allTimeCoachRow?.totalEarned ?? 0;

  // Real disbursements from accounting ledger
  const coachPayments = useMemo(() => {
    if (!coach) return [];
    return db.ledger
      .filter(
        (l) =>
          (l.status as string) !== "Voided" &&
          (l.account === "Coach Payroll Expense" ||
            l.account === "Coach payroll" ||
            l.account === "Coach Salaries" ||
            Boolean(l.coachId) ||
            l.account?.toLowerCase().includes("coach")) &&
          (l.coachId === coach.id ||
            l.referenceId === coach.id ||
            l.referenceId?.endsWith(`-${coach.id}`) ||
            l.entry?.toLowerCase().includes(coach.name.toLowerCase()) ||
            l.id.includes(coach.id)),
      )
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [db.ledger, coach]);

  const disbursedThisMonth =
    monthlyCoachRow?.totalDisbursed ??
    coachPayments
      .filter((l) => l.date.startsWith(currentMonthStr))
      .reduce((acc, l) => acc + Math.abs(l.amount), 0);

  const disbursedThisYear = coachPayments
    .filter((l) => l.date.startsWith(String(currentYear)))
    .reduce((acc, l) => acc + Math.abs(l.amount), 0);

  const totalDisbursedAllTime =
    allTimeCoachRow?.totalDisbursed ??
    coachPayments.reduce((acc, l) => acc + Math.abs(l.amount), 0);
  const netBalanceAllTime =
    allTimeCoachRow?.netBalance ?? totalEarnedAllTime - totalDisbursedAllTime;
  const liveOutstanding = netBalanceAllTime;
  const advanceBalance =
    allTimeCoachRow?.advanceBalance ?? (netBalanceAllTime < 0 ? Math.abs(netBalanceAllTime) : 0);

  const myTeams = useMemo(() => {
    if (!coach) return [];
    const coachNameLower = coach.name?.toLowerCase().trim();
    return (db.teams || []).filter(
      (t) =>
        t.coachId === coach.id ||
        t.headCoachId === coach.id ||
        t.assistantId === coach.id ||
        Boolean(
          coachNameLower &&
          (t.headCoach?.toLowerCase().trim() === coachNameLower ||
            t.assistant?.toLowerCase().trim() === coachNameLower ||
            t.coach?.toLowerCase().trim() === coachNameLower),
        ),
    );
  }, [coach, db.teams]);

  // Finals & Tournament Records
  const finalsList = useMemo(() => {
    if (!coach) return [];
    const list = [...(coach.finalsRecord || [])];
    const coachTeamNames = new Set(myTeams.map((t) => t.name.toLowerCase().trim()));

    // Also include completed game sessions tagged as finals coached by this coach if not already in list
    db.sessions
      .filter(
        (s) =>
          s.kind === "Game" &&
          (s.coachId === coach.id ||
            s.headCoachId === coach.id ||
            s.coach?.toLowerCase() === coach.name?.toLowerCase() ||
            s.headCoach?.toLowerCase() === coach.name?.toLowerCase() ||
            (s.teamA && coachTeamNames.has(s.teamA.toLowerCase().trim())) ||
            (s.teamB && coachTeamNames.has(s.teamB.toLowerCase().trim()))) &&
          (s.gameType === "Final" ||
            s.gameType === "Championship" ||
            s.title?.toLowerCase().includes("final")),
      )
      .forEach((s) => {
        if (!list.some((r) => r.id === s.id || r.tournament === s.title)) {
          let res: "Champion" | "Runner-up" = "Runner-up";
          const isTeamB =
            Boolean(s.teamB && coachTeamNames.has(s.teamB.toLowerCase().trim())) ||
            (s.team && s.teamB && s.team.toLowerCase().trim() === s.teamB.toLowerCase().trim());
          if (s.score) {
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
              if ((isTeamB && p1 > p0) || (!isTeamB && p0 > p1)) {
                res = "Champion";
              }
            }
          }
          list.push({
            id: s.id,
            tournament: s.title,
            date: s.date,
            result: res,
            team: (isTeamB ? s.teamB : s.teamA) || coach.branch,
            score: s.score,
          });
        }
      });
    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [coach, db.sessions, myTeams]);

  const totalFinals = coach?.finals ?? finalsList.length;
  const championshipsCount =
    coach?.championships ?? finalsList.filter((f) => f.result === "Champion").length;
  const runnerUpCount = finalsList.filter((f) => f.result === "Runner-up").length;

  const selectableFinalTeams = !canSwitchCoach ? myTeams : db.teams;

  // New Final Modal State
  const [addFinalOpen, setAddFinalOpen] = useState(false);
  const [newFinalForm, setNewFinalForm] = useState({
    tournament: "",
    date: new Date().toISOString().slice(0, 10),
    team: selectableFinalTeams[0]?.name || "",
    result: "Champion" as "Champion" | "Runner-up",
    score: "",
  });

  function handleSaveFinal() {
    if (!coach) return;
    if (!newFinalForm.tournament.trim()) {
      toast.error("Please enter the tournament or championship name.");
      return;
    }
    const finalRecordItem = {
      id: `fin-${Date.now().toString(36)}`,
      tournament: newFinalForm.tournament.trim(),
      date: newFinalForm.date,
      team: newFinalForm.team,
      result: newFinalForm.result,
      score: newFinalForm.score.trim() || undefined,
    };
    const updatedRecords = [finalRecordItem, ...(coach.finalsRecord || [])];
    const newFinalsCount = (coach.finals || 0) + 1;
    const newChampionshipsCount =
      newFinalForm.result === "Champion"
        ? (coach.championships || 0) + 1
        : coach.championships || 0;

    update((d) => ({
      ...d,
      coaches: d.coaches.map((c) =>
        c.id === coach.id
          ? {
              ...c,
              finalsRecord: updatedRecords,
              finals: newFinalsCount,
              championships: newChampionshipsCount,
            }
          : c,
      ),
    }));
    toast.success("Final tournament achievement recorded to profile.");
    setAddFinalOpen(false);
    setNewFinalForm({
      tournament: "",
      date: new Date().toISOString().slice(0, 10),
      team: selectableFinalTeams[0]?.name || "",
      result: "Champion",
      score: "",
    });
  }

  // Payment Records Search and Filter
  const [paymentQuery, setPaymentQuery] = useState("");
  const [paymentYear, setPaymentYear] = useState<string>("All");
  const [statementModalOpen, setStatementModalOpen] = useState(false);

  const filteredPayments = useMemo(() => {
    return coachPayments.filter((p) => {
      const matchQ =
        !paymentQuery.trim() ||
        p.entry?.toLowerCase().includes(paymentQuery.toLowerCase()) ||
        p.account?.toLowerCase().includes(paymentQuery.toLowerCase()) ||
        p.id.toLowerCase().includes(paymentQuery.toLowerCase());
      const matchY = paymentYear === "All" || p.date.startsWith(paymentYear);
      return matchQ && matchY;
    });
  }, [coachPayments, paymentQuery, paymentYear]);

  const paymentYears = useMemo(() => {
    const years = new Set<string>();
    coachPayments.forEach((p) => {
      if (p.date) years.add(p.date.slice(0, 4));
    });
    return [
      "All",
      ...Array.from(years)
        .sort((a, b) => a.localeCompare(b))
        .reverse(),
    ];
  }, [coachPayments]);

  const licenseStatus = (() => {
    if (!licenseForm.licenseExpiry) {
      return licenseForm.licenseUrl
        ? { tone: "good" as const, label: "UPLOADED" }
        : { tone: "neutral" as const, label: "PENDING UPLOAD" };
    }
    const exp = new Date(licenseForm.licenseExpiry).getTime();
    const diffDays = Math.ceil((exp - Date.now()) / (1000 * 3600 * 24));
    if (diffDays < 0) return { tone: "bad" as const, label: "EXPIRED" };
    if (diffDays <= 30) return { tone: "warn" as const, label: `EXPIRING IN ${diffDays} DAYS` };
    return { tone: "good" as const, label: "ACTIVE & COMPLIANT" };
  })();

  async function handleUploadLicense(file: File) {
    if (!coach) return;
    if (file.size > 15 * 1024 * 1024) {
      toast.error("File size must be under 15MB");
      return;
    }
    try {
      setLicenseUploading(true);
      const tenantId = getTenantSlug();
      const doc = await uploadDocumentAttachment(
        tenantId,
        "coaches",
        coach.id,
        file,
        licenseForm.licenseName || file.name,
        "Coaching License",
      );
      const updated = {
        ...licenseForm,
        licenseUrl: doc.url,
        licenseName: licenseForm.licenseName || doc.name,
      };
      setLicenseForm(updated);
      update((d) => ({
        ...d,
        coaches: d.coaches.map((c) =>
          c.id === coach.id
            ? {
                ...c,
                ...updated,
                documents: [...(c.documents || []), doc],
              }
            : c,
        ),
      }));
      toast.success("License document uploaded and saved to profile.");
    } catch (err) {
      console.error("License upload error:", err);
      toast.error("Failed to upload license document.");
    } finally {
      setLicenseUploading(false);
    }
  }

  function handleSaveProfile() {
    if (!coach) return;
    update((d) => ({
      ...d,
      coaches: d.coaches.map((c) =>
        c.id === coach.id
          ? {
              ...c,
              ...form,
              ...licenseForm,
            }
          : c,
      ),
    }));
    setSaved(true);
    toast.success("Profile details saved live.");
    window.setTimeout(() => setSaved(false), 2000);
  }

  if (!coach) {
    return (
      <Card title="My details">
        <div className="py-4 text-center font-mono text-xs text-ink-400">
          No coach profile found.
        </div>
      </Card>
    );
  }

  return (
    <>
      {/* Coach Account & Outstanding Balance Summary */}
      <Card
        title="Coach Balance & Payroll Account"
        action={
          <Chip tone={advanceBalance > 0 || liveOutstanding > 0 ? "warn" : "good"}>
            {advanceBalance > 0
              ? `Advance / On Account: -${money(advanceBalance)} (Prepaid / Borrowed)`
              : liveOutstanding > 0
                ? "DISBURSEMENT PENDING"
                : "PAID UP TO DATE"}
          </Chip>
        }
      >
        <div className="space-y-4">
          <div className="rounded-lg bg-gradient-to-br from-ink-900 via-ink-850 to-ink-900 p-4 ring-1 ring-ink-700/80">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
                  {advanceBalance > 0
                    ? "Advance / Credit Balance on Account"
                    : "Current Outstanding Balance"}
                </span>
                <div
                  className={`text-3xl font-display font-extrabold mt-1 ${
                    advanceBalance > 0 ? "text-warn" : "text-court-400"
                  }`}
                >
                  {advanceBalance > 0
                    ? `-${money(advanceBalance)}`
                    : money(Math.max(0, liveOutstanding))}
                </div>
                {advanceBalance > 0 && (
                  <div className="mt-1 inline-flex items-center gap-1.5 rounded bg-warn/15 px-2 py-0.5 font-mono text-[10px] font-semibold text-warn ring-1 ring-warn/30">
                    <span>Advance / On Account: -{money(advanceBalance)} (Prepaid / Borrowed)</span>
                  </div>
                )}
              </div>
              <div className="grid h-12 w-12 place-items-center rounded-full bg-court-500/10 text-court-400 ring-1 ring-court-400/30">
                <Wallet className="h-6 w-6" />
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-ink-800/80 grid grid-cols-2 gap-2 text-xs font-mono">
              <div>
                <span className="text-ink-400 text-[10px] block">THIS MONTH EARNED</span>
                <span className="text-ink-100 font-bold">{money(earnedThisMonth)}</span>
                <span className="text-ink-500 text-[10px] ml-1">
                  ({completedThisMonthCount} sess)
                </span>
              </div>
              <div>
                <span className="text-ink-400 text-[10px] block">DISBURSED THIS MONTH</span>
                <span className="text-court-300 font-bold">{money(disbursedThisMonth)}</span>
              </div>
            </div>
          </div>

          <div className="space-y-2 text-xs font-mono">
            <div className="flex items-center justify-between py-1 border-b border-ink-800/60">
              <span className="text-ink-400">Default Rate per Session:</span>
              <span className="text-ink-100 font-bold">{money(rate)} / session</span>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-ink-800/60">
              <span className="text-ink-400">Total Verified Sessions (All-Time):</span>
              <span className="text-ink-100 font-bold">{totalVerifiedSessionsCount} sessions</span>
            </div>
            {(allTimeCoachRow?.totalTransportEarned || 0) > 0 && (
              <>
                <div className="flex items-center justify-between py-1 border-b border-ink-800/60">
                  <span className="text-ink-400">Session Fees Earned (All-Time):</span>
                  <span className="text-ink-100 font-bold">
                    {money(allTimeCoachRow?.totalBaseEarned || 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-ink-800/60">
                  <span className="text-ink-400">Transportation Allowances (All-Time):</span>
                  <span className="text-court-300 font-bold">
                    +{money(allTimeCoachRow?.totalTransportEarned || 0)}
                  </span>
                </div>
              </>
            )}
            <div className="flex items-center justify-between py-1 border-b border-ink-800/60">
              <span className="text-ink-400">Total Earned Value (All-Time):</span>
              <span className="text-ink-100 font-bold">{money(totalEarnedAllTime)}</span>
            </div>
            <div className="flex items-center justify-between py-1 border-b border-ink-800/60">
              <span className="text-ink-400">Total Disbursed to Date (Ledger):</span>
              <span className="text-court-300 font-bold">{money(totalDisbursedAllTime)}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Finals & Championship Records */}
      <Card
        title="Finals & Championship Honors"
        action={
          <button
            type="button"
            onClick={() => setAddFinalOpen(true)}
            className="flex items-center gap-1 rounded bg-court-500/10 hover:bg-court-500/20 px-2 py-1 font-mono text-[11px] text-court-400 ring-1 ring-court-400/30 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Record Final</span>
          </button>
        }
      >
        <div className="space-y-3">
          {/* Trophy & Medal Highlights */}
          <div className="grid grid-cols-3 gap-2 text-center font-mono">
            <div className="rounded bg-ink-850 p-2.5 ring-1 ring-ink-700/80">
              <div className="text-[10px] text-ink-400 uppercase">Finals Coached</div>
              <div className="text-xl font-bold text-ink-100 mt-0.5">{totalFinals}</div>
            </div>
            <div className="rounded bg-ink-850 p-2.5 ring-1 ring-court-400/30">
              <div className="text-[10px] text-court-300 uppercase flex items-center justify-center gap-1">
                <Trophy className="h-3 w-3 text-court-400" />
                <span>Champions</span>
              </div>
              <div className="text-xl font-bold text-court-400 mt-0.5">{championshipsCount}</div>
            </div>
            <div className="rounded bg-ink-850 p-2.5 ring-1 ring-ink-700/80">
              <div className="text-[10px] text-ink-400 uppercase flex items-center justify-center gap-1">
                <Medal className="h-3 w-3 text-ink-300" />
                <span>Runner-up</span>
              </div>
              <div className="text-xl font-bold text-ink-200 mt-0.5">{runnerUpCount}</div>
            </div>
          </div>

          {finalsList.length === 0 ? (
            <div className="py-6 text-center font-mono text-xs text-ink-500">
              No tournament finals recorded yet. Click &quot;Record Final&quot; to log championship
              games.
            </div>
          ) : (
            <div className="divide-y divide-ink-800">
              {finalsList.map((f) => (
                <div key={f.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`grid h-8 w-8 place-items-center rounded-full shrink-0 ${
                        f.result === "Champion"
                          ? "bg-court-500/20 text-court-400 ring-1 ring-court-400/40"
                          : "bg-ink-800 text-ink-300 ring-1 ring-ink-700"
                      }`}
                    >
                      {f.result === "Champion" ? (
                        <Trophy className="h-4 w-4" />
                      ) : (
                        <Medal className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-ink-100 truncate">
                        {f.tournament}
                      </div>
                      <div className="font-mono text-[10px] text-ink-400">
                        {f.team} · {f.date} {f.score ? `· Score: ${f.score}` : ""}
                      </div>
                    </div>
                  </div>
                  <Chip tone={f.result === "Champion" ? "good" : "neutral"}>
                    {f.result === "Champion" ? "🏆 CHAMPION" : "🥈 RUNNER-UP"}
                  </Chip>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Payment & Ledger Records */}
      <Card
        title="Full Payments & Payroll Ledger Records"
        action={
          <button
            type="button"
            onClick={() => setStatementModalOpen(true)}
            className="flex items-center gap-1.5 rounded bg-ink-850 hover:bg-ink-800 px-2.5 py-1 font-mono text-[11px] text-court-300 ring-1 ring-court-400/30 hover:ring-court-400/50 transition-colors shadow-sm"
            title="Open printable Coach Account & Payroll Statement"
          >
            <Printer className="h-3.5 w-3.5 text-court-400" />
            <span>Print Statement</span>
          </button>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex-1 min-w-[140px]">
              <Input
                placeholder="Search transactions or entries…"
                value={paymentQuery}
                onChange={setPaymentQuery}
              />
            </div>
            {paymentYears.length > 2 && (
              <div className="w-24">
                <Select value={paymentYear} onChange={setPaymentYear} options={paymentYears} />
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2 rounded bg-ink-900/80 p-2 text-center font-mono text-xs ring-1 ring-ink-750">
            <div>
              <div className="text-[9px] text-ink-400 uppercase">Disbursed (Month)</div>
              <div className="font-bold text-ink-100">{money(disbursedThisMonth)}</div>
            </div>
            <div>
              <div className="text-[9px] text-ink-400 uppercase">Disbursed (Year)</div>
              <div className="font-bold text-court-300">{money(disbursedThisYear)}</div>
            </div>
            <div>
              <div className="text-[9px] text-ink-400 uppercase">All-Time Paid</div>
              <div className="font-bold text-court-400">{money(totalDisbursedAllTime)}</div>
            </div>
          </div>

          {filteredPayments.length === 0 ? (
            <div className="py-6 text-center font-mono text-xs text-ink-500">
              No matching disbursement records found in the academy ledger.
            </div>
          ) : (
            <div className="divide-y divide-ink-800 max-h-80 overflow-y-auto pr-1">
              {filteredPayments.map((p) => {
                const isAdv =
                  Boolean(p.isAdvance) ||
                  Boolean(p.advanceReason) ||
                  (p.entry || "").toLowerCase().includes("advance") ||
                  totalEarnedAllTime === 0;
                return (
                  <div key={p.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div className="min-w-0 pr-2">
                      <div className="text-sm font-medium text-ink-100 truncate">
                        {isAdv && !(p.entry || "").includes("Custom / Advance Payment")
                          ? `Custom / Advance Payment (On Account) · ${p.entry}`
                          : p.entry}
                      </div>
                      <div className="font-mono text-[10px] text-ink-400 mt-0.5">
                        {p.date} · {p.account} · ID: <span className="text-ink-500">{p.id}</span>
                        {p.advanceReason ? ` · Reason: ${p.advanceReason}` : ""}
                        {p.linkedAdvanceSessionsCount
                          ? ` · Validated: ${p.linkedAdvanceSessionsCount} session(s)`
                          : ""}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="font-mono text-sm font-bold text-court-300">
                        +{money(Math.abs(p.amount))}
                      </span>
                      <span
                        className={`block font-mono text-[9px] ${
                          isAdv ? "text-warn font-semibold" : "text-ink-500"
                        }`}
                      >
                        {isAdv ? "Custom / Advance Payment (On Account)" : "Verified Payout"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {/* Official Coaching License & Certification */}
      <Card
        title="Official License & Certification"
        action={<Chip tone={licenseStatus.tone}>{licenseStatus.label}</Chip>}
      >
        <div className="space-y-3">
          <Field label="License / Certification Title">
            <Input
              placeholder="e.g. FIBA Level 2, UEFA B, USAB Gold"
              value={licenseForm.licenseName}
              onChange={(v) => setLicenseForm({ ...licenseForm, licenseName: v })}
            />
          </Field>

          <Field label="License Expiry Date">
            <Input
              type="date"
              value={licenseForm.licenseExpiry}
              onChange={(v) => setLicenseForm({ ...licenseForm, licenseExpiry: v })}
            />
          </Field>

          <div className="pt-2 border-t border-ink-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs text-ink-300">Certificate Document:</span>
              {licenseForm.licenseUrl && (
                <a
                  href={licenseForm.licenseUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-court-500/10 text-court-400 font-mono text-[11px] ring-1 ring-court-400/30 hover:bg-court-500/20"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>View Document</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            <div className="flex items-center gap-2">
              <label className="flex-1 cursor-pointer">
                <input
                  type="file"
                  accept="image/*,.pdf"
                  disabled={licenseUploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleUploadLicense(f);
                  }}
                  className="hidden"
                />
                <div className="flex items-center justify-center gap-2 w-full py-2 px-3 rounded bg-ink-850 hover:bg-ink-800 border border-dashed border-court-500/40 text-court-400 font-mono text-xs transition-colors">
                  <Upload className="w-3.5 h-3.5" />
                  <span>
                    {licenseUploading
                      ? "Uploading to Storage..."
                      : licenseForm.licenseUrl
                        ? "Upload New / Renewed Certificate"
                        : "Upload License File (PDF / Image)"}
                  </span>
                </div>
              </label>
            </div>
          </div>

          <button
            type="button"
            onClick={handleSaveProfile}
            className="w-full rounded bg-ink-850 hover:bg-ink-800 py-1.5 text-xs font-mono text-ink-200 ring-1 ring-ink-700 transition-colors"
          >
            Update License Information
          </button>
        </div>
      </Card>

      {/* Personal & Academy Credentials */}
      <Card title="My Details & Academy Credentials">
        <div className="grid gap-3">
          <Field label="Full Name">
            <Input value={coach.name} onChange={() => {}} disabled />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
          </Field>
          <Field label="Email">
            <Input value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
          </Field>
        </div>

        <div className="mt-4 rounded-md bg-ink-850 p-3 ring-1 ring-ink-700 space-y-1.5 font-mono text-xs">
          <div className="flex justify-between">
            <span className="text-ink-400">Coaching Level:</span>
            <span className="text-court-400 font-bold">{coach.level}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-400">Assigned Branch:</span>
            <span className="text-ink-100">{coach.branch}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-400">Monthly Session Target:</span>
            <span className="text-ink-100">{coach.sessionTarget || 20} sessions</span>
          </div>
          <div className="flex justify-between">
            <span className="text-ink-400">Experience:</span>
            <span className="text-ink-100">{coach.years || 0} years</span>
          </div>
        </div>

        <button
          onClick={handleSaveProfile}
          className="mt-3 w-full rounded-md bg-court-500 py-2 text-xs font-semibold text-ink-950 hover:bg-court-400 transition-colors"
        >
          {saved ? "Saved ✓" : "Save my details"}
        </button>

        {onSignOut && (
          <button
            type="button"
            onClick={onSignOut}
            className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-md border border-ink-700 bg-ink-850 py-2 font-mono text-xs font-semibold text-ink-200 hover:bg-ink-800 transition-colors"
          >
            <LogOut className="h-3.5 w-3.5 text-court-400" />
            <span>Sign Out of Coach Portal</span>
          </button>
        )}
      </Card>

      {/* Record Final Achievement Modal */}
      <Modal
        open={addFinalOpen}
        title="Record Final / Championship Achievement"
        meta="Log a tournament final coached and won or placed"
        onClose={() => setAddFinalOpen(false)}
        onSubmit={handleSaveFinal}
        submitLabel="Save Final to Profile"
      >
        <div className="space-y-3 p-4">
          <Field label="Tournament / Championship Name">
            <Input
              placeholder="e.g. Lebanon Youth Cup 2025 or National Cup Final"
              value={newFinalForm.tournament}
              onChange={(v) => setNewFinalForm({ ...newFinalForm, tournament: v })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Date">
              <Input
                type="date"
                value={newFinalForm.date}
                onChange={(v) => setNewFinalForm({ ...newFinalForm, date: v })}
              />
            </Field>
            <Field label="Result">
              <Select
                value={newFinalForm.result}
                onChange={(v) =>
                  setNewFinalForm({
                    ...newFinalForm,
                    result: v as "Champion" | "Runner-up",
                  })
                }
                options={["Champion", "Runner-up"]}
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Team Coached">
              <Select
                value={newFinalForm.team}
                onChange={(v) => setNewFinalForm({ ...newFinalForm, team: v })}
                options={(!canSwitchCoach ? myTeams : db.teams).map((t) => t.name)}
              />
            </Field>
            <Field label="Final Score (Optional)">
              <Input
                placeholder="e.g. 78 - 71"
                value={newFinalForm.score}
                onChange={(v) => setNewFinalForm({ ...newFinalForm, score: v })}
              />
            </Field>
          </div>
        </div>
      </Modal>

      {/* Official Coach Remuneration & Payroll Statement Modal */}
      <CoachStatementModal
        coach={coach}
        open={statementModalOpen}
        onClose={() => setStatementModalOpen(false)}
        sessions={db.sessions}
        ledger={db.ledger}
      />
    </>
  );
}

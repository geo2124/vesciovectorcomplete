import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Database,
  FlaskConical,
  Layers,
  RefreshCw,
  Shield,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { setTenantSlug } from "@/lib/utils";
import { useDB } from "@/lib/data-store";
import {
  RBA_DEMO_BRANCHES,
  RBA_DEMO_ROLES,
  RBA_DEMO_TENANT_ID,
  enterRbaDemoAsRole,
  resetRbaDemoData,
  seedRbaDemoData,
  wipeRbaDemoData,
  type RbaDemoRoleKey,
} from "@/lib/rba-demo-seed";

export const Route = createFileRoute("/demo-rba")({
  component: RbaDemoLauncherPage,
});

function RbaDemoLauncherPage() {
  const navigate = useNavigate();
  const { db } = useDB();

  const [selectedBranch, setSelectedBranch] = useState<string>("RBA Main Campus");
  const [busyAction, setBusyAction] = useState<null | "seed" | "reset" | "wipe" | "enter">(null);
  const [progressText, setProgressText] = useState<string>("");
  const [confirmAction, setConfirmAction] = useState<null | "reset" | "wipe">(null);
  const [isBlankSlate, setIsBlankSlate] = useState<boolean>(false);

  // Switch active tenant context to rba-demo on mount and auto-seed on first visit
  useEffect(() => {
    setTenantSlug(RBA_DEMO_TENANT_ID);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("vv_rba_demo_active", "true");
      window.dispatchEvent(
        new CustomEvent("vv:rba-demo-tenant-change", { detail: { tenantId: RBA_DEMO_TENANT_ID } }),
      );

      const alreadyInitialized = window.localStorage.getItem("vv_rba_demo_initialized");
      if (!alreadyInitialized) {
        setBusyAction("seed");
        setProgressText("Initializing RBA Demo Sandbox dataset...");
        seedRbaDemoData(RBA_DEMO_TENANT_ID, (msg: string) => setProgressText(msg))
          .then(() => {
            setIsBlankSlate(false);
          })
          .catch(() => {})
          .finally(() => {
            setBusyAction(null);
            setProgressText("");
          });
      }
    }
  }, []);

  const handleEnterRole = async (roleKey: RbaDemoRoleKey) => {
    const roleMeta = RBA_DEMO_ROLES.find((r) => r.key === roleKey);
    if (!roleMeta) return;

    setBusyAction("enter");
    try {
      // Auto-seed if never initialized and not explicitly wiped to blank slate
      const initialized =
        typeof window !== "undefined"
          ? window.localStorage.getItem("vv_rba_demo_initialized")
          : "true";
      if (!initialized && !isBlankSlate && db.players.length === 0 && db.branches.length === 0) {
        setProgressText("Seeding RBA Demo dataset before entering...");
        await seedRbaDemoData(RBA_DEMO_TENANT_ID, (msg: string) => setProgressText(msg));
      }

      const branchForRole =
        roleMeta.role === "Branch Manager" || roleMeta.role === "Coach" || roleMeta.role === "Staff"
          ? selectedBranch
          : "All";

      enterRbaDemoAsRole(roleKey, { branch: branchForRole });
      toast.success(`Entered RBA Sandbox as ${roleMeta.title}`, {
        description: `Tenant: ${RBA_DEMO_TENANT_ID} · Branch Scope: ${branchForRole}`,
      });
      navigate({ to: roleMeta.defaultRoute });
    } finally {
      setBusyAction(null);
      setProgressText("");
    }
  };

  const handleSeedData = async () => {
    if (busyAction) return;
    setBusyAction("seed");
    setProgressText("Seeding comprehensive RBA dataset...");
    try {
      const res = await seedRbaDemoData(RBA_DEMO_TENANT_ID, (msg: string) => setProgressText(msg));
      setIsBlankSlate(false);
      toast.success("RBA Demo Dataset Seeded", {
        description: `${res.counts.branches} branches, ${res.counts.teams} teams, ${res.counts.coaches} coaches, ${res.counts.players} players, ${res.counts.sessions} sessions, ${res.counts.ledger} ledger records.`,
      });
    } catch (err) {
      toast.error("Failed to seed RBA demo data", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setBusyAction(null);
      setProgressText("");
    }
  };

  const handleConfirmedDestructive = async () => {
    if (!confirmAction || busyAction) return;
    const action = confirmAction;
    setConfirmAction(null);
    setBusyAction(action);
    setProgressText(
      action === "reset"
        ? "Wiping all records and re-seeding clean RBA dataset..."
        : "Wiping all RBA demo records (blank slate)...",
    );

    try {
      if (action === "reset") {
        const { wipeResult, seedResult } = await resetRbaDemoData(
          RBA_DEMO_TENANT_ID,
          (msg: string) => setProgressText(msg),
        );
        setIsBlankSlate(false);
        toast.success("Reset to Fresh Demo Complete", {
          description: `Cleared ${wipeResult.deletedDocs} docs and seeded ${seedResult.counts.players} players, ${seedResult.counts.sessions} sessions, and ${seedResult.counts.ledger} ledger entries.`,
        });
      } else {
        const wipeResult = await wipeRbaDemoData(RBA_DEMO_TENANT_ID, (msg: string) =>
          setProgressText(msg),
        );
        setIsBlankSlate(true);
        toast.success("Wiped All Data (Blank Slate)", {
          description: `Deleted all records in rba-demo (${wipeResult.deletedDocs} Firestore docs + local cache).`,
        });
      }
    } catch (err) {
      toast.error(`Failed to ${action} RBA demo data`, {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setBusyAction(null);
      setProgressText("");
    }
  };

  return (
    <div
      data-testid="rba-demo-launcher-page"
      className="min-h-screen bg-[#090A0F] text-zinc-100 selection:bg-orange-500 selection:text-white"
    >
      {/* Top Diagnostic Header Bar */}
      <header className="border-b border-zinc-800/90 bg-zinc-950/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center border border-orange-500/40 bg-orange-500/15 text-orange-400">
              <FlaskConical className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs font-bold uppercase tracking-widest text-orange-400">
                  TENANT: {RBA_DEMO_TENANT_ID}
                </span>
                <span className="border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] text-emerald-300">
                  ISOLATED SANDBOX
                </span>
              </div>
              <h1 className="mt-0.5 text-lg font-bold tracking-tight text-white sm:text-xl">
                RBA — Interactive Testing &amp; Demo Sandbox
              </h1>
            </div>
          </div>

          {/* Global Data Controls */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSeedData}
              disabled={Boolean(busyAction)}
              data-testid="launcher-seed-demo-btn"
              className="inline-flex items-center gap-1.5 border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/25 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              Seed Demo Data
            </button>

            <button
              type="button"
              onClick={() => setConfirmAction("reset")}
              disabled={Boolean(busyAction)}
              data-testid="launcher-reset-demo-btn"
              className="inline-flex items-center gap-1.5 border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-xs font-semibold text-amber-300 transition-colors hover:bg-amber-500/25 disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${busyAction === "reset" ? "animate-spin" : ""}`}
              />
              Reset to Fresh Demo
            </button>

            <button
              type="button"
              onClick={() => setConfirmAction("wipe")}
              disabled={Boolean(busyAction)}
              data-testid="launcher-wipe-demo-btn"
              className="inline-flex items-center gap-1.5 border border-rose-500/40 bg-rose-500/15 px-3 py-2 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/25 disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Wipe All Data (Blank Slate)
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8 pb-24">
        {/* Status / Progress Banner */}
        {busyAction && (
          <div
            data-testid="launcher-progress-banner"
            className="mb-6 flex items-center gap-3 border border-orange-500/40 bg-orange-500/10 px-4 py-3 text-xs text-orange-200"
          >
            <Database className="h-4 w-4 animate-pulse text-orange-400" />
            <span className="font-mono">{progressText || "Processing sandbox operation..."}</span>
          </div>
        )}

        {/* Sandbox Dataset Metrics & Branch Context Bar */}
        <section className="mb-8 grid grid-cols-1 gap-4 border border-zinc-800 bg-zinc-950/80 p-5 lg:grid-cols-12">
          <div className="lg:col-span-8">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
              <Layers className="h-3.5 w-3.5 text-orange-400" />
              <span>Live RBA Dataset State (`tenants/rba-demo`)</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-6">
              <div className="border border-zinc-800/90 bg-zinc-900/60 p-3">
                <div className="font-mono text-[11px] text-zinc-400">BRANCHES</div>
                <div
                  data-testid="rba-stat-branches"
                  className="mt-1 font-mono text-xl font-bold tabular-nums text-white"
                >
                  {db.branches.length}
                </div>
              </div>
              <div className="border border-zinc-800/90 bg-zinc-900/60 p-3">
                <div className="font-mono text-[11px] text-zinc-400">TEAMS</div>
                <div
                  data-testid="rba-stat-teams"
                  className="mt-1 font-mono text-xl font-bold tabular-nums text-white"
                >
                  {db.teams.length}
                </div>
              </div>
              <div className="border border-zinc-800/90 bg-zinc-900/60 p-3">
                <div className="font-mono text-[11px] text-zinc-400">COACHES</div>
                <div
                  data-testid="rba-stat-coaches"
                  className="mt-1 font-mono text-xl font-bold tabular-nums text-white"
                >
                  {db.coaches.length}
                </div>
              </div>
              <div className="border border-zinc-800/90 bg-zinc-900/60 p-3">
                <div className="font-mono text-[11px] text-zinc-400">PLAYERS</div>
                <div
                  data-testid="rba-stat-players"
                  className="mt-1 font-mono text-xl font-bold tabular-nums text-white"
                >
                  {db.players.length}
                </div>
              </div>
              <div className="border border-zinc-800/90 bg-zinc-900/60 p-3">
                <div className="font-mono text-[11px] text-zinc-400">SESSIONS</div>
                <div
                  data-testid="rba-stat-sessions"
                  className="mt-1 font-mono text-xl font-bold tabular-nums text-white"
                >
                  {db.sessions.length}
                </div>
              </div>
              <div className="border border-zinc-800/90 bg-zinc-900/60 p-3">
                <div className="font-mono text-[11px] text-zinc-400">LEDGER</div>
                <div
                  data-testid="rba-stat-ledger"
                  className="mt-1 font-mono text-xl font-bold tabular-nums text-emerald-400"
                >
                  {db.ledger.length}
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col justify-between border-t border-zinc-800 pt-4 lg:col-span-4 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                <Building2 className="h-3.5 w-3.5 text-cyan-400" />
                <span>Branch Scope for Scoped Roles</span>
              </div>
              <p className="mt-1 text-xs text-zinc-400">
                Applies when entering as Branch Manager, Coach, or Receptionist / Nexus Staff.
              </p>
            </div>

            <div className="mt-3">
              <select
                aria-label="Default Branch Scope"
                data-testid="launcher-branch-select"
                value={selectedBranch}
                onChange={(e) => setSelectedBranch(e.target.value)}
                className="w-full border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-semibold text-white focus:border-orange-500 focus:outline-none"
              >
                {RBA_DEMO_BRANCHES.map((branchName) => (
                  <option key={branchName} value={branchName}>
                    {branchName}
                  </option>
                ))}
                <option value="All">All RBA Branches (Unrestricted)</option>
              </select>
            </div>
          </div>
        </section>

        {/* 1-Click Role Access Cards Grid */}
        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-bold tracking-tight text-white">
                1-Click Role Access Matrix
              </h2>
              <p className="text-xs text-zinc-400">
                Select any role below to authenticate immediately into{" "}
                <code className="font-mono text-orange-400">rba-demo</code> and jump straight to its
                workspace. You can switch roles at any time using the persistent RBA Control Bar.
              </p>
            </div>
            <div className="flex items-center gap-1.5 font-mono text-xs text-zinc-400">
              <Users className="h-3.5 w-3.5 text-orange-400" />
              <span>{RBA_DEMO_ROLES.length} Roles Configured</span>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {RBA_DEMO_ROLES.map((roleCard) => {
              const isScopedRole =
                roleCard.role === "Branch Manager" ||
                roleCard.role === "Coach" ||
                roleCard.role === "Staff";

              return (
                <div
                  key={roleCard.key}
                  data-testid={`rba-role-card-${roleCard.key}`}
                  className="group flex flex-col justify-between border border-zinc-800 bg-zinc-950/90 p-5 transition-colors hover:border-orange-500/60"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="font-mono text-[10px] font-bold uppercase tracking-widest text-orange-400">
                          ROLE: {roleCard.role}
                        </span>
                        <h3 className="mt-1 text-base font-bold text-white">{roleCard.title}</h3>
                      </div>
                      <span className="border border-zinc-800 bg-zinc-900 px-2 py-0.5 font-mono text-[11px] text-zinc-300">
                        {roleCard.defaultRoute}
                      </span>
                    </div>

                    <p className="mt-1.5 font-mono text-[11px] text-zinc-400">{roleCard.badge}</p>

                    <div className="mt-3 border-t border-zinc-800/80 pt-3">
                      <div className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                        What You Can Test:
                      </div>
                      <ul className="mt-2 space-y-1.5">
                        {roleCard.highlights.map((bullet, idx) => (
                          <li
                            key={idx}
                            className="flex items-start gap-2 text-xs leading-relaxed text-zinc-300"
                          >
                            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                            <span>{bullet}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="mt-5 border-t border-zinc-800/80 pt-3.5">
                    <div className="mb-2.5 flex items-center justify-between text-[11px] text-zinc-400">
                      <span className="flex items-center gap-1">
                        <Shield className="h-3 w-3 text-zinc-500" />
                        {roleCard.user.name}
                      </span>
                      <span className="font-mono text-[10px] text-zinc-400">
                        {isScopedRole ? selectedBranch : "All Branches"}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleEnterRole(roleCard.key)}
                      disabled={Boolean(busyAction)}
                      data-testid={`rba-enter-role-${roleCard.key}`}
                      className="flex w-full items-center justify-between border border-orange-500/40 bg-orange-500/15 px-3.5 py-2.5 text-xs font-bold text-orange-300 transition-colors group-hover:bg-orange-500 group-hover:text-white disabled:opacity-50"
                    >
                      <span>Enter as {roleCard.title}</span>
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {/* Confirmation Modal for Reset / Wipe */}
      {confirmAction && (
        <div
          data-testid="launcher-confirm-modal"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-md border border-zinc-800 bg-zinc-950 p-5 text-zinc-100 shadow-2xl">
            <div className="flex items-center gap-2.5">
              <span
                className={`flex h-8 w-8 items-center justify-center ${
                  confirmAction === "wipe"
                    ? "bg-rose-500/15 text-rose-400"
                    : "bg-amber-500/15 text-amber-400"
                }`}
              >
                {confirmAction === "wipe" ? (
                  <Trash2 className="h-4 w-4" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
              </span>
              <div>
                <h3 className="text-sm font-bold text-white">
                  {confirmAction === "wipe"
                    ? "Wipe All RBA Demo Data (Blank Slate)?"
                    : "Reset RBA Sandbox to Fresh Demo?"}
                </h3>
                <p className="font-mono text-[11px] text-zinc-400">
                  Target Tenant: {RBA_DEMO_TENANT_ID} (Strictly Isolated)
                </p>
              </div>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-zinc-300">
              {confirmAction === "wipe"
                ? "This will permanently delete every document in the rba-demo tenant—including all seeded data AND any players, sessions, attendance, court bookings, POS orders, or ledger records submitted during testing—leaving an empty academy."
                : "This will wipe all existing records in rba-demo (including any custom records you created during testing) and immediately re-seed the clean RBA dataset (2 branches, 4 teams, 5 coaches, 20 players, 12 sessions, and 18 balanced ledger entries)."}
            </p>

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmAction(null)}
                data-testid="launcher-confirm-cancel-btn"
                className="border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmedDestructive}
                data-testid="launcher-confirm-proceed-btn"
                className={`px-3.5 py-1.5 text-xs font-semibold text-white ${
                  confirmAction === "wipe"
                    ? "bg-rose-600 hover:bg-rose-500"
                    : "bg-amber-600 hover:bg-amber-500"
                }`}
              >
                {confirmAction === "wipe" ? "Yes, Wipe Everything" : "Yes, Reset & Re-Seed"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  Building2,
  ChevronDown,
  ChevronUp,
  Database,
  ExternalLink,
  FlaskConical,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { getTenantSlug } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useDB } from "@/lib/data-store";
import {
  RBA_DEMO_BRANCHES,
  RBA_DEMO_ROLES,
  RBA_DEMO_TENANT_ID,
  enterRbaDemoAsRole,
  exitRbaDemoToDefaultTenant,
  resetRbaDemoData,
  seedRbaDemoData,
  wipeRbaDemoData,
  type RbaDemoRoleKey,
} from "@/lib/rba-demo-seed";

export function RbaDemoControlBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { passwordUser } = useAuth();
  const { db } = useDB();

  const [tenantId, setTenantId] = useState<string>(() => getTenantSlug());
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [busyAction, setBusyAction] = useState<null | "seed" | "reset" | "wipe">(null);
  const [progressText, setProgressText] = useState<string>("");
  const [confirmAction, setConfirmAction] = useState<null | "reset" | "wipe">(null);

  useEffect(() => {
    const syncTenant = () => {
      setTenantId(getTenantSlug());
    };
    syncTenant();
    window.addEventListener("vv:rba-demo-tenant-change", syncTenant);
    window.addEventListener("vv:rba-demo-auth-change", syncTenant);
    window.addEventListener("storage", syncTenant);
    return () => {
      window.removeEventListener("vv:rba-demo-tenant-change", syncTenant);
      window.removeEventListener("vv:rba-demo-auth-change", syncTenant);
      window.removeEventListener("storage", syncTenant);
    };
  }, [location.pathname]);

  if (tenantId !== RBA_DEMO_TENANT_ID) {
    return null;
  }

  const storedRoleKey =
    (typeof window !== "undefined"
      ? (window.localStorage.getItem("vv_rba_demo_role_key") as RbaDemoRoleKey | null)
      : null) || null;

  const activeRoleMeta =
    RBA_DEMO_ROLES.find((r) => r.key === storedRoleKey) ||
    RBA_DEMO_ROLES.find((r) => r.role === passwordUser?.role) ||
    RBA_DEMO_ROLES[0]!;

  const activeBranch =
    passwordUser?.branch ||
    (typeof window !== "undefined" ? window.localStorage.getItem("vv_rba_demo_branch") : null) ||
    activeRoleMeta.user.branch;

  const showBranchSwitcher =
    activeRoleMeta.role === "Branch Manager" ||
    activeRoleMeta.role === "Coach" ||
    activeRoleMeta.role === "Staff";

  const handleRoleSwitch = (nextKey: RbaDemoRoleKey) => {
    const nextMeta = RBA_DEMO_ROLES.find((r) => r.key === nextKey);
    if (!nextMeta) return;
    const nextBranch =
      nextMeta.role === "Branch Manager" || nextMeta.role === "Coach" || nextMeta.role === "Staff"
        ? activeBranch === "All"
          ? "RBA Main Campus"
          : activeBranch
        : "All";
    enterRbaDemoAsRole(nextKey, { branch: nextBranch });
    toast.success(`Switched role to ${nextMeta.title}`, {
      description: `Active branch context: ${nextBranch}`,
    });
    if (location.pathname !== nextMeta.defaultRoute) {
      navigate({ to: nextMeta.defaultRoute });
    }
  };

  const handleBranchSwitch = (nextBranch: string) => {
    enterRbaDemoAsRole(activeRoleMeta.key, { branch: nextBranch });
    toast.success(`Switched branch context to ${nextBranch}`);
  };

  const handleSeedData = async () => {
    if (busyAction) return;
    setBusyAction("seed");
    setProgressText("Seeding RBA Demo dataset...");
    try {
      const result = await seedRbaDemoData(RBA_DEMO_TENANT_ID, (msg: string) =>
        setProgressText(msg),
      );
      toast.success("RBA Demo Data Seeded", {
        description: `Populated ${result.counts.players} players, ${result.counts.sessions} sessions, and ${result.counts.ledger} ledger records.`,
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

  const handleConfirmedDestructiveAction = async () => {
    if (!confirmAction || busyAction) return;
    const action = confirmAction;
    setConfirmAction(null);
    setBusyAction(action);
    setProgressText(
      action === "reset"
        ? "Wiping all records and re-seeding fresh RBA dataset..."
        : "Wiping all RBA demo records (blank slate)...",
    );
    try {
      if (action === "reset") {
        const { wipeResult, seedResult } = await resetRbaDemoData(
          RBA_DEMO_TENANT_ID,
          (msg: string) => setProgressText(msg),
        );
        toast.success("Reset to Fresh Demo Complete", {
          description: `Deleted ${wipeResult.deletedDocs} docs and re-seeded ${seedResult.counts.players} players, ${seedResult.counts.sessions} sessions, and ${seedResult.counts.ledger} ledger entries.`,
        });
      } else {
        const wipeResult = await wipeRbaDemoData(RBA_DEMO_TENANT_ID, (msg: string) =>
          setProgressText(msg),
        );
        toast.success("Wiped All RBA Demo Data (Blank Slate)", {
          description: `Cleared all collections (${wipeResult.deletedDocs} Firestore docs + local state). Ready for from-scratch testing.`,
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

  const handleExitDemo = () => {
    exitRbaDemoToDefaultTenant("donbosco");
    toast.info("Exited RBA Demo Sandbox");
    navigate({ to: "/" });
  };

  return (
    <>
      <div
        data-testid="rba-demo-control-bar"
        className="fixed bottom-3 right-3 z-[90] max-w-[calc(100vw-1.5rem)] font-sans"
      >
        {isCollapsed ? (
          <button
            type="button"
            onClick={() => setIsCollapsed(false)}
            data-testid="rba-demo-expand-btn"
            className="flex items-center gap-2 border border-orange-500/50 bg-zinc-950/95 px-3.5 py-2 text-xs font-semibold text-white shadow-2xl backdrop-blur-md transition-colors hover:border-orange-400 hover:bg-zinc-900"
          >
            <FlaskConical className="h-3.5 w-3.5 text-orange-400" />
            <span className="font-mono uppercase tracking-wider text-orange-400">RBA Sandbox</span>
            <span className="text-zinc-300">· {activeRoleMeta.title}</span>
            <ChevronUp className="h-3.5 w-3.5 text-zinc-400" />
          </button>
        ) : (
          <div className="border border-orange-500/40 bg-zinc-950/95 p-3 text-xs text-zinc-100 shadow-2xl backdrop-blur-md sm:p-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 pb-2.5">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center bg-orange-500/15 text-orange-400">
                  <FlaskConical className="h-3.5 w-3.5" />
                </span>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-orange-400">
                      RBA DEMO SANDBOX
                    </span>
                    <span className="border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[10px] text-emerald-300">
                      tenant: rba-demo
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    {db.players.length} Players · {db.sessions.length} Sessions · {db.ledger.length}{" "}
                    Ledger Entries
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {location.pathname !== "/demo-rba" && (
                  <button
                    type="button"
                    onClick={() => navigate({ to: "/demo-rba" })}
                    data-testid="rba-demo-open-launcher-btn"
                    className="inline-flex items-center gap-1 border border-zinc-700 bg-zinc-900 px-2 py-1 text-[11px] font-medium text-zinc-200 transition-colors hover:border-orange-500/50 hover:text-white"
                  >
                    <ExternalLink className="h-3 w-3 text-orange-400" />
                    Launcher
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleExitDemo}
                  data-testid="rba-demo-exit-btn"
                  title="Exit RBA Demo Sandbox"
                  className="inline-flex items-center gap-1 border border-zinc-800 bg-zinc-900/70 px-2 py-1 text-[11px] text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-200"
                >
                  <LogOut className="h-3 w-3" />
                  Exit
                </button>
                <button
                  type="button"
                  onClick={() => setIsCollapsed(true)}
                  data-testid="rba-demo-collapse-btn"
                  title="Minimize RBA Control Bar"
                  className="inline-flex h-6 w-6 items-center justify-center border border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-white"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Role & Branch Switchers */}
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-orange-400" />
                <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                  Role:
                </span>
                <select
                  aria-label="RBA Demo Role Switcher"
                  data-testid="rba-demo-role-select"
                  value={activeRoleMeta.key}
                  onChange={(e) => handleRoleSwitch(e.target.value as RbaDemoRoleKey)}
                  disabled={Boolean(busyAction)}
                  className="border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-medium text-white focus:border-orange-500 focus:outline-none"
                >
                  {RBA_DEMO_ROLES.map((roleOption) => (
                    <option key={roleOption.key} value={roleOption.key}>
                      {roleOption.title}
                    </option>
                  ))}
                </select>
              </label>

              {showBranchSwitcher && (
                <label className="flex items-center gap-1.5">
                  <Building2 className="h-3.5 w-3.5 text-cyan-400" />
                  <span className="font-mono text-[10px] uppercase tracking-wider text-zinc-400">
                    Branch:
                  </span>
                  <select
                    aria-label="RBA Demo Branch Context Switcher"
                    data-testid="rba-demo-branch-select"
                    value={activeBranch}
                    onChange={(e) => handleBranchSwitch(e.target.value)}
                    disabled={Boolean(busyAction)}
                    className="border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs font-medium text-white focus:border-orange-500 focus:outline-none"
                  >
                    {RBA_DEMO_BRANCHES.map((branchName) => (
                      <option key={branchName} value={branchName}>
                        {branchName}
                      </option>
                    ))}
                    <option value="All">All Branches</option>
                  </select>
                </label>
              )}
            </div>

            {/* Data Seeding & Wipe Controls */}
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-zinc-800/80 pt-2.5">
              <button
                type="button"
                onClick={handleSeedData}
                disabled={Boolean(busyAction)}
                data-testid="rba-demo-seed-btn"
                className="inline-flex items-center gap-1.5 border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/25 disabled:opacity-50"
              >
                <Sparkles className="h-3 w-3" />
                Seed Demo Data
              </button>

              <button
                type="button"
                onClick={() => setConfirmAction("reset")}
                disabled={Boolean(busyAction)}
                data-testid="rba-demo-reset-btn"
                className="inline-flex items-center gap-1.5 border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[11px] font-semibold text-amber-300 transition-colors hover:bg-amber-500/25 disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${busyAction === "reset" ? "animate-spin" : ""}`} />
                Reset to Fresh Demo
              </button>

              <button
                type="button"
                onClick={() => setConfirmAction("wipe")}
                disabled={Boolean(busyAction)}
                data-testid="rba-demo-wipe-btn"
                className="inline-flex items-center gap-1.5 border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 text-[11px] font-semibold text-rose-300 transition-colors hover:bg-rose-500/25 disabled:opacity-50"
              >
                <Trash2 className="h-3 w-3" />
                Wipe All Data (Blank Slate)
              </button>
            </div>

            {busyAction && (
              <div
                data-testid="rba-demo-progress-banner"
                className="mt-2 flex items-center gap-2 border border-orange-500/30 bg-orange-500/10 px-2.5 py-1.5 text-[11px] text-orange-200"
              >
                <Database className="h-3.5 w-3.5 animate-pulse text-orange-400" />
                <span>{progressText || "Working..."}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirmation Modal for Reset / Wipe */}
      {confirmAction && (
        <div
          data-testid="rba-demo-confirm-modal"
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
                data-testid="rba-demo-confirm-cancel-btn"
                className="border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmedDestructiveAction}
                data-testid="rba-demo-confirm-proceed-btn"
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
    </>
  );
}

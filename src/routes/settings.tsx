import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useEffect, useMemo, lazy, Suspense } from "react";
import { AppShell } from "@/components/app-shell";
import {
  Button,
  Chip,
  Field,
  Input,
  Modal,
  Panel,
  Select,
  EmptyState,
  Textarea,
} from "@/components/kit";
import {
  MessageSquare,
  Send,
  Copy,
  ExternalLink,
  Plus,
  Trash2,
  Edit2,
  Check,
  Calendar,
  Trophy,
  Users,
  Lock,
  FileText,
} from "lucide-react";
import {
  DEFAULT_WHATSAPP_TEMPLATES,
  buildWhatsAppTemplateContext,
  formatGameReportForWhatsApp,
  formatSessionNoticeForWhatsApp,
  interpolateWhatsAppTemplate,
  pushToWhatsApp,
} from "@/lib/whatsapp";
import { dispatchNotification } from "@/lib/notifications";
import type { SessionItem } from "@/lib/mock-data";

import { WhatsAppGroupsManager } from "@/components/whatsapp-groups-manager";
import { WhatsAppTemplatesManager } from "@/components/whatsapp-templates-manager";
import { DiagnosticsErrorLogsViewer } from "@/components/diagnostics-viewer";
import { ProtectedSuperAdminWhitelistManager } from "@/components/protected-super-admin-whitelist";

import {
  useDB,
  useTenantUser,
  defaultRoleDefinitions,
  defaultAgeCategoryRules,
  formatAgeDate,
  DEFAULT_INSURANCE_COMPANIES,
  DEFAULT_TRAINING_PACKAGES,
  DEFAULT_SPECIAL_OFFERS,
  type InsuranceCompany,
  type TrainingPackage,
  type SpecialOfferConfig,
} from "@/lib/data-store";
import { useAuth } from "@/lib/auth";
import { uploadAcademyLogo } from "@/lib/storage";
import { useSetup, emptySetup } from "@/lib/tenant-store";
import { toast } from "sonner";
import { defaultAppearance, skinVars, normalizeAppearance } from "@/lib/appearance";
import type { Appearance as AppearanceConfig, Skin } from "@/lib/appearance";
import { useTheme } from "@/lib/theme";
import { doc, getDoc, setDoc, deleteField } from "firebase/firestore";
import { db as firestore } from "@/lib/firebase";
import { cleanFirestoreData } from "@/lib/firestore-sync";
import { getTenantSlug } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "System Settings — Vescio Vector" },
      {
        name: "description",
        content:
          "Interface branding, package features, payment deadlines, dropdown administration and WhatsApp broadcast groups.",
      },
      { property: "og:title", content: "System Settings — Vescio Vector" },
      { property: "og:description", content: "Brand, configure and control the whole system." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

const tabs = [
  "Identity",
  "Appearance",
  "Data administration",
  "Communications",
  "Gateways",
  "Diagnostics & Error Logs",
] as const;

function SettingsPage() {
  const { db, ready } = useDB();
  const currentUser = useTenantUser();
  const { user, passwordUser, loading: authLoading } = useAuth();
  const userEmail = (user?.email || passwordUser?.email || currentUser?.email || "").toLowerCase();
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
  const isSuperAdminOrManager =
    (Boolean(currentUser) &&
      (currentUser?.role === "Super Admin" || currentUser?.role === "Academy Manager")) ||
    Boolean(userRoleDef?.permissions?.["settings"]?.read) ||
    userEmail === "geogo3@gmail.com";
  const canAccessCommunications =
    isSuperAdminOrManager ||
    currentUser?.role === "Branch Manager" ||
    currentUser?.role === "Technical Director";
  const hasAccess = isSuperAdminOrManager || canAccessCommunications;
  const availableTabs = useMemo(
    () => (isSuperAdminOrManager ? tabs : (["Communications"] as const)),
    [isSuperAdminOrManager],
  );
  const [tab, setTab] = useState<(typeof tabs)[number]>(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      const qTab = p.get("tab")?.toLowerCase();
      if (qTab === "communications" || qTab === "templates") {
        return "Communications";
      }
      if (qTab === "diagnostics" || qTab === "errors" || qTab === "logs") {
        return "Diagnostics & Error Logs";
      }
    }
    return "Identity";
  });

  useEffect(() => {
    if (!isSuperAdminOrManager && canAccessCommunications && tab !== "Communications") {
      setTab("Communications");
    }
  }, [isSuperAdminOrManager, canAccessCommunications, tab]);

  // Only display credential verification spinner on initial load before any auth session or user profile is resolved
  if (authLoading && !currentUser && !user && !passwordUser) {
    return (
      <AppShell crumb="CONTROL / SETTINGS" title="System Settings">
        <div className="flex h-64 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-court-500 border-t-transparent" />
          <span className="ml-3 font-mono text-xs text-ink-400">
            Verifying security credentials...
          </span>
        </div>
      </AppShell>
    );
  }

  if (!hasAccess) {
    return (
      <AppShell crumb="CONTROL / SETTINGS" title="System Settings">
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
            You must be a Branch Manager, Technical Director, Academy Manager, or Super Admin to
            access this module.
          </p>
        </div>
      </AppShell>
    );
  }

  const activeTab = !isSuperAdminOrManager ? "Communications" : tab;

  return (
    <AppShell
      crumb="CONTROL / SETTINGS"
      title={isSuperAdminOrManager ? "System Settings" : "WhatsApp Hub & Communications"}
    >
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="flex rounded-md bg-ink-850 p-0.5 ring-1 ring-ink-700">
          {availableTabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                activeTab === t ? "bg-court-500 text-ink-950" : "text-ink-300"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {activeTab === "Identity" ? <Identity /> : null}
      {activeTab === "Appearance" ? <Appearance /> : null}
      {activeTab === "Data administration" ? <DataAdmin /> : null}
      {activeTab === "Communications" ? <Communications /> : null}
      {activeTab === "Gateways" ? <Gateways /> : null}
      {activeTab === "Diagnostics & Error Logs" ? <DiagnosticsErrorLogsViewer /> : null}
    </AppShell>
  );
}

function ResetWorkspaceConfirmModal({
  open,
  onClose,
  onConfirm,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-4 backdrop-blur-sm">
      <div className="panel w-full max-w-lg overflow-hidden rounded-xl border border-red-500/30 bg-ink-900 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <header className="flex items-center gap-3 border-b border-ink-800 bg-red-500/10 px-5 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/20 text-red-400 ring-1 ring-red-500/40">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <div>
            <h2 className="font-display text-base font-bold tracking-tight text-ink-100">
              Reset Workspace Data?
            </h2>
            <div className="font-mono text-[10px] tracking-wider text-red-400 uppercase">
              Irreversible Action · Start From 0
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            aria-label="Close"
            className="ml-auto rounded-md p-1.5 text-ink-400 hover:bg-ink-800 hover:text-ink-100 disabled:opacity-50"
          >
            ✕
          </button>
        </header>

        <div className="space-y-3.5 p-5 text-sm text-ink-200">
          <p className="leading-relaxed">
            Are you sure you want to reset all workspace data to{" "}
            <strong className="text-ink-100">0</strong>?
          </p>
          <div className="rounded-lg border border-red-500/25 bg-red-500/10 p-3.5 text-xs leading-relaxed text-red-200">
            <strong className="block font-semibold mb-1 text-red-300">
              This will permanently delete all records across the academy:
            </strong>
            <ul className="list-disc list-inside space-y-1 text-ink-300 font-mono text-[11px]">
              <li>All players & roster registrations</li>
              <li>All coaches & staff personnel</li>
              <li>All teams, squads & branch facilities</li>
              <li>All training sessions & match records</li>
              <li>All attendance logs & QR check-ins</li>
              <li>All merchandise inventory, orders & suppliers</li>
              <li>All tuition invoices & accounting ledger rows</li>
            </ul>
          </div>
          <p className="text-xs text-ink-400 leading-relaxed">
            Your administrator account credentials will remain untouched. You will be taken
            immediately back to the <strong className="text-ink-100">Setup Wizard</strong> to start
            over from 0.
          </p>
        </div>

        <div className="flex items-center justify-end gap-2.5 border-t border-ink-800 bg-ink-950/60 px-5 py-3.5">
          <Button variant="ghost" size="md" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="danger" size="md" onClick={onConfirm} disabled={loading}>
            <Trash2 className="h-4 w-4 mr-1.5" />
            {loading ? "Resetting Everything…" : "Yes, Reset Data & Start Over"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Identity() {
  const { db, updateAcademy, tenantId, resetWorkspaceData } = useDB();
  const { user, passwordUser } = useAuth();
  const currentUser = useTenantUser();
  const { save: saveSetup } = useSetup();
  const navigate = useNavigate();
  const [form, setForm] = useState(db.academy);
  const [saved, setSaved] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  const userEmail = (user?.email || passwordUser?.email || currentUser?.email || "").toLowerCase();
  const canChangePlayersLimit = userEmail === "geogo3@gmail.com";

  async function confirmResetWorkspace() {
    setResetting(true);
    toast.loading("Resetting workspace and clearing database…", { id: "reset-workspace" });
    try {
      await resetWorkspaceData();
      saveSetup({ ...emptySetup, done: false });
      toast.success("Workspace reset to 0. Opening Setup Wizard…", { id: "reset-workspace" });
      setResetModalOpen(false);
      navigate({ to: "/setup" });
    } catch (e) {
      console.error("Failed to reset workspace:", e);
      toast.error("Failed to reset workspace.", { id: "reset-workspace" });
    } finally {
      setResetting(false);
    }
  }

  useEffect(() => {
    if (db.academy) {
      setForm(db.academy);
    }
  }, [db.academy]);

  async function save() {
    try {
      const defaultFeatures = [
        "calendar",
        "sessions",
        "players",
        "teams",
        "accounting",
        "merchandise",
        "technical",
        "coach",
        "whatsapp",
      ];
      const rawFeatures = (form as Record<string, unknown>).features;
      const normalizedFeatures = Array.isArray(rawFeatures)
        ? rawFeatures.filter((f): f is string => typeof f === "string" && Boolean(f))
        : rawFeatures && typeof rawFeatures === "object"
          ? Object.entries(rawFeatures as Record<string, unknown>)
              .filter(([, v]) => Boolean(v))
              .map(([k]) => k)
          : Array.isArray(db.academy?.features)
            ? db.academy.features.filter((f): f is string => typeof f === "string" && Boolean(f))
            : defaultFeatures;

      const resolvedCurr = form.currency || "USD";
      const payload = cleanFirestoreData({
        ...(canChangePlayersLimit ? form : { ...form, playersLimit: db.academy.playersLimit }),
        currency: resolvedCurr,
        currencies: [resolvedCurr],
        features: normalizedFeatures,
      });
      await updateAcademy(payload);
      setSaved(true);
      toast.success("Academy settings saved successfully.");
      window.setTimeout(() => setSaved(false), 2500);
    } catch {
      toast.error("Failed to save academy settings.");
    }
  }

  async function uploadLogo(file: File | undefined) {
    if (!file) return;
    try {
      setUploadingLogo(true);
      const downloadUrl = await uploadAcademyLogo(tenantId, file);
      setForm((prev) => ({ ...prev, logo: downloadUrl }));
      toast.success("Logo uploaded to Firebase Storage.");
    } catch (err) {
      console.error("Error uploading logo:", err);
      toast.error("Failed to upload logo to Storage.");
    } finally {
      setUploadingLogo(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <Panel title="Academy identity" meta="Used across the workspace and the coach portal">
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Field label="Academy name">
                <Input value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
              </Field>
            </div>

            <Field label="Sport theme">
              <Select
                value={form.sport}
                onChange={(v) => setForm({ ...form, sport: v as typeof form.sport })}
                options={["Basketball", "Football", "Volleyball"]}
              />
            </Field>
            <Field label="Currency">
              <Select
                value={form.currency}
                onChange={(v) => {
                  setForm({ ...form, currency: v, currencies: [v] });
                  void updateAcademy({ currency: v, currencies: [v] });
                }}
                options={["USD", "EUR", "LBP", "AED", "SAR"]}
              />
            </Field>
            <Field label="Package">
              <Select
                value={form.plan}
                onChange={(v) => setForm({ ...form, plan: v })}
                options={["Starter", "Pro", "Elite"]}
              />
            </Field>
            <Field label="Renewal">
              <Input value={form.renews} onChange={(v) => setForm({ ...form, renews: v })} />
            </Field>
            <Field
              label="Player limit"
              hint={
                canChangePlayersLimit
                  ? "Maximum number of kids allowed in the system"
                  : "Locked · Only changeable by geogo3@gmail.com"
              }
            >
              {canChangePlayersLimit ? (
                <Input
                  type="number"
                  value={String(form.playersLimit)}
                  onChange={(v) => setForm({ ...form, playersLimit: Number(v) || 0 })}
                />
              ) : (
                <div
                  className="mt-1.5 flex items-center justify-between rounded-md bg-ink-900/90 px-3 py-2 font-mono text-sm text-ink-400 ring-1 ring-ink-800 cursor-not-allowed select-none opacity-75"
                  title="Locked: Only geogo3@gmail.com can modify the maximum number of kids allowed in the system"
                >
                  <span>{form.playersLimit}</span>
                  <span className="inline-flex items-center gap-1 rounded bg-ink-850 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-amber-400 ring-1 ring-amber-500/30">
                    <Lock className="h-3 w-3" />
                    Locked
                  </span>
                </div>
              )}
            </Field>
            <Field label="Branch limit">
              <Input
                type="number"
                value={String(form.branchesLimit)}
                onChange={(v) => setForm({ ...form, branchesLimit: Number(v) || 0 })}
              />
            </Field>
            <Field label="Academy logo" hint="PNG or SVG, uploaded directly to Firebase Storage">
              <input
                type="file"
                accept="image/*"
                disabled={uploadingLogo}
                onChange={(e) => uploadLogo(e.target.files?.[0])}
                className="mt-1.5 w-full rounded-md bg-ink-850 px-3 py-2 font-ui text-sm text-ink-200 ring-1 ring-ink-700 file:mr-3 file:rounded file:border-0 file:bg-court-500 file:px-2 file:py-1 file:text-xs file:font-semibold file:text-ink-950 disabled:opacity-50"
              />
              {uploadingLogo && (
                <div className="mt-2 flex items-center gap-2 text-xs text-court-400 font-mono">
                  <div className="h-2 w-2 animate-ping rounded-full bg-court-400" />
                  Uploading binary asset to Firebase Storage...
                </div>
              )}
              {form.logo && !uploadingLogo && (
                <div className="mt-2 flex items-center gap-3 rounded bg-ink-900 p-2 ring-1 ring-ink-800">
                  <img
                    src={form.logo}
                    alt="Logo preview"
                    className="h-8 w-8 rounded object-contain bg-ink-950 p-1"
                    referrerPolicy="no-referrer"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-mono text-ink-300">
                      {form.logo.startsWith("https://")
                        ? "Stored in Firebase Storage"
                        : "Local asset"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm((prev) => ({ ...prev, logo: null }))}
                    className="text-xs text-rose-400 hover:text-rose-300 px-2 py-1"
                  >
                    Remove
                  </button>
                </div>
              )}
            </Field>
          </div>
          <div className="flex items-center gap-2 border-t border-ink-800 px-4 py-3">
            <Button onClick={save}>Save settings</Button>
            <Button variant="ghost" onClick={() => setForm(db.academy)}>
              Revert
            </Button>
            {saved ? <Chip tone="good">SAVED</Chip> : null}
          </div>
        </Panel>

        <Panel title="Payment deadlines" meta="Counted from one month after registration">
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <Field label="Soft deadline (days)" hint="shows a payment warning">
              <Input
                type="number"
                value={String(form.softDeadline)}
                onChange={(v) => setForm({ ...form, softDeadline: Number(v) || 0 })}
              />
            </Field>
            <Field label="Hard deadline (days)" hint="blocks attendance">
              <Input
                type="number"
                value={String(form.hardDeadline)}
                onChange={(v) => setForm({ ...form, hardDeadline: Number(v) || 0 })}
              />
            </Field>
          </div>
          <div className="border-t border-ink-800 px-4 py-3">
            <Button onClick={save}>Save deadlines</Button>
          </div>
        </Panel>

        <Panel
          title="Game & Match Operations Policy"
          meta="Controls whether newly scheduled games require manual Technical Director confirmation"
        >
          <div className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-ink-100">
                  Require TD Game Confirmation
                </span>
                <Chip
                  tone={
                    form.requireGameConfirmation !== false && !form.autoConfirmGames
                      ? "warn"
                      : "good"
                  }
                >
                  {form.requireGameConfirmation !== false && !form.autoConfirmGames
                    ? "Manual Approval Active"
                    : "Auto-Confirm Active"}
                </Chip>
              </div>
              <p className="font-mono text-[11px] text-ink-400">
                When enabled, coach-submitted games start as &quot;Pending approval&quot;. When
                disabled (Auto-Confirm ON), games are automatically confirmed while preserving all
                Technical Director match notifications, scores, and reports.
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.requireGameConfirmation !== false && !form.autoConfirmGames}
              onClick={async () => {
                const currentVal = form.requireGameConfirmation !== false && !form.autoConfirmGames;
                const nextVal = !currentVal;
                setForm((prev) => ({
                  ...prev,
                  requireGameConfirmation: nextVal,
                  autoConfirmGames: !nextVal,
                }));
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
                form.requireGameConfirmation !== false && !form.autoConfirmGames
                  ? "bg-court-500"
                  : "bg-ink-700"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-ink-950 shadow ring-0 transition duration-200 ease-in-out ${
                  form.requireGameConfirmation !== false && !form.autoConfirmGames
                    ? "translate-x-5"
                    : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </Panel>

        <Panel
          title="Assignment Mode (Player Registration & Team Assignment)"
          meta="Global toggle controlling how players are registered and assigned to teams"
        >
          <div className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="space-y-0.5">
                <span className="text-sm font-semibold text-ink-100">Assignment Mode</span>
                <p className="font-mono text-[11px] text-ink-400">
                  Choose between immediate manual team selection or automated DOB / Age-Matrix
                  driven registration.
                </p>
              </div>
              <Chip
                tone={
                  (form.assignmentMode || db.academy?.assignmentMode || "direct") === "dob_matrix"
                    ? "warn"
                    : "good"
                }
              >
                {(form.assignmentMode || db.academy?.assignmentMode || "direct") === "dob_matrix"
                  ? "Mode B: DOB / Age-Matrix Driven"
                  : "Mode A: Direct Assignment"}
              </Chip>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={async () => {
                  setForm((prev) => ({ ...prev, assignmentMode: "direct" }));
                  try {
                    await updateAcademy({ assignmentMode: "direct" });
                    toast.success("Assignment Mode set to Mode A: Direct Assignment.");
                  } catch {
                    // handled by updateAcademy
                  }
                }}
                className={`rounded-md p-3.5 text-left ring-1 transition-all ${
                  (form.assignmentMode || db.academy?.assignmentMode || "direct") === "direct"
                    ? "bg-court-500/15 ring-court-500 text-ink-100"
                    : "bg-ink-900/60 ring-ink-800 text-ink-300 hover:ring-ink-700"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-semibold text-xs text-ink-100">
                    Mode A · Direct Assignment (Default)
                  </span>
                  {(form.assignmentMode || db.academy?.assignmentMode || "direct") === "direct" && (
                    <span className="rounded bg-court-500 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-ink-950">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-ink-400 leading-relaxed">
                  When registering a new player, the form includes Category and Team fields to
                  assign them immediately.
                </p>
              </button>

              <button
                type="button"
                onClick={async () => {
                  setForm((prev) => ({ ...prev, assignmentMode: "dob_matrix" }));
                  try {
                    await updateAcademy({ assignmentMode: "dob_matrix" });
                    toast.success("Assignment Mode set to Mode B: DOB / Age-Matrix Driven.");
                  } catch {
                    // handled by updateAcademy
                  }
                }}
                className={`rounded-md p-3.5 text-left ring-1 transition-all ${
                  (form.assignmentMode || db.academy?.assignmentMode || "direct") === "dob_matrix"
                    ? "bg-court-500/15 ring-court-500 text-ink-100"
                    : "bg-ink-900/60 ring-ink-800 text-ink-300 hover:ring-ink-700"
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="font-semibold text-xs text-ink-100">
                    Mode B · DOB / Age-Matrix Driven
                  </span>
                  {(form.assignmentMode || db.academy?.assignmentMode || "direct") ===
                    "dob_matrix" && (
                    <span className="rounded bg-court-500 px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase text-ink-950">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-ink-400 leading-relaxed">
                  Hides Category and Team fields during Player Registration. Requires only Date of
                  Birth (DOB), automatically calculating exact age &amp; birth year for smart
                  two-way team assignment.
                </p>
              </button>
            </div>
          </div>
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel title="Support & preview">
          <div className="grid gap-3 p-4">
            <Field label="Support phone">
              <Input
                value={form.supportPhone}
                onChange={(v) => setForm({ ...form, supportPhone: v })}
              />
            </Field>
            <Field label="Support email">
              <Input
                value={form.supportEmail}
                onChange={(v) => setForm({ ...form, supportEmail: v })}
              />
            </Field>
          </div>
          <div className="border-t border-ink-800 px-4 py-3">
            <Button onClick={save}>Save support info</Button>
          </div>
          <div className="border-t border-ink-800 p-4">
            <div className="label-mono mb-2">Live preview</div>
            <div className="rounded-md bg-ink-850 p-3 ring-1 ring-ink-700">
              <div className="flex items-center gap-2">
                <img
                  src={form.logo ?? "/vescio-vector-logo.png"}
                  alt={form.name}
                  className="h-7 w-7 object-contain"
                />
                <span className="font-display text-sm text-ink-100">{form.name}</span>
              </div>
              <div className="mt-3 flex gap-2">
                <Button>Primary</Button>
                <Button variant="ghost">Secondary</Button>
              </div>
            </div>
          </div>
        </Panel>

        <ProtectedSuperAdminWhitelistManager />

        <Panel title="Danger zone" meta="Reset & Setup">
          <div className="space-y-3 p-4">
            <p className="text-sm text-ink-300">
              Reset all workspace data to 0, clean the database, and restart the first-run Setup
              Wizard. Once completed, the Setup Wizard will not be shown in the sidebar.
            </p>
            <Button variant="danger" size="md" onClick={() => setResetModalOpen(true)}>
              <Trash2 className="h-4 w-4 mr-1.5" />
              Reset workspace data
            </Button>
          </div>
        </Panel>
      </div>

      <ResetWorkspaceConfirmModal
        open={resetModalOpen}
        onClose={() => !resetting && setResetModalOpen(false)}
        onConfirm={confirmResetWorkspace}
        loading={resetting}
      />
    </div>
  );
}

const swatches: { key: keyof Skin; label: string; hint: string }[] = [
  { key: "accent", label: "Accent", hint: "buttons, highlights, active items" },
  { key: "background", label: "Page background", hint: "the deepest surface" },
  { key: "surface", label: "Panels & cards", hint: "boxes sitting on the page" },
  { key: "text", label: "Text", hint: "main reading colour" },
];

function ColorRow({ skin, onChange }: { skin?: Partial<Skin>; onChange: (s: Skin) => void }) {
  const safeSkin: Skin = {
    accent: skin?.accent || defaultAppearance.dark.accent,
    background: skin?.background || defaultAppearance.dark.background,
    surface: skin?.surface || defaultAppearance.dark.surface,
    text: skin?.text || defaultAppearance.dark.text,
  };
  return (
    <div className="space-y-2">
      {swatches.map((sw) => (
        <div
          key={sw.key}
          className="flex items-center gap-3 rounded-md bg-ink-850 p-2 ring-1 ring-ink-700"
        >
          <input
            type="color"
            aria-label={sw.label}
            value={safeSkin[sw.key] ?? ""}
            onChange={(e) => onChange({ ...safeSkin, [sw.key]: e.target.value })}
            className="h-9 w-12 cursor-pointer rounded border-0 bg-transparent p-0"
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm text-ink-100">{sw.label}</div>
            <div className="font-mono text-[10px] text-ink-400">{sw.hint}</div>
          </div>
          <input
            value={safeSkin[sw.key] ?? ""}
            onChange={(e) => onChange({ ...safeSkin, [sw.key]: e.target.value })}
            className="w-24 rounded bg-ink-900 px-2 py-1 text-right font-mono text-[11px] text-ink-200 ring-1 ring-ink-700 focus:outline-none"
          />
        </div>
      ))}
    </div>
  );
}

function SkinPreview({ skin, label }: { skin?: Partial<Skin>; label: string }) {
  const v = skinVars(skin);
  return (
    <div className="rounded-lg p-3" style={{ background: v["--ink-950"], color: v["--ink-100"] }}>
      <div
        className="font-mono text-[10px] uppercase tracking-widest"
        style={{ color: v["--ink-400"] }}
      >
        {label}
      </div>
      <div
        className="mt-2 rounded-md p-3"
        style={{ background: v["--ink-900"], boxShadow: `inset 0 0 0 1px ${v["--ink-800"]}` }}
      >
        <div className="text-sm font-semibold">Team roster</div>
        <div className="mt-1 font-mono text-[10px]" style={{ color: v["--ink-400"] }}>
          14 players · 3 coaches
        </div>
        <div className="mt-3 flex gap-2">
          <span
            className="rounded px-3 py-1.5 text-xs font-semibold"
            style={{ background: v["--court-500"], color: v["--primary-foreground"] }}
          >
            Primary
          </span>
          <span
            className="rounded px-3 py-1.5 text-xs"
            style={{
              background: v["--ink-850"],
              color: v["--ink-200"],
              boxShadow: `inset 0 0 0 1px ${v["--ink-700"]}`,
            }}
          >
            Secondary
          </span>
        </div>
      </div>
    </div>
  );
}

const presets: { name: string; value: Pick<AppearanceConfig, "dark" | "light"> }[] = [
  { name: "Vector teal", value: { dark: defaultAppearance.dark, light: defaultAppearance.light } },
  {
    name: "Court orange",
    value: {
      dark: { accent: "#f97316", background: "#141313", surface: "#1f1d1c", text: "#f2ece8" },
      light: { accent: "#c2410c", background: "#faf6f3", surface: "#ffffff", text: "#26201c" },
    },
  },
  {
    name: "Midnight blue",
    value: {
      dark: { accent: "#4f8ef7", background: "#0c1220", surface: "#151d31", text: "#e8eefb" },
      light: { accent: "#2354c7", background: "#f4f6fb", surface: "#ffffff", text: "#161d2e" },
    },
  },
  {
    name: "Royal purple",
    value: {
      dark: { accent: "#a855f7", background: "#140f1c", surface: "#1e1729", text: "#eee7f7" },
      light: { accent: "#7127c4", background: "#f7f4fb", surface: "#ffffff", text: "#1e1729" },
    },
  },
];

function Appearance() {
  const { db, update } = useDB();
  const { theme, toggle } = useTheme();
  const current: AppearanceConfig = normalizeAppearance(db?.appearance);
  const [form, setForm] = useState<AppearanceConfig>(current);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setForm(normalizeAppearance(db?.appearance));
  }, [db?.appearance]);

  function apply(next: AppearanceConfig) {
    setForm(next);
    update((d) => ({ ...d, appearance: next }));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        <Panel
          title="Colour themes"
          meta="Dark and light are styled separately — changes apply live"
          action={
            <>
              <Chip tone={saved ? "good" : "neutral"}>
                {saved ? "SAVED" : `VIEWING ${theme.toUpperCase()}`}
              </Chip>
              <Button variant="ghost" onClick={toggle}>
                Preview {theme === "dark" ? "light" : "dark"}
              </Button>
            </>
          }
        >
          <div className="grid gap-4 p-4 lg:grid-cols-2">
            <div className="space-y-3">
              <div className="label-mono">Dark theme</div>
              <ColorRow skin={form.dark} onChange={(dark) => apply({ ...form, dark })} />
              <SkinPreview skin={form.dark} label="Dark preview" />
            </div>
            <div className="space-y-3">
              <div className="label-mono">Light theme</div>
              <ColorRow skin={form.light} onChange={(light) => apply({ ...form, light })} />
              <SkinPreview skin={form.light} label="Light preview" />
            </div>
          </div>
        </Panel>

        <Panel title="Interface" meta="Shape and density of the whole system">
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label={`Corner radius · ${form.radius}px`}>
              <input
                type="range"
                min={0}
                max={20}
                value={form.radius ?? 8}
                onChange={(e) => apply({ ...form, radius: Number(e.target.value) })}
                className="mt-3 w-full accent-court-500"
              />
            </Field>
            <Field label={`Text size · ${form.fontSize}px`}>
              <input
                type="range"
                min={13}
                max={19}
                value={form.fontSize ?? 16}
                onChange={(e) => apply({ ...form, fontSize: Number(e.target.value) })}
                className="mt-3 w-full accent-court-500"
              />
            </Field>
            <label className="flex items-center gap-3 rounded-md bg-ink-850 p-3 ring-1 ring-ink-700 sm:col-span-2">
              <input
                type="checkbox"
                checked={form.texture ?? true}
                onChange={(e) => apply({ ...form, texture: e.target.checked })}
                className="h-4 w-4 accent-court-500"
              />
              <span className="text-sm text-ink-100">Court texture behind headers</span>
            </label>
          </div>
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel title="Presets" meta="One click, then fine-tune">
          <div className="grid gap-2 p-4">
            {presets.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => apply({ ...form, dark: p.value.dark, light: p.value.light })}
                className="flex items-center gap-3 rounded-md bg-ink-850 p-3 text-left ring-1 ring-ink-700 hover:ring-court-500"
              >
                <span className="flex gap-1">
                  {[
                    p.value.dark.accent,
                    p.value.dark.background,
                    p.value.light.accent,
                    p.value.light.background,
                  ].map((c) => (
                    <span key={c} className="h-5 w-5 rounded" style={{ background: c }} />
                  ))}
                </span>
                <span className="text-sm text-ink-100">{p.name}</span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Restore" meta="Back to the Vescio Vector look">
          <div className="p-4">
            <Button variant="ghost" onClick={() => apply(defaultAppearance)}>
              Reset appearance
            </Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}

function DataAdmin() {
  const { db, update, updateAcademy, resetWorkspaceData } = useDB();
  const { save: saveSetup } = useSetup();
  const navigate = useNavigate();
  const [openList, setOpenList] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Insurance Companies CRUD state
  const insuranceCompanies: InsuranceCompany[] =
    Array.isArray(db.academy?.insuranceCompanies) && db.academy.insuranceCompanies.length > 0
      ? db.academy.insuranceCompanies
      : DEFAULT_INSURANCE_COMPANIES;
  const [insName, setInsName] = useState("");
  const [insFee, setInsFee] = useState(25);
  const [insNotes, setInsNotes] = useState("");
  const [editingInsId, setEditingInsId] = useState<string | null>(null);

  // Training Packages CRUD state
  const trainingPackages: TrainingPackage[] =
    Array.isArray(db.academy?.trainingPackages) && db.academy.trainingPackages.length > 0
      ? db.academy.trainingPackages
      : DEFAULT_TRAINING_PACKAGES;
  const [pkgName, setPkgName] = useState("");
  const [pkgPractices, setPkgPractices] = useState(8);
  const [pkgPrice, setPkgPrice] = useState(85);
  const [pkgDesc, setPkgDesc] = useState("");
  const [editingPkgId, setEditingPkgId] = useState<string | null>(null);

  // Special Offers CRUD state
  const specialOffers: SpecialOfferConfig[] =
    Array.isArray(db.academy?.specialOffers) && db.academy.specialOffers.length > 0
      ? db.academy.specialOffers
      : DEFAULT_SPECIAL_OFFERS;
  const [offerName, setOfferName] = useState("");
  const [offerTargetType, setOfferTargetType] = useState<"package" | "sibling" | "general">(
    "package",
  );
  const [offerApplicablePkgIds, setOfferApplicablePkgIds] = useState<string[]>([]);
  const [offerDiscPct, setOfferDiscPct] = useState<number>(10);
  const [offerDiscAmt, setOfferDiscAmt] = useState<number>(0);
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);

  async function saveInsuranceCompany() {
    const trimmed = insName.trim();
    if (!trimmed) {
      toast.error("Please enter an insurance company name.");
      return;
    }
    const feeVal = Math.max(0, Number(insFee) || 0);
    let next: InsuranceCompany[];
    if (editingInsId) {
      next = insuranceCompanies.map((c) =>
        c.id === editingInsId
          ? { ...c, name: trimmed, defaultFee: feeVal, policyNotes: insNotes.trim() }
          : c,
      );
    } else {
      next = [
        ...insuranceCompanies,
        {
          id: `ins-${Date.now().toString(36)}`,
          name: trimmed,
          defaultFee: feeVal,
          policyNotes: insNotes.trim(),
          active: true,
        },
      ];
    }
    await updateAcademy({ insuranceCompanies: next });
    toast.success(
      editingInsId
        ? `Updated insurance company "${trimmed}".`
        : `Added insurance company "${trimmed}" ($${feeVal} default fee).`,
    );
    setInsName("");
    setInsFee(25);
    setInsNotes("");
    setEditingInsId(null);
  }

  async function removeInsuranceCompany(id: string, name: string) {
    const next = insuranceCompanies.filter((c) => c.id !== id);
    await updateAcademy({ insuranceCompanies: next });
    toast.success(`Removed insurance company "${name}".`);
  }

  async function toggleInsuranceCompanyActive(id: string) {
    const next = insuranceCompanies.map((c) => (c.id === id ? { ...c, active: !c.active } : c));
    await updateAcademy({ insuranceCompanies: next });
  }

  async function saveTrainingPackage() {
    const trimmed = pkgName.trim();
    if (!trimmed) {
      toast.error("Please enter a training package name.");
      return;
    }
    const practicesVal = Math.max(1, Number(pkgPractices) || 8);
    const priceVal = Math.max(0, Number(pkgPrice) || 0);
    let next: TrainingPackage[];
    if (editingPkgId) {
      next = trainingPackages.map((p) =>
        p.id === editingPkgId
          ? {
              ...p,
              name: trimmed,
              practicesPerMonth: practicesVal,
              monthlyPrice: priceVal,
              description: pkgDesc.trim(),
            }
          : p,
      );
    } else {
      next = [
        ...trainingPackages,
        {
          id: `pkg-${Date.now().toString(36)}`,
          name: trimmed,
          practicesPerMonth: practicesVal,
          monthlyPrice: priceVal,
          description: pkgDesc.trim(),
          active: true,
        },
      ];
    }
    await updateAcademy({ trainingPackages: next });
    toast.success(
      editingPkgId
        ? `Updated training package "${trimmed}".`
        : `Added training package "${trimmed}" (${practicesVal >= 999 ? "Unlimited" : `${practicesVal} practices/mo`} · $${priceVal}/mo).`,
    );
    setPkgName("");
    setPkgPractices(8);
    setPkgPrice(85);
    setPkgDesc("");
    setEditingPkgId(null);
  }

  async function removeTrainingPackage(id: string, name: string) {
    const next = trainingPackages.filter((p) => p.id !== id);
    await updateAcademy({ trainingPackages: next });
    toast.success(`Removed training package "${name}".`);
  }

  async function saveSpecialOffer() {
    const trimmed = offerName.trim();
    if (!trimmed) {
      toast.error("Please enter a special offer or sibling promotion name.");
      return;
    }
    const pctVal = Math.max(0, Math.min(100, Number(offerDiscPct) || 0));
    const amtVal = Math.max(0, Number(offerDiscAmt) || 0);
    let next: SpecialOfferConfig[];
    if (editingOfferId) {
      next = specialOffers.map((o) =>
        o.id === editingOfferId
          ? {
              ...o,
              name: trimmed,
              targetType: offerTargetType,
              applicablePackageIds: offerApplicablePkgIds,
              discountPercent: pctVal > 0 ? pctVal : undefined,
              discountAmount: amtVal > 0 ? amtVal : undefined,
            }
          : o,
      );
    } else {
      next = [
        ...specialOffers,
        {
          id: `offer-${Date.now().toString(36)}`,
          name: trimmed,
          targetType: offerTargetType,
          applicablePackageIds: offerApplicablePkgIds,
          discountPercent: pctVal > 0 ? pctVal : undefined,
          discountAmount: amtVal > 0 ? amtVal : undefined,
          active: true,
        },
      ];
    }
    await updateAcademy({ specialOffers: next });
    toast.success(
      editingOfferId ? `Updated special offer "${trimmed}".` : `Added special offer "${trimmed}".`,
    );
    setOfferName("");
    setOfferTargetType("package");
    setOfferApplicablePkgIds([]);
    setOfferDiscPct(10);
    setOfferDiscAmt(0);
    setEditingOfferId(null);
  }

  async function removeSpecialOffer(id: string, name: string) {
    const next = specialOffers.filter((o) => o.id !== id);
    await updateAcademy({ specialOffers: next });
    toast.success(`Removed special offer "${name}".`);
  }

  async function confirmResetWorkspace() {
    setResetting(true);
    toast.loading("Resetting workspace and clearing database…", { id: "reset-workspace" });
    try {
      await resetWorkspaceData();
      saveSetup({ ...emptySetup, done: false });
      toast.success("Workspace reset to 0. Opening Setup Wizard…", { id: "reset-workspace" });
      setResetModalOpen(false);
      navigate({ to: "/setup" });
    } catch (e) {
      console.error("Failed to reset workspace:", e);
      toast.error("Failed to reset workspace.", { id: "reset-workspace" });
    } finally {
      setResetting(false);
    }
  }

  const lists = db.lists;
  const displayListEntries = useMemo(() => {
    const entries = Object.entries(lists || {});
    const hasCoachingLevels = "Coaching levels" in (lists || {});
    return entries.filter(
      ([key]) => !(hasCoachingLevels && key === "Coach levels") && key !== "Packages",
    );
  }, [lists]);
  const options = openList
    ? (lists[openList] ??
      (openList === "Coaching levels" ? lists["Coach levels"] : undefined) ??
      [])
    : [];
  const isAgeCategoryList = openList === "Age categories";
  const isCoachingLevelsList = openList === "Coaching levels" || openList === "Coach levels";
  const effectiveAgeRules = db.ageCategoryRules ?? defaultAgeCategoryRules;

  const [ageStartDate, setAgeStartDate] = useState("2014-01-01");
  const [ageEndDate, setAgeEndDate] = useState("2015-12-31");
  const [editingCatName, setEditingCatName] = useState<string | null>(null);
  const [editStartDate, setEditStartDate] = useState("");
  const [editEndDate, setEditEndDate] = useState("");

  function addOption() {
    if (!openList || !draft.trim()) return;
    const trimmed = draft.trim();
    if (isAgeCategoryList) {
      const updatedRules = {
        ...effectiveAgeRules,
        [trimmed]: { startDate: ageStartDate, endDate: ageEndDate },
      };
      update((d) => {
        const currentOpts = d.lists[openList] ?? [];
        const nextOpts = currentOpts.includes(trimmed) ? currentOpts : [...currentOpts, trimmed];
        return {
          ...d,
          lists: { ...d.lists, [openList]: nextOpts },
          ageCategoryRules: updatedRules,
        };
      });
      toast.success(`Age category "${trimmed}" added (${ageStartDate} to ${ageEndDate}).`);
    } else {
      update((d) => {
        const currentOpts =
          d.lists[openList] ??
          (isCoachingLevelsList ? d.lists["Coach levels"] || d.lists["Coaching levels"] : []) ??
          [];
        const nextOpts = currentOpts.includes(trimmed) ? currentOpts : [...currentOpts, trimmed];
        return {
          ...d,
          lists: {
            ...d.lists,
            [openList]: nextOpts,
            ...(isCoachingLevelsList
              ? { "Coaching levels": nextOpts, "Coach levels": nextOpts }
              : {}),
          },
        };
      });
      toast.success(`Option "${trimmed}" added to ${openList}.`);
    }
    setDraft("");
  }

  function saveAgeRule(cat: string) {
    if (!editStartDate || !editEndDate) return;
    const updatedRules = {
      ...effectiveAgeRules,
      [cat]: { startDate: editStartDate, endDate: editEndDate },
    };
    update((d) => ({
      ...d,
      ageCategoryRules: updatedRules,
    }));
    toast.success(`Updated eligible birth date range for "${cat}".`);
    setEditingCatName(null);
  }

  function removeOption(value: string) {
    if (!openList) return;
    const normTarget = value.replace(/[\s-]/g, "").toLowerCase();
    const removedRuleKeys = new Set<string>([value]);

    update((d) => {
      const filteredOpts = (
        d.lists[openList] ??
        (isCoachingLevelsList ? d.lists["Coach levels"] || d.lists["Coaching levels"] : []) ??
        []
      ).filter((o) => o !== value);

      const newLists = {
        ...d.lists,
        [openList]: filteredOpts,
        ...(isCoachingLevelsList
          ? { "Coaching levels": filteredOpts, "Coach levels": filteredOpts }
          : {}),
      };
      const newRules = { ...(d.ageCategoryRules ?? defaultAgeCategoryRules) };
      if (isAgeCategoryList) {
        delete newRules[value];
        for (const k of Object.keys(newRules)) {
          if (k.replace(/[\s-]/g, "").toLowerCase() === normTarget) {
            removedRuleKeys.add(k);
            delete newRules[k];
          }
        }
      }
      return {
        ...d,
        lists: newLists,
        ...(isAgeCategoryList ? { ageCategoryRules: newRules } : {}),
      };
    });
    if (isAgeCategoryList) {
      const activeTenant = getTenantSlug();
      if (activeTenant && firestore) {
        const rulesDeleteMap: Record<string, unknown> = {
          [value]: deleteField(),
        };
        const compactAlias = value.replace(/[\s-]/g, "");
        if (compactAlias) {
          rulesDeleteMap[compactAlias] = deleteField();
        }
        removedRuleKeys.forEach((k) => {
          rulesDeleteMap[k] = deleteField();
        });
        setDoc(
          doc(firestore, "tenants", activeTenant),
          {
            ageCategoryRules: rulesDeleteMap,
            academy: { ageCategoryRules: deleteField() },
          },
          { merge: true },
        ).catch(() => {});
      }
    }
    toast.success(`Option "${value}" removed.`);
  }

  return (
    <div className="space-y-4">
      <Panel
        title="Assignment Mode (Player Registration & Smart Age-Matrix Workflow)"
        meta="Global toggle controlling how players are registered and matched to teams"
      >
        <div className="p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-ink-100">Active Assignment Mode</span>
              <Chip
                tone={(db.academy?.assignmentMode || "direct") === "dob_matrix" ? "warn" : "good"}
              >
                {(db.academy?.assignmentMode || "direct") === "dob_matrix"
                  ? "Mode B: DOB / Age-Matrix Driven"
                  : "Mode A: Direct Assignment"}
              </Chip>
            </div>
            <p className="font-mono text-[11px] text-ink-400">
              Mode A shows Category &amp; Team fields on Player Registration. Mode B hides Category
              &amp; Team fields on registration, calculates exact age &amp; birth year from DOB, and
              powers two-way smart assignment in Teams and Player Profiles.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant={(db.academy?.assignmentMode || "direct") === "direct" ? "primary" : "ghost"}
              onClick={async () => {
                await updateAcademy({ assignmentMode: "direct" });
                toast.success("Assignment Mode set to Mode A: Direct Assignment.");
              }}
            >
              Mode A: Direct Assignment
            </Button>
            <Button
              size="sm"
              variant={
                (db.academy?.assignmentMode || "direct") === "dob_matrix" ? "primary" : "ghost"
              }
              onClick={async () => {
                await updateAcademy({ assignmentMode: "dob_matrix" });
                toast.success("Assignment Mode set to Mode B: DOB / Age-Matrix Driven.");
              }}
            >
              Mode B: DOB / Age-Matrix Driven
            </Button>
          </div>
        </div>
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Panel title="Dropdown administration" meta="Add or remove the options used in every form">
          <div className="divide-y divide-ink-800">
            {displayListEntries.map(([name, values]) => (
              <div key={name} className="flex items-center justify-between px-4 py-2.5">
                <div>
                  <span className="text-sm text-ink-200">{name}</span>
                  <div className="font-mono text-[10px] text-ink-400">{values.length} options</div>
                </div>
                <button
                  type="button"
                  onClick={() => setOpenList(name)}
                  className="font-mono text-[10px] text-court-400"
                >
                  MANAGE ›
                </button>
              </div>
            ))}
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Workspace Data Management" meta="Live Production Workspace">
            <div className="space-y-3 p-4">
              <p className="text-sm text-ink-300">
                Reset the workspace to 0 to restart the academy setup from scratch. All operational
                records (players, teams, coaches, branches, sessions, merchandise, invoices, and
                ledger) will be completely cleared, while preserving your Super Admin credentials.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="danger" size="md" onClick={() => setResetModalOpen(true)}>
                  <Trash2 className="h-4 w-4 mr-1.5" />
                  Reset workspace data
                </Button>
              </div>
              <div className="font-mono text-[10px] text-ink-400">
                {db.players.length} players · {db.coaches.length} coaches · {db.sessions.length}{" "}
                activities · {db.ledger.length} ledger rows
              </div>
            </div>
          </Panel>

          <Panel title="Package features" meta="What this academy can reach">
            <div className="space-y-2 p-4">
              {[
                ["Multi-branch", db.branches.length > 1],
                ["Merchandise", true],
                ["Accounting", true],
                ["Coach portal", db.coaches.some((c) => c.portal)],
                ["Technical portal", true],
              ].map(([label, on]) => (
                <div key={String(label)} className="flex items-center justify-between">
                  <span className="text-sm text-ink-200">{String(label)}</span>
                  <Chip tone={on ? "good" : "warn"}>{on ? "ACTIVE" : "UPGRADE"}</Chip>
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>

      {/* Point 5: Insurance Companies & Basic Fees Management */}
      <Panel
        title="Insurance Companies &amp; Basic Fees"
        meta="Manage multi-company player insurance providers and default annual/season fees"
      >
        <div className="p-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {insuranceCompanies.map((comp) => (
              <div
                key={comp.id}
                className={`rounded-lg border p-3 flex flex-col justify-between gap-2 ${
                  comp.active
                    ? "border-ink-750 bg-ink-900/70"
                    : "border-ink-850 bg-ink-950/60 opacity-60"
                }`}
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm text-ink-100">{comp.name}</span>
                    <span className="rounded bg-court-500/15 px-2 py-0.5 font-mono text-xs font-bold text-court-300 ring-1 ring-court-500/30">
                      ${comp.defaultFee}
                    </span>
                  </div>
                  {comp.policyNotes && (
                    <div className="text-xs text-ink-400 line-clamp-2">{comp.policyNotes}</div>
                  )}
                </div>
                <div className="flex items-center justify-between pt-2 border-t border-ink-800/80 font-mono text-[10px]">
                  <button
                    type="button"
                    onClick={() => toggleInsuranceCompanyActive(comp.id)}
                    className={comp.active ? "text-good" : "text-ink-400"}
                  >
                    {comp.active ? "● ACTIVE" : "○ INACTIVE"}
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingInsId(comp.id);
                        setInsName(comp.name);
                        setInsFee(comp.defaultFee);
                        setInsNotes(comp.policyNotes || "");
                      }}
                      className="text-court-400 hover:underline"
                    >
                      EDIT
                    </button>
                    <button
                      type="button"
                      onClick={() => removeInsuranceCompany(comp.id, comp.name)}
                      className="text-bad hover:underline"
                    >
                      DELETE
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-lg bg-ink-900/90 border border-ink-800 p-3 space-y-3">
            <div className="font-mono text-[11px] font-bold uppercase text-court-400">
              {editingInsId ? "Edit Insurance Company" : "+ Add Insurance Company"}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Company Name">
                <Input value={insName} onChange={setInsName} placeholder="e.g. Bankers Assurance" />
              </Field>
              <Field label="Default Basic Fee ($)" hint="Auto-fills on player registration">
                <Input type="number" value={insFee} onChange={(v) => setInsFee(Number(v))} />
              </Field>
              <Field label="Policy / Coverage Notes">
                <Input
                  value={insNotes}
                  onChange={setInsNotes}
                  placeholder="Optional coverage summary"
                />
              </Field>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={saveInsuranceCompany}>
                {editingInsId ? "Save Changes" : "Add Insurance Company"}
              </Button>
              {editingInsId && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setEditingInsId(null);
                    setInsName("");
                    setInsFee(25);
                    setInsNotes("");
                  }}
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </div>
      </Panel>

      {/* Point 6: Training Packages & Special Offers (Split Architecture) */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="Training Packages (Practices / Month &amp; Base Tuition)"
          meta="Define monthly practice caps and base tuition fees"
        >
          <div className="p-4 space-y-4">
            <div className="space-y-2">
              {trainingPackages.map((pkg) => (
                <div
                  key={pkg.id}
                  className="rounded-lg border border-ink-750 bg-ink-900/70 p-3 flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-ink-100">{pkg.name}</span>
                      <span className="rounded bg-court-500/15 px-2 py-0.5 font-mono text-[11px] font-bold text-court-300 ring-1 ring-court-500/30">
                        {pkg.practicesPerMonth >= 999
                          ? "Unlimited Practices/Mo"
                          : `${pkg.practicesPerMonth} Practices/Mo`}
                      </span>
                      <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-300 ring-1 ring-emerald-500/30">
                        ${pkg.monthlyPrice}/mo
                      </span>
                    </div>
                    {pkg.description && (
                      <div className="text-xs text-ink-400 mt-1">{pkg.description}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[10px] shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingPkgId(pkg.id);
                        setPkgName(pkg.name);
                        setPkgPractices(pkg.practicesPerMonth);
                        setPkgPrice(pkg.monthlyPrice);
                        setPkgDesc(pkg.description || "");
                      }}
                      className="text-court-400 hover:underline"
                    >
                      EDIT
                    </button>
                    <button
                      type="button"
                      onClick={() => removeTrainingPackage(pkg.id, pkg.name)}
                      className="text-bad hover:underline"
                    >
                      DELETE
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-lg bg-ink-900/90 border border-ink-800 p-3.5 space-y-3">
              <div className="font-mono text-[11px] font-bold uppercase text-court-400">
                {editingPkgId ? "Edit Training Package" : "+ Add Training Package"}
              </div>
              <div className="space-y-3">
                <Field label="Package Name">
                  <Input
                    value={pkgName}
                    onChange={setPkgName}
                    placeholder="e.g. Standard Package"
                  />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
                  <Field label="Practices / Month (999 = Unlimited)">
                    <Input
                      type="number"
                      value={pkgPractices}
                      onChange={(v) => setPkgPractices(Number(v))}
                    />
                  </Field>
                  <Field label="Monthly Base Price ($)">
                    <Input
                      type="number"
                      value={pkgPrice}
                      onChange={(v) => setPkgPrice(Number(v))}
                    />
                  </Field>
                </div>
                <Field label="Description">
                  <Input
                    value={pkgDesc}
                    onChange={setPkgDesc}
                    placeholder="e.g. 2 practices per week (8 practices / month)"
                  />
                </Field>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Button onClick={saveTrainingPackage}>
                  {editingPkgId ? "Save Package" : "Add Package"}
                </Button>
                {editingPkgId && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditingPkgId(null);
                      setPkgName("");
                      setPkgPractices(8);
                      setPkgPrice(85);
                      setPkgDesc("");
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          title="Special Offers &amp; Sibling Promotions"
          meta="Promotional discounts linked to packages, siblings, or general tuition"
        >
          <div className="p-4 space-y-4">
            <div className="space-y-2">
              {specialOffers.map((off) => (
                <div
                  key={off.id}
                  className="rounded-lg border border-ink-750 bg-ink-900/70 p-3 flex items-center justify-between gap-3"
                >
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm text-ink-100">{off.name}</span>
                      <span className="rounded bg-amber-500/15 px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-amber-300 ring-1 ring-amber-500/30">
                        {off.targetType}
                      </span>
                      {off.discountPercent ? (
                        <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-300">
                          -{off.discountPercent}%
                        </span>
                      ) : null}
                      {off.discountAmount ? (
                        <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-[11px] font-bold text-emerald-300">
                          -${off.discountAmount}
                        </span>
                      ) : null}
                    </div>
                    {off.applicablePackageIds && off.applicablePackageIds.length > 0 && (
                      <div className="text-[11px] font-mono text-ink-400 mt-1">
                        Applies to:{" "}
                        {off.applicablePackageIds
                          .map((pid) => trainingPackages.find((p) => p.id === pid)?.name || pid)
                          .join(", ")}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 font-mono text-[10px] shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingOfferId(off.id);
                        setOfferName(off.name);
                        setOfferTargetType(off.targetType);
                        setOfferApplicablePkgIds(off.applicablePackageIds || []);
                        setOfferDiscPct(off.discountPercent || 0);
                        setOfferDiscAmt(off.discountAmount || 0);
                      }}
                      className="text-court-400 hover:underline"
                    >
                      EDIT
                    </button>
                    <button
                      type="button"
                      onClick={() => removeSpecialOffer(off.id, off.name)}
                      className="text-bad hover:underline"
                    >
                      DELETE
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-lg bg-ink-900/90 border border-ink-800 p-3 space-y-3">
              <div className="font-mono text-[11px] font-bold uppercase text-court-400">
                {editingOfferId ? "Edit Special Offer" : "+ Add Special Offer"}
              </div>
              <div className="space-y-3">
                <Field label="Offer Name">
                  <Input
                    value={offerName}
                    onChange={setOfferName}
                    placeholder="e.g. Early Bird -15%"
                  />
                </Field>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-start">
                  <Field label="Target Type">
                    <Select
                      value={offerTargetType}
                      onChange={(v) => setOfferTargetType(v as "package" | "sibling" | "general")}
                      options={["package", "sibling", "general"]}
                    />
                  </Field>
                  <Field label="Discount (%)">
                    <Input
                      type="number"
                      value={offerDiscPct}
                      onChange={(v) => setOfferDiscPct(Number(v))}
                    />
                  </Field>
                  <Field label="Fixed Discount ($)">
                    <Input
                      type="number"
                      value={offerDiscAmt}
                      onChange={(v) => setOfferDiscAmt(Number(v))}
                    />
                  </Field>
                </div>
              </div>
              {offerTargetType === "package" && (
                <div className="space-y-1.5">
                  <div className="font-mono text-[10px] uppercase text-ink-400">
                    Applicable Training Packages (leave unselected for all packages)
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {trainingPackages.map((pkg) => {
                      const selected = offerApplicablePkgIds.includes(pkg.id);
                      return (
                        <button
                          key={pkg.id}
                          type="button"
                          onClick={() =>
                            setOfferApplicablePkgIds((prev) =>
                              prev.includes(pkg.id)
                                ? prev.filter((id) => id !== pkg.id)
                                : [...prev, pkg.id],
                            )
                          }
                          className={`rounded px-2 py-1 font-mono text-[11px] transition-colors ${
                            selected
                              ? "bg-court-500 text-ink-950 font-bold"
                              : "bg-ink-850 text-ink-300 ring-1 ring-ink-750"
                          }`}
                        >
                          {pkg.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Button onClick={saveSpecialOffer}>
                  {editingOfferId ? "Save Offer" : "Add Special Offer"}
                </Button>
                {editingOfferId && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setEditingOfferId(null);
                      setOfferName("");
                      setOfferTargetType("package");
                      setOfferApplicablePkgIds([]);
                      setOfferDiscPct(10);
                      setOfferDiscAmt(0);
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <Modal
        open={openList !== null}
        title={openList ?? ""}
        meta={
          isAgeCategoryList
            ? "Configure age categories with eligible birth date / year ranges for team compliance"
            : "These options appear in the matching dropdowns"
        }
        onClose={() => {
          setOpenList(null);
          setEditingCatName(null);
        }}
        wide={isAgeCategoryList}
      >
        <div className="space-y-3 p-4">
          {isAgeCategoryList && (
            <div className="rounded-md bg-court-500/10 p-3 ring-1 ring-court-500/30 text-xs text-court-300">
              <span className="font-semibold text-ink-100">Age Limit Compliance:</span> Set the
              eligible birth date range for each category (e.g. U-12: 1 Jan 2014 to 31 Dec 2015).
              When a player is added who exceeds the age limit, the system alerts and displays a
              persistent warning badge next to his name on the team roster.
            </div>
          )}

          {options.map((o) => {
            const rule = effectiveAgeRules[o];
            const isEditing = editingCatName === o;

            if (isAgeCategoryList) {
              return (
                <div key={o} className="rounded-md bg-ink-850 p-3 ring-1 ring-ink-700 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-display text-sm font-semibold text-ink-100">{o}</span>
                      {rule?.startDate && rule?.endDate && (
                        <span className="font-mono text-xs text-court-300">
                          {rule.startDate.slice(0, 4)} &ndash; {rule.endDate.slice(0, 4)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (isEditing) {
                            setEditingCatName(null);
                          } else {
                            setEditingCatName(o);
                            setEditStartDate(rule?.startDate || "2014-01-01");
                            setEditEndDate(rule?.endDate || "2015-12-31");
                          }
                        }}
                        className="font-mono text-[10px] text-court-400 hover:text-court-300"
                      >
                        {isEditing ? "CANCEL" : "EDIT DATES"}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeOption(o)}
                        className="font-mono text-[10px] text-bad hover:underline"
                      >
                        REMOVE
                      </button>
                    </div>
                  </div>

                  {rule?.startDate && rule?.endDate && !isEditing && (
                    <div className="space-y-1 border-t border-ink-800 pt-1.5 font-mono text-[11px]">
                      <div className="flex flex-wrap items-center justify-between gap-1 text-ink-300">
                        <span>
                          Eligible birth window:{" "}
                          <strong className="text-court-300">
                            {formatAgeDate(rule.startDate)} and {formatAgeDate(rule.endDate)}
                          </strong>
                        </span>
                        <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[10px] text-ink-200">
                          Birth Years: {rule.startDate.slice(0, 4)} &ndash;{" "}
                          {rule.endDate.slice(0, 4)}
                        </span>
                      </div>
                      <div className="text-[10px] text-warn">
                        ⚠️ Born before {formatAgeDate(rule.startDate)} = Exceeds age limit
                        (persistent overage warning sign on team)
                      </div>
                    </div>
                  )}

                  {isEditing && (
                    <div className="pt-2 border-t border-ink-800 space-y-2">
                      <div className="grid gap-2 sm:grid-cols-2 items-end">
                        <Field
                          label="Eligible Start Date"
                          hint={`Oldest allowed birth date (e.g. 1 Jan ${editStartDate.slice(0, 4) || "2014"})`}
                        >
                          <Input type="date" value={editStartDate} onChange={setEditStartDate} />
                        </Field>
                        <Field
                          label="Eligible End Date"
                          hint={`Youngest allowed birth date (e.g. 31 Dec ${editEndDate.slice(0, 4) || "2015"})`}
                        >
                          <Input type="date" value={editEndDate} onChange={setEditEndDate} />
                        </Field>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <div className="text-[11px] font-mono text-ink-300">
                          Range: {formatAgeDate(editStartDate)} and {formatAgeDate(editEndDate)} (
                          {editStartDate.slice(0, 4)} &ndash; {editEndDate.slice(0, 4)})
                        </div>
                        <Button onClick={() => saveAgeRule(o)}>Save Dates &amp; Years</Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            }

            return (
              <div
                key={o}
                className="flex items-center justify-between rounded bg-ink-850 px-3 py-2 ring-1 ring-ink-700"
              >
                <span className="text-sm text-ink-100">{o}</span>
                <button
                  type="button"
                  onClick={() => removeOption(o)}
                  className="font-mono text-[10px] text-bad"
                >
                  REMOVE
                </button>
              </div>
            );
          })}

          {isAgeCategoryList ? (
            <div className="mt-3 rounded-md bg-ink-900 p-3 ring-1 ring-ink-700 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-mono text-[11px] text-court-400 font-bold uppercase">
                  Add New Age Category With Years &amp; Date Range
                </div>
                <div className="flex items-center gap-1.5 text-[10px] font-mono text-ink-400">
                  Quick Presets:
                  <button
                    type="button"
                    onClick={() => {
                      setDraft("U12");
                      setAgeStartDate("2014-01-01");
                      setAgeEndDate("2015-12-31");
                    }}
                    className="rounded bg-ink-800 px-1.5 py-0.5 text-court-400 hover:bg-ink-700"
                  >
                    U12 (2014–2015)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft("U14");
                      setAgeStartDate("2012-01-01");
                      setAgeEndDate("2013-12-31");
                    }}
                    className="rounded bg-ink-800 px-1.5 py-0.5 text-court-400 hover:bg-ink-700"
                  >
                    U14 (2012–2013)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft("U10");
                      setAgeStartDate("2016-01-01");
                      setAgeEndDate("2017-12-31");
                    }}
                    className="rounded bg-ink-800 px-1.5 py-0.5 text-court-400 hover:bg-ink-700"
                  >
                    U10 (2016–2017)
                  </button>
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label="Category Name">
                  <Input value={draft} onChange={setDraft} placeholder="e.g. U12 or U-12" />
                </Field>
                <Field label="Eligible Start Date" hint="Oldest birth date (e.g. 1 January 2014)">
                  <Input type="date" value={ageStartDate} onChange={setAgeStartDate} />
                </Field>
                <Field label="Eligible End Date" hint="Youngest birth date (e.g. 31 December 2015)">
                  <Input type="date" value={ageEndDate} onChange={setAgeEndDate} />
                </Field>
              </div>

              {draft.trim() && (
                <div className="rounded bg-ink-850 p-2 font-mono text-[11px] text-ink-300 ring-1 ring-ink-750">
                  <span className="text-court-400 font-bold">{draft}:</span> Eligible birth window
                  is{" "}
                  <strong className="text-ink-100">
                    {formatAgeDate(ageStartDate)} and {formatAgeDate(ageEndDate)}
                  </strong>{" "}
                  (Birth Years: {ageStartDate.slice(0, 4)} &ndash; {ageEndDate.slice(0, 4)}).
                  Players born before {formatAgeDate(ageStartDate)} will trigger a persistent
                  overage warning sign on the team.
                </div>
              )}

              <Button onClick={addOption} disabled={!draft.trim()}>
                Add Category &amp; Save Age Limit
              </Button>
            </div>
          ) : (
            <div className="flex gap-2 pt-2">
              <div className="flex-1">
                <Input value={draft} onChange={setDraft} placeholder="New option" />
              </div>
              <div className="pt-1.5">
                <Button onClick={addOption}>Add</Button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      <ResetWorkspaceConfirmModal
        open={resetModalOpen}
        onClose={() => !resetting && setResetModalOpen(false)}
        onConfirm={confirmResetWorkspace}
        loading={resetting}
      />
    </div>
  );
}

interface WhatsAppGroupItem {
  id: string;
  name: string;
  scope?: string;
  scopeType?: "branch" | "team" | "coach_level" | "academy" | "custom";
  link?: string;
  branchId?: string;
  branchName?: string;
  teamId?: string;
  teamName?: string;
  coachLevel?: string;
  adminPhone?: string;
  contactName?: string;
  description?: string;
  active?: boolean;
  category?: "Games" | "Sessions" | "General" | "Coaches" | "Parents" | "Emergency";
}

function Communications() {
  const { db, update, ensureCollection } = useDB();
  useEffect(() => {
    ensureCollection("notifications");
  }, [ensureCollection]);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<WhatsAppGroupItem | null>(null);
  const [groupToDelete, setGroupToDelete] = useState<{ id: string; name: string } | null>(null);
  const coachLevels = useMemo(() => {
    const fromLists = db.lists?.["Coaching levels"] || db.lists?.["Coach levels"] || [];
    const fromCoaches = (db.coaches || [])
      .map((c) => c.level)
      .filter((lvl): lvl is string => Boolean(lvl && lvl.trim()));
    return Array.from(
      new Set([
        "All Coaches",
        ...fromLists,
        ...fromCoaches,
        "Head Coach",
        "Assistant Coach",
        "Trainer",
      ]),
    );
  }, [db.lists, db.coaches]);
  const [groupForm, setGroupForm] = useState({
    name: "",
    scopeType: "team" as "branch" | "team" | "coach_level" | "academy" | "custom",
    branchId: db.branches[0]?.id || "",
    teamId: db.teams[0]?.id || "",
    coachLevel: "All Coaches",
    scope: "",
    link: "",
    adminPhone: "",
    contactName: "",
    category: "Games" as NonNullable<WhatsAppGroupItem["category"]>,
  });

  const [activeCommTab, setActiveCommTab] = useState<"manager" | "templates" | "broadcast">(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      if (
        p.get("tab")?.toLowerCase() === "templates" ||
        p.get("subtab")?.toLowerCase() === "templates"
      ) {
        return "templates";
      }
    }
    return "manager";
  });

  // Push Mode: "game" | "session" | "custom"
  const [pushMode, setPushMode] = useState<"game" | "session" | "custom">("game");

  const games = useMemo(() => db.sessions.filter((s) => s.kind === "Game"), [db.sessions]);
  const sessions = useMemo(() => db.sessions.filter((s) => s.kind !== "Game"), [db.sessions]);

  const savedTemplates = useMemo(
    () =>
      Array.isArray(db.academy?.whatsappTemplates) && db.academy.whatsappTemplates.length > 0
        ? db.academy.whatsappTemplates
        : DEFAULT_WHATSAPP_TEMPLATES,
    [db.academy?.whatsappTemplates],
  );

  const [selectedGameId, setSelectedGameId] = useState<string>(games[0]?.id || "");
  const [selectedSessionId, setSelectedSessionId] = useState<string>(sessions[0]?.id || "");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("auto");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>("");
  const [targetGroupName, setTargetGroupName] = useState<string>(db.groups[0]?.name || "");

  const [messageText, setMessageText] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const history = useMemo(() => {
    const notifs = db.notifications || [];
    return notifs
      .filter(
        (n) =>
          n.actionUrl === "/settings?tab=communications" ||
          n.id.startsWith("push-") ||
          n.title.startsWith("Game Report:") ||
          n.title.startsWith("Session Notice:") ||
          n.title.startsWith("Announcement:"),
      )
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
      .slice(0, 10)
      .map((n) => {
        const match = n.message.match(/\[To:\s*([^\]]+)\]\s*$/);
        const groupLabel = match?.[1] || n.targetBranchId || "Academy Broadcast";
        const timeStr = n.createdAt
          ? new Date(n.createdAt).toLocaleString([], {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })
          : "Just now";
        return {
          id: n.id,
          title: n.title,
          group: groupLabel,
          time: timeStr,
        };
      });
  }, [db.notifications]);

  // Update preview when selections change
  useEffect(() => {
    const activeGroups = (db.groups || []).filter((grp) => grp.active !== false);
    const activePlayer = db.players.find((p) => p.id === selectedPlayerId) || null;
    const activeTemplate =
      selectedTemplateId !== "auto"
        ? savedTemplates.find((t) => t.id === selectedTemplateId) || null
        : null;

    if (pushMode === "game") {
      const g = games.find((x) => x.id === selectedGameId) || games[0];
      if (g) {
        if (activeTemplate) {
          const ctx = buildWhatsAppTemplateContext({
            academyName: db.academy?.name,
            currency: db.academy?.currency,
            player: activePlayer,
            session: g,
          });
          setMessageText(interpolateWhatsAppTemplate(activeTemplate.body, ctx));
        } else {
          setMessageText(formatGameReportForWhatsApp(g, db.academy?.name));
        }
        // Auto-match group: match by teamId / teamName FIRST, then fall back to branchName / scope
        const gameTeamId = (g as SessionItem & { teamId?: string }).teamId;
        const matchedByTeam = activeGroups.find(
          (grp) =>
            (gameTeamId && grp.teamId === gameTeamId) ||
            (g.teamA && grp.teamName?.toLowerCase() === g.teamA.toLowerCase()) ||
            (g.teamB && grp.teamName?.toLowerCase() === g.teamB.toLowerCase()) ||
            (g.team && grp.teamName?.toLowerCase() === g.team.toLowerCase()),
        );
        const matchedByBranch = activeGroups.find(
          (grp) =>
            g.branch &&
            (grp.branchName?.toLowerCase() === g.branch.toLowerCase() ||
              grp.scope?.toLowerCase().includes(g.branch.toLowerCase())),
        );
        const matched = matchedByTeam || matchedByBranch;
        if (matched) setTargetGroupName(matched.name);
      }
    } else if (pushMode === "session") {
      const s = sessions.find((x) => x.id === selectedSessionId) || sessions[0];
      if (s) {
        if (activeTemplate) {
          const ctx = buildWhatsAppTemplateContext({
            academyName: db.academy?.name,
            currency: db.academy?.currency,
            player: activePlayer,
            session: s,
          });
          setMessageText(interpolateWhatsAppTemplate(activeTemplate.body, ctx));
        } else {
          setMessageText(formatSessionNoticeForWhatsApp(s, db.academy?.name));
        }
        const sessionTeamId = (s as SessionItem & { teamId?: string }).teamId;
        const matchedByTeam = activeGroups.find(
          (grp) =>
            (sessionTeamId && grp.teamId === sessionTeamId) ||
            (s.team && grp.teamName?.toLowerCase() === s.team.toLowerCase()) ||
            (s.teamA && grp.teamName?.toLowerCase() === s.teamA.toLowerCase()) ||
            (s.teamB && grp.teamName?.toLowerCase() === s.teamB.toLowerCase()),
        );
        const matchedByBranch = activeGroups.find(
          (grp) =>
            s.branch &&
            (grp.branchName?.toLowerCase() === s.branch.toLowerCase() ||
              grp.scope?.toLowerCase().includes(s.branch.toLowerCase())),
        );
        const matched = matchedByTeam || matchedByBranch;
        if (matched) setTargetGroupName(matched.name);
      }
    } else if (pushMode === "custom" && activeTemplate) {
      const refSession =
        sessions.find((x) => x.id === selectedSessionId) ||
        games.find((x) => x.id === selectedGameId) ||
        sessions[0] ||
        games[0];
      const ctx = buildWhatsAppTemplateContext({
        academyName: db.academy?.name,
        currency: db.academy?.currency,
        player: activePlayer,
        session: refSession,
      });
      setMessageText(interpolateWhatsAppTemplate(activeTemplate.body, ctx));
    }
  }, [
    pushMode,
    selectedGameId,
    selectedSessionId,
    selectedTemplateId,
    selectedPlayerId,
    savedTemplates,
    games,
    sessions,
    db.academy?.name,
    db.academy?.currency,
    db.players,
    db.groups,
  ]);

  const activeGroup =
    (db.groups as WhatsAppGroupItem[]).find((g) => g.name === targetGroupName) ||
    (db.groups[0] as WhatsAppGroupItem | undefined);

  const handlePush = async () => {
    if (!messageText.trim()) {
      toast.error("Message content cannot be empty.");
      return;
    }
    const groupTarget = activeGroup?.name || targetGroupName || "Academy Broadcast";
    const broadcastTitle =
      pushMode === "game"
        ? `Game Report: ${games.find((g) => g.id === selectedGameId)?.title || "Game"}`
        : pushMode === "session"
          ? `Session Notice: ${sessions.find((s) => s.id === selectedSessionId)?.title || "Session"}`
          : `Announcement: ${messageText.slice(0, 30)}...`;

    pushToWhatsApp(messageText, activeGroup?.link, activeGroup?.adminPhone);
    await dispatchNotification(
      {
        recipientName: groupTarget,
        recipientPhone: activeGroup?.adminPhone,
        subject: broadcastTitle,
        message: messageText,
        channel: "WhatsApp",
        metadata: { group: groupTarget },
      },
      db.academy?.notificationServices,
    );
  };

  const handleCopy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(messageText);
      setCopied(true);
      toast.success("Formatted text copied to clipboard.");
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const openNewGroupModal = () => {
    setEditingGroup(null);
    const defaultTeam = db.teams[0];
    setGroupForm({
      name: "",
      scopeType: defaultTeam ? "team" : "branch",
      branchId: db.branches[0]?.id || "",
      teamId: defaultTeam?.id || "",
      coachLevel: coachLevels[0] || "All Coaches",
      scope: defaultTeam?.name || "",
      link: "",
      adminPhone: "",
      contactName: defaultTeam?.headCoach || "",
      category: "Games",
    });
    setGroupModalOpen(true);
  };

  const openEditGroupModal = (g: WhatsAppGroupItem) => {
    setEditingGroup(g);
    let scopeType: "branch" | "team" | "coach_level" | "academy" | "custom" =
      g.scopeType || "custom";
    if (!g.scopeType) {
      if (g.coachLevel) {
        scopeType = "coach_level";
      } else if (g.teamId || (g.teamName && db.teams.some((t) => t.name === g.teamName))) {
        scopeType = "team";
      } else if (g.branchId || (g.branchName && db.branches.some((b) => b.name === g.branchName))) {
        scopeType = "branch";
      } else if (g.scope?.toLowerCase().includes("all academy")) {
        scopeType = "academy";
      }
    }
    setGroupForm({
      name: g.name,
      scopeType,
      branchId:
        g.branchId ||
        db.branches.find((b) => b.name === g.branchName)?.id ||
        db.branches[0]?.id ||
        "",
      teamId: g.teamId || db.teams.find((t) => t.name === g.teamName)?.id || db.teams[0]?.id || "",
      coachLevel: g.coachLevel || coachLevels[0] || "All Coaches",
      scope: g.scope || "",
      link: g.link || "",
      adminPhone: g.adminPhone || "",
      contactName: g.contactName || "",
      category: g.category || "Games",
    });
    setGroupModalOpen(true);
  };

  const saveGroup = () => {
    if (!groupForm.name.trim()) {
      toast.error("Please provide a group name.");
      return;
    }
    let calculatedScope = groupForm.scope;
    let branchId: string | undefined;
    let branchName: string | undefined;
    let teamId: string | undefined;
    let teamName: string | undefined;
    let coachLevel: string | undefined;

    if (groupForm.scopeType === "branch") {
      const b = db.branches.find((br) => br.id === groupForm.branchId);
      branchId = b?.id;
      branchName = b?.name;
      calculatedScope = b ? `${b.name} Branch` : "Branch";
    } else if (groupForm.scopeType === "team") {
      const t = db.teams.find((tm) => tm.id === groupForm.teamId);
      teamId = t?.id;
      teamName = t?.name;
      const b = db.branches.find((br) => br.name === t?.branch);
      branchId = b?.id;
      branchName = t?.branch;
      calculatedScope = t ? t.name : "Team";
    } else if (groupForm.scopeType === "coach_level") {
      coachLevel = groupForm.coachLevel || "All Coaches";
      calculatedScope = `Coaches · ${coachLevel}`;
    } else if (groupForm.scopeType === "academy") {
      calculatedScope = "All Academy";
    }

    const now = new Date().toISOString();
    const payload = {
      name: groupForm.name.trim(),
      scope: calculatedScope || groupForm.name.trim(),
      scopeType: groupForm.scopeType,
      branchId,
      branchName,
      teamId,
      teamName,
      coachLevel,
      link: groupForm.link.trim() || undefined,
      adminPhone: groupForm.adminPhone.trim() || undefined,
      contactName: groupForm.contactName.trim() || undefined,
      category: groupForm.category,
      active: editingGroup?.active !== false,
      updatedAt: now,
    };

    if (editingGroup) {
      update((d) => ({
        ...d,
        groups: d.groups.map((g) => (g.id === editingGroup.id ? { ...g, ...payload } : g)),
      }));
      toast.success(`WhatsApp group "${groupForm.name}" updated.`);
    } else {
      const newGroup = {
        ...payload,
        id: `wg-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 6)}`,
        createdAt: now,
      };
      update((d) => ({
        ...d,
        groups: [...d.groups, newGroup],
      }));
      toast.success(`WhatsApp group "${groupForm.name}" created.`);
    }
    setGroupModalOpen(false);
  };

  const deleteGroup = (id: string, name: string) => {
    setGroupToDelete({ id, name });
  };

  return (
    <div className="space-y-6">
      {/* Top Navigation Tabs */}
      <div className="flex flex-wrap border-b border-ink-800 bg-ink-950/80 rounded-xl p-1 gap-1">
        <button
          type="button"
          onClick={() => setActiveCommTab("manager")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 font-mono text-xs font-semibold transition-all ${
            activeCommTab === "manager"
              ? "bg-court-500 text-ink-950 font-bold shadow-sm"
              : "text-ink-400 hover:text-ink-100"
          }`}
        >
          <MessageSquare className="h-4 w-4" />
          <span>Manage WhatsApp Groups & Links ({db.groups?.length || 0})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveCommTab("templates")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 font-mono text-xs font-semibold transition-all ${
            activeCommTab === "templates"
              ? "bg-court-500 text-ink-950 font-bold shadow-sm"
              : "text-ink-400 hover:text-ink-100"
          }`}
        >
          <FileText className="h-4 w-4" />
          <span>Notification Templates ({savedTemplates.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveCommTab("broadcast")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 font-mono text-xs font-semibold transition-all ${
            activeCommTab === "broadcast"
              ? "bg-court-500 text-ink-950 font-bold shadow-sm"
              : "text-ink-400 hover:text-ink-100"
          }`}
        >
          <Send className="h-4 w-4" />
          <span>1-Click Matchday Broadcast Center</span>
        </button>
      </div>

      {activeCommTab === "manager" ? (
        <WhatsAppGroupsManager />
      ) : activeCommTab === "templates" ? (
        <WhatsAppTemplatesManager
          onSelectTemplateForBroadcast={(formattedText) => {
            setPushMode("custom");
            setSelectedTemplateId("auto");
            setMessageText(formattedText);
            setActiveCommTab("broadcast");
            toast.success("Loaded formatted template into 1-Click Broadcast Center.");
          }}
        />
      ) : (
        <>
          {/* Top Banner */}
          <div className="rounded-xl border border-ink-800 bg-ink-900/90 p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-emerald-400" />
                <h2 className="font-display text-lg font-bold text-ink-100">
                  WhatsApp Matchday &amp; Session Broadcast Center
                </h2>
              </div>
              <p className="mt-1 text-xs text-ink-300 max-w-2xl">
                Broadcast official match reports, final scores, and custom notification templates
                with dynamic variables ({"{PLAYER_NAME}"}, {"{SESSION_DATE}"}, {"{ACADEMY_NAME}"})
                directly into your team and branch channels.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => setActiveCommTab("templates")}>
                <FileText className="h-4 w-4 mr-1.5" />
                Manage Templates
              </Button>
              <Button onClick={() => setActiveCommTab("manager")}>
                <Plus className="h-4 w-4 mr-1.5" />
                Manage Channels
              </Button>
            </div>
          </div>

          <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
            {/* Left Column: 1-Click Push Dispatcher */}
            <div className="space-y-4">
              <Panel
                title="1-Click WhatsApp Broadcast Center"
                meta="Select a match report, practice session, or custom notification template to push to WhatsApp"
              >
                {/* Mode Switcher Tabs */}
                <div className="p-4 pb-0">
                  <div className="flex rounded-lg bg-ink-950 p-1 ring-1 ring-ink-800 max-w-md">
                    <button
                      type="button"
                      onClick={() => setPushMode("game")}
                      className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-mono font-medium transition-all ${
                        pushMode === "game"
                          ? "bg-court-500 text-ink-950 font-bold shadow-sm"
                          : "text-ink-400 hover:text-ink-200"
                      }`}
                    >
                      <Trophy className="h-3.5 w-3.5" />
                      <span>Push Game Report</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPushMode("session")}
                      className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-mono font-medium transition-all ${
                        pushMode === "session"
                          ? "bg-court-500 text-ink-950 font-bold shadow-sm"
                          : "text-ink-400 hover:text-ink-200"
                      }`}
                    >
                      <Calendar className="h-3.5 w-3.5" />
                      <span>Push Session Notice</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPushMode("custom");
                        if (selectedTemplateId === "auto") {
                          setMessageText(
                            `🏀 *${db.academy?.name || "VESCIO VECTOR ACADEMY"} — ANNOUNCEMENT*\n\n`,
                          );
                        }
                      }}
                      className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-mono font-medium transition-all ${
                        pushMode === "custom"
                          ? "bg-court-500 text-ink-950 font-bold shadow-sm"
                          : "text-ink-400 hover:text-ink-200"
                      }`}
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span>Quick Message</span>
                    </button>
                  </div>
                </div>

                <div className="p-4 space-y-4">
                  {/* Template & Variable Context Selectors */}
                  <div className="grid gap-3 sm:grid-cols-2 rounded-lg border border-ink-800 bg-ink-950/70 p-3">
                    <Field
                      label="Notification Template"
                      hint="Use a saved custom template or standard format"
                    >
                      <select
                        value={selectedTemplateId}
                        onChange={(e) => setSelectedTemplateId(e.target.value)}
                        className="mt-1.5 w-full rounded-md bg-ink-850 px-3 py-2 font-ui text-sm text-ink-100 ring-1 ring-ink-700 focus:outline-none focus:ring-1 focus:ring-court-500"
                      >
                        <option value="auto">Standard Auto-Formatter</option>
                        {savedTemplates.map((tpl) => (
                          <option key={tpl.id} value={tpl.id}>
                            [{tpl.category}] {tpl.name}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field
                      label="Player Context ({PLAYER_NAME})"
                      hint="Optional athlete for personalized variables"
                    >
                      <select
                        value={selectedPlayerId}
                        onChange={(e) => setSelectedPlayerId(e.target.value)}
                        className="mt-1.5 w-full rounded-md bg-ink-850 px-3 py-2 font-ui text-sm text-ink-100 ring-1 ring-ink-700 focus:outline-none focus:ring-1 focus:ring-court-500"
                      >
                        <option value="">All Squad Athletes (Generic)</option>
                        {db.players.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.teams?.[0] || p.category || "Player"})
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    {/* Source Selection */}
                    {pushMode === "game" && (
                      <Field
                        label="Select Game to Report"
                        hint="Populates {SESSION_DATE} & {SCORE}"
                      >
                        {games.length > 0 ? (
                          <select
                            value={selectedGameId}
                            onChange={(e) => setSelectedGameId(e.target.value)}
                            className="mt-1.5 w-full rounded-md bg-ink-850 px-3 py-2 font-ui text-sm text-ink-100 ring-1 ring-ink-700 focus:outline-none focus:ring-1 focus:ring-court-500"
                          >
                            {games.map((g) => (
                              <option key={g.id} value={g.id}>
                                {g.date} · {g.title} {g.score ? `(${g.score})` : ""} [{g.status}]
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="text-xs font-mono text-ink-500 py-2">
                            No games created yet.
                          </div>
                        )}
                      </Field>
                    )}

                    {pushMode === "session" && (
                      <Field
                        label="Select Training Session"
                        hint="Populates {SESSION_DATE} & {VENUE}"
                      >
                        {sessions.length > 0 ? (
                          <select
                            value={selectedSessionId}
                            onChange={(e) => setSelectedSessionId(e.target.value)}
                            className="mt-1.5 w-full rounded-md bg-ink-850 px-3 py-2 font-ui text-sm text-ink-100 ring-1 ring-ink-700 focus:outline-none focus:ring-1 focus:ring-court-500"
                          >
                            {sessions.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.date} {s.time} · {s.title} ({s.branch || "HQ"})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div className="text-xs font-mono text-ink-500 py-2">
                            No sessions planned yet.
                          </div>
                        )}
                      </Field>
                    )}

                    {/* Target WhatsApp Group */}
                    <Field label="Target WhatsApp Group" hint="Recipient broadcast group">
                      {db.groups.length > 0 ? (
                        <Select
                          value={targetGroupName}
                          onChange={setTargetGroupName}
                          options={db.groups.map((g) => g.name)}
                        />
                      ) : (
                        <div className="text-xs font-mono text-warn py-2">
                          Please configure at least one WhatsApp group.
                        </div>
                      )}
                    </Field>
                  </div>

                  {/* Target Group details pill */}
                  {activeGroup && (
                    <div className="rounded-lg bg-ink-950/80 px-3 py-2 ring-1 ring-ink-800 flex items-center justify-between text-xs font-mono">
                      <div className="flex items-center gap-2">
                        <span className="text-emerald-400 font-bold">Target:</span>
                        <span className="text-ink-100 font-semibold">{activeGroup.name}</span>
                        <span className="text-ink-400">
                          · Scope: {activeGroup.scope || "Academy Wide"}
                        </span>
                      </div>
                      {activeGroup?.link && (
                        <a
                          href={activeGroup.link}
                          target="_blank"
                          rel="noreferrer"
                          className="text-court-400 hover:underline flex items-center gap-1 text-[11px]"
                        >
                          <span>Open Group Chat</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  )}

                  {/* Live Preview Textarea */}
                  <Field
                    label="WhatsApp Formatted Message Preview"
                    hint="Auto-formatted with dynamic variables ({PLAYER_NAME}, {SESSION_DATE}, {ACADEMY_NAME}). You can edit any details before pushing."
                  >
                    <Textarea value={messageText} onChange={setMessageText} rows={9} />
                  </Field>
                </div>

                {/* Action Footer */}
                <div className="flex items-center justify-between border-t border-ink-800 p-4 bg-ink-900/50 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="flex items-center gap-1.5 rounded-md bg-ink-800 px-3 py-2 text-xs font-mono text-ink-200 ring-1 ring-ink-700 hover:bg-ink-750 transition-colors"
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5 text-good" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      <span>{copied ? "Copied!" : "Copy Text"}</span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handlePush}
                    className="flex items-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-4 py-2.5 text-xs font-mono font-bold tracking-wide text-white shadow-md transition-all active:scale-95"
                  >
                    <Send className="h-4 w-4" />
                    <span>PUSH TO WHATSAPP (1-CLICK)</span>
                  </button>
                </div>
              </Panel>

              {/* Recent Broadcast Activity */}
              <Panel title="Recent Broadcasts History" meta="Log of reports pushed to WhatsApp">
                <div className="divide-y divide-ink-800/80">
                  {history.map((h) => (
                    <div key={h.id} className="flex items-center justify-between p-3.5 text-xs">
                      <div>
                        <div className="font-medium text-ink-100">{h.title}</div>
                        <div className="font-mono text-[10px] text-ink-400 mt-0.5">
                          Pushed to:{" "}
                          <span className="text-emerald-400 font-semibold">{h.group}</span> ·{" "}
                          {h.time}
                        </div>
                      </div>
                      <Chip tone="good">DELIVERED</Chip>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>

            {/* Right Column: WhatsApp Groups Management */}
            <div className="space-y-4">
              <Panel
                title="Configured WhatsApp Groups"
                action={
                  <button
                    type="button"
                    onClick={openNewGroupModal}
                    className="flex items-center gap-1 rounded bg-court-500/20 px-2 py-1 font-mono text-[11px] font-bold text-court-400 hover:bg-court-500/30 ring-1 ring-court-500/30 transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    <span>New</span>
                  </button>
                }
              >
                {db.groups.length === 0 ? (
                  <EmptyState>No WhatsApp groups configured yet.</EmptyState>
                ) : (
                  <div className="divide-y divide-ink-800">
                    {(db.groups as WhatsAppGroupItem[]).map((g) => {
                      const hasLink = !!g.link;
                      return (
                        <div
                          key={g.id}
                          className="p-3.5 space-y-2 hover:bg-ink-850/40 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <div className="text-sm font-semibold text-ink-100 flex items-center gap-1.5">
                                <span>{g.name}</span>
                                {g.category && (
                                  <span className="font-mono text-[9px] bg-ink-800 text-ink-300 px-1.5 py-0.5 rounded">
                                    {g.category}
                                  </span>
                                )}
                              </div>
                              <div className="font-mono text-[11px] text-ink-400 mt-0.5">
                                Scope: <span className="text-court-400">{g.scope || "All"}</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => openEditGroupModal(g)}
                                className="p-1 text-ink-400 hover:text-ink-200 transition-colors rounded"
                                title="Edit group"
                              >
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteGroup(g.id, g.name)}
                                className="p-1 text-ink-400 hover:text-bad transition-colors rounded"
                                title="Delete group"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Group Link row */}
                          <div className="flex items-center justify-between text-[11px] font-mono text-ink-400 pt-1">
                            {hasLink && g.link ? (
                              <a
                                href={g.link}
                                target="_blank"
                                rel="noreferrer"
                                className="text-emerald-400 hover:underline flex items-center gap-1 truncate max-w-[240px]"
                              >
                                <ExternalLink className="h-3 w-3 shrink-0" />
                                <span className="truncate">{g.link}</span>
                              </a>
                            ) : (
                              <span className="text-ink-500 italic">No chat link added</span>
                            )}

                            <button
                              type="button"
                              onClick={() => {
                                setTargetGroupName(g.name);
                                toast.info(`Selected "${g.name}" as target broadcast group.`);
                              }}
                              className="text-[10px] text-court-400 hover:underline shrink-0"
                            >
                              Select as Target →
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Panel>

              {/* Quick Help Card */}
              <div className="rounded-xl border border-ink-800 bg-ink-950 p-4 text-xs font-mono text-ink-400 space-y-2">
                <div className="text-ink-200 font-bold flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-court-400" />
                  <span>How 1-Click Push Works:</span>
                </div>
                <p className="leading-relaxed">
                  1. If an invite link (e.g. <code>https://chat.whatsapp.com/...</code>) is
                  configured, clicking push copies the message and opens your group chat.
                </p>
                <p className="leading-relaxed">
                  2. Without a link, it opens WhatsApp with the message text pre-loaded, ready to
                  send to any contact or group with 1 tap.
                </p>
              </div>
            </div>
          </div>

          {/* Modal: New / Edit WhatsApp Group */}
          <Modal
            open={groupModalOpen}
            title={
              editingGroup ? `Edit WhatsApp Group: ${editingGroup.name}` : "New WhatsApp Group"
            }
            meta="Set up team parents, staff channels, or age group announcement broadcasts"
            onClose={() => setGroupModalOpen(false)}
            onSubmit={saveGroup}
            submitLabel={editingGroup ? "Save Changes" : "Create Group"}
          >
            <div className="p-4 space-y-3.5">
              <Field label="Target Mapping Type">
                <Select
                  value={groupForm.scopeType}
                  onChange={(v) =>
                    setGroupForm({
                      ...groupForm,
                      scopeType: v as "branch" | "team" | "coach_level" | "academy" | "custom",
                    })
                  }
                  options={["team", "coach_level", "branch", "academy", "custom"]}
                />
              </Field>

              {groupForm.scopeType === "coach_level" && (
                <Field label="Select Level of Coaches">
                  <select
                    value={groupForm.coachLevel}
                    onChange={(e) => setGroupForm({ ...groupForm, coachLevel: e.target.value })}
                    className="mt-1.5 w-full rounded-md bg-ink-850 px-3 py-2 font-ui text-sm text-ink-100 ring-1 ring-ink-700 focus:outline-none focus:ring-1 focus:ring-court-500"
                  >
                    {coachLevels.map((lvl) => (
                      <option key={lvl} value={lvl}>
                        {lvl}
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              {groupForm.scopeType === "branch" && (
                <Field label="Select Academy Branch">
                  <select
                    value={groupForm.branchId}
                    onChange={(e) => setGroupForm({ ...groupForm, branchId: e.target.value })}
                    className="mt-1.5 w-full rounded-md bg-ink-850 px-3 py-2 font-ui text-sm text-ink-100 ring-1 ring-ink-700 focus:outline-none focus:ring-1 focus:ring-court-500"
                  >
                    {db.branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.city})
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              {groupForm.scopeType === "team" && (
                <Field label="Select Team / Squad">
                  <select
                    value={groupForm.teamId}
                    onChange={(e) => setGroupForm({ ...groupForm, teamId: e.target.value })}
                    className="mt-1.5 w-full rounded-md bg-ink-850 px-3 py-2 font-ui text-sm text-ink-100 ring-1 ring-ink-700 focus:outline-none focus:ring-1 focus:ring-court-500"
                  >
                    {db.teams.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.branch})
                      </option>
                    ))}
                  </select>
                </Field>
              )}

              {groupForm.scopeType === "custom" && (
                <Field label="Target Scope" hint="e.g. U-14 North, Achrafieh, or All Academy">
                  <Input
                    value={groupForm.scope}
                    onChange={(v) => setGroupForm({ ...groupForm, scope: v })}
                    placeholder="e.g. U-14 North"
                  />
                </Field>
              )}

              <Field
                label="Group Name"
                hint="e.g. U-14 North Parents, Academy Game Results, Coaches Staff"
              >
                <Input
                  value={groupForm.name}
                  onChange={(v) => setGroupForm({ ...groupForm, name: v })}
                  placeholder="e.g. U-14 North Matchday Group"
                />
              </Field>

              <Field
                label="WhatsApp Invite Link (Optional)"
                hint="https://chat.whatsapp.com/... (Allows 1-click opening straight into this group)"
              >
                <Input
                  value={groupForm.link}
                  onChange={(v) => setGroupForm({ ...groupForm, link: v })}
                  placeholder="https://chat.whatsapp.com/AbCdEf12345"
                />
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Admin / Contact Person">
                  <Input
                    value={groupForm.contactName}
                    onChange={(v) => setGroupForm({ ...groupForm, contactName: v })}
                    placeholder="e.g. Coach Ziad"
                  />
                </Field>
                <Field label="Admin WhatsApp Phone">
                  <Input
                    value={groupForm.adminPhone}
                    onChange={(v) => setGroupForm({ ...groupForm, adminPhone: v })}
                    placeholder="e.g. +961 70 123456"
                  />
                </Field>
              </div>

              <Field label="Group Category">
                <Select
                  value={groupForm.category}
                  onChange={(v) =>
                    setGroupForm({
                      ...groupForm,
                      category: v as NonNullable<WhatsAppGroupItem["category"]>,
                    })
                  }
                  options={["Games", "Sessions", "Parents", "Coaches", "General", "Emergency"]}
                />
              </Field>
            </div>
          </Modal>

          {/* Delete WhatsApp Group Confirmation Modal */}
          <Modal
            open={!!groupToDelete}
            onClose={() => setGroupToDelete(null)}
            title="Delete WhatsApp Group"
          >
            <div className="space-y-4">
              <p className="text-sm text-ink-300">
                Are you sure you want to delete WhatsApp group &ldquo;{groupToDelete?.name}&rdquo;?
                This action cannot be undone.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setGroupToDelete(null)}>
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    if (groupToDelete) {
                      update((d) => ({
                        ...d,
                        groups: d.groups.filter((g) => g.id !== groupToDelete.id),
                      }));
                      toast.success(`Group "${groupToDelete.name}" deleted.`);
                      setGroupToDelete(null);
                    }
                  }}
                >
                  Delete Group
                </Button>
              </div>
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}

function Gateways() {
  const { db, updateAcademy } = useDB();
  const academy = db.academy;
  const tenantId = getTenantSlug();

  const [notifConfig, setNotifConfig] = useState(
    academy.notificationServices || {
      smsProvider: "Twilio" as const,
      emailProvider: "SendGrid" as const,
      autoSendReceipts: true,
      smsApiKey: "",
      emailApiKey: "",
      smsWebhookUrl: "",
      emailWebhookUrl: "",
    },
  );

  const [saved, setSaved] = useState(false);

  // SEC-03: Load secrets securely from /private/secrets (isolated from world-readable academy doc)
  useEffect(() => {
    let isMounted = true;
    async function loadPrivateSecrets() {
      try {
        const secRef = doc(firestore, "tenants", tenantId, "private", "secrets");
        const snap = await getDoc(secRef);
        if (snap.exists() && isMounted) {
          const sec = snap.data();
          setNotifConfig((prev) => ({
            ...prev,
            smsApiKey: (sec.smsApiKey as string) ?? prev.smsApiKey ?? "",
            emailApiKey: (sec.emailApiKey as string) ?? prev.emailApiKey ?? "",
          }));
        }
      } catch (err) {
        // Not Super Admin or Academy Manager; access restricted as designed
      }
    }
    loadPrivateSecrets();
    return () => {
      isMounted = false;
    };
  }, [tenantId]);

  useEffect(() => {
    if (academy.notificationServices) {
      setNotifConfig((prev) => ({
        ...prev,
        smsProvider: academy.notificationServices?.smsProvider || prev.smsProvider,
        emailProvider: academy.notificationServices?.emailProvider || prev.emailProvider,
        autoSendReceipts: academy.notificationServices?.autoSendReceipts ?? prev.autoSendReceipts,
        smsWebhookUrl: academy.notificationServices?.smsWebhookUrl ?? prev.smsWebhookUrl ?? "",
        emailWebhookUrl:
          academy.notificationServices?.emailWebhookUrl ?? prev.emailWebhookUrl ?? "",
      }));
    }
  }, [academy.notificationServices]);

  async function save() {
    // 1. SEC-03: Isolate sensitive API keys in /private/secrets
    try {
      const secRef = doc(firestore, "tenants", tenantId, "private", "secrets");
      await setDoc(
        secRef,
        cleanFirestoreData({
          smsApiKey: notifConfig.smsApiKey || "",
          emailApiKey: notifConfig.emailApiKey || "",
          updatedAt: new Date().toISOString(),
        }),
        { merge: true },
      );
    } catch (err) {
      console.warn("Could not save to private/secrets (permissions):", err);
    }

    // 2. SEC-03 & FIN-03: Strip secrets from public academy root document and enforce offline payment mode
    const sanitizedNotifConfig = {
      ...notifConfig,
      smsApiKey: "", // Never exposed in world-readable academy doc
      emailApiKey: "",
      smsWebhookUrl: notifConfig.smsWebhookUrl?.trim() || "",
      emailWebhookUrl: notifConfig.emailWebhookUrl?.trim() || "",
    };

    const offlinePaymentConfig = {
      provider: "None" as const,
      enabled: false,
      mode: "Live" as const,
    };

    const defaultFeatures = [
      "calendar",
      "sessions",
      "players",
      "teams",
      "accounting",
      "merchandise",
      "technical",
      "coach",
      "whatsapp",
    ];
    const normalizedFeatures = Array.isArray(academy.features)
      ? academy.features.filter((f): f is string => typeof f === "string" && Boolean(f))
      : defaultFeatures;

    await updateAcademy(
      cleanFirestoreData({
        ...academy,
        features: normalizedFeatures,
        paymentGateway: offlinePaymentConfig,
        notificationServices: sanitizedNotifConfig,
      }),
    );

    setSaved(true);
    toast.success("Payment mode and notification settings updated. Secrets securely isolated.");
    window.setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Panel
        title="Payment Processing Configuration"
        meta="Tuition fee collections & accounting entry mode"
        action={<Chip tone="good">OFFLINE CASH ONLY</Chip>}
      >
        <div className="space-y-4 p-4">
          <div className="rounded-lg bg-court-500/10 border border-court-500/20 p-3.5 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-court-400 animate-pulse" />
              <span className="text-xs font-mono font-bold text-court-300">
                Payment Mode: Offline & Cash Recording Only
              </span>
            </div>
            <p className="text-xs text-ink-300 leading-relaxed">
              Online card gateways (Stripe, Tap, Fawry) are disabled. All tuition fees and
              merchandise purchases are recorded directly via in-person Cash, Manual Bank Transfer,
              or Cheque with authorized staff collector auditing.
            </p>
          </div>

          <div className="rounded-md bg-ink-900 border border-ink-800 p-3 space-y-2 text-xs font-mono">
            <div className="text-ink-400 uppercase text-[10px] tracking-wider">
              Supported Offline Payment Methods
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="px-2 py-0.5 rounded bg-ink-800 text-court-300 border border-ink-700">
                ✓ Cash (Counter / Drawer)
              </span>
              <span className="px-2 py-0.5 rounded bg-ink-800 text-court-300 border border-ink-700">
                ✓ Manual Bank Transfer
              </span>
              <span className="px-2 py-0.5 rounded bg-ink-800 text-court-300 border border-ink-700">
                ✓ Cheque
              </span>
            </div>
          </div>
        </div>
      </Panel>

      <Panel
        title="Automated Guardian Dispatch Services"
        meta="Outbound SMS, Email & WhatsApp transaction receipts"
        action={
          <Chip tone={notifConfig.autoSendReceipts ? "good" : "neutral"}>
            {notifConfig.autoSendReceipts ? "AUTO-SEND ON" : "MANUAL"}
          </Chip>
        }
      >
        <div className="space-y-4 p-4">
          <Field label="SMS & WhatsApp Dispatcher">
            <Select
              value={notifConfig.smsProvider}
              onChange={(v) =>
                setNotifConfig({
                  ...notifConfig,
                  smsProvider: v as "Twilio" | "WhatsApp Business API" | "Local Gateway",
                })
              }
              options={["Twilio", "WhatsApp Business API", "Local Gateway"]}
            />
          </Field>

          <Field
            label="SMS / Twilio Gateway Key"
            hint="Stored securely in /private/secrets, isolated from public academy metadata"
          >
            <Input
              type="password"
              value={notifConfig.smsApiKey || ""}
              onChange={(v) => setNotifConfig({ ...notifConfig, smsApiKey: v })}
              placeholder="Twilio Account SID or WhatsApp Token"
            />
          </Field>

          <Field
            label="SMS / WhatsApp Webhook URL"
            hint="External POST endpoint invoked by dispatchNotification for live SMS/WhatsApp delivery"
          >
            <Input
              value={notifConfig.smsWebhookUrl || ""}
              onChange={(v) => setNotifConfig({ ...notifConfig, smsWebhookUrl: v })}
              placeholder="https://api.yourdomain.com/webhooks/sms"
            />
          </Field>

          <Field label="Guardian Email Provider">
            <Select
              value={notifConfig.emailProvider}
              onChange={(v) =>
                setNotifConfig({
                  ...notifConfig,
                  emailProvider: v as "SendGrid" | "Firebase Cloud Messaging" | "SMTP",
                })
              }
              options={["SendGrid", "Firebase Cloud Messaging", "SMTP"]}
            />
          </Field>

          <Field
            label="Email API Key"
            hint="Stored securely in /private/secrets, isolated from public academy metadata"
          >
            <Input
              type="password"
              value={notifConfig.emailApiKey || ""}
              onChange={(v) => setNotifConfig({ ...notifConfig, emailApiKey: v })}
              placeholder="SG.xxxxx or FCM Server Token"
            />
          </Field>

          <Field
            label="Guardian Email Webhook URL"
            hint="External POST endpoint invoked by dispatchNotification for live transactional emails"
          >
            <Input
              value={notifConfig.emailWebhookUrl || ""}
              onChange={(v) => setNotifConfig({ ...notifConfig, emailWebhookUrl: v })}
              placeholder="https://api.yourdomain.com/webhooks/email"
            />
          </Field>

          <label className="flex items-center gap-3 rounded-md bg-ink-850 p-3 ring-1 ring-ink-700">
            <input
              type="checkbox"
              checked={notifConfig.autoSendReceipts}
              onChange={(e) =>
                setNotifConfig({ ...notifConfig, autoSendReceipts: e.target.checked })
              }
              className="accent-court-500"
            />
            <div className="text-xs text-ink-200">
              Automatically trigger outbound SMS / Email receipt delivery upon payment collection
            </div>
          </label>
        </div>
      </Panel>

      <div className="xl:col-span-2 flex items-center justify-end gap-3 p-4 rounded-md bg-ink-900 ring-1 ring-ink-800">
        <Button onClick={save}>{saved ? "Saved ✓" : "Save Gateway Configurations"}</Button>
      </div>
    </div>
  );
}

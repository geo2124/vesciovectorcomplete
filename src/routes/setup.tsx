import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Button, Chip, Field, Input, Select } from "@/components/kit";
import { ThemeToggle } from "@/lib/theme";
import { emptySetup, slugify, useSetup, type SetupState } from "@/lib/tenant-store";
import { uploadAcademyLogo } from "@/lib/storage";
import {
  useDB,
  useTenantUser,
  getTenantSlug,
  isProtectedSuperAdminEmail,
  type UserAccount,
} from "@/lib/data-store";
import { useAuth, provisionFirebaseAuthUser } from "@/lib/auth";
import { toast } from "sonner";

export const Route = createFileRoute("/setup")({
  head: () => ({
    meta: [
      { title: "Setup Wizard · Vescio Vector" },
      {
        name: "description",
        content:
          "First-run setup for a Vescio Vector academy workspace: name the academy, pick a sport theme, upload a logo and create administrator accounts.",
      },
      { property: "og:title", content: "Setup Wizard · Vescio Vector" },
      {
        property: "og:description",
        content: "Name your academy, choose a sport theme, upload your logo and add admins.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SetupWizard,
});

const steps = ["Academy", "Theme", "Logo", "Administrators"] as const;

function SetupWizard() {
  const { setup, ready: setupReady, save } = useSetup();
  const { db, update, updateAcademy, ready: dbReady } = useDB();
  const { user, passwordUser, loading: authLoading } = useAuth();
  const currentUser = useTenantUser();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<SetupState>(() => ({
    done: false,
    academyName: db.academy?.name || setup.academyName || "",
    sport: (db.academy?.sport as SetupState["sport"]) || setup.sport || "Basketball",
    logo: db.academy?.logo || setup.logo || null,
    admins: setup.admins || [],
  }));
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const patch = (p: Partial<SetupState>) => setDraft((prev) => ({ ...prev, ...p }));

  // Security Guard: Check if active user has Super Admin credentials
  const isSuperAdmin =
    currentUser?.role === "Super Admin" ||
    isProtectedSuperAdminEmail(user?.email, db.academy?.protectedSuperAdminEmails) ||
    isProtectedSuperAdminEmail(passwordUser?.email, db.academy?.protectedSuperAdminEmails) ||
    isProtectedSuperAdminEmail(currentUser?.email, db.academy?.protectedSuperAdminEmails);

  // Live Operational Setup Checklist computed from db.academy, db.branches, db.coaches, db.teams, and db.players
  const manualSteps = db.academy?.completedSetupSteps || [];

  const checklistSteps = [
    {
      id: "academy",
      label: "Academy Identity & Branding",
      liveDone: Boolean(db.academy?.name && db.academy.name !== "Vescio Vector Academy"),
      detail: db.academy?.name || "Configure academy name, sport & logo",
      href: "/settings",
    },
    {
      id: "branches",
      label: "Facilities & Branches",
      liveDone: db.branches.length > 0,
      detail: `${db.branches.length} branch${db.branches.length === 1 ? "" : "es"} configured`,
      href: "/branches",
    },
    {
      id: "coaches",
      label: "Coaching Staff",
      liveDone: db.coaches.length > 0,
      detail: `${db.coaches.length} coach${db.coaches.length === 1 ? "" : "es"} registered`,
      href: "/coaches",
    },
    {
      id: "teams",
      label: "Teams & Squads",
      liveDone: db.teams.length > 0,
      detail: `${db.teams.length} team${db.teams.length === 1 ? "" : "s"} active`,
      href: "/teams",
    },
    {
      id: "players",
      label: "Player Roster",
      liveDone: db.players.length > 0,
      detail: `${db.players.length} player${db.players.length === 1 ? "" : "s"} enrolled`,
      href: "/players",
    },
  ] as const;

  const isChecklistStepDone = (id: string, liveDone: boolean) =>
    liveDone || manualSteps.includes(id);

  const completedChecklistCount = checklistSteps.filter((s) =>
    isChecklistStepDone(s.id, s.liveDone),
  ).length;

  const [rerunWizard, setRerunWizard] = useState(false);

  // Determine if the workspace is already initialized from persisted state or live collections
  const isConfigured =
    !rerunWizard &&
    Boolean(
      (setup.done || db.academy?.setupDone) &&
      (db.academy?.name || completedChecklistCount === checklistSteps.length),
    );

  async function toggleManualStep(stepId: string) {
    const nextSteps = manualSteps.includes(stepId)
      ? manualSteps.filter((id) => id !== stepId)
      : [...manualSteps, stepId];
    try {
      await updateAcademy({
        completedSetupSteps: nextSteps,
      });
      toast.success(
        nextSteps.includes(stepId)
          ? "Setup step marked complete and saved to workspace."
          : "Manual step override cleared.",
      );
    } catch {
      toast.error("Failed to persist setup step state.");
    }
  }

  // Hydrate initial draft fields only if the user hasn't started typing yet in step 0
  useEffect(() => {
    if ((!setup.done && !db.academy?.setupDone) || rerunWizard) {
      setDraft((prev) => ({
        ...prev,
        done: false,
        academyName: prev.academyName || db.academy?.name || setup.academyName || "",
        sport:
          prev.sport || (db.academy?.sport as SetupState["sport"]) || setup.sport || "Basketball",
        logo: prev.logo ?? db.academy?.logo ?? setup.logo ?? null,
      }));
    }
  }, [
    rerunWizard,
    setup.done,
    setup.academyName,
    setup.sport,
    setup.logo,
    db.academy?.setupDone,
    db.academy?.name,
    db.academy?.sport,
    db.academy?.logo,
  ]);

  async function handleFinishSetup() {
    if (submitting) return;
    setSubmitting(true);
    try {
      const pendingAdmin =
        email.trim() || username.trim()
          ? [{ email: email.trim(), username: username.trim(), password: password.trim() }]
          : [];
      const finalAdmins = [...draft.admins, ...pendingAdmin];
      const cleanAcademyName = draft.academyName.trim();

      const nextSteps = Array.from(new Set([...manualSteps, "academy"]));
      // 1. Sync academy details and setup completion live to Firestore tenant document first
      await updateAcademy({
        ...(cleanAcademyName
          ? {
              name: cleanAcademyName,
              url: `${slugify(cleanAcademyName || "academy")}.vescio.io`,
            }
          : {}),
        sport: draft.sport || "Basketball",
        logo: draft.logo || null,
        setupDone: true,
        completedSetupSteps: nextSteps,
      });

      // 2. Persist local setup state after academy update succeeds
      const nextSetup: SetupState = {
        ...draft,
        academyName: cleanAcademyName || draft.academyName,
        admins: finalAdmins,
        done: true,
      };
      save(nextSetup);

      // 3. Sync administrator accounts securely without storing plaintext passwords
      if (finalAdmins.length > 0) {
        const newUsers: UserAccount[] = [];
        for (let idx = 0; idx < finalAdmins.length; idx++) {
          const admin = finalAdmins[idx];
          if (!admin) continue;
          const adminEmail = (
            admin.email || `${admin.username || "admin"}@academy.internal`
          ).trim();
          let authUid: string | undefined;

          if (admin.password && admin.password.trim()) {
            try {
              const provRes = await provisionFirebaseAuthUser(adminEmail, admin.password.trim());
              if (provRes.success && provRes.uid) {
                authUid = provRes.uid;
              }
            } catch (provErr) {
              console.warn("Non-fatal Firebase Auth provisioning notice:", provErr);
            }
          }

          newUsers.push({
            id: authUid || `usr-admin-${idx + 1}-${Date.now().toString(36)}`,
            name: admin.username || adminEmail.split("@")[0] || "Super Admin",
            email: adminEmail,
            username: admin.username || undefined,
            role: "Super Admin",
            method: admin.password?.trim() ? "Password" : "Google",
            active: true,
            branch: "All",
            branchScope: "All branches",
            joinedDate: new Date().toISOString().slice(0, 10),
            createdAt: new Date().toISOString(),
            ...(authUid ? { authUid } : {}),
          });
        }

        update((curr) => ({
          ...curr,
          users: [
            ...curr.users.filter(
              (u) => !newUsers.some((nu) => nu.email.toLowerCase() === u.email.toLowerCase()),
            ),
            ...newUsers,
          ],
        }));
      }

      setEmail("");
      setUsername("");
      setPassword("");
      setRerunWizard(false);
      toast.success(`Setup complete! Welcome to ${cleanAcademyName || "your academy"}.`);
      navigate({ to: "/" });
    } catch (err) {
      console.error("Failed to complete setup:", err);
      const errMsg = err instanceof Error ? err.message : "Failed to save setup";
      toast.error(`An error occurred completing setup: ${errMsg}`);
    } finally {
      setSubmitting(false);
    }
  }

  // 1. Unauthenticated Guard: Visitor is not signed in
  if (!user && !passwordUser) {
    return (
      <Shell>
        <div className="py-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10 text-amber-400">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h1 className="font-display text-2xl tracking-tight text-ink-100">
            Authentication Required
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-300">
            This workspace is locked and protected. To access setup and configuration parameters,
            please sign in with an authorized Super Admin or Academy Manager account.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Link to="/">
              <Button>Go to Dashboard</Button>
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  // 2. Loading state verification
  if (!setupReady || !dbReady || authLoading) {
    return (
      <Shell>
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-court-500 border-t-transparent" />
          <p className="mt-4 font-mono text-xs uppercase tracking-widest text-ink-400">
            Verifying Workspace Security & Permissions…
          </p>
        </div>
      </Shell>
    );
  }

  // 3. Unauthorized Guard: ONLY Super Admin can access setup
  if (!isSuperAdmin) {
    return (
      <Shell>
        <div className="py-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/10 text-rose-400">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
          <h1 className="font-display text-2xl tracking-tight text-ink-100">
            Super Admin Access Required
          </h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-ink-300">
            You are signed in as{" "}
            <span className="font-medium text-ink-100">
              {typeof user?.email === "string"
                ? user.email
                : typeof currentUser?.name === "string"
                  ? currentUser.name
                  : "Super Admin"}
            </span>{" "}
            ({typeof currentUser?.role === "string" ? currentUser.role : "Super Admin"}). Re-running
            the workspace setup wizard or modifying academy branding and administrator credentials
            is restricted exclusively to Super Administrators.
          </p>
          <div className="mt-6 flex items-center justify-center gap-3">
            <Link to="/">
              <Button>Return to Dashboard</Button>
            </Link>
          </div>
        </div>
      </Shell>
    );
  }

  // 4. Completed Setup state for authorized Super Admins
  if (isConfigured) {
    return (
      <Shell>
        <div className="py-6">
          <div className="text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <h1 className="font-display text-2xl tracking-tight text-ink-100">
              Setup complete ({completedChecklistCount}/{checklistSteps.length} steps)
            </h1>
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-300">
              {db.academy?.name || setup.academyName} is configured. Step completion is tracked live
              from your workspace records and persisted to Firestore.
            </p>
          </div>

          <div className="mt-6 divide-y divide-ink-800 rounded-lg bg-ink-900/60 ring-1 ring-ink-800">
            {checklistSteps.map((item) => {
              const done = isChecklistStepDone(item.id, item.liveDone);
              return (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => void toggleManualStep(item.id)}
                      className={`grid h-5 w-5 shrink-0 place-items-center rounded font-mono text-[10px] transition-colors ${
                        done
                          ? "bg-emerald-500 text-ink-950 font-bold"
                          : "bg-ink-850 text-ink-400 ring-1 ring-ink-700 hover:ring-court-400"
                      }`}
                      title="Toggle manual step completion in Firestore"
                    >
                      {done ? "✓" : ""}
                    </button>
                    <div>
                      <div className="text-sm font-medium text-ink-100">{item.label}</div>
                      <div className="font-mono text-[11px] text-ink-400">{item.detail}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Chip tone={done ? "good" : "warn"}>
                      {item.liveDone ? "LIVE DATA" : done ? "MANUAL DONE" : "PENDING"}
                    </Chip>
                    <Link
                      to={item.href}
                      className="font-mono text-[11px] text-court-400 hover:underline"
                    >
                      Open &rarr;
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-6 flex items-center justify-center gap-3">
            <Link to="/">
              <Button>Open workspace</Button>
            </Link>
            <Button
              variant="outline"
              onClick={async () => {
                setRerunWizard(true);
                setDraft({
                  done: false,
                  academyName: db.academy?.name || setup.academyName || "",
                  sport: (db.academy?.sport as SetupState["sport"]) || setup.sport || "Basketball",
                  logo: db.academy?.logo || setup.logo || null,
                  admins: [],
                });
                save({ ...setup, done: false });
                await updateAcademy({ setupDone: false }).catch(() => {});
                setStep(0);
              }}
            >
              Run wizard again
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  function addAdmin() {
    if (!email.trim() && !username.trim()) return;
    patch({
      admins: [
        ...draft.admins,
        { email: email.trim(), username: username.trim(), password: password.trim() },
      ],
    });
    setEmail("");
    setUsername("");
    setPassword("");
  }

  const canAdvance =
    step === 0
      ? draft.academyName.trim().length > 1
      : step === 3
        ? draft.admins.length > 0 || email.trim().length > 0 || username.trim().length > 0
        : true;

  return (
    <Shell>
      <div className="mb-6 flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s} className="flex flex-1 items-center gap-2">
            <span
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-full font-mono text-[10px] ${
                i <= step ? "bg-court-500 text-ink-950" : "bg-ink-850 text-ink-400"
              }`}
            >
              {i + 1}
            </span>
            <span
              className={`hidden text-xs sm:inline ${i <= step ? "text-ink-100" : "text-ink-400"}`}
            >
              {s}
            </span>
            {i < steps.length - 1 ? (
              <span className={`h-px flex-1 ${i < step ? "bg-court-500" : "bg-ink-800"}`} />
            ) : null}
          </div>
        ))}
      </div>

      {step === 0 ? (
        <section className="space-y-4">
          <Header title="Name your academy" note="This appears across the workspace and reports." />
          <Field label="Academy name">
            <Input
              value={draft.academyName}
              onChange={(v) => patch({ academyName: v })}
              placeholder="Alba Academy"
            />
          </Field>
        </section>
      ) : null}

      {step === 1 ? (
        <section className="space-y-4">
          <Header title="Choose a theme" note="Terminology, icons and default positions adapt." />
          <div className="grid gap-3 sm:grid-cols-3">
            {(["Basketball", "Football", "Volleyball"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => patch({ sport: s })}
                className={`rounded-lg p-4 text-left ring-1 transition-colors ${
                  draft.sport === s
                    ? "bg-court-500/10 ring-court-500/50"
                    : "bg-ink-850 ring-ink-700 hover:bg-ink-800"
                }`}
              >
                <div className="font-display text-base text-ink-100">{s}</div>
                <div className="mt-1 font-mono text-[10px] text-ink-400">
                  {s === "Basketball"
                    ? "Quarters · PG–C · fouls"
                    : s === "Football"
                      ? "Halves · GK–ST · cards"
                      : "Sets · S/OH/MB · rotations"}
                </div>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {step === 2 ? (
        <section className="space-y-4">
          <Header title="Upload your logo" note="Used in the sidebar, reports and coach portal." />
          <div className="flex flex-wrap items-center gap-4">
            <div className="grid h-24 w-24 place-items-center rounded-lg bg-ink-850 ring-1 ring-ink-700">
              {draft.logo ? (
                <img src={draft.logo} alt="Academy logo" className="h-20 w-20 object-contain" />
              ) : (
                <span className="label-mono">EMPTY</span>
              )}
            </div>
            <label className="cursor-pointer rounded-md bg-ink-850 px-3.5 py-2 text-sm font-semibold text-ink-200 ring-1 ring-ink-700 hover:bg-ink-800">
              {uploadingLogo ? "Uploading to Storage..." : "Choose file"}
              <input
                type="file"
                accept="image/*"
                disabled={uploadingLogo}
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  try {
                    setUploadingLogo(true);
                    const tenantId = getTenantSlug();
                    const downloadUrl = await uploadAcademyLogo(tenantId, file);
                    patch({ logo: downloadUrl });
                    toast.success("Logo uploaded to Firebase Storage.");
                  } catch (err) {
                    console.error("Failed to upload logo:", err);
                    toast.error("Failed to upload logo to Storage.");
                  } finally {
                    setUploadingLogo(false);
                  }
                }}
              />
            </label>
            {draft.logo ? (
              <Button variant="ghost" onClick={() => patch({ logo: null })}>
                Remove
              </Button>
            ) : null}
          </div>
          {uploadingLogo && (
            <div className="flex items-center gap-2 text-xs text-court-400 font-mono">
              <div className="h-2 w-2 animate-ping rounded-full bg-court-400" />
              Persisting binary file in Firebase Storage...
            </div>
          )}
        </section>
      ) : null}

      {step === 3 ? (
        <section className="space-y-4">
          <Header
            title="Super administrators"
            note="Add sign-in emails, or fixed username and password pairs."
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Email">
              <Input value={email} onChange={setEmail} placeholder="admin@academy.com" />
            </Field>
            <Field label="Username">
              <Input value={username} onChange={setUsername} placeholder="superadmin" />
            </Field>
            <Field label="Password">
              <Input value={password} onChange={setPassword} type="password" placeholder="••••••" />
            </Field>
          </div>
          <Button variant="ghost" onClick={addAdmin}>
            + Add administrator
          </Button>
          <div className="divide-y divide-ink-800 rounded-lg bg-ink-850 ring-1 ring-ink-700">
            {draft.admins.length === 0 ? (
              <div className="px-4 py-3 font-mono text-[11px] text-ink-400">
                No administrators yet — at least one is required.
              </div>
            ) : (
              draft.admins.map((a, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="text-sm text-ink-100">
                    {typeof a.email === "string" && a.email
                      ? a.email
                      : typeof a.username === "string" && a.username
                        ? a.username
                        : "Administrator"}
                  </span>
                  <Chip tone={a.email ? "accent" : "neutral"}>
                    {a.email ? "EMAIL SIGN-IN" : "USER + PASSWORD"}
                  </Chip>
                  <button
                    type="button"
                    onClick={() => patch({ admins: draft.admins.filter((_, j) => j !== i) })}
                    className="ml-auto font-mono text-[10px] uppercase tracking-widest text-ink-400 hover:text-bad"
                  >
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>
        </section>
      ) : null}

      <div className="mt-7 flex items-center gap-2">
        {step > 0 ? (
          <Button variant="ghost" onClick={() => setStep(step - 1)}>
            Back
          </Button>
        ) : rerunWizard ? (
          <Button variant="ghost" onClick={() => setRerunWizard(false)}>
            Cancel & Return
          </Button>
        ) : null}
        <div className="ml-auto flex items-center">
          {step < steps.length - 1 ? (
            <span className={canAdvance ? "" : "pointer-events-none opacity-40"}>
              <Button onClick={() => setStep(step + 1)}>Continue</Button>
            </span>
          ) : (
            <span className={canAdvance ? "" : "pointer-events-none opacity-40"}>
              <Button onClick={handleFinishSetup}>Finish setup</Button>
            </span>
          )}
        </div>
      </div>
    </Shell>
  );
}

function Header({ title, note }: { title: string; note: string }) {
  return (
    <div>
      <h2 className="font-display text-xl tracking-tight text-ink-100">{title}</h2>
      <p className="mt-1 text-sm text-ink-300">{note}</p>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-ink-950 px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-8 flex items-center gap-3">
          <img
            src={"/vescio-vector-logo.png"}
            alt="Vescio Vector"
            className="h-9 w-9 object-contain"
          />
          <div className="leading-none">
            <div className="font-display text-[15px] tracking-tight text-ink-100">VESCIO</div>
            <div className="mt-1 font-mono text-[9px] tracking-[0.3em] text-court-400">VECTOR</div>
          </div>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </div>
        <div className="panel p-6 sm:p-8">{children}</div>
      </div>
    </div>
  );
}

import React, { useState, useMemo } from "react";
import {
  useDB,
  useTenantUser,
  isMasterOwner,
  DEFAULT_PROTECTED_SUPER_ADMIN_EMAILS,
  MASTER_OWNER_EMAIL,
} from "@/lib/data-store";
import { useAuth } from "@/lib/auth";
import { doc, setDoc } from "firebase/firestore";
import { db as firestore } from "@/lib/firebase";
import { Panel, Field, Input, Button, Chip } from "@/components/kit";
import { ShieldCheck, Plus, Trash2, Lock, Sparkles, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export function ProtectedSuperAdminWhitelistManager() {
  const { db, updateAcademy, update, tenantId } = useDB();
  const { user: authUser, passwordUser } = useAuth();
  const currentUser = useTenantUser();

  const userEmail = (
    authUser?.email ||
    passwordUser?.email ||
    currentUser?.email ||
    ""
  ).toLowerCase();

  const [newEmail, setNewEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);

  // Derive consolidated whitelist
  const currentWhitelist = useMemo(() => {
    const rawList = Array.isArray(db.academy?.protectedSuperAdminEmails)
      ? db.academy.protectedSuperAdminEmails
      : DEFAULT_PROTECTED_SUPER_ADMIN_EMAILS;
    return Array.from(
      new Set(
        [
          ...DEFAULT_PROTECTED_SUPER_ADMIN_EMAILS,
          ...rawList.map((e) =>
            String(e || "")
              .trim()
              .toLowerCase(),
          ),
        ].filter(Boolean),
      ),
    );
  }, [db.academy?.protectedSuperAdminEmails]);

  // Strict Security Gate: Only the Master Owner (geogo3@gmail.com) can view or modify this manager
  if (!isMasterOwner(userEmail)) {
    return null;
  }

  async function handleAddEmail(e?: React.FormEvent) {
    if (e) e.preventDefault();
    const cleanEmail = newEmail.trim().toLowerCase();
    if (!cleanEmail) {
      toast.error("Please enter an email address.");
      return;
    }
    if (!cleanEmail.includes("@") || !cleanEmail.includes(".")) {
      toast.error("Please enter a valid email address (e.g., name@domain.com).");
      return;
    }
    if (currentWhitelist.includes(cleanEmail)) {
      toast.info(`${cleanEmail} is already on the Protected Super Admin Whitelist.`);
      setNewEmail("");
      return;
    }

    setSubmitting(true);
    const updatedWhitelist = Array.from(new Set([...currentWhitelist, cleanEmail]));

    try {
      // 1. Update local academy state
      await updateAcademy({
        protectedSuperAdminEmails: updatedWhitelist,
      });

      // 2. Persist to Firestore /tenants/{tenantId}
      if (firestore && tenantId) {
        const sanitizedId = `super-admin-${cleanEmail.replace(/[^a-zA-Z0-9]/g, "")}`;
        const tenantRootRef = doc(firestore, "tenants", tenantId);
        await setDoc(
          tenantRootRef,
          {
            protectedSuperAdminEmails: updatedWhitelist,
            roleMap: {
              [cleanEmail]: "Super Admin",
              [sanitizedId]: "Super Admin",
            },
            memberEmails: updatedWhitelist,
            academy: {
              protectedSuperAdminEmails: updatedWhitelist,
            },
          },
          { merge: true },
        );

        // 3. Upsert user record in /tenants/{tenantId}/users
        const userDocRef = doc(firestore, "tenants", tenantId, "users", sanitizedId);
        await setDoc(
          userDocRef,
          {
            id: sanitizedId,
            email: cleanEmail,
            name:
              cleanEmail === "piakerbej@gmail.com" || cleanEmail === "piakerbaje@gmail.com"
                ? "Pia Kerbej"
                : cleanEmail === "jess.chakh22@gmail.com"
                  ? "Jess Chakh"
                  : cleanEmail.split("@")[0],
            role: "Super Admin",
            branch: "All",
            branchScope: "All branches",
            active: true,
            method: "Google",
          },
          { merge: true },
        );
      }

      // 4. Update db.users in local store
      update((draft) => {
        const sanitizedId = `super-admin-${cleanEmail.replace(/[^a-zA-Z0-9]/g, "")}`;
        const existingIdx = draft.users.findIndex(
          (u) => u.email?.toLowerCase() === cleanEmail || u.id === sanitizedId,
        );
        const superAdminUser = {
          id: sanitizedId,
          email: cleanEmail,
          name:
            cleanEmail === "piakerbej@gmail.com" || cleanEmail === "piakerbaje@gmail.com"
              ? "Pia Kerbej"
              : cleanEmail === "jess.chakh22@gmail.com"
                ? "Jess Chakh"
                : cleanEmail.split("@")[0],
          role: "Super Admin",
          branch: "All",
          branchScope: "All branches" as const,
          active: true,
          method: "Google" as const,
        };
        if (existingIdx >= 0) {
          const nextUsers = [...draft.users];
          nextUsers[existingIdx] = { ...nextUsers[existingIdx], ...superAdminUser };
          return { ...draft, users: nextUsers };
        }
        return { ...draft, users: [superAdminUser, ...draft.users] };
      });

      // 5. Sync to localStorage for instant cold-boot recognition
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(
            "vv_protected_super_admins",
            JSON.stringify(updatedWhitelist),
          );
        } catch {
          // ignore
        }
      }

      toast.success(`Added ${cleanEmail} to Protected Super Admin Whitelist.`);
      setNewEmail("");
    } catch (err) {
      console.error("Failed to add to protected whitelist:", err);
      toast.error("Failed to save changes to Protected Super Admin Whitelist.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemoveEmail(emailToRemove: string) {
    const cleanEmail = emailToRemove.trim().toLowerCase();
    if (cleanEmail === MASTER_OWNER_EMAIL) {
      toast.error(
        "The Master Owner account (geogo3@gmail.com) cannot be removed from the whitelist.",
      );
      return;
    }

    setRemovingEmail(cleanEmail);
    const updatedWhitelist = currentWhitelist.filter((e) => e !== cleanEmail);

    try {
      // 1. Update local academy state
      await updateAcademy({
        protectedSuperAdminEmails: updatedWhitelist,
      });

      // 2. Persist to Firestore /tenants/{tenantId}
      if (firestore && tenantId) {
        const tenantRootRef = doc(firestore, "tenants", tenantId);
        await setDoc(
          tenantRootRef,
          {
            protectedSuperAdminEmails: updatedWhitelist,
            academy: {
              protectedSuperAdminEmails: updatedWhitelist,
            },
          },
          { merge: true },
        );
      }

      // 3. Sync to localStorage
      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem(
            "vv_protected_super_admins",
            JSON.stringify(updatedWhitelist),
          );
        } catch {
          // ignore
        }
      }

      toast.success(`Removed ${cleanEmail} from Protected Super Admin Whitelist.`);
    } catch (err) {
      console.error("Failed to remove from whitelist:", err);
      toast.error("Failed to update Protected Super Admin Whitelist.");
    } finally {
      setRemovingEmail(null);
    }
  }

  return (
    <Panel
      title="🔒 Protected Super Admin Whitelist (Master Owner Only)"
      meta="Survives Workspace Resets & Setup Wizard"
    >
      <div className="space-y-4 p-4">
        <div className="rounded-md border border-court-500/30 bg-court-500/10 p-3 text-xs leading-relaxed text-ink-200">
          <div className="flex items-center gap-2 font-medium text-court-300">
            <ShieldCheck className="h-4 w-4" />
            <span>Master Owner Immunity Matrix</span>
          </div>
          <p className="mt-1 text-ink-300">
            Accounts listed below are guaranteed permanent{" "}
            <strong className="text-ink-100">Super Admin</strong> access. Even if a full workspace
            reset is triggered and all database collections are wiped to 0, these accounts will
            automatically retain their Super Admin privileges and can access the Setup Wizard.
          </p>
        </div>

        {/* Email Add Form */}
        <form
          onSubmit={handleAddEmail}
          className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2"
        >
          <div className="flex-1">
            <Field
              label="Add Super Admin Email to Whitelist"
              hint="Enter user email (e.g. piakerbej@gmail.com)"
            >
              <Input
                type="email"
                placeholder="superadmin@academy.com"
                value={newEmail}
                onChange={setNewEmail}
                disabled={submitting}
              />
            </Field>
          </div>
          <Button type="submit" disabled={submitting || !newEmail.trim()} className="sm:mb-0.5">
            <Plus className="h-4 w-4 mr-1.5" />
            {submitting ? "Adding…" : "Add to Whitelist"}
          </Button>
        </form>

        {/* Whitelist Table */}
        <div className="divide-y divide-ink-800 rounded-md border border-ink-800 bg-ink-900/60 overflow-hidden">
          {currentWhitelist.map((email) => {
            const isOwner = email === MASTER_OWNER_EMAIL;
            return (
              <div
                key={email}
                className="flex flex-wrap items-center justify-between gap-3 p-3 transition-colors hover:bg-ink-850/50"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`grid h-7 w-7 place-items-center rounded ${
                      isOwner
                        ? "bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40"
                        : "bg-court-500/15 text-court-400 ring-1 ring-court-500/30"
                    }`}
                  >
                    {isOwner ? (
                      <Lock className="h-3.5 w-3.5" />
                    ) : (
                      <ShieldCheck className="h-3.5 w-3.5" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-semibold text-ink-100">{email}</span>
                      {isOwner ? (
                        <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-amber-400 ring-1 ring-amber-500/30">
                          <Lock className="h-2.5 w-2.5" />
                          Master Owner (Permanent)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-court-500/15 px-2 py-0.5 font-mono text-[9px] font-medium tracking-wider text-court-300 ring-1 ring-court-500/30">
                          <CheckCircle2 className="h-2.5 w-2.5" />
                          Survives Workspace Reset &amp; Setup Wizard
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {!isOwner && (
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={removingEmail === email}
                    onClick={() => handleRemoveEmail(email)}
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    {removingEmail === email ? "Removing…" : "Remove"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

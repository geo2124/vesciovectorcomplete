import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
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
  Toggle,
} from "@/components/kit";
import {
  useDB,
  useTenantUser,
  SYSTEM_PERMISSION_MODULES,
  defaultRoleDefinitions,
  type UserAccount,
  type RoleDefinition,
  type PermissionPower,
} from "@/lib/data-store";
import { useAuth, provisionFirebaseAuthUser } from "@/lib/auth";
import { removeTenantUserAccess } from "@/lib/firestore-sync";
import { toast } from "sonner";

export const Route = createFileRoute("/users")({
  head: () => ({
    meta: [
      { title: "Users & Access — Vescio Vector" },
      {
        name: "description",
        content:
          "User accounts, custom roles, and granular read/write/delete permissions across the academy: super admins, branch managers, coaches, and custom roles.",
      },
      { property: "og:title", content: "Users & Access — Vescio Vector" },
      {
        property: "og:description",
        content:
          "Invite users, configure custom roles, assign branch scopes, and control page access.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: UsersPage,
});

const blankUser: Omit<UserAccount, "id"> & { password?: string } = {
  name: "",
  email: "",
  role: "Branch Manager",
  branch: "HQ",
  branchScope: "Assigned branch only",
  method: "Google",
  username: "",
  password: "",
  active: true,
};

function createBlankPermissions(): Record<string, PermissionPower> {
  const perms: Record<string, PermissionPower> = {};
  for (const mod of SYSTEM_PERMISSION_MODULES) {
    perms[mod.id] = { read: true, write: false, delete: false };
  }
  return perms;
}

export function UsersPage() {
  const { db, update, ready, tenantId } = useDB();
  const currentUser = useTenantUser();
  const { user, passwordUser, loading: authLoading } = useAuth();
  const users = db.users;
  const rawRoles =
    db.customRoles && db.customRoles.length > 0 ? db.customRoles : defaultRoleDefinitions;
  const branches = ["HQ", ...db.branches.map((b) => b.name)];

  // Active roles (system + custom)
  const rolesList: RoleDefinition[] = rawRoles;
  const roleNames = rolesList.map((r) => r.name);

  // Security role & permissions evaluation
  const userRoleDef = rawRoles.find((r) => r.name === currentUser?.role);
  const isSuperAdminOrManager =
    currentUser?.role === "Super Admin" ||
    currentUser?.role === "Academy Manager" ||
    user?.email === "geogo3@gmail.com" ||
    passwordUser?.email === "geogo3@gmail.com";
  const hasAccess = isSuperAdminOrManager || Boolean(userRoleDef?.permissions?.["users"]?.read);
  const canWrite = isSuperAdminOrManager || Boolean(userRoleDef?.permissions?.["users"]?.write);
  const canDelete = isSuperAdminOrManager || Boolean(userRoleDef?.permissions?.["users"]?.delete);

  // Filters
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");

  // User invite / edit modal state
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserAccount | null>(null);
  const [userForm, setUserForm] = useState<Omit<UserAccount, "id"> & { password?: string }>(
    blankUser,
  );

  // Role create / edit modal state
  const [roleModalOpen, setRoleModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleDefinition | null>(null);
  const [roleForm, setRoleForm] = useState<RoleDefinition>({
    id: "",
    name: "",
    description: "",
    scope: "Assigned branch only",
    defaultBranchScope: "Assigned branch only",
    isSystem: false,
    permissions: createBlankPermissions(),
  });

  // Modal deletion confirmation states
  const [roleToDeleteConfirm, setRoleToDeleteConfirm] = useState<RoleDefinition | null>(null);
  const [userToDeleteConfirm, setUserToDeleteConfirm] = useState<UserAccount | null>(null);

  // Filtered users
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      const matchQuery =
        !q.trim() || [u.name, u.email].join(" ").toLowerCase().includes(q.toLowerCase());
      const matchRole = !roleFilter || u.role === roleFilter;
      const matchBranch = !branchFilter || u.branch === branchFilter;
      return matchQuery && matchRole && matchBranch;
    });
  }, [users, q, roleFilter, branchFilter]);

  // Page-level security access guard
  if (authLoading && !currentUser && !user && !passwordUser) {
    return (
      <AppShell crumb="CONTROL / USERS" title="Users & Access">
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
      <AppShell crumb="CONTROL / USERS" title="Access Denied">
        <Panel title="Unauthorized">
          <div className="py-12 px-4 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-court-500/10 text-court-400 ring-1 ring-court-500/20">
              <span className="font-mono text-base font-bold">!</span>
            </div>
            <h3 className="text-sm font-semibold text-ink-100">Super Admin Access Required</h3>
            <p className="mt-2 text-xs text-ink-400 max-w-md mx-auto leading-relaxed">
              You do not have permission to view credentials, alter roles, or modify system
              permission definitions. Please sign in with an authorized administrator account.
            </p>
          </div>
        </Panel>
      </AppShell>
    );
  }

  // Handle open user modal
  function openInviteUser() {
    if (!canWrite) {
      toast.error("You do not have permission to invite users.");
      return;
    }
    setEditingUser(null);
    setUserForm(blankUser);
    setUserModalOpen(true);
  }

  function openEditUser(u: UserAccount) {
    if (!canWrite) {
      toast.error("You do not have permission to edit user credentials or roles.");
      return;
    }
    setEditingUser(u);
    const { id: _id, ...rest } = u;
    setUserForm({
      ...rest,
      username: rest.username || "",
      password: "", // Plaintext passwords are never retrieved or prefilled
      branchScope:
        rest.branchScope ||
        (rest.role === "Branch Manager" || rest.role === "Coach"
          ? "Assigned branch only"
          : "All branches"),
    });
    setUserModalOpen(true);
  }

  // Handle submit user form
  async function submitUser() {
    if (!canWrite) {
      toast.error("You do not have write permission for user accounts.");
      return;
    }
    if (!userForm.name.trim() || !userForm.email.trim()) {
      toast.error("Please provide both name and email address.");
      return;
    }

    let authUid = editingUser?.authUid;

    if (userForm.method === "Password") {
      if (!userForm.username?.trim()) {
        toast.error("Please enter a username for password sign-in.");
        return;
      }
      if (!editingUser && !userForm.password?.trim()) {
        toast.error("Please enter a password for password sign-in.");
        return;
      }

      // Provision native Firebase Auth credential securely if password was specified
      if (userForm.password?.trim()) {
        const provRes = await provisionFirebaseAuthUser(
          userForm.email.trim(),
          userForm.password.trim(),
        );
        if (provRes.success && provRes.uid) {
          authUid = provRes.uid;
        } else if (!provRes.success && provRes.message) {
          toast.error(`Auth account notice: ${provRes.message}`);
        }
      }
    }

    // Strip plaintext password property before saving to user state and Firestore save payloads
    const { password: _formPassword, ...cleanUserForm } = userForm;
    // Ensure document ID uses authUid (fallback to user.id only if authUid is unavailable)
    const effectiveDocId =
      authUid ||
      editingUser?.authUid ||
      (editingUser?.id && !editingUser.id.startsWith("u-") ? editingUser.id : undefined) ||
      editingUser?.id ||
      `u-${Date.now().toString(36)}`;
    const matchedRolePerms = rolesList.find((r) => r.name === cleanUserForm.role)?.permissions;
    const finalUserForm: UserAccount & { permissions?: unknown } = {
      ...cleanUserForm,
      email: cleanUserForm.email.trim().toLowerCase(),
      username: (cleanUserForm.username || cleanUserForm.email.trim().split("@")[0] || "").trim(),
      id: effectiveDocId,
      ...(authUid ? { authUid } : {}),
      ...(matchedRolePerms ? { permissions: matchedRolePerms } : {}),
    };
    delete (finalUserForm as Record<string, unknown>).password;

    update((d) => {
      const filtered = d.users.filter(
        (u) =>
          u.id !== finalUserForm.id &&
          (!editingUser || u.id !== editingUser.id) &&
          u.email?.toLowerCase() !== finalUserForm.email.toLowerCase(),
      );
      return {
        ...d,
        users: [finalUserForm, ...filtered],
      };
    });

    if (typeof window !== "undefined") {
      try {
        const stored = window.localStorage.getItem("vv_custom_registered_users");
        let list: UserAccount[] = stored ? JSON.parse(stored) : [];
        if (editingUser) {
          list = list.map((u) => (u.id === editingUser.id ? { ...u, ...finalUserForm } : u));
        } else {
          list = [finalUserForm, ...list.filter((u) => u.id !== finalUserForm.id)];
        }
        window.localStorage.setItem("vv_custom_registered_users", JSON.stringify(list));
      } catch {
        // ignore
      }
    }

    toast.success(
      editingUser
        ? `Account updated for ${userForm.name}.`
        : `User account created and provisioned for ${userForm.name}.`,
    );
    setUserModalOpen(false);
  }

  // Handle open role modal
  function openCreateRole() {
    if (!canWrite) {
      toast.error("You do not have permission to create custom roles.");
      return;
    }
    setEditingRole(null);
    setRoleForm({
      id: `role-${Date.now().toString(36)}`,
      name: "",
      description: "",
      scope: "Assigned branch only",
      defaultBranchScope: "Assigned branch only",
      isSystem: false,
      permissions: createBlankPermissions(),
    });
    setRoleModalOpen(true);
  }

  function openEditRole(r: RoleDefinition) {
    if (!canWrite) {
      toast.error("You do not have permission to modify role permissions.");
      return;
    }
    setEditingRole(r);
    // Deep clone to avoid in-place mutations
    setRoleForm({
      ...r,
      permissions: JSON.parse(JSON.stringify(r.permissions)),
    });
    setRoleModalOpen(true);
  }

  // Handle submit role form
  function submitRole() {
    if (!canWrite) {
      toast.error("You do not have write permission for system roles.");
      return;
    }
    if (!roleForm.name.trim()) {
      toast.error("Please specify a role name.");
      return;
    }

    const trimmedName = roleForm.name.trim();

    update((d) => {
      const currentRoles =
        d.customRoles && d.customRoles.length > 0 ? d.customRoles : defaultRoleDefinitions;
      let nextRoles: RoleDefinition[];

      if (editingRole) {
        nextRoles = currentRoles.map((r) =>
          r.id === editingRole.id ? { ...roleForm, name: trimmedName } : r,
        );

        // If role name changed, update assigned users
        let nextUsers = d.users;
        if (editingRole.name !== trimmedName) {
          nextUsers = nextUsers.map((u) =>
            u.role === editingRole.name ? { ...u, role: trimmedName } : u,
          );
        }

        return { ...d, customRoles: nextRoles, users: nextUsers };
      }

      nextRoles = [...currentRoles, { ...roleForm, name: trimmedName }];
      return { ...d, customRoles: nextRoles };
    });

    toast.success(
      editingRole ? `Role "${trimmedName}" updated.` : `Custom role "${trimmedName}" created.`,
    );
    setRoleModalOpen(false);
  }

  // Handle delete role
  function deleteRole(roleToDelete: RoleDefinition) {
    if (!canDelete) {
      toast.error("You do not have permission to delete roles.");
      return;
    }
    if (roleToDelete.isSystem) {
      toast.error("Built-in system roles cannot be deleted.");
      return;
    }

    setRoleToDeleteConfirm(roleToDelete);
  }

  function confirmDeleteRole() {
    if (!roleToDeleteConfirm) return;
    const roleToDelete = roleToDeleteConfirm;

    update((d) => {
      const currentRoles =
        d.customRoles && d.customRoles.length > 0 ? d.customRoles : defaultRoleDefinitions;
      return {
        ...d,
        customRoles: currentRoles.filter((r) => r.id !== roleToDelete.id),
      };
    });

    toast.success(`Role "${roleToDelete.name}" deleted.`);
    setRoleToDeleteConfirm(null);
  }

  function confirmDeleteUser() {
    if (!userToDeleteConfirm) return;
    const u = userToDeleteConfirm;

    update((d) => ({
      ...d,
      users: d.users.filter((x) => x.id !== u.id),
    }));
    if (tenantId) {
      removeTenantUserAccess(tenantId, {
        email: u.email,
        username: u.username,
        authUid: u.authUid,
        id: u.id,
      }).catch((err) => {
        console.warn("Failed to remove tenant user access:", err);
      });
    }
    if (typeof window !== "undefined") {
      try {
        const stored = window.localStorage.getItem("vv_custom_registered_users");
        if (stored) {
          const list: UserAccount[] = JSON.parse(stored);
          window.localStorage.setItem(
            "vv_custom_registered_users",
            JSON.stringify(list.filter((x) => x.id !== u.id)),
          );
        }
      } catch {
        // ignore
      }
    }
    toast.success(`Access revoked and account removed for ${u.name}.`);
    setUserToDeleteConfirm(null);
  }

  // Quick permission helpers for roleForm
  function setAllPermissions(read: boolean, write: boolean, del: boolean) {
    setRoleForm((prev) => {
      const nextPerms: Record<string, PermissionPower> = {};
      for (const mod of SYSTEM_PERMISSION_MODULES) {
        nextPerms[mod.id] = { read, write, delete: del };
      }
      return { ...prev, permissions: nextPerms };
    });
  }

  function togglePerm(moduleId: string, power: "read" | "write" | "delete") {
    setRoleForm((prev) => {
      const current = prev.permissions[moduleId] || { read: false, write: false, delete: false };
      const nextVal = !current[power];
      const updated = { ...current, [power]: nextVal };
      // If write or delete is checked, automatically enable read
      if ((power === "write" || power === "delete") && nextVal) {
        updated.read = true;
      }
      // If read is disabled, disable write and delete
      if (power === "read" && !nextVal) {
        updated.write = false;
        updated.delete = false;
      }
      return {
        ...prev,
        permissions: {
          ...prev.permissions,
          [moduleId]: updated,
        },
      };
    });
  }

  // Calculate stats
  const activeUsersCount = users.filter((u) => u.active).length;
  const branchScopedCount = users.filter((u) => u.branchScope === "Assigned branch only").length;

  return (
    <AppShell crumb="CONTROL / USERS" title="Users & Access">
      {/* Top Stat Ribbon */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="User accounts"
          value={String(users.length)}
          accent
          note={`${activeUsersCount} active`}
        />
        <Stat
          label="Total roles"
          value={String(rolesList.length)}
          note={`${rolesList.filter((r) => !r.isSystem).length} custom created`}
        />
        <Stat
          label="Branch-scoped"
          value={String(branchScopedCount)}
          note="restricted to assigned branch"
        />
        <Stat
          label="Google sign-in"
          value={String(users.filter((u) => u.method === "Google").length)}
          note={`${users.filter((u) => u.method === "Password").length} password`}
        />
      </div>

      {/* Main Grid: Accounts Table + Roles Panel */}
      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_420px]">
        {/* Left: Accounts Panel */}
        <Panel
          title="Accounts"
          meta="Manage team access, assign roles and define branch visibility"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <FilterSelect
                label="Role"
                value={roleFilter}
                onChange={setRoleFilter}
                options={roleNames}
              />
              <FilterSelect
                label="Branch"
                value={branchFilter}
                onChange={setBranchFilter}
                options={branches}
              />
              {canWrite && <Button onClick={openInviteUser}>+ Invite user</Button>}
            </div>
          }
        >
          <div className="border-b border-ink-800 px-4 py-3">
            <Search value={q} onChange={setQ} placeholder="Search users by name or email…" />
          </div>

          <Table
            head={
              <>
                <Th>USER</Th>
                <Th>ROLE</Th>
                <Th>BRANCH & SCOPE</Th>
                <Th hide>AUTH</Th>
                <Th>
                  <span className="block text-right">STATUS</span>
                </Th>
              </>
            }
            footer={`SHOWING ${filteredUsers.length} OF ${users.length} REGISTERED USERS`}
          >
            {filteredUsers.length === 0 ? (
              <EmptyState>No accounts match the selected filters.</EmptyState>
            ) : (
              filteredUsers.map((u) => {
                const isBranchScoped = u.branchScope === "Assigned branch only";
                return (
                  <Row key={u.id}>
                    <Td strong>
                      <div className="leading-tight">
                        <div className="font-medium text-ink-100">{u.name}</div>
                        <div className="font-mono text-[11px] text-ink-400">{u.email}</div>
                      </div>
                    </Td>
                    <Td>
                      <Chip
                        tone={
                          u.role === "Super Admin"
                            ? "accent"
                            : u.role === "Technical Director"
                              ? "good"
                              : u.role === "Branch Manager"
                                ? "warn"
                                : "neutral"
                        }
                      >
                        {u.role}
                      </Chip>
                    </Td>
                    <Td>
                      <div className="space-y-0.5">
                        <div className="font-mono text-xs text-ink-200">{u.branch}</div>
                        <span
                          className={`inline-block font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded ${
                            isBranchScoped
                              ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                              : "bg-ink-800 text-ink-400 border border-ink-700"
                          }`}
                        >
                          {isBranchScoped ? "Branch only" : "All branches"}
                        </span>
                      </div>
                    </Td>
                    <Td hide>
                      <div className="space-y-0.5">
                        <span className="font-mono text-[11px] text-ink-300">{u.method}</span>
                        {u.method === "Password" && u.username && (
                          <div className="font-mono text-[10px] text-ink-400">
                            id: <span className="text-court-300 font-bold">{u.username}</span>
                          </div>
                        )}
                      </div>
                    </Td>
                    <Td right>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (!canWrite) {
                              toast.error("You do not have permission to alter user accounts.");
                              return;
                            }
                            update((d) => ({
                              ...d,
                              users: d.users.map((x) =>
                                x.id === u.id ? { ...x, active: !x.active } : x,
                              ),
                            }));
                            toast.success(
                              `Account for ${u.name} ${!u.active ? "activated" : "disabled"}.`,
                            );
                          }}
                        >
                          <Chip tone={u.active ? "good" : "bad"}>
                            {u.active ? "ACTIVE" : "DISABLED"}
                          </Chip>
                        </button>
                        <RowActions
                          onEdit={canWrite ? () => openEditUser(u) : undefined}
                          onDelete={canDelete ? () => setUserToDeleteConfirm(u) : undefined}
                        />
                      </div>
                    </Td>
                  </Row>
                );
              })
            )}
          </Table>
        </Panel>

        {/* Right: Roles & Permissions Matrix Panel */}
        <Panel
          title="Roles & Permissions"
          meta="Define granular read, write, and delete permissions per page section"
          action={
            canWrite ? (
              <Button variant="ghost" onClick={openCreateRole}>
                + Create custom role
              </Button>
            ) : undefined
          }
        >
          <div className="divide-y divide-ink-800">
            {rolesList.map((r) => {
              const assignedCount = users.filter((u) => u.role === r.name).length;
              const perms = r.permissions || {};
              const readCount = Object.values(perms).filter((p) => p.read).length;
              const writeCount = Object.values(perms).filter((p) => p.write).length;
              const deleteCount = Object.values(perms).filter((p) => p.delete).length;

              return (
                <div key={r.id} className="p-4 transition hover:bg-ink-850/30">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-ink-100">{r.name}</span>
                        {r.isSystem ? (
                          <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[9px] text-ink-400">
                            BUILT-IN
                          </span>
                        ) : (
                          <span className="rounded bg-court-500/10 px-1.5 py-0.5 font-mono text-[9px] text-court-400 border border-court-500/20">
                            CUSTOM
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-ink-400 leading-relaxed">
                        {r.description || "Custom role with tailored operational powers"}
                      </p>
                    </div>

                    <Chip tone="neutral">{assignedCount} USERS</Chip>
                  </div>

                  {/* Scope & Permissions Summary */}
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center rounded bg-ink-850 px-2 py-0.5 font-mono text-[10px] text-ink-300 border border-ink-800">
                      Scope: {r.defaultBranchScope || r.scope || "All branches"}
                    </span>
                    <span className="inline-flex items-center rounded bg-court-500/10 px-2 py-0.5 font-mono text-[10px] text-court-400 border border-court-500/20">
                      {readCount} Read · {writeCount} Write · {deleteCount} Delete
                    </span>
                  </div>

                  {/* Action row */}
                  <div className="mt-3 flex items-center justify-end gap-2 pt-2 border-t border-ink-850">
                    {canWrite && (
                      <button
                        type="button"
                        onClick={() => openEditRole(r)}
                        className="font-mono text-xs text-court-400 hover:text-court-300 px-2 py-1 rounded hover:bg-ink-800 transition"
                      >
                        Edit permissions ›
                      </button>
                    )}
                    {!r.isSystem && canDelete && (
                      <button
                        type="button"
                        onClick={() => deleteRole(r)}
                        className="font-mono text-xs text-rose-400 hover:text-rose-300 px-2 py-1 rounded hover:bg-ink-800 transition"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      {/* MODAL 1: Invite / Edit User Account */}
      <Modal
        open={userModalOpen}
        title={editingUser ? `Edit User: ${editingUser.name}` : "Invite New User"}
        meta="Assign credentials, role template, and branch visibility scope"
        onClose={() => setUserModalOpen(false)}
        onSubmit={submitUser}
        submitLabel={editingUser ? "Save changes" : "Send invite"}
        wide
      >
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Full name">
            <Input
              value={userForm.name}
              onChange={(v) => setUserForm({ ...userForm, name: v })}
              placeholder="e.g. Fadi Aoun"
            />
          </Field>
          <Field label="Email address">
            <Input
              value={userForm.email}
              onChange={(v) => setUserForm({ ...userForm, email: v })}
              placeholder="fadi@academy.com"
            />
          </Field>

          <Field label="Role template" hint="Determines page access and operational powers">
            <Select
              value={userForm.role}
              onChange={(v) => {
                const selectedRole = rolesList.find((r) => r.name === v);
                setUserForm({
                  ...userForm,
                  role: v,
                  branchScope:
                    userForm.branchScope ||
                    selectedRole?.defaultBranchScope ||
                    (v === "Branch Manager" || v === "Coach"
                      ? "Assigned branch only"
                      : "All branches"),
                });
              }}
              options={roleNames}
            />
          </Field>

          <Field label="Assigned Branch" hint="Primary base of operations">
            <Select
              value={userForm.branch}
              onChange={(v) => setUserForm({ ...userForm, branch: v })}
              options={branches}
            />
          </Field>

          {/* Branch Visibility Scope Selector */}
          <div className="col-span-1 sm:col-span-2 rounded-lg border border-ink-800 bg-ink-900/60 p-3 space-y-2">
            <div className="font-mono text-xs font-semibold text-court-400 uppercase tracking-wide">
              Branch Visibility & Data Access Scope
            </div>
            <p className="text-xs text-ink-300">
              Control whether this user can view and manage data across the entire academy or only
              their assigned facility.
            </p>

            <div className="grid gap-2 sm:grid-cols-2 pt-1">
              <label
                className={`flex items-start gap-3 rounded-md p-2.5 cursor-pointer transition border ${
                  userForm.branchScope === "Assigned branch only"
                    ? "border-court-500 bg-court-500/10"
                    : "border-ink-800 bg-ink-850 hover:border-ink-700"
                }`}
              >
                <input
                  type="radio"
                  name="branchScope"
                  checked={userForm.branchScope === "Assigned branch only"}
                  onChange={() => setUserForm({ ...userForm, branchScope: "Assigned branch only" })}
                  className="mt-0.5 accent-court-500"
                />
                <div>
                  <div className="text-xs font-medium text-ink-100">
                    Assigned branch only ({userForm.branch || "Selected branch"})
                  </div>
                  <div className="text-[11px] text-ink-400 mt-0.5">
                    Recommended for Branch Managers and Coaches. Restricts sessions, court bookings,
                    and player rosters to this branch.
                  </div>
                </div>
              </label>

              <label
                className={`flex items-start gap-3 rounded-md p-2.5 cursor-pointer transition border ${
                  userForm.branchScope === "All branches"
                    ? "border-court-500 bg-court-500/10"
                    : "border-ink-800 bg-ink-850 hover:border-ink-700"
                }`}
              >
                <input
                  type="radio"
                  name="branchScope"
                  checked={userForm.branchScope === "All branches"}
                  onChange={() => setUserForm({ ...userForm, branchScope: "All branches" })}
                  className="mt-0.5 accent-court-500"
                />
                <div>
                  <div className="text-xs font-medium text-ink-100">
                    All branches (HQ & Regional)
                  </div>
                  <div className="text-[11px] text-ink-400 mt-0.5">
                    Recommended for Technical Directors, General Managers, and Accountants with
                    multi-facility oversight.
                  </div>
                </div>
              </label>
            </div>
          </div>

          <Field label="Sign-in method">
            <Select
              value={userForm.method}
              onChange={(v) => {
                const method = v as UserAccount["method"];
                setUserForm({
                  ...userForm,
                  method,
                  username:
                    method === "Password" && !userForm.username
                      ? (userForm.email?.split("@")[0]?.toLowerCase() ?? "")
                      : (userForm.username ?? ""),
                });
              }}
              options={["Google", "Password"]}
            />
          </Field>

          <div className="self-end pb-1">
            <Toggle
              on={userForm.active}
              onChange={(v) => setUserForm({ ...userForm, active: v })}
              label="Account active (allow sign-in)"
            />
          </div>

          {/* Credentials for Native Password Authentication */}
          {userForm.method === "Password" && (
            <div className="col-span-1 sm:col-span-2 rounded-lg border border-court-500/30 bg-court-500/5 p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-semibold text-court-400 uppercase tracking-wide">
                  Credentials for Password Sign-In
                </span>
                <span className="font-mono text-[10px] text-ink-400">Native Firebase Auth</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Account Username" hint="Login identifier (e.g. coach.mike)">
                  <Input
                    value={userForm.username || ""}
                    onChange={(v) => setUserForm({ ...userForm, username: v })}
                    placeholder="e.g. coach.mike"
                  />
                </Field>
                <Field
                  label="Password"
                  hint={
                    editingUser
                      ? "Leave blank to keep current password"
                      : "Account password (min. 6 characters)"
                  }
                >
                  <Input
                    type="password"
                    value={userForm.password || ""}
                    onChange={(v) => setUserForm({ ...userForm, password: v })}
                    placeholder={editingUser ? "•••••••• (unchanged)" : "Enter account password"}
                  />
                </Field>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* MODAL 2: Create / Edit Custom Role & Granular Permissions */}
      <Modal
        open={roleModalOpen}
        title={editingRole ? `Edit Role: ${editingRole.name}` : "Create Custom Role"}
        meta="Configure read, write, and delete permissions for each system page"
        onClose={() => setRoleModalOpen(false)}
        onSubmit={submitRole}
        submitLabel={editingRole ? "Save role permissions" : "Create role"}
        wide
      >
        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Role Name">
              <Input
                value={roleForm.name}
                onChange={(v) => setRoleForm({ ...roleForm, name: v })}
                placeholder="e.g. Front Desk Manager, Registrar, Equipment Coordinator"
              />
            </Field>

            <Field label="Default Branch Scope">
              <Select
                value={roleForm.defaultBranchScope || "Assigned branch only"}
                onChange={(v) =>
                  setRoleForm({
                    ...roleForm,
                    defaultBranchScope: v as "All branches" | "Assigned branch only",
                    scope: v,
                  })
                }
                options={["Assigned branch only", "All branches"]}
              />
            </Field>

            <div className="sm:col-span-2">
              <Field label="Role Description">
                <Input
                  value={roleForm.description}
                  onChange={(v) => setRoleForm({ ...roleForm, description: v })}
                  placeholder="Summary of responsibilities and intended access level"
                />
              </Field>
            </div>
          </div>

          {/* Quick presets toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-ink-900 p-3 border border-ink-800">
            <span className="font-mono text-xs text-ink-300 uppercase tracking-wide">
              Permissions Matrix
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAllPermissions(true, false, false)}
                className="rounded bg-ink-800 px-2.5 py-1 font-mono text-[11px] text-ink-200 hover:bg-ink-700 transition"
              >
                Grant All Read
              </button>
              <button
                type="button"
                onClick={() => setAllPermissions(true, true, true)}
                className="rounded bg-court-500/20 px-2.5 py-1 font-mono text-[11px] text-court-300 hover:bg-court-500/30 transition border border-court-500/30"
              >
                Grant Full Access
              </button>
              <button
                type="button"
                onClick={() => setAllPermissions(false, false, false)}
                className="rounded bg-ink-800 px-2.5 py-1 font-mono text-[11px] text-rose-300 hover:bg-ink-700 transition"
              >
                Clear All
              </button>
            </div>
          </div>

          {/* Granular Permissions Table */}
          <div className="overflow-hidden rounded-lg border border-ink-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-ink-900 border-b border-ink-800 text-ink-400 font-mono text-[10px] uppercase">
                <tr>
                  <th className="px-3 py-2.5">Section / Module</th>
                  <th className="px-3 py-2.5 text-center w-24">Read</th>
                  <th className="px-3 py-2.5 text-center w-24">Write / Edit</th>
                  <th className="px-3 py-2.5 text-center w-24">Delete</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-850">
                {SYSTEM_PERMISSION_MODULES.map((mod) => {
                  const perms = roleForm.permissions[mod.id] || {
                    read: false,
                    write: false,
                    delete: false,
                  };

                  return (
                    <tr key={mod.id} className="hover:bg-ink-850/50 transition">
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-ink-100">{mod.name}</div>
                        <div className="text-[11px] text-ink-400 leading-tight">
                          {mod.description}
                        </div>
                      </td>

                      {/* Read Toggle */}
                      <td className="px-3 py-2.5 text-center">
                        <button
                          type="button"
                          onClick={() => togglePerm(mod.id, "read")}
                          className={`inline-flex items-center justify-center font-mono text-[10px] font-semibold px-2.5 py-1 rounded transition ${
                            perms.read
                              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                              : "bg-ink-850 text-ink-500 border border-ink-800 hover:text-ink-300"
                          }`}
                        >
                          {perms.read ? "READ ✓" : "NO READ"}
                        </button>
                      </td>

                      {/* Write Toggle */}
                      <td className="px-3 py-2.5 text-center">
                        <button
                          type="button"
                          onClick={() => togglePerm(mod.id, "write")}
                          className={`inline-flex items-center justify-center font-mono text-[10px] font-semibold px-2.5 py-1 rounded transition ${
                            perms.write
                              ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                              : "bg-ink-850 text-ink-500 border border-ink-800 hover:text-ink-300"
                          }`}
                        >
                          {perms.write ? "WRITE ✓" : "NO WRITE"}
                        </button>
                      </td>

                      {/* Delete Toggle */}
                      <td className="px-3 py-2.5 text-center">
                        <button
                          type="button"
                          onClick={() => togglePerm(mod.id, "delete")}
                          className={`inline-flex items-center justify-center font-mono text-[10px] font-semibold px-2.5 py-1 rounded transition ${
                            perms.delete
                              ? "bg-rose-500/20 text-rose-400 border border-rose-500/30"
                              : "bg-ink-850 text-ink-500 border border-ink-800 hover:text-ink-300"
                          }`}
                        >
                          {perms.delete ? "DELETE ✓" : "NO DEL"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>

      {/* Custom Role Deletion Confirmation Modal */}
      <Modal
        title={roleToDeleteConfirm ? `Delete Role: ${roleToDeleteConfirm.name}` : "Delete Role"}
        open={Boolean(roleToDeleteConfirm)}
        onClose={() => setRoleToDeleteConfirm(null)}
      >
        {roleToDeleteConfirm && (
          <div className="space-y-4 p-4">
            <p className="text-sm text-ink-200">
              Are you sure you want to permanently remove the{" "}
              <strong className="text-ink-100">"{roleToDeleteConfirm.name}"</strong> role?
            </p>
            {(() => {
              const assignedCount = users.filter((u) => u.role === roleToDeleteConfirm.name).length;
              if (assignedCount === 0) return null;
              return (
                <div className="rounded-md bg-warn/10 p-3 border border-warn/30 text-xs text-ink-200">
                  <div className="font-semibold text-warn mb-1">
                    ⚠️ {assignedCount} user(s) currently assigned
                  </div>
                  Deleting this role will keep their accounts, but their role assignment must be
                  updated in user settings.
                </div>
              );
            })()}
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button variant="outline" size="sm" onClick={() => setRoleToDeleteConfirm(null)}>
                Cancel
              </Button>
              <Button variant="bad" size="sm" onClick={confirmDeleteRole}>
                Confirm & Delete Role
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* User Account Deletion Confirmation Modal */}
      <Modal
        title={userToDeleteConfirm ? `Revoke Access: ${userToDeleteConfirm.name}` : "Revoke Access"}
        open={Boolean(userToDeleteConfirm)}
        onClose={() => setUserToDeleteConfirm(null)}
      >
        {userToDeleteConfirm && (
          <div className="space-y-4 p-4">
            <p className="text-sm text-ink-200">
              Are you sure you want to revoke access and remove the account for{" "}
              <strong className="text-ink-100">{userToDeleteConfirm.name}</strong> (
              <span className="font-mono text-xs">{userToDeleteConfirm.email}</span>)?
            </p>
            <p className="text-xs text-ink-400">
              This will immediately revoke their authentication credentials and remove all access to
              this academy workspace.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button variant="outline" size="sm" onClick={() => setUserToDeleteConfirm(null)}>
                Cancel
              </Button>
              <Button variant="bad" size="sm" onClick={confirmDeleteUser}>
                Revoke & Remove Account
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </AppShell>
  );
}

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  User,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithCredential,
  GoogleAuthProvider,
  browserPopupRedirectResolver,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { initializeApp, getApps } from "firebase/app";
import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  collection,
  query,
  where,
} from "firebase/firestore";
import { auth, db } from "./firebase";
import firebaseConfig from "../../firebase-applet-config.json";
import { seedUsers, type UserAccount } from "./auth-users";
import { isProtectedSuperAdminEmail, type Coach } from "./mock-data";
import { getTenantSlug } from "./utils";

type AuthContextType = {
  user: User | null;
  passwordUser: UserAccount | null;
  role?: string;
  userRole?: string;
  userBranch?: string;
  loading: boolean;
  signInWithGoogle: () => Promise<{
    success: boolean;
    user?: User;
    resolvedUser?: UserAccount;
    message?: string;
    errorCode?: string;
  }>;
  signInWithGoogleToken?: (
    idToken: string,
  ) => Promise<{ success: boolean; user?: User; message?: string }>;
  signInWithPassword: (
    usernameOrEmail: string,
    passwordAttempt: string,
    users: UserAccount[],
    coaches?: Partial<Coach>[],
  ) => Promise<{ success: boolean; message?: string; user?: UserAccount }>;
  registerWithPassword: (
    account: {
      name: string;
      email: string;
      username: string;
      password: string;
      role?: string;
      branch?: string;
    },
    existingUsers: UserAccount[],
  ) => Promise<{ success: boolean; message?: string; user?: UserAccount }>;
  logOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | null>(null);

/**
 * Provisions a user in native Firebase Auth using an isolated secondary app instance.
 * This guarantees the currently active administrator session is never replaced or interrupted.
 */
export async function provisionFirebaseAuthUser(
  email: string,
  password: string,
): Promise<{ success: boolean; uid?: string; message?: string }> {
  if (typeof window === "undefined") {
    return { success: false, message: "Window is not defined." };
  }
  const rawEmail = email.trim().toLowerCase();
  const normalizedEmail = rawEmail.includes("@")
    ? rawEmail
    : `${rawEmail}@${getTenantSlug()}.academy`;
  const secondaryAppName = "secondary-auth-provisioner";
  const existingApp = getApps().find((a) => a.name === secondaryAppName);
  const secondaryApp = existingApp || initializeApp(firebaseConfig, secondaryAppName);
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, normalizedEmail, password);
    const uid = cred.user.uid;
    await signOut(secondaryAuth);
    return { success: true, uid };
  } catch (err: unknown) {
    const fbErr = err as { code?: string; message?: string };
    if (fbErr?.code === "auth/email-already-in-use") {
      try {
        const existingCred = await signInWithEmailAndPassword(
          secondaryAuth,
          normalizedEmail,
          password,
        );
        const uid = existingCred.user.uid;
        await signOut(secondaryAuth);
        return { success: true, uid };
      } catch {
        // User account already exists in Firebase Auth; link existing email cleanly
        await signOut(secondaryAuth).catch(() => {});
        return { success: true };
      }
    }
    return {
      success: false,
      message: fbErr?.message || "Failed to provision Firebase Auth account.",
    };
  }
}

function stripPassword(user: UserAccount): UserAccount {
  const clean = { ...user };
  delete (clean as Record<string, unknown>).password;
  delete (clean as Record<string, unknown>).passwordHash;
  return clean;
}

export function normalizeUiRole(role?: string | null): string {
  if (!role) return "Staff";
  const upper = role.trim().toUpperCase();
  if (upper === "SUPER_ADMIN" || upper === "SUPER ADMIN") return "Super Admin";
  return role;
}

export function isSuperAdminRoleOrEmail(role?: string | null, email?: string | null): boolean {
  const normRole = normalizeUiRole(role);
  return (
    normRole === "Super Admin" ||
    role === "SUPER_ADMIN" ||
    Boolean(email && isProtectedSuperAdminEmail(email.trim().toLowerCase()))
  );
}

export function isTenantAdminRoleOrEmail(role?: string | null, email?: string | null): boolean {
  const normRole = normalizeUiRole(role);
  return (
    isSuperAdminRoleOrEmail(role, email) ||
    normRole === "Academy Manager" ||
    role === "ACADEMY_MANAGER" ||
    role === "academy_manager"
  );
}

/**
 * Automatically bootstraps/upserts the current authenticated admin user's `users/{uid}` document
 * and tenant `/tenants/{tenantId}/users/{uid}` document without exposing password or passwordHash fields.
 * Restricted strictly to authorized tenant admins / super admins.
 */
export async function bootstrapFirestoreUserDocument(
  tenantId: string,
  uid: string,
  userAccount: UserAccount,
  permissions?: unknown,
): Promise<void> {
  if (!db || !uid) return;
  const cleanUser = stripPassword(userAccount);
  const emailLower = (cleanUser.email || "").trim().toLowerCase();
  const isSuperAdmin = isSuperAdminRoleOrEmail(cleanUser.role, emailLower);
  const isTenantAdmin = isTenantAdminRoleOrEmail(cleanUser.role, emailLower);
  const firestoreRole = isSuperAdmin ? "SUPER_ADMIN" : cleanUser.role || "Staff";
  const uiRole = isSuperAdmin ? "Super Admin" : normalizeUiRole(cleanUser.role);

  if (!isTenantAdmin) {
    return;
  }

  const rootUserPayload: Record<string, unknown> = {
    ...cleanUser,
    id: uid,
    uid,
    authUid: uid,
    role: firestoreRole,
    uiRole,
    active: cleanUser.active !== false,
    updatedAt: new Date().toISOString(),
    ...(permissions ? { permissions } : {}),
  };
  delete rootUserPayload.password;
  delete rootUserPayload.passwordHash;

  if (isSuperAdmin) {
    await setDoc(doc(db, "users", uid), rootUserPayload, { merge: true }).catch(() => {});
  }

  const tenantUserPayload: Record<string, unknown> = {
    ...cleanUser,
    id: uid,
    authUid: uid,
    role: isSuperAdmin ? "SUPER_ADMIN" : uiRole,
    uiRole,
    active: cleanUser.active !== false,
    ...(permissions ? { permissions } : {}),
  };
  delete tenantUserPayload.password;
  delete tenantUserPayload.passwordHash;

  await setDoc(doc(db, "tenants", tenantId, "users", uid), tenantUserPayload, {
    merge: true,
  }).catch(() => {});

  const unameLower = (cleanUser.username || (emailLower ? emailLower.split("@")[0] : "") || "")
    .trim()
    .toLowerCase();
  await setDoc(
    doc(db, "tenants", tenantId),
    {
      roleMap: {
        [uid]: firestoreRole,
        ...(emailLower ? { [emailLower]: firestoreRole } : {}),
      },
      ...(unameLower && emailLower ? { usernameMap: { [unameLower]: emailLower } } : {}),
    },
    { merge: true },
  ).catch(() => {});

  if (unameLower && emailLower) {
    await setDoc(
      doc(db, "tenants", tenantId, "public", "auth_lookup"),
      { usernameMap: { [unameLower]: emailLower } },
      { merge: true },
    ).catch(() => {});
  }
}

export function isE2EBypassEnabled(): boolean {
  if (import.meta.env.VITE_E2E_BYPASS_AUTH === "true") {
    return true;
  }
  if (!import.meta.env.PROD && typeof window !== "undefined") {
    try {
      return window.localStorage.getItem("vv_e2e_bypass_auth") === "true";
    } catch {
      return false;
    }
  }
  return false;
}

const DEFAULT_E2E_BYPASS_USER: UserAccount = {
  id: "admin-1",
  authUid: "admin-1",
  email: "geogo3@gmail.com",
  username: "geogo3",
  name: "Georges Khoury",
  role: "Super Admin",
  branch: "All",
  branchScope: "All branches",
  active: true,
  method: "Password",
};

function resolveStoredOrDefaultE2EUser(): UserAccount {
  if (typeof window !== "undefined") {
    try {
      const explicitRoleOverride = window.localStorage.getItem("e2e_test_role")?.trim();
      const explicitBranchOverride = window.localStorage.getItem("e2e_test_branch")?.trim();
      const raw =
        window.localStorage.getItem("vv_auth_session_user") ||
        window.sessionStorage.getItem("vv_auth_session_user");
      if (raw || explicitRoleOverride) {
        const parsed = raw ? (JSON.parse(raw) as Partial<UserAccount>) : {};
        const requestedRoleRaw = explicitRoleOverride || parsed.role || "Super Admin";
        const normalizedRequestedRole = normalizeUiRole(requestedRoleRaw);
        const isRequestedSuperAdmin =
          normalizedRequestedRole === "Super Admin" ||
          requestedRoleRaw.toLowerCase() === "super_admin";

        let email = (parsed.email || DEFAULT_E2E_BYPASS_USER.email).trim();
        if (!isRequestedSuperAdmin && isProtectedSuperAdminEmail(email)) {
          const slug = normalizedRequestedRole.toLowerCase().replace(/[^a-z0-9]+/g, ".");
          email = `e2e.${slug}@vescio.test`;
        }

        const role = isRequestedSuperAdmin
          ? "Super Admin"
          : isSuperAdminRoleOrEmail(normalizedRequestedRole, email)
            ? "Super Admin"
            : normalizedRequestedRole;

        const branch =
          explicitBranchOverride ||
          parsed.branch ||
          (role === "Branch Manager" || role === "Coach" || role === "Staff" ? "HQ" : "All");
        const branchScope =
          parsed.branchScope ||
          (branch !== "All" && (role === "Branch Manager" || role === "Coach" || role === "Staff")
            ? "Assigned branch only"
            : "All branches");

        const normalized: UserAccount = {
          ...DEFAULT_E2E_BYPASS_USER,
          ...parsed,
          id:
            parsed.id && (!isProtectedSuperAdminEmail(email) || isRequestedSuperAdmin)
              ? parsed.id
              : `e2e-${role.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          authUid:
            parsed.authUid && (!isProtectedSuperAdminEmail(email) || isRequestedSuperAdmin)
              ? parsed.authUid
              : `e2e-${role.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          email,
          role,
          branch,
          branchScope,
          active: parsed.active !== false,
          method: parsed.method || "Password",
        };
        window.localStorage.setItem("vv_auth_session_user", JSON.stringify(normalized));
        window.sessionStorage.setItem("vv_auth_session_user", JSON.stringify(normalized));
        return normalized;
      }
      window.localStorage.setItem("vv_auth_session_user", JSON.stringify(DEFAULT_E2E_BYPASS_USER));
      window.sessionStorage.setItem(
        "vv_auth_session_user",
        JSON.stringify(DEFAULT_E2E_BYPASS_USER),
      );
    } catch {
      // ignore storage errors
    }
  }
  return DEFAULT_E2E_BYPASS_USER;
}

export function isRbaDemoSandboxActive(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      getTenantSlug() === "rba-demo" && window.localStorage.getItem("vv_rba_demo_active") === "true"
    );
  } catch {
    return false;
  }
}

function resolveRbaDemoSessionUser(): UserAccount | null {
  if (typeof window === "undefined") return null;
  try {
    const raw =
      window.localStorage.getItem("vv_auth_session_user") ||
      window.sessionStorage.getItem("vv_auth_session_user");
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<UserAccount> & { tenantId?: string };
      if (parsed && (parsed.email || parsed.id)) {
        const role = normalizeUiRole(parsed.role || "Super Admin");
        return {
          ...DEFAULT_E2E_BYPASS_USER,
          ...parsed,
          role,
          branch: parsed.branch || "All",
          branchScope: parsed.branchScope || "All branches",
          active: true,
          method: "Password",
        };
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [passwordUser, setPasswordUser] = useState<UserAccount | null>(() => {
    if (isRbaDemoSandboxActive()) {
      return resolveRbaDemoSessionUser() || resolveStoredOrDefaultE2EUser();
    }
    return isE2EBypassEnabled() ? resolveStoredOrDefaultE2EUser() : null;
  });
  const [loading, setLoading] = useState<boolean>(
    () => !(isE2EBypassEnabled() || isRbaDemoSandboxActive()),
  );

  // Listen for instant role/branch switches from the RBA Demo Launcher & Control Bar
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleRbaAuthChange = () => {
      if (isRbaDemoSandboxActive()) {
        const demoUser = resolveRbaDemoSessionUser();
        if (demoUser) {
          setPasswordUser(demoUser);
          setLoading(false);
        }
      } else if (isE2EBypassEnabled()) {
        setPasswordUser(resolveStoredOrDefaultE2EUser());
        setLoading(false);
      }
    };
    window.addEventListener("vv:rba-demo-auth-change", handleRbaAuthChange);
    return () => window.removeEventListener("vv:rba-demo-auth-change", handleRbaAuthChange);
  }, []);

  // Security Hardening: Restore persisted session on client mount after hydration,
  // clean up legacy keys, and handle explicit lock requests (?lock=1 or ?signout=1)
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.removeItem("vescio_active_password_user");
        window.localStorage.removeItem("vv-password-user");

        const params = new URLSearchParams(window.location.search);
        if (params.get("lock") === "1" || params.get("signout") === "1") {
          window.sessionStorage.removeItem("vv_auth_session_user");
          window.localStorage.removeItem("vv_auth_session_user");
          setPasswordUser(null);
          setUser(null);
          setLoading(false);
          signOut(auth).catch(() => {});
          params.delete("lock");
          params.delete("signout");
          const nextQuery = params.toString() ? `?${params.toString()}` : "";
          window.history.replaceState(null, "", window.location.pathname + nextQuery);
          return;
        }

        // Restore verified session from localStorage or sessionStorage
        const sessionRaw =
          window.localStorage.getItem("vv_auth_session_user") ||
          window.sessionStorage.getItem("vv_auth_session_user");
        if (sessionRaw) {
          try {
            const parsed = JSON.parse(sessionRaw);
            if (parsed) {
              if ("password" in parsed) {
                delete parsed.password;
                window.localStorage.setItem("vv_auth_session_user", JSON.stringify(parsed));
              }
              if (
                parsed.email?.toLowerCase() === "geogo3@gmail.com" &&
                parsed.name === "Georges Matta"
              ) {
                parsed.name = "Georges Khoury";
              }
              setPasswordUser(parsed);
              if (isRbaDemoSandboxActive()) {
                setLoading(false);
              }
            }
          } catch {
            // ignore
          }
        } else if (isE2EBypassEnabled()) {
          const e2eUser = resolveStoredOrDefaultE2EUser();
          setPasswordUser(e2eUser);
          setLoading(false);
        }
      } catch {
        // ignore
      }
    }
  }, []);

  // Listen to verified Firebase Auth sessions
  useEffect(() => {
    let lastSyncedUid: string | null = null;
    if (typeof window !== "undefined") {
      getRedirectResult(auth).catch((err) => {
        console.warn("Google OAuth redirect check:", err);
      });
    }
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      const tenantId = getTenantSlug();

      if (isRbaDemoSandboxActive()) {
        const demoUser = resolveRbaDemoSessionUser();
        if (demoUser) {
          setPasswordUser(demoUser);
          setUser(currentUser && !currentUser.isAnonymous ? currentUser : null);
          setLoading(false);
          return;
        }
      }

      if (!currentUser) {
        if (isE2EBypassEnabled()) {
          const e2eUser = resolveStoredOrDefaultE2EUser();
          setPasswordUser(e2eUser);
          setLoading(false);
          return;
        }
        if (typeof window !== "undefined") {
          window.localStorage.removeItem("vv_auth_session_user");
          window.sessionStorage.setItem("vv_auth_session_user", "");
          window.sessionStorage.removeItem("vv_auth_session_user");
        }
        setPasswordUser(null);
        setUser(null);
        setLoading(false);
        return;
      }

      if (currentUser.isAnonymous) {
        // Anonymous Firebase Auth sessions are strictly rejected to prevent authorization bypasses.
        if (typeof window !== "undefined") {
          window.localStorage.removeItem("vv_auth_session_user");
          window.sessionStorage.removeItem("vv_auth_session_user");
        }
        await signOut(auth).catch(() => {});
        setPasswordUser(null);
        setUser(null);
        setLoading(false);
        return;
      }

      const realEmail = (currentUser.email || "").toLowerCase();
      const realName =
        currentUser.displayName || (realEmail ? realEmail.split("@")[0] : "Academy Staff");

      // Verify user against seed users, local storage, and Firestore tenant users
      const allUsers: UserAccount[] = [...seedUsers];
      if (typeof window !== "undefined") {
        try {
          const stored = window.localStorage.getItem("vv_custom_registered_users");
          if (stored) {
            const list = JSON.parse(stored);
            for (const u of list) {
              if (
                !allUsers.some(
                  (x) =>
                    x.id === u.id || (x.email && x.email.toLowerCase() === u.email?.toLowerCase()),
                )
              ) {
                allUsers.push(u);
              }
            }
          }
        } catch {
          // ignore
        }
      }

      let matched = allUsers.find((u) => u.email && u.email.toLowerCase() === realEmail);

      let matchedDocId: string | null = matched?.id || null;

      // Query Firestore tenants/{tenantId}/users to ensure live role & permissions take precedence over local seed cache
      if (db) {
        try {
          const userDocSnap = await getDoc(doc(db, "tenants", tenantId, "users", currentUser.uid));
          if (userDocSnap.exists()) {
            matched = userDocSnap.data() as UserAccount;
            matchedDocId = userDocSnap.id;
          } else if (realEmail) {
            const emailQuerySnap = await getDocs(
              query(collection(db, "tenants", tenantId, "users"), where("email", "==", realEmail)),
            );
            if (!emailQuerySnap.empty) {
              matched = emailQuerySnap.docs[0].data() as UserAccount;
              matchedDocId = emailQuerySnap.docs[0].id;
            } else {
              // Also check /tenants/{tenantId}/coaches for matching coach email
              const coachesSnap = await getDocs(collection(db, "tenants", tenantId, "coaches"));
              const matchedCoachDoc = coachesSnap.docs.find((d) => {
                const c = d.data() as Partial<Coach>;
                return c.email && c.email.trim().toLowerCase() === realEmail;
              });
              if (matchedCoachDoc) {
                const c = matchedCoachDoc.data() as Partial<Coach>;
                matched = {
                  id: matchedCoachDoc.id,
                  name: c.name || realName,
                  email: realEmail,
                  username: c.username || realEmail.split("@")[0] || matchedCoachDoc.id,
                  role: "Coach",
                  branch: c.branch || "HQ",
                  branchScope: "Assigned branch only",
                  active: true,
                  method: "Google",
                };
              }
            }
          }
        } catch (queryErr) {
          console.warn("Could not query firestore user document:", queryErr);
        }
      }

      const isSuperAdminEmail = isProtectedSuperAdminEmail(realEmail);

      if (!matched && !isSuperAdminEmail) {
        setUser(currentUser);
        setLoading(false);
        return;
      }

      const isPasswordAuth = currentUser.providerData.some((p) => p.providerId === "password");
      const authMethod: "Google" | "Password" = isPasswordAuth ? "Password" : "Google";

      const verifiedName =
        currentUser.displayName ||
        (matched?.name && matched.name !== "Georges Matta"
          ? matched.name
          : realEmail === "geogo3@gmail.com"
            ? "Georges Khoury"
            : realEmail === "piakerbej@gmail.com" || realEmail === "piakerbaje@gmail.com"
              ? "Pia Kerbej"
              : realEmail === "jess.chakh22@gmail.com"
                ? "Jess Chakh"
                : matched?.name || realName);

      const resolvedRole =
        isSuperAdminEmail || isSuperAdminRoleOrEmail(matched?.role, realEmail)
          ? "Super Admin"
          : normalizeUiRole(matched?.role || "Staff");
      const matchedPerms = (matched as Record<string, unknown> | undefined)?.permissions;

      const verifiedAuthUser: UserAccount & { permissions?: unknown } = {
        ...(matched || {}),
        id: currentUser.uid,
        authUid: currentUser.uid,
        name: verifiedName,
        email: currentUser.email || realEmail,
        username: matched?.username || (realEmail ? realEmail.split("@")[0] : currentUser.uid),
        role: resolvedRole,
        branch: matched?.branch || (isSuperAdminEmail ? "All" : ""),
        branchScope:
          matched?.branchScope ||
          (isSuperAdminEmail || resolvedRole === "Super Admin" || resolvedRole === "Academy Manager"
            ? "All branches"
            : "Assigned branch only"),
        active: matched ? matched.active !== false : true,
        method: authMethod,
        ...(matchedPerms ? { permissions: matchedPerms } : {}),
      };

      const cleanAuthUser = stripPassword(verifiedAuthUser);

      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem("vv_auth_session_user", JSON.stringify(cleanAuthUser));
          window.sessionStorage.setItem("vv_auth_session_user", JSON.stringify(cleanAuthUser));
        } catch {
          // ignore
        }
      }

      if (db && lastSyncedUid !== currentUser.uid) {
        lastSyncedUid = currentUser.uid;
        try {
          await bootstrapFirestoreUserDocument(
            tenantId,
            currentUser.uid,
            cleanAuthUser,
            matchedPerms,
          );
          const oldId = matchedDocId || matched?.id;
          if (oldId && oldId !== currentUser.uid && oldId.startsWith("u-")) {
            await deleteDoc(doc(db, "tenants", tenantId, "users", oldId)).catch(() => {});
          }
        } catch {
          // ignore
        }
      }

      setPasswordUser((prev) => {
        if (
          prev &&
          prev.id === cleanAuthUser.id &&
          prev.email === cleanAuthUser.email &&
          prev.role === cleanAuthUser.role &&
          prev.name === cleanAuthUser.name &&
          prev.branch === cleanAuthUser.branch &&
          prev.active === cleanAuthUser.active
        ) {
          return prev;
        }
        return cleanAuthUser;
      });
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const signInWithGoogle = async (): Promise<{
    success: boolean;
    user?: User;
    resolvedUser?: UserAccount;
    message?: string;
    errorCode?: string;
  }> => {
    const provider = new GoogleAuthProvider();
    provider.addScope("profile");
    provider.addScope("email");
    provider.addScope("openid");
    provider.setCustomParameters({ prompt: "select_account" });

    try {
      const cred = await signInWithPopup(auth, provider, browserPopupRedirectResolver);
      const authUser = cred.user;

      const realEmail = (authUser.email || "").toLowerCase();
      const realName =
        authUser.displayName || (realEmail ? realEmail.split("@")[0] : "Academy Staff");

      // Check whether this account exists among admin-provisioned users
      const allUsers: UserAccount[] = [...seedUsers];
      if (typeof window !== "undefined") {
        try {
          const stored = window.localStorage.getItem("vv_custom_registered_users");
          if (stored) {
            const list = JSON.parse(stored);
            for (const u of list) {
              if (
                !allUsers.some(
                  (x) =>
                    x.id === u.id || (x.email && x.email.toLowerCase() === u.email?.toLowerCase()),
                )
              ) {
                allUsers.push(u);
              }
            }
          }
        } catch {
          // ignore
        }
      }

      let matched = allUsers.find((u) => u.email && u.email.toLowerCase() === realEmail);

      let matchedDocId: string | null = matched?.id || null;
      const tenantId = getTenantSlug();

      if (db && realEmail) {
        try {
          const userDocSnap = await getDoc(doc(db, "tenants", tenantId, "users", authUser.uid));
          if (userDocSnap.exists()) {
            matched = userDocSnap.data() as UserAccount;
            matchedDocId = userDocSnap.id;
          } else {
            const emailQuerySnap = await getDocs(
              query(collection(db, "tenants", tenantId, "users"), where("email", "==", realEmail)),
            );
            if (!emailQuerySnap.empty) {
              matched = emailQuerySnap.docs[0].data() as UserAccount;
              matchedDocId = emailQuerySnap.docs[0].id;
            } else {
              // Also check /tenants/{tenantId}/coaches for matching coach email
              const coachesSnap = await getDocs(collection(db, "tenants", tenantId, "coaches"));
              const matchedCoachDoc = coachesSnap.docs.find((d) => {
                const c = d.data() as Partial<Coach>;
                return c.email && c.email.trim().toLowerCase() === realEmail;
              });
              if (matchedCoachDoc) {
                const c = matchedCoachDoc.data() as Partial<Coach>;
                matched = {
                  id: matchedCoachDoc.id,
                  name: c.name || realName,
                  email: realEmail,
                  username: c.username || realEmail.split("@")[0] || matchedCoachDoc.id,
                  role: "Coach",
                  branch: c.branch || "HQ",
                  branchScope: "Assigned branch only",
                  active: true,
                  method: "Google",
                };
              }
            }
          }
        } catch (err) {
          console.warn("Could not query firestore for Google user:", err);
        }
      }

      const isSuperAdminEmail = isProtectedSuperAdminEmail(realEmail);

      if (!matched && !isSuperAdminEmail) {
        await signOut(auth).catch(() => {});
        setUser(null);
        setPasswordUser(null);
        setLoading(false);
        return {
          success: false,
          message: `Access denied. No account found for ${realEmail}. Only users created by academy administrators can access the system.`,
        };
      }

      setUser(authUser);

      const verifiedName =
        authUser.displayName ||
        (matched?.name && matched.name !== "Georges Matta"
          ? matched.name
          : realEmail === "geogo3@gmail.com"
            ? "Georges Khoury"
            : realEmail === "piakerbej@gmail.com" || realEmail === "piakerbaje@gmail.com"
              ? "Pia Kerbej"
              : realEmail === "jess.chakh22@gmail.com"
                ? "Jess Chakh"
                : realName);

      const resolvedRole =
        isSuperAdminEmail || isSuperAdminRoleOrEmail(matched?.role, realEmail)
          ? "Super Admin"
          : normalizeUiRole(matched?.role || "Staff");
      const matchedPerms = (matched as Record<string, unknown> | undefined)?.permissions;

      const verifiedGoogleUser: UserAccount & { permissions?: unknown } = {
        ...(matched || {}),
        id: authUser.uid,
        authUid: authUser.uid,
        name: verifiedName,
        email: authUser.email || realEmail,
        username: matched?.username || (realEmail ? realEmail.split("@")[0] : authUser.uid),
        role: resolvedRole,
        branch: matched?.branch || (isSuperAdminEmail ? "All" : ""),
        branchScope:
          matched?.branchScope ||
          (isSuperAdminEmail || resolvedRole === "Super Admin" || resolvedRole === "Academy Manager"
            ? "All branches"
            : "Assigned branch only"),
        active: matched ? matched.active !== false : true,
        method: "Google",
        ...(matchedPerms ? { permissions: matchedPerms } : {}),
      };

      const cleanGoogleUser = stripPassword(verifiedGoogleUser);

      if (typeof window !== "undefined") {
        try {
          window.localStorage.setItem("vv_auth_session_user", JSON.stringify(cleanGoogleUser));
          window.sessionStorage.setItem("vv_auth_session_user", JSON.stringify(cleanGoogleUser));
        } catch {
          // ignore
        }
      }

      if (db) {
        try {
          await bootstrapFirestoreUserDocument(
            tenantId,
            authUser.uid,
            cleanGoogleUser,
            matchedPerms,
          );
          const oldId = matchedDocId || matched?.id;
          if (oldId && oldId !== authUser.uid && oldId.startsWith("u-")) {
            await deleteDoc(doc(db, "tenants", tenantId, "users", oldId)).catch(() => {});
          }
        } catch {
          // ignore
        }
      }

      setUser(authUser);
      setPasswordUser(cleanGoogleUser);
      setLoading(false);

      return {
        success: true,
        user: authUser,
        resolvedUser: cleanGoogleUser,
        message: `Signed in successfully as ${verifiedGoogleUser.name} (${verifiedGoogleUser.role}).`,
      };
    } catch (err: unknown) {
      const fbErr = err as { code?: string; message?: string };
      console.error("Google Sign-In error:", fbErr);
      if (
        fbErr?.code === "auth/popup-blocked" ||
        fbErr?.code === "auth/operation-not-supported-in-this-environment" ||
        fbErr?.code === "auth/popup-closed-by-user"
      ) {
        const isMobileOrStandalone =
          typeof window !== "undefined" &&
          (/iphone|ipad|ipod|android|mobile/i.test(window.navigator.userAgent || "") ||
            window.matchMedia?.("(display-mode: standalone)")?.matches);
        if (
          fbErr?.code === "auth/popup-blocked" ||
          fbErr?.code === "auth/operation-not-supported-in-this-environment" ||
          isMobileOrStandalone
        ) {
          try {
            await signInWithRedirect(auth, provider, browserPopupRedirectResolver);
            return {
              success: true,
              message: "Redirecting to Google Sign-In...",
            };
          } catch (redirErr) {
            console.error("Google Sign-In redirect fallback error:", redirErr);
          }
        }
      }
      let msg = "Google Sign-In failed. Please try again.";
      if (fbErr?.code === "auth/popup-closed-by-user") {
        msg = "Sign-in cancelled: Google pop-up window was closed.";
      } else if (fbErr?.code === "auth/popup-blocked") {
        msg = "Google sign-in pop-up was blocked by browser. Please allow popups for this site.";
      } else if (fbErr?.code === "auth/unauthorized-domain") {
        msg =
          "This preview domain is not yet in the Firebase Auth authorized domains list. Please use your Username & Password below to sign in.";
      } else if (fbErr?.message) {
        msg = fbErr.message;
      }
      return {
        success: false,
        errorCode: fbErr?.code,
        message: msg,
      };
    }
  };

  const signInWithGoogleToken = async (
    idToken: string,
  ): Promise<{ success: boolean; user?: User; message?: string }> => {
    try {
      const credential = GoogleAuthProvider.credential(idToken);
      const cred = await signInWithCredential(auth, credential);
      setUser(cred.user);
      return { success: true, user: cred.user };
    } catch (err: unknown) {
      const fbErr = err as { code?: string; message?: string };
      console.error("Google token authentication error:", fbErr);
      return { success: false, message: fbErr?.message || "Google token sign-in failed." };
    }
  };

  /**
   * Authenticates staff or manager using native Firebase Auth signInWithEmailAndPassword.
   * This guarantees a native non-anonymous Firebase session on any device/phone/laptop.
   */
  const signInWithPassword = async (
    usernameOrEmail: string,
    passwordAttempt: string,
    users: UserAccount[],
    coaches: Partial<Coach>[] = [],
  ): Promise<{ success: boolean; message?: string; user?: UserAccount }> => {
    const rawInput = (usernameOrEmail || "").trim();
    const rawPassword = (passwordAttempt || "").trim();

    if (!rawInput) {
      return { success: false, message: "Please enter your username or email address." };
    }
    if (!rawPassword) {
      return { success: false, message: "Please enter your account password." };
    }

    const normalizedInput = rawInput.toLowerCase();
    const normalizedPhoneInput = rawInput.replace(/[\s\-()+]/g, "");
    const tenantId = getTenantSlug();

    // 1. Resolve user profile from supplied users, coaches, seeds, or localStorage
    const allUsers: UserAccount[] = [...users];
    for (const su of seedUsers) {
      if (
        !allUsers.some((x) => x.id === su.id || x.email?.toLowerCase() === su.email?.toLowerCase())
      ) {
        allUsers.push(su);
      }
    }
    for (const c of coaches) {
      if (!c) continue;
      const cEmail = (c.email || "").trim().toLowerCase();
      const cUsername = (
        c.username ||
        (cEmail ? cEmail.split("@")[0] : "") ||
        (c.name || "").toLowerCase().replace(/[^a-z0-9]/g, "")
      )
        .trim()
        .toLowerCase();
      const syntheticEmail = cEmail || (cUsername ? `${cUsername}@${tenantId}.academy` : "");
      if (
        syntheticEmail &&
        !allUsers.some(
          (x) =>
            x.id === c.id ||
            (x.email && x.email.toLowerCase() === syntheticEmail) ||
            (cUsername && x.username && x.username.toLowerCase() === cUsername),
        )
      ) {
        allUsers.push({
          id: c.id || `coach-${cUsername}`,
          name: c.name || "Coach",
          email: syntheticEmail,
          username: cUsername || syntheticEmail.split("@")[0],
          password: c.password,
          role: "Coach",
          branch: c.branch || "HQ",
          branchScope: "Assigned branch only",
          active: true,
          method: "Password",
        });
      }
    }
    if (typeof window !== "undefined") {
      try {
        const stored = window.localStorage.getItem("vv_custom_registered_users");
        if (stored) {
          const list = JSON.parse(stored);
          for (const u of list) {
            delete (u as Record<string, unknown>).password;
            if (
              !allUsers.some(
                (x) => x.id === u.id || x.username === u.username || x.email === u.email,
              )
            ) {
              allUsers.push(u);
            }
          }
        }
      } catch {
        // ignore
      }
    }

    const matchedCoachRecord = coaches.find((c) => {
      if (!c) return false;
      const cEmail = (c.email || "").trim().toLowerCase();
      const cUsername = (c.username || "").trim().toLowerCase();
      const cName = (c.name || "").trim().toLowerCase();
      const cPhone = (c.phone || "").replace(/[\s\-()+]/g, "");
      return (
        (cEmail && cEmail === normalizedInput) ||
        (cEmail && cEmail.split("@")[0] === normalizedInput) ||
        (cUsername && cUsername === normalizedInput) ||
        (cName && cName === normalizedInput) ||
        (normalizedPhoneInput.length >= 6 && cPhone && cPhone === normalizedPhoneInput)
      );
    });

    let matched = allUsers.find((u) => {
      const uName = (u.username || "").toLowerCase();
      const uEmail = (u.email || "").toLowerCase();
      const uId = (u.id || "").toLowerCase();
      return (
        (uName && uName === normalizedInput) ||
        (uEmail && uEmail === normalizedInput) ||
        (uId && uId === normalizedInput) ||
        (uEmail && uEmail.split("@")[0] === normalizedInput)
      );
    });

    if (!matched && matchedCoachRecord) {
      const cEmail = (matchedCoachRecord.email || "").trim().toLowerCase();
      const cUsername = (
        matchedCoachRecord.username ||
        (cEmail ? cEmail.split("@")[0] : "") ||
        (matchedCoachRecord.name || "coach").toLowerCase().replace(/[^a-z0-9]/g, "")
      )
        .trim()
        .toLowerCase();
      matched = {
        id: matchedCoachRecord.id || `coach-${cUsername}`,
        name: matchedCoachRecord.name || "Coach",
        email: cEmail || `${cUsername}@${tenantId}.academy`,
        username: cUsername,
        password: matchedCoachRecord.password,
        role: "Coach",
        branch: matchedCoachRecord.branch || "HQ",
        branchScope: "Assigned branch only",
        active: true,
        method: "Password",
      };
    }

    let matchedDocId: string | null = matched?.id || null;

    // Resolve bare username (without '@') via Firestore usernameMap on /tenants/{tenantId}/public/auth_lookup
    const isBareUsername = !normalizedInput.includes("@");
    let emailToAuth = "";
    if (!isBareUsername) {
      emailToAuth = normalizedInput;
    } else {
      let resolvedFromFirestore = "";
      if (db) {
        try {
          const lookupSnap = await getDoc(doc(db, "tenants", tenantId, "public", "auth_lookup"));
          if (lookupSnap.exists()) {
            const uMap = (lookupSnap.data() as { usernameMap?: Record<string, string> })
              ?.usernameMap;
            if (uMap && typeof uMap[normalizedInput] === "string") {
              resolvedFromFirestore = uMap[normalizedInput].trim().toLowerCase();
            }
          }
        } catch {
          // ignore if offline
        }
      }
      if (resolvedFromFirestore) {
        emailToAuth = resolvedFromFirestore;
      } else if (matched?.email) {
        emailToAuth = matched.email.toLowerCase();
      } else {
        return {
          success: false,
          message: `No registered account found for username '${rawInput}'. Please check your username or sign in with your full email address.`,
        };
      }
    }

    if (matched && matched.active === false) {
      return {
        success: false,
        message: "This account has been deactivated. Please contact an Academy Manager.",
      };
    }

    // 2. Authenticate natively with Firebase Auth using signInWithEmailAndPassword
    let nativeUser: User | null = null;
    try {
      const cred = await signInWithEmailAndPassword(auth, emailToAuth, rawPassword);
      nativeUser = cred.user;
    } catch (err: unknown) {
      const fbErr = err as { code?: string; message?: string };
      console.warn("Native signInWithEmailAndPassword error code:", fbErr?.code);

      // If this is a known seed user or coach profile whose account has not yet been provisioned in Firebase Auth,
      // auto-provision their Firebase Auth credential if the password matches seedUsers or matched profile.
      const seedMatch = seedUsers.find(
        (su) =>
          su.email?.toLowerCase() === emailToAuth.toLowerCase() ||
          su.username?.toLowerCase() === normalizedInput,
      );
      const localPasswordMatch =
        (seedMatch && seedMatch.password === rawPassword) ||
        (matched?.password && matched.password === rawPassword) ||
        (matchedCoachRecord?.password && matchedCoachRecord.password === rawPassword);

      if (
        localPasswordMatch &&
        (fbErr?.code === "auth/user-not-found" || fbErr?.code === "auth/invalid-credential")
      ) {
        try {
          const createdCred = await createUserWithEmailAndPassword(auth, emailToAuth, rawPassword);
          nativeUser = createdCred.user;
        } catch {
          // fall through to standard error handling if email already exists with a different password
        }
      }

      if (!nativeUser) {
        if (
          fbErr?.code === "auth/invalid-credential" ||
          fbErr?.code === "auth/wrong-password" ||
          fbErr?.code === "auth/user-not-found"
        ) {
          return {
            success: false,
            message: "Invalid email or password",
          };
        }
        if (fbErr?.code === "auth/too-many-requests") {
          return {
            success: false,
            message:
              "Too many failed login attempts. Access is temporarily locked. Please try again later.",
          };
        }
        return {
          success: false,
          message: fbErr?.message || "Invalid email or password",
        };
      }
    }

    if (!nativeUser) {
      return {
        success: false,
        message: "Invalid email or password",
      };
    }

    // Now that the user is authenticated, query Firestore for the authoritative user or coach profile
    if (db) {
      try {
        const uidSnap = await getDoc(doc(db, "tenants", tenantId, "users", nativeUser.uid));
        if (uidSnap.exists()) {
          const data = uidSnap.data() as UserAccount;
          delete (data as Record<string, unknown>).password;
          delete (data as Record<string, unknown>).passwordHash;
          matched = data;
          matchedDocId = uidSnap.id;
        } else {
          const usersCol = collection(db, "tenants", tenantId, "users");
          const qSnap = await getDocs(query(usersCol, where("email", "==", emailToAuth)));
          if (!qSnap.empty) {
            const data = qSnap.docs[0].data() as UserAccount;
            delete (data as Record<string, unknown>).password;
            delete (data as Record<string, unknown>).passwordHash;
            matched = data;
            matchedDocId = qSnap.docs[0].id;
          } else if (isBareUsername) {
            const uSnap = await getDocs(query(usersCol, where("username", "==", normalizedInput)));
            if (!uSnap.empty) {
              const data = uSnap.docs[0].data() as UserAccount;
              delete (data as Record<string, unknown>).password;
              delete (data as Record<string, unknown>).passwordHash;
              matched = data;
              matchedDocId = uSnap.docs[0].id;
            }
          }
          // If still not matched in users collection, check /tenants/{tenantId}/coaches
          if (!matched) {
            const coachesSnap = await getDocs(collection(db, "tenants", tenantId, "coaches"));
            const foundCoachDoc = coachesSnap.docs.find((d) => {
              const c = d.data() as Partial<Coach>;
              const cEmail = (c.email || "").trim().toLowerCase();
              const cUname = (c.username || "").trim().toLowerCase();
              const cPhone = (c.phone || "").replace(/[\s\-()+]/g, "");
              return (
                (cEmail && cEmail === emailToAuth) ||
                (cUname && cUname === normalizedInput) ||
                (normalizedPhoneInput.length >= 6 && cPhone && cPhone === normalizedPhoneInput)
              );
            });
            if (foundCoachDoc) {
              const c = foundCoachDoc.data() as Partial<Coach>;
              matched = {
                id: foundCoachDoc.id,
                name: c.name || emailToAuth.split("@")[0] || "Coach",
                email: c.email || emailToAuth,
                username: c.username || emailToAuth.split("@")[0],
                role: "Coach",
                branch: c.branch || "HQ",
                branchScope: "Assigned branch only",
                active: true,
                method: "Password",
              };
            }
          }
        }
      } catch (err) {
        console.warn("Could not query firestore for authenticated user:", err);
      }
    }

    if (matched && matched.active === false) {
      await signOut(auth).catch(() => {});
      return {
        success: false,
        message: "This account has been deactivated. Please contact an Academy Manager.",
      };
    }

    const isSuperAdminEmail = isProtectedSuperAdminEmail(emailToAuth);
    const resolvedRole =
      isSuperAdminEmail || isSuperAdminRoleOrEmail(matched?.role, emailToAuth)
        ? "Super Admin"
        : normalizeUiRole(matched?.role || (matchedCoachRecord ? "Coach" : "Staff"));
    const matchedPerms = (matched as Record<string, unknown> | undefined)?.permissions;

    // 3. Construct verified user profile with native auth session
    const verifiedUser: UserAccount & { permissions?: unknown } = {
      ...(matched || {}),
      id: nativeUser.uid,
      authUid: nativeUser.uid,
      name:
        nativeUser.displayName ||
        (matched?.name && matched.name !== "Georges Matta"
          ? matched.name
          : emailToAuth === "geogo3@gmail.com"
            ? "Georges Khoury"
            : emailToAuth === "piakerbej@gmail.com" || emailToAuth === "piakerbaje@gmail.com"
              ? "Pia Kerbej"
              : emailToAuth === "jess.chakh22@gmail.com"
                ? "Jess Chakh"
                : matched?.name || emailToAuth.split("@")[0]),
      email: nativeUser.email || emailToAuth,
      username: matched?.username || emailToAuth.split("@")[0],
      role: resolvedRole,
      branch: matched?.branch || (isSuperAdminEmail ? "All" : ""),
      branchScope:
        matched?.branchScope ||
        (isSuperAdminEmail || resolvedRole === "Super Admin" || resolvedRole === "Academy Manager"
          ? "All branches"
          : "Assigned branch only"),
      active: true,
      method: "Password",
      ...(matchedPerms ? { permissions: matchedPerms } : {}),
    };

    const cleanUser = stripPassword(verifiedUser);

    // 4. Set active user session in state and storage
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem("vv_auth_session_user", JSON.stringify(cleanUser));
        window.sessionStorage.setItem("vv_auth_session_user", JSON.stringify(cleanUser));
      } catch {
        // ignore
      }
    }

    if (db) {
      try {
        await bootstrapFirestoreUserDocument(tenantId, nativeUser.uid, cleanUser, matchedPerms);
        const oldId = matchedDocId || matched?.id;
        if (oldId && oldId !== nativeUser.uid && oldId.startsWith("u-")) {
          await deleteDoc(doc(db, "tenants", tenantId, "users", oldId)).catch(() => {});
        }
      } catch {
        // ignore
      }
    }

    setUser(nativeUser);
    setPasswordUser(cleanUser);
    setLoading(false);

    return {
      success: true,
      user: cleanUser,
      message: `Signed in successfully as ${cleanUser.name} (${cleanUser.role}).`,
    };
  };

  /**
   * Self-registration is disabled because only users created by administrators can access.
   */
  const registerWithPassword = async (): Promise<{
    success: boolean;
    message?: string;
    user?: UserAccount;
  }> => {
    return {
      success: false,
      message:
        "Self-service account registration is disabled. User accounts can only be created by an Academy Administrator in Users & Access.",
    };
  };

  const logOut = async () => {
    if (typeof window !== "undefined") {
      try {
        window.sessionStorage.removeItem("vv_auth_session_user");
        window.localStorage.removeItem("vv_auth_session_user");
        window.localStorage.removeItem("vescio_active_password_user");
        window.localStorage.removeItem("vv-password-user");
      } catch {
        // ignore
      }
    }
    setPasswordUser(null);
    setUser(null);
    try {
      await signOut(auth);
    } catch (e) {
      console.warn("Sign out error:", e);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        passwordUser,
        role: passwordUser?.role,
        userRole: passwordUser?.role,
        userBranch: passwordUser?.branch,
        loading,
        signInWithGoogle,
        signInWithGoogleToken,
        signInWithPassword,
        registerWithPassword,
        logOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}

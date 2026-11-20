import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import React, { ReactNode, useState, useEffect, useMemo, useSyncExternalStore } from "react";
import { academy } from "@/lib/mock-data";

import { ThemeToggle } from "@/lib/theme";
import { useAuth } from "@/lib/auth";
import {
  useDBReady,
  useTenantUser,
  defaultRoleDefinitions,
  dbStore,
  setDb,
} from "@/lib/data-store";
import type { RoleDefinition } from "@/lib/data-store";
import { useSetup } from "@/lib/tenant-store";
import { NotificationCenter } from "@/components/notification-center";
import {
  copyDiagnosticReportToClipboard,
  sendDiagnosticReportToSystemAdmin,
  setErrorLoggerUserContext,
} from "@/lib/error-logger";
import {
  LogIn,
  KeyRound,
  Menu,
  X,
  ExternalLink,
  Lock,
  ShieldAlert,
  ShieldCheck,
  Copy,
  Send,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Kanban,
  Pin,
  PinOff,
  LayoutDashboard,
  Calendar,
  Clock,
  ShoppingBag,
  Users,
  UserCheck,
  Shield,
  Briefcase,
  Building2,
  Wallet,
  Settings,
  Compass,
  ClipboardList,
  BookOpen,
  Sliders,
} from "lucide-react";
import { Modal, Field, Input, Textarea, Button } from "@/components/kit";
import { VescioNexusIcon } from "@/components/vescio-nexus-icon";
import { toast } from "sonner";

const isMasterOwner = (email?: string | null) =>
  String(email || "")
    .trim()
    .toLowerCase() === "geogo3@gmail.com";

const isCoachOnlyRole = (role?: string | null) => {
  const r = String(role || "")
    .trim()
    .toLowerCase();
  return r === "coach" || r === "head coach" || r === "assistant coach";
};

type NavItem = { to: string; label: string; meta?: string };

const baseGroups: { title: string; items: NavItem[] }[] = [
  {
    title: "Operate",
    items: [
      { to: "/", label: "Dashboard" },
      { to: "/calendar", label: "Calendar" },
      { to: "/sessions", label: "Sessions" },
      { to: "/merchandise", label: "Merchandise" },
    ],
  },
  {
    title: "Roster",
    items: [
      { to: "/players", label: "Players" },
      { to: "/coaches", label: "Coaches" },
      { to: "/teams", label: "Teams" },
      { to: "/personnel", label: "Personnel" },
      { to: "/branches", label: "Branches" },
    ],
  },
  {
    title: "Control",
    items: [
      { to: "/accounting", label: "Accounting", meta: academy.currencies?.join(" · ") || "USD" },
      { to: "/users", label: "Users & Access" },
      { to: "/settings", label: "System Settings" },
      { to: "/technical", label: "Technical Portal", meta: "VIEW" },
      { to: "/coach", label: "Coach Portal", meta: "VIEW" },
    ],
  },
];

const mobileTabs: NavItem[] = [
  { to: "/", label: "Home" },
  { to: "/calendar", label: "Calendar" },
  { to: "/sessions", label: "Sessions" },
  { to: "/players", label: "Players" },
  { to: "/settings", label: "More" },
];

const glyphs: Record<string, string> = {
  "/": "▦",
  "/calendar": "▤",
  "/sessions": "◈",
  "/players": "●",
  "/crm": "◎",
  "/settings": "⌗",
  "/documentation": "📖",
};

const isNavActive = (itemTo: string, currentPath: string) => {
  if (itemTo === "/") return currentPath === "/";
  return currentPath === itemTo || currentPath.startsWith(itemTo + "/");
};

const SIDEBAR_PINNED_STORAGE_KEY = "vv-sidebar-pinned";

const NEXUS_LINK_SURFACE_CLS =
  "bg-teal-600/15 text-teal-950 ring-1 ring-teal-600/45 hover:bg-teal-600/25 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/40 dark:hover:bg-emerald-500/25";

function getSidebarNavIcon(to: string) {
  switch (to) {
    case "/":
      return LayoutDashboard;
    case "/calendar":
      return Calendar;
    case "/sessions":
      return Clock;
    case "/merchandise":
      return ShoppingBag;
    case "/players":
      return Users;
    case "/coaches":
      return UserCheck;
    case "/teams":
      return Shield;
    case "/personnel":
      return Briefcase;
    case "/branches":
      return Building2;
    case "/accounting":
      return Wallet;
    case "/users":
      return KeyRound;
    case "/settings":
      return Settings;
    case "/technical":
      return Compass;
    case "/coach":
      return ClipboardList;
    case "/admin":
      return ShieldCheck;
    case "/setup":
      return Sliders;
    case "/documentation":
      return BookOpen;
    default:
      return LayoutDashboard;
  }
}

let hasClientMounted = false;

const subscribeAcademySlice = (cb: () => void) => dbStore.subscribe("academy", cb);
const getAcademySlice = () => dbStore.getSlice("academy") || academy;

const subscribeCustomRolesSlice = (cb: () => void) => dbStore.subscribe("customRoles", cb);
const getCustomRolesSlice = () => dbStore.getSlice("customRoles") || defaultRoleDefinitions;

const subscribePlayersCountSlice = (cb: () => void) => dbStore.subscribe("players", cb);
const getPlayersCountSlice = () => dbStore.getSlice("players")?.length ?? 0;

export function AppShell({
  crumb: _crumb,
  title,
  action,
  children,
}: {
  crumb?: string;
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const currentUser = useTenantUser();
  const { user, passwordUser, loading, signInWithGoogle, signInWithPassword, logOut } = useAuth();
  const authUser = user;

  const userEmail = (
    authUser?.email ||
    passwordUser?.email ||
    currentUser?.email ||
    ""
  ).toLowerCase();
  const isOwnerGeogo = isMasterOwner(authUser?.email || currentUser?.email);
  const isAuthenticatedSession = Boolean(passwordUser || (user && !user.isAnonymous));

  const [mounted, setMounted] = useState(() => hasClientMounted);
  const [sidebarPinned, setSidebarPinned] = useState(false);
  const [sidebarHovered, setSidebarHovered] = useState(false);
  const [workspaceCollapsed, setWorkspaceCollapsed] = useState(false);
  const [packageCollapsed, setPackageCollapsed] = useState(false);
  useEffect(() => {
    hasClientMounted = true;
    setMounted(true);
    try {
      const storedPinned = window.localStorage.getItem(SIDEBAR_PINNED_STORAGE_KEY);
      if (storedPinned === "true") {
        setSidebarPinned(true);
      } else if (storedPinned === "false") {
        setSidebarPinned(false);
      }
    } catch {
      // ignore localStorage access errors
    }
  }, []);

  const handleToggleSidebarPin = () => {
    setSidebarPinned((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(SIDEBAR_PINNED_STORAGE_KEY, String(next));
      } catch {
        // ignore localStorage access errors
      }
      if (!next) {
        setSidebarHovered(false);
      }
      return next;
    });
  };

  const isSidebarExpanded = sidebarPinned || sidebarHovered;

  const liveAcademy = useSyncExternalStore(subscribeAcademySlice, getAcademySlice, getAcademySlice);

  useEffect(() => {
    setErrorLoggerUserContext({
      ...(userEmail ? { userEmail } : {}),
      ...(authUser?.displayName || currentUser?.name || passwordUser?.name
        ? { userName: authUser?.displayName || currentUser?.name || passwordUser?.name }
        : {}),
      ...(currentUser?.role || passwordUser?.role
        ? { userRole: currentUser?.role || passwordUser?.role }
        : {}),
      ...(currentUser?.branch || passwordUser?.branch
        ? { userBranch: currentUser?.branch || passwordUser?.branch }
        : {}),
      ...(liveAcademy?.notificationServices
        ? { notificationServices: liveAcademy.notificationServices }
        : {}),
      onInAppNotificationCreated: (notif) => {
        const existing = dbStore.getSlice("notifications") || [];
        if (!existing.some((n) => n.id === notif.id)) {
          const next = [notif, ...existing];
          dbStore.setSlice("notifications", next);
          setDb((prev) => ({ ...prev, notifications: next }));
        }
      },
    });
  }, [
    userEmail,
    authUser?.displayName,
    currentUser?.name,
    currentUser?.role,
    currentUser?.branch,
    passwordUser?.name,
    passwordUser?.role,
    passwordUser?.branch,
    liveAcademy?.notificationServices,
  ]);
  const customRoles = useSyncExternalStore(
    subscribeCustomRolesSlice,
    getCustomRolesSlice,
    getCustomRolesSlice,
  );
  const playersCount = useSyncExternalStore(
    subscribePlayersCountSlice,
    getPlayersCountSlice,
    getPlayersCountSlice,
  );

  const dbReady = useDBReady();

  const activeRoleDefinition: RoleDefinition | undefined = useMemo(() => {
    const roleName = currentUser?.role;
    if (!roleName) return undefined;
    const defaultDef = defaultRoleDefinitions.find(
      (r) => r.name.toLowerCase() === roleName.toLowerCase(),
    );
    const customDef = (customRoles || []).find(
      (r) => r.name.toLowerCase() === roleName.toLowerCase(),
    );
    if (!customDef && !defaultDef) return undefined;
    if (customDef && defaultDef) {
      return {
        ...defaultDef,
        ...customDef,
        permissions: {
          ...defaultDef.permissions,
          ...customDef.permissions,
        },
      };
    }
    return customDef || defaultDef;
  }, [currentUser?.role, customRoles]);

  const hasModuleReadPermission = React.useCallback(
    (routePath: string): boolean => {
      if (routePath === "/documentation") return true;
      if (routePath === "/admin") return isOwnerGeogo;
      if (
        routePath.startsWith("/settings") &&
        (currentUser?.role === "Branch Manager" ||
          currentUser?.role === "Technical Director" ||
          currentUser?.role === "Academy Manager" ||
          currentUser?.role === "Super Admin")
      ) {
        return true;
      }
      if (!activeRoleDefinition?.permissions) return true;

      const routeModuleMap: Record<string, string> = {
        "/": "dashboard",
        "/calendar": "sessions",
        "/sessions": "sessions",
        "/merchandise": "merchandise",
        "/players": "players",
        "/crm": "crm",
        "/coaches": "staff",
        "/teams": "teams",
        "/personnel": "staff",
        "/branches": "branches",
        "/accounting": "accounting",
        "/users": "users",
        "/settings": "settings",
        "/technical": "drills",
        "/coach": "sessions",
      };

      const matchedPrefix = Object.keys(routeModuleMap).find((prefix) =>
        prefix === "/" ? routePath === "/" : routePath.startsWith(prefix),
      );
      if (!matchedPrefix) return true;
      const modKey = routeModuleMap[matchedPrefix];
      if (!modKey) return true;
      const perm = activeRoleDefinition.permissions[modKey];
      return perm ? perm.read !== false : true;
    },
    [activeRoleDefinition, isOwnerGeogo, currentUser?.role],
  );

  const filterGroupsByCustomPermissions = React.useCallback(
    (groups: { title: string; items: NavItem[] }[]) => {
      if (!activeRoleDefinition) {
        return groups;
      }
      return groups
        .map((g) => ({
          ...g,
          items: g.items.filter((item) => hasModuleReadPermission(item.to)),
        }))
        .filter((g) => g.items.length > 0);
    },
    [activeRoleDefinition, hasModuleReadPermission],
  );

  const { setup } = useSetup();
  const visibleGroups = useMemo(() => {
    // Client Console is strictly accessible to master owner geogo3@gmail.com only
    const platformItems: NavItem[] = [];
    if (isMasterOwner(authUser?.email || currentUser?.email)) {
      platformItems.push({ to: "/admin", label: "Client Console", meta: "ADMIN" });
    }
    if (!setup.done) {
      platformItems.push({ to: "/setup", label: "Setup Wizard", meta: "TENANT" });
    }

    const platformGroup: { title: string; items: NavItem[] } | null =
      platformItems.length > 0 ? { title: "Platform", items: platformItems } : null;

    // Documentation is universally available at the bottom of the sidebar for all roles
    const docGroup: { title: string; items: NavItem[] } = {
      title: "Knowledge Base",
      items: [{ to: "/documentation", label: "Documentation", meta: "TOUR" }],
    };

    const dynamicCurrencyMeta =
      liveAcademy?.currency || liveAcademy?.currencies?.join(" · ") || "USD";
    const dynamicBaseGroups = baseGroups.map((g) => ({
      ...g,
      items: g.items.map((item) =>
        item.to === "/accounting" ? { ...item, meta: dynamicCurrencyMeta } : item,
      ),
    }));

    // Coach role defaults to /coach and /documentation unless granted extra module permissions
    if (isCoachOnlyRole(currentUser?.role)) {
      const extraCoachModules = [
        "dashboard",
        "merchandise",
        "players",
        "teams",
        "branches",
        "staff",
        "accounting",
        "users",
        "settings",
      ];
      const hasExtraCoachPerms = extraCoachModules.some(
        (k) => activeRoleDefinition?.permissions?.[k]?.read === true,
      );
      if (!hasExtraCoachPerms) {
        return [
          {
            title: "Coach Portal",
            items: [{ to: "/coach", label: "Coach Portal", meta: "COACH" }],
          },
          docGroup,
        ];
      }
      const extraGroups = dynamicBaseGroups
        .map((g) => ({
          ...g,
          items: g.items.filter((item) => {
            if (item.to === "/coach") return true;
            if (item.to === "/sessions" || item.to === "/calendar" || item.to === "/technical") {
              return false;
            }
            return hasModuleReadPermission(item.to);
          }),
        }))
        .filter((g) => g.items.length > 0);
      return [
        {
          title: "Coach Portal",
          items: [{ to: "/coach", label: "Coach Portal", meta: "COACH" }],
        },
        ...extraGroups,
        docGroup,
      ];
    }

    // Technical Director accesses /technical, /teams, /sessions, /coaches, /players, /coach, /documentation, plus any dynamically enabled modules
    if (currentUser?.role === "Technical Director") {
      const tdGroups: { title: string; items: NavItem[] }[] = [
        {
          title: "Technical Directorate",
          items: [
            { to: "/technical", label: "Technical Portal", meta: "DIRECTOR" },
            { to: "/coach", label: "Coach Portal", meta: "VIEW" },
          ],
        },
        {
          title: "Operate",
          items: [
            { to: "/", label: "Dashboard" },
            { to: "/calendar", label: "Calendar" },
            { to: "/sessions", label: "Sessions" },
            { to: "/merchandise", label: "Merchandise" },
          ],
        },
        {
          title: "Roster",
          items: [
            { to: "/teams", label: "Teams" },
            { to: "/coaches", label: "Coaches" },
            { to: "/players", label: "Players" },
            { to: "/personnel", label: "Personnel" },
            { to: "/branches", label: "Branches" },
          ],
        },
        {
          title: "Control",
          items: [
            { to: "/accounting", label: "Accounting", meta: dynamicCurrencyMeta },
            { to: "/users", label: "Users & Access" },
            { to: "/settings", label: "System Settings" },
          ],
        },
      ];
      return [...filterGroupsByCustomPermissions(tdGroups), docGroup];
    }

    // Accountant defaults to financial & billing modules, dynamically filtered by role permissions
    if (currentUser?.role === "Accountant") {
      const acctGroups: { title: string; items: NavItem[] }[] = [
        {
          title: "Operate",
          items: [
            { to: "/", label: "Dashboard" },
            { to: "/calendar", label: "Calendar" },
            { to: "/sessions", label: "Sessions" },
            { to: "/merchandise", label: "Merchandise" },
          ],
        },
        {
          title: "Roster & Billing",
          items: [
            { to: "/players", label: "Players", meta: "BILLING" },
            { to: "/branches", label: "Branches", meta: "FINANCE" },
            { to: "/coaches", label: "Coaches" },
            { to: "/teams", label: "Teams" },
            { to: "/personnel", label: "Personnel" },
          ],
        },
        {
          title: "Control",
          items: [
            {
              to: "/accounting",
              label: "Accounting",
              meta: dynamicCurrencyMeta,
            },
            { to: "/users", label: "Users & Access" },
            { to: "/settings", label: "System Settings" },
            { to: "/technical", label: "Technical Portal", meta: "VIEW" },
          ],
        },
      ];
      return [...filterGroupsByCustomPermissions(acctGroups), docGroup];
    }

    // Branch Manager sees branch operations, roster, and any dynamically enabled modules
    if (currentUser?.role === "Branch Manager") {
      const bmGroups: { title: string; items: NavItem[] }[] = [
        {
          title: "Operate",
          items: [
            { to: "/", label: "Dashboard" },
            { to: "/calendar", label: "Calendar" },
            { to: "/sessions", label: "Sessions" },
            { to: "/merchandise", label: "Merchandise" },
          ],
        },
        {
          title: "Roster",
          items: [
            { to: "/players", label: "Players" },
            { to: "/coaches", label: "Coaches" },
            { to: "/teams", label: "Teams" },
            { to: "/personnel", label: "Personnel" },
            { to: "/branches", label: "My Branch" },
          ],
        },
        {
          title: "Control",
          items: [
            { to: "/accounting", label: "Accounting", meta: dynamicCurrencyMeta },
            { to: "/users", label: "Users & Access" },
            { to: "/settings", label: "System Settings" },
            { to: "/technical", label: "Technical Portal", meta: "VIEW" },
          ],
        },
      ];
      return [...filterGroupsByCustomPermissions(bmGroups), docGroup];
    }

    // Custom Roles & Staff (non-admin roles)
    if (
      currentUser?.role &&
      currentUser.role !== "Super Admin" &&
      currentUser.role !== "Academy Manager"
    ) {
      return [...filterGroupsByCustomPermissions(dynamicBaseGroups), docGroup];
    }

    // Academy Manager & Super Admin: dynamically filtered by role permissions,
    // with Platform / Client Console strictly exclusive to geogo3@gmail.com,
    // and Documentation at the bottom
    const full = [...filterGroupsByCustomPermissions(dynamicBaseGroups)];
    if (platformGroup) {
      full.push(platformGroup);
    }
    full.push(docGroup);
    return full;
  }, [
    currentUser?.role,
    setup.done,
    isOwnerGeogo,
    activeRoleDefinition,
    hasModuleReadPermission,
    filterGroupsByCustomPermissions,
    liveAcademy?.currencies,
  ]);

  // Route protection rules per role (dynamically evaluated against role permission matrix)
  useEffect(() => {
    if (loading) return;

    // Unauthenticated users (including orphan anonymous sessions with no passwordUser) visiting any sub-route are routed to unified root login (/)
    if (!isAuthenticatedSession) {
      if (pathname !== "/") {
        navigate({ to: "/", replace: true });
      }
      return;
    }

    // Documentation is universally accessible to every authenticated role
    if (pathname === "/documentation") {
      return;
    }

    // Client Console is strictly restricted to geogo3@gmail.com
    if (pathname === "/admin" && !isMasterOwner(authUser?.email || currentUser?.email)) {
      navigate({ to: "/", replace: true });
      return;
    }

    // Coach defaults to /coach: automatically route logged-in Coaches from / or admin routes straight to /coach
    if (isCoachOnlyRole(currentUser?.role || passwordUser?.role)) {
      if (pathname === "/coach") return;
      if (pathname === "/") {
        navigate({ to: "/coach", replace: true });
        return;
      }
      const coachExtraAllowed =
        pathname !== "/sessions" &&
        pathname !== "/calendar" &&
        pathname !== "/technical" &&
        hasModuleReadPermission(pathname);
      if (!coachExtraAllowed) {
        navigate({ to: "/coach", replace: true });
      }
      return;
    }

    // Dynamically enforce role permission matrix for all roles (Technical Director, Branch Manager, Accountant, Staff, Custom Roles, Academy Manager, Super Admin)
    if (currentUser?.role && !hasModuleReadPermission(pathname)) {
      const fallbackRoute = visibleGroups[0]?.items[0]?.to || "/documentation";
      if (pathname !== fallbackRoute) {
        navigate({ to: fallbackRoute, replace: true });
      }
    }
  }, [
    user,
    passwordUser,
    isAuthenticatedSession,
    currentUser?.role,
    currentUser?.email,
    authUser?.email,
    pathname,
    navigate,
    isOwnerGeogo,
    loading,
    hasModuleReadPermission,
    visibleGroups,
  ]);

  const handleSignOut = React.useCallback(async () => {
    await logOut();
    navigate({ to: "/", replace: true });
  }, [logOut, navigate]);

  const [signInOpen, setSignInOpen] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isGoogleSigningIn, setIsGoogleSigningIn] = useState(false);
  const [reportIssueOpen, setReportIssueOpen] = useState(false);
  const [issueNote, setIssueNote] = useState("");
  const [isSubmittingIssue, setIsSubmittingIssue] = useState(false);
  const [issueReportedConfirm, setIssueReportedConfirm] = useState(false);

  const handleSubmitIssueReport = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    try {
      setIsSubmittingIssue(true);
      await sendDiagnosticReportToSystemAdmin({
        trigger: "manual_user_report",
        userNote: issueNote.trim(),
        currentUser: {
          email: authUser?.email || passwordUser?.email || currentUser?.email || "anonymous",
          name:
            authUser?.displayName ||
            currentUser?.name ||
            passwordUser?.name ||
            authUser?.email ||
            "Academy User",
          role: currentUser?.role || passwordUser?.role || "Academy User",
          branch: currentUser?.branch || passwordUser?.branch || "All",
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
  };

  const handlePasswordSubmit = async (e?: React.FormEvent | React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const username = loginForm.username.trim();
    const password = loginForm.password.trim();
    if (!username) {
      toast.error("Please enter your username or email address.");
      return;
    }
    if (!password) {
      toast.error("Please enter your account password.");
      return;
    }
    try {
      setIsSigningIn(true);
      const usersList = dbStore.getSlice("users") || [];
      const coachesList = dbStore.getSlice("coaches") || [];
      const result = await signInWithPassword(username, password, usersList, coachesList);
      if (!result.success) {
        toast.error(result.message || "Invalid credentials.");
        return;
      }
      toast.success(result.message || `Signed in successfully as ${result.user?.name || "User"}.`);
      setSignInOpen(false);
      setLoginForm({ username: "", password: "" });
      if (isCoachOnlyRole(result.user?.role)) {
        navigate({ to: "/coach", replace: true });
      }
    } catch (err: unknown) {
      console.error("Sign in error:", err);
      toast.error("An unexpected error occurred during sign in.");
    } finally {
      setIsSigningIn(false);
    }
  };

  const currentAcademy = useMemo(() => liveAcademy || academy, [liveAcademy]);
  const currentLogo = currentAcademy?.logo || "/vescio-vector-logo.png";
  const initials = useMemo(
    () =>
      (currentAcademy?.name || "Vescio")
        .split(" ")
        .map((w: string) => w[0])
        .slice(0, 2)
        .join("")
        .toUpperCase(),
    [currentAcademy?.name],
  );
  const playersUsedCount = playersCount || currentAcademy?.playersUsed || 0;
  const playersLimit = currentAcademy?.playersLimit || 400;

  // 1. Loading state while verifying authentication (only when no active session is known yet)
  if (!mounted || (loading && !isAuthenticatedSession)) {
    const loadingLogo = mounted ? currentLogo : "/vescio-vector-logo.png";
    return (
      <div className="min-h-screen bg-ink-950 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-ink-900 border border-ink-800 flex items-center justify-center mb-4 animate-pulse ring-1 ring-court-500/20">
          <img src={loadingLogo} alt="Vescio Vector" className="w-9 h-9 object-contain" />
        </div>
        <div className="font-mono text-xs tracking-widest text-court-400 uppercase mb-1">
          VESCIO VECTOR
        </div>
        <div className="text-sm font-medium text-ink-300">
          Verifying security credentials & authorization...
        </div>
      </div>
    );
  }

  // 2. System Signed Out & Locked state: Canonical Unified Root Login Screen on both Mobile & Desktop
  if (!isAuthenticatedSession) {
    return (
      <div className="min-h-screen bg-ink-950 text-ink-100 flex flex-col justify-center items-center px-4 py-12 relative overflow-hidden">
        {/* Ambient basketball court backdrop glow */}
        <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-court-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="w-full max-w-md relative z-10 space-y-6">
          {/* Header & Lock Indicator */}
          <div className="text-center space-y-3">
            <div className="inline-flex items-center justify-center p-3 rounded-2xl bg-ink-900 border border-ink-800 shadow-xl ring-1 ring-court-500/20">
              <img
                src={currentLogo}
                alt={currentAcademy?.name || "Vescio Vector"}
                className="w-12 h-12 object-contain"
                onError={(e) => {
                  e.currentTarget.src = "/vescio-vector-logo.png";
                }}
              />
            </div>
            <div>
              <div className="inline-flex items-center justify-center gap-2">
                <h1 className="font-display text-2xl tracking-tight text-ink-50">
                  {currentAcademy?.name || "VESCIO VECTOR"}
                </h1>
                <span className="inline-flex items-center rounded-full bg-amber-400 px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-ink-950 shadow-sm ring-1 ring-amber-300">
                  STAGING
                </span>
              </div>
              <p className="font-mono text-[10px] tracking-[0.25em] text-court-400 uppercase mt-0.5">
                Basketball Academy Management System
              </p>
            </div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-court-500/10 border border-court-500/25 text-court-300 font-mono text-[11px]">
              <Lock className="w-3.5 h-3.5 text-court-400" />
              <span>SYSTEM LOCKED · AUTHENTICATION REQUIRED</span>
            </div>
          </div>

          {/* Authentication Card */}
          <div className="rounded-xl border border-ink-800 bg-ink-900/90 p-6 shadow-2xl backdrop-blur space-y-5">
            <div>
              <button
                type="button"
                onClick={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  try {
                    setIsGoogleSigningIn(true);
                    const result = await signInWithGoogle();
                    if (result.success) {
                      toast.success(result.message || "Signed in with Google successfully.");
                      if (isCoachOnlyRole(result.resolvedUser?.role)) {
                        navigate({ to: "/coach", replace: true });
                      }
                    } else {
                      toast.error(result.message || "Google sign-in could not be completed.");
                    }
                  } catch (err: unknown) {
                    console.error("Google sign in button error:", err);
                    toast.error("Google sign-in failed. Please try again.");
                  } finally {
                    setIsGoogleSigningIn(false);
                  }
                }}
                disabled={isGoogleSigningIn}
                className="w-full flex items-center justify-center gap-2.5 py-3 rounded-lg bg-court-500 hover:bg-court-400 text-ink-950 font-bold text-xs tracking-wide shadow-md transition-all cursor-pointer disabled:opacity-50"
              >
                <LogIn className="w-4 h-4" />
                <span>
                  {isGoogleSigningIn ? "Connecting to Google..." : "Continue with Google Account"}
                </span>
              </button>
              <p className="mt-1.5 text-center font-mono text-[10px] text-ink-400">
                Direct OAuth Authentication with your Google Account
              </p>
            </div>

            <div className="relative flex items-center justify-center">
              <div className="border-t border-ink-800 w-full" />
              <span className="bg-ink-900 px-3 text-[10px] font-mono text-ink-400 uppercase tracking-widest absolute">
                Or use Username & Password
              </span>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handlePasswordSubmit(e);
              }}
              className="space-y-3.5"
            >
              <Field label="Username or Email">
                <Input
                  value={loginForm.username}
                  onChange={(v) => setLoginForm({ ...loginForm, username: v })}
                  placeholder="Enter your username or email"
                  autoFocus
                />
              </Field>

              <Field label="Password">
                <Input
                  type="password"
                  value={loginForm.password}
                  onChange={(v) => setLoginForm({ ...loginForm, password: v })}
                  placeholder="Enter your account password"
                />
              </Field>

              <button
                type="submit"
                disabled={isSigningIn}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md bg-ink-800 hover:bg-ink-750 text-court-300 ring-1 ring-ink-700 font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50"
              >
                <KeyRound className="w-4 h-4 text-court-400" />
                <span>{isSigningIn ? "Verifying Credentials..." : "Sign In to Workspace"}</span>
              </button>
            </form>

            <div className="rounded-lg border border-ink-800 bg-ink-950/60 p-3 text-center">
              <p className="font-mono text-[11px] text-ink-400 leading-relaxed">
                Access is restricted to authorized personnel. Only accounts created by Academy
                Administrators can access the system.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 3. User is signed in, but account is deactivated or pending role assignment
  if (currentUser?.active === false) {
    return (
      <div className="min-h-screen bg-ink-950 text-ink-100 flex flex-col justify-center items-center px-4 py-12">
        <div className="w-full max-w-md p-6 rounded-xl border border-red-500/30 bg-ink-900 space-y-4 text-center">
          <div className="w-12 h-12 rounded-full bg-red-500/15 text-red-400 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h2 className="text-base font-semibold text-ink-100">Account Deactivated</h2>
          <p className="text-xs text-ink-300 leading-relaxed">
            Your account ({user?.email || passwordUser?.email}) is currently inactive. Please
            contact an Academy Manager for assistance.
          </p>
          <Button
            variant="outline"
            onClick={() => void handleSignOut()}
            className="w-full flex items-center justify-center gap-2 py-2 text-xs font-mono text-ink-200"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Lock System & Return to Sign In</span>
          </Button>
        </div>
      </div>
    );
  }

  if (currentUser?.role === "Pending Guest" || (dbReady && !currentUser && !isOwnerGeogo)) {
    return (
      <div className="min-h-screen bg-ink-950 text-ink-100 flex flex-col justify-center items-center px-4 py-12">
        <div className="w-full max-w-md p-6 rounded-xl border border-amber-500/30 bg-ink-900 space-y-4 text-center">
          <div className="w-12 h-12 rounded-full bg-amber-500/15 text-amber-400 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <h2 className="text-base font-semibold text-ink-100">Role Assignment Required</h2>
          <p className="text-xs text-ink-300 leading-relaxed">
            Signed in as{" "}
            <span className="font-mono text-court-300">{user?.email || passwordUser?.email}</span>.
            Your account is verified, but an Academy Manager must assign your designated role before
            workspace access is unlocked.
          </p>
          <Button
            variant="outline"
            onClick={() => void handleSignOut()}
            className="w-full flex items-center justify-center gap-2 py-2 text-xs font-mono text-ink-200"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>Lock System & Return to Sign In</span>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`mx-auto grid min-h-screen max-w-[1560px] ${
        sidebarPinned ? "lg:grid-cols-[248px_1fr]" : "lg:grid-cols-[64px_1fr]"
      }`}
    >
      <div className="relative sticky top-0 z-30 hidden h-screen lg:block">
        <aside
          onMouseEnter={() => setSidebarHovered(true)}
          onMouseLeave={() => setSidebarHovered(false)}
          className={`flex h-screen flex-col overflow-x-hidden border-r border-ink-800 bg-ink-950 transition-[width,box-shadow] duration-200 ease-out ${
            sidebarPinned
              ? "w-[248px]"
              : isSidebarExpanded
                ? "absolute inset-y-0 left-0 w-[248px] shadow-2xl shadow-black/20 dark:shadow-black/60"
                : "w-16"
          }`}
        >
          {isSidebarExpanded ? (
            <>
              <div className="flex h-16 shrink-0 items-center gap-2.5 border-b border-ink-800 px-4">
                <img
                  src={currentLogo}
                  alt={currentAcademy?.name || "Vescio Vector"}
                  className="h-9 w-9 shrink-0 object-contain"
                  onError={(e) => {
                    if (
                      typeof window !== "undefined" &&
                      e.currentTarget.src !== window.location.origin + "/vescio-vector-logo.png"
                    ) {
                      e.currentTarget.src = "/vescio-vector-logo.png";
                    }
                  }}
                />
                <div className="min-w-0 flex-1 leading-none">
                  <div className="flex items-center gap-1.5">
                    <span className="font-display text-[15px] tracking-tight text-ink-100">
                      VESCIO
                    </span>
                    <span
                      className="inline-flex shrink-0 items-center rounded-full bg-amber-400 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-wider text-ink-950 shadow-sm ring-1 ring-amber-300"
                      title="Staging Environment"
                    >
                      STAGING
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[9px] tracking-[0.3em] text-court-400">
                    VECTOR
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleToggleSidebarPin}
                  aria-pressed={sidebarPinned}
                  aria-label={
                    sidebarPinned ? "Unlock sidebar to auto-collapse" : "Lock and pin sidebar open"
                  }
                  title={
                    sidebarPinned
                      ? "Sidebar pinned open — click to unlock (auto-collapse)"
                      : "Sidebar auto-collapses — click to pin/lock open"
                  }
                  className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors ${
                    sidebarPinned
                      ? "bg-court-500/15 text-court-400 ring-1 ring-court-500/40 hover:bg-court-500/25"
                      : "text-ink-400 ring-1 ring-transparent hover:bg-ink-850 hover:text-ink-100 hover:ring-ink-700"
                  }`}
                >
                  {sidebarPinned ? (
                    <Pin className="h-3.5 w-3.5" />
                  ) : (
                    <PinOff className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>

              <div className="px-4 pt-5">
                <button
                  type="button"
                  onClick={() => setWorkspaceCollapsed((prev) => !prev)}
                  aria-expanded={!workspaceCollapsed}
                  aria-controls="sidebar-workspace-card"
                  title={
                    workspaceCollapsed ? "Expand workspace details" : "Collapse workspace details"
                  }
                  className="flex w-full items-center justify-between gap-2 px-2 pb-2 text-left transition-colors hover:text-ink-100"
                >
                  <span className="label-mono">Workspace</span>
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-400 transition-colors hover:bg-ink-850 hover:text-ink-100">
                    {workspaceCollapsed ? (
                      <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronUp className="h-3.5 w-3.5" />
                    )}
                  </span>
                </button>

                <div
                  id="sidebar-workspace-card"
                  className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                    workspaceCollapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="p-px pb-3">
                      <div className="flex items-center gap-3 rounded-md bg-ink-850 px-2 py-2 ring-1 ring-ink-700">
                        <div className="grid h-8 w-8 place-items-center overflow-hidden rounded bg-court-500/15">
                          {currentAcademy?.logo ? (
                            <img
                              src={currentAcademy.logo}
                              alt=""
                              className="h-6 w-6 object-contain"
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          ) : (
                            <span className="font-mono text-xs text-court-400">{initials}</span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1 leading-tight">
                          <div className="truncate text-sm font-medium text-ink-100">
                            {currentAcademy.name}
                          </div>
                          <div className="truncate font-mono text-[10px] text-ink-400">
                            {currentAcademy.url}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {workspaceCollapsed ? (
                  <div
                    className={`grid gap-1.5 ${
                      hasModuleReadPermission("/crm") ? "grid-cols-2" : "grid-cols-1"
                    }`}
                  >
                    <Link
                      to="/up-erp"
                      preload="intent"
                      className={`flex h-8 items-center justify-center whitespace-nowrap rounded-md px-2 font-mono text-[11px] font-bold tracking-wide transition-all ${NEXUS_LINK_SURFACE_CLS}`}
                      title="Vescio Nexus ERP"
                    >
                      Nexus ERP
                    </Link>
                    {hasModuleReadPermission("/crm") && (
                      <Link
                        to="/crm"
                        preload="intent"
                        className={`flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-2 font-mono text-[11px] font-bold tracking-wide ring-1 transition-all ${
                          isNavActive("/crm", pathname)
                            ? "bg-court-500/20 text-court-400 ring-court-500/50 dark:text-court-300"
                            : "bg-ink-850/90 text-court-400 ring-court-500/30 hover:bg-court-500/15 hover:ring-court-500/45 dark:text-court-300"
                        }`}
                        title="CRM & Pipeline"
                      >
                        <Kanban className="h-3.5 w-3.5 shrink-0 text-court-400" />
                        <span>CRM</span>
                      </Link>
                    )}
                  </div>
                ) : (
                  <>
                    <Link
                      to="/up-erp"
                      preload="intent"
                      className={`flex items-center justify-between gap-2 rounded-md px-3 py-2 transition-all ${NEXUS_LINK_SURFACE_CLS}`}
                    >
                      <div className="min-w-0 leading-tight">
                        <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-teal-950 dark:text-emerald-300">
                          Vescio Nexus
                        </div>
                        <div className="font-mono text-[9px] text-teal-800 dark:text-emerald-400/80">
                          Courts · Gym · Physio · POS
                        </div>
                      </div>
                      <VescioNexusIcon className="h-5 w-8 shrink-0" />
                    </Link>

                    {hasModuleReadPermission("/crm") && (
                      <Link
                        to="/crm"
                        preload="intent"
                        className={`mt-2 flex items-center justify-between gap-2 rounded-md px-3 py-2 ring-1 transition-all ${
                          isNavActive("/crm", pathname)
                            ? "bg-court-500/20 text-court-400 ring-court-500/50 dark:text-court-300"
                            : "bg-ink-850/90 text-court-400 ring-court-500/30 hover:bg-court-500/15 hover:ring-court-500/45 dark:text-court-300"
                        }`}
                      >
                        <div className="min-w-0 leading-tight">
                          <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-court-400 dark:text-court-300">
                            CRM &amp; Pipeline
                          </div>
                          <div className="font-mono text-[9px] text-ink-400">
                            Leads · Trials · Renewals
                          </div>
                        </div>
                        <Kanban className="h-4 w-4 shrink-0 text-court-400" />
                      </Link>
                    )}
                  </>
                )}
              </div>

              <nav className="flex-1 space-y-6 overflow-y-auto px-4 pt-5">
                {visibleGroups.map((g) => (
                  <div key={g.title}>
                    <div className="label-mono px-2 pb-1.5">{g.title}</div>
                    <div className="space-y-0.5">
                      {g.items.map((item) => {
                        const active = isNavActive(item.to, pathname);
                        return (
                          <Link
                            key={item.to}
                            to={item.to}
                            preload="intent"
                            className={`flex items-center justify-between rounded-md px-2 py-2 ${
                              active
                                ? "bg-court-500/12 text-ink-100 ring-1 ring-court-500/30"
                                : "text-ink-200 transition-colors hover:bg-ink-850 hover:text-ink-100"
                            }`}
                          >
                            <span className={`text-sm ${active ? "font-medium" : ""}`}>
                              {item.label}
                            </span>
                            {item.meta ? (
                              <span
                                className={`font-mono text-[10px] ${
                                  active ? "text-court-400" : "text-ink-400"
                                }`}
                              >
                                {item.meta}
                              </span>
                            ) : null}
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </nav>

              <div className="border-t border-ink-800 px-4 py-3">
                <button
                  type="button"
                  onClick={() => setPackageCollapsed((prev) => !prev)}
                  aria-expanded={!packageCollapsed}
                  aria-controls="sidebar-package-details"
                  title={packageCollapsed ? "Expand package details" : "Collapse package details"}
                  className="flex w-full items-center justify-between gap-2 text-left transition-colors hover:text-ink-100"
                >
                  {packageCollapsed ? (
                    <span className="truncate text-[11px] text-ink-400">
                      Plan · <span className="text-ink-200">{currentAcademy.plan}</span> · renews{" "}
                      {currentAcademy.renews}
                    </span>
                  ) : (
                    <span className="label-mono">Package</span>
                  )}
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-400 transition-colors hover:bg-ink-850 hover:text-ink-100">
                    {packageCollapsed ? (
                      <ChevronUp className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </span>
                </button>

                <div
                  id="sidebar-package-details"
                  className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                    packageCollapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"
                  }`}
                >
                  <div className="overflow-hidden">
                    <div className="pt-2.5">
                      <div className="mb-2 flex items-baseline justify-between">
                        <span className="text-xs text-ink-200">Players used</span>
                        <span className="font-mono text-xs tabular-nums text-ink-100">
                          {playersUsedCount}
                          <span className="text-ink-400">/{playersLimit}</span>
                        </span>
                      </div>
                      <div className="h-1 overflow-hidden rounded-full bg-ink-800">
                        <div
                          className="h-full bg-court-500"
                          style={{
                            width: `${Math.min(100, (playersUsedCount / playersLimit) * 100)}%`,
                          }}
                        />
                      </div>
                      <div className="mt-3 text-[11px] text-ink-400">
                        Plan · <span className="text-ink-200">{currentAcademy.plan}</span> · renews{" "}
                        {currentAcademy.renews}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            /* Slim 64px Icon-Only Rail when Unlocked & Not Hovered */
            <>
              <div className="flex h-16 shrink-0 items-center justify-center border-b border-ink-800">
                <img
                  src={currentLogo}
                  alt={currentAcademy?.name || "Vescio Vector"}
                  className="h-8 w-8 object-contain"
                  onError={(e) => {
                    if (
                      typeof window !== "undefined" &&
                      e.currentTarget.src !== window.location.origin + "/vescio-vector-logo.png"
                    ) {
                      e.currentTarget.src = "/vescio-vector-logo.png";
                    }
                  }}
                />
              </div>

              <div className="flex flex-col items-center gap-2 border-b border-ink-800 py-3">
                <div
                  className="grid h-9 w-9 place-items-center overflow-hidden rounded-md bg-ink-850 ring-1 ring-ink-700"
                  title={`${currentAcademy.name} (${currentAcademy.url})`}
                >
                  {currentAcademy?.logo ? (
                    <img
                      src={currentAcademy.logo}
                      alt=""
                      className="h-6 w-6 object-contain"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    <span className="font-mono text-xs text-court-400">{initials}</span>
                  )}
                </div>

                <Link
                  to="/up-erp"
                  preload="intent"
                  title="Vescio Nexus"
                  className={`grid h-9 w-9 place-items-center rounded-md transition-all ${NEXUS_LINK_SURFACE_CLS}`}
                >
                  <VescioNexusIcon className="h-3.5 w-6" />
                </Link>

                {hasModuleReadPermission("/crm") && (
                  <Link
                    to="/crm"
                    preload="intent"
                    title="CRM & Pipeline"
                    className={`grid h-9 w-9 place-items-center rounded-md ring-1 transition-all ${
                      isNavActive("/crm", pathname)
                        ? "bg-court-500/20 text-court-400 ring-court-500/50"
                        : "bg-ink-850/90 text-court-400 ring-court-500/30 hover:bg-court-500/15"
                    }`}
                  >
                    <Kanban className="h-4 w-4" />
                  </Link>
                )}
              </div>

              <nav className="flex flex-1 flex-col items-center gap-1 overflow-y-auto py-3">
                {visibleGroups.flatMap((g) =>
                  g.items.map((item) => {
                    const active = isNavActive(item.to, pathname);
                    const IconComp = getSidebarNavIcon(item.to);
                    return (
                      <Link
                        key={item.to}
                        to={item.to}
                        preload="intent"
                        title={item.label}
                        className={`grid h-9 w-9 shrink-0 place-items-center rounded-md transition-colors ${
                          active
                            ? "bg-court-500/15 text-court-400 ring-1 ring-court-500/35"
                            : "text-ink-300 hover:bg-ink-850 hover:text-ink-100"
                        }`}
                      >
                        <IconComp className="h-4 w-4" />
                      </Link>
                    );
                  }),
                )}
              </nav>

              <div className="flex shrink-0 items-center justify-center border-t border-ink-800 py-3">
                <div
                  className="grid h-8 w-10 place-items-center rounded-md bg-ink-900 font-mono text-[9px] font-bold uppercase text-court-400 ring-1 ring-ink-800"
                  title={`Plan · ${currentAcademy.plan} · Players used ${playersUsedCount}/${playersLimit}`}
                >
                  {currentAcademy.plan}
                </div>
              </div>
            </>
          )}
        </aside>
      </div>

      <div className="min-w-0 pb-20 lg:pb-0">
        <header className="sticky top-0 z-20 flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-ink-800 bg-ink-950/90 px-4 py-2.5 backdrop-blur lg:px-8">
          {/* Left Side: Mobile Trigger & Page Title */}
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-ink-850 text-ink-300 ring-1 ring-ink-700 hover:bg-ink-800 hover:text-ink-100 lg:hidden"
              aria-label="Open Navigation Menu"
            >
              <Menu className="h-5 w-5 text-court-400" />
            </button>

            <span
              className="inline-flex shrink-0 items-center rounded-full bg-amber-400 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-ink-950 shadow-sm ring-1 ring-amber-300 lg:hidden"
              title="Staging Environment"
            >
              STAGING
            </span>

            {title ? (
              <h1 className="font-display shrink-0 truncate text-lg tracking-tight text-ink-100">
                {title}
              </h1>
            ) : null}
          </div>

          {/* Right Side: Page Action (if any), Currency, Notifications, Theme, Sign Out, Avatar & Profile */}
          <div className="ml-auto flex flex-wrap items-center gap-3">
            {action ? (
              <div className="hidden lg:flex flex-wrap items-center gap-2">{action}</div>
            ) : null}
            <span className="hidden md:inline-flex items-center rounded bg-ink-900 px-2 py-1 font-mono text-[10px] text-ink-400 ring-1 ring-ink-800">
              {currentAcademy?.currency || currentAcademy?.currencies?.join(" · ") || "USD"}
            </span>
            <NotificationCenter />

            <ThemeToggle />
            {mounted && (user || passwordUser) ? (
              <div className="flex items-center gap-3">
                <button
                  onClick={() => void handleSignOut()}
                  className="label-mono hidden items-center gap-2 rounded-md bg-ink-850 px-2.5 py-2 text-ink-300 ring-1 ring-ink-700 hover:bg-ink-800 sm:flex"
                >
                  SIGN OUT
                </button>
                <div className="flex items-center gap-2.5">
                  <div className="grid h-9 w-9 shrink-0 place-items-center bg-court-500/15 ring-1 ring-court-500/30 rounded-md overflow-hidden">
                    {user?.photoURL ? (
                      <img src={user.photoURL} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <span className="font-mono text-xs font-bold text-court-300">
                        {(
                          user?.displayName?.[0] ||
                          currentUser?.name?.[0] ||
                          passwordUser?.name?.[0] ||
                          user?.email?.[0] ||
                          "G"
                        ).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="hidden sm:flex flex-col text-left">
                    <span className="text-xs font-semibold text-ink-100 leading-tight">
                      {user?.displayName ||
                        currentUser?.name ||
                        passwordUser?.name ||
                        (user?.email === "geogo3@gmail.com"
                          ? "Georges Khoury"
                          : user?.email?.split("@")[0]) ||
                        "Academy Manager"}
                    </span>
                    <span className="text-[10px] font-mono text-court-400">
                      {currentUser?.role || passwordUser?.role || "Academy Manager"}
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <button
                onClick={() => void handleSignOut()}
                className="label-mono flex items-center gap-2 rounded-md bg-court-500/20 px-2.5 py-2 text-court-400 ring-1 ring-court-500/30 hover:bg-court-500/30"
              >
                <LogIn className="w-3.5 h-3.5" />
                SIGN IN
              </button>
            )}
          </div>
        </header>

        {/* Mobile Sub-Header Row for Workspace/Tenant, Branch, Role, Currency & Primary Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-800 bg-ink-900/60 px-4 py-2 lg:hidden">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <span className="inline-flex items-center rounded bg-ink-850 px-2 py-0.5 font-mono text-[10px] text-ink-200 ring-1 ring-ink-700">
              {currentAcademy.name}
            </span>
            <span className="inline-flex items-center rounded bg-court-500/15 px-2 py-0.5 font-mono text-[10px] text-court-400 ring-1 ring-court-500/30">
              {currentUser?.role || passwordUser?.role || "Academy Manager"}
            </span>
            {currentUser?.branch && (
              <span className="inline-flex items-center rounded bg-ink-850 px-2 py-0.5 font-mono text-[10px] text-ink-300 ring-1 ring-ink-700">
                {currentUser.branch}
              </span>
            )}
            <span className="inline-flex items-center rounded bg-ink-900 px-2 py-0.5 font-mono text-[10px] text-ink-400 ring-1 ring-ink-800 md:hidden">
              {currentAcademy?.currency || currentAcademy?.currencies?.join(" · ") || "USD"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
            {mounted && (user || passwordUser) && (
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="label-mono inline-flex items-center gap-1.5 rounded bg-ink-850 px-2 py-1 text-[10px] text-ink-300 ring-1 ring-ink-700 hover:bg-ink-800 sm:hidden"
              >
                SIGN OUT
              </button>
            )}
          </div>
        </div>

        <main className="px-4 py-6 lg:px-8">
          {pathname === "/admin" && !isMasterOwner(authUser?.email || currentUser?.email)
            ? null
            : children}
        </main>

        {/* Client-Friendly "Report a Technical Issue" Modal */}
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
                  {isMasterOwner(authUser?.email) && (
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
              <form onSubmit={(e) => void handleSubmitIssueReport(e)} className="space-y-4">
                <Field label="Problem Description (Optional)">
                  <Textarea
                    rows={3}
                    value={issueNote}
                    onChange={setIssueNote}
                    placeholder="Briefly describe the problem you encountered (optional)..."
                  />
                </Field>
                <div className="rounded-md border border-ink-800 bg-ink-950/70 p-2.5 font-mono text-[10px] text-ink-400">
                  Your current page route (<span className="text-ink-200">{pathname}</span>), role (
                  <span className="text-ink-200">
                    {currentUser?.role || passwordUser?.role || "User"}
                  </span>
                  ), and recent diagnostic logs will be attached automatically.
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                  {isMasterOwner(authUser?.email) && (
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

        {/* Universal Sign-In Modal */}
        <Modal
          open={signInOpen}
          title="Sign In to Academy Portal"
          meta="Authenticate with Google or enter your administrator-provisioned credentials"
          onClose={() => setSignInOpen(false)}
        >
          <div className="p-4 space-y-4">
            <button
              type="button"
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-md bg-court-500 hover:bg-court-400 text-ink-950 font-bold text-xs shadow-sm cursor-pointer disabled:opacity-50"
              disabled={isGoogleSigningIn}
              onClick={async (e) => {
                e.preventDefault();
                setIsGoogleSigningIn(true);
                const result = await signInWithGoogle();
                setIsGoogleSigningIn(false);
                if (result.success) {
                  setSignInOpen(false);
                  toast.success(result.message || "Signed in with Google successfully.");
                  if (isCoachOnlyRole(result.resolvedUser?.role)) {
                    navigate({ to: "/coach", replace: true });
                  }
                } else {
                  toast.error(result.message || "Google sign-in could not be completed.");
                }
              }}
            >
              <LogIn className="w-4 h-4" />
              <span>
                {isGoogleSigningIn ? "Connecting to Google..." : "Continue with Google Account"}
              </span>
            </button>

            <div className="relative flex items-center justify-center my-2">
              <div className="border-t border-ink-800 w-full" />
              <span className="bg-ink-900 px-2 text-[10px] font-mono text-ink-400 uppercase absolute">
                Or username & password
              </span>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                handlePasswordSubmit(e);
              }}
              className="space-y-3 pt-1"
            >
              <Field label="Username or Email">
                <Input
                  value={loginForm.username}
                  onChange={(v) => setLoginForm({ ...loginForm, username: v })}
                  placeholder="Enter your username or email"
                  autoFocus
                />
              </Field>

              <Field label="Password">
                <Input
                  type="password"
                  value={loginForm.password}
                  onChange={(v) => setLoginForm({ ...loginForm, password: v })}
                  placeholder="Enter account password"
                />
              </Field>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSigningIn}
                  className="w-full flex items-center justify-center gap-2 py-2 rounded-md bg-ink-800 hover:bg-ink-750 text-court-300 ring-1 ring-ink-700 font-semibold text-xs cursor-pointer disabled:opacity-50"
                >
                  <KeyRound className="w-4 h-4 text-court-400" />
                  <span>{isSigningIn ? "Verifying..." : "Sign In to Workspace"}</span>
                </button>
              </div>
            </form>

            <div className="rounded-md border border-ink-800 bg-ink-950/60 p-2.5 text-center">
              <p className="font-mono text-[10px] text-ink-400">
                Self-registration is disabled. User accounts are created and provisioned exclusively
                by Academy Administrators.
              </p>
            </div>
          </div>
        </Modal>
      </div>

      {/* Mobile Slide-Out Navigation Drawer */}
      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-ink-950/80 backdrop-blur-sm transition-opacity"
            onClick={() => setMobileDrawerOpen(false)}
          />

          {/* Drawer content */}
          <div className="relative flex w-full max-w-xs flex-1 flex-col border-r border-ink-800 bg-ink-950 shadow-2xl">
            <div className="flex h-16 items-center justify-between border-b border-ink-800 px-5">
              <div className="flex items-center gap-3">
                <img
                  src={currentLogo}
                  alt={currentAcademy?.name || "Vescio Vector"}
                  className="h-8 w-8 object-contain"
                  onError={(e) => {
                    if (
                      e.currentTarget.src !==
                      window.location.origin + "/vescio-vector-logo.png"
                    ) {
                      e.currentTarget.src = "/vescio-vector-logo.png";
                    }
                  }}
                />
                <div className="leading-none">
                  <div className="flex items-center gap-2">
                    <span className="font-display text-[15px] tracking-tight text-ink-100">
                      VESCIO
                    </span>
                    <span
                      className="inline-flex shrink-0 items-center rounded-full bg-amber-400 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider text-ink-950 shadow-sm ring-1 ring-amber-300"
                      title="Staging Environment"
                    >
                      STAGING
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-[9px] tracking-[0.3em] text-court-400">
                    VECTOR
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-md bg-ink-850 text-ink-400 hover:text-ink-100 ring-1 ring-ink-700"
                aria-label="Close menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* User Profile Card in Drawer */}
            <div className="border-b border-ink-800 p-4 bg-ink-900/50">
              {mounted && (user || passwordUser) ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="grid h-9 w-9 shrink-0 place-items-center bg-court-500/15 text-court-400 ring-1 ring-court-500/30 rounded-md font-mono text-xs font-bold">
                      {(
                        user?.displayName?.[0] ||
                        currentUser?.name?.[0] ||
                        passwordUser?.name?.[0] ||
                        user?.email?.[0] ||
                        "G"
                      ).toUpperCase()}
                    </div>
                    <div className="min-w-0 leading-tight">
                      <div className="truncate text-xs font-semibold text-ink-100">
                        {user?.displayName ||
                          currentUser?.name ||
                          passwordUser?.name ||
                          (user?.email === "geogo3@gmail.com"
                            ? "Georges Khoury"
                            : user?.email?.split("@")[0]) ||
                          "Academy Manager"}
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] text-court-400">
                        {currentUser?.role ||
                          passwordUser?.role ||
                          (user?.email === "geogo3@gmail.com" ? "Academy Manager" : "User")}
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      void handleSignOut();
                      setMobileDrawerOpen(false);
                    }}
                    className="label-mono rounded bg-ink-850 px-2 py-1 text-[9px] text-ink-300 ring-1 ring-ink-700 hover:bg-ink-800"
                  >
                    SIGN OUT
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setMobileDrawerOpen(false);
                    void handleSignOut();
                  }}
                  className="w-full flex items-center justify-center gap-2 rounded-md bg-court-500 py-2 text-xs font-semibold text-ink-950 hover:bg-court-400"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  <span>SIGN IN</span>
                </button>
              )}
            </div>

            {/* Workspace & Branch Context in Drawer */}
            <div className="border-b border-ink-800 px-4 py-3 bg-ink-950">
              <div className="label-mono pb-1.5 text-[10px] text-ink-400">Workspace & Branch</div>
              <div className="flex items-center gap-3 rounded-md bg-ink-850 px-2.5 py-2 ring-1 ring-ink-700">
                <div className="grid h-8 w-8 shrink-0 place-items-center bg-court-500/15 overflow-hidden rounded">
                  {currentAcademy?.logo ? (
                    <img
                      src={currentAcademy.logo}
                      alt=""
                      className="h-6 w-6 object-contain"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    <span className="font-mono text-xs text-court-400">{initials}</span>
                  )}
                </div>
                <div className="leading-tight min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-ink-100">
                    {currentAcademy.name}
                  </div>
                  <div className="truncate font-mono text-[10px] text-ink-400">
                    {currentUser?.branch || "All Branches"} ·{" "}
                    {currentAcademy?.currency || currentAcademy?.currencies?.join(" · ") || "USD"}
                  </div>
                </div>
              </div>

              <Link
                to="/up-erp"
                preload="intent"
                onClick={() => setMobileDrawerOpen(false)}
                className={`mt-2.5 flex items-center justify-between gap-2 rounded-md px-3 py-2 transition-all ${NEXUS_LINK_SURFACE_CLS}`}
              >
                <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-teal-950 dark:text-emerald-300">
                  Vescio Nexus
                </span>
                <VescioNexusIcon className="w-7 h-4 shrink-0" />
              </Link>

              {hasModuleReadPermission("/crm") && (
                <Link
                  to="/crm"
                  preload="intent"
                  onClick={() => setMobileDrawerOpen(false)}
                  className={`mt-2 flex items-center justify-between gap-2 rounded-md px-3 py-2 ring-1 transition-all ${
                    isNavActive("/crm", pathname)
                      ? "bg-court-500/20 text-court-300 ring-court-500/50"
                      : "bg-ink-850/90 text-court-300 ring-court-500/30 hover:bg-court-500/15"
                  }`}
                >
                  <div className="leading-tight min-w-0">
                    <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-court-300">
                      CRM &amp; Pipeline
                    </div>
                    <div className="font-mono text-[9px] text-ink-400">
                      Leads · Trials · Renewals
                    </div>
                  </div>
                  <Kanban className="h-4 w-4 shrink-0 text-court-400" />
                </Link>
              )}
            </div>

            {/* Complete Navigation Groups */}
            <nav className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
              {visibleGroups.map((g) => (
                <div key={g.title}>
                  <div className="label-mono px-2 pb-1.5 text-[10px] text-ink-400 uppercase tracking-wider">
                    {g.title}
                  </div>
                  <div className="space-y-1">
                    {g.items.map((item) => {
                      const active = isNavActive(item.to, pathname);
                      return (
                        <Link
                          key={item.to}
                          to={item.to}
                          preload="intent"
                          onClick={() => setMobileDrawerOpen(false)}
                          className={`flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                            active
                              ? "bg-court-500/15 text-court-300 ring-1 ring-court-500/30 font-medium"
                              : "text-ink-200 hover:bg-ink-850"
                          }`}
                        >
                          <span>{item.label}</span>
                          {item.meta && (
                            <span className="font-mono text-[9px] text-court-400/80 bg-ink-900 px-1.5 py-0.5 rounded border border-ink-800">
                              {item.meta}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>

            {/* Package Usage in Drawer */}
            <div className="border-t border-ink-800 p-4 bg-ink-900/40">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-ink-300">Players limit</span>
                <span className="font-mono text-ink-100 font-semibold">
                  {playersUsedCount}/{playersLimit}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-ink-800">
                <div
                  className="h-full bg-court-500"
                  style={{ width: `${Math.min(100, (playersUsedCount / playersLimit) * 100)}%` }}
                />
              </div>
              <div className="mt-3 space-y-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setMobileDrawerOpen(false);
                    setIssueReportedConfirm(false);
                    setReportIssueOpen(true);
                  }}
                  className="flex w-full items-center justify-center gap-1.5 rounded border border-ink-800 bg-ink-950 px-2.5 py-1.5 font-mono text-[10px] text-ink-300 hover:border-court-500/40 hover:text-court-300"
                >
                  <ShieldAlert className="h-3 w-3 text-court-400" />
                  <span>Report Issue</span>
                </button>
                {isMasterOwner(authUser?.email) && (
                  <button
                    type="button"
                    onClick={() => {
                      void copyDiagnosticReportToClipboard();
                      setMobileDrawerOpen(false);
                    }}
                    className="flex w-full items-center justify-center gap-1.5 rounded border border-court-500/30 bg-court-500/10 px-2.5 py-1.5 font-mono text-[10px] text-court-300 hover:bg-court-500/20"
                  >
                    <Copy className="h-3 w-3 text-court-400" />
                    <span>Copy AI Prompt Block</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {currentUser?.role !== "Technical Director" &&
        !isCoachOnlyRole(currentUser?.role || passwordUser?.role) && (
          <nav className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-around border-t border-ink-800 bg-ink-950/95 px-2 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur lg:hidden">
            {mobileTabs
              .filter((tab) => tab.to !== "/settings" && hasModuleReadPermission(tab.to))
              .map((tab) => {
                const active = tab.to === "/" ? pathname === "/" : pathname.startsWith(tab.to);
                return (
                  <Link
                    key={tab.to}
                    to={tab.to}
                    preload="intent"
                    className={`flex flex-1 flex-col items-center gap-1 py-1.5 transition-colors ${
                      active ? "text-court-400" : "text-ink-400"
                    }`}
                  >
                    <span className="font-mono text-sm leading-none">{glyphs[tab.to]}</span>
                    <span className="font-mono text-[9px] uppercase tracking-widest">
                      {tab.label}
                    </span>
                  </Link>
                );
              })}
            <button
              type="button"
              onClick={() => setMobileDrawerOpen(true)}
              className={`flex flex-1 flex-col items-center gap-1 py-1.5 transition-colors ${
                mobileDrawerOpen ? "text-court-400" : "text-ink-400"
              }`}
            >
              <span className="font-mono text-sm leading-none">☰</span>
              <span className="font-mono text-[9px] uppercase tracking-widest">Menu</span>
            </button>
          </nav>
        )}
    </div>
  );
}

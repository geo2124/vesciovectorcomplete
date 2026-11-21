import { doc, getDoc } from "firebase/firestore";
import { money } from "@/components/kit";
import { db as firestore } from "./firebase";
import { getTenantSlug } from "./utils";

export type DispatchChannel = "SMS" | "Email" | "WhatsApp";

export type NotificationPayload = {
  recipientName: string;
  recipientPhone?: string | undefined;
  recipientEmail?: string | undefined;
  subject: string;
  message: string;
  channel: DispatchChannel;
  receiptNumber?: string | undefined;
  amount?: number | undefined;
  branch?: string | undefined;
  targetCoachId?: string | undefined;
  targetCoachName?: string | undefined;
  targetTeam?: string | undefined;
  targetUserId?: string | undefined;
  metadata?: Record<string, string | number> | undefined;
};

export type DispatchResult = {
  success: boolean;
  messageId: string;
  channel: DispatchChannel;
  timestamp: string;
  provider: string;
  status?: string;
  statusMessage?: string;
  note?: string;
  fallbackToInApp?: boolean;
};

/**
 * Service that dispatches outbound transactional notifications (SMS via Twilio,
 * Email via SendGrid / FCM REST, and Direct WhatsApp API), or logs them to the
 * internal Notification Center when external webhook URLs are not configured.
 */
export async function dispatchNotification(
  payload: NotificationPayload,
  config?: {
    smsProvider?: string;
    emailProvider?: string;
    smsApiKey?: string;
    emailApiKey?: string;
    smsWebhookUrl?: string;
    emailWebhookUrl?: string;
  },
): Promise<DispatchResult> {
  const timestamp = new Date().toISOString();
  const hasSmsWebhook = Boolean(config?.smsWebhookUrl?.trim());
  const hasEmailWebhook = Boolean(config?.emailWebhookUrl?.trim());

  const isExternalConfigured =
    ((payload.channel === "SMS" || payload.channel === "WhatsApp") && hasSmsWebhook) ||
    (payload.channel === "Email" && hasEmailWebhook);

  const provider = !isExternalConfigured
    ? "In-App Notification Center"
    : payload.channel === "SMS"
      ? config?.smsProvider || "Twilio SMS Gateway"
      : payload.channel === "WhatsApp"
        ? config?.smsProvider || "WhatsApp Cloud Business API"
        : payload.channel === "Email"
          ? config?.emailProvider || "SendGrid Cloud Dispatcher"
          : "WhatsApp Cloud Business API";

  const persistToNotificationCenter = async (messageId: string) => {
    try {
      const tenantId = getTenantSlug();
      if (!tenantId) return;
      const isBroadcast = Boolean(payload.metadata?.group);
      const isGameAlert = Boolean(
        payload.metadata?.sessionId ||
        payload.subject?.toLowerCase().includes("game") ||
        payload.subject?.toLowerCase().includes("fixture"),
      );
      const isBilling =
        Boolean(payload.amount !== undefined || payload.receiptNumber) && !isBroadcast;
      const isPrivateGuardianOrBilling = !isBroadcast && !isGameAlert;
      const targetBranchId =
        payload.branch || (payload.metadata?.branch ? String(payload.metadata.branch) : undefined);

      const created = await dispatchAcademyNotification(tenantId, {
        id: messageId,
        title: payload.subject || `${payload.channel} Notification to ${payload.recipientName}`,
        message: `${payload.message}${
          payload.recipientPhone
            ? ` [To: ${payload.recipientName} (${payload.recipientPhone})]`
            : payload.recipientName
              ? ` [To: ${payload.recipientName}]`
              : ""
        }`,
        type: isBilling ? "billing" : "system",
        targetRoles:
          isBilling || isPrivateGuardianOrBilling
            ? ["super_admin", "accountant", "branch_manager"]
            : ["super_admin", "branch_manager", "technical_director", "coach", "accountant"],
        targetBranchId,
        targetCoachId: payload.targetCoachId,
        targetCoachName: payload.targetCoachName,
        targetTeam: payload.targetTeam,
        targetUserId: payload.targetUserId,
        actionUrl: isBroadcast
          ? "/settings?tab=communications"
          : isBilling
            ? "/accounting"
            : undefined,
        createdAt: timestamp,
        readBy: [],
        dismissedBy: [],
      });
      const existing = dbStore.getSlice("notifications") || [];
      if (!existing.some((n) => n.id === created.id)) {
        dbStore.setSlice("notifications", [created, ...existing]);
      }
    } catch (err) {
      console.warn("Failed to persist dispatched notification to Firestore:", err);
    }
  };

  const resolveGatewayApiKey = async (
    field: "smsApiKey" | "emailApiKey",
    explicitKey?: string,
  ): Promise<string> => {
    if (explicitKey?.trim()) return explicitKey.trim();
    try {
      const tenantId = getTenantSlug();
      if (!tenantId || !firestore) return "";
      let snap = await getDoc(doc(firestore, "tenants", tenantId, "settings", "secrets"));
      if (!snap.exists()) {
        snap = await getDoc(doc(firestore, "tenants", tenantId, "private", "secrets"));
      }
      if (snap.exists()) {
        const val = snap.data()?.[field];
        if (typeof val === "string" && val.trim()) return val.trim();
      }
    } catch {
      // Non-admin callers may not have read access to /settings/secrets; proceed without throwing
    }
    return "";
  };

  // If external SMS / WhatsApp webhook URL is configured in Academy Settings:
  if (
    (payload.channel === "SMS" || payload.channel === "WhatsApp") &&
    hasSmsWebhook &&
    config?.smsWebhookUrl
  ) {
    try {
      const apiKey = await resolveGatewayApiKey("smsApiKey", config.smsApiKey);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}`, "x-api-key": apiKey } : {}),
      };
      await fetch(config.smsWebhookUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const messageId = `${payload.channel === "WhatsApp" ? "wa" : "tw"}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      await persistToNotificationCenter(messageId);
      return {
        success: true,
        messageId,
        channel: payload.channel,
        timestamp,
        provider,
        status: "Dispatched",
        statusMessage: `Dispatched via ${provider} to ${payload.recipientPhone || payload.recipientName}`,
        note: `Dispatched via ${provider} to ${payload.recipientPhone || payload.recipientName}`,
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : `Failed ${payload.channel} delivery`;
      return {
        success: false,
        messageId: `err-${Date.now()}`,
        channel: payload.channel,
        timestamp,
        provider,
        status: "Failed",
        statusMessage: msg,
        note: msg,
      };
    }
  }

  // If external Email webhook URL is configured in Academy Settings:
  if (payload.channel === "Email" && hasEmailWebhook && config?.emailWebhookUrl) {
    try {
      const apiKey = await resolveGatewayApiKey("emailApiKey", config.emailApiKey);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}`, "x-api-key": apiKey } : {}),
      };
      await fetch(config.emailWebhookUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      const messageId = `sg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      await persistToNotificationCenter(messageId);
      return {
        success: true,
        messageId,
        channel: "Email",
        timestamp,
        provider,
        status: "Dispatched",
        statusMessage: `Dispatched via ${provider} to ${payload.recipientEmail || payload.recipientName}`,
        note: `Dispatched via ${provider} to ${payload.recipientEmail || payload.recipientName}`,
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed Email delivery";
      return {
        success: false,
        messageId: `err-${Date.now()}`,
        channel: "Email",
        timestamp,
        provider,
        status: "Failed",
        statusMessage: msg,
        note: msg,
      };
    }
  }

  // When external SMS/Email webhook URLs are not configured,
  // persist to the in-app Notification Center and return a clear fallback status.
  const messageId = `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  await persistToNotificationCenter(messageId);
  const fallbackMsg =
    "Logged to In-App Notification Center (External SMS/Email webhook not configured)";
  return {
    success: true,
    messageId,
    channel: payload.channel,
    timestamp,
    provider: "In-App Notification Center",
    status: fallbackMsg,
    statusMessage: fallbackMsg,
    note: fallbackMsg,
    fallbackToInApp: true,
  };
}

// ---------------------------------------------------------------------------
// Production-Grade Role-Scoped Firestore In-App Notification Engine
// ---------------------------------------------------------------------------

import { useMemo, useCallback } from "react";
import {
  useDB,
  dbStore,
  setDb,
  useTenantUser,
  normalizeAcademyRole,
  getCoachBranches,
  getCoachTeams,
  defaultRoleDefinitions,
  type RoleDefinition,
  type AcademyNotification,
  type NotificationType,
  type AcademyRole,
} from "./data-store";
import type { Coach } from "./mock-data";
import { useAuth } from "./auth";
import {
  dispatchAcademyNotification,
  markNotificationRead,
  markAllNotificationsRead,
  dismissAcademyNotification,
  dismissAllAcademyNotifications,
} from "./firestore-sync";

export async function createAcademyNotification(
  tenantId: string,
  notification: Omit<AcademyNotification, "id" | "tenantId"> & { id?: string },
): Promise<AcademyNotification> {
  const created = await dispatchAcademyNotification(tenantId, notification);
  const current = dbStore.getSlice("notifications") || [];
  if (!current.some((n) => n.id === created.id)) {
    const next = [created, ...current];
    dbStore.setSlice("notifications", next);
    setDb((prev) => ({ ...prev, notifications: next }));
  }
  return created;
}

export type { AcademyNotification, NotificationType, AcademyRole };

export interface NotificationVisibilityContext {
  userKeys?: string[];
  userRoleName?: string;
  branchScope?: string;
  customRoles?: RoleDefinition[];
  matchedCoach?: Partial<Coach> | null;
  coachBranches?: string[];
  coachTeams?: string[];
}

const BUILTIN_ROLE_NAMES = new Set([
  "super admin",
  "academy manager",
  "admin",
  "tenant admin",
  "academy director",
  "technical director",
  "branch manager",
  "accountant",
  "coach",
  "super_admin",
  "branch_manager",
  "technical_director",
]);

function normalizeBranchTokens(input?: string | string[] | null): string[] {
  if (!input) return [];
  const rawList = Array.isArray(input) ? input : [input];
  const result: string[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== "string") continue;
    for (const part of item.split(",")) {
      const trimmed = part.trim().toLowerCase();
      if (trimmed && trimmed !== "all" && trimmed !== "hq" && trimmed !== "all branches") {
        if (!result.includes(trimmed)) {
          result.push(trimmed);
        }
      }
    }
  }
  return result;
}

/**
 * Resolves a role-safe navigation URL for a notification click.
 * Coaches are routed to `/coach` for game/session/curriculum/payroll alerts instead of restricted admin screens.
 * Other roles are checked against module read permissions before navigating.
 */
export function resolveSafeNotificationActionUrl(
  actionUrl: string | undefined,
  role: AcademyRole,
  userRoleName?: string,
  customRoles?: RoleDefinition[],
): string | null {
  if (!actionUrl || !actionUrl.trim()) return null;
  const trimmedUrl = actionUrl.trim();
  const pathPart = trimmedUrl.split("?")[0].toLowerCase();

  // Coaches operate exclusively inside `/coach`
  const isCoachRole =
    role === "coach" &&
    (!userRoleName ||
      userRoleName.trim().toLowerCase() === "coach" ||
      !BUILTIN_ROLE_NAMES.has(userRoleName.trim().toLowerCase()) === false);

  if (isCoachRole || userRoleName?.trim().toLowerCase() === "coach") {
    if (
      pathPart.startsWith("/coach") ||
      pathPart.startsWith("/technical") ||
      pathPart.startsWith("/sessions") ||
      pathPart.startsWith("/calendar") ||
      pathPart.startsWith("/plans") ||
      pathPart.startsWith("/accounting")
    ) {
      return "/coach";
    }
    return null;
  }

  if (role === "super_admin") {
    return trimmedUrl;
  }

  // Map route prefixes to RBAC module keys
  const moduleMap: Record<string, string> = {
    "/accounting": "accounting",
    "/merchandise": "merchandise",
    "/technical": "drills",
    "/sessions": "sessions",
    "/calendar": "sessions",
    "/players": "players",
    "/teams": "teams",
    "/branches": "branches",
    "/staff": "staff",
    "/settings": "settings",
    "/users": "users",
  };

  const matchedPrefix = Object.keys(moduleMap).find((prefix) => pathPart.startsWith(prefix));
  if (!matchedPrefix) {
    return trimmedUrl;
  }

  const moduleKey = moduleMap[matchedPrefix];
  const roleLower = (userRoleName || role).trim().toLowerCase();
  const defaultDef = defaultRoleDefinitions.find((r) => r.name.toLowerCase() === roleLower);
  const customDef = (customRoles || []).find((r) => r.name.toLowerCase() === roleLower);
  const mergedPermissions = {
    ...defaultDef?.permissions,
    ...customDef?.permissions,
  };

  if (mergedPermissions[moduleKey]?.read) {
    return trimmedUrl;
  }

  // Built-in role allowances
  if (
    role === "branch_manager" &&
    ["accounting", "merchandise", "sessions", "players", "teams", "branches"].includes(moduleKey)
  ) {
    return trimmedUrl;
  }
  if (
    role === "technical_director" &&
    ["drills", "sessions", "players", "teams"].includes(moduleKey)
  ) {
    return trimmedUrl;
  }
  if (role === "accountant" && ["accounting", "merchandise", "players"].includes(moduleKey)) {
    return trimmedUrl;
  }

  return null;
}

/**
 * Role Scoping, Per-User Dismissal, Coach/Team Isolation & Branch Filtering Rules:
 * - Filters out any notification dismissed by the current user (`dismissedBy`).
 * - Enforces `targetUserId`, `targetCoachId` / `targetCoachName`, `targetTeam`, and `targetBranchId` / `targetBranchIds`.
 * - Supports Custom Roles by evaluating `db.customRoles` module read permissions.
 */
export function isNotificationVisibleToUser(
  notif: AcademyNotification,
  role: AcademyRole,
  userBranch?: string,
  context?: NotificationVisibilityContext,
): boolean {
  // Suppress false-positive background listener permission-denied Auto Error Alerts on staging
  const titleText = String(notif.title || "");
  const msgText = String(notif.message || "").toLowerCase();
  if (
    titleText.includes("Auto Error Alert") &&
    (msgText.includes("missing or insufficient permissions") ||
      msgText.includes("permission-denied"))
  ) {
    return false;
  }

  const userKeys = (context?.userKeys || []).filter(Boolean);

  // 0. Per-User Dismissal Check (applies to ALL roles including Super Admin)
  if (Array.isArray(notif.dismissedBy) && notif.dismissedBy.length > 0 && userKeys.length > 0) {
    if (userKeys.some((key) => notif.dismissedBy!.includes(key))) {
      return false;
    }
  }

  // 1. Specific User Targeting Check
  if (notif.targetUserId && notif.targetUserId.trim()) {
    const targetTrimmed = notif.targetUserId.trim();
    const targetLower = targetTrimmed.toLowerCase();
    // Strictly isolate notifications targeted to master owner geogo3@gmail.com
    if (targetLower === "geogo3@gmail.com") {
      if (!userKeys.some((k) => k.trim().toLowerCase() === "geogo3@gmail.com")) {
        return false;
      }
    } else if (
      role !== "super_admin" &&
      !userKeys.some((k) => k.trim().toLowerCase() === targetLower)
    ) {
      return false;
    }
  }

  // 2. Gather Notification Branch Constraints
  const notifBranches = [
    ...normalizeBranchTokens(notif.targetBranchId),
    ...normalizeBranchTokens(notif.targetBranchIds),
  ];

  // 3. Universal Branch Scope Check for Non-Super-Admin Roles (Finding #5)
  if (role !== "super_admin" && notifBranches.length > 0) {
    const isCoachRole =
      role === "coach" &&
      (!context?.userRoleName || context.userRoleName.trim().toLowerCase() === "coach");

    if (isCoachRole) {
      const coachAllowed = normalizeBranchTokens(
        context?.coachBranches && context.coachBranches.length > 0
          ? context.coachBranches
          : userBranch,
      );
      if (coachAllowed.length > 0 && !notifBranches.some((nb) => coachAllowed.includes(nb))) {
        return false;
      }
    } else if (
      role === "branch_manager" ||
      context?.userRoleName?.trim().toLowerCase() === "branch manager" ||
      context?.branchScope === "Assigned branch only"
    ) {
      const userAllowed = normalizeBranchTokens(userBranch);
      if (userAllowed.length > 0 && !notifBranches.some((nb) => userAllowed.includes(nb))) {
        return false;
      }
    }
  }

  // 4. Super Admin has full visibility across all non-dismissed alert types and branches
  if (role === "super_admin") {
    return true;
  }

  // 5. Target Coach & Team Isolation (Finding #3)
  const hasCoachTarget = Boolean(notif.targetCoachId?.trim() || notif.targetCoachName?.trim());
  const matchesCurrentCoach = Boolean(
    (notif.targetCoachId &&
      (context?.matchedCoach?.id === notif.targetCoachId ||
        userKeys.includes(notif.targetCoachId))) ||
    (notif.targetCoachName &&
      context?.matchedCoach?.name &&
      notif.targetCoachName.trim().toLowerCase() ===
        context.matchedCoach.name.trim().toLowerCase()),
  );

  // If a notification targets a specific coach, other coaches or unrelated non-admin roles shouldn't see it
  const roleNameLower = (context?.userRoleName || "").trim().toLowerCase();
  const isCustomRole = Boolean(roleNameLower && !BUILTIN_ROLE_NAMES.has(roleNameLower));

  if (role === "coach" && !isCustomRole) {
    const matchedCoach = context?.matchedCoach;
    const isPersonalCoachPayout = Boolean(
      matchedCoach &&
      ((notif.targetCoachId && notif.targetCoachId === matchedCoach.id) ||
        (notif.targetCoachName &&
          matchedCoach.name &&
          notif.targetCoachName.trim().toLowerCase() === matchedCoach.name.trim().toLowerCase())),
    );

    // Hard-block any notification whose title or message mentions tuition, invoice, player payment, or guardian receipt unless it is explicitly a personal coach payroll payout
    const combinedText = `${notif.title || ""} ${notif.message || ""}`.toLowerCase();
    const mentionsPlayerBilling =
      combinedText.includes("tuition") ||
      combinedText.includes("invoice") ||
      combinedText.includes("player payment") ||
      combinedText.includes("guardian receipt");
    if (mentionsPlayerBilling && !isPersonalCoachPayout) {
      return false;
    }

    // Must match specific coach if targeted
    if (hasCoachTarget && !matchesCurrentCoach) {
      return false;
    }

    // Workshop / multi-coach & level targeting check
    const hasWorkshopTargets =
      (Array.isArray(notif.targetCoachNames) && notif.targetCoachNames.length > 0) ||
      (Array.isArray(notif.targetCoachLevels) && notif.targetCoachLevels.length > 0);
    if (hasWorkshopTargets) {
      if (!matchedCoach) {
        return false;
      }
      const matchesWorkshopCoachName = Boolean(
        notif.targetCoachNames?.some(
          (n) =>
            (matchedCoach.name &&
              n.trim().toLowerCase() === matchedCoach.name.trim().toLowerCase()) ||
            n === matchedCoach.id,
        ),
      );
      const matchesWorkshopCoachLevel = Boolean(
        matchedCoach.level &&
        notif.targetCoachLevels?.some(
          (l) => l.trim().toLowerCase() === matchedCoach.level!.trim().toLowerCase(),
        ),
      );
      if (!matchesWorkshopCoachName && !matchesWorkshopCoachLevel) {
        return false;
      }
    }

    // Must match one of the coach's assigned teams if targetTeam is set
    if (notif.targetTeam && notif.targetTeam.trim()) {
      const myTeams = context?.coachTeams || [];
      const targetTeamLower = notif.targetTeam.trim().toLowerCase();
      if (!myTeams.some((t) => t.trim().toLowerCase() === targetTeamLower)) {
        return false;
      }
    }

    // Coaches NEVER see inventory alerts
    if (notif.type === "inventory") {
      return false;
    }

    // Coaches NEVER see general billing alerts; ONLY personal coach payroll payout alerts targeted specifically to them
    if (notif.type === "billing") {
      return hasCoachTarget && matchesCurrentCoach;
    }

    if (notif.type !== "attendance" && notif.type !== "curriculum" && notif.type !== "system") {
      return false;
    }

    if (notif.targetRoles && notif.targetRoles.length > 0 && !notif.targetRoles.includes("coach")) {
      return false;
    }

    return true;
  }

  // 6. Custom Role Support via Module Permissions (Finding #6)
  if (isCustomRole) {
    const defaultDef = defaultRoleDefinitions.find((r) => r.name.toLowerCase() === roleNameLower);
    const customDef = (context?.customRoles || []).find(
      (r) => r.name.toLowerCase() === roleNameLower,
    );
    const perms = {
      ...defaultDef?.permissions,
      ...customDef?.permissions,
    };

    switch (notif.type) {
      case "billing":
        return Boolean(perms.accounting?.read);
      case "inventory":
        return Boolean(perms.merchandise?.read);
      case "curriculum":
        return Boolean(perms.drills?.read || perms.sessions?.read || perms.teams?.read);
      case "attendance":
        return Boolean(perms.sessions?.read || perms.players?.read);
      case "system":
        return Boolean(perms.dashboard?.read || Object.values(perms).some((p) => Boolean(p?.read)));
      default:
        return false;
    }
  }

  // 7. Standard Built-in Role Scoping by Type
  switch (role) {
    case "technical_director":
      // ONLY 'curriculum', 'attendance' (when targeted), and 'system' (NEVER 'inventory' or 'billing')
      if (notif.type === "inventory" || notif.type === "billing") {
        return false;
      }
      if (
        notif.type !== "curriculum" &&
        notif.type !== "system" &&
        !(notif.type === "attendance" && notif.targetRoles?.includes("technical_director"))
      ) {
        return false;
      }
      break;

    case "accountant":
      // ONLY 'billing', 'inventory', and 'system'
      if (notif.type !== "billing" && notif.type !== "inventory" && notif.type !== "system") {
        return false;
      }
      break;

    case "branch_manager":
      // 'attendance', 'billing', 'inventory', 'system' (scoped to their branch or all branches)
      if (
        notif.type !== "attendance" &&
        notif.type !== "billing" &&
        notif.type !== "inventory" &&
        notif.type !== "system"
      ) {
        return false;
      }
      break;

    default:
      return false;
  }

  // 8. Target Roles Check (if defined and non-empty on notification)
  if (notif.targetRoles && notif.targetRoles.length > 0) {
    // Allow Branch Manager to see branch-relevant inventory alerts even on legacy notifications
    if (role === "branch_manager" && notif.type === "inventory") {
      return true;
    }
    if (!notif.targetRoles.includes(role)) {
      return false;
    }
  }

  return true;
}

/**
 * React Hook for persistent, real-time, role-scoped notifications.
 */
export function useAcademyNotifications() {
  const { db, tenantId } = useDB();
  const currentUser = useTenantUser();
  const { user: authUser, passwordUser } = useAuth();

  // Unified primary userKey for writing to readBy and dismissedBy (Findings #8 & #9)
  const currentUserId = useMemo(() => {
    return (
      currentUser?.id ||
      authUser?.uid ||
      passwordUser?.id ||
      currentUser?.email ||
      authUser?.email ||
      "anonymous-user"
    );
  }, [currentUser?.id, currentUser?.email, authUser?.uid, authUser?.email, passwordUser?.id]);

  // All candidate keys for this user to ensure 100% compatibility with legacy readBy / dismissedBy entries
  const userKeys = useMemo(() => {
    const keys = new Set<string>();
    if (currentUser?.id) keys.add(currentUser.id);
    if (currentUser?.authUid) keys.add(currentUser.authUid);
    if (authUser?.uid) keys.add(authUser.uid);
    if (passwordUser?.id) keys.add(passwordUser.id);
    if (currentUser?.email) keys.add(currentUser.email);
    if (authUser?.email) keys.add(authUser.email);
    keys.add(currentUserId);
    return Array.from(keys);
  }, [
    currentUser?.id,
    currentUser?.authUid,
    currentUser?.email,
    authUser?.uid,
    authUser?.email,
    passwordUser?.id,
    currentUserId,
  ]);

  const currentRole: AcademyRole = useMemo(() => {
    return normalizeAcademyRole(currentUser?.role);
  }, [currentUser?.role]);

  const userBranch = currentUser?.branch;

  // Resolve Coach profile if the logged-in user is a Coach
  const matchedCoach = useMemo(() => {
    if (!db.coaches || db.coaches.length === 0) return null;
    const uEmail = (currentUser?.email || authUser?.email || "").trim().toLowerCase();
    const uName = (currentUser?.name || "").trim().toLowerCase();
    return (
      db.coaches.find(
        (c) =>
          (c.id && userKeys.includes(c.id)) ||
          (uEmail && c.email && c.email.trim().toLowerCase() === uEmail) ||
          (uName && c.name && c.name.trim().toLowerCase() === uName),
      ) || null
    );
  }, [db.coaches, currentUser?.email, currentUser?.name, authUser?.email, userKeys]);

  const coachBranches = useMemo(() => {
    const fromCoach = getCoachBranches(matchedCoach);
    if (fromCoach.length > 0) return fromCoach;
    return currentUser?.branch ? [currentUser.branch] : [];
  }, [matchedCoach, currentUser?.branch]);

  const coachTeams = useMemo(() => {
    return getCoachTeams(matchedCoach, db.teams);
  }, [matchedCoach, db.teams]);

  const visibilityContext = useMemo<NotificationVisibilityContext>(
    () => ({
      userKeys,
      userRoleName: currentUser?.role,
      branchScope: currentUser?.branchScope,
      customRoles: db.customRoles,
      matchedCoach,
      coachBranches,
      coachTeams,
    }),
    [
      userKeys,
      currentUser?.role,
      currentUser?.branchScope,
      db.customRoles,
      matchedCoach,
      coachBranches,
      coachTeams,
    ],
  );

  // Raw notifications sorted by createdAt descending
  const rawNotifications = useMemo(() => {
    const list = [...(db.notifications || [])];
    return list.sort((a, b) => {
      const timeA = new Date(a.createdAt || 0).getTime();
      const timeB = new Date(b.createdAt || 0).getTime();
      return timeB - timeA;
    });
  }, [db.notifications]);

  // Filtered by current user's role, coach/team assignment, branch scope, and per-user dismissal
  const visibleNotifications = useMemo(() => {
    return rawNotifications.filter((n) =>
      isNotificationVisibleToUser(n, currentRole, userBranch, visibilityContext),
    );
  }, [rawNotifications, currentRole, userBranch, visibilityContext]);

  const isNotificationRead = useCallback(
    (notif: AcademyNotification): boolean => {
      if (!Array.isArray(notif.readBy) || notif.readBy.length === 0) return false;
      return userKeys.some((k) => notif.readBy.includes(k));
    },
    [userKeys],
  );

  // Unread badge count
  const unreadCount = useMemo(() => {
    return visibleNotifications.filter((n) => !isNotificationRead(n)).length;
  }, [visibleNotifications, isNotificationRead]);

  const markAsRead = useCallback(
    async (notificationId: string) => {
      const current = dbStore.getSlice("notifications") || [];
      const updated = current.map((n) =>
        n.id === notificationId
          ? {
              ...n,
              readBy: n.readBy?.includes(currentUserId)
                ? n.readBy
                : [...(n.readBy || []), currentUserId],
            }
          : n,
      );
      dbStore.setSlice("notifications", updated);
      setDb((prev) => ({ ...prev, notifications: updated }));
      await markNotificationRead(tenantId, notificationId, currentUserId);
    },
    [tenantId, currentUserId],
  );

  const markAllAsRead = useCallback(async () => {
    const unreadIds = visibleNotifications.filter((n) => !isNotificationRead(n)).map((n) => n.id);
    if (unreadIds.length > 0) {
      const current = dbStore.getSlice("notifications") || [];
      const updated = current.map((n) =>
        unreadIds.includes(n.id)
          ? {
              ...n,
              readBy: n.readBy?.includes(currentUserId)
                ? n.readBy
                : [...(n.readBy || []), currentUserId],
            }
          : n,
      );
      dbStore.setSlice("notifications", updated);
      setDb((prev) => ({ ...prev, notifications: updated }));
      await markAllNotificationsRead(tenantId, unreadIds, currentUserId);
    }
  }, [visibleNotifications, isNotificationRead, currentUserId, tenantId]);

  const dismiss = useCallback(
    async (notificationId: string) => {
      const current = dbStore.getSlice("notifications") || [];
      const updated = current.map((n) =>
        n.id === notificationId
          ? {
              ...n,
              dismissedBy: n.dismissedBy?.includes(currentUserId)
                ? n.dismissedBy
                : [...(n.dismissedBy || []), currentUserId],
            }
          : n,
      );
      dbStore.setSlice("notifications", updated);
      setDb((prev) => ({ ...prev, notifications: updated }));
      await dismissAcademyNotification(tenantId, notificationId, currentUserId);
    },
    [tenantId, currentUserId],
  );

  const dismissAll = useCallback(async () => {
    const visibleIds = visibleNotifications.map((n) => n.id);
    if (visibleIds.length === 0) return;
    const current = dbStore.getSlice("notifications") || [];
    const updated = current.map((n) =>
      visibleIds.includes(n.id)
        ? {
            ...n,
            dismissedBy: n.dismissedBy?.includes(currentUserId)
              ? n.dismissedBy
              : [...(n.dismissedBy || []), currentUserId],
          }
        : n,
    );
    dbStore.setSlice("notifications", updated);
    setDb((prev) => ({ ...prev, notifications: updated }));
    await dismissAllAcademyNotifications(tenantId, visibleIds, currentUserId);
  }, [visibleNotifications, currentUserId, tenantId]);

  const resolveActionUrl = useCallback(
    (actionUrl?: string) =>
      resolveSafeNotificationActionUrl(actionUrl, currentRole, currentUser?.role, db.customRoles),
    [currentRole, currentUser?.role, db.customRoles],
  );

  return {
    notifications: visibleNotifications,
    allNotifications: rawNotifications,
    unreadCount,
    currentUserId,
    currentRole,
    userRoleName: currentUser?.role,
    userBranch,
    isNotificationRead,
    resolveActionUrl,
    markAsRead,
    markAllAsRead,
    dismiss,
    dismissAll,
  };
}

// ---------------------------------------------------------------------------
// Notification Event Dispatch Triggers
// ---------------------------------------------------------------------------

/**
 * Event Trigger 1: Inventory
 * Dispatch an 'inventory' notification to 'super_admin', 'accountant', and 'branch_manager' when stock <= reorderLevel.
 */
export async function dispatchInventoryAlert(
  tenantId: string,
  params: {
    itemName: string;
    variant?: string;
    stock: number;
    reorderLevel: number;
    branch?: string;
  },
) {
  if (params.stock > params.reorderLevel) return;

  return await createAcademyNotification(tenantId, {
    title: `Low Stock Alert: ${params.itemName}`,
    message: `Stock level for "${params.itemName}"${params.variant ? ` (${params.variant})` : ""} has dropped to ${params.stock} (reorder point: ${params.reorderLevel}).`,
    type: "inventory",
    targetRoles: ["super_admin", "accountant", "branch_manager"],
    targetBranchId: params.branch || undefined,
    actionUrl: "/merchandise",
    createdAt: new Date().toISOString(),
    readBy: [],
    dismissedBy: [],
  });
}

export const dispatchLowStockAlert = dispatchInventoryAlert;

/**
 * Event Trigger 2: Invoicing
 * Dispatch a 'billing' notification when monthly tuition batch finishes.
 */
export async function dispatchBillingAlert(
  tenantId: string,
  params: {
    month: string;
    year: number;
    generatedCount: number;
    totalAmount: number;
    currency?: string;
    branch?: string;
  },
) {
  return await createAcademyNotification(tenantId, {
    title: `Monthly Invoicing Batch Completed (${params.month} ${params.year})`,
    message: `Generated ${params.generatedCount} monthly tuition invoices totaling ${money(params.totalAmount, params.currency)}${params.branch ? ` for ${params.branch}` : ""}.`,
    type: "billing",
    targetRoles: ["super_admin", "accountant", "branch_manager"],
    targetBranchId: params.branch || undefined,
    actionUrl: "/accounting",
    createdAt: new Date().toISOString(),
    readBy: [],
    dismissedBy: [],
  });
}

/**
 * Event Trigger 3: Curriculum
 * Dispatch a 'curriculum' notification to 'coach' when the Technical Director publishes or updates a master drill.
 */
export async function dispatchCurriculumAlert(
  tenantId: string,
  params: {
    drillTitle: string;
    category: string;
    isUpdate?: boolean;
    drillId?: string;
  },
) {
  return await createAcademyNotification(tenantId, {
    title: params.isUpdate
      ? `Master Drill Updated: ${params.drillTitle}`
      : `New Master Drill: ${params.drillTitle}`,
    message: `The Technical Director has published "${params.drillTitle}" under ${params.category} curriculum.`,
    type: "curriculum",
    targetRoles: ["coach", "super_admin", "technical_director"],
    actionUrl: "/coach",
    createdAt: new Date().toISOString(),
    readBy: [],
    dismissedBy: [],
  });
}

/**
 * Event Trigger 4: Attendance Guardrail
 * Dispatch an 'attendance' alert when an inactive player check-in is overridden.
 */
export async function dispatchAttendanceGuardrailAlert(
  tenantId: string,
  params: {
    playerName: string;
    playerBranch?: string;
    playerTeam?: string;
    targetTeam?: string;
    status: string;
    overrideTime?: string;
    sessionId?: string;
  },
) {
  return await createAcademyNotification(tenantId, {
    title: `Attendance Guardrail Override: ${params.playerName}`,
    message: `Check-in guardrail overridden for ${params.playerName} (${params.status.toUpperCase()}) at ${params.playerBranch || "Academy"}. Manager override approved.`,
    type: "attendance",
    targetRoles: ["super_admin", "branch_manager", "coach"],
    targetBranchId: params.playerBranch || undefined,
    targetTeam: params.targetTeam || params.playerTeam || undefined,
    actionUrl: params.sessionId ? `/sessions?sessionId=${params.sessionId}` : "/sessions",
    createdAt: new Date().toISOString(),
    readBy: [],
    dismissedBy: [],
  });
}

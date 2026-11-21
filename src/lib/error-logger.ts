import { useState, useEffect, useMemo, useCallback } from "react";
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  writeBatch,
} from "firebase/firestore";
import { toast } from "sonner";
import { db as firestore, auth } from "./firebase";
import { getTenantSlug } from "./utils";
import { recordDiagnosticAndCaptureSentry, setSentryUserContext } from "./sentry-init";

export const SYSTEM_ADMIN_EMAIL = "geogo3@gmail.com";
export const ISSUE_EMAIL_SUBJECT = "technical issue for academy software";

export const isMasterOwner = (email?: string | null): boolean =>
  String(email || "")
    .trim()
    .toLowerCase() === SYSTEM_ADMIN_EMAIL;

export interface SystemErrorLog {
  id: string;
  timestamp: string;
  tenantId: string;
  userEmail: string;
  userRole: string;
  userBranch: string;
  route: string;
  source:
    | "firestore_write"
    | "firestore_listener"
    | "form_submit"
    | "transaction"
    | "auth"
    | "storage"
    | "runtime_error"
    | "unhandled_promise"
    | "user_reported_issue"
    | "auto_error_report";
  operation: string; // e.g. "setEntity(players)", "submitNewGame", "editLedgerTransaction"
  errorMessage: string;
  errorCode?: string;
  stack?: string;
  payloadSummary?: string; // Safe, truncated JSON preview (max 1500 chars) showing any offending fields/types
  deviceInfo: string; // UserAgent / viewport size (Mobile vs Desktop)
  subject?: string;
  to?: string;
  description?: string;
  aiPromptText?: string;
  trigger?: "manual_user_report" | "auto_critical_error";
}

export const FLIGHT_RECORDER_STORAGE_KEY = "vv_error_flight_recorder";
const MAX_LOCAL_LOGS = 100;
const MAX_PAYLOAD_SUMMARY_CHARS = 1500;
const FLIGHT_RECORDER_EVENT = "vv-error-flight-recorder-update";
const AUTO_EMAIL_DEBOUNCE_MS = 60_000;

interface TelemetryUserContext {
  tenantId?: string;
  userEmail?: string;
  userName?: string;
  userRole?: string;
  userBranch?: string;
  notificationServices?: {
    emailEnabled?: boolean;
    emailWebhookUrl?: string;
    emailApiKey?: string;
  };
  onInAppNotificationCreated?: (notif: {
    id: string;
    tenantId: string;
    title: string;
    message: string;
    type: "system";
    targetRoles: (
      "super_admin" | "branch_manager" | "technical_director" | "coach" | "accountant"
    )[];
    targetUserId: string;
    actionUrl: string;
    createdAt: string;
    readBy: string[];
    dismissedBy: string[];
  }) => void;
}

let activeUserContext: TelemetryUserContext = {};
let isLoggingInProgress = false;
let globalTelemetryInitialized = false;
let recentErrorDedupeKey = "";
let recentErrorDedupeTs = 0;
const autoEmailDebounceMap = new Map<string, number>();

export function setErrorLoggerUserContext(ctx: TelemetryUserContext): void {
  activeUserContext = {
    ...activeUserContext,
    ...ctx,
  };
  setSentryUserContext({
    userEmail: activeUserContext.userEmail,
    userName: activeUserContext.userName,
    userRole: activeUserContext.userRole,
    branchId: activeUserContext.userBranch,
    tenantId: activeUserContext.tenantId,
  });
}

function getDeviceInfo(): string {
  if (typeof window === "undefined") return "Server / SSR";
  const w = window.innerWidth || 0;
  const h = window.innerHeight || 0;
  const formFactor = w > 0 && w < 768 ? "Mobile" : w >= 768 && w < 1024 ? "Tablet" : "Desktop";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "Unknown UA";
  return `${formFactor} (${w}x${h}) · ${ua.slice(0, 180)}`;
}

function resolveCurrentRoute(): string {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}`;
}

function resolveUserContext(overrides?: Partial<TelemetryUserContext>): Required<
  Pick<TelemetryUserContext, "tenantId" | "userEmail" | "userRole" | "userBranch">
> & {
  userName: string;
} {
  const tenantId =
    overrides?.tenantId ||
    activeUserContext.tenantId ||
    (typeof window !== "undefined" ? getTenantSlug() : "") ||
    "donbosco";

  let userEmail = overrides?.userEmail || activeUserContext.userEmail || "";
  let userName = overrides?.userName || activeUserContext.userName || "";
  let userRole = overrides?.userRole || activeUserContext.userRole || "";
  let userBranch = overrides?.userBranch || activeUserContext.userBranch || "";

  if (!userEmail && auth?.currentUser?.email) {
    userEmail = auth.currentUser.email;
  }
  if (!userName && auth?.currentUser?.displayName) {
    userName = auth.currentUser.displayName;
  }

  if (typeof window !== "undefined" && (!userEmail || !userRole)) {
    try {
      const pwRaw =
        window.localStorage.getItem(`vv_pw_session_${tenantId}`) ||
        window.localStorage.getItem("vv_pw_session");
      if (pwRaw) {
        const parsed = JSON.parse(pwRaw) as {
          email?: string;
          username?: string;
          name?: string;
          role?: string;
          branch?: string;
        };
        if (!userEmail) userEmail = parsed.email || parsed.username || "";
        if (!userName) userName = parsed.name || "";
        if (!userRole) userRole = parsed.role || "";
        if (!userBranch) userBranch = parsed.branch || "";
      }
    } catch {
      /* ignore storage parse errors */
    }
  }

  if (!userEmail && auth?.currentUser?.uid) {
    userEmail = `uid:${auth.currentUser.uid.slice(0, 10)}`;
  }

  return {
    tenantId: tenantId || "donbosco",
    userEmail: userEmail || "anonymous",
    userName: userName || userEmail || "Academy User",
    userRole: userRole || "Unknown Role",
    userBranch: userBranch || "All",
  };
}

/**
 * Recursively inspects a payload to identify any keys with `undefined`, `NaN`, or non-serializable values.
 */
export function findOffendingPayloadPaths(
  val: unknown,
  prefix = "",
  seen: WeakSet<object> = new WeakSet(),
  acc: string[] = [],
): string[] {
  if (acc.length >= 25) return acc;
  if (val === undefined) {
    acc.push(`${prefix || "<root>"}=undefined`);
    return acc;
  }
  if (typeof val === "number" && Number.isNaN(val)) {
    acc.push(`${prefix || "<root>"}=NaN`);
    return acc;
  }
  if (typeof val === "function" || typeof val === "symbol") {
    acc.push(`${prefix || "<root>"}=${typeof val}`);
    return acc;
  }
  if (!val || typeof val !== "object") return acc;
  if (seen.has(val)) return acc;
  seen.add(val);

  if (Array.isArray(val)) {
    for (let i = 0; i < Math.min(val.length, 50); i++) {
      findOffendingPayloadPaths(val[i], `${prefix}[${i}]`, seen, acc);
      if (acc.length >= 25) break;
    }
    return acc;
  }

  const proto = Object.getPrototypeOf(val);
  if (proto !== null && proto !== Object.prototype) {
    return acc;
  }

  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    const nextPath = prefix ? `${prefix}.${k}` : k;
    findOffendingPayloadPaths(v, nextPath, seen, acc);
    if (acc.length >= 25) break;
  }
  return acc;
}

/**
 * Generates a safe, truncated JSON preview (max 1500 chars) highlighting offending keys.
 */
export function summarizeErrorPayload(payload: unknown, errorMessage?: string): string | undefined {
  if (payload === undefined) return undefined;
  try {
    const offendingPaths = findOffendingPayloadPaths(payload);
    const seen = new WeakSet<object>();
    const jsonPreview = JSON.stringify(payload, (_key, value) => {
      if (value === undefined) return "__UNDEFINED__";
      if (typeof value === "number" && Number.isNaN(value)) return "__NaN__";
      if (typeof value === "function") return `[Function: ${value.name || "anon"}]`;
      if (typeof value === "string" && value.length > 220) {
        return `${value.slice(0, 220)}...[truncated ${value.length} chars]`;
      }
      if (typeof value === "object" && value !== null) {
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
      }
      return value;
    });

    const prefixHeader =
      offendingPaths.length > 0 ||
      (errorMessage && errorMessage.toLowerCase().includes("unsupported field value"))
        ? `[Offending Keys: ${offendingPaths.length > 0 ? offendingPaths.join(", ") : "none detected in top-level"}] `
        : "";

    const combined = `${prefixHeader}${jsonPreview || String(payload)}`;
    return combined.length > MAX_PAYLOAD_SUMMARY_CHARS
      ? `${combined.slice(0, MAX_PAYLOAD_SUMMARY_CHARS - 3)}...`
      : combined;
  } catch (err) {
    const fallback = String(err instanceof Error ? err.message : payload);
    return fallback.slice(0, MAX_PAYLOAD_SUMMARY_CHARS);
  }
}

function extractErrorDetails(error: unknown): {
  errorMessage: string;
  errorCode?: string;
  stack?: string;
} {
  if (!error) {
    return { errorMessage: "Unknown error" };
  }
  if (error instanceof Error) {
    const anyErr = error as Error & { code?: string; customData?: unknown };
    return {
      errorMessage: error.message || error.name || "Error",
      ...(typeof anyErr.code === "string" && anyErr.code ? { errorCode: anyErr.code } : {}),
      ...(typeof error.stack === "string" && error.stack
        ? { stack: error.stack.slice(0, 2000) }
        : {}),
    };
  }
  if (typeof error === "object") {
    const obj = error as Record<string, unknown>;
    const msg =
      typeof obj.message === "string"
        ? obj.message
        : typeof obj.error === "string"
          ? obj.error
          : JSON.stringify(obj).slice(0, 500);
    const code = typeof obj.code === "string" ? obj.code : undefined;
    const stack = typeof obj.stack === "string" ? obj.stack.slice(0, 2000) : undefined;
    return {
      errorMessage: msg || "Object error",
      ...(code ? { errorCode: code } : {}),
      ...(stack ? { stack } : {}),
    };
  }
  return { errorMessage: String(error).slice(0, 1000) };
}

export function getLocalErrorLogs(): SystemErrorLog[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(FLIGHT_RECORDER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SystemErrorLog => {
      if (!item || typeof item !== "object" || typeof item.id !== "string") return false;
      const msg = String(item.errorMessage || "").toLowerCase();
      if (
        item.source === "firestore_listener" &&
        (msg.includes("missing or insufficient permissions") || msg.includes("permission-denied"))
      ) {
        return false;
      }
      return true;
    });
  } catch {
    return [];
  }
}

function saveLocalErrorLog(entry: SystemErrorLog): void {
  if (typeof window === "undefined") return;
  try {
    const existing = getLocalErrorLogs();
    const deduped = existing.filter((e) => e.id !== entry.id);
    const updated = [entry, ...deduped].slice(0, MAX_LOCAL_LOGS);
    window.localStorage.setItem(FLIGHT_RECORDER_STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent(FLIGHT_RECORDER_EVENT));
  } catch {
    /* Never throw from flight recorder localStorage write */
  }
}

function sanitizeLogForFirestore(entry: SystemErrorLog): Record<string, string> {
  const clean: Record<string, string> = {
    id: String(entry.id || ""),
    timestamp: String(entry.timestamp || new Date().toISOString()),
    tenantId: String(entry.tenantId || "donbosco"),
    userEmail: String(entry.userEmail || "anonymous"),
    userRole: String(entry.userRole || "Unknown Role"),
    userBranch: String(entry.userBranch || "All"),
    route: String(entry.route || "/"),
    source: String(entry.source || "runtime_error"),
    operation: String(entry.operation || "unknown"),
    errorMessage: String(entry.errorMessage || "Unknown error").slice(0, 2000),
    deviceInfo: String(entry.deviceInfo || "Unknown Device").slice(0, 400),
  };
  if (entry.errorCode) {
    clean.errorCode = String(entry.errorCode).slice(0, 120);
  }
  if (entry.stack) {
    clean.stack = String(entry.stack).slice(0, 2000);
  }
  if (entry.payloadSummary) {
    clean.payloadSummary = String(entry.payloadSummary).slice(0, MAX_PAYLOAD_SUMMARY_CHARS);
  }
  if (entry.subject) {
    clean.subject = String(entry.subject).slice(0, 200);
  }
  if (entry.to) {
    clean.to = String(entry.to).slice(0, 200);
  }
  if (entry.description) {
    clean.description = String(entry.description).slice(0, 2000);
  }
  if (entry.aiPromptText) {
    clean.aiPromptText = String(entry.aiPromptText).slice(0, 8000);
  }
  if (entry.trigger) {
    clean.trigger = String(entry.trigger);
  }
  return clean;
}

/**
 * Formats selected (or latest N) errors into a clean Markdown diagnostic block ready to paste into AI Studio.
 */
export function formatDiagnosticReportForAI(logs: SystemErrorLog[], maxCount = 20): string {
  const slice = logs.slice(0, maxCount);
  const generatedAt = new Date().toISOString();
  const ctx = resolveUserContext();

  if (slice.length === 0) {
    return [
      "### Vescio Vector — Flight Recorder Diagnostic Report",
      `- **Generated:** ${generatedAt}`,
      `- **Tenant:** \`${ctx.tenantId}\` | **User:** \`${ctx.userEmail}\` (${ctx.userRole})`,
      `- **Status:** 0 errors recorded in Flight Recorder.`,
    ].join("\n");
  }

  const lines: string[] = [
    "### Vescio Vector — Flight Recorder Diagnostic Report",
    `- **Generated:** ${generatedAt}`,
    `- **Active Workspace:** \`${ctx.tenantId}\` | **Viewer:** \`${ctx.userEmail}\` (${ctx.userRole})`,
    `- **Entries Included:** ${slice.length} (of ${logs.length} total captured)`,
    "",
    "| Timestamp | User / Role | Route | Operation | Exact Error | Offending Payload Keys / Summary | First Stack Line |",
    "| :--- | :--- | :--- | :--- | :--- | :--- | :--- |",
  ];

  for (const item of slice) {
    const tsShort = (item.timestamp || "").replace("T", " ").slice(0, 19);
    const userCol = `${item.userEmail} (${item.userRole}${item.userBranch && item.userBranch !== "All" ? ` · ${item.userBranch}` : ""})`;
    const opCol = `[${item.source}] ${item.operation}`;
    const errCol = `${item.errorCode ? `(${item.errorCode}) ` : ""}${item.errorMessage}`
      .replace(/\|/g, "\\|")
      .replace(/\r?\n/g, " ")
      .slice(0, 260);
    const payloadCol = (item.payloadSummary || "—")
      .replace(/\|/g, "\\|")
      .replace(/\r?\n/g, " ")
      .slice(0, 240);
    const firstStackLine = item.stack
      ? (
          item.stack
            .split("\n")
            .map((l) => l.trim())
            .find((l, idx) => idx > 0 && l.startsWith("at ")) ||
          item.stack.split("\n")[0] ||
          "—"
        )
          .replace(/\|/g, "\\|")
          .slice(0, 180)
      : "—";

    lines.push(
      `| \`${tsShort}\` | \`${userCol}\` | \`${item.route}\` | \`${opCol}\` | ${errCol} | \`${payloadCol}\` | \`${firstStackLine}\` |`,
    );
  }

  lines.push("");
  lines.push("#### Detailed Payload & Stack Traces (Latest 5)");
  for (const item of slice.slice(0, 5)) {
    lines.push(
      `- **${item.timestamp}** · \`${item.operation}\` on \`${item.route}\` (\`${item.userEmail}\` / \`${item.userRole}\`)`,
    );
    lines.push(
      `  - **Error:** ${item.errorCode ? `[${item.errorCode}] ` : ""}${item.errorMessage}`,
    );
    if (item.description && item.description !== item.errorMessage) {
      lines.push(`  - **User Description:** ${item.description}`);
    }
    lines.push(`  - **Device:** ${item.deviceInfo}`);
    if (item.payloadSummary) {
      lines.push(`  - **Payload Summary:** \`${item.payloadSummary}\``);
    }
    if (item.stack) {
      lines.push(
        `  - **Stack:** \`${item.stack.split("\n").slice(0, 4).join(" | ").replace(/`/g, "'")}\``,
      );
    }
  }

  return lines.join("\n");
}

/**
 * Builds the exact Ready-to-Paste AI Studio Diagnostic Block.
 */
export function buildAiStudioPromptBlock(
  logs: SystemErrorLog[],
  options?: {
    userEmail?: string;
    userRole?: string;
    userBranch?: string;
    route?: string;
    userNote?: string;
    maxCount?: number;
  },
): string {
  const ctx = resolveUserContext({
    userEmail: options?.userEmail,
    userRole: options?.userRole,
    userBranch: options?.userBranch,
  });
  const userEmail = options?.userEmail || ctx.userEmail;
  const userRole = options?.userRole || ctx.userRole;
  const userBranch = options?.userBranch || ctx.userBranch;
  const route =
    options?.route ||
    (typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "/");
  const userNote = options?.userNote || "Automated system error trigger";
  const formattedAiDiagnosticReport = formatDiagnosticReportForAI(logs, options?.maxCount ?? 20);

  return [
    "=== PASTE THIS BLOCK DIRECTLY INTO AI STUDIO ===",
    "Fix the following production issue reported on Vescio Vector (Don Bosco Academy):",
    `- Reporter: ${userEmail} (${userRole} -${userBranch})`,
    `- Route: ${route}`,
    `- User Description: ${userNote}`,
    "- Captured Error Logs & Offending Payloads:",
    formattedAiDiagnosticReport,
    "================================================",
  ].join("\n");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Dispatches a comprehensive technical issue diagnostic report to `geogo3@gmail.com`
 * with subject `"technical issue for academy software"` across 3 resilient layers:
 * 1) Configured Academy Email Webhook
 * 2) Zero-Config Direct Email Relay (FormSubmit AJAX)
 * 3) Guaranteed Firestore Cloud Persistence (`/tenants/{tenantId}/errorLogs/{reportId}`) + In-App Alert to `geogo3@gmail.com`
 */
export async function sendDiagnosticReportToSystemAdmin(options: {
  trigger: "manual_user_report" | "auto_critical_error";
  userNote?: string;
  currentUser?: { email?: string; name?: string; role?: string; branch?: string };
  tenantId?: string;
  specificError?: SystemErrorLog;
}): Promise<{ success: boolean; reportId: string; aiPromptText: string }> {
  const ctx = resolveUserContext({
    tenantId: options.tenantId,
    userEmail: options.currentUser?.email,
    userName: options.currentUser?.name,
    userRole: options.currentUser?.role,
    userBranch: options.currentUser?.branch,
  });

  const userEmail = options.currentUser?.email || ctx.userEmail;
  const userName = options.currentUser?.name || ctx.userName || userEmail;
  const userRole = options.currentUser?.role || ctx.userRole;
  const userBranch = options.currentUser?.branch || ctx.userBranch;
  const tenantId = options.tenantId || ctx.tenantId || "donbosco";
  const route =
    options.specificError?.route ||
    (typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "/");
  const fullUrl = typeof window !== "undefined" ? window.location.href : route;
  const deviceInfo = options.specificError?.deviceInfo || getDeviceInfo();
  const timestamp = new Date().toISOString();
  const cleanNote = options.userNote?.trim() || "";
  const descriptionText =
    cleanNote ||
    (options.trigger === "manual_user_report"
      ? "User submitted technical issue report"
      : options.specificError?.errorMessage || "Automatic System Error Intercept");

  const localLogs = getLocalErrorLogs();
  const combinedLogs: SystemErrorLog[] = options.specificError
    ? [options.specificError, ...localLogs.filter((l) => l.id !== options.specificError!.id)]
    : localLogs;

  const formattedAiDiagnosticReport = formatDiagnosticReportForAI(combinedLogs, 20);
  const aiPromptText = [
    "=== PASTE THIS BLOCK DIRECTLY INTO AI STUDIO ===",
    "Fix the following production issue reported on Vescio Vector (Don Bosco Academy):",
    `- Reporter: ${userEmail} (${userRole} -${userBranch})`,
    `- Route: ${route}`,
    `- User Description: ${cleanNote || "Automated system error trigger"}`,
    "- Captured Error Logs & Offending Payloads:",
    formattedAiDiagnosticReport,
    "================================================",
  ].join("\n");

  const problemBullets =
    combinedLogs.length > 0
      ? combinedLogs
          .slice(0, 10)
          .map(
            (l, idx) =>
              `${idx + 1}. [${l.timestamp}] (${l.source} · ${l.operation}) on ${l.route}: ${l.errorCode ? `[${l.errorCode}] ` : ""}${l.errorMessage}${l.payloadSummary ? ` | Payload: ${l.payloadSummary.slice(0, 220)}` : ""}`,
          )
          .join("\n")
      : "• No prior exceptions in ring buffer — user submitted live state snapshot.";

  // Section 1 + Section 2 + Section 3 Plain Text Email Body
  const emailBodyText = [
    "============================================================",
    "SECTION 1 — HUMAN SUMMARY",
    "============================================================",
    `Subject: ${ISSUE_EMAIL_SUBJECT}`,
    `To: ${SYSTEM_ADMIN_EMAIL}`,
    `Trigger: ${options.trigger === "manual_user_report" ? "Manual User Issue Report" : "Automatic System Error Intercept"}`,
    `Reporter Name / Email: ${userName} <${userEmail}>`,
    `Role & Branch: ${userRole} (${userBranch})`,
    `Tenant Workspace: ${tenantId}`,
    `Active Route / URL: ${fullUrl}`,
    `Device / Browser: ${deviceInfo}`,
    `Timestamp: ${timestamp}`,
    `Problem Description: ${cleanNote || "Automatic System Error Intercept"}`,
    "",
    "============================================================",
    "SECTION 2 — SUMMARY OF RECORDED PROBLEMS",
    "============================================================",
    problemBullets,
    "",
    "============================================================",
    "SECTION 3 — READY-TO-PASTE AI STUDIO DIAGNOSTIC BLOCK",
    "============================================================",
    aiPromptText,
  ].join("\n");

  // HTML Email Body
  const emailBodyHtml = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace; color: #111827; max-width: 820px; margin: 0 auto; padding: 16px;">
      <h2 style="margin: 0 0 12px; color: #dc2626;">Technical Issue Report — Vescio Vector (${escapeHtml(tenantId)})</h2>
      <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
        <h3 style="margin: 0 0 8px; font-size: 14px;">Section 1: Reporter &amp; Context Summary</h3>
        <p style="margin: 4px 0; font-size: 13px;"><strong>Reporter:</strong> ${escapeHtml(userName)} (${escapeHtml(userEmail)})</p>
        <p style="margin: 4px 0; font-size: 13px;"><strong>Role &amp; Branch:</strong> ${escapeHtml(userRole)} — ${escapeHtml(userBranch)}</p>
        <p style="margin: 4px 0; font-size: 13px;"><strong>Active Route / URL:</strong> ${escapeHtml(fullUrl)}</p>
        <p style="margin: 4px 0; font-size: 13px;"><strong>Device / Browser:</strong> ${escapeHtml(deviceInfo)}</p>
        <p style="margin: 4px 0; font-size: 13px;"><strong>Timestamp:</strong> ${escapeHtml(timestamp)}</p>
        <p style="margin: 4px 0; font-size: 13px;"><strong>Problem Description:</strong> ${escapeHtml(cleanNote || "Automatic System Error Intercept")}</p>
      </div>
      <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
        <h3 style="margin: 0 0 8px; font-size: 14px;">Section 2: Summary of Recorded Problems</h3>
        <pre style="white-space: pre-wrap; word-break: break-word; font-size: 12px; margin: 0;">${escapeHtml(problemBullets)}</pre>
      </div>
      <div style="background: #0f172a; color: #f8fafc; border-radius: 8px; padding: 14px;">
        <h3 style="margin: 0 0 8px; font-size: 14px; color: #38bdf8;">Section 3: Ready-to-Paste AI Studio Diagnostic Block</h3>
        <pre style="white-space: pre-wrap; word-break: break-word; font-size: 12px; margin: 0; color: #f8fafc;">${escapeHtml(aiPromptText)}</pre>
      </div>
    </div>
  `.trim();

  const reportId =
    options.trigger === "auto_critical_error" && options.specificError?.id
      ? options.specificError.id
      : `rep_${Date.now()}_${(crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000).toString(36).slice(2, 8)}`;

  // Layer 1: Configured Academy Email Webhook
  const notifServices = activeUserContext.notificationServices;
  if (notifServices?.emailEnabled && notifServices?.emailWebhookUrl?.trim()) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(notifServices.emailApiKey
          ? {
              Authorization: `Bearer ${notifServices.emailApiKey}`,
              "x-api-key": notifServices.emailApiKey,
            }
          : {}),
      };
      await fetch(notifServices.emailWebhookUrl.trim(), {
        method: "POST",
        headers,
        body: JSON.stringify({
          to: SYSTEM_ADMIN_EMAIL,
          subject: ISSUE_EMAIL_SUBJECT,
          text: emailBodyText,
          html: emailBodyHtml,
        }),
      });
    } catch {
      /* Continue to Layer 2 and Layer 3 */
    }
  }

  // Layer 2: Zero-Config Direct Email Relay to geogo3@gmail.com
  if (typeof fetch !== "undefined") {
    try {
      await fetch(`https://formsubmit.co/ajax/${SYSTEM_ADMIN_EMAIL}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          _subject: ISSUE_EMAIL_SUBJECT,
          _template: "box",
          reporter: userEmail,
          role: userRole,
          route: fullUrl,
          description: cleanNote || "Automated Error Report",
          ai_studio_paste_block: formattedAiDiagnosticReport,
          full_ai_prompt: aiPromptText,
        }),
      });
    } catch {
      /* Silent catch so offline / adblock environments still complete Layer 3 */
    }
  }

  // Layer 3: Guaranteed Firestore Cloud Persistence + In-App Alert to geogo3@gmail.com
  const reportEntry: SystemErrorLog = {
    id: reportId,
    timestamp: options.specificError?.timestamp || timestamp,
    tenantId,
    userEmail,
    userRole,
    userBranch,
    route,
    source:
      options.trigger === "manual_user_report"
        ? "user_reported_issue"
        : options.specificError?.source || "auto_error_report",
    operation:
      options.trigger === "manual_user_report"
        ? "User Reported Issue"
        : options.specificError?.operation || "Auto System Error Report",
    errorMessage:
      options.trigger === "manual_user_report"
        ? cleanNote || "User reported a technical issue"
        : options.specificError?.errorMessage || descriptionText,
    ...(options.specificError?.errorCode ? { errorCode: options.specificError.errorCode } : {}),
    ...(options.specificError?.stack ? { stack: options.specificError.stack } : {}),
    ...(options.specificError?.payloadSummary
      ? { payloadSummary: options.specificError.payloadSummary }
      : {}),
    deviceInfo,
    subject: ISSUE_EMAIL_SUBJECT,
    to: SYSTEM_ADMIN_EMAIL,
    description: descriptionText,
    aiPromptText,
    trigger: options.trigger,
  };

  saveLocalErrorLog(reportEntry);

  if (firestore && tenantId && auth?.currentUser) {
    try {
      const sanitized = sanitizeLogForFirestore(reportEntry);
      await setDoc(doc(firestore, "tenants", tenantId, "errorLogs", reportId), sanitized, {
        merge: true,
      });
    } catch {
      /* Ignore cloud write permission errors */
    }

    // Create an in-app notification in db.notifications targeted exclusively to geogo3@gmail.com
    try {
      const notifId = `notif-issue-${reportId}`;
      const notifPayload = {
        id: notifId,
        tenantId,
        title:
          options.trigger === "manual_user_report"
            ? `📨 Issue Reported by ${userEmail} (${userRole})`
            : `⚡ Auto Error Alert: ${reportEntry.operation}`,
        message: `[${ISSUE_EMAIL_SUBJECT}] ${descriptionText.slice(0, 220)} (Route: ${route})`,
        type: "system" as const,
        targetRoles: ["super_admin" as const],
        targetUserId: SYSTEM_ADMIN_EMAIL,
        actionUrl: "/settings?tab=diagnostics",
        createdAt: timestamp,
        readBy: [] as string[],
        dismissedBy: [] as string[],
      };
      await setDoc(doc(firestore, "tenants", tenantId, "notifications", notifId), notifPayload, {
        merge: true,
      });
      if (activeUserContext.onInAppNotificationCreated) {
        activeUserContext.onInAppNotificationCreated(notifPayload);
      }
    } catch {
      /* Ignore notification write error */
    }
  }

  return {
    success: true,
    reportId,
    aiPromptText,
  };
}

export interface LogSystemErrorInput {
  source: SystemErrorLog["source"];
  operation: string;
  error: unknown;
  payload?: unknown;
  tenantId?: string;
  userEmail?: string;
  userRole?: string;
  userBranch?: string;
  route?: string;
}

/**
 * Records an error in the dual-layer Flight Recorder:
 * 1) Immediate synchronous write to localStorage ring buffer ("vv_error_flight_recorder", max 100 items)
 * 2) Asynchronous non-blocking write to Firestore /tenants/{tenantId}/errorLogs/{logId}
 * 3) Automatic background report to geogo3@gmail.com (debounced to max 1 per 60s per unique error message)
 */
export function logSystemError(input: LogSystemErrorInput): SystemErrorLog | null {
  if (isLoggingInProgress) return null;
  isLoggingInProgress = true;

  try {
    const { errorMessage, errorCode, stack } = extractErrorDetails(input.error);

    // Ignore benign ResizeObserver, aborted fetch noise, or background listener permission checks on unseeded staging collections
    const lowerErr = errorMessage.toLowerCase();
    if (
      errorMessage.includes("ResizeObserver loop") ||
      errorMessage.includes("Failed to fetch dynamically imported module") ||
      (input.source === "firestore_listener" &&
        (lowerErr.includes("missing or insufficient permissions") ||
          lowerErr.includes("permission-denied") ||
          errorCode === "permission-denied"))
    ) {
      return null;
    }

    const nowMs = Date.now();
    const dedupeSignature = `${input.source}:${input.operation}:${errorMessage}`;
    if (dedupeSignature === recentErrorDedupeKey && nowMs - recentErrorDedupeTs < 1500) {
      return null;
    }
    recentErrorDedupeKey = dedupeSignature;
    recentErrorDedupeTs = nowMs;

    const ctx = resolveUserContext({
      tenantId: input.tenantId,
      userEmail: input.userEmail,
      userRole: input.userRole,
      userBranch: input.userBranch,
    });

    const payloadSummary = summarizeErrorPayload(input.payload, errorMessage);
    const id = `err_${nowMs}_${(crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000).toString(36).slice(2, 8)}`;
    const route = input.route || resolveCurrentRoute();

    const logEntry: SystemErrorLog = {
      id,
      timestamp: new Date(nowMs).toISOString(),
      tenantId: ctx.tenantId,
      userEmail: ctx.userEmail,
      userRole: ctx.userRole,
      userBranch: ctx.userBranch,
      route,
      source: input.source,
      operation: input.operation,
      errorMessage,
      ...(errorCode ? { errorCode } : {}),
      ...(stack ? { stack } : {}),
      ...(payloadSummary ? { payloadSummary } : {}),
      deviceInfo: getDeviceInfo(),
      subject: ISSUE_EMAIL_SUBJECT,
      to: SYSTEM_ADMIN_EMAIL,
      description: `Automatic System Error Intercept (${input.source}: ${input.operation})`,
      trigger: "auto_critical_error",
    };

    logEntry.aiPromptText = buildAiStudioPromptBlock([logEntry], {
      userEmail: ctx.userEmail,
      userRole: ctx.userRole,
      userBranch: ctx.userBranch,
      route,
      userNote: `Automatic System Error Intercept (${input.source}: ${input.operation})`,
      maxCount: 1,
    });

    // Layer 0: Sentry SDK captureException + window.__APP_DIAGNOSTICS__ (last 10 in-memory buffer)
    recordDiagnosticAndCaptureSentry(input.error, {
      source: input.source,
      operation: input.operation,
      errorCode,
      payloadSummary,
      userEmail: ctx.userEmail,
      userRole: ctx.userRole,
      branchId: ctx.userBranch,
      tenantId: ctx.tenantId,
      route,
    });

    // Layer 1: Synchronous Local Ring Buffer
    saveLocalErrorLog(logEntry);

    // Layer 2: Asynchronous Cloud Sync to /tenants/{tenantId}/errorLogs/{logId}
    if (firestore && ctx.tenantId && auth?.currentUser) {
      const sanitized = sanitizeLogForFirestore(logEntry);
      const docRef = doc(firestore, "tenants", ctx.tenantId, "errorLogs", id);
      void setDoc(docRef, sanitized).catch(() => {
        /* Silently ignore cloud logging failure so it never recurses */
      });
    }

    // Layer 3: Automatic Background Email & Admin Notification Dispatch (debounced 60s, gated behind explicit opt-in flag in Staging / non-production)
    const isAutoExternalRelayEnabled =
      typeof import.meta !== "undefined" &&
      import.meta.env?.VITE_ENABLE_EXTERNAL_ERROR_EMAIL_RELAY === "true";
    const watchedAutoSources = new Set<SystemErrorLog["source"]>([
      "firestore_write",
      "transaction",
      "runtime_error",
      "unhandled_promise",
    ]);
    if (isAutoExternalRelayEnabled && watchedAutoSources.has(input.source)) {
      const uniqueErrorKey = `${input.source}::${errorMessage.slice(0, 180)}`;
      const lastDispatchedAt = autoEmailDebounceMap.get(uniqueErrorKey) || 0;
      if (nowMs - lastDispatchedAt >= AUTO_EMAIL_DEBOUNCE_MS) {
        autoEmailDebounceMap.set(uniqueErrorKey, nowMs);
        void sendDiagnosticReportToSystemAdmin({
          trigger: "auto_critical_error",
          specificError: logEntry,
          tenantId: ctx.tenantId,
          currentUser: {
            email: ctx.userEmail,
            name: ctx.userName,
            role: ctx.userRole,
            branch: ctx.userBranch,
          },
        }).catch(() => {
          /* Never throw from background auto-report */
        });
      }
    }

    return logEntry;
  } catch {
    return null;
  } finally {
    isLoggingInProgress = false;
  }
}

export async function copyTextToClipboard(
  text: string,
  successToast = "AI Studio Prompt copied! Paste directly into AI Studio.",
): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      toast.success(successToast);
      return true;
    }
  } catch {
    /* fallback below */
  }
  try {
    if (typeof document !== "undefined") {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      toast.success(successToast);
      return true;
    }
  } catch {
    toast.error("Could not copy diagnostic report to clipboard.");
  }
  return false;
}

export async function copyDiagnosticReportToClipboard(
  logs?: SystemErrorLog[],
  maxCount = 20,
): Promise<boolean> {
  const sourceLogs = logs && logs.length > 0 ? logs : getLocalErrorLogs();
  if (sourceLogs.length === 1 && sourceLogs[0]?.aiPromptText) {
    return copyTextToClipboard(
      sourceLogs[0].aiPromptText,
      "AI Studio Prompt copied! Paste directly into AI Studio.",
    );
  }
  const first = sourceLogs[0];
  const reportText = buildAiStudioPromptBlock(sourceLogs, {
    userEmail: first?.userEmail,
    userRole: first?.userRole,
    userBranch: first?.userBranch,
    route: first?.route,
    userNote: first?.description || first?.errorMessage,
    maxCount,
  });
  return copyTextToClipboard(reportText, "AI Studio Prompt copied! Paste directly into AI Studio.");
}

export function exportErrorLogsJson(logs: SystemErrorLog[], tenantId?: string): void {
  if (typeof window === "undefined") return;
  const slug = tenantId || resolveUserContext().tenantId || "donbosco";
  const blob = new Blob([JSON.stringify(logs, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `flight-recorder-${slug}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast.success(`Exported ${logs.length} diagnostic log(s) as JSON.`);
}

export async function clearErrorLogs(tenantId?: string): Promise<void> {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(FLIGHT_RECORDER_STORAGE_KEY);
      window.dispatchEvent(new CustomEvent(FLIGHT_RECORDER_EVENT));
    } catch {
      /* ignore */
    }
  }

  const targetTenant = tenantId || resolveUserContext().tenantId;
  if (firestore && targetTenant && auth?.currentUser) {
    try {
      const colRef = collection(firestore, "tenants", targetTenant, "errorLogs");
      const snap = await getDocs(colRef);
      if (!snap.empty) {
        const docs = snap.docs;
        for (let i = 0; i < docs.length; i += 400) {
          const chunk = docs.slice(i, i + 400);
          const batch = writeBatch(firestore);
          chunk.forEach((d) => batch.delete(d.ref));
          await batch.commit();
        }
      }
    } catch {
      /* ignore if user does not have delete permission on cloud logs */
    }
  }
}

/**
 * Initializes global window error / unhandledrejection listeners and console.error interceptors.
 * Note: Benign user validation toast.error messages are intentionally NOT intercepted as system errors.
 * Safe and idempotent to call once at startup.
 */
export function initGlobalErrorTelemetry(): void {
  if (typeof window === "undefined" || globalTelemetryInitialized) return;
  globalTelemetryInitialized = true;

  const prevOnError = window.onerror;
  window.onerror = (message, source, lineno, colno, error) => {
    logSystemError({
      source: "runtime_error",
      operation: source
        ? `window.onerror (${String(source).split("/").pop()}:${lineno || 0}:${colno || 0})`
        : "window.onerror",
      error: error || message || "Uncaught runtime error",
    });
    if (typeof prevOnError === "function") {
      return prevOnError(message, source, lineno, colno, error);
    }
    return false;
  };

  const prevOnUnhandledRejection = window.onunhandledrejection;
  window.onunhandledrejection = function (event: PromiseRejectionEvent) {
    const reasonStr = String(
      event.reason instanceof Error ? event.reason.message : event.reason || "",
    ).toLowerCase();
    const isFirestoreFailure =
      reasonStr.includes("permission-denied") ||
      reasonStr.includes("missing or insufficient permissions") ||
      reasonStr.includes("invalid-argument") ||
      reasonStr.includes("unsupported field value") ||
      reasonStr.includes("transaction");

    logSystemError({
      source: isFirestoreFailure ? "firestore_write" : "unhandled_promise",
      operation: isFirestoreFailure
        ? "window.onunhandledrejection (Firestore)"
        : "window.onunhandledrejection",
      error: event.reason || "Unhandled promise rejection",
    });
    if (typeof prevOnUnhandledRejection === "function") {
      return prevOnUnhandledRejection.call(window, event);
    }
  };

  window.addEventListener("error", (event: ErrorEvent) => {
    logSystemError({
      source: "runtime_error",
      operation: event.filename
        ? `window.onerror (${event.filename.split("/").pop()}:${event.lineno || 0})`
        : "window.onerror",
      error: event.error || event.message || "Uncaught runtime error",
    });
  });

  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    logSystemError({
      source: "unhandled_promise",
      operation: "window.unhandledrejection",
      error: event.reason || "Unhandled promise rejection",
    });
  });

  // Intercept console.error for watched Firestore / Storage / Call-stack patterns
  const origConsoleError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    origConsoleError(...args);
    if (isLoggingInProgress) return;
    try {
      const joined = args
        .map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : String(a)))
        .join(" ");
      const joinedLower = joined.toLowerCase();
      if (
        joinedLower.includes("firestore listener notice") ||
        joinedLower.includes("graceful empty state active") ||
        joinedLower.includes("uncaught error in snapshot listener")
      ) {
        return;
      }
      const watchedPatterns = [
        "[FirestoreSync]",
        "Firestore sync error",
        "Firestore delete error",
        "Firestore patch error",
        "Failed to save",
        "Failed to delete",
        "Failed to update",
        "Failed to atomically",
        "Unsupported field value",
        "Maximum call stack",
        "storage/",
      ];
      if (watchedPatterns.some((pat) => joinedLower.includes(pat.toLowerCase()))) {
        const errObj = args.find((a) => a instanceof Error) || joined;
        const isStorage = joinedLower.includes("storage");
        const isListener = joinedLower.includes("listener");
        logSystemError({
          source: isStorage ? "storage" : isListener ? "firestore_listener" : "firestore_write",
          operation: String(args[0] || "console.error").slice(0, 120),
          error: errObj,
        });
      }
    } catch {
      /* never fail console.error */
    }
  };
}

/**
 * React hook that merges real-time Firestore `/tenants/{tenantId}/errorLogs` (ordered by timestamp desc)
 * with the local device `localStorage` ring buffer.
 */
export function useSystemErrorLogs(tenantIdOverride?: string) {
  const resolvedTenant = tenantIdOverride || getTenantSlug() || "donbosco";
  const [localLogs, setLocalLogs] = useState<SystemErrorLog[]>([]);
  const [cloudLogs, setCloudLogs] = useState<SystemErrorLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    const syncLocal = () => {
      setLocalLogs(getLocalErrorLogs());
    };
    syncLocal();
    window.addEventListener(FLIGHT_RECORDER_EVENT, syncLocal);
    window.addEventListener("storage", syncLocal);
    return () => {
      window.removeEventListener(FLIGHT_RECORDER_EVENT, syncLocal);
      window.removeEventListener("storage", syncLocal);
    };
  }, []);

  useEffect(() => {
    if (!firestore || !resolvedTenant || !auth?.currentUser) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const colRef = collection(firestore, "tenants", resolvedTenant, "errorLogs");
    const q = query(colRef, orderBy("timestamp", "desc"), limit(150));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const items: SystemErrorLog[] = [];
        snap.docs.forEach((d) => {
          const data = d.data() as Partial<SystemErrorLog>;
          if (
            data &&
            (typeof data.errorMessage === "string" || typeof data.description === "string")
          ) {
            items.push({
              id: data.id || d.id,
              timestamp: data.timestamp || new Date().toISOString(),
              tenantId: data.tenantId || resolvedTenant,
              userEmail: data.userEmail || "anonymous",
              userRole: data.userRole || "Unknown Role",
              userBranch: data.userBranch || "All",
              route: data.route || "/",
              source: data.source || "runtime_error",
              operation: data.operation || "unknown",
              errorMessage: data.errorMessage || data.description || "Issue report",
              ...(data.errorCode ? { errorCode: data.errorCode } : {}),
              ...(data.stack ? { stack: data.stack } : {}),
              ...(data.payloadSummary ? { payloadSummary: data.payloadSummary } : {}),
              ...(data.subject ? { subject: data.subject } : {}),
              ...(data.to ? { to: data.to } : {}),
              ...(data.description ? { description: data.description } : {}),
              ...(data.aiPromptText ? { aiPromptText: data.aiPromptText } : {}),
              ...(data.trigger ? { trigger: data.trigger } : {}),
              deviceInfo: data.deviceInfo || "Unknown Device",
            });
          }
        });
        setCloudLogs(items);
        setLoading(false);
      },
      () => {
        setLoading(false);
      },
    );

    return () => unsub();
  }, [resolvedTenant]);

  const mergedLogs = useMemo(() => {
    const map = new Map<string, SystemErrorLog>();
    for (const item of cloudLogs) {
      map.set(item.id, item);
    }
    for (const item of localLogs) {
      if (!map.has(item.id)) {
        map.set(item.id, item);
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      (b.timestamp || "").localeCompare(a.timestamp || ""),
    );
  }, [cloudLogs, localLogs]);

  const handleClear = useCallback(async () => {
    await clearErrorLogs(resolvedTenant);
    setLocalLogs([]);
    setCloudLogs([]);
    toast.success("Flight recorder error logs cleared.");
  }, [resolvedTenant]);

  const handleCopyForAI = useCallback(
    async (selected?: SystemErrorLog[]) => {
      const target = selected && selected.length > 0 ? selected : mergedLogs;
      await copyDiagnosticReportToClipboard(target, 20);
    },
    [mergedLogs],
  );

  const handleExportJson = useCallback(() => {
    exportErrorLogsJson(mergedLogs, resolvedTenant);
  }, [mergedLogs, resolvedTenant]);

  return {
    logs: mergedLogs,
    localCount: localLogs.length,
    cloudCount: cloudLogs.length,
    loading,
    clearAll: handleClear,
    copyForAI: handleCopyForAI,
    exportJson: handleExportJson,
  };
}

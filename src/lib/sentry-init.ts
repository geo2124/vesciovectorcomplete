import * as Sentry from "@sentry/react";

export const DEFAULT_SENTRY_DSN =
  "https://7ac7f3ac501a6246f9904af68a63bcfb@o4512449553956864.ingest.us.sentry.io/4512449922138112";

export const APP_DIAGNOSTICS_EVENT = "vv-app-diagnostics-update";
export const MAX_APP_DIAGNOSTICS = 10;

export interface AppDiagnosticEntry {
  id: string;
  errorMessage: string;
  errorCode?: string;
  stackTrace: string;
  source: string;
  operation: string;
  payloadSummary?: string;
  userState: {
    userEmail: string;
    userRole: string;
    branchId: string;
    tenantId: string;
    route: string;
  };
  timestamp: string;
}

declare global {
  interface Window {
    __APP_DIAGNOSTICS__?: AppDiagnosticEntry[];
  }
}

let sentryInitialized = false;
let lastCapturedSignature = "";
let lastCapturedTimestamp = 0;

export function cleanupStaleServiceWorkersInPreview(): void {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const host = window.location.hostname || "";
    const isPreviewOrDev =
      import.meta.env.DEV ||
      host.includes("run.app") ||
      host === "localhost" ||
      host === "127.0.0.1";
    if (!isPreviewOrDev) return;

    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => {
        for (const reg of regs) {
          try {
            reg.unregister().catch(() => false);
          } catch {
            /* Ignore individual unregister errors */
          }
        }
      })
      .catch(() => {
        /* Ignore getRegistrations errors */
      });
  } catch {
    /* Fail-safe */
  }
}

export function initSentryMonitoring(): void {
  if (typeof window === "undefined") return;

  cleanupStaleServiceWorkersInPreview();

  if (!Array.isArray(window.__APP_DIAGNOSTICS__)) {
    window.__APP_DIAGNOSTICS__ = [];
  }

  if (sentryInitialized) return;
  sentryInitialized = true;

  try {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN || DEFAULT_SENTRY_DSN,
      ignoreErrors: [
        /Failed to update a ServiceWorker/i,
        /Failed to register a ServiceWorker/i,
        /The script has an unsupported MIME type \('text\/html'\)/i,
      ],
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({
          maskAllText: false,
          blockAllMedia: false,
        }),
      ],
      tracesSampleRate: 1.0,
      replaysSessionSampleRate: 0.0,
      replaysOnErrorSampleRate: 1.0,
    });
  } catch {
    /* Fail-safe so Sentry init never blocks application boot */
  }
}

// Initialize immediately on module load in browser environments
if (typeof window !== "undefined") {
  initSentryMonitoring();
}

export function setSentryUserContext(context: {
  userEmail?: string;
  userName?: string;
  userRole?: string;
  branchId?: string;
  tenantId?: string;
}): void {
  if (typeof window === "undefined") return;
  try {
    Sentry.setUser(
      context.userEmail
        ? {
            email: context.userEmail,
            username: context.userName || context.userEmail,
          }
        : null,
    );
    Sentry.setTags({
      userRole: context.userRole || "Unknown Role",
      branchId: context.branchId || "All",
      tenantId: context.tenantId || "donbosco",
    });
  } catch {
    /* Ignore Sentry context errors */
  }
}

export function getAppDiagnostics(): AppDiagnosticEntry[] {
  if (typeof window === "undefined") return [];
  if (!Array.isArray(window.__APP_DIAGNOSTICS__)) {
    window.__APP_DIAGNOSTICS__ = [];
  }
  return window.__APP_DIAGNOSTICS__;
}

export function clearAppDiagnostics(): void {
  if (typeof window === "undefined") return;
  window.__APP_DIAGNOSTICS__ = [];
  window.dispatchEvent(new CustomEvent(APP_DIAGNOSTICS_EVENT));
}

export function recordDiagnosticAndCaptureSentry(
  rawError: unknown,
  context: {
    source?: string;
    operation?: string;
    errorCode?: string;
    payloadSummary?: string;
    userEmail?: string;
    userRole?: string;
    branchId?: string;
    tenantId?: string;
    route?: string;
    skipDedupe?: boolean;
  },
): AppDiagnosticEntry | null {
  if (typeof window === "undefined") return null;
  initSentryMonitoring();

  const errorObj =
    rawError instanceof Error
      ? rawError
      : new Error(
          typeof rawError === "string"
            ? rawError
            : rawError && typeof rawError === "object" && "message" in rawError
              ? String((rawError as { message?: unknown }).message)
              : JSON.stringify(rawError) || "Unknown Application Error",
        );

  const errorMessage = errorObj.message || "Unknown Application Error";
  const stackTrace =
    errorObj.stack ||
    (rawError && typeof rawError === "object" && "stack" in rawError
      ? String((rawError as { stack?: unknown }).stack || "")
      : "") ||
    new Error(errorMessage).stack ||
    "No stack trace available";

  const nowMs = Date.now();
  const signature = `${context.source || "runtime"}:${context.operation || "op"}:${errorMessage}`;
  if (
    !context.skipDedupe &&
    signature === lastCapturedSignature &&
    nowMs - lastCapturedTimestamp < 1200
  ) {
    return null;
  }
  lastCapturedSignature = signature;
  lastCapturedTimestamp = nowMs;

  const userState = {
    userEmail: context.userEmail || "anonymous",
    userRole: context.userRole || "Unknown Role",
    branchId: context.branchId || "All",
    tenantId: context.tenantId || "donbosco",
    route: context.route || `${window.location.pathname}${window.location.search}`,
  };

  const entry: AppDiagnosticEntry = {
    id: `diag_${nowMs}_${(crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000).toString(36).slice(2, 7)}`,
    errorMessage,
    ...(context.errorCode ? { errorCode: context.errorCode } : {}),
    stackTrace: stackTrace.slice(0, 3000),
    source: context.source || "runtime_error",
    operation: context.operation || "unhandled",
    ...(context.payloadSummary ? { payloadSummary: context.payloadSummary } : {}),
    userState,
    timestamp: new Date(nowMs).toISOString(),
  };

  try {
    Sentry.captureException(errorObj, {
      extra: {
        ...context,
        userRole: userState.userRole,
        branchId: userState.branchId,
        userEmail: userState.userEmail,
        tenantId: userState.tenantId,
        route: userState.route,
        timestamp: entry.timestamp,
      },
    });
  } catch {
    /* Never fail if Sentry capture throws */
  }

  const existing = Array.isArray(window.__APP_DIAGNOSTICS__) ? window.__APP_DIAGNOSTICS__ : [];
  window.__APP_DIAGNOSTICS__ = [entry, ...existing].slice(0, MAX_APP_DIAGNOSTICS);
  window.dispatchEvent(new CustomEvent(APP_DIAGNOSTICS_EVENT));

  return entry;
}

export function triggerSentryVerificationError(userState?: {
  userEmail?: string;
  userRole?: string;
  branchId?: string;
  tenantId?: string;
  route?: string;
}): AppDiagnosticEntry | null {
  const testErr = new Error("Vescio Vector Sentry Connection Verified");
  return recordDiagnosticAndCaptureSentry(testErr, {
    source: "sentry_verification",
    operation: "Sentry.captureException(Verification)",
    userEmail: userState?.userEmail,
    userRole: userState?.userRole,
    branchId: userState?.branchId,
    tenantId: userState?.tenantId,
    route: userState?.route,
    skipDedupe: true,
  });
}

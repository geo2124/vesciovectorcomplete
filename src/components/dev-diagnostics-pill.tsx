import { useState, useEffect } from "react";
import { AlertTriangle, Bug, Check, Copy, Send, Trash2, X, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import {
  APP_DIAGNOSTICS_EVENT,
  clearAppDiagnostics,
  getAppDiagnostics,
  triggerSentryVerificationError,
  type AppDiagnosticEntry,
} from "@/lib/sentry-init";
import { copyTextToClipboard } from "@/lib/error-logger";
import { useAuth } from "@/lib/auth";
import { getTenantSlug } from "@/lib/utils";

export function DevDiagnosticsPill() {
  const [entries, setEntries] = useState<AppDiagnosticEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sentTest, setSentTest] = useState(false);

  const authCtx = useAuth();

  useEffect(() => {
    const syncDiagnostics = () => {
      setEntries([...getAppDiagnostics()]);
    };
    syncDiagnostics();
    window.addEventListener(APP_DIAGNOSTICS_EVENT, syncDiagnostics);
    return () => {
      window.removeEventListener(APP_DIAGNOSTICS_EVENT, syncDiagnostics);
    };
  }, []);

  const errorCount = entries.length;

  const buildAiFixPayloadJson = (targetEntries: AppDiagnosticEntry[]) => {
    const currentRoute =
      typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "/";
    const payload = {
      application: "Vescio Vector Basketball Academy ERP",
      exportedAt: new Date().toISOString(),
      sentryReplayOnErrorSampleRate: 1.0,
      userState: {
        userEmail: authCtx?.user?.email || targetEntries[0]?.userState.userEmail || "anonymous",
        userRole: authCtx?.userRole || targetEntries[0]?.userState.userRole || "SUPER_ADMIN",
        branchId: authCtx?.userBranch || targetEntries[0]?.userState.branchId || "All",
        tenantId: getTenantSlug() || targetEntries[0]?.userState.tenantId || "donbosco",
        route: currentRoute,
      },
      diagnosticsCount: targetEntries.length,
      errors: targetEntries.map((item) => ({
        id: item.id,
        errorMessage: item.errorMessage,
        errorCode: item.errorCode || null,
        source: item.source,
        operation: item.operation,
        stackTrace: item.stackTrace,
        payloadSummary: item.payloadSummary || null,
        userState: item.userState,
        timestamp: item.timestamp,
      })),
    };
    return JSON.stringify(payload, null, 2);
  };

  const handleCopyPayload = async (specificEntry?: AppDiagnosticEntry) => {
    const target = specificEntry ? [specificEntry] : entries;
    const jsonString = buildAiFixPayloadJson(target);
    const ok = await copyTextToClipboard(jsonString, "AI Fix Payload JSON copied to clipboard!");
    if (ok) {
      const key = specificEntry ? specificEntry.id : "all";
      setCopiedId(key);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const handleSendTestError = () => {
    const currentRoute =
      typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}` : "/";
    triggerSentryVerificationError({
      userEmail: authCtx?.user?.email || "geogo3@gmail.com",
      userRole: authCtx?.userRole || "super_admin",
      branchId: authCtx?.userBranch || "All",
      tenantId: getTenantSlug() || "donbosco",
      route: currentRoute,
    });
    setSentTest(true);
    toast.success("Test exception dispatched to Sentry & recorded in __APP_DIAGNOSTICS__.");
    setTimeout(() => setSentTest(false), 2500);
  };

  return (
    <>
      {/* Bottom-right Floating Dev Diagnostics Badge (avoids bottom-left sidebar footer overlap) */}
      <div className="fixed bottom-16 right-4 lg:bottom-4 lg:right-4 z-40 flex items-center gap-2">
        {errorCount > 0 ? (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="group flex items-center gap-2 rounded-full border border-red-500/60 bg-red-600/95 px-3 py-1.5 text-xs font-semibold text-white shadow-lg shadow-red-950/50 backdrop-blur-md transition-all hover:bg-red-500"
            title="Open Dev Diagnostics & Sentry Monitor"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-200 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
            </span>
            <AlertTriangle className="h-3.5 w-3.5" />
            <span>
              {errorCount} {errorCount === 1 ? "Diagnostic Error" : "Diagnostic Errors"}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex items-center gap-1.5 rounded-full border border-border/70 bg-background/85 px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm backdrop-blur-md transition-colors hover:border-primary/50 hover:text-foreground"
            title="Dev Diagnostics & Sentry Verification"
          >
            <Bug className="h-3 w-3 text-emerald-500" />
            <span>Dev Diagnostics</span>
          </button>
        )}
      </div>

      {/* Diagnostics Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-xs">
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border bg-muted/40 px-5 py-3.5">
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-red-500/15 text-red-500">
                  <ShieldAlert className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold tracking-tight text-foreground">
                    Dev Diagnostics &amp; Sentry Error Catcher
                  </h2>
                  <p className="text-[11px] text-muted-foreground">
                    window.__APP_DIAGNOSTICS__ ({errorCount}/10 buffered) · Replay on Error: 100%
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Close Diagnostics Modal"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background/60 px-5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleCopyPayload()}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary/90"
                >
                  {copiedId === "all" ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      <span>Copied AI Fix Payload!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copy AI Fix Payload</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleSendTestError}
                  className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-400 transition-colors hover:bg-emerald-500/20"
                >
                  {sentTest ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      <span>Sent to Sentry!</span>
                    </>
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5" />
                      <span>Send Test Error to Sentry</span>
                    </>
                  )}
                </button>
              </div>

              {errorCount > 0 && (
                <button
                  type="button"
                  onClick={() => clearAppDiagnostics()}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Clear ({errorCount})</span>
                </button>
              )}
            </div>

            {/* Error Entries List */}
            <div className="flex-1 space-y-3 overflow-y-auto p-5">
              {errorCount === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center">
                  <Bug className="mx-auto h-8 w-8 text-emerald-500/80" />
                  <p className="mt-2 text-sm font-medium text-foreground">
                    Zero unhandled errors in window.__APP_DIAGNOSTICS__
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Click &ldquo;Send Test Error to Sentry&rdquo; above to verify your Sentry DSN
                    pipeline and inspect the AI Fix Payload format.
                  </p>
                </div>
              ) : (
                entries.map((entry, idx) => (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-border bg-muted/20 p-3.5 text-xs"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="rounded bg-red-500/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-red-400">
                            #{idx + 1} · {entry.source}
                          </span>
                          <span className="font-mono text-[11px] font-semibold text-foreground">
                            {entry.operation}
                          </span>
                          {entry.errorCode && (
                            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[10px] text-amber-400">
                              {entry.errorCode}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {entry.timestamp} · Role:{" "}
                          <strong className="text-foreground">{entry.userState.userRole}</strong> ·
                          Branch:{" "}
                          <strong className="text-foreground">{entry.userState.branchId}</strong> ·
                          Route: <code className="text-foreground">{entry.userState.route}</code>
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleCopyPayload(entry)}
                        className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
                      >
                        {copiedId === entry.id ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-500" />
                            <span>Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            <span>Copy JSON</span>
                          </>
                        )}
                      </button>
                    </div>

                    <p className="mt-2 font-mono text-xs font-medium text-red-400">
                      {entry.errorMessage}
                    </p>

                    {entry.payloadSummary && (
                      <div className="mt-2 rounded bg-background/80 p-2 font-mono text-[11px] text-amber-300">
                        Payload: {entry.payloadSummary}
                      </div>
                    )}

                    {entry.stackTrace && (
                      <pre className="mt-2 max-h-32 overflow-x-auto overflow-y-auto rounded bg-black/50 p-2 font-mono text-[10px] leading-relaxed text-slate-300">
                        {entry.stackTrace}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

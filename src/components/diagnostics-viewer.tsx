import React, { useState, useMemo } from "react";
import {
  Button,
  Chip,
  EmptyState,
  Field,
  Input,
  Panel,
  Row,
  Select,
  Stat,
  Table,
  Td,
  Th,
} from "@/components/kit";
import {
  useSystemErrorLogs,
  type SystemErrorLog,
  copyDiagnosticReportToClipboard,
  buildAiStudioPromptBlock,
  copyTextToClipboard,
} from "@/lib/error-logger";
import { Copy, Download, Trash2, ChevronDown, ChevronRight, ShieldAlert } from "lucide-react";

const SOURCE_OPTIONS = [
  "All Sources",
  "user_reported_issue",
  "auto_error_report",
  "firestore_write",
  "firestore_listener",
  "form_submit",
  "transaction",
  "auth",
  "storage",
  "runtime_error",
  "unhandled_promise",
];

function getSourceTone(source: SystemErrorLog["source"]): "warn" | "accent" | "neutral" | "good" {
  if (source === "user_reported_issue") {
    return "accent";
  }
  if (
    source === "firestore_write" ||
    source === "transaction" ||
    source === "runtime_error" ||
    source === "unhandled_promise" ||
    source === "auto_error_report"
  ) {
    return "warn";
  }
  if (source === "auth" || source === "storage") {
    return "accent";
  }
  return "neutral";
}

function isUserReported(log: SystemErrorLog): boolean {
  return log.source === "user_reported_issue" || log.trigger === "manual_user_report";
}

export function DiagnosticsErrorLogsViewer({ tenantId }: { tenantId?: string }) {
  const { logs, localCount, cloudCount, loading, clearAll, copyForAI, exportJson } =
    useSystemErrorLogs(tenantId);

  const [searchQuery, setSearchQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState("All Sources");
  const [roleFilter, setRoleFilter] = useState("All Roles");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isClearing, setIsClearing] = useState(false);

  const availableRoles = useMemo(() => {
    const roles = new Set<string>();
    for (const l of logs) {
      if (l.userRole) roles.add(l.userRole);
    }
    return ["All Roles", ...Array.from(roles)];
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return logs.filter((item) => {
      if (sourceFilter !== "All Sources") {
        if (sourceFilter === "auto_error_report") {
          if (isUserReported(item)) return false;
        } else if (item.source !== sourceFilter) {
          return false;
        }
      }
      if (roleFilter !== "All Roles" && item.userRole !== roleFilter) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        item.userEmail,
        item.userRole,
        item.userBranch,
        item.route,
        item.source,
        item.operation,
        item.errorMessage,
        item.description,
        item.errorCode,
        item.payloadSummary,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [logs, searchQuery, sourceFilter, roleFilter]);

  const selectedLogs = useMemo(
    () => filteredLogs.filter((l) => selectedIds.has(l.id)),
    [filteredLogs, selectedIds],
  );

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredLogs.length && filteredLogs.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredLogs.map((l) => l.id)));
    }
  };

  const handleClearLogs = async () => {
    setIsClearing(true);
    try {
      await clearAll();
      setSelectedIds(new Set());
      setExpandedIds(new Set());
    } finally {
      setIsClearing(false);
    }
  };

  const handleCopySinglePrompt = async (log: SystemErrorLog) => {
    const promptText =
      log.aiPromptText ||
      buildAiStudioPromptBlock([log], {
        userEmail: log.userEmail,
        userRole: log.userRole,
        userBranch: log.userBranch,
        route: log.route,
        userNote: log.description || log.errorMessage,
        maxCount: 1,
      });
    await copyTextToClipboard(
      promptText,
      "AI Studio Prompt copied! Paste directly into AI Studio.",
    );
  };

  const userReportedCount = useMemo(() => logs.filter((l) => isUserReported(l)).length, [logs]);

  const firestoreWriteErrors = useMemo(
    () => logs.filter((l) => l.source === "firestore_write" || l.source === "transaction").length,
    [logs],
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Total Captured"
          value={String(logs.length)}
          note={`${cloudCount} cloud · ${localCount} local buffer`}
          accent
        />
        <Stat
          label="User Reported Issues"
          value={String(userReportedCount)}
          note="manual reports to geogo3@gmail.com"
        />
        <Stat
          label="Firestore & Tx Errors"
          value={String(firestoreWriteErrors)}
          note="write / batch / ledger ops"
        />
        <Stat
          label="Filtered View"
          value={String(filteredLogs.length)}
          note={
            selectedIds.size > 0
              ? `${selectedIds.size} selected for AI prompt`
              : "latest 20 copied by default"
          }
        />
      </div>

      <Panel
        title="System Diagnostics & Error Logs (Flight Recorder)"
        meta={
          loading
            ? "Syncing live telemetry..."
            : `${filteredLogs.length} events · Live cross-device feed + local ring buffer`
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() =>
                void copyForAI(selectedLogs.length > 0 ? selectedLogs : filteredLogs.slice(0, 20))
              }
            >
              <span className="inline-flex items-center gap-1.5">
                <Copy className="h-3.5 w-3.5" />
                <span>
                  {selectedIds.size > 0
                    ? `Copy AI Prompt Block (${selectedLogs.length})`
                    : "Copy AI Prompt Block"}
                </span>
              </span>
            </Button>
            <Button variant="ghost" onClick={exportJson}>
              <span className="inline-flex items-center gap-1.5">
                <Download className="h-3.5 w-3.5" />
                <span>Export JSON</span>
              </span>
            </Button>
            <Button
              variant="ghost"
              disabled={isClearing || logs.length === 0}
              onClick={() => void handleClearLogs()}
            >
              <span className="inline-flex items-center gap-1.5 text-red-400">
                <Trash2 className="h-3.5 w-3.5" />
                <span>{isClearing ? "Clearing..." : "Clear Logs"}</span>
              </span>
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 border-b border-ink-800 p-4 sm:grid-cols-3">
          <Field label="Search Error / Operation / User / Key">
            <Input
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Filter by message, route, email, or undefined key..."
            />
          </Field>
          <Field label="Source">
            <Select value={sourceFilter} onChange={setSourceFilter} options={SOURCE_OPTIONS} />
          </Field>
          <Field label="User Role">
            <Select value={roleFilter} onChange={setRoleFilter} options={availableRoles} />
          </Field>
        </div>

        {filteredLogs.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No diagnostic errors recorded"
              note="The Global Flight Recorder is actively monitoring all user reports, Firestore writes, transactions, listeners, storage uploads, and runtime promises across devices."
            />
          </div>
        ) : (
          <Table
            head={
              <>
                <Th>
                  <input
                    type="checkbox"
                    checked={selectedIds.size === filteredLogs.length && filteredLogs.length > 0}
                    onChange={toggleSelectAll}
                    className="accent-court-500 cursor-pointer"
                    aria-label="Select all logs"
                  />
                </Th>
                <Th>TIME</Th>
                <Th>USER & ROLE</Th>
                <Th hide>ROUTE</Th>
                <Th>TYPE / SOURCE</Th>
                <Th>DESCRIPTION & ERROR MESSAGE</Th>
                <Th>
                  <span className="block text-right">ACTIONS</span>
                </Th>
              </>
            }
            footer={`SHOWING ${filteredLogs.length} OF ${logs.length} CAPTURED EVENTS`}
          >
            {filteredLogs.map((log) => {
              const isExpanded = expandedIds.has(log.id);
              const isSelected = selectedIds.has(log.id);
              const formattedTime = (log.timestamp || "").replace("T", " ").slice(0, 19);
              const userReported = isUserReported(log);
              return (
                <React.Fragment key={log.id}>
                  <Row>
                    <Td>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(log.id)}
                        className="accent-court-500 cursor-pointer"
                        aria-label={`Select log ${log.id}`}
                      />
                    </Td>
                    <Td>
                      <span className="font-mono text-[11px] text-ink-300">{formattedTime}</span>
                      <div className="font-mono text-[9px] text-ink-500 truncate max-w-[140px]">
                        {log.deviceInfo.split("·")[0]?.trim() || "Device"}
                      </div>
                    </Td>
                    <Td strong>
                      <div className="text-xs text-ink-100">{log.userEmail}</div>
                      <div className="font-mono text-[10px] text-court-400">
                        {log.userRole}
                        {log.userBranch && log.userBranch !== "All" ? ` · ${log.userBranch}` : ""}
                      </div>
                    </Td>
                    <Td hide>
                      <span className="font-mono text-xs text-ink-300">{log.route}</span>
                    </Td>
                    <Td>
                      <div className="flex flex-col gap-1 items-start">
                        <span
                          className={`inline-flex items-center gap-1 rounded px-2 py-0.5 font-mono text-[10px] font-semibold ${
                            userReported
                              ? "bg-court-500/20 text-court-300 ring-1 ring-court-500/40"
                              : "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30"
                          }`}
                        >
                          {userReported ? "📨 User Reported Issue" : "⚡ Auto-Captured Error"}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <Chip tone={getSourceTone(log.source)}>{log.source}</Chip>
                          <span className="font-mono text-[11px] text-ink-200">
                            {log.operation}
                          </span>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <div className="max-w-md space-y-1">
                        {log.description && (
                          <div className="text-xs font-semibold text-ink-100 break-words">
                            {userReported ? "User Description: " : ""}
                            {log.description}
                          </div>
                        )}
                        <div className="text-xs font-medium text-red-300 break-words">
                          {log.errorCode ? (
                            <span className="mr-1.5 rounded bg-red-500/20 px-1.5 py-0.5 font-mono text-[10px] text-red-300">
                              {log.errorCode}
                            </span>
                          ) : null}
                          {log.errorMessage}
                        </div>
                        {log.payloadSummary && (
                          <div className="mt-1 truncate font-mono text-[10px] text-amber-300/90 max-w-sm">
                            {log.payloadSummary}
                          </div>
                        )}
                      </div>
                    </Td>
                    <Td right>
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => void handleCopySinglePrompt(log)}
                          className="inline-flex items-center gap-1 rounded bg-court-500/15 px-2.5 py-1 font-mono text-[10px] font-semibold text-court-300 ring-1 ring-court-500/30 hover:bg-court-500/25 hover:text-court-200"
                          title="Copy ready-to-paste AI Studio prompt block for this entry"
                        >
                          <Copy className="h-3 w-3" />
                          <span>Copy AI Studio Prompt</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleExpand(log.id)}
                          className="inline-flex items-center gap-1 rounded bg-ink-850 px-2 py-1 font-mono text-[10px] text-court-400 ring-1 ring-ink-700 hover:bg-ink-800"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                          <span>{isExpanded ? "Hide" : "Trace"}</span>
                        </button>
                      </div>
                    </Td>
                  </Row>
                  {isExpanded && (
                    <tr className="bg-ink-950/90 border-b border-ink-800">
                      <td colSpan={7} className="p-4">
                        <div className="space-y-3 rounded-lg border border-ink-800 bg-ink-900/80 p-3.5 font-mono text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-800 pb-2">
                            <div className="flex items-center gap-2 text-ink-200">
                              <ShieldAlert className="h-4 w-4 text-amber-400" />
                              <span className="font-semibold">Event ID: {log.id}</span>
                              <span className="text-ink-400">·</span>
                              <span className="text-ink-300">Route: {log.route}</span>
                              {log.to && (
                                <>
                                  <span className="text-ink-400">·</span>
                                  <span className="text-court-400">Dispatched to: {log.to}</span>
                                </>
                              )}
                            </div>
                            <span className="text-[10px] text-ink-400">{log.deviceInfo}</span>
                          </div>

                          {log.description && (
                            <div>
                              <div className="mb-1 text-[10px] uppercase tracking-wider text-court-400">
                                Problem Description
                              </div>
                              <div className="rounded bg-ink-950 p-2.5 text-[11px] text-ink-100 ring-1 ring-ink-800">
                                {log.description}
                              </div>
                            </div>
                          )}

                          {log.payloadSummary && (
                            <div>
                              <div className="mb-1 text-[10px] uppercase tracking-wider text-amber-400">
                                Payload & Offending Field Summary
                              </div>
                              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-ink-950 p-2.5 text-[11px] text-ink-200 ring-1 ring-ink-800">
                                {log.payloadSummary}
                              </pre>
                            </div>
                          )}

                          {log.stack && (
                            <div>
                              <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-400">
                                Stack Trace
                              </div>
                              <pre className="max-h-56 overflow-y-auto overflow-x-auto whitespace-pre-wrap break-all rounded bg-ink-950 p-2.5 text-[10px] text-ink-400 ring-1 ring-ink-800">
                                {log.stack}
                              </pre>
                            </div>
                          )}

                          {log.aiPromptText && (
                            <div>
                              <div className="mb-1 flex items-center justify-between">
                                <span className="text-[10px] uppercase tracking-wider text-court-400">
                                  Ready-to-Paste AI Studio Prompt Block
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void handleCopySinglePrompt(log)}
                                  className="inline-flex items-center gap-1 rounded bg-court-500/20 px-2 py-0.5 text-[10px] font-semibold text-court-300 hover:bg-court-500/30"
                                >
                                  <Copy className="h-3 w-3" />
                                  <span>Copy AI Studio Prompt</span>
                                </button>
                              </div>
                              <pre className="max-h-60 overflow-y-auto overflow-x-auto whitespace-pre-wrap break-all rounded bg-ink-950 p-2.5 text-[10px] text-ink-200 ring-1 ring-ink-800">
                                {log.aiPromptText}
                              </pre>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </Table>
        )}
      </Panel>
    </div>
  );
}

export { DiagnosticsErrorLogsViewer as DiagnosticsViewer };

import { useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Bell,
  Check,
  CheckCheck,
  Clock,
  Package,
  DollarSign,
  BookOpen,
  UserCheck,
  Shield,
  X,
  ArrowUpRight,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAcademyNotifications, type AcademyNotification } from "@/lib/notifications";
import { useDB } from "@/lib/data-store";

function formatTimestamp(isoString: string): string {
  try {
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return "Recently";
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHr / 24);

    if (diffMin < 1) return "Just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "Recently";
  }
}

function getNotificationVisuals(type: AcademyNotification["type"]) {
  switch (type) {
    case "inventory":
      return {
        icon: Package,
        color: "text-amber-400 bg-amber-500/10 border-amber-500/30",
        badge: "INVENTORY",
        badgeTone: "bg-amber-500/15 text-amber-300 border-amber-500/30",
      };
    case "billing":
      return {
        icon: DollarSign,
        color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30",
        badge: "BILLING",
        badgeTone: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
      };
    case "curriculum":
      return {
        icon: BookOpen,
        color: "text-court-400 bg-court-500/10 border-court-500/30",
        badge: "CURRICULUM",
        badgeTone: "bg-court-500/15 text-court-300 border-court-500/30",
      };
    case "attendance":
      return {
        icon: UserCheck,
        color: "text-cyan-400 bg-cyan-500/10 border-cyan-500/30",
        badge: "ATTENDANCE",
        badgeTone: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
      };
    case "system":
    default:
      return {
        icon: Shield,
        color: "text-purple-400 bg-purple-500/10 border-purple-500/30",
        badge: "SYSTEM",
        badgeTone: "bg-purple-500/15 text-purple-300 border-purple-500/30",
      };
  }
}

export function NotificationCenter() {
  const navigate = useNavigate();
  const { movePlayerToCrmFollowUp } = useDB();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  useEffect(() => {
    setMounted(true);
  }, []);

  const {
    notifications,
    unreadCount,
    currentRole,
    userRoleName,
    userBranch,
    isNotificationRead,
    resolveActionUrl,
    markAsRead,
    markAllAsRead,
    dismiss,
    dismissAll,
  } = useAcademyNotifications();

  const displayedNotifications =
    filter === "unread" ? notifications.filter((n) => !isNotificationRead(n)) : notifications;

  const handleNotificationClick = async (notif: AcademyNotification) => {
    // 1. Mark as read atomically in Firestore
    await markAsRead(notif.id);

    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("vv:notification-clicked", { detail: notif }));
    }

    // 2. Role-safe deep link navigation if actionUrl is permitted for this role
    const safeUrl = resolveActionUrl(notif.actionUrl);
    if (safeUrl) {
      setOpen(false);
      navigate({ to: safeUrl });
    }
  };

  const handleDismiss = async (e: React.MouseEvent, notifId: string) => {
    e.stopPropagation();
    await dismiss(notifId);
  };

  const formatRoleLabel = (r: string) => {
    return (userRoleName || r).replace(/_/g, " ").toUpperCase();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Notification Center"
          title={mounted ? `Notifications (${unreadCount} unread)` : "Notifications"}
          className="relative flex h-9 w-9 items-center justify-center rounded-md bg-ink-850 text-ink-300 ring-1 ring-ink-700 hover:bg-ink-800 hover:text-ink-100 hover:ring-court-500/50 transition-all focus:outline-none focus:ring-2 focus:ring-court-500/60"
        >
          <Bell className="h-4 w-4 transition-transform active:scale-95" />
          {mounted && unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-court-500 text-[10px] font-bold text-white shadow-sm ring-2 ring-ink-950 animate-in zoom-in-50 duration-200">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 sm:w-96 p-0 overflow-hidden border border-ink-800 bg-ink-950/95 shadow-2xl backdrop-blur-xl rounded-xl ring-1 ring-white/10"
      >
        {/* Header */}
        <div className="border-b border-ink-800/80 bg-ink-900/90 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-display font-semibold text-sm text-ink-100 tracking-tight">
                Notifications
              </span>
              <span className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-court-300 border border-ink-700 uppercase">
                {formatRoleLabel(currentRole)}
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllAsRead}
                  className="flex items-center gap-1 text-[11px] font-medium text-court-400 hover:text-court-300 hover:underline transition-colors"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  Mark all read
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={dismissAll}
                  title="Clear my notifications"
                  className="flex items-center gap-1 text-[11px] font-medium text-ink-400 hover:text-ink-200 hover:underline transition-colors"
                >
                  <X className="w-3 h-3" />
                  Clear all
                </button>
              )}
            </div>
          </div>

          {/* Filter Pills */}
          <div className="mt-2.5 flex items-center justify-between gap-1 border-t border-ink-800/60 pt-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setFilter("all")}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  filter === "all"
                    ? "bg-ink-800 text-ink-100 ring-1 ring-ink-700"
                    : "text-ink-400 hover:text-ink-200 hover:bg-ink-850/50"
                }`}
              >
                All ({notifications.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter("unread")}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  filter === "unread"
                    ? "bg-court-500/20 text-court-300 ring-1 ring-court-500/40"
                    : "text-ink-400 hover:text-ink-200 hover:bg-ink-850/50"
                }`}
              >
                Unread ({unreadCount})
              </button>
            </div>

            {userBranch && (
              <span className="text-[10px] font-mono text-ink-400 truncate max-w-[120px]">
                📍 {userBranch}
              </span>
            )}
          </div>
        </div>

        {/* Notification List */}
        <div className="max-h-[380px] overflow-y-auto divide-y divide-ink-850/80 p-1">
          {displayedNotifications.length === 0 ? (
            <div className="py-12 px-4 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-ink-900 border border-ink-800 text-ink-400">
                <Check className="h-5 w-5 text-court-400" />
              </div>
              <p className="mt-3 text-xs font-medium text-ink-200">All caught up!</p>
              <p className="mt-1 text-[11px] text-ink-400 max-w-[220px] mx-auto">
                {filter === "unread"
                  ? "No unread notifications for your role."
                  : `No active notifications scoped to ${formatRoleLabel(currentRole)}.`}
              </p>
            </div>
          ) : (
            displayedNotifications.map((notif) => {
              const isUnread = !isNotificationRead(notif);
              const safeUrl = resolveActionUrl(notif.actionUrl);
              const visuals = getNotificationVisuals(notif.type);
              const VisualIcon = visuals.icon;

              return (
                <div
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  className={`group relative flex items-start gap-3 p-3 rounded-lg transition-all cursor-pointer ${
                    isUnread
                      ? "bg-ink-900/60 hover:bg-ink-900 text-ink-100"
                      : "hover:bg-ink-900/40 text-ink-300 opacity-85"
                  }`}
                >
                  {/* Visual Icon */}
                  <div
                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${visuals.color}`}
                  >
                    <VisualIcon className="h-3.5 w-3.5" />
                  </div>

                  {/* Body */}
                  <div className="flex-1 min-w-0 pr-4">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`rounded px-1.5 py-0.2 font-mono text-[9px] font-semibold border ${visuals.badgeTone}`}
                      >
                        {visuals.badge}
                      </span>
                      {(notif.priority === "high" ||
                        notif.isIdleFollowUpAlert ||
                        notif.message?.includes("sessions while Idle since")) && (
                        <span className="rounded bg-bad/20 px-1.5 py-0.2 font-mono text-[9px] font-bold text-bad border border-bad/40">
                          HIGH PRIORITY
                        </span>
                      )}
                      {notif.targetBranchId && (
                        <span className="rounded bg-ink-800 px-1 py-0.2 font-mono text-[9px] text-ink-400 border border-ink-700">
                          {notif.targetBranchId}
                        </span>
                      )}
                      {notif.targetTeam && (
                        <span className="rounded bg-ink-800 px-1 py-0.2 font-mono text-[9px] text-court-300 border border-ink-700">
                          {notif.targetTeam}
                        </span>
                      )}
                      <span className="ml-auto text-[10px] font-mono text-ink-400 flex items-center gap-1">
                        <Clock className="w-2.5 h-2.5" />
                        {formatTimestamp(notif.createdAt)}
                      </span>
                    </div>

                    <div className="mt-1 flex items-center justify-between gap-1">
                      <h4
                        className={`text-xs font-semibold leading-snug line-clamp-1 ${
                          isUnread ? "text-ink-100 font-bold" : "text-ink-200"
                        }`}
                      >
                        {notif.title}
                      </h4>
                      {isUnread && (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full bg-court-400 ring-2 ring-court-500/30"
                          title="Unread notification"
                        />
                      )}
                    </div>

                    <p className="mt-0.5 text-[11px] text-ink-300 leading-normal line-clamp-3">
                      {notif.message}
                    </p>

                    {(notif.isIdleFollowUpAlert ||
                      notif.message?.includes("sessions while Idle since")) && (
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const matchId =
                              notif.targetPlayerId ||
                              notif.actionUrl?.split("playerId=")[1]?.split("&")[0];
                            if (matchId) {
                              void movePlayerToCrmFollowUp(matchId, "idle_followup");
                            }
                            void markAsRead(notif.id);
                          }}
                          className="inline-flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 font-mono text-[10px] font-semibold text-amber-300 hover:bg-amber-500/25 transition-colors"
                        >
                          Move to CRM Follow-Up
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const matchId =
                              notif.targetPlayerId ||
                              notif.actionUrl?.split("playerId=")[1]?.split("&")[0];
                            if (matchId) {
                              void movePlayerToCrmFollowUp(matchId, "lost_churned");
                            }
                            void markAsRead(notif.id);
                          }}
                          className="inline-flex items-center gap-1.5 rounded border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 font-mono text-[10px] font-semibold text-rose-300 hover:bg-rose-500/25 transition-colors"
                        >
                          Move to Lost Clients
                        </button>
                      </div>
                    )}

                    {safeUrl && (
                      <div className="mt-1.5 flex items-center gap-1 text-[10px] font-medium text-court-400 group-hover:text-court-300 transition-colors">
                        <span>Open details</span>
                        <ArrowUpRight className="w-3 h-3 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
                      </div>
                    )}
                  </div>

                  {/* Dismiss (X) */}
                  <button
                    type="button"
                    title="Dismiss for me"
                    onClick={(e) => handleDismiss(e, notif.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-ink-400 hover:text-bad rounded transition-opacity"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-ink-850 bg-ink-950/80 px-4 py-2 flex items-center justify-between text-[10px] font-mono text-ink-400">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-good animate-pulse" />
            Live Firestore Sync
          </span>
          <span>Role: {formatRoleLabel(currentRole)}</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}

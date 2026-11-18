import { useState, useEffect, useMemo } from "react";
import { Modal, Field, Select, Button, Textarea } from "./kit";
import { useDB, useTenantUser, defaultRoleDefinitions, getCoachTeams } from "@/lib/data-store";
import type { SessionItem } from "@/lib/mock-data";
import {
  formatGameReportForWhatsApp,
  formatSessionNoticeForWhatsApp,
  pushToWhatsApp,
} from "@/lib/whatsapp";
import { MessageSquare, Send, Copy, Check } from "lucide-react";
import { toast } from "sonner";

export function WhatsAppShareModal({
  open,
  onClose,
  session,
}: {
  open: boolean;
  onClose: () => void;
  session: SessionItem | null;
}) {
  const { db } = useDB();
  const currentUser = useTenantUser();
  const [targetGroup, setTargetGroup] = useState<string>("");
  const [customText, setCustomText] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const activeGroups = useMemo(() => {
    const base = (db.groups || []).filter((g) => g.active !== false);
    if (!currentUser) return base;

    const activeRolesMatrix =
      db.customRoles && db.customRoles.length > 0 ? db.customRoles : defaultRoleDefinitions;
    const matchedRoleDef = activeRolesMatrix.find((r) => r.role === currentUser.role);
    const roleLower = (currentUser.role || "").toLowerCase();
    const isCoach =
      currentUser.role === "Coach" || roleLower === "head coach" || roleLower === "assistant coach";
    const isBranchScoped = Boolean(
      currentUser.branch &&
      currentUser.branch !== "All branches" &&
      currentUser.branch !== "HQ" &&
      (currentUser.role === "Branch Manager" ||
        matchedRoleDef?.branchScope === "Assigned branch only"),
    );

    if (isCoach) {
      const matchedCoach = (db.coaches || []).find(
        (c) =>
          c.id === currentUser.id ||
          (currentUser.email && c.email?.toLowerCase() === currentUser.email.toLowerCase()) ||
          (currentUser.name && c.name.toLowerCase() === currentUser.name.toLowerCase()) ||
          (currentUser.username &&
            c.username?.toLowerCase() === currentUser.username.toLowerCase()),
      );
      const assignedTeamNamesLower = new Set(
        getCoachTeams(
          matchedCoach || { id: currentUser.id, name: currentUser.name },
          db.teams || [],
        ).map((n) => n.toLowerCase().trim()),
      );
      const myTeams = (db.teams || []).filter((t) =>
        assignedTeamNamesLower.has(t.name.toLowerCase().trim()),
      );
      const myTeamIds = new Set(myTeams.map((t) => t.id));
      const myTeamNames = assignedTeamNamesLower;
      const coachBranch = (matchedCoach?.branch || currentUser.branch || "").toLowerCase();
      const matchedBranchObj = coachBranch
        ? (db.branches || []).find((b) => b.name.toLowerCase() === coachBranch)
        : undefined;

      return base.filter((g) => {
        // 1. Assigned team match
        if (g.teamId && myTeamIds.has(g.teamId)) return true;
        if (g.teamName && myTeamNames.has(g.teamName.toLowerCase())) return true;
        // If group is explicitly tied to another team, exclude it
        if (g.teamId || g.teamName) return false;

        // 2. Assigned branch match (for branch-level groups not tied to another team)
        if (
          coachBranch &&
          coachBranch !== "all branches" &&
          coachBranch !== "hq" &&
          ((matchedBranchObj && g.branchId === matchedBranchObj.id) ||
            (g.branchName && g.branchName.toLowerCase() === coachBranch))
        ) {
          return true;
        }
        // If group is explicitly tied to another branch, exclude it
        if (g.branchId || g.branchName) return false;

        // 3. Academy-wide Coaches or General groups
        if (
          g.category === "Coaches" ||
          g.category === "General" ||
          g.scope?.toLowerCase().includes("all academy")
        ) {
          return true;
        }
        return false;
      });
    }

    if (isBranchScoped) {
      const bLower = (currentUser.branch || "").toLowerCase();
      const branchObj = (db.branches || []).find((b) => b.name.toLowerCase() === bLower);
      const branchTeams = (db.teams || []).filter((t) => (t.branch || "").toLowerCase() === bLower);
      const branchTeamIds = new Set(branchTeams.map((t) => t.id));
      const branchTeamNames = new Set(branchTeams.map((t) => t.name.toLowerCase()));

      return base.filter((g) => {
        if (branchObj && g.branchId === branchObj.id) return true;
        if (g.branchName && g.branchName.toLowerCase() === bLower) return true;
        if (g.teamId && branchTeamIds.has(g.teamId)) return true;
        if (g.teamName && branchTeamNames.has(g.teamName.toLowerCase())) return true;
        if (!g.branchId && !g.branchName && !g.teamId && !g.teamName) {
          return Boolean(g.scope && g.scope.toLowerCase().includes(bLower));
        }
        return false;
      });
    }

    return base;
  }, [db.groups, db.customRoles, db.coaches, db.teams, db.branches, currentUser]);

  // Auto-format text whenever session changes
  useEffect(() => {
    if (!session) return;
    const initialText =
      session.kind === "Game"
        ? formatGameReportForWhatsApp(session, db.academy?.name)
        : formatSessionNoticeForWhatsApp(session, db.academy?.name);
    setCustomText(initialText);

    // Auto-select best matching group based on team FIRST, then branch
    if (activeGroups.length > 0) {
      const sessionTeamId = (session as SessionItem & { teamId?: string }).teamId;
      const matchByTeam = activeGroups.find(
        (g) =>
          (sessionTeamId && g.teamId === sessionTeamId) ||
          (session.team &&
            (g.teamName?.toLowerCase() === session.team.toLowerCase() ||
              g.scope?.toLowerCase() === session.team.toLowerCase())) ||
          (session.teamA && g.teamName?.toLowerCase() === session.teamA.toLowerCase()) ||
          (session.teamB && g.teamName?.toLowerCase() === session.teamB.toLowerCase()),
      );
      const matchByBranch = activeGroups.find(
        (g) =>
          session.branch &&
          (g.branchName?.toLowerCase() === session.branch.toLowerCase() ||
            g.scope?.toLowerCase().includes(session.branch.toLowerCase())),
      );
      const match = matchByTeam || matchByBranch;
      setTargetGroup(match ? match.name : activeGroups[0].name);
    } else {
      setTargetGroup("");
    }
  }, [session, db.academy?.name, activeGroups]);

  if (!session) return null;

  const selectedGroupObj = activeGroups.find((g) => g.name === targetGroup);

  const handlePush = () => {
    if (!customText.trim()) {
      toast.error("Message is empty.");
      return;
    }
    pushToWhatsApp(customText, selectedGroupObj?.link, selectedGroupObj?.adminPhone);
    onClose();
  };

  const handleCopy = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(customText);
      setCopied(true);
      toast.success("Formatted WhatsApp text copied to clipboard.");
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <Modal
      open={open}
      title={`Push to WhatsApp: ${session.title}`}
      meta={
        session.kind === "Game"
          ? "Broadcast official match report, score, and highlights"
          : "Broadcast training schedule and session requirements"
      }
      onClose={onClose}
      wide
    >
      <div className="p-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 items-end">
          <Field
            label="Target WhatsApp Group"
            hint="Select the parent/player or coach broadcast group"
          >
            {activeGroups.length > 0 ? (
              <Select
                value={targetGroup}
                onChange={setTargetGroup}
                options={activeGroups.map((g) => g.name)}
              />
            ) : (
              <div className="text-xs text-warn font-mono">
                No groups configured for your scope. Head to Settings → Communications.
              </div>
            )}
          </Field>

          <div className="flex items-center gap-2 pb-1">
            {selectedGroupObj && (
              <div className="rounded-md bg-ink-850 px-3 py-2 border border-ink-750 text-xs flex-1 min-w-0">
                <span className="text-ink-400 font-mono text-[10px] block uppercase">Scope</span>
                <span className="text-ink-200 font-medium truncate block">
                  {selectedGroupObj.scope || "Academy Wide"}
                </span>
              </div>
            )}
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 rounded-md bg-ink-800 hover:bg-ink-750 text-ink-200 px-3 py-2 text-xs font-mono border border-ink-700 transition-colors"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-good" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
              <span>{copied ? "Copied!" : "Copy"}</span>
            </button>
          </div>
        </div>

        <Field
          label="WhatsApp Formatted Message Preview"
          hint="Edit text or emojis before broadcasting"
        >
          <Textarea
            value={customText}
            onChange={setCustomText}
            rows={10}
            className="font-mono text-xs leading-relaxed bg-ink-950 text-emerald-300 border-ink-750 selection:bg-court-500/30"
          />
        </Field>

        <div className="flex items-center justify-between pt-2 border-t border-ink-800">
          <div className="flex items-center gap-2 text-[11px] text-ink-400 font-mono">
            <MessageSquare className="h-3.5 w-3.5 text-court-400" />
            <span>1-Click push opens WhatsApp with message ready to send</span>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" size="md" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="emerald"
              size="md"
              onClick={handlePush}
              className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold border-transparent shadow-sm"
            >
              <Send className="h-3.5 w-3.5 mr-1" />
              <span>PUSH TO WHATSAPP</span>
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

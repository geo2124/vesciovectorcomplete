import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Field, Modal, money } from "@/components/kit";
import {
  useDB,
  DEFAULT_CRM_SETTINGS,
  type CrmCommunicationEntry,
  type CrmLead,
  type CrmReminderItem,
  type CrmSettings,
  type CrmStage,
} from "@/lib/data-store";
import { useAuth } from "@/lib/auth";
import { normalizeDoubleEntryLedger } from "@/lib/accounting-coa";
import { openDirectWhatsApp } from "@/lib/whatsapp";
import { toast } from "sonner";
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  Filter,
  Kanban,
  List,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShoppingBag,
  Trash2,
  UserCheck,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";

export const Route = createFileRoute("/crm")({
  component: CrmPipelinePage,
});

const CRM_STAGE_CONFIG: Array<{
  id: CrmStage;
  label: string;
  shortLabel: string;
  description: string;
  accentBorder: string;
  badgeBg: string;
  badgeText: string;
}> = [
  {
    id: "inquiry",
    label: "New Inquiries / Leads",
    shortLabel: "New Inquiries",
    description: "Prospective players, parent contact, DOB, preferred branch/position & source",
    accentBorder: "border-t-sky-500",
    badgeBg: "bg-sky-500/15 border-sky-500/30",
    badgeText: "text-sky-600 dark:text-sky-300",
  },
  {
    id: "trial_scheduled",
    label: "Trial Scheduled",
    shortLabel: "Trial Scheduled",
    description: "Linked to a specific existing Team session for on-court evaluation",
    accentBorder: "border-t-indigo-500",
    badgeBg: "bg-indigo-500/15 border-indigo-500/30",
    badgeText: "text-indigo-600 dark:text-indigo-300",
  },
  {
    id: "pending_registration",
    label: "Pending Registration / Offer Sent",
    shortLabel: "Offer Sent",
    description: "Evaluated players with package offer & tuition quote awaiting registration",
    accentBorder: "border-t-purple-500",
    badgeBg: "bg-purple-500/15 border-purple-500/30",
    badgeText: "text-purple-600 dark:text-purple-300",
  },
  {
    id: "active_converted",
    label: "Active / Converted",
    shortLabel: "Active / Converted",
    description: "Automatically creates or activates the player in the Academy database",
    accentBorder: "border-t-emerald-500",
    badgeBg: "bg-emerald-500/15 border-emerald-500/30",
    badgeText: "text-emerald-600 dark:text-emerald-300",
  },
  {
    id: "idle_followup",
    label: "Idle / At-Risk Follow-Up",
    shortLabel: "Idle Follow-Up",
    description: "Synced with players currently in the Idle renewal state needing outreach",
    accentBorder: "border-t-amber-500",
    badgeBg: "bg-amber-500/15 border-amber-500/30",
    badgeText: "text-amber-600 dark:text-amber-300",
  },
  {
    id: "lost_churned",
    label: "Lost Clients / Churned",
    shortLabel: "Lost / Churned",
    description: "Stores reason for leaving, last team, idle duration & re-engagement notes",
    accentBorder: "border-t-rose-500",
    badgeBg: "bg-rose-500/15 border-rose-500/30",
    badgeText: "text-rose-600 dark:text-rose-300",
  },
  {
    id: "aftersales_retention",
    label: "Aftersales & Retention",
    shortLabel: "Aftersales & Retention",
    description: "Parent check-ins, gear/uniform upsells, camp invites & feedback logs",
    accentBorder: "border-t-teal-500",
    badgeBg: "bg-teal-500/15 border-teal-500/30",
    badgeText: "text-teal-600 dark:text-teal-300",
  },
];

const BASKETBALL_POSITIONS = [
  "PG (Point Guard)",
  "SG (Shooting Guard)",
  "SF (Small Forward)",
  "PF (Power Forward)",
  "C (Center)",
  "Guard / Wing",
  "Big / Post",
  "Undecided / Youth",
];

const LEAD_SOURCES = [
  "Instagram / Social Media",
  "Walk-In / Branch Visit",
  "Parent / Player Referral",
  "School Tournament / Scout",
  "WhatsApp Inquiry",
  "Seasonal Camp",
  "Website / Google",
  "Academy Renewal Pipeline",
];

function createEmptyLeadDraft(defaultBranch = "HQ"): CrmLead {
  const nowIso = new Date().toISOString();
  const todayIso = nowIso.slice(0, 10);
  return {
    id: `crm-${Date.now().toString(36)}`,
    stage: "inquiry",
    playerName: "",
    gender: "Boy",
    dob: "2013-05-15",
    category: "U-14",
    preferredBranch: defaultBranch,
    preferredPosition: "PG (Point Guard)",
    source: "WhatsApp Inquiry",
    parentName: "",
    parentPhone: "",
    parentEmail: "",
    guardian2Name: "",
    guardian2Phone: "",
    school: "",
    medicalNotes: "",
    generalNotes: "",
    trialSessionId: "",
    trialDate: "",
    trialTeam: "",
    trialEvaluationNotes: "",
    trialRating: "4",
    offeredPackageId: "",
    offeredMonthlyFee: 85,
    registrationFeeCollected: 0,
    offerSentDate: todayIso,
    churnReason: "",
    lastTeam: "",
    idleDurationDays: 0,
    reEngagementNotes: "",
    aftersalesCategory: "Parent Check-In",
    gearUpsellNotes: "",
    campInviteStatus: "Not Sent",
    feedbackLog: "",
    communications: [],
    reminders: [],
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function CrmPipelinePage() {
  const {
    db,
    setEntity,
    deleteEntity,
    updateAcademy,
    movePlayerToCrmFollowUp,
    convertCrmLeadToPlayer,
    runCrmAutoChurnCheck,
  } = useDB();
  const { user, passwordUser } = useAuth();
  const currentAuthor = user?.email || passwordUser?.email || "Academy Admin";

  const [viewMode, setViewMode] = useState<"kanban" | "list">("kanban");
  const [searchQuery, setSearchQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState("All");
  const [stageFilter, setStageFilter] = useState<CrmStage | "All">("All");

  // Modals
  const [isLeadFormOpen, setIsLeadFormOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<CrmLead | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  // Settings form state
  const currentCrmSettings: CrmSettings = useMemo(
    () => ({
      ...DEFAULT_CRM_SETTINGS,
      ...(db.academy?.crmSettings || {}),
    }),
    [db.academy?.crmSettings],
  );
  const [settingsDraft, setSettingsDraft] = useState<CrmSettings>(currentCrmSettings);

  // Activity Log & Reminder inputs inside Detail Modal
  const [newCommType, setNewCommType] = useState<CrmCommunicationEntry["type"]>("WhatsApp");
  const [newCommNote, setNewCommNote] = useState("");
  const [newReminderTitle, setNewReminderTitle] = useState("");
  const [newReminderDue, setNewReminderDue] = useState(() =>
    new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  );

  // Quick Churn Reason prompt state when moving to Lost Clients
  const [churnModalTarget, setChurnModalTarget] = useState<{
    lead?: CrmLead;
    playerId?: string;
    playerName: string;
    lastTeam?: string;
    idleDays?: number;
  } | null>(null);
  const [churnReasonInput, setChurnReasonInput] = useState("Schedule / Financial Pause");
  const [reEngagementInput, setReEngagementInput] = useState(
    "Check in before next seasonal cycle or holiday camp.",
  );

  const todayIso = new Date().toISOString().slice(0, 10);

  // Build unified CRM leads list: combines persisted db.crmLeads + virtual/live-synced Idle players
  // so every player currently in the "Idle" state is visible and actionable in the CRM!
  const allLeads = useMemo(() => {
    const storedLeads = Array.isArray(db.crmLeads) ? db.crmLeads : [];
    const players = Array.isArray(db.players) ? db.players : [];
    const linkedPlayerIds = new Set(
      storedLeads.map((l) => l.linkedPlayerId).filter((id): id is string => Boolean(id)),
    );

    // Enrich stored leads with live player status/idle counters if linked
    const enrichedStored: CrmLead[] = storedLeads.map((lead) => {
      if (!lead.linkedPlayerId) return lead;
      const p = players.find((pl) => pl.id === lead.linkedPlayerId);
      if (!p) return lead;
      const idleStart = p.idleSinceDate || lead.idleSinceDate || "";
      const idleDays = idleStart
        ? Math.max(
            0,
            Math.floor((Date.now() - new Date(idleStart).getTime()) / (1000 * 60 * 60 * 24)) || 0,
          )
        : (lead.idleDurationDays ?? 0);
      return {
        ...lead,
        idleSinceDate: idleStart || lead.idleSinceDate,
        missedSessionsSinceIdle: p.missedSessionsSinceIdle ?? lead.missedSessionsSinceIdle ?? 0,
        idleDurationDays: idleDays,
        lastTeam: (Array.isArray(p.teams) && p.teams[0]) || lead.lastTeam || "",
      };
    });

    // Auto-surface any player currently in "Idle" status that doesn't yet have a stored CrmLead doc
    const unsyncedIdlePlayers: CrmLead[] = players
      .filter((p) => p.status === "Idle" && !linkedPlayerIds.has(p.id))
      .map((p) => {
        const idleStart = p.idleSinceDate || todayIso;
        const idleDays = Math.max(
          0,
          Math.floor((Date.now() - new Date(idleStart).getTime()) / (1000 * 60 * 60 * 24)) || 0,
        );
        return {
          id: `crm-player-${p.id}`,
          stage: "idle_followup" as CrmStage,
          playerName: p.name,
          gender: p.gender,
          dob: p.dob || "2013-01-01",
          category: p.category || "U-14",
          preferredBranch: p.branch || "HQ",
          preferredPosition: "Guard / Wing",
          source: "Academy Renewal Pipeline",
          parentName: p.parent || "",
          parentPhone: p.parentPhone || "",
          guardian2Name: p.guardian2Name || "",
          guardian2Phone: p.guardian2Phone || "",
          school: p.school || "",
          medicalNotes: p.medicalNotes || "",
          generalNotes: `Auto-synced from Idle renewal status (${p.teams?.join(", ") || "No team"}).`,
          linkedPlayerId: p.id,
          idleSinceDate: idleStart,
          missedSessionsSinceIdle: p.missedSessionsSinceIdle ?? 0,
          lastTeam: (Array.isArray(p.teams) && p.teams[0]) || "",
          idleDurationDays: idleDays,
          communications: [],
          reminders: [],
          createdAt: idleStart,
          updatedAt: todayIso,
        };
      });

    return [...enrichedStored, ...unsyncedIdlePlayers];
  }, [db.crmLeads, db.players, todayIso]);

  // Idle players in the Academy database for the 1-Click Idle-to-CRM Sync Bar
  const idleAcademyPlayers = useMemo(() => {
    return (db.players || []).filter((p) => p.status === "Idle");
  }, [db.players]);

  const filteredLeads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allLeads.filter((l) => {
      if (branchFilter !== "All" && (l.preferredBranch || "HQ") !== branchFilter) return false;
      if (stageFilter !== "All" && l.stage !== stageFilter) return false;
      if (!q) return true;
      return (
        l.playerName.toLowerCase().includes(q) ||
        (l.parentName || "").toLowerCase().includes(q) ||
        (l.parentPhone || "").toLowerCase().includes(q) ||
        (l.category || "").toLowerCase().includes(q) ||
        (l.preferredBranch || "").toLowerCase().includes(q) ||
        (l.lastTeam || "").toLowerCase().includes(q) ||
        (l.trialTeam || "").toLowerCase().includes(q)
      );
    });
  }, [allLeads, branchFilter, stageFilter, searchQuery]);

  const selectedLead = useMemo(() => {
    if (!selectedLeadId) return null;
    return allLeads.find((l) => l.id === selectedLeadId) || null;
  }, [allLeads, selectedLeadId]);

  const linkedAcademyPlayer = useMemo(() => {
    if (!selectedLead?.linkedPlayerId) return null;
    return (db.players || []).find((p) => p.id === selectedLead.linkedPlayerId) || null;
  }, [selectedLead, db.players]);

  // Linked player's invoices & attendance history for the Client Profile drawer
  const linkedPlayerHistory = useMemo(() => {
    if (!linkedAcademyPlayer) return { invoices: [], attendanceLogs: [] };
    const playerInvoices = (db.invoices || [])
      .filter((inv) => inv.playerId === linkedAcademyPlayer.id)
      .sort((a, b) => (b.issueDate || "").localeCompare(a.issueDate || ""));

    const attMap = db.attendance || {};
    const attendanceLogs: Array<{
      sessionId: string;
      date: string;
      title: string;
      team: string;
      branch: string;
      status: "Present" | "Absent" | "Excused";
    }> = [];

    for (const s of db.sessions || []) {
      const st = attMap[s.id]?.[linkedAcademyPlayer.id];
      if (st) {
        attendanceLogs.push({
          sessionId: s.id,
          date: s.date,
          title: s.title,
          team: s.team || s.teamA || "Academy",
          branch: s.branch,
          status: st,
        });
      }
    }
    attendanceLogs.sort((a, b) => b.date.localeCompare(a.date));

    return { invoices: playerInvoices, attendanceLogs };
  }, [linkedAcademyPlayer, db.invoices, db.attendance, db.sessions]);

  // KPI metrics
  const kpis = useMemo(() => {
    const inquiries = allLeads.filter((l) => l.stage === "inquiry").length;
    const trials = allLeads.filter((l) => l.stage === "trial_scheduled").length;
    const pendingOffers = allLeads.filter((l) => l.stage === "pending_registration").length;
    const activeConverted = allLeads.filter((l) => l.stage === "active_converted").length;
    const idleFollowUp = allLeads.filter((l) => l.stage === "idle_followup").length;
    const lostChurned = allLeads.filter((l) => l.stage === "lost_churned").length;
    const aftersales = allLeads.filter((l) => l.stage === "aftersales_retention").length;
    const dueReminders = allLeads.reduce(
      (acc, l) =>
        acc + (l.reminders || []).filter((r) => !r.completed && r.dueDate <= todayIso).length,
      0,
    );
    return {
      total: allLeads.length,
      inquiries,
      trials,
      pendingOffers,
      activeConverted,
      idleFollowUp,
      lostChurned,
      aftersales,
      dueReminders,
    };
  }, [allLeads, todayIso]);

  const handleOpenCreateLead = (initialStage: CrmStage = "inquiry") => {
    const defaultBranch = db.branches?.[0]?.name || "HQ";
    const draft = createEmptyLeadDraft(defaultBranch);
    draft.stage = initialStage;
    setEditingLead(draft);
    setIsLeadFormOpen(true);
  };

  const handleOpenEditLead = (lead: CrmLead) => {
    setEditingLead({
      ...lead,
      communications: [...(lead.communications || [])],
      reminders: [...(lead.reminders || [])],
    });
    setIsLeadFormOpen(true);
  };

  const handleSaveLeadForm = async () => {
    if (!editingLead) return;
    if (!editingLead.playerName.trim()) {
      toast.error("Please enter the player's full name.");
      return;
    }

    const nowIso = new Date().toISOString();
    const todayIso = nowIso.slice(0, 10);
    const regFeeAmount = Math.max(0, Number(editingLead.registrationFeeCollected) || 0);
    const regFeeLedgerId =
      regFeeAmount > 0
        ? editingLead.registrationFeeLedgerId || `l-crm-fee-${editingLead.id}`
        : editingLead.registrationFeeLedgerId;

    const cleanedLead: CrmLead = {
      ...editingLead,
      playerName: editingLead.playerName.trim(),
      parentName: (editingLead.parentName || "").trim(),
      parentPhone: (editingLead.parentPhone || "").trim(),
      ...(regFeeAmount > 0 ? { registrationFeeCollected: regFeeAmount } : {}),
      ...(regFeeLedgerId ? { registrationFeeLedgerId: regFeeLedgerId } : {}),
      updatedAt: nowIso,
    };

    await setEntity("crmLeads", cleanedLead);

    if (regFeeAmount > 0 && regFeeLedgerId) {
      await setEntity(
        "ledger",
        normalizeDoubleEntryLedger({
          id: regFeeLedgerId,
          date: todayIso,
          account: "Player Insurance & Registration",
          category: "Player Insurance & Registration",
          entry: `CRM Registration / Trial Fee · ${cleanedLead.playerName}`,
          description: `CRM Registration / Trial Fee · ${cleanedLead.playerName}`,
          type: "Revenue",
          amount: regFeeAmount,
          status: "Collected",
          paymentMethod: "Cash",
          branch: cleanedLead.preferredBranch || "HQ",
          module: "crm",
          referenceId: cleanedLead.id,
          note: `Collected via CRM pipeline (${cleanedLead.stage})`,
        }),
      );
    }

    // If stage was set to active_converted, automatically create or activate the player in Academy DB
    if (cleanedLead.stage === "active_converted") {
      await convertCrmLeadToPlayer(cleanedLead.id);
    }

    setIsLeadFormOpen(false);
    setEditingLead(null);
    toast.success(`Saved CRM profile for ${cleanedLead.playerName}.`);
  };

  const handleStageChange = async (lead: CrmLead, nextStage: CrmStage) => {
    if (lead.stage === nextStage) return;

    // If moving to Lost Clients / Churned, open quick churn reason prompt
    if (nextStage === "lost_churned") {
      setChurnReasonInput(lead.churnReason || "Schedule / Financial Pause");
      setReEngagementInput(
        lead.reEngagementNotes || "Follow up before next seasonal camp or cycle.",
      );
      setChurnModalTarget({
        lead,
        playerId: lead.linkedPlayerId,
        playerName: lead.playerName,
        lastTeam: lead.lastTeam || lead.trialTeam,
        idleDays: lead.idleDurationDays,
      });
      return;
    }

    const nowIso = new Date().toISOString();
    const stageMeta = CRM_STAGE_CONFIG.find((s) => s.id === nextStage);
    const commEntry: CrmCommunicationEntry = {
      id: `comm-${Date.now()}`,
      type: "In-Person",
      note: `Moved pipeline stage to "${stageMeta?.label || nextStage}".`,
      timestamp: nowIso,
      author: currentAuthor,
    };

    const updatedLead: CrmLead = {
      ...lead,
      stage: nextStage,
      updatedAt: nowIso,
      communications: [commEntry, ...(lead.communications || [])],
    };

    await setEntity("crmLeads", updatedLead);

    if (nextStage === "active_converted") {
      await convertCrmLeadToPlayer(updatedLead.id);
    } else if (nextStage === "idle_followup" && updatedLead.linkedPlayerId) {
      await movePlayerToCrmFollowUp(updatedLead.linkedPlayerId, "idle_followup");
    } else {
      toast.success(`Moved ${lead.playerName} to ${stageMeta?.shortLabel || nextStage}.`);
    }
  };

  const handleConfirmChurnModal = async () => {
    if (!churnModalTarget) return;
    const { lead, playerId } = churnModalTarget;
    if (playerId) {
      await movePlayerToCrmFollowUp(playerId, "lost_churned", {
        churnReason: churnReasonInput.trim() || "Unspecified churn reason",
        reEngagementNotes: reEngagementInput.trim(),
      });
    } else if (lead) {
      const nowIso = new Date().toISOString();
      const commEntry: CrmCommunicationEntry = {
        id: `comm-${Date.now()}`,
        type: "In-Person",
        note: `Moved to Lost Clients / Churned. Reason: ${churnReasonInput.trim() || "N/A"}.`,
        timestamp: nowIso,
        author: currentAuthor,
      };
      await setEntity("crmLeads", {
        ...lead,
        stage: "lost_churned",
        churnReason: churnReasonInput.trim(),
        reEngagementNotes: reEngagementInput.trim(),
        churnedAt: todayIso,
        updatedAt: nowIso,
        communications: [commEntry, ...(lead.communications || [])],
      });
      toast.success(`Moved ${lead.playerName} to Lost Clients / Churned.`);
    }
    setChurnModalTarget(null);
  };

  const handleAddCommunication = async () => {
    if (!selectedLead) return;
    if (!newCommNote.trim()) {
      toast.error("Please enter a communication note.");
      return;
    }
    const nowIso = new Date().toISOString();
    const entry: CrmCommunicationEntry = {
      id: `comm-${Date.now()}`,
      type: newCommType,
      note: newCommNote.trim(),
      timestamp: nowIso,
      author: currentAuthor,
    };
    const updated: CrmLead = {
      ...selectedLead,
      updatedAt: nowIso,
      communications: [entry, ...(selectedLead.communications || [])],
    };
    await setEntity("crmLeads", updated);
    setNewCommNote("");
    toast.success(`Logged ${newCommType} activity for ${selectedLead.playerName}.`);
  };

  const handleAddReminder = async () => {
    if (!selectedLead) return;
    if (!newReminderTitle.trim() || !newReminderDue) {
      toast.error("Please enter a reminder task and due date.");
      return;
    }
    const nowIso = new Date().toISOString();
    const item: CrmReminderItem = {
      id: `rem-${Date.now()}`,
      title: newReminderTitle.trim(),
      dueDate: newReminderDue,
      completed: false,
      createdAt: nowIso,
    };
    const updated: CrmLead = {
      ...selectedLead,
      updatedAt: nowIso,
      reminders: [...(selectedLead.reminders || []), item],
    };
    await setEntity("crmLeads", updated);
    setNewReminderTitle("");
    toast.success(`Added follow-up reminder due ${newReminderDue}.`);
  };

  const handleToggleReminder = async (reminderId: string) => {
    if (!selectedLead) return;
    const nowIso = new Date().toISOString();
    const updatedReminders = (selectedLead.reminders || []).map((r) =>
      r.id === reminderId ? { ...r, completed: !r.completed } : r,
    );
    await setEntity("crmLeads", {
      ...selectedLead,
      updatedAt: nowIso,
      reminders: updatedReminders,
    });
  };

  const handleDeleteLead = async (lead: CrmLead) => {
    await deleteEntity("crmLeads", lead.id);
    if (selectedLeadId === lead.id) {
      setSelectedLeadId(null);
    }
    toast.success(`Removed ${lead.playerName} from CRM pipeline.`);
  };

  const handleSaveCrmSettings = async () => {
    await updateAcademy({ crmSettings: settingsDraft });
    setIsSettingsOpen(false);
    toast.success("Saved CRM Auto-Churn configuration.");
    await runCrmAutoChurnCheck({ silent: false });
  };

  return (
    <AppShell crumb="Roster · CRM" title="CRM & Pipeline">
      <div className="pt-2">
        {/* Responsive CRM Header Row (prevents top bar clipping & KPI card overlap) */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6 rounded-2xl border border-border bg-card/60 p-4">
          <div className="min-w-0">
            <div className="font-mono text-[10px] font-semibold tracking-widest text-primary uppercase">
              PLAYER ACQUISITION, RETENTION &amp; RENEWAL PIPELINE
            </div>
            <h2 className="mt-0.5 font-display text-lg font-bold tracking-tight text-foreground sm:text-xl">
              Basketball Academy CRM
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="inline-flex rounded-xl border border-border bg-secondary/40 p-1">
              <button
                type="button"
                onClick={() => setViewMode("kanban")}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  viewMode === "kanban"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Kanban className="size-3.5" />
                Kanban Board
              </button>
              <button
                type="button"
                onClick={() => setViewMode("list")}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                  viewMode === "list"
                    ? "bg-primary text-primary-foreground shadow-xs"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <List className="size-3.5" />
                List View
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setSettingsDraft(currentCrmSettings);
                setIsSettingsOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground hover:bg-secondary/60"
            >
              <Settings className="size-3.5 text-primary" />
              CRM Settings
              <span className="rounded-md bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {currentCrmSettings.autoChurnEnabled
                  ? currentCrmSettings.autoChurnMode === "1_month"
                    ? "Auto-Churn: 1 Mo"
                    : `Auto-Churn: ${currentCrmSettings.autoChurnWeeks}w`
                  : "Auto-Churn: Off"}
              </span>
            </button>

            <button
              type="button"
              onClick={() => handleOpenCreateLead("inquiry")}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-xs hover:opacity-95"
            >
              <Plus className="size-4" />
              New Lead / Inquiry
            </button>
          </div>
        </div>

        {/* KPI Strip */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          <div className="rounded-2xl border border-border bg-card p-3.5">
            <div className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
              Total Pipeline
            </div>
            <div className="mt-1 font-display text-2xl font-bold">{kpis.total}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">All active & archived</div>
          </div>
          <div className="rounded-2xl border border-sky-500/25 bg-sky-500/5 p-3.5">
            <div className="font-mono text-[10px] tracking-widest text-sky-600 uppercase dark:text-sky-300">
              New Inquiries
            </div>
            <div className="mt-1 font-display text-2xl font-bold text-sky-600 dark:text-sky-300">
              {kpis.inquiries}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">Prospective leads</div>
          </div>
          <div className="rounded-2xl border border-indigo-500/25 bg-indigo-500/5 p-3.5">
            <div className="font-mono text-[10px] tracking-widest text-indigo-600 uppercase dark:text-indigo-300">
              Trials Scheduled
            </div>
            <div className="mt-1 font-display text-2xl font-bold text-indigo-600 dark:text-indigo-300">
              {kpis.trials}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">Linked to sessions</div>
          </div>
          <div className="rounded-2xl border border-purple-500/25 bg-purple-500/5 p-3.5">
            <div className="font-mono text-[10px] tracking-widest text-purple-600 uppercase dark:text-purple-300">
              Offers Sent
            </div>
            <div className="mt-1 font-display text-2xl font-bold text-purple-600 dark:text-purple-300">
              {kpis.pendingOffers}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">Pending registration</div>
          </div>
          <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-3.5">
            <div className="font-mono text-[10px] tracking-widest text-emerald-600 uppercase dark:text-emerald-300">
              Converted
            </div>
            <div className="mt-1 font-display text-2xl font-bold text-emerald-600 dark:text-emerald-300">
              {kpis.activeConverted}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">Activated in roster</div>
          </div>
          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5">
            <div className="font-mono text-[10px] tracking-widest text-amber-600 uppercase dark:text-amber-300">
              Idle Follow-Up
            </div>
            <div className="mt-1 font-display text-2xl font-bold text-amber-600 dark:text-amber-300">
              {kpis.idleFollowUp}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">At-risk renewals</div>
          </div>
          <div className="rounded-2xl border border-rose-500/25 bg-rose-500/5 p-3.5">
            <div className="font-mono text-[10px] tracking-widest text-rose-600 uppercase dark:text-rose-300">
              Lost / Churned
            </div>
            <div className="mt-1 font-display text-2xl font-bold text-rose-600 dark:text-rose-300">
              {kpis.lostChurned}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">Re-engagement pool</div>
          </div>
          <div className="rounded-2xl border border-teal-500/25 bg-teal-500/5 p-3.5">
            <div className="font-mono text-[10px] tracking-widest text-teal-600 uppercase dark:text-teal-300">
              Aftersales / Due
            </div>
            <div className="mt-1 font-display text-2xl font-bold text-teal-600 dark:text-teal-300">
              {kpis.aftersales}{" "}
              {kpis.dueReminders > 0 && (
                <span className="ml-1 rounded-md bg-rose-500/20 px-1.5 py-0.5 font-mono text-xs text-rose-500">
                  {kpis.dueReminders} due
                </span>
              )}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">Retention & upsells</div>
          </div>
        </div>

        {/* Live Idle Renewal Players One-Click Control Strip */}
        {idleAcademyPlayers.length > 0 && (
          <div className="mb-6 rounded-2xl border border-amber-500/35 bg-amber-500/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex size-9 items-center justify-center rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-300">
                  <AlertTriangle className="size-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-foreground">
                      Live Idle Renewal Queue ({idleAcademyPlayers.length} Player
                      {idleAcademyPlayers.length === 1 ? "" : "s"})
                    </h3>
                    <span className="rounded-md border border-amber-500/40 bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-700 dark:text-amber-200">
                      Synced with Roster
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    One-click manual controls to assign Idle players into{" "}
                    <strong>Idle / At-Risk Follow-Up</strong> or{" "}
                    <strong>Lost Clients / Churned</strong>. Players with 3+ missed sessions are
                    highlighted.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => runCrmAutoChurnCheck({ silent: false })}
                className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-background/80 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-500/20 dark:text-amber-200"
              >
                <RefreshCw className="size-3.5" />
                Run Auto-Churn Check Now
              </button>
            </div>

            <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {idleAcademyPlayers.map((p) => {
                const missed = p.missedSessionsSinceIdle ?? 0;
                const isAlert = missed >= 3;
                const idleDays = p.idleSinceDate
                  ? Math.max(
                      0,
                      Math.floor(
                        (Date.now() - new Date(p.idleSinceDate).getTime()) / (1000 * 60 * 60 * 24),
                      ) || 0,
                    )
                  : 0;
                return (
                  <div
                    key={p.id}
                    className={`flex flex-col justify-between rounded-xl border p-3 transition-colors ${
                      isAlert
                        ? "border-rose-500/50 bg-rose-500/10"
                        : "border-border/80 bg-background/90"
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold text-foreground">{p.name}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {p.teams?.join(", ") || "No Team"} • {p.branch}
                          </div>
                        </div>
                        <span
                          className={`rounded-md px-2 py-0.5 font-mono text-[10px] font-bold ${
                            isAlert
                              ? "bg-rose-500 text-white"
                              : "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                          }`}
                        >
                          {missed} missed {missed === 1 ? "session" : "sessions"}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
                        <span>Idle since {p.idleSinceDate || "N/A"}</span>
                        <span>({idleDays}d)</span>
                        {p.crmFollowUpStatus && (
                          <span className="text-primary">• {p.crmFollowUpStatus}</span>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2.5">
                      <button
                        type="button"
                        onClick={() => movePlayerToCrmFollowUp(p.id, "idle_followup")}
                        className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-500/25 dark:text-amber-200"
                      >
                        <UserCheck className="size-3.5" />
                        Idle Follow-Up
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setChurnReasonInput(
                            `Missed ${missed} sessions while Idle since ${p.idleSinceDate || todayIso}`,
                          );
                          setReEngagementInput(
                            "Contact parent for next cycle re-enrollment or holiday camp.",
                          );
                          setChurnModalTarget({
                            playerId: p.id,
                            playerName: p.name,
                            lastTeam: p.teams?.[0],
                            idleDays,
                          });
                        }}
                        className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-500/25 dark:text-rose-300"
                      >
                        <UserMinus className="size-3.5" />
                        Move to Lost
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedLeadId(`crm-player-${p.id}`)}
                        className="inline-flex items-center justify-center rounded-lg border border-border bg-secondary/60 px-2.5 py-1.5 text-[11px] font-semibold text-foreground hover:bg-secondary"
                        title="Open CRM Profile & Log Activity"
                      >
                        Profile
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Search & Filter Bar */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3.5">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search player, parent, phone, team, branch, or age category..."
              className="w-full rounded-xl border border-border bg-background py-2 pr-3 pl-9 text-xs text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-hidden"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs">
              <Filter className="size-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Branch:</span>
              <select
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                className="bg-transparent font-semibold text-foreground focus:outline-hidden"
              >
                <option value="All">All Branches</option>
                {(db.branches || []).map((b) => (
                  <option key={b.id} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-1.5 text-xs">
              <span className="text-muted-foreground">Stage:</span>
              <select
                value={stageFilter}
                onChange={(e) => setStageFilter(e.target.value as CrmStage | "All")}
                className="bg-transparent font-semibold text-foreground focus:outline-hidden"
              >
                <option value="All">All 7 Stages ({allLeads.length})</option>
                {CRM_STAGE_CONFIG.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* KANBAN BOARD VIEW */}
        {viewMode === "kanban" ? (
          <div className="grid grid-cols-1 gap-4 pb-6 md:grid-cols-2 xl:grid-cols-3">
            {CRM_STAGE_CONFIG.map((stage) => {
              const stageLeads = filteredLeads.filter((l) => l.stage === stage.id);
              return (
                <div
                  key={stage.id}
                  className={`flex min-w-0 flex-col rounded-2xl border border-border border-t-4 bg-card/70 ${stage.accentBorder}`}
                >
                  {/* Column Header */}
                  <div className="border-b border-border p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-display text-sm font-bold text-foreground">
                        {stage.label}
                      </h3>
                      <span
                        className={`rounded-full border px-2 py-0.5 font-mono text-xs font-bold ${stage.badgeBg} ${stage.badgeText}`}
                      >
                        {stageLeads.length}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                      {stage.description}
                    </p>
                    <button
                      type="button"
                      onClick={() => handleOpenCreateLead(stage.id)}
                      className="mt-2.5 inline-flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-border py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                    >
                      <Plus className="size-3.5" />
                      Add to {stage.shortLabel}
                    </button>
                  </div>

                  {/* Column Cards */}
                  <div className="flex flex-1 flex-col gap-2.5 p-3">
                    {stageLeads.length === 0 ? (
                      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/60 py-10 text-center">
                        <Users className="size-6 text-muted-foreground/40" />
                        <div className="mt-1.5 text-xs font-medium text-muted-foreground">
                          No cards in {stage.shortLabel}
                        </div>
                      </div>
                    ) : (
                      stageLeads.map((lead) => {
                        const trialSession = lead.trialSessionId
                          ? (db.sessions || []).find((s) => s.id === lead.trialSessionId)
                          : null;
                        const pendingReminders = (lead.reminders || []).filter((r) => !r.completed);
                        const overdueReminders = pendingReminders.filter(
                          (r) => r.dueDate <= todayIso,
                        );
                        const lastComm = lead.communications?.[0];

                        return (
                          <div
                            key={lead.id}
                            onClick={() => setSelectedLeadId(lead.id)}
                            className="group cursor-pointer rounded-xl border border-border bg-background p-3.5 shadow-2xs transition-all hover:border-primary/50 hover:shadow-md"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div>
                                <div className="font-semibold text-foreground group-hover:text-primary">
                                  {lead.playerName}
                                </div>
                                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                                  <span>{lead.category || "U-14"}</span>
                                  <span>•</span>
                                  <span>{lead.preferredBranch || "HQ"}</span>
                                  {lead.preferredPosition && (
                                    <>
                                      <span>•</span>
                                      <span>{lead.preferredPosition.split(" ")[0]}</span>
                                    </>
                                  )}
                                </div>
                              </div>
                              {lead.linkedPlayerId && (
                                <span className="rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
                                  Roster Linked
                                </span>
                              )}
                            </div>

                            {/* Parent / Guardian Info */}
                            {(lead.parentName || lead.parentPhone) && (
                              <div className="mt-2.5 rounded-lg bg-secondary/50 px-2.5 py-1.5 text-[11px]">
                                <div className="font-medium text-foreground">
                                  {lead.parentName || "Parent / Guardian"}
                                </div>
                                {lead.parentPhone && (
                                  <div className="font-mono text-[10px] text-muted-foreground">
                                    {lead.parentPhone}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Stage-specific contextual badges */}
                            {stage.id === "trial_scheduled" && (
                              <div className="mt-2 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2.5 py-1.5 text-[11px] text-indigo-700 dark:text-indigo-200">
                                <div className="flex items-center gap-1 font-semibold">
                                  <Calendar className="size-3" />
                                  {trialSession
                                    ? `${trialSession.title} (${trialSession.date})`
                                    : lead.trialDate
                                      ? `Trial Date: ${lead.trialDate}`
                                      : "Trial Session Pending"}
                                </div>
                                {(trialSession?.team || lead.trialTeam) && (
                                  <div className="text-[10px] opacity-85">
                                    Squad: {trialSession?.team || lead.trialTeam}
                                  </div>
                                )}
                              </div>
                            )}

                            {stage.id === "pending_registration" && (
                              <div className="mt-2 rounded-lg border border-purple-500/30 bg-purple-500/10 px-2.5 py-1.5 text-[11px] text-purple-700 dark:text-purple-200">
                                <div className="font-semibold">
                                  Offer: {money(lead.offeredMonthlyFee ?? 85)} / mo
                                </div>
                                {lead.offerSentDate && (
                                  <div className="font-mono text-[10px] opacity-80">
                                    Sent {lead.offerSentDate}
                                  </div>
                                )}
                              </div>
                            )}

                            {stage.id === "idle_followup" && (
                              <div className="mt-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-200">
                                <div className="flex items-center justify-between font-semibold">
                                  <span>Idle since {lead.idleSinceDate || "N/A"}</span>
                                  <span className="font-mono">
                                    {lead.missedSessionsSinceIdle ?? 0} missed
                                  </span>
                                </div>
                                {lead.lastTeam && (
                                  <div className="text-[10px] opacity-85">
                                    Team: {lead.lastTeam}
                                  </div>
                                )}
                              </div>
                            )}

                            {stage.id === "lost_churned" && (
                              <div className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-700 dark:text-rose-200">
                                <div className="line-clamp-2 font-medium">
                                  Reason: {lead.churnReason || "Unspecified"}
                                </div>
                                <div className="mt-0.5 font-mono text-[10px] opacity-85">
                                  Last Team: {lead.lastTeam || "N/A"} • Idle{" "}
                                  {lead.idleDurationDays ?? 0}d
                                </div>
                              </div>
                            )}

                            {stage.id === "aftersales_retention" && (
                              <div className="mt-2 rounded-lg border border-teal-500/30 bg-teal-500/10 px-2.5 py-1.5 text-[11px] text-teal-700 dark:text-teal-200">
                                <div className="flex items-center gap-1 font-semibold">
                                  <ShoppingBag className="size-3" />
                                  {lead.aftersalesCategory || "Parent Check-In"}
                                </div>
                                {lead.gearUpsellNotes && (
                                  <div className="line-clamp-1 text-[10px] opacity-85">
                                    {lead.gearUpsellNotes}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Activity & Reminders Footer */}
                            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1.5 text-[10px] text-muted-foreground">
                              <span>
                                {(lead.communications || []).length} comm{" "}
                                {(lead.communications || []).length === 1 ? "log" : "logs"}
                              </span>
                              {pendingReminders.length > 0 && (
                                <span
                                  className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono font-semibold ${
                                    overdueReminders.length > 0
                                      ? "bg-rose-500/20 text-rose-600 dark:text-rose-300"
                                      : "bg-secondary text-foreground"
                                  }`}
                                >
                                  <Clock className="size-2.5" />
                                  {pendingReminders[0].dueDate}
                                </span>
                              )}
                            </div>

                            {lastComm && (
                              <div className="mt-1.5 line-clamp-1 border-t border-border/50 pt-1.5 text-[10px] text-muted-foreground italic">
                                {lastComm.type}: "{lastComm.note}"
                              </div>
                            )}

                            {/* Quick Stage Selector & Actions (stopPropagation) */}
                            <div
                              className="mt-2.5 flex items-center justify-between gap-1.5 border-t border-border pt-2"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <select
                                value={lead.stage}
                                onChange={(e) =>
                                  handleStageChange(lead, e.target.value as CrmStage)
                                }
                                className="max-w-[165px] truncate rounded-lg border border-border bg-secondary/60 px-2 py-1 text-[10px] font-semibold text-foreground focus:outline-hidden"
                              >
                                {CRM_STAGE_CONFIG.map((st) => (
                                  <option key={st.id} value={st.id}>
                                    → {st.shortLabel}
                                  </option>
                                ))}
                              </select>

                              <div className="flex items-center gap-1">
                                {lead.parentPhone && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openDirectWhatsApp(
                                        lead.parentPhone!,
                                        `Hi ${lead.parentName || "there"}, checking in from ${db.academy?.name || "the Basketball Academy"} regarding ${lead.playerName}.`,
                                      )
                                    }
                                    className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-1.5 text-emerald-600 hover:bg-emerald-500/20 dark:text-emerald-300"
                                    title="WhatsApp Parent"
                                  >
                                    <MessageCircle className="size-3.5" />
                                  </button>
                                )}
                                {lead.stage !== "active_converted" && (
                                  <button
                                    type="button"
                                    onClick={() => convertCrmLeadToPlayer(lead.id)}
                                    className="rounded-lg border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary hover:bg-primary/20"
                                    title="Convert / Activate Player in Academy Roster"
                                  >
                                    Activate
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* LIST VIEW */
          <div className="overflow-hidden rounded-2xl border border-border bg-card">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-secondary/40 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                  <tr>
                    <th className="px-4 py-3">Player & DOB</th>
                    <th className="px-4 py-3">CRM Stage</th>
                    <th className="px-4 py-3">Parent / Contact</th>
                    <th className="px-4 py-3">Branch / Position</th>
                    <th className="px-4 py-3">Trial / Idle / Churn Context</th>
                    <th className="px-4 py-3">Activity & Reminders</th>
                    <th className="px-4 py-3 text-right">Quick Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredLeads.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-12 text-center text-muted-foreground">
                        No CRM records match your current filters.
                      </td>
                    </tr>
                  ) : (
                    filteredLeads.map((lead) => {
                      const stConfig =
                        CRM_STAGE_CONFIG.find((s) => s.id === lead.stage) || CRM_STAGE_CONFIG[0];
                      const dueRems = (lead.reminders || []).filter((r) => !r.completed);
                      return (
                        <tr
                          key={lead.id}
                          onClick={() => setSelectedLeadId(lead.id)}
                          className="cursor-pointer transition-colors hover:bg-secondary/30"
                        >
                          <td className="px-4 py-3">
                            <div className="font-semibold text-foreground">{lead.playerName}</div>
                            <div className="font-mono text-[11px] text-muted-foreground">
                              DOB: {lead.dob || "N/A"} • {lead.category || "U-14"}
                            </div>
                          </td>
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <select
                              value={lead.stage}
                              onChange={(e) => handleStageChange(lead, e.target.value as CrmStage)}
                              className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${stConfig.badgeBg} ${stConfig.badgeText}`}
                            >
                              {CRM_STAGE_CONFIG.map((st) => (
                                <option key={st.id} value={st.id}>
                                  {st.label}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium text-foreground">
                              {lead.parentName || "—"}
                            </div>
                            <div className="font-mono text-[11px] text-muted-foreground">
                              {lead.parentPhone || lead.parentEmail || "No phone"}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-medium">{lead.preferredBranch || "HQ"}</div>
                            <div className="text-[11px] text-muted-foreground">
                              {lead.preferredPosition || "—"} • {lead.source || "Direct"}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            {lead.stage === "idle_followup" && (
                              <span className="font-mono text-[11px] text-amber-600 dark:text-amber-300">
                                Idle since {lead.idleSinceDate || "N/A"} (
                                {lead.missedSessionsSinceIdle ?? 0} missed)
                              </span>
                            )}
                            {lead.stage === "lost_churned" && (
                              <span className="text-[11px] text-rose-600 dark:text-rose-300">
                                {lead.churnReason || "Churned"} (Team: {lead.lastTeam || "N/A"})
                              </span>
                            )}
                            {lead.stage === "trial_scheduled" && (
                              <span className="text-[11px] text-indigo-600 dark:text-indigo-300">
                                Trial: {lead.trialTeam || "Squad"} ({lead.trialDate || "TBD"})
                              </span>
                            )}
                            {lead.stage === "pending_registration" && (
                              <span className="font-mono text-[11px] text-purple-600 dark:text-purple-300">
                                Offer: {money(lead.offeredMonthlyFee ?? 85)}/mo
                              </span>
                            )}
                            {lead.stage === "aftersales_retention" && (
                              <span className="text-[11px] text-teal-600 dark:text-teal-300">
                                {lead.aftersalesCategory || "Retention"} • Camp:{" "}
                                {lead.campInviteStatus || "Not Sent"}
                              </span>
                            )}
                            {(lead.stage === "inquiry" || lead.stage === "active_converted") && (
                              <span className="text-[11px] text-muted-foreground">
                                {lead.generalNotes || "—"}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <div className="font-mono text-[11px]">
                              {(lead.communications || []).length} logs • {dueRems.length} open
                              reminders
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => setSelectedLeadId(lead.id)}
                                className="rounded-lg border border-border bg-secondary/60 px-2.5 py-1 text-[11px] font-semibold hover:bg-secondary"
                              >
                                Open Log
                              </button>
                              {lead.stage !== "active_converted" && (
                                <button
                                  type="button"
                                  onClick={() => convertCrmLeadToPlayer(lead.id)}
                                  className="rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
                                >
                                  Activate
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* CLIENT INFORMATION & ACTIVITY LOG DRAWER / MODAL */}
        <Modal
          open={Boolean(selectedLead)}
          onClose={() => setSelectedLeadId(null)}
          title={
            selectedLead
              ? `${selectedLead.playerName} — CRM Client Profile & Activity Log`
              : "CRM Client Profile"
          }
          wide
        >
          {selectedLead && (
            <div className="space-y-6 p-4">
              {/* Top Status & Quick Stage Transition Banner */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-secondary/30 p-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-lg font-bold text-foreground">
                      {selectedLead.playerName}
                    </span>
                    <span className="rounded-md bg-primary/15 px-2 py-0.5 font-mono text-xs font-semibold text-primary">
                      {selectedLead.category || "U-14"}
                    </span>
                    <span className="rounded-md bg-secondary px-2 py-0.5 font-mono text-xs text-muted-foreground">
                      DOB: {selectedLead.dob || "N/A"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Preferred Branch: <strong>{selectedLead.preferredBranch || "HQ"}</strong> •
                    Position: <strong>{selectedLead.preferredPosition || "Guard"}</strong> • Source:{" "}
                    <strong>{selectedLead.source || "Direct"}</strong>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={selectedLead.stage}
                    onChange={(e) => handleStageChange(selectedLead, e.target.value as CrmStage)}
                    className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-bold text-foreground"
                  >
                    {CRM_STAGE_CONFIG.map((st) => (
                      <option key={st.id} value={st.id}>
                        Stage: {st.label}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => handleOpenEditLead(selectedLead)}
                    className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold hover:bg-secondary"
                  >
                    Edit Details
                  </button>

                  {selectedLead.stage !== "active_converted" && (
                    <button
                      type="button"
                      onClick={() => convertCrmLeadToPlayer(selectedLead.id)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-500"
                    >
                      <UserPlus className="size-3.5" />
                      Convert / Activate in Academy
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => handleDeleteLead(selectedLead)}
                    className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-2 text-rose-500 hover:bg-rose-500/20"
                    title="Delete CRM Card"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>

              {/* Grid: Left = Client & Stage Details, Right = Communication Log & Reminders */}
              <div className="grid gap-5 lg:grid-cols-12">
                <div className="space-y-4 lg:col-span-5">
                  {/* Parent / Guardian Card */}
                  <div className="rounded-2xl border border-border bg-card p-4">
                    <h4 className="font-mono text-xs font-bold tracking-wider text-muted-foreground uppercase">
                      Parent / Guardian & Medical Details
                    </h4>
                    <div className="mt-3 space-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Primary Guardian:</span>
                        <span className="font-semibold text-foreground">
                          {selectedLead.parentName || "—"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-muted-foreground">Primary Phone:</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold">
                            {selectedLead.parentPhone || "—"}
                          </span>
                          {selectedLead.parentPhone && (
                            <button
                              type="button"
                              onClick={() =>
                                openDirectWhatsApp(
                                  selectedLead.parentPhone!,
                                  `Hello ${selectedLead.parentName || ""}, reaching out from ${db.academy?.name || "Vescio Vector Academy"} regarding ${selectedLead.playerName}.`,
                                )
                              }
                              className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-300"
                            >
                              <MessageCircle className="size-3" />
                              WhatsApp
                            </button>
                          )}
                        </div>
                      </div>
                      {selectedLead.parentEmail && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Email:</span>
                          <span className="font-mono">{selectedLead.parentEmail}</span>
                        </div>
                      )}
                      {(selectedLead.guardian2Name || selectedLead.guardian2Phone) && (
                        <div className="flex justify-between border-t border-border/60 pt-2">
                          <span className="text-muted-foreground">Guardian 2:</span>
                          <span className="font-semibold">
                            {selectedLead.guardian2Name || "—"} (
                            {selectedLead.guardian2Phone || "—"})
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between border-t border-border/60 pt-2">
                        <span className="text-muted-foreground">School:</span>
                        <span>{selectedLead.school || "—"}</span>
                      </div>
                      <div className="border-t border-border/60 pt-2">
                        <div className="text-muted-foreground">Medical / Allergy Notes:</div>
                        <div className="mt-1 rounded-lg bg-secondary/40 p-2 text-foreground">
                          {selectedLead.medicalNotes || "No medical conditions reported."}
                        </div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">
                          General Scouting / Evaluation Notes:
                        </div>
                        <div className="mt-1 rounded-lg bg-secondary/40 p-2 text-foreground">
                          {selectedLead.generalNotes || "No general notes."}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Stage-Specific Context Box */}
                  <div className="rounded-2xl border border-border bg-card p-4">
                    <h4 className="font-mono text-xs font-bold tracking-wider text-muted-foreground uppercase">
                      Pipeline Stage Context
                    </h4>
                    <div className="mt-3 space-y-2.5 text-xs">
                      <div>
                        <span className="text-muted-foreground">Trial Session Evaluation:</span>
                        <div className="mt-1 font-medium">
                          {selectedLead.trialSessionId
                            ? (db.sessions || []).find((s) => s.id === selectedLead.trialSessionId)
                                ?.title || selectedLead.trialSessionId
                            : selectedLead.trialDate
                              ? `Scheduled on ${selectedLead.trialDate} (${selectedLead.trialTeam || "TBD"})`
                              : "No trial session linked"}
                        </div>
                        {selectedLead.trialEvaluationNotes && (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            Eval: {selectedLead.trialEvaluationNotes}
                          </div>
                        )}
                      </div>

                      <div className="border-t border-border/60 pt-2">
                        <span className="text-muted-foreground">Idle / Churned Tracking:</span>
                        <div className="mt-1 grid grid-cols-2 gap-2">
                          <div className="rounded-lg bg-secondary/40 p-2">
                            <div className="text-[10px] text-muted-foreground">Idle Since</div>
                            <div className="font-mono font-semibold">
                              {selectedLead.idleSinceDate || "—"}
                            </div>
                          </div>
                          <div className="rounded-lg bg-secondary/40 p-2">
                            <div className="text-[10px] text-muted-foreground">Missed Sessions</div>
                            <div className="font-mono font-semibold">
                              {selectedLead.missedSessionsSinceIdle ?? 0} (
                              {selectedLead.idleDurationDays ?? 0}d)
                            </div>
                          </div>
                        </div>
                        {selectedLead.churnReason && (
                          <div className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 p-2 text-rose-600 dark:text-rose-300">
                            <strong>Churn Reason:</strong> {selectedLead.churnReason}
                            {selectedLead.reEngagementNotes && (
                              <div className="mt-1 text-[11px]">
                                <strong>Re-Engagement Plan:</strong>{" "}
                                {selectedLead.reEngagementNotes}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="border-t border-border/60 pt-2">
                        <span className="text-muted-foreground">Aftersales & Retention:</span>
                        <div className="mt-1 text-[11px]">
                          Focus:{" "}
                          <strong>{selectedLead.aftersalesCategory || "Parent Check-In"}</strong> •
                          Camp Invite:{" "}
                          <strong>{selectedLead.campInviteStatus || "Not Sent"}</strong>
                        </div>
                        {selectedLead.gearUpsellNotes && (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            Gear / Upsell: {selectedLead.gearUpsellNotes}
                          </div>
                        )}
                        {selectedLead.feedbackLog && (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            Parent Feedback: {selectedLead.feedbackLog}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Column: Communication Log, Reminders & Linked Player Payment/Attendance History */}
                <div className="space-y-4 lg:col-span-7">
                  {/* Communication Log */}
                  <div className="rounded-2xl border border-border bg-card p-4">
                    <div className="flex items-center justify-between">
                      <h4 className="font-mono text-xs font-bold tracking-wider text-muted-foreground uppercase">
                        Communication Log (Call, WhatsApp, Email, In-Person)
                      </h4>
                      <span className="font-mono text-xs text-muted-foreground">
                        {(selectedLead.communications || []).length} entries
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <select
                        value={newCommType}
                        onChange={(e) =>
                          setNewCommType(e.target.value as CrmCommunicationEntry["type"])
                        }
                        className="rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold"
                      >
                        <option value="WhatsApp">WhatsApp</option>
                        <option value="Call">Phone Call</option>
                        <option value="Email">Email</option>
                        <option value="In-Person">In-Person</option>
                      </select>
                      <input
                        type="text"
                        value={newCommNote}
                        onChange={(e) => setNewCommNote(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddCommunication();
                          }
                        }}
                        placeholder="Log call outcome, parent feedback, WhatsApp message, or trial notes..."
                        className="min-w-[220px] flex-1 rounded-xl border border-border bg-background px-3 py-2 text-xs"
                      />
                      <button
                        type="button"
                        onClick={handleAddCommunication}
                        className="rounded-xl bg-primary px-3.5 py-2 text-xs font-bold text-primary-foreground"
                      >
                        Log Note
                      </button>
                    </div>

                    <div className="mt-3 max-h-52 space-y-2 overflow-y-auto pr-1">
                      {(selectedLead.communications || []).length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
                          No communication entries logged yet.
                        </div>
                      ) : (
                        (selectedLead.communications || []).map((c) => (
                          <div
                            key={c.id}
                            className="rounded-xl border border-border/80 bg-secondary/30 p-2.5 text-xs"
                          >
                            <div className="flex items-center justify-between">
                              <span className="inline-flex items-center gap-1.5 font-semibold text-foreground">
                                {c.type === "Call" && <Phone className="size-3 text-sky-500" />}
                                {c.type === "WhatsApp" && (
                                  <MessageCircle className="size-3 text-emerald-500" />
                                )}
                                {c.type === "Email" && <Mail className="size-3 text-indigo-500" />}
                                {c.type === "In-Person" && (
                                  <Users className="size-3 text-amber-500" />
                                )}
                                {c.type}
                              </span>
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {(c.timestamp || c.createdAt || "").replace("T", " ").slice(0, 16)}{" "}
                                • {c.author || "Admin"}
                              </span>
                            </div>
                            <p className="mt-1 text-muted-foreground">{c.note}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>

                  {/* Follow-Up Reminders */}
                  <div className="rounded-2xl border border-border bg-card p-4">
                    <h4 className="font-mono text-xs font-bold tracking-wider text-muted-foreground uppercase">
                      Follow-Up Reminders & Due Dates
                    </h4>

                    <div className="mt-3 flex flex-wrap gap-2">
                      <input
                        type="text"
                        value={newReminderTitle}
                        onChange={(e) => setNewReminderTitle(e.target.value)}
                        placeholder="e.g., Call parent after trial session / Check renewal payment..."
                        className="min-w-[200px] flex-1 rounded-xl border border-border bg-background px-3 py-2 text-xs"
                      />
                      <input
                        type="date"
                        value={newReminderDue}
                        onChange={(e) => setNewReminderDue(e.target.value)}
                        className="rounded-xl border border-border bg-background px-3 py-2 font-mono text-xs"
                      />
                      <button
                        type="button"
                        onClick={handleAddReminder}
                        className="rounded-xl border border-primary/40 bg-primary/15 px-3.5 py-2 text-xs font-bold text-primary hover:bg-primary/25"
                      >
                        Add Reminder
                      </button>
                    </div>

                    <div className="mt-3 space-y-1.5">
                      {(selectedLead.reminders || []).length === 0 ? (
                        <div className="rounded-xl border border-dashed border-border py-4 text-center text-xs text-muted-foreground">
                          No follow-up reminders scheduled.
                        </div>
                      ) : (
                        (selectedLead.reminders || []).map((rem) => {
                          const isOverdue = !rem.completed && rem.dueDate <= todayIso;
                          return (
                            <div
                              key={rem.id}
                              onClick={() => handleToggleReminder(rem.id)}
                              className={`flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2 text-xs transition-colors ${
                                rem.completed
                                  ? "border-border/50 bg-secondary/20 opacity-60 line-through"
                                  : isOverdue
                                    ? "border-rose-500/40 bg-rose-500/10"
                                    : "border-border bg-background"
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <CheckCircle2
                                  className={`size-4 ${
                                    rem.completed ? "text-emerald-500" : "text-muted-foreground"
                                  }`}
                                />
                                <span className="font-medium text-foreground">{rem.title}</span>
                              </div>
                              <span
                                className={`font-mono text-[11px] font-semibold ${
                                  isOverdue ? "text-rose-500" : "text-muted-foreground"
                                }`}
                              >
                                Due {rem.dueDate}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  {/* Linked Academy Player Full Payment & Attendance History */}
                  <div className="rounded-2xl border border-border bg-card p-4">
                    <div className="flex items-center justify-between">
                      <h4 className="font-mono text-xs font-bold tracking-wider text-muted-foreground uppercase">
                        Linked Academy Player Payment & Attendance History
                      </h4>
                      {linkedAcademyPlayer && (
                        <Link
                          to="/players"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                        >
                          View in Roster <ExternalLink className="size-3" />
                        </Link>
                      )}
                    </div>

                    {!linkedAcademyPlayer ? (
                      <div className="mt-3 rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                        This CRM lead is not yet linked to an Academy player record. Click{" "}
                        <strong>Convert / Activate in Academy</strong> to create or link their
                        player profile.
                      </div>
                    ) : (
                      <div className="mt-3 space-y-3 text-xs">
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-secondary/40 p-3">
                          <div>
                            <div className="font-bold text-foreground">
                              {linkedAcademyPlayer.name} ({linkedAcademyPlayer.status})
                            </div>
                            <div className="text-[11px] text-muted-foreground">
                              Teams: {linkedAcademyPlayer.teams?.join(", ") || "None"} • Monthly
                              Fee: {money(linkedAcademyPlayer.fee)}
                            </div>
                          </div>
                          <div className="text-right font-mono">
                            <div className="text-[10px] text-muted-foreground">OPEN BALANCE</div>
                            <div
                              className={`text-sm font-bold ${
                                linkedAcademyPlayer.balance > 0
                                  ? "text-rose-500"
                                  : "text-emerald-500"
                              }`}
                            >
                              {money(linkedAcademyPlayer.balance)}
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          {/* Payment / Invoice History */}
                          <div className="rounded-xl border border-border p-3">
                            <div className="font-mono text-[10px] font-bold text-muted-foreground uppercase">
                              Invoices & Payments ({linkedPlayerHistory.invoices.length})
                            </div>
                            <div className="mt-2 max-h-36 space-y-1.5 overflow-y-auto">
                              {linkedPlayerHistory.invoices.length === 0 ? (
                                <div className="text-[11px] text-muted-foreground">
                                  No invoices recorded yet.
                                </div>
                              ) : (
                                linkedPlayerHistory.invoices.slice(0, 8).map((inv) => (
                                  <div
                                    key={inv.id}
                                    className="flex items-center justify-between border-b border-border/50 pb-1 text-[11px]"
                                  >
                                    <div>
                                      <span className="font-medium">{inv.billingMonth}</span>
                                      <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                                        ({inv.status})
                                      </span>
                                    </div>
                                    <span className="font-mono font-semibold">
                                      {money(inv.netAmount ?? inv.amount ?? 0)}
                                    </span>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>

                          {/* Attendance History */}
                          <div className="rounded-xl border border-border p-3">
                            <div className="font-mono text-[10px] font-bold text-muted-foreground uppercase">
                              Session Attendance ({linkedPlayerHistory.attendanceLogs.length})
                            </div>
                            <div className="mt-2 max-h-36 space-y-1.5 overflow-y-auto">
                              {linkedPlayerHistory.attendanceLogs.length === 0 ? (
                                <div className="text-[11px] text-muted-foreground">
                                  No session attendance logs found.
                                </div>
                              ) : (
                                linkedPlayerHistory.attendanceLogs.slice(0, 8).map((log) => (
                                  <div
                                    key={log.sessionId}
                                    className="flex items-center justify-between border-b border-border/50 pb-1 text-[11px]"
                                  >
                                    <div className="truncate pr-2">
                                      <span className="font-mono text-[10px] text-muted-foreground">
                                        {log.date}
                                      </span>{" "}
                                      <span>{log.team}</span>
                                    </div>
                                    <span
                                      className={`font-mono text-[10px] font-bold ${
                                        log.status === "Present"
                                          ? "text-emerald-500"
                                          : log.status === "Excused"
                                            ? "text-amber-500"
                                            : "text-rose-500"
                                      }`}
                                    >
                                      {log.status}
                                    </span>
                                  </div>
                                ))
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </Modal>

        {/* CREATE / EDIT CRM LEAD MODAL */}
        <Modal
          open={isLeadFormOpen}
          onClose={() => {
            setIsLeadFormOpen(false);
            setEditingLead(null);
          }}
          title={
            editingLead?.playerName
              ? `Edit CRM Card: ${editingLead.playerName}`
              : "New CRM Lead / Client Card"
          }
          wide
        >
          {editingLead && (
            <div className="space-y-4 p-4">
              <div className="grid items-end gap-3 sm:grid-cols-3">
                <Field label="Player Full Name *">
                  <input
                    type="text"
                    value={editingLead.playerName}
                    onChange={(e) => setEditingLead({ ...editingLead, playerName: e.target.value })}
                    placeholder="e.g., Karim Mansour"
                    className="h-10 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs leading-tight"
                  />
                </Field>
                <Field label="Pipeline Stage">
                  <select
                    value={editingLead.stage}
                    onChange={(e) =>
                      setEditingLead({ ...editingLead, stage: e.target.value as CrmStage })
                    }
                    className="h-10 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold leading-tight"
                  >
                    {CRM_STAGE_CONFIG.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Date of Birth (DOB)">
                  <input
                    type="date"
                    value={editingLead.dob || ""}
                    onChange={(e) => setEditingLead({ ...editingLead, dob: e.target.value })}
                    className="h-10 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-xs leading-tight"
                  />
                </Field>
              </div>

              <div className="grid items-end gap-3 sm:grid-cols-4">
                <Field label="Age Category">
                  <select
                    value={editingLead.category || "U-14"}
                    onChange={(e) => setEditingLead({ ...editingLead, category: e.target.value })}
                    className="h-10 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs leading-tight"
                  >
                    {(
                      db.lists?.["Age categories"] || [
                        "U-10",
                        "U-12",
                        "U-14",
                        "U-16",
                        "U-18",
                        "Senior",
                      ]
                    ).map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Preferred Branch">
                  <select
                    value={editingLead.preferredBranch || "HQ"}
                    onChange={(e) =>
                      setEditingLead({ ...editingLead, preferredBranch: e.target.value })
                    }
                    className="h-10 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs leading-tight"
                  >
                    {(db.branches || []).map((b) => (
                      <option key={b.id} value={b.name}>
                        {b.name}
                      </option>
                    ))}
                    {(!db.branches || db.branches.length === 0) && <option value="HQ">HQ</option>}
                  </select>
                </Field>
                <Field label="Preferred Position">
                  <select
                    value={editingLead.preferredPosition || BASKETBALL_POSITIONS[0]}
                    onChange={(e) =>
                      setEditingLead({ ...editingLead, preferredPosition: e.target.value })
                    }
                    className="h-10 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs leading-tight"
                  >
                    {BASKETBALL_POSITIONS.map((pos) => (
                      <option key={pos} value={pos}>
                        {pos}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Lead Source">
                  <select
                    value={editingLead.source || LEAD_SOURCES[0]}
                    onChange={(e) => setEditingLead({ ...editingLead, source: e.target.value })}
                    className="h-10 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs leading-tight"
                  >
                    {LEAD_SOURCES.map((src) => (
                      <option key={src} value={src}>
                        {src}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="grid items-end gap-3 sm:grid-cols-3">
                <Field label="Parent / Guardian Name">
                  <input
                    type="text"
                    value={editingLead.parentName || ""}
                    onChange={(e) => setEditingLead({ ...editingLead, parentName: e.target.value })}
                    placeholder="Parent Full Name"
                    className="h-10 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs leading-tight"
                  />
                </Field>
                <Field label="Parent Phone (WhatsApp)">
                  <input
                    type="text"
                    value={editingLead.parentPhone || ""}
                    onChange={(e) =>
                      setEditingLead({ ...editingLead, parentPhone: e.target.value })
                    }
                    placeholder="+961 3 000 000"
                    className="h-10 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-xs leading-tight"
                  />
                </Field>
                <Field label="Parent Email">
                  <input
                    type="email"
                    value={editingLead.parentEmail || ""}
                    onChange={(e) =>
                      setEditingLead({ ...editingLead, parentEmail: e.target.value })
                    }
                    placeholder="parent@example.com"
                    className="h-10 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-xs leading-tight"
                  />
                </Field>
              </div>

              {/* Trial Scheduled Evaluation Fields */}
              <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/5 p-3.5">
                <div className="mb-2 font-mono text-[10px] font-bold tracking-wider text-indigo-600 uppercase dark:text-indigo-300">
                  Trial Session Evaluation Link (For Trial Scheduled Stage)
                </div>
                <div className="grid items-end gap-3 sm:grid-cols-3">
                  <Field label="Link to Existing Team Session">
                    <select
                      value={editingLead.trialSessionId || ""}
                      onChange={(e) => {
                        const sess = (db.sessions || []).find((s) => s.id === e.target.value);
                        setEditingLead({
                          ...editingLead,
                          trialSessionId: e.target.value,
                          trialDate: sess?.date || editingLead.trialDate,
                          trialTeam: sess?.team || sess?.teamA || editingLead.trialTeam,
                        });
                      }}
                      className="h-10 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs leading-tight"
                    >
                      <option value="">— Select Team Session —</option>
                      {(db.sessions || []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.date} • {s.title} ({s.team || s.branch})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Trial Team / Squad">
                    <select
                      value={editingLead.trialTeam || ""}
                      onChange={(e) =>
                        setEditingLead({ ...editingLead, trialTeam: e.target.value })
                      }
                      className="h-10 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs leading-tight"
                    >
                      <option value="">— Select Squad —</option>
                      {(db.teams || []).map((t) => (
                        <option key={t.id} value={t.name}>
                          {t.name} ({t.category})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Offered Monthly Tuition ($)">
                    <input
                      type="number"
                      value={editingLead.offeredMonthlyFee ?? 85}
                      onChange={(e) =>
                        setEditingLead({
                          ...editingLead,
                          offeredMonthlyFee: Number(e.target.value) || 0,
                        })
                      }
                      className="h-10 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-xs leading-tight"
                    />
                  </Field>
                  <Field label="Registration / Trial Fee Collected ($)">
                    <input
                      type="number"
                      min={0}
                      value={editingLead.registrationFeeCollected ?? 0}
                      onChange={(e) =>
                        setEditingLead({
                          ...editingLead,
                          registrationFeeCollected: Math.max(0, Number(e.target.value) || 0),
                        })
                      }
                      placeholder="0 (optional)"
                      className="h-10 w-full rounded-xl border border-border bg-background px-3 py-2 font-mono text-xs leading-tight"
                    />
                  </Field>
                </div>
              </div>

              {/* Lost / Churned & Aftersales Fields */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-3">
                  <div className="mb-2 font-mono text-[10px] font-bold tracking-wider text-rose-600 uppercase dark:text-rose-300">
                    Lost / Churned Details
                  </div>
                  <Field label="Reason for Leaving">
                    <input
                      type="text"
                      value={editingLead.churnReason || ""}
                      onChange={(e) =>
                        setEditingLead({ ...editingLead, churnReason: e.target.value })
                      }
                      placeholder="e.g., Exam schedule conflict / Injury / Relocation"
                      className="h-10 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs leading-tight"
                    />
                  </Field>
                  <div className="mt-2">
                    <Field label="Re-Engagement Notes">
                      <input
                        type="text"
                        value={editingLead.reEngagementNotes || ""}
                        onChange={(e) =>
                          setEditingLead({ ...editingLead, reEngagementNotes: e.target.value })
                        }
                        placeholder="e.g., Invite to Summer Camp in June"
                        className="h-10 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs leading-tight"
                      />
                    </Field>
                  </div>
                </div>

                <div className="rounded-xl border border-teal-500/25 bg-teal-500/5 p-3">
                  <div className="mb-2 font-mono text-[10px] font-bold tracking-wider text-teal-600 uppercase dark:text-teal-300">
                    Aftersales & Retention
                  </div>
                  <div className="grid grid-cols-2 items-end gap-2">
                    <Field label="Retention Track">
                      <select
                        value={editingLead.aftersalesCategory || "Parent Check-In"}
                        onChange={(e) =>
                          setEditingLead({
                            ...editingLead,
                            aftersalesCategory: e.target.value as CrmLead["aftersalesCategory"],
                          })
                        }
                        className="h-10 w-full rounded-xl border border-border bg-background px-2.5 py-2 text-xs leading-tight"
                      >
                        <option value="Parent Check-In">Parent Check-In</option>
                        <option value="Gear / Uniform Upsell">Gear / Uniform Upsell</option>
                        <option value="Camp Invite">Camp Invite</option>
                        <option value="Feedback Log">Feedback Log</option>
                      </select>
                    </Field>
                    <Field label="Camp Invite Status">
                      <select
                        value={editingLead.campInviteStatus || "Not Sent"}
                        onChange={(e) =>
                          setEditingLead({
                            ...editingLead,
                            campInviteStatus: e.target.value as CrmLead["campInviteStatus"],
                          })
                        }
                        className="h-10 w-full rounded-xl border border-border bg-background px-2.5 py-2 text-xs leading-tight"
                      >
                        <option value="Not Sent">Not Sent</option>
                        <option value="Invited">Invited</option>
                        <option value="Registered">Registered</option>
                        <option value="Declined">Declined</option>
                      </select>
                    </Field>
                  </div>
                  <div className="mt-2">
                    <Field label="Gear Upsell / Feedback Log">
                      <input
                        type="text"
                        value={editingLead.gearUpsellNotes || ""}
                        onChange={(e) =>
                          setEditingLead({ ...editingLead, gearUpsellNotes: e.target.value })
                        }
                        placeholder="e.g., Needs reversible jersey size YL + warmup hoodie"
                        className="h-10 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs leading-tight"
                      />
                    </Field>
                  </div>
                </div>
              </div>

              <div className="grid items-end gap-3 sm:grid-cols-2">
                <Field label="Medical / Allergy Notes">
                  <input
                    type="text"
                    value={editingLead.medicalNotes || ""}
                    onChange={(e) =>
                      setEditingLead({ ...editingLead, medicalNotes: e.target.value })
                    }
                    placeholder="Asthma inhaler, ankle brace, etc."
                    className="h-10 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs leading-tight"
                  />
                </Field>
                <Field label="General Scouting / Evaluation Notes">
                  <input
                    type="text"
                    value={editingLead.generalNotes || ""}
                    onChange={(e) =>
                      setEditingLead({ ...editingLead, generalNotes: e.target.value })
                    }
                    placeholder="Strong left-hand drive, high defensive energy..."
                    className="h-10 w-full rounded-xl border border-border bg-background px-3 py-2 text-xs leading-tight"
                  />
                </Field>
              </div>

              <div className="flex justify-end gap-2 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsLeadFormOpen(false);
                    setEditingLead(null);
                  }}
                  className="rounded-xl border border-border px-4 py-2 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveLeadForm}
                  className="rounded-xl bg-primary px-5 py-2 text-xs font-bold text-primary-foreground"
                >
                  Save CRM Card
                </button>
              </div>
            </div>
          )}
        </Modal>

        {/* CRM SETTINGS MODAL (IDLE-TO-LOST AUTO-CHURN CONFIGURATION) */}
        <Modal
          open={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          title="CRM Settings — Idle-to-Lost Automation"
        >
          <div className="space-y-4 p-4">
            <div className="rounded-2xl border border-border bg-secondary/30 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold text-foreground">
                    Automatic Idle-to-Lost Churn Engine
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Automatically move any player in the <strong>Idle</strong> state to the{" "}
                    <strong>Lost Clients / Churned</strong> CRM stage if their{" "}
                    <code className="font-mono">idleSinceDate</code> exceeds the configured
                    threshold without payment or attendance.
                  </p>
                </div>
                <input
                  type="checkbox"
                  checked={settingsDraft.autoChurnEnabled}
                  onChange={(e) =>
                    setSettingsDraft({
                      ...settingsDraft,
                      autoChurnEnabled: e.target.checked,
                    })
                  }
                  className="size-4 accent-primary"
                />
              </div>
            </div>

            <Field label="Auto-Churn Threshold Mode">
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() =>
                    setSettingsDraft({
                      ...settingsDraft,
                      autoChurnMode: "1_month",
                      autoChurnWeeks: 4,
                    })
                  }
                  className={`rounded-xl border p-3 text-left transition-all ${
                    settingsDraft.autoChurnMode === "1_month"
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  <div className="text-xs font-bold">1 Month (Standard)</div>
                  <div className="mt-0.5 text-[11px] opacity-80">
                    Auto-churn after 30 days Idle without payment or attendance
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    setSettingsDraft({
                      ...settingsDraft,
                      autoChurnMode: "custom_weeks",
                    })
                  }
                  className={`rounded-xl border p-3 text-left transition-all ${
                    settingsDraft.autoChurnMode === "custom_weeks"
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-background text-muted-foreground"
                  }`}
                >
                  <div className="text-xs font-bold">Custom Number of Weeks</div>
                  <div className="mt-0.5 text-[11px] opacity-80">
                    Choose 2, 4, 6, 8 weeks or any custom week threshold
                  </div>
                </button>
              </div>
            </Field>

            {settingsDraft.autoChurnMode === "custom_weeks" && (
              <Field label="Custom Weeks Threshold (Idle Duration)">
                <div className="flex flex-wrap items-center gap-2">
                  {[2, 4, 6, 8].map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => setSettingsDraft({ ...settingsDraft, autoChurnWeeks: w })}
                      className={`rounded-xl border px-3.5 py-2 font-mono text-xs font-bold ${
                        settingsDraft.autoChurnWeeks === w
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-background text-foreground hover:bg-secondary"
                      }`}
                    >
                      {w} Weeks ({w * 7}d)
                    </button>
                  ))}
                  <input
                    type="number"
                    min={1}
                    max={52}
                    value={settingsDraft.autoChurnWeeks}
                    onChange={(e) =>
                      setSettingsDraft({
                        ...settingsDraft,
                        autoChurnWeeks: Math.max(1, Number(e.target.value) || 4),
                      })
                    }
                    className="w-24 rounded-xl border border-border bg-background px-3 py-2 font-mono text-xs"
                  />
                </div>
              </Field>
            )}

            <div className="flex items-center justify-between border-t border-border pt-4">
              <button
                type="button"
                onClick={() => runCrmAutoChurnCheck({ silent: false })}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-secondary px-3.5 py-2 text-xs font-semibold hover:bg-secondary/80"
              >
                <RefreshCw className="size-3.5" />
                Test Auto-Churn Now
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsSettingsOpen(false)}
                  className="rounded-xl border border-border px-4 py-2 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveCrmSettings}
                  className="rounded-xl bg-primary px-5 py-2 text-xs font-bold text-primary-foreground"
                >
                  Save CRM Settings
                </button>
              </div>
            </div>
          </div>
        </Modal>

        {/* QUICK CHURN REASON MODAL WHEN MOVING TO LOST CLIENTS */}
        <Modal
          open={Boolean(churnModalTarget)}
          onClose={() => setChurnModalTarget(null)}
          title={`Move ${churnModalTarget?.playerName || "Player"} to Lost Clients / Churned`}
        >
          {churnModalTarget && (
            <div className="space-y-4 p-4">
              <p className="text-xs text-muted-foreground">
                Record the reason for leaving and re-engagement notes so your coaching and retention
                team can follow up for future cycles or seasonal camps.
              </p>
              <Field label="Reason for Leaving / Churn Reason">
                <input
                  type="text"
                  value={churnReasonInput}
                  onChange={(e) => setChurnReasonInput(e.target.value)}
                  placeholder="e.g., School exams / Injury / Financial / Switched sport"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs"
                />
              </Field>
              <Field label="Re-Engagement Notes">
                <input
                  type="text"
                  value={reEngagementInput}
                  onChange={(e) => setReEngagementInput(e.target.value)}
                  placeholder="e.g., Follow up in 4 weeks before Summer Camp registration"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs"
                />
              </Field>
              <div className="flex justify-end gap-2 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => setChurnModalTarget(null)}
                  className="rounded-xl border border-border px-4 py-2 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmChurnModal}
                  className="rounded-xl bg-rose-600 px-5 py-2 text-xs font-bold text-white hover:bg-rose-500"
                >
                  Confirm Move to Lost Clients
                </button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </AppShell>
  );
}

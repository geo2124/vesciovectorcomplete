import { useEffect, useMemo, useRef, useState } from "react";
import { useDB, findPlayerNextSession } from "@/lib/data-store";
import { Button, Chip, EmptyState, Field, Input, Modal, Panel, Textarea } from "@/components/kit";
import {
  DEFAULT_WHATSAPP_TEMPLATES,
  WHATSAPP_TEMPLATE_VARIABLES,
  buildWhatsAppTemplateContext,
  interpolateWhatsAppTemplate,
  openDirectWhatsApp,
  pushToWhatsApp,
  type WhatsAppTemplate,
  type WhatsAppTemplateCategory,
} from "@/lib/whatsapp";
import {
  Check,
  Copy,
  Edit2,
  FileText,
  MessageSquare,
  Plus,
  RotateCcw,
  Save,
  Search,
  Send,
  Sparkles,
  Trash2,
  User,
  Calendar,
  Building2,
} from "lucide-react";
import { toast } from "sonner";

const TEMPLATE_CATEGORIES: WhatsAppTemplateCategory[] = [
  "Session",
  "Game",
  "Player",
  "Billing",
  "General",
];

const CATEGORY_META: Record<
  WhatsAppTemplateCategory,
  { tone: "court" | "good" | "warn" | "neutral" | "bad"; label: string }
> = {
  Session: { tone: "court", label: "Session Notice" },
  Game: { tone: "warn", label: "Game / Matchday" },
  Player: { tone: "good", label: "Player & Guardian" },
  Billing: { tone: "bad", label: "Billing & Tuition" },
  General: { tone: "neutral", label: "General Broadcast" },
};

interface WhatsAppTemplatesManagerProps {
  onSelectTemplateForBroadcast?: (formattedText: string, template: WhatsAppTemplate) => void;
}

export function WhatsAppTemplatesManager({
  onSelectTemplateForBroadcast,
}: WhatsAppTemplatesManagerProps) {
  const { db, updateAcademy } = useDB();

  const templates = useMemo<WhatsAppTemplate[]>(() => {
    const stored = db.academy?.whatsappTemplates;
    if (Array.isArray(stored) && stored.length > 0) {
      return stored;
    }
    return DEFAULT_WHATSAPP_TEMPLATES;
  }, [db.academy?.whatsappTemplates]);

  const [selectedCategory, setSelectedCategory] = useState<"All" | WhatsAppTemplateCategory>("All");
  const [searchQuery, setSearchQuery] = useState("");

  // Active template being edited
  const [activeTemplateId, setActiveTemplateId] = useState<string>(
    () => templates[0]?.id || DEFAULT_WHATSAPP_TEMPLATES[0].id,
  );
  const [isCreatingNew, setIsCreatingNew] = useState(false);

  const [draftName, setDraftName] = useState("");
  const [draftCategory, setDraftCategory] = useState<WhatsAppTemplateCategory>("Session");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deletingTemplate, setDeletingTemplate] = useState<WhatsAppTemplate | null>(null);

  const bodyTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Live Context Selectors for Dynamic Formatting Preview
  const [selectedPlayerId, setSelectedPlayerId] = useState<string>(() => db.players[0]?.id || "");
  const [selectedSessionId, setSelectedSessionId] = useState<string>(
    () => db.sessions[0]?.id || "",
  );
  const [targetGroupName, setTargetGroupName] = useState<string>(() => db.groups[0]?.name || "");
  const [customMessageOverride, setCustomMessageOverride] = useState<string | null>(null);
  const [copiedPreview, setCopiedPreview] = useState(false);

  // Sync editor fields when activeTemplateId changes
  useEffect(() => {
    if (isCreatingNew) return;
    const found = templates.find((t) => t.id === activeTemplateId) || templates[0];
    if (found) {
      setActiveTemplateId(found.id);
      setDraftName(found.name);
      setDraftCategory(found.category);
      setDraftDescription(found.description || "");
      setDraftBody(found.body);
      setCustomMessageOverride(null);
    }
  }, [activeTemplateId, templates, isCreatingNew]);

  // Keep player/session defaults populated when db loads
  useEffect(() => {
    if (!selectedPlayerId && db.players.length > 0) {
      setSelectedPlayerId(db.players[0].id);
    }
  }, [db.players, selectedPlayerId]);

  useEffect(() => {
    if (!selectedSessionId && db.sessions.length > 0) {
      setSelectedSessionId(db.sessions[0].id);
    }
  }, [db.sessions, selectedSessionId]);

  useEffect(() => {
    if (!targetGroupName && db.groups.length > 0) {
      setTargetGroupName(db.groups[0].name);
    }
  }, [db.groups, targetGroupName]);

  const selectedPlayer = useMemo(
    () => db.players.find((p) => p.id === selectedPlayerId) || null,
    [db.players, selectedPlayerId],
  );

  const selectedSession = useMemo(
    () => db.sessions.find((s) => s.id === selectedSessionId) || null,
    [db.sessions, selectedSessionId],
  );

  // When player changes, optionally auto-select their next scheduled session if available
  const handleSelectPlayer = (playerId: string) => {
    setSelectedPlayerId(playerId);
    setCustomMessageOverride(null);
    const p = db.players.find((x) => x.id === playerId);
    if (p && db.sessions.length > 0) {
      const nextSess = findPlayerNextSession(p, db.sessions);
      if (nextSess) {
        setSelectedSessionId(nextSess.id);
      }
    }
  };

  // Build live variable dictionary
  const variableContext = useMemo(() => {
    return buildWhatsAppTemplateContext({
      academyName: db.academy?.name || "Vescio Vector Academy",
      currency: db.academy?.currency || "USD",
      player: selectedPlayer,
      session: selectedSession,
    });
  }, [db.academy?.name, db.academy?.currency, selectedPlayer, selectedSession]);

  // Dynamically formatted preview text
  const interpolatedPreview = useMemo(() => {
    return interpolateWhatsAppTemplate(draftBody, variableContext);
  }, [draftBody, variableContext]);

  const finalMessageToSend =
    customMessageOverride !== null ? customMessageOverride : interpolatedPreview;

  // Filtered templates list
  const filteredTemplates = useMemo(() => {
    return templates.filter((tpl) => {
      if (selectedCategory !== "All" && tpl.category !== selectedCategory) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          tpl.name.toLowerCase().includes(q) ||
          tpl.body.toLowerCase().includes(q) ||
          (tpl.description || "").toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [templates, selectedCategory, searchQuery]);

  // Detect variables used inside current draftBody
  const detectedVariables = useMemo(() => {
    const matches = draftBody.match(/\{[A-Za-z0-9_]+\}/g) || [];
    return Array.from(new Set(matches.map((m) => m.toUpperCase())));
  }, [draftBody]);

  // Insert variable token at cursor position in textarea
  const handleInsertVariable = (token: string) => {
    const el = bodyTextareaRef.current;
    if (!el) {
      setDraftBody((prev) => `${prev}${prev.endsWith(" ") || !prev ? "" : " "}${token}`);
      setCustomMessageOverride(null);
      return;
    }
    const start = el.selectionStart ?? draftBody.length;
    const end = el.selectionEnd ?? draftBody.length;
    const nextBody = `${draftBody.slice(0, start)}${token}${draftBody.slice(end)}`;
    setDraftBody(nextBody);
    setCustomMessageOverride(null);

    requestAnimationFrame(() => {
      el.focus();
      const nextCursor = start + token.length;
      el.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const handleStartNewTemplate = () => {
    setIsCreatingNew(true);
    setActiveTemplateId("");
    setDraftName("Custom Session Notification");
    setDraftCategory("Session");
    setDraftDescription("Custom notification template with dynamic academy variables");
    setDraftBody(
      `🏀 *{ACADEMY_NAME} — NOTIFICATION*\n\nHello {PLAYER_NAME},\n\n📅 *Session Date:* {SESSION_DATE}\n⏰ *Time:* {SESSION_TIME}\n📋 *Session:* {SESSION_TITLE}\n📍 *Venue:* {VENUE} ({BRANCH_NAME})\n\nSee you on the court!`,
    );
    setCustomMessageOverride(null);
  };

  const handleSelectTemplate = (tpl: WhatsAppTemplate) => {
    setIsCreatingNew(false);
    setActiveTemplateId(tpl.id);
    setDraftName(tpl.name);
    setDraftCategory(tpl.category);
    setDraftDescription(tpl.description || "");
    setDraftBody(tpl.body);
    setCustomMessageOverride(null);
  };

  const handleSaveTemplate = async () => {
    const trimmedName = draftName.trim();
    const trimmedBody = draftBody.trim();
    if (!trimmedName) {
      toast.error("Please enter a template name.");
      return;
    }
    if (!trimmedBody) {
      toast.error("Template message body cannot be empty.");
      return;
    }

    setIsSaving(true);
    try {
      const now = new Date().toISOString();
      let nextTemplates: WhatsAppTemplate[];

      if (isCreatingNew || !templates.some((t) => t.id === activeTemplateId)) {
        const newTemplate: WhatsAppTemplate = {
          id: `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          name: trimmedName,
          category: draftCategory,
          description: draftDescription.trim() || undefined,
          body: trimmedBody,
          isDefault: false,
          updatedAt: now,
        };
        nextTemplates = [newTemplate, ...templates];
        await updateAcademy({ whatsappTemplates: nextTemplates });
        setIsCreatingNew(false);
        setActiveTemplateId(newTemplate.id);
        toast.success(`Saved new WhatsApp template "${newTemplate.name}".`);
      } else {
        nextTemplates = templates.map((t) =>
          t.id === activeTemplateId
            ? {
                ...t,
                name: trimmedName,
                category: draftCategory,
                description: draftDescription.trim() || undefined,
                body: trimmedBody,
                updatedAt: now,
              }
            : t,
        );
        await updateAcademy({ whatsappTemplates: nextTemplates });
        toast.success(`Updated WhatsApp template "${trimmedName}".`);
      }
    } catch {
      // Error toast is already handled by updateAcademy
    } finally {
      setIsSaving(false);
    }
  };

  const handleDuplicateTemplate = async (tpl: WhatsAppTemplate) => {
    const copy: WhatsAppTemplate = {
      ...tpl,
      id: `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: `${tpl.name} (Copy)`,
      isDefault: false,
      updatedAt: new Date().toISOString(),
    };
    const nextTemplates = [copy, ...templates];
    await updateAcademy({ whatsappTemplates: nextTemplates });
    setIsCreatingNew(false);
    setActiveTemplateId(copy.id);
    toast.success(`Duplicated "${tpl.name}".`);
  };

  const confirmDeleteTemplate = async () => {
    if (!deletingTemplate) return;
    const remaining = templates.filter((t) => t.id !== deletingTemplate.id);
    const nextTemplates = remaining.length > 0 ? remaining : DEFAULT_WHATSAPP_TEMPLATES;
    await updateAcademy({ whatsappTemplates: nextTemplates });
    toast.success(`Deleted template "${deletingTemplate.name}".`);
    setDeletingTemplate(null);
    if (activeTemplateId === deletingTemplate.id) {
      setIsCreatingNew(false);
      setActiveTemplateId(nextTemplates[0].id);
    }
  };

  const handleRestoreDefaults = async () => {
    const customOnly = templates.filter(
      (t) => !DEFAULT_WHATSAPP_TEMPLATES.some((def) => def.id === t.id),
    );
    const merged = [...DEFAULT_WHATSAPP_TEMPLATES, ...customOnly];
    await updateAcademy({ whatsappTemplates: merged });
    setIsCreatingNew(false);
    setActiveTemplateId(merged[0].id);
    toast.success("Default WhatsApp templates restored.");
  };

  const handleCopyFormatted = () => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(finalMessageToSend);
      setCopiedPreview(true);
      toast.success("Formatted WhatsApp message copied to clipboard!");
      setTimeout(() => setCopiedPreview(false), 2000);
    }
  };

  const handleSendToPlayerPhone = () => {
    const phone = selectedPlayer?.guardianPhone || selectedPlayer?.phone || "";
    if (!phone) {
      toast.info(
        "Selected player does not have a phone number on file. Opening WhatsApp with formatted text.",
      );
      pushToWhatsApp(finalMessageToSend);
      return;
    }
    openDirectWhatsApp(phone, finalMessageToSend);
    toast.success(
      `Opening WhatsApp chat for ${selectedPlayer?.name || "Player"} (${phone}) with formatted template.`,
    );
  };

  const handlePushToGroup = () => {
    const grp = db.groups.find((g) => g.name === targetGroupName);
    pushToWhatsApp(finalMessageToSend, grp?.link, grp?.adminPhone);
  };

  return (
    <div className="space-y-6">
      {/* Top KPI & Variable Overview Banner */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-ink-800 bg-ink-900/90 p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-ink-400">
              Saved Templates
            </span>
            <FileText className="h-4 w-4 text-court-400" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-ink-100 tabular-nums">
            {templates.length}
          </div>
          <div className="mt-1 text-xs text-ink-400 font-mono">Synced across academy workspace</div>
        </div>

        <div className="rounded-xl border border-ink-800 bg-ink-900/90 p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-ink-400">
              Dynamic Variables
            </span>
            <Sparkles className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="mt-2 text-2xl font-bold font-mono text-emerald-400 tabular-nums">
            {WHATSAPP_TEMPLATE_VARIABLES.length}
          </div>
          <div className="mt-1 text-xs text-ink-400 font-mono truncate">
            {"{PLAYER_NAME}"}, {"{SESSION_DATE}"}, {"{ACADEMY_NAME}"}...
          </div>
        </div>

        <div className="rounded-xl border border-ink-800 bg-ink-900/90 p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-ink-400">
              Academy Context
            </span>
            <Building2 className="h-4 w-4 text-court-400" />
          </div>
          <div className="mt-2 text-base font-bold font-display text-ink-100 truncate">
            {variableContext.ACADEMY_NAME}
          </div>
          <div className="mt-1 text-xs text-ink-400 font-mono">
            Auto-injected for {"{ACADEMY_NAME}"}
          </div>
        </div>

        <div className="rounded-xl border border-ink-800 bg-ink-900/90 p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-ink-400">
              Active Preview Target
            </span>
            <User className="h-4 w-4 text-amber-400" />
          </div>
          <div className="mt-2 text-base font-bold font-display text-ink-100 truncate">
            {variableContext.PLAYER_NAME}
          </div>
          <div className="mt-1 text-xs text-ink-400 font-mono truncate">
            Session: {variableContext.SESSION_DATE}
          </div>
        </div>
      </div>

      {/* Main Split Workspace: Left = Library + Template Editor, Right = Live Variable Formatter & Send */}
      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        {/* Left Column: Template Directory & Editor */}
        <div className="space-y-6">
          <Panel
            title="WhatsApp Notification Templates Library"
            meta="Select a template to customize or create a new reusable template with dynamic variables"
            action={
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="xs" onClick={handleRestoreDefaults}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1" />
                  <span>Reset Defaults</span>
                </Button>
                <Button variant="primary" size="xs" onClick={handleStartNewTemplate}>
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  <span>New Template</span>
                </Button>
              </div>
            }
          >
            <div className="p-4 space-y-4">
              {/* Search & Category Filter Row */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search templates by title or variable..."
                    className="w-full rounded-md bg-ink-950 py-1.5 pl-8 pr-3 font-mono text-xs text-ink-100 placeholder:text-ink-500 ring-1 ring-ink-800 focus:outline-none focus:ring-1 focus:ring-court-500"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {(["All", ...TEMPLATE_CATEGORIES] as const).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setSelectedCategory(cat)}
                      className={`rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors ${
                        selectedCategory === cat
                          ? "bg-court-500 text-ink-950 font-bold"
                          : "bg-ink-950 text-ink-400 hover:text-ink-200 ring-1 ring-ink-800"
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Templates List */}
              {filteredTemplates.length === 0 ? (
                <EmptyState>
                  No templates match your filter. Click "New Template" to create one.
                </EmptyState>
              ) : (
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {filteredTemplates.map((tpl) => {
                    const isSelected = !isCreatingNew && tpl.id === activeTemplateId;
                    const catMeta = CATEGORY_META[tpl.category] || CATEGORY_META.General;
                    const tplVars = Array.from(new Set(tpl.body.match(/\{[A-Za-z0-9_]+\}/g) || []));

                    return (
                      <div
                        key={tpl.id}
                        onClick={() => handleSelectTemplate(tpl)}
                        className={`cursor-pointer rounded-xl border p-3.5 transition-all flex flex-col justify-between ${
                          isSelected
                            ? "border-court-500 bg-court-500/10 ring-1 ring-court-500/30"
                            : "border-ink-800 bg-ink-950/70 hover:border-ink-700"
                        }`}
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <Chip tone={catMeta.tone}>{catMeta.label}</Chip>
                            <div
                              className="flex items-center gap-1"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => handleDuplicateTemplate(tpl)}
                                className="rounded p-1 text-ink-400 hover:bg-ink-800 hover:text-ink-100"
                                title="Duplicate template"
                              >
                                <Copy className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeletingTemplate(tpl)}
                                className="rounded p-1 text-ink-400 hover:bg-bad/15 hover:text-bad"
                                title="Delete template"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>

                          <div className="mt-2 font-display text-sm font-bold text-ink-100 flex items-center gap-1.5">
                            <span className="truncate">{tpl.name}</span>
                          </div>

                          {tpl.description && (
                            <p className="mt-1 text-[11px] text-ink-400 line-clamp-2">
                              {tpl.description}
                            </p>
                          )}
                        </div>

                        <div className="mt-3 pt-2.5 border-t border-ink-800/80 flex flex-wrap items-center gap-1">
                          {tplVars.slice(0, 4).map((v) => (
                            <span
                              key={v}
                              className="rounded bg-ink-900 px-1.5 py-0.5 font-mono text-[10px] text-emerald-400 ring-1 ring-ink-800"
                            >
                              {v}
                            </span>
                          ))}
                          {tplVars.length > 4 && (
                            <span className="font-mono text-[10px] text-ink-400">
                              +{tplVars.length - 4} more
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </Panel>

          {/* Template Builder & Variable Editor */}
          <Panel
            title={
              isCreatingNew
                ? "Create New WhatsApp Notification Template"
                : `Edit Template: ${draftName || "Untitled"}`
            }
            meta="Define message layout and insert dynamic variables like {PLAYER_NAME}, {SESSION_DATE}, and {ACADEMY_NAME}"
            action={
              <Button variant="primary" size="sm" onClick={handleSaveTemplate} disabled={isSaving}>
                <Save className="h-3.5 w-3.5 mr-1.5" />
                <span>
                  {isSaving ? "Saving..." : isCreatingNew ? "Save New Template" : "Save Template"}
                </span>
              </Button>
            }
          >
            <div className="p-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_200px]">
                <Field label="Template Name" hint="Identifiable name for admins and coaches">
                  <Input
                    value={draftName}
                    onChange={setDraftName}
                    placeholder="e.g. U16 Session Reminder"
                  />
                </Field>

                <Field label="Category" hint="Notification type">
                  <select
                    value={draftCategory}
                    onChange={(e) => setDraftCategory(e.target.value as WhatsAppTemplateCategory)}
                    className="mt-1.5 w-full rounded-md bg-ink-850 px-3 py-2 font-ui text-sm text-ink-100 ring-1 ring-ink-700 focus:outline-none focus:ring-1 focus:ring-court-500"
                  >
                    {TEMPLATE_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {CATEGORY_META[cat].label}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <Field
                label="Description (Optional)"
                hint="When admins or coaches should use this template"
              >
                <Input
                  value={draftDescription}
                  onChange={setDraftDescription}
                  placeholder="e.g. Sent 24 hours before scheduled training sessions"
                />
              </Field>

              {/* Click-to-Insert Variables Palette */}
              <div className="rounded-xl border border-ink-800 bg-ink-950 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-mono text-xs font-bold text-ink-200">
                    <Sparkles className="h-3.5 w-3.5 text-court-400" />
                    <span>Click a Variable to Insert into Template</span>
                  </div>
                  <span className="font-mono text-[10px] text-ink-400">
                    Inserts at cursor position
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {WHATSAPP_TEMPLATE_VARIABLES.map((v) => {
                    const isUsed = detectedVariables.includes(v.token);
                    return (
                      <button
                        key={v.token}
                        type="button"
                        onClick={() => handleInsertVariable(v.token)}
                        title={`${v.description} (Sample: ${v.sample})`}
                        className={`group flex items-center gap-1.5 rounded-md px-2.5 py-1 font-mono text-xs transition-all ${
                          isUsed
                            ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40 hover:bg-emerald-500/25"
                            : "bg-ink-900 text-ink-200 ring-1 ring-ink-750 hover:bg-ink-800 hover:text-court-300"
                        }`}
                      >
                        <span className="font-bold">{v.token}</span>
                        <span className="text-[10px] text-ink-400 group-hover:text-ink-200">
                          · {v.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Raw Template Body Textarea */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-mono text-xs font-semibold text-ink-200">
                    Template Body (with {"{VARIABLE}"} placeholders)
                  </label>
                  <span className="font-mono text-[11px] text-ink-400 tabular-nums">
                    {detectedVariables.length} variable(s) active · {draftBody.length} chars
                  </span>
                </div>
                <textarea
                  ref={bodyTextareaRef}
                  value={draftBody}
                  onChange={(e) => {
                    setDraftBody(e.target.value);
                    setCustomMessageOverride(null);
                  }}
                  rows={9}
                  placeholder="Write your WhatsApp template here... Use {PLAYER_NAME}, {SESSION_DATE}, and {ACADEMY_NAME} to personalize."
                  className="w-full rounded-lg bg-ink-850 p-3 font-mono text-xs leading-relaxed text-ink-100 ring-1 ring-ink-700 focus:outline-none focus:ring-2 focus:ring-court-500"
                />
              </div>

              {/* Action Bar */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-ink-800">
                <div className="text-xs font-mono text-ink-400">
                  Supports WhatsApp formatting: <code>*bold*</code>, <code>_italic_</code>, and
                  emojis.
                </div>
                <div className="flex items-center gap-2">
                  {onSelectTemplateForBroadcast && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        onSelectTemplateForBroadcast(finalMessageToSend, {
                          id: activeTemplateId || "custom",
                          name: draftName || "Custom Template",
                          category: draftCategory,
                          body: draftBody,
                        });
                      }}
                    >
                      <Edit2 className="h-3.5 w-3.5 mr-1.5" />
                      <span>Load in Broadcast Center</span>
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleSaveTemplate}
                    disabled={isSaving}
                  >
                    <Save className="h-3.5 w-3.5 mr-1.5" />
                    <span>{isSaving ? "Saving..." : "Save Template"}</span>
                  </Button>
                </div>
              </div>
            </div>
          </Panel>
        </div>

        {/* Right Column: Live Dynamic Variable Resolution & 1-Click WhatsApp Dispatch */}
        <div className="space-y-6">
          <Panel
            title="Live Dynamic Variable Preview & Dispatch"
            meta="Select a player and session to resolve {PLAYER_NAME}, {SESSION_DATE}, and {ACADEMY_NAME} before sending"
          >
            <div className="p-4 space-y-4">
              {/* Context Selectors */}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field
                  label="Select Player ({PLAYER_NAME})"
                  hint="Populates athlete, guardian, squad & balance"
                >
                  <select
                    value={selectedPlayerId}
                    onChange={(e) => handleSelectPlayer(e.target.value)}
                    className="mt-1.5 w-full rounded-md bg-ink-850 px-3 py-2 font-ui text-sm text-ink-100 ring-1 ring-ink-700 focus:outline-none focus:ring-1 focus:ring-court-500"
                  >
                    <option value="">All Squad Athletes (Generic)</option>
                    {db.players.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.teams?.[0] || p.category || "Player"})
                      </option>
                    ))}
                  </select>
                </Field>

                <Field
                  label="Select Session ({SESSION_DATE})"
                  hint="Populates date, time, venue, coach & score"
                >
                  <select
                    value={selectedSessionId}
                    onChange={(e) => {
                      setSelectedSessionId(e.target.value);
                      setCustomMessageOverride(null);
                    }}
                    className="mt-1.5 w-full rounded-md bg-ink-850 px-3 py-2 font-ui text-sm text-ink-100 ring-1 ring-ink-700 focus:outline-none focus:ring-1 focus:ring-court-500"
                  >
                    <option value="">Today / Default Session</option>
                    {db.sessions.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.date} · {s.title} ({s.time})
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              {/* Resolved Variable Values Table */}
              <div className="rounded-xl border border-ink-800 bg-ink-950 p-3 space-y-2">
                <div className="flex items-center justify-between text-[11px] font-mono text-ink-400">
                  <span className="font-semibold text-ink-200 flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-emerald-400" />
                    <span>Resolved Variable Values</span>
                  </span>
                  <span>Live Data Binding</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono">
                  <div className="rounded bg-ink-900 px-2.5 py-1.5 border border-ink-850 truncate">
                    <span className="text-emerald-400">{"{PLAYER_NAME}"}</span>:{" "}
                    <span className="text-ink-100 font-semibold">
                      {variableContext.PLAYER_NAME}
                    </span>
                  </div>
                  <div className="rounded bg-ink-900 px-2.5 py-1.5 border border-ink-850 truncate">
                    <span className="text-emerald-400">{"{SESSION_DATE}"}</span>:{" "}
                    <span className="text-ink-100 font-semibold tabular-nums">
                      {variableContext.SESSION_DATE}
                    </span>
                  </div>
                  <div className="rounded bg-ink-900 px-2.5 py-1.5 border border-ink-850 truncate">
                    <span className="text-emerald-400">{"{ACADEMY_NAME}"}</span>:{" "}
                    <span className="text-ink-100 font-semibold">
                      {variableContext.ACADEMY_NAME}
                    </span>
                  </div>
                  <div className="rounded bg-ink-900 px-2.5 py-1.5 border border-ink-850 truncate">
                    <span className="text-emerald-400">{"{SESSION_TIME}"}</span>:{" "}
                    <span className="text-ink-100 font-semibold tabular-nums">
                      {variableContext.SESSION_TIME}
                    </span>
                  </div>
                  <div className="rounded bg-ink-900 px-2.5 py-1.5 border border-ink-850 truncate">
                    <span className="text-emerald-400">{"{TEAM_NAME}"}</span>:{" "}
                    <span className="text-ink-100 font-semibold">{variableContext.TEAM_NAME}</span>
                  </div>
                  <div className="rounded bg-ink-900 px-2.5 py-1.5 border border-ink-850 truncate">
                    <span className="text-emerald-400">{"{BRANCH_NAME}"}</span>:{" "}
                    <span className="text-ink-100 font-semibold">
                      {variableContext.BRANCH_NAME}
                    </span>
                  </div>
                </div>
              </div>

              {/* Formatted Message Preview (Editable before sending) */}
              <Field
                label="Formatted WhatsApp Message (Ready to Send)"
                hint={
                  customMessageOverride !== null
                    ? "Custom manual edits applied · Click 'Reset Preview' to re-sync with template"
                    : "Variables dynamically replaced — you can also fine-tune this text before sending"
                }
              >
                <Textarea
                  value={finalMessageToSend}
                  onChange={(val) => setCustomMessageOverride(val)}
                  rows={9}
                />
              </Field>

              {customMessageOverride !== null && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setCustomMessageOverride(null)}
                    className="font-mono text-xs text-court-400 hover:underline flex items-center gap-1"
                  >
                    <RotateCcw className="h-3 w-3" />
                    <span>Reset Preview to Dynamic Template Output</span>
                  </button>
                </div>
              )}

              {/* Target Group Selector for Group Broadcast */}
              <Field
                label="Target WhatsApp Group (For Group Push)"
                hint="Or send directly to the selected player/guardian phone below"
              >
                {db.groups.length > 0 ? (
                  <select
                    value={targetGroupName}
                    onChange={(e) => setTargetGroupName(e.target.value)}
                    className="mt-1.5 w-full rounded-md bg-ink-850 px-3 py-2 font-ui text-sm text-ink-100 ring-1 ring-ink-700 focus:outline-none focus:ring-1 focus:ring-court-500"
                  >
                    {db.groups.map((g) => (
                      <option key={g.id} value={g.name}>
                        {g.name} ({g.scope || "Academy"})
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="text-xs font-mono text-ink-400 py-1">
                    No groups configured yet — direct WhatsApp send is still available.
                  </div>
                )}
              </Field>

              {/* Send & Copy Buttons */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-ink-800">
                <button
                  type="button"
                  onClick={handleCopyFormatted}
                  className="flex items-center gap-1.5 rounded-md bg-ink-800 px-3 py-2 text-xs font-mono text-ink-200 ring-1 ring-ink-700 hover:bg-ink-750 transition-colors"
                >
                  {copiedPreview ? (
                    <Check className="h-3.5 w-3.5 text-good" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  <span>{copiedPreview ? "Copied!" : "Copy Message"}</span>
                </button>

                <div className="flex flex-wrap items-center gap-2">
                  {selectedPlayer && (
                    <button
                      type="button"
                      onClick={handleSendToPlayerPhone}
                      className="flex items-center gap-1.5 rounded-lg bg-court-500 hover:bg-court-400 px-3.5 py-2 text-xs font-mono font-bold text-ink-950 shadow-sm transition-all"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      <span>Send to {selectedPlayer.name}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handlePushToGroup}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 px-3.5 py-2 text-xs font-mono font-bold text-white shadow-sm transition-all"
                  >
                    <Send className="h-3.5 w-3.5" />
                    <span>Push to WhatsApp</span>
                  </button>
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>

      {/* Delete Template Confirmation Modal */}
      <Modal
        open={!!deletingTemplate}
        title="Delete WhatsApp Notification Template?"
        meta={deletingTemplate?.name || ""}
        onClose={() => setDeletingTemplate(null)}
      >
        <div className="p-4 space-y-4">
          <p className="text-xs text-ink-300 leading-relaxed">
            Are you sure you want to delete the template{" "}
            <strong className="text-ink-100">"{deletingTemplate?.name}"</strong>? This will remove
            it from your saved WhatsApp notification templates.
          </p>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDeletingTemplate(null)}>
              Cancel
            </Button>
            <Button variant="danger" size="sm" onClick={confirmDeleteTemplate}>
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              <span>Delete Template</span>
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default WhatsAppTemplatesManager;

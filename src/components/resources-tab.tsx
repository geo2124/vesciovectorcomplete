import { useState } from "react";
import { useDB } from "@/lib/data-store";
import type { ResourceFolder, ResourceItem, QuizSubmission } from "@/lib/mock-data";
import { Button, Chip, Field, Input, Modal, Panel, Select, Textarea } from "@/components/kit";
import { uploadResourceFile } from "@/lib/storage";
import { toast } from "sonner";

export function ResourcesTab() {
  const { db, setEntity, deleteEntity, tenantId } = useDB();
  const folders = db.resourceFolders || [];
  const coaches = db.coaches || [];

  const [activeFolder, setActiveFolder] = useState<ResourceFolder | null>(null);

  // Folder modal state
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [editingFolder, setEditingFolder] = useState<ResourceFolder | null>(null);
  const [folderForm, setFolderForm] = useState<{
    name: string;
    accessType: "All" | "Group" | "Specific";
    accessGroup?: string;
    accessCoaches: string[];
  }>({
    name: "",
    accessType: "All",
    accessGroup: "Coaches",
    accessCoaches: [],
  });

  // Delete confirmation modals state
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<ResourceFolder | null>(null);
  const [deleteItemTarget, setDeleteItemTarget] = useState<string | null>(null);

  // Resource item modal state
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ResourceItem | null>(null);
  const [itemType, setItemType] = useState<"File" | "YouTube" | "Interactive Form">("File");
  const [uploading, setUploading] = useState(false);
  const [linkForm, setLinkForm] = useState({ name: "", url: "" });
  const [quizForm, setQuizForm] = useState<{
    name: string;
    description: string;
    questions: {
      id: string;
      type: "Text" | "Radio" | "Checkbox" | "Scale" | "Paragraph" | string;
      prompt: string;
      options?: string[];
    }[];
  }>({
    name: "",
    description: "",
    questions: [],
  });

  // Quiz submissions view modal state
  const [viewSubmissionsItem, setViewSubmissionsItem] = useState<ResourceItem | null>(null);

  // --- Folder Management ---
  function openCreateFolder() {
    setEditingFolder(null);
    setFolderForm({
      name: "",
      accessType: "All",
      accessGroup: "Coaches",
      accessCoaches: [],
    });
    setFolderModalOpen(true);
  }

  function openEditFolder(f: ResourceFolder, e?: React.MouseEvent) {
    e?.stopPropagation();
    setEditingFolder(f);
    setFolderForm({
      name: f.name,
      accessType: f.accessType || "All",
      accessGroup: f.accessGroup || "Coaches",
      accessCoaches: f.accessCoaches || [],
    });
    setFolderModalOpen(true);
  }

  function handleDeleteFolder(f: ResourceFolder, e?: React.MouseEvent) {
    e?.stopPropagation();
    setDeleteFolderTarget(f);
  }

  async function confirmDeleteFolder() {
    if (!deleteFolderTarget) return;
    try {
      await deleteEntity("resourceFolders", deleteFolderTarget.id);
      if (activeFolder?.id === deleteFolderTarget.id) {
        setActiveFolder(null);
      }
      toast.success(`Folder "${deleteFolderTarget.name}" deleted.`);
    } catch (err) {
      console.error("Failed to delete folder:", err);
      toast.error("Failed to delete folder.");
    } finally {
      setDeleteFolderTarget(null);
    }
  }

  async function saveFolder() {
    const trimmedName = folderForm.name.trim();
    if (!trimmedName) {
      toast.error("Please enter a folder name.");
      return;
    }

    if (editingFolder) {
      const updated: ResourceFolder = {
        ...editingFolder,
        name: trimmedName,
        accessType: folderForm.accessType,
        accessGroup: folderForm.accessType === "Group" ? folderForm.accessGroup : undefined,
        accessCoaches: folderForm.accessType === "Specific" ? folderForm.accessCoaches : [],
        items: editingFolder.items || [],
      };
      await setEntity("resourceFolders", updated);
      if (activeFolder?.id === updated.id) {
        setActiveFolder(updated);
      }
      toast.success("Folder updated.");
    } else {
      const created: ResourceFolder = {
        id: `f-${Date.now()}`,
        name: trimmedName,
        accessType: folderForm.accessType,
        accessGroup: folderForm.accessType === "Group" ? folderForm.accessGroup : undefined,
        accessCoaches: folderForm.accessType === "Specific" ? folderForm.accessCoaches : [],
        items: [],
      };
      await setEntity("resourceFolders", created);
      toast.success("Folder created.");
    }

    setFolderModalOpen(false);
  }

  function toggleCoachAccess(coachId: string) {
    setFolderForm((prev) => {
      const exists = prev.accessCoaches.includes(coachId);
      return {
        ...prev,
        accessCoaches: exists
          ? prev.accessCoaches.filter((id) => id !== coachId)
          : [...prev.accessCoaches, coachId],
      };
    });
  }

  function selectAllCoaches() {
    setFolderForm((prev) => ({
      ...prev,
      accessCoaches: coaches.map((c) => c.id),
    }));
  }

  function deselectAllCoaches() {
    setFolderForm((prev) => ({
      ...prev,
      accessCoaches: [],
    }));
  }

  // --- Resource Item Management ---
  function openCreateItem() {
    setEditingItem(null);
    setItemType("File");
    setLinkForm({ name: "", url: "" });
    setQuizForm({
      name: "",
      description: "",
      questions: [
        {
          id: `q-${Date.now()}`,
          type: "Text",
          prompt: "",
          options: [],
        },
      ],
    });
    setItemModalOpen(true);
  }

  function openEditItem(item: ResourceItem) {
    setEditingItem(item);
    if (item.type === "YouTube") {
      setItemType("YouTube");
      setLinkForm({ name: item.name, url: item.url || "" });
    } else if (item.type === "Interactive Form") {
      setItemType("Interactive Form");
      setQuizForm({
        name: item.name,
        description: item.quiz?.description || "",
        questions: item.quiz?.questions ? JSON.parse(JSON.stringify(item.quiz.questions)) : [],
      });
    } else {
      setItemType("File");
      setLinkForm({ name: item.name, url: item.url || "" });
    }
    setItemModalOpen(true);
  }

  function handleDeleteItem(itemId: string) {
    if (!activeFolder) return;
    setDeleteItemTarget(itemId);
  }

  async function confirmDeleteItem() {
    if (!activeFolder || !deleteItemTarget) return;

    const itemId = deleteItemTarget;
    const updatedFolder: ResourceFolder = {
      ...activeFolder,
      items: activeFolder.items.filter((i) => i.id !== itemId),
    };

    try {
      await setEntity("resourceFolders", updatedFolder);
      setActiveFolder(updatedFolder);
      toast.success("Resource deleted.");
    } catch (err) {
      console.error("Failed to delete resource:", err);
      toast.error("Failed to delete resource.");
    } finally {
      setDeleteItemTarget(null);
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !activeFolder) return;

    if (file.size > 25 * 1024 * 1024) {
      toast.error("File size must be under 25MB");
      return;
    }

    const type = file.type.startsWith("video")
      ? "Video"
      : file.type.startsWith("image")
        ? "Image"
        : "PDF";

    try {
      setUploading(true);
      const uploaded = await uploadResourceFile(tenantId, activeFolder.id, file);
      const item: ResourceItem = {
        id: `i-${Date.now()}`,
        name: file.name,
        type: type as ResourceItem["type"],
        size: file.size,
        url: uploaded.url,
      };

      await addItemToFolder(item);
      setItemModalOpen(false);
      toast.success("File uploaded to Firebase Storage.");
    } catch (err) {
      console.error("Storage upload failed:", err);
      toast.error("Failed to upload binary file to Firebase Storage.");
    } finally {
      setUploading(false);
    }
  }

  async function saveLink() {
    if (!linkForm.name.trim() || !linkForm.url.trim()) {
      toast.error("Please enter both a title and URL.");
      return;
    }

    if (editingItem && activeFolder) {
      const updatedItem: ResourceItem = {
        ...editingItem,
        name: linkForm.name.trim(),
        url: linkForm.url.trim(),
      };
      const updatedFolder: ResourceFolder = {
        ...activeFolder,
        items: activeFolder.items.map((it) => (it.id === editingItem.id ? updatedItem : it)),
      };
      await setEntity("resourceFolders", updatedFolder);
      setActiveFolder(updatedFolder);
      setItemModalOpen(false);
      toast.success("Resource updated.");
    } else {
      const item: ResourceItem = {
        id: `i-${Date.now()}`,
        name: linkForm.name.trim(),
        type: "YouTube",
        url: linkForm.url.trim(),
      };
      await addItemToFolder(item);
      setItemModalOpen(false);
      setLinkForm({ name: "", url: "" });
      toast.success("YouTube resource added.");
    }
  }

  async function saveQuiz() {
    if (!quizForm.name.trim()) {
      toast.error("Please enter a title for the interactive form.");
      return;
    }

    if (editingItem && activeFolder) {
      const updatedItem: ResourceItem = {
        ...editingItem,
        name: quizForm.name.trim(),
        type: "Interactive Form",
        quiz: {
          description: quizForm.description.trim(),
          questions: quizForm.questions,
        },
        submissions: editingItem.submissions,
      };
      const updatedFolder: ResourceFolder = {
        ...activeFolder,
        items: activeFolder.items.map((it) => (it.id === editingItem.id ? updatedItem : it)),
      };
      await setEntity("resourceFolders", updatedFolder);
      setActiveFolder(updatedFolder);
      setItemModalOpen(false);
      toast.success("Interactive form updated.");
    } else {
      const item: ResourceItem = {
        id: `i-${Date.now()}`,
        name: quizForm.name.trim(),
        type: "Interactive Form",
        quiz: {
          description: quizForm.description.trim(),
          questions: quizForm.questions,
        },
        submissions: [],
      };
      await addItemToFolder(item);
      setItemModalOpen(false);
      setQuizForm({ name: "", description: "", questions: [] });
      toast.success("Interactive form added.");
    }
  }

  async function saveFileRename() {
    if (!linkForm.name.trim() || !editingItem || !activeFolder) return;
    const updatedItem: ResourceItem = {
      ...editingItem,
      name: linkForm.name.trim(),
    };
    const updatedFolder: ResourceFolder = {
      ...activeFolder,
      items: activeFolder.items.map((it) => (it.id === editingItem.id ? updatedItem : it)),
    };
    await setEntity("resourceFolders", updatedFolder);
    setActiveFolder(updatedFolder);
    setItemModalOpen(false);
    toast.success("Resource renamed.");
  }

  async function addItemToFolder(item: ResourceItem) {
    if (!activeFolder) return;
    const updatedFolder: ResourceFolder = {
      ...activeFolder,
      items: [...activeFolder.items, item],
    };
    await setEntity("resourceFolders", updatedFolder);
    setActiveFolder(updatedFolder);
  }

  function addQuestion() {
    setQuizForm((prev) => ({
      ...prev,
      questions: [
        ...prev.questions,
        {
          id: `q-${Date.now()}`,
          type: "Text",
          prompt: "",
          options: [],
        },
      ],
    }));
  }

  // --- RENDER INSIDE FOLDER ---
  if (activeFolder) {
    return (
      <Panel
        title={activeFolder.name}
        meta={
          activeFolder.accessType === "All"
            ? "Access: All Coaches"
            : activeFolder.accessType === "Group"
              ? `Access: Group (${activeFolder.accessGroup || "Coaches"})`
              : `Access: Specific Coaches (${activeFolder.accessCoaches?.length || 0} coaches)`
        }
        action={
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setActiveFolder(null)}>
              ← Back to folders
            </Button>
            <Button variant="outline" onClick={() => openEditFolder(activeFolder)}>
              Edit Folder
            </Button>
            <Button
              variant="outline"
              className="text-bad hover:bg-bad/10 border-bad/30"
              onClick={() => handleDeleteFolder(activeFolder)}
            >
              Delete Folder
            </Button>
            <Button onClick={openCreateItem}>+ Add resource</Button>
          </div>
        }
      >
        <div className="p-4">
          {activeFolder.items.length === 0 ? (
            <div className="py-12 text-center text-ink-400 font-mono text-[11px]">
              No resources in this folder yet. Click "+ Add resource" to upload files, attach
              YouTube links, or create interactive coach quizzes.
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {activeFolder.items.map((item) => (
                <div
                  key={item.id}
                  className="rounded-md bg-ink-850 p-4 ring-1 ring-ink-700 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <Chip
                        tone={
                          item.type === "YouTube"
                            ? "bad"
                            : item.type === "Interactive Form"
                              ? "accent"
                              : "neutral"
                        }
                      >
                        {item.type}
                      </Chip>

                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditItem(item)}
                          className="px-2 py-0.5 rounded text-[11px] font-mono text-ink-300 hover:text-ink-100 bg-ink-800 hover:bg-ink-750 border border-ink-700 transition-colors"
                          title="Edit resource"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteItem(item.id)}
                          className="px-2 py-0.5 rounded text-[11px] font-mono text-bad hover:bg-bad/10 border border-bad/30 transition-colors"
                          title="Delete resource"
                        >
                          Delete
                        </button>
                      </div>
                    </div>

                    <div className="text-sm font-medium text-ink-100">{item.name}</div>

                    {item.size && (
                      <div className="font-mono text-[10px] text-ink-400 mt-1">
                        {(item.size / 1024 / 1024).toFixed(2)} MB
                      </div>
                    )}

                    {item.quiz && (
                      <div className="font-mono text-[10px] text-ink-400 mt-1">
                        {item.quiz.questions?.length || 0} questions
                        {item.quiz.description ? ` · ${item.quiz.description}` : ""}
                      </div>
                    )}
                  </div>

                  <div className="mt-4 pt-3 border-t border-ink-800/80 flex flex-col gap-2">
                    {item.url && (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full inline-flex items-center justify-center gap-1.5 rounded bg-ink-800 px-2.5 py-1.5 text-xs font-semibold text-court-400 ring-1 ring-ink-700 hover:bg-ink-750 transition-colors"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          className="stroke-court-400"
                        >
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                        Open Resource
                      </a>
                    )}

                    {item.type === "Interactive Form" && (
                      <button
                        type="button"
                        onClick={() => setViewSubmissionsItem(item)}
                        className="w-full inline-flex items-center justify-center gap-1.5 rounded bg-court-500/15 border border-court-500/30 px-2.5 py-1.5 text-xs font-semibold text-court-300 hover:bg-court-500/25 transition-colors"
                      >
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <polyline points="14 2 14 8 20 8" />
                          <line x1="16" y1="13" x2="8" y2="13" />
                          <line x1="16" y1="17" x2="8" y2="17" />
                          <polyline points="10 9 9 9 8 9" />
                        </svg>
                        View Submissions ({item.submissions?.length || 0})
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* MODAL: Add / Edit Resource */}
        <Modal
          open={itemModalOpen}
          title={editingItem ? `Edit ${editingItem.name}` : "Add resource"}
          onClose={() => !uploading && setItemModalOpen(false)}
          submitLabel={itemType === "File" ? (editingItem ? "Save Title" : "") : "Save"}
          onSubmit={
            itemType === "YouTube"
              ? saveLink
              : itemType === "Interactive Form"
                ? saveQuiz
                : editingItem
                  ? saveFileRename
                  : undefined
          }
          wide={itemType === "Interactive Form"}
        >
          <div className="p-4 space-y-4">
            {!editingItem && (
              <Field label="Resource type">
                <Select
                  value={itemType}
                  onChange={(v: unknown) =>
                    setItemType(v as "File" | "YouTube" | "Interactive Form")
                  }
                  options={["File", "YouTube", "Interactive Form"]}
                />
              </Field>
            )}

            {!editingItem && <div className="my-4 h-px bg-ink-800" />}

            {itemType === "File" && (
              <>
                {editingItem ? (
                  <Field label="File Title / Label">
                    <Input
                      value={linkForm.name}
                      onChange={(v) => setLinkForm({ ...linkForm, name: v })}
                    />
                  </Field>
                ) : (
                  <Field
                    label="Upload file"
                    hint="PDF, Image, or Video up to 25MB uploaded to Firebase Storage."
                  >
                    <input
                      type="file"
                      accept="image/*,video/*,.pdf"
                      disabled={uploading}
                      onChange={handleFileUpload}
                      className="w-full rounded-md bg-ink-850 px-3 py-2 font-ui text-sm text-ink-200 ring-1 ring-ink-700 file:mr-3 file:rounded file:border-0 file:bg-court-500 file:px-2 file:py-1 file:text-xs file:font-semibold file:text-ink-950 disabled:opacity-50"
                    />
                    {uploading && (
                      <div className="mt-2 flex items-center gap-2 text-xs text-court-400 font-mono">
                        <div className="h-2 w-2 animate-ping rounded-full bg-court-400" />
                        Uploading binary payload directly to Firebase Storage...
                      </div>
                    )}
                  </Field>
                )}
              </>
            )}

            {itemType === "YouTube" && (
              <>
                <Field label="Video Title">
                  <Input
                    value={linkForm.name}
                    onChange={(v) => setLinkForm({ ...linkForm, name: v })}
                    placeholder="e.g. Pick and Roll breakdown"
                  />
                </Field>
                <Field label="YouTube Link">
                  <Input
                    value={linkForm.url}
                    onChange={(v) => setLinkForm({ ...linkForm, url: v })}
                    placeholder="https://youtube.com/..."
                  />
                </Field>
              </>
            )}

            {itemType === "Interactive Form" && (
              <div className="space-y-4">
                <Field label="Interactive Form Title">
                  <Input
                    value={quizForm.name}
                    onChange={(v) => setQuizForm({ ...quizForm, name: v })}
                    placeholder="e.g. Zone Defense Tactics & Rules"
                  />
                </Field>
                <Field label="Instructions (optional)">
                  <Textarea
                    value={quizForm.description}
                    onChange={(v) => setQuizForm({ ...quizForm, description: v })}
                    placeholder="Provide guidance or background information for coaches before taking this form..."
                  />
                </Field>

                <div className="flex items-center justify-between pt-2">
                  <div className="label-mono">Questions ({quizForm.questions.length})</div>
                  <Button variant="outline" className="text-xs" onClick={addQuestion}>
                    + Add Question
                  </Button>
                </div>

                <div className="space-y-3">
                  {quizForm.questions.map((q, i) => (
                    <div
                      key={q.id || i}
                      className="p-3 bg-ink-900 ring-1 ring-ink-800 rounded-md space-y-3"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-ink-400 w-6">#{i + 1}</span>
                        <div className="flex-1">
                          <Input
                            value={q.prompt}
                            onChange={(v) => {
                              const newQ = [...quizForm.questions];
                              newQ[i].prompt = v;
                              setQuizForm({ ...quizForm, questions: newQ });
                            }}
                            placeholder="Question prompt..."
                          />
                        </div>
                        <div className="w-32">
                          <Select
                            value={q.type}
                            onChange={(v: unknown) => {
                              const newQ = [...quizForm.questions];
                              newQ[i].type = v as string;
                              if (
                                (v === "Radio" || v === "Checkbox") &&
                                (!newQ[i].options || newQ[i].options?.length === 0)
                              ) {
                                newQ[i].options = ["Option 1", "Option 2"];
                              }
                              setQuizForm({ ...quizForm, questions: newQ });
                            }}
                            options={["Text", "Radio", "Checkbox", "Scale", "Paragraph"]}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setQuizForm({
                              ...quizForm,
                              questions: quizForm.questions.filter((_, idx) => idx !== i),
                            });
                          }}
                          className="text-bad hover:bg-bad/10 p-1.5 rounded text-xs font-mono"
                          title="Remove question"
                        >
                          ✕
                        </button>
                      </div>

                      {(q.type === "Radio" || q.type === "Checkbox") && (
                        <div className="pl-8 space-y-2 border-l-2 border-ink-800">
                          {q.options?.map((opt: string, optI: number) => (
                            <div key={optI} className="flex gap-2 items-center">
                              <span className="text-[10px] font-mono text-ink-500">
                                {optI + 1}.
                              </span>
                              <div className="flex-1">
                                <Input
                                  value={opt}
                                  onChange={(v) => {
                                    const newQ = [...quizForm.questions];
                                    if (newQ[i].options) {
                                      newQ[i].options![optI] = v;
                                      setQuizForm({ ...quizForm, questions: newQ });
                                    }
                                  }}
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  const newQ = [...quizForm.questions];
                                  if (newQ[i].options) {
                                    newQ[i].options = newQ[i].options!.filter(
                                      (_, oIdx) => oIdx !== optI,
                                    );
                                    setQuizForm({ ...quizForm, questions: newQ });
                                  }
                                }}
                                className="text-ink-400 hover:text-bad px-2 text-xs"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              const newQ = [...quizForm.questions];
                              newQ[i].options = [
                                ...(newQ[i].options || []),
                                `Option ${(newQ[i].options?.length || 0) + 1}`,
                              ];
                              setQuizForm({ ...quizForm, questions: newQ });
                            }}
                            className="text-xs text-court-400 hover:text-court-300 font-mono"
                          >
                            + Add option
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </Modal>

        {/* MODAL: View Coach Submissions */}
        <Modal
          open={Boolean(viewSubmissionsItem)}
          title={`Submissions: ${viewSubmissionsItem?.name || "Interactive Form"}`}
          meta={`${viewSubmissionsItem?.submissions?.length || 0} total submissions recorded`}
          onClose={() => setViewSubmissionsItem(null)}
          wide
        >
          <div className="p-4 space-y-4">
            {!viewSubmissionsItem?.submissions || viewSubmissionsItem.submissions.length === 0 ? (
              <div className="py-12 text-center text-ink-400 font-mono text-xs">
                No coach responses submitted yet for this interactive form. When coaches complete
                this quiz in the Coach Portal, their responses will appear here with timestamps and
                score breakdowns.
              </div>
            ) : (
              <div className="space-y-4">
                {viewSubmissionsItem.submissions.map((sub: QuizSubmission, sIdx: number) => (
                  <div
                    key={`${sub.coachId}-${sub.submittedAt}-${sIdx}`}
                    className="rounded-lg bg-ink-900 border border-ink-800 p-4 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-800 pb-2.5">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-court-500/20 text-court-300 font-bold text-xs font-mono">
                          {sub.coachName ? sub.coachName.charAt(0).toUpperCase() : "C"}
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-ink-100">{sub.coachName}</div>
                          <div className="text-[11px] font-mono text-ink-400">
                            Submitted:{" "}
                            {sub.submittedAt
                              ? new Date(sub.submittedAt).toLocaleString()
                              : "Timestamp recorded"}
                          </div>
                        </div>
                      </div>

                      {sub.score !== undefined && (
                        <Chip tone="good">Score: {String(sub.score)}</Chip>
                      )}
                    </div>

                    <div className="space-y-2 pt-1">
                      <div className="text-[11px] font-mono uppercase tracking-wider text-ink-400">
                        Answers Submitted:
                      </div>

                      {viewSubmissionsItem.quiz?.questions &&
                      viewSubmissionsItem.quiz.questions.length > 0 ? (
                        viewSubmissionsItem.quiz.questions.map((q, qIdx) => {
                          const coachAns = sub.answers?.[q.id] || sub.answers?.[q.prompt];
                          return (
                            <div
                              key={q.id || qIdx}
                              className="rounded bg-ink-850 p-2.5 border border-ink-750 text-xs space-y-1"
                            >
                              <div className="text-ink-300 font-medium">
                                <span className="text-court-400 font-mono mr-1.5">
                                  Q{qIdx + 1}:
                                </span>
                                {q.prompt}
                              </div>
                              <div className="pl-4 text-ink-100 font-mono bg-ink-900/60 p-1.5 rounded border border-ink-800">
                                {coachAns ? (
                                  <span className="text-court-300 font-medium">{coachAns}</span>
                                ) : (
                                  <span className="text-ink-500 italic">(No answer provided)</span>
                                )}
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className="space-y-2">
                          {Object.entries(sub.answers || {}).map(([key, val], aIdx) => (
                            <div
                              key={aIdx}
                              className="rounded bg-ink-850 p-2.5 border border-ink-750 text-xs space-y-1"
                            >
                              <div className="text-ink-300 font-medium">{key}</div>
                              <div className="pl-4 text-court-300 font-mono bg-ink-900/60 p-1.5 rounded border border-ink-800">
                                {val || "(No answer)"}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>

        {/* MODAL: Create / Edit Folder */}
        <Modal
          open={folderModalOpen}
          title={editingFolder ? "Edit folder" : "Create folder"}
          onClose={() => setFolderModalOpen(false)}
          submitLabel={editingFolder ? "Save Changes" : "Create"}
          onSubmit={saveFolder}
        >
          <div className="p-4 space-y-4">
            <Field label="Folder Name">
              <Input
                value={folderForm.name}
                onChange={(v) => setFolderForm({ ...folderForm, name: v })}
                placeholder="e.g. Offensive Sets"
              />
            </Field>

            <Field label="Access Level">
              <Select
                value={folderForm.accessType}
                onChange={(v: unknown) =>
                  setFolderForm({
                    ...folderForm,
                    accessType: v as "All" | "Group" | "Specific",
                  })
                }
                options={["All", "Group", "Specific"]}
              />
            </Field>

            {folderForm.accessType === "Group" && (
              <Field label="Target Group">
                <Select
                  value={folderForm.accessGroup || "Coaches"}
                  onChange={(v: unknown) =>
                    setFolderForm({ ...folderForm, accessGroup: v as string })
                  }
                  options={["Coaches", "Branch Managers", "U-14 Coaches", "U-16 Coaches"]}
                />
              </Field>
            )}

            {folderForm.accessType === "Specific" && (
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-mono font-medium text-ink-300">
                    Authorized Coaches ({folderForm.accessCoaches.length} selected)
                  </label>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={selectAllCoaches}
                      className="text-[11px] font-mono text-court-400 hover:text-court-300"
                    >
                      Select All
                    </button>
                    <span className="text-ink-600">·</span>
                    <button
                      type="button"
                      onClick={deselectAllCoaches}
                      className="text-[11px] font-mono text-ink-400 hover:text-ink-200"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="max-h-56 overflow-y-auto rounded-md border border-ink-800 bg-ink-900/80 p-2 space-y-1">
                  {coaches.length === 0 ? (
                    <div className="p-3 text-center text-xs text-ink-500 font-mono">
                      No coaches registered in the system.
                    </div>
                  ) : (
                    coaches.map((c) => {
                      const isSelected = folderForm.accessCoaches.includes(c.id);
                      return (
                        <label
                          key={c.id}
                          className="flex items-center gap-2.5 rounded px-2.5 py-1.5 hover:bg-ink-800/60 cursor-pointer transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleCoachAccess(c.id)}
                            className="rounded border-ink-700 bg-ink-850 text-court-500 focus:ring-court-500"
                          />
                          <span className="text-xs text-ink-100 font-medium flex-1">{c.name}</span>
                          <span className="text-[10px] font-mono text-ink-400">
                            {c.level || c.role || "Coach"} · {c.branch || "HQ"}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </Modal>
      </Panel>
    );
  }

  // --- RENDER FOLDERS LIST ---
  return (
    <Panel
      title="Shared resources"
      meta="Training materials, quizzes, and videos"
      action={<Button onClick={openCreateFolder}>+ New Folder</Button>}
    >
      <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {folders.length === 0 ? (
          <div className="col-span-full py-12 text-center text-ink-400 font-mono text-[11px]">
            No folders created yet. Click "+ New Folder" to create shared resource folders for
            coaches.
          </div>
        ) : (
          folders.map((f) => (
            <div
              key={f.id}
              onClick={() => setActiveFolder(f)}
              className="text-left rounded-md bg-ink-850 p-4 ring-1 ring-ink-700 hover:bg-ink-800 transition-colors cursor-pointer flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="font-mono text-xl text-court-400">▤</div>
                    <Chip
                      tone={
                        f.accessType === "All"
                          ? "neutral"
                          : f.accessType === "Group"
                            ? "accent"
                            : "warn"
                      }
                    >
                      {f.accessType === "All"
                        ? "All Coaches"
                        : f.accessType === "Group"
                          ? f.accessGroup || "Group"
                          : `${f.accessCoaches?.length || 0} Coaches`}
                    </Chip>
                  </div>

                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={(e) => openEditFolder(f, e)}
                      className="px-2 py-0.5 rounded text-[11px] font-mono text-ink-300 hover:text-ink-100 bg-ink-800 hover:bg-ink-750 border border-ink-700 transition-colors"
                      title="Edit folder details"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteFolder(f, e)}
                      className="px-2 py-0.5 rounded text-[11px] font-mono text-bad hover:bg-bad/10 border border-bad/30 transition-colors"
                      title="Delete folder"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="mt-3 text-sm font-medium text-ink-100">{f.name}</div>
              </div>

              <div className="mt-4 pt-2 border-t border-ink-800/80 flex items-center justify-between">
                <div className="font-mono text-[10px] text-ink-400">
                  {(f.items || []).length} items
                </div>
                <span className="text-[11px] font-mono text-court-400 hover:underline">
                  Open folder →
                </span>
              </div>
            </div>
          ))
        )}
      </div>

      {/* MODAL: Create / Edit Folder */}
      <Modal
        open={folderModalOpen}
        title={editingFolder ? "Edit folder" : "Create folder"}
        onClose={() => setFolderModalOpen(false)}
        submitLabel={editingFolder ? "Save Changes" : "Create"}
        onSubmit={saveFolder}
      >
        <div className="p-4 space-y-4">
          <Field label="Folder Name">
            <Input
              value={folderForm.name}
              onChange={(v) => setFolderForm({ ...folderForm, name: v })}
              placeholder="e.g. Offensive Sets"
            />
          </Field>

          <Field label="Access Level">
            <Select
              value={folderForm.accessType}
              onChange={(v: unknown) =>
                setFolderForm({
                  ...folderForm,
                  accessType: v as "All" | "Group" | "Specific",
                })
              }
              options={["All", "Group", "Specific"]}
            />
          </Field>

          {folderForm.accessType === "Group" && (
            <Field label="Target Group">
              <Select
                value={folderForm.accessGroup || "Coaches"}
                onChange={(v: unknown) =>
                  setFolderForm({ ...folderForm, accessGroup: v as string })
                }
                options={["Coaches", "Branch Managers", "U-14 Coaches", "U-16 Coaches"]}
              />
            </Field>
          )}

          {folderForm.accessType === "Specific" && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-mono font-medium text-ink-300">
                  Authorized Coaches ({folderForm.accessCoaches.length} selected)
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={selectAllCoaches}
                    className="text-[11px] font-mono text-court-400 hover:text-court-300"
                  >
                    Select All
                  </button>
                  <span className="text-ink-600">·</span>
                  <button
                    type="button"
                    onClick={deselectAllCoaches}
                    className="text-[11px] font-mono text-ink-400 hover:text-ink-200"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="max-h-56 overflow-y-auto rounded-md border border-ink-800 bg-ink-900/80 p-2 space-y-1">
                {coaches.length === 0 ? (
                  <div className="p-3 text-center text-xs text-ink-500 font-mono">
                    No coaches registered in the system.
                  </div>
                ) : (
                  coaches.map((c) => {
                    const isSelected = folderForm.accessCoaches.includes(c.id);
                    return (
                      <label
                        key={c.id}
                        className="flex items-center gap-2.5 rounded px-2.5 py-1.5 hover:bg-ink-800/60 cursor-pointer transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleCoachAccess(c.id)}
                          className="rounded border-ink-700 bg-ink-850 text-court-500 focus:ring-court-500"
                        />
                        <span className="text-xs text-ink-100 font-medium flex-1">{c.name}</span>
                        <span className="text-[10px] font-mono text-ink-400">
                          {c.level || c.role || "Coach"} · {c.branch || "HQ"}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Delete Folder Confirmation Modal */}
      <Modal
        open={!!deleteFolderTarget}
        onClose={() => setDeleteFolderTarget(null)}
        title="Delete Folder"
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-300">
            Are you sure you want to delete folder &ldquo;{deleteFolderTarget?.name}&rdquo; and all
            its contents? This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteFolderTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDeleteFolder}>
              Delete Folder
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Resource Confirmation Modal */}
      <Modal
        open={!!deleteItemTarget}
        onClose={() => setDeleteItemTarget(null)}
        title="Delete Resource"
      >
        <div className="space-y-4">
          <p className="text-sm text-ink-300">
            Are you sure you want to delete this resource? This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteItemTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDeleteItem}>
              Delete Resource
            </Button>
          </div>
        </div>
      </Modal>
    </Panel>
  );
}

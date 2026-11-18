import { useState, lazy, Suspense } from "react";
import { Button, Chip, Field, Input, Select, Textarea } from "@/components/kit";
import type { Plan, PlanBlock } from "@/lib/data-store";
import { useDB } from "@/lib/data-store";
import { uploadTacticalDrawing } from "@/lib/storage";
import { toast } from "sonner";
import { BookOpen, Image as ImageIcon, ExternalLink } from "lucide-react";

const DrawingBoard = lazy(() =>
  import("@/components/drawing-board").then((m) => ({ default: m.DrawingBoard })),
);

export type PlanDraft = Omit<Plan, "id">;

const BLOCK_COLORS = ["bg-court-500", "bg-good", "bg-warn", "bg-ink-500", "bg-court-400"];

export function newBlock(): PlanBlock {
  return {
    id: `b-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
    name: "New section",
    minutes: 10,
    notes: "",
    drawing: undefined,
  };
}

export function emptyPlan(coach: string, category: string): PlanDraft {
  return {
    title: "",
    category,
    coach,
    focus: "",
    date: new Date().toISOString().slice(0, 10),
    status: "Draft",
    review: "",
    blocks: [{ ...newBlock(), name: "Warm-up" }],
  };
}

export function PlanEditor({
  value,
  onChange,
  coachLocked,
  onOpenDrillSelector,
}: {
  value: PlanDraft;
  onChange: (p: PlanDraft) => void;
  coachLocked?: boolean;
  onOpenDrillSelector?: () => void;
}) {
  const { db, tenantId } = useDB();
  const [openBlock, setOpenBlock] = useState<string | null>((value.blocks ?? [])[0]?.id ?? null);
  const [uploadingBlock, setUploadingBlock] = useState<string | null>(null);
  const blocks = value.blocks ?? [];
  const total = blocks.reduce((s, b) => s + (b.minutes || 0), 0);

  async function persistDrawingToStorage(blockId: string, dataUrl: string | null) {
    if (!dataUrl) {
      setBlock(blockId, { drawing: null });
      return;
    }
    // If it's already a hosted URL, don't re-upload
    if (dataUrl.startsWith("https://")) {
      setBlock(blockId, { drawing: dataUrl });
      return;
    }

    try {
      setUploadingBlock(blockId);
      // Convert dataURL to blob
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const planSlug =
        value.title
          .trim()
          .replace(/[^a-zA-Z0-9]/g, "_")
          .toLowerCase() || "draft";
      const uploadedUrl = await uploadTacticalDrawing(tenantId, planSlug, blockId, blob);
      setBlock(blockId, { drawing: uploadedUrl });
      toast.success("Tactical board saved to Cloud Storage.");
    } catch (err) {
      console.error("Failed to upload tactical board to Storage:", err);
      // Fall back to dataUrl so user data is never lost
      setBlock(blockId, { drawing: dataUrl });
      toast.warning("Saved locally. Offline fallback preserved.");
    } finally {
      setUploadingBlock(null);
    }
  }

  function setBlock(id: string, patch: Partial<PlanBlock>) {
    onChange({
      ...value,
      blocks: blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    });
  }

  function addBlock() {
    const b = newBlock();
    onChange({ ...value, blocks: [...blocks, b] });
    setOpenBlock(b.id);
  }

  function removeBlock(id: string) {
    onChange({ ...value, blocks: blocks.filter((b) => b.id !== id) });
  }

  function moveBlock(index: number, dir: -1 | 1) {
    const next = blocks.slice();
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    const a = next[index]!;
    const b = next[target]!;
    next[index] = b;
    next[target] = a;
    onChange({ ...value, blocks: next });
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Plan title">
          <Input
            value={value.title}
            onChange={(v) => onChange({ ...value, title: v })}
            placeholder="Transition week"
          />
        </Field>
        <Field label="Category">
          <Select
            value={value.category}
            onChange={(v) => onChange({ ...value, category: v })}
            options={db.lists["Age categories"] ?? ["U-14"]}
          />
        </Field>
        {coachLocked ? null : (
          <Field label="Coach">
            <Select
              value={value.coach}
              onChange={(v) => onChange({ ...value, coach: v })}
              options={db.coaches.map((c) => c.name)}
            />
          </Field>
        )}
        <Field label="Date">
          <Input type="date" value={value.date} onChange={(v) => onChange({ ...value, date: v })} />
        </Field>
        <Field label="Focus">
          <Input
            value={value.focus}
            onChange={(v) => onChange({ ...value, focus: v })}
            placeholder="Fast break spacing"
          />
        </Field>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="label-mono">Session timeline</span>
          <Chip tone="accent">{total} MIN</Chip>
          <div className="ml-auto flex items-center gap-2">
            {onOpenDrillSelector && (
              <button
                type="button"
                id="btn-plan-open-drills"
                onClick={onOpenDrillSelector}
                className="flex items-center gap-1.5 rounded-md bg-court-500 px-3 py-1 font-mono text-[11px] font-semibold text-ink-950 transition-colors hover:bg-court-400 shadow-sm"
              >
                <BookOpen className="h-3.5 w-3.5" />
                Browse Drill Repo
              </button>
            )}
            <Button variant="ghost" onClick={addBlock}>
              + Add section
            </Button>
          </div>
        </div>
        <div className="flex h-3 overflow-hidden rounded-full bg-ink-850">
          {blocks.map((b, i) => (
            <div
              key={b.id}
              className={BLOCK_COLORS[i % BLOCK_COLORS.length]}
              style={{ width: `${total ? ((b.minutes || 0) / total) * 100 : 0}%` }}
              title={`${b.name} · ${b.minutes} min`}
            />
          ))}
        </div>
      </div>

      <div className="space-y-2">
        {blocks.map((b, i) => {
          const open = openBlock === b.id;
          return (
            <div key={b.id} className="rounded-md bg-ink-850 ring-1 ring-ink-700">
              <div className="flex flex-wrap items-center gap-2 px-3 py-2">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${BLOCK_COLORS[i % BLOCK_COLORS.length]}`}
                />
                <button
                  type="button"
                  onClick={() => setOpenBlock(open ? null : b.id)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink-100">{b.name}</span>
                    {b.category && (
                      <span className="rounded bg-ink-800 px-1.5 py-0.2 font-mono text-[9px] text-court-400">
                        {b.category}
                      </span>
                    )}
                  </div>
                  <div className="font-mono text-[10px] text-ink-400">
                    {b.minutes} min
                    {b.diagramUrl ? " · diagram" : ""}
                    {b.drawing ? " · board drawn" : ""}
                  </div>
                </button>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveBlock(i, -1)}
                    aria-label="Move up"
                    className="rounded px-1.5 py-1 font-mono text-[10px] text-ink-300 ring-1 ring-ink-700"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => moveBlock(i, 1)}
                    aria-label="Move down"
                    className="rounded px-1.5 py-1 font-mono text-[10px] text-ink-300 ring-1 ring-ink-700"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => removeBlock(b.id)}
                    className="rounded px-2 py-1 font-mono text-[10px] text-bad ring-1 ring-ink-700"
                  >
                    DEL
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpenBlock(open ? null : b.id)}
                    className="rounded px-2 py-1 font-mono text-[10px] text-court-400 ring-1 ring-ink-700"
                  >
                    {open ? "CLOSE" : "OPEN"}
                  </button>
                </div>
              </div>

              {open ? (
                <div className="space-y-3 border-t border-ink-800 p-3">
                  <div className="grid gap-3 sm:grid-cols-[1fr_120px]">
                    <Field label="Section name">
                      <Input value={b.name} onChange={(v) => setBlock(b.id, { name: v })} />
                    </Field>
                    <Field label="Minutes">
                      <Input
                        type="number"
                        value={String(b.minutes)}
                        onChange={(v) => setBlock(b.id, { minutes: Number(v) || 0 })}
                      />
                    </Field>
                  </div>
                  <Field label="Coaching points">
                    <Textarea
                      rows={4}
                      value={b.notes}
                      onChange={(v) => setBlock(b.id, { notes: v })}
                      placeholder="Key cues, constraints, scoring…"
                    />
                  </Field>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Diagram / Media Link (Optional)">
                      <Input
                        value={b.diagramUrl || ""}
                        onChange={(v) => setBlock(b.id, { diagramUrl: v })}
                        placeholder="https://..."
                      />
                    </Field>
                    <Field label="Category / Focus">
                      <Input
                        value={b.category || ""}
                        onChange={(v) => setBlock(b.id, { category: v })}
                        placeholder="Shooting, Spacing, Defense..."
                      />
                    </Field>
                  </div>

                  {b.diagramUrl && (
                    <div className="rounded-lg bg-ink-900 p-2.5 ring-1 ring-ink-750">
                      <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] text-court-400">
                        <span className="flex items-center gap-1">
                          <ImageIcon className="h-3 w-3" /> Diagram Link Attached
                        </span>
                        <a
                          href={b.diagramUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-ink-400 hover:text-ink-200"
                        >
                          View External <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      </div>
                      <img
                        src={b.diagramUrl}
                        alt={b.name}
                        className="max-h-44 w-full rounded object-contain bg-ink-950 ring-1 ring-ink-800"
                      />
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <div className="label-mono">Drill drawing board</div>
                        {uploadingBlock === b.id && (
                          <span className="flex items-center gap-1 font-mono text-[10px] text-court-400">
                            <span className="h-1.5 w-1.5 animate-ping rounded-full bg-court-400" />
                            Syncing to Storage...
                          </span>
                        )}
                        {b.drawing?.startsWith("https://") && uploadingBlock !== b.id && (
                          <span className="font-mono text-[10px] text-good">✓ Cloud Stored</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setBlock(b.id, { drawing: b.drawing !== undefined ? undefined : null })
                        }
                        className="text-[10px] uppercase tracking-widest text-court-400 hover:text-court-300"
                      >
                        {b.drawing !== undefined ? "- Remove board" : "+ Add board"}
                      </button>
                    </div>
                    {b.drawing !== undefined && (
                      <Suspense
                        fallback={
                          <div className="flex h-64 items-center justify-center rounded-lg border border-ink-800 bg-ink-950 font-mono text-xs text-ink-400">
                            Loading tactical drawing board...
                          </div>
                        }
                      >
                        <DrawingBoard
                          value={b.drawing || null}
                          onChange={(d) => {
                            persistDrawingToStorage(b.id, d);
                          }}
                          sport={db.academy.sport}
                        />
                      </Suspense>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function PlanView({ plan }: { plan: Plan }) {
  const planBlocks = plan.blocks ?? [];
  const total = planBlocks.reduce((s, b) => s + (b.minutes || 0), 0);
  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-display text-lg text-ink-100">{plan.title}</span>
        <Chip tone="accent">{total} MIN</Chip>
        <span className="font-mono text-[10px] text-ink-400">
          {plan.category} · {plan.coach} · {plan.date}
        </span>
      </div>
      {plan.focus ? <div className="text-sm text-ink-300">Focus: {plan.focus}</div> : null}
      {planBlocks.map((b) => (
        <div key={b.id} className="rounded-md bg-ink-850 p-3 ring-1 ring-ink-700">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-ink-100">{b.name}</span>
            {b.category && (
              <span className="rounded bg-ink-800 px-1.5 py-0.2 font-mono text-[9px] text-court-400">
                {b.category}
              </span>
            )}
            <span className="ml-auto font-mono text-[10px] text-ink-400">{b.minutes} min</span>
          </div>
          {b.notes ? (
            <p className="mt-1.5 whitespace-pre-line text-xs text-ink-300">{b.notes}</p>
          ) : null}
          {b.diagramUrl && (
            <div className="mt-2">
              <img
                src={b.diagramUrl}
                alt={`${b.name} diagram`}
                className="max-h-56 w-full rounded object-contain bg-ink-900 ring-1 ring-ink-700"
              />
            </div>
          )}
          {b.drawing ? (
            <img
              src={b.drawing}
              alt={`${b.name} drill`}
              className="mt-2 w-full rounded ring-1 ring-ink-700"
            />
          ) : !b.diagramUrl ? (
            <div className="mt-2 grid h-16 place-items-center rounded bg-ink-900 font-mono text-[10px] text-ink-400 ring-1 ring-ink-700">
              No drill drawing
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

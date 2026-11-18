import { useState, useMemo } from "react";
import { useDB, type MasterDrill, type DrillCategory, type PlanBlock } from "@/lib/data-store";
import { masterDrills as fallbackDrills } from "@/lib/mock-data";
import { Chip, Input, Button } from "@/components/kit";
import { toast } from "sonner";
import {
  BookOpen,
  Search,
  Plus,
  Clock,
  Zap,
  Target,
  Layers,
  Sparkles,
  X,
  ExternalLink,
  Shield,
  Activity,
  Maximize2,
  Check,
} from "lucide-react";

export const DRILL_CATEGORIES: (DrillCategory | "All")[] = [
  "All",
  "Shooting",
  "Ball Handling",
  "Defense",
  "Transition",
  "Spacing",
  "Finishing",
  "Rebounding",
];

interface DrillSelectorProps {
  open: boolean;
  onClose: () => void;
  onInsertDrill: (drill: MasterDrill, block: PlanBlock) => void;
  existingBlockCount?: number;
}

export function DrillSelector({
  open,
  onClose,
  onInsertDrill,
  existingBlockCount = 0,
}: DrillSelectorProps) {
  const { db } = useDB();
  const [selectedCategory, setSelectedCategory] = useState<string>("All");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>("All");
  const [insertedIds, setInsertedIds] = useState<Set<string>>(new Set());
  const [previewDrill, setPreviewDrill] = useState<MasterDrill | null>(null);

  // Combine live DB drills with fallback seed drills to ensure comprehensive repository
  const allDrills: MasterDrill[] = useMemo(() => {
    const list = db.drills && db.drills.length > 0 ? db.drills : fallbackDrills;
    // Deduplicate by ID
    const map = new Map<string, MasterDrill>();
    fallbackDrills.forEach((d) => map.set(d.id, d));
    list.forEach((d) => map.set(d.id, d));
    return Array.from(map.values());
  }, [db.drills]);

  const filteredDrills = useMemo(() => {
    return allDrills.filter((drill) => {
      const matchCategory =
        selectedCategory === "All" ||
        (typeof drill.category === "string"
          ? drill.category.toLowerCase() === selectedCategory.toLowerCase()
          : Array.isArray(drill.category)
            ? (drill.category as unknown[]).some(
                (c) => String(c).toLowerCase() === selectedCategory.toLowerCase(),
              )
            : false);

      const matchDifficulty =
        selectedDifficulty === "All" ||
        (typeof drill.difficulty === "string"
          ? drill.difficulty.toLowerCase() === selectedDifficulty.toLowerCase()
          : false);

      const q = searchQuery.trim().toLowerCase();
      const pointsMatch =
        typeof drill.coachingPoints === "string"
          ? drill.coachingPoints.toLowerCase().includes(q)
          : Array.isArray(drill.coachingPoints)
            ? (drill.coachingPoints as unknown[]).some((p) => String(p).toLowerCase().includes(q))
            : false;
      const tagsMatch = Array.isArray(drill.tags)
        ? (drill.tags as unknown[]).some((t) => String(t).toLowerCase().includes(q))
        : typeof drill.tags === "string"
          ? (drill.tags as string).toLowerCase().includes(q)
          : false;
      const catMatchSearch =
        typeof drill.category === "string"
          ? drill.category.toLowerCase().includes(q)
          : Array.isArray(drill.category)
            ? (drill.category as unknown[]).some((c) => String(c).toLowerCase().includes(q))
            : false;

      const matchSearch =
        !q ||
        (drill.title && drill.title.toLowerCase().includes(q)) ||
        pointsMatch ||
        catMatchSearch ||
        tagsMatch ||
        (drill.description && drill.description.toLowerCase().includes(q)) ||
        (drill.equipment && drill.equipment.toLowerCase().includes(q));

      return matchCategory && matchDifficulty && matchSearch;
    });
  }, [allDrills, selectedCategory, selectedDifficulty, searchQuery]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { All: allDrills.length };
    allDrills.forEach((d) => {
      if (typeof d.category === "string") {
        counts[d.category] = (counts[d.category] || 0) + 1;
      } else if (Array.isArray(d.category)) {
        (d.category as unknown[]).forEach((cat) => {
          const strCat = String(cat);
          counts[strCat] = (counts[strCat] || 0) + 1;
        });
      }
    });
    return counts;
  }, [allDrills]);

  if (!open) return null;

  function handleInsert(drill: MasterDrill) {
    const blockId = `b-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`;
    const newBlock: PlanBlock = {
      id: blockId,
      name: drill.title,
      minutes: drill.duration || 15,
      notes:
        typeof drill.coachingPoints === "string"
          ? drill.coachingPoints
          : Array.isArray(drill.coachingPoints)
            ? (drill.coachingPoints as string[]).join("\n• ")
            : "",
      drawing: drill.drawing || null,
      diagramUrl: drill.diagramUrl,
      mediaUrl: drill.mediaUrl,
      category: Array.isArray(drill.category)
        ? String(drill.category[0] || "")
        : String(drill.category || ""),
      drillId: drill.id,
    };

    onInsertDrill(drill, newBlock);
    setInsertedIds((prev) => new Set(prev).add(drill.id));
    toast.success(`Inserted "${drill.title}" into session plan`, {
      description: `${drill.duration} min · ${Array.isArray(drill.category) ? drill.category.join(", ") : drill.category}`,
    });
  }

  return (
    <div
      id="drill-selector-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/80 p-3 backdrop-blur-sm sm:p-6"
    >
      <div className="relative flex h-full max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-ink-900 shadow-2xl ring-1 ring-ink-700">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-ink-800 bg-ink-850 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-court-500/10 text-court-400 ring-1 ring-court-500/30">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg font-bold text-ink-100">
                  Master Drill Repository
                </h2>
                <Chip tone="accent">{allDrills.length} DRILLS</Chip>
                {existingBlockCount > 0 && (
                  <span className="hidden font-mono text-[11px] text-ink-400 sm:inline">
                    · Plan has {existingBlockCount} sections
                  </span>
                )}
              </div>
              <p className="font-mono text-[11px] text-ink-400">
                Technical Director certified curriculum · 1-click insert into active session plan
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-ink-400 hover:bg-ink-800 hover:text-ink-200"
            title="Close drill repository"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Filters & Controls */}
        <div className="space-y-3 border-b border-ink-800 bg-ink-900/90 p-4 sm:px-6">
          {/* Category Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            {DRILL_CATEGORIES.map((cat) => {
              const count = categoryCounts[cat] || 0;
              const isSelected = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  id={`filter-category-${cat.toLowerCase().replace(/\s+/g, "-")}`}
                  onClick={() => setSelectedCategory(cat)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 font-mono text-[11px] font-medium transition-all ${
                    isSelected
                      ? "bg-court-500 text-ink-950 shadow-sm"
                      : "bg-ink-850 text-ink-300 ring-1 ring-ink-700 hover:bg-ink-800 hover:text-ink-100"
                  }`}
                >
                  <span>{cat}</span>
                  <span
                    className={`rounded-full px-1.5 py-0.2 text-[9px] ${
                      isSelected ? "bg-ink-950/20 text-ink-950" : "bg-ink-800 text-ink-400"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Search & Difficulty Filter */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search drills by keyword, tag (e.g. Catch & Shoot, PnR, 5-Out), or coaching cues..."
                className="w-full rounded-md bg-ink-850 py-2 pl-9 pr-4 text-xs text-ink-100 placeholder-ink-400 ring-1 ring-ink-700 focus:outline-none focus:ring-2 focus:ring-court-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-400 hover:text-ink-200"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">
                Difficulty:
              </span>
              {["All", "Beginner", "Intermediate", "Advanced"].map((diff) => (
                <button
                  key={diff}
                  onClick={() => setSelectedDifficulty(diff)}
                  className={`rounded px-2.5 py-1 font-mono text-[10px] transition-colors ${
                    selectedDifficulty === diff
                      ? "bg-ink-700 text-ink-100 font-semibold"
                      : "text-ink-400 hover:text-ink-200"
                  }`}
                >
                  {diff}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Drill Cards Grid */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {filteredDrills.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Layers className="h-10 w-10 text-ink-600" />
              <h3 className="mt-3 text-sm font-medium text-ink-300">
                No drills match your criteria
              </h3>
              <p className="mt-1 font-mono text-[11px] text-ink-500">
                Try selecting a different category or clearing the search filter.
              </p>
              <button
                onClick={() => {
                  setSelectedCategory("All");
                  setSearchQuery("");
                  setSelectedDifficulty("All");
                }}
                className="mt-4 rounded-md bg-ink-800 px-3 py-1.5 font-mono text-xs text-court-400 ring-1 ring-ink-700 hover:bg-ink-750"
              >
                Reset All Filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {filteredDrills.map((drill) => {
                const wasInserted = insertedIds.has(drill.id);
                return (
                  <div
                    key={drill.id}
                    id={`drill-card-${drill.id}`}
                    className="flex flex-col justify-between rounded-lg bg-ink-850 p-4 ring-1 ring-ink-700 transition-all hover:ring-court-500/50"
                  >
                    <div>
                      {/* Top Header */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Chip tone="accent">
                              {Array.isArray(drill.category)
                                ? drill.category.join(" / ").toUpperCase()
                                : String(drill.category || "").toUpperCase()}
                            </Chip>
                            <span className="flex items-center gap-1 rounded bg-ink-800 px-2 py-0.5 font-mono text-[10px] text-court-400 ring-1 ring-ink-700">
                              <Clock className="h-3 w-3" />
                              {drill.duration} MIN
                            </span>
                            <span
                              className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase ${
                                drill.difficulty === "Advanced"
                                  ? "bg-bad/15 text-bad"
                                  : drill.difficulty === "Intermediate"
                                    ? "bg-warn/15 text-warn"
                                    : "bg-good/15 text-good"
                              }`}
                            >
                              {drill.difficulty}
                            </span>
                          </div>
                          <h3 className="mt-1.5 font-display text-sm font-semibold text-ink-100">
                            {drill.title}
                          </h3>
                        </div>

                        {drill.diagramUrl && (
                          <button
                            onClick={() => setPreviewDrill(drill)}
                            className="group relative flex h-14 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded border border-ink-700 bg-ink-900 hover:border-court-400"
                            title="Preview tactical diagram"
                          >
                            <img
                              src={drill.diagramUrl}
                              alt={drill.title}
                              className="h-full w-full object-cover transition-transform group-hover:scale-110"
                            />
                            <div className="absolute inset-0 flex items-center justify-center bg-ink-950/40 opacity-0 transition-opacity group-hover:opacity-100">
                              <Maximize2 className="h-3.5 w-3.5 text-ink-100" />
                            </div>
                          </button>
                        )}
                      </div>

                      {/* Description */}
                      {drill.description && (
                        <p className="mt-2 text-xs leading-relaxed text-ink-300">
                          {drill.description}
                        </p>
                      )}

                      {/* Coaching Points / Points of Emphasis */}
                      <div className="mt-3 rounded-md bg-ink-900/80 p-3 ring-1 ring-ink-750">
                        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-court-400">
                          <Target className="h-3 w-3" />
                          Coaching Points & Keys:
                        </div>
                        <div className="mt-1.5 whitespace-pre-line text-[11px] leading-relaxed text-ink-300">
                          {typeof drill.coachingPoints === "string"
                            ? drill.coachingPoints
                            : Array.isArray(drill.coachingPoints)
                              ? (drill.coachingPoints as string[]).join("\n• ")
                              : ""}
                        </div>
                      </div>

                      {/* Tags & Equipment */}
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        {drill.equipment && (
                          <span className="font-mono text-[10px] text-ink-400">
                            Equipment: {drill.equipment} ·
                          </span>
                        )}
                        {(Array.isArray(drill.tags)
                          ? drill.tags
                          : typeof drill.tags === "string"
                            ? (drill.tags as string).split(",").map((t) => t.trim())
                            : []
                        ).map((tag) => (
                          <span
                            key={tag}
                            className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-[9px] text-ink-400"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Bottom Action Button */}
                    <div className="mt-4 flex items-center justify-between border-t border-ink-800 pt-3">
                      <span className="font-mono text-[10px] text-ink-400">
                        {wasInserted ? (
                          <span className="flex items-center gap-1 text-good">
                            <Check className="h-3 w-3" /> Added to current draft
                          </span>
                        ) : (
                          "Ready to insert into session"
                        )}
                      </span>

                      <button
                        id={`btn-insert-drill-${drill.id}`}
                        onClick={() => handleInsert(drill)}
                        className={`flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-all ${
                          wasInserted
                            ? "bg-good/20 text-good ring-1 ring-good/40 hover:bg-good/30"
                            : "bg-court-500 text-ink-950 hover:bg-court-400 shadow-sm"
                        }`}
                      >
                        <Plus className="h-3.5 w-3.5 stroke-[2.5]" />
                        <span>{wasInserted ? "Insert Again" : "Insert into Session Plan"}</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-ink-800 bg-ink-850 px-6 py-3">
          <div className="font-mono text-[11px] text-ink-400">
            Showing {filteredDrills.length} of {allDrills.length} master drills
          </div>
          <Button variant="ghost" onClick={onClose}>
            Done Browsing
          </Button>
        </div>
      </div>

      {/* Modal Diagram Preview */}
      {previewDrill && (
        <div
          className="fixed inset-0 z-60 flex items-center justify-center bg-ink-950/90 p-4"
          onClick={() => setPreviewDrill(null)}
        >
          <div
            className="relative max-h-[85vh] max-w-2xl overflow-hidden rounded-xl bg-ink-900 p-4 ring-1 ring-ink-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h4 className="font-display font-semibold text-ink-100">{previewDrill.title}</h4>
                <p className="font-mono text-[10px] text-ink-400">
                  {previewDrill.category} · {previewDrill.duration} MIN
                </p>
              </div>
              <button
                onClick={() => setPreviewDrill(null)}
                className="rounded p-1 text-ink-400 hover:text-ink-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {previewDrill.diagramUrl && (
              <img
                src={previewDrill.diagramUrl}
                alt={previewDrill.title}
                className="max-h-[60vh] w-full rounded-lg object-contain ring-1 ring-ink-700"
              />
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  handleInsert(previewDrill);
                  setPreviewDrill(null);
                }}
                className="flex items-center gap-1.5 rounded-md bg-court-500 px-4 py-2 text-xs font-semibold text-ink-950"
              >
                <Plus className="h-4 w-4" />
                Insert into Session Plan
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

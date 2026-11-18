import { useState, useEffect } from "react";
import { Plus, Trash2, Clock, Copy, Check } from "lucide-react";
import { Button } from "@/components/kit";
import { cn } from "@/lib/utils";
import type { BranchScheduleSlot, Court, DaySchedule, TimeWindow } from "@/lib/mock-data";

export const DAYS_OF_WEEK: {
  key: DaySchedule["day"];
  short: string;
  full: string;
}[] = [
  { key: "Mon", short: "Mon", full: "Monday" },
  { key: "Tue", short: "Tue", full: "Tuesday" },
  { key: "Wed", short: "Wed", full: "Wednesday" },
  { key: "Thu", short: "Thu", full: "Thursday" },
  { key: "Fri", short: "Fri", full: "Friday" },
  { key: "Sat", short: "Sat", full: "Saturday" },
  { key: "Sun", short: "Sun", full: "Sunday" },
];

export function formatTime12h(time24: string): string {
  if (!time24 || !time24.includes(":")) return time24 || "";
  const [hStr, mStr] = time24.split(":");
  const h = parseInt(hStr || "0", 10);
  const m = mStr || "00";
  if (Number.isNaN(h)) return time24;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === "00" ? `${h12}:00 ${period}` : `${h12}:${m} ${period}`;
}

export function createDefaultWeeklySchedule(): DaySchedule[] {
  return DAYS_OF_WEEK.map((d, idx) => ({
    day: d.key,
    available: idx < 5,
    windows:
      idx < 5
        ? [
            {
              id: `win-${d.key.toLowerCase()}-1`,
              startTime: "16:00",
              endTime: "19:00",
            },
          ]
        : [],
  }));
}

export function buildWeeklySchedule(
  weeklySchedule?: DaySchedule[],
  legacySlots?: BranchScheduleSlot[],
): DaySchedule[] {
  if (weeklySchedule && weeklySchedule.length > 0) {
    return DAYS_OF_WEEK.map((d) => {
      const existing = weeklySchedule.find((w) => w.day === d.key);
      if (existing) {
        const cleanWindows = (existing.windows || []).map((w, idx) => ({
          id: w.id || `win-${d.key.toLowerCase()}-${idx + 1}`,
          startTime: w.startTime || "16:00",
          endTime: w.endTime || "18:00",
        }));
        return {
          day: d.key,
          available: Boolean(existing.available && cleanWindows.length > 0),
          windows: cleanWindows,
        };
      }
      return { day: d.key, available: false, windows: [] };
    });
  }

  if (legacySlots && legacySlots.length > 0) {
    return DAYS_OF_WEEK.map((d) => {
      const matchingSlots = legacySlots.filter(
        (s) => !s.isClosed && Array.isArray(s.days) && s.days.includes(d.key),
      );
      if (matchingSlots.length === 0) {
        return { day: d.key, available: false, windows: [] };
      }
      const windows: TimeWindow[] = matchingSlots.map((s, idx) => ({
        id: `win-${d.key.toLowerCase()}-${idx + 1}`,
        startTime: s.startTime || "16:00",
        endTime: s.endTime || "18:00",
      }));
      return {
        day: d.key,
        available: true,
        windows,
      };
    });
  }

  return createDefaultWeeklySchedule();
}

export function computeOperatingHoursFromWeekly(weekly: DaySchedule[]): string {
  if (!weekly || weekly.length === 0) return "";
  const activeDays = weekly.filter((d) => d.available && d.windows.length > 0);
  if (activeDays.length === 0) return "No available hours configured";

  return activeDays
    .map((d) => {
      const windowsText = d.windows
        .map((w) => `${formatTime12h(w.startTime)} - ${formatTime12h(w.endTime)}`)
        .join(", ");
      return `${d.day}: ${windowsText}`;
    })
    .join(" · ");
}

export function weeklyToScheduleSlots(weekly: DaySchedule[]): BranchScheduleSlot[] {
  const slots: BranchScheduleSlot[] = [];
  for (const d of weekly) {
    if (!d.available || d.windows.length === 0) continue;
    for (let i = 0; i < d.windows.length; i++) {
      const w = d.windows[i];
      if (!w) continue;
      slots.push({
        id: w.id || `slot-${d.day.toLowerCase()}-${i + 1}`,
        days: [d.day],
        startTime: w.startTime,
        endTime: w.endTime,
      });
    }
  }
  return slots;
}

interface BranchScheduleBuilderProps {
  value?: string;
  schedules?: BranchScheduleSlot[];
  weeklySchedule?: DaySchedule[];
  courts?: Court[];
  selectedTarget?: "branch" | number;
  onSelectTarget?: (target: "branch" | number) => void;
  onChange: (
    formattedText: string,
    schedules: BranchScheduleSlot[],
    weeklySchedule: DaySchedule[],
  ) => void;
  onCourtsChange?: (courts: Court[]) => void;
}

export function BranchScheduleBuilder({
  schedules = [],
  weeklySchedule,
  courts = [],
  selectedTarget: externalTarget,
  onSelectTarget,
  onChange,
  onCourtsChange,
}: BranchScheduleBuilderProps) {
  const [internalTarget, setInternalTarget] = useState<"branch" | number>("branch");
  const activeTarget = externalTarget !== undefined ? externalTarget : internalTarget;

  const setActiveTarget = (next: "branch" | number) => {
    setInternalTarget(next);
    onSelectTarget?.(next);
  };

  const [branchWeekly, setBranchWeekly] = useState<DaySchedule[]>(() =>
    buildWeeklySchedule(weeklySchedule, schedules),
  );

  const [copiedDay, setCopiedDay] = useState<string | null>(null);

  // Sync state if branch switches in parent modal
  useEffect(() => {
    setBranchWeekly(buildWeeklySchedule(weeklySchedule, schedules));
  }, [weeklySchedule, schedules]);

  // Reset activeTarget to "branch" if selected court index was removed
  useEffect(() => {
    if (typeof activeTarget === "number" && activeTarget >= courts.length) {
      setActiveTarget("branch");
    }
  }, [courts.length, activeTarget]);

  const isCourtTarget = typeof activeTarget === "number" && Boolean(courts[activeTarget]);
  const targetCourt = isCourtTarget ? courts[activeTarget as number] : undefined;

  const currentWeekly: DaySchedule[] = isCourtTarget
    ? buildWeeklySchedule(
        targetCourt?.weeklySchedule,
        targetCourt?.schedules ||
          (targetCourt?.weeklySchedule
            ? undefined
            : branchWeekly
              ? weeklyToScheduleSlots(branchWeekly)
              : schedules),
      )
    : branchWeekly;

  const commitWeeklyChange = (nextWeekly: DaySchedule[]) => {
    const formatted = computeOperatingHoursFromWeekly(nextWeekly);
    const legacySlots = weeklyToScheduleSlots(nextWeekly);

    if (courts.length === 1) {
      setBranchWeekly(nextWeekly);
      onChange(formatted, legacySlots, nextWeekly);
      if (onCourtsChange) {
        onCourtsChange(
          courts.map((c) => ({
            ...c,
            schedule: formatted,
            operatingHours: formatted,
            weeklySchedule: nextWeekly,
            schedules: legacySlots,
          })),
        );
      }
      return;
    }

    if (isCourtTarget && onCourtsChange && typeof activeTarget === "number") {
      const updatedCourts = courts.map((c, idx) =>
        idx === activeTarget
          ? {
              ...c,
              schedule: formatted,
              weeklySchedule: nextWeekly,
              schedules: legacySlots,
              operatingHours: formatted,
            }
          : c,
      );
      onCourtsChange(updatedCourts);
    } else {
      setBranchWeekly(nextWeekly);
      onChange(formatted, legacySlots, nextWeekly);
    }
  };

  const handleToggleDay = (dayKey: DaySchedule["day"]) => {
    const next = currentWeekly.map((d) => {
      if (d.day !== dayKey) return d;
      const nextAvailable = !d.available;
      const nextWindows =
        nextAvailable && d.windows.length === 0
          ? [
              {
                id: `win-${dayKey.toLowerCase()}-${Date.now().toString(36)}`,
                startTime: "16:30",
                endTime: "18:00",
              },
            ]
          : d.windows;
      return {
        ...d,
        available: nextAvailable,
        windows: nextWindows,
      };
    });
    commitWeeklyChange(next);
  };

  const handleAddWindow = (dayKey: DaySchedule["day"]) => {
    const next = currentWeekly.map((d) => {
      if (d.day !== dayKey) return d;
      const lastWin = d.windows[d.windows.length - 1];
      let defaultStart = "16:30";
      let defaultEnd = "18:00";
      if (lastWin) {
        defaultStart = "21:00";
        defaultEnd = "23:00";
      }
      const newWin: TimeWindow = {
        id: `win-${dayKey.toLowerCase()}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 5)}`,
        startTime: defaultStart,
        endTime: defaultEnd,
      };
      return {
        ...d,
        available: true,
        windows: [...d.windows, newWin],
      };
    });
    commitWeeklyChange(next);
  };

  const handleRemoveWindow = (dayKey: DaySchedule["day"], winId: string) => {
    const next = currentWeekly.map((d) => {
      if (d.day !== dayKey) return d;
      const filtered = d.windows.filter((w) => w.id !== winId);
      return {
        ...d,
        available: filtered.length > 0,
        windows: filtered,
      };
    });
    commitWeeklyChange(next);
  };

  const handleTimeChange = (
    dayKey: DaySchedule["day"],
    winId: string,
    field: "startTime" | "endTime",
    val: string,
  ) => {
    const next = currentWeekly.map((d) => {
      if (d.day !== dayKey) return d;
      return {
        ...d,
        windows: d.windows.map((w) => (w.id === winId ? { ...w, [field]: val } : w)),
      };
    });
    commitWeeklyChange(next);
  };

  const handleCopyDayToWeekdays = (sourceDay: DaySchedule) => {
    const weekdays: DaySchedule["day"][] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
    const next = currentWeekly.map((d) => {
      if (!weekdays.includes(d.day) || d.day === sourceDay.day) return d;
      return {
        day: d.day,
        available: sourceDay.available,
        windows: sourceDay.windows.map((w, idx) => ({
          id: `win-${d.day.toLowerCase()}-${Date.now().toString(36)}-${idx}`,
          startTime: w.startTime,
          endTime: w.endTime,
        })),
      };
    });
    commitWeeklyChange(next);
    setCopiedDay(sourceDay.day);
    setTimeout(() => setCopiedDay(null), 1500);
  };

  const handleApplyBranchToAllCourts = () => {
    if (!onCourtsChange || courts.length === 0) return;
    const formatted = computeOperatingHoursFromWeekly(branchWeekly);
    const legacySlots = weeklyToScheduleSlots(branchWeekly);
    const nextCourts = courts.map((c) => ({
      ...c,
      weeklySchedule: branchWeekly.map((d) => ({
        day: d.day,
        available: d.available,
        windows: d.windows.map((w) => ({ ...w })),
      })),
      schedules: legacySlots.map((s) => ({ ...s, days: [...s.days] })),
      operatingHours: formatted,
    }));
    onCourtsChange(nextCourts);
  };

  const handleCopyBranchToThisCourt = () => {
    if (!isCourtTarget) return;
    const cloned = branchWeekly.map((d) => ({
      day: d.day,
      available: d.available,
      windows: d.windows.map((w, idx) => ({
        id: `win-${d.day.toLowerCase()}-${Date.now().toString(36)}-${idx}`,
        startTime: w.startTime,
        endTime: w.endTime,
      })),
    }));
    commitWeeklyChange(cloned);
  };

  return (
    <div className="space-y-3 rounded-lg border border-ink-800 bg-ink-950/70 p-3 sm:p-4">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-800 pb-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-court-500/15 text-court-400 ring-1 ring-court-500/30">
            <Clock className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-200">
              Daily Available Time Schedule
            </h4>
            <p className="text-[11px] text-ink-400">
              Set available time windows for each day of the week (and per court when multiple
              courts exist)
            </p>
          </div>
        </div>

        {courts.length > 0 && !isCourtTarget && onCourtsChange && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={handleApplyBranchToAllCourts}
            className="text-court-300 border-court-500/30 hover:bg-court-500/10"
            title="Copy the branch default schedule to all courts"
          >
            <Copy className="h-3 w-3 mr-1" />
            <span>Apply to All Courts ({courts.length})</span>
          </Button>
        )}

        {isCourtTarget && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={handleCopyBranchToThisCourt}
            className="text-court-300 border-court-500/30 hover:bg-court-500/10"
            title="Copy the branch default schedule into this court"
          >
            <Copy className="h-3 w-3 mr-1" />
            <span>Copy from Branch Schedule</span>
          </Button>
        )}
      </div>

      {/* Court / Branch Schedule Selector Tabs */}
      {courts.length <= 1 ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-court-500/25 bg-court-500/10 px-3 py-2 text-xs">
          <div className="flex items-center gap-2 font-mono text-court-300">
            <span className="inline-block h-2 w-2 rounded-full bg-court-400" />
            <span>
              <strong>Single-Court Facility:</strong> Branch Master Schedule automatically applies
              to <span className="underline">{courts[0]?.name?.trim() || "Main Court"}</span>
            </span>
          </div>
          <span className="font-mono text-[10px] uppercase text-ink-400">1 Court</span>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase tracking-wider text-ink-400">
            <span>
              Multi-Court Facility — Select Target to Configure Dedicated Schedule per Court
            </span>
            <span className="text-court-300 font-semibold">{courts.length} courts in branch</span>
          </div>
          <div className="flex flex-wrap gap-1.5 rounded-md bg-ink-900/90 p-1.5 ring-1 ring-ink-800">
            <button
              type="button"
              onClick={() => setActiveTarget("branch")}
              className={cn(
                "flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-mono transition-colors",
                activeTarget === "branch"
                  ? "bg-court-500 text-ink-950 font-bold shadow-sm"
                  : "bg-ink-850 text-ink-300 hover:bg-ink-800 hover:text-ink-100",
              )}
            >
              <span>Branch General Schedule</span>
            </button>

            {courts.map((c, idx) => {
              const courtName = c.name?.trim() || `Court ${idx + 1}`;
              const isSelected = activeTarget === idx;
              const hasCustomSchedule = Boolean(
                c.weeklySchedule &&
                c.weeklySchedule.some((d) => d.available && d.windows.length > 0),
              );
              return (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setActiveTarget(idx)}
                  className={cn(
                    "flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-mono transition-colors",
                    isSelected
                      ? "bg-court-500 text-ink-950 font-bold shadow-sm"
                      : "bg-ink-850 text-ink-300 hover:bg-ink-800 hover:text-ink-100",
                  )}
                >
                  <span>{courtName}</span>
                  {hasCustomSchedule && (
                    <span
                      className={cn(
                        "rounded px-1 py-0.2 text-[9px]",
                        isSelected
                          ? "bg-ink-950/20 text-ink-950"
                          : "bg-court-500/15 text-court-400",
                      )}
                    >
                      Custom
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Day-by-Day Rows (Mon - Sun) */}
      <div className="space-y-2">
        {DAYS_OF_WEEK.map((dayMeta) => {
          const dayEntry = currentWeekly.find((d) => d.day === dayMeta.key) || {
            day: dayMeta.key,
            available: false,
            windows: [],
          };

          return (
            <div
              key={dayMeta.key}
              className={cn(
                "rounded-md border p-2.5 transition-colors",
                dayEntry.available
                  ? "border-ink-750 bg-ink-900/90"
                  : "border-ink-850 bg-ink-950/40 opacity-75",
              )}
            >
              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-start sm:justify-between">
                {/* Left: Day Toggle & Label */}
                <div className="flex items-center justify-between sm:w-44 sm:shrink-0 sm:pt-1">
                  <label className="flex cursor-pointer items-center gap-2.5 select-none">
                    <input
                      type="checkbox"
                      checked={dayEntry.available}
                      onChange={() => handleToggleDay(dayMeta.key)}
                      className="h-4 w-4 rounded border-ink-700 bg-ink-850 text-court-500 focus:ring-0"
                    />
                    <div>
                      <div className="text-xs font-semibold text-ink-100">{dayMeta.full}</div>
                      <div className="font-mono text-[10px] text-ink-400">
                        {dayEntry.available
                          ? `${dayEntry.windows.length} time ${dayEntry.windows.length === 1 ? "window" : "windows"}`
                          : "Unavailable"}
                      </div>
                    </div>
                  </label>

                  {dayEntry.available && dayEntry.windows.length > 0 && (
                    <button
                      type="button"
                      onClick={() => handleCopyDayToWeekdays(dayEntry)}
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] text-ink-400 hover:bg-ink-800 hover:text-court-300 sm:hidden"
                      title="Copy this day's hours to Mon–Fri"
                    >
                      {copiedDay === dayMeta.key ? (
                        <>
                          <Check className="h-3 w-3 text-good" />
                          <span className="text-good">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3 w-3" />
                          <span>Copy M-F</span>
                        </>
                      )}
                    </button>
                  )}
                </div>

                {/* Right: Time Windows for this Day */}
                <div className="flex-1 space-y-2">
                  {dayEntry.available ? (
                    <>
                      <div className="space-y-2">
                        {dayEntry.windows.map((win, wIdx) => (
                          <div
                            key={win.id}
                            className="flex flex-wrap items-center gap-2 rounded bg-ink-850/90 px-2.5 py-1.5 ring-1 ring-ink-800"
                          >
                            <span className="font-mono text-[10px] text-ink-400 uppercase">
                              {wIdx === 0 ? "From" : "Then"}
                            </span>
                            <input
                              type="time"
                              value={win.startTime}
                              onChange={(e) =>
                                handleTimeChange(dayMeta.key, win.id, "startTime", e.target.value)
                              }
                              className="rounded bg-ink-900 px-2 py-1 font-mono text-xs text-ink-100 border border-ink-700 focus:border-court-500 focus:outline-none"
                            />
                            <span className="font-mono text-[10px] text-ink-400 uppercase">to</span>
                            <input
                              type="time"
                              value={win.endTime}
                              onChange={(e) =>
                                handleTimeChange(dayMeta.key, win.id, "endTime", e.target.value)
                              }
                              className="rounded bg-ink-900 px-2 py-1 font-mono text-xs text-ink-100 border border-ink-700 focus:border-court-500 focus:outline-none"
                            />

                            <span className="hidden md:inline-block rounded bg-court-500/10 px-2 py-0.5 font-mono text-[10px] text-court-300 ring-1 ring-court-500/20">
                              {formatTime12h(win.startTime)} – {formatTime12h(win.endTime)}
                            </span>

                            <button
                              type="button"
                              onClick={() => handleRemoveWindow(dayMeta.key, win.id)}
                              className="ml-auto rounded p-1 text-ink-400 hover:bg-bad/10 hover:text-bad"
                              title="Remove time window"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                        <button
                          type="button"
                          onClick={() => handleAddWindow(dayMeta.key)}
                          className="inline-flex items-center gap-1 rounded bg-court-500/10 px-2.5 py-1 font-mono text-[11px] font-medium text-court-300 ring-1 ring-court-500/30 hover:bg-court-500/20 transition-colors"
                        >
                          <Plus className="h-3 w-3" />
                          <span>Add time window on {dayMeta.short}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleCopyDayToWeekdays(dayEntry)}
                          className="hidden sm:inline-flex items-center gap-1 rounded px-2 py-1 font-mono text-[10px] text-ink-400 hover:bg-ink-800 hover:text-court-300 transition-colors"
                          title="Copy this day's time windows to Monday–Friday"
                        >
                          {copiedDay === dayMeta.key ? (
                            <>
                              <Check className="h-3 w-3 text-good" />
                              <span className="text-good">Copied to Mon–Fri</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              <span>Copy {dayMeta.short} to Mon–Fri</span>
                            </>
                          )}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center justify-between py-0.5">
                      <span className="font-mono text-xs text-ink-500">
                        No available time slots set for {dayMeta.full}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleAddWindow(dayMeta.key)}
                        className="inline-flex items-center gap-1 rounded bg-ink-850 px-2.5 py-1 font-mono text-[11px] text-ink-300 ring-1 ring-ink-750 hover:bg-ink-800 hover:text-court-300 transition-colors"
                      >
                        <Plus className="h-3 w-3" />
                        <span>Add available time</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Formatted Schedule Summary */}
      <div className="rounded-md border border-ink-800/80 bg-ink-900/60 p-2.5">
        <div className="flex items-center justify-between text-[10px] font-mono text-ink-400">
          <span className="uppercase tracking-wider font-semibold text-ink-300">
            {isCourtTarget
              ? `${targetCourt?.name?.trim() || `Court ${(activeTarget as number) + 1}`} — Available Schedule Summary`
              : "Branch Available Schedule Summary"}
          </span>
          <span className="text-court-400">Auto-saved to branch profile</span>
        </div>
        <div className="mt-1 font-mono text-xs text-ink-100 leading-relaxed">
          {computeOperatingHoursFromWeekly(currentWeekly)}
        </div>
      </div>
    </div>
  );
}

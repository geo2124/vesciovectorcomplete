import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/app-shell";
import {
  Button,
  Chip,
  Field,
  FilterSelect,
  Input,
  Modal,
  Panel,
  Select,
  money,
} from "@/components/kit";
import {
  useCollection,
  useDB,
  useTenantUser,
  COURT_ALLOCATION_OPTIONS,
  calculateSessionCourtRentalCost,
  calculateSessionTotalCostSummary,
  checkCourtScheduleConflict,
  type CourtAllocationType,
} from "@/lib/data-store";
import { useAuth } from "@/lib/auth";
import type { SessionItem } from "@/lib/mock-data";
import { syncGameOfficialFeesToLedger, removeGameOfficialFeesFromLedger } from "@/lib/match-fees";
import { GameOfficialsForm } from "@/components/game-officials-form";
import { toast } from "sonner";

export const Route = createFileRoute("/calendar")({
  head: () => ({
    meta: [
      { title: "Calendar — Vescio Vector" },
      {
        name: "description",
        content:
          "Month, week and day views of every practice, game, camp, seminar and academy event.",
      },
      { property: "og:title", content: "Calendar — Vescio Vector" },
      { property: "og:description", content: "All academy activity in month, week or day view." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CalendarPage,
});

const views = ["Month", "Week", "Day"] as const;

const kindTone: Record<string, "accent" | "good" | "warn" | "neutral"> = {
  Practice: "good",
  Game: "accent",
  Seminar: "neutral",
  Camp: "warn",
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const MAX_RECURRING_ITERATIONS = 52;

function normalizeIsoDateString(dateStr?: string): string {
  if (typeof dateStr !== "string") return "";
  const trimmed = dateStr.trim();
  if (!trimmed) return "";
  const isoPart = trimmed.includes("T") ? trimmed.split("T")[0] : trimmed;
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(isoPart);
  if (!match) return "";
  const [, y, m, d] = match;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function safeParseDate(dateStr?: string): Date {
  const normalized = normalizeIsoDateString(dateStr);
  if (!normalized) return new Date();
  const parsed = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}

function toSafeIsoDate(d: Date): string {
  if (!d || Number.isNaN(d.getTime())) {
    return new Date().toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 10);
}

function generateRecurringSessionDates(startDateStr: string, endDateStr?: string): string[] {
  const cleanStart = normalizeIsoDateString(startDateStr) || toSafeIsoDate(new Date());
  const cleanEnd = normalizeIsoDateString(endDateStr);

  if (!cleanEnd || cleanEnd <= cleanStart) {
    return [cleanStart];
  }

  const startMs = new Date(`${cleanStart}T00:00:00Z`).getTime();
  const endMs = new Date(`${cleanEnd}T00:00:00Z`).getTime();
  if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
    return [cleanStart];
  }

  const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
  const dates: string[] = [];

  for (let i = 0; i < MAX_RECURRING_ITERATIONS; i++) {
    const stepDate = new Date(startMs + i * ONE_WEEK_MS);
    if (stepDate.getTime() > endMs) {
      break;
    }
    dates.push(toSafeIsoDate(stepDate));
  }

  return dates.length > 0 ? dates : [cleanStart];
}

function CalendarPage() {
  useCollection("sessions");
  useCollection("branches");
  useCollection("coaches");
  useCollection("teams");

  const { db, update, setEntity, deleteEntity, dispatchNotification } = useDB();
  const { user: authUser, loading: authLoading } = useAuth();
  const [view, setView] = useState<(typeof views)[number]>("Month");
  const first = normalizeIsoDateString(db.sessions[0]?.date) || toSafeIsoDate(new Date());
  const [cursor, setCursor] = useState(() => safeParseDate(first));
  const [selectedMobileDate, setSelectedMobileDate] = useState<string>(() => first);
  const [kind, setKind] = useState("");
  const [branch, setBranch] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<SessionItem | null>(null);
  const [form, setForm] = useState<Omit<SessionItem, "id">>({
    kind: "Practice",
    title: "",
    detail: "",
    date: first,
    time: "17:00",
    branch: "",
    coach: "",
    status: "Planned",
  });

  const safeCursor = Number.isNaN(cursor.getTime()) ? new Date() : cursor;
  const year = safeCursor.getFullYear();
  const month = safeCursor.getMonth();
  const currentUser = useTenantUser();
  const isBranchManager = currentUser?.role === "Branch Manager" && Boolean(currentUser?.branch);
  const userBranch = isBranchManager ? currentUser?.branch || "" : "";

  const branches = db.branches.map((b) => b.name);

  const visible = db.sessions
    .filter(
      (s) =>
        (!kind || s.kind === kind) &&
        (isBranchManager
          ? s.branch?.toLowerCase() === userBranch.toLowerCase()
          : !branch || s.branch === branch),
    )
    .sort(
      (a, b) =>
        String(a.date || "").localeCompare(String(b.date || "")) ||
        String(a.time || "").localeCompare(String(b.time || "")),
    );
  const forDate = (d: string) =>
    visible.filter((s) => (normalizeIsoDateString(s.date) || s.date) === d);

  function shift(n: number) {
    const next = new Date(safeCursor.getTime());
    if (view === "Month") next.setMonth(next.getMonth() + n);
    else if (view === "Week") next.setDate(next.getDate() + n * 7);
    else next.setDate(next.getDate() + n);
    setCursor(next);
    setSelectedMobileDate(toSafeIsoDate(next));
  }

  const canManageSessionFee =
    Boolean(currentUser) &&
    (currentUser?.role === "Super Admin" ||
      currentUser?.role === "Academy Manager" ||
      currentUser?.role === "Branch Manager" ||
      currentUser?.role === "Accountant");

  function openNew(date?: string | unknown) {
    setEditing(null);
    const validDate = typeof date === "string" ? normalizeIsoDateString(date) : "";
    const initialCoach = db.coaches[0]?.name || "";
    const matchedCoach = db.coaches.find((c) => c.name === initialCoach);
    const defaultRate = matchedCoach?.rate ?? 0;
    const defaultTeam = db.teams[0]?.name || "";
    setForm({
      kind: "Practice",
      title: "",
      team: defaultTeam,
      teamA: defaultTeam,
      teamB: "",
      gameType: (db.lists?.["Game types"]?.[0] as string) || "Friendly",
      referees: [],
      matchStaff: [],
      detail: "",
      date: validDate || toSafeIsoDate(safeCursor),
      time: "17:00",
      endTime: "18:00",
      endDate: "",
      branch: branches[0] ?? "",
      courtAllocation: "Full Court",
      coach: initialCoach,
      coachId: matchedCoach?.id,
      headCoach: initialCoach,
      headCoachId: matchedCoach?.id,
      coachRate: defaultRate,
      coachSessionFee: defaultRate,
      coachTransportFee: 0,
      rateOverwritten: false,
      status: "Planned",
    });
    setOpen(true);
  }

  function openEdit(e: SessionItem) {
    setEditing(e);
    const { id: _id, ...rest } = e;
    const coachName = (rest.coach || rest.headCoach || "").trim();
    const matched = db.coaches.find(
      (c) =>
        (rest.coachId && c.id === rest.coachId) ||
        (coachName && c.name.toLowerCase() === coachName.toLowerCase()),
    );
    const resolvedSessionFee =
      rest.coachSessionFee !== undefined && rest.coachSessionFee !== null
        ? rest.coachSessionFee
        : rest.coachRate !== undefined && rest.coachRate !== null
          ? rest.coachRate
          : (matched?.rate ?? 0);
    setForm({
      ...rest,
      kind: typeof rest.kind === "string" && rest.kind ? rest.kind : "Practice",
      courtAllocation: rest.courtAllocation || "Full Court",
      coachId: matched?.id || rest.coachId,
      headCoachId: rest.headCoachId || matched?.id,
      coachRate: resolvedSessionFee,
      coachSessionFee: resolvedSessionFee,
      coachTransportFee: rest.coachTransportFee ?? 0,
      referees: rest.referees || [],
      matchStaff: rest.matchStaff || [],
    });
    setOpen(true);
  }

  function submit(e?: React.FormEvent) {
    if (e && typeof e.preventDefault === "function") {
      e.preventDefault();
    }
    const safeKind: SessionItem["kind"] = form.kind === "Game" ? "Game" : "Practice";
    let computedTitle = (typeof form.title === "string" ? form.title : "").trim();
    if (!computedTitle) {
      if (safeKind === "Game" && form.teamA && form.teamB) {
        computedTitle = `${form.teamA} vs ${form.teamB}`;
      } else {
        return;
      }
    }
    const coachName = (form.coach || form.headCoach || "").trim();
    const matchedCoach = db.coaches.find(
      (c) =>
        (form.coachId && c.id === form.coachId) ||
        (coachName && c.name.toLowerCase() === coachName.toLowerCase()),
    );
    const requireGameConfirmation =
      db.academy?.requireGameConfirmation !== false && !db.academy?.autoConfirmGames;
    const defaultGameStatus: SessionItem["status"] = requireGameConfirmation
      ? "Pending approval"
      : "Official";
    const targetStatus =
      safeKind === "Game"
        ? editing
          ? editing.status || defaultGameStatus
          : defaultGameStatus
        : typeof form.status === "string" && form.status
          ? form.status
          : "Planned";

    const targetId = editing ? editing.id : `e-${Date.now().toString(36)}`;
    const resolvedCourtName = form.court || form.detail || "";
    const courtRentalCalc = calculateSessionCourtRentalCost(
      {
        ...form,
        court: resolvedCourtName,
        detail: form.detail || resolvedCourtName,
      },
      db.branches || [],
    );

    const baseForm: SessionItem = {
      ...form,
      id: targetId,
      kind: safeKind,
      title: computedTitle,
      detail: form.detail || courtRentalCalc.courtName || "",
      court: resolvedCourtName || courtRentalCalc.courtName || "",
      courtAllocation: courtRentalCalc.allocation,
      durationHours: courtRentalCalc.durationHours,
      courtRentalCost: courtRentalCalc.rentalCost,
      status: targetStatus as SessionItem["status"],
      ...(safeKind === "Game"
        ? {
            approvalStatus:
              editing?.approvalStatus || (requireGameConfirmation ? "Pending" : "Approved"),
            ...(editing
              ? {}
              : requireGameConfirmation
                ? {}
                : { confirmedBy: "Auto-Confirmed (TD Policy)" }),
          }
        : {}),
      coach: matchedCoach?.name || coachName,
      coachId: matchedCoach?.id || form.coachId || undefined,
      headCoach: matchedCoach?.name || coachName,
      headCoachId: matchedCoach?.id || form.headCoachId || undefined,
    };

    const scheduleDates = editing
      ? [baseForm.date]
      : generateRecurringSessionDates(baseForm.date, baseForm.endDate);

    const generatedSessions: SessionItem[] = scheduleDates.map((dateStr, idx) => ({
      ...baseForm,
      id: idx === 0 ? targetId : `${targetId}-r${idx}`,
      date: dateStr,
    }));
    const finalForm = generatedSessions[0]!;

    if (finalForm.status !== "Cancelled" && finalForm.date && finalForm.time) {
      const conflictResult = checkCourtScheduleConflict(
        finalForm,
        db.sessions || [],
        editing ? targetId : undefined,
      );
      if (conflictResult.hasCourtConflict) {
        toast.error(
          conflictResult.courtConflictReason ||
            "Court schedule conflict detected. Full Court bookings cannot overlap with HCA/HCB or another Full Court session.",
        );
        return;
      }
      if (conflictResult.simultaneousHalfCourtSession) {
        const other = conflictResult.simultaneousHalfCourtSession;
        toast.info(
          `Simultaneous Half-Court booking confirmed: ${finalForm.courtAllocation} shares ${finalForm.court || finalForm.detail} with "${other.title}" (${other.courtAllocation || "Half Court"}).`,
        );
      }
      if (conflictResult.hasCoachConflict && conflictResult.coachConflictReason) {
        toast.warning(conflictResult.coachConflictReason);
      }
    }

    const canManageFin =
      Boolean(currentUser) &&
      (currentUser?.role === "Super Admin" ||
        currentUser?.role === "Academy Manager" ||
        currentUser?.role === "Accountant" ||
        currentUser?.role === "Branch Manager");

    if (generatedSessions.length > 1) {
      update((d) => {
        let nextLedger = d.ledger;
        if (canManageFin && finalForm.kind === "Game") {
          for (const sess of generatedSessions) {
            nextLedger = syncGameOfficialFeesToLedger(sess, nextLedger);
          }
        }
        return {
          ...d,
          sessions: [...generatedSessions, ...d.sessions],
          ledger: nextLedger,
        };
      });
    } else if (canManageFin && finalForm.kind === "Game") {
      update((d) => {
        const updatedSessions = editing
          ? d.sessions.map((s) => (s.id === targetId ? finalForm : s))
          : [finalForm, ...d.sessions];
        const updatedLedger = syncGameOfficialFeesToLedger(finalForm, d.ledger);
        return {
          ...d,
          sessions: updatedSessions,
          ledger: updatedLedger,
        };
      });
    } else {
      void setEntity("sessions", finalForm);
    }

    if (!editing && finalForm.kind === "Game") {
      void dispatchNotification({
        title: requireGameConfirmation
          ? `Game Approval Requested: ${finalForm.title}`
          : `New Game Scheduled (Auto-Confirmed): ${finalForm.title}`,
        message: `${finalForm.coach || currentUser?.name || "Staff"} scheduled ${finalForm.title} on ${finalForm.date} at ${finalForm.time} (${finalForm.branch || "HQ"}).`,
        type: "curriculum",
        targetRoles: ["technical_director", "super_admin", "branch_manager"],
        targetCoachId: finalForm.coachId || finalForm.headCoachId,
        targetCoachName: finalForm.coach || finalForm.headCoach,
        targetTeam: finalForm.teamA || finalForm.team,
        targetBranchId: finalForm.branch || undefined,
        actionUrl: "/technical",
        createdAt: new Date().toISOString(),
        readBy: [],
      }).catch(() => {});
    }

    setOpen(false);
  }

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  function removeEvent() {
    if (!editing) return;
    setConfirmDeleteOpen(true);
  }

  function confirmRemoveEvent() {
    if (!editing) return;
    const canManageFin =
      Boolean(currentUser) &&
      (currentUser?.role === "Super Admin" ||
        currentUser?.role === "Academy Manager" ||
        currentUser?.role === "Accountant" ||
        currentUser?.role === "Branch Manager");

    if (canManageFin && editing.kind === "Game") {
      update((d) => ({
        ...d,
        sessions: d.sessions.filter((s) => s.id !== editing.id),
        ledger: removeGameOfficialFeesFromLedger(editing.id, d.ledger),
      }));
    } else {
      void deleteEntity("sessions", editing.id);
    }
    setConfirmDeleteOpen(false);
    setOpen(false);
  }

  const label =
    view === "Day" ? safeCursor.toDateString() : `${MONTHS[month] || MONTHS[0]} ${year}`;

  if (authLoading && !currentUser && !authUser) {
    return (
      <AppShell crumb="OPS / CALENDAR" title="Calendar">
        <div className="flex h-64 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-court-500 border-t-transparent" />
          <span className="ml-3 font-mono text-xs text-ink-400">Loading academy calendar…</span>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb="OPS / CALENDAR" title="Calendar">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex rounded-md bg-ink-850 p-0.5 ring-1 ring-ink-700">
          {views.map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                view === v ? "bg-court-500 text-ink-950" : "text-ink-300"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => shift(-1)}
            aria-label="Previous"
            className="rounded bg-ink-850 px-2.5 py-1.5 font-mono text-xs text-ink-200 ring-1 ring-ink-700"
          >
            ‹
          </button>
          <span className="font-display px-1 text-sm tracking-tight text-ink-100">{label}</span>
          <button
            onClick={() => shift(1)}
            aria-label="Next"
            className="rounded bg-ink-850 px-2.5 py-1.5 font-mono text-xs text-ink-200 ring-1 ring-ink-700"
          >
            ›
          </button>
        </div>
        <div className="w-full sm:w-auto sm:ml-auto flex flex-wrap items-center gap-2">
          <FilterSelect
            label="Type"
            value={kind}
            onChange={setKind}
            options={
              db.lists?.["Session types"]?.length
                ? db.lists["Session types"]
                : ["Practice", "Game", "Seminar", "Camp"]
            }
          />
          <FilterSelect label="Branch" value={branch} onChange={setBranch} options={branches} />
          <Button onClick={() => openNew()}>+ New activity</Button>
        </div>
      </div>

      {view === "Month" ? (
        <MonthGrid
          year={year}
          month={month}
          selectedDate={selectedMobileDate}
          onSelectDate={setSelectedMobileDate}
          forDate={forDate}
          onPick={openNew}
          onEdit={openEdit}
        />
      ) : null}
      {view === "Week" ? (
        <WeekGrid cursor={safeCursor} forDate={forDate} onPick={openNew} onEdit={openEdit} />
      ) : null}
      {view === "Day" ? <DayList cursor={safeCursor} forDate={forDate} onEdit={openEdit} /> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {Object.keys(kindTone).map((k) => (
          <Chip key={k} tone={kindTone[k] ?? "neutral"}>
            {k.toUpperCase()}
          </Chip>
        ))}
      </div>

      <Modal
        open={open}
        title={editing ? `Edit activity` : "New activity"}
        meta="Adds to the calendar and the sessions list"
        onClose={() => setOpen(false)}
        onSubmit={submit}
        submitLabel={editing ? "Save changes" : "Create activity"}
        wide
      >
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <Field label="Type">
            <Select
              value={form.kind ?? "Practice"}
              onChange={(v) => {
                const k = v as SessionItem["kind"];
                setForm({
                  ...form,
                  kind: k,
                  ...(k === "Game" && !form.teamA
                    ? { teamA: form.team || db.teams[0]?.name || "Team A" }
                    : {}),
                });
              }}
              options={["Practice", "Game"]}
            />
          </Field>

          <Field label="Title">
            <Input
              value={form.title ?? ""}
              onChange={(v) => setForm({ ...form, title: v })}
              placeholder={
                form.kind === "Game" ? "e.g. Team A vs Team B" : "e.g. Fundamental Drills"
              }
            />
          </Field>

          {form.kind === "Practice" && (
            <Field label="Team">
              <Input
                value={form.team ?? ""}
                onChange={(v) => {
                  const t = db.teams.find((x) => x.name.toLowerCase() === v.toLowerCase());
                  const head = t?.headCoach ?? form.coach ?? "";
                  const matchedHead = db.coaches.find(
                    (c) =>
                      (t?.headCoachId && c.id === t.headCoachId) ||
                      (head && c.name.toLowerCase() === head.toLowerCase()),
                  );
                  const headRate = t?.headCoachRate ?? matchedHead?.rate ?? 0;
                  setForm({
                    ...form,
                    team: v,
                    coach: head,
                    coachId: matchedHead?.id || t?.headCoachId,
                    headCoach: head,
                    headCoachId: matchedHead?.id || t?.headCoachId,
                    coachRate: form.rateOverwritten ? form.coachRate : headRate,
                    coachSessionFee: form.rateOverwritten
                      ? (form.coachSessionFee ?? form.coachRate)
                      : headRate,
                  });
                }}
                list="teams-list"
                placeholder="Assign team / squad..."
              />
            </Field>
          )}

          {form.kind === "Game" && (
            <>
              <Field label="Team A (Home)">
                <Input
                  value={form.teamA ?? ""}
                  onChange={(v) => {
                    const newTeamA = v;
                    const autoTitle =
                      !editing && (!form.title || form.title.includes(" vs "))
                        ? `${newTeamA || "Team A"} vs ${form.teamB || "Team B"}`
                        : form.title;
                    setForm({ ...form, teamA: newTeamA, title: autoTitle });
                  }}
                  list="teams-list"
                  placeholder="Select home squad..."
                />
              </Field>

              <Field label="Team B (Away / Opponent)">
                <Input
                  value={form.teamB ?? ""}
                  onChange={(v) => {
                    const newTeamB = v;
                    const autoTitle =
                      !editing && (!form.title || form.title.includes(" vs "))
                        ? `${form.teamA || "Team A"} vs ${newTeamB || "Team B"}`
                        : form.title;
                    setForm({ ...form, teamB: newTeamB, title: autoTitle });
                  }}
                  list="teams-list"
                  placeholder="Select or type opponent..."
                />
              </Field>

              <Field label="Game Type">
                <Select
                  value={form.gameType ?? ""}
                  onChange={(v) => setForm({ ...form, gameType: v })}
                  options={[
                    "",
                    ...(db.lists?.["Game types"] ?? ["Friendly", "League", "Tournament"]),
                  ]}
                />
              </Field>
            </>
          )}

          <Field label="Start Date">
            <Input
              type="date"
              value={form.date ?? ""}
              onChange={(v) => setForm({ ...form, date: v })}
            />
          </Field>
          <Field label="End Date (Optional)">
            <Input
              type="date"
              value={form.endDate ?? ""}
              onChange={(v) => setForm({ ...form, endDate: v })}
            />
          </Field>

          <Field label="Start Time">
            <Input
              type="time"
              value={form.time ?? ""}
              onChange={(v) => setForm({ ...form, time: v })}
            />
          </Field>
          <Field label="End Time">
            <Input
              type="time"
              value={form.endTime ?? ""}
              onChange={(v) => setForm({ ...form, endTime: v })}
            />
          </Field>

          <Field label="Branch">
            <Select
              value={form.branch ?? ""}
              onChange={(v) => {
                const b = db.branches.find((x) => x.name === v);
                const courtName = b?.courts?.[0]?.name ?? "";
                setForm({ ...form, branch: v, detail: courtName, court: courtName });
              }}
              options={["", ...branches, "HQ"]}
            />
          </Field>
          <Field label="Location / Court">
            {(() => {
              const branchObj = db.branches.find(
                (b) => b.name?.toLowerCase() === (form.branch || "").toLowerCase(),
              );
              const branchCourts = (branchObj?.courts || []).filter((c) => c.name?.trim());
              const matchedCourt = branchCourts.find(
                (c) => c.name.toLowerCase() === (form.detail || form.court || "").toLowerCase(),
              );
              const courtSchedule =
                matchedCourt?.schedule ||
                matchedCourt?.operatingHours ||
                branchObj?.operatingHours ||
                "";

              return (
                <div className="space-y-1.5">
                  {branchCourts.length > 0 && (
                    <Select
                      value={
                        matchedCourt
                          ? matchedCourt.name
                          : form.detail
                            ? "__custom__"
                            : branchCourts[0]?.name || ""
                      }
                      onChange={(v) => {
                        if (v === "__custom__") {
                          setForm({ ...form, detail: "", court: "" });
                        } else {
                          setForm({ ...form, detail: v, court: v });
                        }
                      }}
                      options={[...branchCourts.map((c) => c.name), "__custom__"]}
                    />
                  )}
                  {(!matchedCourt || branchCourts.length === 0) && (
                    <Input
                      value={form.detail ?? ""}
                      placeholder="Enter court or venue name"
                      onChange={(v) => setForm({ ...form, detail: v, court: v })}
                    />
                  )}
                  {courtSchedule && (
                    <div className="rounded bg-ink-900/80 px-2 py-1 font-mono text-[10px] text-court-300 ring-1 ring-ink-800">
                      Court Schedule ({matchedCourt?.name || "Branch Master"}):{" "}
                      <span className="text-ink-100">{courtSchedule}</span>
                    </div>
                  )}
                </div>
              );
            })()}
          </Field>

          <Field
            label="Court Allocation (Full vs. Half Court HCA / HCB)"
            hint="Full Court occupies both HCA & HCB. HCA and HCB allow simultaneous sessions."
          >
            <Select
              value={form.courtAllocation || "Full Court"}
              onChange={(v) => setForm({ ...form, courtAllocation: v as CourtAllocationType })}
              options={COURT_ALLOCATION_OPTIONS}
            />
          </Field>

          <Field label="Coach">
            <Input
              value={form.coach ?? ""}
              onChange={(v) => {
                const matched = db.coaches.find((c) => c.name.toLowerCase() === v.toLowerCase());
                const inheritedRate = matched?.rate ?? 0;
                setForm({
                  ...form,
                  coach: v,
                  coachId: matched?.id || undefined,
                  headCoach: v,
                  headCoachId: matched?.id || undefined,
                  coachRate: form.rateOverwritten ? form.coachRate : inheritedRate,
                  coachSessionFee: form.rateOverwritten
                    ? (form.coachSessionFee ?? form.coachRate)
                    : inheritedRate,
                });
              }}
              list="coaches-list"
              placeholder="Start typing..."
            />
          </Field>

          {canManageSessionFee &&
            (() => {
              const coachObj = db.coaches.find(
                (c) =>
                  (form.coachId && c.id === form.coachId) ||
                  c.name.toLowerCase() === (form.coach || form.headCoach || "").toLowerCase(),
              );
              const defaultRate = coachObj?.rate ?? 0;
              const currentFeeVal =
                form.coachSessionFee !== undefined && form.coachSessionFee !== null
                  ? form.coachSessionFee
                  : form.coachRate !== undefined
                    ? form.coachRate
                    : defaultRate;
              const currentTransportVal = form.coachTransportFee ?? 0;

              return (
                <div className="sm:col-span-2 rounded-lg border border-ink-800 bg-ink-900/60 p-3 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-court-300">
                      Coach Session Fee &amp; Optional Transportation Allowance
                    </span>
                    <span className="rounded bg-court-500/15 px-2 py-0.5 font-mono text-[10px] text-court-300 ring-1 ring-court-500/30">
                      Default Coach Rate: ${defaultRate} — Editable for this session
                    </span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field
                      label={`Coach Session Fee (${db.academy?.currency || "USD"})`}
                      hint="Editable for this specific session"
                    >
                      <Input
                        type="number"
                        value={currentFeeVal !== undefined ? String(currentFeeVal) : ""}
                        placeholder={String(defaultRate || 50)}
                        onChange={(v) => {
                          const val = v === "" ? undefined : Number(v);
                          setForm({
                            ...form,
                            coachRate: val,
                            coachSessionFee: val ?? null,
                            rateOverwritten: val !== undefined && val !== defaultRate,
                            rateOverwrittenBy:
                              currentUser?.name || currentUser?.role || "Branch Manager",
                          });
                        }}
                      />
                    </Field>
                    <Field
                      label={`Optional Transportation Fee (${db.academy?.currency || "USD"})`}
                      hint="Added to coach's session payout when verified ($0 default)"
                    >
                      <Input
                        type="number"
                        value={String(currentTransportVal)}
                        placeholder="0"
                        onChange={(v) => {
                          const val = v === "" ? 0 : Math.max(0, Number(v) || 0);
                          setForm({
                            ...form,
                            coachTransportFee: val,
                          });
                        }}
                      />
                    </Field>
                  </div>
                </div>
              );
            })()}

          {form.kind === "Practice" ? (
            <Field
              label="Status (Optional)"
              hint="Optional for practices. Defaults to 'Planned' if left unselected."
            >
              <Select
                value={form.status || "Planned"}
                onChange={(v) =>
                  setForm({ ...form, status: (v || "Planned") as SessionItem["status"] })
                }
                options={["Planned", "Live", "Completed", "Cancelled"]}
              />
            </Field>
          ) : (
            <div className="sm:col-span-2">
              {db.academy?.requireGameConfirmation !== false && !db.academy?.autoConfirmGames ? (
                <div className="rounded-lg bg-warn/10 border border-warn/30 p-3 text-xs flex items-center justify-between">
                  <div>
                    <span className="font-bold text-warn">
                      Status: {editing ? editing.status || "Pending approval" : "Pending approval"}
                    </span>
                    <p className="text-[11px] text-ink-300 mt-0.5">
                      Technical Director confirmation is required by academy policy for games.
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded text-[10px] font-mono font-bold bg-warn/20 text-warn border border-warn/40">
                    TD Confirmation Required
                  </span>
                </div>
              ) : (
                <div className="rounded-lg bg-good/10 border border-good/30 p-3 text-xs flex items-center justify-between">
                  <div>
                    <span className="font-bold text-good">
                      Status: {editing ? editing.status || "Official" : "Official"}
                    </span>
                    <p className="text-[11px] text-ink-300 mt-0.5">
                      Technical Director auto-confirmation policy is active. Games are immediately
                      official.
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded text-[10px] font-mono font-bold bg-good/20 text-good border border-good/40">
                    Auto-Confirmed
                  </span>
                </div>
              )}
            </div>
          )}

          {form.kind === "Game" && (
            <div className="sm:col-span-2 pt-2 border-t border-ink-800">
              <GameOfficialsForm
                referees={form.referees || []}
                matchStaff={form.matchStaff || []}
                onChangeReferees={(referees) => setForm({ ...form, referees })}
                onChangeMatchStaff={(matchStaff) => setForm({ ...form, matchStaff })}
              />
            </div>
          )}

          {/* Live Session Cost Summary & Court Allocation Conflict Check */}
          {(() => {
            const candidateBranch = form.branch || "HQ";
            const candidateCourt = form.court || form.detail || "";
            const costSummary = calculateSessionTotalCostSummary(
              {
                ...form,
                branch: candidateBranch,
                court: candidateCourt,
              },
              db.branches || [],
              db.coaches || [],
              db.teams || [],
            );
            const conflictPreview = checkCourtScheduleConflict(
              {
                ...form,
                branch: candidateBranch,
                court: candidateCourt || costSummary.courtName,
              },
              db.sessions || [],
              editing?.id,
            );
            return (
              <div className="sm:col-span-2 rounded-lg bg-ink-950/80 p-3.5 ring-1 ring-ink-800 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-ink-800 pb-2">
                  <div>
                    <span className="font-mono text-xs font-bold uppercase text-court-300 block">
                      Session Cost Summary &amp; Court Allocation Impact
                    </span>
                    <span className="font-mono text-[10px] text-ink-400">
                      {costSummary.courtName} ({candidateBranch}) · {costSummary.allocation} ·{" "}
                      {costSummary.durationHours} hr(s) × {money(costSummary.hourlyRate)}/hr
                    </span>
                  </div>
                  <span className="rounded bg-court-500/15 px-2.5 py-1 font-mono text-xs font-bold text-court-300 ring-1 ring-court-500/30">
                    Total Session Cost: {money(costSummary.totalDirectCost)}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-xs">
                  <div className="rounded bg-ink-900 p-2 ring-1 ring-ink-800">
                    <span className="block text-[9px] uppercase text-ink-400">
                      Court Rental ({costSummary.isHalfCourt ? "Half Rate" : "Full Rate"})
                    </span>
                    <span className="font-bold text-court-300">
                      {money(costSummary.rentalCost)}
                    </span>
                    <span className="block text-[9px] text-ink-500">
                      {costSummary.durationHours}h × {money(costSummary.hourlyRate)}/hr
                    </span>
                  </div>
                  <div className="rounded bg-ink-900 p-2 ring-1 ring-ink-800">
                    <span className="block text-[9px] uppercase text-ink-400">Head Coach Cost</span>
                    <span className="font-bold text-ink-100">
                      {money(costSummary.headCoachCost)}
                    </span>
                  </div>
                  <div className="rounded bg-ink-900 p-2 ring-1 ring-ink-800">
                    <span className="block text-[9px] uppercase text-ink-400">Assistant Cost</span>
                    <span className="font-bold text-ink-100">
                      {money(costSummary.assistantCoachCost)}
                    </span>
                  </div>
                  <div className="rounded bg-ink-900 p-2 ring-1 ring-ink-800">
                    <span className="block text-[9px] uppercase text-ink-400">Match Officials</span>
                    <span className="font-bold text-ink-100">
                      {money(costSummary.officialsCost)}
                    </span>
                  </div>
                </div>

                {conflictPreview.hasCourtConflict ? (
                  <div className="rounded bg-bad/15 px-3 py-2 font-mono text-[11px] text-bad ring-1 ring-bad/40 font-semibold">
                    ⚠️ {conflictPreview.courtConflictReason}
                  </div>
                ) : conflictPreview.simultaneousHalfCourtSession ? (
                  <div className="rounded bg-court-500/15 px-3 py-2 font-mono text-[11px] text-court-300 ring-1 ring-court-500/40">
                    ✓ Simultaneous Half-Court Operation: Shares {costSummary.courtName} with &quot;
                    {conflictPreview.simultaneousHalfCourtSession.title}&quot; (
                    {conflictPreview.simultaneousHalfCourtSession.courtAllocation || "Half Court"})
                    without conflict.
                  </div>
                ) : (
                  <div className="rounded bg-good/10 px-3 py-1.5 font-mono text-[10px] text-good ring-1 ring-good/30">
                    ✓ Court time slot available for {costSummary.allocation}.
                  </div>
                )}
              </div>
            );
          })()}
        </div>
        <datalist id="coaches-list">
          {db.coaches.map((c) => (
            <option key={c.id} value={c.name} />
          ))}
        </datalist>
        <datalist id="teams-list">
          {db.teams.map((t) => (
            <option key={t.id} value={t.name} />
          ))}
        </datalist>
        {editing ? (
          <div className="border-t border-ink-800 bg-ink-900/50 px-4 py-3">
            <Button
              variant="ghost"
              className="text-warn hover:bg-warn/10 hover:text-warn"
              onClick={removeEvent}
            >
              Delete activity
            </Button>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={confirmDeleteOpen && Boolean(editing)}
        title="Delete activity"
        meta={editing ? `Remove "${editing.title}"` : undefined}
        onClose={() => setConfirmDeleteOpen(false)}
        onSubmit={confirmRemoveEvent}
        submitLabel="Delete activity"
      >
        <div className="p-4 text-sm text-ink-200">
          Are you sure you want to delete{" "}
          <span className="font-semibold text-ink-100">{editing?.title}</span>? This action cannot
          be undone.
        </div>
      </Modal>
    </AppShell>
  );
}

function MonthGrid({
  year,
  month,
  selectedDate,
  onSelectDate,
  forDate,
  onPick,
  onEdit,
}: {
  year: number;
  month: number;
  selectedDate: string;
  onSelectDate: (d: string) => void;
  forDate: (d: string) => SessionItem[];
  onPick: (d: string) => void;
  onEdit: (e: SessionItem) => void;
}) {
  const firstDay = new Date(year, month, 1);
  const offset = (firstDay.getDay() + 6) % 7; // week starts Monday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = Array.from({ length: 42 }, (_, i) => i - offset + 1);
  const activeMobileDate =
    selectedDate && selectedDate.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`)
      ? selectedDate
      : iso(year, month, 1);
  const selectedDayEvents = forDate(activeMobileDate);

  return (
    <div className="space-y-4">
      <Panel>
        <div className="grid grid-cols-7 border-b border-ink-800">
          {["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map((d) => (
            <div
              key={d}
              className="label-mono px-1 sm:px-2 py-2 text-center text-[9px] sm:text-[10px]"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {cells.map((d, i) => {
            const inMonth = d >= 1 && d <= daysInMonth;
            const date = inMonth ? iso(year, month, d) : "";
            const events = inMonth ? forDate(date) : [];
            const isSelected = inMonth && date === activeMobileDate;
            return (
              <button
                key={i}
                type="button"
                onClick={() => {
                  if (!inMonth) return;
                  onSelectDate(date);
                  if (typeof window !== "undefined" && window.innerWidth >= 640) {
                    onPick(date);
                  }
                }}
                className={`min-h-[58px] sm:min-h-[92px] border-b border-r border-ink-800 p-1 sm:p-1.5 text-left last:border-r-0 transition-colors hover:bg-ink-850/50 ${
                  isSelected
                    ? "bg-court-500/10 ring-1 ring-inset ring-court-500/50 sm:bg-transparent sm:ring-0"
                    : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <div
                    className={`font-mono text-[10px] ${
                      inMonth
                        ? isSelected
                          ? "font-bold text-court-300 sm:font-normal sm:text-ink-300"
                          : "text-ink-300"
                        : "text-ink-700"
                    }`}
                  >
                    {inMonth ? d : ""}
                  </div>
                  {inMonth && events.length > 0 && (
                    <span className="sm:hidden rounded-full bg-court-500/20 px-1.5 py-0.2 font-mono text-[9px] font-bold text-court-300">
                      {events.length}
                    </span>
                  )}
                </div>

                {/* Compact dot indicators on mobile */}
                {inMonth && events.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1 sm:hidden">
                    {events.slice(0, 4).map((e) => (
                      <span
                        key={e.id}
                        className={`h-1.5 w-1.5 rounded-full ${
                          e.kind === "Game" ? "bg-accent" : "bg-court-400"
                        }`}
                      />
                    ))}
                  </div>
                )}

                {/* Full event pills on tablet/desktop */}
                <div className="mt-1 hidden space-y-1 sm:block">
                  {events.map((e) => (
                    <div
                      key={e.id}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        onEdit(e);
                      }}
                      className="truncate rounded bg-ink-850 px-1.5 py-1 text-[10px] text-ink-200 ring-1 ring-ink-800 hover:bg-ink-800"
                    >
                      <span className="text-court-400">{e.time}</span> {e.title}
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </Panel>

      {/* Mobile Day Agenda Card List (< 640px) */}
      <div className="sm:hidden">
        <Panel
          title={`Agenda · ${activeMobileDate}`}
          meta={`${selectedDayEvents.length} ${selectedDayEvents.length === 1 ? "activity" : "activities"}`}
          action={
            <Button size="xs" onClick={() => onPick(activeMobileDate)}>
              + Add on {activeMobileDate.slice(5)}
            </Button>
          }
        >
          <div className="divide-y divide-ink-800">
            {selectedDayEvents.length === 0 ? (
              <div className="px-4 py-6 text-center font-mono text-xs text-ink-400">
                No sessions scheduled on {activeMobileDate}. Tap &ldquo;+ Add&rdquo; to schedule
                one.
              </div>
            ) : (
              selectedDayEvents.map((ev) => (
                <div
                  key={ev.id}
                  onClick={() => onEdit(ev)}
                  className="flex cursor-pointer items-center justify-between gap-3 px-4 py-3 hover:bg-ink-850"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-court-400">
                        {ev.time}
                      </span>
                      <span className="truncate text-sm font-semibold text-ink-100">
                        {ev.title}
                      </span>
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11px] text-ink-400">
                      {ev.branch || "HQ"} · {ev.coach || ev.headCoach || "Unassigned"}
                    </div>
                  </div>
                  <Chip tone={kindTone[ev.kind] ?? "neutral"}>
                    {String(ev.kind || "Event").toUpperCase()}
                  </Chip>
                </div>
              ))
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function WeekGrid({
  cursor,
  forDate,
  onPick,
  onEdit,
}: {
  cursor: Date;
  forDate: (d: string) => SessionItem[];
  onPick: (d: string) => void;
  onEdit: (e: SessionItem) => void;
}) {
  const safe = Number.isNaN(cursor.getTime()) ? new Date() : cursor;
  const start = new Date(safe.getTime());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start.getTime());
    d.setDate(start.getDate() + i);
    return d;
  });

  return (
    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
      {days.map((d) => {
        const date = iso(d.getFullYear(), d.getMonth(), d.getDate());
        const events = forDate(date);
        return (
          <div key={date} className="panel p-3">
            <div className="label-mono mb-2 flex items-center justify-between">
              <span>{d.toDateString().slice(0, 10)}</span>
              <button
                type="button"
                onClick={() => onPick(date)}
                className="flex h-6 w-6 items-center justify-center rounded bg-ink-850 text-court-400 ring-1 ring-ink-700 hover:bg-ink-800"
                aria-label={`Add activity on ${date}`}
              >
                +
              </button>
            </div>
            <div className="space-y-2">
              {events.length === 0 ? (
                <div className="font-mono text-[10px] text-ink-700">No activity</div>
              ) : (
                events.map((e) => (
                  <div
                    key={e.id}
                    onClick={() => onEdit(e)}
                    className="cursor-pointer rounded bg-ink-850 p-2 ring-1 ring-ink-800 hover:bg-ink-800"
                  >
                    <div className="font-mono text-[10px] text-court-400">{e.time}</div>
                    <div className="text-xs font-medium text-ink-100">{e.title}</div>
                    <div className="font-mono text-[10px] text-ink-400">{e.branch}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DayList({
  cursor,
  forDate,
  onEdit,
}: {
  cursor: Date;
  forDate: (d: string) => SessionItem[];
  onEdit: (e: SessionItem) => void;
}) {
  const safe = Number.isNaN(cursor.getTime()) ? new Date() : cursor;
  const date = iso(safe.getFullYear(), safe.getMonth(), safe.getDate());
  const events = [...forDate(date)].sort((a, b) =>
    String(a.time || "").localeCompare(String(b.time || "")),
  );

  return (
    <Panel title={safe.toDateString()} meta={`${events.length} activities`}>
      <div className="divide-y divide-ink-800">
        {events.length === 0 ? (
          <div className="px-4 py-10 text-center font-mono text-[11px] text-ink-400">
            Nothing scheduled on this day.
          </div>
        ) : (
          events.map((ev) => (
            <div
              key={ev.id}
              onClick={() => onEdit(ev)}
              className="flex cursor-pointer items-start gap-4 px-4 py-3 hover:bg-ink-850"
            >
              <span className="w-12 font-mono text-[11px] text-ink-400">{ev.time}</span>
              <div className="flex-1">
                <div className="text-sm font-medium text-ink-100">{ev.title}</div>
                <div className="font-mono text-[10px] text-ink-400">
                  {ev.detail} · {ev.coach}
                </div>
              </div>
              <Chip tone={kindTone[ev.kind] ?? "neutral"}>
                {String(ev.kind || "Event").toUpperCase()}
              </Chip>
            </div>
          ))
        )}
      </div>
    </Panel>
  );
}

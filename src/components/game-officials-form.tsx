import { useState, useMemo } from "react";
import {
  Plus,
  Trash2,
  ShieldCheck,
  DollarSign,
  UserCheck,
  Users,
  ExternalLink,
} from "lucide-react";
import type { MatchOfficial } from "@/lib/mock-data";
import { useDB } from "@/lib/data-store";
import { money } from "@/components/kit";

const COMMON_REFEREE_ROLES = [
  "Lead Referee",
  "Umpire 1",
  "Umpire 2",
  "Chief Referee",
  "Official Scorer",
];

const COMMON_STAFF_ROLES = [
  "Table Official / Scorekeeper",
  "Shot Clock / Timekeeper",
  "Medical / First-Aid",
  "Court Coordinator",
  "Statistician",
  "Equipment Manager",
];

export function GameOfficialsForm({
  referees = [],
  matchStaff = [],
  onChangeReferees,
  onChangeMatchStaff,
}: {
  referees: MatchOfficial[];
  matchStaff: MatchOfficial[];
  onChangeReferees: (refs: MatchOfficial[]) => void;
  onChangeMatchStaff: (staff: MatchOfficial[]) => void;
}) {
  const { db } = useDB();
  const currency = db.academy?.currency || "USD";

  // Comprehensive pool of internal personnel (coaches + staff + administrators)
  const personnelOptions = useMemo(() => {
    const list: { id: string; name: string; rawName: string; type: string }[] = [];

    // 1. Staff
    (db.staff || []).forEach((s) => {
      list.push({
        id: s.id,
        name: `${s.name} (${s.position || "Staff"})`,
        rawName: s.name,
        type: "Staff",
      });
    });

    // 2. Coaches
    (db.coaches || []).forEach((c) => {
      list.push({
        id: c.id,
        name: `${c.name} (Coach)`,
        rawName: c.name,
        type: "Coach",
      });
    });

    // Fallback if academy is fresh/empty
    if (list.length === 0) {
      list.push({
        id: "p-default-1",
        name: "Academy Staff Member (Internal)",
        rawName: "Academy Staff",
        type: "Staff",
      });
    }

    return list;
  }, [db.staff, db.coaches]);

  const totalFees =
    referees.reduce((acc, r) => acc + (Number(r.fee) || 0), 0) +
    matchStaff.reduce((acc, s) => acc + (Number(s.fee) || 0), 0);

  // --- Add Referee ---
  const addReferee = () => {
    const defaultRole = COMMON_REFEREE_ROLES[referees.length] || `Referee ${referees.length + 1}`;
    const defaultP = personnelOptions[0];
    const newRef: MatchOfficial = {
      id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: defaultRole,
      source: "personnel",
      name: defaultP?.rawName || "Internal Official",
      personnelId: defaultP?.id || "",
      fee: 45,
      status: "Pending",
    };
    onChangeReferees([...referees, newRef]);
  };

  const removeReferee = (index: number) => {
    onChangeReferees(referees.filter((_, i) => i !== index));
  };

  const updateReferee = (index: number, patch: Partial<MatchOfficial>) => {
    onChangeReferees(
      referees.map((r, i) => {
        if (i !== index) return r;
        return { ...r, ...patch };
      }),
    );
  };

  // --- Add Staff ---
  const addStaff = () => {
    const defaultRole = COMMON_STAFF_ROLES[matchStaff.length] || `Staff ${matchStaff.length + 1}`;
    const defaultP = personnelOptions[0];
    const newStaff: MatchOfficial = {
      id: `st-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: defaultRole,
      source: "personnel",
      name: defaultP?.rawName || "Table Official",
      personnelId: defaultP?.id || "",
      fee: 30,
      status: "Pending",
    };
    onChangeMatchStaff([...matchStaff, newStaff]);
  };

  const removeStaff = (index: number) => {
    onChangeMatchStaff(matchStaff.filter((_, i) => i !== index));
  };

  const updateStaff = (index: number, patch: Partial<MatchOfficial>) => {
    onChangeMatchStaff(
      matchStaff.map((s, i) => {
        if (i !== index) return s;
        return { ...s, ...patch };
      }),
    );
  };

  return (
    <div className="col-span-full mt-2 rounded-xl border border-ink-800 bg-ink-950/70 p-3.5 space-y-4 shadow-inner">
      {/* Header bar with Live Accounting Sync notice */}
      <div className="flex items-center justify-between border-b border-ink-800/80 pb-2.5 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-court-400" />
          <span className="font-display text-xs font-semibold uppercase tracking-wider text-ink-100">
            Referees & Match Support Personnel
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px] bg-ink-900/90 px-2.5 py-1 rounded border border-ink-750">
          <DollarSign className="h-3.5 w-3.5 text-court-400" />
          <span className="text-ink-300">Match Ops Ledger:</span>
          <strong className="text-court-300 font-bold">{money(totalFees)}</strong>
          <span className="text-[10px] text-good font-semibold">● LIVE</span>
        </div>
      </div>

      {/* Datalists for quick role suggestions */}
      <datalist id="ref-roles-list">
        {COMMON_REFEREE_ROLES.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <datalist id="staff-roles-list">
        {COMMON_STAFF_ROLES.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>

      {/* Section 1: Referees */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-200 font-semibold">
              Assigned Referees ({referees.length})
            </span>
            <span className="text-[10px] text-ink-400 font-mono">
              (Lead, Umpires, Neutral Referees)
            </span>
          </div>
          <button
            type="button"
            onClick={addReferee}
            className="flex items-center gap-1 rounded bg-court-500/15 px-2.5 py-1 font-mono text-[10px] font-bold text-court-400 hover:bg-court-500/25 ring-1 ring-court-500/30 transition-colors"
          >
            <Plus className="h-3 w-3" />
            <span>Add Referee</span>
          </button>
        </div>

        {referees.length === 0 ? (
          <div className="rounded-lg border border-dashed border-ink-800/80 p-3 text-center font-mono text-[11px] text-ink-500 bg-ink-900/40">
            No referees assigned yet. Click &quot;+ Add Referee&quot; to assign internal personnel
            or an outsourced referee with fixed fees.
          </div>
        ) : (
          <div className="space-y-2">
            {referees.map((ref, idx) => (
              <div
                key={ref.id || idx}
                className="grid grid-cols-1 gap-2.5 rounded-lg bg-ink-900/90 p-3 sm:grid-cols-12 items-center ring-1 ring-ink-800 shadow-sm"
              >
                {/* 1. Official Role */}
                <div className="sm:col-span-3">
                  <label className="block text-[9px] font-mono uppercase text-ink-400 mb-1">
                    Role / Position
                  </label>
                  <input
                    type="text"
                    list="ref-roles-list"
                    value={ref.role}
                    onChange={(e) => updateReferee(idx, { role: e.target.value })}
                    placeholder="e.g. Lead Referee"
                    className="w-full rounded-md bg-ink-950 px-2.5 py-1.5 text-xs text-ink-100 ring-1 ring-ink-750 focus:outline-none focus:ring-1 focus:ring-court-500"
                  />
                </div>

                {/* 2. Assignment Source (Personnel vs Outsource) */}
                <div className="sm:col-span-3">
                  <label className="block text-[9px] font-mono uppercase text-ink-400 mb-1">
                    Assignment Source
                  </label>
                  <select
                    value={ref.source}
                    onChange={(e) => {
                      const newSource = e.target.value as "personnel" | "outsource";
                      if (newSource === "outsource") {
                        updateReferee(idx, {
                          source: "outsource",
                          personnelId: undefined,
                          name: ref.source === "personnel" ? "" : ref.name,
                        });
                      } else {
                        const firstP = personnelOptions[0];
                        updateReferee(idx, {
                          source: "personnel",
                          personnelId: firstP?.id || "",
                          name: firstP?.rawName || "Internal Official",
                        });
                      }
                    }}
                    className="w-full rounded-md bg-ink-950 px-2.5 py-1.5 text-xs text-ink-100 ring-1 ring-ink-750 focus:outline-none focus:ring-1 focus:ring-court-500"
                  >
                    <option value="personnel">Personnel (Internal Staff/Coach)</option>
                    <option value="outsource">Outsource (External Official)</option>
                  </select>
                </div>

                {/* 3. Official Name or Personnel Dropdown */}
                <div className="sm:col-span-3">
                  <label className="block text-[9px] font-mono uppercase text-ink-400 mb-1">
                    {ref.source === "personnel"
                      ? "Select Academy Personnel"
                      : "External Official Name"}
                  </label>
                  {ref.source === "personnel" ? (
                    <select
                      value={ref.personnelId || ""}
                      onChange={(e) => {
                        const selectedId = e.target.value;
                        const match = personnelOptions.find((p) => p.id === selectedId);
                        updateReferee(idx, {
                          personnelId: selectedId,
                          name: match?.rawName || "Personnel",
                        });
                      }}
                      className="w-full rounded-md bg-ink-950 px-2.5 py-1.5 text-xs text-ink-100 ring-1 ring-ink-750 focus:outline-none focus:ring-1 focus:ring-court-500"
                    >
                      {personnelOptions.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={ref.name}
                      onChange={(e) => updateReferee(idx, { name: e.target.value })}
                      placeholder="e.g. Carlos Mendoza (FIBA Ref)"
                      className="w-full rounded-md bg-ink-950 px-2.5 py-1.5 text-xs text-ink-100 ring-1 ring-ink-750 focus:outline-none focus:ring-1 focus:ring-court-500"
                    />
                  )}
                </div>

                {/* 4. Fixed Fee */}
                <div className="sm:col-span-2">
                  <label className="block text-[9px] font-mono uppercase text-ink-400 mb-1">
                    Fixed Fee ({currency})
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="5"
                    value={ref.fee}
                    onChange={(e) =>
                      updateReferee(idx, { fee: Math.max(0, parseFloat(e.target.value) || 0) })
                    }
                    className="w-full rounded-md bg-ink-950 px-2.5 py-1.5 text-xs text-ink-100 ring-1 ring-ink-750 focus:outline-none focus:ring-1 focus:ring-court-500 font-mono"
                  />
                </div>

                {/* 5. Delete Action */}
                <div className="sm:col-span-1 flex justify-end pt-1 sm:pt-4">
                  <button
                    type="button"
                    onClick={() => removeReferee(idx)}
                    className="rounded p-1.5 text-ink-400 hover:text-bad hover:bg-bad/10 transition-colors"
                    title="Remove referee"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Section 2: Table & Match Support Staff */}
      <div className="space-y-2.5 pt-3 border-t border-ink-800/60">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-200 font-semibold">
              Table & Operations Staff ({matchStaff.length})
            </span>
            <span className="text-[10px] text-ink-400 font-mono">
              (Scorekeeper, Shot Clock, Medical)
            </span>
          </div>
          <button
            type="button"
            onClick={addStaff}
            className="flex items-center gap-1 rounded bg-court-500/15 px-2.5 py-1 font-mono text-[10px] font-bold text-court-400 hover:bg-court-500/25 ring-1 ring-court-500/30 transition-colors"
          >
            <Plus className="h-3 w-3" />
            <span>Add Staff</span>
          </button>
        </div>

        {matchStaff.length === 0 ? (
          <div className="rounded-lg border border-dashed border-ink-800/80 p-3 text-center font-mono text-[11px] text-ink-500 bg-ink-900/40">
            No table staff assigned. Click &quot;+ Add Staff&quot; for scorekeepers, timekeepers,
            statisticians or medical personnel.
          </div>
        ) : (
          <div className="space-y-2">
            {matchStaff.map((st, idx) => (
              <div
                key={st.id || idx}
                className="grid grid-cols-1 gap-2.5 rounded-lg bg-ink-900/90 p-3 sm:grid-cols-12 items-center ring-1 ring-ink-800 shadow-sm"
              >
                {/* 1. Staff Role */}
                <div className="sm:col-span-3">
                  <label className="block text-[9px] font-mono uppercase text-ink-400 mb-1">
                    Staff Role
                  </label>
                  <input
                    type="text"
                    list="staff-roles-list"
                    value={st.role}
                    onChange={(e) => updateStaff(idx, { role: e.target.value })}
                    placeholder="e.g. Scorekeeper"
                    className="w-full rounded-md bg-ink-950 px-2.5 py-1.5 text-xs text-ink-100 ring-1 ring-ink-750 focus:outline-none focus:ring-1 focus:ring-court-500"
                  />
                </div>

                {/* 2. Assignment Source (Personnel vs Outsource) */}
                <div className="sm:col-span-3">
                  <label className="block text-[9px] font-mono uppercase text-ink-400 mb-1">
                    Assignment Source
                  </label>
                  <select
                    value={st.source}
                    onChange={(e) => {
                      const newSource = e.target.value as "personnel" | "outsource";
                      if (newSource === "outsource") {
                        updateStaff(idx, {
                          source: "outsource",
                          personnelId: undefined,
                          name: st.source === "personnel" ? "" : st.name,
                        });
                      } else {
                        const firstP = personnelOptions[0];
                        updateStaff(idx, {
                          source: "personnel",
                          personnelId: firstP?.id || "",
                          name: firstP?.rawName || "Table Staff",
                        });
                      }
                    }}
                    className="w-full rounded-md bg-ink-950 px-2.5 py-1.5 text-xs text-ink-100 ring-1 ring-ink-750 focus:outline-none focus:ring-1 focus:ring-court-500"
                  >
                    <option value="personnel">Personnel (Internal Staff/Coach)</option>
                    <option value="outsource">Outsource (External Contractor)</option>
                  </select>
                </div>

                {/* 3. Staff Name or Personnel Dropdown */}
                <div className="sm:col-span-3">
                  <label className="block text-[9px] font-mono uppercase text-ink-400 mb-1">
                    {st.source === "personnel" ? "Select Academy Personnel" : "External Staff Name"}
                  </label>
                  {st.source === "personnel" ? (
                    <select
                      value={st.personnelId || ""}
                      onChange={(e) => {
                        const selectedId = e.target.value;
                        const match = personnelOptions.find((p) => p.id === selectedId);
                        updateStaff(idx, {
                          personnelId: selectedId,
                          name: match?.rawName || "Table Staff",
                        });
                      }}
                      className="w-full rounded-md bg-ink-950 px-2.5 py-1.5 text-xs text-ink-100 ring-1 ring-ink-750 focus:outline-none focus:ring-1 focus:ring-court-500"
                    >
                      {personnelOptions.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={st.name}
                      onChange={(e) => updateStaff(idx, { name: e.target.value })}
                      placeholder="e.g. Sarah Miller"
                      className="w-full rounded-md bg-ink-950 px-2.5 py-1.5 text-xs text-ink-100 ring-1 ring-ink-750 focus:outline-none focus:ring-1 focus:ring-court-500"
                    />
                  )}
                </div>

                {/* 4. Fixed Fee */}
                <div className="sm:col-span-2">
                  <label className="block text-[9px] font-mono uppercase text-ink-400 mb-1">
                    Fixed Fee ({currency})
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="5"
                    value={st.fee}
                    onChange={(e) =>
                      updateStaff(idx, { fee: Math.max(0, parseFloat(e.target.value) || 0) })
                    }
                    className="w-full rounded-md bg-ink-950 px-2.5 py-1.5 text-xs text-ink-100 ring-1 ring-ink-750 focus:outline-none focus:ring-1 focus:ring-court-500 font-mono"
                  />
                </div>

                {/* 5. Delete Action */}
                <div className="sm:col-span-1 flex justify-end pt-1 sm:pt-4">
                  <button
                    type="button"
                    onClick={() => removeStaff(idx)}
                    className="rounded p-1.5 text-ink-400 hover:text-bad hover:bg-bad/10 transition-colors"
                    title="Remove staff member"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Summary live ledger note */}
      <div className="flex items-center gap-2 text-[10px] text-ink-400 font-mono pt-1 border-t border-ink-800/40">
        <UserCheck className="h-3.5 w-3.5 text-court-400 shrink-0" />
        <span>
          Assigned referee & staff fees post immediately as live operational expenses under{" "}
          <strong className="text-ink-200 font-semibold">Match Operations</strong> in Academy
          Accounting.
        </span>
      </div>
    </div>
  );
}

import type { Player, SessionItem } from "./mock-data";

export interface PlayerAttendance30DayStats {
  totalCompletedSessions: number;
  attendedSessions: number;
  rate: number; // percentage integer 0-100
  isLowAttendance: boolean; // strictly below 60%
  warningMessage?: string;
}

/**
 * Calculates a player's attendance percentage across completed sessions over the last 30 rolling days.
 * If attendance is below 60%, flags as low attendance.
 */
export function calculatePlayer30DayAttendance(
  playerId: string,
  player: Player | undefined,
  sessions: SessionItem[],
  attendance: Record<string, Record<string, "Present" | "Absent" | "Excused">>,
): PlayerAttendance30DayStats {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Filter completed sessions that fall in the last 30 rolling days window
  const eligibleSessions = sessions.filter((s) => {
    const st = (s.status || "").toLowerCase();
    if (st !== "completed" && st !== "official") return false;

    // Parse session date
    const sessionDate = new Date(`${s.date}T${s.time || "00:00"}:00`);
    const dateOnly = new Date(s.date);
    const validDate = !isNaN(sessionDate.getTime()) ? sessionDate : dateOnly;
    if (isNaN(validDate.getTime())) return false;

    // Must be in [now - 30 days, now]
    if (validDate < thirtyDaysAgo || validDate > now) return false;

    // Check if session applies to this player
    // 1. Explicit attendance record exists
    if (attendance[s.id]?.[playerId] !== undefined) return true;

    // 2. Explicitly in attendees list
    if (s.attendees?.includes(playerId)) return true;

    // 3. Squad and branch relevance
    if (player) {
      const matchBranch = !s.branch || s.branch === player.branch;
      const matchTeam =
        !s.teamA && !s.teamB && !s.team
          ? true
          : (player.teams || []).some((t) => t === s.team || t === s.teamA || t === s.teamB);
      if (matchBranch && matchTeam) return true;
    }

    return false;
  });

  if (eligibleSessions.length === 0) {
    return {
      totalCompletedSessions: 0,
      attendedSessions: 0,
      rate: 100,
      isLowAttendance: false,
    };
  }

  let attendedCount = 0;
  for (const s of eligibleSessions) {
    const record = attendance[s.id]?.[playerId];
    if (record === "Present" || (!record && s.attendees?.includes(playerId))) {
      attendedCount++;
    }
  }

  const rate = Math.round((attendedCount / eligibleSessions.length) * 100);
  const isLowAttendance = rate < 60;
  const playerName = player?.name || "Player";

  return {
    totalCompletedSessions: eligibleSessions.length,
    attendedSessions: attendedCount,
    rate,
    isLowAttendance,
    warningMessage: isLowAttendance
      ? `⚠️ Low Attendance Warning: ${playerName} (Rate: ${rate}% over last 30 days).`
      : undefined,
  };
}

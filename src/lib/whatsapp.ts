import type { Player, SessionItem } from "./mock-data";
import { toast } from "sonner";

export interface WhatsAppGroupConfig {
  id: string;
  name: string;
  scope: string; // Team or branch scope
  link?: string; // e.g. https://chat.whatsapp.com/...
  adminPhone?: string; // Optional admin contact
  category?: "Games" | "Sessions" | "General" | "Coaches";
}

export type WhatsAppTemplateCategory = "Session" | "Game" | "Player" | "Billing" | "General";

export interface WhatsAppTemplate {
  id: string;
  name: string;
  category: WhatsAppTemplateCategory;
  description?: string;
  body: string;
  isDefault?: boolean;
  updatedAt?: string;
}

export interface WhatsAppVariableMeta {
  token: string;
  label: string;
  sample: string;
  description: string;
}

export const WHATSAPP_TEMPLATE_VARIABLES: WhatsAppVariableMeta[] = [
  {
    token: "{PLAYER_NAME}",
    label: "Player Name",
    sample: "Karim Mansour",
    description: "Full name of the selected player or athlete",
  },
  {
    token: "{SESSION_DATE}",
    label: "Session Date",
    sample: new Date().toISOString().slice(0, 10),
    description: "Scheduled date of the training session or match",
  },
  {
    token: "{ACADEMY_NAME}",
    label: "Academy Name",
    sample: "Vescio Vector Academy",
    description: "Official name of the sports academy",
  },
  {
    token: "{SESSION_TIME}",
    label: "Session Time",
    sample: "17:30",
    description: "Start time of the session or fixture",
  },
  {
    token: "{SESSION_TITLE}",
    label: "Session Title",
    sample: "U16 Tactical Practice",
    description: "Name or title of the scheduled session or game",
  },
  {
    token: "{VENUE}",
    label: "Court / Venue",
    sample: "Main Indoor Arena",
    description: "Court, pitch, or facility location",
  },
  {
    token: "{BRANCH_NAME}",
    label: "Branch Name",
    sample: "Downtown HQ",
    description: "Academy branch hosting the session or player",
  },
  {
    token: "{TEAM_NAME}",
    label: "Team / Squad",
    sample: "U16 Elite",
    description: "Assigned squad or team name",
  },
  {
    token: "{COACH_NAME}",
    label: "Coach Name",
    sample: "Coach Ziad",
    description: "Lead or head coach assigned to the session/team",
  },
  {
    token: "{PARENT_NAME}",
    label: "Guardian / Parent",
    sample: "Nabil Mansour",
    description: "Primary guardian or parent contact name",
  },
  {
    token: "{BALANCE}",
    label: "Account Balance",
    sample: "USD 120",
    description: "Player's current outstanding balance",
  },
  {
    token: "{SCORE}",
    label: "Match Score",
    sample: "78 - 72",
    description: "Final or live score of the fixture",
  },
];

export const DEFAULT_WHATSAPP_TEMPLATES: WhatsAppTemplate[] = [
  {
    id: "tpl-session-reminder",
    name: "Training Session Reminder",
    category: "Session",
    description:
      "Standard pre-session reminder for athletes and parents with date, time, and court details",
    body: `🏀 *{ACADEMY_NAME} — SESSION REMINDER*\n\nHello {PLAYER_NAME},\n\nThis is a reminder for your upcoming training session:\n📅 *Date:* {SESSION_DATE}\n⏰ *Time:* {SESSION_TIME}\n📋 *Session:* {SESSION_TITLE}\n📍 *Venue:* {VENUE} ({BRANCH_NAME})\n👕 *Squad:* {TEAM_NAME}\n👤 *Coach:* {COACH_NAME}\n\nPlease arrive 15 minutes early in full training kit.`,
    isDefault: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "tpl-matchday-callup",
    name: "Matchday Call-Up & Fixture Notice",
    category: "Game",
    description: "Official matchday roster call-up and tip-off announcement",
    body: `🏆 *{ACADEMY_NAME} — MATCHDAY CALL-UP*\n\nAthlete: *{PLAYER_NAME}* ({TEAM_NAME})\nFixture: *{SESSION_TITLE}*\n📅 *Date:* {SESSION_DATE} at {SESSION_TIME}\n📍 *Court / Venue:* {VENUE} · {BRANCH_NAME}\n👤 *Head Coach:* {COACH_NAME}\n\nPlease confirm attendance with your coach at least 2 hours prior to tip-off.`,
    isDefault: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "tpl-game-result",
    name: "Official Final Score Report",
    category: "Game",
    description: "Post-game score summary and team recognition broadcast",
    body: `🔥 *{ACADEMY_NAME} — FINAL SCORE REPORT*\n━━━━━━━━━━━━━━━━━━━━━━\n🏀 *Match:* {SESSION_TITLE}\n🏆 *Final Score:* {SCORE}\n📅 *Date:* {SESSION_DATE}\n📍 *Venue:* {VENUE} ({BRANCH_NAME})\n👤 *Head Coach:* {COACH_NAME}\n━━━━━━━━━━━━━━━━━━━━━━\nGreat effort by {PLAYER_NAME} and the entire {TEAM_NAME} squad!`,
    isDefault: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "tpl-player-parent-notice",
    name: "Player & Guardian Schedule Update",
    category: "Player",
    description:
      "Direct personalized update for a player or guardian regarding their next scheduled session",
    body: `👋 *{ACADEMY_NAME} — PLAYER NOTICE*\n\nDear {PARENT_NAME},\n\nHere is the latest schedule update for *{PLAYER_NAME}* ({TEAM_NAME}):\n📅 *Next Session:* {SESSION_TITLE} on {SESSION_DATE} at {SESSION_TIME}\n📍 *Location:* {VENUE}, {BRANCH_NAME}\n👤 *Coach:* {COACH_NAME}\n\nThank you for your continued commitment to {ACADEMY_NAME}!`,
    isDefault: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "tpl-billing-reminder",
    name: "Tuition & Balance Reminder",
    category: "Billing",
    description: "Polite account balance reminder for parents and guardians",
    body: `💳 *{ACADEMY_NAME} — TUITION & ACCOUNT NOTICE*\n\nDear {PARENT_NAME},\n\nThis is a friendly reminder regarding the academy account for *{PLAYER_NAME}* ({TEAM_NAME}).\n💰 *Outstanding Balance:* {BALANCE}\n📅 *Next Scheduled Session:* {SESSION_DATE}\n📍 *Branch:* {BRANCH_NAME}\n\nPlease contact administration or visit the front desk at your convenience. Thank you!`,
    isDefault: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

export interface WhatsAppTemplateContextInput {
  academyName?: string | undefined;
  currency?: string | undefined;
  player?: Partial<Player> | null | undefined;
  session?: Partial<SessionItem> | null | undefined;
  teamName?: string | undefined;
  branchName?: string | undefined;
  coachName?: string | undefined;
  customOverrides?: Record<string, string | undefined> | undefined;
}

export function buildWhatsAppTemplateContext(
  input: WhatsAppTemplateContextInput,
): Record<string, string> {
  const academyName = (input.academyName || "").trim() || "Vescio Vector Academy";
  const currency = (input.currency || "USD").trim();
  const p = input.player;
  const s = input.session;

  const playerName = p?.name?.trim() || "All Squad Athletes";
  const parentName =
    p?.guardianName?.trim() ||
    p?.guardian?.trim() ||
    (p?.name ? `Parent/Guardian of ${p.name.trim()}` : "Parents & Guardians");
  const resolvedTeam =
    input.teamName?.trim() ||
    s?.team?.trim() ||
    (s?.teamA && s?.teamB ? `${s.teamA} vs ${s.teamB}` : "") ||
    p?.teams?.[0]?.trim() ||
    p?.category?.trim() ||
    "Academy Squad";
  const resolvedBranch =
    input.branchName?.trim() || s?.branch?.trim() || p?.branch?.trim() || "Main HQ";
  const resolvedCoach =
    input.coachName?.trim() || s?.coach?.trim() || s?.headCoach?.trim() || "Coaching Staff";

  const sessionDate = s?.date?.trim() || new Date().toISOString().slice(0, 10);
  const sessionTime = s?.time?.trim() || "17:00";
  const sessionTitle =
    s?.title?.trim() ||
    (s?.teamA && s?.teamB ? `${s.teamA} vs ${s.teamB}` : "") ||
    (s?.kind ? `${s.kind} Session` : "Training Session");
  const venue = s?.venue?.trim() || s?.detail?.trim() || resolvedBranch;
  const score = s?.score?.trim() || "TBD";
  const balanceNum = typeof p?.balance === "number" ? p.balance : 0;
  const balanceStr = `${currency} ${balanceNum.toLocaleString()}`;

  const base: Record<string, string> = {
    PLAYER_NAME: playerName,
    SESSION_DATE: sessionDate,
    ACADEMY_NAME: academyName,
    SESSION_TIME: sessionTime,
    SESSION_TITLE: sessionTitle,
    VENUE: venue,
    BRANCH_NAME: resolvedBranch,
    TEAM_NAME: resolvedTeam,
    COACH_NAME: resolvedCoach,
    PARENT_NAME: parentName,
    BALANCE: balanceStr,
    SCORE: score,
  };

  if (input.customOverrides) {
    for (const [k, v] of Object.entries(input.customOverrides)) {
      if (v !== undefined && v !== "") {
        const cleanKey = k.replace(/^\{|\}$/g, "").toUpperCase();
        base[cleanKey] = v;
      }
    }
  }

  return base;
}

/**
 * Dynamically replaces {PLAYER_NAME}, {SESSION_DATE}, {ACADEMY_NAME}, and other supported
 * variables inside a custom WhatsApp template string.
 */
export function interpolateWhatsAppTemplate(
  templateBody: string,
  context: Record<string, string | undefined>,
): string {
  if (!templateBody) return "";
  return templateBody.replace(/\{([A-Za-z0-9_]+)\}/g, (fullMatch, rawKey: string) => {
    const keyUpper = rawKey.toUpperCase();
    const direct = context[keyUpper] ?? context[rawKey] ?? context[`{${keyUpper}}`];
    if (direct !== undefined && direct !== "") {
      return direct;
    }
    return fullMatch;
  });
}

/**
 * Formats a clean, high-impact WhatsApp match report with emojis & key metrics
 */
export function formatGameReportForWhatsApp(
  game: SessionItem,
  academyName = "Vescio Vector Academy",
): string {
  const title = game.title || `${game.teamA || "Team A"} vs ${game.teamB || "Team B"}`;
  const score = game.score
    ? `🏆 *FINAL SCORE:* ${game.score}`
    : "⏳ *STATUS:* Scheduled / In Progress";
  const dateStr = game.date || "TBD";
  const timeStr = game.time || "TBD";
  const venue = game.venue || game.detail || game.branch || "Home Court";
  const coach = game.coach || game.headCoach || "Coaching Staff";

  const refs = game.referees || [];
  const staff = game.matchStaff || [];

  let officialsText = "";
  if (refs.length > 0 || staff.length > 0) {
    const refNames = refs
      .map((r) => `${r.role || "Ref"}: ${r.name} (${r.source === "outsource" ? "Ext" : "Int"})`)
      .join(" · ");
    const staffNames = staff.map((s) => `${s.role || "Staff"}: ${s.name}`).join(" · ");
    const combined = [refNames, staffNames].filter(Boolean).join(" | ");
    officialsText = `\n⚖️ *Match Officials:* ${combined}`;
  }

  const notesText = game.report ? `\n\n📝 *Match Highlights & Coach Notes:*\n${game.report}` : "";

  return `🏀 *${academyName.toUpperCase()} — GAME REPORT* 🏀
━━━━━━━━━━━━━━━━━━━━━━
🔥 *Match:* ${title}
${score}
📅 *Date & Time:* ${dateStr} at ${timeStr}
📍 *Court / Venue:* ${venue} (${game.branch || "HQ"})
👤 *Head Coach:* ${coach}${officialsText}${notesText}
━━━━━━━━━━━━━━━━━━━━━━
⚡ _Sent live from Vescio Vector Match Operations_`;
}

/**
 * Formats a practice / training session announcement for WhatsApp
 */
export function formatSessionNoticeForWhatsApp(
  session: SessionItem,
  academyName = "Vescio Vector Academy",
): string {
  const title = session.title || `${session.kind} Session`;
  const dateStr = session.date || "TBD";
  const timeStr = session.time || "TBD";
  const venue = session.detail || session.venue || session.branch || "Main Facility";
  const coach = session.coach || session.headCoach || "Head Coach";

  return `🏀 *${academyName.toUpperCase()} — TRAINING NOTICE* 🏀
━━━━━━━━━━━━━━━━━━━━━━
📋 *Session:* ${title} (${session.kind || "Practice"})
📅 *Date:* ${dateStr}
⏰ *Time:* ${timeStr}
📍 *Location:* ${venue} · Branch: ${session.branch || "HQ"}
👤 *Coach:* ${coach}
━━━━━━━━━━━━━━━━━━━━━━
💡 *Athlete Checklist:*
• Please arrive 15 minutes before tip-off for dynamic activation.
• Full training kit, indoor court shoes, and personal water bottle.
━━━━━━━━━━━━━━━━━━━━━━
⚡ _Vescio Vector Academy Scheduling System_`;
}

/**
 * Normalizes Lebanese and international phone numbers to E.164 digits (without '+')
 * for direct WhatsApp wa.me links.
 */
export function formatWhatsAppPhone(raw?: string): string {
  if (!raw) return "";
  const rawDigits = String(raw).replace(/\D/g, "");
  if (!rawDigits) return "";
  const digits = rawDigits.startsWith("00") ? rawDigits.slice(2) : rawDigits;

  // Lebanese 8-digit local numbers starting with "0" (e.g. "03123456", "01...", "04...", "09...")
  if (digits.length === 8 && digits.startsWith("0")) {
    return "961" + digits.slice(1);
  }

  // Lebanese 7-digit mobile numbers starting with "3" (e.g. "3123456")
  if (digits.length === 7 && digits.startsWith("3")) {
    return "961" + digits;
  }

  // Lebanese 8-digit mobile numbers starting with 70, 71, 76, 78, 79, 81
  if (
    digits.length === 8 &&
    (digits.startsWith("70") ||
      digits.startsWith("71") ||
      digits.startsWith("76") ||
      digits.startsWith("78") ||
      digits.startsWith("79") ||
      digits.startsWith("81"))
  ) {
    return "961" + digits;
  }

  return digits;
}

/**
 * Opens a direct 1-on-1 WhatsApp chat with normalized phone number and optional pre-filled message.
 */
export function openDirectWhatsApp(phone: string, message?: string): void {
  const normalized = formatWhatsAppPhone(phone);
  if (!normalized) {
    if (message) {
      pushToWhatsApp(message);
    }
    return;
  }
  if (message && typeof navigator !== "undefined" && navigator.clipboard) {
    navigator.clipboard.writeText(message).catch(() => {});
  }
  const url = `https://wa.me/${normalized}${message ? `?text=${encodeURIComponent(message)}` : ""}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Launches WhatsApp with pre-filled encoded text
 */
export function pushToWhatsApp(text: string, groupLink?: string, adminPhone?: string): void {
  // 1. Copy formatted text to clipboard
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => {});
  }

  const trimmedLink = (groupLink?.trim() || "").replace(/^http:\/\//i, "https://");

  // 2. Open WhatsApp
  if (trimmedLink.startsWith("https://chat.whatsapp.com/")) {
    toast.success("Opening WhatsApp group! Formatted message copied to clipboard.", {
      description: "Paste it directly into the chat (Ctrl+V / Long-press Paste).",
    });
    window.open(trimmedLink, "_blank", "noopener,noreferrer");
  } else if (trimmedLink.startsWith("https://wa.me/")) {
    toast.success("Opening direct WhatsApp link with pre-filled message...", {
      description: "Formatted text ready to send. Message also saved to clipboard.",
    });
    const separator = trimmedLink.includes("?") ? "&" : "?";
    const waUrl = `${trimmedLink}${separator}text=${encodeURIComponent(text)}`;
    window.open(waUrl, "_blank", "noopener,noreferrer");
  } else if (adminPhone && formatWhatsAppPhone(adminPhone)) {
    toast.success("Opening direct WhatsApp chat with pre-filled message...", {
      description: "Formatted text ready to send. Message also saved to clipboard.",
    });
    openDirectWhatsApp(adminPhone, text);
  } else {
    toast.success("Launching WhatsApp with pre-filled message...", {
      description: "Formatted text ready to send. Message also saved to clipboard.",
    });
    const encoded = encodeURIComponent(text);
    const waUrl = `https://api.whatsapp.com/send?text=${encoded}`;
    window.open(waUrl, "_blank", "noopener,noreferrer");
  }
}

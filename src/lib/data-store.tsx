import type { Appearance } from "@/lib/appearance";
import type {
  ResourceFolder,
  ResourceItem,
  Workshop,
  MasterDrill,
  DrillCategory,
} from "./mock-data";
import { defaultAppearance, normalizeAppearance } from "@/lib/appearance";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Context, ReactNode } from "react";
import {
  collection,
  doc,
  onSnapshot,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  writeBatch,
  setDoc,
  deleteDoc,
} from "firebase/firestore";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { db as firestore, auth, functions } from "./firebase";
import { ReactiveDBStore, type SliceKey } from "./reactive-db-store";
import {
  logSystemError,
  initGlobalErrorTelemetry,
  setErrorLoggerUserContext,
} from "./error-logger";
import {
  syncToFirestore,
  atomicSetItem,
  atomicDeleteItem,
  atomicUpdateItem,
  atomicRecordAttendance,
  atomicUpdateAcademy,
  atomicProcessMerchandiseTransaction,
  atomicGenerateMonthlyInvoices,
  atomicProcessInvoicePayment,
  atomicUpdatePlayerStatuses,
  recordCronLog,
  dispatchAcademyNotification,
  markNotificationRead,
  markAllNotificationsRead,
  dismissAcademyNotification,
  cleanIncomingFirestoreData,
  cleanFirestoreData,
  MAX_BRANCH_LOG_ENTRIES,
  capBranchSubArrays,
  atomicRunBranchTransaction,
  atomicBookCourtReservationTransaction,
  atomicBookPhysioAppointmentTransaction,
  atomicCompletePosSaleTransaction,
  atomicGymCheckInTransaction,
  atomicBatchSaveEntities,
} from "./firestore-sync";
import {
  useAuth,
  bootstrapFirestoreUserDocument,
  normalizeUiRole,
  isSuperAdminRoleOrEmail,
  isTenantAdminRoleOrEmail,
  isE2EBypassEnabled,
} from "./auth";
import { getTenantSlug } from "./utils";
import { toast } from "sonner";
import { calculatePlayerMonthlyFee } from "./payments";
import { money } from "@/components/kit";
import { normalizeDoubleEntryLedger } from "./accounting-coa";
import { DEFAULT_WHATSAPP_TEMPLATES, type WhatsAppTemplate } from "./whatsapp";
import {
  academy as seedAcademy,
  branches as seedBranches,
  coaches as seedCoaches,
  invoices as seedInvoices,
  ledger as seedLedger,
  masterDrills as seedDrills,
  orders as seedOrders,
  players as seedPlayers,
  rolesMatrix as seedRoles,
  sessions as seedSessions,
  staff as seedStaff,
  stock as seedStock,
  teams as seedTeams,
  DEFAULT_INSURANCE_COMPANIES,
  DEFAULT_TRAINING_PACKAGES,
  DEFAULT_SPECIAL_OFFERS,
  DEFAULT_PRINTING_OPTIONS,
  DEFAULT_CRM_SETTINGS,
  DEFAULT_POS_CATALOG,
  MASTER_OWNER_EMAIL,
  DEFAULT_PROTECTED_SUPER_ADMIN_EMAILS,
  isMasterOwner,
  getStoredProtectedSuperAdminEmails,
  isProtectedSuperAdminEmail,
} from "@/lib/mock-data";
import type {
  Branch,
  BranchNexusRates,
  BranchOffDay,
  Coach,
  Court,
  CourtAllocationType,
  CourtRateType,
  CourtReservation,
  CrmCommunicationEntry,
  CrmLead,
  CrmReminderItem,
  CrmSettings,
  CrmStage,
  GymMember,
  GymWorkoutLog,
  InsuranceCompany,
  Invoice,
  MerchPrintingItem,
  MerchVariant,
  Order,
  PhysioRecord,
  PhysioTreatmentSession,
  Player,
  PlayerMedicalClearanceStatus,
  PosCartLineItem,
  PosCatalogItem,
  PosItemCategory,
  PosTransaction,
  PrintingOption,
  SessionItem,
  SpecialOfferConfig,
  Staff,
  StockItem,
  Supplier,
  Team,
  TrainingPackage,
} from "@/lib/mock-data";

export {
  DEFAULT_INSURANCE_COMPANIES,
  DEFAULT_TRAINING_PACKAGES,
  DEFAULT_SPECIAL_OFFERS,
  DEFAULT_PRINTING_OPTIONS,
  DEFAULT_CRM_SETTINGS,
  DEFAULT_POS_CATALOG,
  DEFAULT_GYM_PACKAGES,
  DEFAULT_PHYSIO_PACKAGES,
  MASTER_OWNER_EMAIL,
  DEFAULT_PROTECTED_SUPER_ADMIN_EMAILS,
  isMasterOwner,
  getStoredProtectedSuperAdminEmails,
  isProtectedSuperAdminEmail,
} from "./mock-data";

export type {
  Branch,
  BranchNexusRates,
  BranchOffDay,
  Coach,
  Court,
  CourtAllocationType,
  CourtRateType,
  CourtReservation,
  GymMember,
  GymWorkoutLog,
  GymProgressMetricEntry,
  GymCheckInEntry,
  GymPackageCategory,
  GymPackageConfig,
  GymCoachProfile,
  GymScheduleSlotType,
  GymScheduleSlot,
  Invoice,
  Order,
  PhysioRecord,
  PhysioTreatmentSession,
  PhysioExercisePrescription,
  PhysioAppointmentStatus,
  PhysioPractitioner,
  PhysioRoom,
  PhysioPackageConfig,
  PhysioAppointment,
  Player,
  PlayerMedicalClearanceStatus,
  PosCartLineItem,
  PosCatalogItem,
  PosItemCategory,
  PosTransaction,
  PosInventoryLog,
  PosRegisterShift,
  PosHeldOrder,
  MasterDrill,
  DrillCategory,
  MerchVariant,
  MerchPrintingItem,
  PrintingOption,
  InsuranceCompany,
  ResourceFolder,
  ResourceItem,
  SessionItem,
  Staff,
  StockItem,
  Supplier,
  Team,
  TrainingPackage,
  SpecialOfferConfig,
  Workshop,
  CrmStage,
  CrmSettings,
  CrmCommunicationEntry,
  CrmReminderItem,
  CrmLead,
} from "./mock-data";

export type LedgerEntry = {
  id: string;
  date: string;
  account: string;
  category?: string;
  entry?: string;
  description?: string;
  memo?: string;
  type: "Revenue" | "Expense" | "credit" | "debit";
  amount: number;
  status: "Collected" | "Paid" | "Pending";
  paymentMethod?: string;
  note?: string;
  branch?: string;
  attachment?: string;
  referenceId?: string;
  period?: string;
  playerId?: string;
  insuranceCompanyId?: string;
  insuranceCompanyName?: string;
  familyPlayerIds?: string[];
  familyPaymentAllocations?: Record<string, number>;
  familySettledInvoiceIds?: string[];
  coachId?: string;
  staffId?: string;
  orderId?: string;
  isAdvance?: boolean;
  advanceAmount?: number;
  advanceReason?: string;
  linkedAdvanceSessionsCount?: number;
  linkedAdvanceSessionIds?: string[];
  module?: "academy" | "courts" | "gym" | "physio" | "pos" | "merchandise" | "crm" | "general";
  debitAccount?: string;
  creditAccount?: string;
  currency?: "USD" | "LBP";
  originalAmount?: number;
  exchangeRate?: number;
};

export type MerchandiseTransactionParams = {
  orderId?: string | undefined;
  playerId?: string | undefined;
  playerName: string;
  team?: string | undefined;
  stockItemId?: string | undefined;
  itemName: string;
  variant?: string | undefined;
  variantId?: string | undefined;
  selectedSize?: string | undefined;
  selectedColor?: string | undefined;
  number?: string | undefined;
  printings?: MerchPrintingItem[] | undefined;
  printingTotalFee?: number | undefined;
  quantity: number;
  unitPrice: number;
  costPrice?: number | undefined;
  subtotal?: number | undefined;
  discountPercent?: number | undefined;
  discountAmount?: number | undefined;
  totalAmount: number;
  paidAmount: number;
  delivered?: boolean | undefined;
  branch?: string | undefined;
  date?: string | undefined;
  notes?: string | undefined;
};

import { seedUsers, type UserAccount } from "./auth-users";
export { seedUsers, type UserAccount };

export type PermissionPower = {
  read: boolean;
  write: boolean;
  delete: boolean;
};

export type RoleDefinition = {
  id: string;
  name: string;
  role?: string;
  description: string;
  scope: string;
  branchScope?: "All branches" | "Assigned branch only" | string;
  defaultBranchScope?: "All branches" | "Assigned branch only";
  isSystem?: boolean;
  permissions: Record<string, PermissionPower>;
};

export const SYSTEM_PERMISSION_MODULES = [
  {
    id: "dashboard",
    key: "dashboard",
    name: "Dashboard",
    label: "Dashboard",
    description: "Overview statistics, KPIs, and operational health",
  },
  {
    id: "players",
    key: "players",
    name: "Players & Passes",
    label: "Players & Passes",
    description: "Player directory, registrations, balances, and digital pass generation",
  },
  {
    id: "teams",
    key: "teams",
    name: "Teams & Squads",
    label: "Teams & Squads",
    description: "Team rosters, category assignments, and squad setups",
  },
  {
    id: "sessions",
    key: "sessions",
    name: "Sessions & Attendance",
    label: "Sessions & Attendance",
    description: "Practice/Game schedule, court booking, attendance logs, and QR scan",
  },
  {
    id: "drills",
    key: "drills",
    name: "Drills & Playbook",
    label: "Drills & Playbook",
    description: "Tactical drill library, lesson plans, and coaching whiteboard",
  },
  {
    id: "merchandise",
    key: "merchandise",
    name: "Merchandise & Inventory",
    label: "Merchandise & Inventory",
    description: "Inventory catalogue, stock levels, supplier records, and player kit orders",
  },
  {
    id: "accounting",
    key: "accounting",
    name: "Accounting & Finance",
    label: "Accounting & Finance",
    description: "Ledger, tuition billing, coach payroll disbursements, and P&L reports",
  },
  {
    id: "branches",
    key: "branches",
    name: "Branches & Courts",
    label: "Branches & Courts",
    description: "Physical branch locations, indoor/outdoor courts, and facilities",
  },
  {
    id: "staff",
    key: "staff",
    name: "Staff & Coaches",
    label: "Staff & Coaches",
    description: "Staff credentials, coach profiles, hourly rates, and contracts",
  },
  {
    id: "crm",
    key: "crm",
    name: "CRM & Pipeline",
    label: "CRM & Pipeline",
    description: "Prospective player leads, trial evaluations, idle follow-ups, churn & retention",
  },
  {
    id: "settings",
    key: "settings",
    name: "System Settings",
    label: "System Settings",
    description: "Academy profile, notification gateways, and system configurations",
  },
  {
    id: "users",
    key: "users",
    name: "User & Access Control",
    label: "User & Access Control",
    description: "User account management, role creation, and permission assignment",
  },
] as const;

export const defaultRoleDefinitions: RoleDefinition[] = [
  {
    id: "role-super-admin",
    name: "Super Admin",
    description:
      "Complete unrestricted access across all academy modules and branches (excluding client console, which is strictly exclusive to master owner geogo3@gmail.com)",
    scope: "All branches",
    defaultBranchScope: "All branches",
    isSystem: true,
    permissions: {
      dashboard: { read: true, write: true, delete: true },
      players: { read: true, write: true, delete: true },
      teams: { read: true, write: true, delete: true },
      sessions: { read: true, write: true, delete: true },
      drills: { read: true, write: true, delete: true },
      merchandise: { read: true, write: true, delete: true },
      accounting: { read: true, write: true, delete: true },
      branches: { read: true, write: true, delete: true },
      staff: { read: true, write: true, delete: true },
      crm: { read: true, write: true, delete: true },
      settings: { read: true, write: true, delete: true },
      users: { read: true, write: true, delete: true },
    },
  },
  {
    id: "role-academy-manager",
    name: "Academy Manager",
    description:
      "Full administrative authority over academy operations, finances, roster, and settings (excluding coach portal, client console & setup wizard)",
    scope: "All branches",
    defaultBranchScope: "All branches",
    isSystem: true,
    permissions: {
      dashboard: { read: true, write: true, delete: true },
      players: { read: true, write: true, delete: true },
      teams: { read: true, write: true, delete: true },
      sessions: { read: true, write: true, delete: true },
      drills: { read: true, write: true, delete: true },
      merchandise: { read: true, write: true, delete: true },
      accounting: { read: true, write: true, delete: true },
      branches: { read: true, write: true, delete: true },
      staff: { read: true, write: true, delete: true },
      crm: { read: true, write: true, delete: true },
      settings: { read: true, write: true, delete: true },
      users: { read: true, write: true, delete: true },
    },
  },
  {
    id: "role-branch-manager",
    name: "Branch Manager",
    description:
      "Operational leadership over assigned facility, court booking, and localized branch roster",
    scope: "Assigned branch only",
    defaultBranchScope: "Assigned branch only",
    isSystem: true,
    permissions: {
      dashboard: { read: true, write: false, delete: false },
      players: { read: true, write: true, delete: false },
      teams: { read: true, write: true, delete: false },
      sessions: { read: true, write: true, delete: true },
      drills: { read: false, write: false, delete: false },
      merchandise: { read: true, write: true, delete: false },
      accounting: { read: false, write: false, delete: false },
      branches: { read: true, write: false, delete: false },
      staff: { read: true, write: false, delete: false },
      crm: { read: true, write: true, delete: false },
      settings: { read: false, write: false, delete: false },
      users: { read: false, write: false, delete: false },
    },
  },
  {
    id: "role-technical-director",
    name: "Technical Director",
    description:
      "Full oversight of technical coaching, drills playbook, squads, and game schedules",
    scope: "All branches",
    defaultBranchScope: "All branches",
    isSystem: true,
    permissions: {
      dashboard: { read: false, write: false, delete: false },
      players: { read: true, write: true, delete: false },
      teams: { read: true, write: true, delete: true },
      sessions: { read: true, write: true, delete: true },
      drills: { read: true, write: true, delete: true },
      merchandise: { read: false, write: false, delete: false },
      accounting: { read: false, write: false, delete: false },
      branches: { read: false, write: false, delete: false },
      staff: { read: true, write: true, delete: false },
      settings: { read: false, write: false, delete: false },
      users: { read: false, write: false, delete: false },
    },
  },
  {
    id: "role-accountant",
    name: "Accountant",
    description: "Financial ledger, tuition collection, payroll disbursement, and fiscal audit",
    scope: "All branches",
    defaultBranchScope: "All branches",
    isSystem: true,
    permissions: {
      dashboard: { read: true, write: false, delete: false },
      players: { read: true, write: false, delete: false },
      teams: { read: false, write: false, delete: false },
      sessions: { read: false, write: false, delete: false },
      drills: { read: false, write: false, delete: false },
      merchandise: { read: true, write: true, delete: true },
      accounting: { read: true, write: true, delete: true },
      branches: { read: true, write: false, delete: false },
      staff: { read: true, write: false, delete: false },
      settings: { read: false, write: false, delete: false },
      users: { read: false, write: false, delete: false },
    },
  },
  {
    id: "role-coach",
    name: "Coach",
    description: "Field execution, attendance logging, session reviews, and drill playbook",
    scope: "Assigned branch only",
    defaultBranchScope: "Assigned branch only",
    isSystem: true,
    permissions: {
      dashboard: { read: false, write: false, delete: false },
      players: { read: false, write: false, delete: false },
      teams: { read: false, write: false, delete: false },
      sessions: { read: true, write: true, delete: false },
      drills: { read: true, write: true, delete: false },
      merchandise: { read: false, write: false, delete: false },
      accounting: { read: false, write: false, delete: false },
      branches: { read: false, write: false, delete: false },
      staff: { read: false, write: false, delete: false },
      settings: { read: false, write: false, delete: false },
      users: { read: false, write: false, delete: false },
    },
  },
  {
    id: "role-staff",
    name: "Staff",
    description: "General operational staff with read-only access to core academy views",
    scope: "Assigned branch only",
    defaultBranchScope: "Assigned branch only",
    isSystem: true,
    permissions: {
      dashboard: { read: true, write: false, delete: false },
      players: { read: true, write: false, delete: false },
      teams: { read: true, write: false, delete: false },
      sessions: { read: true, write: false, delete: false },
      drills: { read: false, write: false, delete: false },
      merchandise: { read: false, write: false, delete: false },
      accounting: { read: false, write: false, delete: false },
      branches: { read: true, write: false, delete: false },
      staff: { read: false, write: false, delete: false },
      settings: { read: false, write: false, delete: false },
      users: { read: false, write: false, delete: false },
    },
  },
];

export type PlanBlock = {
  id: string;
  name: string;
  minutes: number;
  notes: string;
  drawing?: string | null;
  diagramUrl?: string;
  mediaUrl?: string;
  category?: string;
  drillId?: string;
};

export type Plan = {
  id: string;
  title: string;
  category: string;
  team?: string;
  coach: string;
  coachId?: string;
  focus: string;
  date: string;
  status: "Draft" | "Submitted" | "Approved" | "Rejected";
  blocks: PlanBlock[];
  review: string;
};

export type Academy = {
  name: string;
  tagline?: string;
  hq?: string;
  url: string;
  plan: string;
  renews: string;
  playersLimit: number;
  playersUsed?: number;
  branchesLimit: number;
  branchesUsed?: number;
  storageUsed: number;
  storageLimit: number;
  sport: "Basketball" | "Football" | "Volleyball";
  currency: string;
  currencies?: string[];
  logo: string | null;
  supportPhone: string;
  supportEmail: string;
  softDeadline: number;
  hardDeadline: number;
  features?: string[];
  paymentGateway?: {
    provider: "Stripe" | "Tap" | "Fawry" | "None";
    publishableKey?: string;
    secretKey?: string;
    webhookSecret?: string;
    mode: "Test" | "Live";
    enabled: boolean;
  };
  notificationServices?: {
    smsProvider: "Twilio" | "WhatsApp Business API" | "Local Gateway";
    emailProvider: "SendGrid" | "Firebase Cloud Messaging" | "SMTP";
    autoSendReceipts: boolean;
    smsApiKey?: string;
    emailApiKey?: string;
    smsWebhookUrl?: string;
    emailWebhookUrl?: string;
  };
  notificationConfig?: {
    smsWebhookUrl?: string;
    emailWebhookUrl?: string;
    smsApiKey?: string;
    emailApiKey?: string;
    smsProvider?: string;
    emailProvider?: string;
  };
  completedSetupSteps?: string[];
  setupDone?: boolean;
  playersCount?: number;
  branchesCount?: number;
  requireGameConfirmation?: boolean;
  autoConfirmGames?: boolean;
  whatsappTemplates?: WhatsAppTemplate[];
  insuranceCompanies?: InsuranceCompany[];
  trainingPackages?: TrainingPackage[];
  specialOffers?: SpecialOfferConfig[];
  printingOptions?: PrintingOption[];
  protectedSuperAdminEmails?: string[];
  crmSettings?: CrmSettings;
  assignmentMode?: "direct" | "dob_matrix";
};

/**
 * Deterministically counts the number of sessions in `yearMonth` (defaulting to current YYYY-MM)
 * where `playerId` was marked "Present".
 */
export function getPlayerMonthlyPresentCount(
  playerId: string,
  sessions: SessionItem[] | undefined,
  attendance: Record<string, Record<string, "Present" | "Absent" | "Excused" | string>> | undefined,
  yearMonth?: string,
): number {
  if (!playerId) return 0;
  const targetYm = (yearMonth || new Date().toISOString().slice(0, 7)).slice(0, 7);
  const sessList = Array.isArray(sessions) ? sessions : [];
  const attMap = attendance || {};
  let count = 0;
  for (const s of sessList) {
    if (!s || !s.id) continue;
    const sDate = (s.date || "").slice(0, 7);
    if (sDate !== targetYm) continue;
    const status = attMap[s.id]?.[playerId];
    if (
      status === "Present" ||
      (status as string) === "present" ||
      (!status && Array.isArray(s.attendees) && s.attendees.includes(playerId))
    ) {
      count += 1;
    }
  }
  return count;
}

export type { Appearance } from "@/lib/appearance";

export type WhatsAppGroupCategory =
  "Games" | "Sessions" | "General" | "Coaches" | "Parents" | "Emergency";

export type WhatsAppGroupScopeType = "team" | "coach_level" | "branch" | "academy" | "custom";

export type WhatsAppGroupMemberPhone = {
  id: string;
  name: string;
  phone: string;
  role: string;
  playerId?: string;
  coachId?: string;
  isAuto?: boolean;
};

export type WhatsAppGroup = {
  id: string;
  name: string;
  scope?: string;
  scopeType?: WhatsAppGroupScopeType;
  link?: string;
  branchId?: string;
  branchName?: string;
  teamId?: string;
  teamName?: string;
  coachLevel?: string;
  category?: WhatsAppGroupCategory;
  adminPhone?: string;
  contactName?: string;
  description?: string;
  manualMembers?: WhatsAppGroupMemberPhone[];
  excludedAutoPhones?: string[];
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export function findPlayerNextSession(
  player: Player | null | undefined,
  sessions: SessionItem[] | undefined,
): SessionItem | null {
  if (!player || !Array.isArray(sessions) || sessions.length === 0) return null;
  const todayIso = new Date().toISOString().slice(0, 10);
  const playerTeamsLower = new Set(
    (player.teams || []).map((t) => t.trim().toLowerCase()).filter(Boolean),
  );
  const playerBranchLower = (player.branch || "").trim().toLowerCase();

  const matchesPlayerTeam = (s: SessionItem) => {
    if (playerTeamsLower.size === 0) return false;
    const sTeams = [s.team, s.teamA, s.teamB]
      .filter((x): x is string => Boolean(x && x.trim()))
      .map((x) => x.trim().toLowerCase());
    return sTeams.some((st) => playerTeamsLower.has(st));
  };

  const matchesPlayerBranch = (s: SessionItem) => {
    if (!playerBranchLower) return true;
    const sb = (s.branch || "").trim().toLowerCase();
    return sb === playerBranchLower || sb === "all branches" || sb === "hq";
  };

  const sortAsc = (a: SessionItem, b: SessionItem) => {
    const da = `${a.date || "9999-99-99"}T${a.time || "00:00"}`;
    const dbStr = `${b.date || "9999-99-99"}T${b.time || "00:00"}`;
    return da.localeCompare(dbStr);
  };

  const sortDesc = (a: SessionItem, b: SessionItem) => -sortAsc(a, b);

  // 1. Upcoming or today's non-completed session for player's assigned team(s)
  const upcomingTeamSessions = sessions
    .filter((s) => s.date >= todayIso && s.status !== "Completed" && matchesPlayerTeam(s))
    .sort(sortAsc);
  if (upcomingTeamSessions.length > 0) return upcomingTeamSessions[0];

  // 2. Upcoming or today's non-completed session in player's branch (general practice/camp or any branch session)
  const upcomingBranchSessions = sessions
    .filter((s) => s.date >= todayIso && s.status !== "Completed" && matchesPlayerBranch(s))
    .sort(sortAsc);
  if (upcomingBranchSessions.length > 0) return upcomingBranchSessions[0];

  // 3. Any upcoming session on or after today
  const anyUpcoming = sessions
    .filter((s) => s.date >= todayIso && s.status !== "Completed")
    .sort(sortAsc);
  if (anyUpcoming.length > 0) return anyUpcoming[0];

  // 4. Fallback to most recent team or branch session
  const recentTeamOrBranch = sessions
    .filter((s) => matchesPlayerTeam(s) || matchesPlayerBranch(s))
    .sort(sortDesc);
  if (recentTeamOrBranch.length > 0) return recentTeamOrBranch[0];

  return [...sessions].sort(sortDesc)[0] || null;
}

export function resolveWhatsAppGroupMembers(
  group: Partial<WhatsAppGroup>,
  db: Pick<DB, "players" | "coaches" | "teams" | "branches">,
): WhatsAppGroupMemberPhone[] {
  const autoMembers: WhatsAppGroupMemberPhone[] = [];
  const seenPhones = new Set<string>();
  const excludedSet = new Set(
    (group.excludedAutoPhones || []).map((p) => String(p).replace(/[^\d+]/g, "")),
  );

  const pushAuto = (item: WhatsAppGroupMemberPhone) => {
    const cleanPhone = (item.phone || "").trim();
    if (!cleanPhone) return;
    const normDigits = cleanPhone.replace(/[^\d+]/g, "");
    const normKey = `${item.role}:${normDigits}:${item.name.toLowerCase()}`;
    if (seenPhones.has(normKey)) return;
    seenPhones.add(normKey);
    if (excludedSet.has(normDigits) || excludedSet.has(cleanPhone.replace(/\s+/g, ""))) return;
    autoMembers.push({ ...item, phone: cleanPhone, isAuto: true });
  };

  const inferredScopeType: WhatsAppGroupScopeType =
    group.scopeType ||
    (group.coachLevel
      ? "coach_level"
      : group.teamId || group.teamName
        ? "team"
        : group.branchId || group.branchName
          ? "branch"
          : group.scope?.toLowerCase().includes("all academy")
            ? "academy"
            : "custom");

  if (inferredScopeType === "team") {
    const matchedTeam = (db.teams || []).find(
      (t) =>
        (group.teamId && t.id === group.teamId) ||
        (group.teamName && t.name.toLowerCase() === group.teamName.toLowerCase()),
    );
    const targetTeamNameLower = (matchedTeam?.name || group.teamName || "").trim().toLowerCase();

    if (targetTeamNameLower) {
      // Include team head coach & assistant coach if they have phones
      if (matchedTeam) {
        const teamCoaches = (db.coaches || []).filter(
          (c) =>
            (matchedTeam.headCoachId && c.id === matchedTeam.headCoachId) ||
            (matchedTeam.assistantId && c.id === matchedTeam.assistantId) ||
            (matchedTeam.headCoach &&
              c.name.toLowerCase() === matchedTeam.headCoach.toLowerCase()) ||
            (matchedTeam.assistant && c.name.toLowerCase() === matchedTeam.assistant.toLowerCase()),
        );
        for (const c of teamCoaches) {
          if (c.phone?.trim()) {
            pushAuto({
              id: `auto-coach-${c.id}`,
              name: c.name,
              phone: c.phone,
              role: `Coach (${c.level || "Team Staff"})`,
              coachId: c.id,
            });
          }
        }
      }

      // Automatically list every player's phone number AND their guardians' phone numbers
      const teamPlayers = (db.players || []).filter((p) =>
        (p.teams || []).some((tn) => tn.trim().toLowerCase() === targetTeamNameLower),
      );
      for (const p of teamPlayers) {
        if (p.phone?.trim()) {
          pushAuto({
            id: `auto-player-${p.id}`,
            name: p.name,
            phone: p.phone,
            role: "Player",
            playerId: p.id,
          });
        }
        if (p.parentPhone?.trim()) {
          pushAuto({
            id: `auto-g1-${p.id}`,
            name: `${p.parent || "Guardian 1"} (${p.name})`,
            phone: p.parentPhone,
            role: "Guardian 1",
            playerId: p.id,
          });
        }
        if (p.guardian2Phone?.trim()) {
          pushAuto({
            id: `auto-g2-${p.id}`,
            name: `${p.guardian2Name || "Guardian 2"} (${p.name})`,
            phone: p.guardian2Phone,
            role: "Guardian 2",
            playerId: p.id,
          });
        }
      }
    }
  } else if (inferredScopeType === "coach_level") {
    const levelTarget = (group.coachLevel || "All Coaches").trim().toLowerCase();
    const branchTargetLower = (group.branchName || "").trim().toLowerCase();
    const matchingCoaches = (db.coaches || []).filter((c) => {
      const levelMatch =
        !levelTarget ||
        levelTarget === "all coaches" ||
        levelTarget === "all levels" ||
        levelTarget === "all" ||
        (c.level || "").trim().toLowerCase() === levelTarget;
      if (!levelMatch) return false;
      if (branchTargetLower && branchTargetLower !== "all branches" && branchTargetLower !== "hq") {
        const cBranches = [c.branch, ...(c.branches || [])]
          .filter((b): b is string => Boolean(b))
          .map((b) => b.trim().toLowerCase());
        return cBranches.includes("all branches") || cBranches.includes(branchTargetLower);
      }
      return true;
    });

    for (const c of matchingCoaches) {
      if (c.phone?.trim()) {
        pushAuto({
          id: `auto-coach-${c.id}`,
          name: c.name,
          phone: c.phone,
          role: `Coach (${c.level || "Coach"})`,
          coachId: c.id,
        });
      }
    }
  } else if (inferredScopeType === "branch") {
    const matchedBranch = (db.branches || []).find(
      (b) =>
        (group.branchId && b.id === group.branchId) ||
        (group.branchName && b.name.toLowerCase() === group.branchName.toLowerCase()),
    );
    const targetBranchLower = (matchedBranch?.name || group.branchName || "").trim().toLowerCase();
    if (targetBranchLower) {
      const branchCoaches = (db.coaches || []).filter((c) => {
        const cBranches = [c.branch, ...(c.branches || [])]
          .filter((b): b is string => Boolean(b))
          .map((b) => b.trim().toLowerCase());
        return cBranches.includes(targetBranchLower);
      });
      for (const c of branchCoaches) {
        if (c.phone?.trim()) {
          pushAuto({
            id: `auto-coach-${c.id}`,
            name: c.name,
            phone: c.phone,
            role: `Coach (${c.level || "Branch"})`,
            coachId: c.id,
          });
        }
      }

      if (group.category !== "Coaches") {
        const branchPlayers = (db.players || []).filter(
          (p) => (p.branch || "").trim().toLowerCase() === targetBranchLower,
        );
        for (const p of branchPlayers) {
          if (p.phone?.trim()) {
            pushAuto({
              id: `auto-player-${p.id}`,
              name: p.name,
              phone: p.phone,
              role: "Player",
              playerId: p.id,
            });
          }
          if (p.parentPhone?.trim()) {
            pushAuto({
              id: `auto-g1-${p.id}`,
              name: `${p.parent || "Guardian 1"} (${p.name})`,
              phone: p.parentPhone,
              role: "Guardian 1",
              playerId: p.id,
            });
          }
          if (p.guardian2Phone?.trim()) {
            pushAuto({
              id: `auto-g2-${p.id}`,
              name: `${p.guardian2Name || "Guardian 2"} (${p.name})`,
              phone: p.guardian2Phone,
              role: "Guardian 2",
              playerId: p.id,
            });
          }
        }
      }
    }
  }

  const manualMembers: WhatsAppGroupMemberPhone[] = Array.isArray(group.manualMembers)
    ? group.manualMembers
        .filter((m) => Boolean(m && m.phone && m.phone.trim()))
        .map((m) => ({
          id: String(m.id || `man-${m.phone.replace(/\D/g, "")}`),
          name: String(m.name || "Manual Contact").trim(),
          phone: String(m.phone).trim(),
          role: String(m.role || "Manual").trim(),
          isAuto: false,
        }))
    : [];

  return [...autoMembers, ...manualMembers];
}

export type NotificationType =
  "attendance" | "billing" | "billing_automation" | "inventory" | "curriculum" | "system";

export type AcademyRole =
  "super_admin" | "branch_manager" | "coach" | "technical_director" | "accountant";

export interface AcademyNotification {
  id: string;
  tenantId: string;
  title: string;
  message: string;
  type: NotificationType;
  targetRoles?: AcademyRole[];
  targetBranchId?: string; // Optional: filter by single branch if relevant
  targetBranchIds?: string[]; // Optional: filter by multiple branches
  branch?: string;
  targetUserId?: string; // Optional: target a specific user ID
  targetCoachId?: string; // Optional: target a specific coach ID
  targetCoachName?: string; // Optional: target a specific coach by name
  targetCoachNames?: string[]; // Optional: target multiple coaches by name or ID (e.g. workshops)
  targetCoachLevels?: string[]; // Optional: target coaches by coaching level (e.g. workshops)
  targetTeam?: string; // Optional: target a specific team name
  createdAt: string; // ISO string or Firestore Timestamp
  readBy: string[]; // List of user keys who marked this notification as read
  dismissedBy?: string[]; // List of user keys who dismissed this notification
  actionUrl?: string; // Deep link to the relevant screen (e.g. /accounting, /merchandise, /coach)
  link?: string;
  priority?: "high" | "normal";
  targetPlayerId?: string;
  targetPlayerName?: string;
  isIdleFollowUpAlert?: boolean;
}

export type DB = {
  academy: Academy;
  appearance: Appearance;
  coaches: Coach[];
  players: Player[];
  teams: Team[];
  staff: Staff[];
  branches: Branch[];
  sessions: SessionItem[];
  stock: StockItem[];
  suppliers: Supplier[];
  orders: Order[];
  ledger: LedgerEntry[];
  invoices: Invoice[];
  users: UserAccount[];
  plans: Plan[];
  drills: MasterDrill[];
  lists: Record<string, string[]>;
  groups: WhatsAppGroup[];
  notifications: AcademyNotification[];
  attendance: Record<string, Record<string, "Present" | "Absent" | "Excused">>;
  attendanceMeta?: Record<
    string,
    Record<
      string,
      {
        timestamp: string;
        method?: "qr" | "qr_scan" | "manual";
        flag?: "low_attendance_warning" | string;
      }
    >
  >;
  auditLogs?: Array<{
    id: string;
    timestamp?: string;
    createdAt?: string;
    action?: string;
    title?: string;
    details?: string;
    message?: string;
    actor?: string;
    targetId?: string;
    targetName?: string;
  }>;
  resourceFolders: ResourceFolder[];
  workshops: Workshop[];
  crmLeads: CrmLead[];
  courtReservations: CourtReservation[];
  gymMembers: GymMember[];
  physioRecords: PhysioRecord[];
  posCatalog: PosCatalogItem[];
  posTransactions: PosTransaction[];
  customRoles: RoleDefinition[];
  ageCategoryRules?: Record<string, { startDate: string; endDate: string }>;
};

export const defaultAgeCategoryRules: Record<string, { startDate: string; endDate: string }> = {
  "U-10": { startDate: "2016-01-01", endDate: "2017-12-31" },
  "U-12": { startDate: "2014-01-01", endDate: "2015-12-31" },
  "U-14": { startDate: "2012-01-01", endDate: "2013-12-31" },
  "U-16": { startDate: "2010-01-01", endDate: "2011-12-31" },
  "U-18": { startDate: "2008-01-01", endDate: "2009-12-31" },
  Senior: { startDate: "1970-01-01", endDate: "2007-12-31" },
  U10: { startDate: "2016-01-01", endDate: "2017-12-31" },
  U12: { startDate: "2014-01-01", endDate: "2015-12-31" },
  U14: { startDate: "2012-01-01", endDate: "2013-12-31" },
  U16: { startDate: "2010-01-01", endDate: "2011-12-31" },
  U18: { startDate: "2008-01-01", endDate: "2009-12-31" },
};

export function formatAgeDate(isoDate?: string): string {
  if (!isoDate) return "";
  const parts = isoDate.split("-");
  if (parts.length !== 3) return isoDate;
  const fullMonths = [
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
  const day = parseInt(parts[2], 10);
  const monthIndex = parseInt(parts[1], 10) - 1;
  return `${day} ${fullMonths[monthIndex] || parts[1]} ${parts[0]}`;
}

export function checkPlayerAgeEligibility(
  dob?: string,
  category?: string,
  rules?: Record<string, { startDate: string; endDate: string }>,
): {
  isExceeding: boolean;
  reason?: string;
  rule?: { startDate: string; endDate: string };
  formattedRange?: string;
} {
  if (!dob || !category) return { isExceeding: false };
  const effectiveRules = rules ?? defaultAgeCategoryRules;
  const normCat = category.replace(/[\s-]/g, "").toLowerCase();
  const ruleKey = Object.keys(effectiveRules).find(
    (k) => k.replace(/[\s-]/g, "").toLowerCase() === normCat,
  );
  if (!ruleKey || !effectiveRules[ruleKey]) return { isExceeding: false };
  const rule = effectiveRules[ruleKey];
  const formattedRange = `${formatAgeDate(rule.startDate)} and ${formatAgeDate(rule.endDate)}`;

  if (rule.startDate && dob < rule.startDate) {
    return {
      isExceeding: true,
      reason: `Born ${formatAgeDate(dob)}: Exceeds age limit for ${category} (Eligible birth dates: ${formattedRange})`,
      rule,
      formattedRange,
    };
  }
  return { isExceeding: false, rule, formattedRange };
}

export function calculatePlayerAgeFromDob(dob?: string): {
  exactAge: number;
  birthYear: number;
  formattedSummary: string;
} | null {
  if (!dob || typeof dob !== "string") return null;
  const parts = dob.trim().split("-");
  if (parts.length !== 3) return null;
  const birthYear = parseInt(parts[0], 10);
  const birthMonth = parseInt(parts[1], 10);
  const birthDay = parseInt(parts[2], 10);
  if (isNaN(birthYear) || isNaN(birthMonth) || isNaN(birthDay)) return null;

  const now = new Date();
  let exactAge = now.getFullYear() - birthYear;
  const currentMonth = now.getMonth() + 1;
  const currentDay = now.getDate();
  if (currentMonth < birthMonth || (currentMonth === birthMonth && currentDay < birthDay)) {
    exactAge -= 1;
  }
  exactAge = Math.max(0, exactAge);
  return {
    exactAge,
    birthYear,
    formattedSummary: `${exactAge} yrs old · Born ${birthYear}`,
  };
}

export function resolveCategoryFromDob(
  dob?: string,
  rules?: Record<string, { startDate: string; endDate: string }>,
  availableCategories?: string[],
): string {
  const canonicalOrder = ["U-10", "U-12", "U-14", "U-16", "U-18", "Senior"];
  const fallback =
    (availableCategories && availableCategories.length > 0 ? availableCategories[0] : "U-12") ||
    "U-12";
  if (!dob || typeof dob !== "string" || dob.trim().length < 10) return fallback;
  const cleanDob = dob.trim().slice(0, 10);
  const effectiveRules = rules ?? defaultAgeCategoryRules;

  // Check exact match across canonical categories first
  for (const cat of canonicalOrder) {
    const normCat = cat.replace(/[\s-]/g, "").toLowerCase();
    const ruleKey = Object.keys(effectiveRules).find(
      (k) => k.replace(/[\s-]/g, "").toLowerCase() === normCat,
    );
    const rule = ruleKey ? effectiveRules[ruleKey] : undefined;
    if (rule && rule.startDate && rule.endDate) {
      if (cleanDob >= rule.startDate && cleanDob <= rule.endDate) {
        const matchedAvailable = availableCategories?.find(
          (c) => c.replace(/[\s-]/g, "").toLowerCase() === normCat,
        );
        return matchedAvailable || cat;
      }
    }
  }

  // Check any custom category rules
  for (const [key, rule] of Object.entries(effectiveRules)) {
    if (rule && rule.startDate && rule.endDate) {
      if (cleanDob >= rule.startDate && cleanDob <= rule.endDate) {
        const normKey = key.replace(/[\s-]/g, "").toLowerCase();
        const matchedAvailable = availableCategories?.find(
          (c) => c.replace(/[\s-]/g, "").toLowerCase() === normKey,
        );
        return matchedAvailable || key;
      }
    }
  }

  // If born after the youngest category's endDate, assign to youngest category (U-10)
  const u10Rule = effectiveRules["U-10"] || effectiveRules["U10"];
  if (u10Rule && cleanDob > u10Rule.endDate) {
    return (
      availableCategories?.find((c) => c.replace(/[\s-]/g, "").toLowerCase() === "u10") || "U-10"
    );
  }

  // If born before Senior/U-18, assign to Senior
  return (
    availableCategories?.find((c) => c.toLowerCase() === "senior") ||
    availableCategories?.[availableCategories.length - 1] ||
    "Senior"
  );
}

export type TeamEligibilityBadgeLabel =
  "Exact Match" | "Playing Up - Younger" | "Over-Age Exception" | "Ineligible";

export function evaluateTeamEligibilityForDob(
  dob: string | undefined,
  team: Partial<Team> | null | undefined,
  rules?: Record<string, { startDate: string; endDate: string }>,
  playerGender?: "Male" | "Female" | string,
): {
  eligible: boolean;
  matchType: "exact" | "younger" | "older" | "ineligible" | "ineligible_gender";
  badgeLabel: TeamEligibilityBadgeLabel;
  rule?: { startDate: string; endDate: string };
  formattedRange?: string;
  birthYearRange?: string;
} {
  if (!dob || !team || !team.category) {
    return { eligible: false, matchType: "ineligible", badgeLabel: "Ineligible" };
  }
  const cleanDob = dob.trim().slice(0, 10);
  if (cleanDob.length < 10) {
    return { eligible: false, matchType: "ineligible", badgeLabel: "Ineligible" };
  }
  const effectiveRules = rules ?? defaultAgeCategoryRules;
  const normCat = team.category.replace(/[\s-]/g, "").toLowerCase();
  const ruleKey = Object.keys(effectiveRules).find(
    (k) => k.replace(/[\s-]/g, "").toLowerCase() === normCat,
  );
  const rule = ruleKey ? effectiveRules[ruleKey] : undefined;
  if (!rule || !rule.startDate || !rule.endDate) {
    return { eligible: false, matchType: "ineligible", badgeLabel: "Ineligible" };
  }

  const formattedRange = `${formatAgeDate(rule.startDate)} – ${formatAgeDate(rule.endDate)}`;
  const startYr = rule.startDate.slice(0, 4);
  const endYr = rule.endDate.slice(0, 4);
  const birthYearRange = startYr === endYr ? startYr : `${startYr}–${endYr}`;

  if (playerGender && team.gender) {
    const normalizeGender = (g: string) => {
      const s = g.trim().toLowerCase();
      if (s === "boys" || s === "boy" || s === "male" || s === "m") return "male";
      if (s === "girls" || s === "girl" || s === "female" || s === "f") return "female";
      if (s === "mixed" || s === "co-ed" || s === "coed") return "mixed";
      return s;
    };
    const tGender = normalizeGender(team.gender);
    const pGender = normalizeGender(playerGender);
    const isMixed = tGender === "mixed";
    if (!isMixed && tGender !== pGender) {
      return {
        eligible: false,
        matchType: "ineligible_gender",
        badgeLabel: "Ineligible",
        rule,
        formattedRange,
        birthYearRange,
      };
    }
  }

  if (cleanDob >= rule.startDate && cleanDob <= rule.endDate) {
    return {
      eligible: true,
      matchType: "exact",
      badgeLabel: "Exact Match",
      rule,
      formattedRange,
      birthYearRange,
    };
  }

  // Born AFTER rule.endDate -> Player is YOUNGER than category minimum ("Playing Up - Younger")
  if (cleanDob > rule.endDate) {
    if (team.allowYoungerPlayers) {
      return {
        eligible: true,
        matchType: "younger",
        badgeLabel: "Playing Up - Younger",
        rule,
        formattedRange,
        birthYearRange,
      };
    }
    return {
      eligible: false,
      matchType: "ineligible",
      badgeLabel: "Ineligible",
      rule,
      formattedRange,
      birthYearRange,
    };
  }

  // Born BEFORE rule.startDate -> Player is OLDER than category maximum ("Over-Age Exception")
  if (cleanDob < rule.startDate) {
    if (team.allowOlderPlayers) {
      return {
        eligible: true,
        matchType: "older",
        badgeLabel: "Over-Age Exception",
        rule,
        formattedRange,
        birthYearRange,
      };
    }
    return {
      eligible: false,
      matchType: "ineligible",
      badgeLabel: "Ineligible",
      rule,
      formattedRange,
      birthYearRange,
    };
  }

  return {
    eligible: false,
    matchType: "ineligible",
    badgeLabel: "Ineligible",
    rule,
    formattedRange,
    birthYearRange,
  };
}

export const COURT_ALLOCATION_OPTIONS: CourtAllocationType[] = [
  "Full Court",
  "Half Court - HCA",
  "Half Court - HCB",
];

function parseTimeToMinutes(timeStr?: string | null): number | null {
  if (!timeStr || typeof timeStr !== "string") return null;
  const trimmed = timeStr.trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (Number.isNaN(hh) || Number.isNaN(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return null;
  }
  return hh * 60 + mm;
}

/**
 * Calculates session duration in hours from `time` (startTime) and `endTime`.
 * Defaults to 1.0 hour when `endTime` is omitted or invalid.
 */
export function calculateSessionDurationHours(
  startTime?: string | null,
  endTime?: string | null,
  explicitDurationHours?: number | null,
): number {
  const startMin = parseTimeToMinutes(startTime);
  const endMin = parseTimeToMinutes(endTime);
  if (startMin !== null && endMin !== null && endMin > startMin) {
    return Math.round(((endMin - startMin) / 60) * 100) / 100;
  }
  if (
    typeof explicitDurationHours === "number" &&
    !Number.isNaN(explicitDurationHours) &&
    explicitDurationHours > 0
  ) {
    return Math.round(explicitDurationHours * 100) / 100;
  }
  return 1;
}

/**
 * Locates the Branch and Court record matching a session's `branch` and `court` (or `detail`).
 */
export function findBranchAndCourtForSession(
  session: Partial<SessionItem>,
  branches: Branch[],
): { branch?: Branch; court?: Court } {
  const branchName = (session.branch || "").trim().toLowerCase();
  const branch = branchName
    ? branches.find((b) => (b.name || "").trim().toLowerCase() === branchName)
    : undefined;
  if (!branch) return {};
  const courts = Array.isArray(branch.courts) ? branch.courts : [];
  if (courts.length === 0) return { branch };
  const targetCourtName = (session.court || session.detail || "").trim().toLowerCase();
  const matchedCourt = targetCourtName
    ? courts.find((c) => (c.name || "").trim().toLowerCase() === targetCourtName)
    : undefined;
  return {
    branch,
    court: matchedCourt || courts[0],
  };
}

/**
 * Resolves a court's Full Court Hourly Rate and Half Court (HCA / HCB) Hourly Rate.
 */
export function resolveCourtHourlyRates(
  court?: Court | null,
  branch?: Branch | null,
): {
  fullCourtHourlyRate: number;
  halfCourtHourlyRate: number;
  enableHalfCourts: boolean;
} {
  const fallbackBranchRate =
    branch && branch.rentalType !== "Fixed amount"
      ? Number(branch.sessionRentalRate ?? branch.rentalRate ?? 0)
      : 0;
  const fallbackCourtRate =
    court && court.feeType !== "fixed" ? Number(court.feeAmount ?? 0) : fallbackBranchRate;

  const fullCourtHourlyRate =
    court?.fullCourtHourlyRate !== undefined && court?.fullCourtHourlyRate !== null
      ? Math.max(0, Number(court.fullCourtHourlyRate) || 0)
      : Math.max(0, fallbackCourtRate || 0);

  const halfCourtHourlyRate =
    court?.halfCourtHourlyRate !== undefined && court?.halfCourtHourlyRate !== null
      ? Math.max(0, Number(court.halfCourtHourlyRate) || 0)
      : Math.round((fullCourtHourlyRate / 2) * 100) / 100;

  return {
    fullCourtHourlyRate,
    halfCourtHourlyRate,
    enableHalfCourts: Boolean(court?.enableHalfCourts),
  };
}

/**
 * Deterministically calculates a session's court rental cost based on its duration
 * and whether it uses Full Court (`fullCourtHourlyRate`) or Half Court (`halfCourtHourlyRate`).
 */
export function calculateSessionCourtRentalCost(
  session: Partial<SessionItem>,
  branches: Branch[],
): {
  rentalCost: number;
  hourlyRate: number;
  fullCourtHourlyRate: number;
  halfCourtHourlyRate: number;
  durationHours: number;
  allocation: CourtAllocationType;
  courtName: string;
  isHalfCourt: boolean;
  enableHalfCourts: boolean;
} {
  const allocation: CourtAllocationType =
    session.courtAllocation === "Half Court - HCA" || session.courtAllocation === "Half Court - HCB"
      ? session.courtAllocation
      : "Full Court";
  const isHalfCourt = allocation !== "Full Court";
  const durationHours = calculateSessionDurationHours(
    session.time,
    session.endTime,
    session.durationHours,
  );
  const { branch, court } = findBranchAndCourtForSession(session, branches);
  const { fullCourtHourlyRate, halfCourtHourlyRate, enableHalfCourts } = resolveCourtHourlyRates(
    court,
    branch,
  );
  const hourlyRate = isHalfCourt ? halfCourtHourlyRate : fullCourtHourlyRate;
  const rentalCost = Math.round(hourlyRate * durationHours * 100) / 100;

  return {
    rentalCost,
    hourlyRate,
    fullCourtHourlyRate,
    halfCourtHourlyRate,
    durationHours,
    allocation,
    courtName: session.court || court?.name || "Court 1",
    isHalfCourt,
    enableHalfCourts,
  };
}

/**
 * Calculates the complete Session Cost Summary (Court Rental + Head Coach + Assistant + Officials).
 */
export function calculateSessionTotalCostSummary(
  session: Partial<SessionItem>,
  branches: Branch[],
  coaches: Coach[],
  teams: Team[],
): {
  rentalCost: number;
  hourlyRate: number;
  fullCourtHourlyRate: number;
  halfCourtHourlyRate: number;
  durationHours: number;
  allocation: CourtAllocationType;
  courtName: string;
  isHalfCourt: boolean;
  enableHalfCourts: boolean;
  headCoachCost: number;
  assistantCoachCost: number;
  officialsCost: number;
  totalDirectCost: number;
} {
  const courtInfo = calculateSessionCourtRentalCost(session, branches);
  const teamName = session.team || session.teamA || "";
  const matchedTeam = teamName ? teams.find((t) => t.name === teamName) : undefined;
  const headCoachName = session.headCoach || session.coach || matchedTeam?.headCoach || "";
  const matchedHeadCoach = headCoachName
    ? coaches.find((c) => c.name === headCoachName || c.id === session.coachId)
    : undefined;

  const headSessionFee =
    session.coachSessionFee !== undefined && session.coachSessionFee !== null
      ? Number(session.coachSessionFee) || 0
      : Number(
          session.coachRate ??
            matchedTeam?.headCoachRate ??
            matchedHeadCoach?.sessionFee ??
            matchedHeadCoach?.rate ??
            0,
        );
  const headTransportFee =
    session.coachTransportFee !== undefined && session.coachTransportFee !== null
      ? Number(session.coachTransportFee) || 0
      : Number(matchedHeadCoach?.transportFee ?? 0);
  const headCoachCost = headCoachName ? Math.max(0, headSessionFee + headTransportFee) : 0;

  const assistantName = session.assistantCoach || matchedTeam?.assistant || "";
  const matchedAssistant = assistantName
    ? coaches.find((c) => c.name === assistantName || c.id === session.assistantCoachId)
    : undefined;
  const assistantSessionFee =
    session.assistantSessionFee !== undefined && session.assistantSessionFee !== null
      ? Number(session.assistantSessionFee) || 0
      : Number(
          matchedTeam?.assistantRate ?? matchedAssistant?.sessionFee ?? matchedAssistant?.rate ?? 0,
        );
  const assistantTransportFee =
    session.assistantTransportFee !== undefined && session.assistantTransportFee !== null
      ? Number(session.assistantTransportFee) || 0
      : Number(matchedAssistant?.transportFee ?? 0);
  const assistantCoachCost = assistantName
    ? Math.max(0, assistantSessionFee + assistantTransportFee)
    : 0;

  const refereesFee = Array.isArray(session.referees)
    ? session.referees.reduce((sum, r) => sum + (Number(r.fee) || 0), 0)
    : 0;
  const staffFee = Array.isArray(session.matchStaff)
    ? session.matchStaff.reduce((sum, m) => sum + (Number(m.fee) || 0), 0)
    : 0;
  const officialsCost = Math.max(0, refereesFee + staffFee);

  const totalDirectCost =
    Math.round((courtInfo.rentalCost + headCoachCost + assistantCoachCost + officialsCost) * 100) /
    100;

  return {
    ...courtInfo,
    headCoachCost,
    assistantCoachCost,
    officialsCost,
    totalDirectCost,
  };
}

export function projectCourtReservationsForDate(
  targetDate: string,
  reservationsList: CourtReservation[],
  options?: {
    branchFilter?: string;
    branches?: Branch[];
    excludeReservationId?: string;
  },
): Array<CourtReservation & { isProjectedContinuous?: boolean; seedReservationId?: string }> {
  const cleanDate = (targetDate || "").trim();
  if (!cleanDate) return [];

  const getWeekdayUtc = (iso: string): number | null => {
    const parts = iso.split("-").map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    return new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!)).getUTCDay();
  };

  const targetWeekday = getWeekdayUtc(cleanDate);
  const bFilter = options?.branchFilter?.trim();
  const matchesBranch = (branchName?: string) => {
    if (!bFilter || bFilter === "All") return true;
    return (branchName || "").trim().toLowerCase() === bFilter.toLowerCase();
  };

  const branchesList: Branch[] = Array.isArray(options?.branches)
    ? options.branches
    : typeof dbStore !== "undefined"
      ? (dbStore.getSlice("branches") as Branch[]) || []
      : [];

  const isOffDayForBranch = (branchName?: string): boolean => {
    const bLower = (branchName || "").trim().toLowerCase();
    const bObj = bLower
      ? branchesList.find((b) => (b.name || "").trim().toLowerCase() === bLower)
      : branchesList[0];
    return Boolean(bObj?.offDays?.some((od) => od.date === cleanDate));
  };

  const concreteForDate = (reservationsList || []).filter(
    (r) =>
      r &&
      r.id !== options?.excludeReservationId &&
      r.status !== "Cancelled" &&
      (r.date || "").trim() === cleanDate &&
      matchesBranch(r.branch),
  );

  const materializedGroupKeys = new Set<string>();
  for (const r of concreteForDate) {
    if (r.recurringGroupId) {
      materializedGroupKeys.add(`${r.recurringGroupId}::${cleanDate}`);
    }
  }

  const projectedContinuousForDate: Array<
    CourtReservation & { isProjectedContinuous?: boolean; seedReservationId?: string }
  > = [];

  for (const seed of reservationsList || []) {
    if (!seed || seed.id === options?.excludeReservationId || seed.status === "Cancelled") continue;
    if (seed.recurrenceMode !== "continuous") continue;
    if (!matchesBranch(seed.branch)) continue;
    if (isOffDayForBranch(seed.branch)) continue;

    const startIso = (seed.seriesStartDate || seed.date || "").trim();
    if (!startIso || cleanDate <= startIso) continue;
    if (seed.continuousActive === false && !seed.continuousStoppedAfterDate) continue;
    if (seed.continuousStoppedAfterDate && cleanDate > seed.continuousStoppedAfterDate) continue;
    if (Array.isArray(seed.skippedDates) && seed.skippedDates.includes(cleanDate)) continue;
    if (targetWeekday === null || getWeekdayUtc(startIso) !== targetWeekday) continue;

    const grpId = seed.recurringGroupId || seed.id;
    if (materializedGroupKeys.has(`${grpId}::${cleanDate}`)) continue;

    projectedContinuousForDate.push({
      ...seed,
      id: `${seed.id}__occ__${cleanDate}`,
      seedReservationId: seed.id,
      isProjectedContinuous: true,
      date: cleanDate,
      paidAmount: 0,
      paymentStatus: seed.freePass ? "Free Pass" : "Pending",
      status: "Confirmed",
    });
  }

  return [...concreteForDate, ...projectedContinuousForDate].sort((a, b) =>
    (a.startTime || "").localeCompare(b.startTime || ""),
  );
}

/**
 * Schedule Conflict Checker supporting Full Court and Half-Court (HCA / HCB) simultaneous operations:
 * - Two different teams/coaches can book "Half Court - HCA" and "Half Court - HCB" at the exact same time on the same court.
 * - Blocks "Full Court" bookings if either HCA, HCB, or Full Court is already booked on that court during the overlapping time slot.
 * - Blocks duplicate "Half Court - HCA" + "Half Court - HCA" or "Half Court - HCB" + "Half Court - HCB" bookings on the same court/time.
 * - Blocks scheduling on dates marked in the branch's `offDays` array.
 */
export function checkCourtScheduleConflict(
  candidate: Partial<SessionItem>,
  existingSessions: SessionItem[],
  excludeSessionId?: string,
  existingReservations?: CourtReservation[],
  excludeReservationId?: string,
  branchOffDaysOrBranches?: BranchOffDay[] | Branch[],
): {
  hasCourtConflict: boolean;
  hasCoachConflict: boolean;
  conflictingCourtSession?: SessionItem;
  conflictingCoachSession?: SessionItem;
  simultaneousHalfCourtSession?: SessionItem;
  courtConflictReason?: string;
  coachConflictReason?: string;
} {
  const candidateDate = (candidate.date || "").trim();
  if (!candidateDate) {
    return { hasCourtConflict: false, hasCoachConflict: false };
  }

  const candidateStartMin = parseTimeToMinutes(candidate.time);
  const candidateDurHours = calculateSessionDurationHours(
    candidate.time,
    candidate.endTime,
    candidate.durationHours,
  );
  const candidateEndMin =
    candidateStartMin !== null ? candidateStartMin + Math.round(candidateDurHours * 60) : null;

  const candidateBranch = (candidate.branch || "").trim().toLowerCase();
  const candidateCourt = (candidate.court || "").trim().toLowerCase();
  const candidateAlloc: CourtAllocationType =
    candidate.courtAllocation === "Half Court - HCA" ||
    candidate.courtAllocation === "Half Court - HCB"
      ? candidate.courtAllocation
      : "Full Court";
  const candidateCoach = (candidate.headCoach || candidate.coach || "").trim().toLowerCase();

  // Check Branch Off Days / Closures first
  let resolvedOffDays: BranchOffDay[] = [];
  if (Array.isArray(branchOffDaysOrBranches) && branchOffDaysOrBranches.length > 0) {
    const firstItem = branchOffDaysOrBranches[0] as BranchOffDay | Branch;
    if (firstItem && "date" in firstItem && "reason" in firstItem) {
      resolvedOffDays = branchOffDaysOrBranches as BranchOffDay[];
    } else {
      const branchesArr = branchOffDaysOrBranches as Branch[];
      const matchedBranch = candidateBranch
        ? branchesArr.find((b) => (b.name || "").trim().toLowerCase() === candidateBranch)
        : branchesArr[0];
      resolvedOffDays = matchedBranch?.offDays || [];
    }
  } else if (typeof dbStore !== "undefined") {
    const storeBranches = (dbStore.getSlice("branches") as Branch[]) || [];
    const matchedBranch = candidateBranch
      ? storeBranches.find((b) => (b.name || "").trim().toLowerCase() === candidateBranch)
      : storeBranches[0];
    resolvedOffDays = matchedBranch?.offDays || [];
  }

  const offDayMatch = resolvedOffDays.find((od) => od && od.date === candidateDate);
  if (offDayMatch) {
    return {
      hasCourtConflict: true,
      hasCoachConflict: false,
      courtConflictReason: `Facility Off Day on ${candidateDate}: ${offDayMatch.reason || "Branch Closed"}. Sessions cannot be scheduled on Off Days.`,
    };
  }

  let conflictingCourtSession: SessionItem | undefined;
  let conflictingCoachSession: SessionItem | undefined;
  let simultaneousHalfCourtSession: SessionItem | undefined;
  let courtConflictReason: string | undefined;
  let coachConflictReason: string | undefined;

  const reservationsList: CourtReservation[] = Array.isArray(existingReservations)
    ? existingReservations
    : typeof dbStore !== "undefined"
      ? (dbStore.getSlice("courtReservations") as CourtReservation[]) || []
      : [];

  const activeReservationsForDate = projectCourtReservationsForDate(
    candidateDate,
    reservationsList,
    { excludeReservationId },
  );

  const reservationVirtualSessions: SessionItem[] = activeReservationsForDate.map((r) => ({
    id: r.id,
    kind: "Reservation",
    title: `[Vescio Nexus Rental] ${r.clientName}`,
    detail: `${r.clientType} · ${r.courtAllocation}`,
    branch: r.branch,
    court: r.court,
    courtAllocation: r.courtAllocation,
    date: r.date,
    time: r.startTime,
    endTime: r.endTime,
    durationHours: r.durationHours,
    coach: "",
    team: r.linkedTeamName || r.clientType,
    status: "Planned",
  }));

  const combinedSlots = [...existingSessions, ...reservationVirtualSessions];

  for (const s of combinedSlots) {
    if (!s || s.id === excludeSessionId || s.status === "Cancelled") continue;
    if ((s.date || "").trim() !== candidateDate) continue;

    // Determine time overlap
    const existingStartMin = parseTimeToMinutes(s.time);
    const existingDurHours = calculateSessionDurationHours(s.time, s.endTime, s.durationHours);
    const existingEndMin =
      existingStartMin !== null ? existingStartMin + Math.round(existingDurHours * 60) : null;

    let timeOverlaps = false;
    if (
      candidateStartMin !== null &&
      candidateEndMin !== null &&
      existingStartMin !== null &&
      existingEndMin !== null
    ) {
      timeOverlaps = candidateStartMin < existingEndMin && existingStartMin < candidateEndMin;
    } else {
      timeOverlaps = Boolean(candidate.time && s.time && candidate.time.trim() === s.time.trim());
    }

    if (!timeOverlaps) continue;

    // 1. Check Coach Conflict
    const existingCoach = (s.headCoach || s.coach || "").trim().toLowerCase();
    if (
      !conflictingCoachSession &&
      candidateCoach &&
      existingCoach &&
      candidateCoach === existingCoach
    ) {
      conflictingCoachSession = s;
      coachConflictReason = `Coach ${candidate.headCoach || candidate.coach} is already booked for "${s.title}" (${s.time}${s.endTime ? `–${s.endTime}` : ""}).`;
    }

    // 2. Check Court & Allocation Conflict
    const existingBranch = (s.branch || "").trim().toLowerCase();
    const existingCourt = (s.court || "").trim().toLowerCase();
    if (
      candidateBranch &&
      existingBranch === candidateBranch &&
      candidateCourt &&
      existingCourt === candidateCourt
    ) {
      const existingAlloc: CourtAllocationType =
        s.courtAllocation === "Half Court - HCA" || s.courtAllocation === "Half Court - HCB"
          ? s.courtAllocation
          : "Full Court";

      const isCompatibleOppositeHalf =
        (candidateAlloc === "Half Court - HCA" && existingAlloc === "Half Court - HCB") ||
        (candidateAlloc === "Half Court - HCB" && existingAlloc === "Half Court - HCA");

      if (isCompatibleOppositeHalf) {
        if (!simultaneousHalfCourtSession) {
          simultaneousHalfCourtSession = s;
        }
      } else if (!conflictingCourtSession) {
        conflictingCourtSession = s;
        if (candidateAlloc === "Full Court" && existingAlloc !== "Full Court") {
          courtConflictReason = `Full Court booking blocked: ${existingAlloc} on ${candidate.court} (${candidate.branch}) is already occupied by "${s.title}" (${s.team || s.teamA || "Team"}) at ${s.time}${s.endTime ? `–${s.endTime}` : ""}.`;
        } else if (candidateAlloc !== "Full Court" && existingAlloc === "Full Court") {
          courtConflictReason = `${candidateAlloc} booking blocked: ${candidate.court} (${candidate.branch}) is already booked as Full Court by "${s.title}" (${s.team || s.teamA || "Team"}) at ${s.time}${s.endTime ? `–${s.endTime}` : ""}.`;
        } else {
          courtConflictReason = `${candidateAlloc} on ${candidate.court} (${candidate.branch}) is already booked by "${s.title}" (${s.team || s.teamA || "Team"}) at ${s.time}${s.endTime ? `–${s.endTime}` : ""}.`;
        }
      }
    }
  }

  return {
    hasCourtConflict: Boolean(conflictingCourtSession),
    hasCoachConflict: Boolean(conflictingCoachSession),
    conflictingCourtSession,
    conflictingCoachSession,
    simultaneousHalfCourtSession,
    courtConflictReason,
    coachConflictReason,
  };
}

export type TeamOperatingCostRow = {
  teamId: string;
  teamName: string;
  category: string;
  branch: string;
  activePlayersCount: number;
  sessionsCount: number;
  fullCourtSessions: number;
  hcaSessions: number;
  hcbSessions: number;
  totalHours: number;
  courtRentalCost: number;
  coachPayrollCost: number;
  officialsCost: number;
  totalOperatingCost: number;
  tuitionRevenue: number;
  netMargin: number;
};

/**
 * Multi-Level Financial Impact Helper (Level B):
 * Computes Team Monthly Operating Cost & Profitability across Full Court and Half-Court (HCA / HCB) sessions.
 */
export function calculateTeamOperatingCostReport(
  teams: Team[],
  sessions: SessionItem[],
  players: Player[],
  branches: Branch[],
  coaches: Coach[],
  monthFilter?: string,
  branchFilter?: string,
): TeamOperatingCostRow[] {
  return teams
    .filter((t) => !branchFilter || t.branch === branchFilter)
    .map((team) => {
      const teamSessions = sessions.filter((s) => {
        if (s.status === "Cancelled") return false;
        if (monthFilter && !(s.date || "").startsWith(monthFilter)) return false;
        return s.team === team.name || s.teamA === team.name || s.teamB === team.name;
      });

      let fullCourtSessions = 0;
      let hcaSessions = 0;
      let hcbSessions = 0;
      let totalHours = 0;
      let courtRentalCost = 0;
      let coachPayrollCost = 0;
      let officialsCost = 0;

      for (const s of teamSessions) {
        const summary = calculateSessionTotalCostSummary(s, branches, coaches, teams);
        if (summary.allocation === "Half Court - HCA") hcaSessions += 1;
        else if (summary.allocation === "Half Court - HCB") hcbSessions += 1;
        else fullCourtSessions += 1;

        totalHours += summary.durationHours;
        // If internal scrimmage between teamA and teamB, split court & officials cost 50/50 if both are academy teams
        const isSharedGame =
          s.kind === "Game" &&
          s.teamA &&
          s.teamB &&
          (s.teamA === team.name || s.teamB === team.name) &&
          teams.some((other) => other.name === (s.teamA === team.name ? s.teamB : s.teamA));
        const shareFactor = isSharedGame ? 0.5 : 1;

        courtRentalCost += summary.rentalCost * shareFactor;
        coachPayrollCost += (summary.headCoachCost + summary.assistantCoachCost) * shareFactor;
        officialsCost += summary.officialsCost * shareFactor;
      }

      const activeTeamPlayers = players.filter(
        (p) =>
          p.status === "Active" &&
          ((Array.isArray(p.teams) && p.teams.includes(team.name)) || p.team === team.name),
      );
      const tuitionRevenue = activeTeamPlayers.reduce((sum, p) => {
        const feeForTeam =
          p.teamFees && p.teamFees[team.name] !== undefined
            ? Number(p.teamFees[team.name]) || 0
            : Number(team.monthlyFee || p.customFee || 150);
        return sum + feeForTeam;
      }, 0);

      const roundedRental = Math.round(courtRentalCost * 100) / 100;
      const roundedPayroll = Math.round(coachPayrollCost * 100) / 100;
      const roundedOfficials = Math.round(officialsCost * 100) / 100;
      const totalOperatingCost =
        Math.round((roundedRental + roundedPayroll + roundedOfficials) * 100) / 100;
      const roundedRevenue = Math.round(tuitionRevenue * 100) / 100;

      return {
        teamId: team.id,
        teamName: team.name,
        category: team.category,
        branch: team.branch,
        activePlayersCount: activeTeamPlayers.length,
        sessionsCount: teamSessions.length,
        fullCourtSessions,
        hcaSessions,
        hcbSessions,
        totalHours: Math.round(totalHours * 100) / 100,
        courtRentalCost: roundedRental,
        coachPayrollCost: roundedPayroll,
        officialsCost: roundedOfficials,
        totalOperatingCost,
        tuitionRevenue: roundedRevenue,
        netMargin: Math.round((roundedRevenue - totalOperatingCost) * 100) / 100,
      };
    });
}

export type CourtBreakdownMetric = {
  courtName: string;
  enableHalfCourts: boolean;
  fullCourtHourlyRate: number;
  halfCourtHourlyRate: number;
  fullCourtSessions: number;
  hcaSessions: number;
  hcbSessions: number;
  totalHours: number;
  courtRentalCost: number;
};

export type BranchCourtUtilizationRow = {
  branchId: string;
  branchName: string;
  courtsCount: number;
  halfCourtEnabledCount: number;
  totalSessions: number;
  fullCourtSessions: number;
  hcaSessions: number;
  hcbSessions: number;
  totalHours: number;
  sessionCourtRentalCost: number;
  fixedFacilityOverhead: number;
  coachAndOfficialsCost: number;
  totalBranchOperatingCost: number;
  branchCollectedRevenue: number;
  branchNetProfit: number;
  courtsBreakdown: CourtBreakdownMetric[];
};

/**
 * Multi-Level Financial Impact Helper (Level C & Level D):
 * Computes Branch Revenue & Court Utilization Analytics (Full Court vs. HCA / HCB) and facility rental costs.
 */
export function calculateBranchCourtUtilizationAnalytics(
  branches: Branch[],
  sessions: SessionItem[],
  ledger: LedgerEntry[],
  teams: Team[],
  coaches: Coach[],
  monthFilter?: string,
): BranchCourtUtilizationRow[] {
  return branches.map((b) => {
    const branchSessions = sessions.filter((s) => {
      if (s.status === "Cancelled") return false;
      if ((s.branch || "").trim().toLowerCase() !== (b.name || "").trim().toLowerCase()) {
        return false;
      }
      if (monthFilter && !(s.date || "").startsWith(monthFilter)) return false;
      return true;
    });

    const courtMap = new Map<string, CourtBreakdownMetric>();
    for (const c of b.courts || []) {
      const rates = resolveCourtHourlyRates(c, b);
      courtMap.set((c.name || "Court 1").trim(), {
        courtName: c.name || "Court 1",
        enableHalfCourts: rates.enableHalfCourts,
        fullCourtHourlyRate: rates.fullCourtHourlyRate,
        halfCourtHourlyRate: rates.halfCourtHourlyRate,
        fullCourtSessions: 0,
        hcaSessions: 0,
        hcbSessions: 0,
        totalHours: 0,
        courtRentalCost: 0,
      });
    }

    let fullCourtSessions = 0;
    let hcaSessions = 0;
    let hcbSessions = 0;
    let totalHours = 0;
    let sessionCourtRentalCost = 0;
    let coachAndOfficialsCost = 0;

    for (const s of branchSessions) {
      const summary = calculateSessionTotalCostSummary(s, branches, coaches, teams);
      if (summary.allocation === "Half Court - HCA") hcaSessions += 1;
      else if (summary.allocation === "Half Court - HCB") hcbSessions += 1;
      else fullCourtSessions += 1;

      totalHours += summary.durationHours;
      sessionCourtRentalCost += summary.rentalCost;
      coachAndOfficialsCost +=
        summary.headCoachCost + summary.assistantCoachCost + summary.officialsCost;

      const key = (summary.courtName || "Court 1").trim();
      const existingMetric = courtMap.get(key) || {
        courtName: key,
        enableHalfCourts: summary.enableHalfCourts,
        fullCourtHourlyRate: summary.fullCourtHourlyRate,
        halfCourtHourlyRate: summary.halfCourtHourlyRate,
        fullCourtSessions: 0,
        hcaSessions: 0,
        hcbSessions: 0,
        totalHours: 0,
        courtRentalCost: 0,
      };
      if (summary.allocation === "Half Court - HCA") existingMetric.hcaSessions += 1;
      else if (summary.allocation === "Half Court - HCB") existingMetric.hcbSessions += 1;
      else existingMetric.fullCourtSessions += 1;
      existingMetric.totalHours =
        Math.round((existingMetric.totalHours + summary.durationHours) * 100) / 100;
      existingMetric.courtRentalCost =
        Math.round((existingMetric.courtRentalCost + summary.rentalCost) * 100) / 100;
      courtMap.set(key, existingMetric);
    }

    const fixedCourtsSum = (b.courts || [])
      .filter((c) => c.feeType === "fixed")
      .reduce((acc, c) => acc + (Number(c.feeAmount) || 0), 0);
    const fixedFacilityOverhead = Math.max(0, Number(b.fixedExpenses || 0) + fixedCourtsSum);

    const branchCollectedRevenue = ledger
      .filter((l) => {
        if ((l.branch || "").trim().toLowerCase() !== (b.name || "").trim().toLowerCase()) {
          return false;
        }
        if (monthFilter && !(l.date || "").startsWith(monthFilter)) return false;
        return l.type === "Revenue" || (l.type as string) === "credit";
      })
      .reduce((acc, l) => acc + Math.abs(Number(l.amount) || 0), 0);

    const roundedSessionRental = Math.round(sessionCourtRentalCost * 100) / 100;
    const roundedCoachOfficials = Math.round(coachAndOfficialsCost * 100) / 100;
    const totalBranchOperatingCost =
      Math.round((roundedSessionRental + fixedFacilityOverhead + roundedCoachOfficials) * 100) /
      100;
    const roundedRevenue = Math.round(branchCollectedRevenue * 100) / 100;

    return {
      branchId: b.id,
      branchName: b.name,
      courtsCount: (b.courts || []).length,
      halfCourtEnabledCount: (b.courts || []).filter((c) => c.enableHalfCourts).length,
      totalSessions: branchSessions.length,
      fullCourtSessions,
      hcaSessions,
      hcbSessions,
      totalHours: Math.round(totalHours * 100) / 100,
      sessionCourtRentalCost: roundedSessionRental,
      fixedFacilityOverhead,
      coachAndOfficialsCost: roundedCoachOfficials,
      totalBranchOperatingCost,
      branchCollectedRevenue: roundedRevenue,
      branchNetProfit: Math.round((roundedRevenue - totalBranchOperatingCost) * 100) / 100,
      courtsBreakdown: Array.from(courtMap.values()),
    };
  });
}

/**
 * Normalizes a Coach record's legacy `branch` string and `branches` string[] array
 * into a deduplicated array of non-empty branch names (100% backward compatible).
 */
export function getCoachBranches(coach?: Partial<Coach> | null): string[] {
  if (!coach) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  const addBranch = (val?: string | null) => {
    if (!val || typeof val !== "string") return;
    val
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((part) => {
        const key = part.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          result.push(part);
        }
      });
  };
  if (Array.isArray(coach.branches)) {
    coach.branches.forEach((b) => addBranch(b));
  }
  addBranch(coach.branch);
  return result;
}

/**
 * Checks whether a coach is assigned to a target branch (case-insensitive, supports multi-branch).
 */
export function coachMatchesBranch(
  coach: Partial<Coach> | null | undefined,
  targetBranch?: string | null,
): boolean {
  if (!targetBranch || !targetBranch.trim() || targetBranch.trim().toLowerCase() === "all") {
    return true;
  }
  const needle = targetBranch.trim().toLowerCase();
  const branches = getCoachBranches(coach);
  return branches.some((b) => b.toLowerCase() === needle);
}

/**
 * Returns a deduplicated list of team names assigned to a coach across `coach.teams`, `coach.team`,
 * and any team in `allTeams` where the coach is listed as headCoach, assistant, or coach.
 */
export function getCoachTeams(coach?: Partial<Coach> | null, allTeams?: Team[]): string[] {
  if (!coach) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  const addTeam = (val?: string | null) => {
    if (!val || typeof val !== "string") return;
    const trimmed = val.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(trimmed);
    }
  };
  if (Array.isArray(coach.teams)) {
    coach.teams.forEach((t) => addTeam(t));
  }
  addTeam(coach.team);
  if (Array.isArray(allTeams) && allTeams.length > 0) {
    const coachId = coach.id?.trim();
    const coachNameLower = coach.name?.trim().toLowerCase();
    allTeams.forEach((t) => {
      if (!t || !t.name) return;
      const matchedById =
        Boolean(coachId) &&
        (t.coachId === coachId || t.headCoachId === coachId || t.assistantId === coachId);
      const matchedByName =
        Boolean(coachNameLower) &&
        (t.headCoach?.trim().toLowerCase() === coachNameLower ||
          t.assistant?.trim().toLowerCase() === coachNameLower ||
          t.coach?.trim().toLowerCase() === coachNameLower);
      if (matchedById || matchedByName) {
        addTeam(t.name);
      }
    });
  }
  return result;
}

export function getStoredUsers(): UserAccount[] {
  if (typeof window === "undefined") return seedUsers;
  try {
    const stored = window.localStorage.getItem("vv_custom_registered_users");
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const cleaned = parsed.map((u: UserAccount) =>
          u.email?.toLowerCase() === "geogo3@gmail.com" && (u.name === "Georges Matta" || !u.name)
            ? { ...u, name: "Georges Khoury" }
            : u,
        );
        const ids = new Set(cleaned.map((u: UserAccount) => u.id));
        return [...cleaned, ...seedUsers.filter((u) => !ids.has(u.id))];
      }
    }
  } catch {
    // ignore
  }
  return seedUsers;
}

const block = (name: string, minutes: number, notes = ""): PlanBlock => ({
  id: `b-${name.toLowerCase().replace(/\W+/g, "-")}-${minutes}`,
  name,
  minutes,
  notes,
  drawing: null,
});

const seedPlans: Plan[] = [];

export const seedNotifications: AcademyNotification[] = [];

export const defaultLists: Record<string, string[]> = {
  "Age categories": ["U-10", "U-12", "U-14", "U-16", "U-18", "Senior"],
  "Staff positions": ["General Manager", "Technical Director", "Branch Manager", "Accountant"],
  "Coaching levels": ["Level 1", "Level 2", "Level 3", "Level 4"],
  "Coach levels": ["Level 1", "Level 2", "Level 3", "Level 4"],
  "Session types": ["Practice", "Game", "Seminar", "Camp"],
  "Game types": ["Friendly", "Tournament", "League"],
  "Expense accounts": ["Coach payroll", "Court rental", "Merchandise", "Utilities"],
};

export function normalizeLists(
  raw?: Record<string, string[]> | null,
  prev?: Record<string, string[]> | null,
): Record<string, string[]> {
  const source = raw && typeof raw === "object" ? raw : {};
  const result: Record<string, string[]> = {};

  for (const [k, defVal] of Object.entries(defaultLists)) {
    if (Array.isArray(source[k])) {
      result[k] = source[k].filter((item): item is string => typeof item === "string");
    } else if (prev && Array.isArray(prev[k])) {
      result[k] = prev[k];
    } else {
      result[k] = [...defVal];
    }
  }

  for (const [k, v] of Object.entries(source)) {
    if (k === "Packages") continue;
    if (!(k in result) && Array.isArray(v)) {
      result[k] = v.filter((item): item is string => typeof item === "string");
    }
  }

  // Synchronize "Coaching levels" and "Coach levels" bidirectionally
  const rawHasCoaching = Array.isArray(source["Coaching levels"]);
  const rawHasCoach = Array.isArray(source["Coach levels"]);
  if (rawHasCoaching && rawHasCoach) {
    const prevCoaching = prev?.["Coaching levels"];
    const prevCoach = prev?.["Coach levels"];
    if (prevCoaching && !isSliceStructurallyEqual(source["Coaching levels"], prevCoaching)) {
      result["Coach levels"] = [...result["Coaching levels"]];
    } else if (prevCoach && !isSliceStructurallyEqual(source["Coach levels"], prevCoach)) {
      result["Coaching levels"] = [...result["Coach levels"]];
    } else {
      result["Coach levels"] = [...result["Coaching levels"]];
    }
  } else if (rawHasCoaching) {
    result["Coach levels"] = [...result["Coaching levels"]];
  } else if (rawHasCoach) {
    result["Coaching levels"] = [...result["Coach levels"]];
  }

  return result;
}

export const emptyDB = (): DB => ({
  appearance: defaultAppearance,
  academy: {
    name: seedAcademy.name || "Vescio Vector Academy",
    url: seedAcademy.url || "vesciovector.com",
    plan: seedAcademy.plan || "Pro",
    renews: seedAcademy.renews || "Annual",
    playersLimit: 400,
    branchesLimit: 10,
    storageUsed: 0,
    storageLimit: 50,
    sport: "Basketball",
    currency: "USD",
    currencies: ["USD"],
    logo: null,
    supportPhone: "",
    supportEmail: "support@vesciovector.com",
    softDeadline: 7,
    hardDeadline: 30,
    requireGameConfirmation: true,
    autoConfirmGames: false,
    features: [
      "calendar",
      "sessions",
      "players",
      "teams",
      "accounting",
      "merchandise",
      "technical",
      "coach",
      "whatsapp",
    ],
    whatsappTemplates: DEFAULT_WHATSAPP_TEMPLATES,
    insuranceCompanies: DEFAULT_INSURANCE_COMPANIES,
    trainingPackages: DEFAULT_TRAINING_PACKAGES,
    specialOffers: DEFAULT_SPECIAL_OFFERS,
    printingOptions: DEFAULT_PRINTING_OPTIONS,
    protectedSuperAdminEmails: getStoredProtectedSuperAdminEmails(),
    crmSettings: DEFAULT_CRM_SETTINGS,
    assignmentMode: "direct",
  },
  coaches: [],
  players: [],
  teams: [],
  staff: [],
  branches: [],
  sessions: [],
  stock: [],
  suppliers: [],
  orders: [],
  ledger: [],
  invoices: [],
  users: getStoredUsers(),
  plans: [],
  drills: [],
  lists: { ...defaultLists },
  ageCategoryRules: defaultAgeCategoryRules,
  groups: [],
  attendance: {},
  attendanceMeta: {},
  resourceFolders: [],
  workshops: [],
  crmLeads: [],
  courtReservations: [],
  gymMembers: [],
  physioRecords: [],
  posCatalog: DEFAULT_POS_CATALOG,
  posTransactions: [],
  notifications: [],
  customRoles: defaultRoleDefinitions,
});

function isSliceStructurallyEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== "object" || typeof b !== "object") return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!isSliceStructurallyEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (Array.isArray(b)) return false;

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;

  for (let i = 0; i < keysA.length; i++) {
    const key = keysA[i];
    if (!Object.prototype.hasOwnProperty.call(objB, key)) return false;
    if (!isSliceStructurallyEqual(objA[key], objB[key])) return false;
  }

  return true;
}

function createDedupedDBStore(): ReactiveDBStore {
  const store = new ReactiveDBStore(() => emptyDB());
  const originalSetSlice = store.setSlice.bind(store);
  store.setSlice = <K extends keyof DB>(key: K, data: DB[K]) => {
    const current = store.getSlice(key);
    if (isSliceStructurallyEqual(current, data)) {
      return;
    }
    originalSetSlice(key, data);
  };
  return store;
}

export const dbStore = createDedupedDBStore();
export const setDb = (updater: ((prev: DB) => DB) | DB) => {
  if (typeof updater === "function") {
    dbStore.updateDB(updater);
  } else {
    dbStore.setWholeDB(updater);
  }
};

export const blankDB = (): DB => {
  const base = emptyDB();
  return {
    ...base,
    coaches: [],
    players: [],
    teams: [],
    staff: [],
    branches: [],
    sessions: [],
    stock: [],
    suppliers: [],
    orders: [],
    ledger: [],
    invoices: [],
    users: seedUsers,
    plans: [],
    drills: [],
    groups: [],
    notifications: [],
    attendance: {},
    attendanceMeta: {},
    resourceFolders: [],
    workshops: [],
    crmLeads: [],
    courtReservations: [],
    gymMembers: [],
    physioRecords: [],
    posCatalog: DEFAULT_POS_CATALOG,
    posTransactions: [],
    customRoles: defaultRoleDefinitions,
  };
};

export type CollectionKey =
  | "coaches"
  | "players"
  | "teams"
  | "staff"
  | "branches"
  | "sessions"
  | "stock"
  | "suppliers"
  | "orders"
  | "ledger"
  | "invoices"
  | "users"
  | "plans"
  | "drills"
  | "groups"
  | "resourceFolders"
  | "workshops"
  | "crmLeads"
  | "courtReservations"
  | "gymMembers"
  | "physioRecords"
  | "posCatalog"
  | "posTransactions"
  | "notifications"
  | "customRoles";

export interface InvoicingRunOptions {
  branchFilter?: string;
  squadFilter?: string;
  dueDate?: string;
  customDescription?: string;
  excludedPlayerIds?: string[];
  includedPlayerIds?: string[];
  applySiblingDiscounts?: boolean;
  siblingDiscountConfig?: { secondChildPercent: number; thirdPlusChildPercent: number };
  customPlayerRates?: Record<string, number>;
  customRates?: Record<string, number>;
}

export interface InvoicingResult {
  success: boolean;
  billingMonth: string;
  monthCode: string;
  year: number;
  totalEligible: number;
  generatedCount: number;
  skippedCount: number;
  totalAmount: number;
  invoices: Invoice[];
}

export interface SuspensionAuditResult {
  evaluated: number;
  flaggedSoft: number;
  flaggedInactive: number;
  unchanged: number;
  changes: {
    playerId: string;
    playerName: string;
    oldStatus: string;
    newStatus: string;
    daysOverdue: number;
  }[];
}

export type Ctx = {
  db: DB;
  ready: boolean;
  tenantId: string;
  ensureCollection: (key: keyof DB) => void;
  update: (fn: (draft: DB) => DB) => void;
  // Granular atomic Firestore mutations (setDoc / updateDoc / deleteDoc per item):
  setEntity: <K extends CollectionKey>(collectionName: K, item: DB[K][number]) => Promise<void>;
  deleteEntity: <K extends CollectionKey>(collectionName: K, id: string) => Promise<void>;
  patchEntity: <K extends CollectionKey>(
    collectionName: K,
    id: string,
    partial: Partial<DB[K][number]>,
  ) => Promise<void>;
  runBranchArrayTransaction: (
    branchId: string,
    updaterFn: (currentBranch: Branch) => Branch,
    fallbackBranch?: Branch,
  ) => Promise<Branch>;
  cascadeBranchAndCourtRename: (
    params: BranchAndCourtRenameParams,
  ) => Promise<{ updatedRecordsCount: number; branchRecord: Branch }>;
  recordAttendance: (
    sessionId: string,
    playerId: string,
    status: "Present" | "Absent" | "Excused" | "present" | "absent" | "excused",
    timestamp?: string | number | null,
    metadata?: { method?: "qr" | "qr_scan" | "manual"; flag?: string },
  ) => Promise<void>;
  processMerchandiseTransaction: (params: MerchandiseTransactionParams) => Promise<Order>;
  settleMerchandiseOrder: (orderId: string) => Promise<void>;
  generateMonthlyInvoices: (
    billingMonth: string,
    year: number,
    branchFilter?: string,
    options?: InvoicingRunOptions,
  ) => Promise<InvoicingResult>;
  checkOverdueSuspensions: () => Promise<SuspensionAuditResult>;
  triggerServerBillingCron: (monthIndex?: number, year?: number) => Promise<unknown>;
  payInvoice: (invoiceId: string, paymentMethod?: string) => Promise<void>;
  payFamilyBalance: (
    familyPlayerIds: string[],
    totalPaymentAmount: number,
    paymentMethod?: string,
    notes?: string,
  ) => Promise<void>;
  editLedgerTransaction: (entryId: string, updatedFields: Partial<LedgerEntry>) => Promise<void>;
  deleteLedgerTransaction: (entryId: string) => Promise<void>;
  updateAcademy: (partial: Partial<Academy>) => Promise<void>;
  dispatchNotification: (
    notification: Omit<AcademyNotification, "id" | "tenantId"> & { id?: string },
  ) => Promise<AcademyNotification>;
  markNotificationAsRead: (notificationId: string, userId?: string) => Promise<void>;
  markAllNotificationsAsRead: (notificationIds?: string[], userId?: string) => Promise<void>;
  dismissNotification: (notificationId: string, userId?: string) => Promise<void>;
  movePlayerToCrmFollowUp: (
    playerId: string,
    targetStage?: "idle_followup" | "lost_churned",
    options?: { churnReason?: string; reEngagementNotes?: string },
  ) => Promise<void>;
  convertCrmLeadToPlayer: (leadId: string) => Promise<Player | null>;
  runCrmAutoChurnCheck: (options?: { silent?: boolean }) => Promise<number>;
  setPlayerIdleForRenewal: (playerId?: string, idleDate?: string) => Promise<number>;
  resetDemo: () => void;
  clearData: () => void;
  loadDemo: () => void;
  resetWorkspaceData: () => Promise<void>;
};

export interface BranchAndCourtRenameParams {
  branchId: string;
  updatedBranch: Branch;
  oldBranchName?: string;
  newBranchName: string;
  /** Map of oldCourtName -> newCourtName for renamed courts within this branch */
  courtRenames?: Record<string, string>;
  /** List of court names that were removed from this branch */
  removedCourtNames?: string[];
  /** Fallback court name on the branch (e.g., primary court) when a court is removed */
  fallbackCourtName?: string;
}

/**
 * Pure deterministic transformer that cascades a Branch rename and/or Court renames/removals
 * across all referencing collections and embedded branch sub-arrays, returning both the updated
 * DB snapshot and the exact Firestore batch operations needed to persist the cascade.
 */
export function applyBranchAndCourtRenameToDB(
  currentDb: DB,
  params: BranchAndCourtRenameParams,
): {
  nextDb: DB;
  updatedBranchRecord: Branch;
  batchOps: Array<{
    collectionName: string;
    id: string;
    data: Record<string, unknown>;
    merge?: boolean;
  }>;
} {
  const oldB = (params.oldBranchName || "").trim();
  const newB = (params.newBranchName || params.updatedBranch.name || "").trim();
  const branchRenamed = Boolean(oldB && newB && oldB.toLowerCase() !== newB.toLowerCase());

  const courtRenameEntries = Object.entries(params.courtRenames || {}).filter(([oldC, newC]) =>
    Boolean(oldC.trim() && newC.trim() && oldC.trim().toLowerCase() !== newC.trim().toLowerCase()),
  );
  const removedCourtsSet = new Set(
    (params.removedCourtNames || []).map((c) => c.trim().toLowerCase()).filter(Boolean),
  );
  const fallbackCourt = (
    params.fallbackCourtName ||
    params.updatedBranch.courts?.[0]?.name ||
    ""
  ).trim();

  const matchesOldBranch = (val?: string): boolean =>
    branchRenamed && Boolean(val && val.trim().toLowerCase() === oldB.toLowerCase());

  const matchesTargetBranch = (val?: string): boolean => {
    if (!val) return false;
    const lower = val.trim().toLowerCase();
    return (
      (Boolean(oldB) && lower === oldB.toLowerCase()) ||
      (Boolean(newB) && lower === newB.toLowerCase())
    );
  };

  const resolveNextCourtName = (courtVal?: string, recordBranch?: string): string | undefined => {
    if (!courtVal || !matchesTargetBranch(recordBranch)) return courtVal;
    const trimmed = courtVal.trim();
    const lower = trimmed.toLowerCase();
    for (const [oldC, newC] of courtRenameEntries) {
      if (lower === oldC.trim().toLowerCase()) {
        return newC.trim();
      }
    }
    if (removedCourtsSet.has(lower) && fallbackCourt) {
      return fallbackCourt;
    }
    return courtVal;
  };

  // 1. Update embedded branch sub-arrays on updatedBranch
  let branchRec: Branch = {
    ...params.updatedBranch,
    name: newB || params.updatedBranch.name,
  };
  if (branchRenamed) {
    if (Array.isArray(branchRec.gymBookings)) {
      branchRec = {
        ...branchRec,
        gymBookings: branchRec.gymBookings.map((b) =>
          matchesOldBranch(b.branch) ? { ...b, branch: newB } : b,
        ),
      };
    }
    if (Array.isArray(branchRec.physioAppointments)) {
      branchRec = {
        ...branchRec,
        physioAppointments: branchRec.physioAppointments.map((a) =>
          matchesOldBranch(a.branch) ? { ...a, branch: newB } : a,
        ),
      };
    }
    if (Array.isArray(branchRec.posShifts)) {
      branchRec = {
        ...branchRec,
        posShifts: branchRec.posShifts.map((s) =>
          matchesOldBranch(s.branch) ? { ...s, branch: newB } : s,
        ),
      };
    }
    if (Array.isArray(branchRec.posInventoryLogs)) {
      branchRec = {
        ...branchRec,
        posInventoryLogs: branchRec.posInventoryLogs.map((l) =>
          matchesOldBranch(l.branch) ? { ...l, branch: newB } : l,
        ),
      };
    }
    if (Array.isArray(branchRec.posHeldOrders)) {
      branchRec = {
        ...branchRec,
        posHeldOrders: branchRec.posHeldOrders.map((h) =>
          matchesOldBranch(h.branch) ? { ...h, branch: newB } : h,
        ),
      };
    }
  }
  branchRec = capBranchSubArrays(
    branchRec as unknown as Record<string, unknown>,
  ) as unknown as Branch;

  const batchOps: Array<{
    collectionName: string;
    id: string;
    data: Record<string, unknown>;
    merge?: boolean;
  }> = [
    {
      collectionName: "branches",
      id: branchRec.id,
      data: branchRec as unknown as Record<string, unknown>,
      merge: true,
    },
  ];

  const existingBranches = currentDb.branches || [];
  const hasBranch = existingBranches.some((b) => b.id === branchRec.id);
  const nextBranches = hasBranch
    ? existingBranches.map((b) => (b.id === branchRec.id ? branchRec : b))
    : [branchRec, ...existingBranches];

  // Helper for simple branch-field collections
  const cascadeSimpleBranchSlice = <T extends { id: string; branch?: string }>(
    collectionName: string,
    items: T[] | undefined,
  ): T[] => {
    const list = items || [];
    if (!branchRenamed) return list;
    return list.map((item) => {
      if (matchesOldBranch(item.branch)) {
        const updated = { ...item, branch: newB };
        batchOps.push({
          collectionName,
          id: item.id,
          data: { id: item.id, branch: newB },
          merge: true,
        });
        return updated;
      }
      return item;
    });
  };

  const nextPlayers = cascadeSimpleBranchSlice("players", currentDb.players);
  const nextTeams = cascadeSimpleBranchSlice("teams", currentDb.teams);
  const nextPhysioRecords = cascadeSimpleBranchSlice("physioRecords", currentDb.physioRecords);
  const nextPosCatalog = cascadeSimpleBranchSlice("posCatalog", currentDb.posCatalog);
  const nextPosTransactions = cascadeSimpleBranchSlice(
    "posTransactions",
    currentDb.posTransactions,
  );
  const nextLedger = cascadeSimpleBranchSlice("ledger", currentDb.ledger);
  const nextStock = cascadeSimpleBranchSlice("stock", currentDb.stock);
  const nextOrders = cascadeSimpleBranchSlice("orders", currentDb.orders);
  const nextInvoices = cascadeSimpleBranchSlice("invoices", currentDb.invoices);

  // GymMembers: branch field + checkInHistory[].branch
  const nextGymMembers = (currentDb.gymMembers || []).map((m) => {
    if (!branchRenamed) return m;
    const topMatches = matchesOldBranch(m.branch);
    const historyMatches =
      Array.isArray(m.checkInHistory) && m.checkInHistory.some((c) => matchesOldBranch(c.branch));
    if (!topMatches && !historyMatches) return m;
    const nextHistory = Array.isArray(m.checkInHistory)
      ? m.checkInHistory.map((c) => (matchesOldBranch(c.branch) ? { ...c, branch: newB } : c))
      : m.checkInHistory;
    const updated: GymMember = {
      ...m,
      ...(topMatches ? { branch: newB } : {}),
      ...(historyMatches ? { checkInHistory: nextHistory } : {}),
    };
    batchOps.push({
      collectionName: "gymMembers",
      id: m.id,
      data: {
        id: m.id,
        ...(topMatches ? { branch: newB } : {}),
        ...(historyMatches ? { checkInHistory: nextHistory } : {}),
      },
      merge: true,
    });
    return updated;
  });

  // Sessions: branch field + court field
  const nextSessions = (currentDb.sessions || []).map((s) => {
    const bChanged = matchesOldBranch(s.branch);
    const resolvedCourt = resolveNextCourtName(s.court, s.branch);
    const cChanged = resolvedCourt !== undefined && resolvedCourt !== s.court;
    if (!bChanged && !cChanged) return s;
    const updated: SessionItem = {
      ...s,
      ...(bChanged ? { branch: newB } : {}),
      ...(cChanged && resolvedCourt ? { court: resolvedCourt } : {}),
    };
    batchOps.push({
      collectionName: "sessions",
      id: s.id,
      data: {
        id: s.id,
        ...(bChanged ? { branch: newB } : {}),
        ...(cChanged && resolvedCourt ? { court: resolvedCourt } : {}),
      },
      merge: true,
    });
    return updated;
  });

  // CourtReservations (including recurring templates & continuous seeds): branch field + court field
  const nextCourtReservations = (currentDb.courtReservations || []).map((r) => {
    const bChanged = matchesOldBranch(r.branch);
    const resolvedCourt = resolveNextCourtName(r.court, r.branch);
    const cChanged = resolvedCourt !== undefined && resolvedCourt !== r.court;
    if (!bChanged && !cChanged) return r;
    const updated: CourtReservation = {
      ...r,
      ...(bChanged ? { branch: newB } : {}),
      ...(cChanged && resolvedCourt ? { court: resolvedCourt } : {}),
    };
    batchOps.push({
      collectionName: "courtReservations",
      id: r.id,
      data: {
        id: r.id,
        ...(bChanged ? { branch: newB } : {}),
        ...(cChanged && resolvedCourt ? { court: resolvedCourt } : {}),
      },
      merge: true,
    });
    return updated;
  });

  // Staff & Coaches: branch + branches[]
  const cascadeMultiBranchSlice = <T extends { id: string; branch?: string; branches?: string[] }>(
    collectionName: string,
    items: T[] | undefined,
  ): T[] => {
    const list = items || [];
    if (!branchRenamed) return list;
    return list.map((item) => {
      const primaryMatches = matchesOldBranch(item.branch);
      const arrayMatches =
        Array.isArray(item.branches) && item.branches.some((b) => matchesOldBranch(b));
      if (!primaryMatches && !arrayMatches) return item;
      const nextBranchesArr = Array.isArray(item.branches)
        ? item.branches.map((b) => (matchesOldBranch(b) ? newB : b))
        : item.branches;
      const updated: T = {
        ...item,
        ...(primaryMatches ? { branch: newB } : {}),
        ...(arrayMatches ? { branches: nextBranchesArr } : {}),
      };
      batchOps.push({
        collectionName,
        id: item.id,
        data: {
          id: item.id,
          ...(primaryMatches ? { branch: newB } : {}),
          ...(arrayMatches ? { branches: nextBranchesArr } : {}),
        },
        merge: true,
      });
      return updated;
    });
  };

  const nextStaff = cascadeMultiBranchSlice("staff", currentDb.staff);
  const nextCoaches = cascadeMultiBranchSlice("coaches", currentDb.coaches);

  const nextDb: DB = {
    ...currentDb,
    branches: nextBranches,
    players: nextPlayers,
    teams: nextTeams,
    sessions: nextSessions,
    courtReservations: nextCourtReservations,
    gymMembers: nextGymMembers,
    physioRecords: nextPhysioRecords,
    posCatalog: nextPosCatalog,
    posTransactions: nextPosTransactions,
    ledger: nextLedger,
    staff: nextStaff,
    coaches: nextCoaches,
    stock: nextStock,
    orders: nextOrders,
    invoices: nextInvoices,
  };

  return {
    nextDb,
    updatedBranchRecord: branchRec,
    batchOps,
  };
}

/**
 * Pure deterministic evaluator for monthly cycle renewal Idle state initialization.
 * Every eligible active player starts the new monthly cycle in `Idle` with `idleSinceDate`
 * and `missedSessionsSinceIdle = 0` unless they have already paid or attended in the target month.
 */
export function evaluateMonthlyIdleCycleRenewal(params: {
  players: Player[];
  sessions: SessionItem[];
  attendance: Record<string, Record<string, string>>;
  invoices: Invoice[];
  targetYm: string;
  renewalDate: string;
}): {
  updatedPlayers: Player[];
  transitionedToIdleIds: string[];
  keptActiveIds: string[];
} {
  const { players, sessions, attendance, invoices, targetYm, renewalDate } = params;
  const transitionedToIdleIds: string[] = [];
  const keptActiveIds: string[] = [];

  const updatedPlayers = players.map((p) => {
    if (p.isScholarship === true || (p.status !== "Active" && p.status !== "Idle")) {
      return p;
    }

    const attendedInNewMonth =
      getPlayerMonthlyPresentCount(p.id, sessions, attendance, targetYm) > 0;
    const paidInNewMonth =
      invoices.some((inv) => {
        if (inv.playerId !== p.id || inv.status !== "paid") return false;
        const invYm = `${inv.year}-${String(inv.month).padStart(2, "0")}`;
        return invYm >= targetYm || Boolean(inv.paidDate && inv.paidDate >= `${targetYm}-01`);
      }) ||
      (Array.isArray(p.payments) &&
        p.payments.some((pmt) => pmt.date?.startsWith(targetYm) && pmt.amount > 0));

    if (attendedInNewMonth || paidInNewMonth) {
      keptActiveIds.push(p.id);
      return {
        ...p,
        status: "Active" as const,
        idleSinceDate: "",
        missedSessionsSinceIdle: 0,
        idleMissedSessionIds: [],
      };
    }

    transitionedToIdleIds.push(p.id);
    return {
      ...p,
      status: "Idle" as const,
      idleSinceDate: p.status === "Idle" && p.idleSinceDate ? p.idleSinceDate : renewalDate,
      missedSessionsSinceIdle: p.status === "Idle" ? Number(p.missedSessionsSinceIdle) || 0 : 0,
      idleMissedSessionIds:
        p.status === "Idle" && Array.isArray(p.idleMissedSessionIds) ? p.idleMissedSessionIds : [],
    };
  });

  return {
    updatedPlayers,
    transitionedToIdleIds,
    keptActiveIds,
  };
}

/**
 * Pure deterministic evaluator for completed team session Idle tracking & 3-session alert engine.
 * - Increments `missedSessionsSinceIdle` on each completed team session while the player is `Idle`
 *   without payment or attendance (idempotent per session ID via `idleMissedSessionIds`).
 * - Fires an alert on every 3rd missed session (`missedSessionsSinceIdle % 3 === 0`, i.e. 3, 6, 9...).
 * - Immediately reactivates the player to `Active` and resets `missedSessionsSinceIdle = 0` and
 *   `idleSinceDate = ""` on payment or first `Present` attendance of the new cycle.
 */
export function evaluateIdleSessionCompletionAndAlerts(params: {
  completedSession: SessionItem;
  players: Player[];
  teams?: Team[];
  attendance?: Record<string, Record<string, string>>;
  invoices?: Invoice[];
}): {
  updatedPlayers: Player[];
  updatedPlayerMap: Map<string, Partial<Player>>;
  alerts: Array<{
    player: Player;
    missedCount: number;
    idleSince: string;
    message: string;
  }>;
  reactivatedPlayerIds: string[];
} {
  const { completedSession, players, teams = [], attendance = {}, invoices = [] } = params;

  const updatedPlayerMap = new Map<string, Partial<Player>>();
  const alerts: Array<{
    player: Player;
    missedCount: number;
    idleSince: string;
    message: string;
  }> = [];
  const reactivatedPlayerIds: string[] = [];

  if (!completedSession || (completedSession.status || "").toLowerCase() !== "completed") {
    return { updatedPlayers: players, updatedPlayerMap, alerts, reactivatedPlayerIds };
  }

  const sessionTeams = new Set<string>();
  const addTeamName = (val?: string | null) => {
    if (val && val.trim()) sessionTeams.add(val.trim().toLowerCase());
  };
  addTeamName(completedSession.team);
  addTeamName(completedSession.teamA);
  addTeamName(completedSession.teamB);

  if (sessionTeams.size === 0 && completedSession.title) {
    const titleLower = completedSession.title.toLowerCase();
    teams.forEach((t) => {
      if (t.name && titleLower.includes(t.name.toLowerCase().trim())) {
        sessionTeams.add(t.name.toLowerCase().trim());
      }
    });
  }

  if (sessionTeams.size === 0) {
    return { updatedPlayers: players, updatedPlayerMap, alerts, reactivatedPlayerIds };
  }

  const sessionAttendanceMap = attendance[completedSession.id] || {};
  const sessionAttendeesSet = new Set(completedSession.attendees || []);
  const sessionDate = completedSession.date || new Date().toISOString().slice(0, 10);
  const sessionYm = sessionDate.slice(0, 7);

  for (const p of players) {
    if (p.status !== "Idle") continue;
    const playerTeams = p.teams || [];
    if (!playerTeams.some((t) => sessionTeams.has(t.toLowerCase().trim()))) continue;

    const rawAttStatus = sessionAttendanceMap[p.id];
    const attendedPresent =
      (typeof rawAttStatus === "string" && rawAttStatus.toLowerCase() === "present") ||
      sessionAttendeesSet.has(p.id);
    const idleSince = p.idleSinceDate || sessionDate;

    const hasPaidForCycle =
      invoices.some((inv) => {
        if (inv.playerId !== p.id || inv.status !== "paid") return false;
        const invYm = `${inv.year}-${String(inv.month).padStart(2, "0")}`;
        return invYm >= sessionYm || Boolean(inv.paidDate && inv.paidDate >= idleSince);
      }) ||
      (Array.isArray(p.payments) &&
        p.payments.some((pmt) => Boolean(pmt.date && pmt.date >= idleSince) && pmt.amount > 0));

    if (attendedPresent || hasPaidForCycle) {
      updatedPlayerMap.set(p.id, {
        status: "Active",
        missedSessionsSinceIdle: 0,
        idleSinceDate: "",
        idleMissedSessionIds: [],
      });
      reactivatedPlayerIds.push(p.id);
      continue;
    }

    const alreadyCountedIds = Array.isArray(p.idleMissedSessionIds) ? p.idleMissedSessionIds : [];
    if (alreadyCountedIds.includes(completedSession.id)) {
      continue;
    }

    const nextMissed = (Number(p.missedSessionsSinceIdle) || 0) + 1;
    const nextMissedIds = [...alreadyCountedIds, completedSession.id];

    updatedPlayerMap.set(p.id, {
      status: "Idle",
      idleSinceDate: idleSince,
      missedSessionsSinceIdle: nextMissed,
      idleMissedSessionIds: nextMissedIds,
    });

    if (nextMissed > 0 && nextMissed % 3 === 0) {
      alerts.push({
        player: p,
        missedCount: nextMissed,
        idleSince,
        message: `${p.name} has missed ${nextMissed} sessions while Idle since ${idleSince} without payment or attendance.`,
      });
    }
  }

  const updatedPlayers = players.map((p) => {
    const patch = updatedPlayerMap.get(p.id);
    return patch ? { ...p, ...patch } : p;
  });

  return {
    updatedPlayers,
    updatedPlayerMap,
    alerts,
    reactivatedPlayerIds,
  };
}

/**
 * Pure deterministic evaluator for CRM Auto-Churn date calculation.
 * Evaluates `1_month` (30 days) vs `custom_weeks` (weeks * 7 days) strictly using
 * session attendance and invoice/payment dates ON OR AFTER `idleSinceDate`.
 */
export function evaluateCrmAutoChurnCandidates(params: {
  players: Player[];
  crmSettings: CrmSettings;
  sessions?: SessionItem[];
  attendance?: Record<string, Record<string, string>>;
  invoices?: Invoice[];
  crmLeads?: CrmLead[];
  referenceDateIso?: string;
}): {
  thresholdDays: number;
  thresholdLabel: string;
  churnCandidates: Array<{
    player: Player;
    daysIdle: number;
    churnReason: string;
  }>;
} {
  const {
    players,
    crmSettings,
    sessions = [],
    attendance = {},
    invoices = [],
    crmLeads = [],
    referenceDateIso,
  } = params;

  const thresholdDays =
    crmSettings.autoChurnMode === "1_month"
      ? 30
      : Math.max(1, Number(crmSettings.autoChurnWeeks) || 4) * 7;

  const thresholdLabel =
    crmSettings.autoChurnMode === "1_month"
      ? "1 Month (30 days)"
      : `${crmSettings.autoChurnWeeks} Weeks (${thresholdDays} days)`;

  if (!crmSettings.autoChurnEnabled) {
    return { thresholdDays, thresholdLabel, churnCandidates: [] };
  }

  const nowMs = referenceDateIso ? new Date(referenceDateIso).getTime() : Date.now();
  const churnCandidates: Array<{
    player: Player;
    daysIdle: number;
    churnReason: string;
  }> = [];

  for (const p of players) {
    if (p.status !== "Idle" || !p.idleSinceDate) continue;
    const idleStartMs = new Date(p.idleSinceDate).getTime();
    if (Number.isNaN(idleStartMs)) continue;

    const daysIdle = Math.floor((nowMs - idleStartMs) / (1000 * 60 * 60 * 24));
    if (daysIdle < thresholdDays) continue;

    const attendedSinceIdle = sessions.some((s) => {
      if (!s || (s.status || "").toLowerCase() === "cancelled") return false;
      if (!s.date || s.date < p.idleSinceDate!) return false;
      const mapForSess = attendance[s.id];
      const recStatus = mapForSess?.[p.id];
      if (typeof recStatus === "string") {
        return recStatus.toLowerCase() === "present";
      }
      return Array.isArray(s.attendees) && s.attendees.includes(p.id);
    });

    const paidSinceIdle =
      invoices.some((inv) => {
        if (inv.playerId !== p.id || inv.status !== "paid") return false;
        return Boolean(inv.paidDate && inv.paidDate >= p.idleSinceDate!);
      }) ||
      (Array.isArray(p.payments) &&
        p.payments.some(
          (pmt) => Boolean(pmt.date && pmt.date >= p.idleSinceDate!) && pmt.amount > 0,
        ));

    if (attendedSinceIdle || paidSinceIdle) continue;

    const existingLead = crmLeads.find((l) => l.linkedPlayerId === p.id);
    if (existingLead && existingLead.stage === "lost_churned") continue;

    churnCandidates.push({
      player: p,
      daysIdle,
      churnReason: `Auto-Churned: Idle since ${p.idleSinceDate} (${daysIdle} days > ${thresholdLabel} threshold without payment or attendance)`,
    });
  }

  return {
    thresholdDays,
    thresholdLabel,
    churnCandidates,
  };
}

export {
  getTenantSlug,
  MAX_BRANCH_LOG_ENTRIES,
  capBranchSubArrays,
  atomicRunBranchTransaction,
  atomicBookCourtReservationTransaction,
  atomicBookPhysioAppointmentTransaction,
  atomicCompletePosSaleTransaction,
  atomicGymCheckInTransaction,
  atomicBatchSaveEntities,
};

/**
 * Historical Query Bounds:
 * Restricts real-time onSnapshot listeners on high-growth collections to prevent unbounded memory growth.
 * By default bounds queries to the active season or 90-day sliding window.
 */
export const HISTORICAL_QUERY_WINDOW_DAYS = 90;

export const HISTORICAL_BOUNDED_COLLECTIONS: ReadonlySet<keyof DB> = new Set([
  "ledger",
  "sessions",
  "posTransactions",
  "courtReservations",
]);

export function getHistoricalQueryBoundary(
  windowDays: number = HISTORICAL_QUERY_WINDOW_DAYS,
): string {
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000);

  // Active season start: in sports academies, seasons encompass the current athletic cycle
  // (e.g. starting around May 1st for current season or rolling 90 days).
  const currentYear = now.getFullYear();
  const seasonStartDate = new Date(currentYear, 4, 1); // 2026-05-01 (May 1st)

  // Use the earlier boundary to ensure active season entries (e.g., fixtures and ledger)
  // are included while unbounded historical archives (>1 season ago) do not bloat memory.
  const boundary =
    ninetyDaysAgo.getTime() < seasonStartDate.getTime() ? ninetyDaysAgo : seasonStartDate;

  return boundary.toISOString().slice(0, 10);
}

/**
 * One-time fetch for historical ledger records older than the active real-time query bound.
 * Avoids attaching permanent real-time snapshot listeners.
 */
export async function fetchHistoricalLedger(
  tenantId: string,
  beforeDate?: string,
): Promise<LedgerEntry[]> {
  try {
    const boundary = beforeDate || getHistoricalQueryBoundary();
    const q = query(
      collection(firestore, "tenants", tenantId, "ledger"),
      where("date", "<", boundary),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as LedgerEntry);
  } catch {
    return [];
  }
}

/**
 * One-time fetch for historical session records older than the active real-time query bound.
 * Avoids attaching permanent real-time snapshot listeners.
 */
export async function fetchHistoricalSessions(
  tenantId: string,
  beforeDate?: string,
): Promise<SessionItem[]> {
  try {
    const boundary = beforeDate || getHistoricalQueryBoundary();
    const q = query(
      collection(firestore, "tenants", tenantId, "sessions"),
      where("date", "<", boundary),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as SessionItem);
  } catch {
    return [];
  }
}

const lastSyncedUsernameMapByTenant = new Map<string, string>();

export type ActiveRoleAccessContext = {
  role?: string | null;
  email?: string | null;
  permissions?: Record<string, PermissionPower> | null;
};

let activeRoleAccessContext: ActiveRoleAccessContext = {};

export function setActiveRoleAccessContext(ctx: ActiveRoleAccessContext) {
  activeRoleAccessContext = ctx;
}

export const SENSITIVE_ROLE_GATED_COLLECTIONS: ReadonlySet<CollectionKey> = new Set([
  "physioRecords",
  "ledger",
  "staff",
  "posTransactions",
]);

function resolveEffectiveUserAccess(ctxOverride?: ActiveRoleAccessContext): {
  role: string;
  email: string;
  permissions: Record<string, PermissionPower> | undefined;
  isAdmin: boolean;
} {
  const ctx = ctxOverride || activeRoleAccessContext;
  const email = (ctx.email || auth?.currentUser?.email || "").trim().toLowerCase();
  let role = (ctx.role || "").trim();
  let permissions = ctx.permissions || undefined;

  if (!role && (email || auth?.currentUser?.uid)) {
    const usersSlice = (dbStore.getSlice("users") as UserAccount[]) || [];
    const uid = auth?.currentUser?.uid;
    const matched = usersSlice.find(
      (u) =>
        (uid && (u.id === uid || u.authUid === uid)) ||
        (email && u.email && u.email.trim().toLowerCase() === email),
    );
    if (matched) {
      role = matched.role || "";
      permissions =
        permissions ||
        (matched as UserAccount & { permissions?: Record<string, PermissionPower> }).permissions;
    }
  }

  const isAdmin = isTenantAdminRoleOrEmail(role, email);
  if (!permissions && role) {
    const rolesList =
      (dbStore.getSlice("customRoles") as RoleDefinition[]) || defaultRoleDefinitions;
    const roleLower = normalizeUiRole(role).trim().toLowerCase();
    const roleDef =
      rolesList.find((r) => r.name.trim().toLowerCase() === roleLower) ||
      defaultRoleDefinitions.find((r) => r.name.trim().toLowerCase() === roleLower);
    permissions = roleDef?.permissions;
  }

  return { role, email, permissions, isAdmin };
}

export function canUserAccessCollection(
  key: keyof DB,
  ctxOverride?: ActiveRoleAccessContext,
): boolean {
  if (!SENSITIVE_ROLE_GATED_COLLECTIONS.has(key as CollectionKey)) {
    return true;
  }
  const { role, permissions, isAdmin } = resolveEffectiveUserAccess(ctxOverride);
  if (isAdmin) return true;

  const roleLower = (role || "").trim().toLowerCase().replace(/_/g, " ");
  if (!roleLower) return false;

  if (key === "physioRecords") {
    return [
      "super admin",
      "academy manager",
      "branch manager",
      "physiotherapist",
      "doctor",
      "medical",
    ].includes(roleLower);
  }

  if (key === "ledger") {
    return (
      ["super admin", "academy manager", "accountant", "branch manager"].includes(roleLower) ||
      Boolean(permissions?.accounting?.read)
    );
  }

  if (key === "posTransactions") {
    return (
      ["super admin", "academy manager", "accountant", "branch manager"].includes(roleLower) ||
      Boolean(permissions?.accounting?.read || permissions?.merchandise?.read)
    );
  }

  if (key === "staff") {
    return (
      [
        "super admin",
        "academy manager",
        "branch manager",
        "technical director",
        "accountant",
      ].includes(roleLower) || Boolean(permissions?.staff?.read)
    );
  }

  return true;
}

export function canUserViewStaffSalary(ctxOverride?: ActiveRoleAccessContext): boolean {
  const { role, permissions, isAdmin } = resolveEffectiveUserAccess(ctxOverride);
  if (isAdmin) return true;
  const roleLower = (role || "").trim().toLowerCase().replace(/_/g, " ");
  if (!roleLower) return false;
  return (
    ["super admin", "academy manager", "accountant"].includes(roleLower) ||
    Boolean(permissions?.accounting?.read)
  );
}

async function ensureAuthForWrite(): Promise<boolean> {
  if (auth?.currentUser && !auth.currentUser.isAnonymous) return true;
  if (isE2EBypassEnabled()) return false;
  const waitedUser = await new Promise<{ isAnonymous?: boolean } | null>((resolve) => {
    if (!auth) return resolve(null);
    if (auth.currentUser && !auth.currentUser.isAnonymous) return resolve(auth.currentUser);
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        unsub();
        resolve(auth.currentUser);
      }
    }, 2500);
    const unsub = auth.onAuthStateChanged((u) => {
      if (u && !u.isAnonymous && !settled) {
        settled = true;
        clearTimeout(timer);
        unsub();
        resolve(u);
      }
    });
  });
  return Boolean(
    (waitedUser && !waitedUser.isAnonymous) || (auth?.currentUser && !auth.currentUser.isAnonymous),
  );
}

/**
 * Lazy & Eager Subscription Manager:
 * Opens real-time Firestore onSnapshot listeners per collection and skips redundant
 * emissions when incoming snapshots are structurally identical to the active store slice.
 */
export function ensureCollectionSubscribed(key: keyof DB, tenantId: string) {
  if (!tenantId) return;
  if (!auth?.currentUser || auth.currentUser.isAnonymous) return;

  // Non-collection singletons: managed by dedicated eager listeners or root tenant doc
  if (key === "academy" || key === "appearance" || key === "lists" || key === "ageCategoryRules") {
    return;
  }

  // Gate sensitive collections by signed-in user role/permissions so unauthorized roles
  // do not preload or retain restricted records in client state (skip destructive cache wipe in rba-demo sandbox).
  if (SENSITIVE_ROLE_GATED_COLLECTIONS.has(key as CollectionKey) && !canUserAccessCollection(key)) {
    if (dbStore.isSubscribed(key)) {
      dbStore.unregisterSubscription(key);
    }
    dbStore.markHydrated(key);
    if (tenantId !== "rba-demo") {
      const prevRestricted = dbStore.getSlice(key);
      if (Array.isArray(prevRestricted) && prevRestricted.length > 0) {
        dbStore.setSlice(key, [] as unknown as DB[typeof key]);
      }
    }
    return;
  }

  // attendanceMeta is populated directly by the attendance collection listener
  if (key === "attendanceMeta") {
    ensureCollectionSubscribed("attendance", tenantId);
    return;
  }

  if (dbStore.isSubscribed(key)) return;

  if (key === "attendance") {
    const attQ = collection(firestore, "tenants", tenantId, "attendance");
    const unsubAtt = onSnapshot(
      attQ,
      (snapshot) => {
        const att: Record<string, Record<string, "Present" | "Absent" | "Excused">> = {};
        const attMeta: Record<
          string,
          Record<
            string,
            {
              timestamp: string;
              method?: "qr" | "manual";
              flag?: "low_attendance_warning" | string;
            }
          >
        > = {};
        snapshot.docs.forEach((d) => {
          const data = d.data();
          att[d.id] = data.records || {};
          if (data.detailedRecords) {
            attMeta[d.id] = data.detailedRecords;
          }
        });
        dbStore.markHydrated("attendance");
        dbStore.markHydrated("attendanceMeta");
        const prevAtt = dbStore.getSlice("attendance");
        const preserveRbaSeededAtt =
          tenantId === "rba-demo" &&
          snapshot.empty &&
          typeof window !== "undefined" &&
          window.localStorage.getItem("vv_rba_demo_seeded") === "true" &&
          prevAtt &&
          Object.keys(prevAtt).length > 0;
        if (!preserveRbaSeededAtt && !isSliceStructurallyEqual(prevAtt, att)) {
          dbStore.setSlice("attendance", att);
        }
        const mergedMeta = {
          ...(dbStore.getSlice("attendanceMeta") || {}),
          ...attMeta,
        };
        const prevMeta = dbStore.getSlice("attendanceMeta");
        if (!isSliceStructurallyEqual(prevMeta, mergedMeta)) {
          dbStore.setSlice("attendanceMeta", mergedMeta);
        }
      },
      (err) => {
        console.warn("Firestore attendance listener notice (graceful empty state active):", err);
        dbStore.markHydrated("attendance");
        dbStore.markHydrated("attendanceMeta");
        const prevAtt = dbStore.getSlice("attendance");
        if (!prevAtt) {
          dbStore.setSlice("attendance", {});
        }
        const prevMeta = dbStore.getSlice("attendanceMeta");
        if (!prevMeta) {
          dbStore.setSlice("attendanceMeta", {});
        }
        dbStore.unregisterSubscription("attendance");
        if (typeof window !== "undefined") {
          setTimeout(() => {
            if (auth?.currentUser && !dbStore.isSubscribed("attendance")) {
              ensureCollectionSubscribed("attendance", tenantId);
            }
          }, 3000);
        }
      },
    );
    dbStore.registerSubscription("attendance", unsubAtt);
    return;
  }

  let q;
  if (HISTORICAL_BOUNDED_COLLECTIONS.has(key)) {
    const boundaryDate = getHistoricalQueryBoundary(HISTORICAL_QUERY_WINDOW_DAYS);
    q = query(collection(firestore, "tenants", tenantId, key), where("date", ">=", boundaryDate));
  } else if (key === "notifications") {
    q = query(collection(firestore, "tenants", tenantId, key), limit(100));
  } else {
    q = collection(firestore, "tenants", tenantId, key);
  }

  const unsub = onSnapshot(
    q,
    (snapshot) => {
      dbStore.markHydrated(key);
      let items = snapshot.docs.map((d) => cleanIncomingFirestoreData(d.data()));
      if (key === "notifications") {
        // Filter out false-positive staging "Auto Error Alert" notifications for permission-denied
        const staleErrorNotifIds: string[] = [];
        items = (items as AcademyNotification[]).filter((n) => {
          const isFalsePositivePermAlert =
            typeof n?.title === "string" &&
            n.title.includes("Auto Error Alert") &&
            typeof n?.message === "string" &&
            (n.message.includes("Missing or insufficient permissions") ||
              n.message.includes("permission-denied"));
          if (isFalsePositivePermAlert && n.id) {
            staleErrorNotifIds.push(n.id);
            return false;
          }
          return true;
        });
        for (const staleId of staleErrorNotifIds) {
          deleteDoc(doc(firestore, "tenants", tenantId, "notifications", staleId)).catch(() => {});
        }
        items = (items as AcademyNotification[])
          .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
          .slice(0, 100);
        if (snapshot.empty && seedNotifications.length) {
          seedNotifications.forEach((n) => {
            dispatchAcademyNotification(tenantId, n).catch(() => {});
          });
        }
      }
      if (key === "customRoles" && snapshot.empty) {
        const currentRoles = dbStore.getSlice("customRoles");
        const nextRoles =
          currentRoles && currentRoles.length > 0 ? currentRoles : defaultRoleDefinitions;
        if (!isSliceStructurallyEqual(currentRoles, nextRoles)) {
          dbStore.setSlice("customRoles", nextRoles);
        }
        return;
      }
      if (key === "posCatalog" && snapshot.empty) {
        const currentCat = dbStore.getSlice("posCatalog");
        const nextCat = currentCat && currentCat.length > 0 ? currentCat : DEFAULT_POS_CATALOG;
        if (!isSliceStructurallyEqual(currentCat, nextCat)) {
          dbStore.setSlice("posCatalog", nextCat);
        }
        return;
      }
      if (key === "coaches" && items.length > 0) {
        items = (items as Record<string, unknown>[]).map((c) => {
          const cleanCoach = { ...c };
          delete cleanCoach.password;
          delete cleanCoach.passwordHash;
          return cleanCoach;
        });
      }
      if (key === "staff" && items.length > 0 && !canUserViewStaffSalary()) {
        items = (items as Staff[]).map((s) => ({
          ...s,
          salary: 0,
        }));
      }
      if (key === "users" && items.length > 0) {
        items = (items as UserAccount[]).map((u) => {
          const cleanUser = {
            ...u,
            role: normalizeUiRole(u.role),
          };
          delete (cleanUser as Record<string, unknown>).password;
          delete (cleanUser as Record<string, unknown>).passwordHash;
          return cleanUser;
        });
        const { isAdmin } = resolveEffectiveUserAccess();
        if (isAdmin) {
          const usernameMap: Record<string, string> = {};
          for (const u of items as UserAccount[]) {
            const emailLower = u.email?.trim().toLowerCase();
            if (emailLower && u.active !== false) {
              const unameLower = (u.username || emailLower.split("@")[0] || "")
                .trim()
                .toLowerCase();
              if (unameLower) {
                usernameMap[unameLower] = emailLower;
              }
              const emailPrefix = emailLower.split("@")[0]?.trim().toLowerCase();
              if (emailPrefix && !usernameMap[emailPrefix]) {
                usernameMap[emailPrefix] = emailLower;
              }
            }
          }
          if (Object.keys(usernameMap).length > 0) {
            const serializedMap = JSON.stringify(usernameMap);
            if (lastSyncedUsernameMapByTenant.get(tenantId) !== serializedMap) {
              lastSyncedUsernameMapByTenant.set(tenantId, serializedMap);
              setDoc(
                doc(firestore, "tenants", tenantId, "public", "auth_lookup"),
                { usernameMap },
                { merge: true },
              ).catch(() => {});
            }
          }
        }
      }

      const prevSlice = dbStore.getSlice(key);
      const preserveRbaSeededSlice =
        tenantId === "rba-demo" &&
        snapshot.empty &&
        typeof window !== "undefined" &&
        window.localStorage.getItem("vv_rba_demo_seeded") === "true" &&
        Array.isArray(prevSlice) &&
        prevSlice.length > 0;
      if (!preserveRbaSeededSlice && !isSliceStructurallyEqual(prevSlice, items)) {
        dbStore.setSlice(key, items as unknown as DB[typeof key]);
      }
    },
    (err) => {
      console.warn(`Firestore listener notice for ${key} (graceful empty state active):`, err);
      dbStore.markHydrated(key);
      const currentSlice = dbStore.getSlice(key);
      if (!currentSlice) {
        const fallback =
          key === "customRoles"
            ? defaultRoleDefinitions
            : key === "posCatalog"
              ? DEFAULT_POS_CATALOG
              : key === "users"
                ? getStoredUsers()
                : ([] as unknown as DB[typeof key]);
        dbStore.setSlice(key, fallback as DB[typeof key]);
      }
      dbStore.unregisterSubscription(key);
      if (typeof window !== "undefined") {
        setTimeout(() => {
          if (auth?.currentUser && !dbStore.isSubscribed(key)) {
            ensureCollectionSubscribed(key, tenantId);
          }
        }, 3000);
      }
    },
  );
  dbStore.registerSubscription(key, unsub);
}

type DataActionsCtxValue = {
  tenantId: string;
  ready: boolean;
  ensureCollection: (key: keyof DB) => void;
  update: (fn: (draft: DB) => DB) => void;
};

const g = globalThis as unknown as {
  __vvDataCtx?: Context<Ctx | null>;
  __vvDataActionsCtx?: Context<DataActionsCtxValue | null>;
};
const DataCtx: Context<Ctx | null> =
  g.__vvDataCtx ?? (g.__vvDataCtx = createContext<Ctx | null>(null));
const DataActionsCtx: Context<DataActionsCtxValue | null> =
  g.__vvDataActionsCtx ?? (g.__vvDataActionsCtx = createContext<DataActionsCtxValue | null>(null));

export const CORE_PRELOAD_COLLECTIONS: Array<CollectionKey | "attendance"> = [
  "players",
  "teams",
  "sessions",
  "coaches",
  "branches",
  "invoices",
  "stock",
  "orders",
  "attendance",
  "customRoles",
  "users",
  "notifications",
  "suppliers",
  "plans",
  "drills",
  "groups",
  "resourceFolders",
  "workshops",
  "crmLeads",
  "courtReservations",
  "gymMembers",
  "posCatalog",
  "ledger",
  "staff",
  "physioRecords",
  "posTransactions",
];

export function DataProvider({ children }: { children: ReactNode }) {
  const { user, passwordUser, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const [ready, setReady] = useState(false);
  const [, setTenantChangeTick] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onTenantChange = () => {
      const nextSlug = getTenantSlug() || "donbosco";
      dbStore.hydrateFromLocalCache(nextSlug);
      setTenantChangeTick((t) => t + 1);
    };
    window.addEventListener("vv:rba-demo-tenant-change", onTenantChange);
    return () => window.removeEventListener("vv:rba-demo-tenant-change", onTenantChange);
  }, []);

  const tenantId = getTenantSlug() || "donbosco";
  const authUid = user?.uid || auth?.currentUser?.uid || null;
  const isAuthenticated =
    !authLoading && Boolean(authUid && !user?.isAnonymous && (user || passwordUser));

  const activeEmail = (user?.email || passwordUser?.email || auth?.currentUser?.email || "")
    .trim()
    .toLowerCase();
  const activeRole =
    passwordUser?.role || (isProtectedSuperAdminEmail(activeEmail) ? "Super Admin" : undefined);
  const activePerms = (
    passwordUser as (UserAccount & { permissions?: Record<string, PermissionPower> }) | null
  )?.permissions;

  setActiveRoleAccessContext({
    role: activeRole,
    email: activeEmail,
    permissions: activePerms || null,
  });

  // Synchronously align active tenant before child renders/effects subscribe to collections
  // so parent useEffect never wipes child useCollection subscriptions via resetTenant().
  if (tenantId && dbStore.getActiveTenant() !== tenantId) {
    dbStore.resetTenant(tenantId);
  }

  // Synchronously pre-subscribe allowed core collections on the client ONLY after Firebase Auth has
  // finished restoring auth.currentUser so listeners never fail with pre-auth permission-denied.
  if (
    typeof window !== "undefined" &&
    isAuthenticated &&
    auth?.currentUser &&
    !auth.currentUser.isAnonymous &&
    tenantId
  ) {
    for (const colKey of CORE_PRELOAD_COLLECTIONS) {
      if (canUserAccessCollection(colKey)) {
        ensureCollectionSubscribed(colKey, tenantId);
      }
    }
  }

  // Bind queryClient to reactive store for cache sync & initialize global error flight recorder
  useEffect(() => {
    dbStore.hydrateFromLocalCache(tenantId);
    if (tenantId !== "rba-demo") {
      for (const restrictedKey of SENSITIVE_ROLE_GATED_COLLECTIONS) {
        if (!canUserAccessCollection(restrictedKey)) {
          if (dbStore.isSubscribed(restrictedKey)) {
            dbStore.unregisterSubscription(restrictedKey);
          }
          dbStore.setSlice(restrictedKey, [] as unknown as DB[typeof restrictedKey]);
        }
      }
      if (canUserAccessCollection("staff") && !canUserViewStaffSalary()) {
        const currentStaff = (dbStore.getSlice("staff") as Staff[]) || [];
        if (currentStaff.some((s) => Boolean(s.salary))) {
          dbStore.setSlice(
            "staff",
            currentStaff.map((s) => ({ ...s, salary: 0 })),
          );
        }
      }
    }
    initGlobalErrorTelemetry();
    dbStore.setQueryClient(queryClient);
    return () => {
      dbStore.setQueryClient(null);
    };
  }, [queryClient, tenantId]);

  useEffect(() => {
    const activeBranch = passwordUser?.branch || "";
    setErrorLoggerUserContext({
      tenantId,
      ...(activeEmail ? { userEmail: activeEmail } : {}),
      ...(activeRole ? { userRole: activeRole } : {}),
      ...(activeBranch ? { userBranch: activeBranch } : {}),
    });

    // Enforce role-gating on sensitive collections whenever signed-in user role or permissions change
    if (tenantId !== "rba-demo") {
      for (const restrictedKey of SENSITIVE_ROLE_GATED_COLLECTIONS) {
        if (!isAuthenticated || !canUserAccessCollection(restrictedKey)) {
          if (dbStore.isSubscribed(restrictedKey)) {
            dbStore.unregisterSubscription(restrictedKey);
          }
          const currentSlice = dbStore.getSlice(restrictedKey);
          if (Array.isArray(currentSlice) && currentSlice.length > 0) {
            dbStore.setSlice(restrictedKey, [] as unknown as DB[typeof restrictedKey]);
          }
        } else if (
          isAuthenticated &&
          auth?.currentUser &&
          !auth.currentUser.isAnonymous &&
          tenantId
        ) {
          ensureCollectionSubscribed(restrictedKey, tenantId);
        }
      }

      if (canUserAccessCollection("staff") && !canUserViewStaffSalary()) {
        const currentStaff = (dbStore.getSlice("staff") as Staff[]) || [];
        if (currentStaff.some((s) => Boolean(s.salary))) {
          dbStore.setSlice(
            "staff",
            currentStaff.map((s) => ({ ...s, salary: 0 })),
          );
        }
      }
    }
  }, [tenantId, isAuthenticated, activeEmail, activeRole, passwordUser?.branch, activePerms]);

  // Subscribe to whole store updates via useSyncExternalStore (with SSR support)
  const currentDB = useSyncExternalStore(
    (onStoreChange) => dbStore.subscribe("ALL", onStoreChange),
    () => dbStore.getDB(),
    () => dbStore.getDB(),
  );

  // Transparent lazy-loading Proxy: accessing db.players, db.ledger, etc.,
  // automatically triggers on-demand Firestore subscriptions for that collection.
  const db = useMemo(() => {
    return new Proxy(currentDB, {
      get(target, prop) {
        if (typeof prop === "string" && prop in target) {
          const key = prop as keyof DB;
          if (
            isAuthenticated &&
            auth?.currentUser &&
            !auth.currentUser.isAnonymous &&
            tenantId &&
            canUserAccessCollection(key)
          ) {
            ensureCollectionSubscribed(key, tenantId);
          }
          return target[key];
        }
        return Reflect.get(target, prop);
      },
    });
  }, [currentDB, isAuthenticated, tenantId]);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    if (!isAuthenticated || !auth?.currentUser || auth.currentUser.isAnonymous) {
      setReady(true);
      return;
    }

    if (dbStore.getActiveTenant() !== tenantId) {
      dbStore.resetTenant(tenantId);
    }

    // Ensure allowed core operational collections are subscribed once on authenticated tenant mount
    // (ensureCollectionSubscribed is idempotent and skips already-subscribed collections).
    for (const colKey of CORE_PRELOAD_COLLECTIONS) {
      if (canUserAccessCollection(colKey)) {
        ensureCollectionSubscribed(colKey, tenantId);
      }
    }

    let isMounted = true;
    const unsubscribes: (() => void)[] = [];

    const applyAcademySnapshot = (raw: Record<string, unknown>) => {
      const nestedAcademy =
        raw.academy && typeof raw.academy === "object"
          ? (raw.academy as Partial<Academy> & Record<string, unknown>)
          : {};
      const topName = typeof raw.name === "string" ? raw.name.trim() : "";
      const nestedName = typeof nestedAcademy.name === "string" ? nestedAcademy.name.trim() : "";

      const incoming = (
        topName || !nestedName
          ? {
              ...nestedAcademy,
              ...raw,
            }
          : {
              ...raw,
              ...nestedAcademy,
            }
      ) as Partial<Academy> & Record<string, unknown>;

      delete incoming.academy;

      const prevAcademy =
        (dbStore.getSlice("academy") as Academy & Record<string, unknown>) ||
        (emptyDB().academy as Academy & Record<string, unknown>);

      const incomingName = typeof incoming.name === "string" ? incoming.name.trim() : "";
      const isExplicitReset = incoming.setupDone === false && "name" in incoming && !incomingName;
      const hasValidName = Boolean(incomingName);

      if (hasValidName || isExplicitReset) {
        const defaultFeatures = [
          "calendar",
          "sessions",
          "players",
          "teams",
          "accounting",
          "merchandise",
          "technical",
          "coach",
          "whatsapp",
        ];

        const normalizedFeatures = Array.isArray(incoming.features)
          ? incoming.features.filter((f): f is string => typeof f === "string" && Boolean(f))
          : incoming.features && typeof incoming.features === "object"
            ? Object.entries(incoming.features as Record<string, unknown>)
                .filter(([, v]) => Boolean(v))
                .map(([k]) => k)
            : Array.isArray(prevAcademy.features)
              ? prevAcademy.features.filter((f): f is string => typeof f === "string" && Boolean(f))
              : defaultFeatures;

        const resolvedRequireGameConfirmation =
          typeof incoming.requireGameConfirmation === "boolean"
            ? incoming.requireGameConfirmation
            : typeof incoming.autoConfirmGames === "boolean"
              ? !incoming.autoConfirmGames
              : typeof prevAcademy.requireGameConfirmation === "boolean"
                ? prevAcademy.requireGameConfirmation
                : true;

        const resolvedCurrency =
          typeof raw.currency === "string" && raw.currency.trim()
            ? raw.currency.trim()
            : typeof nestedAcademy.currency === "string" && nestedAcademy.currency.trim()
              ? nestedAcademy.currency.trim()
              : typeof incoming.currency === "string" && incoming.currency.trim()
                ? incoming.currency.trim()
                : String(prevAcademy.currency || "USD");

        const mergedAcademy = cleanFirestoreData({
          ...prevAcademy,
          ...incoming,
          name: isExplicitReset ? "" : incomingName || prevAcademy.name || "",
          currency: resolvedCurrency,
          currencies: [resolvedCurrency],
          features: normalizedFeatures,
          requireGameConfirmation: resolvedRequireGameConfirmation,
          autoConfirmGames: !resolvedRequireGameConfirmation,
          ...(incoming.collection && typeof incoming.collection === "object"
            ? {
                collection: {
                  ...(prevAcademy.collection as Record<string, unknown>),
                  ...(incoming.collection as Record<string, unknown>),
                },
              }
            : prevAcademy.collection
              ? { collection: prevAcademy.collection }
              : {}),
          ...(incoming.socials && typeof incoming.socials === "object"
            ? {
                socials: {
                  ...(prevAcademy.socials as Record<string, unknown>),
                  ...(incoming.socials as Record<string, unknown>),
                },
              }
            : prevAcademy.socials
              ? { socials: prevAcademy.socials }
              : {}),
          ...(Array.isArray(incoming.completedSetupSteps)
            ? {
                completedSetupSteps: incoming.completedSetupSteps.filter(
                  (s): s is string => typeof s === "string",
                ),
              }
            : Array.isArray(prevAcademy.completedSetupSteps)
              ? { completedSetupSteps: prevAcademy.completedSetupSteps }
              : {}),
          whatsappTemplates: Array.isArray(incoming.whatsappTemplates)
            ? incoming.whatsappTemplates
            : Array.isArray(prevAcademy.whatsappTemplates) &&
                prevAcademy.whatsappTemplates.length > 0
              ? prevAcademy.whatsappTemplates
              : DEFAULT_WHATSAPP_TEMPLATES,
          insuranceCompanies: Array.isArray(incoming.insuranceCompanies)
            ? incoming.insuranceCompanies
            : Array.isArray(prevAcademy.insuranceCompanies) &&
                prevAcademy.insuranceCompanies.length > 0
              ? prevAcademy.insuranceCompanies
              : DEFAULT_INSURANCE_COMPANIES,
          trainingPackages: Array.isArray(incoming.trainingPackages)
            ? incoming.trainingPackages
            : Array.isArray(prevAcademy.trainingPackages) && prevAcademy.trainingPackages.length > 0
              ? prevAcademy.trainingPackages
              : DEFAULT_TRAINING_PACKAGES,
          specialOffers: Array.isArray(incoming.specialOffers)
            ? incoming.specialOffers
            : Array.isArray(prevAcademy.specialOffers) && prevAcademy.specialOffers.length > 0
              ? prevAcademy.specialOffers
              : DEFAULT_SPECIAL_OFFERS,
          printingOptions: Array.isArray(incoming.printingOptions)
            ? incoming.printingOptions
            : Array.isArray(prevAcademy.printingOptions) && prevAcademy.printingOptions.length > 0
              ? prevAcademy.printingOptions
              : DEFAULT_PRINTING_OPTIONS,
          crmSettings:
            incoming.crmSettings && typeof incoming.crmSettings === "object"
              ? {
                  ...DEFAULT_CRM_SETTINGS,
                  ...(prevAcademy.crmSettings || {}),
                  ...(incoming.crmSettings as Partial<CrmSettings>),
                }
              : prevAcademy.crmSettings
                ? { ...DEFAULT_CRM_SETTINGS, ...prevAcademy.crmSettings }
                : DEFAULT_CRM_SETTINGS,
          assignmentMode:
            incoming.assignmentMode === "dob_matrix" || incoming.assignmentMode === "direct"
              ? incoming.assignmentMode
              : prevAcademy.assignmentMode === "dob_matrix"
                ? "dob_matrix"
                : "direct",
          protectedSuperAdminEmails: Array.from(
            new Set(
              [
                ...DEFAULT_PROTECTED_SUPER_ADMIN_EMAILS,
                ...(Array.isArray(incoming.protectedSuperAdminEmails)
                  ? incoming.protectedSuperAdminEmails
                  : Array.isArray(raw.protectedSuperAdminEmails)
                    ? (raw.protectedSuperAdminEmails as string[])
                    : Array.isArray(prevAcademy.protectedSuperAdminEmails)
                      ? prevAcademy.protectedSuperAdminEmails
                      : []),
              ]
                .map((e) =>
                  String(e || "")
                    .trim()
                    .toLowerCase(),
                )
                .filter(Boolean),
            ),
          ),
        }) as unknown as Academy;

        if (
          typeof window !== "undefined" &&
          Array.isArray(mergedAcademy.protectedSuperAdminEmails)
        ) {
          try {
            window.localStorage.setItem(
              "vv_protected_super_admins",
              JSON.stringify(mergedAcademy.protectedSuperAdminEmails),
            );
          } catch {
            // ignore
          }
        }
        const rootOnlyFields = [
          "academy",
          "ageCategoryRules",
          "lists",
          "roleMap",
          "memberEmails",
          "usernameMap",
        ];
        for (const field of rootOnlyFields) {
          if (field in (mergedAcademy as Record<string, unknown>)) {
            delete (mergedAcademy as Record<string, unknown>)[field];
          }
        }
        if (mergedAcademy.paymentGateway && typeof mergedAcademy.paymentGateway === "object") {
          delete (mergedAcademy.paymentGateway as Record<string, unknown>).secretKey;
          delete (mergedAcademy.paymentGateway as Record<string, unknown>).webhookSecret;
        }
        if (
          mergedAcademy.notificationServices &&
          typeof mergedAcademy.notificationServices === "object"
        ) {
          delete (mergedAcademy.notificationServices as Record<string, unknown>).smsApiKey;
          delete (mergedAcademy.notificationServices as Record<string, unknown>).emailApiKey;
        }
        if (
          mergedAcademy.notificationConfig &&
          typeof mergedAcademy.notificationConfig === "object"
        ) {
          delete (mergedAcademy.notificationConfig as Record<string, unknown>).smsApiKey;
          delete (mergedAcademy.notificationConfig as Record<string, unknown>).emailApiKey;
        }
        dbStore.markHydrated("academy");
        dbStore.setSlice("academy", mergedAcademy);
      }

      if (
        "ageCategoryRules" in raw &&
        raw.ageCategoryRules &&
        typeof raw.ageCategoryRules === "object"
      ) {
        dbStore.markHydrated("ageCategoryRules");
        dbStore.setSlice(
          "ageCategoryRules",
          raw.ageCategoryRules as Record<string, { startDate: string; endDate: string }>,
        );
      }
    };

    // 1. Academy Root Singleton (/tenants/{tenantId})
    const unsubAcademy = onSnapshot(
      doc(firestore, "tenants", tenantId),
      (docSnap) => {
        if (!isMounted) return;
        dbStore.markHydrated("academy");
        if (docSnap.exists()) {
          const data = cleanIncomingFirestoreData(docSnap.data());
          if (data && typeof data === "object") {
            applyAcademySnapshot(data as Record<string, unknown>);
          }
          setReady(true);
        } else if (!docSnap.metadata.fromCache) {
          setReady(true);
        }
      },
      (err) => {
        console.warn("Firestore academy listener notice (graceful empty state active):", err);
        dbStore.markHydrated("academy");
        dbStore.unregisterSubscription("academy");
        setReady(true);
      },
    );
    unsubscribes.push(unsubAcademy);
    dbStore.registerSubscription("academy", unsubAcademy);

    // 2. Appearance Settings Singleton
    const unsubAppearance = onSnapshot(
      doc(firestore, "tenants", tenantId, "settings", "appearance"),
      (docSnap) => {
        if (!isMounted) return;
        dbStore.markHydrated("appearance");
        if (docSnap.exists()) {
          const data = cleanIncomingFirestoreData(docSnap.data());
          if (data)
            dbStore.setSlice("appearance", normalizeAppearance(data as Partial<Appearance>));
        }
      },
      (err) => {
        console.warn("Firestore appearance listener notice (graceful empty state active):", err);
        dbStore.markHydrated("appearance");
        dbStore.unregisterSubscription("appearance");
      },
    );
    unsubscribes.push(unsubAppearance);
    dbStore.registerSubscription("appearance", unsubAppearance);

    // 3. Lists Settings Singleton
    const unsubLists = onSnapshot(
      doc(firestore, "tenants", tenantId, "settings", "lists"),
      (docSnap) => {
        if (!isMounted) return;
        dbStore.markHydrated("lists");
        if (docSnap.exists()) {
          const data = cleanIncomingFirestoreData(docSnap.data());
          if (data) {
            dbStore.setSlice(
              "lists",
              normalizeLists(data as Record<string, string[]>, dbStore.getSlice("lists")),
            );
          }
        }
      },
      (err) => {
        console.warn("Firestore lists listener notice (graceful empty state active):", err);
        dbStore.markHydrated("lists");
        dbStore.unregisterSubscription("lists");
      },
    );
    unsubscribes.push(unsubLists);
    dbStore.registerSubscription("lists", unsubLists);

    return () => {
      isMounted = false;
      unsubscribes.forEach((fn) => fn());
      dbStore.unsubscribeAll();
    };
  }, [tenantId, isAuthenticated, authLoading, authUid, passwordUser?.id]);

  const update = useCallback(
    (fn: (draft: DB) => DB) => {
      const previousState = dbStore.getDB();
      const rawNextState = fn(previousState);
      const activeEmail = (user?.email || passwordUser?.email || "").toLowerCase();
      const canModifyPlayersLimit = activeEmail === "geogo3@gmail.com";
      let nextState =
        !canModifyPlayersLimit &&
        rawNextState.academy &&
        previousState.academy &&
        rawNextState.academy.playersLimit !== previousState.academy.playersLimit
          ? {
              ...rawNextState,
              academy: {
                ...rawNextState.academy,
                playersLimit: previousState.academy.playersLimit,
              },
            }
          : rawNextState;

      if (nextState.academy && nextState.academy.currency) {
        const cur = nextState.academy.currency;
        if (
          !Array.isArray(nextState.academy.currencies) ||
          nextState.academy.currencies.length !== 1 ||
          nextState.academy.currencies[0] !== cur
        ) {
          nextState = {
            ...nextState,
            academy: {
              ...nextState.academy,
              currencies: [cur],
            },
          };
        }
      }

      if (nextState.lists && nextState.lists !== previousState.lists) {
        nextState = {
          ...nextState,
          lists: normalizeLists(nextState.lists, previousState.lists),
        };
      }

      dbStore.setWholeDB(nextState);

      // Evaluate any sessions that transitioned to Completed in this state update
      if (nextState.sessions && nextState.sessions !== previousState.sessions) {
        const prevMap = new Map(
          (previousState.sessions || []).map((s) => [s.id, (s.status || "").toLowerCase()]),
        );
        for (const s of nextState.sessions) {
          const nextSt = (s.status || "").toLowerCase();
          const prevSt = prevMap.get(s.id) || "";
          if (nextSt === "completed" && prevSt !== "completed") {
            void evaluateIdlePlayersForCompletedSessionRef.current?.(s);
          }
        }
      }

      // Background Firestore sync: keeps optimistic state safe and reverts if write fails
      if (previousState !== nextState) {
        void (async () => {
          try {
            const hasAuth = await ensureAuthForWrite();
            if (!hasAuth && isE2EBypassEnabled()) return;
            await syncToFirestore(tenantId, previousState, nextState);
          } catch (err: unknown) {
            console.error("Firestore sync error in update():", err);
            logSystemError({
              source: "firestore_write",
              operation: "update(syncToFirestore)",
              error: err,
              tenantId,
            });
            dbStore.setWholeDB(previousState);
            const errMsg = err instanceof Error ? err.message : "Network or permission error";
            toast.error(`Sync failed: ${errMsg}. Reverting changes.`);
          }
        })();
      }
    },
    [tenantId, user?.email, passwordUser?.email],
  );

  const evaluateIdlePlayersForCompletedSessionRef = useRef<
    ((completedSession: SessionItem) => Promise<void>) | null
  >(null);

  const evaluateIdlePlayersForCompletedSession = useCallback(
    async (completedSession: SessionItem) => {
      if (!completedSession || (completedSession.status || "").toLowerCase() !== "completed") {
        return;
      }

      // 1. Identify the team(s) assigned to this session
      const sessionTeams = new Set<string>();
      const addTeamName = (val?: string | null) => {
        if (val && val.trim()) sessionTeams.add(val.trim().toLowerCase());
      };
      addTeamName(completedSession.team);
      addTeamName(completedSession.teamA);
      addTeamName(completedSession.teamB);

      if (sessionTeams.size === 0 && completedSession.title) {
        const titleLower = completedSession.title.toLowerCase();
        const allTeams = (dbStore.getSlice("teams") as Team[]) || [];
        allTeams.forEach((t) => {
          if (t.name && titleLower.includes(t.name.toLowerCase().trim())) {
            sessionTeams.add(t.name.toLowerCase().trim());
          }
        });
      }

      if (sessionTeams.size === 0) return;

      const currentPlayers = (dbStore.getSlice("players") as Player[]) || [];
      const currentAttendance = dbStore.getSlice("attendance") || {};
      const currentInvoices = (dbStore.getSlice("invoices") as Invoice[]) || [];
      const sessionAttendanceMap = currentAttendance[completedSession.id] || {};
      const sessionAttendeesSet = new Set(completedSession.attendees || []);
      const sessionDate = completedSession.date || new Date().toISOString().slice(0, 10);
      const sessionYm = sessionDate.slice(0, 7);

      const idleTeamPlayers = currentPlayers.filter((p) => {
        if (p.status !== "Idle") return false;
        const playerTeams = p.teams || [];
        return playerTeams.some((t) => sessionTeams.has(t.toLowerCase().trim()));
      });

      if (idleTeamPlayers.length === 0) return;

      const updatedPlayerMap = new Map<string, Partial<Player>>();
      const alertsToDispatch: {
        player: Player;
        missedCount: number;
        idleSince: string;
      }[] = [];

      for (const p of idleTeamPlayers) {
        const attendedPresent =
          sessionAttendanceMap[p.id] === "Present" || sessionAttendeesSet.has(p.id);
        const idleSince = p.idleSinceDate || sessionDate;

        // Check if player has paid for the new month or since idleSinceDate
        const hasPaidForCycle =
          currentInvoices.some((inv) => {
            if (inv.playerId !== p.id || inv.status !== "paid") return false;
            const invYm = `${inv.year}-${String(inv.month).padStart(2, "0")}`;
            return invYm >= sessionYm || Boolean(inv.paidDate && inv.paidDate >= idleSince);
          }) ||
          (Array.isArray(p.payments) &&
            p.payments.some((pmt) => pmt.date && pmt.date >= idleSince && pmt.amount > 0));

        if (attendedPresent || hasPaidForCycle) {
          // Player attended or paid -> transition from Idle to Active
          updatedPlayerMap.set(p.id, {
            status: "Active",
            missedSessionsSinceIdle: 0,
            idleSinceDate: "",
            idleMissedSessionIds: [],
          });
          continue;
        }

        // Guard against duplicate increment if this completed session was already counted
        const alreadyCountedIds = Array.isArray(p.idleMissedSessionIds)
          ? p.idleMissedSessionIds
          : [];
        if (alreadyCountedIds.includes(completedSession.id)) {
          continue;
        }

        const nextMissed = (Number(p.missedSessionsSinceIdle) || 0) + 1;
        const nextMissedIds = [...alreadyCountedIds, completedSession.id];

        updatedPlayerMap.set(p.id, {
          status: "Idle",
          idleSinceDate: idleSince,
          missedSessionsSinceIdle: nextMissed,
          idleMissedSessionIds: nextMissedIds,
        });

        if (nextMissed > 0 && nextMissed % 3 === 0) {
          alertsToDispatch.push({
            player: p,
            missedCount: nextMissed,
            idleSince,
          });
        }
      }

      if (updatedPlayerMap.size === 0) return;

      const nextPlayers = currentPlayers.map((p) => {
        const patch = updatedPlayerMap.get(p.id);
        return patch ? { ...p, ...patch } : p;
      });
      dbStore.setSlice("players", nextPlayers);
      setDb((prev) => ({ ...prev, players: nextPlayers }));

      try {
        const hasAuth = await ensureAuthForWrite();
        if (!hasAuth && isE2EBypassEnabled()) return;
        for (const [pid, patch] of updatedPlayerMap.entries()) {
          await atomicUpdateItem(
            tenantId,
            "players",
            pid,
            patch as unknown as Record<string, unknown>,
          );
        }

        for (const alertItem of alertsToDispatch) {
          const alertMsg = `${alertItem.player.name} has missed ${alertItem.missedCount} sessions while Idle since ${alertItem.idleSince} without payment or attendance.`;
          toast.warning(`🚨 ${alertMsg}`);
          const created = await dispatchAcademyNotification(tenantId, {
            title: `🚨 Idle Renewal Alert: ${alertItem.player.name} (${alertItem.missedCount} Sessions Missed)`,
            message: alertMsg,
            type: "system",
            priority: "high",
            targetPlayerId: alertItem.player.id,
            targetPlayerName: alertItem.player.name,
            isIdleFollowUpAlert: true,
            targetRoles: ["super_admin", "branch_manager", "accountant", "technical_director"],
            targetBranchId: alertItem.player.branch || undefined,
            actionUrl: `/players?playerId=${alertItem.player.id}`,
            createdAt: new Date().toISOString(),
            readBy: [],
            dismissedBy: [],
          });
          const curNotifs = dbStore.getSlice("notifications") || [];
          if (!curNotifs.some((n) => n.id === created.id)) {
            const nextNotifs = [created, ...curNotifs];
            dbStore.setSlice("notifications", nextNotifs);
            setDb((prev) => ({ ...prev, notifications: nextNotifs }));
          }
        }
      } catch (err) {
        console.warn("Error updating Idle player missed session counts:", err);
      }
    },
    [tenantId],
  );

  useEffect(() => {
    evaluateIdlePlayersForCompletedSessionRef.current = evaluateIdlePlayersForCompletedSession;
  }, [evaluateIdlePlayersForCompletedSession]);

  const setEntity = useCallback(
    async <K extends CollectionKey>(collectionName: K, rawItem: DB[K][number]) => {
      const item =
        collectionName === "branches"
          ? (capBranchSubArrays(
              rawItem as unknown as Record<string, unknown>,
            ) as unknown as DB[K][number])
          : collectionName === "ledger"
            ? (normalizeDoubleEntryLedger(
                rawItem as unknown as LedgerEntry,
              ) as unknown as DB[K][number])
            : rawItem;
      // Capture previous slice snapshot before optimistic update
      const previousSlice = (dbStore.getSlice(collectionName) as Array<{ id: string }>) || [];
      const prevItem = previousSlice.find((x) => x.id === (item as { id: string }).id) as
        SessionItem | undefined;
      const exists = Boolean(prevItem);
      const updated = exists
        ? previousSlice.map((x) => (x.id === (item as { id: string }).id ? item : x))
        : [item, ...previousSlice];
      dbStore.setSlice(collectionName, updated as DB[K]);

      try {
        const hasAuth = await ensureAuthForWrite();
        if (!hasAuth && isE2EBypassEnabled()) return;
        await atomicSetItem(tenantId, collectionName, (item as { id: string }).id, item);
        if (collectionName === "sessions") {
          const sItem = item as unknown as SessionItem;
          const prevStatus = (prevItem?.status || "").toLowerCase();
          if ((sItem.status || "").toLowerCase() === "completed" && prevStatus !== "completed") {
            void evaluateIdlePlayersForCompletedSession(sItem);
          }
        }
        if (
          (collectionName === "players" || collectionName === "branches") &&
          resolveEffectiveUserAccess().isAdmin
        ) {
          const countField = collectionName === "players" ? "playersCount" : "branchesCount";
          const usedField = collectionName === "players" ? "playersUsed" : "branchesUsed";
          await atomicUpdateAcademy(tenantId, {
            [countField]: updated.length,
            [usedField]: updated.length,
          }).catch((e) => {
            console.warn("Non-fatal academy count update notice:", e);
          });
        }
      } catch (err: unknown) {
        // Rollback optimistic update
        dbStore.setSlice(collectionName, previousSlice as DB[K]);
        logSystemError({
          source: "firestore_write",
          operation: `setEntity(${collectionName})`,
          error: err,
          payload: item,
          tenantId,
        });
        console.error(`Firestore sync error for ${collectionName}:`, err);
        const errMsg = err instanceof Error ? err.message : "Sync error";
        toast.error(`Failed to save to ${collectionName}: ${errMsg}. Reverting changes.`);
        throw err;
      }
    },
    [tenantId, evaluateIdlePlayersForCompletedSession],
  );

  const deleteEntity = useCallback(
    async <K extends CollectionKey>(collectionName: K, id: string) => {
      // Capture previous slice snapshot before optimistic update
      const previousSlice = (dbStore.getSlice(collectionName) as Array<{ id: string }>) || [];
      const updated = previousSlice.filter((x) => x.id !== id);
      dbStore.setSlice(collectionName, updated as DB[K]);

      try {
        const hasAuth = await ensureAuthForWrite();
        if (!hasAuth && isE2EBypassEnabled()) return;
        const userItem =
          collectionName === "users"
            ? (previousSlice.find((x) => x.id === id) as UserAccount | undefined)
            : undefined;
        await atomicDeleteItem(
          tenantId,
          collectionName,
          id,
          userItem
            ? { email: userItem.email, authUid: userItem.authUid, id: userItem.id }
            : undefined,
        );
        if (
          (collectionName === "players" || collectionName === "branches") &&
          resolveEffectiveUserAccess().isAdmin
        ) {
          const countField = collectionName === "players" ? "playersCount" : "branchesCount";
          const usedField = collectionName === "players" ? "playersUsed" : "branchesUsed";
          await atomicUpdateAcademy(tenantId, {
            [countField]: updated.length,
            [usedField]: updated.length,
          }).catch((e) => {
            console.warn("Non-fatal academy count update notice:", e);
          });
        }
      } catch (err: unknown) {
        // Rollback optimistic update
        dbStore.setSlice(collectionName, previousSlice as DB[K]);
        logSystemError({
          source: "firestore_write",
          operation: `deleteEntity(${collectionName}/${id})`,
          error: err,
          payload: { collectionName, id },
          tenantId,
        });
        console.error(`Firestore delete error for ${collectionName}:`, err);
        const errMsg = err instanceof Error ? err.message : "Sync error";
        toast.error(`Failed to delete from ${collectionName}: ${errMsg}. Reverting deletion.`);
        throw err;
      }
    },
    [tenantId],
  );

  const patchEntity = useCallback(
    async <K extends CollectionKey>(
      collectionName: K,
      id: string,
      partial: Partial<DB[K][number]>,
    ) => {
      // Capture previous slice snapshot before optimistic update
      const previousSlice = (dbStore.getSlice(collectionName) as Array<{ id: string }>) || [];
      const prevItem = previousSlice.find((x) => x.id === id) as SessionItem | undefined;
      const mergedItem = prevItem ? { ...prevItem, ...partial, id } : { ...partial, id };
      const updated = previousSlice.some((x) => x.id === id)
        ? previousSlice.map((x) => (x.id === id ? { ...x, ...partial } : x))
        : [mergedItem as unknown as DB[K][number], ...previousSlice];
      dbStore.setSlice(collectionName, updated as DB[K]);

      try {
        const hasAuth = await ensureAuthForWrite();
        if (!hasAuth && isE2EBypassEnabled()) return;
        const payloadToPersist =
          collectionName === "workshops" && prevItem
            ? (mergedItem as Record<string, unknown>)
            : (partial as Record<string, unknown>);
        await atomicUpdateItem(tenantId, collectionName, id, payloadToPersist);
        if (collectionName === "sessions") {
          const mergedSession = updated.find((x) => x.id === id) as unknown as
            SessionItem | undefined;
          const prevStatus = (prevItem?.status || "").toLowerCase();
          if (
            mergedSession &&
            (mergedSession.status || "").toLowerCase() === "completed" &&
            prevStatus !== "completed"
          ) {
            void evaluateIdlePlayersForCompletedSession(mergedSession);
          }
        }
      } catch (err: unknown) {
        // Rollback optimistic update
        dbStore.setSlice(collectionName, previousSlice as DB[K]);
        logSystemError({
          source: "firestore_write",
          operation: `patchEntity(${collectionName}/${id})`,
          error: err,
          payload: partial,
          tenantId,
        });
        console.error(`Firestore patch error for ${collectionName}:`, err);
        const errMsg = err instanceof Error ? err.message : "Sync error";
        toast.error(`Failed to update ${collectionName}: ${errMsg}. Reverting changes.`);
        throw err;
      }
    },
    [tenantId, evaluateIdlePlayersForCompletedSession],
  );

  const runBranchArrayTransaction = useCallback(
    async (
      branchId: string,
      updaterFn: (currentBranch: Branch) => Branch,
      fallbackBranch?: Branch,
    ): Promise<Branch> => {
      const previousBranches = (dbStore.getSlice("branches") as Branch[]) || [];
      const existingBranch =
        previousBranches.find(
          (b) => b.id === branchId || (b.name || "").toLowerCase() === branchId.toLowerCase(),
        ) || fallbackBranch;
      const targetId = existingBranch?.id || branchId;
      const baseBranch: Branch =
        existingBranch ||
        ({
          id: targetId,
          name: branchId || "Main Branch",
          city: "Beirut",
          address: "Main Facility Campus",
          manager: "Branch Manager",
          operatingHours: "08:00 - 23:00",
          courtsCount: 2,
          teams: 0,
          players: 0,
          rentalType: "Per session",
          rentalRate: 60,
        } as Branch);

      const optimisticBranch = capBranchSubArrays(
        updaterFn(baseBranch) as unknown as Record<string, unknown>,
      ) as unknown as Branch;
      const hasInStore = previousBranches.some((b) => b.id === targetId);
      dbStore.setSlice(
        "branches",
        hasInStore
          ? previousBranches.map((b) => (b.id === targetId ? optimisticBranch : b))
          : [optimisticBranch, ...previousBranches],
      );

      try {
        const hasAuth = await ensureAuthForWrite();
        if (!hasAuth && isE2EBypassEnabled()) return optimisticBranch;
        const committedBranch = await atomicRunBranchTransaction(
          tenantId,
          targetId,
          baseBranch,
          updaterFn,
        );
        const latestBranches = (dbStore.getSlice("branches") as Branch[]) || [];
        const existsNow = latestBranches.some((b) => b.id === targetId);
        dbStore.setSlice(
          "branches",
          existsNow
            ? latestBranches.map((b) => (b.id === targetId ? committedBranch : b))
            : [committedBranch, ...latestBranches],
        );
        return committedBranch;
      } catch (err: unknown) {
        dbStore.setSlice("branches", previousBranches);
        const errMsg = err instanceof Error ? err.message : "Transaction error";
        toast.error(`Failed to update branch: ${errMsg}. Reverting changes.`);
        throw err;
      }
    },
    [tenantId],
  );

  const cascadeBranchAndCourtRename = useCallback(
    async (
      params: BranchAndCourtRenameParams,
    ): Promise<{ updatedRecordsCount: number; branchRecord: Branch }> => {
      const currentDbSnapshot = dbStore.getDB();
      const { nextDb, updatedBranchRecord, batchOps } = applyBranchAndCourtRenameToDB(
        currentDbSnapshot,
        params,
      );

      dbStore.setWholeDB(nextDb);
      setDb(nextDb);

      try {
        const hasAuth = await ensureAuthForWrite();
        if (!hasAuth && isE2EBypassEnabled()) {
          return {
            updatedRecordsCount: Math.max(0, batchOps.length - 1),
            branchRecord: updatedBranchRecord,
          };
        }
        await atomicBatchSaveEntities(tenantId, batchOps);
        return {
          updatedRecordsCount: Math.max(0, batchOps.length - 1),
          branchRecord: updatedBranchRecord,
        };
      } catch (err: unknown) {
        dbStore.setWholeDB(currentDbSnapshot);
        setDb(currentDbSnapshot);
        const errMsg = err instanceof Error ? err.message : "Batch cascade error";
        toast.error(`Failed to save branch and cascade updates: ${errMsg}. Reverting changes.`);
        throw err;
      }
    },
    [tenantId],
  );

  const recordAttendance = useCallback(
    async (
      sessionId: string,
      playerId: string,
      status: "Present" | "Absent" | "Excused" | "present" | "absent" | "excused",
      timestamp?: string | number | null,
      metadata?: { method?: "qr" | "qr_scan" | "manual"; flag?: string },
    ) => {
      const normalizedStatus = status.toLowerCase() as "present" | "absent" | "excused";
      const capitalizedStatus = (normalizedStatus.charAt(0).toUpperCase() +
        normalizedStatus.slice(1)) as "Present" | "Absent" | "Excused";
      const ts = timestamp ? String(timestamp) : new Date().toISOString();

      // Capture previous snapshots for optimistic rollback
      const prevSessions = dbStore.getSlice("sessions") || [];
      const prevAttendance = dbStore.getSlice("attendance") || {};
      const prevMeta = dbStore.getSlice("attendanceMeta") || {};

      const cur = prevAttendance[sessionId] || {};
      const updatedAttendance = { ...cur, [playerId]: capitalizedStatus };

      const curMeta = prevMeta[sessionId] || {};
      const updatedMeta = {
        ...curMeta,
        [playerId]: {
          timestamp: ts,
          method: metadata?.method || "manual",
          ...(metadata?.flag ? { flag: metadata.flag } : {}),
        },
      };

      const updatedSessions = prevSessions.map((s) => {
        if (s.id !== sessionId) return s;
        const currentAttendees = new Set(s.attendees || []);
        if (capitalizedStatus === "Present") {
          currentAttendees.add(playerId);
        } else {
          currentAttendees.delete(playerId);
        }
        return { ...s, attendees: Array.from(currentAttendees) };
      });

      const nextAttendanceState = {
        ...(dbStore.getSlice("attendance") || {}),
        [sessionId]: updatedAttendance,
      };
      dbStore.setSlice("sessions", updatedSessions);
      dbStore.setSlice("attendance", nextAttendanceState);
      dbStore.setSlice("attendanceMeta", {
        ...(dbStore.getSlice("attendanceMeta") || {}),
        [sessionId]: updatedMeta,
      });

      setDb((prev) => ({
        ...prev,
        sessions: updatedSessions,
        attendance: {
          ...(prev.attendance || {}),
          [sessionId]: updatedAttendance,
        },
        attendanceMeta: {
          ...(prev.attendanceMeta || {}),
          [sessionId]: updatedMeta,
        },
      }));

      try {
        const hasAuth = await ensureAuthForWrite();
        if (!hasAuth && isE2EBypassEnabled()) return;
        await atomicRecordAttendance(
          tenantId,
          sessionId,
          playerId,
          capitalizedStatus,
          ts,
          metadata,
        );

        // Point 6C: Over-Attendance Detection & Automated Notification + Idle -> Active Transition
        if (capitalizedStatus === "Present") {
          const currentPlayers = (dbStore.getSlice("players") as Player[]) || [];
          const matchedPlayer = currentPlayers.find((p) => p.id === playerId);

          // IDLE STATE LOGIC: First attendance marked "Present" in a team session transitions player from "Idle" to "Active"
          if (matchedPlayer && matchedPlayer.status === "Idle") {
            const todayIso = new Date().toISOString().slice(0, 10);
            const nowIso = new Date().toISOString();
            const idleResetPatch: Partial<Player> = {
              status: "Active",
              missedSessionsSinceIdle: 0,
              idleSinceDate: "",
              idleMissedSessionIds: [],
              crmFollowUpStatus: "Active / Converted",
              crmMovedAt: todayIso,
            };
            const updatedPlayersList = currentPlayers.map((p) =>
              p.id === playerId ? { ...p, ...idleResetPatch } : p,
            );
            dbStore.setSlice("players", updatedPlayersList);
            setDb((prev) => ({ ...prev, players: updatedPlayersList }));
            await atomicUpdateItem(
              tenantId,
              "players",
              playerId,
              idleResetPatch as unknown as Record<string, unknown>,
            ).catch((e) =>
              console.warn("Failed to persist Idle->Active attendance transition:", e),
            );

            // Sync any linked CRM lead from "idle_followup" to "active_converted"
            const currentLeads = (dbStore.getSlice("crmLeads") as CrmLead[]) || [];
            const linkedLead = currentLeads.find(
              (l) =>
                (l.linkedPlayerId === playerId || l.id === `crm-player-${playerId}`) &&
                l.stage === "idle_followup",
            );
            if (linkedLead) {
              const updatedLead: CrmLead = {
                ...linkedLead,
                stage: "active_converted",
                convertedAt: todayIso,
                updatedAt: nowIso,
              };
              const nextLeads = currentLeads.map((l) => (l.id === linkedLead.id ? updatedLead : l));
              dbStore.setSlice("crmLeads", nextLeads);
              setDb((prev) => ({ ...prev, crmLeads: nextLeads }));
              await atomicSetItem(tenantId, "crmLeads", updatedLead.id, updatedLead).catch((e) =>
                console.warn("Failed to sync CRM lead on Idle->Active attendance transition:", e),
              );
            }

            toast.success(
              `${matchedPlayer.name} marked Present — subscription status transitioned from Idle to Active.`,
            );
          }

          const allowedLimit = Number(matchedPlayer?.allowedPracticesPerMonth || 0);
          if (matchedPlayer && allowedLimit > 0 && allowedLimit < 999) {
            const targetSession = updatedSessions.find((s) => s.id === sessionId);
            const targetYm = (targetSession?.date || new Date().toISOString()).slice(0, 7);
            const monthlyPresentCount = getPlayerMonthlyPresentCount(
              playerId,
              updatedSessions,
              nextAttendanceState,
              targetYm,
            );
            if (monthlyPresentCount > allowedLimit) {
              const playerTeamLabel =
                (matchedPlayer.teams || [])[0] || matchedPlayer.category || "Academy";
              const pkgLabel = matchedPlayer.packageName || `${allowedLimit} Practices/Mo Package`;
              toast.warning(
                `⚠️ Package Session Limit Exceeded: ${matchedPlayer.name} has attended ${monthlyPresentCount} of ${allowedLimit} allowed monthly practices under '${pkgLabel}'.`,
              );
              void dispatchAcademyNotification(tenantId, {
                title: `⚠️ Package Session Limit Exceeded: ${matchedPlayer.name}`,
                message: `${matchedPlayer.name} (${playerTeamLabel}) has attended ${monthlyPresentCount} of ${allowedLimit} allowed monthly practices under '${pkgLabel}'. Consider upgrading their package.`,
                type: "attendance",
                targetRoles: ["branch_manager", "super_admin", "accountant"],
                targetBranchId: matchedPlayer.branch || undefined,
                actionUrl: `/players?playerId=${matchedPlayer.id}`,
                createdAt: new Date().toISOString(),
                readBy: [],
                dismissedBy: [],
              }).catch(() => {});
            }
          }
        }
      } catch (err: unknown) {
        // Rollback optimistic slices
        dbStore.setSlice("sessions", prevSessions);
        dbStore.setSlice("attendance", prevAttendance);
        dbStore.setSlice("attendanceMeta", prevMeta);
        setDb((prev) => ({
          ...prev,
          sessions: prevSessions,
          attendance: prevAttendance,
          attendanceMeta: prevMeta,
        }));
        console.error("Failed to atomically record attendance:", err);
        const errMsg = err instanceof Error ? err.message : "Sync error";
        toast.error(`Failed to record attendance: ${errMsg}. Reverting.`);
        throw err;
      }
    },
    [tenantId],
  );

  const processMerchandiseTransaction = useCallback(
    async (params: MerchandiseTransactionParams): Promise<Order> => {
      const qty = params.quantity > 0 ? params.quantity : 1;
      const printingsList = Array.isArray(params.printings)
        ? params.printings.filter((p) => p && p.label?.trim())
        : [];
      const computedPrintingFee =
        params.printingTotalFee !== undefined
          ? Number(params.printingTotalFee) || 0
          : printingsList.reduce((sum, p) => sum + (Number(p.fee) || 0), 0);
      const baseSubtotal =
        params.subtotal !== undefined ? params.subtotal : (params.unitPrice || 0) * qty;
      const total =
        params.totalAmount !== undefined ? params.totalAmount : baseSubtotal + computedPrintingFee;
      const paid = params.paidAmount !== undefined ? params.paidAmount : 0;
      const unpaid = Math.max(0, total - paid);
      const dateStr = params.date || new Date().toISOString().slice(0, 10);
      const orderId =
        params.orderId || `o-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

      const matchedStock = params.stockItemId
        ? db.stock.find((s) => s.id === params.stockItemId)
        : db.stock.find((s) => s.item.toLowerCase() === params.itemName.toLowerCase());
      const effectiveCostPrice =
        params.costPrice !== undefined ? params.costPrice : matchedStock?.costPrice || 0;
      const totalCost = effectiveCostPrice * qty;

      const resolvedVariantLabel =
        params.variant ||
        (params.selectedColor && params.selectedSize
          ? `${params.selectedColor} · ${params.selectedSize}`
          : params.selectedColor || params.selectedSize || "");

      const printingSummaryText =
        printingsList.length > 0
          ? printingsList
              .map((p) => {
                const txt = p.customText || p.details;
                return `${p.label}${txt ? ` ("${txt}")` : ""}: +${money(Number(p.fee) || 0, db.academy?.currency)}`;
              })
              .join(", ")
          : "";

      const order: Order = {
        id: orderId,
        player: params.playerName,
        playerId: params.playerId,
        stockItemId: matchedStock?.id || params.stockItemId,
        team: params.team || "",
        items: qty > 1 ? `${params.itemName} (x${qty})` : params.itemName,
        quantity: qty,
        unitPrice: params.unitPrice,
        variant: resolvedVariantLabel,
        variantId: params.variantId,
        selectedSize: params.selectedSize,
        selectedColor: params.selectedColor,
        number: params.number || "",
        printings: printingsList.length > 0 ? printingsList : undefined,
        printingTotalFee: computedPrintingFee > 0 ? computedPrintingFee : undefined,
        subtotal: baseSubtotal,
        discountPercent: params.discountPercent,
        discountAmount: params.discountAmount,
        costPrice: effectiveCostPrice || undefined,
        costTotal: totalCost > 0 ? totalCost : undefined,
        total,
        paid,
        delivered: params.delivered ?? false,
        date: dateStr,
        notes:
          params.notes || (printingSummaryText ? `Printing: ${printingSummaryText}` : undefined),
        branch: params.branch,
      };

      // 1. Stock & Variant Matrix Updates
      let stockItemToUpdate: {
        id: string;
        newStock: number;
        variants?: MerchVariant[];
        variant?: string;
      } | null = null;
      const foundStock =
        (params.stockItemId ? db.stock.find((s) => s.id === params.stockItemId) : undefined) ||
        (params.itemName
          ? db.stock.find((s) => s.item.toLowerCase() === params.itemName.toLowerCase())
          : undefined);

      if (foundStock) {
        if (Array.isArray(foundStock.variants) && foundStock.variants.length > 0) {
          const updatedVariants = foundStock.variants.map((v) => {
            const isTargetVariant =
              (params.variantId && v.id === params.variantId) ||
              (!params.variantId &&
                params.selectedSize &&
                params.selectedColor &&
                v.size.trim().toLowerCase() === params.selectedSize.trim().toLowerCase() &&
                v.color.trim().toLowerCase() === params.selectedColor.trim().toLowerCase());
            if (isTargetVariant) {
              return { ...v, quantity: Math.max(0, (Number(v.quantity) || 0) - qty) };
            }
            return v;
          });
          const newTotalStock = updatedVariants.reduce(
            (sum, v) => sum + Math.max(0, Number(v.quantity) || 0),
            0,
          );
          const updatedSummary = updatedVariants
            .map((v) => `${v.color} · ${v.size} (${v.quantity})`)
            .join(", ");
          stockItemToUpdate = {
            id: foundStock.id,
            newStock: newTotalStock,
            variants: updatedVariants,
            variant: updatedSummary,
          };
        } else {
          stockItemToUpdate = {
            id: foundStock.id,
            newStock: Math.max(0, foundStock.stock - qty),
          };
        }
      }

      // 2. Player Updates (if unpaid balance exists)
      let playerToUpdate: { id: string; newBalance: number } | null = null;
      if (unpaid > 0) {
        const playerObj = params.playerId
          ? db.players.find((p) => p.id === params.playerId)
          : db.players.find((p) => p.name.toLowerCase() === params.playerName.toLowerCase());
        if (playerObj) {
          playerToUpdate = {
            id: playerObj.id,
            newBalance: (playerObj.balance || 0) + unpaid,
          };
        }
      }

      const variantSuffix = resolvedVariantLabel ? ` [${resolvedVariantLabel}]` : "";
      const printingEntrySuffix =
        computedPrintingFee > 0
          ? ` + Custom Printing (${money(computedPrintingFee, db.academy?.currency)})`
          : "";
      const breakdownNote = [
        `Order #${orderId} (${params.playerName})`,
        `Base Item: ${money(baseSubtotal - (params.discountAmount || 0), db.academy?.currency)}`,
        computedPrintingFee > 0 ? `Printing Fees: ${printingSummaryText}` : "",
        `Total: ${money(total, db.academy?.currency)}`,
      ]
        .filter(Boolean)
        .join(" · ");

      // 3. Ledger Entries
      const newLedgerEntries: LedgerEntry[] = [];
      if (paid > 0) {
        newLedgerEntries.push(
          normalizeDoubleEntryLedger({
            id: `l-merch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            date: dateStr,
            account: "Merchandise Revenue",
            category: "Merchandise Revenue",
            entry: `Merchandise Sale · ${params.playerName} · ${params.itemName}${variantSuffix}${qty > 1 ? ` (x${qty})` : ""}${printingEntrySuffix}${params.discountPercent ? ` (${params.discountPercent}% off)` : ""}`,
            type: "Revenue",
            amount: paid,
            status: "Collected",
            referenceId: orderId,
            orderId,
            branch: params.branch || "",
            module: "merchandise",
            note: breakdownNote,
          }),
        );
      }

      if (unpaid > 0) {
        newLedgerEntries.push(
          normalizeDoubleEntryLedger({
            id: `l-ar-${orderId}`,
            date: dateStr,
            account: "Accounts Receivable - Merchandise",
            category: "Accounts Receivable - Merchandise",
            entry: `Accounts Receivable - Merchandise · ${params.playerName} · ${params.itemName}${variantSuffix}${qty > 1 ? ` (x${qty})` : ""}${printingEntrySuffix}${params.discountPercent ? ` (${params.discountPercent}% off)` : ""}`,
            type: "Revenue",
            amount: unpaid,
            status: "Pending",
            referenceId: orderId,
            orderId,
            branch: params.branch || "",
            module: "merchandise",
            note: `Assigned on credit to ${params.playerName}. ${breakdownNote}`,
          }),
        );
      }

      if (totalCost > 0) {
        newLedgerEntries.push(
          normalizeDoubleEntryLedger({
            id: `l-cogs-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
            date: dateStr,
            account: "Merchandise",
            category: "Merchandise",
            entry: `Merchandise Cost (COGS) · ${params.itemName}${variantSuffix}${qty > 1 ? ` (x${qty})` : ""}`,
            type: "Expense",
            amount: totalCost,
            status: "Collected",
            referenceId: orderId,
            orderId,
            branch: params.branch || "",
            module: "merchandise",
            note: `Cost of goods sold (${qty} unit(s) @ ${db.academy?.currency || "USD"} ${effectiveCostPrice}) for Order #${orderId}`,
          }),
        );
      }

      // Capture previous slice snapshots before optimistic update
      const prevStock = (dbStore.getSlice("stock") as StockItem[]) || db.stock;
      const prevOrders = (dbStore.getSlice("orders") as Order[]) || db.orders;
      const prevPlayers = (dbStore.getSlice("players") as Player[]) || db.players;
      const prevLedger = (dbStore.getSlice("ledger") as LedgerEntry[]) || db.ledger;

      let updatedStock = prevStock;
      if (stockItemToUpdate) {
        const itemUpdate = stockItemToUpdate;
        updatedStock = prevStock.map((s) =>
          s.id === itemUpdate.id
            ? {
                ...s,
                stock: itemUpdate.newStock,
                ...(itemUpdate.variants ? { variants: itemUpdate.variants } : {}),
                ...(itemUpdate.variant !== undefined ? { variant: itemUpdate.variant } : {}),
              }
            : s,
        );
      }

      const existingOrderIdx = prevOrders.findIndex((o) => o.id === orderId);
      let updatedOrders: Order[];
      if (existingOrderIdx >= 0) {
        updatedOrders = prevOrders.map((o, idx) => (idx === existingOrderIdx ? order : o));
      } else {
        updatedOrders = [order, ...prevOrders];
      }

      let updatedPlayers = prevPlayers;
      if (playerToUpdate) {
        const pUpdate = playerToUpdate;
        updatedPlayers = prevPlayers.map((p) =>
          p.id === pUpdate.id ? { ...p, balance: pUpdate.newBalance } : p,
        );
      }

      const updatedLedger = [...newLedgerEntries, ...prevLedger];

      // Optimistic update to both store and React state
      dbStore.setSlice("stock", updatedStock);
      dbStore.setSlice("orders", updatedOrders);
      dbStore.setSlice("players", updatedPlayers);
      dbStore.setSlice("ledger", updatedLedger);

      setDb((prev) => ({
        ...prev,
        stock: updatedStock,
        orders: updatedOrders,
        players: updatedPlayers,
        ledger: updatedLedger,
      }));

      // Atomic commit to Firestore
      try {
        await atomicProcessMerchandiseTransaction(tenantId, {
          stockUpdates: stockItemToUpdate ? [stockItemToUpdate] : undefined,
          order: order as unknown as { id: string; [key: string]: unknown },
          playerUpdate: playerToUpdate || undefined,
          ledgerEntries: newLedgerEntries as unknown as { id: string; [key: string]: unknown }[],
        });

        // Event Dispatch: Inventory alert to super_admin, accountant, and branch_manager when stock <= reorderLevel
        if (
          stockItemToUpdate &&
          matchedStock &&
          stockItemToUpdate.newStock <= (matchedStock.reorder ?? 10)
        ) {
          dispatchAcademyNotification(tenantId, {
            title: `Low Stock Alert: ${matchedStock.item}`,
            message: `Inventory for "${matchedStock.item}" (${matchedStock.variant || "Standard"}) has fallen to ${stockItemToUpdate.newStock} units (reorder point: ${matchedStock.reorder ?? 10}). Reorder recommended.`,
            type: "inventory",
            targetRoles: ["super_admin", "accountant", "branch_manager"],
            targetBranchId: matchedStock.branch || params.branch || undefined,
            actionUrl: "/merchandise",
            createdAt: new Date().toISOString(),
            readBy: [],
            dismissedBy: [],
          })
            .then((created) => {
              const current = dbStore.getSlice("notifications") || [];
              if (!current.some((n) => n.id === created.id)) {
                dbStore.setSlice("notifications", [created, ...current]);
              }
            })
            .catch((e) => console.warn("Failed to dispatch low stock alert:", e));
        }
      } catch (err) {
        // Rollback optimistic state
        dbStore.setSlice("stock", prevStock);
        dbStore.setSlice("orders", prevOrders);
        dbStore.setSlice("players", prevPlayers);
        dbStore.setSlice("ledger", prevLedger);
        setDb((prev) => ({
          ...prev,
          stock: prevStock,
          orders: prevOrders,
          players: prevPlayers,
          ledger: prevLedger,
        }));
        console.error("Failed atomic merchandise transaction:", err);
        const errMsg = err instanceof Error ? err.message : "Sync error";
        toast.error(`Failed to process merchandise order: ${errMsg}. Reverting changes.`);
        throw err;
      }

      return order;
    },
    [db.stock, db.orders, db.players, db.ledger, db.academy?.currency, tenantId],
  );

  const settleMerchandiseOrder = useCallback(
    async (orderId: string) => {
      const order = db.orders.find((o) => o.id === orderId);
      if (!order) return;
      const unsettled = Math.max(0, order.total - order.paid);
      if (unsettled <= 0) return;

      const dateStr = new Date().toISOString().slice(0, 10);
      const updatedOrder: Order = { ...order, paid: order.total };

      // Player balance reduction
      let playerToUpdate: { id: string; newBalance: number } | null = null;
      const playerObj = db.players.find((p) => p.name.toLowerCase() === order.player.toLowerCase());
      if (playerObj && (playerObj.balance || 0) > 0) {
        playerToUpdate = {
          id: playerObj.id,
          newBalance: Math.max(0, (playerObj.balance || 0) - unsettled),
        };
      }

      // Settle Ledger Entry
      const newLedgerEntry: LedgerEntry = normalizeDoubleEntryLedger({
        id: `l-merch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        date: dateStr,
        account: "Merchandise Revenue",
        category: "Merchandise Revenue",
        entry: `Merchandise Settlement · ${order.player} · ${order.items}`,
        type: "Revenue",
        amount: unsettled,
        status: "Collected",
        referenceId: order.id,
        branch: order.branch || playerObj?.branch || "",
        module: "merchandise",
        note: `Order #${order.id} balance settled by ${order.player}`,
      });

      // Capture previous slice snapshots
      const prevOrders = (dbStore.getSlice("orders") as Order[]) || db.orders;
      const prevPlayers = (dbStore.getSlice("players") as Player[]) || db.players;
      const prevLedger = (dbStore.getSlice("ledger") as LedgerEntry[]) || db.ledger;

      const updatedOrders = prevOrders.map((o) => (o.id === order.id ? updatedOrder : o));
      let updatedPlayers = prevPlayers;
      if (playerToUpdate) {
        const pUpdate = playerToUpdate;
        updatedPlayers = prevPlayers.map((p) =>
          p.id === pUpdate.id ? { ...p, balance: pUpdate.newBalance } : p,
        );
      }
      const arIdsToDelete = new Set<string>([`l-ar-${order.id}`]);
      for (const l of prevLedger) {
        if (l.referenceId === order.id && l.account === "Accounts Receivable - Merchandise") {
          arIdsToDelete.add(l.id);
        }
      }

      const updatedLedger = [newLedgerEntry, ...prevLedger.filter((l) => !arIdsToDelete.has(l.id))];

      // Optimistic state update
      dbStore.setSlice("orders", updatedOrders);
      dbStore.setSlice("players", updatedPlayers);
      dbStore.setSlice("ledger", updatedLedger);

      setDb((prev) => ({
        ...prev,
        orders: updatedOrders,
        players: updatedPlayers,
        ledger: updatedLedger,
      }));

      // Atomic commit to Firestore
      try {
        await atomicProcessMerchandiseTransaction(tenantId, {
          order: updatedOrder as unknown as { id: string; [key: string]: unknown },
          playerUpdate: playerToUpdate || undefined,
          ledgerEntries: [newLedgerEntry] as unknown as { id: string; [key: string]: unknown }[],
        });
        for (const arId of arIdsToDelete) {
          await deleteDoc(doc(firestore, "tenants", tenantId, "ledger", arId));
        }
      } catch (err) {
        // Rollback optimistic state
        dbStore.setSlice("orders", prevOrders);
        dbStore.setSlice("players", prevPlayers);
        dbStore.setSlice("ledger", prevLedger);
        setDb((prev) => ({
          ...prev,
          orders: prevOrders,
          players: prevPlayers,
          ledger: prevLedger,
        }));
        console.error("Failed to settle merchandise order in Firestore:", err);
        const errMsg = err instanceof Error ? err.message : "Sync error";
        toast.error(`Failed to settle order: ${errMsg}. Reverting changes.`);
        throw err;
      }
    },
    [db.orders, db.players, db.ledger, tenantId],
  );

  const generateMonthlyInvoices = useCallback(
    async (
      billingMonth: string,
      year: number,
      branchFilter?: string,
      options?: InvoicingRunOptions,
    ): Promise<InvoicingResult> => {
      // 1. Normalize month (support "May", "05", "5", "September", etc.)
      const monthNames = [
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
      let monthIndex = -1;
      const cleanMonth = billingMonth.trim().toLowerCase();

      const numMatch = parseInt(cleanMonth, 10);
      if (!isNaN(numMatch) && numMatch >= 1 && numMatch <= 12) {
        monthIndex = numMatch - 1;
      } else {
        monthIndex = monthNames.findIndex((m) =>
          m.toLowerCase().startsWith(cleanMonth.slice(0, 3)),
        );
      }
      if (monthIndex === -1) {
        monthIndex = new Date().getMonth();
      }

      const monthCode = String(monthIndex + 1).padStart(2, "0");
      const monthLabel = monthNames[monthIndex];

      const effectiveBranch = options?.branchFilter ?? branchFilter;
      const excludedSet = new Set(options?.excludedPlayerIds || []);
      const includedSet = options?.includedPlayerIds ? new Set(options.includedPlayerIds) : null;
      const squadFilterLower = options?.squadFilter?.trim().toLowerCase();

      // 2. Query all active/idle/soft-flag players (matching branch if specified, skipping 100% scholarship players)
      const eligiblePlayers = db.players.filter((p) => {
        if (p.isScholarship === true) return false;
        if (excludedSet.has(p.id)) return false;
        if (includedSet && !includedSet.has(p.id)) return false;
        const isActive = p.status === "Active" || p.status === "Idle" || p.status === "Soft flag";
        const matchesBranch = !effectiveBranch || p.branch === effectiveBranch;
        const matchesSquad =
          !squadFilterLower ||
          (p.teams && p.teams.some((tm) => tm.toLowerCase() === squadFilterLower));
        return isActive && matchesBranch && matchesSquad;
      });

      // 3. Prevent duplicate billing for the same month/year combination using an idempotency key
      const existingIds = new Set(db.invoices.map((inv) => inv.id));

      // Calculate sibling discounts if requested
      const siblingDiscountMap = new Map<
        string,
        { rank: number; discountPercent: number; discountAmount: number }
      >();
      if (options?.applySiblingDiscounts) {
        const config = options.siblingDiscountConfig || {
          secondChildPercent: 10,
          thirdPlusChildPercent: 15,
        };
        const buckets = new Map<string, Player[]>();
        eligiblePlayers.forEach((p) => {
          const normFam = p.familyId ? p.familyId.trim().toLowerCase() : "";
          const normPhone = (p.parentPhone || p.guardianPhone || "").replace(/[^\d+]/g, "").trim();
          const normName = (p.parent || p.guardianName || "").trim().toLowerCase();
          const key = normFam
            ? `fam_${normFam}`
            : normPhone
              ? `tel_${normPhone}`
              : normName
                ? `name_${normName}`
                : "";
          if (!key) return;
          const arr = buckets.get(key) || [];
          arr.push(p);
          buckets.set(key, arr);
        });

        buckets.forEach((kids) => {
          if (kids.length >= 2) {
            const sorted = [...kids].sort((a, b) => {
              const feeA = calculatePlayerMonthlyFee(a, db.teams, db.branches);
              const feeB = calculatePlayerMonthlyFee(b, db.teams, db.branches);
              return feeB - feeA;
            });
            sorted.forEach((kid, idx) => {
              const rank = idx + 1;
              const discountPercent =
                rank === 2
                  ? config.secondChildPercent
                  : rank >= 3
                    ? config.thirdPlusChildPercent
                    : 0;
              const standard = calculatePlayerMonthlyFee(kid, db.teams, db.branches);
              const discountAmount = Math.round((standard * discountPercent) / 100);
              siblingDiscountMap.set(kid.id, { rank, discountPercent, discountAmount });
            });
          }
        });
      }

      const newInvoices: Invoice[] = [];
      const playerUpdates: {
        id: string;
        newBalance: number;
        status: Player["status"];
        idleSinceDate: string;
        missedSessionsSinceIdle: number;
        idleMissedSessionIds: string[];
      }[] = [];
      const batchItems: {
        invoice: Record<string, unknown> & { id: string };
        playerUpdate: {
          id: string;
          newBalance: number;
          status?: string;
          idleSinceDate?: string;
          missedSessionsSinceIdle?: number;
          idleMissedSessionIds?: string[];
        };
      }[] = [];

      let skippedCount = 0;
      let totalAmount = 0;
      let seq =
        db.invoices.filter((inv) => inv.year === year && inv.month === monthCode).length + 1;
      const todayIso = new Date().toISOString().slice(0, 10);
      const targetYm = `${year}-${monthCode}`;
      const currentSessions = (dbStore.getSlice("sessions") as SessionItem[]) || db.sessions || [];
      const currentAttendance = dbStore.getSlice("attendance") || db.attendance || {};

      for (const p of eligiblePlayers) {
        if (p.isScholarship === true) {
          skippedCount++;
          continue;
        }
        const invoiceId = `${p.id}_${year}_${monthCode}`;

        if (existingIds.has(invoiceId)) {
          skippedCount++;
          continue;
        }

        // Resolve assigned squad / program tier tuition rate
        const standardRate = calculatePlayerMonthlyFee(p, db.teams, db.branches);
        const sib = siblingDiscountMap.get(p.id);
        const customRate = options?.customRates?.[p.id] ?? options?.customPlayerRates?.[p.id];
        const tuitionRate =
          typeof customRate === "number"
            ? customRate
            : sib && sib.discountPercent > 0
              ? Math.max(0, standardRate - sib.discountAmount)
              : standardRate;

        // Skip $0 / 100% exempt players so $0 pending invoices are never generated
        if (tuitionRate <= 0) {
          skippedCount++;
          continue;
        }

        const squad = db.teams.find((t) => p.teams && p.teams.includes(t.name));

        const invoiceNumber = `INV-${year}-${monthCode}-${String(seq++).padStart(3, "0")}`;
        const newBalance = (p.balance || 0) + tuitionRate;

        const effectiveDueDate = options?.dueDate?.trim() || `${year}-${monthCode}-15`;
        const concessionSuffix =
          sib && sib.discountPercent > 0
            ? ` (Sibling #${sib.rank} Concession -${sib.discountPercent}%)`
            : "";
        const effectiveDescription = options?.customDescription
          ? options.customDescription
              .replace("{MONTH}", monthLabel)
              .replace("{YEAR}", String(year))
              .replace("{PROGRAM}", squad?.name || p.category || "Academy Program") +
            concessionSuffix
          : `Tuition Fee · ${monthLabel} ${year} · ${squad?.name || p.category || "Academy Program"}${concessionSuffix}`;

        // IDLE STATE LOGIC:
        // When a player's monthly subscription cycle ends/renews, do NOT set their status to Active
        // unless they have already recorded a payment or Present attendance for the new month.
        const attendedInNewMonth =
          getPlayerMonthlyPresentCount(p.id, currentSessions, currentAttendance, targetYm) > 0;
        const paidInNewMonth = Array.isArray(p.payments)
          ? p.payments.some((pmt) => pmt.date?.startsWith(targetYm) && pmt.amount > 0)
          : false;

        const nextStatus: Player["status"] =
          attendedInNewMonth || paidInNewMonth ? "Active" : "Idle";
        const nextIdleSinceDate =
          nextStatus === "Idle"
            ? p.status === "Idle" && p.idleSinceDate
              ? p.idleSinceDate
              : todayIso
            : "";
        const nextMissedSessions =
          nextStatus === "Idle"
            ? p.status === "Idle"
              ? Number(p.missedSessionsSinceIdle) || 0
              : 0
            : 0;
        const nextMissedSessionIds =
          nextStatus === "Idle" && p.status === "Idle" && Array.isArray(p.idleMissedSessionIds)
            ? p.idleMissedSessionIds
            : [];

        const invoice: Invoice = {
          id: invoiceId,
          invoiceNumber,
          playerId: p.id,
          playerName: p.name,
          playerBranch: p.branch,
          team: p.teams?.[0] || squad?.name || "Academy Squad",
          programTier: squad?.tier || p.programTier || "Standard Program",
          billingMonth: monthLabel,
          month: monthCode,
          year: year,
          amount: tuitionRate,
          status: "pending",
          issuedDate: todayIso,
          dueDate: effectiveDueDate,
          description: effectiveDescription,
        };

        newInvoices.push(invoice);
        playerUpdates.push({
          id: p.id,
          newBalance,
          status: nextStatus,
          idleSinceDate: nextIdleSinceDate,
          missedSessionsSinceIdle: nextMissedSessions,
          idleMissedSessionIds: nextMissedSessionIds,
        });
        batchItems.push({
          invoice: invoice as unknown as Record<string, unknown> & { id: string },
          playerUpdate: {
            id: p.id,
            newBalance,
            status: nextStatus,
            idleSinceDate: nextIdleSinceDate,
            missedSessionsSinceIdle: nextMissedSessions,
            idleMissedSessionIds: nextMissedSessionIds,
          },
        });

        totalAmount += tuitionRate;
      }

      if (newInvoices.length > 0) {
        // Capture snapshots for rollback
        const prevInvoices = (dbStore.getSlice("invoices") as Invoice[]) || db.invoices;
        const prevPlayers = (dbStore.getSlice("players") as Player[]) || db.players;

        // Optimistic state update
        const updateMap = new Map(playerUpdates.map((u) => [u.id, u]));
        const updatedPlayers = prevPlayers.map((p) => {
          const u = updateMap.get(p.id);
          return u !== undefined
            ? {
                ...p,
                balance: u.newBalance,
                status: u.status,
                idleSinceDate: u.idleSinceDate,
                missedSessionsSinceIdle: u.missedSessionsSinceIdle,
                idleMissedSessionIds: u.idleMissedSessionIds,
              }
            : p;
        });
        const updatedInvoices = [...newInvoices, ...prevInvoices];

        dbStore.setSlice("invoices", updatedInvoices);
        dbStore.setSlice("players", updatedPlayers);

        setDb((prev) => ({
          ...prev,
          invoices: updatedInvoices,
          players: updatedPlayers,
        }));

        // Atomic commit to Firestore
        try {
          await atomicGenerateMonthlyInvoices(tenantId, batchItems);

          // Event Dispatch: Billing notification when monthly tuition batch finishes
          if (newInvoices.length > 0) {
            dispatchAcademyNotification(tenantId, {
              title: `Monthly Tuition Generated: ${monthLabel} ${year}`,
              message: `Generated ${newInvoices.length} invoices totaling ${money(totalAmount)}${branchFilter ? ` for ${branchFilter}` : ""}.`,
              type: "billing",
              targetRoles: ["super_admin", "accountant", "branch_manager"],
              targetBranchId: branchFilter || undefined,
              actionUrl: "/accounting",
              createdAt: new Date().toISOString(),
              readBy: [],
            }).catch((e) => console.warn("Failed to dispatch billing notification:", e));
          }
        } catch (err) {
          // Rollback on error
          dbStore.setSlice("invoices", prevInvoices);
          dbStore.setSlice("players", prevPlayers);
          setDb((prev) => ({
            ...prev,
            invoices: prevInvoices,
            players: prevPlayers,
          }));
          console.error("Firestore batch invoice generation failed:", err);
          const errMsg = err instanceof Error ? err.message : "Sync error";
          toast.error(`Failed to save invoices to Firestore: ${errMsg}. Reverting changes.`);
          throw err;
        }
      }

      return {
        success: true,
        billingMonth: monthLabel,
        monthCode,
        year,
        totalEligible: eligiblePlayers.length,
        generatedCount: newInvoices.length,
        skippedCount,
        totalAmount,
        invoices: newInvoices,
      };
    },
    [db.invoices, db.players, db.teams, db.branches, db.sessions, db.attendance, tenantId],
  );

  const payInvoice = useCallback(
    async (invoiceId: string, paymentMethod = "Cash") => {
      const invoice = db.invoices.find((i) => i.id === invoiceId);
      if (!invoice || invoice.status === "paid") return;

      const prevInvoices = (dbStore.getSlice("invoices") as Invoice[]) || db.invoices;
      const prevPlayers = (dbStore.getSlice("players") as Player[]) || db.players;
      const prevLedger = (dbStore.getSlice("ledger") as LedgerEntry[]) || db.ledger;

      const today = new Date().toISOString().slice(0, 10);
      const updatedInvoice: Invoice = {
        ...invoice,
        status: "paid",
        paidAmount: invoice.amount,
        paidDate: today,
        paymentMethod,
      };

      const player = db.players.find((p) => p.id === invoice.playerId);
      const newBalance = player ? Math.max(0, (player.balance || 0) - invoice.amount) : 0;

      const ledgerEntry: LedgerEntry = normalizeDoubleEntryLedger({
        id: `l-tui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        date: today,
        account: "Tuition",
        category: "Tuition",
        entry: `Tuition Collection · ${invoice.playerName} · ${invoice.billingMonth} ${invoice.year}`,
        type: "Revenue",
        amount: invoice.amount,
        status: "Collected",
        paymentMethod,
        branch: invoice.playerBranch || player?.branch || "",
        referenceId: invoice.id,
        module: "academy",
        note: `Invoice ${invoice.invoiceNumber} paid via ${paymentMethod}`,
      });

      // Optimistic slice updates
      const updatedInvoices = prevInvoices.map((i) => (i.id === invoiceId ? updatedInvoice : i));
      dbStore.setSlice("invoices", updatedInvoices);

      let updatedPlayers = prevPlayers;
      const shouldActivateFromPayment =
        player && (player.status === "Idle" || (player.status === "Soft flag" && newBalance <= 0));
      if (player) {
        updatedPlayers = prevPlayers.map((p) =>
          p.id === invoice.playerId
            ? {
                ...p,
                balance: newBalance,
                ...(shouldActivateFromPayment
                  ? {
                      status: "Active" as const,
                      idleSinceDate: "",
                      missedSessionsSinceIdle: 0,
                      idleMissedSessionIds: [],
                      crmFollowUpStatus: "Active / Converted",
                      crmMovedAt: today,
                    }
                  : {}),
              }
            : p,
        );
        dbStore.setSlice("players", updatedPlayers);
      }

      const updatedLedger = [ledgerEntry, ...prevLedger];
      dbStore.setSlice("ledger", updatedLedger);

      setDb((prev) => ({
        ...prev,
        invoices: updatedInvoices,
        players: updatedPlayers,
        ledger: updatedLedger,
      }));

      // Atomic commit to Firestore in a single writeBatch
      try {
        await atomicProcessInvoicePayment(
          tenantId,
          invoiceId,
          updatedInvoice as Record<string, unknown>,
          player
            ? {
                playerId: player.id,
                balance: newBalance,
                ...(shouldActivateFromPayment
                  ? {
                      status: "Active",
                      idleSinceDate: "",
                      missedSessionsSinceIdle: 0,
                      idleMissedSessionIds: [],
                      crmFollowUpStatus: "Active / Converted",
                      crmMovedAt: today,
                    }
                  : {}),
              }
            : undefined,
          ledgerEntry as Record<string, unknown> & { id: string },
        );

        if (shouldActivateFromPayment && player) {
          const currentLeads = (dbStore.getSlice("crmLeads") as CrmLead[]) || [];
          const linkedLead = currentLeads.find(
            (l) =>
              (l.linkedPlayerId === player.id || l.id === `crm-player-${player.id}`) &&
              l.stage === "idle_followup",
          );
          if (linkedLead) {
            const updatedLead: CrmLead = {
              ...linkedLead,
              stage: "active_converted",
              convertedAt: today,
              updatedAt: new Date().toISOString(),
            };
            const nextLeads = currentLeads.map((l) => (l.id === linkedLead.id ? updatedLead : l));
            dbStore.setSlice("crmLeads", nextLeads);
            setDb((prev) => ({ ...prev, crmLeads: nextLeads }));
            await atomicSetItem(tenantId, "crmLeads", updatedLead.id, updatedLead).catch((e) =>
              console.warn("Failed to sync CRM lead on payInvoice reactivation:", e),
            );
          }
        }
        dispatchAcademyNotification(tenantId, {
          title: `Tuition Payment Collected: ${invoice.playerName}`,
          message: `Collected ${money(invoice.amount, db.academy?.currency)} for Invoice ${invoice.invoiceNumber} (${invoice.billingMonth} ${invoice.year}) via ${paymentMethod}.`,
          type: "billing",
          targetRoles: ["super_admin", "accountant", "branch_manager"],
          targetBranchId: invoice.playerBranch || player?.branch || undefined,
          actionUrl: "/accounting",
          createdAt: new Date().toISOString(),
          readBy: [],
          dismissedBy: [],
        })
          .then((created) => {
            const current = dbStore.getSlice("notifications") || [];
            if (!current.some((n) => n.id === created.id)) {
              dbStore.setSlice("notifications", [created, ...current]);
            }
          })
          .catch(() => {});
        toast.success(`Invoice ${invoice.invoiceNumber} collected.`);
      } catch (err) {
        // Rollback optimistic slices
        dbStore.setSlice("invoices", prevInvoices);
        dbStore.setSlice("players", prevPlayers);
        dbStore.setSlice("ledger", prevLedger);
        setDb((prev) => ({
          ...prev,
          invoices: prevInvoices,
          players: prevPlayers,
          ledger: prevLedger,
        }));
        console.error("Failed to record invoice payment in Firestore:", err);
        const errMsg = err instanceof Error ? err.message : "Sync error";
        toast.error(`Failed to record invoice payment: ${errMsg}. Reverting changes.`);
        throw err;
      }
    },
    [db.invoices, db.players, db.ledger, db.academy?.currency, tenantId],
  );

  const payFamilyBalance = useCallback(
    async (
      familyPlayerIds: string[],
      totalPaymentAmount: number,
      paymentMethod = "Cash",
      notes = "",
    ) => {
      const amount = Math.abs(Number(totalPaymentAmount) || 0);
      if (amount <= 0 || !Array.isArray(familyPlayerIds) || familyPlayerIds.length === 0) {
        return;
      }

      const idSet = new Set(familyPlayerIds);
      const familyPlayers = db.players.filter((p) => idSet.has(p.id));
      if (familyPlayers.length === 0) return;

      const today = new Date().toISOString().slice(0, 10);
      const guardianLabel =
        familyPlayers.find((p) => p.parent?.trim())?.parent?.trim() ||
        familyPlayers.find((p) => p.guardianName?.trim())?.guardianName?.trim() ||
        familyPlayers[0].name;
      const primaryBranch = familyPlayers[0]?.branch || "";

      // 1. Collect all open ("pending" | "overdue") invoices across all siblings sorted oldest-first
      const openFamilyInvoices = (db.invoices || [])
        .filter(
          (inv) =>
            idSet.has(inv.playerId) && (inv.status === "pending" || inv.status === "overdue"),
        )
        .sort((a, b) =>
          (a.dueDate || a.issuedDate || "").localeCompare(b.dueDate || b.issuedDate || ""),
        );

      let remainingPayment = amount;
      const settledInvoiceIds: string[] = [];
      const playerAllocations: Record<string, number> = {};
      familyPlayers.forEach((p) => {
        playerAllocations[p.id] = 0;
      });

      // Settle open invoices oldest-first
      for (const inv of openFamilyInvoices) {
        if (remainingPayment <= 0) break;
        const alloc = Math.min(remainingPayment, inv.amount);
        if (alloc > 0) {
          playerAllocations[inv.playerId] = (playerAllocations[inv.playerId] || 0) + alloc;
          remainingPayment -= alloc;
          if (alloc >= inv.amount) {
            settledInvoiceIds.push(inv.id);
          }
        }
      }

      // Distribute any remaining payment across siblings who still have positive remaining balance
      if (remainingPayment > 0) {
        for (const p of familyPlayers) {
          if (remainingPayment <= 0) break;
          const alreadyAllocated = playerAllocations[p.id] || 0;
          const openBal = Math.max(0, (p.balance || 0) - alreadyAllocated);
          if (openBal > 0) {
            const alloc = Math.min(remainingPayment, openBal);
            playerAllocations[p.id] = alreadyAllocated + alloc;
            remainingPayment -= alloc;
          }
        }
      }

      // If still remaining (e.g. prepayment or full settlement on primary sibling), allocate to first sibling
      if (remainingPayment > 0 && familyPlayers[0]) {
        playerAllocations[familyPlayers[0].id] =
          (playerAllocations[familyPlayers[0].id] || 0) + remainingPayment;
        remainingPayment = 0;
      }

      const itemizedBreakdown = familyPlayers
        .filter((p) => (playerAllocations[p.id] || 0) > 0)
        .map((p) => `${p.name}: ${money(playerAllocations[p.id], db.academy?.currency)}`)
        .join(", ");

      const settledSet = new Set(settledInvoiceIds);
      const ledgerEntry: LedgerEntry = cleanFirestoreData(
        normalizeDoubleEntryLedger({
          id: `l-fam-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          date: today,
          account: "Tuition",
          category: "Tuition",
          entry: `Unified Family Payment · ${guardianLabel} (${familyPlayers.map((p) => p.name).join(", ")})`,
          type: "Revenue",
          amount,
          status: "Collected",
          paymentMethod,
          branch: primaryBranch,
          module: "academy",
          playerId: familyPlayers[0].id,
          familyPlayerIds: familyPlayers.map((p) => p.id),
          familyPaymentAllocations: playerAllocations,
          familySettledInvoiceIds: settledInvoiceIds,
          ...(settledInvoiceIds[0] ? { referenceId: settledInvoiceIds[0] } : {}),
          note: [
            `Unified Family Receipt (${paymentMethod})`,
            itemizedBreakdown ? `Breakdown: ${itemizedBreakdown}` : "",
            notes.trim(),
          ]
            .filter(Boolean)
            .join(" · "),
        }),
      );

      // Update open invoices & sibling balances in local state and Firestore
      for (const invId of settledInvoiceIds) {
        const inv = db.invoices.find((i) => i.id === invId);
        if (inv) {
          await patchEntity("invoices", invId, {
            status: "paid",
            paidDate: today,
            paidAmount: inv.amount,
            paymentMethod,
          });
        }
      }

      for (const p of familyPlayers) {
        const deducted = playerAllocations[p.id] || 0;
        if (deducted > 0) {
          const nextBal = Math.max(0, (p.balance || 0) - deducted);
          const shouldActivate = p.status === "Idle" || (nextBal <= 0 && p.status === "Soft flag");
          await patchEntity("players", p.id, {
            balance: nextBal,
            ...(shouldActivate
              ? {
                  status: "Active",
                  idleSinceDate: "",
                  missedSessionsSinceIdle: 0,
                  idleMissedSessionIds: [],
                  crmFollowUpStatus: "Active / Converted",
                  crmMovedAt: today,
                }
              : {}),
          });

          if (shouldActivate) {
            const currentLeads = (dbStore.getSlice("crmLeads") as CrmLead[]) || [];
            const linkedLead = currentLeads.find(
              (l) =>
                (l.linkedPlayerId === p.id || l.id === `crm-player-${p.id}`) &&
                l.stage === "idle_followup",
            );
            if (linkedLead) {
              await patchEntity("crmLeads", linkedLead.id, {
                stage: "active_converted",
                convertedAt: today,
                updatedAt: new Date().toISOString(),
              });
            }
          }
        }
      }

      await setEntity("ledger", ledgerEntry);

      void dispatchAcademyNotification(tenantId, {
        title: `Unified Family Payment Collected: ${guardianLabel}`,
        message: `Collected ${money(amount, db.academy?.currency)} across ${familyPlayers.length} siblings (${itemizedBreakdown || familyPlayers.map((p) => p.name).join(", ")}) via ${paymentMethod}.${settledSet.size > 0 ? ` Settled ${settledSet.size} invoice(s).` : ""}`,
        type: "billing",
        targetRoles: ["super_admin", "accountant", "branch_manager"],
        targetBranchId: primaryBranch || undefined,
        actionUrl: "/accounting",
        createdAt: new Date().toISOString(),
        readBy: [],
        dismissedBy: [],
      }).catch(() => {});

      toast.success(
        `Collected ${money(amount, db.academy?.currency)} Unified Family Payment for ${guardianLabel} (${familyPlayers.length} siblings).`,
      );
    },
    [db.players, db.invoices, db.academy?.currency, patchEntity, setEntity, tenantId],
  );

  const updateAcademy = useCallback(
    async (partial: Partial<Academy>) => {
      const prevAcademy = (dbStore.getSlice("academy") as Academy) || db.academy;
      const activeEmail = (user?.email || passwordUser?.email || "").toLowerCase();
      const canModifyPlayersLimit = activeEmail === "geogo3@gmail.com";

      const rawPartial: Partial<Academy> & Record<string, unknown> = { ...partial };
      if (
        !canModifyPlayersLimit &&
        "playersLimit" in rawPartial &&
        rawPartial.playersLimit !== prevAcademy.playersLimit
      ) {
        rawPartial.playersLimit = prevAcademy.playersLimit;
      }

      if ("features" in rawPartial) {
        if (Array.isArray(rawPartial.features)) {
          rawPartial.features = rawPartial.features.filter(
            (f): f is string => typeof f === "string" && Boolean(f),
          );
        } else if (rawPartial.features && typeof rawPartial.features === "object") {
          rawPartial.features = Object.entries(rawPartial.features as Record<string, unknown>)
            .filter(([, v]) => Boolean(v))
            .map(([k]) => k);
        } else {
          rawPartial.features = Array.isArray(prevAcademy.features)
            ? prevAcademy.features.filter((f): f is string => typeof f === "string" && Boolean(f))
            : [
                "calendar",
                "sessions",
                "players",
                "teams",
                "accounting",
                "merchandise",
                "technical",
                "coach",
                "whatsapp",
              ];
        }
      }

      if ("requireGameConfirmation" in rawPartial || "autoConfirmGames" in rawPartial) {
        const nextReq =
          typeof rawPartial.requireGameConfirmation === "boolean"
            ? rawPartial.requireGameConfirmation
            : typeof rawPartial.autoConfirmGames === "boolean"
              ? !rawPartial.autoConfirmGames
              : prevAcademy.requireGameConfirmation !== false;
        rawPartial.requireGameConfirmation = Boolean(nextReq);
        rawPartial.autoConfirmGames = !nextReq;
      }

      if (rawPartial.currency && typeof rawPartial.currency === "string") {
        rawPartial.currencies = [rawPartial.currency];
      }

      const sanitizedPartial = cleanFirestoreData(rawPartial);
      const rootOnlyFields = [
        "academy",
        "ageCategoryRules",
        "lists",
        "roleMap",
        "memberEmails",
        "usernameMap",
      ];
      for (const field of rootOnlyFields) {
        if (field in (sanitizedPartial as Record<string, unknown>)) {
          delete (sanitizedPartial as Record<string, unknown>)[field];
        }
      }
      const updatedAcademy = cleanFirestoreData({
        ...prevAcademy,
        ...sanitizedPartial,
      }) as Academy;
      if (updatedAcademy.currency) {
        updatedAcademy.currencies = [updatedAcademy.currency];
      }
      for (const field of rootOnlyFields) {
        if (field in (updatedAcademy as Record<string, unknown>)) {
          delete (updatedAcademy as Record<string, unknown>)[field];
        }
      }
      dbStore.setSlice("academy", updatedAcademy);
      setDb((prev) => ({ ...prev, academy: updatedAcademy }));

      try {
        await ensureAuthForWrite();
        await atomicUpdateAcademy(tenantId, updatedAcademy as unknown as Record<string, unknown>);
      } catch (err) {
        dbStore.setSlice("academy", prevAcademy);
        setDb((prev) => ({ ...prev, academy: prevAcademy }));
        console.error("Failed to update academy settings:", err);
        const errMsg = err instanceof Error ? err.message : "Sync error";
        toast.error(`Failed to save academy settings: ${errMsg}. Reverting changes.`);
        throw err;
      }
    },
    [tenantId, db.academy, user?.email, passwordUser?.email],
  );

  const resetDemo = useCallback(() => {
    update(() => emptyDB());
  }, [update]);

  const clearData = useCallback(() => {
    update((curr) => ({
      ...blankDB(),
      academy: curr.academy,
      appearance: curr.appearance,
      lists: curr.lists,
    }));
  }, [update]);

  const loadDemo = useCallback(() => {
    update((curr) => ({ ...emptyDB(), academy: curr.academy, appearance: curr.appearance }));
  }, [update]);

  const resetWorkspaceData = useCallback(async () => {
    const blank = blankDB();
    const currentAcademy = (dbStore.getSlice("academy") as Academy) || db.academy || {};
    const preservedPlayersLimit =
      typeof currentAcademy.playersLimit === "number" ? currentAcademy.playersLimit : 400;
    const preservedPlan = currentAcademy.plan || "Pro";
    const preservedRenews = currentAcademy.renews || "Annual";
    const preservedBranchesLimit =
      typeof currentAcademy.branchesLimit === "number" ? currentAcademy.branchesLimit : 10;
    const preservedStorageLimit =
      typeof currentAcademy.storageLimit === "number" ? currentAcademy.storageLimit : 50;

    blank.academy = {
      name: "",
      tagline: "",
      hq: "",
      url: "",
      plan: preservedPlan,
      renews: preservedRenews,
      playersLimit: preservedPlayersLimit,
      branchesLimit: preservedBranchesLimit,
      storageUsed: 0,
      storageLimit: preservedStorageLimit,
      sport: "Basketball",
      currency: "USD",
      currencies: ["USD"],
      logo: null,
      supportPhone: "",
      supportEmail: currentAcademy.supportEmail || "geogo3@gmail.com",
      softDeadline: 7,
      hardDeadline: 30,
      requireGameConfirmation: true,
      autoConfirmGames: false,
      setupDone: false,
      completedSetupSteps: [],
      features: [
        "calendar",
        "sessions",
        "players",
        "teams",
        "accounting",
        "merchandise",
        "technical",
        "coach",
        "whatsapp",
      ],
    };
    blank.users = [
      {
        id: "super-admin-geogo3",
        name: "Georges Khoury",
        email: "geogo3@gmail.com",
        role: "Super Admin",
        branch: "All",
        branchScope: "All branches",
        active: true,
        method: "Google",
      },
      {
        id: "super-admin-jesschakh",
        name: "Jess Chakh",
        email: "jess.chakh22@gmail.com",
        role: "Super Admin",
        branch: "All",
        branchScope: "All branches",
        active: true,
        method: "Google",
      },
      {
        id: "super-admin-piakerbej",
        name: "Pia Kerbej",
        email: "piakerbej@gmail.com",
        role: "Academy Manager",
        branch: "All",
        branchScope: "All branches",
        active: true,
        method: "Google",
      },
    ];

    const collectionsToWipe = [
      "players",
      "teams",
      "coaches",
      "staff",
      "branches",
      "sessions",
      "stock",
      "suppliers",
      "orders",
      "ledger",
      "invoices",
      "plans",
      "drills",
      "groups",
      "notifications",
      "auditLogs",
      "audit_logs",
      "attendance",
      "attendanceMeta",
      "resourceFolders",
      "workshops",
      "cron_logs",
      "crmLeads",
      "courtReservations",
      "gymMembers",
      "physioRecords",
      "posCatalog",
      "posTransactions",
      "errorLogs",
    ];

    // 1. Immediately reset in-memory ReactiveDBStore & DataContext state
    dbStore.clearLocalCache(tenantId);
    dbStore.clearLocalCache();
    dbStore.clearQueryCache();
    dbStore.setWholeDB(blank);
    setDb(() => blank);

    for (const colName of collectionsToWipe) {
      try {
        if (colName === "attendance" || colName === "attendanceMeta") {
          dbStore.setSlice(colName as keyof DB, {} as unknown as DB[keyof DB]);
        } else if (colName in blank) {
          dbStore.setSlice(colName as keyof DB, [] as unknown as DB[keyof DB]);
        }
      } catch {
        /* ignore */
      }
    }
    dbStore.setSlice("academy", blank.academy);
    dbStore.setSlice("users", blank.users);

    // 2. Clear client storage and notify subscribers
    try {
      window.localStorage.removeItem("vv-setup");
      window.localStorage.removeItem(`vv-setup-${tenantId}`);
      window.localStorage.removeItem("dismissedAlerts");
      window.localStorage.removeItem(`vv-billing-${tenantId}`);
      const freshSetup = {
        done: false,
        academyName: "",
        sport: "Basketball",
        logo: null,
        admins: [],
      };
      window.localStorage.setItem(`vv-setup-${tenantId}`, JSON.stringify(freshSetup));
      window.localStorage.setItem("vv-setup", JSON.stringify(freshSetup));
      window.dispatchEvent(new Event("vv-setup-sync"));
    } catch {
      /* ignore */
    }

    // 3. Clear remote Firestore documents concurrently in parallel with a 5s timeout guarantee
    if (tenantId && firestore) {
      const wipeRemote = async () => {
        await ensureAuthForWrite().catch(() => {});

        // Reset tenant root document FIRST so it never races with Setup Wizard submission
        // Ensure playersLimit matches current tenant limits so isPlayersLimitUnchanged() passes in security rules
        try {
          const cleanedBlankAcademy = cleanFirestoreData(blank.academy);
          const tenantRootDocRef = doc(firestore, "tenants", tenantId);
          const currentAuthUid = user?.uid || passwordUser?.id || "";
          const currentAuthEmail = (user?.email || passwordUser?.email || "").trim().toLowerCase();
          const effectiveSuperAdminWhitelist = Array.from(
            new Set(
              [
                ...DEFAULT_PROTECTED_SUPER_ADMIN_EMAILS,
                ...(db.academy?.protectedSuperAdminEmails || []),
                ...getStoredProtectedSuperAdminEmails(),
              ]
                .map((e) =>
                  String(e || "")
                    .trim()
                    .toLowerCase(),
                )
                .filter(Boolean),
            ),
          );

          if (typeof window !== "undefined") {
            try {
              window.localStorage.setItem(
                "vv_protected_super_admins",
                JSON.stringify(effectiveSuperAdminWhitelist),
              );
            } catch {
              // ignore
            }
          }

          const preservedRoleMap: Record<string, string> = {};
          effectiveSuperAdminWhitelist.forEach((em) => {
            preservedRoleMap[em] = "Super Admin";
            const sanitizedId = `super-admin-${em.replace(/[^a-zA-Z0-9]/g, "")}`;
            preservedRoleMap[sanitizedId] = "Super Admin";
          });
          if (
            currentAuthUid &&
            isProtectedSuperAdminEmail(currentAuthEmail, effectiveSuperAdminWhitelist)
          ) {
            preservedRoleMap[currentAuthUid] = "Super Admin";
          } else if (currentAuthUid) {
            preservedRoleMap[currentAuthUid] = "Super Admin";
          }

          const preservedMemberEmails = Array.from(
            new Set([...effectiveSuperAdminWhitelist, currentAuthEmail].filter(Boolean)),
          );

          await setDoc(
            tenantRootDocRef,
            {
              ...cleanedBlankAcademy,
              name: "",
              url: "",
              academy: {
                ...cleanedBlankAcademy,
                protectedSuperAdminEmails: effectiveSuperAdminWhitelist,
              },
              protectedSuperAdminEmails: effectiveSuperAdminWhitelist,
              setupDone: false,
              completedSetupSteps: [],
              playersCount: 0,
              playersUsed: 0,
              branchesCount: 0,
              branchesUsed: 0,
              playersLimit: preservedPlayersLimit,
              roleMap: preservedRoleMap,
              memberEmails: preservedMemberEmails,
            },
            { merge: true },
          );
        } catch (e) {
          console.warn("Error resetting academy doc:", e);
        }

        await Promise.allSettled(
          collectionsToWipe.map(async (colName) => {
            try {
              const colRef = collection(firestore, "tenants", tenantId, colName);
              const snap = await getDocs(colRef);
              if (!snap.empty) {
                const docs = snap.docs;
                for (let i = 0; i < docs.length; i += 400) {
                  const chunk = docs.slice(i, i + 400);
                  const batch = writeBatch(firestore);
                  chunk.forEach((d) => batch.delete(d.ref));
                  await batch.commit();
                }
              }
            } catch (e) {
              console.warn(`Error wiping collection ${colName}:`, e);
            }
          }),
        );

        // Clear users except Protected Super Admins
        try {
          const effectiveSuperAdminWhitelist = Array.from(
            new Set(
              [
                ...DEFAULT_PROTECTED_SUPER_ADMIN_EMAILS,
                ...(db.academy?.protectedSuperAdminEmails || []),
                ...getStoredProtectedSuperAdminEmails(),
              ]
                .map((e) =>
                  String(e || "")
                    .trim()
                    .toLowerCase(),
                )
                .filter(Boolean),
            ),
          );
          const usersColRef = collection(firestore, "tenants", tenantId, "users");
          const snap = await getDocs(usersColRef);
          if (!snap.empty) {
            const batch = writeBatch(firestore);
            const activeEmail = (user?.email || passwordUser?.email || "").toLowerCase();
            snap.docs.forEach((d) => {
              const data = d.data();
              const email = (data.email || "").toLowerCase();
              if (
                !effectiveSuperAdminWhitelist.includes(email) &&
                (!activeEmail || email !== activeEmail)
              ) {
                batch.delete(d.ref);
              }
            });
            await batch.commit();
          }
        } catch (e) {
          console.warn("Error wiping users collection:", e);
        }

        // Ensure active super admin records for all whitelisted emails
        try {
          const effectiveSuperAdminWhitelist = Array.from(
            new Set(
              [
                ...DEFAULT_PROTECTED_SUPER_ADMIN_EMAILS,
                ...(db.academy?.protectedSuperAdminEmails || []),
                ...getStoredProtectedSuperAdminEmails(),
              ]
                .map((e) =>
                  String(e || "")
                    .trim()
                    .toLowerCase(),
                )
                .filter(Boolean),
            ),
          );
          const batch = writeBatch(firestore);
          for (const email of effectiveSuperAdminWhitelist) {
            const sanitizedId = `super-admin-${email.replace(/[^a-zA-Z0-9]/g, "")}`;
            const ref = doc(firestore, "tenants", tenantId, "users", sanitizedId);
            const displayName =
              email === "geogo3@gmail.com"
                ? "Georges Khoury"
                : email === "piakerbej@gmail.com" || email === "piakerbaje@gmail.com"
                  ? "Pia Kerbej"
                  : email === "jess.chakh22@gmail.com"
                    ? "Jess Chakh"
                    : email.split("@")[0];
            batch.set(
              ref,
              {
                id: sanitizedId,
                name: displayName,
                email,
                role: "Super Admin",
                branch: "All",
                branchScope: "All branches",
                active: true,
                method: "Google",
              },
              { merge: true },
            );
          }
          await batch.commit();
        } catch (e) {
          console.warn("Error ensuring super admin records:", e);
        }
      };

      // Cap with 5s timeout so user is never stuck waiting forever
      await Promise.race([wipeRemote(), new Promise((resolve) => setTimeout(resolve, 5000))]);
      dbStore.clearLocalCache(tenantId);
      dbStore.clearQueryCache();
    }
  }, [tenantId, user, passwordUser, db.academy]);

  // Server-Authoritative Billing Cron: Automated monthly invoice generation and overdue suspension checks
  // have been migrated off the browser useEffect to a server-authoritative Firebase Cloud Function
  // (onSchedule("0 0 1 * *") & onSchedule("0 2 * * *")).
  // The client exposes on-demand manual triggers and review workflows below.

  const checkOverdueSuspensions = useCallback(async (): Promise<SuspensionAuditResult> => {
    if (!ready || !db.academy) {
      return { evaluated: 0, flaggedSoft: 0, flaggedInactive: 0, unchanged: 0, changes: [] };
    }

    const softDeadline = typeof db.academy.softDeadline === "number" ? db.academy.softDeadline : 15;
    const hardDeadline = typeof db.academy.hardDeadline === "number" ? db.academy.hardDeadline : 30;

    const playerInvoicesMap = new Map<string, { dueDate: string; status: string }[]>();
    (db.invoices || []).forEach((inv) => {
      if (inv.playerId && inv.status !== "paid" && inv.dueDate) {
        const list = playerInvoicesMap.get(inv.playerId) || [];
        list.push({ dueDate: inv.dueDate, status: inv.status });
        playerInvoicesMap.set(inv.playerId, list);
      }
    });

    const now = Date.now();
    const statusUpdates: {
      id: string;
      status: "Active" | "Soft flag" | "Inactive" | "Suspended";
    }[] = [];
    const changes: {
      playerId: string;
      playerName: string;
      oldStatus: string;
      newStatus: string;
      daysOverdue: number;
    }[] = [];
    let flaggedSoft = 0;
    let flaggedInactive = 0;
    let unchanged = 0;
    let evaluated = 0;

    for (const p of db.players) {
      evaluated++;
      // Never flag or suspend a player with 100% Scholarship / Free exemption
      if (p.isScholarship === true) {
        unchanged++;
        continue;
      }
      const currentBalance = Number(p.balance) || 0;
      const currentStatus = p.status || "Active";

      if (currentBalance <= 0) {
        unchanged++;
        continue;
      }

      const pending = playerInvoicesMap.get(p.id) || [];
      if (pending.length === 0) {
        unchanged++;
        continue;
      }

      let oldestDueTime = Infinity;
      for (const inv of pending) {
        const t = new Date(inv.dueDate).getTime();
        if (!isNaN(t) && t < oldestDueTime) oldestDueTime = t;
      }

      if (oldestDueTime === Infinity) {
        unchanged++;
        continue;
      }

      const daysOverdue = Math.max(0, Math.floor((now - oldestDueTime) / 86400000));
      let nextStatus: "Soft flag" | "Inactive" | undefined;

      if (daysOverdue >= hardDeadline && currentStatus !== "Inactive") {
        nextStatus = "Inactive";
        flaggedInactive++;
      } else if (
        daysOverdue >= softDeadline &&
        daysOverdue < hardDeadline &&
        currentStatus === "Active"
      ) {
        nextStatus = "Soft flag";
        flaggedSoft++;
      }

      if (nextStatus) {
        statusUpdates.push({ id: p.id, status: nextStatus });
        changes.push({
          playerId: p.id,
          playerName: p.name,
          oldStatus: currentStatus,
          newStatus: nextStatus,
          daysOverdue,
        });
      } else {
        unchanged++;
      }
    }

    if (statusUpdates.length > 0) {
      const prevPlayers = (dbStore.getSlice("players") as Player[]) || db.players;
      const updateMap = new Map(statusUpdates.map((u) => [u.id, u.status]));
      const nextPlayers = prevPlayers.map((p) => {
        const newSt = updateMap.get(p.id);
        return newSt ? { ...p, status: newSt } : p;
      });

      dbStore.setSlice("players", nextPlayers);
      setDb((prev) => ({ ...prev, players: nextPlayers }));

      try {
        await atomicUpdatePlayerStatuses(tenantId, statusUpdates);
      } catch (err) {
        dbStore.setSlice("players", prevPlayers);
        setDb((prev) => ({ ...prev, players: prevPlayers }));
        console.error("Failed to commit status updates to Firestore:", err);
        const errMsg = err instanceof Error ? err.message : "Sync error";
        toast.error(`Failed to update player statuses: ${errMsg}. Reverting changes.`);
        throw err;
      }
    }

    const auditLog = {
      id: `audit_suspension_${Date.now()}`,
      tenantId,
      type: "manual_suspension_audit",
      schedule: "on_demand",
      flaggedSoft,
      flaggedInactive,
      unchanged,
      executedAt: new Date().toISOString(),
      status: "success",
    };
    await recordCronLog(tenantId, auditLog).catch(() => {});

    return {
      evaluated,
      flaggedSoft,
      flaggedInactive,
      unchanged,
      changes,
    };
  }, [ready, db.academy, db.invoices, db.players, tenantId]);

  const triggerServerBillingCron = useCallback(
    async (monthIndex?: number, year?: number) => {
      try {
        const { httpsCallable } = await import("firebase/functions");
        const callBilling = httpsCallable(functions, "runBillingCronManual");
        const res = await callBilling({
          tenantId,
          monthIndex,
          year,
        });
        return res.data;
      } catch (e) {
        console.warn(
          "Server callable unavailable or errored, executing local atomic batch fallback:",
          e,
        );
        const monthNames = [
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
        const targetMonth =
          monthIndex !== undefined
            ? monthNames[monthIndex] || "January"
            : new Date().toLocaleString("en-US", { month: "long" });
        const targetYear = year || new Date().getFullYear();
        return await generateMonthlyInvoices(targetMonth, targetYear);
      }
    },
    [tenantId, generateMonthlyInvoices],
  );

  const dispatchNotification = useCallback(
    async (notification: Omit<AcademyNotification, "id" | "tenantId"> & { id?: string }) => {
      const created = await dispatchAcademyNotification(tenantId, notification);
      const current = dbStore.getSlice("notifications") || [];
      dbStore.setSlice("notifications", [created, ...current.filter((n) => n.id !== created.id)]);
      return created;
    },
    [tenantId],
  );

  const markNotificationAsRead = useCallback(
    async (notificationId: string, userId?: string) => {
      const uid = userId || user?.uid || "current-user";
      const current = dbStore.getSlice("notifications") || [];
      const updated = current.map((n) =>
        n.id === notificationId
          ? { ...n, readBy: n.readBy?.includes(uid) ? n.readBy : [...(n.readBy || []), uid] }
          : n,
      );
      dbStore.setSlice("notifications", updated);
      setDb((prev) => ({ ...prev, notifications: updated }));
      try {
        await markNotificationRead(tenantId, notificationId, uid);
      } catch (err) {
        dbStore.setSlice("notifications", current);
        setDb((prev) => ({ ...prev, notifications: current }));
        console.error("Failed to mark notification read in Firestore:", err);
        const errMsg = err instanceof Error ? err.message : "Sync error";
        toast.error(`Failed to mark notification read: ${errMsg}. Reverting.`);
      }
    },
    [tenantId, user?.uid],
  );

  const markAllNotificationsAsRead = useCallback(
    async (notificationIds?: string[], userId?: string) => {
      const uid = userId || user?.uid || "current-user";
      const current = dbStore.getSlice("notifications") || [];
      const idsToMark = notificationIds ?? current.map((n) => n.id);
      if (!idsToMark.length) return;

      const updated = current.map((n) =>
        idsToMark.includes(n.id)
          ? { ...n, readBy: n.readBy?.includes(uid) ? n.readBy : [...(n.readBy || []), uid] }
          : n,
      );
      dbStore.setSlice("notifications", updated);
      setDb((prev) => ({ ...prev, notifications: updated }));
      try {
        await markAllNotificationsRead(tenantId, idsToMark, uid);
      } catch (err) {
        dbStore.setSlice("notifications", current);
        setDb((prev) => ({ ...prev, notifications: current }));
        console.error("Failed to mark notifications read in Firestore:", err);
        const errMsg = err instanceof Error ? err.message : "Sync error";
        toast.error(`Failed to mark notifications read: ${errMsg}. Reverting.`);
      }
    },
    [tenantId, user?.uid],
  );

  const dismissNotification = useCallback(
    async (notificationId: string, userId?: string) => {
      const uid = userId || user?.uid || passwordUser?.id || "current-user";
      const current = dbStore.getSlice("notifications") || [];
      const updated = current.map((n) =>
        n.id === notificationId
          ? {
              ...n,
              dismissedBy: n.dismissedBy?.includes(uid)
                ? n.dismissedBy
                : [...(n.dismissedBy || []), uid],
            }
          : n,
      );
      dbStore.setSlice("notifications", updated);
      setDb((prev) => ({ ...prev, notifications: updated }));
      try {
        await dismissAcademyNotification(tenantId, notificationId, uid);
      } catch (err) {
        dbStore.setSlice("notifications", current);
        setDb((prev) => ({ ...prev, notifications: current }));
        console.error("Failed to dismiss notification in Firestore:", err);
        const errMsg = err instanceof Error ? err.message : "Sync error";
        toast.error(`Failed to dismiss notification: ${errMsg}. Reverting.`);
      }
    },
    [tenantId, user?.uid, passwordUser?.id],
  );

  const editLedgerTransaction = useCallback(
    async (entryId: string, updatedFields: Partial<LedgerEntry>) => {
      const currentLedger = (dbStore.getSlice("ledger") as LedgerEntry[]) || db.ledger || [];
      const entry = currentLedger.find((l) => l.id === entryId);
      if (!entry) return;

      const oldAmount = Math.abs(Number(entry.amount) || 0);
      const newAmount = Math.abs(
        Number(updatedFields.amount !== undefined ? updatedFields.amount : entry.amount) || 0,
      );
      const oldRealized = entry.status === "Collected" || entry.status === "Paid";
      const nextStatus = updatedFields.status ?? entry.status;
      const newRealized = nextStatus === "Collected" || nextStatus === "Paid";

      const oldEffective = oldRealized ? oldAmount : 0;
      const newEffective = newRealized ? newAmount : 0;
      const delta = newEffective - oldEffective; // > 0 means more paid/collected; < 0 means reduced/reverted

      const nextEntry: LedgerEntry = cleanFirestoreData({
        ...entry,
        ...updatedFields,
        id: entry.id,
        amount: newAmount,
        status: nextStatus,
        account: updatedFields.account ?? entry.account,
        category:
          updatedFields.category ?? updatedFields.account ?? entry.category ?? entry.account,
        entry: updatedFields.entry ?? updatedFields.description ?? entry.entry,
        description:
          updatedFields.description ?? updatedFields.entry ?? entry.description ?? entry.entry,
      });

      const isRevenue = nextEntry.type === "Revenue" || (nextEntry.type as string) === "credit";
      const accName = nextEntry.account || nextEntry.category || "";
      const entryTextLower = `${entry.entry || ""} ${entry.description || ""}`.toLowerCase();

      const isInsuranceEntry =
        accName === "Player Insurance" ||
        accName === "Insurance" ||
        entry.category === "Insurance" ||
        entry.id.startsWith("l-ins-");

      try {
        // 0. Player Insurance Fee Reconciliation
        if (isRevenue && isInsuranceEntry) {
          const matchedPlayer =
            (entry.playerId ? db.players.find((p) => p.id === entry.playerId) : undefined) ||
            (entry.referenceId ? db.players.find((p) => p.id === entry.referenceId) : undefined) ||
            db.players.find(
              (p) =>
                p.insuranceLedgerId === entry.id ||
                (p.name && entryTextLower.includes(p.name.toLowerCase().trim())),
            );
          if (matchedPlayer) {
            const playerPatch: Partial<Player> = {
              insuranceFee: newAmount,
              insurancePaid: newRealized,
              insuranceLedgerId: entry.id,
            };
            if (matchedPlayer.insuranceBilledToBalance && delta !== 0) {
              playerPatch.balance = Math.max(0, (matchedPlayer.balance || 0) - delta);
            }
            await patchEntity("players", matchedPlayer.id, playerPatch);
          }
        }

        // 1. Player Tuition / Monthly Fees / Package Upgrade / Invoice Reconciliation
        if (
          isRevenue &&
          !isInsuranceEntry &&
          (accName === "Tuition" ||
            accName === "Monthly fees" ||
            entry.id.startsWith("l-upg-") ||
            Boolean(entry.playerId) ||
            Boolean(
              entry.referenceId &&
              db.invoices.some(
                (i) => i.id === entry.referenceId || i.invoiceNumber === entry.referenceId,
              ),
            ))
        ) {
          const linkedInvoice = entry.referenceId
            ? db.invoices.find(
                (inv) => inv.id === entry.referenceId || inv.invoiceNumber === entry.referenceId,
              )
            : undefined;

          const matchedPlayer =
            (entry.playerId ? db.players.find((p) => p.id === entry.playerId) : undefined) ||
            (linkedInvoice ? db.players.find((p) => p.id === linkedInvoice.playerId) : undefined) ||
            db.players.find((p) => p.name && entryTextLower.includes(p.name.toLowerCase().trim()));

          if (linkedInvoice) {
            const nextInvPaid = newEffective;
            const nextInvStatus = nextInvPaid > 0 ? ("paid" as const) : ("pending" as const);
            await patchEntity("invoices", linkedInvoice.id, {
              status: nextInvStatus,
              paidAmount: nextInvPaid,
              paidDate: nextInvPaid > 0 ? nextEntry.date : "",
              ...(nextEntry.paymentMethod ? { paymentMethod: nextEntry.paymentMethod } : {}),
            });
          } else if (matchedPlayer && delta !== 0 && !entry.id.startsWith("l-upg-")) {
            const fallbackInvoice = db.invoices.find(
              (inv) =>
                inv.playerId === matchedPlayer.id &&
                inv.status === "paid" &&
                (Math.abs((inv.paidAmount || inv.amount) - oldAmount) < 0.01 ||
                  inv.paidDate === entry.date),
            );
            if (fallbackInvoice) {
              const nextInvPaid = newEffective;
              await patchEntity("invoices", fallbackInvoice.id, {
                status: nextInvPaid > 0 ? "paid" : "pending",
                paidAmount: nextInvPaid,
                paidDate: nextInvPaid > 0 ? nextEntry.date : "",
              });
            }
          }

          if (matchedPlayer) {
            const nextBalance = Math.max(0, (matchedPlayer.balance || 0) - delta);
            const updatedPayments = Array.isArray(matchedPlayer.payments)
              ? matchedPlayer.payments.map((pmt) =>
                  pmt.id === entry.id ||
                  (pmt.date === entry.date && Math.abs(pmt.amount - oldAmount) < 0.01)
                    ? {
                        ...pmt,
                        amount: newAmount,
                        date: nextEntry.date,
                        notes: nextEntry.note || pmt.notes || "",
                      }
                    : pmt,
                )
              : undefined;
            const shouldActivateFromLedgerPayment =
              delta > 0 &&
              (matchedPlayer.status === "Idle" ||
                (nextBalance <= 0 && matchedPlayer.status === "Soft flag"));
            await patchEntity("players", matchedPlayer.id, {
              balance: nextBalance,
              ...(shouldActivateFromLedgerPayment
                ? {
                    status: "Active",
                    idleSinceDate: "",
                    missedSessionsSinceIdle: 0,
                    idleMissedSessionIds: [],
                  }
                : {}),
              ...(updatedPayments ? { payments: updatedPayments } : {}),
            });
          }
        }

        // 2. Merchandise Order Payment Reconciliation
        if (
          isRevenue &&
          (accName === "Merchandise" ||
            accName === "Merchandise Revenue" ||
            Boolean(entry.orderId) ||
            Boolean(entry.referenceId && db.orders.some((o) => o.id === entry.referenceId)))
        ) {
          const linkedOrder =
            (entry.orderId ? db.orders.find((o) => o.id === entry.orderId) : undefined) ||
            (entry.referenceId ? db.orders.find((o) => o.id === entry.referenceId) : undefined) ||
            db.orders.find(
              (o) =>
                o.player &&
                entryTextLower.includes(o.player.toLowerCase().trim()) &&
                o.date === entry.date,
            );
          if (linkedOrder && delta !== 0) {
            const nextOrderPaid = Math.max(0, (linkedOrder.paid || 0) + delta);
            await patchEntity("orders", linkedOrder.id, { paid: nextOrderPaid });
            const matchedPlayer =
              (linkedOrder.playerId
                ? db.players.find((p) => p.id === linkedOrder.playerId)
                : undefined) ||
              db.players.find(
                (p) =>
                  p.name.toLowerCase().trim() === (linkedOrder.player || "").toLowerCase().trim(),
              );
            if (matchedPlayer) {
              await patchEntity("players", matchedPlayer.id, {
                balance: Math.max(0, (matchedPlayer.balance || 0) - delta),
              });
            }
          }
        }

        // 3. Coach Payroll Disbursement Reconciliation (supports negative outstanding = Advance / On-Account)
        if (
          accName === "Coach Payroll Expense" ||
          accName === "Coach payroll" ||
          accName === "Coach Salaries" ||
          Boolean(entry.coachId) ||
          entry.referenceId?.startsWith("payroll-") ||
          entry.id.startsWith("payroll-")
        ) {
          const matchedCoach = (db.coaches || []).find(
            (c) =>
              (entry.coachId && c.id === entry.coachId) ||
              (entry.referenceId &&
                (entry.referenceId === c.id || entry.referenceId.endsWith(`-${c.id}`))) ||
              entry.id.startsWith(`payroll-${c.id}-`) ||
              (c.name && entryTextLower.includes(c.name.toLowerCase().trim())),
          );
          if (matchedCoach && delta !== 0) {
            await patchEntity("coaches", matchedCoach.id, {
              outstanding: Math.round(((matchedCoach.outstanding || 0) - delta) * 100) / 100,
            });
          }
        }

        // 4. Staff HR Salary Payment Reconciliation
        if (
          accName === "Staff Salaries" ||
          Boolean(entry.staffId) ||
          entry.referenceId?.startsWith("pay-")
        ) {
          const matchedStaff = (db.staff || []).find(
            (s) =>
              (entry.staffId && s.id === entry.staffId) ||
              (entry.referenceId && s.payments?.some((p) => p.id === entry.referenceId)) ||
              (s.name && entryTextLower.includes(s.name.toLowerCase().trim())),
          );
          if (matchedStaff && Array.isArray(matchedStaff.payments)) {
            const updatedPayments = matchedStaff.payments.map((p) => {
              if (
                (entry.referenceId && p.id === entry.referenceId) ||
                (!entry.referenceId &&
                  p.date === entry.date &&
                  Math.abs((p.amount || 0) - oldAmount) < 0.01)
              ) {
                return {
                  ...p,
                  amount: newAmount,
                  date: nextEntry.date,
                  notes: nextEntry.note || p.notes || "",
                };
              }
              return p;
            });
            await patchEntity("staff", matchedStaff.id, { payments: updatedPayments });
          }
        }
      } catch (reconcileErr) {
        logSystemError({
          source: "transaction",
          operation: `editLedgerTransaction(${entryId})`,
          error: reconcileErr,
          payload: { entryId, updatedFields },
          tenantId,
        });
        console.warn("Notice reconciling linked entity during ledger edit:", reconcileErr);
      }

      try {
        await setEntity("ledger", nextEntry);
      } catch (err) {
        logSystemError({
          source: "transaction",
          operation: `editLedgerTransaction.setEntity(${entryId})`,
          error: err,
          payload: nextEntry,
          tenantId,
        });
        throw err;
      }
    },
    [
      db.invoices,
      db.players,
      db.orders,
      db.coaches,
      db.staff,
      db.ledger,
      patchEntity,
      setEntity,
      tenantId,
    ],
  );

  const deleteLedgerTransaction = useCallback(
    async (entryId: string) => {
      const currentLedger = (dbStore.getSlice("ledger") as LedgerEntry[]) || db.ledger || [];
      const entry = currentLedger.find((l) => l.id === entryId);
      if (!entry) return;

      const entryAmount = Math.abs(Number(entry.amount) || 0);
      const isRevenue = entry.type === "Revenue" || (entry.type as string) === "credit";
      const isRealized = entry.status === "Collected" || entry.status === "Paid";
      const accName = entry.account || entry.category || "";
      const entryTextLower = `${entry.entry || ""} ${entry.description || ""}`.toLowerCase();

      const isInsuranceEntry =
        accName === "Player Insurance" ||
        accName === "Insurance" ||
        entry.category === "Insurance" ||
        entry.id.startsWith("l-ins-");

      try {
        // 0. Reconcile Player Insurance Payment
        if (isRevenue && isInsuranceEntry) {
          const matchedPlayer =
            (entry.playerId ? db.players.find((p) => p.id === entry.playerId) : undefined) ||
            (entry.referenceId ? db.players.find((p) => p.id === entry.referenceId) : undefined) ||
            db.players.find(
              (p) =>
                p.insuranceLedgerId === entry.id ||
                (p.name && entryTextLower.includes(p.name.toLowerCase().trim())),
            );
          if (matchedPlayer) {
            await patchEntity("players", matchedPlayer.id, {
              insurancePaid: false,
              insuranceLedgerId: "",
              ...(isRealized && matchedPlayer.insuranceBilledToBalance
                ? { balance: (matchedPlayer.balance || 0) + entryAmount }
                : {}),
            });
          }
        }

        // 1. Reconcile Player Tuition Payment / Package Upgrade / Invoice (including Unified Family Receipts)
        if (
          isRevenue &&
          !isInsuranceEntry &&
          (accName === "Tuition" ||
            accName === "Monthly fees" ||
            entry.id.startsWith("l-upg-") ||
            Boolean(entry.playerId) ||
            Boolean(entry.familyPlayerIds && entry.familyPlayerIds.length > 0) ||
            Boolean(
              entry.referenceId &&
              db.invoices.some(
                (i) => i.id === entry.referenceId || i.invoiceNumber === entry.referenceId,
              ),
            ))
        ) {
          if (
            entry.familyPaymentAllocations &&
            Object.keys(entry.familyPaymentAllocations).length > 0
          ) {
            if (Array.isArray(entry.familySettledInvoiceIds)) {
              for (const invId of entry.familySettledInvoiceIds) {
                const inv = db.invoices.find((i) => i.id === invId);
                if (inv && inv.status === "paid") {
                  await patchEntity("invoices", inv.id, {
                    status: "pending",
                    paidDate: "",
                    paidAmount: 0,
                  });
                }
              }
            }
            if (isRealized) {
              for (const [sibId, allocAmt] of Object.entries(entry.familyPaymentAllocations)) {
                const amt = Number(allocAmt) || 0;
                if (amt > 0) {
                  const sib = db.players.find((p) => p.id === sibId);
                  if (sib) {
                    await patchEntity("players", sib.id, {
                      balance: (sib.balance || 0) + amt,
                    });
                  }
                }
              }
            }
          } else {
            const linkedInvoice = entry.referenceId
              ? db.invoices.find(
                  (inv) => inv.id === entry.referenceId || inv.invoiceNumber === entry.referenceId,
                )
              : undefined;

            const matchedPlayer =
              (entry.playerId ? db.players.find((p) => p.id === entry.playerId) : undefined) ||
              (linkedInvoice
                ? db.players.find((p) => p.id === linkedInvoice.playerId)
                : undefined) ||
              db.players.find(
                (p) => p.name && entryTextLower.includes(p.name.toLowerCase().trim()),
              );

            if (linkedInvoice && linkedInvoice.status === "paid") {
              await patchEntity("invoices", linkedInvoice.id, {
                status: "pending",
                paidDate: "",
                paidAmount: 0,
              });
            } else if (matchedPlayer && !entry.id.startsWith("l-upg-")) {
              // Revert matching paid invoices up to entryAmount
              const candidateInvoices = db.invoices.filter(
                (inv) =>
                  inv.playerId === matchedPlayer.id &&
                  inv.status === "paid" &&
                  (Math.abs((inv.paidAmount || inv.amount) - entryAmount) < 0.01 ||
                    inv.paidDate === entry.date),
              );
              let remainingToRevert = entryAmount;
              for (const inv of candidateInvoices) {
                if (remainingToRevert <= 0) break;
                remainingToRevert -= inv.paidAmount || inv.amount;
                await patchEntity("invoices", inv.id, {
                  status: "pending",
                  paidDate: "",
                  paidAmount: 0,
                });
              }
            }

            if (matchedPlayer && isRealized) {
              const updatedPayments = Array.isArray(matchedPlayer.payments)
                ? matchedPlayer.payments.filter(
                    (pmt) =>
                      pmt.id !== entry.id &&
                      !(pmt.date === entry.date && Math.abs(pmt.amount - entryAmount) < 0.01),
                  )
                : undefined;
              await patchEntity("players", matchedPlayer.id, {
                balance: (matchedPlayer.balance || 0) + entryAmount,
                ...(updatedPayments ? { payments: updatedPayments } : {}),
              });
            }
          }
        }

        // 2. Reconcile Merchandise Order Payment
        if (
          isRevenue &&
          (accName === "Merchandise" ||
            accName === "Merchandise Revenue" ||
            Boolean(entry.orderId) ||
            Boolean(entry.referenceId && db.orders.some((o) => o.id === entry.referenceId)))
        ) {
          const linkedOrder =
            (entry.orderId ? db.orders.find((o) => o.id === entry.orderId) : undefined) ||
            (entry.referenceId ? db.orders.find((o) => o.id === entry.referenceId) : undefined) ||
            db.orders.find(
              (o) =>
                o.player &&
                entryTextLower.includes(o.player.toLowerCase().trim()) &&
                o.date === entry.date,
            );
          if (linkedOrder && isRealized) {
            await patchEntity("orders", linkedOrder.id, {
              paid: Math.max(0, (linkedOrder.paid || 0) - entryAmount),
            });
            const matchedPlayer =
              (linkedOrder.playerId
                ? db.players.find((p) => p.id === linkedOrder.playerId)
                : undefined) ||
              db.players.find(
                (p) =>
                  p.name.toLowerCase().trim() === (linkedOrder.player || "").toLowerCase().trim(),
              );
            if (matchedPlayer) {
              await patchEntity("players", matchedPlayer.id, {
                balance: (matchedPlayer.balance || 0) + entryAmount,
              });
            }
          }
        }

        // 3. Reconcile Staff Salaries entry
        if (
          accName === "Staff Salaries" ||
          entry.referenceId?.startsWith("pay-") ||
          Boolean(entry.staffId)
        ) {
          const matchedStaff = (db.staff || []).find(
            (s) =>
              (entry.staffId && s.id === entry.staffId) ||
              (entry.referenceId && s.payments?.some((p) => p.id === entry.referenceId)) ||
              (s.name && entryTextLower.includes(s.name.toLowerCase().trim())),
          );
          if (matchedStaff && matchedStaff.payments && matchedStaff.payments.length > 0) {
            const updatedPayments = matchedStaff.payments.filter((p) => {
              if (entry.referenceId && p.id === entry.referenceId) return false;
              if (
                !entry.referenceId &&
                p.date === entry.date &&
                Math.abs((p.amount || 0) - entryAmount) < 0.01
              ) {
                return false;
              }
              return true;
            });
            if (updatedPayments.length !== matchedStaff.payments.length) {
              await patchEntity("staff", matchedStaff.id, { payments: updatedPayments });
            }
          }
        }

        // 4. Reconcile Coach Payroll Expense entry
        if (
          accName === "Coach Payroll Expense" ||
          accName === "Coach payroll" ||
          accName === "Coach Salaries" ||
          Boolean(entry.coachId) ||
          entry.referenceId?.startsWith("payroll-") ||
          entry.id.startsWith("payroll-")
        ) {
          const matchedCoach = (db.coaches || []).find(
            (c) =>
              (entry.coachId && c.id === entry.coachId) ||
              (entry.referenceId &&
                (entry.referenceId === c.id || entry.referenceId.endsWith(`-${c.id}`))) ||
              entry.id.startsWith(`payroll-${c.id}-`) ||
              (c.name && entryTextLower.includes(c.name.toLowerCase().trim())),
          );
          if (matchedCoach && isRealized) {
            await patchEntity("coaches", matchedCoach.id, {
              outstanding: Math.round(((matchedCoach.outstanding || 0) + entryAmount) * 100) / 100,
            });
          }
        }
      } catch (reconcileErr) {
        logSystemError({
          source: "transaction",
          operation: `deleteLedgerTransaction(${entryId})`,
          error: reconcileErr,
          payload: { entryId, entry },
          tenantId,
        });
        console.warn("Error reconciling linked entity during ledger deletion:", reconcileErr);
      }

      try {
        await deleteEntity("ledger", entry.id);
      } catch (err) {
        logSystemError({
          source: "transaction",
          operation: `deleteLedgerTransaction.deleteEntity(${entryId})`,
          error: err,
          payload: { entryId, entry },
          tenantId,
        });
        throw err;
      }
    },
    [
      db.invoices,
      db.players,
      db.orders,
      db.staff,
      db.coaches,
      db.ledger,
      patchEntity,
      deleteEntity,
      tenantId,
    ],
  );

  const ensureCollection = useCallback(
    (key: keyof DB) => {
      if (isAuthenticated && tenantId) {
        ensureCollectionSubscribed(key, tenantId);
      }
    },
    [isAuthenticated, tenantId],
  );

  const actionsValue = useMemo<DataActionsCtxValue>(
    () => ({
      tenantId,
      ready,
      ensureCollection,
      update,
    }),
    [tenantId, ready, ensureCollection, update],
  );

  const movePlayerToCrmFollowUp = useCallback(
    async (
      playerId: string,
      targetStage: "idle_followup" | "lost_churned" = "idle_followup",
      options?: { churnReason?: string; reEngagementNotes?: string },
    ) => {
      const currentPlayers = (dbStore.getSlice("players") as Player[]) || db.players || [];
      const targetPlayer = currentPlayers.find((p) => p.id === playerId);
      if (!targetPlayer) return;

      const todayIso = new Date().toISOString().slice(0, 10);
      const nowIso = new Date().toISOString();
      const currentLeads = (dbStore.getSlice("crmLeads") as CrmLead[]) || db.crmLeads || [];
      const existingLead = currentLeads.find(
        (l) =>
          l.linkedPlayerId === playerId ||
          l.id === `crm-player-${playerId}` ||
          l.playerName.trim().toLowerCase() === targetPlayer.name.trim().toLowerCase(),
      );

      const idleStart = targetPlayer.idleSinceDate || todayIso;
      const idleDays = Math.max(
        0,
        Math.floor((Date.now() - new Date(idleStart).getTime()) / (1000 * 60 * 60 * 24)) || 0,
      );

      const stageLabel =
        targetStage === "lost_churned" ? "Lost Clients / Churned" : "Idle / At-Risk Follow-Up";

      const logNote: CrmCommunicationEntry = {
        id: `comm-${Date.now()}-${(crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000).toString(36).slice(2, 6)}`,
        type: "In-Person",
        note:
          targetStage === "lost_churned"
            ? `Moved player from Idle to Lost Clients / Churned (${options?.churnReason || "Subscription renewal not completed after Idle period"}).`
            : `Synced Idle player into CRM Follow-Up (${targetPlayer.missedSessionsSinceIdle ?? 0} sessions missed since ${idleStart}).`,
        timestamp: nowIso,
        author: user?.email || passwordUser?.email || "Academy Admin",
      };

      const upsertedLead: CrmLead = {
        id: existingLead?.id || `crm-player-${playerId}`,
        stage: targetStage,
        playerName: targetPlayer.name,
        gender: targetPlayer.gender,
        dob: targetPlayer.dob || existingLead?.dob || "2013-01-01",
        category: targetPlayer.category || existingLead?.category || "U-14",
        preferredBranch: targetPlayer.branch || existingLead?.preferredBranch || "HQ",
        preferredPosition: existingLead?.preferredPosition || "PG",
        source: existingLead?.source || "Academy Renewal Pipeline",
        parentName: targetPlayer.parent || existingLead?.parentName || "",
        parentPhone: targetPlayer.parentPhone || existingLead?.parentPhone || "",
        parentEmail: existingLead?.parentEmail || "",
        guardian2Name: targetPlayer.guardian2Name || existingLead?.guardian2Name || "",
        guardian2Phone: targetPlayer.guardian2Phone || existingLead?.guardian2Phone || "",
        school: targetPlayer.school || existingLead?.school || "",
        medicalNotes: targetPlayer.medicalNotes || existingLead?.medicalNotes || "",
        generalNotes:
          existingLead?.generalNotes ||
          `Linked Academy Player (${targetPlayer.teams?.join(", ") || "Unassigned"}).`,
        linkedPlayerId: targetPlayer.id,
        idleSinceDate: idleStart,
        missedSessionsSinceIdle: targetPlayer.missedSessionsSinceIdle ?? 0,
        lastTeam:
          (Array.isArray(targetPlayer.teams) && targetPlayer.teams[0]) ||
          existingLead?.lastTeam ||
          "",
        idleDurationDays: idleDays,
        ...(targetStage === "lost_churned"
          ? {
              churnReason:
                options?.churnReason ||
                existingLead?.churnReason ||
                `Exceeded Idle period (${idleDays}d idle, ${targetPlayer.missedSessionsSinceIdle ?? 0} missed sessions)`,
              reEngagementNotes:
                options?.reEngagementNotes ||
                existingLead?.reEngagementNotes ||
                "Follow up before next seasonal camp / cycle.",
              churnedAt: todayIso,
            }
          : {}),
        communications: [logNote, ...(existingLead?.communications || [])],
        reminders: existingLead?.reminders || [],
        createdAt: existingLead?.createdAt || nowIso,
        updatedAt: nowIso,
      };

      await setEntity("crmLeads", upsertedLead);

      await patchEntity("players", playerId, {
        ...(targetStage === "lost_churned" ? { status: "Inactive" as const } : {}),
        crmFollowUpStatus: stageLabel,
        crmMovedAt: todayIso,
      });

      toast.success(`Moved ${targetPlayer.name} to CRM: ${stageLabel}.`);
    },
    [db.players, db.crmLeads, patchEntity, setEntity, user?.email, passwordUser?.email],
  );

  const convertCrmLeadToPlayer = useCallback(
    async (leadId: string): Promise<Player | null> => {
      const currentLeads = (dbStore.getSlice("crmLeads") as CrmLead[]) || db.crmLeads || [];
      const lead = currentLeads.find((l) => l.id === leadId);
      if (!lead) return null;

      const currentPlayers = (dbStore.getSlice("players") as Player[]) || db.players || [];
      const nowIso = new Date().toISOString();
      const todayIso = nowIso.slice(0, 10);

      const existingPlayer = lead.linkedPlayerId
        ? currentPlayers.find((p) => p.id === lead.linkedPlayerId)
        : currentPlayers.find(
            (p) => p.name.trim().toLowerCase() === lead.playerName.trim().toLowerCase(),
          );

      if (existingPlayer) {
        const updatedPlayer: Player = {
          ...existingPlayer,
          status: "Active",
          idleSinceDate: "",
          missedSessionsSinceIdle: 0,
          idleMissedSessionIds: [],
          crmFollowUpStatus: "Active / Converted",
          crmMovedAt: todayIso,
          ...(lead.offeredMonthlyFee != null ? { fee: Number(lead.offeredMonthlyFee) } : {}),
          ...(lead.offeredPackageId ? { packageId: lead.offeredPackageId } : {}),
        };
        await setEntity("players", updatedPlayer);

        const commEntry: CrmCommunicationEntry = {
          id: `comm-${Date.now()}`,
          type: "In-Person",
          note: `Reactivated existing Academy player (${updatedPlayer.name}) as Active.`,
          timestamp: nowIso,
          author: user?.email || passwordUser?.email || "Academy Admin",
        };
        await setEntity("crmLeads", {
          ...lead,
          stage: "active_converted",
          linkedPlayerId: updatedPlayer.id,
          convertedAt: todayIso,
          updatedAt: nowIso,
          communications: [commEntry, ...(lead.communications || [])],
        });
        toast.success(`Activated ${updatedPlayer.name} in the Academy Roster!`);
        return updatedPlayer;
      }

      const newPlayerId = `p-${Date.now().toString(36)}`;
      const assignedTeams = lead.trialTeam
        ? [lead.trialTeam]
        : lead.lastTeam
          ? [lead.lastTeam]
          : [];
      const newPlayer: Player = {
        id: newPlayerId,
        name: lead.playerName.trim(),
        gender: lead.gender || "Male",
        dob: lead.dob || "2013-01-01",
        category: lead.category || "U-14",
        teams: assignedTeams,
        branch: lead.preferredBranch || "HQ",
        phone: lead.parentPhone || "",
        parent: lead.parentName || "Parent / Guardian",
        parentPhone: lead.parentPhone || "",
        guardian2Name: lead.guardian2Name || "",
        guardian2Phone: lead.guardian2Phone || "",
        school: lead.school || "",
        fee: lead.offeredMonthlyFee != null ? Number(lead.offeredMonthlyFee) : 85,
        packageId: lead.offeredPackageId || undefined,
        status: "Active",
        balance: 0,
        medicalNotes: lead.medicalNotes || "",
        attendance: "100%",
        crmFollowUpStatus: "Active / Converted",
        crmMovedAt: todayIso,
      };

      await setEntity("players", newPlayer);

      const commEntry: CrmCommunicationEntry = {
        id: `comm-${Date.now()}`,
        type: "In-Person",
        note: `Converted CRM Lead into Active Academy Player (ID: ${newPlayerId}).`,
        timestamp: nowIso,
        author: user?.email || passwordUser?.email || "Academy Admin",
      };

      await setEntity("crmLeads", {
        ...lead,
        stage: "active_converted",
        linkedPlayerId: newPlayerId,
        convertedAt: todayIso,
        updatedAt: nowIso,
        communications: [commEntry, ...(lead.communications || [])],
      });

      toast.success(`Created & activated ${newPlayer.name} in the Academy database!`);
      return newPlayer;
    },
    [db.crmLeads, db.players, setEntity, user?.email, passwordUser?.email],
  );

  const runCrmAutoChurnCheck = useCallback(
    async (options?: { silent?: boolean }): Promise<number> => {
      const crmSettings = db.academy?.crmSettings || DEFAULT_CRM_SETTINGS;
      if (!crmSettings.autoChurnEnabled) {
        if (!options?.silent) {
          toast.info("Auto-Churn is currently disabled in CRM Settings.");
        }
        return 0;
      }

      const thresholdDays =
        crmSettings.autoChurnMode === "1_month"
          ? 30
          : Math.max(1, Number(crmSettings.autoChurnWeeks) || 4) * 7;

      const currentPlayers = (dbStore.getSlice("players") as Player[]) || db.players || [];
      const currentLeads = (dbStore.getSlice("crmLeads") as CrmLead[]) || db.crmLeads || [];
      const currentSessions = (dbStore.getSlice("sessions") as SessionItem[]) || db.sessions || [];
      const currentAttendance = dbStore.getSlice("attendance") || db.attendance || {};
      const currentInvoices = (dbStore.getSlice("invoices") as Invoice[]) || db.invoices || [];

      const todayIso = new Date().toISOString().slice(0, 10);
      const nowMs = Date.now();
      let churnedCount = 0;

      for (const p of currentPlayers) {
        if (p.status !== "Idle" || !p.idleSinceDate) continue;
        const idleStartMs = new Date(p.idleSinceDate).getTime();
        if (Number.isNaN(idleStartMs)) continue;

        const daysIdle = Math.floor((nowMs - idleStartMs) / (1000 * 60 * 60 * 24));
        if (daysIdle < thresholdDays) continue;

        const attendedSinceIdle = currentSessions.some((s) => {
          if (!s || (s.status || "").toLowerCase() === "cancelled") return false;
          if (!s.date || s.date < p.idleSinceDate!) return false;
          const mapForSess = currentAttendance[s.id];
          const recStatus = mapForSess?.[p.id];
          if (typeof recStatus === "string") {
            return recStatus.toLowerCase() === "present";
          }
          return Array.isArray(s.attendees) && s.attendees.includes(p.id);
        });

        const paidSinceIdle =
          currentInvoices.some((inv) => {
            if (inv.playerId !== p.id || inv.status !== "paid") return false;
            return Boolean(inv.paidDate && inv.paidDate >= p.idleSinceDate!);
          }) ||
          (Array.isArray(p.payments) &&
            p.payments.some(
              (pmt) => Boolean(pmt.date && pmt.date >= p.idleSinceDate!) && pmt.amount > 0,
            ));

        if (attendedSinceIdle || paidSinceIdle) continue;

        // Already marked as lost_churned in CRM?
        const existingLead = currentLeads.find((l) => l.linkedPlayerId === p.id);
        if (existingLead && existingLead.stage === "lost_churned") continue;

        const thresholdLabel =
          crmSettings.autoChurnMode === "1_month"
            ? "1 Month (30 days)"
            : `${crmSettings.autoChurnWeeks} Weeks (${thresholdDays} days)`;

        await movePlayerToCrmFollowUp(p.id, "lost_churned", {
          churnReason: `Auto-Churned: Idle since ${p.idleSinceDate} (${daysIdle} days > ${thresholdLabel} threshold without payment or attendance)`,
          reEngagementNotes:
            "Automatically moved by Idle-to-Lost CRM automation. Schedule parent check-in.",
        });

        await dispatchNotification({
          id: `crm-autochurn-${p.id}-${todayIso}`,
          type: "billing_automation",
          priority: "high",
          title: `CRM Auto-Churn: ${p.name}`,
          message: `${p.name} was automatically moved from Idle to Lost Clients / Churned after ${daysIdle} days without payment or attendance (threshold: ${thresholdLabel}).`,
          createdAt: new Date().toISOString(),
          readBy: [],
          dismissedBy: [],
          targetPlayerId: p.id,
          targetPlayerName: p.name,
          isIdleFollowUpAlert: true,
          link: "/crm",
        });

        churnedCount += 1;
      }

      if (!options?.silent) {
        if (churnedCount > 0) {
          toast.success(
            `Auto-Churn moved ${churnedCount} Idle player(s) to Lost Clients / Churned.`,
          );
        } else {
          toast.info("No Idle players exceeded the configured Auto-Churn threshold.");
        }
      }

      return churnedCount;
    },
    [
      db.academy?.crmSettings,
      db.players,
      db.crmLeads,
      db.sessions,
      db.attendance,
      db.invoices,
      movePlayerToCrmFollowUp,
      dispatchNotification,
    ],
  );

  // Automatically evaluate Idle-to-Lost Auto-Churn when data store is ready
  const autoChurnCheckedRef = useRef<string>("");
  useEffect(() => {
    if (!ready || !isAuthenticated) return;
    const idlePlayersSignature = (db.players || [])
      .filter((p) => p.status === "Idle" && p.idleSinceDate)
      .map((p) => `${p.id}:${p.idleSinceDate}`)
      .join("|");
    const settingsSig = JSON.stringify(db.academy?.crmSettings || DEFAULT_CRM_SETTINGS);
    const combinedSig = `${idlePlayersSignature}::${settingsSig}`;
    if (!idlePlayersSignature || autoChurnCheckedRef.current === combinedSig) return;
    autoChurnCheckedRef.current = combinedSig;
    runCrmAutoChurnCheck({ silent: true }).catch(() => {});
  }, [ready, isAuthenticated, db.players, db.academy?.crmSettings, runCrmAutoChurnCheck]);

  const setPlayerIdleForRenewal = useCallback(
    async (playerId?: string, idleDate?: string): Promise<number> => {
      const todayIso = idleDate || new Date().toISOString().slice(0, 10);
      const currentYm = todayIso.slice(0, 7);
      const currentPlayers = (dbStore.getSlice("players") as Player[]) || db.players || [];
      const currentSessions = (dbStore.getSlice("sessions") as SessionItem[]) || db.sessions || [];
      const currentAttendance = dbStore.getSlice("attendance") || db.attendance || {};
      const currentInvoices = (dbStore.getSlice("invoices") as Invoice[]) || db.invoices || [];

      if (playerId) {
        const target = currentPlayers.find((p) => p.id === playerId);
        if (!target) return 0;
        await patchEntity("players", playerId, {
          status: "Idle",
          idleSinceDate: todayIso,
          missedSessionsSinceIdle: 0,
          idleMissedSessionIds: [],
        });
        toast.success(`${target.name} set to Idle (Pending Renewal) since ${todayIso}.`);
        return 1;
      }

      // Cycle renewal across all eligible Active players who haven't paid or attended in currentYm
      const candidates = currentPlayers.filter((p) => {
        if (p.status !== "Active") return false;
        if (p.isScholarship === true) return false;
        const attendedInCycle =
          getPlayerMonthlyPresentCount(p.id, currentSessions, currentAttendance, currentYm) > 0;
        const paidInCycle =
          currentInvoices.some((inv) => {
            if (inv.playerId !== p.id || inv.status !== "paid") return false;
            const invYm = `${inv.year}-${String(inv.month).padStart(2, "0")}`;
            return invYm >= currentYm || Boolean(inv.paidDate && inv.paidDate >= `${currentYm}-01`);
          }) ||
          (Array.isArray(p.payments) &&
            p.payments.some((pmt) => pmt.date?.startsWith(currentYm) && pmt.amount > 0));
        return !attendedInCycle && !paidInCycle;
      });

      if (candidates.length === 0) {
        toast.info("All active players have already attended or paid for this cycle.");
        return 0;
      }

      const candidateIds = new Set(candidates.map((c) => c.id));
      const nextPlayers = currentPlayers.map((p) =>
        candidateIds.has(p.id)
          ? {
              ...p,
              status: "Idle" as const,
              idleSinceDate: todayIso,
              missedSessionsSinceIdle: 0,
              idleMissedSessionIds: [],
            }
          : p,
      );
      dbStore.setSlice("players", nextPlayers);
      setDb((prev) => ({ ...prev, players: nextPlayers }));

      await atomicUpdatePlayerStatuses(
        tenantId,
        candidates.map((c) => ({
          id: c.id,
          status: "Idle",
          idleSinceDate: todayIso,
          missedSessionsSinceIdle: 0,
          idleMissedSessionIds: [],
        })),
      );
      toast.success(
        `Transitioned ${candidates.length} player(s) to Idle (Pending Renewal) for the new monthly cycle.`,
      );
      return candidates.length;
    },
    [db.players, db.sessions, db.attendance, db.invoices, patchEntity, tenantId],
  );

  const value = useMemo(
    () => ({
      db,
      ready,
      tenantId,
      ensureCollection,
      update,
      setEntity,
      deleteEntity,
      patchEntity,
      recordAttendance,
      processMerchandiseTransaction,
      settleMerchandiseOrder,
      generateMonthlyInvoices,
      checkOverdueSuspensions,
      triggerServerBillingCron,
      payInvoice,
      payFamilyBalance,
      editLedgerTransaction,
      deleteLedgerTransaction,
      updateAcademy,
      dispatchNotification,
      markNotificationAsRead,
      markAllNotificationsAsRead,
      dismissNotification,
      movePlayerToCrmFollowUp,
      convertCrmLeadToPlayer,
      runCrmAutoChurnCheck,
      setPlayerIdleForRenewal,
      runBranchArrayTransaction,
      cascadeBranchAndCourtRename,
      resetDemo,
      clearData,
      loadDemo,
      resetWorkspaceData,
    }),
    [
      db,
      ready,
      tenantId,
      ensureCollection,
      update,
      setEntity,
      deleteEntity,
      patchEntity,
      runBranchArrayTransaction,
      cascadeBranchAndCourtRename,
      recordAttendance,
      processMerchandiseTransaction,
      settleMerchandiseOrder,
      generateMonthlyInvoices,
      checkOverdueSuspensions,
      triggerServerBillingCron,
      payInvoice,
      payFamilyBalance,
      editLedgerTransaction,
      deleteLedgerTransaction,
      updateAcademy,
      dispatchNotification,
      markNotificationAsRead,
      markAllNotificationsAsRead,
      dismissNotification,
      movePlayerToCrmFollowUp,
      convertCrmLeadToPlayer,
      runCrmAutoChurnCheck,
      setPlayerIdleForRenewal,
      resetDemo,
      clearData,
      loadDemo,
      resetWorkspaceData,
    ],
  );

  return (
    <DataActionsCtx.Provider value={actionsValue}>
      <DataCtx.Provider value={value}>{children}</DataCtx.Provider>
    </DataActionsCtx.Provider>
  );
}

export function useDB() {
  const ctx = useContext(DataCtx);
  if (!ctx) throw new Error("useDB must be used inside DataProvider");
  return ctx;
}

export function useDBReady(): boolean {
  const actionsCtx = useContext(DataActionsCtx);
  const fullCtx = useContext(DataCtx);
  return actionsCtx?.ready ?? fullCtx?.ready ?? false;
}

export function normalizeAcademyRole(roleName?: string): AcademyRole {
  if (!roleName) return "coach";
  const lower = roleName.toLowerCase().replace(/[\s_-]+/g, "_");
  if (lower.includes("super")) return "super_admin";
  if (lower.includes("academy")) return "super_admin";
  if (lower.includes("tech")) return "technical_director";
  if (lower.includes("branch")) return "branch_manager";
  if (lower.includes("account")) return "accountant";
  if (lower.includes("coach")) return "coach";
  return "coach";
}

const getUsersSliceSnapshot = () => dbStore.getSlice("users") || [];
const subscribeUsersSlice = (onStoreChange: () => void) =>
  dbStore.subscribe("users", onStoreChange);

const getCoachesSliceSnapshot = () => dbStore.getSlice("coaches") || [];
const subscribeCoachesSlice = (onStoreChange: () => void) =>
  dbStore.subscribe("coaches", onStoreChange);

const getCustomRolesSliceSnapshot = () => dbStore.getSlice("customRoles") || defaultRoleDefinitions;
const subscribeCustomRolesSlice = (onStoreChange: () => void) =>
  dbStore.subscribe("customRoles", onStoreChange);

export function useTenantUser(): (UserAccount & { id: string }) | null {
  const actionsCtx = useContext(DataActionsCtx);
  const fullCtx = useContext(DataCtx);
  const ready = actionsCtx?.ready ?? fullCtx?.ready ?? false;
  const tenantId = actionsCtx?.tenantId ?? fullCtx?.tenantId ?? (getTenantSlug() || "donbosco");
  const { user, passwordUser } = useAuth();

  useEffect(() => {
    if (tenantId && ((user && !user.isAnonymous) || passwordUser || user)) {
      ensureCollectionSubscribed("users", tenantId);
      ensureCollectionSubscribed("coaches", tenantId);
    }
  }, [tenantId, user, passwordUser]);

  const users = useSyncExternalStore(
    subscribeUsersSlice,
    getUsersSliceSnapshot,
    getUsersSliceSnapshot,
  );
  const coaches = useSyncExternalStore(
    subscribeCoachesSlice,
    getCoachesSliceSnapshot,
    getCoachesSliceSnapshot,
  );

  const resolvedTenantUser = useMemo(() => {
    const liveAcademy = dbStore.getSlice("academy");
    const customWhitelist = liveAcademy?.protectedSuperAdminEmails;

    if (tenantId === "rba-demo" && passwordUser) {
      return {
        ...passwordUser,
        id: passwordUser.id || "rba-demo-user",
        role: normalizeUiRole(passwordUser.role),
        branch: passwordUser.branch || "All",
        branchScope: passwordUser.branchScope || "All branches",
        active: true,
      };
    }

    if (passwordUser) {
      const pEmail = (passwordUser.email || "").toLowerCase();
      const pUname = (passwordUser.username || "").toLowerCase();
      const isMasterOwner = pEmail === "geogo3@gmail.com";
      const isSuperAdminEmail = isProtectedSuperAdminEmail(pEmail, customWhitelist);
      const pMatch = users.find(
        (u) =>
          (u.id && u.id === passwordUser.id) ||
          (u.authUid && u.authUid === passwordUser.authUid) ||
          (pEmail && u.email && u.email.toLowerCase() === pEmail) ||
          (pUname && u.username && u.username.toLowerCase() === pUname),
      );
      const coachMatch = !pMatch
        ? coaches.find(
            (c) =>
              (c.id && c.id === passwordUser.id) ||
              (pEmail && c.email && c.email.toLowerCase() === pEmail) ||
              (pUname && c.username && c.username.toLowerCase() === pUname),
          )
        : undefined;
      if (pMatch && pMatch.active === false) {
        return null;
      }
      if (
        ready &&
        users.length > 0 &&
        !pMatch &&
        !coachMatch &&
        !isSuperAdminEmail &&
        passwordUser.method === "Google" &&
        passwordUser.role !== "Coach"
      ) {
        return null;
      }
      const finalName =
        user?.displayName ||
        (isMasterOwner && (passwordUser.name === "Georges Matta" || !passwordUser.name)
          ? "Georges Khoury"
          : coachMatch?.name || passwordUser.name);
      return {
        ...passwordUser,
        ...(pMatch
          ? {
              role:
                isSuperAdminEmail || isSuperAdminRoleOrEmail(pMatch.role, pEmail)
                  ? "Super Admin"
                  : normalizeUiRole(pMatch.role),
              branch: pMatch.branch,
              branchScope: pMatch.branchScope,
              active: pMatch.active !== false,
            }
          : coachMatch
            ? {
                role: isSuperAdminEmail ? "Super Admin" : "Coach",
                branch: coachMatch.branch || passwordUser.branch || "HQ",
                branchScope: "Assigned branch only" as const,
                active: true,
              }
            : {
                role:
                  isSuperAdminEmail || isSuperAdminRoleOrEmail(passwordUser.role, pEmail)
                    ? "Super Admin"
                    : normalizeUiRole(passwordUser.role),
                active: passwordUser.active !== false,
              }),
        name: finalName,
      };
    }

    if (!user) return null;

    const realEmail = (user.email || "").toLowerCase();
    const match = users.find(
      (u) =>
        (u.authUid && u.authUid === user.uid) ||
        (realEmail && u.email && u.email.toLowerCase() === realEmail),
    );
    const coachMatch = !match
      ? coaches.find(
          (c) =>
            (c.id && c.id === user.uid) ||
            (realEmail && c.email && c.email.toLowerCase() === realEmail),
        )
      : undefined;

    const isSuperAdminEmail = isProtectedSuperAdminEmail(realEmail, customWhitelist);

    const realName =
      user.displayName ||
      (realEmail === "geogo3@gmail.com"
        ? "Georges Khoury"
        : realEmail === "piakerbej@gmail.com" || realEmail === "piakerbaje@gmail.com"
          ? "Pia Kerbej"
          : realEmail === "jess.chakh22@gmail.com"
            ? "Jess Chakh"
            : coachMatch?.name
              ? coachMatch.name
              : realEmail
                ? realEmail.split("@")[0]
                : "Super Admin");

    if (match) {
      if (match.active === false) {
        return null;
      }
      return {
        ...match,
        name:
          user.displayName ||
          (realEmail === "geogo3@gmail.com" && (match.name === "Georges Matta" || !match.name)
            ? "Georges Khoury"
            : match.name),
        role:
          isSuperAdminEmail || isSuperAdminRoleOrEmail(match.role, realEmail)
            ? "Super Admin"
            : normalizeUiRole(match.role),
        active: Boolean(match.active),
      };
    }

    if (coachMatch && !isSuperAdminEmail) {
      return {
        id: coachMatch.id || user.uid,
        authUid: user.uid,
        name: coachMatch.name || realName,
        email: realEmail || coachMatch.email || "",
        username: coachMatch.username || (realEmail ? realEmail.split("@")[0] : user.uid),
        role: "Coach",
        branch: coachMatch.branch || "HQ",
        branchScope: "Assigned branch only" as const,
        active: true,
        method: "Google" as const,
      };
    }

    // Super Admins resolve without an explicit db.users entry once hydrated
    if (!isSuperAdminEmail) {
      return null;
    }

    return {
      id: user.uid || `super-admin-${realEmail.replace(/[^a-zA-Z0-9]/g, "")}`,
      authUid: user.uid,
      name: realName,
      email: realEmail,
      username: realEmail ? realEmail.split("@")[0] : user.uid,
      role: "Super Admin",
      branch: "All",
      branchScope: "All branches" as const,
      active: true,
      method: "Google" as const,
    };
  }, [passwordUser, user, users, coaches, ready]);

  // Automatically bootstrap/upsert users/{uid} with role: "SUPER_ADMIN" whenever UI role resolves to Super Admin
  const bootstrappedSuperAdminUidRef = useRef<string | null>(null);
  useEffect(() => {
    const activeUid = user?.uid || auth?.currentUser?.uid;
    if (
      activeUid &&
      resolvedTenantUser &&
      isSuperAdminRoleOrEmail(resolvedTenantUser.role, resolvedTenantUser.email) &&
      bootstrappedSuperAdminUidRef.current !== `${tenantId}:${activeUid}`
    ) {
      bootstrappedSuperAdminUidRef.current = `${tenantId}:${activeUid}`;
      void bootstrapFirestoreUserDocument(tenantId, activeUid, resolvedTenantUser);
    }
  }, [tenantId, user?.uid, resolvedTenantUser]);

  return resolvedTenantUser;
}

type ListKeys = CollectionKey;

const EMPTY_COLLECTION_SLICE: never[] = [];

export function useCollection<K extends ListKeys>(key: K) {
  const actionsCtx = useContext(DataActionsCtx);
  const fullCtx = useContext(DataCtx);
  if (!actionsCtx && !fullCtx) {
    throw new Error("useCollection must be used inside DataProvider");
  }
  const tenantId = actionsCtx?.tenantId ?? fullCtx!.tenantId;
  const ensureCollection = actionsCtx?.ensureCollection ?? fullCtx!.ensureCollection;
  const update = actionsCtx?.update ?? fullCtx!.update;
  const ready = actionsCtx?.ready ?? fullCtx!.ready;

  // Ensure listener is active
  useEffect(() => {
    if (tenantId) {
      ensureCollection(key);
    }
  }, [key, tenantId, ensureCollection]);

  const subscribeSlice = useCallback(
    (onStoreChange: () => void) => dbStore.subscribe(key, onStoreChange),
    [key],
  );

  const getSliceSnapshot = useCallback(
    () =>
      (dbStore.getSlice(key) as unknown as ({ id: string } & Record<string, unknown>)[]) ||
      EMPTY_COLLECTION_SLICE,
    [key],
  );

  // Subscribe exclusively to changes in this collection slice (Fine-grained: other slices won't re-render this hook!)
  const items = useSyncExternalStore(subscribeSlice, getSliceSnapshot, getSliceSnapshot);

  type Item = (DB[K] extends (infer T)[] ? T : never) & { id: string };

  const add = useCallback(
    (item: Omit<Item, "id"> & { id?: string }) => {
      const created = {
        ...item,
        id: item.id ?? `${String(key)}-${Date.now().toString(36)}`,
      } as Item;
      update(
        (d) =>
          ({
            ...d,
            [key]: [
              created,
              ...((d[key] as unknown as Item[]) || []).filter((i) => i.id !== created.id),
            ],
          }) as DB,
      );
      return created;
    },
    [key, update],
  );

  const save = useCallback(
    (id: string, patch: Partial<Item>) => {
      update(
        (d) =>
          ({
            ...d,
            [key]: ((d[key] as unknown as Item[]) || []).map((i) =>
              i.id === id ? { ...i, ...patch } : i,
            ),
          }) as DB,
      );
    },
    [key, update],
  );

  const remove = useCallback(
    (id: string) => {
      update(
        (d) =>
          ({
            ...d,
            [key]: ((d[key] as unknown as Item[]) || []).filter((i) => i.id !== id),
          }) as DB,
      );
    },
    [key, update],
  );

  return { items: items as unknown as Item[], add, save, remove, ready };
}

/**
 * Fine-grained selector hook that only triggers re-renders when the selected
 * value changes, resolving the monolithic state store re-rendering bottleneck.
 */
export function useDBSelector<T>(
  selector: (db: DB) => T,
  equalityFn: (a: T, b: T) => boolean = (a, b) => a === b,
): T {
  const lastSelectedRef = useRef<T | undefined>(undefined);

  const getSnapshot = useCallback(() => {
    const next = selector(dbStore.getDB());
    if (lastSelectedRef.current !== undefined && equalityFn(lastSelectedRef.current, next)) {
      return lastSelectedRef.current;
    }
    lastSelectedRef.current = next;
    return next;
  }, [selector, equalityFn]);

  const getServerSnapshot = useCallback(() => {
    return selector(dbStore.getDB());
  }, [selector]);

  return useSyncExternalStore(
    (onStoreChange) => dbStore.subscribe("ALL", onStoreChange),
    getSnapshot,
    getServerSnapshot,
  );
}

/**
 * Hook to lazily subscribe to specific collections on a per-route basis.
 * E.g., useSubscribedCollections(["players", "teams"]) in /players.
 */
export function useSubscribedCollections(keys: (keyof DB)[]) {
  const tenantId = getTenantSlug() || "donbosco";
  const { user, passwordUser } = useAuth();
  const isAuthenticated = Boolean((user && !user.isAnonymous) || passwordUser || user);

  useEffect(() => {
    if (!isAuthenticated || !tenantId) return;
    for (const key of keys) {
      ensureCollectionSubscribed(key, tenantId);
    }
  }, [tenantId, isAuthenticated, keys]);
}

export const useCollectionsPreload = useSubscribedCollections;

/**
 * TanStack Query Hook:
 * Queries and caches a collection slice with TanStack React Query,
 * integrating Firestore real-time listeners with React Query's cache.
 */
export function useCollectionQuery<K extends keyof DB>(key: K) {
  const tenantId = getTenantSlug() || "donbosco";
  const { user, passwordUser } = useAuth();
  const isAuthenticated = Boolean((user && !user.isAnonymous) || passwordUser || user);

  useEffect(() => {
    if (isAuthenticated && tenantId) {
      ensureCollectionSubscribed(key, tenantId);
    }
  }, [key, tenantId, isAuthenticated]);

  return useQuery({
    queryKey: ["firestore", tenantId, key],
    queryFn: () => dbStore.getSlice(key),
    initialData: () => dbStore.getSlice(key),
    enabled: isAuthenticated && Boolean(tenantId),
    staleTime: Infinity,
  });
}

export function useModulePermissions(moduleKey: string): {
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  read: boolean;
  write: boolean;
  delete: boolean;
} {
  const customRoles = useSyncExternalStore(
    subscribeCustomRolesSlice,
    getCustomRolesSliceSnapshot,
    getCustomRolesSliceSnapshot,
  );
  const currentUser = useTenantUser();
  const { user, passwordUser } = useAuth();

  return useMemo(() => {
    const email = (currentUser?.email || user?.email || passwordUser?.email || "").toLowerCase();
    const roleName = currentUser?.role || "";
    const roleLower = roleName.toLowerCase();

    if (
      email === "geogo3@gmail.com" ||
      roleName === "Super Admin" ||
      roleName === "Academy Manager" ||
      roleName === "Admin" ||
      roleName === "Tenant Admin" ||
      roleName === "Academy Director" ||
      roleLower === "super admin" ||
      roleLower === "academy manager"
    ) {
      return {
        canRead: true,
        canWrite: true,
        canDelete: true,
        read: true,
        write: true,
        delete: true,
      };
    }

    const defaultDef = defaultRoleDefinitions.find((r) => r.name.toLowerCase() === roleLower);
    const customDef = (customRoles || []).find((r) => r.name.toLowerCase() === roleLower);
    const mergedPermissions = {
      ...defaultDef?.permissions,
      ...customDef?.permissions,
    };
    const modPerm = mergedPermissions[moduleKey];
    const canRead = Boolean(modPerm?.read);
    const canWrite = Boolean(modPerm?.write);
    const canDelete = Boolean(modPerm?.delete);

    return {
      canRead,
      canWrite,
      canDelete,
      read: canRead,
      write: canWrite,
      delete: canDelete,
    };
  }, [currentUser, user?.email, passwordUser?.email, customRoles, moduleKey]);
}

export const uid = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1000).toString(36)}`;

export const todayISO = () => new Date().toISOString().slice(0, 10);

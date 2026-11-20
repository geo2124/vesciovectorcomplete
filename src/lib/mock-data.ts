// Zero-demo clean data types and baseline schema for Vescio Vector.

export const MASTER_OWNER_EMAIL = "geogo3@gmail.com";
export const DEFAULT_PROTECTED_SUPER_ADMIN_EMAILS = [
  "geogo3@gmail.com",
  "piakerbej@gmail.com",
  "piakerbaje@gmail.com",
  "jess.chakh22@gmail.com",
];

export const isMasterOwner = (email?: string | null): boolean =>
  String(email || "")
    .trim()
    .toLowerCase() === MASTER_OWNER_EMAIL;

export function getStoredProtectedSuperAdminEmails(): string[] {
  if (typeof window === "undefined") {
    return DEFAULT_PROTECTED_SUPER_ADMIN_EMAILS;
  }
  try {
    const raw = window.localStorage.getItem("vv_protected_super_admins");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return Array.from(
          new Set(
            [
              ...DEFAULT_PROTECTED_SUPER_ADMIN_EMAILS,
              ...parsed.map((e) => String(e).trim().toLowerCase()),
            ].filter(Boolean),
          ),
        );
      }
    }
  } catch {
    // fallback
  }
  return DEFAULT_PROTECTED_SUPER_ADMIN_EMAILS;
}

export function isProtectedSuperAdminEmail(
  email?: string | null,
  customWhitelist?: string[],
): boolean {
  if (!email) return false;
  const normalized = String(email).trim().toLowerCase();
  if (!normalized) return false;
  if (DEFAULT_PROTECTED_SUPER_ADMIN_EMAILS.includes(normalized)) return true;
  if (
    Array.isArray(customWhitelist) &&
    customWhitelist.some((e) => String(e).trim().toLowerCase() === normalized)
  ) {
    return true;
  }
  const stored = getStoredProtectedSuperAdminEmails();
  return stored.includes(normalized);
}

export interface InsuranceCompany {
  id: string;
  name: string; // e.g., "Bankers Assurance", "Fidelity Insurance", "Adir Insurance"
  defaultFee: number; // Default Basic Fee ($) charged to player
  defaultCost?: number; // Optional cost paid to insurance provider
  policyNotes?: string;
  active: boolean;
}

export interface TrainingPackage {
  id: string;
  name: string; // e.g., "Basic Package", "Standard Package", "Elite Unlimited"
  practicesPerMonth: number; // e.g., 4, 8, 12, or 999 (Unlimited)
  monthlyPrice: number; // e.g., 60, 85, 120
  description?: string;
  active: boolean;
}

export interface SpecialOfferConfig {
  id: string;
  name: string; // e.g., "Sibling 2nd Child -10%", "Early Bird -15%", "Package Promo -$15"
  targetType: "package" | "sibling" | "general";
  applicablePackageIds?: string[]; // empty = applies to any package
  discountPercent?: number;
  discountAmount?: number;
  active: boolean;
}

export interface PrintingOption {
  id: string;
  label: string; // e.g., "Player Name", "Player Number", "Front & Back Number", "Short Number", "Sponsor / Club Logo"
  defaultFee: number;
}

export const DEFAULT_PRINTING_OPTIONS: PrintingOption[] = [
  { id: "pr-1", label: "Player Name", defaultFee: 5 },
  { id: "pr-2", label: "Player Number", defaultFee: 4 },
  { id: "pr-3", label: "Front & Back Number", defaultFee: 6 },
  { id: "pr-4", label: "Short Number", defaultFee: 3 },
  { id: "pr-5", label: "Sponsor / Club Logo", defaultFee: 4 },
];

export const DEFAULT_INSURANCE_COMPANIES: InsuranceCompany[] = [
  {
    id: "ins-bankers",
    name: "Bankers Assurance",
    defaultFee: 25,
    defaultCost: 15,
    policyNotes: "Standard annual sports injury coverage",
    active: true,
  },
  {
    id: "ins-fidelity",
    name: "Fidelity Insurance",
    defaultFee: 30,
    defaultCost: 18,
    policyNotes: "Comprehensive on-court & tournament protection",
    active: true,
  },
  {
    id: "ins-adir",
    name: "Adir Insurance",
    defaultFee: 20,
    defaultCost: 12,
    policyNotes: "Basic youth athletics accident plan",
    active: true,
  },
];

export const DEFAULT_TRAINING_PACKAGES: TrainingPackage[] = [
  {
    id: "pkg-basic",
    name: "Basic Package",
    practicesPerMonth: 4,
    monthlyPrice: 60,
    description: "1 practice per week (4 practices / month)",
    active: true,
  },
  {
    id: "pkg-standard",
    name: "Standard Package",
    practicesPerMonth: 8,
    monthlyPrice: 85,
    description: "2 practices per week (8 practices / month)",
    active: true,
  },
  {
    id: "pkg-pro",
    name: "Pro Package",
    practicesPerMonth: 12,
    monthlyPrice: 105,
    description: "3 practices per week (12 practices / month)",
    active: true,
  },
  {
    id: "pkg-elite",
    name: "Elite Unlimited",
    practicesPerMonth: 999,
    monthlyPrice: 120,
    description: "Unlimited monthly practices & conditioning",
    active: true,
  },
];

export const DEFAULT_SPECIAL_OFFERS: SpecialOfferConfig[] = [
  {
    id: "offer-sibling-10",
    name: "Sibling 2nd Child -10%",
    targetType: "sibling",
    applicablePackageIds: [],
    discountPercent: 10,
    active: true,
  },
  {
    id: "offer-sibling-20",
    name: "Sibling 3rd+ Child -20%",
    targetType: "sibling",
    applicablePackageIds: [],
    discountPercent: 20,
    active: true,
  },
  {
    id: "offer-early-bird",
    name: "Early Bird -15%",
    targetType: "package",
    applicablePackageIds: [],
    discountPercent: 15,
    active: true,
  },
  {
    id: "offer-pkg-promo",
    name: "Package Promo -$15",
    targetType: "package",
    applicablePackageIds: [],
    discountAmount: 15,
    active: true,
  },
];

export const academy = {
  name: "Vescio Vector Academy",
  url: "vesciovector.com",
  plan: "Pro",
  renews: "Annual",
  playersUsed: 0,
  playersLimit: 400,
  branchesUsed: 0,
  branchesLimit: 10,
  storageUsed: 0,
  storageLimit: 50,
  sport: "Basketball" as const,
  currency: "USD",
  currencies: ["USD"] as string[],
  logo: null as string | null,
  supportPhone: "",
  supportEmail: "geogo3@gmail.com",
  softDeadline: 7,
  hardDeadline: 30,
  requireGameConfirmation: true,
  autoConfirmGames: false,
  insuranceCompanies: DEFAULT_INSURANCE_COMPANIES,
  trainingPackages: DEFAULT_TRAINING_PACKAGES,
  specialOffers: DEFAULT_SPECIAL_OFFERS,
  printingOptions: DEFAULT_PRINTING_OPTIONS,
  protectedSuperAdminEmails: DEFAULT_PROTECTED_SUPER_ADMIN_EMAILS,
};

export const kpis = [
  { label: "Total players", value: "0", note: "0 registered", accent: true },
  { label: "Active teams", value: "0", note: "0 teams" },
  { label: "This week", value: "0", note: "0 sessions" },
  { label: "Collected · MTD", value: "$0", note: "0 open balance", accent: true },
];

export type DocumentAttachment = {
  id: string;
  name: string;
  type: string;
  url: string;
  uploadedAt: string;
  size: number;
};

export type Coach = {
  id: string;
  name: string;
  phone: string;
  years: number;
  level: string;
  gender: "M" | "F";
  wins: number;
  losses: number;
  sessions: number;
  sessionTarget: number;
  outstanding: number;
  branch: string;
  branches?: string[] | undefined;
  team?: string | undefined;
  teams?: string[] | undefined;
  portal: boolean;
  rate: number;
  rateType?: "per_session" | "hourly" | undefined;
  email: string;
  username?: string | undefined;
  password?: string | undefined;
  licenseUrl?: string | undefined;
  licenseName?: string | undefined;
  licenseExpiry?: string | undefined;
  documents?: DocumentAttachment[] | undefined;
  seenFolders?: Record<string, number> | undefined;
  finals?: number | undefined;
  championships?: number | undefined;
  finalsRecord?:
    | {
        id: string;
        tournament: string;
        date: string;
        result: "Champion" | "Runner-up";
        team: string;
        score?: string | undefined;
      }[]
    | undefined;
};

export const coachLevels = ["Level 1", "Level 2", "Level 3", "Level 4"];

export const coaches: Coach[] = [];

export type Player = {
  id: string;
  name: string;
  gender: "Boy" | "Girl";
  dob: string;
  category: string;
  teams: string[];
  branch: string;
  parent: string; // Primary guardian (Guardian 1)
  parentPhone: string; // Primary guardian phone (Guardian 1)
  guardian2Name?: string | undefined; // Secondary guardian (optional)
  guardian2Phone?: string | undefined; // Secondary guardian phone (optional)
  guardianName?: string | undefined;
  guardianPhone?: string | undefined;
  guardianEmail?: string | undefined;
  school: string;
  fee: number;
  feeNote?: string | undefined;
  isScholarship?: boolean | undefined;
  discountPercent?: number | undefined;
  discountAmount?: number | undefined;
  specialOffer?: string | undefined;
  specialOfferId?: string | undefined;
  packageId?: string | undefined;
  packageName?: string | undefined;
  allowedPracticesPerMonth?: number | undefined;
  familyId?: string | undefined;
  balance: number;
  status: "Active" | "Idle" | "Soft flag" | "Inactive" | "Suspended";
  idleSinceDate?: string | undefined;
  missedSessionsSinceIdle?: number | undefined;
  idleMissedSessionIds?: string[] | undefined;
  crmFollowUpStatus?: string | undefined;
  crmMovedAt?: string | undefined;
  insuranceStatus?: "Academy insured" | "Self insured" | "Not insured" | undefined;
  isInsured?: boolean | undefined;
  insuranceCompanyId?: string | undefined;
  insuranceCompanyName?: string | undefined;
  insuranceFee?: number | undefined;
  insurancePaid?: boolean | undefined;
  insuranceBilledToBalance?: boolean | undefined;
  insuranceLedgerId?: string | undefined;
  insuranceExpiryDate?: string | undefined;
  idCardUrl?: string | undefined;
  idCardName?: string | undefined;
  photoUrl?: string | undefined;
  documents?: DocumentAttachment[] | undefined;
  payments?:
    | { id: string; date: string; amount: number; notes: string; paymentMethod?: string }[]
    | undefined;
  programTier?: string | undefined;
  teamFees?: Record<string, number> | undefined;
  phone?: string | undefined;
  nationality?: string | undefined;
  bloodType?: string | undefined;
  medicalNotes?: string | undefined;
  medicalStatus?: "Fit" | "Limited" | "Injured" | undefined;
  rtpStage?: 1 | 2 | 3 | 4 | 5 | undefined;
  registered?: string | undefined;
};

export const players: Player[] = [];

export type Team = {
  id: string;
  name: string;
  category: string;
  gender: "Boys" | "Girls" | "Mixed";
  headCoach: string;
  headCoachId?: string | undefined;
  assistant?: string | undefined;
  assistantId?: string | undefined;
  branch: string;
  players: number;
  coach?: string | undefined;
  coachId?: string | undefined;
  playersCount?: number | undefined;
  wins: number;
  losses: number;
  monthlyFee: number;
  tier?: "Grassroots" | "Development" | "Competitive" | "Elite / High Performance" | undefined;
  gamesFrequencyPerMonth?: number | undefined;
  pendingFrequencyProposal?:
    | {
        gamesPerMonth?: number | undefined;
        proposedBy?: string | undefined;
        proposedAt?: string | undefined;
        rationale?: string | undefined;
        status?: "Pending" | "Approved" | "Rejected" | string | undefined;
        requestedFrequency?: number | undefined;
        requestedByCoach?: string | undefined;
        requestedDate?: string | undefined;
      }
    | undefined;
  headCoachRate?: number | undefined;
  assistantRate?: number | undefined;
  allowYoungerPlayers?: boolean | undefined;
  allowOlderPlayers?: boolean | undefined;
};

export const teams: Team[] = [];

export type Payment = {
  id: string;
  date: string;
  amount: number;
  notes: string;
};

export type Staff = {
  id: string;
  name: string;
  position: string;
  phone: string;
  email: string;
  branch: string;
  branches?: string[] | undefined;
  dob: string;
  idFile?: string | undefined;
  salary?: number | undefined;
  salaryType?: string | undefined;
  payments?: Payment[] | undefined;
};

export const staff: Staff[] = [];

export type TimeWindow = {
  id: string;
  startTime: string;
  endTime: string;
};

export type DaySchedule = {
  day: "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
  available: boolean;
  windows: TimeWindow[];
};

export type BranchScheduleSlot = {
  id: string;
  days: string[];
  startTime: string;
  endTime: string;
  activity?: string;
  isClosed?: boolean;
};

export type Court = {
  id?: string | undefined;
  name: string;
  contact: string;
  phone: string;
  mapsLink?: string | undefined;
  lat?: number | undefined;
  lng?: number | undefined;
  schedule?: string | undefined;
  operatingHours?: string | undefined;
  weeklySchedule?: DaySchedule[] | undefined;
  schedules?: BranchScheduleSlot[] | undefined;
  feeType?: "fixed" | "per_session" | "per_hour" | undefined;
  feeAmount?: number | undefined;
  enableHalfCourts?: boolean | undefined;
  fullCourtHourlyRate?: number | undefined;
  halfCourtHourlyRate?: number | undefined;
};

export type CourtRateType = "Half Court Rate" | "Full Court Rate" | "Private Rate" | "Academy Rate";

export type BranchNexusRates = {
  halfCourtHourlyRate: number;
  fullCourtHourlyRate: number;
  privateBaseFee: number;
  privateExtraPlayerFee: number;
  academyHourlyRate: number;
  updatedAt?: string | undefined;
};

export type BranchOffDay = {
  id: string;
  date: string;
  reason: string;
  createdBy?: string | undefined;
  createdAt: string;
};

export type Branch = {
  id: string;
  name: string;
  city: string;
  address: string;
  manager: string;
  phone?: string | undefined;
  email?: string | undefined;
  rentalType?: "Per session" | "Fixed amount" | undefined;
  rentalRate?: number | undefined;
  courtsCount?: number | undefined;
  courts: Court[];
  teams: number;
  players: number;
  fixedExpenses?: number | undefined;
  sessionRentalRate?: number | undefined;
  notes?: string | undefined;
  operatingHours?: string | undefined;
  schedules?: BranchScheduleSlot[] | undefined;
  weeklySchedule?: DaySchedule[] | undefined;
  // Vescio Nexus Multi-Branch Facility Configuration
  nexusRates?: BranchNexusRates | undefined;
  offDays?: BranchOffDay[] | undefined;
  gymCapacity?: number | undefined;
  gymEquipmentNotes?: string | undefined;
  gymDefaultMonthlyFee?: number | undefined;
  physioRoomsCount?: number | undefined;
  leadPhysiotherapist?: string | undefined;
  physioClinicStatus?: "Open" | "By Appointment" | "Closed" | undefined;
  posRegisterName?: string | undefined;
  posStartingFloat?: number | undefined;
  posStatus?: "Open" | "Closed" | undefined;
};

export const branches: Branch[] = [];

export type MatchOfficial = {
  id: string;
  role: string;
  source: "personnel" | "outsource";
  name: string;
  fee: number;
  personnelId?: string | undefined;
  status?: "Pending" | "Paid" | undefined;
};

export type CourtAllocationType = "Full Court" | "Half Court - HCA" | "Half Court - HCB";

export type SessionItem = {
  id: string;
  kind: "Practice" | "Game" | "Seminar" | "Camp" | string;
  title: string;
  detail: string;
  venue?: string | undefined;
  court?: string | undefined;
  courtAllocation?: CourtAllocationType | undefined;
  durationHours?: number | undefined;
  courtRentalCost?: number | undefined;
  planId?: string | undefined;
  coachCheckedInAt?: string | undefined;
  coachCheckedInBy?: string | undefined;
  assistantCheckedInAt?: string | undefined;
  checkedInByManagerName?: string | undefined;
  checkedInByManagerReason?: string | undefined;
  date: string;
  time: string;
  endDate?: string | undefined;
  endTime?: string | undefined;
  branch: string;
  coach: string;
  coachId?: string | undefined;
  coachRate?: number | undefined;
  coachSessionFee?: number | null | undefined;
  coachTransportFee?: number | null | undefined;
  assistantSessionFee?: number | null | undefined;
  assistantTransportFee?: number | null | undefined;
  rateOverwritten?: boolean | undefined;
  rateOverwrittenBy?: string | undefined;
  team?: string | undefined;
  teamA?: string | undefined;
  teamB?: string | undefined;
  gameType?: string | undefined;
  headCoach?: string | undefined;
  headCoachId?: string | undefined;
  assistantCoach?: string | undefined;
  assistantCoachId?: string | undefined;
  status:
    | "Live"
    | "Planned"
    | "Pending approval"
    | "Pre-approved"
    | "Official"
    | "Completed"
    | "Cancelled";
  approvalStatus?: "Pending" | "Approved" | "Rejected" | undefined;
  confirmedBy?: string | undefined;
  score?: string | undefined;
  report?: string | undefined;
  coachAttendance?: "Present" | "Absent" | "Excused" | undefined;
  assistantAttendance?: "Present" | "Absent" | "Excused" | undefined;
  referees?: MatchOfficial[] | undefined;
  matchStaff?: MatchOfficial[] | undefined;
};

export const sessions: SessionItem[] = [];

export type Supplier = {
  id: string;
  name: string;
  contact: string;
  email: string;
  phone: string;
};

export interface MerchVariant {
  id: string;
  size: string; // e.g., "Small", "Medium", "Large", "XL", "Youth M", or "One Size"
  color: string; // e.g., "Blue", "White", "Black", "Gold"
  quantity: number; // e.g., 50
  sku?: string | undefined;
}

export interface MerchPrintingItem {
  id: string;
  label: string;
  details?: string | undefined;
  customText?: string | undefined;
  fee: number;
}

export type StockItem = {
  id: string;
  item: string;
  supplier: string;
  variant: string;
  variants?: MerchVariant[] | undefined;
  stock: number;
  reorder: number;
  costPrice?: number;
  sellingPrice?: number;
  price: number;
  branch?: string | undefined;
};

export const stock: StockItem[] = [];

export type Order = {
  id: string;
  team?: string | undefined;
  player: string;
  playerId?: string | undefined;
  stockItemId?: string | undefined;
  items: string;
  quantity?: number | undefined;
  unitPrice?: number | undefined;
  variant?: string | undefined;
  variantId?: string | undefined;
  selectedSize?: string | undefined;
  selectedColor?: string | undefined;
  number?: string | undefined;
  printings?: MerchPrintingItem[] | undefined;
  printingTotalFee?: number | undefined;
  subtotal?: number | undefined;
  discountPercent?: number | undefined;
  discountAmount?: number | undefined;
  costPrice?: number | undefined;
  costTotal?: number | undefined;
  total: number;
  paid: number;
  delivered: boolean;
  date?: string | undefined;
  notes?: string | undefined;
  branch?: string | undefined;
};

export const orders: Order[] = [];

export interface LedgerEntry {
  id: string;
  date: string;
  account: string;
  category?: string | undefined;
  entry?: string | undefined;
  description?: string | undefined;
  type: "Revenue" | "Expense" | "debit" | "credit";
  amount: number;
  status: "Collected" | "Paid" | "Pending";
  branch?: string | undefined;
  note?: string | undefined;
  attachment?: string | undefined;
  coachId?: string | undefined;
  staffId?: string | undefined;
  period?: string | undefined;
  referenceId?: string | undefined;
  isAdvance?: boolean | undefined;
  advanceAmount?: number | undefined;
  advanceReason?: string | undefined;
  linkedAdvanceSessionsCount?: number | undefined;
  linkedAdvanceSessionIds?: string[] | undefined;
}

export const ledger: LedgerEntry[] = [];

export const rolesMatrix = [
  { role: "Super Admin", users: 3, scope: "All modules", perms: "Read · Add · Edit · Delete" },
  { role: "Academy Manager", users: 1, scope: "All modules", perms: "Read · Add · Edit · Delete" },
  {
    role: "Technical Director",
    users: 1,
    scope: "Technical portal only",
    perms: "Read · Add · Edit",
  },
  { role: "Branch Manager", users: 1, scope: "Assigned branch only", perms: "Read · Add · Edit" },
  { role: "Accountant", users: 1, scope: "Accounting, merchandise", perms: "Read · Add · Edit" },
  { role: "Coach", users: 1, scope: "Coach portal only", perms: "Read · Add" },
];

export type QuizSubmission = {
  coachId: string;
  coachName: string;
  submittedAt: string;
  score?: number | string;
  answers: Record<string, string>;
};

export type ResourceItem = {
  id: string;
  type: "PDF" | "Image" | "Video" | "YouTube" | "Interactive Form";
  name: string;
  url?: string;
  size?: number;
  description?: string;
  quiz?: {
    description?: string;
    questions: {
      id: string;
      type: "Text" | "Radio" | "Checkbox" | "Scale" | "Paragraph" | string;
      prompt: string;
      options?: string[];
    }[];
  };
  submissions?: QuizSubmission[];
};

export type ResourceFolder = {
  id: string;
  name: string;
  accessType: "All" | "Group" | "Specific";
  accessGroup?: string;
  accessCoaches?: string[]; // IDs
  items: ResourceItem[];
};

export const resourceFolders: ResourceFolder[] = [];
export const defaultResourceFolders: ResourceFolder[] = [];

export type Workshop = {
  id: string;
  type: "Physical" | "Online";
  title: string;
  topic: string;
  venue: string;
  date: string;
  time: string;
  assignedCoaches: string[];
  assignedLevels: string[];
  attendance: Record<string, "Present" | "Absent" | "Excused">;
  handoutUrl?: string | undefined;
  handoutName?: string | undefined;
  documents?: DocumentAttachment[] | undefined;
};

export const workshops: Workshop[] = [];

export type Invoice = {
  id: string; // `${playerId}_${year}_${month}` (idempotency key)
  invoiceNumber: string;
  playerId: string;
  playerName: string;
  playerBranch?: string;
  team?: string;
  programTier?: string;
  billingMonth: string; // e.g. "May", "June", "September"
  month: string; // "01" through "12"
  year: number;
  amount: number;
  status: "pending" | "paid" | "overdue" | "cancelled";
  issuedDate: string;
  dueDate: string;
  description: string;
  paidAmount?: number;
  paidDate?: string;
  paymentMethod?: string;
  notes?: string;
};

export const invoices: Invoice[] = [];

export type DrillCategory =
  | "Shooting"
  | "Ball Handling"
  | "Defense"
  | "Transition"
  | "Spacing"
  | "Finishing"
  | "Rebounding"
  | "Conditioning";

export type MasterDrill = {
  id: string;
  title: string;
  category: DrillCategory | string;
  duration: number; // minutes
  durationMinutes?: number | undefined;
  difficulty: "Beginner" | "Intermediate" | "Advanced" | "Intro";
  intensity?: "Low" | "Medium" | "High" | undefined;
  coachingPoints: string;
  description?: string | undefined;
  diagramUrl?: string | undefined;
  mediaUrl?: string | undefined;
  drawing?: string | null | undefined;
  tags?: string[] | undefined;
  equipment?: string | undefined;
  targetSquad?: string | undefined;
  createdAt?: string | undefined;
  updatedAt?: string | undefined;
};

export const masterDrills: MasterDrill[] = [];

export type CrmStage =
  | "inquiry"
  | "trial_scheduled"
  | "pending_registration"
  | "active_converted"
  | "idle_followup"
  | "lost_churned"
  | "aftersales_retention";

export interface CrmSettings {
  autoChurnEnabled: boolean;
  autoChurnMode: "1_month" | "custom_weeks";
  autoChurnWeeks: number;
}

export const DEFAULT_CRM_SETTINGS: CrmSettings = {
  autoChurnEnabled: true,
  autoChurnMode: "1_month",
  autoChurnWeeks: 4,
};

export interface CrmCommunicationEntry {
  id: string;
  channel: "Call" | "WhatsApp" | "Email" | "In-Person";
  summary: string;
  author: string;
  createdAt: string;
}

export interface CrmReminderItem {
  id: string;
  title: string;
  dueDate: string;
  completed: boolean;
  assignedTo?: string | undefined;
  createdAt: string;
}

export type CrmLead = {
  id: string;
  stage: CrmStage;
  playerName: string;
  gender: "Boy" | "Girl";
  dob: string;
  category?: string | undefined;
  preferredBranch: string;
  preferredPosition?: string | undefined;
  leadSource?: string | undefined;
  parentName: string;
  parentPhone: string;
  parentEmail?: string | undefined;
  guardian2Name?: string | undefined;
  guardian2Phone?: string | undefined;
  school?: string | undefined;
  medicalNotes?: string | undefined;
  generalNotes?: string | undefined;
  trialSessionId?: string | undefined;
  trialSessionTitle?: string | undefined;
  trialSessionDate?: string | undefined;
  trialTeam?: string | undefined;
  trialEvaluationNotes?: string | undefined;
  trialRating?: string | undefined;
  offeredPackageId?: string | undefined;
  offeredPackageName?: string | undefined;
  offeredMonthlyFee?: number | undefined;
  offeredDiscountPercent?: number | undefined;
  offerSentDate?: string | undefined;
  linkedPlayerId?: string | undefined;
  lastTeam?: string | undefined;
  idleSinceDate?: string | undefined;
  missedSessionsSinceIdle?: number | undefined;
  idleDurationDays?: number | undefined;
  churnReason?: string | undefined;
  reEngagementNotes?: string | undefined;
  churnedAt?: string | undefined;
  retentionCategory?:
    "Parent Check-In" | "Gear / Uniform Upsell" | "Camp Invite" | "Feedback Log" | undefined;
  upsellItems?: string | undefined;
  campName?: string | undefined;
  feedbackLog?: string | undefined;
  communications: CrmCommunicationEntry[];
  reminders: CrmReminderItem[];
  createdAt: string;
  updatedAt: string;
};

export const crmLeads: CrmLead[] = [];

// ---------------------------------------------------------------------------
// Vescio Nexus Types (Court Reservations, Gym & S&C, Physio & Medical, Kiosk POS)
// ---------------------------------------------------------------------------

export type CourtReservation = {
  id: string;
  clientName: string;
  clientType: "External Client" | "Academy Player" | "Academy Team" | "Corporate / Club";
  linkedPlayerId?: string | undefined;
  linkedTeamName?: string | undefined;
  phone: string;
  email?: string | undefined;
  branch: string;
  court: string;
  courtAllocation: CourtAllocationType; // "Full Court" | "Half Court - HCA" | "Half Court - HCB"
  date: string;
  startTime: string;
  endTime: string;
  durationHours: number;
  // Snapshot-Protected Rate Engine Fields
  rateType?: CourtRateType | undefined;
  snapshotUnitRate?: number | undefined;
  snapshotExtraPlayerRate?: number | undefined;
  playerCount?: number | undefined;
  baseCalculatedAmount?: number | undefined;
  freePass?: boolean | undefined;
  discountPercent?: number | undefined;
  discountFixedAmount?: number | undefined;
  hourlyRate: number;
  totalAmount: number;
  paidAmount: number;
  paymentStatus: "Paid" | "Pending" | "Partial" | "Charged to Account" | "Free Pass";
  paymentMethod?: "Cash" | "Card" | "Bank Transfer" | "Wish / OMT" | "Account Charge" | undefined;
  // Booking Type & Recurrence Fields
  bookingType?: "walk_in" | "recurring" | undefined;
  recurrenceMode?: "single" | "weeks" | "continuous" | "single_materialized" | undefined;
  isRecurring?: boolean | undefined;
  recurringWeeks?: number | undefined;
  recurringGroupId?: string | undefined;
  seriesStartDate?: string | undefined;
  continuousActive?: boolean | undefined;
  continuousStoppedAfterDate?: string | undefined;
  skippedDates?: string[] | undefined;
  // Completion & Cash-In Audit Fields
  status: "Confirmed" | "Completed" | "Cancelled";
  cashedInAt?: string | undefined;
  cashedInBy?: string | undefined;
  ledgerEntryId?: string | undefined;
  notes?: string | undefined;
  createdAt: string;
  updatedAt?: string | undefined;
};

export const courtReservations: CourtReservation[] = [];

export type GymWorkoutLog = {
  id: string;
  date: string;
  focusArea:
    | "Lower Body Power"
    | "Upper Body Strength"
    | "Core & Mobility"
    | "Plyometrics & Speed"
    | "Energy System Conditioning";
  exercisesSummary: string;
  setsRepsLoad: string;
  rpe: number; // 1–10
  personalRecord?: string | undefined;
  coachName: string;
  notes?: string | undefined;
};

export type GymMember = {
  id: string;
  memberName: string;
  memberType: "Academy Player" | "External Member";
  linkedPlayerId?: string | undefined;
  phone: string;
  email?: string | undefined;
  branch: string;
  packageName: string;
  packageType: "Monthly Unlimited" | "10-Session S&C Pack" | "Athlete Pro S&C" | "Walk-In Day Pass";
  monthlyFee: number;
  sessionsRemaining?: number | undefined;
  totalSessionsIncluded?: number | undefined;
  startDate: string;
  expiryDate: string;
  status: "Active" | "Expired" | "Paused";
  balance: number;
  lastCheckInDate?: string | undefined;
  totalCheckIns: number;
  checkInHistory?: { id: string; date: string; time: string; note?: string }[] | undefined;
  workoutLogs: GymWorkoutLog[];
  createdAt: string;
  updatedAt?: string | undefined;
};

export const gymMembers: GymMember[] = [];

export type PlayerMedicalClearanceStatus = "Fit" | "Limited" | "Injured";

export type PhysioTreatmentSession = {
  id: string;
  date: string;
  time: string;
  therapistName: string;
  modality:
    | "Manual Therapy & Mobilization"
    | "Dry Needling / Electrotherapy"
    | "Cryotherapy & Compression"
    | "Rehab Gym Load Protocol"
    | "Return-to-Play Biomechanical Test";
  soapNotes: string;
  painScore: number; // 0–10
  fee: number;
  paymentStatus: "Paid" | "Pending" | "Academy Covered" | "Charged to Account";
  status: "Scheduled" | "Completed" | "Cancelled";
};

export type PhysioRecord = {
  id: string;
  patientName: string;
  patientType: "Academy Player" | "External Patient";
  linkedPlayerId?: string | undefined;
  team?: string | undefined;
  phone?: string | undefined;
  branch: string;
  medicalStatus: PlayerMedicalClearanceStatus; // "Fit" | "Limited" | "Injured"
  injuryArea:
    | "Ankle / Foot"
    | "Knee / ACL / Meniscus"
    | "Hamstring / Groin"
    | "Shoulder / Rotator Cuff"
    | "Lumbar / Lower Back"
    | "Wrist / Hand"
    | "Concussion / General";
  diagnosis: string;
  mechanism?: string | undefined;
  severity: "Mild (Grade 1)" | "Moderate (Grade 2)" | "Severe (Grade 3)";
  intakeDate: string;
  estimatedReturnDate?: string | undefined;
  therapistName: string;
  rtpStage: 1 | 2 | 3 | 4 | 5;
  restrictions: string;
  treatmentSessions: PhysioTreatmentSession[];
  createdAt: string;
  updatedAt: string;
};

export const physioRecords: PhysioRecord[] = [];

export type PosItemCategory =
  | "Hydration & Drinks"
  | "Snacks & Nutrition"
  | "Uniforms & Merch"
  | "Court Walk-In & Passes"
  | "Recovery & Tape";

export type PosCatalogItem = {
  id: string;
  name: string;
  category: PosItemCategory;
  price: number;
  stock: number;
  sku?: string | undefined;
  linkedStockId?: string | undefined;
  branch?: string | undefined;
  active: boolean;
};

export type PosCartLineItem = {
  itemId: string;
  name: string;
  category: PosItemCategory | string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  linkedStockId?: string | undefined;
};

export type PosTransaction = {
  id: string;
  receiptNumber: string;
  date: string;
  time: string;
  branch: string;
  cashierName: string;
  customerType: "Walk-In" | "Academy Player" | "Gym Member";
  customerName: string;
  linkedPlayerId?: string | undefined;
  linkedGymMemberId?: string | undefined;
  items: PosCartLineItem[];
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: "Cash" | "Card" | "Charge to Account";
  status: "Completed" | "Refunded";
  notes?: string | undefined;
  createdAt: string;
};

export const DEFAULT_POS_CATALOG: PosCatalogItem[] = [
  {
    id: "pos-water-500",
    name: "Mineral Water (500ml)",
    category: "Hydration & Drinks",
    price: 1.5,
    stock: 120,
    sku: "HYD-001",
    active: true,
  },
  {
    id: "pos-iso-blue",
    name: "Isotonic Sports Drink (Blue Berry)",
    category: "Hydration & Drinks",
    price: 3.5,
    stock: 64,
    sku: "HYD-002",
    active: true,
  },
  {
    id: "pos-electrolyte-citrus",
    name: "Zero-Sugar Electrolyte Hydration",
    category: "Hydration & Drinks",
    price: 4.0,
    stock: 48,
    sku: "HYD-003",
    active: true,
  },
  {
    id: "pos-whey-shake",
    name: "Post-Workout Whey Recovery Shake",
    category: "Hydration & Drinks",
    price: 6.5,
    stock: 35,
    sku: "HYD-004",
    active: true,
  },
  {
    id: "pos-protein-bar",
    name: "High-Protein Peanut Crunch Bar",
    category: "Snacks & Nutrition",
    price: 3.5,
    stock: 50,
    sku: "SNK-001",
    active: true,
  },
  {
    id: "pos-energy-oat",
    name: "Pre-Game Energy Oat & Honey Flapjack",
    category: "Snacks & Nutrition",
    price: 2.5,
    stock: 40,
    sku: "SNK-002",
    active: true,
  },
  {
    id: "pos-court-walkin-hr",
    name: "Court Walk-In Open Shootaround (1 Hr)",
    category: "Court Walk-In & Passes",
    price: 15.0,
    stock: 999,
    sku: "WLK-001",
    active: true,
  },
  {
    id: "pos-gym-day-pass",
    name: "S&C Gym Walk-In Day Pass",
    category: "Court Walk-In & Passes",
    price: 12.0,
    stock: 999,
    sku: "WLK-002",
    active: true,
  },
  {
    id: "pos-jersey-kit",
    name: "Vescio Vector Official Reversible Kit",
    category: "Uniforms & Merch",
    price: 45.0,
    stock: 28,
    sku: "UNI-001",
    active: true,
  },
  {
    id: "pos-shooting-shirt",
    name: "Academy Warmup Shooting Shirt",
    category: "Uniforms & Merch",
    price: 28.0,
    stock: 32,
    sku: "UNI-002",
    active: true,
  },
  {
    id: "pos-grip-socks",
    name: "Pro Court Grip Crew Socks",
    category: "Uniforms & Merch",
    price: 12.0,
    stock: 55,
    sku: "UNI-003",
    active: true,
  },
  {
    id: "pos-kt-tape",
    name: "Kinesiology Athletic Tape Roll",
    category: "Recovery & Tape",
    price: 14.0,
    stock: 25,
    sku: "REC-001",
    active: true,
  },
  {
    id: "pos-ankle-wrap",
    name: "Instant Cold Compression Pack",
    category: "Recovery & Tape",
    price: 8.0,
    stock: 30,
    sku: "REC-002",
    active: true,
  },
];

export const posCatalog: PosCatalogItem[] = DEFAULT_POS_CATALOG;
export const posTransactions: PosTransaction[] = [];

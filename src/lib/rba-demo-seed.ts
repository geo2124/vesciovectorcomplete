import { collection, doc, getDocs, writeBatch, deleteDoc, setDoc } from "firebase/firestore";
import { db as firestore, auth } from "./firebase";
import {
  DEFAULT_POS_CATALOG,
  defaultRoleDefinitions,
  dbStore,
  blankDB,
  type DB,
  type UserAccount,
} from "./data-store";
import { normalizeDoubleEntryLedger } from "./accounting-coa";
import { getTenantSlug, setTenantSlug } from "./utils";

export const RBA_DEMO_TENANT_ID = "rba-demo";

export const RBA_DEMO_BRANCHES = ["RBA Main Campus", "RBA North Court"] as const;
export type RbaDemoBranchName = (typeof RBA_DEMO_BRANCHES)[number];

export type RbaDemoRoleKey =
  | "super_admin"
  | "academy_manager"
  | "branch_manager"
  | "technical_director"
  | "coach"
  | "accountant"
  | "staff";

export interface RbaDemoRoleConfig {
  key: RbaDemoRoleKey;
  role:
    | "Super Admin"
    | "Academy Manager"
    | "Branch Manager"
    | "Technical Director"
    | "Coach"
    | "Accountant"
    | "Staff";
  title: string;
  badge: string;
  defaultRoute: "/" | "/branches" | "/technical" | "/coach" | "/accounting" | "/up-erp";
  supportsBranchSwitch: boolean;
  highlights: [string, string, string];
  user: UserAccount;
}

export const RBA_DEMO_ROLES: RbaDemoRoleConfig[] = [
  {
    key: "super_admin",
    role: "Super Admin",
    title: "Super Admin",
    badge: "FULL SYSTEM AUTHORITY",
    defaultRoute: "/",
    supportsBranchSwitch: false,
    highlights: [
      "Full read/write/delete control across all 12 academy & Nexus ERP modules",
      "Configure RBAC permission matrix, system settings, and multi-branch quotas",
      "Audit consolidated & per-vertical P&L, Trial Balance, and coach payroll",
    ],
    user: {
      id: "rba-user-super-admin",
      authUid: "rba-user-super-admin",
      name: "RBA Executive Director",
      email: "director@rba-demo.test",
      username: "rba_director",
      role: "Super Admin",
      branch: "All",
      branchScope: "All branches",
      active: true,
      method: "Password",
    },
  },
  {
    key: "academy_manager",
    role: "Academy Manager",
    title: "Academy Manager (Admin)",
    badge: "OPERATIONS & ROSTER LEAD",
    defaultRoute: "/",
    supportsBranchSwitch: false,
    highlights: [
      "Manage all branches, player enrollments, team rosters, and staff invites",
      "Oversee CRM lead pipeline conversions, merchandise inventory, and billing",
      "Full operational & financial reporting across RBA Main Campus and North Court",
    ],
    user: {
      id: "rba-user-academy-manager",
      authUid: "rba-user-academy-manager",
      name: "Karim Haddad (RBA Admin)",
      email: "admin@rba-demo.test",
      username: "rba_admin",
      role: "Academy Manager",
      branch: "All",
      branchScope: "All branches",
      active: true,
      method: "Password",
    },
  },
  {
    key: "branch_manager",
    role: "Branch Manager",
    title: "Branch Manager",
    badge: "FACILITY & BRANCH SCOPED",
    defaultRoute: "/branches",
    supportsBranchSwitch: true,
    highlights: [
      "Scoped operational leadership over assigned RBA branch, courts, and schedule",
      "Submit localized branch expenses for Accountant approval & manage branch leads",
      "Enroll branch players, assign squads, and perform manual staff check-in overrides",
    ],
    user: {
      id: "rba-user-branch-manager",
      authUid: "rba-user-branch-manager",
      name: "Nadine Khoury (Branch Lead)",
      email: "branch@rba-demo.test",
      username: "rba_branch",
      role: "Branch Manager",
      branch: "RBA Main Campus",
      branchScope: "Assigned branch only",
      active: true,
      method: "Password",
    },
  },
  {
    key: "technical_director",
    role: "Technical Director",
    title: "Technical Director",
    badge: "CURRICULUM & ATHLETICS",
    defaultRoute: "/technical",
    supportsBranchSwitch: false,
    highlights: [
      "Author Master Drill Repository, review/approve Coach Practice Plans, and run Tryouts",
      "Approve match schedules, referee assignments, and monthly game frequency targets",
      "Organize Coaching Workshops, share tactical resource folders, and evaluate players",
    ],
    user: {
      id: "rba-user-tech-director",
      authUid: "rba-user-tech-director",
      name: "Coach Samer Saad (TD)",
      email: "td@rba-demo.test",
      username: "rba_td",
      role: "Technical Director",
      branch: "All",
      branchScope: "All branches",
      active: true,
      method: "Password",
    },
  },
  {
    key: "coach",
    role: "Coach",
    title: "Coach",
    badge: "PITCH-SIDE COACH PORTAL",
    defaultRoute: "/coach",
    supportsBranchSwitch: true,
    highlights: [
      "Dedicated mobile-ready Coach Portal (/coach) with GPS/Self Check-In & QR Turnstile",
      "Mark live player attendance (Present / Excused / Absent) & complete practice sessions",
      "Build practice plans from the Drill Repository, schedule games, and track payroll",
    ],
    user: {
      id: "rba-coach-1",
      authUid: "rba-coach-1",
      name: "Coach Tariq Mansour",
      email: "tariq.coach@rba-demo.test",
      username: "rba_coach_tariq",
      role: "Coach",
      branch: "RBA Main Campus",
      branchScope: "Assigned branch only",
      active: true,
      method: "Password",
    },
  },
  {
    key: "accountant",
    role: "Accountant",
    title: "Accountant",
    badge: "FINANCE & DOUBLE-ENTRY",
    defaultRoute: "/accounting",
    supportsBranchSwitch: false,
    highlights: [
      "Inspect Multi-Vertical P&L Matrix (Academy, Courts, Gym, Physio, POS, Merch, CRM)",
      "Verify balanced Double-Entry General Ledger & Trial Balance across USD and LBP",
      "Disburse attendance-verified Coach Payroll, approve branch expenses, and export PDF/CSV",
    ],
    user: {
      id: "rba-user-accountant",
      authUid: "rba-user-accountant",
      name: "Dalia Gemayel (CPA)",
      email: "accounting@rba-demo.test",
      username: "rba_accountant",
      role: "Accountant",
      branch: "All",
      branchScope: "All branches",
      active: true,
      method: "Password",
    },
  },
  {
    key: "staff",
    role: "Staff",
    title: "Receptionist / Nexus Staff",
    badge: "FRONT DESK & NEXUS ERP",
    defaultRoute: "/up-erp",
    supportsBranchSwitch: true,
    highlights: [
      "Operate Vescio Nexus Facility ERP: Court Reservations (Full & HCA/HCB), Gym, Physio, and POS",
      "Check in gym members, process Kiosk POS sales, and manage daily court bookings",
      "Read-only visibility into Academy rosters and schedules while restricted from Finance/RBAC",
    ],
    user: {
      id: "rba-user-staff",
      authUid: "rba-user-staff",
      name: "Lara Boustany (Front Desk)",
      email: "frontdesk@rba-demo.test",
      username: "rba_frontdesk",
      role: "Staff",
      branch: "RBA Main Campus",
      branchScope: "Assigned branch only",
      active: true,
      method: "Password",
    },
  },
];

export function isRbaDemoTenantActive(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const slug = getTenantSlug();
    return slug === RBA_DEMO_TENANT_ID;
  } catch {
    return false;
  }
}

export function getActiveRbaDemoRoleConfig(currentRole?: string | null): RbaDemoRoleConfig {
  const norm = (currentRole || "").trim().toLowerCase();
  return (
    RBA_DEMO_ROLES.find((r) => r.key === norm || r.role.toLowerCase() === norm) ||
    RBA_DEMO_ROLES[0]!
  );
}

function isoDateOffset(daysOffset: number, anchorDateIso?: string): string {
  const d = anchorDateIso ? new Date(`${anchorDateIso}T12:00:00.000Z`) : new Date();
  d.setUTCDate(d.getUTCDate() + daysOffset);
  return d.toISOString().slice(0, 10);
}

/**
 * Deterministic, interconnected RBA dataset covering all modules:
 * - 2 Branches (RBA Main Campus, RBA North Court)
 * - 4 Teams (U-12, U-14, U-16, U-18)
 * - 5 Coaches & 3 Staff + 7 Role Users
 * - 20 Players distributed across teams & branches
 * - 12 Sessions (5 completed past with attendance, 3 today ready for live testing, 4 upcoming)
 * - Normalized Double-Entry Ledger across all modules in USD and LBP
 * - CRM leads, Nexus Court reservations, Gym members, Physio appointments, Kiosk POS & Merchandise
 */
export function buildRbaDemoDataset(anchorDateIso?: string): DB {
  const base = blankDB();
  const today = isoDateOffset(0, anchorDateIso);
  const yesterday = isoDateOffset(-1, anchorDateIso);
  const twoDaysAgo = isoDateOffset(-2, anchorDateIso);
  const fourDaysAgo = isoDateOffset(-4, anchorDateIso);
  const sixDaysAgo = isoDateOffset(-6, anchorDateIso);
  const eightDaysAgo = isoDateOffset(-8, anchorDateIso);
  const tomorrow = isoDateOffset(1, anchorDateIso);
  const inTwoDays = isoDateOffset(2, anchorDateIso);
  const inFourDays = isoDateOffset(4, anchorDateIso);
  const inSixDays = isoDateOffset(6, anchorDateIso);

  const branches: DB["branches"] = [
    {
      id: "rba-b-main",
      name: "RBA Main Campus",
      city: "Beirut",
      manager: "Nadine Khoury",
      address: "RBA Arena Complex, Achrafieh Sector 4",
      phone: "+961 70 810 100",
      teams: 3,
      players: 15,
      courtsCount: 2,
      fixedExpenses: 2400,
      rentalType: "Per session",
      rentalRate: 45,
      operatingHours: "Mon-Sun 08:00 - 22:30",
      notes: "FIBA hardwood show court with electronic scoreboard, gym & physio clinic",
      courts: [
        {
          id: "rba-c-main-1",
          name: "Main Show Court",
          contact: "Nadine Khoury",
          phone: "+961 70 810 100",
          schedule: "08:00 - 22:30",
          operatingHours: "08:00 - 22:30",
          enableHalfCourts: true,
          fullCourtHourlyRate: 70,
          halfCourtHourlyRate: 40,
          lat: 33.8886,
          lng: 35.515,
        },
        {
          id: "rba-c-main-2",
          name: "Training Court B",
          contact: "Nadine Khoury",
          phone: "+961 70 810 101",
          schedule: "09:00 - 21:30",
          operatingHours: "09:00 - 21:30",
          enableHalfCourts: true,
          fullCourtHourlyRate: 55,
          halfCourtHourlyRate: 30,
          lat: 33.8888,
          lng: 35.5152,
        },
      ],
    },
    {
      id: "rba-b-north",
      name: "RBA North Court",
      city: "Dbayeh",
      manager: "Jad Farah",
      address: "North Seaside Sports Hub, Highway Exit 2",
      phone: "+961 70 820 200",
      teams: 1,
      players: 5,
      courtsCount: 2,
      fixedExpenses: 1600,
      rentalType: "Per session",
      rentalRate: 35,
      operatingHours: "Mon-Sun 09:00 - 22:00",
      notes: "Indoor climate-controlled training facility & recovery zone",
      courts: [
        {
          id: "rba-c-north-1",
          name: "North Arena Court 1",
          contact: "Jad Farah",
          phone: "+961 70 820 200",
          schedule: "09:00 - 22:00",
          operatingHours: "09:00 - 22:00",
          enableHalfCourts: true,
          fullCourtHourlyRate: 60,
          halfCourtHourlyRate: 35,
          lat: 33.9312,
          lng: 35.5884,
        },
        {
          id: "rba-c-north-2",
          name: "North Skills Court 2",
          contact: "Jad Farah",
          phone: "+961 70 820 201",
          schedule: "10:00 - 21:00",
          operatingHours: "10:00 - 21:00",
          enableHalfCourts: false,
          fullCourtHourlyRate: 50,
          halfCourtHourlyRate: 30,
          lat: 33.9315,
          lng: 35.5886,
        },
      ],
    },
  ];

  const coaches: DB["coaches"] = [
    {
      id: "rba-coach-1",
      name: "Coach Tariq Mansour",
      email: "tariq.coach@rba-demo.test",
      username: "rba_coach_tariq",
      phone: "+961 71 301 101",
      years: 8,
      level: "FIBA Level 2",
      gender: "M",
      wins: 14,
      losses: 3,
      sessions: 24,
      sessionTarget: 24,
      rate: 50,
      transportFee: 10,
      outstanding: 120,
      branch: "RBA Main Campus",
      branches: ["RBA Main Campus", "RBA North Court"],
      teams: ["RBA U-14 Vipers", "RBA U-16 Elite"],
      team: "RBA U-16 Elite",
      portal: true,
      licenseName: "FIBA Level 2 Certified Head Coach",
      licenseExpiry: "2027-09-30",
      finals: 3,
      championships: 2,
      finalsRecord: [
        {
          id: "rba-fin-1",
          tournament: "RBA Winter Youth Championship",
          date: sixDaysAgo,
          team: "RBA U-16 Elite",
          result: "Champion",
          score: "82 - 74",
        },
      ],
    },
    {
      id: "rba-coach-2",
      name: "Coach Maya Saab",
      email: "maya.coach@rba-demo.test",
      username: "rba_coach_maya",
      phone: "+961 71 302 102",
      years: 5,
      level: "FIBA Level 1",
      gender: "F",
      wins: 9,
      losses: 2,
      sessions: 18,
      sessionTarget: 20,
      rate: 40,
      transportFee: 8,
      outstanding: 88,
      branch: "RBA Main Campus",
      branches: ["RBA Main Campus"],
      teams: ["RBA U-12 Rising Stars"],
      team: "RBA U-12 Rising Stars",
      portal: true,
      licenseName: "FIBA Level 1 Youth Development",
      licenseExpiry: "2027-06-15",
      finals: 1,
      championships: 1,
    },
    {
      id: "rba-coach-3",
      name: "Coach Rami Nassar",
      email: "rami.coach@rba-demo.test",
      username: "rba_coach_rami",
      phone: "+961 71 303 103",
      years: 11,
      level: "FIBA Level 3",
      gender: "M",
      wins: 19,
      losses: 4,
      sessions: 22,
      sessionTarget: 24,
      rate: 60,
      transportFee: 12,
      outstanding: 144,
      branch: "RBA North Court",
      branches: ["RBA North Court"],
      teams: ["RBA U-18 Varsity"],
      team: "RBA U-18 Varsity",
      portal: true,
      licenseName: "FIBA Level 3 Pro License",
      licenseExpiry: "2028-01-20",
      finals: 4,
      championships: 3,
    },
    {
      id: "rba-coach-4",
      name: "Coach Ziad Karam",
      email: "ziad.coach@rba-demo.test",
      username: "rba_coach_ziad",
      phone: "+961 71 304 104",
      years: 4,
      level: "FIBA Level 1",
      gender: "M",
      wins: 6,
      losses: 2,
      sessions: 15,
      sessionTarget: 18,
      rate: 35,
      transportFee: 6,
      outstanding: 41,
      branch: "RBA Main Campus",
      branches: ["RBA Main Campus"],
      teams: ["RBA U-16 Elite"],
      team: "RBA U-16 Elite",
      portal: true,
    },
    {
      id: "rba-coach-5",
      name: "Coach Layla Harb",
      email: "layla.coach@rba-demo.test",
      username: "rba_coach_layla",
      phone: "+961 71 305 105",
      years: 6,
      level: "FIBA Level 2",
      gender: "F",
      wins: 8,
      losses: 3,
      sessions: 16,
      sessionTarget: 20,
      rate: 45,
      transportFee: 10,
      outstanding: 0,
      branch: "RBA North Court",
      branches: ["RBA North Court", "RBA Main Campus"],
      teams: ["RBA U-18 Varsity"],
      team: "RBA U-18 Varsity",
      portal: true,
    },
  ];

  const teams: DB["teams"] = [
    {
      id: "rba-t-u12",
      name: "RBA U-12 Rising Stars",
      category: "U-12",
      gender: "Mixed",
      branch: "RBA Main Campus",
      coach: "Coach Maya Saab",
      coachId: "rba-coach-2",
      headCoach: "Coach Maya Saab",
      headCoachId: "rba-coach-2",
      headCoachRate: 40,
      players: 5,
      wins: 9,
      losses: 2,
      monthlyFee: 120,
      gamesFrequencyPerMonth: 2,
    },
    {
      id: "rba-t-u14",
      name: "RBA U-14 Vipers",
      category: "U-14",
      gender: "Boys",
      branch: "RBA Main Campus",
      coach: "Coach Tariq Mansour",
      coachId: "rba-coach-1",
      headCoach: "Coach Tariq Mansour",
      headCoachId: "rba-coach-1",
      headCoachRate: 50,
      players: 5,
      wins: 11,
      losses: 3,
      monthlyFee: 140,
      gamesFrequencyPerMonth: 2,
    },
    {
      id: "rba-t-u16",
      name: "RBA U-16 Elite",
      category: "U-16",
      gender: "Boys",
      branch: "RBA Main Campus",
      coach: "Coach Tariq Mansour",
      coachId: "rba-coach-1",
      headCoach: "Coach Tariq Mansour",
      headCoachId: "rba-coach-1",
      headCoachRate: 50,
      assistant: "Coach Ziad Karam",
      assistantId: "rba-coach-4",
      assistantRate: 35,
      players: 5,
      wins: 14,
      losses: 3,
      monthlyFee: 150,
      gamesFrequencyPerMonth: 3,
    },
    {
      id: "rba-t-u18",
      name: "RBA U-18 Varsity",
      category: "U-18",
      gender: "Boys",
      branch: "RBA North Court",
      coach: "Coach Rami Nassar",
      coachId: "rba-coach-3",
      headCoach: "Coach Rami Nassar",
      headCoachId: "rba-coach-3",
      headCoachRate: 60,
      assistant: "Coach Layla Harb",
      assistantId: "rba-coach-5",
      assistantRate: 45,
      players: 5,
      wins: 19,
      losses: 4,
      monthlyFee: 160,
      gamesFrequencyPerMonth: 3,
    },
  ];

  const playerSpecs: Array<{
    id: string;
    name: string;
    dob: string;
    category: string;
    team: string;
    branch: RbaDemoBranchName;
    status: "Active" | "Soft flag";
    fee: number;
    paid: number;
    parent: string;
    phone: string;
  }> = [
    // Team 1: RBA U-12 Rising Stars (RBA Main Campus)
    {
      id: "rba-p-01",
      name: "Adam Khoury",
      dob: "2015-03-14",
      category: "U-12",
      team: "RBA U-12 Rising Stars",
      branch: "RBA Main Campus",
      status: "Active",
      fee: 120,
      paid: 120,
      parent: "Fadi Khoury",
      phone: "+961 70 500 101",
    },
    {
      id: "rba-p-02",
      name: "Jude Saliba",
      dob: "2015-07-22",
      category: "U-12",
      team: "RBA U-12 Rising Stars",
      branch: "RBA Main Campus",
      status: "Active",
      fee: 120,
      paid: 120,
      parent: "Marwan Saliba",
      phone: "+961 70 500 102",
    },
    {
      id: "rba-p-03",
      name: "Nour Abi Aad",
      dob: "2015-11-05",
      category: "U-12",
      team: "RBA U-12 Rising Stars",
      branch: "RBA Main Campus",
      status: "Active",
      fee: 120,
      paid: 120,
      parent: "Rania Abi Aad",
      phone: "+961 70 500 103",
    },
    {
      id: "rba-p-04",
      name: "Sami Tohme",
      dob: "2014-12-19",
      category: "U-12",
      team: "RBA U-12 Rising Stars",
      branch: "RBA Main Campus",
      status: "Soft flag",
      fee: 120,
      paid: 60,
      parent: "Elie Tohme",
      phone: "+961 70 500 104",
    },
    {
      id: "rba-p-05",
      name: "Tarek Mouawad",
      dob: "2015-05-30",
      category: "U-12",
      team: "RBA U-12 Rising Stars",
      branch: "RBA Main Campus",
      status: "Active",
      fee: 120,
      paid: 120,
      parent: "Walid Mouawad",
      phone: "+961 70 500 105",
    },
    // Team 2: RBA U-14 Vipers (RBA Main Campus)
    {
      id: "rba-p-06",
      name: "Lucas Ghanem",
      dob: "2013-02-11",
      category: "U-14",
      team: "RBA U-14 Vipers",
      branch: "RBA Main Campus",
      status: "Active",
      fee: 140,
      paid: 140,
      parent: "Antoine Ghanem",
      phone: "+961 70 500 106",
    },
    {
      id: "rba-p-07",
      name: "Karim Rizk",
      dob: "2013-06-18",
      category: "U-14",
      team: "RBA U-14 Vipers",
      branch: "RBA Main Campus",
      status: "Active",
      fee: 140,
      paid: 140,
      parent: "Bassam Rizk",
      phone: "+961 70 500 107",
    },
    {
      id: "rba-p-08",
      name: "Rayan Chahine",
      dob: "2013-09-09",
      category: "U-14",
      team: "RBA U-14 Vipers",
      branch: "RBA Main Campus",
      status: "Active",
      fee: 140,
      paid: 140,
      parent: "Ghassan Chahine",
      phone: "+961 70 500 108",
    },
    {
      id: "rba-p-09",
      name: "Mazen Frem",
      dob: "2012-11-25",
      category: "U-14",
      team: "RBA U-14 Vipers",
      branch: "RBA Main Campus",
      status: "Soft flag",
      fee: 140,
      paid: 70,
      parent: "Ziad Frem",
      phone: "+961 70 500 109",
    },
    {
      id: "rba-p-10",
      name: "Omar Dagher",
      dob: "2013-04-03",
      category: "U-14",
      team: "RBA U-14 Vipers",
      branch: "RBA Main Campus",
      status: "Active",
      fee: 140,
      paid: 140,
      parent: "Nabil Dagher",
      phone: "+961 70 500 110",
    },
    // Team 3: RBA U-16 Elite (RBA Main Campus)
    {
      id: "rba-p-11",
      name: "Jad Makhlouf",
      dob: "2011-01-17",
      category: "U-16",
      team: "RBA U-16 Elite",
      branch: "RBA Main Campus",
      status: "Active",
      fee: 150,
      paid: 150,
      parent: "Tarek Makhlouf",
      phone: "+961 70 500 111",
    },
    {
      id: "rba-p-12",
      name: "Ziad Hitti",
      dob: "2011-05-21",
      category: "U-16",
      team: "RBA U-16 Elite",
      branch: "RBA Main Campus",
      status: "Active",
      fee: 150,
      paid: 150,
      parent: "Samir Hitti",
      phone: "+961 70 500 112",
    },
    {
      id: "rba-p-13",
      name: "Fares Tannous",
      dob: "2011-08-14",
      category: "U-16",
      team: "RBA U-16 Elite",
      branch: "RBA Main Campus",
      status: "Active",
      fee: 150,
      paid: 150,
      parent: "Charbel Tannous",
      phone: "+961 70 500 113",
    },
    {
      id: "rba-p-14",
      name: "Nabil Sfeir",
      dob: "2010-12-08",
      category: "U-16",
      team: "RBA U-16 Elite",
      branch: "RBA Main Campus",
      status: "Active",
      fee: 150,
      paid: 150,
      parent: "Rami Sfeir",
      phone: "+961 70 500 114",
    },
    {
      id: "rba-p-15",
      name: "Elias Bitar",
      dob: "2011-03-29",
      category: "U-16",
      team: "RBA U-16 Elite",
      branch: "RBA Main Campus",
      status: "Soft flag",
      fee: 150,
      paid: 50,
      parent: "Michel Bitar",
      phone: "+961 70 500 115",
    },
    // Team 4: RBA U-18 Varsity (RBA North Court)
    {
      id: "rba-p-16",
      name: "Kareem Aoun",
      dob: "2009-02-10",
      category: "U-18",
      team: "RBA U-18 Varsity",
      branch: "RBA North Court",
      status: "Active",
      fee: 160,
      paid: 160,
      parent: "Joseph Aoun",
      phone: "+961 70 500 116",
    },
    {
      id: "rba-p-17",
      name: "Marc Sawaya",
      dob: "2009-06-27",
      category: "U-18",
      team: "RBA U-18 Varsity",
      branch: "RBA North Court",
      status: "Active",
      fee: 160,
      paid: 160,
      parent: "Pierre Sawaya",
      phone: "+961 70 500 117",
    },
    {
      id: "rba-p-18",
      name: "Dany Chamoun",
      dob: "2009-09-15",
      category: "U-18",
      team: "RBA U-18 Varsity",
      branch: "RBA North Court",
      status: "Active",
      fee: 160,
      paid: 160,
      parent: "Riad Chamoun",
      phone: "+961 70 500 118",
    },
    {
      id: "rba-p-19",
      name: "Hadi Maalouf",
      dob: "2008-11-30",
      category: "U-18",
      team: "RBA U-18 Varsity",
      branch: "RBA North Court",
      status: "Active",
      fee: 160,
      paid: 160,
      parent: "Adel Maalouf",
      phone: "+961 70 500 119",
    },
    {
      id: "rba-p-20",
      name: "Youssef Helou",
      dob: "2009-04-19",
      category: "U-18",
      team: "RBA U-18 Varsity",
      branch: "RBA North Court",
      status: "Soft flag",
      fee: 160,
      paid: 80,
      parent: "Fouad Helou",
      phone: "+961 70 500 120",
    },
  ];

  const players: DB["players"] = playerSpecs.map((p) => ({
    id: p.id,
    name: p.name,
    dob: p.dob,
    category: p.category,
    gender: "Boy" as const,
    branch: p.branch,
    teams: [p.team],
    team: p.team,
    school: "Collège Notre-Dame",
    status: p.status,
    fee: p.fee,
    balance: Math.max(0, p.fee - p.paid),
    parent: p.parent,
    parentPhone: p.phone,
    phone: p.phone,
    attendance: 92,
    registered: eightDaysAgo,
    packageName: "Monthly Pro Squad (3x/Week)",
  }));

  // 12 Sessions: 5 completed past, 3 today (ready for live Coach Portal attendance), 4 upcoming
  const sessions: DB["sessions"] = [
    // Past Completed Sessions (5)
    {
      id: "rba-sess-01",
      kind: "Practice",
      title: "RBA U-16 Elite — Defensive Shell & Closeouts",
      team: "RBA U-16 Elite",
      detail: "Main Show Court",
      court: "Main Show Court",
      date: eightDaysAgo,
      time: "17:00",
      branch: "RBA Main Campus",
      coach: "Coach Tariq Mansour",
      coachId: "rba-coach-1",
      headCoach: "Coach Tariq Mansour",
      headCoachId: "rba-coach-1",
      assistantCoach: "Coach Ziad Karam",
      assistantCoachId: "rba-coach-4",
      status: "Completed",
      coachAttendance: "Present",
      coachCheckedInAt: `${eightDaysAgo}T16:50:00.000Z`,
      coachCheckedInBy: "Coach Tariq Mansour (Self Check-in)",
    },
    {
      id: "rba-sess-02",
      kind: "Practice",
      title: "RBA U-14 Vipers — Ball Screen Reads",
      team: "RBA U-14 Vipers",
      detail: "Training Court B",
      court: "Training Court B",
      date: sixDaysAgo,
      time: "16:00",
      branch: "RBA Main Campus",
      coach: "Coach Tariq Mansour",
      coachId: "rba-coach-1",
      headCoach: "Coach Tariq Mansour",
      headCoachId: "rba-coach-1",
      status: "Completed",
      coachAttendance: "Present",
      coachCheckedInAt: `${sixDaysAgo}T15:52:00.000Z`,
      coachCheckedInBy: "Coach Tariq Mansour (Self Check-in)",
    },
    {
      id: "rba-sess-03",
      kind: "Game",
      title: "RBA U-16 Elite vs Beirut Cedars U-16",
      team: "RBA U-16 Elite",
      teamA: "RBA U-16 Elite",
      teamB: "Beirut Cedars U-16",
      gameType: "League",
      detail: "Main Show Court",
      court: "Main Show Court",
      date: fourDaysAgo,
      time: "18:30",
      branch: "RBA Main Campus",
      coach: "Coach Tariq Mansour",
      coachId: "rba-coach-1",
      headCoach: "Coach Tariq Mansour",
      headCoachId: "rba-coach-1",
      status: "Official",
      score: "79 - 68",
      report: "Strong transition defense in Q3; Jad Makhlouf led with 22 pts and 7 assists.",
      coachAttendance: "Present",
      coachCheckedInAt: `${fourDaysAgo}T18:05:00.000Z`,
    },
    {
      id: "rba-sess-04",
      kind: "Practice",
      title: "RBA U-12 Rising Stars — Footwork & Layup Finishing",
      team: "RBA U-12 Rising Stars",
      detail: "Training Court B",
      court: "Training Court B",
      date: twoDaysAgo,
      time: "15:30",
      branch: "RBA Main Campus",
      coach: "Coach Maya Saab",
      coachId: "rba-coach-2",
      headCoach: "Coach Maya Saab",
      headCoachId: "rba-coach-2",
      status: "Completed",
      coachAttendance: "Present",
      coachCheckedInAt: `${twoDaysAgo}T15:20:00.000Z`,
    },
    {
      id: "rba-sess-05",
      kind: "Practice",
      title: "RBA U-18 Varsity — Half-Court Sets & Press Break",
      team: "RBA U-18 Varsity",
      detail: "North Arena Court 1",
      court: "North Arena Court 1",
      date: yesterday,
      time: "19:00",
      branch: "RBA North Court",
      coach: "Coach Rami Nassar",
      coachId: "rba-coach-3",
      headCoach: "Coach Rami Nassar",
      headCoachId: "rba-coach-3",
      status: "Completed",
      coachAttendance: "Present",
      coachCheckedInAt: `${yesterday}T18:48:00.000Z`,
    },
    // Today's Live / Planned Sessions (3 — ready for Coach Portal testing)
    {
      id: "rba-sess-06",
      kind: "Practice",
      title: "RBA U-16 Elite — Today's Tactical & Transition Session",
      team: "RBA U-16 Elite",
      detail: "Main Show Court",
      court: "Main Show Court",
      date: today,
      time: "17:00",
      branch: "RBA Main Campus",
      coach: "Coach Tariq Mansour",
      coachId: "rba-coach-1",
      headCoach: "Coach Tariq Mansour",
      headCoachId: "rba-coach-1",
      assistantCoach: "Coach Ziad Karam",
      assistantCoachId: "rba-coach-4",
      status: "Planned",
      planId: "rba-plan-1",
    },
    {
      id: "rba-sess-07",
      kind: "Practice",
      title: "RBA U-14 Vipers — Perimeter Shooting & Spacing",
      team: "RBA U-14 Vipers",
      detail: "Training Court B",
      court: "Training Court B",
      date: today,
      time: "18:30",
      branch: "RBA Main Campus",
      coach: "Coach Tariq Mansour",
      coachId: "rba-coach-1",
      headCoach: "Coach Tariq Mansour",
      headCoachId: "rba-coach-1",
      status: "Planned",
    },
    {
      id: "rba-sess-08",
      kind: "Practice",
      title: "RBA U-18 Varsity — North Court Scrimmage & Conditioning",
      team: "RBA U-18 Varsity",
      detail: "North Arena Court 1",
      court: "North Arena Court 1",
      date: today,
      time: "19:30",
      branch: "RBA North Court",
      coach: "Coach Rami Nassar",
      coachId: "rba-coach-3",
      headCoach: "Coach Rami Nassar",
      headCoachId: "rba-coach-3",
      status: "Planned",
    },
    // Upcoming Sessions (4)
    {
      id: "rba-sess-09",
      kind: "Practice",
      title: "RBA U-12 Rising Stars — Dribbling Mechanics",
      team: "RBA U-12 Rising Stars",
      detail: "Training Court B",
      court: "Training Court B",
      date: tomorrow,
      time: "16:00",
      branch: "RBA Main Campus",
      coach: "Coach Maya Saab",
      coachId: "rba-coach-2",
      headCoach: "Coach Maya Saab",
      headCoachId: "rba-coach-2",
      status: "Planned",
    },
    {
      id: "rba-sess-10",
      kind: "Game",
      title: "RBA U-16 Elite vs Metn Falcons U-16",
      team: "RBA U-16 Elite",
      teamA: "RBA U-16 Elite",
      teamB: "Metn Falcons U-16",
      gameType: "League",
      detail: "Main Show Court",
      court: "Main Show Court",
      date: inTwoDays,
      time: "18:00",
      branch: "RBA Main Campus",
      coach: "Coach Tariq Mansour",
      coachId: "rba-coach-1",
      headCoach: "Coach Tariq Mansour",
      headCoachId: "rba-coach-1",
      status: "Pre-approved",
      approvalStatus: "Approved",
    },
    {
      id: "rba-sess-11",
      kind: "Practice",
      title: "RBA U-14 Vipers — Motion Offense Clinic",
      team: "RBA U-14 Vipers",
      detail: "Main Show Court",
      court: "Main Show Court",
      date: inFourDays,
      time: "17:00",
      branch: "RBA Main Campus",
      coach: "Coach Tariq Mansour",
      coachId: "rba-coach-1",
      headCoach: "Coach Tariq Mansour",
      headCoachId: "rba-coach-1",
      status: "Planned",
    },
    {
      id: "rba-sess-12",
      kind: "Game",
      title: "RBA U-18 Varsity vs Coastline Titans U-18",
      team: "RBA U-18 Varsity",
      teamA: "RBA U-18 Varsity",
      teamB: "Coastline Titans U-18",
      gameType: "Friendly",
      detail: "North Arena Court 1",
      court: "North Arena Court 1",
      date: inSixDays,
      time: "19:00",
      branch: "RBA North Court",
      coach: "Coach Rami Nassar",
      coachId: "rba-coach-3",
      headCoach: "Coach Rami Nassar",
      headCoachId: "rba-coach-3",
      status: "Pre-approved",
      approvalStatus: "Approved",
    },
  ];

  const attendance: DB["attendance"] = {
    "rba-sess-01": {
      "rba-p-11": "Present",
      "rba-p-12": "Present",
      "rba-p-13": "Present",
      "rba-p-14": "Present",
      "rba-p-15": "Excused",
    },
    "rba-sess-02": {
      "rba-p-06": "Present",
      "rba-p-07": "Present",
      "rba-p-08": "Present",
      "rba-p-09": "Absent",
      "rba-p-10": "Present",
    },
    "rba-sess-03": {
      "rba-p-11": "Present",
      "rba-p-12": "Present",
      "rba-p-13": "Present",
      "rba-p-14": "Present",
      "rba-p-15": "Present",
    },
    "rba-sess-04": {
      "rba-p-01": "Present",
      "rba-p-02": "Present",
      "rba-p-03": "Present",
      "rba-p-04": "Present",
      "rba-p-05": "Present",
    },
    "rba-sess-05": {
      "rba-p-16": "Present",
      "rba-p-17": "Present",
      "rba-p-18": "Present",
      "rba-p-19": "Excused",
      "rba-p-20": "Present",
    },
  };

  // Normalized Double-Entry Ledger covering every vertical in USD and LBP
  const rawLedgerEntries = [
    // Academy Revenue (USD & LBP)
    {
      id: "rba-led-01",
      date: eightDaysAgo,
      account: "Player Fees",
      entry: "U-16 Elite Monthly Subscriptions (5 Players)",
      type: "Revenue" as const,
      amount: 650,
      status: "Collected" as const,
      branch: "RBA Main Campus",
      module: "academy" as const,
      paymentMethod: "Cash",
      currency: "USD" as const,
      originalAmount: 650,
      exchangeRate: 1,
    },
    {
      id: "rba-led-02",
      date: sixDaysAgo,
      account: "Player Fees",
      entry: "U-14 Vipers & U-12 Rising Stars Tuition Batch",
      type: "Revenue" as const,
      amount: 1150,
      status: "Collected" as const,
      branch: "RBA Main Campus",
      module: "academy" as const,
      paymentMethod: "Card",
      currency: "USD" as const,
      originalAmount: 1150,
      exchangeRate: 1,
    },
    {
      id: "rba-led-03",
      date: fourDaysAgo,
      account: "Player Fees",
      entry: "U-18 Varsity Tuition Settlement (LBP Cash Drawer)",
      type: "Revenue" as const,
      amount: 720,
      status: "Collected" as const,
      branch: "RBA North Court",
      module: "academy" as const,
      paymentMethod: "Cash (LBP)",
      currency: "LBP" as const,
      originalAmount: 720 * 89500,
      exchangeRate: 89500,
    },
    // Nexus Courts Revenue & Expense
    {
      id: "rba-led-04",
      date: fourDaysAgo,
      account: "Court Rental Income (Vescio Nexus)",
      entry: "Prime-Time Full Court Bookings (Main Show Court)",
      type: "Revenue" as const,
      amount: 420,
      status: "Collected" as const,
      branch: "RBA Main Campus",
      module: "courts" as const,
      paymentMethod: "Cash",
    },
    {
      id: "rba-led-05",
      date: twoDaysAgo,
      account: "Court Rental Income (Vescio Nexus)",
      entry: "North Arena Court 1 Evening Corporate League Rental",
      type: "Revenue" as const,
      amount: 310,
      status: "Collected" as const,
      branch: "RBA North Court",
      module: "courts" as const,
      paymentMethod: "Card",
    },
    // Nexus Gym Revenue
    {
      id: "rba-led-06",
      date: sixDaysAgo,
      account: "Gym & S&C Membership Income (Vescio Nexus)",
      entry: "Athletic Performance Gym Memberships (Monthly & PT)",
      type: "Revenue" as const,
      amount: 540,
      status: "Collected" as const,
      branch: "RBA Main Campus",
      module: "gym" as const,
      paymentMethod: "Cash",
    },
    // Nexus Physio Revenue & Expense
    {
      id: "rba-led-07",
      date: twoDaysAgo,
      account: "Physiotherapy & Medical Clinic Income (Vescio Nexus)",
      entry: "Sports Rehab & Ankle Taping Sessions (4 Athletes)",
      type: "Revenue" as const,
      amount: 280,
      status: "Collected" as const,
      branch: "RBA Main Campus",
      module: "physio" as const,
      paymentMethod: "Card",
    },
    {
      id: "rba-led-08",
      date: twoDaysAgo,
      account: "Medical & Clinic Consumables",
      entry: "Kinesio Tape, Ice Compression Wraps & Rehab Supplies",
      type: "Expense" as const,
      amount: 75,
      status: "Paid" as const,
      branch: "RBA Main Campus",
      module: "physio" as const,
      paymentMethod: "Cash",
    },
    // Nexus Kiosk POS Revenue & COGS
    {
      id: "rba-led-09",
      date: yesterday,
      account: "Kiosk POS & Refreshments Income (Vescio Nexus)",
      entry: "Isotonic Drinks, Protein Shakes & Energy Bars (LBP Counter)",
      type: "Revenue" as const,
      amount: 195,
      status: "Collected" as const,
      branch: "RBA Main Campus",
      module: "pos" as const,
      paymentMethod: "Cash (LBP)",
      currency: "LBP" as const,
      originalAmount: 195 * 89500,
      exchangeRate: 89500,
    },
    {
      id: "rba-led-10",
      date: yesterday,
      account: "Kiosk POS Cost of Goods Sold (COGS)",
      entry: "Beverage & Nutrition Wholesale Cost Allocation",
      type: "Expense" as const,
      amount: 82,
      status: "Paid" as const,
      branch: "RBA Main Campus",
      module: "pos" as const,
      paymentMethod: "Cash",
    },
    // Merchandise Revenue & COGS
    {
      id: "rba-led-11",
      date: fourDaysAgo,
      account: "Merchandise Sales",
      entry: "RBA Pro Reversible Game Kits & Warmup Hoodies",
      type: "Revenue" as const,
      amount: 460,
      status: "Collected" as const,
      branch: "RBA Main Campus",
      module: "merchandise" as const,
      paymentMethod: "Card",
    },
    {
      id: "rba-led-12",
      date: fourDaysAgo,
      account: "Merchandise Cost of Goods Sold (COGS)",
      entry: "Supplier Batch Cost — Reversible Jerseys & Printing",
      type: "Expense" as const,
      amount: 190,
      status: "Paid" as const,
      branch: "RBA Main Campus",
      module: "merchandise" as const,
      paymentMethod: "Bank Transfer",
    },
    // CRM Conversion Revenue
    {
      id: "rba-led-13",
      date: yesterday,
      account: "CRM Lead Conversion & Registration Fees",
      entry: "Tryout-to-Academy Conversion Package (2 New Athletes)",
      type: "Revenue" as const,
      amount: 240,
      status: "Collected" as const,
      branch: "RBA Main Campus",
      module: "crm" as const,
      paymentMethod: "Cash",
    },
    // Academy Coach Payroll & Facility Expenses
    {
      id: "rba-led-14",
      date: yesterday,
      account: "Coach Payroll Expense",
      entry: "Coach Payroll Disbursement · Coach Tariq Mansour (3 Verified Sessions + Transport)",
      type: "Expense" as const,
      amount: 180,
      status: "Paid" as const,
      branch: "RBA Main Campus",
      module: "academy" as const,
      coachId: "rba-coach-1",
      referenceId: "rba-coach-1",
      paymentMethod: "Cash",
    },
    {
      id: "rba-led-15",
      date: yesterday,
      account: "Coach Payroll Expense",
      entry: "Coach Payroll Disbursement · Coach Rami Nassar (North Court Varsity)",
      type: "Expense" as const,
      amount: 144,
      status: "Paid" as const,
      branch: "RBA North Court",
      module: "academy" as const,
      coachId: "rba-coach-3",
      referenceId: "rba-coach-3",
      paymentMethod: "Cash",
    },
    {
      id: "rba-led-16",
      date: sixDaysAgo,
      account: "Rental",
      entry: "Branch Expense: RBA Main Campus — Monthly Court & Lighting Lease",
      type: "Expense" as const,
      amount: 850,
      status: "Paid" as const,
      branch: "RBA Main Campus",
      module: "general" as const,
      paymentMethod: "Bank Transfer",
    },
    {
      id: "rba-led-17",
      date: fourDaysAgo,
      account: "Utilities",
      entry: "Branch Expense: RBA North Court — Generator & HVAC Power",
      type: "Expense" as const,
      amount: 320,
      status: "Paid" as const,
      branch: "RBA North Court",
      module: "general" as const,
      paymentMethod: "Cash",
    },
    {
      id: "rba-led-18",
      date: today,
      account: "Equipment",
      entry: "Branch Expense: RBA Main Campus — FIBA Game Balls & Shot Clock Maintenance",
      type: "Expense" as const,
      amount: 165,
      status: "Pending" as const,
      branch: "RBA Main Campus",
      module: "academy" as const,
      note: "Submitted by Branch Manager Nadine Khoury for Accountant approval",
    },
  ];

  const ledger: DB["ledger"] = rawLedgerEntries.map((entry) => normalizeDoubleEntryLedger(entry));

  const crmLeads: DB["crmLeads"] = [
    {
      id: "rba-lead-1",
      playerName: "Zayn Kanaan",
      gender: "Boy",
      parentName: "Walid Kanaan",
      parentPhone: "+961 71 910 001",
      parentEmail: "walid.kanaan@example.com",
      dob: "2012-05-14",
      category: "U-14",
      preferredBranch: "RBA Main Campus",
      stage: "inquiry",
      source: "Instagram Ad",
      offeredMonthlyFee: 140,
      generalNotes: "Played school varsity; looking for 3x/week competitive U-14 squad.",
      communications: [],
      reminders: [],
      createdAt: twoDaysAgo,
      updatedAt: today,
    },
    {
      id: "rba-lead-2",
      playerName: "Celine Hariri",
      gender: "Girl",
      parentName: "Nada Hariri",
      parentPhone: "+961 71 910 002",
      parentEmail: "nada.hariri@example.com",
      dob: "2015-02-20",
      category: "U-12",
      preferredBranch: "RBA Main Campus",
      stage: "trial_scheduled",
      source: "Walk-in",
      trialDate: tomorrow,
      offeredMonthlyFee: 120,
      generalNotes: "Scheduled for U-12 Rising Stars assessment with Coach Maya.",
      communications: [],
      reminders: [],
      createdAt: fourDaysAgo,
      updatedAt: today,
    },
    {
      id: "rba-lead-3",
      playerName: "Tarek Barakat",
      gender: "Boy",
      parentName: "Samer Barakat",
      parentPhone: "+961 71 910 003",
      parentEmail: "samer.barakat@example.com",
      dob: "2011-09-01",
      category: "U-16",
      preferredBranch: "RBA Main Campus",
      stage: "pending_registration",
      source: "Referral",
      offeredMonthlyFee: 150,
      generalNotes: "Completed tryout with Coach Tariq; pro package offer dispatched.",
      communications: [],
      reminders: [],
      createdAt: sixDaysAgo,
      updatedAt: yesterday,
    },
    {
      id: "rba-lead-4",
      playerName: "Rami Geagea",
      gender: "Boy",
      parentName: "Naji Geagea",
      parentPhone: "+961 71 910 004",
      parentEmail: "naji.geagea@example.com",
      dob: "2009-03-11",
      category: "U-18",
      preferredBranch: "RBA North Court",
      stage: "active_converted",
      source: "Tournament Scout",
      offeredMonthlyFee: 160,
      generalNotes: "Converted to RBA U-18 Varsity roster.",
      communications: [],
      reminders: [],
      createdAt: eightDaysAgo,
      updatedAt: twoDaysAgo,
    },
  ];

  const courtReservations: DB["courtReservations"] = [
    {
      id: "rba-res-1",
      branch: "RBA Main Campus",
      court: "Main Show Court",
      courtAllocation: "Full Court",
      clientName: "Beirut Corporate Hoops League",
      clientType: "Corporate / Club",
      phone: "+961 70 601 111",
      date: today,
      startTime: "20:00",
      endTime: "21:30",
      durationHours: 1.5,
      hourlyRate: 70,
      totalAmount: 105,
      paidAmount: 105,
      paymentStatus: "Paid",
      status: "Confirmed",
      notes: "Full court evening corporate match with scoreboard.",
    },
    {
      id: "rba-res-2",
      branch: "RBA Main Campus",
      court: "Training Court B",
      courtAllocation: "Half Court - HCA",
      clientName: "Coach Private Shooting Clinic",
      clientType: "External Client",
      phone: "+961 70 601 222",
      date: today,
      startTime: "14:00",
      endTime: "15:00",
      durationHours: 1,
      hourlyRate: 30,
      totalAmount: 30,
      paidAmount: 0,
      paymentStatus: "Pending",
      status: "Confirmed",
      notes: "Half-Court A shooting gun rental.",
    },
    {
      id: "rba-res-3",
      branch: "RBA North Court",
      court: "North Arena Court 1",
      courtAllocation: "Full Court",
      clientName: "Dbayeh Veterans 5v5",
      clientType: "Corporate / Club",
      phone: "+961 70 601 333",
      date: tomorrow,
      startTime: "20:30",
      endTime: "22:00",
      durationHours: 1.5,
      hourlyRate: 60,
      totalAmount: 90,
      paidAmount: 90,
      paymentStatus: "Paid",
      status: "Confirmed",
    },
  ];

  const gymMembers: DB["gymMembers"] = [
    {
      id: "rba-gym-1",
      memberName: "Jad Makhlouf",
      memberType: "Academy Player",
      linkedPlayerId: "rba-p-11",
      phone: "+961 70 500 111",
      branch: "RBA Main Campus",
      packageName: "Athlete S&C Unlimited",
      packageType: "Athlete Pro S&C",
      monthlyFee: 85,
      status: "Active",
      startDate: eightDaysAgo,
      expiryDate: isoDateOffset(22, anchorDateIso),
      balance: 0,
      totalCheckIns: 7,
      lastCheckInDate: yesterday,
      workoutLogs: [],
      createdAt: eightDaysAgo,
    },
    {
      id: "rba-gym-2",
      memberName: "Kareem Aoun",
      memberType: "Academy Player",
      linkedPlayerId: "rba-p-16",
      phone: "+961 70 500 116",
      branch: "RBA North Court",
      packageName: "Varsity Strength & Vertical Jump",
      packageType: "Athlete Pro S&C",
      monthlyFee: 85,
      status: "Active",
      startDate: sixDaysAgo,
      expiryDate: isoDateOffset(24, anchorDateIso),
      balance: 0,
      totalCheckIns: 5,
      lastCheckInDate: today,
      workoutLogs: [],
      createdAt: sixDaysAgo,
    },
    {
      id: "rba-gym-3",
      memberName: "Cyril Naccache",
      memberType: "External Member",
      phone: "+961 71 888 321",
      branch: "RBA Main Campus",
      packageName: "Open Gym & Recovery Pass",
      packageType: "Monthly Unlimited",
      monthlyFee: 60,
      status: "Expired",
      startDate: isoDateOffset(-32, anchorDateIso),
      expiryDate: yesterday,
      balance: 60,
      totalCheckIns: 11,
      workoutLogs: [],
      createdAt: isoDateOffset(-32, anchorDateIso),
    },
  ];

  const physioRecords: DB["physioRecords"] = [
    {
      id: "rba-phys-1",
      patientName: "Fares Tannous",
      patientType: "Academy Player",
      linkedPlayerId: "rba-p-13",
      phone: "+961 70 500 113",
      branch: "RBA Main Campus",
      medicalStatus: "Fit",
      injuryArea: "Ankle / Foot",
      diagnosis: "Mild lateral ankle sprain recovery; cleared for full contact practice.",
      severity: "Mild (Grade 1)",
      intakeDate: fourDaysAgo,
      therapistName: "Dr. Hala Frem (Sports Physio)",
      rtpStage: 5,
      restrictions: "Kinesio taping recommended for competitive games.",
      treatmentSessions: [
        {
          id: "rba-phys-sess-1",
          date: today,
          time: "16:00",
          therapistName: "Dr. Hala Frem (Sports Physio)",
          modality: "Manual Therapy & Mobilization",
          soapNotes: "Ankle Stability & Kinesio Taping completed; full ROM restored.",
          painScore: 1,
          fee: 45,
          paymentStatus: "Paid",
          status: "Completed",
        },
      ],
      createdAt: fourDaysAgo,
      updatedAt: today,
    },
    {
      id: "rba-phys-2",
      patientName: "Hadi Maalouf",
      patientType: "Academy Player",
      linkedPlayerId: "rba-p-19",
      phone: "+961 70 500 119",
      branch: "RBA North Court",
      medicalStatus: "Limited",
      injuryArea: "Hamstring / Groin",
      diagnosis: "Post-match hamstring tightness before U-18 friendly.",
      severity: "Mild (Grade 1)",
      intakeDate: yesterday,
      therapistName: "Dr. Hala Frem (Sports Physio)",
      rtpStage: 4,
      restrictions: "Limit maximal sprint reps to 80% intensity for 48 hours.",
      treatmentSessions: [
        {
          id: "rba-phys-sess-2",
          date: tomorrow,
          time: "17:30",
          therapistName: "Dr. Hala Frem (Sports Physio)",
          modality: "Cryotherapy & Compression",
          soapNotes: "Hamstring Myofascial Release & Cryo scheduled.",
          painScore: 2,
          fee: 55,
          paymentStatus: "Pending",
          status: "Scheduled",
        },
      ],
      createdAt: yesterday,
      updatedAt: today,
    },
  ];

  const stock: DB["stock"] = [
    {
      id: "rba-stk-1",
      item: "RBA Official Reversible Game Kit (Home/Away)",
      supplier: "RBA Pro Teamwear",
      variant: "Large · Orange/Black",
      price: 45,
      sellingPrice: 45,
      costPrice: 19,
      stock: 34,
      qty: 34,
      reorder: 10,
      status: "In stock",
      branch: "RBA Main Campus",
    },
    {
      id: "rba-stk-2",
      item: "RBA Pro Shooting Warmup Hoodie",
      supplier: "RBA Pro Teamwear",
      variant: "Medium · Charcoal",
      price: 55,
      sellingPrice: 55,
      costPrice: 24,
      stock: 18,
      qty: 18,
      reorder: 8,
      status: "In stock",
      branch: "RBA Main Campus",
    },
    {
      id: "rba-stk-3",
      item: "Molten BG4500 FIBA Approved Size 7 Basketball",
      supplier: "Molten Official Distributor",
      variant: "Size 7 · Official Leather",
      price: 75,
      sellingPrice: 75,
      costPrice: 42,
      stock: 14,
      qty: 14,
      reorder: 6,
      status: "In stock",
      branch: "RBA North Court",
    },
  ];

  const drills: DB["drills"] = [
    {
      id: "rba-dr-1",
      title: "RBA 3-Man Weave to Corner 3 Transition",
      category: "Transition",
      duration: 15,
      durationMinutes: 15,
      difficulty: "Intermediate",
      intensity: "High",
      coachingPoints: "Sprint wide lanes, hit weak-side corner fill, make the extra pass read.",
      description: "Full-court 3-man weave with weak-side corner fill and extra pass read.",
    },
    {
      id: "rba-dr-2",
      title: "Spain Pick-and-Roll Reads & Back-Screen Timing",
      category: "Spacing",
      duration: 20,
      durationMinutes: 20,
      difficulty: "Advanced",
      intensity: "High",
      coachingPoints: "Shooter sets back-screen on drop big and flares to top of key.",
      description: "High ball screen with shooter back-screening the drop big and flaring to top.",
    },
    {
      id: "rba-dr-3",
      title: "4-on-4 Shell Defensive Rotations & Box-Out",
      category: "Defense",
      duration: 15,
      durationMinutes: 15,
      difficulty: "Intermediate",
      intensity: "Medium",
      coachingPoints: "Low-man stunts on baseline drive, weak-side wing sinks to nail.",
      description: "Help-the-helper low post trap rotation and physical rebound seal.",
    },
    {
      id: "rba-dr-4",
      title: "5-Spot Catch & Shoot Pressure Series (70% Target)",
      category: "Shooting",
      duration: 12,
      durationMinutes: 12,
      difficulty: "Intermediate",
      intensity: "Medium",
      coachingPoints: "Hop into shot pocket, hold follow-through, communicate makes aloud.",
      description: "Timed perimeter shooting with game-speed footwork and pass relocation.",
    },
  ];

  const plans: DB["plans"] = [
    {
      id: "rba-plan-1",
      title: "RBA U-16 Elite — High-Tempo Transition & Spain PnR",
      category: "U-16",
      team: "RBA U-16 Elite",
      coach: "Coach Tariq Mansour",
      coachId: "rba-coach-1",
      focus: "First-3-seconds transition spacing and Spain PnR execution",
      date: today,
      status: "Approved",
      review: "Approved by TD Samer Saad — emphasize weak-side corner spacing.",
      blocks: [
        {
          id: "rba-blk-1",
          name: "Dynamic Mobility & Ball Handling Activation",
          minutes: 12,
          notes: "2-ball pound dribbles and hip mobility across full court.",
        },
        {
          id: "rba-blk-2",
          name: "RBA 3-Man Weave to Corner 3 Transition",
          minutes: 18,
          notes: "No dribble touches before half-court line.",
          drillId: "rba-dr-1",
        },
        {
          id: "rba-blk-3",
          name: "Spain Pick-and-Roll 5v5 Controlled Scrimmage",
          minutes: 25,
          notes: "Punish drop coverage with flare screen.",
          drillId: "rba-dr-2",
        },
      ],
    },
    {
      id: "rba-plan-2",
      title: "RBA U-14 Vipers — Perimeter Footwork & Closeouts",
      category: "U-14",
      team: "RBA U-14 Vipers",
      coach: "Coach Tariq Mansour",
      coachId: "rba-coach-1",
      focus: "High-hand closeouts and 1-more-pass perimeter shooting",
      date: tomorrow,
      status: "Submitted",
      review: "",
      blocks: [
        {
          id: "rba-blk-4",
          name: "Closeout Sprint & Slide Footwork",
          minutes: 15,
          notes: "Chop steps on catch, contest without fouling.",
        },
        {
          id: "rba-blk-5",
          name: "5-Spot Catch & Shoot Pressure Series",
          minutes: 20,
          notes: "Must hit 35/50 team makes.",
          drillId: "rba-dr-4",
        },
      ],
    },
  ];

  const workshops: DB["workshops"] = [
    {
      id: "rba-ws-1",
      type: "Physical",
      title: "RBA Technical Symposium: Modern European Ball-Screen Defense",
      topic: "Hedging, Ice/Blue Coverage & Weak-Side Tag Rotations",
      venue: "RBA Main Campus — Video Room",
      date: inTwoDays,
      time: "19:30",
      location: "RBA Main Campus — Video Room",
      presenter: "Coach Samer Saad (Technical Director)",
      status: "Upcoming",
      description:
        "Tactical breakdown of hedging, ice/blue coverage, and weak-side tag rotations across U-14 to U-18 squads.",
      assignedCoaches: ["rba-coach-1", "rba-coach-2", "rba-coach-3", "rba-coach-4", "rba-coach-5"],
      assignedLevels: ["FIBA Level 1", "FIBA Level 2", "FIBA Level 3"],
      attendance: {
        "rba-coach-2": "Present",
        "rba-coach-3": "Present",
      },
      attendeeIds: ["rba-coach-2", "rba-coach-3"],
      documents: [],
    },
  ];

  const resourceFolders: DB["resourceFolders"] = [
    {
      id: "rba-rf-1",
      name: "RBA 2026 Offensive & Defensive Playbook",
      accessType: "All",
      accessCoaches: ["rba-coach-1", "rba-coach-2", "rba-coach-3", "rba-coach-4", "rba-coach-5"],
      items: [
        {
          id: "rba-ri-1",
          name: "RBA Defensive Terminology & Rotations Quiz",
          type: "Interactive Form",
          quiz: {
            questions: [
              {
                id: "q-rba-1",
                prompt:
                  "On a baseline drive against our Shell defense, which defender rotates to protect the rim?",
                type: "Text",
              },
            ],
          },
        },
      ],
    },
  ];

  const staff: DB["staff"] = [
    {
      id: "rba-stf-1",
      name: "Nadine Khoury",
      position: "Branch Manager",
      branch: "RBA Main Campus",
      phone: "+961 70 810 100",
      email: "branch@rba-demo.test",
      dob: "1991-04-12",
      salary: 1400,
    },
    {
      id: "rba-stf-2",
      name: "Dalia Gemayel",
      position: "Senior Accountant",
      branch: "RBA Main Campus",
      phone: "+961 70 810 105",
      email: "accounting@rba-demo.test",
      dob: "1989-08-24",
      salary: 1500,
    },
    {
      id: "rba-stf-3",
      name: "Lara Boustany",
      position: "Nexus Front Desk & POS Coordinator",
      branch: "RBA Main Campus",
      phone: "+961 70 810 109",
      email: "frontdesk@rba-demo.test",
      dob: "1996-11-03",
      salary: 950,
    },
  ];

  const users: DB["users"] = RBA_DEMO_ROLES.map((r) => ({ ...r.user }));

  return {
    ...base,
    academy: {
      ...base.academy,
      name: "RBA Basketball Academy",
      url: "rba-demo.vesciovector.app",
      plan: "Enterprise Multi-Branch + Nexus ERP",
      playersLimit: 500,
      branchesLimit: 10,
      currency: "USD",
      currencies: ["USD", "LBP"],
    },
    branches,
    teams,
    coaches,
    players,
    sessions,
    attendance,
    ledger,
    crmLeads,
    courtReservations,
    gymMembers,
    physioRecords,
    posCatalog: DEFAULT_POS_CATALOG,
    stock,
    drills,
    plans,
    workshops,
    resourceFolders,
    staff,
    users,
    customRoles: defaultRoleDefinitions,
  };
}

const RBA_FIRESTORE_COLLECTIONS: Array<keyof DB> = [
  "branches",
  "teams",
  "coaches",
  "players",
  "sessions",
  "ledger",
  "crmLeads",
  "courtReservations",
  "gymMembers",
  "physioRecords",
  "posCatalog",
  "posTransactions",
  "stock",
  "orders",
  "invoices",
  "drills",
  "plans",
  "workshops",
  "resourceFolders",
  "staff",
  "users",
  "customRoles",
  "notifications",
  "suppliers",
  "groups",
];

function stripUndefinedDeep<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v !== undefined) {
      clean[k] = stripUndefinedDeep(v);
    }
  }
  return clean as T;
}

export interface RbaSeedCounts {
  branches: number;
  teams: number;
  coaches: number;
  players: number;
  sessions: number;
  ledger: number;
}

/**
 * Seeds the complete RBA Demo dataset into `rba-demo` (both reactive local cache and
 * chunked Firestore batches of <= 400 operations when Firebase Auth is available).
 */
export async function seedRbaDemoData(
  tenantIdOrProgress?: string | ((message: string) => void),
  maybeOnProgress?: (message: string) => void,
): Promise<{ totalRecords: number; counts: RbaSeedCounts }> {
  const onProgress =
    typeof tenantIdOrProgress === "function" ? tenantIdOrProgress : maybeOnProgress;
  const dataset = buildRbaDemoDataset();

  onProgress?.("Preparing RBA branches, rosters, sessions, and double-entry ledger…");

  if (typeof window !== "undefined") {
    setTenantSlug(RBA_DEMO_TENANT_ID);
    window.localStorage.setItem("vv_rba_demo_active", "true");
    window.localStorage.setItem("vv_rba_demo_initialized", "true");
    window.localStorage.setItem("vv_rba_demo_seeded", "true");
    window.localStorage.removeItem("vv_rba_demo_wiped");
    window.localStorage.setItem(`vv_cache_${RBA_DEMO_TENANT_ID}`, JSON.stringify(dataset));
  }

  dbStore.resetTenant(RBA_DEMO_TENANT_ID);
  dbStore.setWholeDB(dataset);

  const counts: RbaSeedCounts = {
    branches: dataset.branches.length,
    teams: dataset.teams.length,
    coaches: dataset.coaches.length,
    players: dataset.players.length,
    sessions: dataset.sessions.length,
    ledger: dataset.ledger.length,
  };

  let totalRecords =
    dataset.branches.length +
    dataset.teams.length +
    dataset.coaches.length +
    dataset.players.length +
    dataset.sessions.length +
    dataset.ledger.length +
    dataset.crmLeads.length +
    dataset.courtReservations.length +
    dataset.gymMembers.length +
    dataset.physioRecords.length +
    dataset.stock.length +
    dataset.drills.length +
    dataset.plans.length +
    dataset.workshops.length +
    dataset.resourceFolders.length +
    dataset.staff.length +
    dataset.users.length;

  // Persist to Firestore /tenants/rba-demo/... in chunks of 400 when Firestore connection is available
  if (firestore && (!auth?.currentUser || !auth.currentUser.isAnonymous)) {
    try {
      onProgress?.("Syncing RBA demo dataset to Firestore /tenants/rba-demo…");
      const ops: Array<{ col: string; id: string; data: Record<string, unknown> }> = [];

      for (const colKey of RBA_FIRESTORE_COLLECTIONS) {
        const list = dataset[colKey];
        if (Array.isArray(list)) {
          for (const item of list) {
            const rec = item as Record<string, unknown>;
            if (rec && typeof rec.id === "string") {
              ops.push({
                col: String(colKey),
                id: rec.id,
                data: stripUndefinedDeep(rec),
              });
            }
          }
        }
      }

      for (const [sessId, records] of Object.entries(dataset.attendance || {})) {
        ops.push({
          col: "attendance",
          id: sessId,
          data: { id: sessId, records: stripUndefinedDeep(records) },
        });
      }

      // Explicitly guarantee all seeded workshops (e.g. rba-ws-1) are persisted at tenants/rba-demo/workshops/{id}
      for (const ws of dataset.workshops || []) {
        await setDoc(
          doc(firestore, "tenants", RBA_DEMO_TENANT_ID, "workshops", ws.id),
          stripUndefinedDeep(ws as unknown as Record<string, unknown>),
          { merge: true },
        );
      }

      const CHUNK_SIZE = 400;
      for (let i = 0; i < ops.length; i += CHUNK_SIZE) {
        const slice = ops.slice(i, i + CHUNK_SIZE);
        const batch = writeBatch(firestore);
        for (const op of slice) {
          batch.set(doc(firestore, "tenants", RBA_DEMO_TENANT_ID, op.col, op.id), op.data, {
            merge: true,
          });
        }
        await batch.commit();
      }

      await setDoc(
        doc(firestore, "tenants", RBA_DEMO_TENANT_ID),
        stripUndefinedDeep({
          academy: dataset.academy,
          appearance: dataset.appearance,
          lists: dataset.lists,
        }),
        { merge: true },
      );
      totalRecords = ops.length;
    } catch (err) {
      console.warn("RBA Demo Firestore batch write notice (local sandbox cache active):", err);
    }
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("vv:rba-demo-tenant-change"));
  }

  onProgress?.("RBA demo dataset ready.");
  return { totalRecords, counts };
}

/**
 * Bulletproof Wipe Engine for `rba-demo`.
 * Strictly enforces `tenantId === "rba-demo"` before performing any deletion.
 * Wipes both seeded and user-submitted records across all collections (including workshops) in chunks of 400.
 */
export async function wipeRbaDemoData(
  tenantId: string = getTenantSlug(),
  onProgress?: (message: string) => void,
): Promise<{ deletedCount: number; deletedDocs: number }> {
  if (tenantId !== RBA_DEMO_TENANT_ID) {
    throw new Error("Wipe blocked: non-demo tenant");
  }

  onProgress?.("Verifying rba-demo tenant isolation guard…");

  let deletedCount = 0;

  // 1. Wipe all Firestore collections under /tenants/rba-demo/{collection} (including workshops) in chunks of 400
  if (firestore && (!auth?.currentUser || !auth.currentUser.isAnonymous)) {
    const allCols = Array.from(
      new Set([...RBA_FIRESTORE_COLLECTIONS, "workshops" as const, "attendance" as const]),
    );
    const refsToDelete: ReturnType<typeof doc>[] = [];

    for (const colName of allCols) {
      try {
        onProgress?.(`Scanning /tenants/rba-demo/${String(colName)}…`);
        const snap = await getDocs(
          collection(firestore, "tenants", RBA_DEMO_TENANT_ID, String(colName)),
        );
        snap.docs.forEach((d) => {
          refsToDelete.push(d.ref);
        });
      } catch {
        // Ignore collection read notice when offline or unauthenticated
      }
    }

    const CHUNK_SIZE = 400;
    for (let i = 0; i < refsToDelete.length; i += CHUNK_SIZE) {
      const slice = refsToDelete.slice(i, i + CHUNK_SIZE);
      onProgress?.(
        `Deleting batch ${Math.floor(i / CHUNK_SIZE) + 1} of ${Math.ceil(refsToDelete.length / CHUNK_SIZE)} (${slice.length} docs)…`,
      );
      const batch = writeBatch(firestore);
      for (const ref of slice) {
        batch.delete(ref);
      }
      try {
        await batch.commit();
        deletedCount += slice.length;
      } catch (err) {
        console.warn("RBA Demo batch delete notice:", err);
      }
    }

    try {
      await deleteDoc(doc(firestore, "tenants", RBA_DEMO_TENANT_ID, "workshops", "rba-ws-1")).catch(
        () => {},
      );
      await deleteDoc(doc(firestore, "tenants", RBA_DEMO_TENANT_ID, "public", "auth_lookup")).catch(
        () => {},
      );
    } catch {
      // ignore
    }
  }

  // 2. Wipe local cache and reactive DB store slices for rba-demo (including any user-submitted records)
  const emptyDb = blankDB();
  const blankRbaDb: DB = {
    ...emptyDb,
    academy: {
      ...emptyDb.academy,
      name: "RBA Basketball Academy",
      currency: "USD",
      currencies: ["USD", "LBP"],
    },
    branches: [],
    teams: [],
    coaches: [],
    players: [],
    sessions: [],
    attendance: {},
    attendanceMeta: {},
    ledger: [],
    crmLeads: [],
    courtReservations: [],
    gymMembers: [],
    physioRecords: [],
    posTransactions: [],
    stock: [],
    orders: [],
    invoices: [],
    drills: [],
    plans: [],
    workshops: [],
    resourceFolders: [],
    staff: [],
    users: RBA_DEMO_ROLES.map((r) => ({ ...r.user })),
    customRoles: defaultRoleDefinitions,
    posCatalog: DEFAULT_POS_CATALOG,
  };

  if (typeof window !== "undefined") {
    window.localStorage.setItem("vv_rba_demo_seeded", "false");
    window.localStorage.setItem("vv_rba_demo_wiped", "true");
    window.localStorage.removeItem(`vv_cache_${RBA_DEMO_TENANT_ID}`);
    window.localStorage.setItem(`vv_cache_${RBA_DEMO_TENANT_ID}`, JSON.stringify(blankRbaDb));
  }

  dbStore.resetTenant(RBA_DEMO_TENANT_ID);
  dbStore.setWholeDB(blankRbaDb);

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("vv:rba-demo-tenant-change"));
  }

  onProgress?.("All RBA demo and user-submitted records wiped cleanly.");
  return { deletedCount, deletedDocs: deletedCount };
}

/**
 * Wipes all existing + user-submitted records in `rba-demo` and immediately re-seeds a fresh dataset.
 */
export async function resetRbaDemoData(
  tenantId: string = getTenantSlug(),
  onProgress?: (message: string) => void,
): Promise<{
  deletedCount: number;
  totalRecords: number;
  wipeResult: { deletedCount: number; deletedDocs: number };
  seedResult: { totalRecords: number; counts: RbaSeedCounts };
}> {
  if (tenantId !== RBA_DEMO_TENANT_ID) {
    throw new Error("Wipe blocked: non-demo tenant");
  }
  const wipeResult = await wipeRbaDemoData(RBA_DEMO_TENANT_ID, onProgress);
  const seedResult = await seedRbaDemoData(RBA_DEMO_TENANT_ID, onProgress);
  return {
    deletedCount: wipeResult.deletedCount,
    totalRecords: seedResult.totalRecords,
    wipeResult,
    seedResult,
  };
}

/**
 * Switches into the isolated `rba-demo` tenant under the requested role (and optional branch context)
 * without touching production tenants. Automatically seeds the initial RBA demo dataset on first entry
 * unless the user explicitly wiped to a blank slate.
 */
export function enterRbaDemoAsRole(
  roleKeyOrName: RbaDemoRoleKey | string,
  options: { branch?: string; autoSeedIfUninitialized?: boolean } = {},
): RbaDemoRoleConfig {
  const roleConfig = getActiveRbaDemoRoleConfig(roleKeyOrName);
  const effectiveBranch =
    options.branch || (roleConfig.supportsBranchSwitch ? roleConfig.user.branch : "All");
  const effectiveBranchScope =
    roleConfig.supportsBranchSwitch && effectiveBranch !== "All"
      ? ("Assigned branch only" as const)
      : ("All branches" as const);

  const sessionUser: UserAccount & { tenantId: string } = {
    ...roleConfig.user,
    branch: effectiveBranch,
    branchScope: effectiveBranchScope,
    tenantId: RBA_DEMO_TENANT_ID,
  };

  if (typeof window !== "undefined") {
    setTenantSlug(RBA_DEMO_TENANT_ID);
    window.localStorage.setItem("vv_rba_demo_active", "true");
    window.localStorage.setItem("vv_rba_demo_role_key", roleConfig.key);
    window.localStorage.setItem("vv_rba_demo_branch", effectiveBranch);
    window.localStorage.setItem("vv_auth_session_user", JSON.stringify(sessionUser));
    window.sessionStorage.setItem("vv_auth_session_user", JSON.stringify(sessionUser));

    const isInitialized = window.localStorage.getItem("vv_rba_demo_initialized") === "true";
    const isExplicitlyWiped = window.localStorage.getItem("vv_rba_demo_wiped") === "true";
    const hasCachedData = Boolean(window.localStorage.getItem(`vv_cache_${RBA_DEMO_TENANT_ID}`));

    if (
      options.autoSeedIfUninitialized !== false &&
      (!isInitialized || (!hasCachedData && !isExplicitlyWiped))
    ) {
      const dataset = buildRbaDemoDataset();
      window.localStorage.setItem("vv_rba_demo_initialized", "true");
      window.localStorage.setItem("vv_rba_demo_seeded", "true");
      window.localStorage.setItem(`vv_cache_${RBA_DEMO_TENANT_ID}`, JSON.stringify(dataset));
      dbStore.resetTenant(RBA_DEMO_TENANT_ID);
      dbStore.setWholeDB(dataset);
      void seedRbaDemoData(RBA_DEMO_TENANT_ID);
    } else {
      dbStore.hydrateFromLocalCache(RBA_DEMO_TENANT_ID);
    }

    window.dispatchEvent(new CustomEvent("vv:rba-demo-auth-change"));
    window.dispatchEvent(new CustomEvent("vv:rba-demo-tenant-change"));
  }

  return roleConfig;
}

export function exitRbaDemoToDefaultTenant(defaultTenant = "donbosco"): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem("vv_rba_demo_active");
  window.localStorage.removeItem("vv_rba_demo_role_key");
  window.localStorage.removeItem("vv_rba_demo_branch");
  setTenantSlug(defaultTenant);
  dbStore.resetTenant(defaultTenant);
  window.dispatchEvent(new CustomEvent("vv:rba-demo-auth-change"));
  window.dispatchEvent(new CustomEvent("vv:rba-demo-tenant-change"));
}
